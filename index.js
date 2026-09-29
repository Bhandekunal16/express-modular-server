const { express } = require("./dependency.map");
const { host, port } = require("./json/app.json");
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

errorMiddleware(app);

app.listen(port, host, () => {
  console.log(`http://${host}:${port}`);
});
