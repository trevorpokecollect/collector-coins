// Sends Collector Coins events to Klaviyo so emails (earned, redeemed, tier reached) are Klaviyo flows.
// Needs KLAVIYO_PRIVATE_KEY (a private API key with Events: write and Profiles: write). Without it, nothing is sent.

export const METRICS = {
  earned: "Collector Coins Earned",
  spent: "Collector Coins Redeemed",
  tier: "Collector Coins Tier Reached",
  reward: "Collector Coins Reward Issued",
  adjusted: "Collector Coins Adjusted",
};

export async function sendEvent(metric, member, properties = {}) {
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
  try {
    const res = await fetch("https://a.klaviyo.com/api/events", {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: "2025-10-15",
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`Klaviyo ${metric} failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`Klaviyo ${metric} failed`, err);
  }
}
