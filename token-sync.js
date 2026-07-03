// Runs on followish.io — mirrors the app's auth token into extension storage,
// so the popup can call the API without asking the user to paste anything.
(function () {
  function readLS(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      // Followish stores values JSON-encoded (a quoted string).
      try { return JSON.parse(raw); } catch { return raw; }
    } catch { return null; }
  }

  function sync() {
    const token = readLS("token");
    if (!token) return;
    const analyticToken = readLS("analyticToken");
    chrome.storage.local.get(["token"], (cur) => {
      if (cur.token !== token) {
        chrome.storage.local.set({
          token,
          analyticToken: analyticToken || null,
          tokenSyncedAt: Date.now(),
        });
      }
    });
  }

  sync();
  // Re-check when the tab regains focus (token may have been refreshed).
  window.addEventListener("focus", sync);
})();
