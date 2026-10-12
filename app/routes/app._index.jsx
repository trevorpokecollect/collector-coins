// Staff home: headline numbers, tiers, coins in and out, redemptions and program connections.
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { programMode, testerTag, earnSources } from "../coins/ledger.server";
import { TIERS, formatCoins, COINS_PER_DOLLAR_OFF } from "../coins/rules";
import { StatGrid, Bars, DailyBars, tierColor } from "../components/ui";
import { judgemeWebhookUrl, connectJudgeme } from "../coins/events.server";
import { redemptionsByDay, checkRedemptionSpike, expiryStats } from "../coins/expiry.server";
import { klaviyoCanSubscribe } from "../coins/klaviyo.server";
import { formatMoney, EXPIRY_MONTHS } from "../coins/rules";

const DAY = 24 * 60 * 60 * 1000;

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const since30 = new Date(Date.now() - 30 * DAY);
  const [count, newMembers, sums, tierRows, active30, earned30, spent30, daily, days, spike, expiry, canSubscribe] = await Promise.all([
    prisma.member.count(),
    prisma.member.count({ where: { createdAt: { gte: since30 }, importedFromSmile: false } }),
    prisma.member.aggregate({ _sum: { balance: true } }),
    prisma.member.groupBy({ by: ["tier"], _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT COUNT(DISTINCT "memberId")::int AS n FROM "Transaction"
      WHERE "createdAt" >= ${since30} AND "kind" NOT IN ('import', 'expire', 'redeem_undo')`,
    prisma.transaction.aggregate({ where: { createdAt: { gte: since30 }, amount: { gt: 0 }, kind: { notIn: ["import", "redeem_undo"] } }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { createdAt: { gte: since30 }, kind: "redeem" }, _sum: { amount: true } }),
    prisma.$queryRaw`
      SELECT to_char(("createdAt" AT TIME ZONE 'America/Chicago')::date, 'Mon DD') AS day,
             COALESCE(SUM(CASE WHEN "amount" > 0 AND "kind" NOT IN ('import', 'redeem_undo') THEN "amount" END), 0)::int AS earned,
             COALESCE(-SUM(CASE WHEN "kind" = 'redeem' THEN "amount" END), 0)::int AS spent
      FROM "Transaction" WHERE "createdAt" >= ${since30} GROUP BY 1`,
    redemptionsByDay(14),
    checkRedemptionSpike(),
    expiryStats(),
    klaviyoCanSubscribe(),
  ]);
  const byDay = new Map(daily.map((r) => [r.day, r]));
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const label = new Date(Date.now() - i * DAY).toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "America/Chicago" }).replace(",", "");
    series.push({ label, earned: Number(byDay.get(label)?.earned || 0), spent: Number(byDay.get(label)?.spent || 0) });
  }
  const tierCounts = Object.fromEntries(tierRows.map((t) => [t.tier, t._count._all]));
  return {
    count,
    newMembers,
    active30: Number(active30[0]?.n || 0),
    outstanding: sums._sum.balance || 0,
    earned30: earned30._sum.amount || 0,
    spent30: -(spent30._sum.amount || 0),
    tiers: TIERS.map((t) => ({ key: t.key, name: t.name, count: tierCounts[t.key] || 0 })),
    series,
    mode: programMode(),
    testerTag: testerTag(),
    sources: earnSources().join(", "),
    judgeme: judgemeWebhookUrl(),
    klaviyo: Boolean(process.env.KLAVIYO_PRIVATE_KEY2 || process.env.KLAVIYO_PRIVATE_KEY),
    canSubscribe,
    judgemeToken: Boolean(process.env.JUDGEME_API_TOKEN),
    days,
    spike,
    expiry,
    alertEmail: process.env.ALERT_EMAIL || null,
  };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "judgeme") return null;
  try {
    await connectJudgeme();
    return { ok: "Judge.me is connected. New product reviews now earn 100 coins." };
  } catch (err) {
    return { error: err.message };
  }
};

export default function Overview() {
  const d = useLoaderData();
  const { mode, testerTag, sources, judgeme, klaviyo, canSubscribe, judgemeToken, days, spike, expiry, alertEmail } = d;
  const result = useActionData();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Collector Coins" inlineSize="large">
      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {mode === "live" ? (
              <s-badge tone="success">Live for everyone</s-badge>
            ) : (
              <s-badge tone="warning">Testing: only customers tagged "{testerTag}"</s-badge>
            )}
            {d.spike.spiking && <s-badge tone="critical">Redemptions unusually high today</s-badge>}
          </s-stack>
          <StatGrid
            items={[
              { label: "Members", value: formatCoins(d.count), note: `${formatCoins(d.newMembers)} joined in the last 30 days` },
              { label: "Active in the last 30 days", value: formatCoins(d.active30), note: "earned or redeemed" },
              { label: "Unspent coins", value: formatCoins(d.outstanding), note: `about $${formatCoins(Math.round(d.outstanding / COINS_PER_DOLLAR_OFF))} in discounts` },
              { label: "Earned, last 30 days", value: formatCoins(d.earned30), note: `${formatCoins(d.spent30)} redeemed` },
            ]}
          />
        </s-stack>
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
        <s-section heading="Members by tier">
          <s-stack gap="base">
            <Bars rows={d.tiers.map((t) => ({ label: t.name, value: t.count, display: formatCoins(t.count), color: tierColor(t.key) }))} />
            <Link to="/app/members">Browse members by tier →</Link>
          </s-stack>
        </s-section>
        <s-section heading="Coins earned per day (30 days)">
          <DailyBars points={d.series.map((p) => ({ label: p.label, value: p.earned }))} color="#c9a400" format={formatCoins} />
        </s-section>
      </s-grid>

      <s-section heading="Redemptions">
        <s-stack gap="base">
          {spike.spiking && (
            <s-banner tone="critical">
              Redemptions are unusually high today: {formatMoney(spike.today.valueCents)} so far, against a normal {formatMoney(spike.avgCents)} a day.
            </s-banner>
          )}
          <DailyBars points={d.series.map((p) => ({ label: p.label, value: p.spent }))} color="#e22f39" format={formatCoins} />
          <s-paragraph>
            Today: {spike.today.count} redemptions, {formatMoney(spike.today.valueCents)} ({formatCoins(spike.today.coins)} coins). Alert above{" "}
            {formatMoney(spike.thresholdCents)} a day{alertEmail ? `, emailed to ${alertEmail} through Klaviyo` : " (add ALERT_EMAIL in Railway to get an email)"}.
          </s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header>Day</s-table-header>
              <s-table-header format="numeric">Redemptions</s-table-header>
              <s-table-header format="numeric">Discounts</s-table-header>
              <s-table-header format="numeric">Prizes</s-table-header>
              <s-table-header format="numeric">Coins</s-table-header>
              <s-table-header format="numeric">Value</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {days.map((x) => (
                <s-table-row key={x.day}>
                  <s-table-cell>{x.day}</s-table-cell>
                  <s-table-cell>{x.count}</s-table-cell>
                  <s-table-cell>{x.discounts}</s-table-cell>
                  <s-table-cell>{x.prizes}</s-table-cell>
                  <s-table-cell>{formatCoins(x.coins)}</s-table-cell>
                  <s-table-cell>{formatMoney(x.valueCents)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-text color="subdued">
            Prize value is retail price; your real cost is what you paid for the product. Coins expire after {EXPIRY_MONTHS} months with no earning or
            redeeming: {formatCoins(expiry.expiringMembers)} members ({formatCoins(expiry.expiringCoins)} coins) are within 30 days of expiring, and{" "}
            {formatCoins(expiry.expiredLast30)} coins expired in the last 30 days.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Connections">
        <s-stack gap="small-200">
          {result?.ok && <s-banner tone="success">{result.ok}</s-banner>}
          {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
          <s-paragraph>Orders that earn: {sources}</s-paragraph>
          <s-paragraph>Klaviyo events: {klaviyo ? <s-badge tone="success">On</s-badge> : "off (add KLAVIYO_PRIVATE_KEY in Railway)"}</s-paragraph>
          <s-paragraph>
            Text &amp; email alert sign-ups:{" "}
            {canSubscribe === true ? (
              <s-badge tone="success">Ready</s-badge>
            ) : canSubscribe === false ? (
              "the Klaviyo key needs the \"Subscriptions: write\" and \"Lists: write\" scopes (Klaviyo → Settings → API keys)"
            ) : (
              "couldn't reach Klaviyo to check"
            )}
          </s-paragraph>
          <s-paragraph>
            Judge.me reviews:{" "}
            {judgemeToken ? <s-badge tone="success">Token added</s-badge> : "add JUDGEME_API_TOKEN in Railway, then click Connect."}
          </s-paragraph>
          {judgemeToken && (
            <Form method="post">
              <input type="hidden" name="intent" value="judgeme" />
              <s-button type="submit" loading={busy || undefined}>Reconnect Judge.me</s-button>
            </Form>
          )}
          {judgeme && (
            <s-paragraph>
              <s-text color="subdued">Webhook address: {judgeme}</s-text>
            </s-paragraph>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
