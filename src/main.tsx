import React, { FormEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ArrowUpDown,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
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

const storeUrlFields = [
  { id: "blinkit", label: "Blinkit URL" },
  { id: "amazon-now", label: "Amazon Now URL" },
  { id: "zepto", label: "Zepto URL" },
  { id: "big-basket", label: "BigBasket URL" },
  { id: "flipkart-minutes", label: "Flipkart Minutes URL" }
];

const formatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

function App() {
  const [query, setQuery] = useState("Amul Taaza Homogenised Toned Milk");
  const [pincode, setPincode] = useState("560001");
  const [exactUrls, setExactUrls] = useState<Record<string, string>>({
    blinkit: "",
    "amazon-now": "",
    zepto:
      "https://www.zepto.com/pn/amul-taaza-homogenised-toned-milk-tetra-pack/pvid/84eae511-5edb-4a22-875e-5aa94976c2d6",
    "big-basket": "",
    "flipkart-minutes": ""
  });
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
        body: JSON.stringify({ query, pincode, exactUrls })
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

        <section className="url-panel">
          {storeUrlFields.map((field) => (
            <label key={field.id}>
              <span>{field.label}</span>
              <div className="input-wrap">
                <ExternalLink aria-hidden="true" />
                <input
                  value={exactUrls[field.id] ?? ""}
                  onChange={(event) =>
                    setExactUrls((current) => ({ ...current, [field.id]: event.target.value }))
                  }
                  placeholder="Paste exact product URL"
                />
              </div>
            </label>
          ))}
        </section>

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
      </section>
    </main>
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
