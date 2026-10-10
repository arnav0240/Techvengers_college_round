# Runtime Agent Integration Contract

The frontend (`src/features/agent/agentAdapter.ts`) defines this boundary:

```ts
interface AgentAdapter {
  getConnectionStatus(): 'disconnected' | 'connecting' | 'connected' | 'error';
  submitRequest(text: string, mode: 'command' | 'dictation'): Promise<AgentRequest>;
  subscribeToEvents(requestId: string, cb: (ev: AgentEvent) => void): () => void;
  cancelRequest(requestId: string): Promise<void>;
}

interface AgentEvent {
  eventId: string; requestId: string; stage: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_for_confirmation';
  message: string; timestamp: number; progress?: number; error?: string;
}
```

## Current state

`DisconnectedAgentAdapter` is wired in: `getConnectionStatus()` returns `disconnected`,
`submitRequest()` rejects with a user-facing "not connected" error, and the timeline shows
an honest empty state. Nothing is simulated.

## To connect the real service

1. Implement `AgentAdapter` with the team's transport (suggested: `POST /agent/requests`
   → `{ requestId }`, then WS/SSE `GET /agent/requests/:id/events` streaming `AgentEvent`s,
   `DELETE /agent/requests/:id` for cancel). Adapt names to the actual backend — the UI only
   depends on the interface above.
2. Replace the exported `agentAdapter` instance. `useAgent()` handles ordering, stale-event
   guards (events from old `requestId`s are ignored), and failure display with no UI changes.
3. On accepted requests the app sets `executing` and moves to compact mode; completion/failure
   events drive the orb + timeline. Never mark stages complete client-side.

## Tracking service

`useCamera()` exposes `tracking: TrackingState { available, confidence, x, y, lastUpdate, statusMessage }`.
The vision teammate should feed this (e.g. via a callback/store update); until then the UI
truthfully reports "camera active, tracking unavailable" and renders no overlays.

## Speech

`useSpeechRecognition()` wraps the Web Speech API behind start/stop/interim/final/error.
Swap the internals for a server-side recogniser if needed; keep it separate from the
Web Audio visualisation path (`MicrophoneAnalyser` + `audioBus`).
