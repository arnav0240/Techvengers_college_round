import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraStatus, TrackingState } from '../../types';

export const initialTrackingState: TrackingState = {
  available: false,
  confidence: null,
  x: null,
  y: null,
  lastUpdate: null,
  statusMessage: 'Camera active, but head/hand tracking service is not connected.',
};

/**
 * Real webcam management via getUserMedia. No fake feeds.
 * Tracking is exposed as a typed adapter interface for a teammate-owned
 * service; until connected it honestly reports unavailable.
 */
export function useCamera() {
  const [status, setStatus] = useState<CameraStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [tracking] = useState<TrackingState>(initialTrackingState);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setStatus('off');
    setError(null);
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setError('Camera is not supported in this browser.');
      return;
    }
    setStatus('requesting');
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 400 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = s;
      setStream(s);
      setStatus('active');
    } catch (err) {
      const name = (err as Error)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied');
        setError('Camera permission was denied. Allow camera access in the browser to enable preview.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setStatus('unavailable');
        setError('No camera device was found.');
      } else {
        setStatus('error');
        setError('Could not start the camera.');
      }
    }
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return { status, error, stream, tracking, start, stop };
}
