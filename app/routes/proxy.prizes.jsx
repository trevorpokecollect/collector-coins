// GET /apps/coins/prizes (Shopify app proxy): the live prize list for anyone, signed in or not.
// Used by the Collector Coins landing page so its rewards grid always matches stock.
import { authenticate } from "../shopify.server";
import { adminClient, listPrizes } from "../coins/shopify.server";
import { COINS_PER_DOLLAR_OFF } from "../coins/rules";

export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);
  try {
    const prizes = await listPrizes(await adminClient());
    return Response.json({ coinsPerDollarOff: COINS_PER_DOLLAR_OFF, prizes }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (err) {
    console.error("Prize list failed", err);
    return Response.json({ error: "Couldn't load prizes" }, { status: 500 });
  }
};
