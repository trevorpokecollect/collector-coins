import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, detectColumns, tierKeyFromName, parseBirthday, toInt } from "../app/coins/csv.js";

test("parse csv with quotes", () => {
  const { headers, records } = parseCsv('﻿First name,Email,Points balance,VIP tier,Points earned\r\n"Ash, K",ash@x.com,"1,250",Great Ball,2000\r\n\r\n');
  assert.deepEqual(headers, ["First name", "Email", "Points balance", "VIP tier", "Points earned"]);
  assert.equal(records.length, 1);
  assert.equal(records[0]["First name"], "Ash, K");
  assert.equal(toInt(records[0]["Points balance"]), 1250);
  assert.deepEqual(detectColumns(headers), { email: "Email", balance: "Points balance", lifetime: "Points earned", tier: "VIP tier" });
});

test("tiers and birthdays", () => {
  assert.equal(tierKeyFromName("Master Ball"), "master");
  assert.equal(tierKeyFromName(""), "poke");
  assert.deepEqual(parseBirthday("1990-07-04"), { month: 7, day: 4 });
  assert.deepEqual(parseBirthday("07/04"), { month: 7, day: 4 });
  assert.deepEqual(parseBirthday("--12-25"), { month: 12, day: 25 });
  assert.equal(parseBirthday(""), null);
});
