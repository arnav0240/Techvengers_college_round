/**
 * Shared types for NOVA Simulation mode.
 *
 * These mirror the events produced by `server/engine.js`. The future runtime
 * AI agent can emit the same shapes over the same channel, so the UI never has
 * to change when the local pattern interpreter is swapped for a real agent.
 */

export type SimEventStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_confirmation';

export type SimEventType =
  | 'lifecycle'
  | 'plan'
  | 'browser'
  | 'navigation'
  | 'interaction'
  | 'observation'
  | 'verification'
  | 'error';

/** A single, truthful step of the execution trace. */
export interface SimEvent {
  id: string;
  requestId: string;
  timestamp: number;
  type: SimEventType;
  title: string;
  description: string;
  status: SimEventStatus;
  /** Live browser URL when relevant to this step. */
  url?: string;
  /** Measured wall-clock duration of the operation, when known. */
  durationMs?: number;
  /** Verbatim failure message, when the step failed. */
  error?: string;
}

export type SimRequestStatus =
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'busy';

export interface SimRequest {
  requestId: string;
  command: string;
  status: SimRequestStatus;
  summary?: string | null;
  startedAt: number;
  finishedAt?: number | null;
}

export type SimBrowserState = 'idle' | 'starting' | 'ready' | 'error' | 'crashed';

export interface SimBrowserInfo {
  state: SimBrowserState;
  headless: boolean;
  error?: string | null;
  description?: string | null;
}

export interface SimTab {
  index: number;
  title: string | null;
  url: string;
  active: boolean;
}

export interface SimPageSnapshot {
  state: SimBrowserState;
  headless: boolean;
  error?: string | null;
  description?: string | null;
  page: { title: string | null; url: string | null } | null;
  tabs: SimTab[];
  activeIndex: number;
}

export interface SimResult {
  requestId: string;
  status: SimRequestStatus;
  summary: string;
  final?: { title: string; url: string };
}

export type SimConnection = 'connecting' | 'connected' | 'disconnected';

/** Server → client WebSocket messages. */
export type SimServerMessage =
  | {
      type: 'hello';
      browser: SimPageSnapshot;
      frame: string | null;
      requests: SimRequest[];
      executing: boolean;
      supportedPatterns: string[];
    }
  | { type: 'browser'; browser: SimBrowserInfo }
  | { type: 'frame'; t: number; dataUrl: string }
  | { type: 'page'; page: SimPageSnapshot }
  | { type: 'event'; event: SimEvent }
  | { type: 'request'; request: SimRequest | null }
  | { type: 'result'; requestId: string; status: SimRequestStatus; summary: string }
  | { type: 'accepted'; requestId: string; command: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled'; ok: boolean; requestId: string | null }
  | { type: 'pong'; t: number };

/** Client → server WebSocket messages. */
export type SimClientMessage =
  | { type: 'submit'; requestId: string; command: string }
  | { type: 'cancel'; requestId?: string }
  | { type: 'frame-now' }
  | { type: 'ping' };
