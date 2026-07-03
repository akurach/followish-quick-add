const $ = (s) => document.querySelector(s);

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

// ---- Runs INSIDE the product page (injected). Must be self-contained. ----
function pageExtract() {
  const attr = (sel, a) => {
    const el = document.querySelector(sel);
    return el ? (a ? el.getAttribute(a) : el.textContent) : null;
  };
  const meta = (p) =>
    attr(`meta[property="${p}"]`, "content") ||
    attr(`meta[name="${p}"]`, "content");

  // 1) JSON-LD Product (most reliable, present on Ozon/WB/most stores)
  let ld = null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      const arr = Array.isArray(j) ? j : j["@graph"] || [j];
      for (const node of arr) {
        const t = node && node["@type"];
        if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) {
          ld = node;
          break;
        }
      }
    } catch {}
    if (ld) break;
  }
  const offers = ld && (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers);

  const toNum = (v) => {
    if (v == null) return "";
    const m = String(v).replace(/ /g, " ").match(/\d[\d\s.]*/);
    return m ? m[0].replace(/[\s.]/g, "") : "";
  };

  let name = (ld && ld.name) || meta("og:title") || document.title || "";
  let image =
    (ld && (Array.isArray(ld.image) ? ld.image[0] : ld.image)) ||
    meta("og:image") ||
    "";
  let price =
    (offers && offers.price) ||
    meta("product:price:amount") ||
    meta("og:price:amount") ||
    attr('[itemprop="price"]', "content") ||
    attr('[itemprop="price"]') ||
    "";
  let currency =
    (offers && offers.priceCurrency) ||
    meta("product:price:currency") ||
    meta("og:price:currency") ||
    "";

  // Clean marketplace tails from the title.
  name = name
    .replace(
      /\s*[—|\-]\s*(купить|доставка|цена|отзывы|характеристики|Ozon|OZON|Wildberries|Яндекс[\s.]?Маркет|интернет-магазин|официальный).*$/i,
      ""
    )
    .replace(/\s+купить в[^,—|]*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // --- Multi-variant (Tilda store): every product block is a pickable variant. ---
  // Editions can live in tabs and are all present in the DOM at once, so there is
  // no reliable "active" one — we surface them all and let the user choose.
  const variants = [];
  const vseen = new Set();
  for (const b of document.querySelectorAll(".js-store-product, [data-product-lid]")) {
    const pv = b.querySelector('.js-store-prod-price-val, [field="price"]');
    const vprice = pv && toNum(pv.textContent);
    if (!vprice) continue; // skip blocks without a real price
    if (b.closest(".t-store__card")) continue; // skip accessory upsell cards
    const vn = (
      b.querySelector(
        '.js-product-name, .t744__title, .js-store-prod-name, .t-store__card__title, [field="title"]'
      ) || {}
    ).textContent;
    const vname = vn && vn.trim();
    if (!vname) continue;
    const key = vname + "|" + vprice;
    if (vseen.has(key)) continue;
    vseen.add(key);
    // this block's own gallery (data-original on slides + thumbnails)
    const gimgs = [];
    b.querySelectorAll("[data-original]").forEach((e) => {
      const u = e.getAttribute("data-original");
      if (u && /^https?:\/\//.test(u)) gimgs.push(u);
    });
    const dImg = b.getAttribute("data-product-img");
    if (dImg) gimgs.unshift(dImg);
    variants.push({
      name: vname,
      price: vprice,
      currency: "RUB",
      image: gimgs[0] || "",
      images: [...new Set(gimgs)].slice(0, 18),
    });
  }

  // Real product variants beat the generic OG guess (which points at the first
  // slide / a shared image). Default to the first; the popup lets the user switch.
  if (variants.length) {
    name = variants[0].name;
    price = variants[0].price;
    image = variants[0].image || image;
  }

  // --- Site adapters: reliable name/price/image for sites without JSON-LD and
  //     with build-hashed price classes. Reads <title>/OG (stable), not classes. ---
  const H = location.hostname;
  const ogt = meta("og:title") || "";
  const dt = document.title || "";
  let adapterImages = null;

  if (/(^|\.)auto\.ru$/.test(H)) {
    let nm = dt
      .replace(/^Купить\s+(?:новый|подержанн\w+|б\/у)\s+/i, "")
      .replace(/\s+в\s+[^:]+:.*$/, "")
      .trim();
    if (!nm)
      nm = ogt
        .replace(/^Смотрите[^:]*:\s*/i, "")
        .replace(/\s+за\s+[\d\s ]+.*$/i, "")
        .trim();
    if (nm) name = nm;
    const pm =
      ogt.match(/за\s+([\d\s ]+)\s*(?:₽|руб)/i) ||
      dt.match(/по цене\s+([\d\s ]+)\s*(?:₽|руб)/i);
    if (pm) price = pm[1];
  } else if (/(^|\.)(wildberries|wb)\.ru$/.test(H)) {
    const nm = dt
      .replace(/\s*\d*\s*купить за[\s\S]*$/i, "")
      .replace(/\s+в интернет.?магазине\s+Wildberries\s*$/i, "")
      .replace(/\s+\d{6,}$/, "")
      .trim();
    if (nm) name = nm;
    const pm = dt.match(/купить за\s+([\d\s ]+)\s*₽/i);
    if (pm) price = pm[1];
    const big = [
      ...document.querySelectorAll('img[src*="wbbasket"], img[src*="/images/big/"]'),
    ]
      .map((i) => i.currentSrc || i.src)
      .filter((u) => /\/images\/big\//.test(u));
    if (big.length) {
      image = big[0];
      adapterImages = [...new Set(big)];
    }
  }

  price = toNum(price);

  if (!currency) {
    if (/\.ru$|ozon|wildberries|market\.yandex|\bдоставка\b/i.test(location.hostname + " " + document.title)) {
      currency = "RUB";
    }
  }
  currency = (currency || "RUB").toUpperCase().replace("RUR", "RUB");

  // Clean tracking params off the URL.
  let url = attr('link[rel="canonical"]', "href") || location.href;
  try {
    const u = new URL(url);
    [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "oos_search", "__rr", "_bctid", "sh", "from",
    ].forEach((p) => u.searchParams.delete(p));
    url = u.toString();
  } catch {}

  // Collect candidate images so the user can pick the right one.
  const seen = new Set();
  const images = [];
  const junk = /logo|sprite|icon|favicon|placeholder|banner|payment|badge|wb-og|\.svg(\?|$)/i;
  const pushImg = (u) => {
    if (!u) return;
    u = String(u).trim().replace(/ /g, "%20"); // encode stray spaces in URLs
    if (!/^https?:\/\//i.test(u) || junk.test(u)) return;
    const key = u.split("?")[0];
    if (seen.has(key)) return;
    seen.add(key);
    images.push(u);
  };
  const bestSrc = (img) => {
    if (img.getAttribute("data-original")) return img.getAttribute("data-original");
    if (img.srcset) {
      const last = img.srcset.split(",").pop().trim().split(" ")[0];
      if (last) return last;
    }
    return img.currentSrc || img.src;
  };

  pushImg(image); // current best guess first
  // The selected variant's gallery comes first.
  if (variants.length) variants[0].images.forEach(pushImg);
  if (adapterImages) adapterImages.forEach(pushImg);
  if (ld && ld.image)
    (Array.isArray(ld.image) ? ld.image : [ld.image]).forEach(pushImg);
  pushImg(meta("og:image"));
  pushImg(meta("twitter:image"));
  // Full-size gallery images exposed as links (OpenCart, lightboxes) or lazy <img>.
  for (const a of document.querySelectorAll("a[href]")) {
    const h = a.getAttribute("href");
    if (h && /\.(jpe?g|png|webp)(\?|$)/i.test(h)) pushImg(h);
  }
  document
    .querySelectorAll("img[data-src], img[data-original]")
    .forEach((im) => pushImg(im.getAttribute("data-src") || im.getAttribute("data-original")));
  for (const img of document.querySelectorAll("img")) {
    const w = img.naturalWidth || parseInt(img.getAttribute("width")) || 0;
    const h = img.naturalHeight || parseInt(img.getAttribute("height")) || 0;
    if ((w && w < 150) || (h && h < 150)) continue;
    pushImg(bestSrc(img));
    if (images.length > 24) break;
  }

  return {
    name,
    image: images[0] || image || "",
    images: images.slice(0, 18),
    variants,
    price: price || "",
    currency,
    storeLink: url,
    host: location.hostname,
  };
}
// ------------------------------------------------------------------------

function updateThumb() {
  const src = $("#image").value.trim();
  const t = $("#thumb");
  if (src) t.setAttribute("src", src);
  else t.removeAttribute("src");
  // sync gallery highlight
  document.querySelectorAll("#gallery img").forEach((im) => {
    im.classList.toggle("sel", im.dataset.url === src);
  });
}

function applyVariant(v) {
  $("#name").value = v.name || "";
  $("#price").value = v.price || "";
  if (v.currency) $("#currency").value = v.currency;
  const imgs = v.images && v.images.length ? v.images : v.image ? [v.image] : [];
  $("#image").value = imgs[0] || "";
  renderGallery(imgs);
  updateThumb();
}

function renderVariants(variants) {
  const box = $("#variants");
  box.innerHTML = "";
  if (!variants || variants.length < 2) return; // nothing to choose
  variants.forEach((v, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `${v.name} <span class="vp">${Number(v.price).toLocaleString(
      "ru-RU"
    )}</span>`;
    b.title = v.name;
    b.classList.toggle("sel", i === 0);
    b.addEventListener("click", () => {
      box.querySelectorAll("button").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      applyVariant(v);
    });
    box.appendChild(b);
  });
}

// Use a small variant for the strip so we don't burst-load full-size images —
// some servers (OpenCart/chipgifts) drop connections on many big parallel GETs.
function smallThumb(url) {
  return url.replace(/-\d{3,4}x\d{3,4}(\.[a-z]+)(\?|$)/i, "-200x200$1$2");
}

function renderGallery(images) {
  const g = $("#gallery");
  g.innerHTML = "";
  (images || []).forEach((url) => {
    const im = document.createElement("img");
    im.loading = "lazy";
    im.decoding = "async";
    im.src = smallThumb(url);
    im.dataset.url = url; // full-size URL is what gets saved
    im.title = "Выбрать эту картинку";
    im.addEventListener("error", () => im.remove()); // drop broken thumbs
    im.addEventListener("click", () => {
      $("#image").value = url;
      updateThumb();
    });
    g.appendChild(im);
  });
}

// ---------- UI state + toast ----------
function showState(which) {
  ["loading", "need-login", "form"].forEach((id) =>
    $("#" + id).classList.toggle("hidden", id !== which)
  );
}

let toastTimer;
function toast(msg, type) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2600);
}

$("#image").addEventListener("input", updateThumb);

async function init() {
  showState("loading");

  const me = await send({ type: "me" });
  if (!me || !me.ok) {
    if (me && /NO_TOKEN|401/.test(me.error || "")) showState("need-login");
    else {
      showState("form");
      toast("Ошибка авторизации: " + (me && me.error), "err");
    }
    return;
  }
  $("#who").textContent = me.data.name || "";

  // Wishlists
  const wl = await send({ type: "wishlists", userLink: me.data.userLink });
  const sel = $("#wishlist");
  const { defaultWishlist } = await chrome.storage.local.get(["defaultWishlist"]);
  if (wl && wl.ok && Array.isArray(wl.data)) {
    for (const w of wl.data) {
      const o = document.createElement("option");
      o.value = w.linkKey;
      o.textContent = `${w.name} · ${w.presentsCount ?? 0}`;
      sel.appendChild(o);
    }
    const inbox = wl.data.find((w) => /инбокс/i.test(w.name));
    sel.value = defaultWishlist || (inbox && inbox.linkKey) || sel.value;
  }

  // Extract from the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  showState("form");
  if (/^(chrome|edge|about|chrome-extension|view-source|file):/i.test(url)) {
    $("#storeLink").value = "";
    toast("Служебная страница — впиши данные вручную");
    return;
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageExtract,
    });
    $("#name").value = result.name || "";
    $("#price").value = result.price || "";
    $("#currency").value = result.currency || "RUB";
    $("#image").value = result.image || "";
    $("#storeLink").value = result.storeLink || url;
    renderVariants(result.variants);
    renderGallery(result.images);
    updateThumb();
    if (!result.name) toast("Название не нашлось — впиши сам");
  } catch (e) {
    $("#storeLink").value = url;
    toast("Не смог прочитать страницу — заполни вручную");
  }
}

async function submit() {
  const save = $("#save");
  const present = {
    name: $("#name").value.trim(),
    price: ($("#price").value.match(/\d+/g) || []).join(""),
    currency: $("#currency").value,
    storeLink: $("#storeLink").value.trim(),
    imageLink: $("#image").value.trim(),
    description: $("#comment").value.trim() || null,
    desireLevel: Number($("#desire").value) || 0,
  };
  if (!present.name) {
    toast("Впиши название", "err");
    $("#name").focus();
    return;
  }
  const linkKey = $("#wishlist").value;
  if (!linkKey) {
    toast("Нет вишлиста", "err");
    return;
  }
  chrome.storage.local.set({ defaultWishlist: linkKey });

  save.disabled = true;
  const original = save.innerHTML;
  save.textContent = "Сохраняю…";
  const r = await send({ type: "create", linkKey, present });
  if (r && r.ok) {
    toast("Добавлено в Followish ✓", "ok");
    setTimeout(() => window.close(), 800);
  } else {
    if (/NO_TOKEN|401/.test((r && r.error) || "")) {
      toast("Сессия истекла — открой followish.io", "err");
      setTimeout(() => showState("need-login"), 500);
    } else {
      toast("Ошибка: " + (r && r.error), "err");
    }
    save.disabled = false;
    save.innerHTML = original;
  }
}

$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    submit();
  }
});

init();
