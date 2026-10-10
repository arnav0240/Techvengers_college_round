import { useCallback, useRef, useState } from 'react';
import type { AgentEvent, AgentRequest, ConnectionStatus } from '../../types';

export interface AgentAdapter {
  getConnectionStatus(): ConnectionStatus;
  submitRequest(text: string, mode: 'command' | 'dictation'): Promise<AgentRequest>;
  subscribeToEvents(requestId: string, cb: (ev: AgentEvent) => void): () => void;
  cancelRequest(requestId: string): Promise<void>;
}

/**
 * Integration boundary for the teammate-owned runtime agent.
 *
 * No runtime service has been provided in this repo, so this adapter
 * honestly reports `disconnected` and refuses to fabricate activity.
 * When the real service lands, replace `DisconnectedAgentAdapter` with a
 * WebSocket/HTTP implementation of the same interface — no UI changes needed.
 *
 * Expected future contract (documented in README + docs/INTEGRATION.md):
 *   POST /agent/requests { text, mode } -> { requestId, status: 'accepted' }
 *   WS/GET /agent/requests/:id/events -> AgentEvent stream
 *   DELETE /agent/requests/:id -> cancel
 */
class DisconnectedAgentAdapter implements AgentAdapter {
  getConnectionStatus(): ConnectionStatus {
    return 'disconnected';
  }
  async submitRequest(): Promise<AgentRequest> {
    throw new Error(
      'Runtime agent is not connected. The request was not sent — connect the agent service to execute browser actions.',
    );
  }
  subscribeToEvents(): () => void {
    return () => undefined;
  }
  async cancelRequest(): Promise<void> {
    throw new Error('Nothing to cancel — no runtime agent is connected.');
  }
}

export const agentAdapter: AgentAdapter = new DisconnectedAgentAdapter();

export function useAgent() {
  const [connection] = useState<ConnectionStatus>(() => agentAdapter.getConnectionStatus());
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const clearForRequest = useCallback((requestId: string) => {
    setActiveRequestId(requestId);
    setEvents([]);
    setSubmitError(null);
  }, []);

  const submit = useCallback(
    async (text: string, mode: 'command' | 'dictation') => {
      const trimmed = text.trim();
      if (!trimmed) {
        setSubmitError('Type or dictate a request before submitting.');
        return null;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        const req = await agentAdapter.submitRequest(trimmed, mode);
        clearForRequest(req.requestId);
        unsubRef.current?.();
        unsubRef.current = agentAdapter.subscribeToEvents(req.requestId, (ev) => {
          // Guard against stale events from a previous request.
          setActiveRequestId((current) => {
            if (current !== null && ev.requestId !== current) return current;
            setEvents((prev) => {
              const i = prev.findIndex((e) => e.eventId === ev.eventId);
              if (i >= 0) {
                const next = [...prev];
                next[i] = ev;
                return next.sort((a, b) => a.timestamp - b.timestamp);
              }
              return [...prev, ev].sort((a, b) => a.timestamp - b.timestamp);
            });
            return current;
          });
        });
        return req;
      } catch (err) {
        setSubmitError((err as Error)?.message ?? 'Submission failed.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [clearForRequest],
  );

  const cancel = useCallback(async () => {
    if (!activeRequestId) return;
    try {
      await agentAdapter.cancelRequest(activeRequestId);
    } catch (err) {
      setSubmitError((err as Error)?.message ?? 'Cancel failed.');
    }
  }, [activeRequestId]);

  return { connection, events, activeRequestId, submitError, submitting, submit, cancel, setSubmitError };
}
