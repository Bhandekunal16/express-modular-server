const { helmet } = require("../provider/dependency.map");
const config = require("../json/helmet.config.json");

module.exports = function helmetInterceptor(app) {
  app.use(Object.keys(config).length ? helmet(config) : helmet());
};
