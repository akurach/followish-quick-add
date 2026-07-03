// Service worker: the only place that talks to the Followish API.
const API = "https://core.followish.io/api";

async function authHeaders() {
  const { token, analyticToken } = await chrome.storage.local.get([
    "token",
    "analyticToken",
  ]);
  if (!token) throw new Error("NO_TOKEN");
  const headers = {
    Authorization: String(token).startsWith("Bearer ")
      ? String(token)
      : "Bearer " + token,
    "Content-Type": "application/json",
    "x-platform": "WEB",
  };
  if (analyticToken) headers["x-analytic-token"] = analyticToken;
  return headers;
}

async function api(path, body, method = "POST") {
  const headers = await authHeaders();
  const res = await fetch(API + "/" + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && data.message) || text || "";
    throw new Error("HTTP " + res.status + ": " + String(msg).slice(0, 200));
  }
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "me") {
        const me = await api("auth/user", { withoutNewsModals: true });
        sendResponse({
          ok: true,
          data: { id: me.id, userLink: me.userLink, name: me.name },
        });
      } else if (msg.type === "wishlists") {
        // Public read; GET works, POST is the fallback.
        let wl;
        try {
          wl = await api("profile/" + msg.userLink + "/wishlists", undefined, "GET");
        } catch {
          wl = await api("profile/" + msg.userLink + "/wishlists", {}, "POST");
        }
        sendResponse({ ok: true, data: wl });
      } else if (msg.type === "create") {
        const created = await api(
          "wishlists/" + msg.linkKey + "/presents",
          msg.present,
          "POST"
        );
        sendResponse({ ok: true, data: created });
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // keep the channel open for the async response
});
