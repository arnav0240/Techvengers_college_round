import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SimBrowserInfo,
  SimConnection,
  SimEvent,
  SimPageSnapshot,
  SimRequest,
  SimResult,
  SimServerMessage,
} from './types';

const WS_URL = (): string =>
  (import.meta.env.VITE_NOVA_SIM_WS as string | undefined) ??
  `ws://${window.location.hostname || '127.0.0.1'}:8787/ws`;

const SERVICE_URL = (): string =>
  (import.meta.env.VITE_NOVA_SIM_URL as string | undefined) ??
  `http://${window.location.hostname || '127.0.0.1'}:8787`;

const MAX_EVENTS = 240;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

/**
 * Frontend half of the simulation integration boundary.
 *
 * Owns the WebSocket to the local execution service, buffers the event stream
 * for the *current* request only (stale events from earlier requests are
 * dropped), and exposes submit/cancel — the same conceptual surface a future
 * runtime AI agent will provide.
 */
export function useSimulation() {
  const [connection, setConnection] = useState<SimConnection>('connecting');
  const [browser, setBrowser] = useState<SimBrowserInfo>({ state: 'idle', headless: true });
  const [pageSnap, setPageSnap] = useState<SimPageSnapshot | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [request, setRequest] = useState<SimRequest | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [supportedPatterns, setSupportedPatterns] = useState<string[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const pendingRef = useRef(new Map<string, { resolve: (ok: boolean) => void; reject: (e: Error) => void }>());
  const retryRef = useRef(0);

  /** Merge a server event into the buffer; dedupe by id, keep chronological order. */
  const applyEvent = useCallback((ev: SimEvent) => {
    if (currentIdRef.current && ev.requestId !== currentIdRef.current) return; // stale request
    setEvents((prev) => {
      const i = prev.findIndex((e) => e.id === ev.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = ev;
        return next;
      }
      const next = [...prev, ev];
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let retryTimer = 0;

    const connect = () => {
      if (disposed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL());
      } catch {
        setConnection('disconnected');
        retryTimer = window.setTimeout(connect, 3000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnection('connected');
        setLastError(null);
      };

      ws.onclose = () => {
        // Only clear the ref if it still points at THIS socket. In dev
        // (StrictMode) two sockets exist briefly; the stale one's late close
        // must not null out the live one.
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed) return;
        setConnection('disconnected');
        retryRef.current = Math.min(retryRef.current + 1, 5);
        retryTimer = window.setTimeout(connect, 800 * retryRef.current);
      };

      ws.onerror = () => {
        /* onclose follows and handles retry */
      };

      ws.onmessage = (raw) => {
        let msg: SimServerMessage;
        try {
          msg = JSON.parse(raw.data as string);
        } catch {
          return;
        }
        switch (msg.type) {
          case 'hello': {
            setBrowser({
              state: msg.browser.state,
              headless: msg.browser.headless,
              error: msg.browser.error,
              description: msg.browser.description,
            });
            setPageSnap(msg.browser);
            if (msg.frame) setFrame(msg.frame);
            setSupportedPatterns(msg.supportedPatterns ?? []);
            // Recover the live request after a refresh, if any.
            const live = (msg.requests ?? []).find((r) => r.status === 'running' || r.status === 'accepted');
            if (live) {
              currentIdRef.current = live.requestId;
              setRequest(live);
              setResult(null);
            } else if (msg.requests?.length) {
              const last = msg.requests[0];
              currentIdRef.current = last.requestId;
              setRequest(last);
              if (last.status !== 'running' && last.status !== 'accepted') {
                setResult({
                  requestId: last.requestId,
                  status: last.status,
                  summary: last.summary ?? '',
                });
              }
            }
            break;
          }
          case 'browser':
            setBrowser({ state: msg.browser.state, headless: msg.browser.headless, error: msg.browser.error, description: msg.browser.description });
            break;
          case 'frame':
            setFrame(msg.dataUrl);
            break;
          case 'page':
            setPageSnap(msg.page);
            break;
          case 'event':
            applyEvent(msg.event);
            break;
          case 'request':
            if (msg.request && msg.request.requestId === currentIdRef.current) setRequest(msg.request);
            break;
          case 'result':
            if (msg.requestId === currentIdRef.current) {
              setResult({ requestId: msg.requestId, status: msg.status, summary: msg.summary });
            }
            break;
          case 'accepted':
            if (currentIdRef.current === msg.requestId) {
              setRequest((prev) => prev ?? { requestId: msg.requestId, command: msg.command, status: 'accepted', startedAt: Date.now() });
              pendingRef.current.get(msg.requestId)?.resolve(true);
              pendingRef.current.delete(msg.requestId);
            }
            break;
          case 'error': {
            setLastError(msg.message);
            // Reject the newest pending submit, if any.
            const entries = [...pendingRef.current.entries()];
            const last = entries[entries.length - 1];
            if (last) {
              last[1].reject(new Error(msg.message));
              pendingRef.current.delete(last[0]);
            }
            break;
          }
          case 'cancelled':
            break;
          default:
            break;
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      // Close only this effect's socket, and only clear the ref if it is ours.
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [applyEvent]);

  const submit = useCallback(async (command: string): Promise<boolean> => {
    const text = command.trim();
    if (!text) throw new Error('Type or dictate a request before submitting.');
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `The browser-execution service is not connected (websocket state: ${
          ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] : 'none'
        }). Start it with \`npm run sim\` and retry.`,
      );
    }
    const requestId = newId();
    currentIdRef.current = requestId;
    setEvents([]);
    setResult(null);
    setLastError(null);
    setRequest({ requestId, command: text, status: 'accepted', startedAt: Date.now() });

    return new Promise<boolean>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error('The execution service did not acknowledge the request in time.'));
      }, 6000);
      pendingRef.current.set(requestId, {
        resolve: (ok) => {
          window.clearTimeout(timer);
          resolve(ok);
        },
        reject: (e) => {
          window.clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ type: 'submit', requestId, command: text }));
    });
  }, []);

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'cancel', requestId: currentIdRef.current ?? undefined }));
    return true;
  }, []);

  /** Fetch the request + event log over HTTP (used after a page refresh). */
  const fetchRequest = useCallback(async (requestId: string) => {
    try {
      const res = await fetch(`${SERVICE_URL()}/api/requests/${requestId}`);
      if (!res.ok) return;
      const body = (await res.json()) as { request: SimRequest | null; events: SimEvent[] };
      if (body.request) setRequest(body.request);
      if (Array.isArray(body.events)) setEvents(body.events);
    } catch {
      /* best effort */
    }
  }, []);

  return {
    connection,
    browser,
    page: pageSnap,
    frame,
    events,
    request,
    result,
    lastError,
    supportedPatterns,
    submit,
    cancel,
    fetchRequest,
    /** true while the service reports an in-flight request */
    executing: request?.status === 'running' || request?.status === 'accepted',
  };
}
