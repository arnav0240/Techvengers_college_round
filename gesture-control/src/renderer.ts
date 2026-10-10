/**
 * renderer.ts — HEAD-CURSOR entry point (runs in the browser context).
 *
 * Pipeline (per spec):
 *                  WEBCAM
 *                     │
 *              ┌──────┴──────┐
 *              │             │
 *          Face Landmarker  Hand Landmarker
 *              │             │
 *           Nose point    Pinch detection
 *              │             │
 *              ▼             │
 *         Head movement      │
 *              │             │
 *         Calibration        │
 *              │             │
 *         Dead zone          │
 *              │             │
 *          Smoothing         │
 *              │             │
 *              ▼             ▼
 *         Cursor position   Click event
 *              │             │
 *              └──────┬──────┘
 *                     │
 *                     ▼
 *               Input controller
 *               (gesture-cursor-move / gesture-click events)
 *
 * Cursor = RELATIVE velocity control: displacement of the nose from a
 * calibrated neutral pose drives velocity (p += v*dt). Returning to neutral
 * stops the cursor — it never snaps back to centre. Face lost → freeze.
 * Click = thumb+index pinch (release re-arms, via GestureDetector latch).
 */

import './index.css';
import {
  startCamera,
  stopCamera,
  isCameraRunning,
  getCameraErrorMessage,
} from './vision/camera';
import {
  getHandLandmarker,
  detectHand,
  drawLandmarks,
  clearOverlay,
  disposeHandLandmarker,
} from './vision/hand-landmarker';
import {
  getFaceLandmarker,
  detectFace,
  getNosePoint,
  drawNosePoint,
  disposeFaceLandmarker,
} from './vision/face-landmarker';
import { GestureDetector } from './gestures/gesture-detector';
import { ConfirmTracker } from './gestures/confirm-tracker';
import { GestureController } from './controller/gesture-controller';
import {
  HeadCursorController,
  drawHeadFrame,
  type HeadCursorUpdate,
} from './controller/head-cursor-controller';

const video = getEl<HTMLVideoElement>('webcam');
const overlay = getEl<HTMLCanvasElement>('overlay');
const startBtn = getEl<HTMLButtonElement>('startBtn');
const stopBtn = getEl<HTMLButtonElement>('stopBtn');
const calibrateBtn = getEl<HTMLButtonElement>('calibrateBtn');
const recenterBtn = getEl<HTMLButtonElement>('recenterBtn');
const sensitivity = getEl<HTMLInputElement>('sensitivity');
const sensitivityVal = getEl<HTMLSpanElement>('sensitivityVal');
const deadzone = getEl<HTMLInputElement>('deadzone');
const deadzoneVal = getEl<HTMLSpanElement>('deadzoneVal');
const browserBtn = getEl<HTMLButtonElement>('browserBtn');
const browserStatusEl = getEl<HTMLParagraphElement>('browserStatus');
const statusEl = getEl<HTMLParagraphElement>('cameraStatus');
const headStatusEl = getEl<HTMLParagraphElement>('headStatus');
const handStatusEl = getEl<HTMLParagraphElement>('handStatus');
const errorBox = getEl<HTMLDivElement>('errorBox');
const dot = getEl<HTMLSpanElement>('cameraDot');
const pillText = getEl<HTMLSpanElement>('cameraPillText');
const faceDot = getEl<HTMLSpanElement>('faceDot');
const facePillText = getEl<HTMLSpanElement>('facePillText');
const handDot = getEl<HTMLSpanElement>('handDot');
const handPillText = getEl<HTMLSpanElement>('handPillText');
const liveBadge = getEl<HTMLDivElement>('liveBadge');
const modeBadge = getEl<HTMLDivElement>('modeBadge');
const commandBadge = getEl<HTMLDivElement>('commandBadge');
const debugPre = getEl<HTMLPreElement>('debugPre');

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id} — check index.html.`);
  return el as T;
}

let rafId = 0;
let loopRunning = false;
let lastDetectMs = 0;
let lastHeadUpdateMs = 0;
let detectorsReady = false;
const DETECT_INTERVAL_MS = 40; // ~25 FPS

const detector = new GestureDetector();
const controller = new GestureController();
const confirmer = new ConfirmTracker();
const head = new HeadCursorController({
  deadZone: 0.025,
  sensitivityX: 9,
  sensitivityY: 9,
});
let lastLabel = '';
let lastCursor: HeadCursorUpdate | null = null;
let lastNose: { x: number; y: number } | null = null;
/** True once the Playwright gesture browser is launched and linked. */
let browserLinked = false;

function setBrowserUI(message: string): void {
  browserStatusEl.textContent = message;
  browserBtn.textContent = browserLinked ? 'Close Browser' : 'Launch Browser';
}

function setCameraUI(running: boolean, message: string): void {
  statusEl.textContent = message;
  dot.classList.toggle('on', running);
  pillText.textContent = running ? 'Camera running' : 'Camera stopped';
  liveBadge.classList.toggle('hidden', !running);
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function setFaceUI(
  state: 'loading' | 'ready' | 'detected' | 'lost' | 'error' | 'uncalibrated',
  message: string,
): void {
  headStatusEl.textContent = message;
  faceDot.classList.toggle('on', state === 'detected');
  if (state === 'loading') facePillText.textContent = 'Face detector loading…';
  else if (state === 'ready' || state === 'lost')
    facePillText.textContent = 'No face';
  else if (state === 'uncalibrated') facePillText.textContent = 'Calibrate →';
  else if (state === 'detected') facePillText.textContent = 'Face tracked';
  else facePillText.textContent = 'Face detector failed';
}

function setHandUI(
  state: 'loading' | 'ready' | 'detected' | 'lost' | 'error',
  message: string,
): void {
  handStatusEl.textContent = message;
  handDot.classList.toggle('on', state === 'detected');
  if (state === 'loading') handPillText.textContent = 'Hand detector loading…';
  else if (state === 'ready' || state === 'lost')
    handPillText.textContent = 'No hand';
  else if (state === 'detected') handPillText.textContent = 'Hand detected';
  else handPillText.textContent = 'Hand detector failed';
}

/**
 * Green badge, top-right: shows the exact command being executed.
 * The last fired command STAYS visible for 1.5s after the pose ends,
 * so it reads like a sign — not a flickering light.
 */
const BADGE_HOLD_MS = 1500;
let heldLabel = '';
let heldUntilMs = 0;

function setCommand(label: string, active: boolean, nowMs: number): void {
  if (active) {
    heldLabel = label;
    heldUntilMs = nowMs + BADGE_HOLD_MS;
    if (label !== lastLabel) {
      const d = detector.debug;
      console.log(
        `[gesture] ${label} | fingers I:${+d.index} M:${+d.middle} R:${+d.ring} P:${+d.pinky} T:${+d.thumb} | gap:${d.pinchGap.toFixed(3)} len:${d.pointLen.toFixed(3)} dx:${d.pointDx.toFixed(3)} dy:${d.pointDy.toFixed(3)}`,
      );
      lastLabel = label;
      lastFiredLabel = label;
      lastFiredAtMs = nowMs;
    }
  } else if (nowMs > heldUntilMs) {
    heldLabel = '';
    lastLabel = '';
  }
  const shown = heldLabel || label;
  commandBadge.textContent = shown;
  commandBadge.classList.toggle('idle', !heldLabel);
}

function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearError(): void {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

async function preloadDetectors(): Promise<void> {
  setFaceUI('loading', 'Loading face detector (model needs internet once)…');
  setHandUI(
    'loading',
    'Loading hand detector (model ~8MB, needs internet once)…',
  );
  try {
    await Promise.all([getFaceLandmarker(), getHandLandmarker()]);
    detectorsReady = true;
    setFaceUI(
      'ready',
      'Face detector ready — look straight ahead, then Calibrate.',
    );
    setHandUI('ready', 'Hand detector ready — pinch thumb + index to click.');
  } catch (error) {
    console.error('[vision] model load failed:', error);
    setFaceUI(
      'error',
      'Face detector failed to load. Check internet, then reload.',
    );
    setHandUI(
      'error',
      'Hand detector failed to load. Check internet, then reload.',
    );
    showError(
      'Could not load the MediaPipe models. They download once from Google storage — check your connection and reload the app.',
    );
  }
}

function detectionLoop(nowMs: number): void {
  if (!loopRunning) return;
  rafId = requestAnimationFrame(detectionLoop);

  if (nowMs - lastDetectMs < DETECT_INTERVAL_MS) return;
  if (!detectorsReady || !isCameraRunning(video)) return;
  const dtSeconds =
    lastHeadUpdateMs === 0
      ? DETECT_INTERVAL_MS / 1000
      : (nowMs - lastHeadUpdateMs) / 1000;
  lastDetectMs = nowMs;
  lastHeadUpdateMs = nowMs;

  // Independent tracks off the SAME frame: face → nose, hand → pinch.
  const faces = detectFace(video, nowMs);
  const hands = detectHand(video, nowMs);
  const nose = getNosePoint(faces);
  lastNose = nose ? { x: nose.x, y: nose.y } : null;

  const ctx = overlay.getContext('2d');
  if (ctx) {
    if (
      overlay.width !== video.videoWidth ||
      overlay.height !== video.videoHeight
    ) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }
  if (hands.length > 0 && hands[0]) {
    drawLandmarks(overlay, video, hands);
    setHandUI('detected', `Hand detected — pinch thumb + index to click.`);
  } else {
    setHandUI('lost', 'No hand — pinch needs thumb + index in view.');
  }
  drawNosePoint(overlay, lastNose, head.calibrated);

  // Classify hand every tick (pinch owns a release-to-rearm latch).
  const result = detector.update(hands, nowMs);
  const out = controller.process(result.gesture);

  // Head cursor: relative velocity from neutral. Face lost or uncalibrated
  // → freeze in place (never drift, never snap back to centre).
  lastCursor = head.update(lastNose, dtSeconds);
  if (!head.calibrated) {
    setFaceUI(
      lastNose ? 'uncalibrated' : 'lost',
      lastNose
        ? 'Face visible — press “Calibrate neutral” while looking straight ahead.'
        : 'No face — show your face to the camera.',
    );
  } else {
    setFaceUI(
      lastNose ? 'detected' : 'lost',
      lastNose
        ? `Head cursor x:${lastCursor.x.toFixed(2)} y:${lastCursor.y.toFixed(2)} — inside circle = stop, outside = move.`
        : 'Face lost — cursor frozen.',
    );
  }

  // Click = pinch (independent of scroll/cursor mode badge). The detector's
  // pinchJustFired latch forces a release before the next CLICK can fire,
  // which is the required "release to re-arm" behaviour.
  // Relative OS mode clicks at the CURRENT OS cursor (no coords) so we never
  // yank the user's mouse.
  if (result.gesture === 'pinch') {
    window.dispatchEvent(
      new CustomEvent<HeadCursorUpdate>('gesture-click', {
        detail: { ...lastCursor },
      }),
    );
  }
  // Confirm flag: thumbs-up → True, cancel (thumbs-down) → False.
  // Edge-triggered — fires ONLY on change, never repeats while held.
  const confirmChanged = confirmer.update(result.gesture);
  if (confirmChanged !== null) {
    console.log(`[confirm] is_confirm=${confirmChanged ? 'True' : 'False'}`);
    window.dispatchEvent(
      new CustomEvent<boolean>('gesture-confirm', {
        detail: confirmChanged,
      }),
    );
  }
  // Relative control: only emit a move while actually displaced beyond the
  // dead zone. Inside the zone (moved=false) emit NOTHING — the OS cursor
  // stays wherever it is (head or physical mouse owns it, never fights it).
  if (lastCursor.moved) {
    window.dispatchEvent(
      new CustomEvent<HeadCursorUpdate>('gesture-cursor-move', {
        detail: { ...lastCursor },
      }),
    );
  }

  // Badge: pinch-click takes priority so the CLICK flash is unmissable;
  // otherwise show the controller's scroll/pause label.
  if (result.gesture === 'pinch') {
    setCommand('CLICK', true, nowMs);
    handStatusEl.textContent = 'Gesture: pinch → CLICK';
  } else {
    setCommand(out.label, out.active, nowMs);
    if (out.active) {
      handStatusEl.textContent = `Gesture: ${result.gesture} → ${out.label}`;
    }
  }

  // Gesture → Playwright browser (no-ops unless a browser is linked).
  // Cursor moves + pinch clicks flow via the gesture-*/window events below;
  // discrete actions are forwarded here.
  if (browserLinked && window.browserInput) {
    if (out.action === 'scroll_up') window.browserInput.wheel(-500);
    else if (out.action === 'scroll_down') window.browserInput.wheel(500);
    else if (out.action === 'confirm') window.browserInput.key('Enter');
    else if (out.action === 'cancel') window.browserInput.key('Escape');
  }
  const isScroll = controller.mode === 'scroll';
  modeBadge.textContent = isScroll ? 'SCROLL MODE' : 'CURSOR MODE';
  modeBadge.classList.toggle('scroll', isScroll);
  modeBadge.classList.toggle('cursor', !isScroll);

  // Axis widget lives at the calibrated nose origin — always visible once
  // calibrated so the stop-circle is easy to find in any mode.
  // (Drawn raw on the mirrored canvas so +x reads screen-right, +y down.)
  const neutral = head.neutralPoint;
  const smoothNose = head.smoothedNose ?? lastNose;
  if (head.calibrated && neutral && smoothNose) {
    drawHeadFrame(overlay, {
      neutral,
      nose: smoothNose,
      deadZone: head.deadZoneRadius,
      inside: head.inDeadZone,
    });
  }

  updateDebugPanel(nowMs);
}

let lastDebugPaintMs = 0;
let lastFiredLabel = '—';
let lastFiredAtMs = 0;

/** Paint detector + head-cursor internals 2x/sec + latched "last fired". */
function updateDebugPanel(nowMs: number): void {
  if (nowMs - lastDebugPaintMs < 500) return;
  lastDebugPaintMs = nowMs;
  const d = detector.debug;
  const hd = head.debug;
  const n = head.neutralPoint;
  const bit = (v: boolean): string => (v ? '1' : '0');
  const agoSec =
    lastFiredAtMs === 0
      ? '—'
      : `${((nowMs - lastFiredAtMs) / 1000).toFixed(1)}s ago`;
  debugPre.textContent =
    `LAST FIRED  ${lastFiredLabel}  (${agoSec})\n` +
    `now        ${d.gesture}\n` +
    `head       ${head.calibrated ? `neutral(${n?.x.toFixed(3)},${n?.y.toFixed(3)})` : 'UNCALIBRATED'} dx:${hd.dx.toFixed(3)} dy:${hd.dy.toFixed(3)} r:${hd.radius.toFixed(3)} R:${hd.deadZone.toFixed(3)} vx:${hd.vx.toFixed(2)} vy:${hd.vy.toFixed(2)}${hd.inDeadZone ? ' IN-CIRCLE' : ''}${hd.faceVisible ? '' : ' FACE-LOST'}\n` +
    `cursor     ${lastCursor ? `x:${lastCursor.x.toFixed(2)} y:${lastCursor.y.toFixed(2)}` : '—'}\n` +
    `pinchGap   ${d.pinchGap.toFixed(3)}  (fires < 0.060, release to re-arm)\n` +
    `fingers    I:${bit(d.index)} M:${bit(d.middle)} R:${bit(d.ring)} P:${bit(d.pinky)} T:${bit(d.thumb)}\n` +
    `drift      ${d.drift.toFixed(3)}  (hold needs < 0.030)\n` +
    `hold       ${d.holdMs}ms\n` +
    `cooldown   ${d.discreteReadyInMs}ms\n` +
    `confirm    is_confirm=${confirmer.value ? 'True' : 'False'}  (thumbs-up → True, cancel → False, change-only)\n` +
    `browser    ${browserLinked ? 'LINKED — gestures drive Chromium' : '— (press Launch Browser)'}`;
}

function startLoop(): void {
  if (loopRunning) return;
  loopRunning = true;
  lastDetectMs = 0;
  lastHeadUpdateMs = 0;
  rafId = requestAnimationFrame(detectionLoop);
}

function stopLoop(): void {
  loopRunning = false;
  cancelAnimationFrame(rafId);
  clearOverlay(overlay);
  head.reset();
  confirmer.reset();
  lastCursor = null;
  setCommand('READY', false, performance.now());
}

async function handleStart(): Promise<void> {
  clearError();
  setCameraUI(isCameraRunning(video), 'Requesting camera…');
  try {
    await startCamera(video);
    setCameraUI(true, 'Camera is running — you should see yourself.');
    if (!detectorsReady) await preloadDetectors();
    startLoop();
  } catch (error) {
    console.error('[camera] start failed:', error);
    showError(getCameraErrorMessage(error));
    setCameraUI(false, 'Camera failed to start. See error above.');
  }
}

function handleStop(): void {
  clearError();
  stopLoop();
  stopCamera(video);
  setCameraUI(false, 'Camera stopped. Press Start Camera to restart.');
  setFaceUI(
    detectorsReady ? 'ready' : 'loading',
    'Detector paused — camera stopped.',
  );
  setHandUI(
    detectorsReady ? 'ready' : 'loading',
    'Detector paused — camera stopped.',
  );
}

function handleCalibrate(): void {
  if (!lastNose) {
    setFaceUI('lost', 'No face to calibrate — look at the camera, then retry.');
    return;
  }
  head.calibrate(lastNose);
  console.log(
    `[head] calibrated neutral=(${lastNose.x.toFixed(3)},${lastNose.y.toFixed(3)})`,
  );
  setFaceUI(
    'detected',
    'Calibrated — nudge your head to steer, return to neutral to stop.',
  );
}

startBtn.addEventListener('click', () => void handleStart());
stopBtn.addEventListener('click', handleStop);
calibrateBtn.addEventListener('click', handleCalibrate);
recenterBtn.addEventListener('click', () => {
  head.recenter();
});
browserBtn.addEventListener('click', () => void handleBrowserToggle());

// Head cursor + pinch → OS / gesture browser (only while linked).
// RELATIVE protocol: deltas only, never absolute jumps — so the physical
// mouse keeps working whenever the head is inside the dead zone (no events
// fire then at all). Server maps dnx/dny → pixels: X_os += dnx * screenW.
window.addEventListener('gesture-cursor-move', (e) => {
  if (!browserLinked || !window.browserInput) return;
  const d = (e as CustomEvent<HeadCursorUpdate>).detail;
  if (!d || !d.moved) return;
  window.browserInput.moveRel(d.dx, d.dy);
});
window.addEventListener('gesture-click', () => {
  if (!browserLinked || !window.browserInput) return;
  window.browserInput.clickCurrent();
});

async function handleBrowserToggle(): Promise<void> {
  if (!window.browserInput) {
    setBrowserUI('Bridge unavailable — preload did not load.');
    return;
  }
  browserBtn.disabled = true;
  try {
    if (!browserLinked) {
      setBrowserUI('Launching gesture browser…');
      const res = await window.browserInput.launch();
      if (res.ok) {
        browserLinked = true;
        setBrowserUI(
          'Browser linked — head steers its mouse, pinch clicks. Scroll/point gestures work too.',
        );
      } else {
        setBrowserUI(`Browser failed to launch: ${res.error ?? 'unknown'}`);
      }
    } else {
      await window.browserInput.close();
      browserLinked = false;
      setBrowserUI('Gesture browser closed.');
    }
  } finally {
    browserBtn.disabled = false;
    setBrowserUI(browserStatusEl.textContent ?? '');
  }
}
sensitivity.addEventListener('input', () => {
  const k = Number.parseFloat(sensitivity.value);
  head.setSensitivity(k);
  sensitivityVal.textContent = k.toFixed(1);
});
deadzone.addEventListener('input', () => {
  const r = Number.parseFloat(deadzone.value);
  head.setDeadZone(r);
  deadzoneVal.textContent = r.toFixed(3);
});

window.addEventListener('beforeunload', () => {
  stopLoop();
  stopCamera(video);
  disposeHandLandmarker();
  disposeFaceLandmarker();
});

setCameraUI(false, 'Starting camera…');
setFaceUI('loading', 'Loading face detector…');
setHandUI('loading', 'Loading hand detector…');
setBrowserUI('Gesture browser not launched.');
setCommand('READY', false, performance.now());
head.setSensitivity(Number.parseFloat(sensitivity.value));
sensitivityVal.textContent = Number.parseFloat(sensitivity.value).toFixed(1);
head.setDeadZone(Number.parseFloat(deadzone.value));
deadzoneVal.textContent = Number.parseFloat(deadzone.value).toFixed(3);
void preloadDetectors();
void handleStart();
