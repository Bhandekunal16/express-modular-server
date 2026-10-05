const { logByte, http } = require("./provider/dependency.map");

module.exports = function replicate(app, host, port, replicate) {
  const ports = replicate ? [port, port + 1, port + 2] : [port];

  return ports.map((nodePort) => {
    const server = http.createServer(app);

    server.listen(nodePort, host, () => {
      logByte.info(`Backend server (http://${host}:${nodePort})`);
    });

    return server;
  });
};
