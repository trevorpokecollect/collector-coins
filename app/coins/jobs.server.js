// Background jobs inside the web process, checked every hour. Each one is safe to run more than once.
// - birthday coins (once per member per year)
// - coin expiry warnings and expiry (once a day, from 10am store time)
// - redemption spike alert (at most one alert a day)
import { runBirthdays } from "./events.server";
import { runExpiry, checkRedemptionSpike } from "./expiry.server";
import { monthDayInZone } from "./rules";

const HOUR = 60 * 60 * 1000;
const state = (globalThis.__coinsJobs ||= { started: false, expiryDay: null });

function chicagoHour(now) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(now)) % 24;
}

async function tick() {
  const now = new Date();
  try {
    const r = await runBirthdays(now);
    if (r.paid) console.log(`Birthday coins paid to ${r.paid} members`);
  } catch (e) {
    console.error("Birthday job failed", e);
  }
  const d = monthDayInZone(now);
  const dayKey = `${d.year}-${d.month}-${d.day}`;
  if (process.env.EXPIRY_ENABLED !== "false" && state.expiryDay !== dayKey && chicagoHour(now) >= 10) {
    state.expiryDay = dayKey;
    try {
      const r = await runExpiry(now);
      if (r.warned || r.expired) console.log(`Expiry: ${r.warned} warned, ${r.expired} expired`);
    } catch (e) {
      console.error("Expiry job failed", e);
    }
  }
  try {
    await checkRedemptionSpike(now);
  } catch (e) {
    console.error("Redemption check failed", e);
  }
}

export function startJobs() {
  if (state.started || process.env.NODE_ENV !== "production") return;
  state.started = true;
  setTimeout(tick, 60 * 1000);
  setInterval(tick, HOUR);
}
