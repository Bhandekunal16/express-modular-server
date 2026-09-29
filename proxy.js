const { http } = require("./dependency.map");

const {
  host: TARGET_HOST,
  port: TARGET_PORT,
  proxyPort,
  PROXY_TIMEOUT,
  HEADERS_TIMEOUT,
  KEEP_ALIVE_TIMEOUT,
  SHUTDOWN_TIMEOUT,
} = require("./json/app.json");

const {
  rateLimiting,
  ENABLE_UPSTREAM_REQUEST_TIMEOUT,
  ENABLE_UPSTREAM_RESPONSE_TIMEOUT,
  ENABLE_CLIENT_HEADERS_TIMEOUT,
  ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT,
} = require("./json/config.json");

const rateLimiter = require("./layers/rate.limiting.layer");

const {
  gracefulShutdown,
  isShuttingDown,
} = require("./layers/graceful.shutdown.layer");

const activeProxyRequests = new Set();

function untrackProxyRequest(proxyReq) {
  activeProxyRequests.delete(proxyReq);
}

function trackProxyRequest(proxyReq) {
  activeProxyRequests.add(proxyReq);
  proxyReq.once("close", () => untrackProxyRequest(proxyReq));
}

const server = http.createServer((req, res) => {
  if (isShuttingDown()) {
    if (!res.headersSent) res.writeHead(503, { "Content-Type": "text/plain" });
    if (!res.writableEnded) res.end("Service Unavailable");

    return;
  }

  if (rateLimiting && !rateLimiter(req, res)) return;

  const { url: path, method, headers } = req;

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path,
    method,
    headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const { statusCode, headers } = proxyRes;

    if (ENABLE_UPSTREAM_RESPONSE_TIMEOUT) {
      proxyRes.setTimeout(PROXY_TIMEOUT, () => {
        console.error("Proxy response timeout");

        proxyRes.destroy();

        if (!res.headersSent) res.writeHead(504);
        if (!res.writableEnded) res.end("Gateway Timeout");
      });
    }

    res.writeHead(statusCode, headers);
    proxyRes.pipe(res);
  });

  trackProxyRequest(proxyReq);

  if (ENABLE_UPSTREAM_REQUEST_TIMEOUT) {
    proxyReq.setTimeout(PROXY_TIMEOUT, () => {
      console.error("Proxy request timeout");

      proxyReq.destroy();

      if (!res.headersSent) res.writeHead(504);
      if (!res.writableEnded) res.end("Gateway Timeout");
    });
  }

  proxyReq.on("error", (error) => {
    console.error("Proxy error:", error.message);

    if (!res.headersSent) res.writeHead(502);
    if (!res.writableEnded) res.end("Bad Gateway");
  });

  req.on("aborted", () => {
    console.log("Client aborted request");
    proxyReq.destroy();
  });

  req.on("error", (error) => {
    console.error("Client request error:", error.message);
    proxyReq.destroy();
  });

  req.pipe(proxyReq);
});

if (ENABLE_CLIENT_HEADERS_TIMEOUT) server.headersTimeout = HEADERS_TIMEOUT;

if (ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT)
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;

server.listen(proxyPort, TARGET_HOST, () => {
  console.log(`http://${TARGET_HOST}:${proxyPort}`);
});

gracefulShutdown({
  server,
  name: "Proxy",
  shutdownTimeout: SHUTDOWN_TIMEOUT,
  activeRequests: activeProxyRequests,
});
