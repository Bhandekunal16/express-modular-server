const { express, cluster } = require("./dependency.map");
const { clusterInterceptor } = require("./interceptor.map");
const { host, port } = require("./json/app.json");
const { clustering } = require("./json/config.json");
const { middleware, errorMiddleware } = require("./middleware.loader");

const app = express();

middleware(app);

app.get("/", (_, res) => {
  res.json({
    message: "hello world",
  });
});

app.use((_, res) => {
  res.status(404).json({
    status: false,
    statusCode: 404,
    message: "Not Found",
  });
});

if (clustering && cluster.isPrimary) {
  clusterInterceptor();
} else {
  errorMiddleware(app);

  app.listen(port, host, () => {
    console.log(`http://${host}:${port}`);
  });
}
