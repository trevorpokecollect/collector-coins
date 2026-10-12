// What the storefront coin panel shows, built for one (possibly signed-out) visitor.
import prisma from "../db.server";
import { TIERS, tierByKey, nextTier, REVIEW_COINS, GOOGLE_REVIEW_COINS, ALERTS_SIGNUP_COINS, COINS_PER_DOLLAR_OFF, EXPIRY_MONTHS, expiryDate, activePromotion } from "./rules";
import { customerIncluded, findOrCreateMember } from "./ledger.server";
import { adminClient, getCustomer, listPrizes } from "./shopify.server";
import { klaviyoCanSubscribe } from "./klaviyo.server";
import { getPanelSettings } from "./settings.server";
import { PANEL_DEFAULTS } from "./panelSettings";

// Whether text + email sign-ups can work (the Klaviyo key has the scopes), re-checked every 10 minutes.
const alertsCheck = (globalThis.__coinsAlertsCheck ||= { at: 0, ok: false });
async function alertsEnabled() {
  if (Date.now() - alertsCheck.at > 10 * 60 * 1000) {
    alertsCheck.at = Date.now();
    alertsCheck.ok = (await klaviyoCanSubscribe()) === true;
  }
  return alertsCheck.ok;
}

const customerCache = new Map(); // customerId -> { at, customer }

async function lookupCustomer(customerId) {
  const hit = customerCache.get(customerId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.customer;
  const customer = await getCustomer(await adminClient(), customerId);
  customerCache.set(customerId, { at: Date.now(), customer });
  return customer;
}

/**
 * The signed-in customer's member record, or null when signed out.
 * Throws a 404 Response when the program is in testing mode and the customer isn't a tester.
 */
export async function memberForProxy(request) {
  const customerId = new URL(request.url).searchParams.get("logged_in_customer_id");
  if (!customerId) return null;
  const existing = await prisma.member.findUnique({ where: { customerId } });
  const customer = await lookupCustomer(customerId);
  if (!customer) return null;
  if (!customerIncluded(customer.tags)) throw new Response(JSON.stringify({ hidden: true }), { status: 404, headers: { "Content-Type": "application/json" } });
  return existing || findOrCreateMember(customer);
}

export function programInfo({ alerts = false, settings = PANEL_DEFAULTS } = {}) {
  const earn = settings.earn;
  const way = (key, badge, extra = {}) => (earn[key].show ? [{ key, title: earn[key].title, badge, detail: earn[key].detail, ...extra }] : []);
  const promo = activePromotion(new Date());
  return {
    coinsPerDollarOff: COINS_PER_DOLLAR_OFF,
    promotion: promo
      ? { id: promo.id, headline: promo.headline, blurb: promo.blurb, endsText: promo.endsText, endsAt: promo.endsAt, url: promo.url, multiplier: promo.multiplier }
      : null,
    expiryMonths: EXPIRY_MONTHS,
    tiers: TIERS.map((t) => ({
      key: t.key, name: t.name, threshold: t.threshold, earnRate: t.earnRate, birthdayCoins: t.birthdayCoins, reward: t.entry.title,
    })),
    alertsCoins: ALERTS_SIGNUP_COINS,
    alertsEnabled: alerts && earn.alerts.show,
    waysToEarn: [
      ...(alerts ? way("alerts", `+${ALERTS_SIGNUP_COINS}`) : []),
      ...way("purchase", "2-10 / $1"),
      ...way("review", `+${REVIEW_COINS}`),
      ...way("google", `+${GOOGLE_REVIEW_COINS}`, { url: "https://g.page/r/CRGYfzYI9zxTEAE/review" }),
      ...way("birthday", "+200-500"),
    ],
  };
}

export async function panelState(member) {
  let prizes = [];
  try {
    prizes = await listPrizes(await adminClient());
  } catch (err) {
    console.error("Loading prizes failed", err);
  }
  const settings = await getPanelSettings();
  const state = { signedIn: Boolean(member), program: programInfo({ alerts: await alertsEnabled(), settings }), prizes, design: settings };
  if (!member) return state;

  const [rewards, activity, alerts] = await Promise.all([
    prisma.reward.findMany({ where: { memberId: member.id, code: { not: null }, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.transaction.findMany({ where: { memberId: member.id }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.transaction.findUnique({ where: { idemKey: `alerts-signup:${member.id}` } }),
  ]);
  const tier = tierByKey(member.tier);
  state.member = {
    firstName: member.firstName,
    balance: member.balance,
    lifetimeEarned: member.lifetimeEarned,
    tier: tier.key,
    tierName: tier.name,
    earnRate: tier.earnRate,
    next: nextTier(member.tier, member.lifetimeEarned),
    email: member.email,
    alertsClaimed: Boolean(alerts),
    birthday: member.birthdayMonth ? { month: member.birthdayMonth, day: member.birthdayDay } : null,
    expiresOn: member.balance > 0 ? expiryDate(member.lastActivityAt || new Date()).toISOString() : null,
    rewards: rewards.map((r) => ({ id: r.id, title: r.title, code: r.code, kind: r.kind, createdAt: r.createdAt })),
    activity: activity.map((t) => ({ description: t.description, amount: t.amount, createdAt: t.createdAt })),
  };
  return state;
}
