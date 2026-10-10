// offscreen.js — background wake-word listener.
// Runs only while the side panel is closed. Listens continuously for "Hey Nova"
// and notifies the service worker, which surfaces the panel.
//
// Mic handoff: the background tells us to pause when the panel opens so the two
// documents never fight over the microphone.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let rec = null;
let micStream = null;
let running = false;

function startListening() {
  if (running || !SR) return;
  rec = new SR();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = 'en-US';
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const text = e.results[i][0].transcript.toLowerCase();
      if (/\b(hey\s+nova|nova)\b/.test(text)) {
        chrome.runtime.sendMessage({ type: 'wake', transcript: text }).catch(() => {});
      }
    }
  };
  rec.onerror = (e) => {
    // SpeechRecognition is unreliable in background-like contexts (it can report
    // 'not-allowed'). If it's a fatal permission/service error, stop instead of
    // restart-looping and holding the microphone — the side panel still works.
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      stopListening();
    }
  };
  rec.onend = () => {
    if (running) {
      try {
        rec.start();
      } catch {
        /* ignore double-start */
      }
    }
  };
  // Grab the mic (satisfies permission / autoplay policy), then start.
  navigator.mediaDevices
    ?.getUserMedia({ audio: true })
    .then((s) => {
      micStream = s;
      running = true;
      try {
        rec.start();
      } catch {
        /* ignore */
      }
    })
    .catch(() => {
      /* Mic unavailable — wake word silently disabled; panel still works. */
    });
}

function stopListening() {
  running = false;
  try {
    rec?.stop();
  } catch {
    /* ignore */
  }
  rec = null;
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'offscreen-pause') stopListening();
  else if (msg?.type === 'offscreen-resume') startListening();
});

startListening();
