const crypto = require("crypto");
const {
  secretKey,
  algorithm,
  randomString,
  ENCODED_KEY,
  encryption_algorithm,
  Unicode_Transformation_Format,
} = require("../provider/config.map");

class encryption {
  #KEY;
  #IV;

  constructor() {
    this.#KEY = crypto.createHash(algorithm).update(secretKey).digest();
    this.#IV = Buffer.from(randomString);
  }

  encrypt(t) {
    const cipher = crypto.createCipheriv(
      encryption_algorithm,
      this.#KEY,
      this.#IV,
    );
    let encrypted = cipher.update(
      t,
      Unicode_Transformation_Format,
      ENCODED_KEY,
    );
    encrypted += cipher.final(ENCODED_KEY);
    return encrypted;
  }

  decrypt(i) {
    const decipher = crypto.createDecipheriv(
      encryption_algorithm,
      this.#KEY,
      this.#IV,
    );
    let decrypted = decipher.update(
      i,
      ENCODED_KEY,
      Unicode_Transformation_Format,
    );
    decrypted += decipher.final(Unicode_Transformation_Format);
    return decrypted;
  }
}

const encryptionService = new encryption();

function encryptionInterceptor(req, res, next) {
  try {
    if (req.body?.data) {
      req.body = JSON.parse(encryptionService.decrypt(req.body.data));
    }

    const originalJson = res.json.bind(res);

    res.json = function (body) {
      const encrypted = encryptionService.encrypt(JSON.stringify(body));

      return originalJson({
        data: encrypted,
      });
    };

    next();
  } catch (err) {
    console.error("Encryption error:", err);

    res.status(400).json({
      error: "Invalid encrypted data",
    });
  }
}

module.exports = encryptionInterceptor;
