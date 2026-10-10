/**
 * controller/cursor-controller.ts — hand fingertip smoother (no OS deps).
 *
 * Pipeline:
 *   index fingertip (MediaPipe) -> crop margins -> clamp -> EMA smooth
 *   -> CursorPoint events for the rest of the app to consume.
 * (No on-canvas cursor is drawn — the overlay preview ring was removed;
 * the real cursor is the OS one, driven relatively via the bridge.)
 */

export interface CursorPoint {
  /** Normalized 0..1 across the interaction area. */
  x: number;
  y: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export class CursorTracker {
  private sx = 0.5;
  private sy = 0.5;
  private ready = false;

  /**
   * @param alpha  EMA smoothing (0..1). Lower = steadier, laggier.
   * @param inset  Margin cropped on every side (0..0.4) for comfort.
   */
  constructor(
    private alpha = 0.3,
    private inset = 0.12,
  ) {}

  /** Feed the raw index-fingertip landmark each tick; get smoothed cursor. */
  update(raw: { x: number; y: number }): CursorPoint {
    const m = this.inset;
    const span = Math.max(1e-6, 1 - 2 * m);
    const cx = clamp01((raw.x - m) / span);
    const cy = clamp01((raw.y - m) / span);
    if (!this.ready) {
      this.sx = cx;
      this.sy = cy;
      this.ready = true;
    } else {
      this.sx += (cx - this.sx) * this.alpha;
      this.sy += (cy - this.sy) * this.alpha;
    }
    return { x: this.sx, y: this.sy };
  }

  /** Call on mode switch / tracking loss so the dot never jumps. */
  reset(): void {
    this.ready = false;
  }
}
