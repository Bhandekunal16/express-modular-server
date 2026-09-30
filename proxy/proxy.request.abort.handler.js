module.exports = function fallbackProxy(req, proxyReq) {
  function destroyProxyRequest() {
    if (!proxyReq.destroyed) proxyReq.destroy();
  }

  req.once("aborted", destroyProxyRequest);
  req.once("error", destroyProxyRequest);

  req.once("close", () => {
    if (!req.complete) destroyProxyRequest();
  });
};
