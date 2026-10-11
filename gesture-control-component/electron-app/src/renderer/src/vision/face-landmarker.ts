/**
 * vision/face-landmarker.ts — HEAD-CURSOR stage.
 *
 * Owns the MediaPipe Face Landmarker instance (runs INDEPENDENTLY of the
 * Hand Landmarker — same webcam frame, two detectors in parallel):
 *
 *   webcam ─┬─ Face Landmarker ─> nose point ─> head-cursor-controller
 *           └─ Hand Landmarker ─> pinch detection ─> click event
 *
 * - Created ONCE and reused (never re-init per frame).
 * - detectForVideo() only — VIDEO running mode for webcam streams.
 * - Only the nose tip (index 1) is needed downstream; the overlay helper
 *   draws just that point so the preview stays uncluttered.
 */

import {
  FilesetResolver,
  FaceLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** MediaPipe FaceMesh topology: landmark 1 = nose tip. */
export const NOSE_TIP_INDEX = 1;

export type FacePoints = NormalizedLandmark[][];

let landmarker: FaceLandmarker | null = null;
let loading: Promise<FaceLandmarker> | null = null;

/** Load (once) and return the shared FaceLandmarker. Safe to call repeatedly. */
export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (landmarker) return landmarker;
  if (loading) return loading;

  loading = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const instance = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    landmarker = instance;
    return instance;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

/** Run detection on the current video frame. Returns [] when no face visible. */
export function detectFace(
  video: HTMLVideoElement,
  timestampMs: number,
): FacePoints {
  if (!landmarker) return [];
  if (video.readyState < 2 || video.videoWidth === 0) return [];
  try {
    const result = landmarker.detectForVideo(video, timestampMs);
    return result.faceLandmarks ?? [];
  } catch (error) {
    console.warn('[face] detectForVideo failed:', error);
    return [];
  }
}

/** Extract the nose tip from the first detected face (null = no face). */
export function getNosePoint(faces: FacePoints): NormalizedLandmark | null {
  const face = faces[0];
  if (!face) return null;
  return face[NOSE_TIP_INDEX] ?? null;
}

/** Free WASM resources on app unload. */
export function disposeFaceLandmarker(): void {
  try {
    landmarker?.close();
  } catch {
    // ignore close errors
  }
  landmarker = null;
  loading = null;
}

/**
 * Draw the nose point on the overlay canvas (call AFTER hand landmarks,
 * so the nose dot stays on top).
 * Canvas gets the same CSS mirror as the video, so no x-flip needed in JS.
 */
export function drawNosePoint(
  canvas: HTMLCanvasElement,
  nose: { x: number; y: number } | null,
  calibrated: boolean,
): void {
  if (!nose) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const x = nose.x * canvas.width;
  const y = nose.y * canvas.height;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = calibrated ? '#4f8cff' : '#f39c12';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}
