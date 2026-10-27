const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const V1_PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HEADER_LEN = 16 + 12 + 16;
const MIN_BLOB_LEN = HEADER_LEN + 16;
const DATA_DIR = path.join(__dirname, "..", "data");
const KEY_FILE = path.join(DATA_DIR, "master.key");

let envKey = "";
let cachedSecret = null;

function configure(env) {
  envKey = String((env && env.MASTER_KEY) || "").trim();
  cachedSecret = null;
}

function readKeyFile() {
  try {
    if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, "utf8").trim();
  } catch (e) {}
  return "";
}

function secret() {
  if (cachedSecret) return cachedSecret;
  if (envKey) {
    cachedSecret = envKey;
    return cachedSecret;
  }
  const fromFile = readKeyFile();
  if (fromFile) {
    cachedSecret = fromFile;
    return cachedSecret;
  }
  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, generated + "\n", { mode: 0o600 });
    fs.chmodSync(KEY_FILE, 0o600);
    console.log("Encryption key generated: data/master.key (keep this file secret)");
  } catch (e) {
    console.log("WARNING: could not write data/master.key: " + e.message);
  }
  cachedSecret = generated;
  return cachedSecret;
}

function legacyKey() {
  const src = envKey || readKeyFile();
  if (!src) return null;
  if (/^[0-9a-f]{64}$/i.test(src)) return Buffer.from(src, "hex");
  return crypto.createHash("sha256").update(src).digest();
}

function isV1(value) {
  return typeof value === "string" && value.indexOf(V1_PREFIX) === 0;
}

function isV2(value) {
  if (typeof value !== "string") return false;
  if (value.indexOf(".") > -1) return false;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) return false;
  if (value.length < Math.ceil(MIN_BLOB_LEN / 3) * 4 - 4) return false;
  return Buffer.from(value, "base64").length >= MIN_BLOB_LEN;
}

function isEncrypted(value) {
  return isV1(value) || isV2(value);
}

function decryptV1(value) {
  const parts = value.slice(V1_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  const key = legacyKey();
  if (!key) return null;
  try {
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const data = Buffer.from(parts[2], "base64");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (e) {
    return null;
  }
}

function decryptV2(value) {
  let raw;
  try {
    raw = Buffer.from(value, "base64");
  } catch (e) {
    return null;
  }
  if (raw.length <= HEADER_LEN) return null;
  try {
    const salt = raw.subarray(0, 16);
    const iv = raw.subarray(16, 28);
    const tag = raw.subarray(28, 44);
    const data = raw.subarray(44);
    const key = crypto.scryptSync(secret(), salt, 32, SCRYPT);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (e) {
    return null;
  }
}

function encryptToken(plain) {
  let text = String(plain == null ? "" : plain);
  if (!text) return text;
  if (isV2(text)) return text;
  if (isV1(text)) {
    const upgraded = decryptV1(text);
    if (upgraded === null) return text;
    text = upgraded;
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret(), salt, 32, SCRYPT);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const packed = Buffer.concat([salt, iv, cipher.getAuthTag(), enc]);
  return packed.toString("base64");
}

function decryptToken(value) {
  const text = String(value == null ? "" : value);
  if (!text) return text;
  if (isV1(text)) return decryptV1(text);
  if (isV2(text)) return decryptV2(text);
  return text;
}

module.exports = {
  configure: configure,
  ensureKey: secret,
  isEncrypted: isEncrypted,
  isV1: isV1,
  isV2: isV2,
  encryptToken: encryptToken,
  decryptToken: decryptToken
};
