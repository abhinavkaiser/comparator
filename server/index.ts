import express from "express";
import { openDatabase } from "./database.js";
import { comparePrices } from "./scrapers.js";

const app = express();
const port = Number(process.env.PORT ?? 4174);
const db = openDatabase();

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/compare", async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  const pincode = String(req.body?.pincode ?? "").trim();
  const exactUrls = typeof req.body?.exactUrls === "object" && req.body.exactUrls ? req.body.exactUrls : {};

  if (!query) {
    res.status(400).json({ error: "Product name is required." });
    return;
  }

  try {
    const results = await comparePrices({ query, pincode, exactUrls });
    res.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to compare prices.";
    res.status(500).json({ error: message });
  }
});

app.get("/api/products", (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json({ products: db.listProducts(limit) });
});

app.get("/api/products/:id/prices", (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isFinite(productId)) {
    res.status(400).json({ error: "Product id must be numeric." });
    return;
  }

  res.json({ prices: db.listPrices(productId) });
});

app.listen(port, () => {
  console.log(`Comparator API listening on http://localhost:${port}`);
});
