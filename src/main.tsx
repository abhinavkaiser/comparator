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

type PriceCell = {
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

type ProductMatrixRow = ProductRow & {
  prices: Record<string, PriceCell | undefined>;
};

const catalogStores = [
  { id: "big-basket", name: "BigBasket" },
  { id: "blinkit", name: "Blinkit" },
  { id: "amazon-now", name: "Amazon Now" },
  { id: "zepto", name: "Zepto" },
  { id: "flipkart-minutes", name: "Flipkart Minutes" }
];

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
  const [products, setProducts] = useState<ProductMatrixRow[]>([]);
  const [productFilter, setProductFilter] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [dbError, setDbError] = useState("");

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
      const response = await fetch("/api/catalog-prices?limit=500");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load products.");
      setProducts(payload.products ?? []);
    } catch (caught) {
      setDbError(caught instanceof Error ? caught.message : "Could not load database.");
    } finally {
      setLoadingProducts(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

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

      <div className="matrix-wrap" aria-live="polite">
        <div className="matrix-head">
          <span>Product</span>
          {catalogStores.map((store) => (
            <span key={store.id}>{store.name}</span>
          ))}
        </div>
        <div className="matrix-scroll">
          {filteredProducts.map((product) => (
            <article className="matrix-row" key={product.id}>
              <div className="product-cell">
                <strong title={product.name}>{product.name}</strong>
                <span>
                  {product.category} · {product.unit ?? "unit unknown"}
                </span>
                <a href={product.product_url} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  BigBasket source
                </a>
              </div>
              {catalogStores.map((store) => (
                <PriceMatrixCell cell={product.prices[store.id]} key={store.id} />
              ))}
            </article>
          ))}
          {!loadingProducts && filteredProducts.length === 0 ? (
            <div className="empty-state">No products match that filter.</div>
          ) : null}
          {loadingProducts ? (
            <div className="empty-state">
              <Loader2 className="spin" aria-hidden="true" />
              Loading database prices...
            </div>
          ) : null}
        </div>
        <div className="matrix-foot">
          Showing {filteredProducts.length} products and {catalogStores.length} store columns.
        </div>
      </div>
    </section>
  );
}

function PriceMatrixCell({ cell }: { cell?: PriceCell }) {
  if (!cell) {
    return (
      <div className="store-cell pending">
        <strong>Not scraped</strong>
        <span>No row yet</span>
      </div>
    );
  }

  const isLive = cell.status === "live" && typeof cell.price === "number";

  return (
    <div className={isLive ? "store-cell live" : "store-cell unavailable"}>
      <div className="cell-top">
        <strong>{formatPrice(cell.price)}</strong>
        <span className={`mini-badge ${cell.status}`}>{cell.status}</span>
      </div>
      {cell.mrp ? <span>MRP {formatPrice(cell.mrp)}</span> : null}
      <span className="cell-match" title={cell.matched_name}>
        {cell.matched_name}
      </span>
      <div className="cell-actions">
        {cell.product_url ? (
          <a href={cell.product_url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            Open
          </a>
        ) : null}
        {cell.note ? <span title={cell.note}>Note</span> : null}
      </div>
    </div>
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
