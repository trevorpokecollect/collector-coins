// POST /apps/coins/birthday (Shopify app proxy): { month, day }. Can be set once (staff can change it).
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { memberForProxy, panelState } from "../coins/panel.server";
import { isValidBirthday } from "../coins/rules";

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  if (!String(request.headers.get("content-type") || "").includes("application/json")) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const member = await memberForProxy(request);
    if (!member) return Response.json({ error: "Sign in first." }, { status: 401 });
    if (member.birthdayMonth) return Response.json({ error: "Your birthday is already saved. Contact support to change it." }, { status: 400 });
    const { month, day } = await request.json();
    if (!isValidBirthday(month, day)) return Response.json({ error: "That date doesn't look right." }, { status: 400 });
    const updated = await prisma.member.update({ where: { id: member.id }, data: { birthdayMonth: Number(month), birthdayDay: Number(day) } });
    return Response.json({ state: await panelState(updated) });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Birthday save failed", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
};
