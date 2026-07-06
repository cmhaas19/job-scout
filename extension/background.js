// All network I/O lives here: the service worker's fetches are covered by
// host_permissions, so calls to the Job Scout backend bypass CORS entirely
// (content-script fetches would be subject to linkedin.com's origin).

const DEFAULT_BASE_URL = "https://jobscout.oakworks.ai";

const PATHS = {
  ping: "/api/extension/ping",
  lookup: "/api/extension/jobs/lookup",
  evaluate: "/api/extension/jobs/evaluate",
};

// Clicking the toolbar icon triggers scoring in the active tab's content script.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "scoreAll" }).catch(() => {
      // No content script in this tab (not a linkedin.com page) — ignore.
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message || "Request failed" }));
  return true; // keep the channel open for the async response
});

// The API key lives in chrome.storage.local: storage.sync replicates
// unencrypted through the user's Google account to every signed-in machine.
// Reads fall back to (and migrate away from) the sync area where v0.2.x
// stored it.
async function getSettings() {
  let { apiKey, baseUrl } = await chrome.storage.local.get({
    apiKey: "",
    baseUrl: "",
  });
  if (!apiKey) {
    const legacy = await chrome.storage.sync.get({ apiKey: "", baseUrl: "" });
    if (legacy.apiKey) {
      apiKey = legacy.apiKey;
      baseUrl = baseUrl || legacy.baseUrl;
      await chrome.storage.local.set({ apiKey, baseUrl });
      await chrome.storage.sync.remove(["apiKey"]);
    }
  }
  return { apiKey, baseUrl: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "") };
}

async function handle(msg) {
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  const path = PATHS[msg.type];
  if (!path) return { error: `Unknown message type: ${msg.type}` };

  const { apiKey, baseUrl } = await getSettings();

  if (!apiKey) {
    return { error: "No API key set — open the Job Scout extension options" };
  }

  // Evaluate calls can run 30-90s server-side; ping a trivial extension API
  // periodically so Chrome doesn't reap the service worker mid-fetch.
  const keepalive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);

  let res;
  try {
    res = await fetch(baseUrl + path, {
      method: msg.type === "ping" ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: msg.type === "ping" ? undefined : JSON.stringify(msg.body),
    });
  } catch {
    return { error: "Could not reach Job Scout — check the backend URL" };
  } finally {
    clearInterval(keepalive);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      return { error: "Invalid API key — check the extension options" };
    }
    return { error: data.error || `Job Scout returned HTTP ${res.status}` };
  }

  return await res.json();
}
