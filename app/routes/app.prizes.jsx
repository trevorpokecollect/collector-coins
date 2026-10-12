// Prizes: everything in the Collector Coins Prizes collection, with stock, coin cost and why an item isn't showing.
// Staff can set a fixed coin cost or hide a prize; blank goes back to the automatic price x 200.
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { prizeCatalog, clearPrizeCache } from "../coins/shopify.server";

const numericId = (gid) => String(gid).split("/").pop();
import { formatCoins, formatMoney, PRIZE_COINS_PER_DOLLAR, PRIZE_MIN_STOCK, PRIZE_TAG, COINS_PER_DOLLAR_OFF } from "../coins/rules";
import { StatGrid, FilterPills, fieldStyle } from "../components/ui";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let catalog = [];
  let error = null;
  try {
    catalog = await prizeCatalog(admin);
  } catch (err) {
    error = err.message;
  }
  const [all, recent] = await Promise.all([
    prisma.reward.groupBy({ by: ["productId"], where: { kind: "free_product", productId: { not: null } }, _count: { _all: true }, _sum: { coins: true } }),
    prisma.reward.groupBy({ by: ["productId"], where: { kind: "free_product", productId: { not: null }, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const allBy = new Map(all.map((r) => [r.productId, r]));
  const recentBy = new Map(recent.map((r) => [r.productId, r._count._all]));
  const prizes = catalog.map((p) => ({
    ...p,
    redeemedAll: allBy.get(p.productId)?._count._all || 0,
    redeemed30: recentBy.get(p.productId) || 0,
  }));
  return { prizes, error };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const staff = session.email || session.userId?.toString() || "staff";
  const form = await request.formData();
  const productId = String(form.get("productId") || "");
  if (!productId.startsWith("gid://shopify/Product/")) return { error: "Pick a prize first." };
  const rawCoins = String(form.get("coins") || "").replace(/[, ]/g, "");
  const coins = rawCoins ? Math.trunc(Number(rawCoins)) : null;
  if (rawCoins && (!Number.isFinite(coins) || coins < 100 || coins > 10000000)) return { error: "Coin cost must be a whole number of at least 100." };
  const hidden = form.get("hidden") === "on";
  const note = String(form.get("note") || "").trim().slice(0, 200) || null;
  if (!coins && !hidden && !note) {
    await prisma.prizeOverride.deleteMany({ where: { productId } });
  } else {
    await prisma.prizeOverride.upsert({
      where: { productId },
      create: { productId, coins, hidden, note, updatedBy: staff },
      update: { coins, hidden, note, updatedBy: staff },
    });
  }
  clearPrizeCache();
  return { ok: hidden ? "Saved. This prize is hidden from the panel." : coins ? `Saved. This prize now costs ${formatCoins(coins)} coins.` : "Saved. This prize uses the automatic coin cost." };
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "live", label: "Showing in panel" },
  { value: "off", label: "Not showing" },
  { value: "custom", label: "Custom cost" },
];

export default function Prizes() {
  const { prizes, error } = useLoaderData();
  const result = useActionData();
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const filter = params.get("show") || "";
  const editId = params.get("edit");
  const editing = prizes.find((p) => p.productId === editId);

  const live = prizes.filter((p) => p.live);
  const custom = prizes.filter((p) => p.override?.coins || p.override?.hidden);
  const lowStock = live.filter((p) => p.stock < PRIZE_MIN_STOCK + 10);
  const shown = prizes.filter((p) => (filter === "live" ? p.live : filter === "off" ? !p.live : filter === "custom" ? p.override : true));
  const counts = { "": prizes.length, live: live.length, off: prizes.length - live.length, custom: custom.length };
  const href = (show, edit) => {
    const q = new URLSearchParams();
    if (show) q.set("show", show);
    if (edit) q.set("edit", edit);
    const s = q.toString();
    return s ? `/app/prizes?${s}` : "/app/prizes";
  };

  return (
    <s-page heading="Prizes" inlineSize="large">
      {error && <s-banner tone="critical">Couldn't load prizes from Shopify: {error}</s-banner>}
      {result?.ok && <s-banner tone="success">{result.ok}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

      <s-section>
        <StatGrid
          items={[
            { label: "Showing in the panel", value: live.length, note: `of ${prizes.length} in the collection` },
            { label: "Close to the stock cut-off", value: lowStock.length, note: `under ${PRIZE_MIN_STOCK + 10} left (hides at ${PRIZE_MIN_STOCK})` },
            { label: "Custom coin costs", value: custom.length, note: "set by staff" },
            { label: "Redeemed, last 30 days", value: prizes.reduce((s, p) => s + p.redeemed30, 0), note: `${prizes.reduce((s, p) => s + p.redeemedAll, 0)} all time` },
          ]}
        />
      </s-section>

      {editing && (
        <s-section heading={`Edit: ${editing.title}`}>
          <Form method="post" key={editing.productId + (editing.override?.updatedAt || "")}>
            <input type="hidden" name="productId" value={editing.productId} />
            <s-stack gap="base">
              <s-paragraph>
                Automatic cost: <s-text type="strong">{formatCoins(editing.defaultCoins)} coins</s-text> (retail {formatMoney(editing.priceCents)} ×{" "}
                {PRIZE_COINS_PER_DOLLAR}, rounded to the nearest 100). Leave the cost blank to use it.
              </s-paragraph>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 600 }}>Coin cost</span>
                  <input name="coins" inputMode="numeric" style={fieldStyle} defaultValue={editing.override?.coins || ""} placeholder={String(editing.defaultCoins)} />
                  <span style={{ fontSize: 12, color: "#616161" }}>For reference, {formatCoins(COINS_PER_DOLLAR_OFF)} coins = $1 off an order.</span>
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 600 }}>Staff note (only staff see this)</span>
                  <input name="note" style={fieldStyle} defaultValue={editing.override?.note || ""} placeholder="e.g. Priced up while stock is low" />
                </label>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" name="hidden" defaultChecked={Boolean(editing.override?.hidden)} />
                <span>Hide this prize from the panel and landing page</span>
              </label>
              <s-stack direction="inline" gap="base">
                <s-button type="submit" variant="primary" loading={busy || undefined}>Save</s-button>
                <Link to={href(filter)}>Cancel</Link>
              </s-stack>
              {editing.override?.updatedBy && (
                <s-text color="subdued">
                  Last changed by {editing.override.updatedBy} on {new Date(editing.override.updatedAt).toLocaleString()}
                </s-text>
              )}
            </s-stack>
          </Form>
        </s-section>
      )}

      <s-section heading="Prize list">
        <s-stack gap="base">
          <FilterPills options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} value={filter} hrefFor={(v) => href(v)} />
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Prize</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">In stock</s-table-header>
              <s-table-header format="numeric">Retail</s-table-header>
              <s-table-header format="numeric">Coins</s-table-header>
              <s-table-header format="numeric">Redeemed (30 days / all)</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {shown.map((p) => (
                <s-table-row key={p.productId}>
                  <s-table-cell>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {p.image ? (
                        <img src={`${p.image}${p.image.includes("?") ? "&" : "?"}width=80`} alt="" width={40} height={40} style={{ borderRadius: 8, objectFit: "cover", background: "#f1f1f1" }} />
                      ) : (
                        <span style={{ width: 40, height: 40, borderRadius: 8, background: "#f1f1f1", display: "inline-block" }} />
                      )}
                      <span>
                        <s-link href={`shopify://admin/products/${numericId(p.productId)}`} target="_top">{p.title}</s-link>
                        {p.override?.note ? (
                          <>
                            <br />
                            <s-text color="subdued">{p.override.note}</s-text>
                          </>
                        ) : null}
                      </span>
                    </div>
                  </s-table-cell>
                  <s-table-cell>
                    {p.live ? <s-badge tone="success">Live</s-badge> : <s-badge tone={p.override?.hidden ? "warning" : "neutral"}>{p.reason}</s-badge>}
                  </s-table-cell>
                  <s-table-cell>
                    <span style={{ color: p.tracked && p.stock < PRIZE_MIN_STOCK + 10 ? "#8e1f0b" : undefined, fontWeight: p.stock < PRIZE_MIN_STOCK + 10 ? 600 : 400 }}>
                      {p.tracked ? formatCoins(p.stock) : "Not tracked"}
                    </span>
                  </s-table-cell>
                  <s-table-cell>{formatMoney(p.priceCents)}</s-table-cell>
                  <s-table-cell>
                    {formatCoins(p.coins)}
                    {p.override?.coins ? (
                      <>
                        <br />
                        <s-text color="subdued">custom (auto {formatCoins(p.defaultCoins)})</s-text>
                      </>
                    ) : null}
                  </s-table-cell>
                  <s-table-cell>
                    {p.redeemed30} / {p.redeemedAll}
                  </s-table-cell>
                  <s-table-cell>
                    <Link to={href(filter, p.productId)}>Edit</Link>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {!shown.length && <s-paragraph>No prizes match.</s-paragraph>}
          <s-text color="subdued">
            A product shows as a prize when it's in the Collector Coins Prizes collection, active, tagged "{PRIZE_TAG}", not a pre-order and has at least{" "}
            {PRIZE_MIN_STOCK} tracked units in stock. Changes reach the panel within 5 minutes.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
