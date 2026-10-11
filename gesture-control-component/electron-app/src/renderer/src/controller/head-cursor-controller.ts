/**
 * controller/head-cursor-controller.ts — RELATIVE head-driven cursor.
 *
 * Design:
 *   1. Calibration: user looks straight ahead → record neutral nose (nx, ny).
 *   2. Each tick: d = smoothedNose − neutral (x mirrored so that
 *      head-right == cursor-right in screen space).
 *   3. Radial dead zone: r = √(dx² + dy²). Inside the circle (r < R) → v = 0.
 *      Outside → speed grows with distance beyond the rim:
 *        speed = min(maxSpeed, k·excess·(1 + boost·excess·10)), excess = r − R
 *      directed along the unit vector (dx/r, dy/r).
 *   4. Anti-drift near the origin: when the RAW nose is already inside the
 *      circle, smoothing snaps fast (α=0.6) and velocity is hard-zeroed, so
 *      EMA lag can't keep the cursor gliding after the head returns.
 *   5. p_{t+1} = p_t + v·dt. Returning to neutral STOPS the cursor — it never
 *      snaps back to centre. Face lost / uncalibrated → freeze.
 *
 * Coordinate note: landmarks are RAW camera coords. Moving the head to the
 * user's right shows up as DECREASING raw x, so X is negated (mirrorX = true)
 * to produce screen-space cursor coords (look right → cursor right).
 * The preview canvas is CSS-mirrored — see drawHeadFrame() below.
 */

export interface HeadNeutral {
  x: number;
  y: number;
}

export interface HeadCursorPoint {
  /** Normalized 0..1 across the interaction area (screen space). */
  x: number;
  y: number;
}

/**
 * Relative-movement tick output.
 *
 * - `x,y`: absolute virtual cursor (for the on-screen preview ring only).
 * - `dx,dy`: NORMALIZED frame delta actually applied this tick, i.e.
 *   Δx = f(d_head) * dt already integrated — add it to the OS cursor:
 *   X_os ← X_os + dx * screenW (same for y). Zero while inside the dead zone.
 * - `moved`: false while inside the dead zone / frozen — caller MUST skip
 *   OS injection then, so a physical mouse keeps working untouched.
 */
export interface HeadCursorUpdate extends HeadCursorPoint {
  dx: number;
  dy: number;
  moved: boolean;
}

export interface HeadCursorOptions {
  /** Dead-zone CIRCLE radius in normalized webcam units (default 0.025). */
  deadZone?: number;
  /** Sensitivity k (cursor-units/sec per normalized unit, default 9). */
  sensitivityX?: number;
  sensitivityY?: number;
  /** Hard velocity cap (cursor-units/sec, default 2.2). */
  maxSpeed?: number;
  /** EMA smoothing on the raw nose point, 0..1 (lower = steadier). */
  smoothingAlpha?: number;
  /** Mirror raw camera X so head-right == cursor-right (default true). */
  mirrorX?: boolean;
  /** Extra non-linear boost for large displacements (0 = pure linear). */
  boost?: number;
}

export interface HeadCursorDebug {
  calibrated: boolean;
  dx: number;
  dy: number;
  /** Radial distance of the smoothed nose from neutral. */
  radius: number;
  /** Dead-zone circle radius R. */
  deadZone: number;
  vx: number;
  vy: number;
  inDeadZone: boolean;
  faceVisible: boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Fast EMA rate used to settle smoothing when the raw nose is near origin. */
const SETTLE_ALPHA = 0.6;
/**
 * Single-tick nose jumps bigger than this are tracking glitches — ignored.
 * Kept generous (0.15 ≈ half a face-width per 40ms frame): a deliberate fast
 * lean must NEVER be mistaken for a glitch, or far-lean feels no faster
 * than near-lean. True teleports (detector re-lock jumps) still get caught.
 */
const SPIKE_REJECT = 0.15;
/** Velocity EMA: chases the target speed (higher = twitchier). */
const VEL_BETA = 0.4;
/** Smoothed speeds below this are zeroed — kills sub-pixel crawl. */
const VEL_FLOOR = 0.005;
/** Stop rim as a fraction of the start rim (hysteresis against rim chatter). */
const STOP_RATIO = 0.7;

/**
 * Virtual-cursor persistence: the preview ring (and relaunch continuity)
 * always resumes from the LAST position, never a fixed center. The OS
 * cursor itself is stateless under relative control (X += dx), so it
 * inherently continues from wherever it is — this key covers the in-app
 * preview + any fresh controller instance (reload, restart, HMR).
 */
const POS_STORAGE_KEY = 'headCursor.pos.v1';

function loadStoredPos(): HeadCursorPoint | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<HeadCursorPoint>;
    if (
      typeof p.x !== 'number' ||
      typeof p.y !== 'number' ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    ) {
      return null;
    }
    return { x: clamp01(p.x), y: clamp01(p.y) };
  } catch {
    return null;
  }
}

function storePos(pos: HeadCursorPoint): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // private mode / quota — preview continuity is best-effort
  }
}

export class HeadCursorController {
  private neutral: HeadNeutral | null = null;
  private pos: HeadCursorPoint = { x: 0.5, y: 0.5 };
  private smoothNose: HeadNeutral | null = null;
  private vel: { x: number; y: number } = { x: 0, y: 0 };
  private smoothVel: { x: number; y: number } = { x: 0, y: 0 };
  private faceVisible = false;
  private inside = true;
  private moving = false;

  private deadZone: number;
  private kx: number;
  private ky: number;
  private maxSpeed: number;
  private alpha: number;
  private mirrorX: boolean;
  private boost: number;

  constructor(options: HeadCursorOptions = {}) {
    this.deadZone = options.deadZone ?? 0.025;
    this.kx = options.sensitivityX ?? 9;
    this.ky = options.sensitivityY ?? 9;
    this.maxSpeed = options.maxSpeed ?? 2.2;
    this.alpha = options.smoothingAlpha ?? 0.25;
    this.mirrorX = options.mirrorX ?? true;
    this.boost = options.boost ?? 2.0;
    // Resume from last position — never a fixed center.
    const saved = loadStoredPos();
    if (saved) this.pos = saved;
  }

  get calibrated(): boolean {
    return this.neutral !== null;
  }

  get cursor(): HeadCursorPoint {
    return { ...this.pos };
  }

  get neutralPoint(): HeadNeutral | null {
    return this.neutral ? { ...this.neutral } : null;
  }

  /** Smoothed nose in RAW camera coords (for the axis widget). */
  get smoothedNose(): HeadNeutral | null {
    return this.smoothNose ? { ...this.smoothNose } : null;
  }

  get deadZoneRadius(): number {
    return this.deadZone;
  }

  get inDeadZone(): boolean {
    return this.inside;
  }

  /** Step 1 — lock the current nose position as "straight ahead". */
  calibrate(nose: { x: number; y: number }): void {
    this.neutral = { x: nose.x, y: nose.y };
    this.smoothNose = { x: nose.x, y: nose.y };
    this.vel = { x: 0, y: 0 };
    this.smoothVel = { x: 0, y: 0 };
    this.inside = true;
    this.moving = false;
  }

  clearCalibration(): void {
    this.neutral = null;
    this.smoothNose = null;
    this.vel = { x: 0, y: 0 };
    this.smoothVel = { x: 0, y: 0 };
    this.inside = true;
    this.moving = false;
  }

  setSensitivity(k: number): void {
    this.kx = k;
    this.ky = k;
  }

  setDeadZone(deadZone: number): void {
    this.deadZone = Math.min(0.05, Math.max(0.003, deadZone));
  }

  /** Re-centre the cursor without touching calibration (e.g. after drift). */
  recenter(): void {
    this.pos = { x: 0.5, y: 0.5 };
    this.vel = { x: 0, y: 0 };
    this.smoothVel = { x: 0, y: 0 };
    this.moving = false;
    storePos(this.pos);
  }

  reset(): void {
    this.smoothNose = null;
    this.vel = { x: 0, y: 0 };
    this.smoothVel = { x: 0, y: 0 };
    this.faceVisible = false;
    this.inside = true;
    this.moving = false;
  }

  private toScreen(nose: { x: number; y: number }): { dx: number; dy: number } {
    if (!this.neutral) return { dx: 0, dy: 0 };
    const rawDx = nose.x - this.neutral.x;
    return {
      dx: this.mirrorX ? -rawDx : rawDx,
      dy: nose.y - this.neutral.y,
    };
  }

  /**
   * Radial velocity: 0 inside the circle, distance-proportional outside.
   * speed(excess) with excess = r − R, so motion starts gently at the rim
   * and gets faster the farther the head leans out.
   */
  private radialVelocity(dx: number, dy: number): { vx: number; vy: number } {
    const r = Math.hypot(dx, dy);
    if (r < this.deadZone) return { vx: 0, vy: 0 };
    const excess = r - this.deadZone;
    const k = (this.kx + this.ky) / 2;
    const speed = Math.min(
      this.maxSpeed,
      k * excess * (1 + this.boost * excess * 10),
    );
    return { vx: (dx / r) * speed, vy: (dy / r) * speed };
  }

  /**
   * Feed the raw nose tip each tick; get the updated cursor (screen space).
   * - nose = null (face lost) → freeze in place, return current pos.
   * - not calibrated → freeze in place (caller should prompt calibration).
   *
   * Relative semantics: the returned dx/dy is the ONLY thing that may touch
   * the OS cursor (X_os += dx * screenW). Inside the dead zone dx=dy=0 and
   * moved=false — skip injection so a physical mouse is never overridden.
   */
  update(
    nose: { x: number; y: number } | null,
    dtSeconds: number,
  ): HeadCursorUpdate {
    const dt = Math.min(0.1, Math.max(0, dtSeconds));
    if (!nose || !this.neutral) {
      this.faceVisible = nose !== null;
      this.vel = { x: 0, y: 0 };
      this.smoothVel = { x: 0, y: 0 };
      this.moving = false;
      this.inside = true;
      if (nose && !this.smoothNose) {
        this.smoothNose = { x: nose.x, y: nose.y };
      }
      return { ...this.pos, dx: 0, dy: 0, moved: false };
    }
    this.faceVisible = true;

    // Anti-drift: when the RAW nose is already inside the circle, snap the
    // smoother fast toward it and hard-zero the velocity — EMA lag must not
    // keep the cursor gliding after the head has returned to neutral.
    const raw = this.toScreen(nose);
    const rawR = Math.hypot(raw.dx, raw.dy);
    if (!this.smoothNose) {
      this.smoothNose = { x: nose.x, y: nose.y };
    } else {
      // Spike rejection: single-frame teleports are tracking glitches, not
      // head motion — skip the smoother this tick instead of jumping.
      const jump = Math.hypot(
        nose.x - this.smoothNose.x,
        nose.y - this.smoothNose.y,
      );
      if (jump < SPIKE_REJECT) {
        const a =
          rawR < this.deadZone
            ? Math.max(this.alpha, SETTLE_ALPHA)
            : this.alpha;
        this.smoothNose.x += (nose.x - this.smoothNose.x) * a;
        this.smoothNose.y += (nose.y - this.smoothNose.y) * a;
      }
    }

    const { dx, dy } = this.toScreen(this.smoothNose);
    const r = Math.hypot(dx, dy);

    // Hysteresis: motion starts at the rim R but only stops at R*0.7, so
    // hovering at the edge can't chatter the cursor on/off every frame.
    if (this.moving) {
      if (r < this.deadZone * STOP_RATIO) this.moving = false;
    } else if (r >= this.deadZone) {
      this.moving = true;
    }
    this.inside = !this.moving;

    let target = { x: 0, y: 0 };
    if (this.moving) {
      const v = this.radialVelocity(dx, dy);
      target = { x: v.vx, y: v.vy };
    }

    // Velocity smoothing: chase the target fast when stopping (no glide),
    // eased while moving (no tremor). Floor kills sub-pixel crawl.
    const b = this.moving ? VEL_BETA : Math.max(VEL_BETA, SETTLE_ALPHA);
    this.smoothVel.x += (target.x - this.smoothVel.x) * b;
    this.smoothVel.y += (target.y - this.smoothVel.y) * b;
    if (Math.hypot(this.smoothVel.x, this.smoothVel.y) < VEL_FLOOR) {
      this.smoothVel = { x: 0, y: 0 };
    }
    this.vel = { ...this.smoothVel };

    // p_{t+1} = p_t + v_t * dt — head back inside the circle ⇒ v = 0 ⇒ stop.
    // Δx/Δy below is exactly the applied step, so OS control is
    // X_os ← X_os + dx * screenW (never an absolute jump, never drift:
    // inside the zone dx=dy=0 by construction, plus VEL_FLOOR kills crawl).
    const prevX = this.pos.x;
    const prevY = this.pos.y;
    // NOTE (electron-app port): clamp removed. This virtual position is only
    // a delta integrator — the overlay draws the axis widget, never this
    // point — so clamping to 0..1 only pinned an axis mid-lean and starved
    // the OS cursor of further deltas on it (a tiny wobble on the other
    // axis keeps `moved` true forever, so no freeze ever recovers it;
    // gesture-control escapes via its manual Recentre button). Unclamped,
    // sustained leans keep flowing; loadStoredPos() still clamps on boot.
    this.pos = {
      x: this.pos.x + this.smoothVel.x * dt,
      y: this.pos.y + this.smoothVel.y * dt,
    };
    const stepX = this.pos.x - prevX;
    const stepY = this.pos.y - prevY;
    const moved = this.moving && (stepX !== 0 || stepY !== 0);
    // Persist every applied step: a reload/restart resumes from the last
    // position instead of snapping back to a fixed center.
    if (stepX !== 0 || stepY !== 0) storePos(this.pos);
    return { ...this.pos, dx: stepX, dy: stepY, moved };
  }

  get debug(): HeadCursorDebug {
    let dx = 0;
    let dy = 0;
    if (this.neutral && this.smoothNose) {
      const s = this.toScreen(this.smoothNose);
      dx = s.dx;
      dy = s.dy;
    }
    return {
      calibrated: this.calibrated,
      dx,
      dy,
      radius: Math.hypot(dx, dy),
      deadZone: this.deadZone,
      vx: this.vel.x,
      vy: this.vel.y,
      inDeadZone: this.inside,
      faceVisible: this.faceVisible,
    };
  }
}

export interface HeadFrameOptions {
  /** Calibrated origin in RAW camera coords (sits on the nose). */
  neutral: HeadNeutral;
  /** Smoothed nose in RAW camera coords (vector tip). */
  nose: HeadNeutral;
  /** Dead-zone circle radius R (normalized units). */
  deadZone: number;
  /** True while the nose is inside the circle. */
  inside: boolean;
}

/**
 * fillText on a CSS-mirrored canvas reads backwards on screen. Drawing the
 * glyph pre-flipped around (x, y) cancels the mirror so it reads normally.
 */
function drawUnmirroredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.translate(x, 0);
  ctx.scale(-1, 1);
  ctx.fillText(text, 0, y);
  ctx.restore();
}

/**
 * Draw the XY axis widget anchored at the calibrated neutral nose.
 * Drawn in RAW coords on the mirrored canvas — the mirror flips relative
 * vectors once, so on screen +x appears to the RIGHT and +y DOWN, matching
 * the cursor. The circle is the dead zone: inside = green/stop,
 * outside = orange/move (rim → slow, far → fast).
 * Never clears — call after landmarks, before the cursor ring.
 */
export function drawHeadFrame(
  canvas: HTMLCanvasElement,
  opts: HeadFrameOptions,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { neutral, nose, deadZone, inside } = opts;
  const ox = neutral.x * canvas.width;
  const oy = neutral.y * canvas.height;
  const nx = nose.x * canvas.width;
  const ny = nose.y * canvas.height;
  // Ellipse radii: R is in normalized units (x per width, y per height).
  const rx = Math.max(4, deadZone * canvas.width);
  const ry = Math.max(4, deadZone * canvas.height);
  // Full-frame crosshair through the origin (edge to edge).
  const Pad = 4;
  const accent = inside ? '#2ecc71' : '#ff9f43';

  // X / Y axis lines through the origin.
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(154, 164, 178, 0.85)';
  ctx.beginPath();
  ctx.moveTo(Pad, oy);
  ctx.lineTo(canvas.width - Pad, oy);
  ctx.moveTo(ox, Pad);
  ctx.lineTo(ox, canvas.height - Pad);
  ctx.stroke();

  // Axis labels: canvas-left edge appears on screen-right (+x), bottom is +y.
  // (+x text is pre-flipped, so it extends leftward from its anchor —
  // inset the anchor to keep it clear of the edge.)
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(154, 164, 178, 0.95)';
  drawUnmirroredText(ctx, '+x', 34, oy - 8);
  drawUnmirroredText(ctx, '+y', ox + 8, canvas.height - 8);

  // Dead-zone circle (rim → slow, far → fast).
  ctx.beginPath();
  ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.fillStyle = inside
    ? 'rgba(46, 204, 113, 0.08)'
    : 'rgba(255, 159, 67, 0.08)';
  ctx.fill();

  // Displacement vector: origin → current nose.
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(nx, ny);
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.stroke();

  // Origin ring.
  ctx.beginPath();
  ctx.arc(ox, oy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.restore();
}
