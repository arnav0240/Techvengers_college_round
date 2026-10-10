// background.js — NOVA extension service worker (MV3).
//
// Responsibilities:
//  - Open the side panel (mobile layout) when the toolbar icon is clicked.
//  - Keep an offscreen document listening for the "Hey Nova" wake word while
//    the panel is closed; on wake, surface the panel.
//  - Coordinate the microphone handoff so only one document uses it at a time:
//    offscreen = wake word (panel closed), panel = command dictation (open).

// Open the side panel on toolbar-icon click (Chrome 116+).
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function ensureOffscreen() {
  // hasDocument() exists on Chrome 116+; guard for older builds.
  if (chrome.offscreen?.hasDocument && (await chrome.offscreen.hasDocument())) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Continuously listen for the "Hey Nova" wake word so the assistant can be voice-activated.',
    });
  } catch {
    // Already exists, or offscreen unsupported — the panel still works manually.
  }
}

// Start the wake-word listener when the browser starts.
ensureOffscreen();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case 'wake': {
      // Wake word heard while the panel was closed → badge + surface the panel.
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#315BFF' });
      chrome.windows
        .getCurrent()
        .then((w) => {
          if (w?.id != null) chrome.sidePanel.open({ windowId: w.id }).catch(() => {});
        })
        .catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    case 'panel-open': {
      chrome.action.setBadgeText({ text: '' });
      // Free the mic for the panel: pause the offscreen wake listener.
      chrome.runtime.sendMessage({ type: 'offscreen-pause' }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    case 'panel-close': {
      // Resume wake-word listening now that the panel is gone.
      ensureOffscreen();
      chrome.runtime.sendMessage({ type: 'offscreen-resume' }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    default:
      return false;
  }
});
