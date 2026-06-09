import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { StoreResult } from "./scrapers.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseHandle;
};

type DatabaseHandle = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
};

export type SeedProduct = {
  category: string;
  sourceStoreId: string;
  sourceProductId: string;
  brand: string;
  name: string;
  unit?: string;
  productUrl: string;
  imageUrl?: string;
  price: number | null;
  mrp: number | null;
};

export type ProductRow = {
  id: number;
  category: string;
  source_store_id: string;
  source_product_id: string;
  brand: string;
  name: string;
  unit: string | null;
  product_url: string;
};

export type ScrapeRun = {
  id: number;
  startedAt: string;
};

const defaultDbPath = path.join(process.cwd(), "data", "comparator.sqlite");

export function openDatabase(dbPath = process.env.DB_PATH || defaultDbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return new CatalogDatabase(db, dbPath);
}

function migrate(db: DatabaseHandle) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      source_store_id TEXT NOT NULL,
      source_product_id TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      unit TEXT,
      product_url TEXT NOT NULL,
      image_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_store_id, source_product_id)
    );

    CREATE TABLE IF NOT EXISTS scrape_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      categories TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS store_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      scrape_run_id INTEGER NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      matched_name TEXT NOT NULL,
      price REAL,
      mrp REAL,
      unit TEXT,
      product_url TEXT,
      search_url TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      checked_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, scrape_run_id, store_id)
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_store_prices_product ON store_prices(product_id);
    CREATE INDEX IF NOT EXISTS idx_store_prices_store ON store_prices(store_id);
  `);
}

export class CatalogDatabase {
  constructor(
    private readonly db: DatabaseHandle,
    readonly path: string
  ) {}

  upsertProduct(product: SeedProduct): number {
    this.db
      .prepare(
        `
        INSERT INTO products (
          category, source_store_id, source_product_id, brand, name, unit, product_url, image_url, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(source_store_id, source_product_id) DO UPDATE SET
          category = excluded.category,
          brand = excluded.brand,
          name = excluded.name,
          unit = excluded.unit,
          product_url = excluded.product_url,
          image_url = excluded.image_url,
          updated_at = CURRENT_TIMESTAMP
      `
      )
      .run(
        product.category,
        product.sourceStoreId,
        product.sourceProductId,
        product.brand,
        product.name,
        product.unit ?? null,
        product.productUrl,
        product.imageUrl ?? null
      );

    const row = this.db
      .prepare("SELECT id FROM products WHERE source_store_id = ? AND source_product_id = ?")
      .get(product.sourceStoreId, product.sourceProductId) as { id: number };
    return row.id;
  }

  listProducts(limit?: number): ProductRow[] {
    const sql = `
      SELECT id, category, source_store_id, source_product_id, brand, name, unit, product_url
      FROM products
      ORDER BY category, brand, name, unit
      ${limit ? "LIMIT ?" : ""}
    `;
    return this.db.prepare(sql).all(...(limit ? [limit] : [])) as ProductRow[];
  }

  listPrices(productId: number) {
    return this.db
      .prepare(
        `
        SELECT
          sp.product_id,
          sp.scrape_run_id,
          sp.store_id,
          sp.store_name,
          sp.matched_name,
          sp.price,
          sp.mrp,
          sp.unit,
          sp.product_url,
          sp.search_url,
          sp.status,
          sp.note,
          sp.checked_at
        FROM store_prices sp
        WHERE sp.product_id = ?
        ORDER BY sp.scrape_run_id DESC, sp.price IS NULL, sp.price ASC, sp.store_name
      `
      )
      .all(productId);
  }

  createRun(categories: string[]): ScrapeRun {
    const startedAt = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO scrape_runs (started_at, categories, status) VALUES (?, ?, ?)")
      .run(startedAt, categories.join(","), "running");
    return { id: Number(result.lastInsertRowid), startedAt };
  }

  finishRun(runId: number, status: "completed" | "failed", note?: string) {
    this.db
      .prepare("UPDATE scrape_runs SET finished_at = ?, status = ?, note = ? WHERE id = ?")
      .run(new Date().toISOString(), status, note ?? null, runId);
  }

  recordPrice(productId: number, runId: number, result: StoreResult) {
    this.db
      .prepare(
        `
        INSERT INTO store_prices (
          product_id, scrape_run_id, store_id, store_name, matched_name, price, mrp, unit,
          product_url, search_url, status, note, checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id, scrape_run_id, store_id) DO UPDATE SET
          store_name = excluded.store_name,
          matched_name = excluded.matched_name,
          price = excluded.price,
          mrp = excluded.mrp,
          unit = excluded.unit,
          product_url = excluded.product_url,
          search_url = excluded.search_url,
          status = excluded.status,
          note = excluded.note,
          checked_at = excluded.checked_at
      `
      )
      .run(
        productId,
        runId,
        result.storeId,
        result.store,
        result.productName,
        result.price,
        result.mrp ?? null,
        result.unit ?? null,
        result.productUrl,
        result.searchUrl,
        result.status,
        result.note ?? null,
        result.checkedAt
      );
  }

  count(table: "products" | "store_prices" | "scrape_runs"): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return row.count;
  }
}
