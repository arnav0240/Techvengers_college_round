import { useEffect, useState } from 'react';
import type { ConnectionStatus, MicStatus, SpeechSupport } from '../../types';
import MiniGlobe from './MiniGlobe';

interface Metrics {
  fps: number;
  heap: number | null; // MB
  net: string | null;
}

function useRealMetrics() {
  const [m, setM] = useState<Metrics>({ fps: 0, heap: null, net: null });
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
        const nav = navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } };
        setM({
          fps: Math.round((frames * 1000) / (now - last)),
          heap: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null,
          net: nav.connection
            ? `${nav.connection.effectiveType ?? '?'}${nav.connection.downlink ? ` · ${nav.connection.downlink}Mb/s` : ''}`
            : null,
        });
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return m;
}

function Row({ label, value, tone = 'text-[#31E8C0]' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="hud-mono text-[11px] text-[#9AA7CB]">{label}</span>
      <span className={`hud-mono text-[11px] font-semibold ${tone}`}>{value}</span>
    </div>
  );
}

export default function LeftRail({
  connection,
  micStatus,
  speechSupported,
  trackingAvailable,
}: {
  connection: ConnectionStatus;
  micStatus: MicStatus;
  speechSupported: SpeechSupport;
  trackingAvailable: boolean;
}) {
  const m = useRealMetrics();
  const online = connection === 'connected';

  const cap = (name: string, state: string, ok: boolean) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11.5px] text-[#F5F7FF]">{name}</span>
      <span className={`hud-mono text-[10px] ${ok ? 'text-[#31E8C0]' : 'text-[#68769A]'}`}>{state}</span>
    </div>
  );

  return (
    <aside className="hidden min-h-0 min-w-0 flex-col gap-2 overflow-hidden xl:flex" aria-label="System telemetry">
      <p className="hud-title pl-0.5 text-[#9AA7CB]">VOICE INTERFACE / v1.0</p>

      <section className="hud-panel px-3 py-2.5" aria-label="Core status">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="hud-title">CORE</span>
          <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-[#31E8C0] shadow-[0_0_8px_#31E8C0]' : 'bg-[#FFC56B]'}`} />
        </div>
        <div className="space-y-1.5">
          <Row label="AI:" value={online ? 'ONLINE' : 'OFFLINE'} tone={online ? 'text-[#31E8C0]' : 'text-[#FFC56B]'} />
          <Row label="BROWSER:" value={online ? 'READY' : 'STANDBY'} tone={online ? 'text-[#31E8C0]' : 'text-[#39D8FF]'} />
          <Row label="VISION:" value={trackingAvailable ? 'TRACKING' : 'STANDBY'} tone={trackingAvailable ? 'text-[#31E8C0]' : 'text-[#9AA7CB]'} />
          <Row label="AUDIO:" value={micStatus === 'active' ? 'LIVE' : micStatus === 'requesting' ? 'OPENING' : 'OFF'} tone={micStatus === 'active' ? 'text-[#31E8C0]' : 'text-[#9AA7CB]'} />
        </div>
      </section>

      <section className="hud-panel px-3 py-2.5" aria-label="System metrics">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="hud-title">SYSTEM</span>
          <span className="hud-mono text-[9px] text-[#68769A]">REAL TELEMETRY</span>
        </div>
        <div className="space-y-1.5">
          <Row label="RENDER:" value={`${m.fps} fps`} tone={m.fps >= 50 ? 'text-[#31E8C0]' : m.fps >= 30 ? 'text-[#FFC56B]' : 'text-[#FF6488]'} />
          <Row label="JS HEAP:" value={m.heap !== null ? `${m.heap} MB` : 'n/a'} tone="text-[#39D8FF]" />
          <Row label="NETWORK:" value={m.net ?? 'n/a'} tone="text-[#39D8FF]" />
        </div>
      </section>

      <section className="hud-panel px-3 py-2.5" aria-label="Capabilities">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="hud-title">CAPABILITIES</span>
        </div>
        <div className="space-y-1.5">
          {cap('Web control', online ? 'ARMED' : 'NO AGENT', online)}
          {cap('Multi-tab', online ? 'ARMED' : 'NO AGENT', online)}
          {cap('Voice input', micStatus === 'active' ? 'LIVE' : 'READY', micStatus === 'active')}
          {cap('Natural language', speechSupported === 'supported' ? 'SUPPORTED' : 'TYPING ONLY', speechSupported === 'supported')}
          {cap('Vision tracking', trackingAvailable ? 'ACTIVE' : 'UNAVAILABLE', trackingAvailable)}
        </div>
      </section>

      <div className="hud-panel hidden flex-1 flex-col items-center justify-center overflow-hidden py-2 xl:flex" aria-hidden>
        <MiniGlobe size={116} />
        <span className="hud-mono mt-1 text-[9px] tracking-[0.2em] text-[#68769A]">GLOBE.LINK</span>
      </div>
    </aside>
  );
}
