// Members: search, filter by tier, sort and page through everyone in the program.
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TIERS, formatCoins } from "../coins/rules";
import { FilterPills, TierBadge, fieldStyle } from "../components/ui";

const PAGE = 50;
const SORTS = {
  recent: { label: "Recently updated", orderBy: { updatedAt: "desc" } },
  balance: { label: "Highest balance", orderBy: { balance: "desc" } },
  lifetime: { label: "Most earned", orderBy: { lifetimeEarned: "desc" } },
  newest: { label: "Newest members", orderBy: { createdAt: "desc" } },
  active: { label: "Last active", orderBy: { lastActivityAt: "desc" } },
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const tier = TIERS.some((t) => t.key === url.searchParams.get("tier")) ? url.searchParams.get("tier") : "";
  const sort = SORTS[url.searchParams.get("sort")] ? url.searchParams.get("sort") : "recent";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const search = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { customerId: q },
        ],
      }
    : {};
  const where = { ...search, ...(tier ? { tier } : {}) };
  const [members, total, tierRows, all] = await Promise.all([
    prisma.member.findMany({ where, orderBy: SORTS[sort].orderBy, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.member.count({ where }),
    prisma.member.groupBy({ by: ["tier"], where: search, _count: { _all: true } }),
    prisma.member.count({ where: search }),
  ]);
  const counts = Object.fromEntries(tierRows.map((t) => [t.tier, t._count._all]));
  return { q, tier, sort, page, total, pages: Math.max(1, Math.ceil(total / PAGE)), members, counts: { "": all, ...counts } };
};

export default function MembersList() {
  const { q, tier, sort, page, pages, total, members, counts } = useLoaderData();
  const [params] = useSearchParams();
  const href = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    const s = p.toString();
    return s ? `/app/members?${s}` : "/app/members";
  };
  return (
    <s-page heading="Members" inlineSize="large">
      <s-section>
        <s-stack gap="base">
          <FilterPills
            options={[{ value: "", label: "All tiers" }, ...TIERS.map((t) => ({ value: t.key, label: t.name }))].map((o) => ({ ...o, count: formatCoins(counts[o.value] || 0) }))}
            value={tier}
            hrefFor={(v) => href({ tier: v, page: "" })}
          />
          <Form method="get">
            {tier && <input type="hidden" name="tier" value={tier} />}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input name="q" defaultValue={q} placeholder="Search by email, name or customer ID" style={{ ...fieldStyle, flex: "1 1 260px" }} />
              <select name="sort" defaultValue={sort} style={fieldStyle}>
                {Object.entries(SORTS).map(([k, s]) => (
                  <option key={k} value={k}>{s.label}</option>
                ))}
              </select>
              <s-button type="submit">Apply</s-button>
              {q ? <Link to={href({ q: "", page: "" })}>Clear search</Link> : null}
            </div>
          </Form>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Member</s-table-header>
              <s-table-header>Tier</s-table-header>
              <s-table-header format="numeric">Balance</s-table-header>
              <s-table-header format="numeric">Lifetime</s-table-header>
              <s-table-header>Last active</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {members.map((m) => (
                <s-table-row key={m.id}>
                  <s-table-cell>
                    <Link to={`/app/members/${m.id}`}>{[m.firstName, m.lastName].filter(Boolean).join(" ") || "(no name)"}</Link>
                    <br />
                    <s-text color="subdued">{m.email || `Customer ${m.customerId}`}</s-text>
                  </s-table-cell>
                  <s-table-cell><TierBadge tier={m.tier} /></s-table-cell>
                  <s-table-cell>{formatCoins(m.balance)}</s-table-cell>
                  <s-table-cell>{formatCoins(m.lifetimeEarned)}</s-table-cell>
                  <s-table-cell>{new Date(m.lastActivityAt).toLocaleDateString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {!members.length && <s-paragraph>No members found.</s-paragraph>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <s-text color="subdued">
              {formatCoins(total)} members · page {page} of {formatCoins(pages)}
            </s-text>
            <s-stack direction="inline" gap="small-200">
              {page > 1 && <Link to={href({ page: String(page - 1) })}>← Previous</Link>}
              {page < pages && <Link to={href({ page: String(page + 1) })}>Next →</Link>}
            </s-stack>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}
