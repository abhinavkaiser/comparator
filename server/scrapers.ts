import * as cheerio from "cheerio";
import { chromium } from "playwright";

type StoreId = "blinkit" | "amazon-now" | "zepto" | "big-basket" | "flipkart-minutes";

export type CompareRequest = {
  query: string;
  pincode?: string;
  exactUrls?: Partial<Record<StoreId, string>>;
};

export type StoreResult = {
  storeId: StoreId;
  store: string;
  productName: string;
  price: number | null;
  mrp?: number | null;
  unit?: string;
  deliveryEta?: string;
  productUrl: string | null;
  searchUrl: string;
  status: "live" | "demo" | "unavailable";
  note?: string;
  checkedAt: string;
};

export type CompareResponse = {
  query: string;
  pincode?: string;
  bestStoreId?: StoreId;
  results: StoreResult[];
};

type StoreConfig = {
  id: StoreId;
  name: string;
  searchUrl: (query: string, pincode?: string) => string;
  priceSelectors: string[];
  titleSelectors: string[];
  productLinkSelectors: string[];
  eta?: string;
};

const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const stores: StoreConfig[] = [
  {
    id: "blinkit",
    name: "Blinkit",
    searchUrl: (query) => `https://blinkit.com/s/?q=${encodeURIComponent(query)}`,
    priceSelectors: ["[data-test-id*='price']", "[class*='price']", "[class*='Price']"],
    titleSelectors: ["[data-test-id*='name']", "[class*='product']", "[class*='Product']"],
    productLinkSelectors: ["a[href*='/prn/']", "a[href*='/product/']", "a[href*='/p/']"],
    eta: "8-15 min"
  },
  {
    id: "amazon-now",
    name: "Amazon Now",
    searchUrl: (query) =>
      `https://www.amazon.in/s?k=${encodeURIComponent(query)}&s=nowstore&fpw=alm&almBrandId=ctnow`,
    priceSelectors: [".a-price-whole", ".a-price .a-offscreen", "[class*='price']"],
    titleSelectors: [".a-size-medium.a-color-base.a-text-normal", "h2", "[class*='title']"],
    productLinkSelectors: ["a.a-link-normal.s-no-outline[href*='/dp/']", "a[href*='/dp/']", "h2 a[href]"],
    eta: "10-25 min"
  },
  {
    id: "zepto",
    name: "Zepto",
    searchUrl: (query) => `https://www.zepto.com/search?query=${encodeURIComponent(query)}`,
    priceSelectors: ["[data-testid*='price']", "[class*='price']", "[class*='Price']"],
    titleSelectors: ["[data-testid*='name']", "[class*='name']", "[class*='Name']"],
    productLinkSelectors: ["a[href*='/pn/']", "a[href*='/product/']", "a[href*='/p/']"],
    eta: "6-12 min"
  },
  {
    id: "big-basket",
    name: "BigBasket",
    searchUrl: (query) => `https://www.bigbasket.com/ps/?q=${encodeURIComponent(query)}`,
    priceSelectors: ["[class*='Pricing']", "[class*='price']", "[class*='Price']"],
    titleSelectors: ["[class*='Description']", "[class*='product']", "[class*='Product']"],
    productLinkSelectors: ["a[href*='/pd/']", "a[href*='/product/']", "a[href*='/p/']"],
    eta: "15-30 min"
  },
  {
    id: "flipkart-minutes",
    name: "Flipkart Minutes",
    searchUrl: (query) => `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`,
    priceSelectors: ["[class*='price']", "[class*='Price']", "._30jeq3"],
    titleSelectors: ["[class*='title']", "[class*='Title']", "._4rR01T", ".s1Q9rs"],
    productLinkSelectors: ["a[href*='/p/']", "a[href*='pid=']", "a._1fQZEK", "a.s1Q9rs"],
    eta: "10-20 min"
  }
];

export async function comparePrices(request: CompareRequest): Promise<CompareResponse> {
  const settled = await Promise.allSettled(stores.map((store) => scrapeStore(store, request)));
  const results = settled.map((item, index) => {
    if (item.status === "fulfilled") return item.value;
    return unavailableResult(stores[index], request, item.reason instanceof Error ? item.reason.message : undefined);
  });

  const liveWithPrice = results.filter((result) => result.status === "live" && typeof result.price === "number");
  const best = liveWithPrice.reduce<StoreResult | undefined>((current, result) => {
    if (!current || Number(result.price) < Number(current.price)) return result;
    return current;
  }, undefined);

  return {
    query: request.query,
    pincode: request.pincode,
    bestStoreId: best?.storeId,
    results: results.sort((a, b) => Number(a.price ?? Infinity) - Number(b.price ?? Infinity))
  };
}

async function scrapeStore(store: StoreConfig, request: CompareRequest): Promise<StoreResult> {
  const searchUrl = store.searchUrl(request.query, request.pincode);
  const exactUrl = normalizeStoreUrl(request.exactUrls?.[store.id], store) ?? normalizeStoreUrl(request.query, store);

  if (exactUrl) {
    if (store.id === "blinkit") {
      return scrapeBlinkitProductWithBrowser(store, request, searchUrl, exactUrl);
    }

    if (store.id === "amazon-now") {
      return scrapeAmazonProductWithBrowser(store, request, searchUrl, exactUrl);
    }

    if (store.id === "flipkart-minutes") {
      return scrapeFlipkartProductWithBrowser(store, request, searchUrl, exactUrl);
    }

    const html = await fetchHtml(exactUrl);
    const live = parseProductFromHtml(html, store, request, searchUrl, exactUrl);
    return live.price !== null
      ? { ...live, status: "live", productUrl: live.productUrl ?? exactUrl }
      : unavailableResult(store, request, "Exact product page was readable, but no price was exposed.", exactUrl);
  }

  if (store.id === "blinkit") {
    return scrapeBlinkitSearchWithBrowser(store, request, searchUrl);
  }

  if (store.id === "amazon-now") {
    return scrapeAmazonSearchWithBrowser(store, request, searchUrl);
  }

  if (store.id === "flipkart-minutes") {
    return scrapeFlipkartSearchWithBrowser(store, request, searchUrl);
  }

  if (store.id === "big-basket") {
    const listingResult = await scrapeBigBasketListing(store, request, searchUrl);
    if (listingResult.price !== null && listingResult.productUrl) return listingResult;
  }

  if (store.id === "zepto") {
    const searchResult = await scrapeZeptoSearchWithBrowser(store, request, searchUrl);
    if (searchResult.price !== null && searchResult.productUrl) return searchResult;

    const serverResult = await scrapeZeptoSearch(store, request, searchUrl);
    if (serverResult.price !== null && serverResult.productUrl) return serverResult;
    return searchResult;
  }

  const html = await fetchHtml(searchUrl);
  const live = parseProductFromHtml(html, store, request, searchUrl);

  if (live.price !== null && live.productUrl) return live;
  return unavailableResult(store, request, "No exact product URL and price could be resolved from the store page.");
}

async function scrapeBlinkitSearchWithBrowser(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string
): Promise<StoreResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: browserUserAgent });
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3500);

    const products = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[role="button"][id]'))
        .filter((element) => /^\d+$/.test(element.id))
        .map((element) => {
          const lines = (element.innerText || "")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const priceLine = lines.find((line) => /^₹\d/.test(line));
          const priceIndex = priceLine ? lines.indexOf(priceLine) : -1;
          const unit = priceIndex > 0 ? lines[priceIndex - 1] : "";
          const name = priceIndex > 1 ? lines[priceIndex - 2] : lines.find((line) => !/mins?|add|off|₹/i.test(line)) ?? "";

          return {
            id: element.id,
            name,
            unit,
            priceText: priceLine ?? "",
            text: lines.join(" ")
          };
        });

      return cards;
    });

    const product = products
      .map((item) => ({ ...item, score: productMatchScore(item.name, request.query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0];

    if (!product?.id || !product.name || !product.priceText) {
      return unavailableResult(store, request, "Blinkit search did not expose a matching product card in browser data.");
    }

    const productUrl = `https://blinkit.com/prn/${slugify(product.name)}/prid/${product.id}`;
    const price = parsePrice(product.priceText);

    return {
      storeId: store.id,
      store: store.name,
      productName: product.name,
      price,
      mrp: null,
      unit: product.unit || inferUnit(product.name),
      deliveryEta: store.eta,
      productUrl,
      searchUrl,
      status: price === null ? "unavailable" : "live",
      note: price === null ? "Blinkit product card did not expose a price." : undefined,
      checkedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

async function scrapeBlinkitProductWithBrowser(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string,
  productUrl: string
): Promise<StoreResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: browserUserAgent });
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    const product = await page.evaluate(() => {
      const title = document.title.replace(/\s+Price\s+-\s+Buy.*$/i, "").trim();
      const text = document.body.innerText || "";
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const titleIndex = lines.findIndex((line) => title && line.toLowerCase() === title.toLowerCase());
      const priceLine = titleIndex >= 0 ? lines.slice(titleIndex).find((line) => /^₹\d/.test(line)) : lines.find((line) => /^₹\d/.test(line));
      const priceIndex = priceLine ? lines.indexOf(priceLine) : -1;
      const unit = priceIndex > 0 ? lines[priceIndex - 1] : "";

      return {
        name: title || (titleIndex >= 0 ? lines[titleIndex] : ""),
        unit,
        priceText: priceLine ?? ""
      };
    });

    const price = parsePrice(product.priceText);

    return {
      storeId: store.id,
      store: store.name,
      productName: product.name || stripUrl(request.query),
      price,
      mrp: null,
      unit: product.unit || inferUnit(product.name),
      deliveryEta: store.eta,
      productUrl,
      searchUrl,
      status: price === null ? "unavailable" : "live",
      note: price === null ? "Blinkit product page did not expose a price in browser data." : undefined,
      checkedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

async function scrapeAmazonSearchWithBrowser(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string
): Promise<StoreResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: browserUserAgent });
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);

    const products = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('[data-component-type="s-search-result"][data-asin]'))
        .map((element) => {
          const asin = element.getAttribute("data-asin") ?? "";
          const link = element.querySelector<HTMLAnchorElement>('a[href*="/dp/"]');
          const title =
            element.querySelector<HTMLElement>("h2 span")?.innerText.trim() ||
            element.querySelector<HTMLElement>("h2")?.innerText.trim() ||
            element.querySelector<HTMLElement>(".a-size-base-plus")?.innerText.trim() ||
            "";
          const priceText =
            element.querySelector<HTMLElement>(".a-price .a-offscreen")?.innerText.trim() ||
            element.querySelector<HTMLElement>(".a-price-whole")?.innerText.trim() ||
            "";
          const text = (element.innerText || "").replace(/\s+/g, " ").trim();

          return { asin, title, priceText, href: link?.href ?? "", text };
        })
        .filter((product) => product.asin && (product.title || product.text));
    });

    const product = products
      .map((item) => ({ ...item, score: productMatchScore(`${item.title} ${item.text}`, request.query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (!product) {
      return unavailableResult(store, request, "Amazon search did not return a sufficiently matching product.");
    }

    const productUrl = resolveAmazonProductUrl(product.href, product.asin);
    const price = parsePrice(product.priceText);

    if (price === null || !productUrl) {
      return productUrl
        ? unavailableProductResult(store, request, searchUrl, extractAmazonCardName(product.text, product.title || request.query), productUrl, "Amazon found the product URL, but no live buy-box price was exposed.")
        : unavailableResult(store, request, "Amazon found a matching product card, but no exact product URL was exposed.");
    }

    return {
      storeId: store.id,
      store: store.name,
      productName: extractAmazonCardName(product.text, product.title),
      price,
      mrp: null,
      unit: inferUnit(product.title || product.text),
      deliveryEta: store.eta,
      productUrl,
      searchUrl,
      status: "live",
      checkedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

async function scrapeAmazonProductWithBrowser(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string,
  productUrl: string
): Promise<StoreResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: browserUserAgent });
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    const product = await page.evaluate(() => {
      const scopedSelectors = [
        "#corePrice_feature_div .a-price .a-offscreen",
        "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
        "#apex_desktop .a-price .a-offscreen",
        "#desktop_buybox .a-price .a-offscreen",
        "#buybox .a-price .a-offscreen",
        "#priceblock_ourprice",
        "#priceblock_dealprice"
      ];
      const priceText =
        scopedSelectors
          .map((selector) => document.querySelector<HTMLElement>(selector)?.innerText.trim() ?? "")
          .find(Boolean) ?? "";

      return {
        name: document.querySelector<HTMLElement>("#productTitle")?.innerText.trim() || document.title.replace(/\s*:\s*Amazon\.in.*$/i, "").trim(),
        priceText
      };
    });

    const canonicalUrl = normalizeAmazonDpUrl(productUrl) ?? productUrl;
    const price = parsePrice(product.priceText);
    if (price === null) {
      return unavailableProductResult(store, request, searchUrl, product.name || request.query, canonicalUrl, "Amazon product page did not expose a live buy-box price.");
    }

    return {
      storeId: store.id,
      store: store.name,
      productName: cleanAmazonTitle(product.name || request.query),
      price,
      mrp: null,
      unit: inferUnit(product.name || request.query),
      deliveryEta: store.eta,
      productUrl: canonicalUrl,
      searchUrl,
      status: "live",
      checkedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

async function scrapeFlipkartSearchWithBrowser(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string
): Promise<StoreResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: browserUserAgent });
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);

    const products = await page.evaluate(() => {
      const grouped = new Map<string, { pid: string; href: string; texts: string[] }>();

      Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"][href*="pid="]')).forEach((link) => {
        const url = new URL(link.href);
        const pid = url.searchParams.get("pid") ?? "";
        if (!pid) return;

        const existing = grouped.get(pid) ?? { pid, href: link.href, texts: [] };
        const text = (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim();
        if (text) existing.texts.push(text);
        grouped.set(pid, existing);
      });

      return Array.from(grouped.values()).map((item) => {
        const title =
          item.texts.find((text) => !/^currently unavailable$/i.test(text) && !/^₹/.test(text) && /[a-z]/i.test(text)) ?? "";
        const priceText = item.texts.find((text) => /^₹\s*[\d,]+(?:\.\d{1,2})?/.test(text)) ?? "";
        return {
          pid: item.pid,
          title,
          href: item.href,
          priceText,
          text: item.texts.join(" ")
        };
      });
    });

    const product = products
      .map((item) => ({ ...item, score: productMatchScore(item.title || item.text, request.query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (!product) {
      return unavailableResult(store, request, "Flipkart search did not return a sufficiently matching product.");
    }

    const productUrl = normalizeFlipkartProductUrl(product.href);
    const price = parsePrice(product.priceText);
    if (price === null || !productUrl) {
      return productUrl
        ? unavailableProductResult(store, request, searchUrl, product.title || request.query, productUrl, "Flipkart found the product URL, but no live price was exposed.")
        : unavailableResult(store, request, "Flipkart found a matching product card, but no exact product URL was exposed.");
    }

    return {
      storeId: store.id,
      store: store.name,
      productName: cleanFlipkartTitle(product.title || product.text),
      price,
      mrp: null,
      unit: inferUnit(product.title || product.text),
      deliveryEta: store.eta,
      productUrl,
      searchUrl,
      status: "live",
      checkedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

async function scrapeFlipkartProductWithBrowser(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string,
  productUrl: string
): Promise<StoreResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: browserUserAgent });
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    const product = await page.evaluate(() => {
      const name =
        document.querySelector<HTMLElement>("h1 span")?.innerText.trim() ||
        document.querySelector<HTMLElement>("h1")?.innerText.trim() ||
        document.title.replace(/\s+Price\s+in\s+India.*$/i, "").trim();
      const anchors = Array.from(document.querySelectorAll<HTMLElement>("h1, [class], div, span"));
      const priceText =
        anchors
          .map((element) => element.innerText?.trim() ?? "")
          .filter((text) => /^₹\s*[\d,]+(?:\.\d{1,2})?$/.test(text))
          .find(Boolean) ?? "";

      return { name, priceText };
    });

    const canonicalUrl = normalizeFlipkartProductUrl(productUrl) ?? productUrl;
    const price = parsePrice(product.priceText);
    if (price === null) {
      return unavailableProductResult(store, request, searchUrl, product.name || request.query, canonicalUrl, "Flipkart product page did not expose a live product price.");
    }

    return {
      storeId: store.id,
      store: store.name,
      productName: product.name || request.query,
      price,
      mrp: null,
      unit: inferUnit(product.name || request.query),
      deliveryEta: store.eta,
      productUrl: canonicalUrl,
      searchUrl,
      status: "live",
      checkedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

async function scrapeZeptoSearchWithBrowser(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string
): Promise<StoreResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: browserUserAgent });
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);

    const products = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/pn/"][href*="/pvid/"]'))
        .map((link) => {
          const text = (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim();
          const prices = text.match(/₹\s*[\d,]+(?:\.\d{1,2})?/g) ?? [];
          const path = new URL(link.href).pathname;
          const slug = path.match(/\/pn\/([^/]+)\/pvid\//)?.[1] ?? "";
          return {
            text,
            slug,
            href: link.href,
            priceText: prices[0] ?? "",
            mrpText: prices[1] ?? ""
          };
        })
        .filter((product) => product.slug && product.priceText);
    });

    const product = products
      .map((item) => ({ ...item, name: titleFromSlug(item.slug), score: productMatchScore(titleFromSlug(item.slug), request.query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0];

    if (!product) {
      return unavailableResult(store, request, "Zepto search did not expose a matching product card in browser data.");
    }

    const price = parsePrice(product.priceText);
    return {
      storeId: store.id,
      store: store.name,
      productName: product.name,
      price,
      mrp: parsePrice(product.mrpText),
      unit: inferUnit(product.text),
      deliveryEta: store.eta,
      productUrl: product.href,
      searchUrl,
      status: price === null ? "unavailable" : "live",
      note: price === null ? "Zepto product card did not expose a price." : undefined,
      checkedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

async function scrapeZeptoSearch(store: StoreConfig, request: CompareRequest, searchUrl: string): Promise<StoreResult> {
  const html = await fetchHtml(searchUrl);
  const result = extractZeptoSearchProduct(html, request.query, searchUrl);

  if (!result.url || result.price === null) {
    return unavailableResult(store, request, "Zepto search did not return a matching product in server-rendered data.");
  }

  return {
    storeId: store.id,
    store: store.name,
    productName: result.name,
    price: result.price,
    mrp: result.mrp,
    unit: inferUnit(result.name),
    deliveryEta: store.eta,
    productUrl: result.url,
    searchUrl,
    status: "live",
    checkedAt: new Date().toISOString()
  };
}

async function scrapeBigBasketListing(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string
): Promise<StoreResult> {
  const shellHtml = await fetchHtml(searchUrl);
  const nextData = extractNextData(shellHtml);
  const cookie = cookieHeaderFromNextData(nextData) || (await fetchBigBasketCookieHeader());
  if (!cookie) return unavailableResult(store, request, "BigBasket did not provide listing session cookies.");

  const apiUrl = `https://www.bigbasket.com/listing-svc/v2/products?type=ps&slug=${encodeURIComponent(
    request.query
  )}&page=1`;
  const payload = await fetchJson(apiUrl, {
    cookie,
    "x-channel": "BB-WEB",
    "x-entry-context": "bb-b2c",
    "x-entry-context-id": "100",
    "osmos-enabled": "true"
  });

  let found = { name: "", price: null as number | null, url: null as string | null };
  walkJson(payload, (item) => {
    if (found.price !== null && found.url) return;
    const candidate = embeddedCandidateFromObject(item, store, searchUrl);
    if (!candidate.url || !candidate.name || !isLikelyProductMatch(candidate.name, request.query)) return;
    found = candidate;
  });

  if (!found.url || found.price === null) {
    return unavailableResult(store, request, "BigBasket listing API did not return a matching product.");
  }

  return {
    storeId: store.id,
    store: store.name,
    productName: found.name,
    price: found.price,
    mrp: null,
    unit: inferUnit(found.name),
    deliveryEta: store.eta,
    productUrl: found.url,
    searchUrl,
    status: "live",
    checkedAt: new Date().toISOString()
  };
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

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-IN,en;q=0.9",
      "cache-control": "no-cache",
      "user-agent": browserUserAgent
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`Store returned ${response.status}`);
  }

  return response.text();
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
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

  if (!response.ok) {
    throw new Error(`Store returned ${response.status}`);
  }

  return response.json();
}

function parseProductFromHtml(
  html: string,
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string,
  knownProductUrl?: string
): StoreResult {
  const $ = cheerio.load(html);
  const card = findLikelyProductCard($, store, request.query);
  const scope = card ?? $.root();
  const structured = extractStructuredProduct($);
  const embedded = extractEmbeddedProduct(html, store, request.query, searchUrl);
  const seo = extractSeoProduct($, searchUrl);
  const selectorPrice = firstTextFromScope($, scope, store.priceSelectors);
  const parsedPrice = structured.price ?? embedded.price ?? seo.price ?? parsePrice(selectorPrice);
  const productName =
    structured.name ||
    embedded.name ||
    seo.name ||
    cleanText(firstTextFromScope($, scope, store.titleSelectors)) ||
    `${request.query} at ${store.name}`;
  const price = isLikelyProductMatch(productName, request.query) || knownProductUrl ? parsedPrice : null;
  const productUrl = resolveProductUrl(
    structured.url ??
      embedded.url ??
      seo.url ??
      firstHrefFromScope($, scope, store.productLinkSelectors) ??
      knownProductUrl ??
      null,
    searchUrl
  );

  return {
    storeId: store.id,
    store: store.name,
    productName,
    price,
    mrp: null,
    unit: inferUnit(productName),
    deliveryEta: store.eta,
    productUrl,
    searchUrl,
    status: price === null || !productUrl ? "unavailable" : "live",
    checkedAt: new Date().toISOString()
  };
}

function extractStructuredProduct($: cheerio.CheerioAPI): { name: string; price: number | null; url: string | null } {
  const microdata = extractMicrodataProduct($);
  const jsonLd = extractJsonLdProduct($);

  return {
    name: microdata.name || jsonLd.name,
    price: microdata.price ?? jsonLd.price,
    url: microdata.url ?? jsonLd.url
  };
}

function extractSeoProduct($: cheerio.CheerioAPI, baseUrl: string): { name: string; price: number | null; url: string | null } {
  const title = cleanText($("title").first().text());
  const description = cleanText($("meta[name='description']").attr("content") ?? "");
  const canonical = $("link[rel='canonical']").attr("href") ?? null;
  const priceText = [title, description].join(" ");
  const name = title
    .replace(/\s+Online\s+at\s+the\s+Best\s+Price.*$/i, "")
    .replace(/\s+-\s+bigbasket.*$/i, "")
    .replace(/\s+-\s+Zepto.*$/i, "")
    .replace(/^Buy\s+/i, "")
    .trim();

  return {
    name,
    price: parsePrice(priceText),
    url: resolveProductUrl(canonical, baseUrl)
  };
}

function extractEmbeddedProduct(
  html: string,
  store: StoreConfig,
  query: string,
  baseUrl: string
): { name: string; price: number | null; url: string | null } {
  const nextData = extractNextData(html);
  if (!nextData) return { name: "", price: null, url: null };

  let found = { name: "", price: null as number | null, url: null as string | null };

  walkJson(nextData, (item) => {
    if (found.price !== null && found.url) return;
    const candidate = embeddedCandidateFromObject(item, store, baseUrl);
    if (!candidate.url || !candidate.name || !isLikelyProductMatch(candidate.name, query)) return;
    found = candidate;
  });

  return found;
}

function extractNextData(html: string): unknown | null {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function cookieHeaderFromNextData(nextData: unknown): string {
  if (!nextData || typeof nextData !== "object") return "";
  const pageProps = (nextData as Record<string, any>).props?.pageProps;
  const visitorCookies = pageProps?.visitorCookies;
  if (!visitorCookies || typeof visitorCookies !== "object") return "";

  return Object.entries(visitorCookies)
    .map(([key, value]) => `${key}=${String(value ?? "")}`)
    .join("; ");
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

function embeddedCandidateFromObject(
  item: Record<string, unknown>,
  store: StoreConfig,
  baseUrl: string
): { name: string; price: number | null; url: string | null } {
  if (store.id === "big-basket") {
    const absoluteUrl = typeof item.absolute_url === "string" ? item.absolute_url : "";
    const brand = item.brand && typeof item.brand === "object" ? (item.brand as Record<string, unknown>) : {};
    const brandName = typeof brand.name === "string" ? brand.name : "";
    const desc = typeof item.desc === "string" ? item.desc : "";
    const weight = typeof item.w === "string" ? item.w : "";
    const pricing = item.pricing && typeof item.pricing === "object" ? (item.pricing as Record<string, unknown>) : {};
    const discount =
      pricing.discount && typeof pricing.discount === "object" ? (pricing.discount as Record<string, unknown>) : {};
    const primaryPrice =
      discount.prim_price && typeof discount.prim_price === "object"
        ? (discount.prim_price as Record<string, unknown>)
        : {};
    const sp = typeof primaryPrice.sp === "string" || typeof primaryPrice.sp === "number" ? String(primaryPrice.sp) : "";

    return {
      name: cleanText(`${brandName} ${desc} ${weight}`),
      price: parsePrice(sp),
      url: resolveProductUrl(absoluteUrl, baseUrl)
    };
  }

  return { name: "", price: null, url: null };
}

function extractZeptoSearchProduct(
  html: string,
  query: string,
  searchUrl: string
): { name: string; price: number | null; mrp: number | null; url: string | null } {
  const decoded = html.replace(/\\"/g, '"').replace(/\\u0026/g, "&").replace(/\\n/g, " ");
  const cards = decoded.split('"cardData":').slice(1);

  for (const card of cards) {
    const chunk = card.slice(0, 12000);
    const productName = firstRegex(chunk, /"product":\{[\s\S]*?"name":"([^"]+)"/);
    const variantId = firstRegex(chunk, /"productVariant":\{[\s\S]*?"id":"([^"]+)"/);
    const productId = firstRegex(chunk, /"product":\{[\s\S]*?"id":"([^"]+)"/);
    const pricePaise = firstRegex(chunk, /"discountedSellingPrice":(\d+)/) ?? firstRegex(chunk, /"sellingPrice":(\d+)/);
    const mrpPaise = firstRegex(chunk, /"mrp":(\d+)/);

    if (!productName || !variantId || !isLikelyProductMatch(productName, query)) continue;

    const slug = slugify(productName);
    const url = resolveProductUrl(`/pn/${slug}/pvid/${variantId}`, searchUrl);
    return {
      name: productName,
      price: paiseToRupees(pricePaise),
      mrp: paiseToRupees(mrpPaise),
      url: url ?? (productId ? resolveProductUrl(`/pn/${slug}/pvid/${variantId}`, searchUrl) : null)
    };
  }

  return { name: "", price: null, mrp: null, url: null };
}

function firstRegex(value: string, pattern: RegExp): string | null {
  return value.match(pattern)?.[1] ?? null;
}

function paiseToRupees(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function extractMicrodataProduct($: cheerio.CheerioAPI): { name: string; price: number | null; url: string | null } {
  const product = $("[itemscope][itemtype*='Product']").first();
  if (!product.length) return { name: "", price: null, url: null };

  const readItemProp = (prop: string) => {
    const element = product.find(`[itemprop='${prop}']`).first();
    return cleanText(element.attr("content") ?? element.attr("href") ?? element.text());
  };

  return {
    name: readItemProp("name"),
    price: parsePrice(readItemProp("price")),
    url: readItemProp("url") || null
  };
}

function extractJsonLdProduct($: cheerio.CheerioAPI): { name: string; price: number | null; url: string | null } {
  let found = { name: "", price: null as number | null, url: null as string | null };

  $("script[type='application/ld+json']").each((_index, script) => {
    if (found.price !== null && found.url) return;
    const text = $(script).text();
    try {
      const parsed = JSON.parse(text);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        const offer = item.offers;
        const price = Array.isArray(offer) ? offer[0]?.price : offer?.price;
        const parsedPrice = parsePrice(String(price ?? ""));
        if (!found.name && typeof item.name === "string") found.name = item.name;
        if (!found.url && typeof item.url === "string") found.url = item.url;
        if (parsedPrice !== null) found.price = parsedPrice;
        queue.push(...Object.values(item).filter((value) => value && typeof value === "object"));
      }
    } catch {
      // Some stores embed partial JSON fragments. Selector parsing below still gets a chance.
    }
  });

  return found;
}

function normalizeStoreUrl(value: string | undefined, store: StoreConfig): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (!isStoreUrl(url, store.id)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isStoreUrl(url: URL, storeId: StoreId): boolean {
  const host = url.hostname.replace(/^www\./, "");
  if (storeId === "blinkit") return host.includes("blinkit.com");
  if (storeId === "amazon-now") return host.includes("amazon.in");
  if (storeId === "zepto") return host.includes("zepto.com") || host.includes("zeptonow.com");
  if (storeId === "big-basket") return host.includes("bigbasket.com");
  if (storeId === "flipkart-minutes") return host.includes("flipkart.com");
  return false;
}

function findLikelyProductCard($: cheerio.CheerioAPI, store: StoreConfig, query: string): cheerio.Cheerio<any> | null {
  const candidates = store.productLinkSelectors.flatMap((selector) => $(selector).toArray());

  for (const element of candidates) {
    const link = $(element);
    const card =
      link.closest("article, li, [data-component-type='s-search-result'], [data-asin], [class*='product'], [class*='Product'], [class*='item'], [class*='Item']") ??
      link.parent();
    const text = cleanText(card.text() || link.text());
    if (isLikelyProductMatch(text, query)) return card;
  }

  return null;
}

function firstTextFromScope($: cheerio.CheerioAPI, scope: cheerio.Cheerio<any>, selectors: string[]): string {
  for (const selector of selectors) {
    const value = scope
      .find(selector)
      .toArray()
      .map((element) => cleanText($(element).text()))
      .find(Boolean);
    if (value) return value;
  }
  return "";
}

function firstHrefFromScope(
  $: cheerio.CheerioAPI,
  scope: cheerio.Cheerio<any>,
  selectors: string[]
): string | null {
  for (const selector of selectors) {
    const href = scope
      .find(selector)
      .toArray()
      .map((element) => $(element).attr("href"))
      .find(Boolean);
    if (href) return href;
  }
  return null;
}

function resolveProductUrl(href: string | null, baseUrl: string): string | null {
  if (!href || href === "#") return null;
  try {
    const resolved = new URL(href, baseUrl);
    resolved.hash = "";

    if (resolved.hostname.includes("amazon.in")) {
      const dpMatch = resolved.pathname.match(/\/(?:[^/]+\/)?dp\/([A-Z0-9]{10})/i);
      if (dpMatch) return `https://www.amazon.in/dp/${dpMatch[1]}`;
    }

    return resolved.toString();
  } catch {
    return null;
  }
}

function resolveAmazonProductUrl(href: string, asin: string): string | null {
  const normalized = normalizeAmazonDpUrl(href);
  if (normalized) return normalized;
  return asin ? `https://www.amazon.in/dp/${asin}` : null;
}

function normalizeAmazonDpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const decodedRedirect = url.searchParams.get("url");
    if (decodedRedirect) return normalizeAmazonDpUrl(new URL(decodedRedirect, "https://www.amazon.in").toString());

    const match = url.pathname.match(/\/(?:[^/]+\/)?dp\/([A-Z0-9]{10})/i);
    return match ? `https://www.amazon.in/dp/${match[1]}` : null;
  } catch {
    return null;
  }
}

function normalizeFlipkartProductUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const pid = url.searchParams.get("pid");
    const match = url.pathname.match(/^(.+?\/p\/[^/?]+)/i);
    if (!match) return null;
    const normalized = new URL(match[1], "https://www.flipkart.com");
    if (pid) normalized.searchParams.set("pid", pid);
    return normalized.toString();
  } catch {
    return null;
  }
}

function cleanAmazonTitle(value: string): string {
  return cleanText(value.replace(/^Sponsored\s*/i, "").replace(/Price,\s*product page.*$/i, ""));
}

function extractAmazonCardName(text: string, fallback: string): string {
  const withoutPrice = text.replace(/\s+Price,\s*product page.*$/i, "");
  const withoutRating = withoutPrice.replace(/\s+\d(?:\.\d)?\s+\d(?:\.\d)?\s+out\s+of\s+5\s+stars.*$/i, "");
  const withoutAvailability = withoutRating.replace(/\s+\d+[A-Z+]*\s+bought\s+in\s+past\s+month.*$/i, "");
  return cleanAmazonTitle(withoutAvailability || fallback);
}

function cleanFlipkartTitle(value: string): string {
  const priceIndex = value.search(/₹\s*[\d,]+/);
  return cleanText(priceIndex >= 0 ? value.slice(0, priceIndex) : value)
    .replace(/\s+\d(?:\.\d)?\(\d[\d,]*\).*$/i, "")
    .trim();
}

function parsePrice(value: string): number | null {
  const match = value.replace(/,/g, "").match(/(?:₹|Rs\.?\s*)\s*(\d+(?:\.\d{1,2})?)/i) ?? value.match(/^(\d+(?:\.\d{1,2})?)$/);
  if (!match) return null;
  const price = Number(match[1]);
  return Number.isFinite(price) ? price : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferUnit(value: string): string | undefined {
  return value.match(/\b\d+\s?(?:g|kg|ml|l|pcs|pack|piece)\b/i)?.[0];
}

function isLikelyProductMatch(productName: string, query: string): boolean {
  const ignored = new Set(["the", "and", "for", "with", "pack"]);
  const title = productName.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !ignored.has(token));

  if (productName.length < 8 || /^(skip to|menu|search|login|cart)$/i.test(productName)) {
    return false;
  }

  if (!tokens.length) return true;
  return tokens.some((token) => title.includes(token));
}

function isStrongProductMatch(productName: string, query: string): boolean {
  if (productMatchScore(productName, query) >= 50) return true;

  const ignored = new Set(["the", "and", "for", "with", "pack", "of", "no"]);
  const title = cleanText(productName).toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !ignored.has(token));

  if (title.length < 8 || !tokens.length) return false;

  const matched = tokens.filter((token) => title.includes(token));
  const required = Math.min(tokens.length, Math.max(2, Math.ceil(tokens.length * 0.55)));
  return matched.length >= required;
}

function productMatchScore(productName: string, query: string): number {
  const title = cleanText(productName).toLowerCase();
  const normalizedQuery = cleanText(query).toLowerCase();
  const tokens = normalizedQuery.split(/[^a-z0-9]+/).filter((token) => token.length > 2);

  if (!title || !tokens.length) return 0;
  if (title === normalizedQuery) return 120;

  if (tokens.length === 1) {
    const token = tokens[0];
    const word = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    if (!word.test(title)) return 0;

    let score = 50;
    if (title.startsWith(`${token} `) || title.startsWith(token)) score += 35;
    if (title.endsWith(` ${token}`) || title.endsWith(token)) score += 25;
    if (token === "banana" && /\brobusta\b/i.test(title)) score += 35;
    if (/\bfresh\b/i.test(title)) score += 15;
    if (
      /\b(chips|cookies?|biscuit|juice|cake|mix|snack|powder|flavour|flavored|dried|dry|dehydrated|storage|container|box|case|lunch|travel|plastic|holder)\b/i.test(
        title
      )
    ) {
      score -= 45;
    }
    return score;
  }

  const matched = tokens.filter((token) => title.includes(token)).length;
  return Math.round((matched / tokens.length) * 100);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unavailableProductResult(
  store: StoreConfig,
  request: CompareRequest,
  searchUrl: string,
  productName: string,
  productUrl: string,
  reason: string
): StoreResult {
  return {
    storeId: store.id,
    store: store.name,
    productName: cleanText(productName) || `${titleCase(stripUrl(request.query))} (${request.pincode || "local"} availability)`,
    price: null,
    mrp: null,
    unit: inferUnit(productName || request.query) ?? "1 pack",
    deliveryEta: store.eta,
    productUrl,
    searchUrl,
    status: "unavailable",
    note: reason,
    checkedAt: new Date().toISOString()
  };
}

function unavailableResult(store: StoreConfig, request: CompareRequest, reason?: string, productUrl?: string): StoreResult {
  return {
    storeId: store.id,
    store: store.name,
    productName: `${titleCase(stripUrl(request.query))} (${request.pincode || "local"} availability)`,
    price: null,
    mrp: null,
    unit: inferUnit(request.query) ?? "1 pack",
    deliveryEta: store.eta,
    productUrl: productUrl ?? null,
    searchUrl: store.searchUrl(request.query, request.pincode),
    status: "unavailable",
    note: reason ?? "Exact live price is unavailable for this store.",
    checkedAt: new Date().toISOString()
  };
}

function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function stripUrl(value: string): string {
  return value.startsWith("http") ? "Product URL" : value;
}
