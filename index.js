const { cluster } = require("./provider/dependency.map");
const {
  clusterInterceptor,
  markClusterShuttingDown,
} = require("./provider/interceptor.map");
const {
  host,
  port,
  SHUTDOWN_TIMEOUT,
  clustering,
} = require("./provider/config.map");
const { bootstrap, registerErrorMiddleware } = require("./createExpressApp");
const {
  gracefulShutdown,
  registerClusterPrimaryShutdown,
  registerWorkerShutdownMessage,
  triggerGracefulShutdown,
} = require("./layers/graceful.shutdown.layer");

if (clustering && cluster.isPrimary) {
  clusterInterceptor();
  registerClusterPrimaryShutdown({
    shutdownTimeout: SHUTDOWN_TIMEOUT,
    markClusterShuttingDown,
  });
} else {
  const { app, activeRequests } = bootstrap();

  registerErrorMiddleware(app);

  const server = app.listen(port, host, () => {
    console.log(`http://${host}:${port}`);
  });

  const serverName = clustering ? "Express worker" : "Express";

  gracefulShutdown({
    server,
    name: serverName,
    shutdownTimeout: SHUTDOWN_TIMEOUT,
    activeRequests,
    onShutdown: () => {
      console.log(`${serverName}: shutdown started`);
    },
  });

  if (clustering) {
    registerWorkerShutdownMessage(() => {
      triggerGracefulShutdown("shutdown");
    });
  }
}
