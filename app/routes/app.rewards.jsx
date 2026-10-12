// Gift cards and codes the app has issued, with their live state in Shopify (balance left, used or not).
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { rewardStatuses } from "../coins/shopify.server";
import { formatCoins, formatMoney, tierByKey } from "../coins/rules";
import { StatGrid, FilterPills, fieldStyle } from "../components/ui";

const PAGE = 50;
const KINDS = {
  gift: { label: "Gift cards", where: { kind: "gift_card" } },
  tier: { label: "Tier reward codes", where: { kind: "tier_discount" } },
  discount: { label: "Coin discounts", where: { kind: "order_discount" } },
  prize: { label: "Free prizes", where: { kind: "free_product" } },
  all: { label: "Everything", where: {} },
};
const KIND_NAMES = { gift_card: "Gift card", tier_discount: "Tier reward code", order_discount: "Coin discount", free_product: "Free prize" };

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = KINDS[url.searchParams.get("type")] ? url.searchParams.get("type") : "gift";
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const where = { ...KINDS[type].where };
  if (q) {
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { member: { email: { contains: q, mode: "insensitive" } } },
      { member: { firstName: { contains: q, mode: "insensitive" } } },
      { member: { lastName: { contains: q, mode: "insensitive" } } },
    ];
  }
  const [rows, total, kindCounts, giftCards] = await Promise.all([
    prisma.reward.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { member: { select: { id: true, firstName: true, lastName: true, email: true, customerId: true, tier: true } } },
    }),
    prisma.reward.count({ where }),
    prisma.reward.groupBy({ by: ["kind"], _count: { _all: true }, _sum: { valueCents: true } }),
    prisma.reward.findMany({ where: { kind: "gift_card", shopifyId: { not: null } }, select: { shopifyId: true, valueCents: true, revokedAt: true }, take: 1000 }),
  ]);

  let statuses = new Map();
  let statusError = null;
  try {
    statuses = await rewardStatuses(admin, [...rows.map((r) => r.shopifyId), ...giftCards.map((g) => g.shopifyId)]);
  } catch (err) {
    statusError = err.message;
  }
  let giftIssuedCents = 0, giftLeftCents = 0, giftActive = 0;
  for (const g of giftCards) {
    giftIssuedCents += g.valueCents;
    const s = statuses.get(g.shopifyId);
    if (s?.type === "gift_card" && s.enabled) {
      giftLeftCents += s.balanceCents;
      if (s.balanceCents > 0) giftActive++;
    }
  }
  const counts = Object.fromEntries(kindCounts.map((k) => [k.kind, k._count._all]));
  return {
    type, q, page, total, statusError,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    counts: {
      gift: counts.gift_card || 0,
      tier: counts.tier_discount || 0,
      discount: counts.order_discount || 0,
      prize: counts.free_product || 0,
      all: Object.values(counts).reduce((s, n) => s + n, 0),
    },
    gift: { count: giftCards.length, issuedCents: giftIssuedCents, leftCents: giftLeftCents, active: giftActive },
    rows: rows.map((r) => ({ ...r, live: r.shopifyId ? statuses.get(r.shopifyId) || null : null })),
  };
};

function Status({ r }) {
  if (r.revokedAt) return <s-badge tone="critical">Taken back (refund)</s-badge>;
  const s = r.live;
  if (!r.shopifyId) return <s-badge tone="warning">Not created in Shopify</s-badge>;
  if (!s) return <s-text color="subdued">Unknown</s-text>;
  if (s.type === "gift_card") {
    if (!s.enabled) return <s-badge tone="neutral">Deactivated</s-badge>;
    if (s.balanceCents <= 0) return <s-badge tone="neutral">Used up</s-badge>;
    if (s.balanceCents < s.initialCents) return <s-badge tone="info">Partly used · {formatMoney(s.balanceCents)} left</s-badge>;
    return <s-badge tone="success">Unused · {formatMoney(s.balanceCents)}</s-badge>;
  }
  if (s.used > 0) return <s-badge tone="neutral">Used</s-badge>;
  if (s.status === "EXPIRED") return <s-badge tone="warning">Expired</s-badge>;
  if (s.status && s.status !== "ACTIVE") return <s-badge tone="warning">{s.status.toLowerCase()}</s-badge>;
  return <s-badge tone="success">Unused</s-badge>;
}

export default function Rewards() {
  const { type, q, page, pages, total, rows, counts, gift, statusError } = useLoaderData();
  const [params] = useSearchParams();
  const href = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    return `/app/rewards?${p.toString()}`;
  };
  return (
    <s-page heading="Gift Cards & Codes" inlineSize="large">
      {statusError && <s-banner tone="warning">Couldn't load live status from Shopify: {statusError}</s-banner>}
      <s-section>
        <StatGrid
          items={[
            { label: "Gift cards issued", value: formatCoins(gift.count), note: `${formatMoney(gift.issuedCents)} total` },
            { label: "Gift card balance still out", value: formatMoney(gift.leftCents), note: `${gift.active} cards with money left` },
            { label: "Coin discount codes", value: formatCoins(counts.discount), note: "250 coins = $1" },
            { label: "Free prize codes", value: formatCoins(counts.prize) },
          ]}
        />
      </s-section>
      <s-section>
        <s-stack gap="base">
          <FilterPills
            options={Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label, count: counts[value] }))}
            value={type}
            hrefFor={(v) => href({ type: v, page: "" })}
          />
          <Form method="get">
            <input type="hidden" name="type" value={type} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input name="q" defaultValue={q} placeholder="Search by code, email or name" style={{ ...fieldStyle, flex: "1 1 260px" }} />
              <s-button type="submit">Search</s-button>
              {q ? <Link to={href({ q: "", page: "" })}>Clear</Link> : null}
            </div>
          </Form>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Member</s-table-header>
              <s-table-header>Reward</s-table-header>
              <s-table-header>Code</s-table-header>
              <s-table-header format="numeric">Value</s-table-header>
              <s-table-header>Status in Shopify</s-table-header>
              <s-table-header>Issued</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <Link to={`/app/members/${r.member.id}`}>{[r.member.firstName, r.member.lastName].filter(Boolean).join(" ") || r.member.email || "(no name)"}</Link>
                    <br />
                    <s-text color="subdued">
                      {r.member.email || `Customer ${r.member.customerId}`} · {tierByKey(r.member.tier).name}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    {r.title}
                    <br />
                    <s-text color="subdued">
                      {KIND_NAMES[r.kind] || r.kind}
                      {r.coins ? ` · ${formatCoins(r.coins)} coins` : ""}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{r.code || "–"}</span>
                  </s-table-cell>
                  <s-table-cell>{r.valueCents ? formatMoney(r.valueCents) : "–"}</s-table-cell>
                  <s-table-cell>
                    <Status r={r} />
                  </s-table-cell>
                  <s-table-cell>{new Date(r.createdAt).toLocaleDateString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {!rows.length && <s-paragraph>Nothing here yet.</s-paragraph>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <s-text color="subdued">
              {formatCoins(total)} total · page {page} of {pages}
            </s-text>
            <s-stack direction="inline" gap="small-200">
              {page > 1 && <Link to={href({ page: String(page - 1) })}>← Newer</Link>}
              {page < pages && <Link to={href({ page: String(page + 1) })}>Older →</Link>}
            </s-stack>
          </div>
          <s-text color="subdued">
            Tier rewards are issued as gift cards when Shopify allows it, otherwise as a one-time code for the same amount. Codes taken back after a refund
            are switched off in Shopify.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
