import { useEffect, useRef } from 'react';

/** Decorative-but-live 2D wireframe globe thumbnail for the telemetry rail. */
export default function MiniGlobe({ size = 120 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const r = size / 2 - 6;
    const cx = size / 2;
    const cy = size / 2;

    const draw = (t: number) => {
      const rot = reduced ? 0.6 : t * 0.0004;
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(57,216,255,0.55)';
      ctx.lineWidth = 1;
      // outline
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      // latitudes (flat ellipses)
      ctx.strokeStyle = 'rgba(57,216,255,0.3)';
      for (let i = -2; i <= 2; i++) {
        const y = (i / 3) * r;
        const rr = Math.sqrt(Math.max(0, r * r - y * y));
        ctx.beginPath();
        ctx.ellipse(cx, cy + y, rr, rr * 0.22, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // longitudes (rotating)
      for (let i = 0; i < 5; i++) {
        const phase = rot + (i * Math.PI) / 5;
        const k = Math.abs(Math.sin(phase));
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1.5, r * k), r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // core dot
      ctx.fillStyle = 'rgba(168,85,247,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />;
}
