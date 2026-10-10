/**
 * vision/camera.ts — STAGE 2
 *
 * Small, single-purpose module that owns the webcam stream.
 * Why a separate file? So later stages (MediaPipe, gestures)
 * can reuse start/stop without touching UI code.
 *
 * Rules enforced here:
 * - Never create a second stream while one is alive (avoids leaks + camera-busy errors).
 * - Always stop every track on stop (releases the webcam light/device).
 * - Never throw raw browser errors to the UI — map them to readable messages.
 */

export interface CameraOptions {
  width?: number;
  height?: number;
  frameRate?: number;
  deviceId?: string;
}

const DEFAULTS: Required<Omit<CameraOptions, 'deviceId'>> = {
  width: 640,
  height: 480,
  frameRate: 30,
};

/**
 * Start the webcam and attach it to a <video> element.
 * If a live stream is already attached, it is reused (no re-init).
 */
export async function startCamera(
  video: HTMLVideoElement,
  options: CameraOptions = {},
): Promise<MediaStream> {
  const existing = video.srcObject as MediaStream | null;
  if (existing && existing.getTracks().some((t) => t.readyState === 'live')) {
    return existing;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera API not available. This app must run in Electron with webcam access enabled.',
    );
  }

  const { width, height, frameRate } = { ...DEFAULTS, ...options };

  const constraints: MediaStreamConstraints = {
    video: {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate, max: frameRate },
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    },
    audio: false,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  video.muted = true;

  // play() can reject if the element isn't ready — let the caller show the error.
  await video.play();
  return stream;
}

/** Stop every track and detach from the <video> element. Safe to call twice. */
export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  if (stream) {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore — track may already be ended
      }
    }
  }
  video.srcObject = null;
}

/** True when the video element currently holds a live track. */
export function isCameraRunning(video: HTMLVideoElement): boolean {
  const stream = video.srcObject as MediaStream | null;
  return !!stream && stream.getTracks().some((t) => t.readyState === 'live');
}

/** Turn a getUserMedia exception into a beginner-friendly message. */
export function getCameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException || error instanceof Error) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission denied. Click the camera icon in the address bar / allow webcam access, then press Start Camera.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No webcam found. Plug in a camera and press Start Camera again.';
      case 'NotReadableError':
      case 'AbortError':
        return 'Camera is busy or failed to start. Close other apps using the webcam (Zoom, Chrome, Cheese), then retry.';
      default:
        return `Camera failed to start: ${error.message || error.name}`;
    }
  }
  return 'Camera failed to start for an unknown reason.';
}
