module.exports = function createProxyRequestTracker() {
  const activeRequests = new Set();

  function track(proxyReq) {
    activeRequests.add(proxyReq);

    proxyReq.once("close", () => {
      activeRequests.delete(proxyReq);
    });
  }

  return {
    track,
    activeRequests,
  };
}
