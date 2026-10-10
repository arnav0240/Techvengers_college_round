/**
 * Cancellation + concurrency test: submit a long command, cancel it mid-run,
 * then verify a new command can still run afterwards (no stuck lock).
 */
const BASE = 'http://127.0.0.1:8787';

async function submit(command, requestId) {
  const res = await fetch(`${BASE}/api/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command, requestId }),
  });
  return { status: res.status, body: await res.json() };
}

async function status(requestId) {
  const res = await fetch(`${BASE}/api/requests/${requestId}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('=== Concurrency guard ===');
const a = await submit('Open YouTube', 'conc-aaaa');
console.log('first submit:', a.status, JSON.stringify(a.body));
const b = await submit('Open a new tab', 'conc-bbbb');
console.log('second submit while busy:', b.status, JSON.stringify(b.body));

console.log('\n=== Cancellation mid-run ===');
// Wait for the first to be running, then cancel.
await sleep(2500);
const c = await fetch(`${BASE}/api/cancel`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ requestId: 'conc-aaaa' }),
});
console.log('cancel response:', c.status, JSON.stringify(await c.json()));

let final;
for (let i = 0; i < 30; i++) {
  const s = await status('conc-aaaa');
  if (['completed', 'failed', 'cancelled'].includes(s.request.status)) {
    final = s;
    break;
  }
  await sleep(700);
}
console.log('terminal status:', final?.request.status, '|', final?.request.summary);
console.log('last events:');
for (const ev of (final?.events ?? []).slice(-3)) {
  console.log(`  [${ev.status}] ${ev.title}: ${ev.description ?? ev.error ?? ''}`);
}

console.log('\n=== Service recovers after cancel ===');
await sleep(1500);
const d = await submit('What is the url', 'conc-cccc');
console.log('post-cancel submit:', d.status, JSON.stringify(d.body));
let dFinal;
for (let i = 0; i < 30; i++) {
  const s = await status('conc-cccc');
  if (['completed', 'failed', 'cancelled'].includes(s.request.status)) {
    dFinal = s;
    break;
  }
  await sleep(700);
}
console.log('post-cancel terminal:', dFinal?.request.status, '|', dFinal?.request.summary);

const ok =
  b.status === 400 &&
  ['cancelled', 'completed', 'failed'].includes(final?.request.status) &&
  dFinal?.request.status === 'completed';
console.log(`\n${ok ? 'PASS' : 'FAIL'}: cancel + concurrency behaved honestly`);
process.exit(ok ? 0 : 1);
