import { Ban, Expand, Mic, MicOff, WifiOff } from 'lucide-react';
import NovaOrbCanvas from '../assistant/NovaOrb';
import type { AgentEvent, AppStatus, ConnectionStatus, MicStatus, OrbVisualState } from '../../types';

export default function CompactPanel({
  orbState,
  appStatus,
  connection,
  micStatus,
  events,
  lastSubmitted,
  onExpand,
  onCancel,
}: {
  orbState: OrbVisualState;
  appStatus: AppStatus;
  connection: ConnectionStatus;
  micStatus: MicStatus;
  events: AgentEvent[];
  lastSubmitted: string | null;
  onExpand: () => void;
  onCancel: () => void;
}) {
  const latest = events.length ? events[events.length - 1] : null;
  return (
    <aside
      className="nova-panel fixed right-2 top-2 z-40 flex h-[calc(100dvh-1rem)] w-[300px] flex-col overflow-hidden rounded-2xl"
      aria-label="NOVA compact assistant"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-[#315BFF] to-[#7C3CFF] text-[11px] font-extrabold">N</span>
          <div>
            <p className="text-xs font-bold tracking-[0.18em]">NOVA</p>
            <p className={`flex items-center gap-1 text-[10px] ${connection === 'connected' ? 'text-[#31E8C0]' : 'text-[#FFC56B]'}`}>
              {connection !== 'connected' && <WifiOff className="h-2.5 w-2.5" />}
              {connection === 'connected' ? 'Connected' : 'Disconnected'}
            </p>
          </div>
        </div>
        <button
          onClick={onExpand}
          className="nova-transition inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[#9AA7CB] hover:text-white focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
        >
          <Expand className="h-3 w-3" /> Expand
        </button>
      </div>

      <div className="relative h-[180px] shrink-0">
        <NovaOrbCanvas visualState={orbState} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-3">
        <div className="shrink-0 rounded-xl border border-white/5 bg-black/30 p-2">
          <p className="text-[9px] font-bold tracking-[0.2em] text-[#68769A]">CURRENT TASK</p>
          <p className="line-clamp-2 text-xs leading-snug text-[#F5F7FF]">{lastSubmitted ?? 'No task submitted yet.'}</p>
          <p className="mt-1 flex items-center gap-1 text-[10px] text-[#9AA7CB]">
            {micStatus === 'active' ? <Mic className="h-2.5 w-2.5 text-[#31E8C0]" /> : <MicOff className="h-2.5 w-2.5 text-[#68769A]" />}
            {appStatus} · mic {micStatus}
          </p>
        </div>

        <div className="min-h-0 shrink rounded-xl border border-white/5 bg-black/30 p-2">
          <p className="text-[9px] font-bold tracking-[0.2em] text-[#68769A]">LATEST ACTIVITY</p>
          {latest ? (
            <div className="mt-0.5 min-h-0 overflow-hidden">
              <p className="truncate text-xs font-semibold text-[#F5F7FF]">{latest.stage}</p>
              <p className="line-clamp-2 text-[11px] text-[#9AA7CB]">{latest.message}</p>
            </div>
          ) : (
            <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-[#68769A]">
              {connection === 'connected' ? 'Waiting for agent events…' : 'Agent disconnected — activity appears here once connected.'}
            </p>
          )}
        </div>

        <button
          onClick={onCancel}
          className="nova-transition inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#FF6488]/30 bg-[#FF6488]/10 px-3 py-1.5 text-[11px] font-semibold text-[#FF6488] hover:bg-[#FF6488]/20 focus-visible:outline-2 focus-visible:outline-[#FF6488]"
        >
          <Ban className="h-3 w-3" /> Cancel / Stop
        </button>
      </div>
    </aside>
  );
}
