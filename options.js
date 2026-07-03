const $ = (s) => document.querySelector(s);

function short(t) {
  return t ? String(t).slice(0, 22) + "…(" + String(t).length + ")" : "";
}

let toastTimer;
function toast(msg, type) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2400);
}

async function refresh() {
  const { token, tokenSyncedAt } = await chrome.storage.local.get([
    "token",
    "tokenSyncedAt",
  ]);
  const el = $("#token-state");
  if (token) {
    const when = tokenSyncedAt
      ? new Date(tokenSyncedAt).toLocaleString("ru-RU")
      : "вручную";
    el.innerHTML = `<span class="state-ok">✓ токен есть</span> · ${short(
      token
    )} · ${when}`;
  } else {
    el.innerHTML = `<span class="state-warn">токена нет</span> · открой followish.io залогиненным или вставь ниже`;
  }
}

$("#save").addEventListener("click", async () => {
  let v = $("#token").value.trim();
  if (!v) {
    toast("Пусто", "err");
    return;
  }
  v = v.replace(/^Bearer\s+/i, "").replace(/^"|"$/g, "");
  await chrome.storage.local.set({ token: v, tokenSyncedAt: Date.now() });
  $("#token").value = "";
  toast("Сохранено", "ok");
  refresh();
});

$("#clear").addEventListener("click", async () => {
  await chrome.storage.local.remove(["token", "analyticToken", "tokenSyncedAt"]);
  toast("Очищено");
  refresh();
});

refresh();
