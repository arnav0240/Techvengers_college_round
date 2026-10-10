import { Activity, AudioWaveform, CheckCircle2, CircleDashed, Cpu, Eye, Loader2, Mic, Monitor, PauseCircle, XCircle } from 'lucide-react';
import type { AgentEvent, AppStatus, CameraStatus, ConnectionStatus, MicStatus, OrbVisualState, TrackingState } from '../../types';
import WebcamCard from '../webcam/WebcamCard';
import Waveform from './Waveform';

const STATUS_COPY: Record<OrbVisualState, { word: string; sub: string; cls: string }> = {
  idle: { word: 'STANDBY', sub: 'Ready for input', cls: 'text-[#F5F7FF]' },
  listening: { word: 'LISTENING', sub: 'Microphone active', cls: 'text-[#39D8FF]' },
  speech: { word: 'SPEAKING', sub: 'Analyzing voice signal', cls: 'text-[#39D8FF]' },
  thinking: { word: 'PROCESSING', sub: 'Working on your request', cls: 'text-[#A855F7]' },
  executing: { word: 'EXECUTING', sub: 'Agent running task', cls: 'text-[#A855F7]' },
  error: { word: 'FAULT', sub: 'Attention required', cls: 'text-[#FF6488]' },
  completed: { word: 'COMPLETE', sub: 'Task finished', cls: 'text-[#31E8C0]' },
};

function eventIcon(ev: AgentEvent) {
  switch (ev.status) {
    case 'running': return <Loader2 className="h-3 w-3 animate-spin" />;
    case 'completed': return <CheckCircle2 className="h-3 w-3" />;
    case 'failed': return <XCircle className="h-3 w-3" />;
    case 'waiting_for_confirmation': return <PauseCircle className="h-3 w-3" />;
    case 'cancelled': return <XCircle className="h-3 w-3" />;
    default: return <CircleDashed className="h-3 w-3" />;
  }
}
const TONE: Record<AgentEvent['status'], string> = {
  pending: 'text-[#68769A]',
  running: 'text-[#39D8FF]',
  completed: 'text-[#31E8C0]',
  failed: 'text-[#FF6488]',
  cancelled: 'text-[#9AA7CB]',
  waiting_for_confirmation: 'text-[#FFC56B]',
};

/** Static-but-honest service rows + real agent events (most recent first). */
function serviceRows(
  connection: ConnectionStatus,
  micStatus: MicStatus,
  tracking: TrackingState,
  appStatus: AppStatus,
) {
  return [
    { Icon: Cpu, label: 'System ready', tone: 'text-[#31E8C0]' },
    { Icon: AudioWaveform, label: connection === 'connected' ? 'Listening for input' : 'Agent link offline', tone: connection === 'connected' ? 'text-[#31E8C0]' : 'text-[#FFC56B]' },
    { Icon: Monitor, label: connection === 'connected' ? 'Browser control armed' : 'Browser control idle', tone: connection === 'connected' ? 'text-[#39D8FF]' : 'text-[#68769A]' },
    { Icon: Eye, label: tracking.available ? 'Vision tracking active' : 'Vision tracking unavailable', tone: tracking.available ? 'text-[#31E8C0]' : 'text-[#68769A]' },
    { Icon: Mic, label: micStatus === 'active' ? 'Voice capture live' : appStatus === 'error' ? 'Microphone needs attention' : 'Awaiting command', tone: micStatus === 'active' ? 'text-[#39D8FF]' : appStatus === 'error' ? 'text-[#FF6488]' : 'text-[#9AA7CB]' },
  ];
}

export default function RightRail({
  cam,
  orbState,
  appStatus,
  micStatus,
  connection,
  events,
}: {
  cam: {
    status: CameraStatus;
    error: string | null;
    stream: MediaStream | null;
    tracking: TrackingState;
    start: () => void;
    stop: () => void;
  };
  orbState: OrbVisualState;
  appStatus: AppStatus;
  micStatus: MicStatus;
  connection: ConnectionStatus;
  events: AgentEvent[];
}) {
  const s = STATUS_COPY[orbState];
  const rows = serviceRows(connection, micStatus, cam.tracking, appStatus);
  const recent = events.slice(-4);

  return (
    <aside className="flex min-h-0 min-w-0 shrink-0 flex-col gap-2 overflow-hidden" aria-label="System status column" style={{ width: 'clamp(216px, 17vw, 252px)' }}>
      <WebcamCard
        mini
        status={cam.status}
        error={cam.error}
        stream={cam.stream}
        tracking={cam.tracking}
        onEnable={cam.start}
        onDisable={cam.stop}
      />

      <section className="hud-panel px-3 py-2" aria-label="System status">
        <div className="flex items-center justify-between">
          <span className="hud-title">SYSTEM STATUS</span>
          <span className="h-1.5 w-1.5 rounded-full bg-[#31E8C0] shadow-[0_0_8px_#31E8C0]" />
        </div>
        <p className={`mt-1 truncate text-[26px] font-extrabold leading-none tracking-wide ${s.cls}`} role="status" aria-live="polite">
          {s.word}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#9AA7CB]">
          <Activity className="h-3 w-3 text-[#39D8FF]" /> {s.sub}
        </p>
      </section>

      <section className="hud-panel px-3 py-2" aria-label="Input signal">
        <div className="flex items-center justify-between">
          <span className="hud-title">INPUT SIGNAL</span>
          <span className={`hud-mono text-[9px] ${micStatus === 'active' ? 'text-[#31E8C0]' : 'text-[#68769A]'}`}>
            {micStatus === 'active' ? 'STREAM ACTIVE' : 'NO ACTIVE STREAM'}
          </span>
        </div>
        <div className="mt-1.5 rounded-lg border border-white/5 bg-black/40 px-1.5 py-1">
          <Waveform bars={30} height={30} />
        </div>
        <p className="mt-1 flex items-center justify-between text-[10.5px] text-[#68769A]">
          <span className="inline-flex items-center gap-1">
            {micStatus === 'active' ? <Mic className="h-3 w-3 text-[#31E8C0]" /> : <Mic className="h-3 w-3" />}
            MIC: {micStatus === 'active' ? 'ON' : 'OFF'}
          </span>
            <span className="hud-mono">{micStatus === 'active' ? 'LIVE ANALYSIS' : 'MICROPHONE IDLE'}</span>
        </p>
      </section>

      <section className="hud-panel flex min-h-0 flex-1 flex-col px-3 py-2" aria-label="Agent activity">
        <div className="flex items-center justify-between">
          <span className="hud-title">AGENT ACTIVITY</span>
          <span className="hud-mono text-[9px] text-[#68769A]">{events.length} EVT</span>
        </div>

        <ol className="mt-2 flex min-h-0 flex-1 flex-col justify-start gap-1.5 overflow-hidden" aria-label="Activity rows">
          {recent.length === 0
            ? rows.map(({ Icon, label, tone }) => (
                <li key={label} className="flex min-w-0 items-center gap-2">
                  <span className="text-[#39D8FF]"><Icon className="h-3.5 w-3.5" /></span>
                  <span className={`truncate text-[12px] ${tone}`}>{label}</span>
                </li>
              ))
            : recent.map((ev) => (
                <li key={ev.eventId} className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${TONE[ev.status]}`}>{eventIcon(ev)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[#F5F7FF]" title={ev.message}>
                    {ev.stage}
                  </span>
                  <span className={`hud-mono shrink-0 text-[9px] ${TONE[ev.status]}`}>{ev.status.replace(/_/g, ' ').toUpperCase()}</span>
                </li>
              ))}
        </ol>

        {recent.length > 0 && (
          <p className="mt-1.5 truncate border-t border-white/5 pt-1.5 text-[10px] text-[#68769A]" title={recent[recent.length - 1].message}>
            latest: {recent[recent.length - 1].message}
          </p>
        )}
      </section>
    </aside>
  );
}
