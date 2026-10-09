// Turning coins into rewards: order discounts (250 coins = $1) and free prizes from live stock.
import prisma from "../db.server";
import { COINS_PER_DOLLAR_OFF, discountDollarsForCoins, makeCode, formatCoins } from "./rules";
import { spend, undoSpend, snapshot } from "./ledger.server";
import { adminClient, createDiscountCode, listPrizes } from "./shopify.server";
import { sendEvent, METRICS } from "./klaviyo.server";

export class RedeemError extends Error {}

/** Order discount: a whole number of dollars, 250 coins each. */
export async function redeemDiscount(member, dollars) {
  dollars = Number(dollars);
  if (!Number.isInteger(dollars) || dollars < 1) throw new RedeemError("Pick at least $1 off.");
  const coins = dollars * COINS_PER_DOLLAR_OFF;
  if (discountDollarsForCoins(member.balance) < dollars) throw new RedeemError("Not enough coins for that discount.");
  return issue(member, {
    coins,
    title: `$${dollars} off your order`,
    kind: "order_discount",
    valueCents: dollars * 100,
    make: (admin, code) =>
      createDiscountCode(admin, {
        code,
        title: `Collector Coins: $${dollars} off`,
        customerId: member.customerId,
        amountCents: dollars * 100,
      }),
  });
}

/** Free prize: must still be in the live prize list (20+ in stock); the code covers that product's full price. */
export async function redeemPrize(member, productId) {
  const admin = await adminClient();
  const prizes = await listPrizes(admin, { fresh: true });
  const prize = prizes.find((p) => p.productId === productId);
  if (!prize) throw new RedeemError("That prize isn't available right now.");
  if (member.balance < prize.coins) throw new RedeemError("Not enough coins for that prize.");
  return issue(member, {
    coins: prize.coins,
    title: `Free ${prize.title}`,
    kind: "free_product",
    valueCents: prize.priceCents,
    productId: prize.productId,
    make: (a, code) =>
      createDiscountCode(a, {
        code,
        title: `Collector Coins: Free ${prize.title}`.slice(0, 255),
        customerId: member.customerId,
        amountCents: prize.priceCents,
        productId: prize.productId,
      }),
  });
}

async function issue(member, { coins, title, kind, valueCents, productId, make }) {
  const spent = await spend(member, { amount: coins, description: `Redeemed: ${title}` });
  if (!spent) throw new RedeemError("Not enough coins.");
  const code = makeCode();
  let made;
  try {
    made = await make(await adminClient(), code);
  } catch (err) {
    console.error("Creating reward code failed", err);
    await undoSpend(member, spent, `Coins returned: ${title} could not be created`);
    throw new RedeemError("Something went wrong creating your code. Your coins were returned.");
  }
  const reward = await prisma.reward.create({
    data: { memberId: member.id, kind, title, coins, code: made.code, shopifyId: made.id, valueCents, productId },
  });
  const after = await prisma.member.findUnique({ where: { id: member.id } });
  await sendEvent(METRICS.spent, snapshot(after), {
    coins, reward: title, code: made.code, kind, unique_id: `redeem-${reward.id}`,
    message: `${formatCoins(coins)} coins for ${title}`,
  });
  return { reward, balance: after.balance };
}
