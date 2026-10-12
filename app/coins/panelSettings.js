// Coin panel design: defaults and cleaning. Shared by the server (saving, /me) and the admin designer (live preview),
// so it must stay free of server-only imports. The storefront script (coins.js) carries the same defaults.

export const EARN_KEYS = ["alerts", "purchase", "review", "google", "birthday"];

export const PANEL_DEFAULTS = {
  colors: {
    primary: "#e22f39", // header, main buttons
    primaryDark: "#b81d27", // button hover
    accent: "#ffd800", // balance pill, active tab, badges
    dark: "#1a1a1a", // tabs bar, dark buttons
    background: "#f1eee4", // panel body
  },
  launcher: {
    label: "Collector Coins", // desktop floating button
    mobileButton: true, // round button above the chat bubble on phones
    mobileSide: "chat", // chat (stack above the chat bubble) | left | right
  },
  text: {
    signedOutTitle: "Collector Coins",
    signedOutIntro: "Earn coins every time you shop, then trade them for free cards and discounts.",
    joinTitle: "Join free, get $5 off",
    joinBody: "Your welcome code works on any order of $20 or more.",
    joinButton: "Join free",
    signInButton: "Sign in",
    greeting: "Hi {name}",
    alertsTitle: "Never Miss A Drop",
    alertsBody: "Get a text and email when new sets drop, hot items restock and pre-orders open. Join and we’ll add {coins} Collector Coins.",
    alertsButton: "Turn On Alerts · +{coins} Coins",
    tierNote: "Once you reach a tier, you keep it.",
  },
  earn: {
    alerts: { show: true, title: "Drop & restock alerts", detail: "Join our texts and emails to hear about new releases and restocks first." },
    purchase: { show: true, title: "Shop with us", detail: "Coins on every online order. Higher tiers earn more per $1." },
    review: { show: true, title: "Review a product", detail: "For each product you review." },
    google: { show: true, title: "Google review", detail: "Email your screenshot to support@poke-collect.com" },
    birthday: { show: true, title: "Birthday bonus", detail: "200 coins for Ultra Tier, 500 for Master Tier." },
  },
  sections: {
    promo: true, // coin promotion banner
    tiers: true, // tier cards
    prizesSignedOut: true, // prize preview for signed-out visitors
  },
};

export const TEXT_LABELS = {
  signedOutTitle: "Signed-out heading",
  signedOutIntro: "Signed-out intro",
  joinTitle: "Join box heading",
  joinBody: "Join box text",
  joinButton: "Join button",
  signInButton: "Sign in button",
  greeting: "Signed-in greeting ({name} = first name)",
  alertsTitle: "Alerts card heading",
  alertsBody: "Alerts card text ({coins} = coin amount)",
  alertsButton: "Alerts card button ({coins} = coin amount)",
  tierNote: "Note under the tiers",
};

export const EARN_LABELS = {
  alerts: "Text & email alerts",
  purchase: "Shopping",
  review: "Product reviews",
  google: "Google review",
  birthday: "Birthday",
};

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (v, max) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Merge saved values over the defaults, keeping only known keys with valid values. */
export function normalizePanelSettings(input) {
  const s = input && typeof input === "object" ? input : {};
  const d = PANEL_DEFAULTS;
  const out = { colors: {}, launcher: {}, text: {}, earn: {}, sections: {} };
  for (const k of Object.keys(d.colors)) {
    const v = String(s.colors?.[k] || "").trim();
    out.colors[k] = HEX.test(v) ? v.toLowerCase() : d.colors[k];
  }
  out.launcher.label = clean(s.launcher?.label, 40) || d.launcher.label;
  out.launcher.mobileButton = s.launcher?.mobileButton === undefined ? d.launcher.mobileButton : Boolean(s.launcher.mobileButton);
  out.launcher.mobileSide = ["chat", "left", "right"].includes(s.launcher?.mobileSide) ? s.launcher.mobileSide : d.launcher.mobileSide;
  for (const k of Object.keys(d.text)) out.text[k] = clean(s.text?.[k], 400) || d.text[k];
  for (const k of EARN_KEYS) {
    const e = s.earn?.[k] || {};
    out.earn[k] = {
      show: e.show === undefined ? true : Boolean(e.show),
      title: clean(e.title, 60) || d.earn[k].title,
      detail: clean(e.detail, 200) || d.earn[k].detail,
    };
  }
  for (const k of Object.keys(d.sections)) out.sections[k] = s.sections?.[k] === undefined ? d.sections[k] : Boolean(s.sections[k]);
  return out;
}

/** Fill {name} / {coins} placeholders. */
export function fillText(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}
