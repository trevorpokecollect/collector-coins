// Small CSV reader for the Smile member export, plus column detection.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s.charAt(i + 1) === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r.at(i) || "").trim()])));
  return { headers, records };
}

const GUESS = {
  email: [/^e-?mail/i, /email/i],
  balance: [/points?\s*balance/i, /^balance$/i, /balance/i, /^points$/i],
  lifetime: [/points?\s*earned/i, /lifetime/i, /earned/i],
  tier: [/vip\s*tier/i, /tier/i, /vip/i],
  birthday: [/birth/i],
};

/** Best guess for which column holds each field. */
export function detectColumns(headers) {
  const out = {};
  for (const [field, patterns] of Object.entries(GUESS)) {
    for (const p of patterns) {
      const h = headers.find((x) => p.test(x) && !Object.values(out).includes(x));
      if (h) { out[field] = h; break; }
    }
  }
  return out;
}

export function toInt(v) {
  const n = Number(String(v || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Smile tier name ("Great Ball", "Ultra", "master ball tier") to our key. */
export function tierKeyFromName(name) {
  const s = String(name || "").toLowerCase();
  if (s.includes("master")) return "master";
  if (s.includes("ultra")) return "ultra";
  if (s.includes("great")) return "great";
  return "poke";
}

/** "1990-07-04", "07/04", "July 4", "--07-04" to { month, day } or null. */
export function parseBirthday(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || s.match(/^-{0,2}(\d{1,2})-(\d{1,2})$/);
  if (m) return m.length === 4 ? { month: +m[2], day: +m[3] } : { month: +m[1], day: +m[2] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})/);
  if (m) return { month: +m[1], day: +m[2] };
  const d = new Date(s + (/\d{4}/.test(s) ? "" : " 2000"));
  return isNaN(d) ? null : { month: d.getMonth() + 1, day: d.getDate() };
}
