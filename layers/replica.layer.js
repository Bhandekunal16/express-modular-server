const { logByte, http } = require("../provider/dependency.map");

module.exports = function replicate(app, host, port, replicate, replicas) {
  const ports = [];

  if (!replicate) {
    ports.push(port);
  } else {
    const replicaCount =
      Number.isInteger(replicas) && replicas > 0 ? replicas : 1;

    for (let i = 0; i < replicaCount; i++) {
      ports.push(port + i);
    }
  }

  return ports.map((nodePort) => {
    const server = http.createServer(app);

    server.listen(nodePort, host, () => {
      logByte.info(`Backend server (http://${host}:${nodePort})`);
    });

    return server;
  });
};
