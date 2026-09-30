module.exports = function error(err, _req, res, _next) {
  res
    .status(err.status || 500)
    .json({ message: err.message, status: false, statusCode: 500 });
};
