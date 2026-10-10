import type { AudioLevels } from '../../types';

/**
 * Shared mutable audio bus. Updated by the analyser at ~60Hz without
 * triggering React renders. The Three.js scene reads it inside useFrame.
 */
export const audioBus: AudioLevels = {
  rms: 0,
  smoothed: 0,
  peak: 0,
  low: 0,
  mid: 0,
  high: 0,
  active: false,
};

export function resetAudioBus() {
  audioBus.rms = 0;
  audioBus.smoothed = 0;
  audioBus.peak = 0;
  audioBus.low = 0;
  audioBus.mid = 0;
  audioBus.high = 0;
  audioBus.active = false;
}
