const defaultRateLimiter = require("./layers/rate.limiting.layer");
const {
  isShuttingDown: defaultIsShuttingDown,
} = require("./layers/graceful.shutdown.layer");
const fallbackProxy = require("./proxy/proxy.request.abort.handler");

function createProxyServer(config, deps = {}) {
  const { http } = deps.http
    ? { http: deps.http }
    : require("./provider/dependency.map");
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
  const isShuttingDownFn = deps.isShuttingDown ?? defaultIsShuttingDown;

  const {
    host: TARGET_HOST,
    port: TARGET_PORT,
    rateLimiting,
    PROXY_TIMEOUT,
    ENABLE_UPSTREAM_REQUEST_TIMEOUT,
    ENABLE_UPSTREAM_RESPONSE_TIMEOUT,
  } = config;

  const activeProxyRequests = new Set();

  function untrackProxyRequest(proxyReq) {
    activeProxyRequests.delete(proxyReq);
  }

  function trackProxyRequest(proxyReq) {
    activeProxyRequests.add(proxyReq);
    proxyReq.once("close", () => untrackProxyRequest(proxyReq));
  }

  const server = http.createServer((req, res) => {
    if (isShuttingDownFn()) {
      if (!res.headersSent)
        res.writeHead(503, { "Content-Type": "text/plain" });
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
      const { statusCode, headers: upstreamHeaders } = proxyRes;

      if (ENABLE_UPSTREAM_RESPONSE_TIMEOUT) {
        proxyRes.setTimeout(PROXY_TIMEOUT, () => {
          proxyRes.destroy();

          if (!res.headersSent) res.writeHead(504);
          if (!res.writableEnded) res.end("Gateway Timeout");
        });
      }

      res.writeHead(statusCode, upstreamHeaders);
      proxyRes.pipe(res);
    });

    trackProxyRequest(proxyReq);

    if (ENABLE_UPSTREAM_REQUEST_TIMEOUT) {
      proxyReq.setTimeout(PROXY_TIMEOUT, () => {
        proxyReq.destroy();

        if (!res.headersSent) res.writeHead(504);
        if (!res.writableEnded) res.end("Gateway Timeout");
      });
    }

    proxyReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end("Bad Gateway");
    });

    fallbackProxy(req, proxyReq);

    req.pipe(proxyReq);
  });

  return { server, activeProxyRequests };
}

module.exports = { createProxyServer };
