/* Collector Coins floating panel. Talks to the app through the Shopify app proxy at /apps/coins. */
(function () {
  var root = document.getElementById("cc-root");
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
  function coin(x) { return '<span class="cc-cost"><img src="' + esc(COIN) + '" alt="" width="16" height="16">' + n(x) + "</span>"; }
  function date(d) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

  // ---- shell ----
  root.innerHTML =
    '<div class="cc-panel" role="dialog" aria-label="Collector Coins"><div class="cc-head"></div><div class="cc-tabs"></div><div class="cc-body"></div></div>' +
    '<button type="button" class="cc-launcher" aria-label="Open Collector Coins"><img src="' + esc(COIN) + '" alt=""><span>' + esc(cfg.label || "Collector Coins") + '</span><span class="cc-launcher-bal" hidden></span></button>';
  if (cfg.hideLauncher === "true") root.classList.add("cc-no-launcher");
  var $head = root.querySelector(".cc-head");
  var $tabs = root.querySelector(".cc-tabs");
  var $body = root.querySelector(".cc-body");
  var $bal = root.querySelector(".cc-launcher-bal");

  root.querySelector(".cc-launcher").addEventListener("click", function () { root.classList.contains("cc-open") ? close() : open("home"); });

  function open(v) {
    view = v || "home";
    root.classList.add("cc-open");
    if (!state) load(); else render();
  }
  function close() { root.classList.remove("cc-open"); }
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
    $body.innerHTML = '<p class="cc-empty">Loading your coins&hellip;</p>';
    api("/me").then(function (s) { state = s; updateLauncher(); render(); }).catch(function (e) {
      if (e.message === "hidden") return;
      $body.innerHTML = '<div class="cc-err">' + esc(e.message) + "</div>";
    });
  }
  function updateLauncher() {
    if (state && state.member) { $bal.hidden = false; $bal.textContent = n(state.member.balance); }
  }
  if (signedIn) api("/me").then(function (s) { state = s; updateLauncher(); if (root.classList.contains("cc-open")) render(); }).catch(function () {});

  // ---- render ----
  function render() {
    if (!state) return;
    var m = state.member;
    if (!m) {
      $head.innerHTML = '<button class="cc-close" aria-label="Close">&times;</button><h2>Collector Coins</h2><p>Earn coins every time you shop, then trade them for free cards and discounts.</p>';
      $tabs.innerHTML = "";
      $body.innerHTML = signedOut();
    } else {
      var next = m.next;
      var pct = next ? Math.min(100, Math.round((100 * (m.lifetimeEarned - tierThreshold(m.tier))) / (next.threshold - tierThreshold(m.tier)))) : 100;
      $head.innerHTML =
        '<button class="cc-close" aria-label="Close">&times;</button>' +
        "<h2>" + (m.firstName ? "Hi " + esc(m.firstName) : "Collector Coins") + "</h2>" +
        '<div class="cc-bal"><img src="' + esc(COIN) + '" alt=""><div><strong>' + n(m.balance) + "</strong><br><span>Collector Coins</span></div></div>" +
        '<div class="cc-tierline"><b>' + esc(m.tierName) + "</b> &middot; " + m.earnRate + " coins per $1" +
        (next ? " &middot; " + n(next.coinsToGo) + " to " + esc(next.name) : " &middot; Top tier") + "</div>" +
        '<div class="cc-bar"><i style="width:' + pct + '%"></i></div>';
      var tabs = [["home", "Earn"], ["rewards", "Redeem"], ["codes", "My codes"], ["activity", "History"]];
      $tabs.innerHTML = tabs.map(function (t) {
        return '<button type="button" data-view="' + t[0] + '" class="' + (view === t[0] ? "cc-on" : "") + '">' + t[1] + "</button>";
      }).join("");
      var html = flash ? '<div class="' + (flash.type === "ok" ? "cc-ok" : "cc-err") + '">' + flash.html + "</div>" : "";
      if (view === "rewards") html += rewardsView(m);
      else if (view === "codes") html += codesView(m);
      else if (view === "activity") html += activityView(m);
      else html += homeView(m);
      $body.innerHTML = html;
    }
    var c = $head.querySelector(".cc-close");
    if (c) c.addEventListener("click", close);
  }

  function tierThreshold(key) {
    var t = state.program.tiers.filter(function (x) { return x.key === key; })[0];
    return t ? t.threshold : 0;
  }

  function signedOut() {
    var p = state.program;
    return (
      '<div class="cc-row"><a class="cc-btn cc-btn-red cc-btn-block" href="' + esc(cfg.registerUrl) + '">Join free</a>' +
      '<a class="cc-btn cc-btn-dark cc-btn-block" href="' + esc(cfg.loginUrl) + '">Sign in</a></div>' +
      '<p class="cc-note">Joining is free. You get $5 off your next $20+ order right away.</p>' +
      "<h3>Ways to earn</h3>" + earnList(p) +
      "<h3>Ball tiers</h3>" + tierGrid(p, null) +
      "<h3>Prizes right now</h3>" +
      state.prizes.slice(0, 6).map(function (z) { return prizeCard(z, null); }).join("") +
      (cfg.landingUrl ? '<p class="cc-note"><a href="' + esc(cfg.landingUrl) + '">See how Collector Coins works &rarr;</a></p>' : "")
    );
  }

  function earnList(p) {
    return p.waysToEarn.map(function (w) {
      var link = w.url ? ' <a href="' + esc(w.url) + '" target="_blank" rel="noopener">Write a review</a>' : "";
      return '<div class="cc-card"><div class="cc-grow"><div class="cc-t">' + esc(w.title) + '</div><div class="cc-d">' + esc(w.detail) + link + "</div></div></div>";
    }).join("");
  }

  function tierGrid(p, current) {
    return '<div class="cc-tiers">' + p.tiers.map(function (t) {
      return '<div class="cc-tier' + (t.key === current ? " cc-here" : "") + '"><b>' + esc(t.name) + "</b><small>" +
        (t.threshold ? "Earn " + n(t.threshold) + " coins" : "Join free") + "</small><small>" + t.earnRate + " coins per $1</small><small>Reward: " + esc(t.reward) + "</small></div>";
    }).join("") + "</div><p class=\"cc-note\">Once you reach a tier, you keep it.</p>";
  }

  function homeView(m) {
    var b = m.birthday
      ? '<div class="cc-card"><div class="cc-grow"><div class="cc-t">Birthday</div><div class="cc-d">Saved: ' + MONTHS[m.birthday.month - 1] + " " + m.birthday.day + "</div></div></div>"
      : '<div class="cc-card"><div class="cc-grow"><div class="cc-t">Add your birthday</div><div class="cc-d">Ultra and Master Ball members get birthday coins.</div>' +
        '<div class="cc-bday" style="margin-top:8px"><select data-bday="month">' + MONTHS.map(function (x, i) { return '<option value="' + (i + 1) + '">' + x + "</option>"; }).join("") +
        '</select><select data-bday="day">' + Array.from({ length: 31 }, function (_, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + "</option>"; }).join("") +
        '</select><button type="button" class="cc-btn" data-act="birthday">Save</button></div></div></div>';
    return "<h3>Ways to earn</h3>" + earnList(state.program) + b + "<h3>Ball tiers</h3>" + tierGrid(state.program, m.tier);
  }

  function prizeCard(z, m) {
    var can = m && m.balance >= z.coins;
    var btn = m ? '<button type="button" class="cc-btn" data-act="prize" data-id="' + esc(z.productId) + '"' + (can && !busy ? "" : " disabled") + ">" + (can ? "Redeem" : "Need " + n(z.coins - m.balance)) + "</button>" : "";
    return '<div class="cc-card">' + (z.image ? '<img src="' + esc(z.image + (z.image.indexOf("?") < 0 ? "?" : "&") + "width=120") + '" alt="" loading="lazy">' : "") +
      '<div class="cc-grow"><div class="cc-t"><a href="' + esc(z.url) + '" style="color:inherit">Free ' + esc(z.title) + "</a></div>" + coin(z.coins) + "</div>" + btn + "</div>";
  }

  function rewardsView(m) {
    var maxDollars = Math.floor(m.balance / state.program.coinsPerDollarOff);
    if (discountDollars > maxDollars) discountDollars = Math.max(1, maxDollars);
    var disc = '<div class="cc-discount"><div class="cc-t" style="font-weight:700">Order discount</div><div class="cc-d" style="color:#5f5f5f">' +
      n(state.program.coinsPerDollarOff) + " coins = $1 off</div>";
    if (maxDollars >= 1) {
      disc += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span class="cc-amt" data-amt>$' + discountDollars + " off</span>" +
        '<span data-amt-coins>' + coin(discountDollars * state.program.coinsPerDollarOff) + "</span></div>" +
        '<input type="range" min="1" max="' + maxDollars + '" value="' + discountDollars + '" data-discount aria-label="Dollars off">' +
        '<button type="button" class="cc-btn cc-btn-red cc-btn-block" data-act="discount"' + (busy ? " disabled" : "") + ">Get my code</button>";
    } else {
      disc += '<p class="cc-note">You need ' + n(state.program.coinsPerDollarOff - m.balance) + " more coins for $1 off.</p>";
    }
    disc += "</div>";
    var prizes = state.prizes.length
      ? state.prizes.map(function (z) { return prizeCard(z, m); }).join("")
      : '<p class="cc-empty">No prizes in stock right now. Check back soon.</p>';
    return "<h3>Discounts</h3>" + disc + "<h3>Free prizes</h3>" + prizes;
  }

  function codesView(m) {
    if (!m.rewards.length) return '<p class="cc-empty">No codes yet. Redeem coins to get one.</p>';
    return "<h3>My codes</h3>" + m.rewards.map(function (r) {
      return '<div class="cc-card"><div class="cc-grow"><div class="cc-t">' + esc(r.title) + '</div><div style="margin:6px 0"><span class="cc-code">' + esc(r.code) +
        '</span></div><div class="cc-d">' + date(r.createdAt) + (r.kind === "gift_card" ? " &middot; Gift card, enter at checkout" : " &middot; Enter at checkout") + "</div></div>" +
        '<button type="button" class="cc-btn cc-btn-dark" data-act="copy" data-code="' + esc(r.code) + '">Copy</button></div>';
    }).join("") + '<p class="cc-note">Each code works once and only on your account.</p>';
  }

  function activityView(m) {
    if (!m.activity.length) return '<p class="cc-empty">No activity yet.</p>';
    return "<h3>History</h3>" + m.activity.map(function (a) {
      return '<div class="cc-act"><div>' + esc(a.description) + "<small>" + date(a.createdAt) + '</small></div><div class="' + (a.amount >= 0 ? "cc-plus" : "cc-minus") + '">' +
        (a.amount > 0 ? "+" : "") + n(a.amount) + "</div></div>";
    }).join("");
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
        flash = { type: "ok", html: "<b>" + esc(r.reward.title) + '</b><br>Your code: <span class="cc-code">' + esc(r.reward.code) + "</span><br>Enter it at checkout. It's saved here under My codes." };
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
