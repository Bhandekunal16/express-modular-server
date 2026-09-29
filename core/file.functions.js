const { fs, path } = require("../dependency.map");

module.exports = function append(log) {
  try {
    const logDir = path.join(process.cwd(), "logs");

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const date = new Date().toISOString().slice(0, 10);

    const filePath = path.join(logDir, `${date}.txt`);

    fs.appendFileSync(filePath, `${log}\n`);
  } catch (e) {
    throw new Error(e.message);
  }
};
