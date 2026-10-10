import { CheckCircle2, Circle, Loader2, XCircle, Slash, Clock3, ListChecks } from 'lucide-react';
import type { SimEvent, SimRequest } from '../../features/simulation/types';

const TYPE_TAG: Record<string, string> = {
  lifecycle: 'text-[#9AA7CB] border-white/15',
  plan: 'text-[#A855F7] border-[#A855F7]/40',
  browser: 'text-[#39D8FF] border-[#39D8FF]/40',
  navigation: 'text-[#315BFF] border-[#315BFF]/40',
  interaction: 'text-[#FFC56B] border-[#FFC56B]/40',
  observation: 'text-[#9AA7CB] border-white/15',
  verification: 'text-[#31E8C0] border-[#31E8C0]/40',
  error: 'text-[#FF6488] border-[#FF6488]/40',
};

function StatusIcon({ status }: { status: SimEvent['status'] }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={`${cls} text-[#31E8C0]`} />;
    case 'failed':
      return <XCircle className={`${cls} text-[#FF6488]`} />;
    case 'cancelled':
      return <Slash className={`${cls} text-[#FFC56B]`} />;
    case 'running':
      return <Loader2 className={`${cls} animate-spin text-[#39D8FF]`} />;
    default:
      return <Circle className={`${cls} text-[#68769A]`} />;
  }
}

const stamp = (t: number) => {
  const d = new Date(t);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

/**
 * Real-time execution trace. Every row is an event actually emitted by the
 * execution engine from a real browser operation — the currently running step
 * is highlighted, failures are shown verbatim, and durations are measured.
 */
export default function SimActivity({
  events,
  request,
  dense = false,
}: {
  events: SimEvent[];
  request: SimRequest | null;
  dense?: boolean;
}) {
  const running = request?.status === 'running' || request?.status === 'accepted';
  const failed = request?.status === 'failed';
  const done = request?.status === 'completed';
  const cancelled = request?.status === 'cancelled';

  return (
    <section
      className={`hud-panel flex min-h-0 flex-col overflow-hidden rounded-lg ${dense ? 'h-full' : ''}`}
      aria-label="Agent activity"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-3 py-2">
        <ListChecks className="h-3.5 w-3.5 text-[#39D8FF]" />
        <span className="hud-title">AGENT ACTIVITY //</span>
        <span className="hud-mono ml-auto text-[9px] tracking-[0.14em] text-[#68769A]">
          {events.length} EVENT{events.length === 1 ? '' : 'S'}
        </span>
        {request && (
          <span
            className={`hud-mono rounded-sm border px-1.5 py-px text-[9px] tracking-[0.14em] ${
              running
                ? 'border-[#39D8FF]/40 bg-[#39D8FF]/10 text-[#39D8FF]'
                : done
                  ? 'border-[#31E8C0]/40 bg-[#31E8C0]/10 text-[#31E8C0]'
                  : failed
                    ? 'border-[#FF6488]/40 bg-[#FF6488]/10 text-[#FF6488]'
                    : cancelled
                      ? 'border-[#FFC56B]/40 bg-[#FFC56B]/10 text-[#FFC56B]'
                      : 'border-white/15 text-[#9AA7CB]'
            }`}
          >
            {request.status.toUpperCase()}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2" style={{ scrollbarWidth: 'thin' }}>
        {events.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11.5px] leading-relaxed text-[#68769A]">
            No execution yet.
            <br />
            Submit a command in the deck to run it in a real Chromium session.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {events.map((ev) => {
              const isRunning = ev.status === 'running';
              return (
                <li
                  key={ev.id}
                  className={`rounded-md border px-2 py-1.5 nova-transition ${
                    isRunning
                      ? 'border-[#39D8FF]/50 bg-[#39D8FF]/[0.07]'
                      : ev.status === 'failed'
                        ? 'border-[#FF6488]/30 bg-[#FF6488]/[0.05]'
                        : 'border-white/8 bg-white/[0.02]'
                  }`}
                  aria-current={isRunning ? 'step' : undefined}
                >
                  <div className="flex items-start gap-2">
                    <StatusIcon status={ev.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#F5F7FF]" title={ev.title}>
                          {ev.title}
                        </p>
                        <span className="hud-mono shrink-0 text-[8.5px] tracking-[0.1em] text-[#68769A]">
                          {stamp(ev.timestamp)}
                        </span>
                      </div>
                      {ev.description && (
                        <p className="mt-0.5 break-words text-[11px] leading-snug text-[#9AA7CB]">{ev.description}</p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-sm border px-1 py-px font-mono text-[8px] tracking-[0.12em] ${TYPE_TAG[ev.type] ?? TYPE_TAG.lifecycle}`}>
                          {ev.type.toUpperCase()}
                        </span>
                        {typeof ev.durationMs === 'number' && ev.durationMs > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] text-[#68769A]">
                            <Clock3 className="h-2.5 w-2.5" />
                            {ev.durationMs >= 1000 ? `${(ev.durationMs / 1000).toFixed(1)}s` : `${ev.durationMs}ms`}
                          </span>
                        )}
                        {ev.url && (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="hud-mono max-w-full truncate text-[9px] text-[#39D8FF]/80 underline-offset-2 hover:underline"
                            title={`Open ${ev.url} in a new tab`}
                          >
                            {ev.url}
                          </a>
                        )}
                      </div>
                      {ev.error && (
                        <p className="mt-1 break-words rounded-sm border border-[#FF6488]/30 bg-[#FF6488]/10 px-1.5 py-1 text-[10.5px] text-[#FF6488]">
                          {ev.error}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {request?.summary && !running && (
        <div
          className={`shrink-0 border-t px-3 py-1.5 text-[10.5px] ${
            done
              ? 'border-[#31E8C0]/25 bg-[#31E8C0]/[0.06] text-[#31E8C0]'
              : failed
                ? 'border-[#FF6488]/25 bg-[#FF6488]/[0.06] text-[#FF6488]'
                : 'border-[#FFC56B]/25 bg-[#FFC56B]/[0.06] text-[#FFC56B]'
          }`}
          role="status"
        >
          {request.summary}
        </div>
      )}
    </section>
  );
}
