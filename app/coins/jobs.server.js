// Background jobs inside the web process: birthday coins, checked every hour (idempotent per member per year).
import { runBirthdays } from "./events.server";

const HOUR = 60 * 60 * 1000;

export function startJobs() {
  if (globalThis.__coinsJobsStarted || process.env.NODE_ENV !== "production") return;
  globalThis.__coinsJobsStarted = true;
  const tick = () =>
    runBirthdays()
      .then((r) => r.paid && console.log(`Birthday coins paid to ${r.paid} members`))
      .catch((e) => console.error("Birthday job failed", e));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, HOUR);
}
