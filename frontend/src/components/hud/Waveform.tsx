import { useEffect, useRef } from 'react';
import { audioBus } from '../../features/audio/audioBus';

/**
 * Real microphone waveform — draws audioBus values from the live AnalyserNode.
 * Shows a flat line when the mic is off (no fake idle animation).
 */
export default function Waveform({
  bars = 32,
  height = 26,
  className = '',
}: {
  bars?: number;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<number[]>(new Array(bars).fill(0));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let lastPush = 0;

    const draw = (t: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // push a history sample ~16 times/sec
      if (t - lastPush > 60) {
        lastPush = t;
        const v = audioBus.active ? Math.min(1, audioBus.rms * 2.4 + audioBus.smoothed * 0.4) : 0;
        const hist = histRef.current;
        hist.push(v);
        while (hist.length > bars) hist.shift();
      }

      const hist = histRef.current;
      const gap = 2;
      const bw = Math.max(1.5, (w - gap * (bars - 1)) / bars);
      const mid = h / 2;
      for (let i = 0; i < hist.length; i++) {
        const v = hist[i];
        const x = i * (bw + gap);
        const bh = Math.max(1.5, v * (h - 4));
        const grad = ctx.createLinearGradient(0, mid - bh / 2, 0, mid + bh / 2);
        grad.addColorStop(0, '#39d8ff');
        grad.addColorStop(0.5, '#a855f7');
        grad.addColorStop(1, '#315bff');
        ctx.fillStyle = grad;
        ctx.fillRect(x, mid - bh / 2, bw, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [bars]);

  return <canvas ref={ref} className={`block w-full ${className}`} style={{ height }} aria-hidden />;
}
