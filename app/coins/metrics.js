// What the storefront coin panel reports to /apps/coins/track, with readable names for the Engagement page.

export const TRACKED = {
  open: {
    fab: "Phone coin button",
    launcher: "Desktop coin button",
    link: "Collector Coins link on the site",
    hash: "Link from outside the site (#coins-…)",
  },
  tab: {
    home: "Earn tab",
    rewards: "Redeem tab",
    codes: "My codes tab",
    activity: "History tab",
  },
  click: {
    alerts: "Alerts: started typing a number",
    google: "Google review link",
    join: "Join free button",
    signin: "Sign in button",
    promo: "Promotion banner",
    prize: "Prize product link",
    landing: "How Collector Coins works link",
    birthday: "Birthday: Save",
    copy: "Copy a code",
  },
  submit: {
    alerts: "Alerts: Turn On Alerts",
    discount: "Redeem: order discount",
    prize: "Redeem: free prize",
  },
};

export const EVENT_NAMES = { open: "Panel opened", tab: "Tab viewed", click: "Clicked", submit: "Submitted" };

export function labelFor(event, target) {
  return TRACKED[event]?.[target] || `${event}: ${target}`;
}

/** Keep only known events, at most 20 per request. */
export function cleanTrackEvents(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const e of events.slice(0, 20)) {
    const event = String(e?.event || "");
    const target = String(e?.target || "");
    if (!TRACKED[event] || !TRACKED[event][target]) continue;
    const path = typeof e.path === "string" ? e.path.slice(0, 200) : null;
    out.push({ event, target, path });
  }
  return out;
}

/** The ways to earn, each with the clicks that lead to it and the ledger kind that pays it. */
export const EARN_FUNNELS = [
  { key: "alerts", name: "Text & email alerts", start: ["click", "alerts"], submit: ["submit", "alerts"], kind: "alerts_signup" },
  { key: "google", name: "Google review", start: ["click", "google"], kind: "adjust", descriptionLike: "google review" },
  { key: "review", name: "Product review (Judge.me)", kind: "review" },
  { key: "birthday", name: "Birthday", start: ["click", "birthday"], kind: "birthday" },
  { key: "purchase", name: "Orders", kind: "purchase" },
];
