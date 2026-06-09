import { openDatabase, type SeedProduct } from "./database.js";
import { comparePrices, type StoreResult } from "./scrapers.js";

const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const categories = (process.env.CATEGORIES ?? "paneer,cheese,milk,curd")
  .split(",")
  .map((category) => category.trim().toLowerCase())
  .filter(Boolean);
const pincode = process.env.PINCODE ?? "560001";
const maxPages = Number(process.env.MAX_PAGES ?? 25);
const maxProducts = process.env.MAX_PRODUCTS ? Number(process.env.MAX_PRODUCTS) : undefined;
const offsetProducts = Number(process.env.OFFSET_PRODUCTS ?? 0);
const skipOtherStores = process.env.SKIP_OTHER_STORES === "1";
const bigBasketPageDelayMs = Number(process.env.BIGBASKET_PAGE_DELAY_MS ?? 1200);
const priceExisting = process.env.PRICE_EXISTING === "1";

async function main() {
  const db = openDatabase();
  const run = db.createRun(categories);
  console.log(`Database: ${db.path}`);
  console.log(`Scrape run ${run.id} started for ${categories.join(", ")} at pincode ${pincode}`);

  try {
    if (priceExisting) {
      const products = db
        .listProducts()
        .filter((product) => categories.includes(product.category))
        .slice(offsetProducts, typeof maxProducts === "number" ? offsetProducts + maxProducts : undefined);
      console.log(`Pricing existing products: ${products.length}`);

      let index = 0;
      for (const product of products) {
        index += 1;
        const query = cleanText(`${product.brand} ${product.name} ${product.unit ?? ""}`);
        console.log(`[${index}/${products.length}] Pricing: ${query}`);
        const comparison = await comparePrices({ query, pincode });
        comparison.results.forEach((result) => db.recordPrice(product.id, run.id, result));
      }

      db.finishRun(run.id, "completed");
      console.log(`Scrape run ${run.id} completed.`);
      console.log(`Products in database: ${db.count("products")}`);
      console.log(`Price rows in database: ${db.count("store_prices")}`);
      return;
    }

    const seedProducts = await scrapeBigBasketSeedProducts(categories, maxPages);
    const selectedProducts = typeof maxProducts === "number" ? seedProducts.slice(0, maxProducts) : seedProducts;

    console.log(`BigBasket seed products found: ${seedProducts.length}`);
    if (selectedProducts.length !== seedProducts.length) {
      console.log(`MAX_PRODUCTS=${maxProducts}; processing first ${selectedProducts.length}`);
    }

    const productIds = new Map<string, number>();
    for (const product of selectedProducts) {
      const productId = db.upsertProduct(product);
      productIds.set(product.sourceProductId, productId);
      db.recordPrice(productId, run.id, bigBasketSeedPriceResult(product));
    }

    if (!skipOtherStores) {
      let index = 0;
      for (const product of selectedProducts) {
        index += 1;
        const productId = productIds.get(product.sourceProductId);
        if (!productId) continue;

        const query = productSearchQuery(product);
        console.log(`[${index}/${selectedProducts.length}] Pricing: ${query}`);

        try {
          const comparison = await comparePrices({ query, pincode });
          comparison.results
            .filter((result) => result.storeId !== "big-basket")
            .forEach((result) => db.recordPrice(productId, run.id, result));
        } catch (error) {
          const note = error instanceof Error ? error.message : "Price scrape failed.";
          db.recordPrice(productId, run.id, failedPriceResult("blinkit", "Blinkit", query, note));
          db.recordPrice(productId, run.id, failedPriceResult("amazon-now", "Amazon Now", query, note));
          db.recordPrice(productId, run.id, failedPriceResult("zepto", "Zepto", query, note));
          db.recordPrice(productId, run.id, failedPriceResult("flipkart-minutes", "Flipkart Minutes", query, note));
        }
      }
    }

    db.finishRun(run.id, "completed");
    console.log(`Scrape run ${run.id} completed.`);
    console.log(`Products in database: ${db.count("products")}`);
    console.log(`Price rows in database: ${db.count("store_prices")}`);
  } catch (error) {
    const note = error instanceof Error ? error.message : "Catalog scrape failed.";
    db.finishRun(run.id, "failed", note);
    throw error;
  }
}

async function scrapeBigBasketSeedProducts(categoryNames: string[], pageLimit: number): Promise<SeedProduct[]> {
  const cookie = await fetchBigBasketCookieHeader();
  const products = new Map<string, SeedProduct>();

  for (const category of categoryNames) {
    let emptyPages = 0;
    for (let page = 1; page <= pageLimit; page += 1) {
      const url = `https://www.bigbasket.com/listing-svc/v2/products?type=ps&slug=${encodeURIComponent(
        category
      )}&page=${page}`;
      let payload: unknown;
      try {
        payload = await fetchJson(url, {
          cookie,
          "x-channel": "BB-WEB",
          "x-entry-context": "bb-b2c",
          "x-entry-context-id": "100",
          "osmos-enabled": "true"
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "request failed";
        console.log(`BigBasket ${category} page ${page}: ${message}; stopping this category with partial results.`);
        break;
      }

      const pageProducts = extractBigBasketProducts(payload, category);
      console.log(`BigBasket ${category} page ${page}: ${pageProducts.length} products`);

      if (!pageProducts.length) {
        emptyPages += 1;
        if (emptyPages >= 2) break;
        continue;
      }

      emptyPages = 0;
      pageProducts.forEach((product) => products.set(product.sourceProductId, product));
      await sleep(bigBasketPageDelayMs);
    }
  }

  return Array.from(products.values());
}

function extractBigBasketProducts(payload: unknown, category: string): SeedProduct[] {
  const products = new Map<string, SeedProduct>();

  walkJson(payload, (item) => {
    const product = bigBasketProductFromObject(item, category);
    if (!product) return;
    if (!isRelevantBigBasketProduct(product)) return;
    products.set(product.sourceProductId, product);
  });

  return Array.from(products.values());
}

function bigBasketProductFromObject(item: Record<string, unknown>, category: string): SeedProduct | null {
  const id = stringValue(item.id) || stringValue(item.requested_sku_id);
  const desc = stringValue(item.desc);
  const absoluteUrl = stringValue(item.absolute_url);
  const pricing = objectValue(item.pricing);
  if (!id || !desc || !absoluteUrl || !pricing) return null;

  const brand = objectValue(item.brand);
  const discount = objectValue(pricing.discount);
  const primaryPrice = objectValue(discount?.prim_price);
  const images = Array.isArray(item.images) ? item.images : [];
  const image = objectValue(images[0]);
  const brandName = stringValue(brand?.name);
  const unit = stringValue(item.w);
  const price = parsePrice(stringValue(primaryPrice?.sp));
  const mrp = parsePrice(stringValue(discount?.mrp));
  const productUrl = resolveUrl(absoluteUrl, "https://www.bigbasket.com/");

  return {
    category,
    sourceStoreId: "big-basket",
    sourceProductId: id,
    brand: brandName,
    name: cleanText(`${brandName} ${desc}`),
    unit,
    productUrl,
    imageUrl: stringValue(image?.m) || stringValue(image?.l),
    price,
    mrp
  };
}

function bigBasketSeedPriceResult(product: SeedProduct): StoreResult {
  return {
    storeId: "big-basket",
    store: "BigBasket",
    productName: product.name,
    price: product.price,
    mrp: product.mrp,
    unit: product.unit,
    deliveryEta: "15-30 min",
    productUrl: product.productUrl,
    searchUrl: `https://www.bigbasket.com/ps/?q=${encodeURIComponent(product.category)}`,
    status: product.price === null ? "unavailable" : "live",
    note: product.price === null ? "BigBasket seed product did not expose a selling price." : undefined,
    checkedAt: new Date().toISOString()
  };
}

function failedPriceResult(storeId: StoreResult["storeId"], store: string, query: string, note: string): StoreResult {
  return {
    storeId,
    store,
    productName: query,
    price: null,
    mrp: null,
    unit: undefined,
    deliveryEta: undefined,
    productUrl: null,
    searchUrl: "",
    status: "unavailable",
    note,
    checkedAt: new Date().toISOString()
  };
}

function productSearchQuery(product: SeedProduct): string {
  return cleanText(`${product.name} ${product.unit ?? ""}`);
}

function isRelevantBigBasketProduct(product: SeedProduct): boolean {
  const text = `${product.name} ${product.unit ?? ""}`.toLowerCase();
  const snackWords =
    /\b(popcorn|popcorns|nacho|nachos|nachoz|chips|puffs|makhana|cracker|crackers|biscuit|biscuits|cookie|cookies|bakes|baked|caramel|dip|sauce|seasoning|flavour|flavor)\b/;

  if (product.category === "paneer") return /\bpaneer\b/.test(text);
  if (product.category === "curd") return /\b(curd|dahi|yogurt|yoghurt)\b/.test(text);
  if (product.category === "milk") return /\bmilk\b/.test(text) && !/\b(milkshake|shake|chocolate|beverage|drink mix)\b/.test(text);
  if (product.category === "cheese") {
    return (
      /\b(cheese|cheddar|mozzarella|parmesan|gouda|processed cheese|cheese slice|cheese spread|cheese cube|cheese block)\b/.test(
        text
      ) && !snackWords.test(text)
    );
  }

  return true;
}

async function fetchBigBasketCookieHeader(): Promise<string> {
  const response = await fetch("https://www.bigbasket.com/", {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-IN,en;q=0.9",
      "cache-control": "no-cache",
      "user-agent": browserUserAgent
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000)
  });

  const headers = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return headers.map((header) => header.split(";")[0]).filter(Boolean).join("; ");
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-IN,en;q=0.9",
        "cache-control": "no-cache",
        "user-agent": browserUserAgent,
        ...headers
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000)
    });

    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 4) throw new Error(`BigBasket returned ${response.status}`);

    const waitMs = attempt * 5000;
    console.log(`BigBasket rate limit hit; waiting ${waitMs}ms before retry ${attempt + 1}.`);
    await sleep(waitMs);
  }

  throw new Error("BigBasket request failed.");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function walkJson(value: unknown, visit: (item: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visit));
    return;
  }

  const record = value as Record<string, unknown>;
  visit(record);
  Object.values(record).forEach((item) => walkJson(item, visit));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function parsePrice(value: string): number | null {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const price = Number(match[1]);
  return Number.isFinite(price) ? price : null;
}

function resolveUrl(href: string, baseUrl: string): string {
  return new URL(href, baseUrl).toString();
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
