const { express, cluster, logByte } = require("./provider/dependency.map");
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
const { middleware, errorMiddleware } = require("./middleware.loader");
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
  const app = express();

  middleware(app);

  const activeRequests = new Set();

  app.use((_, res, next) => {
    activeRequests.add(res);

    const release = () => {
      activeRequests.delete(res);
    };

    res.once("finish", release);
    res.once("close", release);

    next();
  });

  app.get("/", (_, res) => {
    res.json({
      message: "hello world",
    });
  });

  app.use((_, res) => {
    res.status(404).json({
      status: false,
      statusCode: 404,
      message: "Not Found",
    });
  });

  errorMiddleware(app);

  const server = app.listen(port, host, () => {
    logByte.info(`Backend server (http://${host}:${port})`);
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
