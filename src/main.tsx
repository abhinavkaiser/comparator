import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ArrowUpDown,
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShoppingBasket
} from "lucide-react";
import "./styles.css";

type StoreResult = {
  storeId: string;
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

type CompareResponse = {
  query: string;
  pincode?: string;
  bestStoreId?: string;
  results: StoreResult[];
};

type ProductRow = {
  id: number;
  category: string;
  source_store_id: string;
  source_product_id: string;
  brand: string;
  name: string;
  unit: string | null;
  product_url: string;
};

type PriceRow = {
  product_id: number;
  scrape_run_id: number;
  store_id: string;
  store_name: string;
  matched_name: string;
  price: number | null;
  mrp: number | null;
  unit: string | null;
  product_url: string | null;
  search_url: string;
  status: "live" | "demo" | "unavailable";
  note: string | null;
  checked_at: string;
};

const formatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

function App() {
  const [activeTab, setActiveTab] = useState<"compare" | "database">("compare");
  const [query, setQuery] = useState("Amul Taaza Homogenised Toned Milk");
  const [pincode, setPincode] = useState("560001");
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const best = useMemo(
    () => data?.results.find((result) => result.storeId === data.bestStoreId),
    [data]
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, pincode })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not compare prices.");
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="workspace">
        <div className="masthead">
          <div>
            <p className="eyebrow">Quick commerce price check</p>
            <h1>Compare product prices across instant delivery stores.</h1>
          </div>
          <div className="summary">
            <ShoppingBasket aria-hidden="true" />
            <span>5 stores</span>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Views">
          <button className={activeTab === "compare" ? "tab active" : "tab"} onClick={() => setActiveTab("compare")}>
            <ArrowUpDown aria-hidden="true" />
            Compare
          </button>
          <button className={activeTab === "database" ? "tab active" : "tab"} onClick={() => setActiveTab("database")}>
            <Database aria-hidden="true" />
            Database
          </button>
        </div>

        {activeTab === "compare" ? (
          <>
            <form className="search-panel" onSubmit={submit}>
              <label>
                <span>Product</span>
                <div className="input-wrap">
                  <Search aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search milk, bread, eggs..."
                  />
                </div>
              </label>
              <label>
                <span>Pincode</span>
                <div className="input-wrap small">
                  <MapPin aria-hidden="true" />
                  <input
                    value={pincode}
                    onChange={(event) => setPincode(event.target.value)}
                    inputMode="numeric"
                    placeholder="560001"
                  />
                </div>
              </label>
              <button disabled={loading || !query.trim()}>
                {loading ? <Loader2 className="spin" aria-hidden="true" /> : <ArrowUpDown aria-hidden="true" />}
                Compare
              </button>
            </form>

            {error && (
              <div className="notice error">
                <AlertCircle aria-hidden="true" />
                {error}
              </div>
            )}

            {best && (
              <section className="best-strip">
                <div>
                  <p>Best price</p>
                  <strong>{best.store}</strong>
                </div>
                <div className="best-price">{formatPrice(best.price)}</div>
                {best.productUrl ? (
                  <a href={best.productUrl} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden="true" />
                    Open
                  </a>
                ) : (
                  <span className="best-link-disabled">No exact URL</span>
                )}
              </section>
            )}

            <section className="results" aria-live="polite">
              <div className="table-head">
                <span>Store</span>
                <span>Price</span>
                <span>Delivery</span>
                <span>Status</span>
                <span>Product</span>
              </div>
              {(data?.results ?? initialRows).map((result) => (
                <article className={result.storeId === data?.bestStoreId ? "row best" : "row"} key={result.storeId}>
                  <div>
                    <strong>{result.store}</strong>
                    <span>{result.productName}</span>
                  </div>
                  <div className="price-cell">
                    <strong>{formatPrice(result.price)}</strong>
                    {result.mrp ? <span>MRP {formatPrice(result.mrp)}</span> : null}
                  </div>
                  <div>{result.deliveryEta ?? "Location needed"}</div>
                  <div className={`badge ${result.status}`}>
                    {result.status === "live" ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
                    {result.status}
                  </div>
                  {result.productUrl ? (
                    <a className="row-link" href={result.productUrl} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" />
                      Open item
                    </a>
                  ) : (
                    <span className="row-link disabled">Exact URL unavailable</span>
                  )}
                  {result.note ? <p className="note">{result.note}</p> : null}
                </article>
              ))}
            </section>
          </>
        ) : (
          <DatabaseView />
        )}
      </section>
    </main>
  );
}

function DatabaseView() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [productFilter, setProductFilter] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [dbError, setDbError] = useState("");

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const filteredProducts = useMemo(() => {
    const term = productFilter.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      [product.category, product.brand, product.name, product.unit ?? ""].join(" ").toLowerCase().includes(term)
    );
  }, [productFilter, products]);

  async function loadProducts() {
    setLoadingProducts(true);
    setDbError("");
    try {
      const response = await fetch("/api/products?limit=300");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load products.");
      const nextProducts: ProductRow[] = payload.products ?? [];
      setProducts(nextProducts);
      setSelectedProductId((current) => current ?? nextProducts[0]?.id ?? null);
    } catch (caught) {
      setDbError(caught instanceof Error ? caught.message : "Could not load database.");
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadPrices(productId: number) {
    setLoadingPrices(true);
    setDbError("");
    try {
      const response = await fetch(`/api/products/${productId}/prices`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load prices.");
      setPrices(payload.prices ?? []);
    } catch (caught) {
      setDbError(caught instanceof Error ? caught.message : "Could not load prices.");
    } finally {
      setLoadingPrices(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (selectedProductId) loadPrices(selectedProductId);
  }, [selectedProductId]);

  return (
    <section className="db-panel">
      <div className="db-toolbar">
        <label>
          <span>Find Product</span>
          <div className="input-wrap">
            <Search aria-hidden="true" />
            <input
              value={productFilter}
              onChange={(event) => setProductFilter(event.target.value)}
              placeholder="Filter paneer, cheese, milk, curd..."
            />
          </div>
        </label>
        <button className="icon-button" onClick={loadProducts} disabled={loadingProducts}>
          {loadingProducts ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          Refresh
        </button>
      </div>

      {dbError && (
        <div className="notice error">
          <AlertCircle aria-hidden="true" />
          {dbError}
        </div>
      )}

      <div className="db-grid">
        <section className="product-list" aria-label="Products">
          <div className="db-section-head">
            <strong>Products</strong>
            <span>{filteredProducts.length} shown</span>
          </div>
          <div className="product-scroll">
            {filteredProducts.map((product) => (
              <button
                className={product.id === selectedProductId ? "product-item active" : "product-item"}
                key={product.id}
                onClick={() => setSelectedProductId(product.id)}
              >
                <strong>{product.name}</strong>
                <span>
                  {product.category} · {product.unit ?? "unit unknown"}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="price-list" aria-live="polite">
          <div className="db-section-head">
            <strong>{selectedProduct ? selectedProduct.name : "Prices"}</strong>
            <span>{loadingPrices ? "Loading..." : `${prices.length} rows`}</span>
          </div>
          <div className="price-table-head">
            <span>Store</span>
            <span>Price</span>
            <span>Status</span>
            <span>Matched Product</span>
          </div>
          <div className="price-scroll">
            {prices.map((price) => (
              <article className="price-row" key={`${price.scrape_run_id}-${price.store_id}`}>
                <strong>{price.store_name}</strong>
                <div className="price-cell">
                  <strong>{formatPrice(price.price)}</strong>
                  {price.mrp ? <span>MRP {formatPrice(price.mrp)}</span> : null}
                </div>
                <div className={`badge ${price.status}`}>
                  {price.status === "live" ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
                  {price.status}
                </div>
                <div className="matched-product">
                  <span>{price.matched_name}</span>
                  {price.product_url ? (
                    <a className="row-link" href={price.product_url} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" />
                      Open
                    </a>
                  ) : null}
                </div>
                {price.note ? <p className="note">{price.note}</p> : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

const initialRows: StoreResult[] = ["Blinkit", "Amazon Now", "Zepto", "BigBasket", "Flipkart Minutes"].map(
  (store) => ({
    storeId: store.toLowerCase().replace(/\s+/g, "-"),
    store,
    productName: "Run a comparison to load prices",
    price: null,
    productUrl: null,
    searchUrl: "#",
    status: "unavailable",
    checkedAt: new Date().toISOString()
  })
);

function formatPrice(price: number | null) {
  return typeof price === "number" ? formatter.format(price) : "Not found";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
