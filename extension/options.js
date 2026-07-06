const DEFAULT_BASE_URL = "https://jobscout.oakworks.ai";

const apiKeyInput = document.getElementById("apiKey");
const baseUrlInput = document.getElementById("baseUrl");
const status = document.getElementById("status");

// Key lives in storage.local (never synced — see background.js); fall back to
// the legacy sync location for users upgrading from v0.2.x.
async function loadSettings() {
  const local = await chrome.storage.local.get({ apiKey: "", baseUrl: "" });
  if (local.apiKey || local.baseUrl) return local;
  return chrome.storage.sync.get({ apiKey: "", baseUrl: "" });
}

loadSettings().then(({ apiKey, baseUrl }) => {
  apiKeyInput.value = apiKey;
  baseUrlInput.value = baseUrl || DEFAULT_BASE_URL;
});

document.getElementById("reveal").addEventListener("click", () => {
  const hidden = apiKeyInput.type === "password";
  apiKeyInput.type = hidden ? "text" : "password";
  document.getElementById("reveal").textContent = hidden ? "Hide" : "Show";
});

function setStatus(message, ok) {
  status.textContent = message;
  status.className = ok ? "ok" : "err";
}

// The bearer key is sent to whatever host is configured here — require https
// (plain http only for local development) so the key can't leak on the wire.
function normalizeBaseUrl(raw) {
  const value = raw.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: "Backend URL is not a valid URL" };
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    return { error: "Backend URL must be https:// (http:// is allowed only for localhost)" };
  }
  return { url: value };
}

async function save() {
  const normalized = normalizeBaseUrl(baseUrlInput.value);
  if (normalized.error) {
    setStatus(`✗ ${normalized.error}`, false);
    return false;
  }
  await chrome.storage.local.set({
    apiKey: apiKeyInput.value.trim(),
    baseUrl: normalized.url,
  });
  await chrome.storage.sync.remove(["apiKey"]);
  return true;
}

document.getElementById("save").addEventListener("click", async () => {
  if (await save()) setStatus("Saved.", true);
});

document.getElementById("test").addEventListener("click", async () => {
  if (!(await save())) return;
  setStatus("Testing…", true);
  const res = await chrome.runtime.sendMessage({ type: "ping" });
  if (res?.ok) {
    setStatus("✓ Connected to Job Scout", true);
  } else {
    setStatus(`✗ ${res?.error || "Connection failed"}`, false);
  }
});
