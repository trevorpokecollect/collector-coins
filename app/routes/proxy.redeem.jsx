// POST /apps/coins/redeem (Shopify app proxy): { type: "discount", dollars } or { type: "prize", productId }
import { authenticate } from "../shopify.server";
import { memberForProxy, panelState } from "../coins/panel.server";
import { redeemDiscount, redeemPrize, RedeemError } from "../coins/redeem.server";

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  // JSON only: a plain cross-site form post can't spend a customer's coins.
  if (!String(request.headers.get("content-type") || "").includes("application/json")) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const member = await memberForProxy(request);
    if (!member) return Response.json({ error: "Sign in to redeem." }, { status: 401 });
    const body = await request.json();
    const result =
      body.type === "prize" ? await redeemPrize(member, String(body.productId || "")) : await redeemDiscount(member, body.dollars);
    const fresh = await memberForProxy(request);
    return Response.json({ reward: { title: result.reward.title, code: result.reward.code }, state: await panelState(fresh) });
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof RedeemError) return Response.json({ error: err.message }, { status: 400 });
    console.error("Redeem failed", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
};
