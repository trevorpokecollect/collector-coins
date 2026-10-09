// Shopify webhooks (subscribed in shopify.app.toml). Each handler is idempotent, so retries are safe.
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleOrderPaid, handleRefund, handleCustomer } from "../coins/events.server";

export const action = async ({ request }) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  try {
    let result;
    switch (topic) {
      case "ORDERS_PAID":
        result = await handleOrderPaid(payload);
        break;
      case "REFUNDS_CREATE":
        result = await handleRefund(payload);
        break;
      case "CUSTOMERS_CREATE":
        result = await handleCustomer(payload, { create: true });
        break;
      case "CUSTOMERS_UPDATE":
        result = await handleCustomer(payload, { create: false });
        break;
      case "APP_UNINSTALLED":
        if (session) await db.session.deleteMany({ where: { shop } });
        break;
      case "CUSTOMERS_DATA_REQUEST":
        // Member data is visible to staff on the app's admin page; nothing is sent automatically.
        break;
      case "CUSTOMERS_REDACT":
        if (payload?.customer?.id) await db.member.deleteMany({ where: { customerId: String(payload.customer.id) } });
        break;
      case "SHOP_REDACT":
        break;
      default:
        return new Response("Unhandled webhook topic", { status: 404 });
    }
    if (result) console.log(`${topic} ${payload?.name || payload?.id || ""}: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`${topic} failed`, err);
    return new Response("Error", { status: 500 }); // Shopify retries
  }
  return new Response();
};
