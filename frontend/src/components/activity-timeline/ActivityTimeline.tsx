import { AlertTriangle, CheckCircle2, Circle, CircleDashed, Loader2, PauseCircle, XCircle } from 'lucide-react';
import type { ActivityStatus, AgentEvent, ConnectionStatus } from '../../types';

const META: Record<ActivityStatus, { label: string; cls: string; Icon: typeof Circle }> = {
  pending: { label: 'Pending', cls: 'text-[#68769A] border-[#68769A]/30 bg-[#68769A]/10', Icon: CircleDashed },
  running: { label: 'Running', cls: 'text-[#39D8FF] border-[#39D8FF]/30 bg-[#315BFF]/10', Icon: Loader2 },
  completed: { label: 'Completed', cls: 'text-[#31E8C0] border-[#31E8C0]/30 bg-[#31E8C0]/10', Icon: CheckCircle2 },
  failed: { label: 'Failed', cls: 'text-[#FF6488] border-[#FF6488]/30 bg-[#FF6488]/10', Icon: XCircle },
  cancelled: { label: 'Cancelled', cls: 'text-[#9AA7CB] border-white/15 bg-white/5', Icon: Circle },
  waiting_for_confirmation: { label: 'Needs confirm', cls: 'text-[#FFC56B] border-[#FFC56B]/30 bg-[#FFC56B]/10', Icon: PauseCircle },
};

/**
 * Compact, NON-scrollable activity display. The full event history stays in
 * the app state model; only the latest few events are rendered so the panel
 * always fits the viewport.
 */
export default function ActivityTimeline({
  events,
  connection,
  activeRequestId,
  currentTask,
}: {
  events: AgentEvent[];
  connection: ConnectionStatus;
  activeRequestId: string | null;
  currentTask: string | null;
}) {
  const recent = events.slice(-4);
  const latest = events.length ? events[events.length - 1] : null;

  return (
    <section className="nova-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl px-3 py-2" aria-label="Agent activity">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-xs font-bold tracking-[0.18em] text-[#9AA7CB]">AGENT ACTIVITY</h2>
        {activeRequestId && (
          <span className="truncate rounded bg-white/5 px-1.5 py-px font-mono text-[10px] text-[#68769A]">req {activeRequestId.slice(0, 8)}</span>
        )}
      </div>

      <div className="mt-1.5 min-h-0 shrink-0 rounded-xl border border-white/5 bg-black/30 px-2.5 py-1.5">
        <p className="text-[9px] font-bold tracking-[0.2em] text-[#68769A]">CURRENT TASK</p>
        <p className="truncate text-[13px] font-medium text-[#F5F7FF]" title={currentTask ?? 'No task submitted yet'}>
          {currentTask ?? 'No task submitted yet.'}
        </p>
        <p className="truncate text-[11px] text-[#9AA7CB]">
          {latest ? `${latest.stage} — ${META[latest.status].label}` : connection === 'connected' ? 'Waiting for agent events…' : 'Agent disconnected — timeline fills in once the real service connects.'}
        </p>
      </div>

      {connection !== 'connected' ? (
        <p className="mt-1.5 flex shrink-0 items-start gap-1.5 rounded-lg border border-[#FFC56B]/25 bg-[#FFC56B]/[0.07] px-2 py-1.5 text-[11px] leading-snug text-[#FFC56B]" role="status">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">Runtime agent disconnected — no activity is fabricated. Local voice, camera and typing work now.</span>
        </p>
      ) : recent.length === 0 ? (
        <p className="mt-1.5 shrink-0 rounded-lg border border-dashed border-white/10 px-2 py-2 text-center text-[11px] text-[#68769A]">
          No events yet — submit a request to begin.
        </p>
      ) : (
        <ol className="mt-1.5 hidden min-h-0 flex-1 flex-col justify-start gap-1 overflow-hidden lg:flex" aria-label="Recent events">
          {recent.map((ev) => {
            const m = META[ev.status];
            return (
              <li key={ev.eventId} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/5 bg-black/25 px-2 py-1">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${m.cls}`}>
                  <m.Icon className={`h-3 w-3 ${ev.status === 'running' ? 'animate-spin' : ''}`} />
                </span>
                <p className="min-w-0 flex-1 truncate text-[11px] text-[#9AA7CB]">
                  <span className="font-semibold text-[#F5F7FF]">{ev.stage}</span>
                  <span className="text-[#68769A]"> · {ev.message}</span>
                </p>
                <span className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold ${m.cls}`}>{m.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-auto hidden shrink-0 truncate pt-1 text-[9px] text-[#68769A] xl:block">
        Tracking: camera-only until the vision service connects. · {events.length} event(s) in session state.
      </p>
    </section>
  );
}
