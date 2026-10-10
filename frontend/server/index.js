/**
 * NOVA Simulation Service
 *
 * Small localhost-only Node service that owns the real Chromium process via
 * Playwright and executes natural-language browser commands from the NOVA
 * frontend, streaming typed execution events + live frames over WebSocket.
 *
 * Start:  npm run sim            (or: node server/index.js)
 * URL:    http://127.0.0.1:8787  (WebSocket: ws://127.0.0.1:8787/ws)
 *
 * Endpoints:
 *   GET  /api/health        service + browser state
 *   POST /api/request       { command }          -> { requestId, status }
 *   POST /api/cancel        { requestId? }       -> { cancelled }
 *   GET  /api/requests      recent request index
 *   GET  /api/requests/:id  full event log for a request
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { BrowserManager } from './browser.js';
import { ExecutionEngine } from './engine.js';
import { SUPPORTED_PATTERNS } from './interpreter.js';

const PORT = Number(process.env.NOVA_SIM_PORT || 8787);
const HOST = '127.0.0.1';

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/** requestId -> { command, status, summary, startedAt, finishedAt, events: [] } */
const requests = new Map();
const ORDER = [];

function broadcast(msg) {
  if (clients.size === 0) return;
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function recordEvent(event) {
  const entry = requests.get(event.requestId);
  if (!entry) return;
  const i = entry.events.findIndex((e) => e.id === event.id);
  if (i >= 0) entry.events[i] = event;
  else entry.events.push(event);
  broadcast({ type: 'event', event });
}

const browser = new BrowserManager({
  onStatus: (s) => broadcast({ type: 'browser', browser: s }),
  onFrame: (f) => broadcast({ type: 'frame', ...f }),
  onPage: (p) => broadcast({ type: 'page', page: p }),
});

const engine = new ExecutionEngine({
  browser,
  emit: recordEvent,
  onState: (state) => {
    const entry = requests.get(state.requestId);
    if (entry) Object.assign(entry, state);
    broadcast({ type: 'request', request: publicRequest(state.requestId) });
  },
});

function publicRequest(requestId) {
  const r = requests.get(requestId);
  if (!r) return null;
  return {
    requestId: r.requestId,
    command: r.command,
    status: r.status,
    summary: r.summary ?? null,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt ?? null,
  };
}

function submitCommand(command, clientRequestId) {
  const text = String(command ?? '').trim();
  if (!text) return { error: 'Command is empty.' };
  if (text.length > 400) return { error: 'Command is too long (400 characters max).' };
  if (engine.busy) return { error: 'Another request is already executing. Wait for it or cancel it first.' };

  // Honour a client-supplied requestId (8-64 url-safe chars) so the submitter
  // can correlate the acknowledgement; otherwise mint one.
  const supplied = typeof clientRequestId === 'string' ? clientRequestId.trim() : '';
  const requestId = /^[A-Za-z0-9_-]{6,64}$/.test(supplied) ? supplied : randomUUID().slice(0, 8);
  requests.set(requestId, {
    requestId,
    command: text,
    status: 'accepted',
    startedAt: Date.now(),
    events: [],
  });
  ORDER.push(requestId);
  while (ORDER.length > 50) requests.delete(ORDER.shift());

  broadcast({ type: 'request', request: publicRequest(requestId) });

  engine
    .execute({ requestId, command: text })
    .then((result) => {
      const entry = requests.get(requestId);
      if (entry) Object.assign(entry, result, { finishedAt: Date.now() });
      broadcast({ type: 'result', requestId, ...result });
      broadcast({ type: 'request', request: publicRequest(requestId) });
    })
    .catch((err) => {
      const entry = requests.get(requestId);
      if (entry) Object.assign(entry, { status: 'failed', summary: String(err?.message ?? err), finishedAt: Date.now() });
      broadcast({ type: 'result', requestId, status: 'failed', summary: String(err?.message ?? err) });
    });

  return { requestId };
}

// ----------------------------------------------------------------- HTTP API

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').slice(0, 8000);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (url.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      service: 'nova-simulation',
      browser: browser.snapshot(),
      executing: engine.busy,
      supportedPatterns: SUPPORTED_PATTERNS,
    });
  }

  if (url.pathname === '/api/request' && req.method === 'POST') {
    const body = await readBody(req);
    const out = submitCommand(body.command, body.requestId);
    if (out.error) return json(res, 400, { ok: false, error: out.error });
    return json(res, 202, { ok: true, requestId: out.requestId });
  }

  if (url.pathname === '/api/cancel' && req.method === 'POST') {
    const body = await readBody(req);
    return json(res, 200, { ok: true, cancelled: engine.cancel(body.requestId) });
  }

  if (url.pathname === '/api/requests') {
    return json(res, 200, { requests: [...requests.values()].map((r) => publicRequest(r.requestId)).reverse() });
  }

  if (url.pathname.startsWith('/api/requests/')) {
    const id = url.pathname.split('/').pop();
    const entry = requests.get(id);
    if (!entry) return json(res, 404, { ok: false, error: `Unknown request "${id}".` });
    return json(res, 200, { request: publicRequest(id), events: entry.events });
  }

  json(res, 404, { ok: false, error: 'Not found.' });
});

// --------------------------------------------------------------- WebSocket

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  clients.add(ws);
  browser.setSubscribers(clients.size);

  // Snapshot so a late-joining or refreshing client recovers the full picture.
  ws.send(
    JSON.stringify({
      type: 'hello',
      browser: browser.snapshot(),
      frame: browser.lastFrame,
      requests: [...requests.values()].map((r) => publicRequest(r.requestId)).reverse().slice(0, 10),
      executing: engine.busy,
      supportedPatterns: SUPPORTED_PATTERNS,
    }),
  );

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Malformed JSON message.' }));
      return;
    }
    if (msg.type === 'submit') {
      const out = submitCommand(msg.command, msg.requestId);
      if (out.error) ws.send(JSON.stringify({ type: 'error', message: out.error }));
      else ws.send(JSON.stringify({ type: 'accepted', requestId: out.requestId, command: String(msg.command).trim() }));
    } else if (msg.type === 'cancel') {
      const ok = engine.cancel(msg.requestId);
      ws.send(JSON.stringify({ type: 'cancelled', ok, requestId: msg.requestId ?? engine.active?.requestId ?? null }));
    } else if (msg.type === 'frame-now') {
      browser.captureFrame();
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    browser.setSubscribers(clients.size);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[nova-sim] listening on http://${HOST}:${PORT}  (ws://${HOST}:${PORT}/ws)`);
  console.log(`[nova-sim] browser mode: ${process.env.NOVA_HEADLESS === '1' ? 'HEADLESS' : 'windowed (native Chromium window)'}; profile: server/.nova-profile`);
});

process.on('SIGINT', async () => {
  console.log('\n[nova-sim] shutting down…');
  await browser.shutdown().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});
