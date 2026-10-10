/**
 * gestures/confirm-tracker.ts — edge-triggered confirm flag.
 *
 * Collapses the one-shot `thumb_up` / `thumb_down` gestures into a single
 * boolean: `is_confirm = True` on thumbs-up, `False` on cancel (thumbs-down).
 * Reports ONLY on change — holding the pose, or repeating the same pose,
 * never re-emits. (`null` = no change this tick.)
 */

import type { GestureName } from './gesture-detector';

export class ConfirmTracker {
  private state = false;

  /** Current value (False until the first thumbs-up). */
  get value(): boolean {
    return this.state;
  }

  /**
   * Feed each classified gesture; returns the new `is_confirm` ONLY when it
   * flips, otherwise `null`.
   */
  update(gesture: GestureName): boolean | null {
    if (gesture === 'thumb_up' && !this.state) {
      this.state = true;
      return true;
    }
    if (gesture === 'thumb_down' && this.state) {
      this.state = false;
      return false;
    }
    return null;
  }

  /** Forget the latch (e.g. on camera stop) — next pose reports fresh. */
  reset(): void {
    this.state = false;
  }
}
