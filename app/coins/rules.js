// Collector Coins program rules. Pure functions only (no database, no network), so they are unit tested.
// Copied from the live Smile.io program on Oct 9 2026, with the changes agreed in the build plan:
// tiers never reset, coins on the subtotal after discounts, refunds take coins back (never below zero).

export const TIERS = [
  {
    key: "poke",
    name: "Poke Tier",
    threshold: 0,
    earnRate: 2, // coins per $1
    birthdayCoins: 0,
    entry: { discountCents: 500, minimumCents: 2000, title: "$5 off orders of $20+" },
  },
  {
    key: "great",
    name: "Great Tier",
    threshold: 500,
    earnRate: 3,
    birthdayCoins: 0,
    entry: { giftCardCents: 2500, title: "$25 gift card" },
  },
  {
    key: "ultra",
    name: "Ultra Tier",
    threshold: 3500,
    earnRate: 5,
    birthdayCoins: 200,
    entry: { giftCardCents: 5000, bonusCoins: 1000, title: "$50 gift card + 1,000 bonus coins" },
  },
  {
    key: "master",
    name: "Master Tier",
    threshold: 10000,
    earnRate: 10,
    birthdayCoins: 500,
    entry: { giftCardCents: 10000, bonusCoins: 2500, title: "$100 gift card + 2,500 bonus coins" },
  },
];

export const REVIEW_COINS = 100;
export const GOOGLE_REVIEW_COINS = 500;
export const COINS_PER_DOLLAR_OFF = 250; // order discount: 250 coins = $1 off
export const PRIZE_COINS_PER_DOLLAR = 200; // free product: retail price x 200 coins
export const PRIZE_MIN_STOCK = 20;
export const PRIZE_TAG = "Collector Coins Prize";
export const PRIZE_COLLECTION_HANDLE = "collector-coins-prizes";

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}

export function tierIndex(key) {
  const i = TIERS.findIndex((t) => t.key === key);
  return i < 0 ? 0 : i;
}

/** The tier a lifetime total qualifies for. */
export function tierForLifetime(lifetimeEarned) {
  let tier = TIERS[0];
  for (const t of TIERS) if (lifetimeEarned >= t.threshold) tier = t;
  return tier;
}

/** Tiers never drop: the higher of the stored tier and what the lifetime total qualifies for. */
export function resolveTier(currentKey, lifetimeEarned) {
  const earned = tierForLifetime(lifetimeEarned);
  return tierIndex(earned.key) > tierIndex(currentKey) ? earned : tierByKey(currentKey);
}

/** Next tier and how far away it is, or null at the top. */
export function nextTier(currentKey, lifetimeEarned) {
  const t = TIERS.at(tierIndex(currentKey) + 1);
  if (!t) return null;
  return { ...t, coinsToGo: Math.max(0, t.threshold - lifetimeEarned) };
}

/** Money string ("12.34") to integer cents, without float drift. */
export function toCents(amount) {
  if (amount === null || amount === undefined || amount === "") return 0;
  const s = String(amount).trim();
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole || 0) * 100 + Number((frac + "00").slice(0, 2));
  return neg ? -cents : cents;
}

/** Coins for a purchase: whole dollars of the subtotal after discounts x the tier's rate (Smile rounds down). */
export function purchaseCoins(subtotalCents, earnRate) {
  if (subtotalCents <= 0) return 0;
  return Math.floor((subtotalCents * earnRate) / 100);
}

/**
 * Coins to take back for a refund: the refunded amount at the rate the order earned,
 * never more than the order earned minus what earlier refunds already took back.
 */
export function refundCoins(refundedCents, earnRate, earnedOnOrder, alreadyTakenBack) {
  const want = Math.ceil((Math.max(0, refundedCents) * earnRate) / 100);
  const left = Math.max(0, earnedOnOrder - alreadyTakenBack);
  return Math.min(want, left);
}

/** Free product cost: retail x 200, to the nearest 100 coins, at least 100 (matches the landing page). */
export function prizeCoins(priceCents) {
  const coins = Math.floor((priceCents * PRIZE_COINS_PER_DOLLAR + 5000) / 10000) * 100;
  return Math.max(100, coins);
}

/** Dollars off for a number of coins in the order-discount reward. */
export function discountDollarsForCoins(coins) {
  return Math.floor(coins / COINS_PER_DOLLAR_OFF);
}

/** Whether a Shopify order counts: online store only by default (POS and Whatnot don't earn). */
export function orderEarns(order, allowedSources) {
  if (!order || !order.customer || !order.customer.id) return { ok: false, reason: "no customer" };
  if (order.test) return { ok: false, reason: "test order" };
  const source = String(order.source_name || "").toLowerCase();
  if (!allowedSources.includes(source)) return { ok: false, reason: `source ${source || "unknown"}` };
  return { ok: true };
}

/** Today's month and day in the store's time zone. */
export function monthDayInZone(date, timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function isValidBirthday(month, day) {
  const m = Number(month), d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return false;
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days.at(m - 1);
}

/** Birthday coins due today, or 0. Feb 29 birthdays are celebrated Feb 28 in non-leap years. */
export function birthdayCoinsDue(member, today) {
  if (!member.birthdayMonth || !member.birthdayDay) return 0;
  if (member.birthdayYearAwarded === today.year) return 0;
  const leap = (today.year % 4 === 0 && today.year % 100 !== 0) || today.year % 400 === 0;
  let { birthdayMonth: m, birthdayDay: d } = member;
  if (m === 2 && d === 29 && !leap) d = 28;
  if (m !== today.month || d !== today.day) return 0;
  return tierByKey(member.tier).birthdayCoins;
}

export function formatCoins(n) {
  return Number(n || 0).toLocaleString("en-US");
}

export function formatMoney(cents) {
  const v = cents / 100;
  return "$" + (Number.isInteger(v) ? String(v) : v.toFixed(2));
}

/** Readable one-time code, e.g. COINS-7KQ2-M9XD. No 0/O/1/I to avoid typos. */
export function makeCode(prefix = "COINS", rand = Math.random) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => abc.charAt(Math.floor(rand() * abc.length))).join("");
  return `${prefix}-${part()}-${part()}`;
}
