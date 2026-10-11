/**
 * gestures/gesture-detector.ts — STAGE 4 (static-pose revision)
 *
 * All poses are STATIC holds — no swipes, no travel distance.
 * Just make the shape, hold it, and the command fires:
 *
 *   index points UP       -> scroll up         (hold to keep scrolling)
 *   index points DOWN     -> scroll down       (hold to keep scrolling)
 *   open palm held still  -> pause
 *   pinch (fingers up)    -> click (cursor mode)
 *   fist held still       -> cursor mode
 *   2 fingers held still  -> scroll mode
 *   thumb up / down       -> confirm / cancel
 *
 * Mode poses need a steady 0.7s hold before they fire, so passing through
 * the shape mid-transition (palm <-> point) never flips the mode.
 *
 * Priority (safety first):
 *   no_hand > thumb_up/down > pinch > fist/two_fingers (held) >
 *   open_palm_hold > point direction > neutral
 *
 * `detector.debug` always holds the latest internals for the on-screen
 * debug panel, so guided testing can see exactly what the classifier sees.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type GestureName =
  | 'no_hand'
  | 'fist'
  | 'pinch'
  | 'two_fingers'
  | 'thumb_up'
  | 'thumb_down'
  | 'open_palm_hold'
  | 'point_up'
  | 'point_down'
  | 'neutral';

export interface GestureResult {
  gesture: GestureName;
  /** Strength of the pose (pinch gap, thumb lift, finger length). */
  magnitude: number;
}

/** Live internals for the on-screen debug panel (guided testing). */
export interface DebugSnapshot {
  gesture: GestureName;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
  thumb: boolean;
  pinchGap: number;
  pointDx: number;
  pointDy: number;
  pointLen: number;
  drift: number;
  discreteReadyInMs: number;
  /** Current hold accumulation in ms (palm needs 400, fist/✌️ need 700). */
  holdMs: number;
}

const TUNING = {
  /** Pinch fires when thumb tip + index tip are closer than this (normalized). */
  pinchDistance: 0.06,
  /** Open palm counts as "held still" when wrist stays inside this radius. */
  stillRadius: 0.03,
  /**
   * Pause-palm stillness radius — looser than stillRadius. A big spread
   * hand trembles more than a fist; demanding 0.03 makes PAUSE exhausting.
   */
  palmStillRadius: 0.045,
  /** ms the open palm must stay still to count as HOLD. */
  holdTimeMs: 400,
  /** Cooldown between one-shot actions (mode, back/forward, confirm, pinch). */
  discreteCooldownMs: 900,
  /** Repeat rate while HOLDING a point pose (continuous scroll). */
  scrollRepeatMs: 250,
  /** Pointing finger must be this long (MCP->tip) to count as straight. */
  minPointLength: 0.06,
  /** Point direction must dominate the other axis by this ratio. */
  directionDominance: 1.4,
  /** Wrist smoothing for the stillness check (0..1, lower = smoother). */
  smoothingAlpha: 0.35,
  /**
   * A point direction must read the SAME for this many frames in a row
   * before it fires — kills flicker from hand tremor (~120ms delay).
   */
  stableFrames: 3,
  /** Ambiguous frames tolerated before the stability counter resets. */
  missTolerance: 2,
  /**
   * Mode poses (fist / two fingers) must be HELD STILL this long before
   * they fire — transitions sweeping through the shape don't count.
   */
  modeHoldMs: 700,
  /** Fist fires faster — its all-folded shape rarely appears by accident. */
  fistHoldMs: 250,
  /** Pinch must be held this long — kills thumb-brushes mid-transition. */
  pinchHoldMs: 300,
  /** Curled-fingers pinch: tips must be this close (tighter than style A). */
  pinchTightDistance: 0.035,
  /**
   * Curled pinch needs the index reaching OUT (tip/pip-to-wrist ratio),
   * not buried in the palm like a thumb pressed into a fist.
   */
  pinchTipRatio: 0.8,
  /** Thumb must point this far vertically to count (deadband kills wobble). */
  thumbFireDy: 0.05,
  /** Thumb direction must read the same this many frames in a row. */
  thumbStableFrames: 3,
};

// Landmark indices (MediaPipe hand topology).
const WRIST = 0;
const THUMB_TIP = 4;
const THUMB_IP = 3;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const INDEX_PIP = 6;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 10;
const RING_TIP = 16;
const RING_PIP = 14;
const PINKY_TIP = 20;
const PINKY_PIP = 18;
const PINKY_MCP = 17;

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Extended = tip clearly farther from wrist than its PIP joint (lenient). */
function fingerExtended(
  lm: NormalizedLandmark[],
  tip: number,
  pip: number,
): boolean {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.05;
}

function thumbExtended(lm: NormalizedLandmark[]): boolean {
  return (
    dist(lm[THUMB_TIP], lm[PINKY_MCP]) >
    dist(lm[THUMB_IP], lm[PINKY_MCP]) * 1.15
  );
}

const EMPTY_DEBUG: DebugSnapshot = {
  gesture: 'no_hand',
  index: false,
  middle: false,
  ring: false,
  pinky: false,
  thumb: false,
  pinchGap: 0,
  pointDx: 0,
  pointDy: 0,
  pointLen: 0,
  drift: 0,
  discreteReadyInMs: 0,
  holdMs: 0,
};

export class GestureDetector {
  /** Latest internals — read this each frame for the debug panel. */
  debug: DebugSnapshot = { ...EMPTY_DEBUG };

  private smoothX = 0.5;
  private smoothY = 0.5;
  private hasTrack = false;
  private anchorX = 0.5;
  private anchorY = 0.5;
  private anchorT = 0;
  private lastDiscreteMs = 0;
  private lastScrollMs = 0;
  private pointCandidate: GestureName | null = null;
  private pointStreak = 0;
  private pointMisses = 0;
  private modeCandidate: 'fist' | 'two_fingers' | null = null;
  private modeAccumMs = 0;
  private modeAnchorX = 0.5;
  private modeAnchorY = 0.5;
  private pinchCandidate: 'A' | 'B' | null = null;
  private pinchAnchorX = 0.5;
  private pinchAnchorY = 0.5;
  private thumbCandidate: 'up' | 'down' | null = null;
  private thumbStreak = 0;
  /** One-shot latches: a fired pose can't refire until the hand releases it. */
  private modeJustFired = false;
  private pinchJustFired = false;
  private thumbJustFired = false;
  private palmAccumMs = 0;
  private pinchAccumMs = 0;
  private lastTickMs = 0;

  /** Feed fresh landmarks each detection tick; returns the classified pose. */
  update(hands: NormalizedLandmark[][], nowMs: number): GestureResult {
    if (hands.length === 0 || !hands[0]) {
      // Full state reset: stale hold progress must never survive the hand
      // leaving, or the next appearance could fire instantly (phantom hit).
      this.hasTrack = false;
      this.pointCandidate = null;
      this.pointStreak = 0;
      this.pointMisses = 0;
      this.modeCandidate = null;
      this.modeAccumMs = 0;
      this.modeJustFired = false;
      this.pinchCandidate = null;
      this.pinchAccumMs = 0;
      this.pinchJustFired = false;
      this.thumbCandidate = null;
      this.thumbStreak = 0;
      this.thumbJustFired = false;
      this.palmAccumMs = 0;
      this.lastTickMs = 0;
      this.debug = { ...EMPTY_DEBUG, gesture: 'no_hand' };
      return { gesture: 'no_hand', magnitude: 0 };
    }
    const lm = hands[0];
    if (lm.length < 21) {
      this.debug = { ...EMPTY_DEBUG, gesture: 'neutral' };
      return { gesture: 'neutral', magnitude: 0 };
    }
    // Degenerate frame (all landmarks identical, e.g. gap:0.000 len:0.000):
    // ignore it instead of classifying a phantom pose.
    if (dist(lm[WRIST], lm[INDEX_TIP]) < 1e-9) {
      this.debug = { ...EMPTY_DEBUG, gesture: 'neutral' };
      return { gesture: 'neutral', magnitude: 0 };
    }

    this.trackWrist(lm[WRIST], nowMs);

    const indexExt = fingerExtended(lm, INDEX_TIP, INDEX_PIP);
    const middleExt = fingerExtended(lm, MIDDLE_TIP, MIDDLE_PIP);
    const ringExt = fingerExtended(lm, RING_TIP, RING_PIP);
    const pinkyExt = fingerExtended(lm, PINKY_TIP, PINKY_PIP);
    const thumbExt = thumbExtended(lm);
    const extendedCount = [indexExt, middleExt, ringExt, pinkyExt].filter(
      Boolean,
    ).length;
    const pinchGap = dist(lm[THUMB_TIP], lm[INDEX_TIP]);
    const drift = Math.hypot(
      this.smoothX - this.anchorX,
      this.smoothY - this.anchorY,
    );
    // Screen-space point vector (x negated: landmarks are raw camera coords,
    // but the video is mirrored selfie-view — see note in the point block).
    const pointDx = -(lm[INDEX_TIP].x - lm[INDEX_MCP].x);
    const pointDy = lm[INDEX_TIP].y - lm[INDEX_MCP].y;
    const pointLen = Math.hypot(pointDx, pointDy);
    const discreteReadyInMs = Math.max(
      0,
      TUNING.discreteCooldownMs - (nowMs - this.lastDiscreteMs),
    );
    // Frame delta (capped): hold timers accumulate with this, so a few
    // flickery frames only slow progress instead of resetting it to zero.
    const dtMs =
      this.lastTickMs === 0 ? 0 : Math.min(100, nowMs - this.lastTickMs);
    this.lastTickMs = nowMs;
    let holdShown = 0;

    const snap = (gesture: GestureName): DebugSnapshot => ({
      gesture,
      index: indexExt,
      middle: middleExt,
      ring: ringExt,
      pinky: pinkyExt,
      thumb: thumbExt,
      pinchGap,
      pointDx,
      pointDy,
      pointLen,
      drift,
      discreteReadyInMs,
      holdMs: Math.round(holdShown),
    });
    const out = (gesture: GestureName, magnitude: number): GestureResult => {
      this.debug = snap(gesture);
      return { gesture, magnitude };
    };

    // Thumb up / down: fist shape + thumb sticking out VERTICALLY.
    // A sideways/tucked thumb falls through to the fist check below —
    // it must not swallow the frame as neutral. The direction must also
    // hold steady for a few frames so a wobbling thumb can't flicker
    // CONFIRM/CANCEL faster than you can read.
    if (extendedCount === 0 && thumbExt) {
      // Not a palm (fist + thumb) — decay any paused-hold buildup.
      this.palmAccumMs = Math.max(0, this.palmAccumMs - dtMs);
      const dyThumb = lm[THUMB_TIP].y - lm[THUMB_IP].y; // y grows downward
      const dir: 'up' | 'down' | null =
        dyThumb < -TUNING.thumbFireDy
          ? 'up'
          : dyThumb > TUNING.thumbFireDy
            ? 'down'
            : null;
      if (dir === null) {
        this.thumbCandidate = null;
        this.thumbStreak = 0;
        this.thumbJustFired = false;
      } else if (this.thumbJustFired) {
        // Already fired for this hold — release (dir null / other pose)
        // before it can fire again.
        return out('neutral', 0);
      } else {
        if (dir !== this.thumbCandidate) {
          this.thumbCandidate = dir;
          this.thumbStreak = 1;
          return out('neutral', 0);
        }
        this.thumbStreak += 1;
        if (this.thumbStreak < TUNING.thumbStableFrames) {
          return out('neutral', 0);
        }
        if (discreteReadyInMs === 0) {
          this.lastDiscreteMs = nowMs;
          this.thumbJustFired = true;
          return out(
            dir === 'up' ? 'thumb_up' : 'thumb_down',
            Math.abs(dyThumb),
          );
        }
        return out('neutral', 0);
      }
    } else {
      this.thumbCandidate = null;
      this.thumbStreak = 0;
      this.thumbJustFired = false;
    }

    // Pinch, two accepted styles (both need a steady hold):
    //   A. fingers-up 🤏 — tips touching, middle/ring/pinky up.
    //   B. curled 🤏 — all curled, tips very close, index reaching OUT
    //      (not buried like a thumb pressed into a fist).
    // A thumb touching the pointing finger reads as "pinch in progress"
    // (neutral) rather than falling through to a phantom point.
    const othersUp = [middleExt, ringExt, pinkyExt].filter(Boolean).length;
    const tipRatio =
      dist(lm[INDEX_TIP], lm[WRIST]) /
      Math.max(1e-6, dist(lm[INDEX_PIP], lm[WRIST]));
    const pinchStyle: 'A' | 'B' | null =
      pinchGap < TUNING.pinchDistance && othersUp >= 2
        ? 'A'
        : pinchGap < TUNING.pinchTightDistance &&
            extendedCount === 0 &&
            tipRatio > TUNING.pinchTipRatio
          ? 'B'
          : null;
    if (pinchStyle === null) {
      this.pinchCandidate = null;
      this.pinchJustFired = false;
      this.pinchAccumMs = Math.max(0, this.pinchAccumMs - dtMs * 3);
    } else if (this.pinchJustFired) {
      // Already fired for this hold — open the fingers before it can fire
      // again (stops repeat CLICK spam while held).
      this.palmAccumMs = Math.max(0, this.palmAccumMs - dtMs);
      return out('neutral', 0);
    } else {
      const movedP = Math.hypot(
        this.smoothX - this.pinchAnchorX,
        this.smoothY - this.pinchAnchorY,
      );
      if (pinchStyle !== this.pinchCandidate) {
        this.pinchCandidate = pinchStyle;
        this.pinchAccumMs = 0;
        this.pinchAnchorX = this.smoothX;
        this.pinchAnchorY = this.smoothY;
      } else if (movedP > TUNING.stillRadius * 1.5) {
        this.pinchAccumMs = Math.max(0, this.pinchAccumMs - dtMs * 3);
        this.pinchAnchorX = this.smoothX;
        this.pinchAnchorY = this.smoothY;
      } else {
        this.pinchAccumMs += dtMs;
      }
      holdShown = this.pinchAccumMs;
      if (this.pinchAccumMs >= TUNING.pinchHoldMs && discreteReadyInMs === 0) {
        this.lastDiscreteMs = nowMs;
        this.modeCandidate = null;
        this.pinchCandidate = null;
        this.pinchAccumMs = 0;
        this.pinchJustFired = true;
        return out('pinch', pinchGap);
      }
      // Pinching, not palming — decay any paused-hold buildup.
      this.palmAccumMs = Math.max(0, this.palmAccumMs - dtMs);
      return out('neutral', 0);
    }

    // Mode poses need an accumulated steady hold: fist = CURSOR mode,
    // ✌️ = SCROLL mode. Flicker or small drifts only slow the 700ms
    // buildup instead of wiping it, but sweeping through the shape
    // mid-transition never accumulates enough to fire.
    // NOTE: fist ignores the thumb — a thumb tucked across the fingers
    // flickers extended/folded frame to frame, and must not block the pose.
    // (A clearly vertical thumb is still caught by thumb_up/down above.)
    // Any all-curled hand is a fist (thumb position doesn't matter here:
    // vertical thumbs were already claimed above, and pinch needs other
    // fingers up so it can't conflict). This also catches a tight fist
    // with the thumb pressed into the fingers (tiny pinch gap).
    const fistShape = extendedCount === 0;
    const twoShape = indexExt && middleExt && !ringExt && !pinkyExt;
    const modeShape: 'fist' | 'two_fingers' | null = fistShape
      ? 'fist'
      : twoShape
        ? 'two_fingers'
        : null;
    if (modeShape !== null) {
      // Holding a mode pose, not a palm — decay any paused-hold buildup.
      this.palmAccumMs = Math.max(0, this.palmAccumMs - dtMs);
      if (this.modeJustFired) {
        // Already fired for this hold — release the shape before it can
        // fire again (stops MODE spam + lets other gestures use cooldown).
        return out('neutral', 0);
      }
      const moved = Math.hypot(
        this.smoothX - this.modeAnchorX,
        this.smoothY - this.modeAnchorY,
      );
      if (modeShape !== this.modeCandidate) {
        this.modeCandidate = modeShape;
        this.modeAccumMs = 0;
        this.modeAnchorX = this.smoothX;
        this.modeAnchorY = this.smoothY;
      } else if (moved > TUNING.stillRadius * 1.5) {
        // Drifted: leak progress and re-anchor instead of resetting to zero.
        this.modeAccumMs = Math.max(0, this.modeAccumMs - dtMs * 3);
        this.modeAnchorX = this.smoothX;
        this.modeAnchorY = this.smoothY;
      } else {
        this.modeAccumMs += dtMs;
      }
      holdShown = this.modeAccumMs;
      const needMs =
        this.modeCandidate === 'fist' ? TUNING.fistHoldMs : TUNING.modeHoldMs;
      if (this.modeAccumMs >= needMs && discreteReadyInMs === 0) {
        this.lastDiscreteMs = nowMs;
        this.modeCandidate = null; // re-hold to fire again
        this.modeAccumMs = 0;
        this.modeJustFired = true;
        return out(modeShape, 0);
      }
      return out('neutral', 0);
    }
    this.modeCandidate = null;
    this.modeAccumMs = 0;
    this.modeJustFired = false;

    // Open palm: hand spread — all 4 up, or 3 + thumb (a relaxed palm
    // often folds the pinky, and that must still count). Hold still =
    // PAUSE. Buildup is leaky everywhere: flicker or drift only slows it
    // instead of wiping to zero, so a real hold always fires without effort.
    const palmShape = extendedCount === 4 || (extendedCount >= 3 && thumbExt);
    if (palmShape) {
      if (drift < TUNING.palmStillRadius) {
        this.palmAccumMs += dtMs;
      } else {
        this.palmAccumMs = Math.max(0, this.palmAccumMs - dtMs * 2);
        this.reanchor(nowMs);
      }
      holdShown = this.palmAccumMs;
      if (this.palmAccumMs >= TUNING.holdTimeMs) {
        return out('open_palm_hold', drift);
      }
      return out('neutral', 0);
    }
    // Not a palm shape this frame: leak progress instead of wiping — one
    // flickery frame must not erase a nearly-done hold.
    this.palmAccumMs = Math.max(0, this.palmAccumMs - dtMs);
    holdShown = this.palmAccumMs;

    // Pointing: index only, vertical. Direction = where the index aims.
    // The direction must read the SAME for `stableFrames` in a row before it
    // fires, so tremor can't flip UP/DOWN faster than you can read.
    if (indexExt && !middleExt && !ringExt && !pinkyExt) {
      // Thumb touching the finger = a pinch attempt in progress (handled
      // above), never a clean point — bail out instead of firing scroll.
      if (pinchGap < TUNING.pinchTightDistance + 0.005) {
        return out('neutral', 0);
      }
      const dir = this.readPointDirection(pointDx, pointDy, pointLen);
      if (dir === null) {
        this.pointMisses += 1;
        if (this.pointMisses > TUNING.missTolerance) {
          this.pointCandidate = null;
          this.pointStreak = 0;
        }
        return out('neutral', 0);
      }
      this.pointMisses = 0;
      if (dir !== this.pointCandidate) {
        this.pointCandidate = dir;
        this.pointStreak = 1;
        return out('neutral', 0);
      }
      this.pointStreak += 1;
      if (this.pointStreak < TUNING.stableFrames) {
        return out('neutral', 0);
      }
      if (dir === 'point_up' || dir === 'point_down') {
        // Vertical: hold-to-scroll, repeats while held.
        if (nowMs - this.lastScrollMs >= TUNING.scrollRepeatMs) {
          this.lastScrollMs = nowMs;
          return out(dir, pointLen);
        }
        return out('neutral', 0);
      }
      return out('neutral', 0);
    }
    this.pointCandidate = null;
    this.pointStreak = 0;

    return out('neutral', 0);
  }

  /**
   * Raw direction reading for one frame (null = bent, sideways, or diagonal:
   * only straight UP / DOWN counts — sideways aims read as neutral).
   */
  private readPointDirection(
    dx: number,
    dy: number,
    len: number,
  ): GestureName | null {
    if (len < TUNING.minPointLength) return null;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const d = TUNING.directionDominance;
    if (ay > ax * d) return dy < 0 ? 'point_up' : 'point_down';
    return null; // sideways or diagonal — hold the finger straight up/down
  }

  private trackWrist(wrist: NormalizedLandmark, nowMs: number): void {
    if (!this.hasTrack) {
      this.smoothX = wrist.x;
      this.smoothY = wrist.y;
      this.hasTrack = true;
      this.reanchor(nowMs);
      return;
    }
    const a = TUNING.smoothingAlpha;
    this.smoothX += (wrist.x - this.smoothX) * a;
    this.smoothY += (wrist.y - this.smoothY) * a;
  }

  private reanchor(nowMs: number): void {
    this.anchorX = this.smoothX;
    this.anchorY = this.smoothY;
    this.anchorT = nowMs;
  }
}
