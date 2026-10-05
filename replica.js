const { logByte, http } = require("./provider/dependency.map");

module.exports = function replicate(app, host, port) {
  const ports = [port, port + 1, port + 2];

  return ports.map((nodePort) => {
    const server = http.createServer(app);

    server.listen(nodePort, host, () => {
      logByte.info(`Backend server (http://${host}:${nodePort})`);
    });

    return server;
  });
};