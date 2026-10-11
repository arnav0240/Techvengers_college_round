/**
 * controller/gesture-controller.ts — STAGE 4 (direct-mode revision)
 *
 * Turns classified gestures into human-readable browser commands.
 * Real CDP execution lands in Stage 5 (browser/cdp-client.ts) — this module
 * already returns the exact command string the UI badge + logs show, so the
 * mapping can be tested with just the webcam today.
 *
 * Rules:
 * - Open-palm hold pauses; any deliberate gesture resumes.
 * - Fist directly selects CURSOR mode, two fingers select SCROLL mode
 *   (no toggle to lose track of — the mode badge always shows the truth).
 * - Scrolling only fires in scroll mode; pinch-click only in cursor mode.
 */

import type { GestureName } from '../gestures/gesture-detector';

export type ControlMode = 'scroll' | 'cursor';

export interface CommandOutput {
  /** Exact command text shown in the green badge, e.g. "SCROLL UP". */
  label: string;
  /** True when this is a real action (green highlight); false = idle/status. */
  active: boolean;
  /** Machine-readable action for Stage 5 CDP wiring (null = nothing to send). */
  action:
    | 'scroll_up'
    | 'scroll_down'
    | 'click'
    | 'confirm'
    | 'cancel'
    | 'mode_cursor'
    | 'mode_scroll'
    | 'pause'
    | null;
}

export class GestureController {
  mode: ControlMode = 'scroll';
  paused = false;

  process(gesture: GestureName): CommandOutput {
    // Open-palm hold pauses while held.
    if (gesture === 'open_palm_hold') {
      this.paused = true;
      return { label: 'PAUSED', active: true, action: 'pause' };
    }

    // Any deliberate gesture resumes a pause.
    if (this.paused && gesture !== 'neutral' && gesture !== 'no_hand') {
      this.paused = false;
    }
    if (this.paused) {
      return { label: 'PAUSED', active: true, action: null };
    }

    switch (gesture) {
      case 'point_up':
        if (this.mode !== 'scroll')
          return { label: 'SCROLL MODE OFF', active: false, action: null };
        return { label: 'SCROLL UP', active: true, action: 'scroll_up' };
      case 'point_down':
        if (this.mode !== 'scroll')
          return { label: 'SCROLL MODE OFF', active: false, action: null };
        return { label: 'SCROLL DOWN', active: true, action: 'scroll_down' };
      case 'pinch':
        if (this.mode !== 'cursor') {
          return {
            label: 'PINCH — CURSOR MODE OFF',
            active: true,
            action: null,
          };
        }
        return { label: 'CLICK', active: true, action: 'click' };
      case 'fist':
        this.mode = 'cursor';
        return { label: 'MODE: CURSOR', active: true, action: 'mode_cursor' };
      case 'two_fingers':
        this.mode = 'scroll';
        return { label: 'MODE: SCROLL', active: true, action: 'mode_scroll' };
      case 'thumb_up':
        return { label: 'CONFIRM', active: true, action: 'confirm' };
      case 'thumb_down':
        return { label: 'CANCEL', active: true, action: 'cancel' };
      case 'no_hand':
        return { label: 'NO HAND', active: false, action: null };
      case 'neutral':
      default:
        return {
          label:
            this.mode === 'scroll'
              ? 'SCROLL MODE — READY'
              : 'CURSOR MODE — READY',
          active: false,
          action: null,
        };
    }
  }
}
