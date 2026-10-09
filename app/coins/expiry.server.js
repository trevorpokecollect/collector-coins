// Coin expiry (12 months with no earning or redeeming) and the redemption spike alert.
import prisma from "../db.server";
import { EXPIRY_MONTHS, EXPIRY_WARN_DAYS, expiryDate, redemptionAlertThreshold, formatCoins, formatMoney, monthDayInZone } from "./rules";
import { takeBack, snapshot } from "./ledger.server";
import { sendEvent, METRICS } from "./klaviyo.server";

const DAY = 24 * 60 * 60 * 1000;

function monthsAgo(now, months) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/**
 * Daily: warn members whose coins expire within 30 days (once), then expire balances
 * with no activity for 12 months. Works in batches so a big run doesn't hold the database.
 */
export async function runExpiry(now = new Date()) {
  let warned = 0, expired = 0;

  // 1. Warnings: inactive for (12 months - 30 days), not yet warned.
  const warnBefore = new Date(monthsAgo(now, EXPIRY_MONTHS).getTime() + EXPIRY_WARN_DAYS * DAY);
  for (;;) {
    const batch = await prisma.member.findMany({
      where: { balance: { gt: 0 }, expiryWarnedAt: null, lastActivityAt: { lt: warnBefore } },
      take: 200,
    });
    if (!batch.length) break;
    for (const m of batch) {
      await prisma.member.update({ where: { id: m.id }, data: { expiryWarnedAt: now } });
      const on = expiryDate(m.lastActivityAt);
      await sendEvent(METRICS.expiring, snapshot(m), {
        coins: m.balance,
        expires_on: on.toISOString().slice(0, 10),
        expires_on_text: on.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }),
        value: formatMoney(Math.floor(m.balance / 250) * 100),
        unique_id: `expiring-${m.id}-${on.toISOString().slice(0, 10)}`,
      });
      warned++;
    }
  }

  // 2. Expire: inactive for 12 months.
  const cutoff = monthsAgo(now, EXPIRY_MONTHS);
  for (;;) {
    const batch = await prisma.member.findMany({ where: { balance: { gt: 0 }, lastActivityAt: { lt: cutoff } }, take: 200 });
    if (!batch.length) break;
    for (const m of batch) {
      const taken = await takeBack(m, {
        amount: m.balance,
        kind: "expire",
        description: `Coins expired after ${EXPIRY_MONTHS} months without activity`,
        idemKey: `expire:${m.id}:${m.lastActivityAt.toISOString()}`,
        reduceLifetime: false,
      });
      if (taken) {
        await sendEvent(METRICS.expired, snapshot({ ...m, balance: 0 }), { coins: taken, unique_id: `expired-${m.id}-${m.lastActivityAt.toISOString()}` });
        expired++;
      } else {
        // Already expired this period (idemKey used) but balance came back somehow: leave it, avoid looping.
        await prisma.member.update({ where: { id: m.id }, data: { lastActivityAt: now } });
      }
    }
  }
  return { warned, expired };
}

/** Redemptions per day (store time zone) for the last `days` days, newest first. */
export async function redemptionsByDay(days = 14, now = new Date()) {
  const since = new Date(now.getTime() - (days + 1) * DAY);
  const rows = await prisma.reward.findMany({
    where: { createdAt: { gte: since }, coins: { gt: 0 } },
    select: { createdAt: true, coins: true, valueCents: true, kind: true },
  });
  const byDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = monthDayInZone(new Date(now.getTime() - i * DAY));
    const key = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    byDay.set(key, { day: key, count: 0, coins: 0, valueCents: 0, discounts: 0, prizes: 0 });
  }
  for (const r of rows) {
    const d = monthDayInZone(r.createdAt);
    const key = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    const row = byDay.get(key);
    if (!row) continue;
    row.count++;
    row.coins += r.coins;
    row.valueCents += r.valueCents;
    if (r.kind === "free_product") row.prizes++;
    else row.discounts++;
  }
  return [...byDay.values()];
}

const alertState = (globalThis.__coinsAlert ||= { day: null });

/** Hourly: if today's redeemed value is unusually high, send one alert for the day. */
export async function checkRedemptionSpike(now = new Date()) {
  const days = await redemptionsByDay(31, now);
  const [today, ...prior] = days;
  const avg = prior.reduce((s, d) => s + d.valueCents, 0) / Math.max(1, prior.length);
  const minCents = Math.round(Number(process.env.REDEMPTION_ALERT_MIN_DOLLARS || 100) * 100);
  const threshold = redemptionAlertThreshold(avg, minCents);
  const spiking = today.valueCents > threshold;
  if (spiking && alertState.day !== today.day) {
    alertState.day = today.day;
    const msg = `${today.count} redemptions today worth ${formatMoney(today.valueCents)} (${formatCoins(today.coins)} coins). Normal is about ${formatMoney(Math.round(avg))} a day.`;
    console.warn(`REDEMPTION SPIKE: ${msg}`);
    const email = process.env.ALERT_EMAIL;
    if (email) {
      await sendEvent(METRICS.alert, { email, balance: 0, tierName: "", lifetimeEarned: 0 }, {
        message: msg, redemptions: today.count, value: formatMoney(today.valueCents), coins: today.coins, unique_id: `alert-${today.day}`,
      });
    }
  }
  return { today, avgCents: Math.round(avg), thresholdCents: threshold, spiking };
}

/** Numbers for the admin page. */
export async function expiryStats(now = new Date()) {
  const warnBefore = new Date(monthsAgo(now, EXPIRY_MONTHS).getTime() + EXPIRY_WARN_DAYS * DAY);
  const [soon, expired30] = await Promise.all([
    prisma.member.aggregate({ where: { balance: { gt: 0 }, lastActivityAt: { lt: warnBefore } }, _count: true, _sum: { balance: true } }),
    prisma.transaction.aggregate({ where: { kind: "expire", createdAt: { gte: new Date(now.getTime() - 30 * DAY) } }, _sum: { amount: true } }),
  ]);
  return {
    expiringMembers: soon._count,
    expiringCoins: soon._sum.balance || 0,
    expiredLast30: -(expired30._sum.amount || 0),
    firstPossibleExpiry: null,
  };
}
