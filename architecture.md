# Architecture Overview

This project is a lightweight Node.js service that demonstrates several important patterns in a single codebase:

- an Express API server for local development and experimentation
- an HTTP reverse proxy that forwards requests to a backend service
- optional process clustering for multi-worker request handling

The design intentionally keeps dependencies minimal and configuration readable so the runtime behavior can be understood quickly without a large framework or complex infrastructure.

## 1. Architectural Goals

The system is designed to be:

- easy to run locally
- easy to configure with JSON files instead of environment variables
- modular enough to plug optional middleware in and out
- educational, showing how request forwarding and request-processing middleware work in Node.js

It is not a production-grade security or deployment architecture. It is best suited for prototyping, learning, and local testing.

## 2. High-Level Structure

```text
Proxy Server
├── index.js                     # Express app entry point
├── proxy.js                    # Reverse proxy entry point
├── createProxyServer.js        # Test-only reverse proxy factory
├── proxy/
│   ├── proxy.request.tracker.js       # activeRequests Set for graceful shutdown
│   ├── proxy.timeout.handler.js       # Upstream request/response 504 timeouts
│   ├── proxy.error.handler.js         # Upstream proxyReq error → 502 Bad Gateway
│   └── proxy.request.abort.handler.js # Client abort/error → destroy upstream
├── middleware.loader.js        # Central middleware registration
├── jest.config.js              # Jest test runner configuration
├── test/                       # Automated unit and integration tests
├── provider/
│   ├── dependency.map.js       # Shared dependency registry
│   ├── config.map.js           # Merged json/* runtime configuration
│   └── interceptor.map.js    # Middleware and process registry
├── architecture.md             # System design documentation
├── README.md                   # Project overview and usage
├── package.json                # App metadata and scripts
├── package-lock.json           # Lockfile for installed packages
├── core/
│   └── file.functions.js       # Log file writing helper
├── layers/
│   ├── rate.limiting.layer.js      # Per-IP rate limiting (proxy)
│   ├── request.id.layer.js         # X-Request-ID (Express)
│   └── graceful.shutdown.layer.js  # SIGTERM/SIGINT shutdown (proxy + Express + cluster)
├── interceptors/
│   ├── cluster.interceptor.js   # Worker supervisor for clustering
│   ├── encryption.interceptor.js # Optional decrypt/encrypt middleware
│   ├── error.interceptor.js    # Error response middleware
│   ├── helmet.interceptor.js    # Security headers middleware
│   ├── logger.interceptor.js   # Optional request logger
│   └── response.interceptor.js # Optional response summary logger
├── json/
│   ├── app.json                # Host, port, and crypto configuration
│   ├── config.json             # Feature toggles
│   ├── logger.config.json      # Log exclusions and file output flag
│   ├── helmet.config.json       # Helmet security policy configuration
│   └── rate-limiting.config.json # Rate limit window and request cap
├── logs/                       # Runtime log directory
├── .gitignore
└── node_modules/               # Installed dependencies
```

## 3. Runtime Components

### 3.1 Express API Server (`index.js`)

The main API server is created with Express and reads `host`, `port`,
`SHUTDOWN_TIMEOUT`, and `clustering` from `provider/config.map.js` (merged from
`json/` files; see §5 and §7).

`index.js` is the production entry: Express app creation, `middleware(app)`, active-request
tracking, routes, `errorMiddleware(app)`, cluster primary vs worker branching, `listen`, and
`gracefulShutdown()`.

[`test/helpers/createExpressApp.js`](test/helpers/createExpressApp.js) mirrors the same
middleware and routes for Jest (`bootstrap()` / `registerErrorMiddleware()`), loaded via
`test/helpers/createTestApp.js` with mocked config.

The root route responds with a simple JSON payload:

```json
{ "message": "hello world" }
```

This keeps the API intentionally minimal while proving the request lifecycle and middleware flow.

### 3.2 Reverse Proxy (`proxy.js`)

The reverse proxy is a Node.js `http` server defined in `proxy.js`. It loads `provider/config.map.js`, composes `proxy/` helpers with `layers/`, listens on `proxyPort`, and registers graceful shutdown. It does not use Express.

- listen: `proxyPort` on `host` (`TARGET_HOST`)
- upstream: `port` (`TARGET_PORT`) on `127.0.0.1` when `host` is `0.0.0.0`, otherwise `TARGET_HOST` — never `proxyPort`

[`createProxyServer.js`](createProxyServer.js) duplicates the handler for Jest integration tests; it is not imported by `proxy.js`.

Runtime settings come from `provider/config.map.js` (see §5), including `PROXY_TIMEOUT`, `rateLimiting`, and the four `ENABLE_*` toggles.

Request flow (same shape in `proxy.js` and the test factory):

1. returns **503** when `isShuttingDown()` is true
2. optional rate limiting (`layers/rate.limiting.layer.js`) → **429** without forwarding
3. outbound `http.request` to `TARGET_PORT` with the same method, path, and headers; `proxy/proxy.request.tracker.js` (default export factory) adds each `proxyReq` to `activeRequests` until `close`
4. when `ENABLE_UPSTREAM_RESPONSE_TIMEOUT` is true, `proxy/proxy.timeout.handler.js` → `updateResponseTimeout` (**504** on expiry)
5. when `ENABLE_UPSTREAM_REQUEST_TIMEOUT` is true, `updateRequestTimeout` on the upstream request (**504** on expiry)
6. `proxy/proxy.error.handler.js` (`sendBadGateway`) listens for upstream `proxyReq` `"error"` and responds with **502**
7. `proxy/proxy.request.abort.handler.js` wires client `aborted`, `error`, and incomplete `close` to destroy the upstream request
8. `req.pipe(proxyReq)` streams the body

`createProxyServer(config)` takes only the merged config object (no dependency-injection parameter). Tests mock modules such as `layers/rate.limiting.layer` when needed.

In `proxy.js`, `server.headersTimeout` / `server.keepAliveTimeout` are set when the client `ENABLE_CLIENT_*` flags are true, then `gracefulShutdown()` runs with the tracker’s `activeRequests` set.

### 3.3 Cluster Supervisor (`interceptors/cluster.interceptor.js`)

The clustering feature uses Node.js's built-in `cluster` module to create worker processes when the application is configured with `clustering: true` in `json/config.json`.

The supervisor process:

- checks whether it is the primary process
- determines the number of available CPU cores
- forks one worker per core
- listens for worker exits and restarts a replacement worker unless `markClusterShuttingDown()` has been called during graceful shutdown

The actual HTTP server is not started in the primary process. Instead, the workers bind to the configured port, allowing the app to distribute incoming work across multiple processes.

### 3.4 Graceful shutdown (`layers/graceful.shutdown.layer.js`)

Shared shutdown logic used by `proxy.js` and `index.js`:

| Role | Behavior |
|------|----------|
| Proxy | `server.close()`, 503 for new requests while draining, wait for active upstream `proxyReq`, `exit(0)` or force-destroy and `exit(1)` after `SHUTDOWN_TIMEOUT` |
| Express worker / standalone | `server.close()`, track active `res` until `finish`/`close`, same timeout and exit codes |
| Cluster primary | `registerClusterPrimaryShutdown()`: IPC `shutdown` to workers, wait for worker exits, `worker.kill()` on timeout; no HTTP server |

`SIGTERM` and `SIGINT` handlers are registered once per process and are idempotent. `provider/interceptor.map.js` exports `markClusterShuttingDown` from `cluster.interceptor.js`.

## 4. Middleware Composition

The application uses a centralized middleware registration pattern in `middleware.loader.js`.

### `middleware(app)`

This function registers shared application-level middleware in order:

- optional request ID middleware (`layers/request.id.layer.js`)
- optional Helmet security headers
- CORS
- JSON body parsing via `express.json()`
- optional encryption middleware
- optional request logger
- optional response logger (`interceptors/response.interceptor.js`)

Rate limiting is intentionally **not** registered here; it runs on the reverse proxy when `rateLimiting` is true (see §6.7 and `proxy.js`).

The logic is intentionally centralized so the Express app remains simple and feature flags are easy to manage.

### `errorMiddleware(app)`

This function enables the custom error interceptor only when `errorInterceptor` is set to true in `json/config.json`.

## 5. Dependency and Registry Layers

Registry modules live under `provider/` so entry points and interceptors share one import path.

### `provider/dependency.map.js`

This file centralizes shared libraries used across the codebase:

- `express`
- `http`
- `cors`
- `helmet`
- `performance` (`node:perf_hooks`, used by the response logger)
- `fs`
- `path`
- `cluster`
- `os`

This acts as a lightweight dependency registry and helps keep import points consistent.

### `provider/interceptor.map.js`

This file maps logical middleware names to concrete implementation modules:

- `errorInterceptors`
- `encryptionInterceptor`
- `loggerInterceptor`
- `clusterInterceptor`
- `helmetInterceptor`
- `requestIdInterceptor` (implemented in `layers/request.id.layer.js`)
- `responseInterceptor`
- `markClusterShuttingDown` (from `cluster.interceptor.js`, used during cluster primary shutdown)

This creates a single place where middleware can be registered or extended without changing multiple import sites.

### `provider/config.map.js`

This file mirrors the registry pattern used by `provider/dependency.map.js` and
`provider/interceptor.map.js`: one import surface for runtime configuration. It
loads:

| Source on disk | How it is exported |
|----------------|-------------------|
| `json/config.json` | spread onto the export |
| `json/app.json` | spread (overrides `config` keys on collision) |
| `json/rate-limiting.config.json` | spread (`windowMs`, `limit`, etc.) |
| `json/helmet.config.json` | nested as `helmet` (not spread) |
| `json/logger.config.json` | spread (`exclude`, `WRITE_L0G`, etc.) |

Consumers include `index.js`, `proxy.js`, `middleware.loader.js`,
`layers/rate.limiting.layer.js`, `interceptors/logger.interceptor.js`,
`interceptors/response.interceptor.js`, `interceptors/encryption.interceptor.js`,
and `interceptors/helmet.interceptor.js` (which reads `helmet` from the export).
Edit the JSON files under `json/` to change behavior; the map module only aggregates them.

## 6. Optional Interceptors

The project supports optional processing layers that can be toggled in `json/config.json`.

### 6.1 Error Interceptor

File: `interceptors/error.interceptor.js`

This middleware catches application errors and formats a structured JSON error response:

```json
{
  "message": "...",
  "status": false,
  "statusCode": 500
}
```

It is designed to standardize API error output.

### 6.2 Encryption Interceptor

File: `interceptors/encryption.interceptor.js`

This middleware is an experimental encryption layer that:

- checks request bodies for a `data` field
- decrypts that payload using a custom crypto implementation
- replaces `req.body` with the decrypted JSON
- wraps outgoing `res.json()` responses to encrypt the payload before sending it back

The encryption uses a custom key/IV setup derived from fields on
`provider/config.map.js` (from `json/app.json`). It is only meant for demonstration
and is not equivalent to TLS/HTTPS or secure enough for real production transport.

### 6.3 Request Logger

File: `interceptors/logger.interceptor.js`

This middleware logs request details such as:

- method
- URL and route information
- query parameters
- protocol and host metadata
- client IP information
- request body
- headers

It then writes the sanitized object to either:

- the console, as one line: `request:` plus `JSON.stringify` of the object
- a dated log file in `logs/` as a raw JSON line (no `request:` prefix)

The logger reads `exclude` and `WRITE_L0G` from `provider/config.map.js`
(sourced from `json/logger.config.json`) and supports omitting sensitive request
properties such as `body`, `headers`, `params`, or `query`.

Logged `requestId` is resolved as `req.requestId`, then the incoming `x-request-id` header, then `"N/A"`, so request and response logs stay aligned even when the request ID layer is disabled.

### 6.4 Response logger

File: `interceptors/response.interceptor.js`

When `response_interceptor` is `true`, this middleware starts a timer and listens for `res` `"finish"`. It logs `method`, `originalUrl`, `statusCode`, numeric `durationMs` (via `performance` from `provider/dependency.map.js`), `contentLength` from `res.getHeader("content-length")`, and the same `requestId` resolution as the request logger.

Console output uses the prefix `response:` plus `JSON.stringify` of the summary
object. When `WRITE_L0G` is true, each summary is also appended to the dated
file under `logs/` through `core/file.functions.js` as raw JSON. Request-log
`exclude` does not apply to this object.

### 6.5 Helmet Security Headers

File: `interceptors/helmet.interceptor.js`

This middleware enables Helmet security protections when `helmet_interceptor` is set to `true` in `json/config.json`.

It passes the `helmet` object from `provider/config.map.js` into the Helmet
middleware when that object has keys; otherwise it uses Helmet defaults. This
adds security headers such as CSP and CORS-related protections without custom
header logic in application routes.

### 6.6 Request ID

File: `layers/request.id.layer.js`

Express middleware registered when `requestId` is `true` in `json/config.json`. It reads `x-request-id` from the incoming request (Node lowercases header names) or generates a UUID, assigns `req.requestId`, sets the `X-Request-ID` response header, and calls `next()`.

The reverse proxy does not invoke this module. Clients may still send `X-Request-ID` through the proxy because `proxy.js` forwards request headers to the backend unchanged.

### 6.7 Rate limiting

File: `layers/rate.limiting.layer.js`

This is not Express middleware by itself. It is a function `(req, res) => boolean` that tracks request counts per IP in an in-memory `Map`, using `windowMs` and `limit` from `provider/config.map.js` (from `json/rate-limiting.config.json`). It sets `RateLimit-Limit` and `RateLimit-Remaining` on responses. When the limit is exceeded it writes HTTP 429 with `Retry-After` and a JSON error payload, then returns `false`; otherwise it returns `true`.

- **Reverse proxy only:** `proxy.js` invokes the layer before building the outbound request when `rateLimiting` is true in `json/config.json`.

The Express API (`index.js` / `middleware.loader.js`) does not use this layer. Direct access to the app port bypasses proxy rate limits.

The proxy process maintains in-memory counters per IP; there is no cross-process or multi-instance shared store.

### 6.8 Cluster Supervisor

File: `interceptors/cluster.interceptor.js`

This interceptor is not a standard Express middleware function; it is a process-management bootstrap used when clustering is enabled in `json/config.json`.

It:

- checks whether the current runtime is the primary process
- forks one child process per CPU core
- restarts workers when they terminate unless `clusterShuttingDown` is set via `markClusterShuttingDown()`
- leaves the actual application startup to the worker instances

This is a multi-process scaling pattern for local concurrency experiments rather than a production load-balancing strategy.

### 6.9 Graceful shutdown layer

File: `layers/graceful.shutdown.layer.js`

Exports `gracefulShutdown()`, `triggerGracefulShutdown()`, `isShuttingDown()`, `registerClusterPrimaryShutdown()`, and `registerWorkerShutdownMessage()`. Callers pass `SHUTDOWN_TIMEOUT` from `provider/config.map.js` (defined in `json/app.json`). Destroys remaining tracked sockets (upstream `ClientRequest` or `res.socket`) when the shutdown deadline expires.

## 7. Configuration Model

The project relies on JSON configuration files to avoid hard-coded runtime values.
At runtime, `provider/config.map.js` merges them into one export (see §5); the
sections below describe each file on disk.

### `json/app.json`

This file defines connection and service values:

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

It is also used for encryption-related settings. Entry points read these values through `provider/config.map.js`. For `proxy.js`, `host` and `port` are the upstream target; timeout fields supply millisecond values paired with `ENABLE_*` flags in `json/config.json`. `SHUTDOWN_TIMEOUT` bounds graceful shutdown for the proxy, each Express worker, and cluster primary worker coordination.

### `json/config.json`

This file toggles middleware behavior:

```json
{
  "errorInterceptor": true,
  "encryption_Interceptor": true,
  "logger_interceptor": true,
  "helmet_interceptor": true,
  "rateLimiting": true,
  "requestId": true,
  "response_interceptor": true,
  "clustering": true,
  "ENABLE_UPSTREAM_REQUEST_TIMEOUT": true,
  "ENABLE_UPSTREAM_RESPONSE_TIMEOUT": true,
  "ENABLE_CLIENT_HEADERS_TIMEOUT": true,
  "ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT": true
}
```

These flags decide which optional services are enabled during app startup. Express-related flags (`helmet_interceptor`, `requestId`, `response_interceptor`, interceptors, `clustering`) apply to `index.js`. Proxy-only flags are `rateLimiting` and the four `ENABLE_*` timeout toggles (durations in `json/app.json`).

### `json/logger.config.json`

This file controls logging output and field exclusion.

```json
{
  "exclude": ["params", "body"],
  "WRITE_L0G": true
}
```

The `exclude` array prevents selected request fields from being emitted to the console or file, which is important when handling sensitive data. `WRITE_L0G` also controls whether the response logger writes summaries to the same log files. Interceptors access these keys through `provider/config.map.js`.

### `json/rate-limiting.config.json`

This file configures the shared rate limiting layer:

```json
{
  "windowMs": 900000,
  "limit": 100,
  "standardHeaders": true,
  "legacyHeaders": false
}
```

The layer reads `windowMs` and `limit` from `provider/config.map.js` only. The committed defaults allow 100 requests per client IP every 15 minutes. The layer always emits `RateLimit-Limit` and `RateLimit-Remaining`; `standardHeaders` and `legacyHeaders` are kept in JSON for forward compatibility but are not used by the current implementation.

## 8. Request Flow

### API Request Lifecycle

```text
Client
  ↓
Express app (index.js)
  ↓
Optional request ID middleware
  ↓
Optional Helmet middleware
  ↓
CORS + JSON parser
  ↓
Optional encryption middleware
  ↓
Optional logger middleware
  ↓
Optional response logger middleware
  ↓
Route handler (/)
  ↓
JSON response
  ↓
Optional encryption wrapper
  ↓
Client
```

### Proxy Request Lifecycle

```text
Client
  ↓
Proxy server (proxy.js)
  ↓
Optional rate limiting layer
  ↓
Read request metadata
  ↓
Send outbound HTTP request to target host:port
  ↓
(Optional upstream request/response timeouts → 504)
  ↓
Stream response back to client
  ↓
Client
```

If the target backend is unreachable, the proxy returns `502 Bad Gateway`. Upstream timeouts return `504 Gateway Timeout` when the corresponding `ENABLE_UPSTREAM_*` flags are enabled. During shutdown, new proxy requests receive `503 Service Unavailable`.

### Graceful shutdown sequence

```text
SIGTERM / SIGINT
  ↓
Proxy OR Express worker OR Cluster primary
  ↓
(stop accepting / notify workers)
  ↓
Drain active requests (up to SHUTDOWN_TIMEOUT)
  ↓
exit(0)  OR  force destroy + exit(1)
```

## 9. Persistence and File Utilities

The `core/file.functions.js` helper is responsible for writing request logs into the `logs/` directory.

It:

- creates the `logs/` folder if it does not exist
- uses the current date as the log filename
- appends each log entry as a new line
- throws an error if file writing fails

This is a simple, local-file logging mechanism appropriate for development use.

## 10. Operational Characteristics

### Strengths

- very easy to understand
- few dependencies
- clear separation between API server and reverse proxy
- feature toggles make experimentation simple
- good learning tool for Node.js HTTP, Express, and proxy fundamentals
- graceful shutdown hooks for proxy and clustered Express workers

### Limitations

- plain HTTP, not HTTPS
- no authentication or authorization
- no validation layer
- proxy rate limiting is in-memory in the proxy process only; Express is not rate-limited by this flag, and multiple proxy instances do not share counters
- proxy timeout and keep-alive behavior are basic; no retries or structured timeout metrics
- no environment-based configuration management
- custom encryption is not production-grade
- automated tests exist but do not cover every deployment edge case (see Testing section)

## 11. Design Summary

This project follows a deliberately simple layered architecture:

- entry points for each runtime service
- a central middleware loader
- pluggable interceptors
- shared `layers/` modules (rate limiting and graceful shutdown on the proxy; request IDs and shutdown on Express)
- JSON-based configuration aggregated through `provider/config.map.js`
- minimal helper utilities
- raw Node.js proxying for request forwarding, with `proxy/` helpers for timeouts and client disconnects

This keeps the system approachable while exposing the essential principles behind web servers, reverse proxies, middleware composition, and lightweight request processing.

## 12. Testing Architecture

The project uses **Jest** (runner, mocks, timers, coverage) and **Supertest** (HTTP assertions against Express).

| Area | Approach |
|------|----------|
| Unit | Direct calls to layers/interceptors and `proxy/` handlers; `jest.resetModules` + `doMock` for `provider/config.map` |
| Middleware | Spy on `app.use` with mocked interceptor map |
| Proxy | `createProxyServer(config)` with local upstream `http` servers on port `0`; module mocks for rate limit / shutdown edge cases |
| API | `bootstrap()` from `test/helpers/createExpressApp.js` via `test/helpers/createTestApp.js` (reloads modules; disables encryption/logging noise) |
| Graceful shutdown | `resetShutdownStateForTests()` when `NODE_ENV=test`; global `process.exit` mock in `test/setup/jest.setup.js` |
| Files | `process.cwd()` pointed at temp dirs; no writes to project `logs/` |

Run `npm test`, `npm run test:unit`, `npm run test:integration`, or `npm run test:coverage`. Entry points remain thin wrappers around the factories so production behavior stays the same while tests bind ephemeral ports.

## 13. Recommended Future Enhancements

If the project is extended, the most valuable next steps would be:

- move configuration to environment variables
- add HTTPS/TLS support
- validate incoming request bodies and headers
- add authentication and authorization
- add structured logging with rotation and sanitization
- separate proxy target configuration from app configuration
- add health checks and monitoring endpoints

These changes would make the architecture more robust while preserving the same basic structure.
