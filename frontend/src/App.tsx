import { useCallback, useEffect, useRef, useState } from 'react';
import { AppStateProvider, useAppState } from './app/store';
import { audioBus } from './features/audio/audioBus';
import { microphoneAnalyser } from './features/audio/analyser';
import { useCamera } from './features/camera/useCamera';
import { useAgent } from './features/agent/agentAdapter';
import { useSpeechRecognition } from './features/speech/useSpeechRecognition';
import TopBar from './components/hud/TopBar';
import LeftRail from './components/hud/LeftRail';
import RightRail from './components/hud/RightRail';
import Reticle from './components/hud/Reticle';
import NovaOrbCanvas from './components/assistant/NovaOrb';
import CommandPanel from './components/command-input/CommandPanel';
import CompactPanel from './components/compact-assistant/CompactPanel';
import SimScreen from './components/simulation/SimScreen';
import { Minimize2 } from 'lucide-react';
import type { AppStatus } from './types';

const ORB_LABEL: Record<string, string> = {
  idle: 'Standby — calm orbital drift',
  listening: 'Listening — mic live, rings brightened',
  speech: 'Speaking — driven by your real voice',
  thinking: 'Thinking — processing pattern engaged',
  executing: 'Executing — stable core, restrained activity',
  error: 'Error — needs attention',
  completed: 'Completed',
};

function statusToOrb(app: AppStatus, audioHot: boolean): 'idle' | 'listening' | 'speech' | 'thinking' | 'executing' | 'error' | 'completed' {
  switch (app) {
    case 'listening':
    case 'transcribing':
    case 'ready_to_submit':
      return audioHot ? 'speech' : 'listening';
    case 'submitting':
    case 'connecting_to_agent':
    case 'thinking':
      return 'thinking';
    case 'executing':
    case 'speaking':
      return audioHot ? 'speech' : 'executing';
    case 'waiting_for_confirmation':
      return 'listening';
    case 'error':
      return 'error';
    case 'completed':
      return 'completed';
    default:
      return audioHot ? 'speech' : 'idle';
  }
}

function NovaApp() {
  const {
    appStatus, setAppStatus,
    orbState, setOrbState,
    micStatus, setMicStatus,
    micError, setMicError,
    micLevel, setMicLevel,
    mode, setMode,
    lastSubmitted, setLastSubmitted,
    view, setView,
  } = useAppState();

  const cam = useCamera();
  const agent = useAgent();
  const speech = useSpeechRecognition();
  const [inputValue, setInputValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [gridOn, setGridOn] = useState(true);
  const [railHidden, setRailHidden] = useState(false);
  const sessionStartRef = useRef(Date.now());
  const lastFinal = useRef('');
  const appStatusRef = useRef(appStatus);
  appStatusRef.current = appStatus;

  // Append recognised finals to the input for review before submit.
  useEffect(() => {
    if (speech.finalText && speech.finalText !== lastFinal.current) {
      lastFinal.current = speech.finalText;
      setInputValue((prev) => (prev ? prev + ' ' + speech.finalText.trim() : speech.finalText.trim()));
      setAppStatus('ready_to_submit');
    }
  }, [speech.finalText, setAppStatus]);

  // Mic level meter (~7Hz) + orb state derivation, no per-frame React renders.
  useEffect(() => {
    const id = window.setInterval(() => {
      setMicLevel(audioBus.smoothed);
      const hot = audioBus.active && audioBus.smoothed > 0.06;
      setOrbState((prev) => {
        const next = statusToOrb(appStatusRef.current, hot || (speech.listening && audioBus.smoothed > 0.04));
        return prev === next ? prev : next;
      });
    }, 180);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "/" focuses the command box from anywhere (unless already typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === '/' && el && el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') {
        e.preventDefault();
        document.getElementById('nova-command')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The SIMULATION tab owns its own full-screen surface (same shell, real browser execution).
  useEffect(() => {
    if (view === 'simulation') document.title = 'NOVA — Simulation';
    else document.title = 'NOVA — Hands-Free Browser Agent';
  }, [view]);

  const handleMicToggle = useCallback(async () => {
    if (micStatus === 'active' || microphoneAnalyser.isRunning) {
      microphoneAnalyser.stop();
      speech.stop();
      setMicStatus('off');
      setMicError(null);
      setAppStatus('idle');
      setOrbState('idle');
      return;
    }
    setMicStatus('requesting');
    setAppStatus('requesting_permission');
    setMicError(null);
    try {
      await microphoneAnalyser.start();
      setMicStatus('active');
      setAppStatus('listening');
      setOrbState('listening');
      if (speech.support !== 'unsupported') speech.start();
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Microphone failed.';
      setMicError(msg);
      setMicStatus(msg.includes('denied') ? 'denied' : 'error');
      setAppStatus('error');
      setOrbState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micStatus]);

  const handleSubmit = useCallback(
    async (text: string) => {
      setAppStatus('submitting');
      setOrbState('thinking');
      setNotice(null);
      const req = await agent.submit(text, 'command');
      if (req) {
        setLastSubmitted(text);
        setInputValue('');
        setAppStatus('executing');
        setOrbState('executing');
        setMode('compact');
      } else {
        setAppStatus('error');
        setOrbState('error');
      }
    },
    [agent, setAppStatus, setOrbState, setLastSubmitted, setMode],
  );

  const handleCancel = useCallback(async () => {
    await agent.cancel();
    if (agent.connection !== 'connected') {
      setNotice('No runtime agent is connected, so there is nothing to cancel. Your input and local session are preserved.');
    }
    setAppStatus('cancelled');
    setTimeout(() => setAppStatus('idle'), 1500);
  }, [agent, setAppStatus]);

  // The SIMULATION tab owns a separate surface; MAIN keeps the exact current UI.
  if (view === 'simulation') return <SimScreen />;

  if (mode === 'compact') {
    return (
      <div className="h-dvh w-screen overflow-hidden bg-[#03040B] text-[#F5F7FF]">
        <CompactPanel
          orbState={orbState}
          appStatus={appStatus}
          connection={agent.connection}
          micStatus={micStatus}
          events={agent.events}
          lastSubmitted={lastSubmitted}
          onExpand={() => setMode('expanded')}
          onCancel={handleCancel}
        />
        <main className="flex h-full items-center justify-center overflow-hidden p-4 pr-[324px]">
          <div className="hud-panel max-w-md rounded-lg px-6 py-5 text-center">
            <p className="hud-title">BROWSER WORKSPACE</p>
            <h2 className="mt-1.5 text-xl font-bold">NOVA is minimised — your workspace stays clear</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[#9AA7CB]">
              The compact panel floats at the right while the real browser occupies this area. No browser actions are
              simulated here — activity appears in the panel only when the runtime agent reports it.
            </p>
            <p className="mt-2 text-[11px] text-[#68769A]">Mic {micStatus} · core {orbState} · {agent.events.length} event(s)</p>
            <button
              onClick={() => setMode('expanded')}
              className="nova-transition mt-4 inline-flex items-center gap-2 rounded-md bg-[#315BFF] px-4 py-2 text-sm font-semibold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
            >
              <Minimize2 className="h-4 w-4 rotate-180" /> Back to full console
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[#03040B] text-[#F5F7FF]">
      {/* ambient background */}
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute left-1/3 top-[4%] h-[46dvh] w-[60vw] rounded-full bg-[#315BFF]/[0.07] blur-[110px]" />
        <div className="absolute bottom-0 left-1/2 h-[24dvh] w-[50vw] -translate-x-1/2 rounded-full bg-[#7C3CFF]/[0.05] blur-[90px]" />
        {gridOn && (
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: 'linear-gradient(rgba(120,150,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(120,150,255,0.5) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
              maskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 30%, transparent 78%)',
              WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 30%, transparent 78%)',
            }}
          />
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <TopBar
          connection={agent.connection}
          mode={mode}
          onToggleMode={() => setMode('compact')}
          sessionStart={sessionStartRef.current}
          gridOn={gridOn}
          onToggleGrid={() => setGridOn((v) => !v)}
          railHidden={railHidden}
          onToggleRail={() => setRailHidden((v) => !v)}
          view={view}
          onViewChange={setView}
        />

        {notice && (
          <div className="pointer-events-none absolute left-1/2 top-14 z-30 -translate-x-1/2" role="status">
            <p className="hud-panel pointer-events-auto max-w-[90vw] truncate rounded-sm px-4 py-1.5 text-xs text-[#FFC56B]" title={notice}>
              {notice}
            </p>
          </div>
        )}

        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 px-3 pb-3 pt-2 lg:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[auto_minmax(0,1fr)_auto]">
          {railHidden ? <div /> : (
            <LeftRail
              connection={agent.connection}
              micStatus={micStatus}
              speechSupported={speech.support}
              trackingAvailable={cam.tracking.available}
            />
          )}

          {/* Center: computational orb + reticle + command deck */}
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <section className="hud relative min-h-[180px] min-w-0 flex-1 overflow-hidden rounded-lg border border-[#39D8FF]/25 bg-[#070A17]/60" aria-label="NOVA computational core">
              <div className="nova-scan" aria-hidden />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-[55%] w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#315BFF]/10 blur-[80px]" aria-hidden />
              <Reticle />

              <div className="pointer-events-none absolute left-3 top-2.5 z-10 max-w-[72%]">
                <p className="hud-title text-[#9AA7CB]">VOICE INTERFACE / NOVA CORE</p>
                <p className="truncate text-[13px] font-semibold text-[#F5F7FF]" role="status" title={`${ORB_LABEL[orbState]} · mic ${micStatus}`}>
                  {ORB_LABEL[orbState]} · mic {micStatus}
                </p>
                <p className="hud-mono mt-0.5 text-[10px] tracking-widest text-[#39D8FF]/80" aria-hidden>
                  CORE.{orbState.toUpperCase()} · MIC.{micStatus.toUpperCase()} · LVL.{String(Math.round(Math.min(1, micLevel) * 100)).padStart(3, '0')}
                </p>
              </div>
              <div className="pointer-events-none absolute right-3 top-2.5 z-10 hidden items-center gap-2 sm:flex" aria-hidden>
                <span className="rounded-sm border border-[#39D8FF]/30 bg-[#39D8FF]/[0.07] px-1.5 py-px font-mono text-[9px] tracking-widest text-[#39D8FF]">SYS.ONLINE</span>
                <span className="rounded-sm border border-[#7C3CFF]/30 bg-[#7C3CFF]/[0.07] px-1.5 py-px font-mono text-[9px] tracking-widest text-[#A855F7]">ORB.V2</span>
              </div>

              <NovaOrbCanvas visualState={orbState} />

              {/* Command deck overlays the bottom of the stage */}
              <div className="absolute inset-x-2 bottom-2 z-10 sm:inset-x-4 sm:bottom-3">
                <CommandPanel
                  appStatus={appStatus}
                  setAppStatus={setAppStatus}
                  micStatus={micStatus}
                  micError={micError}
                  micLevel={micLevel}
                  speechListening={speech.listening}
                  speechInterim={speech.interim}
                  speechSupported={speech.support !== 'unsupported'}
                  speechError={speech.error}
                  onMicToggle={handleMicToggle}
                  onStopSpeech={speech.stop}
                  onSubmit={handleSubmit}
                  submitting={agent.submitting}
                  submitError={agent.submitError}
                  inputValue={inputValue}
                  setInputValue={setInputValue}
                />
              </div>
            </section>
          </div>

          <RightRail
            cam={cam}
            orbState={orbState}
            appStatus={appStatus}
            micStatus={micStatus}
            connection={agent.connection}
            events={agent.events}
          />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <NovaApp />
    </AppStateProvider>
  );
}
