// Import Smile's member export: balances, lifetime coins, tiers and birthdays. Safe to run again at cutover:
// each run sets the balance to Smile's number (the difference is recorded as one "import" ledger row).
import prisma from "../db.server";
import { parseCsv, toInt, tierKeyFromName, parseBirthday } from "./csv";
import { tierIndex, tierForLifetime, isValidBirthday } from "./rules";
import { adminClient, findCustomersByEmail } from "./shopify.server";
import { findOrCreateMember } from "./ledger.server";

const job = (globalThis.__coinsImport ||= { running: false });

export function importStatus() {
  return { ...job };
}

export function previewCsv(text, mapping) {
  const { headers, records } = parseCsv(text);
  const rows = records.map((r) => toRow(r, mapping)).filter((r) => r.email);
  return {
    headers,
    total: records.length,
    withEmail: rows.length,
    coins: rows.reduce((s, r) => s + r.balance, 0),
    tiers: rows.reduce((acc, r) => ({ ...acc, [r.tier]: (acc[r.tier] || 0) + 1 }), {}),
    sample: rows.slice(0, 8),
  };
}

function toRow(r, map) {
  const lifetime = map.lifetime ? toInt(r[map.lifetime]) : null;
  const bday = map.birthday ? parseBirthday(r[map.birthday]) : null;
  return {
    email: String(r[map.email] || "").trim().toLowerCase(),
    balance: Math.max(0, toInt(r[map.balance])),
    lifetime,
    tier: map.tier ? tierKeyFromName(r[map.tier]) : "poke",
    birthday: bday && isValidBirthday(bday.month, bday.day) ? bday : null,
  };
}

export function startImport(text, mapping, staff) {
  if (job.running) throw new Error("An import is already running.");
  const { records } = parseCsv(text);
  const rows = records.map((r) => toRow(r, mapping)).filter((r) => r.email);
  Object.assign(job, {
    running: true, startedAt: new Date().toISOString(), finishedAt: null, total: rows.length,
    done: 0, imported: 0, notFound: 0, failed: 0, notFoundSample: [], error: null,
  });
  run(rows, staff)
    .catch((err) => { job.error = err.message; console.error("Import failed", err); })
    .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); });
}

async function run(rows, staff) {
  const admin = await adminClient();
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const found = await findCustomersByEmail(admin, batch.map((r) => r.email));
    for (const row of batch) {
      const customer = found.get(row.email);
      if (!customer) {
        job.notFound++;
        if (job.notFoundSample.length < 20) job.notFoundSample.push(row.email);
      } else {
        try {
          await importOne(customer, row, staff);
          job.imported++;
        } catch (err) {
          job.failed++;
          console.error(`Import ${row.email} failed`, err);
        }
      }
      job.done++;
    }
  }
}

async function importOne(customer, row, staff) {
  const member = await findOrCreateMember(customer, { welcome: false });
  const lifetime = Math.max(row.lifetime ?? 0, member.lifetimeEarned, row.balance);
  // Highest of: Smile's tier, what the lifetime coins qualify for, and the tier they already have here.
  const tier = [row.tier, tierForLifetime(lifetime).key, member.tier].sort((a, b) => tierIndex(b) - tierIndex(a)).at(0);
  const diff = row.balance - member.balance;
  await prisma.$transaction(async (tx) => {
    if (diff !== 0) {
      await tx.transaction.create({
        data: {
          memberId: member.id, amount: diff, kind: "import", countsToTier: false, staff,
          description: member.importedFromSmile ? "Balance updated from Smile" : "Coins moved over from our old rewards app",
        },
      });
    }
    await tx.member.update({
      where: { id: member.id },
      data: {
        balance: row.balance,
        lifetimeEarned: lifetime,
        tier,
        importedFromSmile: true,
        ...(row.birthday && !member.birthdayMonth ? { birthdayMonth: row.birthday.month, birthdayDay: row.birthday.day } : {}),
      },
    });
  });
}
