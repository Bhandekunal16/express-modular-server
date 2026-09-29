const { os, cluster } = require("../dependency.map");

let clusterShuttingDown = false;

function markClusterShuttingDown() {
  clusterShuttingDown = true;
}

function isClusterShuttingDown() {
  return clusterShuttingDown;
}

module.exports = function clustering() {
  if (cluster.isPrimary) {
    const numCPUs = os.cpus().length;

    for (let cpu = 0; cpu < numCPUs; cpu++) {
      cluster.fork();
    }

    cluster.on("exit", (worker, _, __) => {
      if (clusterShuttingDown) {
        console.log(`Cluster primary: worker ${worker.process.pid} exited`);
        return;
      }

      console.log(`Worker ${worker.process.pid} died. Forking a new worker...`);
      cluster.fork();
    });
  }
};

module.exports.markClusterShuttingDown = markClusterShuttingDown;
module.exports.isClusterShuttingDown = isClusterShuttingDown;
