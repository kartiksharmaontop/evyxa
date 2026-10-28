const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const V1_PREFIX = "enc:v1:";
const V3_PREFIX = "shield:v3:";
const ALGO = "aes-256-gcm";
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HEADER_LEN = 16 + 12 + 16;
const MIN_BLOB_LEN = HEADER_LEN + 16;
const DATA_DIR = path.join(__dirname, "..", "data");
const KEY_FILE = path.join(DATA_DIR, "master.key");
const SHIELD_DIR = path.join(DATA_DIR, ".shield");
const TICKETS_DIR = path.join(SHIELD_DIR, "tickets");

let envKey = "";
let cachedSecret = null;
const ticketCache = new Map();

function configure(env) {
  envKey = String((env && env.MASTER_KEY) || "").trim();
  cachedSecret = null;
}

function ensureTicketsDir() {
  try {
    fs.mkdirSync(TICKETS_DIR, { recursive: true, mode: 0o700 });
  } catch (e) {}
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

function isV3(value) {
  return typeof value === "string" && value.indexOf(V3_PREFIX) === 0;
}

function isEncrypted(value) {
  return isV3(value) || isV2(value) || isV1(value);
}

function readTicket(ticketId) {
  if (!ticketId || typeof ticketId !== "string" || !/^[0-9a-f]{16,64}$/i.test(ticketId)) {
    return null;
  }
  if (ticketCache.has(ticketId)) {
    return ticketCache.get(ticketId);
  }
  const ticketPath = path.join(TICKETS_DIR, ticketId + ".ticket");
  try {
    if (!fs.existsSync(ticketPath)) return null;
    const hex = fs.readFileSync(ticketPath, "utf8").trim();
    if (!hex || hex.length !== 64) return null;
    const buf = Buffer.from(hex, "hex");
    ticketCache.set(ticketId, buf);
    return buf;
  } catch (e) {
    return null;
  }
}

function writeTicket(ticketId, shardKey) {
  ensureTicketsDir();
  const ticketPath = path.join(TICKETS_DIR, ticketId + ".ticket");
  try {
    fs.writeFileSync(ticketPath, shardKey.toString("hex"), { mode: 0o600 });
    fs.chmodSync(ticketPath, 0o600);
    ticketCache.set(ticketId, shardKey);
    return true;
  } catch (e) {
    console.warn("WARNING: could not write ticket shard: " + e.message);
    return false;
  }
}

function deleteTicket(ticketId) {
  if (!ticketId || typeof ticketId !== "string") return false;
  ticketCache.delete(ticketId);
  const ticketPath = path.join(TICKETS_DIR, ticketId + ".ticket");
  try {
    if (fs.existsSync(ticketPath)) {
      fs.unlinkSync(ticketPath);
      return true;
    }
  } catch (e) {}
  return false;
}

function clearTicketCache() {
  ticketCache.clear();
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

function encryptV3(plain) {
  const text = String(plain == null ? "" : plain);
  if (!text) return text;

  const tokenBytes = Buffer.from(text, "utf8");
  const canaryHead = crypto.randomBytes(16);
  const canaryTail = crypto.randomBytes(16);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(tokenBytes.length, 0);

  const payload = Buffer.concat([canaryHead, lenBuf, tokenBytes, canaryTail]);

  const ticketId = crypto.randomBytes(16).toString("hex");
  const shardKey = crypto.randomBytes(32);

  if (!writeTicket(ticketId, shardKey)) {
    return null;
  }

  const combinedSecret = crypto.createHmac("sha256", secret()).update(shardKey).digest();

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derivedKey = crypto.scryptSync(combinedSecret, salt, 64, SCRYPT);
  const aesKey = derivedKey.subarray(0, 32);
  const integrityKey = derivedKey.subarray(32, 64);

  const hmac = crypto.createHmac("sha256", integrityKey).update(payload).digest();
  const camouflaged = Buffer.concat([payload, hmac]);

  const cipher = crypto.createCipheriv(ALGO, aesKey, iv);
  cipher.setAAD(Buffer.from(ticketId, "utf8"));
  const encrypted = Buffer.concat([cipher.update(camouflaged), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const blob = Buffer.concat([salt, iv, authTag, encrypted]).toString("base64");
  return V3_PREFIX + ticketId + ":" + blob;
}

function decryptV3(value) {
  if (!isV3(value)) return null;

  const parts = value.slice(V3_PREFIX.length).split(":");
  if (parts.length !== 2) return null;

  const ticketId = parts[0];
  const blobB64 = parts[1];

  const shardKey = readTicket(ticketId);
  if (!shardKey) return null;

  let raw;
  try {
    raw = Buffer.from(blobB64, "base64");
  } catch (e) {
    return null;
  }

  if (raw.length < HEADER_LEN + 1) return null;

  const salt = raw.subarray(0, 16);
  const iv = raw.subarray(16, 28);
  const authTag = raw.subarray(28, 44);
  const ciphertext = raw.subarray(44);

  const combinedSecret = crypto.createHmac("sha256", secret()).update(shardKey).digest();
  const derivedKey = crypto.scryptSync(combinedSecret, salt, 64, SCRYPT);
  const aesKey = derivedKey.subarray(0, 32);
  const integrityKey = derivedKey.subarray(32, 64);

  let camouflaged;
  try {
    const decipher = crypto.createDecipheriv(ALGO, aesKey, iv);
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(ticketId, "utf8"));
    camouflaged = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    return null;
  }

  if (camouflaged.length < 16 + 4 + 16 + 32) return null;

  const payloadLen = camouflaged.length - 32;
  const payload = camouflaged.subarray(0, payloadLen);
  const hmac = camouflaged.subarray(payloadLen);

  const expectedHmac = crypto.createHmac("sha256", integrityKey).update(payload).digest();
  if (!crypto.timingSafeEqual(hmac, expectedHmac)) {
    return null;
  }

  const tokenLen = payload.readUInt32BE(16);
  if (16 + 4 + tokenLen + 16 !== payload.length) {
    return null;
  }

  const tokenBytes = payload.subarray(20, 20 + tokenLen);
  return tokenBytes.toString("utf8");
}

function encryptToken(plain) {
  let text = String(plain == null ? "" : plain);
  if (!text) return text;
  if (isV3(text)) return text;
  if (isV2(text)) {
    const upgraded = decryptV2(text);
    if (upgraded === null) return text;
    text = upgraded;
  } else if (isV1(text)) {
    const upgraded = decryptV1(text);
    if (upgraded === null) return text;
    text = upgraded;
  }
  const shielded = encryptV3(text);
  return shielded || text;
}

function decryptToken(value) {
  const text = String(value == null ? "" : value);
  if (!text) return text;
  if (isV3(text)) return decryptV3(text);
  if (isV2(text)) return decryptV2(text);
  if (isV1(text)) return decryptV1(text);
  return text;
}

module.exports = {
  configure: configure,
  ensureKey: secret,
  isEncrypted: isEncrypted,
  isV1: isV1,
  isV2: isV2,
  isV3: isV3,
  encryptToken: encryptToken,
  decryptToken: decryptToken,
  deleteTicket: deleteTicket,
  clearTicketCache: clearTicketCache
};
