// Admin API calls the coin program needs: discount codes, gift cards, customers, prize products.
import { unauthenticated } from "../shopify.server";
import { PRIZE_COLLECTION_HANDLE, PRIZE_MIN_STOCK, PRIZE_TAG, prizeCoins, toCents } from "./rules";

export function shopDomain() {
  return process.env.SHOP || "poke-collect-al.myshopify.com";
}

export async function adminClient(shop = shopDomain()) {
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

export async function gql(admin, query, variables = {}) {
  const res = await admin.graphql(query, { variables });
  const body = await res.json();
  if (body.errors && body.errors.length) {
    throw new Error("Shopify GraphQL error: " + JSON.stringify(body.errors));
  }
  return body.data;
}

export const customerGid = (id) => (String(id).startsWith("gid://") ? String(id) : `gid://shopify/Customer/${id}`);
export const numericId = (gid) => String(gid).split("/").pop();

function userErrorsOrThrow(errors, what) {
  if (errors && errors.length) throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
}

const CREATE_CODE = `#graphql
mutation CreateCode($input: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $input) {
    codeDiscountNode { id }
    userErrors { field message code }
  }
}`;

/**
 * One-time fixed-amount code locked to one customer.
 * productId set: the amount only applies to that product (free-product reward).
 */
export async function createDiscountCode(admin, { code, title, customerId, amountCents, minimumCents, productId }) {
  const isProduct = Boolean(productId);
  const input = {
    title,
    code,
    startsAt: new Date().toISOString(),
    usageLimit: 1,
    appliesOncePerCustomer: true,
    context: { customers: { add: [customerGid(customerId)] } },
    combinesWith: isProduct
      ? { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true }
      : { orderDiscounts: false, productDiscounts: true, shippingDiscounts: true },
    customerGets: {
      value: { discountAmount: { amount: (amountCents / 100).toFixed(2), appliesOnEachItem: false } },
      items: isProduct ? { products: { productsToAdd: [productId] } } : { all: true },
    },
  };
  if (minimumCents) input.minimumRequirement = { subtotal: { greaterThanOrEqualToSubtotal: (minimumCents / 100).toFixed(2) } };
  const data = await gql(admin, CREATE_CODE, { input });
  userErrorsOrThrow(data.discountCodeBasicCreate.userErrors, "Discount code");
  return { id: data.discountCodeBasicCreate.codeDiscountNode.id, code };
}

const CREATE_GIFT_CARD = `#graphql
mutation CreateGiftCard($input: GiftCardCreateInput!) {
  giftCardCreate(input: $input) {
    giftCard { id lastCharacters }
    giftCardCode
    userErrors { field message code }
  }
}`;

export async function createGiftCard(admin, { customerId, amountCents, note }) {
  const data = await gql(admin, CREATE_GIFT_CARD, {
    input: { initialValue: (amountCents / 100).toFixed(2), ...(customerId ? { customerId: customerGid(customerId) } : {}), note },
  });
  userErrorsOrThrow(data.giftCardCreate.userErrors, "Gift card");
  return { id: data.giftCardCreate.giftCard.id, code: data.giftCardCreate.giftCardCode };
}

const CUSTOMER = `#graphql
query Customer($id: ID!) {
  customer(id: $id) { id firstName lastName tags defaultEmailAddress { emailAddress } }
}`;

export async function getCustomer(admin, customerId) {
  const data = await gql(admin, CUSTOMER, { id: customerGid(customerId) });
  const c = data.customer;
  if (!c) return null;
  return {
    customerId: numericId(c.id),
    email: c.defaultEmailAddress?.emailAddress || null,
    firstName: c.firstName,
    lastName: c.lastName,
    tags: c.tags || [],
  };
}

const CUSTOMERS = `#graphql
query Customers($q: String!) {
  customers(first: 100, query: $q) { nodes { id firstName lastName tags defaultEmailAddress { emailAddress } } }
}`;

/** Look up customers by email, up to 50 at a time. Returns Map(lowercased email -> customer). */
export async function findCustomersByEmail(admin, emails) {
  const out = new Map();
  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50).filter(Boolean);
    if (!batch.length) continue;
    const q = batch.map((e) => `email:"${String(e).replace(/"/g, "")}"`).join(" OR ");
    const data = await gql(admin, CUSTOMERS, { q });
    for (const c of data.customers.nodes) {
      const email = c.defaultEmailAddress?.emailAddress;
      if (email) {
        out.set(email.toLowerCase(), {
          customerId: numericId(c.id),
          email,
          firstName: c.firstName,
          lastName: c.lastName,
          tags: c.tags || [],
        });
      }
    }
  }
  return out;
}

const PRIZES = `#graphql
query Prizes($handle: String!) {
  collectionByIdentifier(identifier: { handle: $handle }) {
    products(first: 100, sortKey: PRICE) {
      nodes {
        id title handle status tags onlineStoreUrl
        featuredMedia { preview { image { url } } }
        variants(first: 50) { nodes { id price inventoryQuantity inventoryItem { tracked } } }
      }
    }
  }
}`;

let prizeCache = { at: 0, list: [] };

/**
 * Redeemable prizes: products in the Collector Coins Prizes collection, active, tagged, not pre-order,
 * with at least 20 tracked units in stock. Same rules as the landing page. Cached for 5 minutes.
 */
export async function listPrizes(admin, { fresh = false } = {}) {
  if (!fresh && Date.now() - prizeCache.at < 5 * 60 * 1000) return prizeCache.list;
  const data = await gql(admin, PRIZES, { handle: PRIZE_COLLECTION_HANDLE });
  const nodes = data.collectionByIdentifier?.products?.nodes || [];
  const list = [];
  for (const p of nodes) {
    if (p.status !== "ACTIVE") continue;
    if (!p.tags.includes(PRIZE_TAG) || p.tags.includes("Pre-Order")) continue;
    const variants = p.variants.nodes;
    const stock = variants.filter((v) => v.inventoryItem?.tracked).reduce((s, v) => s + Math.max(0, v.inventoryQuantity || 0), 0);
    if (stock < PRIZE_MIN_STOCK) continue;
    const priceCents = Math.max(...variants.map((v) => toCents(v.price)));
    list.push({
      productId: p.id,
      title: p.title,
      url: p.onlineStoreUrl || `/products/${p.handle}`,
      image: p.featuredMedia?.preview?.image?.url || null,
      priceCents,
      coins: prizeCoins(priceCents),
      stock,
    });
  }
  list.sort((a, b) => a.coins - b.coins);
  prizeCache = { at: Date.now(), list };
  return list;
}

const DEACTIVATE_CODE = `#graphql
mutation DeactivateCode($id: ID!) {
  discountCodeDeactivate(id: $id) { codeDiscountNode { id } userErrors { field message } }
}`;

const DEACTIVATE_GIFT_CARD = `#graphql
mutation DeactivateGiftCard($id: ID!) {
  giftCardDeactivate(id: $id) { giftCard { id enabled } userErrors { field message } }
}`;

/** Switch off a reward's discount code or gift card in Shopify (used when a refund takes a tier away). */
export async function deactivateReward(admin, reward) {
  if (!reward.shopifyId) return;
  if (reward.shopifyId.includes("/GiftCard/")) {
    const data = await gql(admin, DEACTIVATE_GIFT_CARD, { id: reward.shopifyId });
    userErrorsOrThrow(data.giftCardDeactivate.userErrors, "Gift card deactivate");
  } else {
    const data = await gql(admin, DEACTIVATE_CODE, { id: reward.shopifyId });
    userErrorsOrThrow(data.discountCodeDeactivate.userErrors, "Discount deactivate");
  }
}

const ORDER_TOTALS = `#graphql
query OrderTotals($id: ID!) {
  order(id: $id) { subtotalPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } }
}`;

/** An order's original subtotal and tax in cents, for working out the merchandise part of an amount-only refund. */
export async function getOrderTotals(admin, orderId) {
  const id = String(orderId).startsWith("gid://") ? String(orderId) : `gid://shopify/Order/${orderId}`;
  const data = await gql(admin, ORDER_TOTALS, { id });
  if (!data.order) return null;
  return {
    subtotalCents: toCents(data.order.subtotalPriceSet?.shopMoney?.amount),
    taxCents: toCents(data.order.totalTaxSet?.shopMoney?.amount),
  };
}

const CUSTOMER_ORDERS = `#graphql
query CustomerOrders($q: String!) {
  orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
    nodes { lineItems(first: 100) { nodes { product { id } } } }
  }
}`;

/**
 * Whether the customer has a paid order containing the product. The app's read_orders access only reaches the
 * last 60 days of orders, which covers Judge.me's review requests (sent after delivery).
 */
export async function customerBoughtProduct(admin, customerId, productId) {
  const want = numericId(productId);
  const data = await gql(admin, CUSTOMER_ORDERS, { q: `customer_id:${numericId(customerId)} AND (financial_status:paid OR financial_status:partially_refunded)` });
  return (data.orders?.nodes || []).some((o) => o.lineItems.nodes.some((li) => li.product && numericId(li.product.id) === want));
}
