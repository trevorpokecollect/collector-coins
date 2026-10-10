// What happens when Shopify or Judge.me tells us something: orders paid, refunds, new customers, reviews, birthdays.
import { createHmac } from "node:crypto";
import prisma from "../db.server";
import { orderEarns, purchaseCoins, refundCoins, tierByKey, REVIEW_COINS, monthDayInZone, birthdayCoinsDue, earnableSubtotalCents, refundedMerchCents } from "./rules";
import { customerIncluded, earnSources, findOrCreateMember, credit, takeBack, revokeTiersAfterRefund } from "./ledger.server";
import { adminClient, findCustomersByEmail, getCustomer, getOrderTotals, customerBoughtProduct } from "./shopify.server";

function customerFromPayload(c) {
  return {
    customerId: String(c.id),
    email: c.email || c.default_email_address?.email_address || null,
    firstName: c.first_name || null,
    lastName: c.last_name || null,
    tags: c.tags || "",
  };
}

/** orders/paid: coins on the subtotal after discounts (no shipping, no tax, no gift cards) at the member's tier rate. */
export async function handleOrderPaid(order) {
  const check = orderEarns(order, earnSources());
  if (!check.ok) {
    console.log(`Order ${order.name || order.id}: no coins (${check.reason})`);
    return { skipped: check.reason };
  }
  const customer = customerFromPayload(order.customer);
  if (!customer.email) customer.email = order.email || order.contact_email || null;
  if (order.customer.tags === undefined) {
    // Some webhook versions leave tags off the order's customer: look them up.
    const full = await getCustomer(await adminClient(), customer.customerId);
    if (full) Object.assign(customer, { tags: full.tags, email: customer.email || full.email });
  }
  if (!customerIncluded(customer.tags)) return { skipped: "not a tester" };

  const member = await findOrCreateMember(customer);
  const rate = tierByKey(member.tier).earnRate;
  const subtotalCents = earnableSubtotalCents(order);
  const coins = purchaseCoins(subtotalCents, rate);
  if (!coins) return { skipped: "no coins" };
  const txn = await credit(member, {
    amount: coins,
    kind: "purchase",
    description: `Order ${order.name || "#" + order.order_number}`,
    orderId: String(order.id),
    earnRate: rate,
    idemKey: `order:${order.id}`,
  });
  return { coins: txn ? coins : 0 };
}

/**
 * refunds/create: take back coins for the refunded merchandise, at the rate the order earned, never below zero.
 * Amount-only refunds count too. If that drops the member below a tier reached recently, the tier is taken back.
 */
export async function handleRefund(refund) {
  const orderId = String(refund.order_id);
  const earned = await prisma.transaction.findUnique({ where: { idemKey: `order:${orderId}` } });
  if (!earned) return { skipped: "order earned no coins" };
  const member = await prisma.member.findUnique({ where: { id: earned.memberId } });

  const amountOnly = !(refund.refund_line_items || []).length;
  const totals = amountOnly ? await getOrderTotals(await adminClient(), orderId).catch(() => null) : null;
  const refundedCents = refundedMerchCents(refund, totals);
  const prior = await prisma.transaction.aggregate({ where: { orderId, kind: "refund" }, _sum: { amount: true } });
  const alreadyTakenBack = -(prior._sum.amount || 0);
  const coins = refundCoins(refundedCents, earned.earnRate || tierByKey(member.tier).earnRate, earned.amount, alreadyTakenBack);
  if (!coins) return { skipped: "nothing to take back" };
  const taken = await takeBack(member, {
    amount: coins,
    kind: "refund",
    description: `Refund on ${earned.description.replace(/^Order /, "order ")}`,
    orderId,
    idemKey: `refund:${refund.id}`,
  });
  const tiersRevoked = await revokeTiersAfterRefund(member.id);
  return { coins: taken, ...(tiersRevoked.length ? { tiersRevoked } : {}) };
}

/** customers/create and customers/update: join the program (Poke Ball welcome reward) and keep name/email current. */
export async function handleCustomer(payload, { create }) {
  const customer = customerFromPayload(payload);
  if (!customerIncluded(customer.tags)) return { skipped: "not a tester" };
  if (!create) {
    const existing = await prisma.member.findUnique({ where: { customerId: customer.customerId } });
    if (!existing) return { skipped: "not a member" };
  }
  await findOrCreateMember(customer);
  return { ok: true };
}

/**
 * Judge.me review/created: 100 coins to the reviewer for a product they bought, once per product per customer.
 * Reviews Judge.me marks as spam, and reviews of products the customer hasn't bought, earn nothing.
 * Payload shape varies by Judge.me version, so the fields are read defensively.
 */
export async function handleReview(body) {
  const review = body.review || body.data?.review || body;
  const email = (review.reviewer?.email || review.email || body.reviewer?.email || "").trim().toLowerCase();
  const reviewId = String(review.id || review.review_id || "");
  const productKey = String(review.product_external_id || review.product_id || review.product_handle || "");
  if (!email || !reviewId) return { skipped: "no email or review id" };
  if (!productKey) return { skipped: "no product on the review" };
  if (review.curated === "spam" || review.hidden === true) return { skipped: "spam or hidden review" };

  const admin = await adminClient();
  const found = await findCustomersByEmail(admin, [email]);
  const customer = found.get(email);
  if (!customer) return { skipped: "reviewer is not a customer" };
  if (!customerIncluded(customer.tags)) return { skipped: "not a tester" };

  const shopifyProductId = review.product_external_id ? String(review.product_external_id) : null;
  const judgemeVerified = ["buyer", "verified-buyer", "verified_buyer", "confirmed-buyer"].includes(String(review.verified || "").toLowerCase());
  const bought = shopifyProductId ? await customerBoughtProduct(admin, customer.customerId, shopifyProductId) : judgemeVerified;
  if (!bought && !judgemeVerified) return { skipped: "not a verified buyer" };

  const member = await findOrCreateMember(customer);
  const dupe = await prisma.transaction.findUnique({ where: { idemKey: `review-product:${member.id}:${productKey}` } });
  if (dupe) return { skipped: "already rewarded for this product" };
  const txn = await credit(member, {
    amount: REVIEW_COINS,
    kind: "review",
    description: review.product_title ? `Review of ${review.product_title}` : "Product review",
    idemKey: `review-product:${member.id}:${productKey}`,
  });
  return { coins: txn ? REVIEW_COINS : 0 };
}

/** Daily: birthday coins for Ultra and Master Ball members, once a year. */
export async function runBirthdays(now = new Date()) {
  const today = monthDayInZone(now);
  const leap = (today.year % 4 === 0 && today.year % 100 !== 0) || today.year % 400 === 0;
  const days = [today.day];
  if (today.month === 2 && today.day === 28 && !leap) days.push(29);
  const members = await prisma.member.findMany({
    where: { birthdayMonth: today.month, birthdayDay: { in: days }, tier: { in: ["ultra", "master"] } },
  });
  let paid = 0;
  for (const m of members) {
    const coins = birthdayCoinsDue(m, today);
    if (!coins) continue;
    const claimed = await prisma.member.updateMany({
      where: { id: m.id, OR: [{ birthdayYearAwarded: null }, { birthdayYearAwarded: { not: today.year } }] },
      data: { birthdayYearAwarded: today.year },
    });
    if (claimed.count !== 1) continue;
    await credit(m, { amount: coins, kind: "birthday", description: "Happy birthday!", idemKey: `birthday:${m.id}:${today.year}` });
    paid++;
  }
  return { paid };
}

/** Secret for the Judge.me webhook URL: JUDGEME_WEBHOOK_TOKEN, or derived from the app secret so nothing extra needs setting. */
export function judgemeToken() {
  if (process.env.JUDGEME_WEBHOOK_TOKEN) return process.env.JUDGEME_WEBHOOK_TOKEN;
  if (!process.env.SHOPIFY_API_SECRET) return "";
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET).update("judgeme-webhook").digest("hex").slice(0, 32);
}

export function judgemeWebhookUrl() {
  const t = judgemeToken();
  return t ? `${process.env.SHOPIFY_APP_URL}/judgeme?token=${t}` : null;
}

/**
 * Register our review/created webhook with Judge.me. Judge.me has no screen for webhooks, only an API,
 * so this needs JUDGEME_API_TOKEN (Judge.me → Settings → Integrations → View API tokens → Private API token).
 */
export async function connectJudgeme() {
  const token = process.env.JUDGEME_API_TOKEN;
  const url = judgemeWebhookUrl();
  if (!token) throw new Error("Add JUDGEME_API_TOKEN in Railway first.");
  if (!url) throw new Error("The app secret is missing.");
  const qs = new URLSearchParams({ api_token: token, shop_domain: process.env.SHOP || "poke-collect-al.myshopify.com" });
  const res = await fetch(`https://judge.me/api/v1/webhooks?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ webhook: { key: "review/created", url } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Judge.me said ${res.status}: ${text.slice(0, 300)}`);
  return text;
}
