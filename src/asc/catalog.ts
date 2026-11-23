import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, vendorCacheDir } from "../config/paths";
import type { Account, ApiKey } from "../config/settings";
import type { Product } from "../reports/tsv";
import { ascAll } from "./client";

/**
 * Which app each product belongs to, so the report can show
 *   App
 *   ├─ In-app purchase
 *   └─ Subscription
 *
 * App names come from /v1/apps, which a Finance key may read. In-app purchases are
 * tied to their app by the "Parent Identifier" column of Sales reports, remembered
 * here so months with only a Financial Report are grouped too. An optional second
 * key (App Manager / Developer role) can list in-app purchases directly.
 */

export interface Catalog {
  apps: { id: string; sku: string; name: string }[];
  /** product ID -> app SKU */
  parents: Record<string, string>;
  /** product ID -> display name */
  names: Record<string, string>;
  appsFetchedAt?: string;
}

const MAX_AGE_MS = 7 * 86_400_000;
const file = (vendor: string) => join(vendorCacheDir(vendor), "catalog.json");

function readCatalog(vendor: string): Catalog {
  try {
    if (existsSync(file(vendor))) return JSON.parse(readFileSync(file(vendor), "utf-8")) as Catalog;
  } catch {
    // rebuilt below
  }
  return { apps: [], parents: {}, names: {} };
}

function writeCatalog(vendor: string, catalog: Catalog): void {
  ensureDir(vendorCacheDir(vendor));
  writeFileSync(file(vendor), JSON.stringify(catalog, null, 1), "utf-8");
}

type AppResource = { id: string; attributes: { name: string; sku: string } };
type NamedProduct = { id: string; attributes: { productId: string; name: string } };
type GroupsPage = { id: string };

async function listApps(key: ApiKey): Promise<Catalog["apps"]> {
  const apps = await ascAll<AppResource>(key, "/v1/apps?limit=200&fields[apps]=name,sku");
  return apps.map((a) => ({ id: a.id, sku: a.attributes.sku, name: a.attributes.name }));
}

async function listInAppProducts(key: ApiKey, apps: Catalog["apps"]): Promise<{ parents: Record<string, string>; names: Record<string, string> }> {
  const parents: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const app of apps) {
    const iaps = await ascAll<NamedProduct>(key, `/v1/apps/${app.id}/inAppPurchasesV2?limit=200&fields[inAppPurchases]=productId,name`);
    const groups = await ascAll<GroupsPage>(key, `/v1/apps/${app.id}/subscriptionGroups?limit=200&fields[subscriptionGroups]=referenceName`);
    const subs: NamedProduct[] = [];
    for (const g of groups) {
      subs.push(...(await ascAll<NamedProduct>(key, `/v1/subscriptionGroups/${g.id}/subscriptions?limit=200&fields[subscriptions]=productId,name`)));
    }
    for (const p of [...iaps, ...subs]) {
      parents[p.attributes.productId] = app.sku;
      names[p.attributes.productId] = p.attributes.name;
    }
  }
  return { parents, names };
}

/** Cached catalog, refreshed weekly or on request. Never throws: grouping is optional. */
export async function loadCatalog(account: Account, refresh: boolean, log: (msg: string) => void): Promise<Catalog> {
  const catalog = readCatalog(account.vendor);
  const stale = !catalog.appsFetchedAt || Date.now() - Date.parse(catalog.appsFetchedAt) > MAX_AGE_MS;
  if (!refresh && !stale) return catalog;

  try {
    catalog.apps = await listApps(account.key);
  } catch (error) {
    if (account.catalogKey) {
      try {
        catalog.apps = await listApps(account.catalogKey);
      } catch (inner) {
        log(`Could not list apps (${(inner as Error).message}); products are shown ungrouped.`);
      }
    } else {
      log(`Could not list apps (${(error as Error).message}); products are shown ungrouped.`);
    }
  }

  if (account.catalogKey && catalog.apps.length > 0) {
    try {
      const found = await listInAppProducts(account.catalogKey, catalog.apps);
      Object.assign(catalog.parents, found.parents);
      Object.assign(catalog.names, found.names);
    } catch (error) {
      log(`Could not list in-app purchases (${(error as Error).message}).`);
    }
  }

  catalog.appsFetchedAt = new Date().toISOString();
  writeCatalog(account.vendor, catalog);
  return catalog;
}

/** Remembers which app each in-app purchase seen in Sales reports belongs to. */
export function learnParents(account: Account, catalog: Catalog, salesProducts: Iterable<Product>): void {
  let changed = false;
  for (const p of salesProducts) {
    if (p.parentSku && catalog.parents[p.id] !== p.parentSku) {
      catalog.parents[p.id] = p.parentSku;
      changed = true;
    }
    if (!catalog.names[p.id] && p.title) {
      catalog.names[p.id] = p.title;
      changed = true;
    }
  }
  if (changed) writeCatalog(account.vendor, catalog);
}

/**
 * Parent of a product never seen in a Sales report, guessed from its siblings:
 * "com.shift.lifetime" belongs where "com.shift.weekly" does, if every known product
 * with the "com.shift." prefix belongs to the same app.
 */
function siblingParent(catalog: Catalog, productId: string): string | undefined {
  const cut = productId.lastIndexOf(".");
  if (cut <= 0) return undefined;
  const prefix = productId.slice(0, cut + 1).toLowerCase();
  const parents = new Set<string>();
  for (const [id, parent] of Object.entries(catalog.parents)) {
    if (id.toLowerCase().startsWith(prefix) && id.slice(prefix.length).indexOf(".") < 0) parents.add(parent);
  }
  if (parents.size === 1) return [...parents][0];
  // or the prefix is an app's own SKU: "com.shift.lifetime" under app SKU "com.shift"
  const app = catalog.apps.find((a) => a.sku.toLowerCase() + "." === prefix);
  return app?.sku;
}

/** The app a product belongs to, or null when unknown. */
export function appOf(catalog: Catalog, product: Pick<Product, "id" | "appleId" | "parentSku">): { key: string; name: string } | null {
  const parentSku = product.parentSku || catalog.parents[product.id] || siblingParent(catalog, product.id);
  const app =
    (parentSku && catalog.apps.find((a) => a.sku === parentSku)) ||
    catalog.apps.find((a) => a.sku === product.id) ||
    (product.appleId && catalog.apps.find((a) => a.id === product.appleId)) ||
    null;
  if (app) return { key: app.sku, name: app.name };
  return parentSku ? { key: parentSku, name: parentSku } : null;
}
