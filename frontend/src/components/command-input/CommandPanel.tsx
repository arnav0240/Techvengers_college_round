import { useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Loader2, Mic, MicOff, Play, Plus, Search, Square, Video } from 'lucide-react';
import type { AppStatus, MicStatus } from '../../types';

const QUICK_TEMPLATES = [
  { label: 'Open YouTube', icon: Video, text: 'Open YouTube' },
  { label: 'Search this page', icon: Search, text: 'Search this page for ' },
  { label: 'Scroll down', icon: ArrowDown, text: 'Scroll down the page' },
  { label: 'Go back', icon: ArrowLeft, text: 'Go back to the previous page' },
  { label: 'New tab', icon: Plus, text: 'Open a new tab and go to ' },
];

/** Templates that the local simulation executor genuinely supports end-to-end. */
const SIM_TEMPLATES = [
  { label: 'Open YouTube', icon: Video, text: 'Open YouTube' },
  { label: 'Search YouTube', icon: Search, text: 'Search YouTube for ' },
  { label: 'Latest video', icon: Play, text: 'Search YouTube for Technical Guruji, find the latest video, and open it' },
  { label: 'Scroll down', icon: ArrowDown, text: 'Scroll down' },
  { label: 'New tab', icon: Plus, text: 'Open a new tab' },
];

export default function CommandPanel({
  appStatus,
  setAppStatus,
  micStatus,
  micError,
  micLevel,
  speechListening,
  speechInterim,
  speechSupported,
  speechError,
  onMicToggle,
  onStopSpeech,
  onSubmit,
  submitting,
  submitError,
  inputValue,
  setInputValue,
  mode = 'main',
}: {
  appStatus: AppStatus;
  setAppStatus: (s: AppStatus) => void;
  micStatus: MicStatus;
  micError: string | null;
  micLevel: number;
  speechListening: boolean;
  speechInterim: string;
  speechSupported: boolean;
  speechError: string | null;
  onMicToggle: () => void;
  onStopSpeech: () => void;
  onSubmit: (text: string) => void;
  submitting: boolean;
  submitError: string | null;
  inputValue: string;
  setInputValue: (v: string) => void;
  /** `simulation` swaps the templates + hint for commands the local executor truly supports. */
  mode?: 'main' | 'simulation';
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const shownInterim = speechListening && speechInterim ? speechInterim : '';
  const micActive = micStatus === 'active';
  const firstError = localError ?? submitError ?? micError ?? speechError;
  const templates = mode === 'simulation' ? SIM_TEMPLATES : QUICK_TEMPLATES;

  const doSubmit = () => {
    const text = inputValue.trim();
    if (!text || submitting) {
      if (!text) setLocalError('Type or dictate a request before submitting.');
      return;
    }
    setLocalError(null);
    onSubmit(text);
  };

  const insert = (text: string) => {
    setInputValue(text);
    setLocalError(null);
    setAppStatus('ready_to_submit');
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(text.length, text.length);
    });
  };

  const statusText =
    appStatus === 'listening' ? 'LISTENING…'
    : appStatus === 'transcribing' ? 'TRANSCRIBING…'
    : appStatus === 'submitting' || appStatus === 'connecting_to_agent' ? 'SUBMITTING…'
    : appStatus === 'thinking' || appStatus === 'executing' ? 'WORKING…'
    : appStatus === 'error' ? 'ERROR'
    : appStatus === 'completed' ? 'COMPLETED'
    : appStatus === 'cancelled' ? 'CANCELLED'
    : micActive ? 'MIC LIVE' : 'READY';

  return (
    <section className="deck-glow rounded-xl border border-[#39D8FF]/40 bg-[#070A17]/90 backdrop-blur-md" aria-label="Command deck">
      <div className="flex items-center justify-between border-b border-[#39D8FF]/15 px-3 py-1.5">
        <span className="hud-title">01 COMMAND DECK //</span>
        <div className="flex items-center gap-3">
          <span className="hud-mono text-[9.5px] tracking-[0.18em] text-[#68769A]">{statusText}</span>
          <span className="hud-mono hidden text-[9.5px] tracking-[0.18em] text-[#A855F7] sm:inline">
            {speechSupported ? 'NATURAL LANGUAGE' : 'TYPING MODE'}
          </span>
        </div>
      </div>

      <div className="flex items-stretch gap-2 px-3 py-2.5">
        <label htmlFor="nova-command" className="sr-only">Speak or type a browser command</label>
        <textarea
          id="nova-command"
          ref={taRef}
          rows={2}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setLocalError(null);
            if (e.target.value.trim()) setAppStatus('ready_to_submit');
            else if (!speechListening) setAppStatus(micActive ? 'listening' : 'idle');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              doSubmit();
            }
          }}
          placeholder="Speak or type a browser command..."
          className="nova-input min-h-0 min-w-0 flex-1 resize-none rounded-lg border border-[#39D8FF]/25 bg-black/50 px-3 py-2 text-sm leading-snug text-[#F5F7FF] placeholder:text-[#68769A] focus:border-[#39D8FF]/70"
        />

        <div className="flex shrink-0 flex-col justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onMicToggle}
              aria-pressed={micActive}
              aria-label={micActive ? 'Turn microphone off' : 'Turn microphone on'}
              title={micActive ? 'Microphone live — click to stop' : 'Enable microphone + dictation'}
              className={`nova-transition relative flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-[#39D8FF] ${
                micActive
                  ? 'bg-gradient-to-br from-[#315BFF] to-[#7C3CFF] text-white shadow-[0_0_18px_rgba(49,91,255,0.6)]'
                  : 'border border-[#39D8FF]/40 bg-white/5 text-[#9AA7CB] hover:text-white'
              }`}
            >
              {micStatus === 'requesting' ? <Loader2 className="h-4 w-4 animate-spin" /> : micActive ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              {micActive && (
                <span
                  className="absolute -bottom-1 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-[#39D8FF]"
                  style={{ transform: `translateX(-50%) scaleX(${0.2 + Math.min(1, micLevel) * 0.8})` }}
                  aria-hidden
                />
              )}
            </button>
            <span className={`hud-mono hidden text-[10px] tracking-[0.16em] sm:inline ${micActive ? 'text-[#31E8C0]' : 'text-[#68769A]'}`}>
              {micActive ? 'VOICE' : 'MIC OFF'}
            </span>
            {speechListening && (
              <button onClick={onStopSpeech} className="hud-mono inline-flex items-center gap-1 text-[10px] text-[#39D8FF] hover:underline" aria-label="Stop dictation">
                <Square className="h-2.5 w-2.5" /> STOP
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="hud-mono hidden text-[9px] tracking-[0.14em] text-[#68769A] md:inline">ENTER TO SEND</span>
            <button
              onClick={doSubmit}
              disabled={submitting || !inputValue.trim()}
              className="nova-transition inline-flex h-8 items-center gap-1.5 rounded-md border border-[#A855F7]/60 bg-[#7C3CFF]/25 px-3 text-xs font-bold tracking-wider text-white shadow-[0_0_18px_-6px_rgba(124,60,255,0.9)] hover:bg-[#7C3CFF]/45 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              RUN
            </button>
          </div>
        </div>
      </div>

      {shownInterim && (
        <p className="px-3 pb-1 text-[11px] text-[#39D8FF]" aria-live="polite">Hearing: “{shownInterim}…”</p>
      )}

      <div className="flex items-center gap-1.5 overflow-hidden border-t border-[#39D8FF]/15 px-3 py-1.5" aria-label="Command templates">
        {templates.map(({ label, icon: Icon, text }) => (
          <button
            key={label}
            onClick={() => insert(text)}
            title={`Insert "${text}" into the command deck (does not execute)`}
            className="nova-chip inline-flex min-w-0 flex-1 items-center justify-center gap-1 truncate rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-1 text-[10.5px] text-[#9AA7CB]"
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex min-h-[16px] items-center gap-2 px-3 pb-1" aria-live="polite">
        {firstError ? (
          <p className="truncate text-[11px] text-[#FF6488]" role="alert" title={firstError}>{firstError}</p>
        ) : (
          <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-[10px] text-[#68769A]">
            <kbd className="nova-kbd">Enter</kbd> send · <kbd className="nova-kbd">Shift+Enter</kbd> newline · <kbd className="nova-kbd">/</kbd> focus ·{' '}
            {mode === 'simulation'
              ? 'RUN executes the command in a real automated Chromium session and streams the live activity.'
              : 'templates insert text only — nothing executes until the agent accepts RUN.'}
          </p>
        )}
      </div>
    </section>
  );
}
