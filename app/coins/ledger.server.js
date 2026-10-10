// The coin ledger: members, earning, spending, tiers and tier rewards.
// Every change is a Transaction row; Member.balance and Member.lifetimeEarned are kept in step inside a DB transaction.
import prisma from "../db.server";
import { TIERS, TIER_REVOKE_DAYS, resolveTier, tierForLifetime, tierByKey, tierIndex, makeCode, formatMoney, formatCoins } from "./rules";
import { adminClient, createDiscountCode, createGiftCard, deactivateReward } from "./shopify.server";
import { sendEvent, METRICS } from "./klaviyo.server";

export const isUniqueError = (err) => err && err.code === "P2002";

// ---- program mode -------------------------------------------------------------------------------
// testing: only customers tagged TESTER_TAG earn, redeem or see the panel; everyone else is ignored,
// so the app can run next to Smile without touching real customers. live: everyone.

export function programMode() {
  return process.env.PROGRAM_MODE === "live" ? "live" : "testing";
}

export function testerTag() {
  return process.env.TESTER_TAG || "coins-tester";
}

export function tagsList(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim());
  return String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
}

export function customerIncluded(tags) {
  return programMode() === "live" || tagsList(tags).includes(testerTag());
}

export function earnSources() {
  return (process.env.EARN_SOURCES || "web").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// ---- members ------------------------------------------------------------------------------------

export function snapshot(member) {
  return { ...member, tierName: tierByKey(member.tier).name };
}

/**
 * Find a member by Shopify customer id, creating them (and their Poke Ball welcome reward) if new.
 * Keeps the stored name and email current.
 */
export async function findOrCreateMember(customer, { welcome = true } = {}) {
  const customerId = String(customer.customerId);
  const data = {
    email: customer.email ?? undefined,
    firstName: customer.firstName ?? undefined,
    lastName: customer.lastName ?? undefined,
  };
  const existing = await prisma.member.findUnique({ where: { customerId } });
  if (existing) {
    const changed = Object.entries(data).some(([k, v]) => v !== undefined && v !== existing[k]);
    return changed ? prisma.member.update({ where: { customerId }, data }) : existing;
  }
  let member;
  try {
    member = await prisma.member.create({ data: { customerId, ...data } });
  } catch (err) {
    if (isUniqueError(err)) return prisma.member.findUnique({ where: { customerId } });
    throw err;
  }
  if (welcome) await issueTierEntry(member, TIERS[0]).catch((e) => console.error("Welcome reward failed", e));
  return member;
}

// ---- earning and spending ---------------------------------------------------------------------

/**
 * Add coins. Returns the transaction, or null when idemKey was already used (a repeated webhook).
 * Checks for a tier upgrade afterwards.
 */
export async function credit(member, { amount, kind, description, orderId, earnRate, idemKey, countsToTier = true, staff, notify = true }) {
  if (!amount || amount <= 0) return null;
  let txn;
  try {
    txn = await prisma.$transaction(async (tx) => {
      const t = await tx.transaction.create({
        data: { memberId: member.id, amount, kind, description, orderId, earnRate, idemKey, countsToTier, staff },
      });
      await tx.member.update({
        where: { id: member.id },
        data: {
          balance: { increment: amount },
          ...(countsToTier ? { lifetimeEarned: { increment: amount } } : {}),
          lastActivityAt: new Date(),
          expiryWarnedAt: null,
        },
      });
      return t;
    });
  } catch (err) {
    if (isUniqueError(err)) return null;
    throw err;
  }
  const after = await checkTier(member.id);
  if (notify) {
    await sendEvent(METRICS.earned, snapshot(after), {
      coins: amount, reason: description, kind, unique_id: txn.id,
    });
  }
  return txn;
}

/**
 * Take coins back (refunds, staff removals). Never takes the balance below zero; returns the amount taken.
 * Lifetime coins go down too, but the tier never drops.
 */
export async function takeBack(member, { amount, kind, description, orderId, idemKey, staff, reduceLifetime = true }) {
  if (!amount || amount <= 0) return 0;
  try {
    return await prisma.$transaction(async (tx) => {
      const m = await tx.member.findUnique({ where: { id: member.id } });
      const taken = Math.min(amount, m.balance);
      await tx.transaction.create({
        data: { memberId: member.id, amount: -taken, kind, description, orderId, idemKey, staff },
      });
      await tx.member.update({
        where: { id: member.id },
        data: {
          balance: { decrement: taken },
          ...(reduceLifetime ? { lifetimeEarned: Math.max(0, m.lifetimeEarned - amount) } : {}),
        },
      });
      return taken;
    });
  } catch (err) {
    if (isUniqueError(err)) return 0;
    throw err;
  }
}

/**
 * Spend coins on a reward. Atomic: fails (returns null) if the balance is short.
 */
export async function spend(member, { amount, description, idemKey }) {
  return prisma.$transaction(async (tx) => {
    const res = await tx.member.updateMany({
      where: { id: member.id, balance: { gte: amount } },
      data: { balance: { decrement: amount }, lastActivityAt: new Date(), expiryWarnedAt: null },
    });
    if (res.count !== 1) return null;
    return tx.transaction.create({
      data: { memberId: member.id, amount: -amount, kind: "redeem", description, idemKey, countsToTier: false },
    });
  });
}

/** Give coins back when creating the reward in Shopify failed after they were spent. */
export async function undoSpend(member, spendTxn, reason) {
  await prisma.$transaction([
    prisma.transaction.create({
      data: { memberId: member.id, amount: -spendTxn.amount, kind: "redeem_undo", description: reason, countsToTier: false },
    }),
    prisma.member.update({ where: { id: member.id }, data: { balance: { increment: -spendTxn.amount } } }),
  ]);
}

// ---- tiers ----------------------------------------------------------------------------------------

/** Move the member up if their lifetime coins reached a new tier, and issue that tier's entry reward. */
export async function checkTier(memberId) {
  const m = await prisma.member.findUnique({ where: { id: memberId } });
  const target = resolveTier(m.tier, m.lifetimeEarned);
  if (tierIndex(target.key) <= tierIndex(m.tier)) return m;
  const res = await prisma.member.updateMany({ where: { id: memberId, tier: m.tier }, data: { tier: target.key } });
  if (res.count !== 1) return prisma.member.findUnique({ where: { id: memberId } }); // someone else moved it
  const updated = { ...m, tier: target.key };
  // A customer who jumps tiers gets the entry reward of the tier they land in.
  await issueTierEntry(updated, target, { prevTier: m.tier }).catch((e) => console.error(`Tier reward ${target.key} failed for ${m.customerId}`, e));
  const latest = await prisma.member.findUnique({ where: { id: memberId } });
  await sendEvent(METRICS.tier, snapshot(latest), { tier: target.name, reward: target.entry.title, unique_id: `tier-${memberId}-${target.key}` });
  return latest;
}

/**
 * Entry reward for a tier: a discount code (Poke Ball), a gift card, and/or bonus coins.
 * Each one is claimed by a unique idemKey first, so it can never be issued twice.
 */
export async function issueTierEntry(member, tier, { prevTier = null } = {}) {
  const { entry } = tier;
  const admin = await adminClient();

  if (entry.discountCents || entry.giftCardCents) {
    const idemKey = `tier:${member.id}:${tier.key}`;
    let claim;
    try {
      claim = await prisma.reward.create({
        data: {
          memberId: member.id,
          kind: entry.giftCardCents ? "gift_card" : "tier_discount",
          title: `${tier.name}: ${entry.giftCardCents ? formatMoney(entry.giftCardCents) + " gift card" : entry.title}`,
          valueCents: entry.giftCardCents || entry.discountCents,
          idemKey,
          prevTier,
        },
      });
    } catch (err) {
      if (!isUniqueError(err)) throw err;
    }
    if (claim) {
      try {
        let made;
        if (entry.giftCardCents) {
          try {
            made = await createGiftCard(admin, {
              customerId: member.customerId,
              amountCents: entry.giftCardCents,
              note: `Collector Coins ${tier.name} reward`,
            });
          } catch (err) {
            // Attaching a gift card to a customer needs write_customers, which the app doesn't have.
            // An unattached gift card works the same at checkout (balance carries over, covers shipping/tax).
            try {
              made = await createGiftCard(admin, {
                amountCents: entry.giftCardCents,
                note: `Collector Coins ${tier.name} reward for customer ${member.customerId}`,
              });
            } catch (err2) {
            // No gift card access at all: fall back to a one-time discount code of the same value.
            console.error("Gift card failed, issuing a discount code instead", err.message, "/", err2.message);
            made = await createDiscountCode(admin, {
              code: makeCode("VIP"),
              title: `Collector Coins ${tier.name} reward`,
              customerId: member.customerId,
              amountCents: entry.giftCardCents,
            });
            await prisma.reward.update({ where: { id: claim.id }, data: { kind: "tier_discount", title: `${tier.name}: ${formatMoney(entry.giftCardCents)} off` } });
            }
          }
        } else {
          made = await createDiscountCode(admin, {
            code: makeCode("WELCOME"),
            title: `Collector Coins ${tier.name} reward`,
            customerId: member.customerId,
            amountCents: entry.discountCents,
            minimumCents: entry.minimumCents,
          });
        }
        const reward = await prisma.reward.update({ where: { id: claim.id }, data: { code: made.code, shopifyId: made.id } });
        const m = await prisma.member.findUnique({ where: { id: member.id } });
        await sendEvent(METRICS.reward, snapshot(m), {
          reward: reward.title, code: made.code, kind: reward.kind, tier: tier.name, unique_id: `reward-${reward.id}`,
        });
      } catch (err) {
        await prisma.reward.delete({ where: { id: claim.id } }).catch(() => {});
        throw err;
      }
    }
  }

  if (entry.bonusCoins) {
    await credit(member, {
      amount: entry.bonusCoins,
      kind: "tier_bonus",
      description: `${tier.name} bonus`,
      idemKey: `tierbonus:${member.id}:${tier.key}`,
    });
  }
}

/**
 * After a refund lowers lifetime coins: take away any tier the member no longer qualifies for, if it was reached
 * in the last TIER_REVOKE_DAYS (so refunding the order that unlocked a tier doesn't keep its rewards). The tier's
 * gift card or code is switched off and its bonus coins taken back. Tiers held longer than that, or brought over
 * from Smile, never drop. Returns the tier keys taken away.
 */
export async function revokeTiersAfterRefund(memberId, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - TIER_REVOKE_DAYS * 24 * 60 * 60 * 1000);
  const revoked = [];
  let admin;
  for (let guard = 0; guard < TIERS.length; guard++) {
    const m = await prisma.member.findUnique({ where: { id: memberId } });
    if (!m) break;
    const cur = tierIndex(m.tier);
    const qualifies = tierIndex(tierForLifetime(m.lifetimeEarned).key);
    if (cur === 0 || cur <= qualifies) break;
    const tier = TIERS[cur];
    const reward = await prisma.reward.findUnique({ where: { idemKey: `tier:${m.id}:${tier.key}` } });
    const bonus = await prisma.transaction.findUnique({ where: { idemKey: `tierbonus:${m.id}:${tier.key}` } });
    const reachedAt = reward?.createdAt || bonus?.createdAt;
    if (!reachedAt || reachedAt < since) break; // reached long ago, or carried over from Smile: keep it

    // Where they land: what their lifetime coins qualify for once this tier's own bonus is gone, but never
    // below the tier they held before reaching this one.
    const lifetimeWithoutBonus = Math.max(0, m.lifetimeEarned - (bonus?.amount || 0));
    const qualifiesAfter = tierIndex(tierForLifetime(lifetimeWithoutBonus).key);
    const back = TIERS[Math.min(cur - 1, Math.max(qualifiesAfter, reward?.prevTier ? tierIndex(reward.prevTier) : 0))];
    const moved = await prisma.member.updateMany({ where: { id: m.id, tier: tier.key }, data: { tier: back.key } });
    if (moved.count !== 1) continue; // another refund got here first; look again

    if (reward) {
      if (reward.code) {
        admin = admin || (await adminClient());
        await deactivateReward(admin, reward).catch((e) => console.error(`Could not switch off ${reward.code}`, e.message));
      }
      await prisma.reward.update({
        where: { id: reward.id },
        data: {
          idemKey: `revoked:${reward.id}`, // frees the tier so reaching it again issues a new reward
          code: null,
          title: `${reward.title} (cancelled after refund${reward.code ? `, was ${reward.code}` : ""})`,
        },
      });
    }
    if (bonus) {
      await prisma.transaction.update({ where: { id: bonus.id }, data: { idemKey: `revoked:${bonus.id}` } });
      await takeBack(m, {
        amount: bonus.amount,
        kind: "tier_bonus_revoked",
        description: `${tier.name} bonus taken back after a refund`,
        idemKey: `tierbonus-revoke:${bonus.id}`,
      });
    }
    console.log(`Tier ${tier.key} taken back from member ${m.customerId} after a refund (now ${back.key})`);
    revoked.push(tier.key);
  }
  return revoked;
}

// ---- reading ----------------------------------------------------------------------------------------

export function describeAmount(n) {
  return (n > 0 ? "+" : "") + formatCoins(n);
}
