import { useEffect, useRef, useState } from 'react'
import './VideoComponent.css'
import { startCamera, stopCamera } from '../vision/camera'
import {
  getHandLandmarker,
  detectHand,
  drawLandmarks,
  clearOverlay,
  disposeHandLandmarker
} from '../vision/hand-landmarker'
import {
  getFaceLandmarker,
  detectFace,
  getNosePoint,
  drawNosePoint,
  disposeFaceLandmarker
} from '../vision/face-landmarker'
import { GestureDetector } from '../gestures/gesture-detector'
import { GestureController } from '../controller/gesture-controller'
import {
  HeadCursorController,
  drawHeadFrame,
  type HeadCursorUpdate
} from '../controller/head-cursor-controller'
import {
  launchGestureBrowser,
  moveBrowserCursorRel,
  clickBrowserCursorCurrent,
  wheelBrowser,
  pressBrowserKey
} from '../browser/os-driver'

const DETECT_INTERVAL_MS = 40 // ~25 FPS, same as gesture-control
const BADGE_HOLD_MS = 1500

/**
 * VideoComponent — the full gesture-control pipeline, video frame + banners only.
 * Same camera, same MediaPipe landmarkers, same detector/controller/head-cursor
 * and same os-driver wiring as gesture-control/src/renderer.ts.
 * Output: <video> feed + <canvas> overlay + LIVE / mode / command banners.
 * No buttons, no sliders, no panels. Auto-links the :8765 server (main
 * autostarts daemon.sh + run.sh) and auto-calibrates on first face.
 */
function VideoComponent(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const liveBadgeRef = useRef<HTMLDivElement | null>(null)
  const modeBadgeRef = useRef<HTMLDivElement | null>(null)
  const commandBadgeRef = useRef<HTMLDivElement | null>(null)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay) return

    let cancelled = false
    let rafId = 0
    let loopRunning = false
    let lastDetectMs = 0
    let lastHeadUpdateMs = 0
    let detectorsReady = false
    let linked = false
    let lastNose: { x: number; y: number } | null = null
    let lastLabel = ''
    let heldLabel = ''
    let heldUntilMs = 0

    const detector = new GestureDetector()
    const controller = new GestureController()
    const head = new HeadCursorController({
      deadZone: 0.025,
      sensitivityX: 9,
      sensitivityY: 9
    })

    const setCommand = (label: string, active: boolean, nowMs: number): void => {
      if (active) {
        heldLabel = label
        heldUntilMs = nowMs + BADGE_HOLD_MS
        if (label !== lastLabel) {
          lastLabel = label
        }
      } else if (nowMs > heldUntilMs) {
        heldLabel = ''
        lastLabel = ''
      }
      const badge = commandBadgeRef.current
      if (badge) {
        badge.textContent = heldLabel || label
        badge.classList.toggle('idle', !heldLabel)
      }
    }

    const setMode = (): void => {
      const badge = modeBadgeRef.current
      if (!badge) return
      const isScroll = controller.mode === 'scroll'
      badge.textContent = isScroll ? 'SCROLL MODE' : 'CURSOR MODE'
      badge.classList.toggle('scroll', isScroll)
      badge.classList.toggle('cursor', !isScroll)
    }

    let nextLinkAttemptMs = 0
    let lastDirLogMs = 0
    const tryLink = async (nowMs: number): Promise<void> => {
      if (linked || nowMs < nextLinkAttemptMs) return
      nextLinkAttemptMs = nowMs + 2000
      try {
        await launchGestureBrowser()
        linked = true
      } catch {
        // server not up yet (main is still starting run.sh) — retry in 2s
      }
    }

    const detectionLoop = (nowMs: number): void => {
      if (!loopRunning || cancelled) return
      rafId = requestAnimationFrame(detectionLoop)
      if (nowMs - lastDetectMs < DETECT_INTERVAL_MS) return
      if (!detectorsReady) return
      if (video.readyState < 2 || video.videoWidth === 0) return
      const dtSeconds =
        lastHeadUpdateMs === 0
          ? DETECT_INTERVAL_MS / 1000
          : (nowMs - lastHeadUpdateMs) / 1000
      lastDetectMs = nowMs
      lastHeadUpdateMs = nowMs

      void tryLink(nowMs)

      // Same frame → face/nose + hand/pinch, independently.
      const faces = detectFace(video, nowMs)
      const hands = detectHand(video, nowMs)
      const nose = getNosePoint(faces)
      lastNose = nose ? { x: nose.x, y: nose.y } : null

      const ctx = overlay.getContext('2d')
      if (ctx) {
        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
          overlay.width = video.videoWidth
          overlay.height = video.videoHeight
        }
        ctx.clearRect(0, 0, overlay.width, overlay.height)
      }
      if (hands.length > 0 && hands[0]) {
        drawLandmarks(overlay, video, hands)
      }
      drawNosePoint(overlay, lastNose, head.calibrated)

      const result = detector.update(hands, nowMs)
      const out = controller.process(result.gesture)

      // Auto-calibrate on first face (no Calibrate button in this UI):
      // same call as gesture-control's handleCalibrate — current nose.
      if (!head.calibrated && lastNose) {
        head.calibrate(lastNose)
      }
      const lastCursor: HeadCursorUpdate = head.update(lastNose, dtSeconds)
      // No Recentre button in this UI, so recentering is automatic:
      // 1. Settled inside the stop-circle → recenter (fresh travel per lean).
      // 2. Leaning well outside it yet producing zero delta → the virtual
      //    cursor is clamped at an edge; recenter to keep a sustained lean
      //    flowing instead of starving the OS cursor.
      // The gesture-control velocity math itself is untouched — only the
      // virtual origin is refreshed, and the OS cursor only ever gets deltas.
      if (head.inDeadZone) {
        head.recenter()
      } else if (!lastCursor.moved) {
        const hdbg = head.debug
        if (
          hdbg.calibrated &&
          hdbg.faceVisible &&
          Math.hypot(hdbg.dx, hdbg.dy) > head.deadZoneRadius
        ) {
          head.recenter()
        }
      }

      // Pinch → click at current OS cursor (never yanks the mouse).
      if (result.gesture === 'pinch' && linked) {
        void clickBrowserCursorCurrent()
      }
      // TEMP direction tracer (1Hz, console only): raw nose displacement
      // vs the delta actually sent to :8765. Remove once fixed.
      if (nowMs - lastDirLogMs > 1000) {
        lastDirLogMs = nowMs
        const dbg = head.debug
        console.log(
          `[dir] nose dx:${dbg.dx.toFixed(4)} dy:${dbg.dy.toFixed(4)} ` +
            `send dx:${lastCursor.dx.toFixed(5)} dy:${lastCursor.dy.toFixed(5)} ` +
            `moved:${lastCursor.moved} calibrated:${dbg.calibrated}`
        )
      }
      // Head cursor: relative steps only while displaced (dead zone = silence).
      if (lastCursor.moved && linked) {
        void moveBrowserCursorRel(lastCursor.dx, lastCursor.dy)
      }
      // Discrete gestures → server.
      if (linked) {
        if (out.action === 'scroll_up') void wheelBrowser(-500)
        else if (out.action === 'scroll_down') void wheelBrowser(500)
        else if (out.action === 'confirm') void pressBrowserKey('Enter')
        else if (out.action === 'cancel') void pressBrowserKey('Escape')
      }

      if (result.gesture === 'pinch') {
        setCommand('CLICK', true, nowMs)
      } else {
        setCommand(out.label, out.active, nowMs)
      }
      setMode()

      const neutral = head.neutralPoint
      const smoothNose = head.smoothedNose ?? lastNose
      if (head.calibrated && neutral && smoothNose) {
        drawHeadFrame(overlay, {
          neutral,
          nose: smoothNose,
          deadZone: head.deadZoneRadius,
          inside: head.inDeadZone
        })
      }
    }

    const boot = async (): Promise<void> => {
      // Phase 1 — camera. Its errors keep the gesture-control wording.
      try {
        await startCamera(video)
      } catch (e) {
        if (cancelled) return
        if (e instanceof DOMException || e instanceof Error) {
          switch (e.name) {
            case 'NotAllowedError':
            case 'SecurityError':
              setError('Camera permission denied. Allow webcam access, then reload.')
              break
            case 'NotFoundError':
            case 'OverconstrainedError':
              setError('No webcam found. Plug in a camera and reload.')
              break
            case 'NotReadableError':
            case 'AbortError':
              setError(
                'Camera is busy or failed to start. Close other apps using the webcam, then retry.'
              )
              break
            default:
              setError(`Camera failed to start: ${e.message || e.name}`)
          }
        } else {
          setError('Camera failed to start for an unknown reason.')
        }
        setLive(false)
        return
      }
      if (cancelled) return
      setLive(true)
      setError(null)
      // Phase 2 — MediaPipe detectors (WASM + models, internet needed once).
      // Kept in its own try/catch so a model/WASM failure never reports as
      // a camera failure — and the live feed stays up regardless.
      try {
        await Promise.all([getFaceLandmarker(), getHandLandmarker()])
      } catch (e) {
        if (cancelled) return
        console.error('[vision] detector load failed:', e)
        const name = e instanceof Error ? e.name : typeof e
        const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
        setError(
          `Detector failed to load [${name}]: ${msg}. Needs internet once for the model download — check connection, then reload.`
        )
        return
      }
      if (cancelled) return
      detectorsReady = true
      loopRunning = true
      rafId = requestAnimationFrame(detectionLoop)
    }

    void boot()

    return () => {
      cancelled = true
      loopRunning = false
      cancelAnimationFrame(rafId)
      if (overlay) clearOverlay(overlay)
      stopCamera(video)
      disposeHandLandmarker()
      disposeFaceLandmarker()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="gc-root">
      <div className="video-wrap">
        <video
          id="webcam"
          ref={videoRef}
          autoPlay
          muted
          playsInline
          width="640"
          height="480"
        />
        <canvas id="overlay" ref={overlayRef} width="640" height="480" />
        <div
          ref={liveBadgeRef}
          className={`live-badge ${live ? '' : 'hidden'}`}
          id="liveBadge"
        >
          ● LIVE
        </div>
        <div ref={modeBadgeRef} className="mode-badge scroll" id="modeBadge">
          SCROLL MODE
        </div>
        <div ref={commandBadgeRef} className="command-badge idle" id="commandBadge">
          READY
        </div>
      </div>

      {error && (
        <div className="error-box" id="errorBox">
          {error}
        </div>
      )}
    </div>
  )
}

export default VideoComponent
