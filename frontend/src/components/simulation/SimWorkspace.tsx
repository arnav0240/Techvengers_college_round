import { Monitor, Globe, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import type { SimBrowserInfo, SimPageSnapshot, SimRequest, SimConnection } from '../../features/simulation/types';

const STATUS_TONE: Record<string, string> = {
  ready: 'text-[#31E8C0] border-[#31E8C0]/40 bg-[#31E8C0]/10',
  starting: 'text-[#FFC56B] border-[#FFC56B]/40 bg-[#FFC56B]/10',
  idle: 'text-[#9AA7CB] border-white/15 bg-white/5',
  error: 'text-[#FF6488] border-[#FF6488]/40 bg-[#FF6488]/10',
  crashed: 'text-[#FF6488] border-[#FF6488]/40 bg-[#FF6488]/10',
};

/**
 * The large left-hand workspace: a live view of the *real* Chromium session
 * driven by Playwright (frames streamed from the actual page, plus the real
 * URL, title and tab strip). Nothing here is faked — if the browser is not
 * running, the panel says so.
 */
export default function SimWorkspace({
  page,
  browser,
  frame,
  request,
  connection,
  compact,
}: {
  page: SimPageSnapshot | null;
  browser: SimBrowserInfo;
  frame: string | null;
  request: SimRequest | null;
  connection: SimConnection;
  compact: boolean;
}) {
  const tabs = page?.tabs ?? [];
  const activeUrl = page?.page?.url ?? null;
  const activeTitle = page?.page?.title ?? null;
  const running = request?.status === 'running' || request?.status === 'accepted';
  const tone = STATUS_TONE[browser.state] ?? STATUS_TONE.idle;

  return (
    <section
      className="hud relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-[#39D8FF]/25 bg-[#070A17]/60"
      aria-label="Real browser workspace"
    >
      {/* Browser chrome: tabs + URL */}
      <div className="flex shrink-0 flex-col gap-1 border-b border-[#39D8FF]/15 bg-black/40 px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <Monitor className="h-3.5 w-3.5 shrink-0 text-[#39D8FF]" />
          <span className="hud-title shrink-0">BROWSER WORKSPACE //</span>
          <span className="hud-mono hidden truncate text-[9.5px] tracking-[0.16em] text-[#68769A] sm:inline">
            PLAYWRIGHT · {browser.headless ? 'HEADLESS' : 'WINDOWED'} · LOCALHOST
          </span>
          <span className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[9.5px] font-bold tracking-[0.16em] ${tone}`}>
            {browser.state === 'starting' ? <Loader2 className="h-3 w-3 animate-spin" /> : browser.state === 'error' || browser.state === 'crashed' ? <AlertTriangle className="h-3 w-3" /> : <span className="nova-live-dot h-1.5 w-1.5 rounded-full bg-current" />}
            {browser.state.toUpperCase()}
          </span>
        </div>

        {/* Tab strip (real tabs from the automation context) */}
        {tabs.length > 0 && (
          <div className="flex items-center gap-1 overflow-hidden" aria-label="Browser tabs">
            {tabs.map((t) => (
              <span
                key={t.index}
                title={t.url}
                className={`inline-flex min-w-0 max-w-[180px] items-center gap-1 truncate rounded-t-sm border px-2 py-0.5 text-[10px] ${
                  t.active
                    ? 'border-[#39D8FF]/40 bg-[#39D8FF]/10 text-[#F5F7FF]'
                    : 'border-white/10 bg-white/[0.03] text-[#68769A]'
                }`}
              >
                <Globe className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{t.title ?? shortUrl(t.url)}</span>
              </span>
            ))}
          </div>
        )}

        {/* URL bar */}
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/50 px-2 py-1">
          <Globe className="h-3 w-3 shrink-0 text-[#68769A]" />
          <span className="hud-mono min-w-0 flex-1 truncate text-[10.5px] text-[#9AA7CB]" title={activeUrl ?? undefined}>
            {activeUrl ?? (browser.state === 'ready' ? 'about:blank' : '— no page loaded —')}
          </span>
          {activeTitle && (
            <span className="hidden min-w-0 max-w-[40%] truncate text-[10px] text-[#68769A] md:inline" title={activeTitle}>
              {activeTitle}
            </span>
          )}
        </div>
      </div>

      {/* Live frame from the real page */}
      <div className="relative min-h-0 flex-1 bg-black">
        {frame ? (
          <img
            src={frame}
            alt="Live view of the automated browser page"
            className="h-full w-full object-contain"
            style={{ imageRendering: 'auto' }}
          />
        ) : (
          <OverlayMessage
            browser={browser}
            connection={connection}
            running={running}
            compact={compact}
          />
        )}

        {/* Running veil */}
        {running && frame && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-sm border border-[#39D8FF]/40 bg-[#03040B]/85 px-2 py-1">
            <Loader2 className="h-3 w-3 animate-spin text-[#39D8FF]" />
            <span className="hud-mono text-[9px] tracking-[0.18em] text-[#39D8FF]">EXECUTING</span>
          </div>
        )}
      </div>

      {/* Honest footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[#39D8FF]/15 bg-black/40 px-2.5 py-1">
        <span className="hud-mono truncate text-[9px] tracking-[0.12em] text-[#68769A]">
          LIVE FRAME FROM THE REAL PLAYWRIGHT-CONTROLLED CHROMIUM SESSION — NOT A MOCK-UP
        </span>
        {request?.summary && request.status !== 'running' && request.status !== 'accepted' && (
          <span
            className={`ml-auto hidden shrink-0 truncate text-[10px] lg:inline ${
              request.status === 'completed' ? 'text-[#31E8C0]' : request.status === 'failed' ? 'text-[#FF6488]' : 'text-[#FFC56B]'
            }`}
            title={request.summary}
          >
            {request.status.toUpperCase()}: {request.summary}
          </span>
        )}
      </div>
    </section>
  );
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

function OverlayMessage({
  browser,
  connection,
  running,
  compact,
}: {
  browser: SimBrowserInfo;
  connection: SimConnection;
  running: boolean;
  compact: boolean;
}) {
  let icon = <Monitor className={`mx-auto mb-2 h-8 w-8 text-[#39D8FF]/50 ${running ? 'animate-pulse' : ''}`} />;
  let title = 'No browser session yet';
  let body = 'Submit a command and NOVA launches a dedicated Chromium instance, then streams its real viewport here.';
  let tone = 'text-[#F5F7FF]';

  if (connection !== 'connected') {
    icon = <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-[#FFC56B]" />;
    title = 'Execution service offline';
    body = 'The local browser-execution service is not reachable. Start it with `npm run sim` (it binds to 127.0.0.1:8787).';
    tone = 'text-[#FFC56B]';
  } else if (browser.state === 'starting') {
    icon = <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-[#39D8FF]" />;
    title = 'Launching Chromium…';
    body = 'A dedicated browser profile is starting. The first frame appears as soon as the page paints.';
  } else if (browser.state === 'error' || browser.state === 'crashed') {
    icon = <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-[#FF6488]" />;
    title = browser.state === 'crashed' ? 'Browser crashed' : 'Browser failed to start';
    body = browser.error ?? 'The browser process ended unexpectedly.';
    tone = 'text-[#FF6488]';
  } else if (browser.state === 'ready' && running) {
    title = 'Waiting for the first frame';
    body = 'The browser is live; the viewport stream is warming up.';
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className={`max-w-sm text-center ${compact ? 'scale-90' : ''}`}>
        {icon}
        <p className={`text-sm font-bold ${tone}`}>{title}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[#9AA7CB]">{body}</p>
        {browser.description && (
          <p className="hud-mono mt-2 text-[9px] tracking-[0.12em] text-[#68769A]">{browser.description}</p>
        )}
      </div>
    </div>
  );
}

/** Small helper reused by the compact panel: an "open the native window" hint. */
export function NativeWindowNote({ headless }: { headless: boolean }) {
  return (
    <p className="flex items-start gap-1.5 text-[10px] leading-snug text-[#68769A]">
      {headless ? <Loader2 className="mt-px h-3 w-3 shrink-0" /> : <ExternalLink className="mt-px h-3 w-3 shrink-0" />}
      {headless
        ? 'Chromium runs headless; the frames above are its live viewport.'
        : 'A native Chromium window is also open on your desktop; the frames above mirror it live.'}
    </p>
  );
}
