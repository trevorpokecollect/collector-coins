// Engagement: how people use the coin panel (what opens it, which tabs, which earn and redeem buttons) and what
// actually paid out, plus who clicked a given button.
import { Link, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TRACKED, EVENT_NAMES, labelFor } from "../coins/metrics";
import { formatCoins } from "../coins/rules";
import { StatGrid, Bars, DailyBars, FilterPills, TierBadge } from "../components/ui";

const RANGES = { 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days" };
const DAY = 24 * 60 * 60 * 1000;

const EARN_KINDS = [
  { key: "purchase", label: "Orders" },
  { key: "review", label: "Product reviews" },
  { key: "alerts_signup", label: "Text & email alerts" },
  { key: "google", label: "Google reviews (staff added)" },
  { key: "birthday", label: "Birthdays" },
  { key: "tier_bonus", label: "Tier bonuses" },
  { key: "adjust", label: "Other staff adjustments" },
];

const num = (v) => Number(v || 0);

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const days = RANGES[url.searchParams.get("days")] ? Number(url.searchParams.get("days")) : 30;
  const pick = url.searchParams.get("who"); // "event:target"
  const since = new Date(Date.now() - days * DAY);

  const [groups, perDay, openers, first, earnRows, googleRow, recent] = await Promise.all([
    prisma.$queryRaw`
      SELECT "event", "target", COUNT(*)::int AS n, COUNT(DISTINCT COALESCE("memberId", "visitor"))::int AS u,
             COUNT(DISTINCT "memberId")::int AS m
      FROM "PanelEvent" WHERE "createdAt" >= ${since} GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT to_char(("createdAt" AT TIME ZONE 'America/Chicago')::date, 'Mon DD') AS day, ("createdAt" AT TIME ZONE 'America/Chicago')::date AS d,
             COUNT(*)::int AS n
      FROM "PanelEvent" WHERE "event" = 'open' AND "createdAt" >= ${since} GROUP BY 1, 2 ORDER BY 2`,
    prisma.$queryRaw`
      SELECT COUNT(DISTINCT COALESCE("memberId", "visitor"))::int AS u, COUNT(DISTINCT "memberId")::int AS m
      FROM "PanelEvent" WHERE "event" = 'open' AND "createdAt" >= ${since}`,
    prisma.panelEvent.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.transaction.groupBy({
      by: ["kind"],
      where: { createdAt: { gte: since }, amount: { gt: 0 }, kind: { in: EARN_KINDS.map((k) => k.key).filter((k) => k !== "google") } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { createdAt: { gte: since }, amount: { gt: 0 }, kind: "adjust", description: { contains: "google review", mode: "insensitive" } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.panelEvent.findMany({ where: { memberId: { not: null }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);

  const g = (event, target) => groups.find((x) => x.event === event && x.target === target) || { n: 0, u: 0, m: 0 };

  // Daily opens, with empty days filled in
  const byDay = new Map(perDay.map((r) => [r.day, num(r.n)]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "America/Chicago" }).replace(",", "");
    series.push({ label, value: byDay.get(label) || 0 });
  }

  const earn = EARN_KINDS.map((k) => {
    if (k.key === "google") return { ...k, count: googleRow._count._all, coins: num(googleRow._sum.amount) };
    const row = earnRows.find((r) => r.kind === k.key);
    let count = row?._count._all || 0, coins = num(row?._sum.amount);
    if (k.key === "adjust") { count -= googleRow._count._all; coins -= num(googleRow._sum.amount); }
    return { ...k, count, coins };
  });

  // Who did one particular thing
  let who = null;
  if (pick && pick.includes(":")) {
    const [event, target] = pick.split(":");
    if (TRACKED[event]?.[target]) {
      const rows = await prisma.$queryRaw`
        SELECT "memberId", COUNT(*)::int AS n, MAX("createdAt") AS last
        FROM "PanelEvent" WHERE "event" = ${event} AND "target" = ${target} AND "memberId" IS NOT NULL AND "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 3 DESC LIMIT 200`;
      const members = await prisma.member.findMany({
        where: { id: { in: rows.map((r) => r.memberId) } },
        select: { id: true, firstName: true, lastName: true, email: true, tier: true, balance: true },
      });
      const done = target === "alerts"
        ? new Set((await prisma.transaction.findMany({ where: { kind: "alerts_signup", memberId: { in: rows.map((r) => r.memberId) } }, select: { memberId: true } })).map((t) => t.memberId))
        : null;
      const byId = new Map(members.map((m) => [m.id, m]));
      who = {
        label: labelFor(event, target),
        anonymous: g(event, target).u - g(event, target).m,
        rows: rows.filter((r) => byId.has(r.memberId)).map((r) => ({ ...byId.get(r.memberId), times: num(r.n), last: r.last, done: done ? done.has(r.memberId) : null })),
      };
    }
  }

  const recentMembers = await prisma.member.findMany({
    where: { id: { in: [...new Set(recent.map((r) => r.memberId))] } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const nameOf = new Map(recentMembers.map((m) => [m.id, [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || "(no name)"]));

  return {
    days,
    since: since.toISOString(),
    trackingSince: first?.createdAt || null,
    openers: { visitors: num(openers[0]?.u), members: num(openers[0]?.m) },
    opens: Object.keys(TRACKED.open).map((t) => ({ target: t, label: TRACKED.open[t], ...g("open", t) })),
    tabs: Object.keys(TRACKED.tab).map((t) => ({ target: t, label: TRACKED.tab[t], ...g("tab", t) })),
    clicks: [
      ...Object.keys(TRACKED.click).map((t) => ({ event: "click", target: t, label: TRACKED.click[t], ...g("click", t) })),
      ...Object.keys(TRACKED.submit).map((t) => ({ event: "submit", target: t, label: TRACKED.submit[t], ...g("submit", t) })),
    ].sort((a, b) => b.n - a.n),
    alertsFunnel: [
      { label: "Saw the Earn tab", value: g("tab", "home").u },
      { label: "Started typing a number", value: g("click", "alerts").u },
      { label: "Pressed Turn On Alerts", value: g("submit", "alerts").u },
      { label: "Signed up (coins paid)", value: earn.find((e) => e.key === "alerts_signup").count },
    ],
    series,
    earn,
    who,
    recent: recent.map((r) => ({ id: r.id, memberId: r.memberId, name: nameOf.get(r.memberId) || "Member", what: `${EVENT_NAMES[r.event] || r.event}: ${labelFor(r.event, r.target)}`, at: r.createdAt, path: r.path })),
  };
};

export default function Engagement() {
  const d = useLoaderData();
  const [params] = useSearchParams();
  const href = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    return `/app/engagement?${p.toString()}`;
  };
  const totalOpens = d.opens.reduce((s, o) => s + o.n, 0);
  const earnedCoins = d.earn.reduce((s, e) => s + e.coins, 0);
  return (
    <s-page heading="Engagement" inlineSize="large">
      <s-section>
        <s-stack gap="base">
          <FilterPills options={Object.entries(RANGES).map(([value, label]) => ({ value, label }))} value={String(d.days)} hrefFor={(v) => href({ days: v, who: "" })} />
          {(!d.trackingSince || new Date(d.trackingSince) > new Date(d.since)) && (
            <s-banner tone="info">
              Panel click tracking {d.trackingSince ? `started ${new Date(d.trackingSince).toLocaleDateString()}` : "starts as soon as people use the panel"}, so
              earlier days show no clicks. Coins paid (bottom) cover the whole range.
            </s-banner>
          )}
          <StatGrid
            items={[
              { label: "Panel opens", value: formatCoins(totalOpens), note: `${formatCoins(d.openers.visitors)} different people` },
              { label: "Signed-in members who opened it", value: formatCoins(d.openers.members) },
              { label: "Alert sign-ups", value: formatCoins(d.alertsFunnel[3].value), note: "from the panel card" },
              { label: "Coins earned", value: formatCoins(earnedCoins), note: RANGES[d.days].toLowerCase() },
            ]}
          />
        </s-stack>
      </s-section>

      <s-section heading="Panel opens per day">
        <DailyBars points={d.series} color="#e22f39" />
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
        <s-section heading="How people open the panel">
          <Bars rows={d.opens.map((o) => ({ label: o.label, value: o.n, display: `${formatCoins(o.n)}` }))} />
        </s-section>
        <s-section heading="Tabs viewed">
          <Bars rows={d.tabs.map((o) => ({ label: o.label, value: o.n, display: formatCoins(o.n) }))} color="#303030" />
        </s-section>
      </s-grid>

      <s-section heading="Text & email alerts funnel">
        <Bars rows={d.alertsFunnel.map((f) => ({ label: f.label, value: f.value, display: formatCoins(f.value), color: "#e22f39" }))} max={Math.max(1, d.alertsFunnel[0].value)} />
        <s-paragraph>
          <s-text color="subdued">Counts are people, not clicks. The card only shows to signed-in members who haven't joined yet.</s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Buttons and links">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">What</s-table-header>
            <s-table-header format="numeric">Clicks</s-table-header>
            <s-table-header format="numeric">People</s-table-header>
            <s-table-header format="numeric">Signed-in members</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {d.clicks.map((c) => (
              <s-table-row key={c.event + c.target}>
                <s-table-cell>{c.label}</s-table-cell>
                <s-table-cell>{formatCoins(c.n)}</s-table-cell>
                <s-table-cell>{formatCoins(c.u)}</s-table-cell>
                <s-table-cell>{formatCoins(c.m)}</s-table-cell>
                <s-table-cell>{c.m ? <Link to={href({ who: `${c.event}:${c.target}` })}>See who</Link> : null}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {d.who && (
        <s-section heading={`Who: ${d.who.label}`}>
          <s-stack gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Member</s-table-header>
                <s-table-header>Tier</s-table-header>
                <s-table-header format="numeric">Times</s-table-header>
                <s-table-header>Last</s-table-header>
                {d.who.rows.some((r) => r.done !== null) && <s-table-header>Signed up?</s-table-header>}
              </s-table-header-row>
              <s-table-body>
                {d.who.rows.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      <Link to={`/app/members/${r.id}`}>{[r.firstName, r.lastName].filter(Boolean).join(" ") || "(no name)"}</Link>
                      <br />
                      <s-text color="subdued">{r.email}</s-text>
                    </s-table-cell>
                    <s-table-cell><TierBadge tier={r.tier} /></s-table-cell>
                    <s-table-cell>{r.times}</s-table-cell>
                    <s-table-cell>{new Date(r.last).toLocaleString()}</s-table-cell>
                    {r.done !== null && <s-table-cell>{r.done ? <s-badge tone="success">Yes</s-badge> : <s-badge tone="warning">Not yet</s-badge>}</s-table-cell>}
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            {d.who.anonymous > 0 && <s-text color="subdued">Plus {formatCoins(d.who.anonymous)} people who weren't signed in.</s-text>}
            <Link to={href({ who: "" })}>Close</Link>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Coins paid by way of earning">
        <Bars rows={d.earn.map((e) => ({ label: `${e.label} (${formatCoins(e.count)})`, value: e.coins, display: `${formatCoins(e.coins)} coins`, color: "#c9a400" }))} />
      </s-section>

      <s-section heading="Latest member activity in the panel">
        {d.recent.length ? (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Member</s-table-header>
              <s-table-header>What</s-table-header>
              <s-table-header>Page</s-table-header>
              <s-table-header>When</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.recent.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell><Link to={`/app/members/${r.memberId}`}>{r.name}</Link></s-table-cell>
                  <s-table-cell>{r.what}</s-table-cell>
                  <s-table-cell><s-text color="subdued">{r.path || ""}</s-text></s-table-cell>
                  <s-table-cell>{new Date(r.at).toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-paragraph>No signed-in activity yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
