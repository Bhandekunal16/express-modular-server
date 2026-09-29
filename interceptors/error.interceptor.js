module.exports = function error(error, _, res, _) {
  res
    .status(error.status || 500)
    .json({ message: error.message, status: false, statusCode: 500 });
};
