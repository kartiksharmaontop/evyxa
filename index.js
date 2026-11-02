const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const DATA_DIR = path.join(__dirname, "data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const LOGIN_DIR = path.join(DATA_DIR, "login");
const USERS_DIR = path.join(DATA_DIR, "users");
const BOTS_FILE = path.join(DATA_DIR, "bots.json");
const PLUGINS_DIR = path.join(__dirname, "src", "plugins");
const USER_PLUGINS_DIR = path.join(__dirname, "data", "plugins");
const PLUGIN_DIRS = [PLUGINS_DIR, USER_PLUGINS_DIR];
const htmlPath = path.join(__dirname, "dashboard", "views", "main.html");
const loginPath = path.join(__dirname, "dashboard", "views", "login.html");
const plansPath = path.join(__dirname, "dashboard", "views", "plans.html");
const docsPath = path.join(__dirname, "dashboard", "views", "docs.html");
const botDashboardPath = path.join(__dirname, "dashboard", "views", "dashboard.html");
const botHost = require("./dashboard/botHost.js");
const cryptoUtil = require("./dashboard/crypto.js");
const panelLog = require("./utils/log.js");

function loadEnv() {
  const env = {};
  try {
    const data = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    data.split(/\r?\n/).forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.charAt(0) === "#") return;
      const i = trimmed.indexOf("=");
      if (i === -1) return;
      env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
    });
  } catch (e) {}
  Object.keys(process.env).forEach(function (k) {
    if (process.env[k] !== undefined && process.env[k] !== "") env[k] = process.env[k];
  });
  return env;
}

function normalizeBase(value) {
  let s = String(value || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  s = s.replace(/\/+$/, "");
  const m = s.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (!m) return "";
  if (m[2] && m[2] !== "/") {
    console.log("WARNING: BASE_URL should not contain a path (got \"" + s + "\"), using origin only: " + m[1]);
  }
  return m[1];
}

function firstHeader(req, name) {
  const raw = req.headers[name];
  if (!raw) return "";
  return String(raw).split(",")[0].trim();
}

function requestOrigin(req) {
  let proto = firstHeader(req, "x-forwarded-proto") || firstHeader(req, "x-forwarded-protocol") || firstHeader(req, "x-scheme");
  if (!proto) proto = (req.socket && req.socket.encrypted) ? "https" : "http";
  if (proto !== "http" && proto !== "https") proto = "http";
  const host = firstHeader(req, "x-forwarded-host") || firstHeader(req, "x-forwarded-server") || firstHeader(req, "host") || ("localhost:" + PORT);
  return proto + "://" + host;
}

function redirectUri(req) {
  if (EXPLICIT_REDIRECT_URI) return EXPLICIT_REDIRECT_URI;
  if (BASE_URL) return BASE_URL + "/api/auth/callback";
  return requestOrigin(req) + "/api/auth/callback";
}

function requestSecure(req) {
  if (firstHeader(req, "x-forwarded-proto") === "https") return true;
  return !!(req.socket && req.socket.encrypted);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      if (fs.existsSync(file + ".bak")) {
        try {
          const bak = fs.readFileSync(file + ".bak", "utf8");
          if (bak && bak.trim()) return JSON.parse(bak);
        } catch (e) {}
      }
      return fallback;
    }
    const raw = fs.readFileSync(file, "utf8");
    if (!raw || !raw.trim()) {
      if (fs.existsSync(file + ".bak")) {
        try {
          const bak = fs.readFileSync(file + ".bak", "utf8");
          if (bak && bak.trim()) return JSON.parse(bak);
        } catch (e) {}
      }
      return fallback;
    }
    return JSON.parse(raw);
  } catch (e) {
    try {
      if (fs.existsSync(file + ".bak")) {
        const bak = fs.readFileSync(file + ".bak", "utf8");
        if (bak && bak.trim()) return JSON.parse(bak);
      }
    } catch (err) {}
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(data, null, 2);
    const tmp = file + ".tmp." + process.pid + "." + Date.now();
    fs.writeFileSync(tmp, content, "utf8");
    if (fs.existsSync(file)) {
      try {
        fs.copyFileSync(file, file + ".bak");
      } catch (e) {}
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {}
  }
}

function getCookies(req) {
  const out = {};
  const header = req.headers && req.headers.cookie;
  if (!header) return out;
  header.split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i > -1) {
      const k = part.slice(0, i).trim();
      const rawVal = part.slice(i + 1).trim();
      try {
        out[k] = decodeURIComponent(rawVal);
      } catch (e) {
        out[k] = rawVal;
      }
    }
  });
  return out;
}

const env = loadEnv();
const PORT = parseInt(env.PORT, 10) || 3000;
const DISCORD_CLIENT_ID = env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = env.DISCORD_CLIENT_SECRET || "";
const BASE_URL = normalizeBase(env.BASE_URL || env.SITE_URL || env.APP_URL || "");
const EXPLICIT_REDIRECT_URI = String(env.DISCORD_REDIRECT_URI || "").trim().replace(/\/+$/, "");
const ALLOWED_IDS = (env.ALLOWED_IDS || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
panelLog.configure(env);

cryptoUtil.configure(env);

const pendingStates = {};

const COOKIE_MAX_AGE = 14 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function userFile(userId) {
  return path.join(LOGIN_DIR, String(userId).replace(/[^a-zA-Z0-9_-]/g, "") + ".json");
}

function readUser(userId) {
  return readJson(userFile(userId), null);
}

function writeUser(userId, data) {
  writeJson(userFile(userId), data);
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "");
}

const PLUGIN_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];
const PLUGIN_IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };

function sanitizePluginId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function parsePluginReadme(file) {
  let raw = "";
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { return { header: {}, body: "" }; }
  const lines = raw.split(/\r?\n/);
  const header = {};
  const known = ["name", "tag", "description", "version", "author"];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (known.indexOf(key) === -1) break;
    header[key] = m[2].trim();
  }
  return { header: header, body: lines.slice(i).join("\n") };
}

function extractPluginConfig(body) {
  const m = String(body || "").match(/```config\s*\r?\n([\s\S]*?)```/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]);
    if (!parsed || !Array.isArray(parsed.fields)) return [];
    return parsed.fields.map(function (f) {
      const rawType = String(f.type || "").toLowerCase().trim();
      let type = "text";
      if (rawType === "color") type = "color";
      else if (rawType === "toggle" || rawType === "boolean") type = "toggle";
      return {
        key: String(f.key || "").trim(),
        type: type,
        label: String(f.label || f.key || "").trim(),
        def: String(f.default === undefined || f.default === null ? "" : f.default).trim()
      };
    }).filter(function (f) { return /^[a-zA-Z0-9_-]{1,40}$/.test(f.key); });
  } catch (e) { return []; }
}

function extractPluginEmbedMode(body) {
  const m = String(body || "").match(/```config\s*\r?\n([\s\S]*?)```/);
  if (!m) return "full";
  try {
    const parsed = JSON.parse(m[1]);
    return parsed && String(parsed.embed || "").toLowerCase() === "color" ? "color" : "full";
  } catch (e) { return "full"; }
}

function readPluginCommands(dir) {
  try {
    const mainPath = path.join(dir, "main", "index.js");
    delete require.cache[require.resolve(mainPath)];
    const mod = require(mainPath);
    const list = Array.isArray(mod && mod.commands) ? mod.commands : [];
    const seen = {};
    const out = [];
    list.forEach(function (c) {
      const name = String((c && c.name) || "").toLowerCase().trim();
      if (!name || seen[name]) return;
      seen[name] = 1;
      const rawAliases = Array.isArray(c && c.aliases) ? c.aliases : (typeof (c && c.aliases) === "string" ? String(c.aliases).split(",") : []);
      const cleanAliases = rawAliases.map(function (a) { return String(a || "").toLowerCase().trim(); }).filter(Boolean);
      const allowAliases = c ? (c.allowAliases !== undefined ? !!c.allowAliases : (c.allowAlias !== undefined ? !!c.allowAlias : true)) : true;
      const category = (c && typeof c.category === "string" && c.category.trim()) ? c.category.trim() : "General";
      const uPerms = Array.isArray(c && c.userPermissions) ? c.userPermissions : (Array.isArray(c && c.permissions) ? c.permissions : []);
      const bPerms = Array.isArray(c && c.botPermissions) ? c.botPermissions : [];

      out.push({
        name: name,
        category: category,
        description: String((c && c.description) || "").trim(),
        cooldown: (c && typeof c.cooldown === "number") ? c.cooldown : null,
        userPermissions: uPerms,
        botPermissions: bPerms,
        slash: !!(c && c.slash !== false),
        prefix: !!(c && c.prefix),
        aliases: cleanAliases,
        allowAliases: allowAliases
      });
    });
    return out;
  } catch (e) { return []; }
}

function readPluginConfig(dir, readmeBody) {
  let fields = [];
  try {
    const mainPath = path.join(dir, "main", "index.js");
    delete require.cache[require.resolve(mainPath)];
    const mod = require(mainPath);
    if (mod && Array.isArray(mod.config)) {
      fields = mod.config;
    }
  } catch (e) {}

  if (!fields.length) {
    fields = extractPluginConfig(readmeBody);
  }

  const seen = {};
  const out = [];
  (Array.isArray(fields) ? fields : []).forEach(function (f) {
    if (!f || typeof f !== "object") return;
    const key = String(f.key || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key) || seen[key]) return;
    seen[key] = 1;
    const rawType = String(f.type || "").toLowerCase().trim();
    if (rawType === "color") return;
    let type = "text";
    if (rawType === "password" || rawType === "secret") type = "password";
    else if (rawType === "number" || rawType === "int" || rawType === "integer") type = "number";
    else if (rawType === "toggle" || rawType === "boolean" || rawType === "bool") type = "toggle";

    out.push({
      key: key,
      label: String(f.label || f.name || key).trim(),
      type: type,
      description: String(f.description || f.desc || "").trim(),
      placeholder: String(f.placeholder || "").trim(),
      def: String(f.default === undefined || f.default === null ? (f.def === undefined ? "" : f.def) : f.default).trim()
    });
  });
  return out;
}

function findPluginImage(dir) {
  let files = [];
  try { files = fs.readdirSync(path.join(dir, "images")); } catch (e) { return null; }
  files = files.filter(function (n) {
    return PLUGIN_IMAGE_EXTS.indexOf(path.extname(n).toLowerCase()) > -1 && /^[a-zA-Z0-9._-]+$/.test(n);
  }).sort();
  return files.length ? files[0] : null;
}

function findPluginDir(id) {
  if (sanitizePluginId(id) !== id) return null;
  for (let i = 0; i < PLUGIN_DIRS.length; i++) {
    const dir = path.join(PLUGIN_DIRS[i], id);
    try { if (fs.statSync(dir).isDirectory()) return dir; } catch (e) {}
  }
  return null;
}

function pluginSourceMeta(dir) {
  const hash = crypto.createHash("sha1");
  let latestMtime = 0;
  const skipDirs = { node_modules: 1, ".git": 1 };
  const skipFiles = { ".DS_Store": 1, "Thumbs.db": 1 };
  function walk(current, prefix) {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (e) { return; }
    entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
    entries.forEach(function (entry) {
      if (entry.isSymbolicLink()) return;
      const full = path.join(current, entry.name);
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (skipDirs[entry.name]) return;
        walk(full, rel);
        return;
      }
      if (!entry.isFile() || skipFiles[entry.name]) return;
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
        const data = fs.readFileSync(full);
        hash.update(rel);
        hash.update("\0");
        hash.update(data);
        hash.update("\0");
      } catch (e) {}
    });
  }
  walk(dir, "");
  return {
    fingerprint: hash.digest("hex"),
    latestMtime: latestMtime
  };
}

function versionParts(value) {
  return String(value || "").split(/[^0-9]+/).filter(Boolean).map(function (n) {
    return parseInt(n, 10);
  });
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function pluginUpdateState(entry, plugin) {
  if (!entry || !plugin) return false;
  if (entry.fingerprint && plugin.fingerprint) {
    return entry.fingerprint !== plugin.fingerprint;
  }
  if (entry.version && plugin.version) {
    const cmp = compareVersions(plugin.version, entry.version);
    if (cmp < 0) return false;
    if (cmp > 0) return true;
  }
  const installedAt = Date.parse(entry.installedAt || "");
  if (Number.isFinite(installedAt) && plugin.latestMtime) {
    return plugin.latestMtime > installedAt + 1000;
  }
  return false;
}

function loadPluginModule(id) {
  const dir = findPluginDir(id);
  if (!dir) return null;
  try {
    const mainPath = require.resolve(path.join(dir, "main", "index.js"));
    delete require.cache[mainPath];
    return require(mainPath);
  } catch (e) {
    return null;
  }
}

function callPluginHook(id, hook, ctx) {
  const mod = loadPluginModule(id);
  if (!mod || typeof mod[hook] !== "function") return;
  try {
    const r = mod[hook](ctx);
    if (r && typeof r.catch === "function") r.catch(function () {});
  } catch (e) {}
}

function pluginActiveForUser(userId, pid) {
  const base = path.join(USERS_DIR, String(userId).replace(/[^a-zA-Z0-9_-]/g, ""));
  let ids = [];
  try { ids = fs.readdirSync(base); } catch (e) { return false; }
  for (let i = 0; i < ids.length; i++) {
    const data = readJson(path.join(base, ids[i], "bot.json"), null);
    const entry = data && data.plugins && data.plugins[pid];
    if (entry && entry.enabled !== false) return true;
  }
  return false;
}

function pluginActiveAnywhere(pid) {
  let users = [];
  try { users = fs.readdirSync(USERS_DIR); } catch (e) { return false; }
  for (let i = 0; i < users.length; i++) {
    if (pluginActiveForUser(users[i], pid)) return true;
  }
  return false;
}

function matchPluginRoute(pattern, pathname) {
  const pp = String(pattern || "/").split("/").filter(Boolean);
  const ap = String(pathname || "/").split("/").filter(Boolean);
  if (ap.length !== pp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i];
    if (seg.charAt(0) === ":") {
      params[seg.slice(1)] = decodeURIComponent(ap[i]);
    } else if (seg !== ap[i]) {
      return null;
    }
  }
  return params;
}

function handlePluginRoute(req, res, url, session) {
  if (url.indexOf("/p/") !== 0) return false;
  const rest = url.slice(3);
  const slash = rest.indexOf("/");
  if (slash < 1) return false;
  const pid = rest.slice(0, slash);
  if (sanitizePluginId(pid) !== pid) return false;
  if (!pluginActiveAnywhere(pid)) return false;
  const mod = loadPluginModule(pid);
  if (!mod || !Array.isArray(mod.routes)) return false;
  const pathname = rest.slice(slash);
  for (let i = 0; i < mod.routes.length; i++) {
    const r = mod.routes[i];
    if (!r || typeof r.handler !== "function") continue;
    const method = String(r.method || "GET").toUpperCase();
    if (method !== req.method) continue;
    const params = matchPluginRoute(r.path, pathname);
    if (!params) continue;
    if (!r.public) {
      if (!session) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
        return true;
      }
      if (!pluginActiveForUser(session.userId, pid)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Plugin is not enabled for your bots" }));
        return true;
      }
    }
    try {
      const out = r.handler(req, res, { session: session || null, params: params, pluginId: pid });
      if (out && typeof out.catch === "function") {
        out.catch(function () {
          if (!res.writableEnded) {
            try { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Plugin route failed" })); } catch (e) {}
          }
        });
      }
    } catch (e) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Plugin route failed" }));
      }
    }
    return true;
  }
  return false;
}

const PLUGIN_UPLOAD_EXTS = [".js", ".mjs", ".json", ".md", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".css", ".html"];

function parseZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("Not a valid zip file");
  let eocd = -1;
  const scanFrom = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid zip file");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > 300) throw new Error("Zip has too many files");
  const entries = [];
  let off = cdOffset;
  let totalOut = 0;
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error("Not a valid zip file");
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
    off += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error("Encrypted zips are not supported");
    totalOut += uncompSize;
    if (totalOut > 8 * 1024 * 1024) throw new Error("Zip content is too large");
    entries.push({ name: name, method: method, compSize: compSize, uncompSize: uncompSize, localOff: localOff });
  }
  const files = [];
  for (let n = 0; n < entries.length; n++) {
    const e = entries[n];
    if (e.name.slice(-1) === "/") continue;
    const name = e.name.replace(/\\/g, "/");
    if (!name || name.charAt(0) === "/" || name.split("/").some(function (s) { return s === "" || s === "." || s === ".."; })) {
      throw new Error("Unsafe file path in zip");
    }
    const ext = path.extname(name).toLowerCase();
    if (PLUGIN_UPLOAD_EXTS.indexOf(ext) === -1) throw new Error("File type not allowed: " + (ext || name));
    const lh = e.localOff;
    if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("Not a valid zip file");
    const lNameLen = buf.readUInt16LE(lh + 26);
    const lExtraLen = buf.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + lNameLen + lExtraLen;
    if (dataStart + e.compSize > buf.length) throw new Error("Not a valid zip file");
    const raw = buf.slice(dataStart, dataStart + e.compSize);
    let data;
    if (e.method === 0) data = Buffer.from(raw);
    else if (e.method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: 2 * 1024 * 1024 });
    else throw new Error("Unsupported zip compression method");
    files.push({ name: name, data: data });
  }
  if (!files.length) throw new Error("Zip is empty");
  return files;
}

function pluginRootOf(names) {
  const has = function (n) { return names.indexOf(n) > -1; };
  if (has("readme.md") && has("main/index.js")) return "";
  const tops = {};
  names.forEach(function (n) {
    const i = n.indexOf("/");
    if (i > 0) tops[n.slice(0, i)] = 1;
  });
  const keys = Object.keys(tops);
  if (keys.length === 1 && has(keys[0] + "/readme.md") && has(keys[0] + "/main/index.js")) return keys[0] + "/";
  throw new Error("Zip must contain readme.md and main/index.js");
}

function parseReadmeHeaderText(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  const header = {};
  const known = ["name", "tag", "description", "version", "author"];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (known.indexOf(key) === -1) break;
    header[key] = m[2].trim();
  }
  return header;
}

function nextPluginId(name, version) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "plugin";
  const major = (String(version || "1.0.0").match(/\d+/) || ["1"])[0];
  let counter = 1;
  PLUGIN_DIRS.forEach(function (base) {
    let names = [];
    try { names = fs.readdirSync(base); } catch (e) {}
    names.forEach(function (id) {
      const m = id.match(/^(\d{5})-/);
      if (m) {
        const n = parseInt(m[1], 10) + 1;
        if (n > counter) counter = n;
      }
    });
  });
  let id = "";
  do {
    id = String(counter).padStart(5, "0") + "-" + slug + "-v" + major;
    counter++;
  } while (findPluginDir(id));
  return id;
}

function handlePluginUpload(req, res, session, url) {
  if (req.method !== "POST" || url !== "/api/plugins/upload") return false;
  if (!session) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    return true;
  }
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on("data", function (c) {
    size += c.length;
    if (size > 2 * 1024 * 1024) { tooBig = true; return; }
    chunks.push(c);
  });
  req.on("end", function () {
    if (tooBig) {
      res.writeHead(413, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Zip is too large (max 2 MB)" }));
    }
    let destRoot = null;
    try {
      const files = parseZipEntries(Buffer.concat(chunks));
      const names = files.map(function (f) { return f.name; });
      const root = pluginRootOf(names);
      const readmeFile = files.filter(function (f) { return f.name === root + "readme.md"; })[0];
      const header = parseReadmeHeaderText(readmeFile ? readmeFile.data.toString("utf8") : "");
      if (!header.name) throw new Error("readme.md must start with a name: header");
      const id = nextPluginId(header.name, header.version);
      destRoot = path.join(USER_PLUGINS_DIR, id);
      files.forEach(function (f) {
        let rel = f.name;
        if (root && rel.indexOf(root) === 0) rel = rel.slice(root.length);
        if (!rel || rel.slice(-1) === "/") return;
        const dest = path.join(destRoot, rel);
        if (dest.indexOf(destRoot + path.sep) !== 0) throw new Error("Unsafe file path in zip");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.data);
      });
      const check = parsePluginReadme(path.join(destRoot, "readme.md"));
      if (!check.header.name) throw new Error("Invalid readme.md");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: id }));
    } catch (e) {
      if (destRoot) { try { fs.rmSync(destRoot, { recursive: true, force: true }); } catch (e2) {} }
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (e && e.message) || "Invalid plugin zip" }));
    }
  });
  return true;
}

function scanPlugins() {
  const seen = {};
  const out = [];
  PLUGIN_DIRS.forEach(function (base) {
    let names = [];
    try { names = fs.readdirSync(base); } catch (e) { names = []; }
    names.sort().forEach(function (id) {
      if (seen[id]) return;
      if (sanitizePluginId(id) !== id) return;
      const dir = path.join(base, id);
      let isDir = false;
      try { isDir = fs.statSync(dir).isDirectory(); } catch (e) {}
      if (!isDir) return;
      seen[id] = 1;
      const readme = parsePluginReadme(path.join(dir, "readme.md"));
      const source = pluginSourceMeta(dir);
      out.push({
        id: id,
        name: readme.header.name || id,
        tag: readme.header.tag || "Plugin",
        description: readme.header.description || "",
        version: readme.header.version || "1.0.0",
        author: readme.header.author || "",
        image: findPluginImage(dir),
        commands: readPluginCommands(dir),
        config: readPluginConfig(dir, readme.body),
        embedMode: extractPluginEmbedMode(readme.body),
        readme: readme.body,
        fingerprint: source.fingerprint,
        latestMtime: source.latestMtime
      });
    });
  });
  return out;
}

function pluginEntry(bot, id) {
  if (!bot || typeof bot !== "object" || !bot.plugins || typeof bot.plugins !== "object") return null;
  const entry = bot.plugins[id];
  return (entry && typeof entry === "object") ? entry : null;
}

function pluginCommandCollisions(bot, plugin) {
  const warns = [];
  const enabledIds = {};
  Object.keys(bot.plugins || {}).forEach(function (id) {
    if (id === plugin.id) return;
    const e = bot.plugins[id];
    if (e && e.enabled !== false) enabledIds[id] = 1;
  });
  const owners = {};
  scanPlugins().forEach(function (p) {
    if (!enabledIds[p.id]) return;
    p.commands.forEach(function (c) { owners[c.name] = p.name; });
  });
  plugin.commands.forEach(function (c) {
    if (owners[c.name]) warns.push("Command '" + c.name + "' is already used by " + owners[c.name]);
  });
  return warns;
}

function resolvePluginCommandConflicts(bot, plugin, userId) {
  const disabled = [];
  if (!bot || !bot.plugins || typeof bot.plugins !== "object" || !plugin) return disabled;

  const catalog = scanPlugins();
  const targetCmdMap = {};
  (plugin.commands || []).forEach(function (c) {
    if (c && c.name) {
      targetCmdMap[String(c.name).toLowerCase()] = true;
    }
  });

  const targetEntry = bot.plugins[plugin.id] || {};
  const targetConfig = (targetEntry.config && typeof targetEntry.config === "object") ? targetEntry.config : {};
  Object.keys(targetConfig).forEach(function (k) {
    if (k === "aliases" || k.startsWith("aliases_")) {
      const parts = String(targetConfig[k] || "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      parts.forEach(function (a) { targetCmdMap[a] = true; });
    }
  });

  Object.keys(bot.plugins).forEach(function (otherId) {
    if (otherId === plugin.id) return;
    const otherEntry = bot.plugins[otherId];
    if (!otherEntry || otherEntry.enabled === false) return;

    const otherPlugin = catalog.find(function (p) { return p.id === otherId; });
    if (!otherPlugin) return;

    let hasConflict = false;
    let conflictCmd = "";

    (otherPlugin.commands || []).forEach(function (c) {
      if (c && c.name) {
        const cname = String(c.name).toLowerCase();
        if (targetCmdMap[cname]) {
          hasConflict = true;
          conflictCmd = cname;
        }
      }
    });

    const otherConfig = (otherEntry.config && typeof otherEntry.config === "object") ? otherEntry.config : {};
    Object.keys(otherConfig).forEach(function (k) {
      if (k === "aliases" || k.startsWith("aliases_")) {
        const parts = String(otherConfig[k] || "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
        parts.forEach(function (a) {
          if (targetCmdMap[a]) {
            hasConflict = true;
            conflictCmd = a;
          }
        });
      }
    });

    if (hasConflict) {
      otherEntry.enabled = false;
      callPluginHook(otherId, "onToggle", { userId: userId, botId: bot.id, enabled: false, config: otherEntry.config || {} });
      disabled.push({
        id: otherId,
        name: otherPlugin.name || otherId,
        command: conflictCmd
      });
    }
  });

  return disabled;
}

function syncBotCommandConflictsOnBoot(bot, userId) {
  if (!bot || !bot.plugins || typeof bot.plugins !== "object") return false;
  const catalog = scanPlugins();
  let changed = false;
  const commandClaimants = {};

  const pluginIds = Object.keys(bot.plugins);
  for (let i = 0; i < pluginIds.length; i++) {
    const pid = pluginIds[i];
    const entry = bot.plugins[pid];
    if (!entry || entry.enabled === false) continue;

    const pMeta = catalog.find(function (p) { return p.id === pid; });
    if (!pMeta || !Array.isArray(pMeta.commands)) continue;

    pMeta.commands.forEach(function (c) {
      if (!c || !c.name) return;
      const cmdName = String(c.name).toLowerCase().trim();
      if (!commandClaimants[cmdName]) {
        commandClaimants[cmdName] = { pid: pid, meta: pMeta };
      } else {
        const prev = commandClaimants[cmdName];
        const isCurrentV2 = pid.endsWith("-v2");
        const isPrevV2 = prev.pid.endsWith("-v2");

        let winnerPid = prev.pid;
        let loserPid = pid;

        if (isCurrentV2 && !isPrevV2) {
          winnerPid = pid;
          loserPid = prev.pid;
          commandClaimants[cmdName] = { pid: pid, meta: pMeta };
        }

        if (bot.plugins[loserPid] && bot.plugins[loserPid].enabled !== false) {
          bot.plugins[loserPid].enabled = false;
          changed = true;
          console.log("[CONFLICT_SHIELD] Auto-resolved command conflict for bot " + (bot.username || bot.id) + ": disabled '" + loserPid + "' in favor of '" + winnerPid + "' for command '" + cmdName + "'");
        }
      }
    });
  }

  if (changed) {
    saveBotData(userId, bot);
  }
  return changed;
}

function connectPlugin(userId, botId, pluginId) {
  const linkDir = path.join(botDir(userId, botId), "plugins");
  fs.mkdirSync(linkDir, { recursive: true });
  const linkPath = path.join(linkDir, pluginId);
  const target = findPluginDir(pluginId);
  if (!target) return false;
  try {
    try { fs.lstatSync(linkPath); return true; } catch (e) {}
    fs.symlinkSync(path.relative(linkDir, target), linkPath, "dir");
    return true;
  } catch (e) {
    try {
      fs.writeFileSync(linkPath + ".json", JSON.stringify({ source: target, linkedAt: new Date().toISOString() }, null, 2));
      return true;
    } catch (e2) { return false; }
  }
}

function disconnectPlugin(userId, botId, pluginId) {
  const linkPath = path.join(botDir(userId, botId), "plugins", pluginId);
  try { fs.unlinkSync(linkPath); } catch (e) {}
  try { fs.unlinkSync(linkPath + ".json"); } catch (e) {}
}

const STATUS_TYPES = ["playing", "streaming", "listening", "watching", "competing"];

function statusTypeOf(s) {
  if (s && typeof s === "object") {
    const t = String(s.type || "").toLowerCase();
    if (STATUS_TYPES.indexOf(t) > -1) return t;
  }
  return "playing";
}

function statusTextOf(s) {
  if (typeof s === "string") return s.trim();
  if (s && typeof s === "object") return String(s.text || s.name || "").trim();
  return "";
}

function normalizeStatusList(list) {
  return (Array.isArray(list) ? list : [])
    .map(function (s) { return { type: statusTypeOf(s), text: statusTextOf(s) }; })
    .filter(function (s) { return s.text.length > 0; });
}

function defaultStatusList() {
  return [{ type: "playing", text: "Hosted by " + (env.NAME || "Arixa") }];
}

const PRESENCE_STATUSES = ["online", "idle", "dnd"];

const DEFAULT_THEME_COLORS = {
  main_v1: "#5865F2",
  main_v2: "#5865F2",
  warning: "#FAA61A",
  error: "#ED4245",
  cooldown: "#EB459E"
};

function normalizeThemeColors(input) {
  const isHex = function (c) {
    return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c.trim());
  };
  const src = (input && typeof input === "object") ? input : {};
  return {
    main_v1: isHex(src.main_v1) ? src.main_v1.trim().toUpperCase() : DEFAULT_THEME_COLORS.main_v1,
    main_v2: isHex(src.main_v2) ? src.main_v2.trim().toUpperCase() : DEFAULT_THEME_COLORS.main_v2,
    warning: isHex(src.warning) ? src.warning.trim().toUpperCase() : DEFAULT_THEME_COLORS.warning,
    error: isHex(src.error) ? src.error.trim().toUpperCase() : DEFAULT_THEME_COLORS.error,
    cooldown: isHex(src.cooldown) ? src.cooldown.trim().toUpperCase() : DEFAULT_THEME_COLORS.cooldown
  };
}

function normalizePresence(status) {
  const t = String(status || "").toLowerCase().trim();
  return PRESENCE_STATUSES.indexOf(t) > -1 ? t : "online";
}

function botDir(userId, botId) {
  return path.join(USERS_DIR, sanitizeId(userId), sanitizeId(botId));
}

function botFile(userId, botId) {
  return path.join(botDir(userId, botId), "bot.json");
}

function botDashDir(userId, botId) {
  return path.join(botDir(userId, botId), "dashboard");
}

function saveBotData(userId, bot) {
  const stored = Object.assign({}, bot);
  if (stored.token) stored.token = cryptoUtil.encryptToken(stored.token);
  writeJson(botFile(userId, stored.id), stored);
  fs.mkdirSync(botDashDir(userId, stored.id), { recursive: true });
  return botFile(userId, stored.id);
}

function botPlainToken(bot) {
  if (!bot || !bot.token) return "";
  const plain = cryptoUtil.decryptToken(bot.token);
  return plain === null ? "" : plain;
}

function listBotData(userId) {
  const userDir = path.join(USERS_DIR, sanitizeId(userId));
  let names = [];
  try { names = fs.readdirSync(userDir); } catch (e) { return []; }
  const out = [];
  names.forEach(function (n) {
    const b = readJson(path.join(userDir, n, "bot.json"), null);
    if (b && b.id) out.push(b);
  });
  return out;
}

function touchSession(u, sid) {
  const now = Date.now();
  const s = u.sessions[sid];
  if (!s) return;
  if (!s.lastSeen || now - s.lastSeen > 600000) {
    s.lastSeen = now;
    writeUser(u.id, u);
  }
}

function findUserBySession(sid) {
  let files = [];
  try { files = fs.readdirSync(LOGIN_DIR); } catch (e) { return null; }
  for (let i = 0; i < files.length; i++) {
    if (!files[i].endsWith(".json")) continue;
    const u = readJson(path.join(LOGIN_DIR, files[i]), null);
    if (u && u.sessions && u.sessions[sid]) return u;
  }
  return null;
}

function sessionCookie(sid, secure) {
  return "sid=" + sid + "; HttpOnly; Path=/; Max-Age=" + COOKIE_MAX_AGE + "; SameSite=Lax" + (secure ? "; Secure" : "");
}

function getSession(req) {
  const sid = getCookies(req).sid;
  if (!sid || typeof sid !== "string") return null;
  const now = Date.now();
  const sep = sid.indexOf("_");
  if (sep > 0) {
    const uid = sid.slice(0, sep);
    const u = readUser(uid);
    if (u && u.sessions && u.sessions[sid]) {
      const sess = u.sessions[sid];
      if (sess.lastSeen && (now - sess.lastSeen > SESSION_MAX_AGE_MS)) {
        delete u.sessions[sid];
        writeUser(u.id, u);
        return null;
      }
      touchSession(u, sid);
      return { sid: sid, userId: u.id, username: u.username, avatar: u.avatar || null };
    }
  }
  const found = findUserBySession(sid);
  if (found && found.sessions && found.sessions[sid]) {
    const sess = found.sessions[sid];
    if (sess.lastSeen && (now - sess.lastSeen > SESSION_MAX_AGE_MS)) {
      delete found.sessions[sid];
      writeUser(found.id, found);
      return null;
    }
    touchSession(found, sid);
    return { sid: sid, userId: found.id, username: found.username, avatar: found.avatar || null };
  }
  return null;
}

function createSession(req, res, user, token) {
  const now = Date.now();
  const oldSid = getCookies(req).sid;
  if (oldSid) {
    try {
      const sep = oldSid.indexOf("_");
      let oldU = null;
      if (sep > 0) oldU = readUser(oldSid.slice(0, sep));
      if (!oldU) oldU = findUserBySession(oldSid);
      if (oldU && oldU.sessions && oldU.sessions[oldSid]) {
        delete oldU.sessions[oldSid];
        writeUser(oldU.id, oldU);
      }
    } catch (e) {}
  }
  const sid = user.id + "_" + crypto.randomBytes(24).toString("hex");
  const u = readUser(user.id) || { id: user.id, sessions: {} };
  u.id = user.id;
  u.username = user.username;
  u.avatar = user.avatar || null;
  u.lastLogin = now;
  u.sessions = u.sessions || {};
  u.sessions[sid] = { createdAt: now, lastSeen: now };
  if (token) {
    u.discord = {
      access_token: cryptoUtil.encryptToken(token.access_token || ""),
      refresh_token: cryptoUtil.encryptToken(token.refresh_token || ""),
      expires_at: token.expires_in ? now + token.expires_in * 1000 : now + 600000
    };
  }
  writeUser(user.id, u);
  res.setHeader("Set-Cookie", sessionCookie(sid, requestSecure(req)));
  return { sid: sid, userId: u.id, username: u.username, avatar: u.avatar };
}

function destroySession(req, res) {
  const sid = getCookies(req).sid;
  if (sid) {
    const sep = sid.indexOf("_");
    let u = null;
    if (sep > 0) {
      u = readUser(sid.slice(0, sep));
      if (u && (!u.sessions || !u.sessions[sid])) u = null;
    }
    if (!u) u = findUserBySession(sid);
    if (u && u.sessions && u.sessions[sid]) {
      delete u.sessions[sid];
      writeUser(u.id, u);
    }
  }
  res.setHeader("Set-Cookie", [
    "sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" + (requestSecure(req) ? "; Secure" : ""),
    "oauth_state=; HttpOnly; Path=/api/auth; Max-Age=0; SameSite=Lax"
  ]);
}

function refreshUserToken(u) {
  if (!u.discord || !u.discord.refresh_token) return Promise.resolve(null);
  if (u.discord.expires_at && Date.now() < u.discord.expires_at - 60000) return Promise.resolve(u.discord);
  const refreshToken = cryptoUtil.decryptToken(u.discord.refresh_token);
  if (!refreshToken) return Promise.resolve(null);
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  }).toString();
  return discordRequest({
    hostname: "discord.com",
    path: "/api/oauth2/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body)
    }
  }, body).then(function (t) {
    u.discord = {
      access_token: cryptoUtil.encryptToken(t.access_token || ""),
      refresh_token: cryptoUtil.encryptToken(t.refresh_token || refreshToken),
      expires_at: Date.now() + (t.expires_in || 600) * 1000
    };
    writeUser(u.id, u);
    return u.discord;
  }).catch(function () {
    return null;
  });
}

function migrateSessions() {
  let raw = null;
  try { raw = fs.readFileSync(SESSIONS_FILE, "utf8"); } catch (e) { return; }
  let sessions = {};
  try { sessions = JSON.parse(raw); } catch (e) { return; }
  const keys = Object.keys(sessions);
  if (!keys.length) {
    try { fs.unlinkSync(SESSIONS_FILE); } catch (e) {}
    return;
  }
  keys.forEach(function (sid) {
    const s = sessions[sid];
    if (!s || !s.userId) return;
    const u = readUser(s.userId) || { id: s.userId, sessions: {} };
    u.username = s.username || u.username;
    u.avatar = s.avatar || u.avatar || null;
    u.sessions = u.sessions || {};
    if (!u.sessions[sid]) {
      u.sessions[sid] = { createdAt: s.createdAt || Date.now(), lastSeen: Date.now() };
    }
    writeUser(s.userId, u);
  });
  try { fs.writeFileSync(SESSIONS_FILE + ".bak", raw); } catch (e) {}
  try { fs.unlinkSync(SESSIONS_FILE); } catch (e) {}
  console.log("Migrated " + keys.length + " old session(s) to data/login/");
}

function migrateBots() {
  let raw = null;
  try { raw = fs.readFileSync(BOTS_FILE, "utf8"); } catch (e) { return; }
  let all = {};
  try { all = JSON.parse(raw); } catch (e) { return; }
  let count = 0;
  Object.keys(all).forEach(function (userId) {
    const userBots = all[userId] || {};
    Object.keys(userBots).forEach(function (botId) {
      const b = userBots[botId];
      if (!b || !b.id) return;
      saveBotData(userId, b);
      count++;
    });
  });
  if (!count) {
    try { fs.unlinkSync(BOTS_FILE); } catch (e) {}
    return;
  }
  try { fs.writeFileSync(BOTS_FILE + ".bak", raw); } catch (e) {}
  try { fs.unlinkSync(BOTS_FILE); } catch (e) {}
  console.log("Migrated " + count + " bot(s) to data/users/");
}

function migrateStoredTokens() {
  const marker = path.join(DATA_DIR, ".shield-v3-migrated");
  if (fs.existsSync(marker)) return;
  let count = 0;
  let userDirs = [];
  try { userDirs = fs.readdirSync(USERS_DIR); } catch (e) { userDirs = []; }
  userDirs.forEach(function (uId) {
    let botDirs = [];
    try { botDirs = fs.readdirSync(path.join(USERS_DIR, uId)); } catch (e) { return; }
    botDirs.forEach(function (bId) {
      const file = botFile(uId, bId);
      const b = readJson(file, null);
      if (!b || !b.token || cryptoUtil.isV3(b.token)) return;
      b.token = cryptoUtil.encryptToken(b.token);
      writeJson(file, b);
      count++;
    });
  });
  let loginFiles = [];
  try { loginFiles = fs.readdirSync(LOGIN_DIR); } catch (e) { loginFiles = []; }
  loginFiles.forEach(function (n) {
    if (!n.endsWith(".json") || n.endsWith(".bak")) return;
    const file = path.join(LOGIN_DIR, n);
    const u = readJson(file, null);
    if (!u || !u.discord) return;
    let changed = false;
    if (u.discord.access_token && !cryptoUtil.isV3(u.discord.access_token)) {
      u.discord.access_token = cryptoUtil.encryptToken(u.discord.access_token);
      changed = true;
    }
    if (u.discord.refresh_token && !cryptoUtil.isV3(u.discord.refresh_token)) {
      u.discord.refresh_token = cryptoUtil.encryptToken(u.discord.refresh_token);
      changed = true;
    }
    if (!changed) return;
    writeJson(file, u);
    count++;
  });
  writeJson(marker, { at: Date.now(), shielded: count });
  try { fs.unlinkSync(path.join(DATA_DIR, ".enc-v2-migrated")); } catch (e) {}
  try { fs.unlinkSync(path.join(DATA_DIR, ".enc-migrated")); } catch (e) {}
  if (count) console.log("Shielded " + count + " stored token(s) with Dual-Vault V3 Shield");
}

function autoStartOnlineBots() {
  let userDirs = [];
  try { userDirs = fs.readdirSync(USERS_DIR); } catch (e) { return; }
  const botsToStart = [];
  userDirs.forEach(function (uId) {
    let botDirs = [];
    try { botDirs = fs.readdirSync(path.join(USERS_DIR, uId)); } catch (e) { return; }
    botDirs.forEach(function (bId) {
      const b = readJson(botFile(uId, bId), null);
      if (b && b.token && b.desiredState === "online") {
        syncBotCommandConflictsOnBoot(b, uId);
        const plain = botPlainToken(b);
        if (!plain) {
          console.log("Skipping auto-start (cannot decrypt token):", b.username);
          return;
        }
        botsToStart.push({ uId: uId, b: b, plain: plain });
      }
    });
  });

  if (!botsToStart.length) return;

  const DELAY_BETWEEN_BOTS_MS = 3500;
  console.log("Found " + botsToStart.length + " bot(s) to auto-start. Starting sequentially with " + (DELAY_BETWEEN_BOTS_MS / 1000) + "s interval...");

  let idx = 0;
  function startNext() {
    if (idx >= botsToStart.length) {
      console.log("All " + botsToStart.length + " bot(s) auto-started successfully.");
      return;
    }
    const item = botsToStart[idx++];
    console.log("Auto-starting hosted bot (" + idx + "/" + botsToStart.length + "):", item.b.username, "(" + item.b.id + ")");
    botHost.startBot(item.uId, item.b.id, item.plain, item.b).catch(function (err) {
      console.error("Failed to auto-start bot", item.b.id, err);
    });
    panelLog.botAction("started", item.b, null);

    if (idx < botsToStart.length) {
      setTimeout(startNext, DELAY_BETWEEN_BOTS_MS);
    }
  }

  startNext();
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function jsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\u003c").replace(/\n/g, "\\n");
}

function defaultAvatar(id) {
  try {
    return "https://cdn.discordapp.com/embed/avatars/" + (Number(BigInt(String(id)) >> 22n) % 6) + ".png";
  } catch (e) {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

function avatarUrl(user) {
  if (!user) return defaultAvatar("0");
  if (user.avatar) return "https://cdn.discordapp.com/avatars/" + user.userId + "/" + user.avatar + ".png?size=64";
  return defaultAvatar(user.userId);
}

function sendHtml(res, file, session, error, extra) {
  let html = fs.readFileSync(file, "utf8");
  html = html.split("{{FOOTER}}").join(escapeHtml(env.FOOTER || "Copyright 2026"));
  html = html.split("{{NAME}}").join(escapeHtml(env.NAME || "Arixa"));
  html = html.split("{{USER}}").join(escapeHtml(session ? session.username : "Guest"));
  html = html.split("{{USERID}}").join(escapeHtml(session ? session.userId : ""));
  html = html.split("{{AVATAR}}").join(escapeHtml(session ? avatarUrl(session) : defaultAvatar("0")));
  html = html.split("{{ERROR}}").join(jsEscape(error || ""));
  if (extra) {
    html = html.split("{{BOTID}}").join(escapeHtml(extra.botId || ""));
    html = html.split("{{BOTNAME}}").join(escapeHtml(extra.botName || ""));
    html = html.split("{{BOTAVATAR}}").join(escapeHtml(extra.botAvatar || defaultAvatar(extra.botId || "0")));
    html = html.split("{{BOTTOKEN}}").join(escapeHtml(extra.botToken || ""));
    html = html.split("{{CLIENTID}}").join(escapeHtml(extra.clientId || ""));
    html = html.split("{{BOTSTATUS}}").join(escapeHtml(extra.botStatus || "offline"));
    html = html.split("{{CURRENT_ACTIVITY}}").join(escapeHtml(extra.currentActivity || ("Hosted by " + (env.NAME || "Arixa"))));
    html = html.split("{{PRESENCE_STATUS}}").join(escapeHtml(extra.presenceStatus || "online"));
    html = html.split("{{GUILD_COUNT}}").join(escapeHtml(String(extra.guildCount || 0)));
    html = html.split("{{USER_COUNT}}").join(escapeHtml(String(extra.memberCount || 0)));
    html = html.split("{{CUSTOM_STATUSES}}").join(jsEscape(JSON.stringify(extra.customStatuses && extra.customStatuses.length ? extra.customStatuses : defaultStatusList())));
    html = html.split("{{STATUS_INTERVAL}}").join(escapeHtml(String(extra.statusInterval || 10)));
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Expires": "0"
  });
  res.end(html);
}

function redirect(res, to) {
  res.writeHead(302, { "Location": to });
  res.end();
}

function discordRequest(options, body) {
  return new Promise(function (resolve, reject) {
    const req = https.request(options, function (res) {
      let data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error((json && (json.error_description || json.message)) || "Discord API " + res.statusCode));
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(function (req, res) {
  req.on("error", function () {
    if (!res.headersSent) {
      try {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
      } catch (e) {}
    }
  });
  res.on("error", function () {});

  try {
    const url = req.url.split("?")[0];
    const session = getSession(req);

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    if (!url.startsWith("/api/plugins/image/")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }

  if (handlePluginUpload(req, res, session, url)) return;
  if (handlePluginRoute(req, res, url, session)) return;

  if (url === "/login" && req.method === "GET") {
    if (session) return redirect(res, "/");
    const q = req.url.indexOf("?") > -1 ? req.url.slice(req.url.indexOf("?") + 1) : "";
    let error = "";
    if (q.indexOf("error=") > -1) {
      const code = q.split("error=")[1].split("&")[0];
      const map = {
        denied: "Discord authorization was cancelled.",
        state: "Login session expired, please try again.",
        notallowed: "This Discord account is not allowed.",
        exchange: "Login failed, please try again.",
        config: "Discord login is not configured. Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to .env"
      };
      error = map[code] || "Login failed.";
    }
    return sendHtml(res, loginPath, session, error);
  }

  if (url === "/api/auth/login" && req.method === "GET") {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return redirect(res, "/login?error=config");
    const state = crypto.randomBytes(16).toString("hex");
    pendingStates[state] = Date.now();
    Object.keys(pendingStates).forEach(function (k) {
      if (Date.now() - pendingStates[k] > 600000) delete pendingStates[k];
    });
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: redirectUri(req),
      response_type: "code",
      scope: "identify",
      prompt: "consent",
      state: state
    });
    res.setHeader("Set-Cookie", "oauth_state=" + state + "; HttpOnly; Path=/api/auth; Max-Age=600; SameSite=Lax" + (requestSecure(req) ? "; Secure" : ""));
    return redirect(res, "https://discord.com/oauth2/authorize?" + params.toString());
  }

  if (url === "/api/auth/callback" && req.method === "GET") {
    const q = new URL(req.url, "http://localhost").searchParams;
    const code = q.get("code");
    const state = q.get("state");
    const cookieState = getCookies(req).oauth_state;
    if (!code) return redirect(res, "/login?error=denied");
    if (!state || !pendingStates[state] || (cookieState && cookieState !== state)) return redirect(res, "/login?error=state");
    delete pendingStates[state];

    const body = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri(req)
    }).toString();

    discordRequest({
      hostname: "discord.com",
      path: "/api/oauth2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, body).then(function (token) {
      return discordRequest({
        hostname: "discord.com",
        path: "/api/users/@me",
        method: "GET",
        headers: { Authorization: "Bearer " + token.access_token }
      }).then(function (me) {
        return { me: me, token: token };
      });
    }).then(function (r) {
      if (ALLOWED_IDS.length && ALLOWED_IDS.indexOf(r.me.id) === -1) return redirect(res, "/login?error=notallowed");
        createSession(req, res, { id: r.me.id, username: r.me.global_name || r.me.username, avatar: r.me.avatar }, r.token);
        panelLog.login({ id: r.me.id, username: r.me.global_name || r.me.username, avatar: r.me.avatar });
        redirect(res, "/");
    }).catch(function () {
      redirect(res, "/login?error=exchange");
    });
    return;
  }

  if (url === "/api/auth/logout" && req.method === "POST") {
    destroySession(req, res);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url === "/api/auth/me" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(session ? { loggedIn: true, userId: session.userId, username: session.username, avatar: avatarUrl(session) } : { loggedIn: false }));
    return;
  }

  if (url === "/api/auth/refresh" && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false }));
    }
    const u = readUser(session.userId);
    if (!u) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false }));
    }
    refreshUserToken(u).then(function (t) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: !!t, expires_at: t ? t.expires_at : null }));
    }).catch(function (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (err && err.message) || "Token refresh failed" }));
    });
    return;
  }

  if (url === "/api/bots/save" && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
      return;
    }
    let body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", function () {
      let token = "";
      let clientId = "";
      try {
        const parsed = JSON.parse(body);
        token = String(parsed.token || "").trim();
        clientId = String(parsed.clientId || "").trim();
      } catch (e) {}
      if (!token) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "No token provided" }));
      }
      if (clientId && !/^\d{17,20}$/.test(clientId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Invalid Client ID format (must be 17-20 digits)" }));
      }
      discordRequest({
        hostname: "discord.com",
        path: "/api/users/@me",
        method: "GET",
        headers: { Authorization: "Bot " + token }
      }).then(function (bot) {
        if (!bot || !bot.id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, error: "Invalid bot token" }));
        }
        if (clientId && String(bot.id) !== String(clientId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, error: "Client ID does not match this Bot Token!" }));
        }
        const existing = readJson(botFile(session.userId, bot.id), null);
        const botToSave = Object.assign({}, existing || {}, {
          id: bot.id,
          clientId: clientId || bot.id,
          username: bot.username,
          avatar: bot.avatar || null,
          token: token,
          createdAt: (existing && existing.createdAt) || Date.now()
        });
        saveBotData(session.userId, botToSave);
        panelLog.botAdded({ id: bot.id, username: bot.username, avatar: bot.avatar || null }, { name: session.username, id: session.userId }, token);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          bot: {
            id: bot.id,
            username: bot.username,
            avatar: bot.avatar ? "https://cdn.discordapp.com/avatars/" + bot.id + "/" + bot.avatar + ".png?size=64" : defaultAvatar(bot.id)
          }
        }));
      }).catch(function (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message || "Invalid bot token" }));
      });
    });
    return;
  }

  if (url === "/api/bots/list" && req.method === "GET") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, bots: [] }));
    }
    const list = listBotData(session.userId).map(function (b) {
      return {
        id: b.id,
        username: b.username,
        avatar: b.avatar ? "https://cdn.discordapp.com/avatars/" + b.id + "/" + b.avatar + ".png?size=64" : defaultAvatar(b.id)
      };
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, bots: list }));
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/status$/) && req.method === "GET") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    const hostStatus = botHost.getBotStatus(botId);
    const customStatuses = normalizeStatusList(bot.customStatuses);
    if (customStatuses.length === 0) customStatuses.push(defaultStatusList()[0]);
    const statusInterval = Math.max(3, parseInt(bot.statusInterval, 10) || 10);
    const currentActivity = hostStatus.currentActivity || statusTextOf(customStatuses[0]);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      botId: botId,
      botName: bot.username,
      botAvatar: bot.avatar ? "https://cdn.discordapp.com/avatars/" + bot.id + "/" + bot.avatar + ".png?size=64" : defaultAvatar(bot.id),
      status: hostStatus.status,
      uptime: hostStatus.uptime,
      ping: hostStatus.ping,
      error: hostStatus.error,
      presenceStatus: hostStatus.presenceStatus || normalizePresence(bot.presenceStatus),
      guildCount: hostStatus.guildCount || 0,
      memberCount: hostStatus.memberCount || 0,
      clientId: bot.clientId || "",
      currentActivity: currentActivity,
      customStatuses: customStatuses,
      statusInterval: statusInterval,
      themeColors: normalizeThemeColors(bot.themeColors)
    }));
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/start$/) && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (bot) syncBotCommandConflictsOnBoot(bot, session.userId);
    const plainToken = botPlainToken(bot);
    if (!bot || !plainToken) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot token missing or unreadable" }));
    }
    bot.desiredState = "online";
    saveBotData(session.userId, bot);
    panelLog.botAction("started", bot, { name: session.username, id: session.userId });
    botHost.startBot(session.userId, bot.id, plainToken, bot).then(function (result) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    }).catch(function (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (err && err.message) || "Failed to start bot" }));
    });
    return;
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/stop$/) && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    bot.desiredState = "offline";
    saveBotData(session.userId, bot);
    const result = botHost.stopBot(session.userId, bot.id);
    panelLog.botAction("stopped", bot, { name: session.username, id: session.userId });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(result));
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/restart$/) && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (bot) syncBotCommandConflictsOnBoot(bot, session.userId);
    const plainToken = botPlainToken(bot);
    if (!bot || !plainToken) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot token missing or unreadable" }));
    }
    bot.desiredState = "online";
    saveBotData(session.userId, bot);
    panelLog.botAction("restarted", bot, { name: session.username, id: session.userId });
    botHost.restartBot(session.userId, bot.id, plainToken, bot).then(function (result) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    }).catch(function (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (err && err.message) || "Failed to restart bot" }));
    });
    return;
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/client-id$/) && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", function () {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (e) {}
      if (!parsed || typeof parsed !== "object" || parsed.clientId === undefined) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Invalid JSON or missing clientId" }));
      }
      const clientId = String(parsed.clientId || "").trim();
      if (clientId && !/^\d{17,20}$/.test(clientId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Client ID must be a valid 17-20 digit snowflake" }));
      }
      bot.clientId = clientId;
      saveBotData(session.userId, bot);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, clientId: bot.clientId }));
    });
    return;
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/custom-status$/) && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 2e4) req.destroy(); });
    req.on("end", function () {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (e) {}
      if (!parsed || typeof parsed !== "object") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
      }
      let rawStatuses = Array.isArray(parsed.statuses) ? parsed.statuses : [];
      let cleaned = normalizeStatusList(rawStatuses);
      if (cleaned.length === 0) {
        cleaned = defaultStatusList();
      }
      let interval = Math.max(3, parseInt(parsed.interval, 10) || 10);
      bot.customStatuses = cleaned;
      bot.statusInterval = interval;
      saveBotData(session.userId, bot);
      botHost.updateBotStatuses(bot.id, bot.customStatuses, bot.statusInterval);
      const hostStatus = botHost.getBotStatus(bot.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        customStatuses: bot.customStatuses,
        statusInterval: bot.statusInterval,
        currentActivity: hostStatus.currentActivity || cleaned[0].text
      }));
    });
    return;
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/presence-status$/) && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 2e4) req.destroy(); });
    req.on("end", function () {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (e) {}
      const wanted = String(parsed.status || "").toLowerCase().trim();
      if (PRESENCE_STATUSES.indexOf(wanted) === -1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Status must be online, idle or dnd" }));
      }
      bot.presenceStatus = wanted;
      saveBotData(session.userId, bot);
      const applied = botHost.updateBotPresenceStatus(bot.id, wanted);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, presenceStatus: applied }));
    });
    return;
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/theme-colors$/) && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 2e4) req.destroy(); });
    req.on("end", function () {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (e) {}
      if (!parsed || typeof parsed !== "object") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
      }
      bot.themeColors = normalizeThemeColors(Object.assign({}, bot.themeColors || {}, parsed));
      saveBotData(session.userId, bot);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, themeColors: bot.themeColors }));
    });
    return;
  }

  const pluginImageMatch = url.match(/^\/plugins\/([a-zA-Z0-9_-]+)\/images\/([a-zA-Z0-9._-]+)$/);
  if (pluginImageMatch && req.method === "GET") {
    const ext = path.extname(pluginImageMatch[2]).toLowerCase();
    const pid = pluginImageMatch[1];
    const fileName = pluginImageMatch[2];
    const targetDir = findPluginDir(pid);
    if (!targetDir || PLUGIN_IMAGE_EXTS.indexOf(ext) === -1) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const imagesDir = path.join(targetDir, "images");
    const full = path.resolve(path.join(imagesDir, fileName));
    if (full.indexOf(path.resolve(imagesDir) + path.sep) !== 0) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    fs.readFile(full, function (err, data) {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Not found");
      }
      res.writeHead(200, { "Content-Type": PLUGIN_IMAGE_TYPES[ext], "Cache-Control": "public, max-age=3600" });
      res.end(data);
    });
    return;
  }

  if (url.match(/^\/api\/bot\/([0-9]+)\/plugins$/) && req.method === "GET") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = url.split("/")[3];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    const plugins = scanPlugins().map(function (p) {
      const entry = pluginEntry(bot, p.id);
      return {
        id: p.id,
        name: p.name,
        tag: p.tag,
        description: p.description,
        version: p.version,
        author: p.author,
        image: p.image,
        commands: p.commands.map(function (c) { return c.name; }),
        installed: !!entry,
        enabled: !!(entry && entry.enabled !== false),
        updateAvailable: pluginUpdateState(entry, p),
        installedVersion: entry && entry.version ? String(entry.version) : null,
        updatedAt: entry && entry.updatedAt ? String(entry.updatedAt) : null
      };
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, plugins: plugins }));
    return;
  }

  const pluginDetailMatch = url.match(/^\/api\/bot\/([0-9]+)\/plugins\/([a-zA-Z0-9_-]+)$/);
  if (pluginDetailMatch && req.method === "GET") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = pluginDetailMatch[1];
    const pluginId = pluginDetailMatch[2];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    let plugin = null;
    scanPlugins().forEach(function (p) { if (p.id === pluginId) plugin = p; });
    if (!plugin) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Plugin not found" }));
    }
    const entry = pluginEntry(bot, plugin.id);
    const configValues = (entry && entry.config && typeof entry.config === "object") ? entry.config : {};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      plugin: {
        id: plugin.id,
        name: plugin.name,
        tag: plugin.tag,
        description: plugin.description,
        version: plugin.version,
        author: plugin.author,
        image: plugin.image,
        commands: plugin.commands,
        config: plugin.config,
        embedMode: plugin.embedMode,
        configValues: configValues,
        installed: !!entry,
        enabled: !!(entry && entry.enabled !== false),
        updateAvailable: pluginUpdateState(entry, plugin),
        installedVersion: entry && entry.version ? String(entry.version) : null,
        updatedAt: entry && entry.updatedAt ? String(entry.updatedAt) : null,
        readme: plugin.readme
      }
    }));
    return;
  }

  const pluginActionMatch = url.match(/^\/api\/bot\/([0-9]+)\/plugins\/(install|uninstall|toggle|config|update)$/);
  if (pluginActionMatch && req.method === "POST") {
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Not logged in" }));
    }
    const botId = pluginActionMatch[1];
    const action = pluginActionMatch[2];
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Bot not found" }));
    }
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", function () {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (e) {}
      const pid = sanitizePluginId(parsed.pluginId);
      if (!pid) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Plugin id required" }));
      }
      let plugin = null;
      scanPlugins().forEach(function (p) { if (p.id === pid) plugin = p; });
      if (!plugin) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Plugin not found" }));
      }
      bot.plugins = (bot.plugins && typeof bot.plugins === "object") ? bot.plugins : {};
      if (action === "install") {
        if (!bot.plugins[pid]) {
          bot.plugins[pid] = {
            installedAt: new Date().toISOString(),
            enabled: true,
            version: plugin.version,
            fingerprint: plugin.fingerprint
          };
          saveBotData(session.userId, bot);
          connectPlugin(session.userId, bot.id, pid);
          botHost.refreshBotCommands(bot.id);
        }
        const entry = bot.plugins[pid];
        let disabled = [];
        if (entry.enabled !== false) {
          disabled = resolvePluginCommandConflicts(bot, plugin, session.userId);
          if (disabled.length) {
            saveBotData(session.userId, bot);
            botHost.refreshBotCommands(bot.id);
          }
        }
        const warnings = entry.enabled !== false ? pluginCommandCollisions(bot, plugin) : [];
        callPluginHook(pid, "onInstall", { userId: session.userId, botId: bot.id, config: entry.config || {} });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          ok: true,
          installed: true,
          enabled: entry.enabled !== false,
          disabledPlugins: disabled.map(function (d) { return d.id; }),
          disabledDetails: disabled,
          warnings: warnings
        }));
      }
      const entry = pluginEntry(bot, pid);
      if (!entry) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Plugin is not installed" }));
      }
      if (action === "update") {
        if (!plugin.fingerprint || !loadPluginModule(pid)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, error: "Plugin source could not be loaded" }));
        }
        const fromVersion = entry.version ? String(entry.version) : null;
        entry.version = plugin.version;
        entry.fingerprint = plugin.fingerprint;
        entry.updatedAt = new Date().toISOString();
        saveBotData(session.userId, bot);
        connectPlugin(session.userId, bot.id, pid);
        botHost.refreshBotCommands(bot.id);
        const warnings = entry.enabled !== false ? pluginCommandCollisions(bot, plugin) : [];
        callPluginHook(pid, "onUpdate", {
          userId: session.userId,
          botId: bot.id,
          config: Object.assign({}, entry.config || {}),
          fromVersion: fromVersion,
          toVersion: plugin.version
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          ok: true,
          installed: true,
          enabled: entry.enabled !== false,
          version: plugin.version,
          installedVersion: plugin.version,
          updatedAt: entry.updatedAt,
          updateAvailable: false,
          warnings: warnings
        }));
      }
      if (action === "uninstall") {
        const hookCtx = { userId: session.userId, botId: bot.id, config: entry.config || {} };
        delete bot.plugins[pid];
        saveBotData(session.userId, bot);
        disconnectPlugin(session.userId, bot.id, pid);
        botHost.refreshBotCommands(bot.id);
        callPluginHook(pid, "onUninstall", hookCtx);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, installed: false }));
      }
      if (action === "toggle") {
        entry.enabled = parsed.enabled === true;
        let disabled = [];
        if (entry.enabled) {
          disabled = resolvePluginCommandConflicts(bot, plugin, session.userId);
        }
        saveBotData(session.userId, bot);
        botHost.refreshBotCommands(bot.id);
        const warnings = entry.enabled ? pluginCommandCollisions(bot, plugin) : [];
        callPluginHook(pid, "onToggle", { userId: session.userId, botId: bot.id, enabled: entry.enabled, config: entry.config || {} });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          ok: true,
          enabled: entry.enabled,
          disabledPlugins: disabled.map(function (d) { return d.id; }),
          disabledDetails: disabled,
          warnings: warnings
        }));
      }
      if (action === "config") {
        const values = (parsed.values && typeof parsed.values === "object") ? parsed.values : {};
        const clean = (entry.config && typeof entry.config === "object") ? Object.assign({}, entry.config) : {};
        if (values.aliases && typeof values.aliases === "object") {
          clean.aliases = {};
          Object.keys(values.aliases).forEach(function (cmdKey) {
            const safeCmd = String(cmdKey || "").toLowerCase().trim();
            if (!/^[a-z0-9_-]{1,32}$/.test(safeCmd)) return;
            const rawList = Array.isArray(values.aliases[cmdKey]) ? values.aliases[cmdKey] : String(values.aliases[cmdKey] || "").split(",");
            const cleanList = rawList.map(function (a) {
              return String(a || "").toLowerCase().trim().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
            }).filter(Boolean);
            clean.aliases[safeCmd] = cleanList;
          });
        }
        (Array.isArray(plugin.config) ? plugin.config : []).forEach(function (f) {
          let v = values[f.key];
          if (v === undefined || v === null) return;
          v = String(v).trim();
          if (f.type === "toggle") {
            v = (v === "true" || v === "1" || v === true) ? "true" : "false";
          } else if (f.type === "number") {
            const num = Number(v);
            v = isNaN(num) ? String(f.def || "0") : String(num);
          } else {
            v = v.slice(0, 500);
          }
          clean[f.key] = v;
        });
        if (values.embed && typeof values.embed === "object") {
          const src = values.embed;
          const str = function (v, max) {
            v = String(v === undefined || v === null ? "" : v).trim();
            return v.slice(0, max);
          };
          const urlv = function (v) {
            v = str(v, 500);
            return /^https?:\/\/\S+$/.test(v) ? v : "";
          };
          const col = str(src.color, 7);
          const colorOnly = plugin.embedMode === "color";
          clean.embed = {
            color: /^#[0-9a-fA-F]{6}$/.test(col) ? col : "#5865f2",
            title: colorOnly ? "" : str(src.title, 256),
            titleUrl: colorOnly ? "" : urlv(src.titleUrl),
            description: colorOnly ? "" : str(src.description, 1000),
            authorName: colorOnly ? "" : str(src.authorName, 256),
            authorIcon: colorOnly ? "" : urlv(src.authorIcon),
            footerText: colorOnly ? "" : str(src.footerText, 2048),
            footerIcon: colorOnly ? "" : urlv(src.footerIcon),
            thumbnail: colorOnly ? "" : urlv(src.thumbnail)
          };
        }
        entry.config = clean;
        saveBotData(session.userId, bot);
        botHost.refreshBotCommands(bot.id);
        callPluginHook(pid, "onConfig", { userId: session.userId, botId: bot.id, config: clean });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, values: clean }));
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unknown action" }));
    });
    return;
  }

  if (url === "/" || url === "/index.html" || url === "/dashboard") {
    if (!session) return redirect(res, "/login");
    return sendHtml(res, htmlPath, session);
  }

  if (url === "/docs" || url === "/docs.html") {
    return sendHtml(res, docsPath, session);
  }

  if (url === "/plans" && req.method === "GET") {
    if (!session) return redirect(res, "/login");
    return sendHtml(res, plansPath, session);
  }

  if (url.indexOf("/bot/") === 0 && req.method === "GET") {
    if (!session) return redirect(res, "/login");
    const botId = url.split("/")[2] || "";
    if (!/^[0-9]+$/.test(botId)) return redirect(res, "/");
    const bot = readJson(botFile(session.userId, botId), null);
    if (!bot) return redirect(res, "/");
    const hostStatus = botHost.getBotStatus(bot.id);
    const botAvatarUrl = bot.avatar ? "https://cdn.discordapp.com/avatars/" + bot.id + "/" + bot.avatar + ".png?size=64" : defaultAvatar(bot.id);
    const customStatuses = normalizeStatusList(bot.customStatuses);
    if (customStatuses.length === 0) customStatuses.push(defaultStatusList()[0]);
    const statusInterval = Math.max(3, parseInt(bot.statusInterval, 10) || 10);
    const currentActivity = hostStatus.currentActivity || statusTextOf(customStatuses[0]);
    return sendHtml(res, botDashboardPath, session, "", {
      botId: bot.id,
      botName: bot.username,
      botAvatar: botAvatarUrl,
      botToken: "",
      clientId: bot.clientId || "",
      botStatus: hostStatus.status || "offline",
      presenceStatus: hostStatus.presenceStatus || normalizePresence(bot.presenceStatus),
      guildCount: hostStatus.guildCount || 0,
      memberCount: hostStatus.memberCount || 0,
      currentActivity: currentActivity,
      customStatuses: customStatuses,
      statusInterval: statusInterval
    });
  }

  if (url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
  } catch (err) {
    console.error("HTTP Request Error:", err);
    if (!res.headersSent) {
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Internal Server Error" }));
      } catch (e) {}
    }
  }
});

server.on("clientError", function (err, socket) {
  if (err.code === "ECONNRESET" || !socket.writable) return;
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch (e) {}
});

server.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.log("Port " + PORT + " is already in use. Stop the other process or change PORT in .env");
  } else {
    console.log("Server error: " + err.message);
  }
  process.exit(1);
});

server.listen(PORT, function () {
  const localUrl = "http://localhost:" + PORT;
  const redirectExample = (BASE_URL || ("http://localhost:" + PORT)) + "/api/auth/callback";
  console.log("Arixa running on port " + PORT);
  console.log("Local: " + localUrl);
  if (BASE_URL) console.log("Base URL: " + BASE_URL);
  if (EXPLICIT_REDIRECT_URI) console.log("Discord redirect URI (from env): " + EXPLICIT_REDIRECT_URI);
  else if (BASE_URL) console.log("Discord redirect URI: " + BASE_URL + "/api/auth/callback");
  else console.log("Discord redirect URI: auto-detected per request (current: " + redirectExample + ")");
  migrateSessions();
  migrateBots();
  cryptoUtil.ensureKey();
  migrateStoredTokens();
  autoStartOnlineBots();
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    console.log("WARNING: Discord login not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env");
  }
  if (!BASE_URL && !EXPLICIT_REDIRECT_URI) {
    console.log("Tip: on a host, set BASE_URL=https://your-domain in .env (locally leave it empty)");
  }
});

function gracefulShutdown(signal) {
  console.log("Received " + signal + ". Shutting down gracefully...");
  try {
    server.close(function () {
      process.exit(0);
    });
    setTimeout(function () {
      process.exit(0);
    }, 3000);
  } catch (e) {
    process.exit(0);
  }
}
process.on("SIGTERM", function () { gracefulShutdown("SIGTERM"); });
process.on("SIGINT", function () { gracefulShutdown("SIGINT"); });

process.on("unhandledRejection", function (reason) {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", function (err) {
  console.error("Uncaught Exception:", err);
});
