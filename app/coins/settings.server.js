// Stored app settings. The coin panel design lives in the Setting table and is copied to an app-data metafield
// (namespace collector_coins, key panel) so the storefront embed can read it in Liquid without an extra request.
import prisma from "../db.server";
import { normalizePanelSettings } from "./panelSettings";
import { adminClient, gql } from "./shopify.server";

const cache = (globalThis.__coinsPanelSettings ||= { at: 0, value: null });

export async function getPanelSettings() {
  if (cache.value && Date.now() - cache.at < 60 * 1000) return cache.value;
  let saved = null;
  try {
    saved = (await prisma.setting.findUnique({ where: { key: "panel" } }))?.value;
  } catch (err) {
    console.error("Loading panel settings failed", err.message);
  }
  cache.value = normalizePanelSettings(saved);
  cache.at = Date.now();
  return cache.value;
}

const INSTALLATION = `#graphql
query { currentAppInstallation { id } }`;

const SET_METAFIELD = `#graphql
mutation SetPanel($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
}`;

/** Copy the panel design to the app-data metafield the storefront reads. */
export async function syncPanelMetafield(value, admin) {
  admin ||= await adminClient();
  const { currentAppInstallation } = await gql(admin, INSTALLATION);
  const data = await gql(admin, SET_METAFIELD, {
    metafields: [{ ownerId: currentAppInstallation.id, namespace: "collector_coins", key: "panel", type: "json", value: JSON.stringify(value) }],
  });
  const errs = data.metafieldsSet.userErrors;
  if (errs.length) throw new Error("Saving to Shopify failed: " + errs.map((e) => e.message).join("; "));
}

export async function savePanelSettings(input, { staff, admin } = {}) {
  const value = normalizePanelSettings(input);
  await prisma.setting.upsert({ where: { key: "panel" }, create: { key: "panel", value, updatedBy: staff }, update: { value, updatedBy: staff } });
  cache.value = value;
  cache.at = Date.now();
  await syncPanelMetafield(value, admin);
  return value;
}

export async function panelSettingsMeta() {
  const row = await prisma.setting.findUnique({ where: { key: "panel" } });
  return row ? { updatedAt: row.updatedAt, updatedBy: row.updatedBy } : null;
}
