// What the storefront coin panel shows, built for one (possibly signed-out) visitor.
import prisma from "../db.server";
import { TIERS, tierByKey, nextTier, REVIEW_COINS, GOOGLE_REVIEW_COINS, COINS_PER_DOLLAR_OFF } from "./rules";
import { customerIncluded, findOrCreateMember } from "./ledger.server";
import { adminClient, getCustomer, listPrizes } from "./shopify.server";

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

export function programInfo() {
  return {
    coinsPerDollarOff: COINS_PER_DOLLAR_OFF,
    tiers: TIERS.map((t) => ({
      key: t.key, name: t.name, threshold: t.threshold, earnRate: t.earnRate, birthdayCoins: t.birthdayCoins, reward: t.entry.title,
    })),
    waysToEarn: [
      { key: "purchase", title: "Shop with us", badge: "2-10 / $1", detail: "Coins on every online order. Higher tiers earn more per $1." },
      { key: "review", title: "Review a product", badge: `+${REVIEW_COINS}`, detail: "For each product you review." },
      { key: "google", title: "Google review", badge: `+${GOOGLE_REVIEW_COINS}`, detail: "Email your screenshot to support@poke-collect.com", url: "https://g.page/r/CRGYfzYI9zxTEAE/review" },
      { key: "birthday", title: "Birthday bonus", badge: "+200-500", detail: "200 coins for Ultra Tier, 500 for Master Tier." },
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
  const state = { signedIn: Boolean(member), program: programInfo(), prizes };
  if (!member) return state;

  const [rewards, activity] = await Promise.all([
    prisma.reward.findMany({ where: { memberId: member.id, code: { not: null } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.transaction.findMany({ where: { memberId: member.id }, orderBy: { createdAt: "desc" }, take: 25 }),
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
    birthday: member.birthdayMonth ? { month: member.birthdayMonth, day: member.birthdayDay } : null,
    rewards: rewards.map((r) => ({ id: r.id, title: r.title, code: r.code, kind: r.kind, createdAt: r.createdAt })),
    activity: activity.map((t) => ({ description: t.description, amount: t.amount, createdAt: t.createdAt })),
  };
  return state;
}
