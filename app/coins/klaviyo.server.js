// Sends Collector Coins events to Klaviyo so emails (earned, redeemed, tier reached) are Klaviyo flows.
// Needs KLAVIYO_PRIVATE_KEY (a private API key with Events: write and Profiles: write). Without it, nothing is sent.

export const METRICS = {
  earned: "Collector Coins Earned",
  spent: "Collector Coins Redeemed",
  tier: "Collector Coins Tier Reached",
  reward: "Collector Coins Reward Issued",
  adjusted: "Collector Coins Adjusted",
  expiring: "Collector Coins Expiring Soon",
  expired: "Collector Coins Expired",
  alert: "Collector Coins Redemption Alert",
};

/**
 * Queue an event for Klaviyo and return straight away. Callers include Shopify webhooks, which fail if they
 * take over 5 seconds, so a slow or down Klaviyo must never hold them up. A timeout or 5xx is retried once.
 */
export function sendEvent(metric, member, properties = {}) {
  const key = process.env.KLAVIYO_PRIVATE_KEY;
  if (!key || !member?.email) return;
  const body = {
    data: {
      type: "event",
      attributes: {
        properties,
        metric: { data: { type: "metric", attributes: { name: metric } } },
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: member.email,
              first_name: member.firstName || undefined,
              last_name: member.lastName || undefined,
              properties: {
                "Collector Coins Balance": member.balance,
                "Collector Coins Tier": member.tierName,
                "Collector Coins Lifetime": member.lifetimeEarned,
              },
            },
          },
        },
        unique_id: properties.unique_id,
      },
    },
  };
  enqueue(() => deliver(metric, key, body, 1));
}

const RETRY_AFTER_MS = 90_000;
const MAX_IN_FLIGHT = 5; // Klaviyo allows ~10 events/s per key; batch jobs (expiry warnings) queue behind this.
let inFlight = 0;
const queue = [];

function enqueue(job) {
  queue.push(job);
  pump();
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const job = queue.shift();
    inFlight++;
    job()
      .catch((err) => console.error("Klaviyo send failed", err))
      .finally(() => {
        inFlight--;
        pump();
      });
  }
}

async function deliver(metric, key, body, attemptsLeft) {
  let res;
  try {
    res = await fetch("https://a.klaviyo.com/api/events", {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: "2025-10-15",
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return retryOrLog(metric, key, body, attemptsLeft, err.name === "TimeoutError" ? "timed out" : String(err));
  }
  if (res.ok) return;
  const text = (await res.text()).slice(0, 300);
  if (res.status >= 500 || res.status === 429) return retryOrLog(metric, key, body, attemptsLeft, `${res.status} ${text}`);
  console.error(`Klaviyo ${metric} failed: ${res.status} ${text}`);
}

function retryOrLog(metric, key, body, attemptsLeft, reason) {
  if (attemptsLeft > 0) {
    console.warn(`Klaviyo ${metric}: ${reason}; retrying in ${RETRY_AFTER_MS / 1000}s`);
    setTimeout(() => enqueue(() => deliver(metric, key, body, attemptsLeft - 1)), RETRY_AFTER_MS);
    return;
  }
  console.error(`Klaviyo ${metric} failed: ${reason}`);
}

// ---- marketing sign-ups (text + email alerts) ------------------------------------------------------
// Needs the private key's "Subscriptions: write" and "Lists: write" scopes. Lists default to the store's
// "Email List" and "SMS List"; override with KLAVIYO_EMAIL_LIST_ID / KLAVIYO_SMS_LIST_ID.

const SUBSCRIBE_URL = "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs";

function klaviyoHeaders(key) {
  return {
    Authorization: `Klaviyo-API-Key ${key}`,
    revision: "2025-10-15",
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
  };
}

function subscriptionJob(listId, profile) {
  return {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: { custom_source: "Collector Coins panel", profiles: { data: [{ type: "profile", attributes: profile }] } },
      relationships: { list: { data: { type: "list", id: listId } } },
    },
  };
}

/** Subscribe one customer to marketing emails and texts. Throws if Klaviyo refuses either. */
export async function subscribeToAlerts({ email, phone }) {
  const key = process.env.KLAVIYO_PRIVATE_KEY;
  if (!key) throw new Error("KLAVIYO_PRIVATE_KEY is not set");
  const jobs = [
    subscriptionJob(process.env.KLAVIYO_EMAIL_LIST_ID || "RMifBt", {
      email,
      subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } },
    }),
    subscriptionJob(process.env.KLAVIYO_SMS_LIST_ID || "XMAWKx", {
      email,
      phone_number: phone,
      subscriptions: { sms: { marketing: { consent: "SUBSCRIBED" } } },
    }),
  ];
  for (const body of jobs) {
    const res = await fetch(SUBSCRIBE_URL, { method: "POST", headers: klaviyoHeaders(key), body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Klaviyo subscribe ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** Whether the key can subscribe people (an empty job is refused with 400 if allowed, 401/403 if not). */
export async function klaviyoCanSubscribe() {
  const key = process.env.KLAVIYO_PRIVATE_KEY;
  if (!key) return false;
  try {
    const res = await fetch(SUBSCRIBE_URL, {
      method: "POST", headers: klaviyoHeaders(key), signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ data: { type: "profile-subscription-bulk-create-job", attributes: { profiles: { data: [] } } } }),
    });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return null;
  }
}
