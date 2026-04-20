# xirr-stocks

Single-page **US stock SIP return estimator** (USD or INR investor modes) with a small Node HTTP server. Historical prices and FX are loaded server-side (Yahoo Finance chart API, SEC ticker file, optional EXINUS CSV for pre-2003 INR).

## Run locally

```bash
npm install
npm start
```

Open `http://127.0.0.1:3000` (or the host/port shown in the console).

## Deploy on Railway

1. **Start command:** `npm start` (runs `node server.mjs`).
2. **Health check:** set the HTTP health check path to **`/api/health`**. The service returns `200` with JSON like `{ "ok": true, "service": "xirr-stocks" }`.
3. **HTTPS:** Railway terminates TLS. The app listens on **`PORT`** (set automatically). In production, the server binds to **`0.0.0.0`** unless you override **`HOST`**.
4. **Canonical URLs, sitemap, and Open Graph:** set **`PUBLIC_BASE_URL`** to your public origin **without a trailing slash**, e.g. `https://your-app.up.railway.app` or `https://yourdomain.com`. If unset, the server derives a URL from `X-Forwarded-Proto` / `X-Forwarded-Host` / `Host` (works behind Railway when proxies send standard headers).

### Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | Listen port (Railway provides this). |
| `NODE_ENV` | Use `production` for default `0.0.0.0` bind when `HOST` is unset. |
| `HOST` | Override bind address (default: `127.0.0.1` in dev, `0.0.0.0` in production). |
| `PUBLIC_BASE_URL` | Public site origin for canonical links, `robots.txt` / `sitemap.xml`, and HTML placeholders. |
| `EXINUS_CSV_PATH` | Optional path to monthly EXINUS CSV for INR mode before Yahoo’s USD/INR range. |
| `MAX_JSON_BODY_BYTES` | Cap for JSON POST bodies (default 256 KiB, capped at 10 MiB). |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Per-IP fixed-window limit for `/api/*` (set `RATE_LIMIT_MAX=0` to disable). |
| `LOG_LEVEL` | `error` / `warn` / `info` / `debug`. |
| `LOG_FILE` | Optional path to append logs. |

## Google Search (indexing)

1. Deploy with a stable **`PUBLIC_BASE_URL`** (or confirm forwarded host headers are correct).
2. Open [Google Search Console](https://search.google.com/search-console), add your property, and verify (DNS or HTML tag).
3. Submit **`https://<your-domain>/sitemap.xml`** (served dynamically; includes the homepage URL).
4. **`/robots.txt`** is generated at runtime and points crawlers at that sitemap.

Indexing and ranking are not guaranteed; this follows common crawling and sitemap practices.

## Development

```bash
npm test
```

## License

Private project (`"private": true` in `package.json`). Adjust as needed.
