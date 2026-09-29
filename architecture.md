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
├── middleware.loader.js        # Central middleware registration
├── dependency.map.js           # Shared dependency registry
├── interceptor.map.js          # Middleware and process registry
├── architecture.md             # System design documentation
├── README.md                   # Project overview and usage
├── package.json                # App metadata and scripts
├── package-lock.json           # Lockfile for installed packages
├── core/
│   └── file.functions.js       # Log file writing helper
├── interceptors/
│   ├── cluster.interceptor.js   # Worker supervisor for clustering
│   ├── encryption.interceptor.js # Optional decrypt/encrypt middleware
│   ├── error.interceptor.js    # Error response middleware
│   ├── helmet.interceptor.js    # Security headers middleware
│   └── logger.interceptor.js   # Optional request logger
├── json/
│   ├── app.json                # Host, port, and crypto configuration
│   ├── config.json             # Feature toggles
│   ├── logger.config.json      # Log exclusions and file output flag
│   └── helmet.config.json       # Helmet security policy configuration
├── logs/                       # Runtime log directory
├── .gitignore
└── node_modules/               # Installed dependencies
```

## 3. Runtime Components

### 3.1 Express API Server (`index.js`)

The main API server is created with Express and starts on the value configured in `json/app.json`:

- `host`
- `port`

The server performs the following steps:

1. creates an Express application instance
2. registers base middleware through `middleware(app)`
3. defines a root route at `GET /`
4. defines a 404 fallback route
5. registers the optional error interceptor
6. listens on the configured port and host

The root route responds with a simple JSON payload:

```json
{ "message": "hello world" }
```

This keeps the API intentionally minimal while proving the request lifecycle and middleware flow.

### 3.2 Reverse Proxy (`proxy.js`)

The reverse proxy is a Node.js `http` server. It does not use Express; it creates a raw HTTP server and forwards each incoming request to a target service:

- target host: `TARGET_HOST`
- target port: `TARGET_PORT`
- proxy listening port: `proxyPort`

The proxy:

1. reads the request URL, method, and headers
2. builds outbound request options
3. opens a connection to the target backend
4. copies the backend response back to the original client
5. returns `502 Bad Gateway` if the target cannot be reached

This is a classic simple reverse proxy pattern and is useful for learning how request forwarding works without a specialized proxy framework.

### 3.3 Cluster Supervisor (`interceptors/cluster.interceptor.js`)

The clustering feature uses Node.js's built-in `cluster` module to create worker processes when the application is configured with `clustering: true` in `json/config.json`.

The supervisor process:

- checks whether it is the primary process
- determines the number of available CPU cores
- forks one worker per core
- listens for worker exits and restarts a replacement worker

The actual HTTP server is not started in the primary process. Instead, the workers bind to the configured port, allowing the app to distribute incoming work across multiple processes.

## 4. Middleware Composition

The application uses a centralized middleware registration pattern in `middleware.loader.js`.

### `middleware(app)`

This function registers shared application-level middleware:

- CORS
- JSON body parsing via `express.json()`
- optional encryption middleware
- optional request logger

The logic is intentionally centralized so the Express app remains simple and feature flags are easy to manage.

### `errorMiddleware(app)`

This function enables the custom error interceptor only when `errorInterceptor` is set to true in `json/config.json`.

## 5. Dependency and Registry Layers

### `dependency.map.js`

This file centralizes shared libraries used across the codebase:

- `express`
- `cors`
- `helmet`
- `fs`
- `path`
- `cluster`
- `os`

This acts as a lightweight dependency registry and helps keep import points consistent.

### `interceptor.map.js`

This file maps logical middleware names to concrete implementation modules:

- `errorInterceptors`
- `encryptionInterceptor`
- `loggerInterceptor`
- `clusterInterceptor`

This creates a single place where middleware can be registered or extended without changing multiple import sites.

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

The encryption uses a custom key/IV setup derived from values stored in `json/app.json`, and it is only meant for demonstration. It is not equivalent to TLS/HTTPS and is not secure enough for real production transport.

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

- the console
- a dated log file in `logs/`

The logger is controlled by `json/logger.config.json` and supports excluding sensitive request properties such as `body`, `headers`, `params`, or `query`.

### 6.4 Helmet Security Headers

File: `interceptors/helmet.interceptor.js`

This middleware enables Helmet security protections when `helmet_interceptor` is set to `true` in `json/config.json`.

It applies helmet defaults and can read optional policy overrides from `json/helmet.config.json`. This layer adds security headers such as CSP and CORS-related protections without requiring a large framework or custom header logic.

### 6.5 Cluster Supervisor

File: `interceptors/cluster.interceptor.js`

This interceptor is not a standard Express middleware function; it is a process-management bootstrap used when clustering is enabled in `json/config.json`.

It:

- checks whether the current runtime is the primary process
- forks one child process per CPU core
- restarts workers when they terminate
- leaves the actual application startup to the worker instances

This is a multi-process scaling pattern for local concurrency experiments rather than a production load-balancing strategy.

## 7. Configuration Model

The project relies on JSON configuration files to avoid hard-coded runtime values.

### `json/app.json`

This file defines connection and service values:

```json
{
  "host": "0.0.0.0",
  "port": 3000,
  "proxyPort": 8080
}
```

It is also used for encryption-related settings and target backend address information.

### `json/config.json`

This file toggles middleware behavior:

```json
{
  "errorInterceptor": true,
  "encryption_Interceptor": true,
  "logger_interceptor": true,
  "helmet_interceptor": true,
  "clustering": true
}
```

These flags decide which optional services are enabled during app startup. The `helmet_interceptor` flag enables the Helmet security header middleware, while the `clustering` flag activates the primary/worker process model used by `interceptors/cluster.interceptor.js`.

### `json/logger.config.json`

This file controls logging output and field exclusion.

```json
{
  "exclude": ["params", "body"],
  "WRITE_L0G": true
}
```

The `exclude` array prevents selected request fields from being emitted to the console or file, which is important when handling sensitive data.

## 8. Request Flow

### API Request Lifecycle

```text
Client
  ↓
Express app (index.js)
  ↓
CORS + JSON parser
  ↓
Optional encryption middleware
  ↓
Optional logger middleware
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
Read request metadata
  ↓
Send outbound HTTP request to target host:port
  ↓
Stream response back to client
  ↓
Client
```

If the target backend is unreachable, the proxy returns a `502 Bad Gateway` response.

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

### Limitations

- plain HTTP, not HTTPS
- no authentication or authorization
- no validation layer
- no rate limiting
- no environment-based configuration management
- custom encryption is not production-grade
- no automated tests configured

## 11. Design Summary

This project follows a deliberately simple layered architecture:

- entry points for each runtime service
- a central middleware loader
- pluggable interceptors
- JSON-based configuration
- minimal helper utilities
- raw Node.js proxying for request forwarding

This keeps the system approachable while exposing the essential principles behind web servers, reverse proxies, middleware composition, and lightweight request processing.

## 12. Recommended Future Enhancements

If the project is extended, the most valuable next steps would be:

- move configuration to environment variables
- add HTTPS/TLS support
- validate incoming request bodies and headers
- add authentication and authorization
- add structured logging with rotation and sanitization
- add automated tests for API and proxy behavior
- separate proxy target configuration from app configuration
- add health checks and monitoring endpoints

These changes would make the architecture more robust while preserving the same basic structure.
