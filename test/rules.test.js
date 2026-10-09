import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tierForLifetime, resolveTier, nextTier, toCents, purchaseCoins, refundCoins, prizeCoins,
  discountDollarsForCoins, orderEarns, birthdayCoinsDue, isValidBirthday, makeCode, monthDayInZone,
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
