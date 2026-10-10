export type AppStatus =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'transcribing'
  | 'ready_to_submit'
  | 'submitting'
  | 'connecting_to_agent'
  | 'thinking'
  | 'executing'
  | 'waiting_for_confirmation'
  | 'speaking'
  | 'completed'
  | 'error'
  | 'cancelled';

export type OrbVisualState =
  | 'idle'
  | 'listening'
  | 'speech'
  | 'thinking'
  | 'executing'
  | 'error'
  | 'completed';

export type ActivityStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_for_confirmation';

export interface AgentEvent {
  eventId: string;
  requestId: string;
  stage: string;
  status: ActivityStatus;
  message: string;
  timestamp: number;
  progress?: number;
  error?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface AgentRequest {
  requestId: string;
  text: string;
  mode: 'command' | 'dictation';
  createdAt: number;
}

export interface AudioLevels {
  /** 0..1 instantaneous RMS energy */
  rms: number;
  /** 0..1 smoothed energy (attack/release applied) */
  smoothed: number;
  /** 0..1 peak hold */
  peak: number;
  /** 0..1 low band energy */
  low: number;
  /** 0..1 mid band energy */
  mid: number;
  /** 0..1 high band energy */
  high: number;
  /** true while analyser is receiving stream data */
  active: boolean;
}

export type CameraStatus =
  | 'off'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'error';

export type MicStatus =
  | 'off'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'error';

export type SpeechSupport = 'supported' | 'unsupported' | 'unknown';

export interface TrackingState {
  available: boolean;
  confidence: number | null;
  /** normalized 0..1 coordinates, origin top-left */
  x: number | null;
  y: number | null;
  lastUpdate: number | null;
  statusMessage: string;
}
