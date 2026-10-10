/**
 * Headless acceptance harness for the simulation service.
 * Usage: node scripts/sim-test.mjs "Open YouTube" ["more commands" ...]
 * Prints the real event stream and the terminal status of each request.
 */
const BASE = process.env.NOVA_SIM_URL || 'http://127.0.0.1:8787';

async function submit(command) {
  const res = await fetch(`${BASE}/api/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.requestId;
}

async function waitFor(requestId, timeoutMs = 150000) {
  const t0 = Date.now();
  const seen = new Map(); // id -> status last printed
  while (Date.now() - t0 < timeoutMs) {
    const res = await fetch(`${BASE}/api/requests/${requestId}`);
    const body = await res.json();
    for (const ev of body.events) {
      if (seen.get(ev.id) !== ev.status) {
        seen.set(ev.id, ev.status);
        const dur = ev.durationMs != null ? ` (${ev.durationMs}ms)` : '';
        const mark =
          ev.status === 'completed' ? '✓' : ev.status === 'failed' ? '✗' : ev.status === 'cancelled' ? '⊘' : '·';
        console.log(`  ${mark} [${ev.type}] ${ev.title}${dur}`);
        if (ev.description) console.log(`      ${ev.description}`);
        if (ev.error) console.log(`      ERROR: ${ev.error}`);
      }
    }
    if (['completed', 'failed', 'cancelled'].includes(body.request.status)) return body;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`Timed out waiting for request ${requestId}`);
}

const commands = process.argv.slice(2);
if (!commands.length) commands.push('Open YouTube');

for (const command of commands) {
  console.log(`\n=== "${command}" ===`);
  try {
    const requestId = await submit(command);
    console.log(`  accepted as ${requestId}`);
    const body = await waitFor(requestId);
    console.log(`  => ${body.request.status.toUpperCase()}: ${body.request.summary}`);
  } catch (err) {
    console.log(`  => SUBMIT FAILED: ${err.message}`);
  }
}
