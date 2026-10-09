// Judge.me "review/created" webhook: POST /judgeme?token=JUDGEME_WEBHOOK_TOKEN
import { timingSafeEqual } from "node:crypto";
import { handleReview } from "../coins/events.server";

function tokenOk(given) {
  const want = process.env.JUDGEME_WEBHOOK_TOKEN || "";
  if (!want || !given || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export const action = async ({ request }) => {
  if (!tokenOk(new URL(request.url).searchParams.get("token"))) return new Response("Forbidden", { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const result = await handleReview(body);
    console.log(`Judge.me review: ${JSON.stringify(result)}`);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Judge.me review failed", err);
    return new Response("Error", { status: 500 });
  }
};
