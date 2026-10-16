/* Collector Coins floating panel. Talks to the app through the Shopify app proxy at /apps/coins. */
(function () {
  var root = document.getElementById("ccp-root");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";

  var cfg = root.dataset;
  var signedIn = cfg.signedIn === "true";
  var COIN = cfg.coin;
  var state = null;
  var view = "home";
  var flash = null; // { type: "ok" | "err", html }
  var busy = false;
  var discountDollars = 1;

  // ---- design (colors, wording, what shows), set in the app under Panel design ----
  var DEFAULT_DESIGN = {
    colors: { primary: "#e22f39", primaryDark: "#b81d27", accent: "#ffd800", dark: "#1a1a1a", background: "#f1eee4" },
    launcher: { label: "", mobileButton: true, mobileSide: "chat" },
    text: {
      signedOutTitle: "Collector Coins",
      signedOutIntro: "Earn coins every time you shop, then trade them for free cards and discounts.",
      joinTitle: "Join free, get $5 off",
      joinBody: "Your welcome code works on any order of $20 or more.",
      joinButton: "Join free",
      signInButton: "Sign in",
      greeting: "Hi {name}",
      alertsTitle: "Never Miss A Drop",
      alertsBody: "Get a text and email when new sets drop, hot items restock and pre-orders open. Join and we\u2019ll add {coins} Collector Coins.",
      alertsButton: "Turn On Alerts \u00b7 +{coins} Coins",
      tierNote: "Once you reach a tier, you keep it.",
    },
    sections: { promo: true, tiers: true, prizesSignedOut: true },
  };
  function mergeDesign(d) {
    var out = JSON.parse(JSON.stringify(DEFAULT_DESIGN));
    if (!d || typeof d !== "object") return out;
    ["colors", "launcher", "text", "sections"].forEach(function (g) {
      if (!d[g]) return;
      Object.keys(out[g]).forEach(function (k) { if (d[g][k] !== undefined && d[g][k] !== "") out[g][k] = d[g][k]; });
    });
    return out;
  }
  var savedDesign = null;
  try { var cfgEl = document.getElementById("ccp-config"); if (cfgEl) savedDesign = JSON.parse(cfgEl.textContent || "null"); } catch (e) {}
  var design = mergeDesign(savedDesign);
  function applyColors() {
    var c = design.colors;
    root.style.setProperty("--ccp-red", c.primary);
    root.style.setProperty("--ccp-red-dark", c.primaryDark);
    root.style.setProperty("--ccp-yellow", c.accent);
    root.style.setProperty("--ccp-dark", c.dark);
    root.style.setProperty("--ccp-bg", c.background);
  }
  applyColors();
  function fill(t, vars) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] === undefined ? m : vars[k]; }); }

  // ---- usage tracking for the Engagement page (which buttons people use); no personal details are sent ----
  var visitor = null;
  try { visitor = localStorage.getItem("ccp-v"); if (!visitor) { visitor = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem("ccp-v", visitor); } } catch (e) {}
  var trackQueue = [], trackTimer = null;
  function track(event, target) {
    trackQueue.push({ event: event, target: target, path: location.pathname });
    if (!trackTimer) trackTimer = setTimeout(flushTrack, 1500);
  }
  function flushTrack() {
    clearTimeout(trackTimer); trackTimer = null;
    if (!trackQueue.length) return;
    var body = JSON.stringify({ visitor: visitor, events: trackQueue.splice(0, 20) });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(cfg.proxy + "/track", new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    try { fetch(cfg.proxy + "/track", { method: "POST", body: body, keepalive: true, credentials: "same-origin" }).catch(function () {}); } catch (e) {}
  }
  window.addEventListener("pagehide", flushTrack);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushTrack(); });

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function n(x) { return Number(x || 0).toLocaleString("en-US"); }
  function money(cents) { var v = cents / 100; return "$" + (v % 1 === 0 ? v : v.toFixed(2)); }
  function coin(x) { return '<span class="ccp-cost"><img src="' + esc(COIN) + '" alt="" width="16" height="16">' + n(x) + "</span>"; }
  function date(d) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

  // ---- shell ----
  root.innerHTML =
    '<div class="ccp-panel" role="dialog" aria-label="Collector Coins"><div class="ccp-head"></div><div class="ccp-tabs"></div><div class="ccp-body"></div></div>' +
    '<button type="button" class="ccp-launcher" aria-label="Open Collector Coins"><img src="' + esc(COIN) + '" alt=""><span>' + esc(design.launcher.label || cfg.label || "Collector Coins") + '</span><span class="ccp-launcher-bal" hidden></span></button>';
  if (cfg.hideLauncher === "true") root.classList.add("ccp-no-launcher");
  var $head = root.querySelector(".ccp-head");
  var $tabs = root.querySelector(".ccp-tabs");
  var $body = root.querySelector(".ccp-body");
  var $bal = root.querySelector(".ccp-launcher-bal");

  root.querySelector(".ccp-launcher").addEventListener("click", function () { root.classList.contains("ccp-open") ? close() : open("home", "launcher"); });

  function open(v, source) {
    view = v || "home";
    if (!root.classList.contains("ccp-open")) { track("open", source || "link"); track("tab", view); }
    root.classList.add("ccp-open");
    if (!state) load(); else render();
  }
  function close() { root.classList.remove("ccp-open"); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  // ---- data ----
  function api(path, body) {
    var opts = body
      ? { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }
      : { headers: { Accept: "application/json" }, credentials: "same-origin" };
    return fetch(cfg.proxy + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 404 && j.hidden) { root.remove(); throw new Error("hidden"); }
        if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
        return j;
      });
    });
  }
  function load() {
    $head.innerHTML = "<h2>Collector Coins</h2><p>Loading&hellip;</p>";
    $tabs.innerHTML = "";
    $body.innerHTML = '<p class="ccp-empty">Loading your coins&hellip;</p>';
    api("/me").then(function (s) { state = s; useDesign(); updateLauncher(); render(); }).catch(function (e) {
      if (e.message === "hidden") return;
      $body.innerHTML = '<div class="ccp-err">' + esc(e.message) + "</div>";
    });
  }
  function updateLauncher() {
    if (state && state.member) { $bal.hidden = false; $bal.textContent = n(state.member.balance); }
  }
  function useDesign() {
    if (!state || !state.design) return;
    design = mergeDesign(state.design);
    applyColors();
    var lab = root.querySelector(".ccp-launcher > span:not(.ccp-launcher-bal)");
    if (lab && design.launcher.label) lab.textContent = design.launcher.label;
    if (typeof fab !== "undefined" && fab) { fab.hidden = !design.launcher.mobileButton; if (typeof schedulePlace === "function") schedulePlace(); }
  }
  if (signedIn) api("/me").then(function (s) { state = s; useDesign(); updateLauncher(); if (root.classList.contains("ccp-open")) render(); }).catch(function () {});

  // ---- render ----
  function render() {
    if (!state) return;
    var m = state.member;
    if (!m) {
      $head.innerHTML = '<button class="ccp-close" aria-label="Close">&times;</button><h2>' + esc(design.text.signedOutTitle) + "</h2><p>" + esc(design.text.signedOutIntro) + "</p>";
      $tabs.innerHTML = "";
      $body.innerHTML = promoBanner() + signedOut();
    } else {
      var next = m.next;
      var pct = next ? Math.max(0, Math.min(100, Math.round((100 * (m.lifetimeEarned - tierThreshold(m.tier))) / (next.threshold - tierThreshold(m.tier))))) : 100;
      $head.innerHTML =
        '<button class="ccp-close" aria-label="Close">&times;</button>' +
        "<h2>" + (m.firstName ? esc(fill(design.text.greeting, { name: m.firstName })) : "Collector Coins") + "</h2>" +
        '<div class="ccp-bal"><img src="' + esc(COIN) + '" alt=""><div><strong>' + n(m.balance) + "</strong><br><span>Collector Coins</span></div></div>" +
        '<div class="ccp-tierline">' + tierIcon(m.tier, false) + "<div><b>" + esc(m.tierName) + "</b> &middot; " + m.earnRate + " coins per $1<br><span>" +
        (next ? n(next.coinsToGo) + " coins to " + esc(next.name) : "Top tier reached") + "</span></div></div>" +
        '<div class="ccp-bar"><i style="width:' + pct + '%"></i></div>';
      var tabs = [["home", "Earn"], ["rewards", "Redeem"], ["codes", "My codes"], ["activity", "History"]];
      $tabs.innerHTML = tabs.map(function (t) {
        return '<button type="button" data-view="' + t[0] + '" class="' + (view === t[0] ? "ccp-on" : "") + '">' + t[1] + "</button>";
      }).join("");
      var html = flash ? '<div class="' + (flash.type === "ok" ? "ccp-ok" : "ccp-err") + '">' + flash.html + "</div>" : "";
      if (view === "rewards") html += rewardsView(m);
      else if (view === "codes") html += codesView(m);
      else if (view === "activity") html += activityView(m);
      else html += promoBanner() + homeView(m);
      $body.innerHTML = html;
    }
    var c = $head.querySelector(".ccp-close");
    if (c) c.addEventListener("click", close);
  }

  // A running coin promotion (e.g. 3x coins on Digital Mystery Packs), shown at the top of the Earn tab.
  function promoBanner() {
    var p = state && state.program && state.program.promotion;
    if (!design.sections.promo) return "";
    if (!p || Date.now() >= Date.parse(p.endsAt)) return "";
    return '<a class="ccp-promo" data-track="promo" href="' + esc(p.url) + '"><span class="ccp-promo-x">' + esc(p.multiplier) + "x</span>" +
      '<span class="ccp-grow"><span class="ccp-promo-t">' + esc(p.headline) + '</span><span class="ccp-d">' + esc(p.blurb) + " " + esc(p.endsText) + ".</span></span>" +
      '<span class="ccp-promo-go" aria-hidden="true">&rsaquo;</span></a>';
  }

  function tierThreshold(key) {
    var t = state.program.tiers.filter(function (x) { return x.key === key; })[0];
    return t ? t.threshold : 0;
  }

  var ICONS = {
    purchase: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    review: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
    google: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M12 8l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 10.3l2-.3 1-2z"/>',
    alerts: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    birthday: '<rect x="4" y="10" width="16" height="10" rx="1"/><path d="M4 14h16M12 10v10M12 10c-2-3-5-3-5-1s3 1 5 1zm0 0c2-3 5-3 5-1s-3 1-5 1z"/>',
  };
  function icon(key) {
    return '<span class="ccp-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' + (ICONS[key] || ICONS.purchase) + "</svg></span>";
  }
  function h(title) { return '<h3 class="ccp-h"><span>' + esc(title) + "</span></h3>"; }

  // Tier icon: the image chosen in the theme editor (App embeds > Collector Coins panel > Tier icons), else a lettered badge.
  function tierIcon(key, big) {
    var url = cfg["icon" + key.charAt(0).toUpperCase() + key.slice(1)];
    var cls = "ccp-ticon" + (big ? " ccp-ticon-lg" : "");
    if (url) return '<img class="' + cls + '" src="' + esc(url) + '" alt="">';
    return '<span class="' + cls + " ccp-tb-" + esc(key) + '" aria-hidden="true">' + esc(key.charAt(0).toUpperCase()) + "</span>";
  }

  function signedOut() {
    var p = state.program;
    return (
      '<div class="ccp-join"><div class="ccp-join-t">' + esc(design.text.joinTitle) + '</div><div class="ccp-d">' + esc(design.text.joinBody) + "</div>" +
      '<div class="ccp-row" style="margin-top:12px"><a class="ccp-btn ccp-btn-red ccp-btn-block" data-track="join" href="' + esc(cfg.registerUrl) + '">' + esc(design.text.joinButton) + "</a>" +
      '<a class="ccp-btn ccp-btn-dark ccp-btn-block" data-track="signin" href="' + esc(cfg.loginUrl) + '">' + esc(design.text.signInButton) + "</a></div></div>" +
      h("Ways to earn") + earnList(p) +
      (design.sections.tiers ? h("Tiers") + tierGrid(p, null) : "") +
      (state.prizes.length && design.sections.prizesSignedOut ? h("Prizes right now") + state.prizes.slice(0, 6).map(function (z) { return prizeCard(z, null); }).join("") : "") +
      (cfg.landingUrl ? '<p class="ccp-more"><a data-track="landing" href="' + esc(cfg.landingUrl) + '">How Collector Coins works &rarr;</a></p>' : "")
    );
  }

  function earnList(p) {
    return p.waysToEarn.map(function (w) {
      var link = w.url ? ' <a href="' + esc(w.url) + '" target="_blank" rel="noopener" data-track="' + esc(w.key) + '">Write a review</a>' : "";
      return '<div class="ccp-card ccp-earn">' + icon(w.key) + '<div class="ccp-grow"><div class="ccp-t">' + esc(w.title) + '</div><div class="ccp-d">' + esc(w.detail) + link + "</div></div>" +
        (w.badge ? '<span class="ccp-pill">' + esc(w.badge) + "</span>" : "") + "</div>";
    }).join("");
  }

  function tierGrid(p, current) {
    return '<div class="ccp-tiers">' + p.tiers.map(function (t) {
      var here = t.key === current;
      return '<div class="ccp-tier' + (here ? " ccp-here" : "") + '">' + (here ? '<span class="ccp-you">Your tier</span>' : "") +
        tierIcon(t.key, true) + '<b>' + esc(t.name) + "</b>" +
        '<span class="ccp-tier-need">' + (t.threshold ? n(t.threshold) + " coins earned" : "Join free") + "</span>" +
        '<span class="ccp-tier-rate">' + t.earnRate + "<small> coins / $1</small></span>" +
        '<span class="ccp-tier-reward">' + esc(t.reward) + "</span></div>";
    }).join("") + '</div><p class="ccp-note">' + esc(design.text.tierNote) + "</p>";
  }

  function homeView(m) {
    var b = m.birthday
      ? '<div class="ccp-card ccp-earn">' + icon("birthday") + '<div class="ccp-grow"><div class="ccp-t">Your birthday</div><div class="ccp-d">Saved: ' + MONTHS[m.birthday.month - 1] + " " + m.birthday.day + "</div></div></div>"
      : '<div class="ccp-card ccp-earn ccp-earn-col"><div class="ccp-earn-top">' + icon("birthday") + '<div class="ccp-grow"><div class="ccp-t">Add your birthday</div><div class="ccp-d">Ultra and Master Tier members get birthday coins.</div></div></div>' +
        '<div class="ccp-bday"><select data-bday="month" aria-label="Month">' + MONTHS.map(function (x, i) { return '<option value="' + (i + 1) + '">' + x + "</option>"; }).join("") +
        '</select><select data-bday="day" aria-label="Day">' + Array.from({ length: 31 }, function (_, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + "</option>"; }).join("") +
        '</select><button type="button" class="ccp-btn" data-act="birthday">Save</button></div></div>';
    return alertsCard(m) + h("Ways to earn") + earnList(state.program) + b + (design.sections.tiers ? h("Tiers") + tierGrid(state.program, m.tier) : "");
  }

  // Text + email alerts sign-up: 200 coins, once per account.
  function alertsCard(m) {
    if (m.alertsClaimed || !state.program.alertsEnabled) return "";
    var coins = n(state.program.alertsCoins || 200);
    return '<div class="ccp-card ccp-alerts">' +
      '<div class="ccp-earn-top">' + icon("alerts") + '<div class="ccp-grow"><div class="ccp-t">' + esc(design.text.alertsTitle) + "</div>" +
      '<div class="ccp-d">' + esc(fill(design.text.alertsBody, { coins: coins })) + "</div></div>" +
      '<span class="ccp-pill">+' + coins + "</span></div>" +
      '<input class="ccp-input" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="Mobile number" data-alerts="phone" aria-label="Mobile number">' +
      '<label class="ccp-consent"><input type="checkbox" data-alerts="consent"> <span>Yes, send me texts and emails. I agree to receive recurring automated marketing texts and emails from Poke-Collect, including drop and restock alerts, at the number' +
      (m.email ? " and email (" + esc(m.email) + ")" : " and email") + ' provided. Consent is not a condition of purchase. Msg &amp; data rates may apply. Msg frequency varies. Reply HELP for help or STOP to cancel. See our <a href="/policies/terms-of-service" target="_blank">Terms</a> and <a href="/policies/privacy-policy" target="_blank">Privacy Policy</a>.</span></label>' +
      '<button type="button" class="ccp-btn ccp-btn-red ccp-btn-block" data-act="alerts"' + (busy ? " disabled" : "") + ">" + esc(fill(design.text.alertsButton, { coins: coins })) + "</button></div>";
  }

  function prizeCard(z, m) {
    var can = m && m.balance >= z.coins;
    var btn = m ? '<button type="button" class="ccp-btn' + (can ? "" : " ccp-btn-ghost") + '" data-act="prize" data-id="' + esc(z.productId) + '"' + (can && !busy ? "" : " disabled") + ">" + (can ? "Redeem" : "Need " + n(z.coins - m.balance)) + "</button>" : "";
    var img = z.image ? '<img src="' + esc(z.image + (z.image.indexOf("?") < 0 ? "?" : "&") + "width=160") + '" alt="" loading="lazy">' : '<span class="ccp-noimg"></span>';
    return '<div class="ccp-card ccp-prize">' + img +
      '<div class="ccp-grow"><a class="ccp-t" data-track="prize" href="' + esc(z.url) + '">Free ' + esc(z.title) + "</a>" + coin(z.coins) + "</div>" + btn + "</div>";
  }

  function rewardsView(m) {
    var maxDollars = Math.floor(m.balance / state.program.coinsPerDollarOff);
    if (discountDollars > maxDollars) discountDollars = Math.max(1, maxDollars);
    var disc = '<div class="ccp-card ccp-discount"><div class="ccp-t">Order discount</div><div class="ccp-d">' +
      n(state.program.coinsPerDollarOff) + " coins = $1 off any order</div>";
    if (maxDollars >= 1) {
      disc += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span class="ccp-amt" data-amt>$' + discountDollars + " off</span>" +
        '<span data-amt-coins>' + coin(discountDollars * state.program.coinsPerDollarOff) + "</span></div>" +
        '<input type="range" min="1" max="' + maxDollars + '" value="' + discountDollars + '" data-discount aria-label="Dollars off">' +
        '<button type="button" class="ccp-btn ccp-btn-red ccp-btn-block" data-act="discount"' + (busy ? " disabled" : "") + ">Get my code</button>";
    } else {
      disc += '<p class="ccp-note">You need ' + n(state.program.coinsPerDollarOff - m.balance) + " more coins for $1 off.</p>";
    }
    disc += "</div>";
    var prizes = state.prizes.length
      ? state.prizes.map(function (z) { return prizeCard(z, m); }).join("")
      : '<p class="ccp-empty">No prizes in stock right now. Check back soon.</p>';
    return h("Discounts") + disc + h("Free prizes") + prizes + expiryNote(m);
  }

  function codesView(m) {
    if (!m.rewards.length) return '<p class="ccp-empty">No codes yet. Redeem coins to get one.</p>';
    return h("My codes") + m.rewards.map(function (r) {
      return '<div class="ccp-card ccp-codecard"><div class="ccp-grow"><div class="ccp-t">' + esc(r.title) + '</div><div style="margin:6px 0"><span class="ccp-code">' + esc(r.code) +
        '</span></div><div class="ccp-d">' + date(r.createdAt) + (r.kind === "gift_card" ? " &middot; Gift card, enter at checkout" : " &middot; Enter at checkout") + "</div></div>" +
        '<button type="button" class="ccp-btn ccp-btn-dark" data-act="copy" data-code="' + esc(r.code) + '">Copy</button></div>';
    }).join("") + '<p class="ccp-note">Each code works once and only on your account.</p>';
  }

  function expiryNote(m) {
    if (!m.expiresOn) return "";
    return '<p class="ccp-note">Coins expire after ' + state.program.expiryMonths + " months with no orders or redemptions. Yours are good until " + date(m.expiresOn) + ".</p>";
  }

  function activityView(m) {
    if (!m.activity.length) return '<p class="ccp-empty">No activity yet.</p>' + expiryNote(m);
    return expiryNote(m) + h("History") + '<div class="ccp-card ccp-list">' + m.activity.map(function (a) {
      return '<div class="ccp-act"><div>' + esc(a.description) + "<small>" + date(a.createdAt) + '</small></div><div class="' + (a.amount >= 0 ? "ccp-plus" : "ccp-minus") + '">' +
        (a.amount > 0 ? "+" : "") + n(a.amount) + "</div></div>";
    }).join("") + "</div>";
  }

  // ---- actions ----
  $tabs.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (!b) return;
    view = b.dataset.view; flash = null; track("tab", view); render(); $body.scrollTop = 0;
  });

  $body.addEventListener("input", function (e) {
    if (!e.target.matches("[data-discount]")) return;
    discountDollars = Number(e.target.value);
    $body.querySelector("[data-amt]").textContent = "$" + discountDollars + " off";
    $body.querySelector("[data-amt-coins]").innerHTML = coin(discountDollars * state.program.coinsPerDollarOff);
  });

  $body.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (act === "copy") {
      track("click", "copy");
      copy(b.dataset.code); b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500);
      return;
    }
    if (busy) return;
    if (act === "discount") {
      if (!confirm("Spend " + n(discountDollars * state.program.coinsPerDollarOff) + " coins on $" + discountDollars + " off?")) return;
      track("submit", "discount");
      redeem({ type: "discount", dollars: discountDollars });
    } else if (act === "prize") {
      var z = state.prizes.filter(function (p) { return p.productId === b.dataset.id; })[0];
      if (!z || !confirm("Spend " + n(z.coins) + " coins on Free " + z.title + "?")) return;
      track("submit", "prize");
      redeem({ type: "prize", productId: z.productId });
    } else if (act === "alerts") {
      var phone = $body.querySelector('[data-alerts="phone"]').value;
      var consent = $body.querySelector('[data-alerts="consent"]').checked;
      track("submit", "alerts");
      if (!consent) { flash = { type: "err", html: "Check the box to agree to texts and emails." }; render(); return; }
      busy = true; render();
      api("/alerts", { phone: phone, consent: true })
        .then(function (r) { state = r.state; updateLauncher(); flash = { type: "ok", html: "<b>Alerts are on!</b> We added " + n(r.coins) + " Collector Coins to your account." }; })
        .catch(function (err) { flash = { type: "err", html: esc(err.message) }; })
        .then(function () { busy = false; render(); $body.scrollTop = 0; });
    } else if (act === "birthday") {
      var mo = $body.querySelector('[data-bday="month"]').value, d = $body.querySelector('[data-bday="day"]').value;
      track("click", "birthday");
      if (!confirm("Save " + MONTHS[mo - 1] + " " + d + " as your birthday? It can only be set once.")) return;
      busy = true;
      api("/birthday", { month: Number(mo), day: Number(d) })
        .then(function (r) { state = r.state; flash = { type: "ok", html: "Birthday saved." }; })
        .catch(function (err) { flash = { type: "err", html: esc(err.message) }; })
        .then(function () { busy = false; render(); });
    }
  });

  // Links and fields inside the panel that are worth counting
  root.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-track]");
    if (a && root.contains(a)) track("click", a.getAttribute("data-track"));
  });
  var alertsStarted = false;
  $body.addEventListener("focusin", function (e) {
    if (!alertsStarted && e.target.matches && e.target.matches('[data-alerts="phone"]')) { alertsStarted = true; track("click", "alerts"); }
  });

  function redeem(body) {
    busy = true; render();
    api("/redeem", body)
      .then(function (r) {
        state = r.state; updateLauncher(); view = "codes";
        flash = { type: "ok", html: "<b>" + esc(r.reward.title) + '</b><br>Your code: <span class="ccp-code">' + esc(r.reward.code) + "</span><br>Enter it at checkout. It's saved here under My codes." };
      })
      .catch(function (err) { flash = { type: "err", html: esc(err.message) }; })
      .then(function () { busy = false; render(); $body.scrollTop = 0; });
  }

  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
  }


  // ---- page promo banners: <... data-ccp-promo data-starts="ISO" data-ends="ISO" style="display:none"> ----
  (function () {
    var now = Date.now();
    document.querySelectorAll("[data-ccp-promo]").forEach(function (el) {
      var s = Date.parse(el.getAttribute("data-starts") || ""), e = Date.parse(el.getAttribute("data-ends") || "");
      if ((!s || now >= s) && e && now < e) el.style.display = "";
    });
  })();

  // ---- links: #coins-home, #coins-rewards, #coins-register, #coins-sign-in (and old #smile- links) ----
  var LINK_VIEWS = { home: "home", "points-activity-rules": "home", "points-balance": "home", redeem: "rewards", rewards: "rewards", "my-rewards": "codes", codes: "codes", activity: "activity", history: "activity" };
  function viewForLink(a) {
    var href = a.getAttribute("href") || "";
    var m = href.match(/#(?:coins|smile)-([\w-]+)/) || href.match(/smile_deep_link=([\w-]+)/);
    return m ? m[1] : null;
  }
  if (cfg.takeOver === "true") {
    window.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      var key = viewForLink(a);
      if (!key) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!signedIn && (key === "register" || key === "join")) { location.href = cfg.registerUrl; return; }
      if (!signedIn && (key === "sign-in" || key === "login")) { location.href = cfg.loginUrl; return; }
      open(LINK_VIEWS[key] || "home");
    }, true);
  }
  var startKey = (location.hash.match(/^#coins-([\w-]+)/) || [])[1];
  if (startKey) open(LINK_VIEWS[startKey] || "home", "hash");


  // ---- keep the floating button clear of the site's own fixed UI (cart drawer, sticky add-to-cart bars) ----
  var launcher = root.querySelector(".ccp-launcher");
  var baseBottom = null;
  function isFixed(el) {
    for (var e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      var pos = getComputedStyle(e).position;
      if (pos === "fixed" || pos === "sticky") return e;
    }
    return null;
  }
  function avoidOverlap() {
    if (root.classList.contains("ccp-open") || !launcher || launcher.offsetParent === null) return;
    if (baseBottom === null) baseBottom = parseFloat(getComputedStyle(root).bottom) || 20;
    // Measure where the button would sit at its normal height without moving it there first:
    // dropping it and lifting it back on every check counted as layout shift (CLS).
    var prev = root.style.bottom;
    var dy = (parseFloat(getComputedStyle(root).bottom) || baseBottom) - baseBottom;
    var b = launcher.getBoundingClientRect();
    var r = { left: b.left, right: b.right, top: b.top + dy, bottom: b.bottom + dy, width: b.width, height: b.height };
    var points = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [r.left + r.width / 2, r.top + r.height / 2]];
    var vh = window.innerHeight, lift = 0, covered = false;
    points.forEach(function (pt) {
      document.elementsFromPoint(pt[0], pt[1]).forEach(function (el) {
        if (root.contains(el) || el === document.body || el === document.documentElement) return;
        var f = isFixed(el);
        if (!f) return;
        var fr = f.getBoundingClientRect();
        if (fr.height > vh * 0.5) covered = true; // a drawer or overlay: get out of the way
        else lift = Math.max(lift, vh - fr.top); // a bar along the bottom: sit above it
      });
    });
    root.classList.toggle("ccp-tucked", covered);
    var next = !covered && lift ? Math.round(lift + 12) + "px" : baseBottom + "px";
    if (next !== prev) root.style.bottom = next;
  }
  var avoidTimer;
  function scheduleAvoid() { clearTimeout(avoidTimer); avoidTimer = setTimeout(avoidOverlap, 120); }
  ["scroll", "resize", "click", "keyup"].forEach(function (ev) { window.addEventListener(ev, scheduleAvoid, { passive: true }); });
  new MutationObserver(function (records) {
    // Ignore our own changes (moving the button is itself a style change).
    if (records.some(function (rec) { return !root.contains(rec.target); })) scheduleAvoid();
  }).observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "style", "open", "aria-hidden"] });
  setTimeout(avoidOverlap, 800);

  // ---- phones: round quick-access button stacked just above the chat bubble ----
  var fab = document.createElement("button");
  if (!design.launcher.mobileButton) fab.hidden = true;
  fab.type = "button";
  fab.className = "ccp-fab";
  fab.setAttribute("aria-label", "Open Collector Coins");
  fab.innerHTML = '<img src="' + esc(COIN) + '" alt=""><span class="ccp-fab-bal" hidden></span>';
  document.body.appendChild(fab);
  var $fabBal = fab.querySelector(".ccp-fab-bal");
  fab.addEventListener("click", function () { root.classList.contains("ccp-open") ? close() : open("home", "fab"); });
  function compact(x) {
    x = Number(x || 0);
    if (x < 1000) return String(x);
    if (x < 10000) return (Math.floor(x / 100) / 10).toFixed(1).replace(/\.0$/, "") + "k";
    if (x < 1000000) return Math.floor(x / 1000) + "k";
    return (Math.floor(x / 100000) / 10).toFixed(1).replace(/\.0$/, "") + "m";
  }
  var baseUpdateLauncher = updateLauncher;
  updateLauncher = function () {
    baseUpdateLauncher();
    if (state && state.member) { $fabBal.hidden = false; $fabBal.textContent = compact(state.member.balance); }
  };
  if (state) updateLauncher();
  function visible(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.top >= window.innerHeight) return null;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return null;
    return r;
  }
  function placeFab() {
    if (fab.offsetParent === null && getComputedStyle(fab).display === "none") return; // desktop: CSS hides it
    var vh = window.innerHeight;
    var hide = root.classList.contains("ccp-open");
    // The chat window open (it slides up over the page) -> step aside.
    var win = document.querySelector(".shop-ai-chat-window");
    var wr = visible(win);
    if (wr && wr.top < vh - 60) hide = true;
    if (fab.hidden) return;
    var side = design.launcher.mobileSide;
    var bubble = side === "chat" ? visible(document.querySelector(".shop-ai-chat-bubble")) : null;
    var size = bubble ? Math.round(bubble.width) : 50;
    var left = bubble ? Math.round(bubble.left) : side === "right" ? Math.round(document.documentElement.clientWidth - size - 10) : 10;
    var bottom = bubble ? Math.round(vh - bubble.top) + 12 : 10;
    fab.style.width = fab.style.height = size + "px";
    fab.style.left = left + "px";
    fab.style.bottom = bottom + "px";
    // Anything else fixed sitting where the button goes (cart drawer, menus, sticky add-to-cart bars)?
    if (!hide) {
      var top = vh - bottom - size, lift = 0;
      var pts = [[left + size / 2, top + 4], [left + 4, top + size / 2], [left + size - 4, top + size / 2], [left + size / 2, top + size - 4], [left + size / 2, top + size / 2]];
      pts.forEach(function (pt) {
        document.elementsFromPoint(pt[0], pt[1]).forEach(function (el) {
          if (el === fab || fab.contains(el) || root.contains(el) || el === document.body || el === document.documentElement) return;
          if (el.closest && el.closest(".shop-ai-chat-container")) return;
          var f = isFixed(el);
          if (!f) return;
          var fr = f.getBoundingClientRect();
          if (fr.height > vh * 0.4) hide = true; // a drawer, menu or overlay: step aside
          else lift = Math.max(lift, vh - fr.top);
        });
      });
      if (lift && !hide) fab.style.bottom = Math.round(lift + 12) + "px";
    }
    fab.classList.toggle("ccp-fab-off", hide);
  }
  var fabTimer;
  function schedulePlace() { clearTimeout(fabTimer); fabTimer = setTimeout(placeFab, 100); }
  ["scroll", "resize", "click", "keyup", "orientationchange"].forEach(function (ev) { window.addEventListener(ev, schedulePlace, { passive: true }); });
  new MutationObserver(function (records) {
    if (records.some(function (rec) { return rec.target !== fab && !fab.contains(rec.target); })) schedulePlace();
  }).observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "style", "open", "aria-hidden"] });
  [300, 1200, 3000].forEach(function (t) { setTimeout(placeFab, t); });

  // ---- landing page: fill the rewards grid from live stock ----
  var grid = document.querySelector(".pc-cc #rewards .cc-rewards");
  if (grid) {
    fetch(cfg.proxy + "/prizes", { headers: { Accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.prizes || !d.prizes.length) return;
      var coinImg = '<img src="' + esc(COIN) + '" alt="" width="20" height="20">';
      var tiles = d.prizes.map(function (z) {
        var img = z.image ? '<img src="' + esc(z.image + (z.image.indexOf("?") < 0 ? "?" : "&") + "width=400") + '" alt="' + esc(z.title) + '" loading="lazy">' : "";
        return '<a class="cc-reward" href="' + esc(z.url) + '"><div class="cc-reward-img">' + img + '</div><div class="cc-reward-body"><h3>Free ' + esc(z.title) +
          '</h3><span class="cc-cost">' + coinImg + n(z.coins) + " coins</span></div></a>";
      }).join("");
      grid.innerHTML =
        '<div class="cc-reward cc-reward--discount"><div class="cc-reward-img"><div class="cc-num">$1 Off</div><span>For every ' + n(d.coinsPerDollarOff) + ' coins</span></div>' +
        '<div class="cc-reward-body"><h3>Order Discount</h3><span class="cc-cost">' + coinImg + n(d.coinsPerDollarOff) + " = $1</span></div></div>" + tiles +
        '<a class="cc-reward cc-reward--discount" href="#coins-rewards"><div class="cc-reward-img"><div class="cc-num">Redeem</div><span>Open your coin panel</span></div>' +
        '<div class="cc-reward-body"><h3>Ready to Cash In?</h3><span class="cc-cost">Redeem Now &rarr;</span></div></a>';
    }).catch(function () {});
  }

  window.CollectorCoins = { open: open, close: close };
})();
