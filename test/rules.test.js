import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tierForLifetime, resolveTier, nextTier, toCents, purchaseCoins, refundCoins, prizeCoins,
  discountDollarsForCoins, orderEarns, birthdayCoinsDue, isValidBirthday, makeCode, monthDayInZone, expiryDate, redemptionAlertThreshold,
} from "../app/coins/rules.js";

test("tiers by lifetime coins", () => {
  assert.equal(tierForLifetime(0).key, "poke");
  assert.equal(tierForLifetime(499).key, "poke");
  assert.equal(tierForLifetime(500).key, "great");
  assert.equal(tierForLifetime(3500).key, "ultra");
  assert.equal(tierForLifetime(10000).key, "master");
});

test("tiers never drop", () => {
  assert.equal(resolveTier("ultra", 100).key, "ultra");
  assert.equal(resolveTier("great", 4000).key, "ultra");
  assert.equal(nextTier("master", 50000), null);
  assert.equal(nextTier("great", 1000).coinsToGo, 2500);
});

test("money parsing", () => {
  assert.equal(toCents("12.34"), 1234);
  assert.equal(toCents("12.3"), 1230);
  assert.equal(toCents("12"), 1200);
  assert.equal(toCents("0.07"), 7);
  assert.equal(toCents(null), 0);
});

test("purchase coins round down per tier rate", () => {
  assert.equal(purchaseCoins(4999, 2), 99);
  assert.equal(purchaseCoins(5000, 10), 500);
  assert.equal(purchaseCoins(0, 5), 0);
});

test("refunds take back at most what the order earned", () => {
  assert.equal(refundCoins(2000, 3, 150, 0), 60);
  assert.equal(refundCoins(5000, 3, 150, 100), 50);
  assert.equal(refundCoins(5000, 3, 150, 150), 0);
});

test("prize cost matches landing page", () => {
  assert.equal(prizeCoins(149), 300);
  assert.equal(prizeCoins(395), 800);
  assert.equal(prizeCoins(1149), 2300);
  assert.equal(prizeCoins(18795), 37600);
  assert.equal(prizeCoins(10), 100);
});

test("order discount 250 coins per $1", () => {
  assert.equal(discountDollarsForCoins(250), 1);
  assert.equal(discountDollarsForCoins(1249), 4);
});

test("online orders only", () => {
  const o = { customer: { id: 1 }, source_name: "web" };
  assert.equal(orderEarns(o, ["web"]).ok, true);
  assert.equal(orderEarns({ ...o, source_name: "pos" }, ["web"]).ok, false);
  assert.equal(orderEarns({ ...o, customer: null }, ["web"]).ok, false);
  assert.equal(orderEarns({ ...o, test: true }, ["web"]).ok, false);
});

test("birthdays", () => {
  const today = { year: 2027, month: 2, day: 28 };
  assert.equal(birthdayCoinsDue({ tier: "ultra", birthdayMonth: 2, birthdayDay: 29 }, today), 200);
  assert.equal(birthdayCoinsDue({ tier: "master", birthdayMonth: 2, birthdayDay: 28 }, today), 500);
  assert.equal(birthdayCoinsDue({ tier: "great", birthdayMonth: 2, birthdayDay: 28 }, today), 0);
  assert.equal(birthdayCoinsDue({ tier: "master", birthdayMonth: 2, birthdayDay: 28, birthdayYearAwarded: 2027 }, today), 0);
  assert.equal(isValidBirthday(2, 30), false);
  assert.equal(isValidBirthday(12, 31), true);
  assert.deepEqual(monthDayInZone(new Date("2026-10-10T03:00:00Z")), { year: 2026, month: 10, day: 9 });
});

test("codes", () => {
  assert.match(makeCode(), /^COINS-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test("expiry and alerts", () => {
  assert.equal(expiryDate(new Date("2026-10-09T12:00:00Z")).toISOString().slice(0, 10), "2027-10-09");
  assert.equal(expiryDate(new Date("2027-01-31T12:00:00Z"), 1).toISOString().slice(0, 10), "2027-02-28");
  assert.equal(redemptionAlertThreshold(2000), 10000);
  assert.equal(redemptionAlertThreshold(50000), 150000);
});

import { earnableSubtotalCents, refundedMerchCents, orderSource, TIER_REVOKE_DAYS } from "../app/coins/rules.js";

test("Shop app orders are recognised and can earn", () => {
  const order = { customer: { id: 1 }, source_name: "3890849" };
  assert.equal(orderSource(order), "shop");
  assert.deepEqual(orderEarns(order, ["web", "shop"]), { ok: true });
  assert.equal(orderEarns(order, ["web"]).ok, false);
  assert.equal(orderEarns({ customer: { id: 1 }, source_name: "292572659713" }, ["web", "shop"]).reason, "source whatnot");
});

test("gift cards bought on an order don't earn", () => {
  const order = {
    current_subtotal_price: "130.00",
    line_items: [
      { price: "30.00", quantity: 1, gift_card: false },
      { price: "50.00", quantity: 2, gift_card: true, discount_allocations: [] },
    ],
  };
  assert.equal(earnableSubtotalCents(order), 3000);
  assert.equal(earnableSubtotalCents({ current_subtotal_price: "40.00" }), 4000);
  assert.equal(earnableSubtotalCents({ current_subtotal_price: "50.00", line_items: [{ price: "50.00", quantity: 1, gift_card: true }] }), 0);
});

test("refunded merchandise: items, gift cards, and amount-only refunds", () => {
  // Item refund: subtotals of refunded items, gift card items skipped
  assert.equal(refundedMerchCents({
    refund_line_items: [{ subtotal: "20.00", line_item: { gift_card: false } }, { subtotal: "50.00", line_item: { gift_card: true } }],
  }), 2000);
  // Amount-only refund of $54.50 on an order with $100 subtotal + $9 tax: tax removed -> $50
  const amountOnly = { refund_line_items: [], transactions: [{ kind: "refund", status: "success", amount: "54.50" }], order_adjustments: [] };
  assert.equal(refundedMerchCents(amountOnly, { subtotalCents: 10000, taxCents: 900 }), 5000);
  // Shipping-only refund takes nothing back
  const shipOnly = {
    refund_line_items: [],
    transactions: [{ kind: "refund", status: "success", amount: "8.00" }],
    order_adjustments: [{ kind: "shipping_refund", amount: "-8.00", tax_amount: "0.00" }],
  };
  assert.equal(refundedMerchCents(shipOnly, { subtotalCents: 10000, taxCents: 900 }), 0);
  // Failed refund transactions don't count
  assert.equal(refundedMerchCents({ transactions: [{ kind: "refund", status: "failure", amount: "10.00" }] }, null), 0);
  assert.ok(TIER_REVOKE_DAYS >= 30);
});
