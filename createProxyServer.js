const rateLimiter = require("./layers/rate.limiting.layer");
const { isShuttingDown } = require("./layers/graceful.shutdown.layer");
const proxyRequestAbortHandler = require("./proxy/proxy.request.abort.handler");
const {
  updateResponseTimeout,
  updateRequestTimeout,
} = require("./proxy/proxy.timeout.handler");
const { createProxyRequestTracker } = require("./proxy/proxy.request.tracker");
const { http } = require("./provider/dependency.map");

function createProxyServer(config) {
  const {
    host: TARGET_HOST,
    port: TARGET_PORT,
    rateLimiting,
    PROXY_TIMEOUT,
    ENABLE_UPSTREAM_REQUEST_TIMEOUT,
    ENABLE_UPSTREAM_RESPONSE_TIMEOUT,
  } = config;

  const { track, activeRequests } = createProxyRequestTracker();

  const server = http.createServer((req, res) => {
    if (isShuttingDown()) {
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

      if (ENABLE_UPSTREAM_RESPONSE_TIMEOUT)
        updateResponseTimeout(proxyRes, res, PROXY_TIMEOUT);

      res.writeHead(statusCode, upstreamHeaders);
      proxyRes.pipe(res);
    });

    track(proxyReq);

    if (ENABLE_UPSTREAM_REQUEST_TIMEOUT)
      updateRequestTimeout(proxyReq, res, PROXY_TIMEOUT);

    proxyReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end("Bad Gateway");
    });

    proxyRequestAbortHandler(req, proxyReq);

    req.pipe(proxyReq);
  });

  return { server, activeRequests };
}

module.exports = { createProxyServer };
