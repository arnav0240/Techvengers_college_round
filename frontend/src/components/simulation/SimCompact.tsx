import { Ban, ChevronLeft, Expand, Loader2, WifiOff, CheckCircle2, XCircle, Slash } from 'lucide-react';
import NovaOrbCanvas from '../assistant/NovaOrb';
import type { OrbVisualState } from '../../types';
import type { SimBrowserInfo, SimConnection, SimEvent, SimRequest, SimResult } from '../../features/simulation/types';

const TONE: Record<string, string> = {
  running: 'text-[#39D8FF]',
  completed: 'text-[#31E8C0]',
  failed: 'text-[#FF6488]',
  cancelled: 'text-[#FFC56B]',
};

function ResultBadge({ status }: { status?: string }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-[#31E8C0]" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-[#FF6488]" />;
  if (status === 'cancelled') return <Slash className="h-3.5 w-3.5 text-[#FFC56B]" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-[#39D8FF]" />;
}

/**
 * Narrow right-hand panel shown while the real browser executes. It reuses the
 * NOVA identity, the (smaller) Three.js orb, the request summary, the current
 * operation, recent activity, and a stop control — and it always reflects the
 * true terminal state (completed / failed / cancelled), never a stuck spinner.
 */
export default function SimCompact({
  orbState,
  request,
  result,
  events,
  connection,
  browser,
  onExpand,
  onCancel,
  onBack,
  executing,
}: {
  orbState: OrbVisualState;
  request: SimRequest | null;
  result: SimResult | null;
  events: SimEvent[];
  connection: SimConnection;
  browser: SimBrowserInfo;
  onExpand: () => void;
  onCancel: () => void;
  onBack: () => void;
  executing: boolean;
}) {
  const running = events.filter((e) => e.status === 'running');
  const current = running[running.length - 1] ?? events[events.length - 1] ?? null;
  const recent = [...events].slice(-6).reverse();
  const status = request?.status ?? 'idle';

  return (
    <aside
      className="nova-panel flex h-full w-[300px] shrink-0 flex-col overflow-hidden rounded-xl"
      aria-label="NOVA compact assistant"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#315BFF] to-[#7C3CFF] text-[11px] font-extrabold">N</span>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold tracking-[0.18em]">NOVA</p>
            <p className={`flex items-center gap-1 text-[10px] ${connection === 'connected' ? 'text-[#31E8C0]' : 'text-[#FFC56B]'}`}>
              {connection !== 'connected' ? <WifiOff className="h-2.5 w-2.5" /> : <span className="nova-live-dot h-1.5 w-1.5 rounded-full bg-[#31E8C0]" />}
              {connection === 'connected' ? 'Execution service linked' : connection === 'connecting' ? 'Connecting…' : 'Service offline'}
            </p>
          </div>
        </div>
        <button
          onClick={onExpand}
          className="nova-transition inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[#9AA7CB] hover:text-white focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
          aria-label="Expand the assistant"
        >
          <Expand className="h-3 w-3" /> Expand
        </button>
      </div>

      {/* Orb */}
      <div className="relative h-[150px] shrink-0">
        <NovaOrbCanvas visualState={orbState} />
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-3">
        {/* Request + status */}
        <div className="shrink-0 rounded-xl border border-white/5 bg-black/30 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold tracking-[0.2em] text-[#68769A]">CURRENT REQUEST</p>
            <span className={`hud-mono text-[9px] tracking-[0.16em] ${TONE[status] ?? 'text-[#9AA7CB]'}`}>{status.toUpperCase()}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-[#F5F7FF]" title={request?.command}>
            {request?.command ?? 'No request submitted yet.'}
          </p>
          {browser.description && (
            <p className="hud-mono mt-1 truncate text-[8.5px] tracking-[0.1em] text-[#68769A]" title={browser.description}>
              {browser.description}
            </p>
          )}
        </div>

        {/* Current operation */}
        <div className="shrink-0 rounded-xl border border-white/5 bg-black/30 p-2">
          <div className="flex items-center gap-1.5">
            <ResultBadge status={executing ? undefined : status} />
            <p className="text-[9px] font-bold tracking-[0.2em] text-[#68769A]">CURRENT OPERATION</p>
          </div>
          {current ? (
            <div className="mt-1 min-h-0">
              <p className="truncate text-xs font-semibold text-[#F5F7FF]" title={current.title}>{current.title}</p>
              <p className="line-clamp-2 text-[11px] leading-snug text-[#9AA7CB]">{current.description || current.type}</p>
              {current.url && (
                <p className="hud-mono mt-0.5 truncate text-[9px] text-[#39D8FF]/80" title={current.url}>{current.url}</p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-[11px] leading-snug text-[#68769A]">
              {connection === 'connected' ? 'Waiting for a request…' : 'Start the execution service to run browser commands.'}
            </p>
          )}
        </div>

        {/* Result summary (only once the request is terminal) */}
        {result && !executing && (
          <div
            className={`shrink-0 rounded-xl border p-2 text-[11px] leading-snug ${
              result.status === 'completed'
                ? 'border-[#31E8C0]/25 bg-[#31E8C0]/[0.06] text-[#31E8C0]'
                : result.status === 'failed'
                  ? 'border-[#FF6488]/25 bg-[#FF6488]/[0.06] text-[#FF6488]'
                  : 'border-[#FFC56B]/25 bg-[#FFC56B]/[0.06] text-[#FFC56B]'
            }`}
            role="status"
          >
            <span className="font-bold">{result.status.toUpperCase()}: </span>
            {result.summary}
          </div>
        )}

        {/* Recent activity */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/5 bg-black/30 p-2">
          <p className="text-[9px] font-bold tracking-[0.2em] text-[#68769A]">RECENT ACTIVITY</p>
          <ul className="mt-1 flex min-h-0 flex-col gap-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {recent.length === 0 ? (
              <li className="text-[11px] leading-snug text-[#68769A]">Activity appears here as the browser executes.</li>
            ) : (
              recent.map((ev) => (
                <li key={ev.id} className="flex min-w-0 items-start gap-1.5">
                  <span
                    className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                      ev.status === 'completed'
                        ? 'bg-[#31E8C0]'
                        : ev.status === 'failed'
                          ? 'bg-[#FF6488]'
                          : ev.status === 'cancelled'
                            ? 'bg-[#FFC56B]'
                            : 'bg-[#39D8FF] animate-pulse'
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-[#F5F7FF]" title={ev.title}>{ev.title}</span>
                    {ev.error && <span className="block truncate text-[10px] text-[#FF6488]" title={ev.error}>{ev.error}</span>}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onCancel}
            disabled={!executing}
            className="nova-transition inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#FF6488]/30 bg-[#FF6488]/10 px-3 py-1.5 text-[11px] font-semibold text-[#FF6488] hover:bg-[#FF6488]/20 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-[#FF6488]"
            title={executing ? 'Cancel the running request' : 'Nothing is running'}
          >
            <Ban className="h-3 w-3" /> Stop
          </button>
          <button
            onClick={onBack}
            className="nova-transition inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-[#9AA7CB] hover:text-white focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
            aria-label="Back to the full console"
          >
            <ChevronLeft className="h-3 w-3" /> Console
          </button>
        </div>
      </div>
    </aside>
  );
}
