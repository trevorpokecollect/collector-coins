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
    '<button type="button" class="ccp-launcher" aria-label="Open Collector Coins"><img src="' + esc(COIN) + '" alt=""><span>' + esc(cfg.label || "Collector Coins") + '</span><span class="ccp-launcher-bal" hidden></span></button>';
  if (cfg.hideLauncher === "true") root.classList.add("ccp-no-launcher");
  var $head = root.querySelector(".ccp-head");
  var $tabs = root.querySelector(".ccp-tabs");
  var $body = root.querySelector(".ccp-body");
  var $bal = root.querySelector(".ccp-launcher-bal");

  root.querySelector(".ccp-launcher").addEventListener("click", function () { root.classList.contains("ccp-open") ? close() : open("home"); });

  function open(v) {
    view = v || "home";
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
    api("/me").then(function (s) { state = s; updateLauncher(); render(); }).catch(function (e) {
      if (e.message === "hidden") return;
      $body.innerHTML = '<div class="ccp-err">' + esc(e.message) + "</div>";
    });
  }
  function updateLauncher() {
    if (state && state.member) { $bal.hidden = false; $bal.textContent = n(state.member.balance); }
  }
  if (signedIn) api("/me").then(function (s) { state = s; updateLauncher(); if (root.classList.contains("ccp-open")) render(); }).catch(function () {});

  // ---- render ----
  function render() {
    if (!state) return;
    var m = state.member;
    if (!m) {
      $head.innerHTML = '<button class="ccp-close" aria-label="Close">&times;</button><h2>Collector Coins</h2><p>Earn coins every time you shop, then trade them for free cards and discounts.</p>';
      $tabs.innerHTML = "";
      $body.innerHTML = signedOut();
    } else {
      var next = m.next;
      var pct = next ? Math.min(100, Math.round((100 * (m.lifetimeEarned - tierThreshold(m.tier))) / (next.threshold - tierThreshold(m.tier)))) : 100;
      $head.innerHTML =
        '<button class="ccp-close" aria-label="Close">&times;</button>' +
        "<h2>" + (m.firstName ? "Hi " + esc(m.firstName) : "Collector Coins") + "</h2>" +
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
      else html += homeView(m);
      $body.innerHTML = html;
    }
    var c = $head.querySelector(".ccp-close");
    if (c) c.addEventListener("click", close);
  }

  function tierThreshold(key) {
    var t = state.program.tiers.filter(function (x) { return x.key === key; })[0];
    return t ? t.threshold : 0;
  }

  var ICONS = {
    purchase: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    review: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
    google: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M12 8l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 10.3l2-.3 1-2z"/>',
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
      '<div class="ccp-join"><div class="ccp-join-t">Join free, get $5 off</div><div class="ccp-d">Your welcome code works on any order of $20 or more.</div>' +
      '<div class="ccp-row" style="margin-top:12px"><a class="ccp-btn ccp-btn-red ccp-btn-block" href="' + esc(cfg.registerUrl) + '">Join free</a>' +
      '<a class="ccp-btn ccp-btn-dark ccp-btn-block" href="' + esc(cfg.loginUrl) + '">Sign in</a></div></div>' +
      h("Ways to earn") + earnList(p) +
      h("Tiers") + tierGrid(p, null) +
      (state.prizes.length ? h("Prizes right now") + state.prizes.slice(0, 6).map(function (z) { return prizeCard(z, null); }).join("") : "") +
      (cfg.landingUrl ? '<p class="ccp-more"><a href="' + esc(cfg.landingUrl) + '">How Collector Coins works &rarr;</a></p>' : "")
    );
  }

  function earnList(p) {
    return p.waysToEarn.map(function (w) {
      var link = w.url ? ' <a href="' + esc(w.url) + '" target="_blank" rel="noopener">Write a review</a>' : "";
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
    }).join("") + '</div><p class="ccp-note">Once you reach a tier, you keep it.</p>';
  }

  function homeView(m) {
    var b = m.birthday
      ? '<div class="ccp-card ccp-earn">' + icon("birthday") + '<div class="ccp-grow"><div class="ccp-t">Your birthday</div><div class="ccp-d">Saved: ' + MONTHS[m.birthday.month - 1] + " " + m.birthday.day + "</div></div></div>"
      : '<div class="ccp-card ccp-earn ccp-earn-col"><div class="ccp-earn-top">' + icon("birthday") + '<div class="ccp-grow"><div class="ccp-t">Add your birthday</div><div class="ccp-d">Ultra and Master Tier members get birthday coins.</div></div></div>' +
        '<div class="ccp-bday"><select data-bday="month" aria-label="Month">' + MONTHS.map(function (x, i) { return '<option value="' + (i + 1) + '">' + x + "</option>"; }).join("") +
        '</select><select data-bday="day" aria-label="Day">' + Array.from({ length: 31 }, function (_, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + "</option>"; }).join("") +
        '</select><button type="button" class="ccp-btn" data-act="birthday">Save</button></div></div>';
    return h("Ways to earn") + earnList(state.program) + b + h("Tiers") + tierGrid(state.program, m.tier);
  }

  function prizeCard(z, m) {
    var can = m && m.balance >= z.coins;
    var btn = m ? '<button type="button" class="ccp-btn' + (can ? "" : " ccp-btn-ghost") + '" data-act="prize" data-id="' + esc(z.productId) + '"' + (can && !busy ? "" : " disabled") + ">" + (can ? "Redeem" : "Need " + n(z.coins - m.balance)) + "</button>" : "";
    var img = z.image ? '<img src="' + esc(z.image + (z.image.indexOf("?") < 0 ? "?" : "&") + "width=160") + '" alt="" loading="lazy">' : '<span class="ccp-noimg"></span>';
    return '<div class="ccp-card ccp-prize">' + img +
      '<div class="ccp-grow"><a class="ccp-t" href="' + esc(z.url) + '">Free ' + esc(z.title) + "</a>" + coin(z.coins) + "</div>" + btn + "</div>";
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
    return h("Discounts") + disc + h("Free prizes") + prizes;
  }

  function codesView(m) {
    if (!m.rewards.length) return '<p class="ccp-empty">No codes yet. Redeem coins to get one.</p>';
    return h("My codes") + m.rewards.map(function (r) {
      return '<div class="ccp-card ccp-codecard"><div class="ccp-grow"><div class="ccp-t">' + esc(r.title) + '</div><div style="margin:6px 0"><span class="ccp-code">' + esc(r.code) +
        '</span></div><div class="ccp-d">' + date(r.createdAt) + (r.kind === "gift_card" ? " &middot; Gift card, enter at checkout" : " &middot; Enter at checkout") + "</div></div>" +
        '<button type="button" class="ccp-btn ccp-btn-dark" data-act="copy" data-code="' + esc(r.code) + '">Copy</button></div>';
    }).join("") + '<p class="ccp-note">Each code works once and only on your account.</p>';
  }

  function activityView(m) {
    if (!m.activity.length) return '<p class="ccp-empty">No activity yet.</p>';
    return h("History") + '<div class="ccp-card ccp-list">' + m.activity.map(function (a) {
      return '<div class="ccp-act"><div>' + esc(a.description) + "<small>" + date(a.createdAt) + '</small></div><div class="' + (a.amount >= 0 ? "ccp-plus" : "ccp-minus") + '">' +
        (a.amount > 0 ? "+" : "") + n(a.amount) + "</div></div>";
    }).join("") + "</div>";
  }

  // ---- actions ----
  $tabs.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (!b) return;
    view = b.dataset.view; flash = null; render(); $body.scrollTop = 0;
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
      copy(b.dataset.code); b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500);
      return;
    }
    if (busy) return;
    if (act === "discount") {
      if (!confirm("Spend " + n(discountDollars * state.program.coinsPerDollarOff) + " coins on $" + discountDollars + " off?")) return;
      redeem({ type: "discount", dollars: discountDollars });
    } else if (act === "prize") {
      var z = state.prizes.filter(function (p) { return p.productId === b.dataset.id; })[0];
      if (!z || !confirm("Spend " + n(z.coins) + " coins on Free " + z.title + "?")) return;
      redeem({ type: "prize", productId: z.productId });
    } else if (act === "birthday") {
      var mo = $body.querySelector('[data-bday="month"]').value, d = $body.querySelector('[data-bday="day"]').value;
      if (!confirm("Save " + MONTHS[mo - 1] + " " + d + " as your birthday? It can only be set once.")) return;
      busy = true;
      api("/birthday", { month: Number(mo), day: Number(d) })
        .then(function (r) { state = r.state; flash = { type: "ok", html: "Birthday saved." }; })
        .catch(function (err) { flash = { type: "err", html: esc(err.message) }; })
        .then(function () { busy = false; render(); });
    }
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
  if (startKey) open(LINK_VIEWS[startKey] || "home");

  window.CollectorCoins = { open: open, close: close };
})();
