// POST /apps/coins/track (Shopify app proxy): coin panel interactions for the Engagement page.
// Body: { visitor, events: [{ event, target, path }] }, sent with navigator.sendBeacon. Only known event names are kept.
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { cleanTrackEvents } from "../coins/metrics";

export const action = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
  } catch {
    return new Response(null, { status: 401 });
  }
  try {
    const text = await request.text();
    if (text.length > 8000) return new Response(null, { status: 413 });
    const body = JSON.parse(text || "{}");
    const events = cleanTrackEvents(body.events);
    if (!events.length) return new Response(null, { status: 204 });
    const customerId = new URL(request.url).searchParams.get("logged_in_customer_id");
    const member = customerId ? await prisma.member.findUnique({ where: { customerId }, select: { id: true } }) : null;
    const visitor = /^[a-z0-9]{8,32}$/i.test(String(body.visitor || "")) ? String(body.visitor) : null;
    await prisma.panelEvent.createMany({
      data: events.map((e) => ({ ...e, memberId: member?.id || null, visitor })),
    });
  } catch (err) {
    console.error("Track failed", err.message);
  }
  return new Response(null, { status: 204 });
};
