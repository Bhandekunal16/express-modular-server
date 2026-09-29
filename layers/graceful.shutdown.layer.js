const { cluster } = require("../dependency.map");

let shutdownStarted = false;
let shutdownConfig = null;

function isShuttingDown() {
  return shutdownStarted;
}

function waitForActiveRequests(activeRequests, name, checkIntervalMs = 100) {
  return new Promise((resolve) => {
    if (!activeRequests || activeRequests.size === 0) {
      resolve();
      return;
    }

    console.log(`${name}: waiting for active requests`);

    const interval = setInterval(() => {
      if (!activeRequests || activeRequests.size === 0) {
        clearInterval(interval);
        resolve();
      }
    }, checkIntervalMs);
  });
}

function destroyActiveRequests(activeRequests, name) {
  if (!activeRequests || activeRequests.size === 0) {
    return;
  }

  const count = activeRequests.size;
  console.log(`${name}: destroying ${count} active requests`);

  for (const item of activeRequests) {
    try {
      if (item && item.socket && !item.socket.destroyed) {
        item.socket.destroy();
      } else if (
        item &&
        typeof item.destroy === "function" &&
        !item.destroyed
      ) {
        item.destroy();
      }
    } catch (_) {
      // already destroyed or closed
    }
  }

  activeRequests.clear();
}

function runGracefulShutdown(signal) {
  if (!shutdownConfig || shutdownStarted) {
    return;
  }

  shutdownStarted = true;

  const { server, name, shutdownTimeout, activeRequests, onShutdown } =
    shutdownConfig;

  console.log(`${signal} received. Starting graceful shutdown...`);
  console.log(`${name}: stopping new requests`);

  if (typeof onShutdown === "function") {
    onShutdown();
  }

  const forceTimer = setTimeout(() => {
    console.log(`${name}: shutdown timeout`);
    destroyActiveRequests(activeRequests, name);
    process.exit(1);
  }, shutdownTimeout);

  server.close((err) => {
    if (err) {
      console.error(`${name}: server.close error:`, err.message);
    }

    waitForActiveRequests(activeRequests, name).then(() => {
      clearTimeout(forceTimer);
      console.log(`${name}: shutdown complete`);
      process.exit(0);
    });
  });
}

function gracefulShutdown(options) {
  shutdownConfig = options;

  process.once("SIGTERM", () => runGracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => runGracefulShutdown("SIGINT"));
}

function triggerGracefulShutdown(signal) {
  runGracefulShutdown(signal);
}

let clusterShutdownStarted = false;

function registerClusterPrimaryShutdown({
  shutdownTimeout,
  markClusterShuttingDown,
}) {
  const runClusterShutdown = (signal) => {
    if (clusterShutdownStarted) {
      return;
    }

    clusterShutdownStarted = true;
    shutdownStarted = true;

    console.log(`${signal} received. Starting graceful shutdown...`);
    console.log("Cluster primary: shutting down workers");

    if (typeof markClusterShuttingDown === "function") {
      markClusterShuttingDown();
    }

    const workers = Object.values(cluster.workers);

    for (const worker of workers) {
      try {
        worker.send("shutdown");
      } catch (_) {
        // worker may already be gone
      }
    }

    const forceTimer = setTimeout(() => {
      console.log("Cluster primary: shutdown timeout");
      for (const worker of Object.values(cluster.workers)) {
        try {
          worker.kill();
        } catch (_) {
          // ignore
        }
      }
      process.exit(1);
    }, shutdownTimeout);

    if (workers.length === 0) {
      clearTimeout(forceTimer);
      console.log("Cluster primary: shutdown complete");
      process.exit(0);
      return;
    }

    let remaining = workers.length;

    const onWorkerExit = () => {
      remaining -= 1;
      if (remaining <= 0) {
        cluster.removeListener("exit", onWorkerExit);
        clearTimeout(forceTimer);
        console.log("Cluster primary: shutdown complete");
        process.exit(0);
      }
    };

    cluster.on("exit", onWorkerExit);
  };

  process.once("SIGTERM", () => runClusterShutdown("SIGTERM"));
  process.once("SIGINT", () => runClusterShutdown("SIGINT"));
}

function registerWorkerShutdownMessage(onShutdownMessage) {
  if (!cluster.isWorker) {
    return;
  }

  process.on("message", (message) => {
    if (message === "shutdown") {
      onShutdownMessage();
    }
  });
}

module.exports = {
  gracefulShutdown,
  triggerGracefulShutdown,
  isShuttingDown,
  registerClusterPrimaryShutdown,
  registerWorkerShutdownMessage,
};
