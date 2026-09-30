const environment = {
  config: require("./json/config.json"),
  app: require("./json/app.json"),
};


module.exports = { ...environment.config, ...environment.app };


