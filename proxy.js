const config = require("./provider/config.map");
const { createProxyServer } = require("./createProxyServer");
const { gracefulShutdown } = require("./layers/graceful.shutdown.layer");

const {
  host: TARGET_HOST,
  proxyPort,
  HEADERS_TIMEOUT,
  KEEP_ALIVE_TIMEOUT,
  SHUTDOWN_TIMEOUT,
  ENABLE_CLIENT_HEADERS_TIMEOUT,
  ENABLE_CLIENT_KEEP_ALIVE_TIMEOUT,
} = config;

const { server, activeProxyRequests } = createProxyServer(config);

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
