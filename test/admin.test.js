import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePanelSettings, PANEL_DEFAULTS, fillText } from "../app/coins/panelSettings.js";
import { cleanTrackEvents } from "../app/coins/metrics.js";

test("panel settings: empty input gives the original design", () => {
  assert.deepEqual(normalizePanelSettings(null), PANEL_DEFAULTS);
  assert.deepEqual(normalizePanelSettings({}), PANEL_DEFAULTS);
});

test("panel settings: keeps valid values, drops bad ones", () => {
  const s = normalizePanelSettings({
    colors: { primary: "#00FF00", accent: "red", dark: "#12" },
    launcher: { label: "  My <b>Coins</b> ", mobileButton: false, mobileSide: "top" },
    text: { joinTitle: "Join Now", greeting: "" },
    earn: { google: { show: false, title: "", detail: "x" }, bogus: { show: true } },
    sections: { tiers: false },
    extra: 1,
  });
  assert.equal(s.colors.primary, "#00ff00");
  assert.equal(s.colors.accent, PANEL_DEFAULTS.colors.accent);
  assert.equal(s.colors.dark, PANEL_DEFAULTS.colors.dark);
  assert.equal(s.launcher.label, "My bCoins/b");
  assert.equal(s.launcher.mobileButton, false);
  assert.equal(s.launcher.mobileSide, "chat");
  assert.equal(s.text.joinTitle, "Join Now");
  assert.equal(s.text.greeting, PANEL_DEFAULTS.text.greeting);
  assert.deepEqual(s.earn.google, { show: false, title: PANEL_DEFAULTS.earn.google.title, detail: "x" });
  assert.equal(s.earn.bogus, undefined);
  assert.equal(s.sections.tiers, false);
  assert.equal(s.sections.promo, true);
  assert.equal(s.extra, undefined);
});

test("fillText fills known placeholders only", () => {
  assert.equal(fillText("Hi {name}, +{coins} {x}", { name: "Ash", coins: "200" }), "Hi Ash, +200 {x}");
});

test("track events: only known names, capped at 20", () => {
  const many = Array.from({ length: 30 }, () => ({ event: "open", target: "fab", path: "/" }));
  assert.equal(cleanTrackEvents(many).length, 20);
  assert.deepEqual(cleanTrackEvents([{ event: "open", target: "nope" }, { event: "hack", target: "fab" }, { event: "click", target: "alerts", path: 5 }]), [
    { event: "click", target: "alerts", path: null },
  ]);
  assert.deepEqual(cleanTrackEvents("x"), []);
});
