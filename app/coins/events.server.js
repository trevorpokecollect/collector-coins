// What happens when Shopify or Judge.me tells us something: orders paid, refunds, new customers, reviews, birthdays.
import { createHmac } from "node:crypto";
import prisma from "../db.server";
import { orderEarns, purchaseCoins, refundCoinsWithPromo, promoRefundCents, toCents, tierByKey, activePromotion, promoLines, promoBonusCoins, REVIEW_COINS, MAX_REVIEW_REWARDS, monthDayInZone, birthdayCoinsDue, earnableSubtotalCents, refundedMerchCents } from "./rules";
import { customerIncluded, earnSources, findOrCreateMember, credit, takeBack, revokeTiersAfterRefund } from "./ledger.server";
import { adminClient, findCustomersByEmail, getCustomer, getOrderTotals, customerBoughtProduct, productIdsOfType } from "./shopify.server";

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
  let subtotalCents = earnableSubtotalCents(order);
  // If a refund landed before this paid notice was handled (delayed or retried webhook), the payload predates it
  // and the refund webhook was skipped. Earn on what's left of the order now instead.
  const now = await getOrderTotals(await adminClient(), order.id).catch(() => null);
  if (now && now.refundCount > (order.refunds || []).length) {
    const giftCardPart = Math.max(0, toCents(order.current_subtotal_price ?? order.subtotal_price) - subtotalCents);
    subtotalCents = Math.min(subtotalCents, Math.max(0, now.currentSubtotalCents - giftCardPart));
  }
  let coins = purchaseCoins(subtotalCents, rate);
  let description = `Order ${order.name || "#" + order.order_number}`;
  let meta = null;

  // Coin promotion (e.g. 3x on Mystery Packs) for orders placed while it runs.
  const promo = activePromotion(order.processed_at || order.created_at || new Date());
  if (promo) {
    const ids = await productIdsOfType(await adminClient(), promo.productType).catch((e) => {
      console.error(`Promotion ${promo.id}: product lookup failed`, e.message);
      return new Set();
    });
    const lines = promoLines(order, ids);
    const cents = Math.min(lines.cents, subtotalCents);
    const bonus = promoBonusCoins(cents, rate, promo.multiplier);
    if (bonus > 0) {
      coins += bonus;
      description += ` (includes ${promo.title})`;
      meta = { promo: promo.id, multiplier: promo.multiplier, lineItemIds: lines.lineItemIds, promoCents: cents, earnableCents: subtotalCents, extraRate: rate * (promo.multiplier - 1), bonus };
    }
  }

  if (!coins) return { skipped: "no coins" };
  const txn = await credit(member, {
    amount: coins,
    kind: "purchase",
    description,
    orderId: String(order.id),
    earnRate: rate,
    idemKey: `order:${order.id}`,
    meta,
  });
  return { coins: txn ? coins : 0, ...(meta ? { promoBonus: meta.bonus } : {}) };
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
  const promoCents = promoRefundCents(refund, earned.meta, refundedCents);
  const coins = refundCoinsWithPromo(
    refundedCents, earned.earnRate || tierByKey(member.tier).earnRate, promoCents, earned.meta?.extraRate, earned.amount, alreadyTakenBack,
  );
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
 * Judge.me review/created: 100 coins to the reviewer for a product they bought, paid when the review is written
 * (not when staff approve it), once per product and at most MAX_REVIEW_REWARDS reviews per account.
 * Reviews of products the customer hasn't bought earn nothing. (Judge.me's "curated" field isn't used: in this
 * store it reads "spam" for every review until staff curate it, including genuine verified-purchase reviews.)
 * Payload shape varies by Judge.me version, so the fields are read defensively.
 */
export async function handleReview(body) {
  const review = body.review || body.data?.review || body;
  const email = (review.reviewer?.email || review.email || body.reviewer?.email || "").trim().toLowerCase();
  const reviewId = String(review.id || review.review_id || "");
  const productKey = String(review.product_external_id || review.product_id || review.product_handle || "");
  if (!email || !reviewId) return { skipped: "no email or review id" };
  if (!productKey) return { skipped: "no product on the review" };

  const admin = await adminClient();
  const found = await findCustomersByEmail(admin, [email]);
  const customer = found.get(email);
  if (!customer) return { skipped: "reviewer is not a customer" };
  if (!customerIncluded(customer.tags)) return { skipped: "not a tester" };

  const shopifyProductId = review.product_external_id ? String(review.product_external_id) : null;
  const judgemeVerified = ["buyer", "verified-buyer", "verified_buyer", "confirmed-buyer", "verified-purchase"].includes(String(review.verified || "").toLowerCase());
  const bought = shopifyProductId ? await customerBoughtProduct(admin, customer.customerId, shopifyProductId) : judgemeVerified;
  if (!bought && !judgemeVerified) return { skipped: "not a verified buyer" };

  const member = await findOrCreateMember(customer);
  const dupe = await prisma.transaction.findUnique({ where: { idemKey: `review-product:${member.id}:${productKey}` } });
  if (dupe) return { skipped: "already rewarded for this product" };
  const paidSoFar = await prisma.transaction.count({ where: { memberId: member.id, kind: "review" } });
  if (paidSoFar >= MAX_REVIEW_REWARDS) return { skipped: `already earned for ${MAX_REVIEW_REWARDS} reviews` };
  const txn = await credit(member, {
    amount: REVIEW_COINS,
    kind: "review",
    description: review.product_title ? `Review of ${review.product_title}` : "Product review",
    idemKey: `review-product:${member.id}:${productKey}`,
  });
  return { coins: txn ? REVIEW_COINS : 0 };
}

/**
 * Daily catch-up: pay any recent Judge.me reviews the webhook missed (app restarts, Judge.me outages, or the
 * Oct 10-11 bug that skipped reviews awaiting approval). Goes through the same checks as the webhook and is
 * safe to repeat: each product review pays once.
 */
export async function runReviewSweep({ days = 14, now = new Date() } = {}) {
  const token = process.env.JUDGEME_API_TOKEN;
  if (!token) return { checked: 0, paid: 0 };
  // Never before Collector Coins went live: Smile paid for reviews written before then.
  const since = Math.max(now.getTime() - days * 24 * 60 * 60 * 1000, Date.parse(process.env.COINS_LIVE_SINCE || "2026-10-09T21:31:00Z"));
  let checked = 0, paid = 0;
  const reasons = {};
  for (let page = 1; page <= 5; page++) {
    const qs = new URLSearchParams({ api_token: token, shop_domain: process.env.SHOP || "poke-collect-al.myshopify.com", per_page: "100", page: String(page) });
    const res = await fetch(`https://judge.me/api/v1/reviews?${qs}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Judge.me reviews ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const reviews = (await res.json()).reviews || [];
    let older = false;
    for (const review of reviews) {
      if (new Date(review.created_at).getTime() < since) { older = true; continue; }
      checked++;
      const email = (review.reviewer?.email || review.email || "").trim().toLowerCase();
      const productKey = String(review.product_external_id || review.product_id || review.product_handle || "");
      if (email && productKey) {
        const member = await prisma.member.findFirst({ where: { email } });
        if (member && (await prisma.transaction.findUnique({ where: { idemKey: `review-product:${member.id}:${productKey}` } }))) {
          reasons["already paid"] = (reasons["already paid"] || 0) + 1;
          continue;
        }
      }
      const r = await handleReview({ review }).catch((e) => ({ error: e.message }));
      if (r.coins) paid++;
      const why = r.coins ? "paid" : r.error ? "error" : r.skipped || "unknown";
      reasons[why] = (reasons[why] || 0) + 1;
      if (r.coins || r.error) console.log(`Review sweep ${review.id}: ${JSON.stringify(r)}`);
    }
    if (older || reviews.length < 100) break;
  }
  if (checked) console.log(`Review catch-up reasons: ${JSON.stringify(reasons)}`);
  return { checked, paid };
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
