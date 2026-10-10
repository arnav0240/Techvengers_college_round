import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ChevronLeft, Minimize2 } from 'lucide-react';
import { useAppState } from '../../app/store';
import { audioBus } from '../../features/audio/audioBus';
import { microphoneAnalyser } from '../../features/audio/analyser';
import { useSpeechRecognition } from '../../features/speech/useSpeechRecognition';
import { useSimulation } from '../../features/simulation/useSimulation';
import TopBar from '../hud/TopBar';
import LeftRail from '../hud/LeftRail';
import Reticle from '../hud/Reticle';
import NovaOrbCanvas from '../assistant/NovaOrb';
import CommandPanel from '../command-input/CommandPanel';
import SimWorkspace from './SimWorkspace';
import SimActivity from './SimActivity';
import SimCompact from './SimCompact';
import { useCamera } from '../../features/camera/useCamera';
import type { AppStatus, OrbVisualState } from '../../types';

const ORB_LABEL: Record<string, string> = {
  idle: 'Standby — awaiting a simulation command',
  listening: 'Listening — mic live',
  speech: 'Speaking — driven by your real voice',
  thinking: 'Submitting — handoff to the execution service',
  executing: 'Executing — real browser under automation',
  error: 'Execution reported a failure',
  completed: 'Task completed and verified',
};

/** Drive the orb from the live simulation status (real, not decorative). */
function statusToOrb(app: AppStatus, reqStatus: string | undefined, audioHot: boolean): OrbVisualState {
  if (app === 'error') return 'error';
  if (app === 'submitting' || app === 'connecting_to_agent' || app === 'thinking') return 'thinking';
  if (reqStatus === 'running' || reqStatus === 'accepted') return audioHot ? 'speech' : 'executing';
  if (reqStatus === 'completed') return 'completed';
  if (reqStatus === 'failed') return 'error';
  if (app === 'listening' || app === 'transcribing' || app === 'ready_to_submit') return audioHot ? 'speech' : 'listening';
  return audioHot ? 'speech' : 'idle';
}

export default function SimScreen() {
  const {
    appStatus, setAppStatus,
    orbState, setOrbState,
    micStatus, setMicStatus,
    micError, setMicError,
    micLevel, setMicLevel,
    setLastSubmitted,
    view, setView,
  } = useAppState();

  const cam = useCamera();
  const speech = useSpeechRecognition();
  const sim = useSimulation();

  const [inputValue, setInputValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [gridOn, setGridOn] = useState(true);
  const [railHidden, setRailHidden] = useState(false);
  /** console = idle expanded view; workspace = browser beside the assistant */
  const [layout, setLayout] = useState<'console' | 'workspace'>('console');
  const [compact, setCompact] = useState(true);
  const sessionStartRef = useRef(Date.now());
  const lastFinal = useRef('');
  const appStatusRef = useRef(appStatus);
  appStatusRef.current = appStatus;

  const { request, executing, events, result } = sim;

  // Dictated finals append to the input.
  useEffect(() => {
    if (speech.finalText && speech.finalText !== lastFinal.current) {
      lastFinal.current = speech.finalText;
      setInputValue((prev) => (prev ? prev + ' ' + speech.finalText.trim() : speech.finalText.trim()));
      setAppStatus('ready_to_submit');
    }
  }, [speech.finalText, setAppStatus]);

  // Mic level + orb derivation.
  const reqStatus = request?.status;
  const reqStatusRef = useRef(reqStatus);
  reqStatusRef.current = reqStatus;
  useEffect(() => {
    const id = window.setInterval(() => {
      setMicLevel(audioBus.smoothed);
      const hot = audioBus.active && audioBus.smoothed > 0.06;
      setOrbState((prev) => {
        const next = statusToOrb(appStatusRef.current, reqStatusRef.current, hot || (speech.listening && audioBus.smoothed > 0.04));
        return prev === next ? prev : next;
      });
    }, 180);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect the terminal request status back into appStatus.
  useEffect(() => {
    if (!reqStatus) return;
    if (reqStatus === 'running' || reqStatus === 'accepted') setAppStatus('executing');
    else if (reqStatus === 'completed') setAppStatus('completed');
    else if (reqStatus === 'failed') setAppStatus('error');
    else if (reqStatus === 'cancelled') setAppStatus('cancelled');
  }, [reqStatus, setAppStatus]);

  // "/" focuses the command box.
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

  const handleMicToggle = useCallback(async () => {
    if (micStatus === 'active' || microphoneAnalyser.isRunning) {
      microphoneAnalyser.stop();
      speech.stop();
      setMicStatus('off');
      setMicError(null);
      setAppStatus('idle');
      return;
    }
    setMicStatus('requesting');
    setAppStatus('requesting_permission');
    setMicError(null);
    try {
      await microphoneAnalyser.start();
      setMicStatus('active');
      setAppStatus('listening');
      if (speech.support !== 'unsupported') speech.start();
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Microphone failed.';
      setMicError(msg);
      setMicStatus(msg.includes('denied') ? 'denied' : 'error');
      setAppStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micStatus]);

  const handleSubmit = useCallback(
    async (text: string) => {
      setNotice(null);
      setAppStatus('submitting');
      setOrbState('thinking');
      try {
        await sim.submit(text);
        setLastSubmitted(text);
        setInputValue('');
        setLayout('workspace');
        setCompact(true);
      } catch (err) {
        const msg = (err as Error)?.message ?? 'Submission failed.';
        setNotice(msg);
        setAppStatus('error');
        setOrbState('error');
      }
    },
    [sim, setAppStatus, setOrbState, setLastSubmitted],
  );

  const handleCancel = useCallback(() => {
    const ok = sim.cancel();
    if (!ok) setNotice('Nothing to cancel — the execution service is not connected.');
  }, [sim]);

  const backToConsole = useCallback(() => {
    setLayout('console');
  }, []);

  // Smooth layout switch; the browser keeps executing regardless of layout.
  const mainClass = useMemo(
    () => 'nova-transition relative flex min-h-0 flex-1 gap-2 px-3 pb-3 pt-2',
    [],
  );

  const showWorkspace = layout === 'workspace';

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[#03040B] text-[#F5F7FF]">
      {/* ambient background (same as main) */}
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute left-1/3 top-[4%] h-[46dvh] w-[60vw] rounded-full bg-[#315BFF]/[0.07] blur-[110px]" />
        <div className="absolute bottom-0 left-1/2 h-[24dvh] w-[50vw] -translate-x-1/2 rounded-full bg-[#7C3CFF]/[0.05] blur-[90px]" />
        {gridOn && (
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(120,150,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(120,150,255,0.5) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
              maskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 30%, transparent 78%)',
              WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 30%, transparent 78%)',
            }}
          />
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <TopBar
          connection={sim.connection === 'connected' ? 'connected' : sim.connection === 'connecting' ? 'connecting' : 'disconnected'}
          mode={compact ? 'compact' : 'expanded'}
          onToggleMode={() => setCompact((v) => !v)}
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

        <main className={mainClass} data-layout={layout} data-compact={compact}>
          {!showWorkspace && (
            /* ---------------- CONSOLE (idle / expanded) ---------------- */
            <>
              {!railHidden && (
                <LeftRail
                  connection={sim.connection === 'connected' ? 'connected' : 'disconnected'}
                  micStatus={micStatus}
                  speechSupported={speech.support}
                  trackingAvailable={cam.tracking.available}
                />
              )}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                <section className="hud relative min-h-[180px] min-w-0 flex-1 overflow-hidden rounded-lg border border-[#39D8FF]/25 bg-[#070A17]/60" aria-label="NOVA computational core">
                  <div className="nova-scan" aria-hidden />
                  <div className="pointer-events-none absolute left-1/2 top-1/2 h-[55%] w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#315BFF]/10 blur-[80px]" aria-hidden />
                  <Reticle />
                  <div className="pointer-events-none absolute left-3 top-2.5 z-10 max-w-[72%]">
                    <p className="hud-title text-[#9AA7CB]">SIMULATION / NOVA CORE</p>
                    <p className="truncate text-[13px] font-semibold text-[#F5F7FF]" role="status" title={ORB_LABEL[orbState]}>
                      {ORB_LABEL[orbState]}
                    </p>
                    <p className="hud-mono mt-0.5 text-[10px] tracking-widest text-[#39D8FF]/80" aria-hidden>
                      MODE.SIM · SVC.{sim.connection.toUpperCase()} · BROWSER.{sim.browser.state.toUpperCase()} · EV.{String(events.length).padStart(3, '0')}
                    </p>
                  </div>
                  <div className="pointer-events-none absolute right-3 top-2.5 z-10 hidden items-center gap-2 sm:flex" aria-hidden>
                    <span className={`rounded-sm border px-1.5 py-px font-mono text-[9px] tracking-widest ${sim.connection === 'connected' ? 'border-[#31E8C0]/30 bg-[#31E8C0]/[0.07] text-[#31E8C0]' : 'border-[#FFC56B]/30 bg-[#FFC56B]/[0.07] text-[#FFC56B]'}`}>
                      {sim.connection === 'connected' ? 'SIM.LINKED' : 'SIM.OFFLINE'}
                    </span>
                    <span className="rounded-sm border border-[#7C3CFF]/30 bg-[#7C3CFF]/[0.07] px-1.5 py-px font-mono text-[9px] tracking-widest text-[#A855F7]">ORB.V2</span>
                  </div>

                  <NovaOrbCanvas visualState={orbState} />

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
                      submitting={sim.connection === 'connecting'}
                      submitError={sim.lastError}
                      inputValue={inputValue}
                      setInputValue={setInputValue}
                      mode="simulation"
                    />
                  </div>
                </section>
              </div>

              <div className="hidden min-h-0 w-[320px] shrink-0 flex-col xl:flex">
                <SimActivity events={events} request={request} dense />
              </div>
            </>
          )}

          {showWorkspace && (
            /* ---------------- WORKSPACE (browser + compact assistant) ---------------- */
            <>
              <div className={`nova-transition flex min-h-0 flex-1 flex-col ${compact ? '' : 'max-w-none'}`}>
                <SimWorkspace
                  page={sim.page}
                  browser={sim.browser}
                  frame={sim.frame}
                  request={request}
                  connection={sim.connection}
                  compact={compact}
                />
              </div>

              {compact ? (
                <SimCompact
                  orbState={orbState}
                  request={request}
                  result={result}
                  events={events}
                  connection={sim.connection}
                  browser={sim.browser}
                  onExpand={() => setCompact(false)}
                  onCancel={handleCancel}
                  onBack={backToConsole}
                  executing={executing}
                />
              ) : (
                /* Expanded assistant beside the still-visible browser */
                <aside className="flex w-[360px] shrink-0 flex-col gap-2" aria-label="NOVA assistant (expanded)">
                  <section className="hud relative h-[190px] shrink-0 overflow-hidden rounded-lg border border-[#39D8FF]/25 bg-[#070A17]/60">
                    <Reticle />
                    <div className="pointer-events-none absolute left-2.5 top-2 z-10">
                      <p className="hud-title text-[#9AA7CB]">NOVA / SIMULATION</p>
                      <p className="truncate text-[11px] font-semibold text-[#F5F7FF]" role="status" title={ORB_LABEL[orbState]}>
                        {ORB_LABEL[orbState]}
                      </p>
                    </div>
                    <NovaOrbCanvas visualState={orbState} />
                    <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-1.5">
                      <button
                        onClick={() => setCompact(true)}
                        className="nova-transition inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[#9AA7CB] hover:text-white focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
                      >
                        <Minimize2 className="h-3 w-3" /> Compact
                      </button>
                      <button
                        onClick={backToConsole}
                        className="nova-transition inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[#9AA7CB] hover:text-white focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
                      >
                        <ChevronLeft className="h-3 w-3" /> Console
                      </button>
                      {executing && (
                        <button
                          onClick={handleCancel}
                          className="nova-transition ml-auto inline-flex items-center gap-1 rounded-md border border-[#FF6488]/30 bg-[#FF6488]/10 px-2 py-1 text-[11px] text-[#FF6488] hover:bg-[#FF6488]/20"
                        >
                          <Ban className="h-3 w-3" /> Stop
                        </button>
                      )}
                    </div>
                  </section>
                  <div className="min-h-0 flex-1">
                    <SimActivity events={events} request={request} dense />
                  </div>
                </aside>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
