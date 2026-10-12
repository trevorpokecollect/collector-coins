// Panel design: colors, wording, buttons and which sections the storefront coin panel shows, with a live preview.
// Saved to the database and copied to an app-data metafield that the theme embed reads.
import { useEffect, useMemo, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getPanelSettings, savePanelSettings, panelSettingsMeta } from "../coins/settings.server";
import { PANEL_DEFAULTS, TEXT_LABELS, EARN_LABELS, EARN_KEYS, normalizePanelSettings, fillText } from "../coins/panelSettings";
import { TIERS, REVIEW_COINS, GOOGLE_REVIEW_COINS, ALERTS_SIGNUP_COINS, formatCoins } from "../coins/rules";
import { fieldStyle } from "../components/ui";
import panelCss from "../../extensions/coin-panel/assets/coins.css?raw";

const COIN = "https://poke-collect.com/cdn/shop/files/PokeCollect_Coins_b45f5078-ccb8-4277-87b5-7c38a10f9e0e.png?v=1723056762&width=120";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {
    settings: await getPanelSettings(),
    meta: await panelSettingsMeta(),
    badges: { alerts: `+${ALERTS_SIGNUP_COINS}`, purchase: "2-10 / $1", review: `+${REVIEW_COINS}`, google: `+${GOOGLE_REVIEW_COINS}`, birthday: "+200-500" },
    tiers: TIERS.map((t) => ({ key: t.key, name: t.name, threshold: t.threshold, earnRate: t.earnRate, reward: t.entry.title })),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const staff = session.email || session.userId?.toString() || "staff";
  const form = await request.formData();
  try {
    if (form.get("intent") === "reset") {
      await savePanelSettings(PANEL_DEFAULTS, { staff, admin });
      return { ok: "Panel design reset to the original look. Live on the store within a minute." };
    }
    const input = JSON.parse(String(form.get("settings") || "{}"));
    await savePanelSettings(input, { staff, admin });
    return { ok: "Saved. The new design is live on the store (refresh the storefront to see it)." };
  } catch (err) {
    console.error("Saving panel design failed", err);
    return { error: err.message || "Couldn't save." };
  }
};

const COLOR_LABELS = {
  primary: "Main color (header, main buttons)",
  primaryDark: "Main color, hover",
  accent: "Accent (balance bar, active tab, badges)",
  dark: "Dark (tabs bar, dark buttons, tier cards)",
  background: "Panel background",
};

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
      {children}
      {hint ? <span style={{ fontSize: 12, color: "#616161" }}>{hint}</span> : null}
    </label>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const ICONS = {
  purchase: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  review: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
  google: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M12 8l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 10.3l2-.3 1-2z"/>',
  alerts: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  birthday: '<rect x="4" y="10" width="16" height="10" rx="1"/><path d="M4 14h16M12 10v10M12 10c-2-3-5-3-5-1s3 1 5 1zm0 0c2-3 5-3 5-1s-3 1-5 1z"/>',
};
const Icon = ({ k }) => (
  <span className="ccp-ico">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" dangerouslySetInnerHTML={{ __html: ICONS[k] || ICONS.purchase }} />
  </span>
);
const H = ({ children }) => (
  <h3 className="ccp-h">
    <span>{children}</span>
  </h3>
);

function Preview({ s, signedIn, badges, tiers }) {
  const vars = {
    "--ccp-red": s.colors.primary,
    "--ccp-red-dark": s.colors.primaryDark,
    "--ccp-yellow": s.colors.accent,
    "--ccp-dark": s.colors.dark,
    "--ccp-bg": s.colors.background,
  };
  const coins = formatCoins(ALERTS_SIGNUP_COINS);
  const earn = EARN_KEYS.filter((k) => s.earn[k].show).map((k) => ({ key: k, ...s.earn[k], badge: badges[k] }));
  const tierGrid = (current) =>
    s.sections.tiers ? (
      <>
        <H>Tiers</H>
        <div className="ccp-tiers">
          {tiers.map((t) => (
            <div key={t.key} className={`ccp-tier${t.key === current ? " ccp-here" : ""}`}>
              {t.key === current ? <span className="ccp-you">Your tier</span> : null}
              <span className={`ccp-ticon ccp-ticon-lg ccp-tb-${t.key}`}>{t.key[0].toUpperCase()}</span>
              <b>{t.name}</b>
              <span className="ccp-tier-need">{t.threshold ? `${formatCoins(t.threshold)} coins earned` : "Join free"}</span>
              <span className="ccp-tier-rate">
                {t.earnRate}
                <small> coins / $1</small>
              </span>
              <span className="ccp-tier-reward">{t.reward}</span>
            </div>
          ))}
        </div>
        <p className="ccp-note">{s.text.tierNote}</p>
      </>
    ) : null;
  const earnList = earn.map((w) => (
    <div key={w.key} className="ccp-card ccp-earn">
      <Icon k={w.key} />
      <div className="ccp-grow">
        <div className="ccp-t">{w.title}</div>
        <div className="ccp-d">
          {w.detail}
          {w.key === "google" ? (
            <>
              {" "}
              <a href="#preview" onClick={(e) => e.preventDefault()}>Write a review</a>
            </>
          ) : null}
        </div>
      </div>
      <span className="ccp-pill">{w.badge}</span>
    </div>
  ));
  return (
    <div className="ccp-preview" style={vars}>
      <div className="ccp-root ccp-open" style={vars}>
        <div className="ccp-panel">
          {signedIn ? (
            <>
              <div className="ccp-head">
                <button className="ccp-close" type="button" aria-label="Close">×</button>
                <h2>{fillText(s.text.greeting, { name: "Ash" })}</h2>
                <div className="ccp-bal">
                  <img src={COIN} alt="" />
                  <div>
                    <strong>4,250</strong>
                    <br />
                    <span>Collector Coins</span>
                  </div>
                </div>
                <div className="ccp-tierline">
                  <span className="ccp-ticon ccp-tb-great">G</span>
                  <div>
                    <b>Great Tier</b> · 3 coins per $1
                    <br />
                    <span>2,750 coins to Ultra Tier</span>
                  </div>
                </div>
                <div className="ccp-bar">
                  <i style={{ width: "45%" }} />
                </div>
              </div>
              <div className="ccp-tabs">
                <button type="button" className="ccp-on">Earn</button>
                <button type="button">Redeem</button>
                <button type="button">My codes</button>
                <button type="button">History</button>
              </div>
              <div className="ccp-body">
                {s.sections.promo ? <PromoSample /> : null}
                {s.earn.alerts.show ? (
                  <div className="ccp-card ccp-alerts">
                    <div className="ccp-earn-top">
                      <Icon k="alerts" />
                      <div className="ccp-grow">
                        <div className="ccp-t">{s.text.alertsTitle}</div>
                        <div className="ccp-d">{fillText(s.text.alertsBody, { coins })}</div>
                      </div>
                      <span className="ccp-pill">+{coins}</span>
                    </div>
                    <input className="ccp-input" placeholder="Mobile number" readOnly />
                    <button type="button" className="ccp-btn ccp-btn-red ccp-btn-block">{fillText(s.text.alertsButton, { coins })}</button>
                  </div>
                ) : null}
                <H>Ways to earn</H>
                {earnList}
                {tierGrid("great")}
              </div>
            </>
          ) : (
            <>
              <div className="ccp-head">
                <button className="ccp-close" type="button" aria-label="Close">×</button>
                <h2>{s.text.signedOutTitle}</h2>
                <p>{s.text.signedOutIntro}</p>
              </div>
              <div className="ccp-body">
                {s.sections.promo ? <PromoSample /> : null}
                <div className="ccp-join">
                  <div className="ccp-join-t">{s.text.joinTitle}</div>
                  <div className="ccp-d">{s.text.joinBody}</div>
                  <div className="ccp-row" style={{ marginTop: 12 }}>
                    <span className="ccp-btn ccp-btn-red ccp-btn-block">{s.text.joinButton}</span>
                    <span className="ccp-btn ccp-btn-dark ccp-btn-block">{s.text.signInButton}</span>
                  </div>
                </div>
                <H>Ways to earn</H>
                {earnList}
                {tierGrid(null)}
                {s.sections.prizesSignedOut ? (
                  <>
                    <H>Prizes right now</H>
                    <div className="ccp-card ccp-prize">
                      <span className="ccp-noimg" />
                      <div className="ccp-grow">
                        <span className="ccp-t">Free Booster Pack</span>
                        <span className="ccp-cost">
                          <img src={COIN} alt="" />
                          1,000
                        </span>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PromoSample() {
  return (
    <span className="ccp-promo">
      <span className="ccp-promo-x">3x</span>
      <span className="ccp-grow">
        <span className="ccp-promo-t">Sample Promotion</span>
        <span className="ccp-d">Shows only while a coin promotion is running.</span>
      </span>
    </span>
  );
}

// Make the real panel stylesheet render in place inside the admin page.
const PREVIEW_CSS = `
.ccd-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 420px); gap: 20px; align-items: start; }
.ccd-editor { display: grid; gap: 16px; min-width: 0; }
.ccd-side { position: sticky; top: 12px; display: grid; gap: 12px; }
@media (max-width: 980px) {
  .ccd-layout { grid-template-columns: minmax(0, 1fr); }
  .ccd-side { position: static; order: -1; }
}
.ccp-preview .ccp-root { position: relative !important; inset: auto !important; bottom: auto !important; right: auto !important; left: auto !important; z-index: auto !important; }
.ccp-preview .ccp-panel { position: relative !important; display: flex !important; bottom: auto !important; width: 100% !important; max-width: 400px !important; height: 660px !important; margin: 0 auto; }
.ccp-preview .ccp-launcher { display: none !important; }
`;

export default function Design() {
  const { settings: saved, meta, badges, tiers } = useLoaderData();
  const result = useActionData();
  const busy = useNavigation().state !== "idle";
  const [s, setS] = useState(saved);
  const [signedIn, setSignedIn] = useState(true);
  useEffect(() => setS(saved), [saved]);
  const clean = useMemo(() => normalizePanelSettings(s), [s]);
  const dirty = JSON.stringify(clean) !== JSON.stringify(saved);
  const set = (group, key, value) => setS((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }));
  const setEarn = (key, field, value) => setS((prev) => ({ ...prev, earn: { ...prev.earn, [key]: { ...prev.earn[key], [field]: value } } }));

  return (
    <s-page heading="Panel Design" inlineSize="large">
      <style dangerouslySetInnerHTML={{ __html: panelCss + PREVIEW_CSS }} />
      {result?.ok && <s-banner tone="success">{result.ok}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

      <div className="ccd-layout">
        <div className="ccd-editor">
          <s-section heading="Colors">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {Object.keys(PANEL_DEFAULTS.colors).map((k) => (
                <Field key={k} label={COLOR_LABELS[k]}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="color" value={clean.colors[k]} onChange={(e) => set("colors", k, e.target.value)} style={{ width: 44, height: 34, padding: 0, border: "1px solid #8a8a8a", borderRadius: 8, background: "#fff" }} />
                    <input value={s.colors[k]} onChange={(e) => set("colors", k, e.target.value)} style={{ ...fieldStyle, width: 110, fontFamily: "ui-monospace, Menlo, monospace" }} />
                  </div>
                </Field>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <s-button onClick={() => setS((prev) => ({ ...prev, colors: { ...PANEL_DEFAULTS.colors } }))}>Use original colors</s-button>
            </div>
          </s-section>

          <s-section heading="Buttons">
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Desktop button label">
                <input value={s.launcher.label} onChange={(e) => set("launcher", "label", e.target.value)} style={fieldStyle} />
              </Field>
              <Toggle checked={clean.launcher.mobileButton} onChange={(v) => set("launcher", "mobileButton", v)} label="Show the round coin button on phones" />
              <Field label="Phone button position" hint="Above the chat bubble keeps it stacked on the chat button and matches its size.">
                <select value={clean.launcher.mobileSide} onChange={(e) => set("launcher", "mobileSide", e.target.value)} style={fieldStyle} disabled={!clean.launcher.mobileButton}>
                  <option value="chat">Above the chat bubble</option>
                  <option value="left">Bottom left corner</option>
                  <option value="right">Bottom right corner</option>
                </select>
              </Field>
            </div>
          </s-section>

          <s-section heading="Wording">
            <div style={{ display: "grid", gap: 14 }}>
              {Object.keys(PANEL_DEFAULTS.text).map((k) => (
                <Field key={k} label={TEXT_LABELS[k] || k}>
                  {PANEL_DEFAULTS.text[k].length > 60 ? (
                    <textarea rows={3} value={s.text[k]} onChange={(e) => set("text", k, e.target.value)} style={{ ...fieldStyle, resize: "vertical" }} />
                  ) : (
                    <input value={s.text[k]} onChange={(e) => set("text", k, e.target.value)} style={fieldStyle} />
                  )}
                </Field>
              ))}
            </div>
          </s-section>

          <s-section heading="Ways to earn">
            <div style={{ display: "grid", gap: 18 }}>
              {EARN_KEYS.map((k) => (
                <div key={k} style={{ display: "grid", gap: 8, paddingBottom: 14, borderBottom: "1px solid #ebebeb" }}>
                  <Toggle checked={clean.earn[k].show} onChange={(v) => setEarn(k, "show", v)} label={<b>{EARN_LABELS[k]}</b>} />
                  {clean.earn[k].show && (
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 10 }}>
                      <input value={s.earn[k].title} onChange={(e) => setEarn(k, "title", e.target.value)} style={fieldStyle} aria-label={`${EARN_LABELS[k]} title`} />
                      <input value={s.earn[k].detail} onChange={(e) => setEarn(k, "detail", e.target.value)} style={fieldStyle} aria-label={`${EARN_LABELS[k]} detail`} />
                    </div>
                  )}
                  {k === "alerts" && <span style={{ fontSize: 12, color: "#616161" }}>Turning this off also hides the alerts sign-up card.</span>}
                </div>
              ))}
            </div>
          </s-section>

          <s-section heading="Sections">
            <div style={{ display: "grid", gap: 10 }}>
              <Toggle checked={clean.sections.promo} onChange={(v) => set("sections", "promo", v)} label="Coin promotion banner (while a promotion runs)" />
              <Toggle checked={clean.sections.tiers} onChange={(v) => set("sections", "tiers", v)} label="Tier cards" />
              <Toggle checked={clean.sections.prizesSignedOut} onChange={(v) => set("sections", "prizesSignedOut", v)} label="Prize preview for visitors who aren't signed in" />
            </div>
          </s-section>
        </div>

        <div className="ccd-side">
          <s-section>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  {[["Signed in", true], ["Signed out", false]].map(([label, v]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setSignedIn(v)}
                      style={{
                        padding: "6px 12px", borderRadius: 999, fontWeight: 600, fontSize: 13, cursor: "pointer",
                        border: `1px solid ${signedIn === v ? "#303030" : "#d4d4d4"}`, background: signedIn === v ? "#303030" : "#fff", color: signedIn === v ? "#fff" : "#303030",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {dirty ? <s-badge tone="warning">Unsaved changes</s-badge> : <s-badge tone="success">Saved</s-badge>}
              </div>
              <div style={{ background: "#e9e9e9", borderRadius: 16, padding: 14 }}>
                <Preview s={clean} signedIn={signedIn} badges={badges} tiers={tiers} />
              </div>
              <Form method="post">
                <input type="hidden" name="settings" value={JSON.stringify(clean)} />
                <s-button type="submit" variant="primary" disabled={!dirty || undefined} loading={busy || undefined}>
                  Save and publish
                </s-button>
              </Form>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <s-text color="subdued">
                  {meta ? `Last saved by ${meta.updatedBy || "staff"} on ${new Date(meta.updatedAt).toLocaleString()}` : "Using the original design"}
                </s-text>
                {dirty ? <s-button variant="tertiary" onClick={() => setS(saved)}>Discard changes</s-button> : null}
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="reset" />
                <s-button type="submit" variant="tertiary" tone="critical">Reset everything to the original design</s-button>
              </Form>
            </div>
          </s-section>
        </div>
      </div>
    </s-page>
  );
}
