// Import Smile's member export (CSV). Upload, check the preview and column matches, then import.
import { Form, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { previewCsv, startImport, importStatus } from "../coins/import.server";
import { programMode } from "../coins/ledger.server";
import { detectColumns } from "../coins/csv";
import { formatCoins, tierByKey } from "../coins/rules";

const upload = (globalThis.__coinsUpload ||= { text: null, name: null });
const FIELDS = [
  ["email", "Email", true],
  ["balance", "Coin balance", true],
  ["lifetime", "Coins earned (for tier progress)", false],
  ["tier", "VIP tier", false],
  ["birthday", "Birthday", false],
];

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { status: importStatus(), fileName: upload.name, live: programMode() === "live" };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "upload") {
    const file = form.get("file");
    if (!file || typeof file === "string" || !file.size) return { error: "Choose the CSV file Smile exported." };
    upload.text = await file.text();
    upload.name = file.name;
    const p = previewCsv(upload.text, {});
    const mapping = detectColumns(p.headers);
    return { mapping, preview: previewCsv(upload.text, mapping) };
  }

  const mapping = Object.fromEntries(FIELDS.map(([k]) => [k, form.get(k) || undefined]));
  if (!upload.text) return { error: "Upload the file again." };
  if (!mapping.email || !mapping.balance) return { error: "Pick the Email and Coin balance columns.", mapping, preview: previewCsv(upload.text, mapping) };

  if (intent === "preview") return { mapping, preview: previewCsv(upload.text, mapping) };
  if (intent === "import") {
    try {
      startImport(upload.text, mapping, session.email || "staff");
      return { started: true };
    } catch (err) {
      return { error: err.message };
    }
  }
  return null;
};

const btn = { padding: "6px 14px", borderRadius: 8, border: "1px solid #c9c9c9", background: "#fff", fontWeight: 600, cursor: "pointer" };
const primary = { background: "#303030", color: "#fff", borderColor: "#303030" };

export default function ImportPage() {
  const { status, fileName, live } = useLoaderData();
  const result = useActionData();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const busy = nav.state !== "idle";

  useEffect(() => {
    if (!status.running && !result?.started) return;
    const t = setInterval(() => revalidator.revalidate(), 2000);
    return () => clearInterval(t);
  }, [status.running, result?.started]);

  const preview = result?.preview;
  const mapping = result?.mapping || {};

  return (
    <s-page heading="Import from Smile">
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
      {live && (
        <s-banner tone="warning">
          The program is live, so importing is switched off. An import sets balances to Smile's numbers, which would undo coins customers have
          earned and spent since launch.
        </s-banner>
      )}

      {(status.running || status.finishedAt) && (
        <s-section heading={status.running ? "Importing…" : "Last import"}>
          <s-paragraph>
            {formatCoins(status.done)} of {formatCoins(status.total)} rows · {formatCoins(status.imported)} imported ·{" "}
            {formatCoins(status.notFound)} with no matching Shopify customer · {formatCoins(status.failed)} failed
          </s-paragraph>
          {status.error && <s-banner tone="critical">{status.error}</s-banner>}
          {status.notFoundSample?.length > 0 && (
            <s-paragraph>
              <s-text color="subdued">No Shopify customer for: {status.notFoundSample.join(", ")}</s-text>
            </s-paragraph>
          )}
        </s-section>
      )}

      <s-section heading="1. Upload Smile's member export">
        <s-paragraph>
          In Smile, go to Customers and export the full member list as CSV. Running the import again later (at cutover) sets every balance to Smile's
          latest number. Tiers only ever go up. No welcome or tier rewards are sent during an import.
        </s-paragraph>
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="upload" />
          <s-stack direction="inline" gap="base">
            <input type="file" name="file" accept=".csv,text/csv" />
            <s-button type="submit" loading={busy || undefined}>Upload and preview</s-button>
          </s-stack>
        </Form>
        {fileName && <s-paragraph><s-text color="subdued">Loaded: {fileName}</s-text></s-paragraph>}
      </s-section>

      {preview && (
        <s-section heading="2. Check the columns and preview">
          <Form method="post">
            <s-stack gap="base">
              {FIELDS.map(([key, label, required]) => (
                <s-select key={key} name={key} label={label + (required ? "" : " (optional)")} value={mapping[key] || ""}>
                  <s-option value="">Not in file</s-option>
                  {preview.headers.map((h) => (
                    <s-option key={h} value={h}>{h}</s-option>
                  ))}
                </s-select>
              ))}
              <s-paragraph>
                {formatCoins(preview.withEmail)} members with an email (of {formatCoins(preview.total)} rows) · {formatCoins(preview.coins)} coins in total ·{" "}
                {Object.entries(preview.tiers).map(([k, v]) => `${tierByKey(k).name}: ${formatCoins(v)}`).join(", ")}
              </s-paragraph>
              <s-table>
                <s-table-header-row>
                  <s-table-header>Email</s-table-header>
                  <s-table-header format="numeric">Balance</s-table-header>
                  <s-table-header format="numeric">Earned</s-table-header>
                  <s-table-header>Tier</s-table-header>
                  <s-table-header>Birthday</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {preview.sample.map((r) => (
                    <s-table-row key={r.email}>
                      <s-table-cell>{r.email}</s-table-cell>
                      <s-table-cell>{formatCoins(r.balance)}</s-table-cell>
                      <s-table-cell>{r.lifetime === null ? "–" : formatCoins(r.lifetime)}</s-table-cell>
                      <s-table-cell>{tierByKey(r.tier).name}</s-table-cell>
                      <s-table-cell>{r.birthday ? `${r.birthday.month}/${r.birthday.day}` : ""}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              <s-stack direction="inline" gap="base">
                {/* Native buttons so the clicked button's intent is submitted with the form */}
                <button type="submit" name="intent" value="preview" style={btn}>Update preview</button>
                <button type="submit" name="intent" value="import" disabled={status.running || live} style={{ ...btn, ...primary }}>
                  Import {formatCoins(preview.withEmail)} members
                </button>
              </s-stack>
            </s-stack>
          </Form>
        </s-section>
      )}
    </s-page>
  );
}
