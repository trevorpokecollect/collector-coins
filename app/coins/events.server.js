// What happens when Shopify or Judge.me tells us something: orders paid, refunds, new customers, reviews, birthdays.
import { createHmac } from "node:crypto";
import prisma from "../db.server";
import { orderEarns, purchaseCoins, refundCoins, toCents, tierByKey, REVIEW_COINS, monthDayInZone, birthdayCoinsDue } from "./rules";
import { customerIncluded, earnSources, findOrCreateMember, credit, takeBack } from "./ledger.server";
import { adminClient, findCustomersByEmail, getCustomer } from "./shopify.server";

function customerFromPayload(c) {
  return {
    customerId: String(c.id),
    email: c.email || c.default_email_address?.email_address || null,
    firstName: c.first_name || null,
    lastName: c.last_name || null,
    tags: c.tags || "",
  };
}

/** orders/paid: coins on the subtotal after discounts (no shipping, no tax) at the member's current tier rate. */
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
  const subtotalCents = toCents(order.current_subtotal_price ?? order.subtotal_price);
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

/** refunds/create: take back coins for the refunded items, at the rate the order earned, never below zero. */
export async function handleRefund(refund) {
  const orderId = String(refund.order_id);
  const earned = await prisma.transaction.findUnique({ where: { idemKey: `order:${orderId}` } });
  if (!earned) return { skipped: "order earned no coins" };
  const member = await prisma.member.findUnique({ where: { id: earned.memberId } });

  const refundedCents = (refund.refund_line_items || []).reduce((sum, li) => sum + toCents(li.subtotal), 0);
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
  return { coins: taken };
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
 * Judge.me review/created: 100 coins to the reviewer, once per review and once per product per customer.
 * Payload shape varies by Judge.me version, so the fields are read defensively.
 */
export async function handleReview(body) {
  const review = body.review || body.data?.review || body;
  const email = (review.reviewer?.email || review.email || body.reviewer?.email || "").trim().toLowerCase();
  const reviewId = String(review.id || review.review_id || "");
  const productKey = String(review.product_external_id || review.product_id || review.product_handle || "");
  if (!email || !reviewId) return { skipped: "no email or review id" };

  const admin = await adminClient();
  const found = await findCustomersByEmail(admin, [email]);
  const customer = found.get(email);
  if (!customer) return { skipped: "reviewer is not a customer" };
  if (!customerIncluded(customer.tags)) return { skipped: "not a tester" };

  const member = await findOrCreateMember(customer);
  if (productKey) {
    const dupe = await prisma.transaction.findUnique({ where: { idemKey: `review-product:${member.id}:${productKey}` } });
    if (dupe) return { skipped: "already rewarded for this product" };
  }
  const txn = await credit(member, {
    amount: REVIEW_COINS,
    kind: "review",
    description: review.product_title ? `Review of ${review.product_title}` : "Product review",
    idemKey: productKey ? `review-product:${member.id}:${productKey}` : `review:${reviewId}`,
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
