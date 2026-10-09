// Staff home: program status, member search and the newest members.
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { programMode, testerTag, earnSources } from "../coins/ledger.server";
import { tierByKey, formatCoins } from "../coins/rules";
import { judgemeWebhookUrl, connectJudgeme } from "../coins/events.server";
import { redemptionsByDay, checkRedemptionSpike, expiryStats } from "../coins/expiry.server";
import { formatMoney, EXPIRY_MONTHS } from "../coins/rules";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { customerId: q },
        ],
      }
    : {};
  const [members, count, sums, days, spike, expiry] = await Promise.all([
    prisma.member.findMany({ where, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.member.count(),
    prisma.member.aggregate({ _sum: { balance: true } }),
    redemptionsByDay(14),
    checkRedemptionSpike(),
    expiryStats(),
  ]);
  return {
    q,
    members,
    count,
    outstanding: sums._sum.balance || 0,
    mode: programMode(),
    testerTag: testerTag(),
    sources: earnSources().join(", "),
    judgeme: judgemeWebhookUrl(),
    klaviyo: Boolean(process.env.KLAVIYO_PRIVATE_KEY),
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

export default function Members() {
  const { q, members, count, outstanding, mode, testerTag, sources, judgeme, klaviyo, judgemeToken, days, spike, expiry, alertEmail } = useLoaderData();
  const result = useActionData();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Collector Coins">
      <s-section heading="Program">
        <s-stack gap="small-200">
          <s-paragraph>
            Mode:{" "}
            {mode === "live" ? (
              <s-badge tone="success">Live for everyone</s-badge>
            ) : (
              <s-badge tone="warning">Testing: only customers tagged "{testerTag}"</s-badge>
            )}
          </s-paragraph>
          <s-paragraph>
            {formatCoins(count)} members · {formatCoins(outstanding)} coins unspent (about ${formatCoins(Math.round(outstanding / 250))} in
            discounts) · Orders that earn: {sources}
          </s-paragraph>
          <s-paragraph>Klaviyo events: {klaviyo ? "on" : "off (add KLAVIYO_PRIVATE_KEY in Railway)"}</s-paragraph>
          {result?.ok && <s-banner tone="success">{result.ok}</s-banner>}
          {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
          <s-paragraph>
            Judge.me reviews:{" "}
            {judgemeToken ? "token added. Click Connect Judge.me once." : "add JUDGEME_API_TOKEN in Railway, then click Connect."}
          </s-paragraph>
          {judgemeToken && (
            <Form method="post">
              <input type="hidden" name="intent" value="judgeme" />
              <s-button type="submit" loading={busy || undefined}>Connect Judge.me</s-button>
            </Form>
          )}
          {judgeme && (
            <s-paragraph>
              <s-text color="subdued">Webhook address: {judgeme}</s-text>
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Redemptions">
        {spike.spiking && (
          <s-banner tone="critical">
            Redemptions are unusually high today: {formatMoney(spike.today.valueCents)} so far, against a normal {formatMoney(spike.avgCents)} a day.
          </s-banner>
        )}
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
            {days.map((d) => (
              <s-table-row key={d.day}>
                <s-table-cell>{d.day}</s-table-cell>
                <s-table-cell>{d.count}</s-table-cell>
                <s-table-cell>{d.discounts}</s-table-cell>
                <s-table-cell>{d.prizes}</s-table-cell>
                <s-table-cell>{formatCoins(d.coins)}</s-table-cell>
                <s-table-cell>{formatMoney(d.valueCents)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <s-paragraph>
          <s-text color="subdued">
            Prize value is retail price; your real cost is what you paid for the product. Coins expire after {EXPIRY_MONTHS} months with no earning or
            redeeming: {formatCoins(expiry.expiringMembers)} members ({formatCoins(expiry.expiringCoins)} coins) are within 30 days of expiring, and{" "}
            {formatCoins(expiry.expiredLast30)} coins expired in the last 30 days.
          </s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Members">
        <Form method="get">
          <s-stack direction="inline" gap="small-200">
            <s-text-field name="q" label="Search by email, name or customer ID" labelAccessibilityVisibility="exclusive" placeholder="Search by email, name or customer ID" value={q}></s-text-field>
            <s-button type="submit">Search</s-button>
          </s-stack>
        </Form>
        <s-table>
          <s-table-header-row>
            <s-table-header>Member</s-table-header>
            <s-table-header>Tier</s-table-header>
            <s-table-header format="numeric">Balance</s-table-header>
            <s-table-header format="numeric">Lifetime</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {members.map((m) => (
              <s-table-row key={m.id}>
                <s-table-cell>
                  <Link to={`/app/members/${m.id}`}>
                    {[m.firstName, m.lastName].filter(Boolean).join(" ") || "(no name)"}
                  </Link>
                  <br />
                  <s-text color="subdued">{m.email || `Customer ${m.customerId}`}</s-text>
                </s-table-cell>
                <s-table-cell>{tierByKey(m.tier).name}</s-table-cell>
                <s-table-cell>{formatCoins(m.balance)}</s-table-cell>
                <s-table-cell>{formatCoins(m.lifetimeEarned)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {!members.length && <s-paragraph>No members found.</s-paragraph>}
      </s-section>
    </s-page>
  );
}
