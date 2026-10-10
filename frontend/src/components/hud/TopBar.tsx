import { useEffect, useState } from 'react';
import { AudioWaveform, Hexagon, Maximize2, Menu, Minimize2, Settings, WifiOff } from 'lucide-react';
import type { ConnectionStatus } from '../../types';
import Waveform from './Waveform';

export type AppView = 'main' | 'simulation';

/** Compact MAIN / SIMULATION switcher, top-centre of the header. */
export function ViewSwitcher({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
  const tabs: { id: AppView; label: string }[] = [
    { id: 'main', label: 'MAIN' },
    { id: 'simulation', label: 'SIMULATION' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Application mode"
      className="hud-panel inline-flex shrink-0 items-center gap-0.5 rounded-md p-0.5"
    >
      {tabs.map((t) => {
        const active = view === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            title={t.id === 'main' ? 'NOVA main console' : 'Run commands in a real automated browser'}
            className={`nova-transition rounded px-2.5 py-1 text-[10.5px] font-bold tracking-[0.18em] focus-visible:outline-2 focus-visible:outline-[#39D8FF] ${
              active
                ? 'border border-[#39D8FF]/50 bg-[#315BFF]/30 text-[#F5F7FF] shadow-[0_0_14px_-6px_rgba(49,91,255,0.9)]'
                : 'border border-transparent text-[#68769A] hover:text-[#39D8FF]'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function TopBar({
  connection,
  mode,
  onToggleMode,
  sessionStart,
  gridOn,
  onToggleGrid,
  railHidden,
  onToggleRail,
  view,
  onViewChange,
}: {
  connection: ConnectionStatus;
  mode: 'expanded' | 'compact';
  onToggleMode: () => void;
  sessionStart: number;
  gridOn: boolean;
  onToggleGrid: () => void;
  railHidden: boolean;
  onToggleRail: () => void;
  view?: AppView;
  onViewChange?: (v: AppView) => void;
}) {
  const [elapsed, setElapsed] = useState('00:00:00');
  useEffect(() => {
    const tick = () => {
      const s = Math.floor((Date.now() - sessionStart) / 1000);
      const hh = String(Math.floor(s / 3600)).padStart(2, '0');
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      setElapsed(`${hh}:${mm}:${ss}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sessionStart]);

  return (
    <header className="flex w-full shrink-0 items-center justify-between gap-3 px-3 pt-2 sm:px-4">
      {/* Brand */}
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center text-[#39D8FF]">
          <Hexagon className="absolute h-10 w-10 opacity-90" strokeWidth={1.5} />
          <span className="relative text-[11px] font-extrabold tracking-tight text-[#F5F7FF]">AI</span>
          <span className="nova-live-dot absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#39D8FF]" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-extrabold leading-none tracking-[0.3em] text-[#F5F7FF]">NOVA</h1>
          <p className="truncate text-[9px] font-semibold tracking-[0.26em] text-[#9AA7CB]">HANDS-FREE BROWSER AGENT</p>
        </div>
      </div>

      {/* Centre: view switcher + system strip */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
        {view && onViewChange && <ViewSwitcher view={view} onChange={onViewChange} />}
        <div
          className="hud-panel hidden min-w-0 items-center justify-center gap-4 px-4 py-1.5 md:flex"
          style={{ maxWidth: 460 }}
          aria-hidden
        >
          <span className="hud-mono shrink-0 text-[11px] tracking-[0.18em] text-[#9AA7CB]">SESSION 01 · {elapsed}</span>
          <span className="h-4 w-px shrink-0 bg-white/10" />
          <span className="inline-flex shrink-0 items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-[#31E8C0]">
            <AudioWaveform className="h-3.5 w-3.5" />
            SYSTEM ONLINE
          </span>
          <div className="hidden min-w-0 flex-1 lg:block">
            <Waveform bars={14} height={18} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={`hud-panel hidden items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11px] font-semibold lg:inline-flex ${
            connection === 'connected' ? 'text-[#31E8C0]' : 'text-[#FFC56B]'
          }`}
          role="status"
          aria-label={`Agent connection: ${connection}`}
        >
          {connection === 'connected' ? <span className="nova-live-dot h-1.5 w-1.5 rounded-full bg-[#31E8C0]" /> : <WifiOff className="h-3 w-3" />}
          {connection === 'connected' ? 'AGENT LINKED' : 'AGENT OFFLINE'}
        </span>
        <button
          onClick={onToggleMode}
          className="hud-panel nova-transition inline-flex h-8 w-8 items-center justify-center text-[#9AA7CB] hover:text-[#39D8FF] focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
          aria-label={mode === 'expanded' ? 'Switch to compact mode' : 'Switch to expanded mode'}
          title={mode === 'expanded' ? 'Compact mode' : 'Expanded mode'}
        >
          {mode === 'expanded' ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          onClick={onToggleGrid}
          className="hud-panel nova-transition inline-flex h-8 w-8 items-center justify-center focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
          aria-label="Toggle background grid"
          aria-pressed={gridOn}
          title="Toggle background grid"
          style={{ color: gridOn ? '#39D8FF' : '#68769A' }}
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          onClick={onToggleRail}
          className="hud-panel nova-transition inline-flex h-8 w-8 items-center justify-center focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
          aria-label="Toggle telemetry rail"
          aria-pressed={!railHidden}
          title="Toggle telemetry rail"
          style={{ color: railHidden ? '#68769A' : '#39D8FF' }}
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
