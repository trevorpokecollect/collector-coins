// One member: balance, tier, codes, history, and the staff Adjust coins form (Google reviews, fixes, goodwill).
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { credit, takeBack } from "../coins/ledger.server";
import { tierByKey, nextTier, formatCoins, formatMoney, isValidBirthday, GOOGLE_REVIEW_COINS } from "../coins/rules";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  const member = await prisma.member.findUnique({
    where: { id: params.id },
    include: {
      transactions: { orderBy: { createdAt: "desc" }, take: 100 },
      rewards: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!member) throw new Response("Not found", { status: 404 });
  return { member, next: nextTier(member.tier, member.lifetimeEarned) };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const staff = session.email || session.userId?.toString() || "staff";
  const form = await request.formData();
  const member = await prisma.member.findUnique({ where: { id: params.id } });
  if (!member) return { error: "Member not found." };
  const intent = form.get("intent");

  if (intent === "birthday") {
    const month = Number(form.get("month")), day = Number(form.get("day"));
    if (!form.get("month")) {
      await prisma.member.update({ where: { id: member.id }, data: { birthdayMonth: null, birthdayDay: null } });
      return { ok: "Birthday cleared." };
    }
    if (!isValidBirthday(month, day)) return { error: "That date isn't valid." };
    await prisma.member.update({ where: { id: member.id }, data: { birthdayMonth: month, birthdayDay: day } });
    return { ok: "Birthday saved." };
  }

  const amount = Math.trunc(Number(form.get("amount")));
  const reason = String(form.get("reason") || "").trim();
  if (!amount) return { error: "Enter a number of coins, like 500 or -200." };
  if (!reason) return { error: "Add a reason. The customer sees it in their history." };
  if (amount > 0) {
    await credit(member, {
      amount,
      kind: "adjust",
      description: reason,
      staff,
      countsToTier: form.get("countsToTier") === "on",
    });
    return { ok: `Added ${formatCoins(amount)} coins.` };
  }
  const taken = await takeBack(member, { amount: -amount, kind: "adjust", description: reason, staff, reduceLifetime: false });
  return { ok: `Removed ${formatCoins(taken)} coins${taken < -amount ? " (balance can't go below zero)" : ""}.` };
};

// Common reasons for the Adjust coins form. Picking one fills the amount and reason; both can still be edited.
// The reason is shown to the customer in their coin history.
const PRESETS = [
  { id: "", label: "Choose a common reason…", coins: "", reason: "", tier: true },
  { id: "google", label: "Google review (500)", coins: String(GOOGLE_REVIEW_COINS), reason: "Google Review", tier: true },
  { id: "missed", label: "Coins missing from an order", coins: "", reason: "Coins For Order #", tier: true },
  { id: "sorry", label: "Sorry for the trouble (goodwill)", coins: "", reason: "Sorry For The Trouble", tier: false },
  { id: "giveaway", label: "Giveaway prize", coins: "", reason: "Giveaway Prize", tier: false },
  { id: "live", label: "Live show bonus", coins: "", reason: "Live Show Bonus", tier: false },
  { id: "bonus", label: "Thank-you bonus", coins: "", reason: "Thank You Bonus", tier: false },
  { id: "fix", label: "Correction (remove coins)", coins: "-", reason: "Balance Correction", tier: false },
  { id: "other", label: "Other (type your own)", coins: "", reason: "", tier: true },
];

const selectStyle = { padding: "6px 8px", borderRadius: 8, border: "1px solid #8a8a8a", font: "inherit", background: "#fff", maxWidth: 360 };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function MemberPage() {
  const { member: m, next } = useLoaderData();
  const result = useActionData();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || `Customer ${m.customerId}`;
  const [presetId, setPresetId] = useState("");
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  const googleBefore = m.transactions.find((t) => t.amount > 0 && /google review/i.test(t.description));

  return (
    <s-page heading={name}>
      <s-link slot="breadcrumb-actions" href="/app">Members</s-link>
      {result?.ok && <s-banner tone="success">{result.ok}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

      <s-section heading="Coins">
        <s-paragraph>
          <s-text type="strong">{formatCoins(m.balance)} coins</s-text> · {tierByKey(m.tier).name} ·{" "}
          {formatCoins(m.lifetimeEarned)} lifetime{next ? ` · ${formatCoins(next.coinsToGo)} to ${next.name}` : ""}
        </s-paragraph>
        <s-paragraph>
          {m.email || "No email"} ·{" "}
          <s-link href={`shopify://admin/customers/${m.customerId}`} target="_top">Open customer</s-link>
          {m.importedFromSmile ? " · Imported from Smile" : ""}
        </s-paragraph>
      </s-section>

      <s-section heading="Adjust coins">
        <Form method="post" key={`adjust-${m.transactions.length}`}>
          <input type="hidden" name="intent" value="adjust" />
          <s-stack gap="base">
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontWeight: 500 }}>Common reasons</span>
              <select value={preset.id} onChange={(e) => setPresetId(e.target.value)} style={selectStyle}>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            {preset.id === "google" && googleBefore && (
              <s-banner tone="warning">This customer already got Google review coins on {new Date(googleBefore.createdAt).toLocaleDateString()}.</s-banner>
            )}
            {/* Keyed on the preset so picking one resets the fields to its values */}
            <s-number-field key={`amount-${preset.id}`} name="amount" label="Coins (negative to remove)" value={preset.coins === "-" ? "" : preset.coins} placeholder={preset.coins === "-" ? "-200" : "500"}></s-number-field>
            <s-text-field key={`reason-${preset.id}`} name="reason" label="Reason (the customer sees this)" value={preset.reason} placeholder="Google Review"></s-text-field>
            <s-checkbox key={`tier-${preset.id}`} name="countsToTier" label="Counts toward their tier" checked={preset.tier || undefined}></s-checkbox>
            <s-button type="submit" variant="primary" loading={busy || undefined}>Save</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Birthday">
        <Form method="post">
          <input type="hidden" name="intent" value="birthday" />
          <s-stack direction="inline" gap="base">
            <s-select name="month" label="Month" value={m.birthdayMonth ? String(m.birthdayMonth) : ""}>
              <s-option value="">Not set</s-option>
              {MONTHS.map((mo, i) => (
                <s-option key={mo} value={String(i + 1)}>{mo}</s-option>
              ))}
            </s-select>
            <s-number-field name="day" label="Day" min={1} max={31} value={m.birthdayDay ? String(m.birthdayDay) : ""}></s-number-field>
            <s-button type="submit">Save birthday</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Codes and gift cards">
        {m.rewards.length ? (
          <s-table>
            <s-table-header-row>
              <s-table-header>Reward</s-table-header>
              <s-table-header>Code</s-table-header>
              <s-table-header format="numeric">Coins</s-table-header>
              <s-table-header>Date</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {m.rewards.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{r.title}{r.valueCents ? ` (${formatMoney(r.valueCents)})` : ""}</s-table-cell>
                  <s-table-cell>{r.code || "pending"}</s-table-cell>
                  <s-table-cell>{r.coins ? formatCoins(r.coins) : "–"}</s-table-cell>
                  <s-table-cell>{new Date(r.createdAt).toLocaleDateString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-paragraph>None yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading="History">
        <s-table>
          <s-table-header-row>
            <s-table-header>What</s-table-header>
            <s-table-header format="numeric">Coins</s-table-header>
            <s-table-header>Date</s-table-header>
            <s-table-header>By</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {m.transactions.map((t) => (
              <s-table-row key={t.id}>
                <s-table-cell>{t.description}</s-table-cell>
                <s-table-cell>{(t.amount > 0 ? "+" : "") + formatCoins(t.amount)}</s-table-cell>
                <s-table-cell>{new Date(t.createdAt).toLocaleString()}</s-table-cell>
                <s-table-cell>{t.staff || ""}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <s-paragraph><Link to="/app">Back to members</Link></s-paragraph>
      </s-section>
    </s-page>
  );
}
