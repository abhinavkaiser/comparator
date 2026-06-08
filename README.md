# Quick Price Comparator

A local React + Express app for comparing product prices across:

- Blinkit
- Amazon Now
- Zepto
- BigBasket
- Flipkart Minutes

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Price Resolution

The API compares only live prices it can read from an exact product page or from a store page that exposes a matching product card.

If a store blocks server-side requests, requires login, or needs precise browser location/session data before rendering product cards, the app does not invent a price and does not use a search URL as a product URL. It marks that store as unavailable.

The comparison endpoint is:

```http
POST /api/compare
Content-Type: application/json

{
  "query": "Amul milk 1L",
  "pincode": "560001",
  "exactUrls": {
    "zepto": "https://www.zepto.com/pn/amul-taaza-homogenised-toned-milk-tetra-pack/pvid/84eae511-5edb-4a22-875e-5aa94976c2d6"
  }
}
```
