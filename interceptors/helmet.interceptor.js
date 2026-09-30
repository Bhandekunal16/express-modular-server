const { helmet } = require("../provider/dependency.map");
const { helmet: helmetConfig } = require("../provider/config.map");

module.exports = function helmetInterceptor(app) {
  app.use(Object.keys(helmetConfig).length ? helmet(helmetConfig) : helmet());
};
