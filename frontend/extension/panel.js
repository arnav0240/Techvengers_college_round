// panel.js — NOVA side panel controller.
//
// Talks to the local simulation service (ws://127.0.0.1:8787/ws) to execute
// browser commands, captures speech via the Web Speech API, gates on the
// "Hey Nova" wake word, and auto-executes after you stop speaking.

const $ = (id) => document.getElementById(id);
const SERVICE_WS = "ws://127.0.0.1:8787/ws";
const WEBAPP = "http://localhost:5173/";
const SILENCE_MS = 1800; // pause before auto-execute

const state = {
  ws: null,
  connection: "connecting",
  request: null, // { requestId, command, status }
  events: [],
  armed: false, // wake word heard → ready to capture a command
  micOn: false,
  micPending: false,
  camOn: false,
  camStream: null,
  buffer: "", // recognized command text so far
  heard: "", // last phrase heard while NOT armed (shown so speech is visible)
  interim: "",
  lastAt: 0,
  seenIds: new Set(),
};

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let silenceTimer = 0;

const newId = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- render ----
function render() {
  // Transcript centred in the orb — show live interim speech, the command being
  // built while armed, or the last phrase heard while idle so speech is NEVER
  // invisible (silently dropping it made the mic look broken).
  let text;
  if (state.armed) {
    text = (state.buffer + (state.interim ? " " + state.interim : "")).trim();
  } else {
    text = (state.interim || state.heard || "").trim();
  }
  $("transcript").textContent = text;

  // hint line
  const hint = $("hint");
  if (!SR) hint.textContent = "Speech recognition unsupported in this browser";
  else if (!state.armed && !state.micOn) hint.textContent = "Tap the mic to start listening";
  else if (!state.armed && state.heard) hint.textContent = "Start with “Hey Nova”, then your command";
  else if (!state.armed) hint.textContent = "Listening for “Hey Nova”…";
  else hint.textContent = "Speak your command — I’ll run it when you stop";

  // orb visual state
  const orb = $("orb");
  orb.classList.toggle("active", state.micOn);
  orb.classList.toggle("armed", state.armed);

  // mic button
  $("micBtn").classList.toggle("listening", state.micOn);

  // service state
  const dot = $("connDot");
  dot.className = "dot " + state.connection;
  const svc = $("serviceState");
  svc.textContent = state.connection;
  svc.className =
    "value " +
    (state.connection === "connected" ? "ok" : state.connection === "connecting" ? "warn" : "err");

  // request state (real protocol statuses: accepted/running/completed/failed/
  // cancelled/busy)
  const req = $("requestState");
  if (!state.request) {
    req.textContent = "idle";
    req.className = "value";
    $("progressFill").style.width = "0%";
  } else {
    const st = state.request.status;
    req.textContent = `${st} · ${state.request.command}`;
    req.className =
      "value " +
      (st === "completed"
        ? "ok"
        : st === "failed"
          ? "err"
          : st === "running" || st === "accepted"
            ? "run"
            : "warn");
    $("progressFill").style.width =
      st === "completed"
        ? "100%"
        : st === "running"
          ? "65%"
          : st === "accepted"
            ? "25%"
            : "10%";
  }

  renderEvents();
}

function renderEvents() {
  const ul = $("eventList");
  if (state.events.length === 0) {
    ul.innerHTML = '<li class="event event-muted">Waiting for the first event…</li>';
    return;
  }
  ul.innerHTML = "";
  for (const ev of state.events) {
    const li = document.createElement("li");
    li.className = "event event-" + (ev.status || "muted");
    const title = document.createElement("span");
    title.textContent = ev.title || ev.type || "event";
    li.appendChild(title);
    if (ev.url) {
      const u = document.createElement("span");
      u.className = "event-url";
      u.textContent = ev.url;
      li.appendChild(u);
    }
    ul.appendChild(li);
  }
  ul.parentElement.scrollTop = ul.parentElement.scrollHeight;
}

// ---------------------------------------------------------------- speech ----
async function startMic() {
  if (!SR) {
    $("hint").textContent = "Speech recognition unsupported in this browser";
    return;
  }
  if (state.micOn || state.micPending) return;
  state.micPending = true;
  render();

  // 1) Obtain mic permission FIRST. This surfaces the browser's permission
  //    prompt and waits for the answer, so SpeechRecognition never starts into
  //    a 'not-allowed' error (the old code raced SR against the prompt). A
  //    safety timeout guarantees a never-answered prompt can't leave the mic
  //    button stuck in a pending state.
  let stream;
  try {
    stream = await new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("mic-timeout"));
      }, 10000);
      navigator.mediaDevices.getUserMedia({ audio: true }).then(
        (s) => {
          clearTimeout(timer);
          if (timedOut) {
            // We already gave up — release the late stream so the mic indicator
            // doesn't stay on.
            s.getTracks().forEach((t) => t.stop());
            reject(new Error("late"));
            return;
          }
          resolve(s);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  } catch {
    state.micPending = false;
    $("hint").textContent = "Mic blocked — tap the mic and choose “Allow”";
    render();
    return;
  }
  // Release our own hold; SpeechRecognition re-acquires the mic itself now that
  // permission is granted for this origin.
  stream.getTracks().forEach((t) => t.stop());

  // 2) Start recognition now that permission is in place.
  state.micPending = false;
  state.micOn = true;
  rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  rec.onresult = onResult;
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      state.micOn = false;
      $("hint").textContent = "Mic not allowed — click the mic and choose “Allow”";
      try {
        rec?.stop();
      } catch {
        /* ignore */
      }
      rec = null;
      render();
    }
    // 'no-speech' / 'aborted' are benign — onend restarts the recogniser.
  };
  rec.onend = () => {
    // Auto-restart while we intend to be listening.
    if (state.micOn) {
      try {
        rec?.start();
      } catch {
        /* ignore */
      }
    }
  };

  try {
    rec.start();
  } catch {
    /* ignore */
  }
  render();
}

function stopMic() {
  state.micOn = false;
  state.micPending = false;
  state.armed = false;
  state.buffer = "";
  state.heard = "";
  state.interim = "";
  clearTimeout(silenceTimer);
  try {
    rec?.stop();
  } catch {
    /* ignore */
  }
  rec = null;
  render();
}

function onResult(e) {
  let interim = "";
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const res = e.results[i];
    const text = res[0].transcript;
    if (res.isFinal) handleFinal(text);
    else interim += text;
  }
  state.interim = interim;
  state.lastAt = Date.now();
  render();
  scheduleAutoExec();
}

function handleFinal(text) {
  const t = text.trim();
  if (!t) return;
  if (!state.armed) {
    // Look for the wake word.
    const m = /\b(hey\s+nova|nova)\b/i.exec(t);
    if (m) {
      state.armed = true;
      // Command is whatever followed the wake word in this utterance.
      const after = t.slice((m.index ?? 0) + m[0].length).trim();
      state.buffer = after;
      state.heard = "";
    } else {
      // Heard speech but no wake word → keep it visible on the orb (with a
      // "start with Hey Nova" hint) instead of silently dropping it.
      state.heard = t;
      state.buffer = "";
    }
  } else {
    state.buffer = (state.buffer ? state.buffer + " " : "") + t;
    state.heard = "";
  }
  state.interim = "";
}

function scheduleAutoExec() {
  clearTimeout(silenceTimer);
  if (!state.armed || !state.buffer.trim()) return;
  silenceTimer = setTimeout(() => {
    const cmd = state.buffer.trim();
    // Clear before submitting so the next command starts fresh.
    state.armed = false;
    state.buffer = "";
    state.interim = "";
    render();
    if (cmd) submit(cmd);
  }, SILENCE_MS);
}

// --------------------------------------------------------------- webcam ----
async function toggleCam() {
  if (state.camOn) {
    state.camStream?.getTracks().forEach((t) => t.stop());
    state.camStream = null;
    state.camOn = false;
    $("webcam").classList.remove("on");
    $("webcamBtn").classList.remove("on");
  } else {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      state.camStream = s;
      state.camOn = true;
      const v = $("webcam");
      v.srcObject = s;
      v.classList.add("on");
      $("webcamBtn").classList.add("on");
    } catch {
      $("hint").textContent = "Camera permission denied";
    }
  }
}

// --------------------------------------------------------------- service ----
function connect() {
  let ws;
  try {
    ws = new WebSocket(SERVICE_WS);
  } catch {
    state.connection = "disconnected";
    render();
    setTimeout(connect, 3000);
    return;
  }
  state.ws = ws;

  ws.onopen = () => {
    state.connection = "connected";
    render();
  };
  ws.onclose = () => {
    state.connection = "disconnected";
    render();
    setTimeout(connect, 2500);
  };
  ws.onerror = () => {
    state.connection = "disconnected";
    render();
  };
  ws.onmessage = (raw) => handleServiceMessage(raw.data);
}

function handleServiceMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  switch (msg.type) {
    case "hello":
      state.connection = "connected";
      render();
      break;
    case "browser":
      break;
    case "accepted":
      if (state.request && msg.requestId === state.request.requestId) {
        state.request.status = "accepted";
        render();
      }
      break;
    case "event": {
      // Server broadcasts { type: 'event', event } — payload is nested.
      const ev = msg.event;
      if (!ev) return;
      if (state.request && ev.requestId !== state.request.requestId) return; // stale
      if (ev.id && state.seenIds.has(ev.id)) return;
      if (ev.id) state.seenIds.add(ev.id);
      state.events.push(ev);
      if (state.events.length > 40) state.events.shift();
      render();
      break;
    }
    case "request": {
      // Server broadcasts { type: 'request', request } — payload is nested.
      const r = msg.request;
      if (state.request && r && r.requestId === state.request.requestId) {
        if (r.status) state.request.status = r.status;
        if (r.command) state.request.command = r.command;
        if (r.summary) state.request.summary = r.summary;
        render();
      }
      break;
    }
    case "result": {
      if (state.request && msg.requestId !== state.request.requestId) return; // stale
      state.request.status = msg.status;
      if (msg.summary) state.request.summary = msg.summary;
      render();
      break;
    }
    case "error": {
      if (state.request && msg.requestId && msg.requestId !== state.request.requestId) return;
      if (state.request) state.request.status = "failed";
      state.events.push({
        title: msg.message || "error",
        status: "failed",
        requestId: msg.requestId,
      });
      render();
      break;
    }
    default:
      break;
  }
}

function submit(command) {
  const cmd = (command || "").trim();
  if (!cmd) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    $("hint").textContent = "Service offline — run `npm run sim` first";
    state.request = { requestId: newId(), command: cmd, status: "failed" };
    state.events.push({ title: "Service offline — cannot execute", status: "failed" });
    render();
    return;
  }
  const requestId = newId();
  state.request = { requestId, command: cmd, status: "accepted" };
  state.events = [];
  state.seenIds = new Set();
  render();
  state.ws.send(JSON.stringify({ type: "submit", requestId, command: cmd }));
}

// ----------------------------------------------------------------- wiring ----
$("micBtn").addEventListener("click", () => {
  if (state.micOn) stopMic();
  else startMic().catch(() => {});
});

$("webcamBtn").addEventListener("click", toggleCam);

$("expandBtn").addEventListener("click", () => {
  // Expand to the full NOVA webapp in a new tab.
  chrome.tabs.create({ url: WEBAPP });
});

$("sendBtn").addEventListener("click", () => {
  const v = $("typeBox").value;
  $("typeBox").value = "";
  submit(v);
});

$("typeBox").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = $("typeBox").value;
    $("typeBox").value = "";
    submit(v);
  }
});

// Notify the background so it can pause the offscreen wake listener (mic handoff).
chrome.runtime.sendMessage({ type: "panel-open" }).catch(() => {});
window.addEventListener("pagehide", () => {
  chrome.runtime.sendMessage({ type: "panel-close" }).catch(() => {});
  if (state.camStream) state.camStream.getTracks().forEach((t) => t.stop());
});

// Boot.
connect();
render();
// Try to auto-start listening so "Hey Nova" works immediately; if the browser
// requires a gesture for mic access, the user can tap the mic button instead.
// The delay lets the offscreen wake-listener receive its pause message first,
// so the two documents never fight over the microphone.
setTimeout(() => {
  if (SR && !state.micOn && !state.micPending) startMic().catch(() => {});
}, 700);
