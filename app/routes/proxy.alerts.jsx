// POST /apps/coins/alerts (Shopify app proxy): { phone, consent }. Signs the customer up for marketing texts and
// emails in Klaviyo and pays ALERTS_SIGNUP_COINS once per account and once per phone number.
import { createHash } from "node:crypto";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { memberForProxy, panelState } from "../coins/panel.server";
import { credit } from "../coins/ledger.server";
import { subscribeToAlerts } from "../coins/klaviyo.server";
import { ALERTS_SIGNUP_COINS, normalizeUsPhone } from "../coins/rules";

const phoneKey = (phone) => createHash("sha256").update(`coins-alerts:${phone}`).digest("hex").slice(0, 40);

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  if (!String(request.headers.get("content-type") || "").includes("application/json")) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const member = await memberForProxy(request);
    if (!member) return Response.json({ error: "Sign in first." }, { status: 401 });
    if (!member.email) return Response.json({ error: "Add an email address to your account first." }, { status: 400 });
    if (await prisma.transaction.findUnique({ where: { idemKey: `alerts-signup:${member.id}` } })) {
      return Response.json({ error: "You've already earned your alert coins." }, { status: 400 });
    }
    const { phone: raw, consent } = await request.json();
    if (consent !== true) return Response.json({ error: "Check the box to agree to texts and emails." }, { status: 400 });
    const phone = normalizeUsPhone(raw);
    if (!phone) return Response.json({ error: "Enter a 10-digit US mobile number." }, { status: 400 });
    const samePhone = await prisma.transaction.findFirst({ where: { kind: "alerts_signup", meta: { path: ["phoneKey"], equals: phoneKey(phone) } } });
    if (samePhone) return Response.json({ error: "That number has already earned alert coins on another account." }, { status: 400 });

    try {
      await subscribeToAlerts({ email: member.email, phone });
    } catch (err) {
      console.error("Alerts sign-up failed", err.message);
      return Response.json({ error: "We couldn't sign you up just now. Please try again in a minute." }, { status: 502 });
    }
    await credit(member, {
      amount: ALERTS_SIGNUP_COINS,
      kind: "alerts_signup",
      description: "Joined Text & Email Alerts",
      idemKey: `alerts-signup:${member.id}`,
      meta: { phoneKey: phoneKey(phone) },
    });
    const fresh = await prisma.member.findUnique({ where: { id: member.id } });
    return Response.json({ state: await panelState(fresh), coins: ALERTS_SIGNUP_COINS });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Alerts sign-up failed", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
};
