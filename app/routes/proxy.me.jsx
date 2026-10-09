// GET /apps/coins/me (Shopify app proxy): everything the coin panel shows.
import { authenticate } from "../shopify.server";
import { memberForProxy, panelState } from "../coins/panel.server";

export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);
  try {
    const member = await memberForProxy(request);
    return Response.json(await panelState(member), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Panel load failed", err);
    return Response.json({ error: "Couldn't load your coins. Try again in a moment." }, { status: 500 });
  }
};
