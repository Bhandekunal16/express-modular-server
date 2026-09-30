# Proxy Server

A lightweight Node.js project that runs a small Express API and a reverse proxy. It is designed for local development and learning how request forwarding works without adding a heavy framework or extra dependencies.

## Overview

This project contains two separate server entry points:

- `index.js` — runs the Express app (production entry)
- `proxy.js` — runs the HTTP reverse proxy

The app is configured with JSON files under the `json/` folder, which makes it easy to adjust the host and port values without changing code.

## Project Structure

```bash
.
├── index.js
├── proxy.js
├── createProxyServer.js  # test-only proxy factory
├── proxy/
│   ├── proxy.request.tracker.js
│   ├── proxy.timeout.handler.js
│   ├── proxy.error.handler.js
│   └── proxy.request.abort.handler.js
├── middleware.loader.js
├── jest.config.js
├── test/
│   ├── unit/
│   ├── integration/
│   ├── helpers/
│   │   ├── createExpressApp.js
│   │   └── createTestApp.js
│   ├── fixtures/
│   └── setup/
├── provider/
│   ├── dependency.map.js
│   ├── config.map.js
│   └── interceptor.map.js
├── architecture.md
├── package.json
├── package-lock.json
├── README.md
├── json/
│   ├── app.json
│   ├── config.json
│   ├── logger.config.json
│   ├── helmet.config.json
│   └── rate-limiting.config.json
├── core/
│   └── file.functions.js
├── layers/
│   ├── rate.limiting.layer.js
│   ├── request.id.layer.js
│   └── graceful.shutdown.layer.js
├── interceptors/
│   ├── cluster.interceptor.js
│   ├── encryption.interceptor.js
│   ├── error.interceptor.js
│   ├── helmet.interceptor.js
│   ├── logger.interceptor.js
│   └── response.interceptor.js
├── logs/
├── .gitignore
└── node_modules/
```

## Features

- Express server with CORS enabled
- JSON request parsing
- Simple root endpoint (`GET /`)
- 404 fallback response
- Reverse proxy using Node.js `http` module
- Optional error interceptor middleware
- Optional encryption interceptor middleware
- Optional request logging middleware
- Optional response summary logging (status, duration in milliseconds, content length)
- Optional Helmet-based security headers middleware
- Optional per-request `X-Request-ID` on the Express API (propagate or generate UUID)
- Optional per-IP rate limiting via a shared in-memory layer on the reverse proxy (JSON-tuned)
- Optional proxy upstream timeouts (504 Gateway Timeout) and client connection timeouts
- Graceful shutdown on `SIGTERM` / `SIGINT` for the proxy, Express workers, and cluster primary
- Optional worker clustering through Node.js `cluster` module
- Easy host/port configuration through JSON files

## Configuration

Settings live under `json/` on disk. At runtime,
[`provider/config.map.js`](provider/config.map.js) loads and exports a single object:

- spreads `json/config.json`, then `json/app.json`, then `json/rate-limiting.config.json`, then `json/logger.config.json` (later spreads override earlier keys on collision)
- attaches `json/helmet.config.json` as the `helmet` property (not spread, so Helmet options do not mix with top-level flags)

`index.js`, `proxy.js`, `middleware.loader.js`, and several interceptors/layers import from this module instead of requiring individual JSON files.

### `json/app.json`

```json
{
  "host": "0.0.0.0",
  "port": 3000,
  "proxyPort": 8080,
  "PROXY_TIMEOUT": 30000,
  "HEADERS_TIMEOUT": 10000,
  "KEEP_ALIVE_TIMEOUT": 5000,
  "SHUTDOWN_TIMEOUT": 10000
}
```

The values are used as follows:

- `host` — bind address for Express and the proxy listen socket (`server.listen`); outbound proxy requests use `127.0.0.1` when `host` is `0.0.0.0`
- `port` — Express app port (**upstream** target for `proxy.js`; must not be confused with `proxyPort`)
- `proxyPort` — reverse proxy **listen** port only (clients connect here; traffic is forwarded to `port`)
- `PROXY_TIMEOUT` — milliseconds used for upstream request/response socket timeouts when the matching flags in `json/config.json` are enabled
- `HEADERS_TIMEOUT` — `server.headersTimeout` on the proxy when `ENABLE_CLIENT_HEADERS_TIMEOUT` is true
- `KEEP_ALIVE_TIMEOUT` — `server.keepAliveTimeout` on the proxy when `ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT` is true
- `SHUTDOWN_TIMEOUT` — graceful shutdown deadline (ms) for the proxy, Express workers, and cluster primary coordination (`layers/graceful.shutdown.layer.js`)

The same file also holds encryption-related fields used by `interceptors/encryption.interceptor.js` (`secretKey`, `algorithm`, and related keys).

### `json/config.json`

```json
{
  "errorInterceptor": true,
  "encryption_Interceptor": true,
  "logger_interceptor": true,
  "clustering": true,
  "helmet_interceptor": true,
  "rateLimiting": true,
  "requestId": true,
  "response_interceptor": true,
  "ENABLE_UPSTREAM_REQUEST_TIMEOUT": true,
  "ENABLE_UPSTREAM_RESPONSE_TIMEOUT": true,
  "ENABLE_CLIENT_HEADERS_TIMEOUT": true,
  "ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT": true
}
```

- `errorInterceptor` — enables the custom error middleware from `interceptors/error.interceptor.js`
- `encryption_Interceptor` — enables the custom encryption middleware from `interceptors/encryption.interceptor.js`
- `logger_interceptor` — enables the request logger from `interceptors/logger.interceptor.js`
- `helmet_interceptor` — enables Helmet security headers via `interceptors/helmet.interceptor.js`
- `rateLimiting` — enables the shared rate limiter in `layers/rate.limiting.layer.js` on the reverse proxy (`proxy.js`) only; the Express app does not apply this limit
- `requestId` — enables request ID middleware from `layers/request.id.layer.js` on the Express app only
- `response_interceptor` — enables response summary logging from `interceptors/response.interceptor.js` on the Express app
- `clustering` — enables the Node.js cluster process manager, which forks worker processes and lets only the worker bind the Express server port
- `ENABLE_UPSTREAM_REQUEST_TIMEOUT` — when true, `proxy.js` (via `provider/config.map.js`) applies `PROXY_TIMEOUT` to the outbound upstream request; on timeout the proxy responds with **504** and destroys the upstream socket
- `ENABLE_UPSTREAM_RESPONSE_TIMEOUT` — when true, applies `PROXY_TIMEOUT` to the upstream response stream; on timeout responds with **504**
- `ENABLE_CLIENT_HEADERS_TIMEOUT` — when true, sets `server.headersTimeout` to `HEADERS_TIMEOUT` on the proxy
- `ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT` — when true, sets `server.keepAliveTimeout` to `KEEP_ALIVE_TIMEOUT` on the proxy

### Middleware loading

`middleware.loader.js` centralizes Express middleware setup. The exported
`middleware(app)` function registers optional request ID handling first when
`requestId` is enabled, then optional Helmet security headers when
`helmet_interceptor` is enabled (via `helmetInterceptor(app)`), then always
registers CORS and JSON request parsing, then registers the encryption and
logger interceptors when their respective configuration flags are enabled, then
the response logger when `response_interceptor` is enabled. Rate limiting is not
part of the Express middleware stack; it runs at the proxy edge in `proxy.js`
when `rateLimiting` is true. The exported
`errorMiddleware(app)` function registers the error interceptor only when
`errorInterceptor` is enabled.

The loader gets Express and CORS from `provider/dependency.map.js`, feature flags
from `provider/config.map.js`, and interceptor implementations from
`provider/interceptor.map.js`. `index.js` calls `middleware(app)` during app
setup and calls `errorMiddleware(app)` to register the configured error handler.

## Request Logging

The optional request logger is implemented in
`interceptors/logger.interceptor.js` and is enabled when
`logger_interceptor` is `true` in `json/config.json`. It logs request details
including the HTTP method and URL, route parameters, query values, protocol and
host, client IP information, request body, and headers. It then passes the
request to the next middleware; it does not log responses.

For correlation, logged entries include `requestId` resolved as
`req.requestId`, then the incoming `x-request-id` header, then `"N/A"` if
neither is present (for example when `requestId` is disabled in config but the
client still sends a header).

On the console, each entry is a single line prefixed with `request:` followed
by `JSON.stringify` of the log object. Lines written under `logs/` are raw JSON
without that prefix.

## Response logging

The optional response logger in `interceptors/response.interceptor.js` is enabled
with `response_interceptor: true` in `json/config.json`. It records a summary
when the response finishes (`res` `"finish"` event): the same `requestId`
resolution as the request logger, HTTP method, `originalUrl`, `statusCode`,
`durationMs` (numeric milliseconds via `performance` from `provider/dependency.map.js`),
and `contentLength` from `res.getHeader("content-length")`. It runs after the
request logger in `middleware.loader.js` and only on the Express API.

When `WRITE_L0G` is true (from `provider/config.map.js`, defined in
`json/logger.config.json`), each response summary is also appended as a JSON line
under `logs/`, using the same file helper as the request logger. The `exclude` array applies only to request logs, not these
response summaries.

On the console, each summary is prefixed with `response:` followed by
`JSON.stringify` of the summary object (file lines remain raw JSON).

## Helmet Security Headers

The project also supports a Helmet-based security interceptor. It is enabled via
`json/config.json` with `helmet_interceptor: true` and is implemented in
`interceptors/helmet.interceptor.js`.

When `helmet_interceptor` is enabled, `interceptors/helmet.interceptor.js` reads
the `helmet` object from `provider/config.map.js` (sourced from
`json/helmet.config.json`). If that object has no keys, Helmet defaults apply;
otherwise options such as `contentSecurityPolicy` and `crossOriginResourcePolicy`
are passed through to Helmet.

Example `json/helmet.config.json`:

```json
{
  "contentSecurityPolicy": false,
  "crossOriginResourcePolicy": {
    "policy": "cross-origin"
  }
}
```

## Request ID

Optional request correlation is controlled by `requestId` in `json/config.json`.
The middleware lives in `layers/request.id.layer.js` and is registered through
`provider/interceptor.map.js` as `requestIdInterceptor`.

When enabled:

- If the client sends `X-Request-ID`, that value is reused.
- Otherwise a new ID is generated with `crypto.randomUUID()`.
- The ID is stored on `req.requestId` and echoed on the response as `X-Request-ID`.

This runs on the **Express API** only (`middleware.loader.js`). The reverse
proxy does not run this layer; it forwards incoming headers as-is, so a client
`X-Request-ID` can still reach the backend when traffic goes through `proxy.js`.

## Rate limiting

Optional per-IP rate limiting is controlled by `rateLimiting` in
`json/config.json` (via `provider/config.map.js`). The logic lives in
`layers/rate.limiting.layer.js`: an in-memory counter per client IP
(`req.socket.remoteAddress`) using `windowMs` and `limit` from the same config map
(sourced from `json/rate-limiting.config.json`).

```json
{
  "windowMs": 900000,
  "limit": 100,
  "standardHeaders": true,
  "legacyHeaders": false
}
```

- `windowMs` — length of the rate-limit window in milliseconds (900000 = 15 minutes); **used by the layer**
- `limit` — maximum requests allowed per client IP within each window; **used by the layer**
- `standardHeaders` and `legacyHeaders` — reserved in JSON for forward compatibility; the current layer always sets `RateLimit-Limit` and `RateLimit-Remaining` and does not read these flags

When a client exceeds `limit` within `windowMs`, the layer ends the response with HTTP **429 Too Many Requests**, a `Retry-After` header (seconds until the window resets), and a JSON body:

```json
{
  "status": false,
  "statusCode": 429,
  "message": "Too Many Requests"
}
```

Rate limiting is an **edge / proxy** concern: `proxy.js` calls the layer before forwarding. If the layer returns `false`, the proxy responds with 429 and does not contact the backend. Traffic that reaches the Express app directly on `port` (bypassing the proxy) is not limited by this flag.

The proxy process keeps in-memory counters per client IP; limits are not shared across multiple proxy instances or with Express worker processes.

### File logging and excluded fields

`json/logger.config.json` defines `exclude` and `WRITE_L0G`; interceptors read
those fields from `provider/config.map.js`. That file controls file output for
both the request logger and the response logger, and which request properties are
omitted from the **request** logged object:

```json
{
  "exclude": ["params", "body"],
  "WRITE_L0G": true
}
```

`WRITE_L0G` (with a zero in `L0G`) enables appending each request log and each
response summary as a JSON line to a date-named text file under `logs/` (for
example, `logs/2026-09-29.txt`). The `logs/` directory is created automatically.
Set `WRITE_L0G` to `false` to disable file output; details are still sent to
the console.

Entries in `exclude` are request property names, such as `body`, `headers`,
`params`, or `query`. Excluded properties are removed before the request is
written to either the console or the log file. Choose exclusions carefully:
request bodies and headers may contain credentials, tokens, or other sensitive
data. The logger runs after JSON parsing and optional decryption, so an
unencrypted or successfully decrypted body can be logged unless excluded.

For real user data, disable the logger with `logger_interceptor` or exclude
sensitive properties in `json/logger.config.json`.

## Installation

Install dependencies:

```bash
npm install
```

## Run the Application

### Start the Express app

```bash
node index.js
```

This server listens on:

```bash
http://0.0.0.0:3000
```

Open:

```bash
http://localhost:3000/
```

Expected response:

```json
{ "message": "hello world" }
```

### Start the proxy server

```bash
node proxy.js
```

This server listens on:

```bash
http://0.0.0.0:8080
```

Requests sent to the proxy port are forwarded to the backend `host` and `port`
from `provider/config.map.js` (values defined in `json/app.json`).

## How the Proxy Works

[`proxy.js`](proxy.js) is the production entry point: it loads `provider/config.map.js`,
creates the HTTP server, wires `proxy/` helpers, listens on `proxyPort`, applies
client `headersTimeout` / `keepAliveTimeout`, and registers graceful shutdown.

[`createProxyServer.js`](createProxyServer.js) mirrors the proxy request handler for
automated tests only (integration tests bind ephemeral ports without starting `proxy.js`).

Integration tests build the app via [`test/helpers/createExpressApp.js`](test/helpers/createExpressApp.js)
and [`test/helpers/createTestApp.js`](test/helpers/createTestApp.js) (quieter middleware flags)
without starting [`index.js`](index.js).

1. Optional rate limiting (`layers/rate.limiting.layer.js`) on the **proxy listen port**; over-limit clients get **429** without forwarding. Limits are per client IP in the proxy process (restart the proxy to reset counters). Direct requests to Express on `port` are not rate-limited by this flag.
2. Forwards to **`port`** (API), not `proxyPort`, via `http.request` with the same method, path, and headers.
3. Each upstream `proxyReq` is tracked in a `Set` via [`proxy/proxy.request.tracker.js`](proxy/proxy.request.tracker.js) for graceful shutdown (`activeRequests`).
4. Upstream **504** handling when enabled: [`proxy/proxy.timeout.handler.js`](proxy/proxy.timeout.handler.js) (`updateRequestTimeout` / `updateResponseTimeout`).
5. Upstream connection errors → **502** via [`proxy/proxy.error.handler.js`](proxy/proxy.error.handler.js) (`sendBadGateway`).
6. Client abort/error handling: [`proxy/proxy.request.abort.handler.js`](proxy/proxy.request.abort.handler.js) destroys the upstream request when the client disconnects.
7. Streams the upstream response back to the client.

**Errors and timeouts**

| Condition | HTTP status | Body (typical) |
|-----------|-------------|----------------|
| Upstream connection error | 502 | `Bad Gateway` |
| Upstream request/response exceeds `PROXY_TIMEOUT` (when enabled) | 504 | `Gateway Timeout` |
| Client aborts, errors, or early `close` (`proxy.request.abort.handler`) | — | upstream `proxyReq` destroyed; no forced client response |
| Request received during graceful shutdown | 503 | `Service Unavailable` |
| Per-IP limit exceeded (`rateLimiting: true`) | 429 | JSON `Too Many Requests` (+ `Retry-After`) |

Optional `server.headersTimeout` and `server.keepAliveTimeout` apply to the client-facing proxy server when the `ENABLE_CLIENT_*` flags are true.

## Proxy timeouts

Timeout durations come from `json/app.json`; toggles are in `json/config.json`:

- **Upstream request** — `ENABLE_UPSTREAM_REQUEST_TIMEOUT` + `PROXY_TIMEOUT`
- **Upstream response** — `ENABLE_UPSTREAM_RESPONSE_TIMEOUT` + `PROXY_TIMEOUT`
- **Client headers** — `ENABLE_CLIENT_HEADERS_TIMEOUT` + `HEADERS_TIMEOUT`
- **Client keep-alive** — `ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT` + `KEEP_ALIVE_TIMEOUT`

Set any `ENABLE_*` flag to `false` to disable that behavior without changing millisecond values in `app.json`.

## Graceful shutdown

Both `proxy.js` and `index.js` handle `SIGTERM` / `SIGINT` through [`layers/graceful.shutdown.layer.js`](layers/graceful.shutdown.layer.js).

**Proxy:** stops accepting connections (`server.close()`), responds with **503** to new requests while draining, tracks active upstream `proxyReq` sockets, waits up to `SHUTDOWN_TIMEOUT`, then destroys remaining upstream requests and exits `1` on timeout or `0` when idle.

**Express (no cluster):** tracks in-flight responses, `server.close()`, waits for active requests, same timeout/exit behavior.

**Cluster primary:** does not listen for HTTP; on signal it sets `markClusterShuttingDown()` (no worker respawn), sends `shutdown` to each worker, waits for exits or forces `worker.kill()` after `SHUTDOWN_TIMEOUT`.

**Cluster workers:** same HTTP graceful shutdown as standalone Express; also start shutdown when the primary sends a `shutdown` IPC message.

Repeated signals during shutdown are ignored (idempotent).

Typical log lines include `SIGTERM received. Starting graceful shutdown...`, `Proxy: stopping new requests`, `Proxy: waiting for active requests`, `Express worker: shutdown started`, `Cluster primary: shutting down workers`, and `shutdown complete` or `shutdown timeout`.

To test locally, start `node proxy.js` or `node index.js` and run `kill -SIGTERM <pid>` (or press Ctrl+C for `SIGINT`). Deployments should signal the **proxy** and **Express** processes separately because they are separate entry points.

## Error Handling

The project includes an error interceptor at:

```bash
interceptors/error.interceptor.js
```

It is activated when `json/config.json` includes:

```json
{
  "errorInterceptor": true
}
```

## Clustering

The app can run with Node.js process clustering enabled via `json/config.json`:

```json
{
  "clustering": true
}
```

When clustering is enabled:

- the primary process acts as a supervisor
- it forks worker processes based on the available CPU count
- a worker restarts itself if it exits unexpectedly (unless intentional shutdown is in progress via `markClusterShuttingDown()`)
- only the worker process binds the Express server port and handles incoming HTTP traffic
- the primary coordinates graceful shutdown and does not serve HTTP (see **Graceful shutdown**)

This pattern improves concurrency and can help distribute work across CPU cores for local performance testing.

## Encryption and Security Status

This project includes an optional encryption interceptor, which can be enabled through the config file.

### Config option

```json
{
  "errorInterceptor": true,
  "encryption_Interceptor": true,
  "logger_interceptor": true,
  "clustering": true,
  "helmet_interceptor": true,
  "rateLimiting": true,
  "requestId": true,
  "response_interceptor": true,
  "ENABLE_UPSTREAM_REQUEST_TIMEOUT": true,
  "ENABLE_UPSTREAM_RESPONSE_TIMEOUT": true,
  "ENABLE_CLIENT_HEADERS_TIMEOUT": true,
  "ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT": true
}
```

When `encryption_Interceptor` is set to `true`, the Express app loads the middleware from:

```bash
interceptors/encryption.interceptor.js
```

This middleware tries to decrypt incoming JSON payloads that contain a `data` field and re-encrypts outgoing JSON responses before sending them back to the client.

### Important note

This is a lightweight custom encryption layer for demonstration purposes, not a full TLS/HTTPS implementation. The project still uses plain HTTP in the main server and proxy setup, so it is not a secure production-ready encrypted transport by itself.

This project is intentionally simple and is suitable for:

- local API testing
- proxy experiments
- understanding request forwarding
- learning Node.js server basics

It is not designed for production use without additional hardening, such as:

- HTTPS/TLS encryption
- authentication
- request validation
- production-safe logging and monitoring
- environment variables
- proper error handling for real deployments

Optional rate limiting is enabled by default in `json/config.json` for learning
on the reverse proxy only. Counters are in-memory in the proxy process;
production deployments may need stricter limits, a shared store (for example
Redis), or rate limiting at an external gateway.

## Testing

Automated tests use **Jest** and **Supertest**. Jest fits this CommonJS codebase because it supports module mocking (`config.map`, interceptors), timer control (rate-limit windows, graceful shutdown), and coverage without a separate build step.

### Commands

```bash
npm test                 # full suite (run in band for stable ports/timers)
npm run test:unit        # unit tests only
npm run test:integration # integration tests only
npm run test:coverage    # coverage report (text + lcov under coverage/)
```

### Layout

- `test/unit/` — provider, layers, interceptors, `middleware.loader.js`, `core/file.functions.js`
- `test/integration/` — Express routes, proxy ↔ upstream, middleware stack, proxy-to-API e2e
- `test/helpers/` — `createExpressApp.js` (Express bootstrap for tests), `createTestApp.js`, mocks, upstream server
- `test/fixtures/` — encryption helpers and config fragments

Integration tests use ephemeral ports, temporary log directories, and mocked `process.exit` so graceful shutdown does not terminate the runner. They do not write to the project `logs/` folder.

### Coverage focus

Coverage prioritizes `provider/`, `layers/`, `interceptors/`, `core/`, `proxy/`, `middleware.loader.js`, `index.js`, and `createProxyServer.js`. Production `proxy.js` is exercised manually; Express integration tests use `test/helpers/createExpressApp.js`.

### Known limitations

- Clustering is covered with mocked `cluster`/`os`, not full multi-worker E2E.
- Demo encryption is behavior-tested, not audited for production crypto.
- Error interceptor JSON always includes `statusCode: 500` even when HTTP status differs.
- Real OS signal delivery is not asserted; shutdown uses `triggerGracefulShutdown` and mocks.

## License

The project is currently configured with the ISC license in `package.json`.

## Suggested Improvements

- add `.env` support for configuration
- redact sensitive data and use a configurable logging framework
- add health check endpoints
- add proxy retries and richer timeout metrics
- add production-ready security hardening
