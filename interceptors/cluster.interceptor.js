const { os, cluster } = require("../dependency.map");

module.exports = function clustering() {
  if (cluster.isPrimary) {
    const numCPUs = os.cpus().length;

    console.log({ number_of_cpu: numCPUs });

    for (let cpu = 0; cpu < numCPUs; cpu++) {
      cluster.fork();
    }

    cluster.on("exit", (worker, _, __) => {
      console.log(`Worker ${worker.process.pid} died. Forking a new worker...`);
      cluster.fork();
    });
  }
};
