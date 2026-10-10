import { Maximize2, Minimize2, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CameraStatus, ConnectionStatus, TrackingState } from '../../types';
import WebcamCard from '../webcam/WebcamCard';

export default function Header({
  connection,
  mode,
  onToggleMode,
  cam,
}: {
  connection: ConnectionStatus;
  mode: 'expanded' | 'compact';
  onToggleMode: () => void;
  cam: {
    status: CameraStatus;
    error: string | null;
    stream: MediaStream | null;
    tracking: TrackingState;
    start: () => void;
    stop: () => void;
  };
}) {
  const [now, setNow] = useState('');
  useEffect(() => {
    const tick = () => setNow(`${new Date().toISOString().slice(11, 19)} UTC`);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <header className="flex w-full shrink-0 items-center justify-between gap-2 px-3 pt-2 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#315BFF] to-[#7C3CFF] text-base font-extrabold shadow-[0_0_20px_rgba(49,91,255,0.5)]">
          N
          <span className="nova-live-dot absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#39D8FF]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-base font-extrabold tracking-[0.22em] text-[#F5F7FF]">NOVA</h1>
            <span className="nova-live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[#39D8FF]" aria-hidden />
          </div>
          <p className="hidden text-[10px] font-medium tracking-[0.3em] text-[#68769A] sm:block">VOICE AGENT</p>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        {now && (
          <span className="nova-panel hidden rounded-full px-2.5 py-1 font-mono text-[11px] tracking-widest text-[#39D8FF] lg:inline-block" aria-label={`Current time ${now}`}>
            {now}
          </span>
        )}
        <div
          className={`nova-panel nova-transition hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold md:inline-flex ${
            connection === 'connected' ? 'text-[#31E8C0]' : connection === 'connecting' ? 'text-[#39D8FF]' : 'text-[#FFC56B]'
          }`}
          role="status"
          aria-label={`Agent connection: ${connection}`}
        >
          {connection === 'connected' ? (
            <span className="nova-live-dot h-1.5 w-1.5 rounded-full bg-[#31E8C0]" />
          ) : connection === 'connecting' ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#39D8FF]" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          {connection === 'connected' ? 'Agent connected' : connection === 'connecting' ? 'Connecting…' : 'Agent disconnected'}
        </div>
        {/* Compact connection dot for narrow screens (icon + text, not color-only) */}
        <div
          className={`nova-panel inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold md:hidden ${
            connection === 'connected' ? 'text-[#31E8C0]' : 'text-[#FFC56B]'
          }`}
          role="status"
          aria-label={`Agent connection: ${connection}`}
        >
          <WifiOff className="h-3 w-3" />
          {connection === 'connected' ? 'Connected' : 'Offline'}
        </div>
        <button
          onClick={onToggleMode}
          className="nova-panel nova-transition inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#9AA7CB] hover:text-white focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
          aria-label={mode === 'expanded' ? 'Switch to compact mode' : 'Switch to expanded mode'}
        >
          {mode === 'expanded' ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          <span className="hidden sm:inline">{mode === 'expanded' ? 'Compact' : 'Expand'}</span>
        </button>
      </div>

      {mode === 'expanded' && (
        <div className="shrink-0">
          <WebcamCard
            mini
            status={cam.status}
            error={cam.error}
            stream={cam.stream}
            tracking={cam.tracking}
            onEnable={cam.start}
            onDisable={cam.stop}
          />
        </div>
      )}
    </header>
  );
}
