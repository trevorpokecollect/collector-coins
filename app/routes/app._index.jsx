// Staff home: program status, member search and the newest members.
import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { programMode, testerTag, earnSources } from "../coins/ledger.server";
import { tierByKey, formatCoins } from "../coins/rules";
import { judgemeWebhookUrl } from "../coins/events.server";

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
  const [members, count, sums] = await Promise.all([
    prisma.member.findMany({ where, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.member.count(),
    prisma.member.aggregate({ _sum: { balance: true } }),
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
  };
};

export default function Members() {
  const { q, members, count, outstanding, mode, testerTag, sources, judgeme, klaviyo } = useLoaderData();
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
          {judgeme && (
            <s-paragraph>
              Judge.me webhook URL (event: review created): <s-text type="strong">{judgeme}</s-text>
            </s-paragraph>
          )}
        </s-stack>
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
