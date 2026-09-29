# Proxy Server

A lightweight Node.js project that runs a small Express API and a reverse proxy. It is designed for local development and learning how request forwarding works without adding a heavy framework or extra dependencies.

## Overview

This project contains two separate server entry points:

- `index.js` — runs the Express app
- `proxy.js` — runs the HTTP reverse proxy

The app is configured with JSON files under the `json/` folder, which makes it easy to adjust the host and port values without changing code.

## Project Structure

```bash
.
├── index.js
├── proxy.js
├── dependency.map.js
├── interceptor.map.js
├── middleware.loader.js
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
│   └── request.id.layer.js
├── interceptors/
│   ├── cluster.interceptor.js
│   ├── encryption.interceptor.js
│   ├── error.interceptor.js
│   ├── helmet.interceptor.js
│   └── logger.interceptor.js
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
- Optional Helmet-based security headers middleware
- Optional per-request `X-Request-ID` on the Express API (propagate or generate UUID)
- Optional per-IP rate limiting via a shared in-memory layer on the reverse proxy (JSON-tuned)
- Optional worker clustering through Node.js `cluster` module
- Easy host/port configuration through JSON files

## Configuration

### `json/app.json`

```json
{
  "host": "0.0.0.0",
  "port": 3000,
  "proxyPort": 8080
}
```

The values are used as follows:

- `host` — bind address for the servers
- `port` — Express app port
- `proxyPort` — reverse proxy port

### `json/config.json`

```json
{
  "errorInterceptor": true,
  "encryption_Interceptor": true,
  "logger_interceptor": true,
  "clustering": true,
  "helmet_interceptor": true,
  "rateLimiting": true,
  "requestId": true
}
```

- `errorInterceptor` — enables the custom error middleware from `interceptors/error.interceptor.js`
- `encryption_Interceptor` — enables the custom encryption middleware from `interceptors/encryption.interceptor.js`
- `logger_interceptor` — enables the request logger from `interceptors/logger.interceptor.js`
- `helmet_interceptor` — enables Helmet security headers via `interceptors/helmet.interceptor.js`
- `rateLimiting` — enables the shared rate limiter in `layers/rate.limiting.layer.js` on the reverse proxy (`proxy.js`) only; the Express app does not apply this limit
- `requestId` — enables request ID middleware from `layers/request.id.layer.js` on the Express app only
- `clustering` — enables the Node.js cluster process manager, which forks worker processes and lets only the worker bind the Express server port

### Middleware loading

`middleware.loader.js` centralizes Express middleware setup. The exported
`middleware(app)` function registers optional request ID handling first when
`requestId` is enabled, then optional Helmet security headers when
`helmet_interceptor` is enabled (via `helmetInterceptor(app)`), then always
registers CORS and JSON request parsing, then registers the encryption and
logger interceptors when their respective configuration flags are enabled. Rate
limiting is not part of the Express middleware stack; it runs at the proxy edge
in `proxy.js` when `rateLimiting` is true. The exported
`errorMiddleware(app)` function registers the error interceptor only when
`errorInterceptor` is enabled.

The loader gets Express and CORS from `dependency.map.js` and the interceptor
functions from `interceptor.map.js`. `index.js` calls `middleware(app)` during
app setup and calls `errorMiddleware(app)` to register the configured error
handler.

## Request Logging

The optional request logger is implemented in
`interceptors/logger.interceptor.js` and is enabled when
`logger_interceptor` is `true` in `json/config.json`. It logs request details
including the HTTP method and URL, route parameters, query values, protocol and
host, client IP information, request body, and headers. It then passes the
request to the next middleware; it does not log responses.

## Helmet Security Headers

The project also supports a Helmet-based security interceptor. It is enabled via
`json/config.json` with `helmet_interceptor: true` and is implemented in
`interceptors/helmet.interceptor.js`.

The interceptor applies Helmet defaults when the config file is empty, but it can
also load custom options from `json/helmet.config.json` to tune policies such as
`contentSecurityPolicy` and `crossOriginResourcePolicy`.

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
`interceptor.map.js` as `requestIdInterceptor`.

When enabled:

- If the client sends `X-Request-ID`, that value is reused.
- Otherwise a new ID is generated with `crypto.randomUUID()`.
- The ID is stored on `req.requestId` and echoed on the response as `X-Request-ID`.

This runs on the **Express API** only (`middleware.loader.js`). The reverse
proxy does not run this layer; it forwards incoming headers as-is, so a client
`X-Request-ID` can still reach the backend when traffic goes through `proxy.js`.

## Rate limiting

Optional per-IP rate limiting is controlled by `rateLimiting` in
`json/config.json`. The logic lives in `layers/rate.limiting.layer.js`: an
in-memory counter per client IP (`req.socket.remoteAddress`) with options from
`json/rate-limiting.config.json`.

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

`json/logger.config.json` controls file output and which request properties are
omitted from the logged object:

```json
{
  "exclude": ["params", "body"],
  "WRITE_L0G": true
}
```

`WRITE_L0G` (with a zero in `L0G`) enables appending each logged request as a
JSON line to a date-named text file under `logs/` (for example,
`logs/2026-09-29.txt`). The `logs/` directory is created automatically. Set
`WRITE_L0G` to `false` to disable file output; request details are still sent
to the console.

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

```text
hello world
```

### Start the proxy server

```bash
node proxy.js
```

This server listens on:

```bash
http://0.0.0.0:8080
```

Requests sent to the proxy port are forwarded to the configured backend target defined in `json/app.json`.

## How the Proxy Works

The proxy receives incoming HTTP requests. When `rateLimiting` is enabled, it runs the shared rate limiter first; blocked clients receive 429 without forwarding. Otherwise it creates an outbound request to the configured target service and streams the response back to the client.

If the target service is unavailable, the proxy returns:

```text
502 Bad Gateway
```

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
- a worker restarts itself if it exits unexpectedly
- only the worker process binds the Express server port and handles incoming HTTP traffic

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
  "requestId": true
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

## Scripts

The current `package.json` includes a placeholder test script:

```bash
npm test
```

At the moment, this is not configured with real automated tests.

## License

The project is currently configured with the ISC license in `package.json`.

## Suggested Improvements

- add `.env` support for configuration
- redact sensitive data and use a configurable logging framework
- add health check endpoints
- add proper proxy error handling and retries
- add automated tests
- add production-ready security hardening
