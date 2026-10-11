/**
 * vision/hand-landmarker.ts — STAGE 3
 *
 * Owns the MediaPipe Hand Landmarker instance.
 * - Loads WASM + model from CDN (needs internet on first run).
 * - Created ONCE and reused (never re-init per frame).
 * - detectForVideo() only — the VIDEO running mode for webcam streams.
 * - drawLandmarks() plots the 21 hand points + finger lines on a canvas.
 */

import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

// Pin WASM to the installed version so CDN + npm never drift apart.
const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
// Official Google-hosted hand model (~8MB, downloaded once, then cached by browser).
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export type HandPoints = NormalizedLandmark[][];

let landmarker: HandLandmarker | null = null;
let loading: Promise<HandLandmarker> | null = null;

/** Load (once) and return the shared HandLandmarker. Safe to call repeatedly. */
export async function getHandLandmarker(): Promise<HandLandmarker> {
  if (landmarker) return landmarker;
  if (loading) return loading;

  loading = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const instance = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1, // one hand first — faster + simpler
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    landmarker = instance;
    return instance;
  })();

  try {
    return await loading;
  } catch (error) {
    // Allow a retry on the next call instead of caching a failure.
    loading = null;
    throw error;
  }
}

/** Run detection on the current video frame. Returns [] when no hand is visible. */
export function detectHand(
  video: HTMLVideoElement,
  timestampMs: number,
): HandPoints {
  if (!landmarker) return [];
  if (video.readyState < 2 || video.videoWidth === 0) return [];
  try {
    const result = landmarker.detectForVideo(video, timestampMs);
    return result.landmarks ?? [];
  } catch (error) {
    console.warn('[hand] detectForVideo failed:', error);
    return [];
  }
}

/** Free WASM resources on app unload. */
export function disposeHandLandmarker(): void {
  try {
    landmarker?.close();
  } catch {
    // ignore close errors
  }
  landmarker = null;
  loading = null;
}

// Finger skeleton: which landmark indices to join with lines.
const CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4], // thumb
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8], // index
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12], // middle
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16], // ring
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20], // pinky
  [0, 17], // palm base
];

/**
 * Plot hand points on the overlay canvas.
 * Landmarks are normalized (0..1) — scaled to canvas pixels here.
 * Canvas gets the same CSS mirror as the video, so no x-flip needed in JS.
 */
export function drawLandmarks(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: HandPoints,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Match canvas backing store to the real video resolution (once it changes).
  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const landmarks of hands) {
    // Finger lines (green)
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [a, b] of CONNECTIONS) {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * canvas.width, pa.y * canvas.height);
      ctx.lineTo(pb.x * canvas.width, pb.y * canvas.height);
      ctx.stroke();
    }
    // 21 joint dots (red with white ring — visible on any skin/background)
    for (const p of landmarks) {
      const x = p.x * canvas.width;
      const y = p.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#e74c3c';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }
}

/** Clear the overlay (used when camera stops or tracking is lost). */
export function clearOverlay(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
