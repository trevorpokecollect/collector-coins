// Small shared pieces for the admin pages, built on Polaris web components.
import { Link } from "react-router";
import { TIERS } from "../coins/rules";

const TIER_STYLE = {
  poke: { background: "#fde8e9", color: "#a3121b", border: "#f3b3b7" },
  great: { background: "#e5effd", color: "#1748a6", border: "#b3cbf2" },
  ultra: { background: "#fff6cc", color: "#5c4a00", border: "#ecd77a" },
  master: { background: "#f0e8fb", color: "#5b2a99", border: "#cdb4ee" },
};

export function TierBadge({ tier }) {
  const t = TIERS.find((x) => x.key === tier) || TIERS[0];
  const s = TIER_STYLE[t.key] || TIER_STYLE.poke;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
        background: s.background, color: s.color, border: `1px solid ${s.border}`, whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
      {t.name}
    </span>
  );
}

export function tierColor(key) {
  return (TIER_STYLE[key] || TIER_STYLE.poke).color;
}

/** A row of headline numbers. items: [{ label, value, note }] */
export function StatGrid({ items }) {
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
      {items.map((it) => (
        <s-box key={it.label} padding="base" background="base" border="base" borderRadius="large">
          <s-stack gap="small-300">
            <s-text color="subdued">{it.label}</s-text>
            <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.01em" }}>{it.value}</span>
            {it.note ? <s-text color="subdued">{it.note}</s-text> : null}
          </s-stack>
        </s-box>
      ))}
    </s-grid>
  );
}

/** Horizontal bars: rows [{ label, value, display?, color? }] */
export function Bars({ rows, max }) {
  const top = max || Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 34%) 1fr auto", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13 }}>{r.label}</span>
          <span style={{ height: 10, borderRadius: 999, background: "#eef0f2", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.max(r.value ? 2 : 0, (100 * r.value) / top)}%`, borderRadius: 999, background: r.color || "#303030" }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", minWidth: 48, textAlign: "right" }}>{r.display ?? r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Simple vertical bar chart for a daily series: points [{ label, value }] */
export function DailyBars({ points, color = "#303030", format = (v) => v }) {
  const top = Math.max(1, ...points.map((p) => p.value));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
        {points.map((p) => (
          <div key={p.label} title={`${p.label}: ${format(p.value)}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
            <div style={{ height: `${(100 * p.value) / top}%`, minHeight: p.value ? 3 : 0, background: color, borderRadius: "4px 4px 0 0" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "#616161" }}>
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

/** Pill-style filter links. options: [{ value, label, count? }] */
export function FilterPills({ options, value, hrefFor }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Link
            key={o.value || "all"}
            to={hrefFor(o.value)}
            style={{
              textDecoration: "none", padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600,
              border: `1px solid ${on ? "#303030" : "#d4d4d4"}`, background: on ? "#303030" : "#fff", color: on ? "#fff" : "#303030",
            }}
          >
            {o.label}
            {o.count !== undefined ? <span style={{ opacity: 0.7, fontWeight: 500 }}> · {o.count}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

export const fieldStyle = { padding: "7px 10px", borderRadius: 8, border: "1px solid #8a8a8a", font: "inherit", background: "#fff", minWidth: 0 };
