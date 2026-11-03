/**
 * Arixa Rate Limit Manager
 * ========================
 * Phase 1: Per-Bot, Per-Route REST rate limit isolation
 * Phase 2: Global Gateway IDENTIFY queue (5.5s gap between identifies)
 * Phase 3: IP-level token-bucket throttler (max global requests/sec)
 * Phase 4: Optional SOCKS5/HTTP proxy support per-bot or global
 *
 * Each bot gets its own bucket map so one bot's 429 never blocks others.
 */

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — Global IP Token-Bucket (Cloudflare guard)
// Discord/Cloudflare allows ~50 req/sec per IP comfortably.
// We cap at MAX_RPS bursts across ALL bots combined.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_RPS = 40;          // max requests per second across all bots (safe under Cloudflare)
const BUCKET_SIZE = 80;      // burst capacity (tokens)
let _tokens = BUCKET_SIZE;
let _lastRefill = Date.now();
const _ipQueue = [];         // pending resolve callbacks
let _ipDrainTimer = null;

function _refill() {
  const now = Date.now();
  const elapsed = (now - _lastRefill) / 1000;
  _tokens = Math.min(BUCKET_SIZE, _tokens + elapsed * MAX_RPS);
  _lastRefill = now;
}

function _drainIpQueue() {
  _ipDrainTimer = null;
  if (_ipQueue.length === 0) return;
  _refill();
  while (_ipQueue.length > 0 && _tokens >= 1) {
    _tokens -= 1;
    const cb = _ipQueue.shift();
    cb();
  }
  if (_ipQueue.length > 0) {
    const waitMs = Math.ceil((1 - _tokens) / MAX_RPS * 1000) + 10;
    _ipDrainTimer = setTimeout(_drainIpQueue, waitMs);
  }
}

/**
 * Acquire a global IP-level token before firing an HTTPS request.
 * Returns a Promise that resolves when a token is available.
 */
function acquireIpToken() {
  _refill();
  if (_tokens >= 1) {
    _tokens -= 1;
    return Promise.resolve();
  }
  return new Promise(function (resolve) {
    _ipQueue.push(resolve);
    if (!_ipDrainTimer) {
      const waitMs = Math.ceil((1 - _tokens) / MAX_RPS * 1000) + 10;
      _ipDrainTimer = setTimeout(_drainIpQueue, waitMs);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Per-Bot, Per-Route REST Buckets
// Each bot gets its own Map of route → { resetAt, remaining, limit }
// So Bot A's 429 never affects Bot B.
// ─────────────────────────────────────────────────────────────────────────────
const _botBuckets = new Map(); // botId → Map<routeKey, {resetAt, remaining}>
const _botGlobalWait = new Map(); // botId → global resetAt timestamp

function _getBotBucketMap(botId) {
  if (!_botBuckets.has(botId)) {
    _botBuckets.set(botId, new Map());
  }
  return _botBuckets.get(botId);
}

function _routeKey(method, apiPath) {
  // Normalize major route parameters (channel/guild/webhook IDs)
  const normalized = apiPath
    .replace(/\/channels\/\d+/, "/channels/{id}")
    .replace(/\/guilds\/\d+/, "/guilds/{id}")
    .replace(/\/webhooks\/\d+/, "/webhooks/{id}")
    .replace(/\/messages\/\d+/, "/messages/{id}");
  return method + ":" + normalized;
}

/**
 * Record a Discord API response's rate-limit headers for a specific bot+route.
 * @param {string} botId
 * @param {string} method
 * @param {string} apiPath
 * @param {object} headers - response headers
 * @param {number} statusCode
 * @param {object|null} json - parsed response body
 * @returns {number|null} waitMs if 429 encountered, else null
 */
function recordRateLimit(botId, method, apiPath, headers, statusCode, json) {
  const buckets = _getBotBucketMap(botId);
  const key = _routeKey(method, apiPath);

  const remaining = parseInt(headers["x-ratelimit-remaining"], 10);
  const resetAfter = parseFloat(headers["x-ratelimit-reset-after"]);
  const resetAt = isNaN(resetAfter) ? 0 : Date.now() + Math.ceil(resetAfter * 1000);

  if (!isNaN(remaining) && resetAt > 0) {
    buckets.set(key, { resetAt: resetAt, remaining: remaining });
  }

  if (statusCode === 429) {
    const retryAfterSec =
      (json && typeof json.retry_after === "number")
        ? json.retry_after
        : (parseFloat(headers["retry-after"]) || 5);
    const waitMs = Math.min(Math.max(Math.ceil(retryAfterSec * 1000), 1000), 60000);

    // Discord spec: if json.global === true, rate limit applies to entire bot token across ALL routes
    if (json && json.global === true) {
      _botGlobalWait.set(botId, Date.now() + waitMs);
      console.warn("[RATE_LIMIT][Bot:" + botId + "] Global 429 hit! Pausing all routes for this bot for " + (waitMs / 1000) + "s.");
    } else {
      buckets.set(key, { resetAt: Date.now() + waitMs, remaining: 0 });
      console.warn("[RATE_LIMIT][Bot:" + botId + "] Route 429 on " + method + " " + apiPath + ". Retry in " + (waitMs / 1000) + "s.");
    }
    return waitMs;
  }
  return null;
}

/**
 * Get the wait time (ms) before a bot can make a request to a given route.
 * Returns 0 if no wait needed.
 * @param {string} botId
 * @param {string} method
 * @param {string} apiPath
 */
function getRouteWait(botId, method, apiPath) {
  // Check if bot is under a global rate limit first
  const globalWait = _botGlobalWait.get(botId) || 0;
  const remainingGlobal = globalWait - Date.now();
  if (remainingGlobal > 0) return remainingGlobal;

  const buckets = _getBotBucketMap(botId);
  const key = _routeKey(method, apiPath);
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  if (bucket.remaining <= 0 && bucket.resetAt > Date.now()) {
    return bucket.resetAt - Date.now();
  }
  return 0;
}

/**
 * Clear all rate-limit state for a specific bot (e.g., when bot is removed).
 */
function clearBotBuckets(botId) {
  _botBuckets.delete(botId);
  _botGlobalWait.delete(botId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Gateway IDENTIFY Queue
// Discord allows only 1 IDENTIFY per 5 seconds PER shard.
// We serialize all IDENTIFY payloads with a 5500ms gap.
// ─────────────────────────────────────────────────────────────────────────────
const IDENTIFY_SAFE_GAP_MS = 5500; // 5.5 seconds per Discord docs
let _lastIdentifyAt = 0;
const _identifyQueue = [];
let _identifyTimer = null;

function _processIdentifyQueue() {
  _identifyTimer = null;
  if (_identifyQueue.length === 0) return;

  const now = Date.now();
  const waitNeeded = _lastIdentifyAt + IDENTIFY_SAFE_GAP_MS - now;

  if (waitNeeded > 0) {
    _identifyTimer = setTimeout(_processIdentifyQueue, waitNeeded);
    return;
  }

  const item = _identifyQueue.shift();
  _lastIdentifyAt = Date.now();

  try {
    item.execute();
  } catch (e) {
    console.error("[IDENTIFY_QUEUE] Error executing identify:", e && e.message);
  }

  if (_identifyQueue.length > 0) {
    _identifyTimer = setTimeout(_processIdentifyQueue, IDENTIFY_SAFE_GAP_MS);
  }
}

/**
 * Queue a Gateway IDENTIFY payload to be sent with proper rate limiting.
 * @param {string} botId - for logging
 * @param {Function} execute - callback that actually sends the IDENTIFY payload
 * @returns {Promise<void>} resolves when IDENTIFY has been sent
 */
function queueIdentify(botId, execute) {
  return new Promise(function (resolve) {
    _identifyQueue.push({
      botId: botId,
      execute: function () {
        try { execute(); } catch (e) {}
        resolve();
      }
    });
    console.log("[IDENTIFY_QUEUE] Bot " + botId + " queued for identify. Queue size: " + _identifyQueue.length);
    if (!_identifyTimer) {
      const now = Date.now();
      const waitNeeded = Math.max(0, _lastIdentifyAt + IDENTIFY_SAFE_GAP_MS - now);
      _identifyTimer = setTimeout(_processIdentifyQueue, waitNeeded);
    }
  });
}

/**
 * Remove a bot from the identify queue (e.g., if bot is stopped before identifying).
 */
function cancelIdentify(botId) {
  for (let i = _identifyQueue.length - 1; i >= 0; i--) {
    if (_identifyQueue[i].botId === botId) {
      _identifyQueue.splice(i, 1);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — Multi-Proxy Support (SOCKS5 / HTTP / HTTPS)
// Supported input formats: JSON, TXT, CSV, ENV URL
// Rotation modes: round-robin (default) | per-bot-sticky | random
// ─────────────────────────────────────────────────────────────────────────────

const net_rlm = require("net");
const tls_rlm = require("tls");
const https_rlm = require("https");
const fs_rlm = require("fs");
const path_rlm = require("path");

/**
 * Proxy object shape:
 * { type: 'socks5'|'socks4'|'http'|'https', host, port, username?, password? }
 */

let _proxyPool = [];          // Array of proxy configs (multi-proxy pool)
let _proxyIndex = 0;          // Current round-robin pointer
let _rotationMode = "round-robin"; // "round-robin" | "random" | "sticky"
const _botProxyOverrides = new Map(); // botId → specific proxy config (per-bot override)
const _botStickyProxy = new Map();   // botId → assigned proxy (for sticky mode)

// ── Parser helpers ──────────────────────────────────────────────────────────

/**
 * Parse a single proxy URL string into a proxy config object.
 * Supports: socks5://user:pass@host:port | http://host:port | host:port (default http)
 */
function _parseProxyUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  raw = raw.trim();
  if (!raw || raw.startsWith("#")) return null;

  const matchProto = raw.match(/^(socks5|socks4|http|https):\/\/(?:([^:@\s]+)(?::([^@\s]*))?@)?([^:/\s]+):(\d+)/i);
  if (matchProto) {
    return {
      type: matchProto[1].toLowerCase(),
      username: matchProto[2] || null,
      password: matchProto[3] || null,
      host: matchProto[4],
      port: parseInt(matchProto[5], 10)
    };
  }

  // Support host:port or host:port:user:pass without protocol prefix
  const parts = raw.split(":");
  if (parts.length >= 2) {
    const host = parts[0].trim();
    const port = parseInt(parts[1].trim(), 10);
    const username = parts[2] ? parts[2].trim() : null;
    const password = parts[3] ? parts[3].trim() : null;
    if (host && !isNaN(port)) {
      const isLikelySocks = [1080, 1081, 1082, 4145, 9050, 10808, 18765, 15303].indexOf(port) !== -1;
      return {
        type: isLikelySocks ? "socks5" : "auto",
        username: username,
        password: password,
        host: host,
        port: port
      };
    }
  }
  return null;
}

/**
 * Load proxies from a TXT file — one proxy per line.
 * Supports:
 *   socks5://user:pass@1.2.3.4:1080
 *   http://1.2.3.4:8080
 *   1.2.3.4:8080
 *   1.2.3.4:8080:username:password
 */
function loadProxiesFromTxt(filePath) {
  try {
    const abs = path_rlm.resolve(filePath);
    const lines = fs_rlm.readFileSync(abs, "utf8").split(/\r?\n/);
    const proxies = [];
    lines.forEach(function (line) {
      const p = _parseProxyUrl(line);
      if (p) proxies.push(p);
    });
    console.log("[PROXY] Loaded " + proxies.length + " proxies from TXT:", abs);
    return proxies;
  } catch (e) {
    console.error("[PROXY] Failed to load TXT proxies:", e.message);
    return [];
  }
}

/**
 * Load proxies from a CSV file.
 * Supported column orders (auto-detected by header or position):
 *   host,port,type,username,password
 *   ip,port,protocol,user,pass
 *   host:port (single column)
 */
function loadProxiesFromCsv(filePath) {
  try {
    const abs = path_rlm.resolve(filePath);
    const lines = fs_rlm.readFileSync(abs, "utf8").split(/\r?\n/);
    const proxies = [];
    let hasHeader = false;
    let colMap = { host: 0, port: 1, type: 2, username: 3, password: 4 };

    lines.forEach(function (line, idx) {
      line = line.trim();
      if (!line || line.startsWith("#")) return;
      const cols = line.split(",").map(function (c) { return c.trim(); });

      // Auto-detect header row
      if (idx === 0 && isNaN(parseInt(cols[1], 10))) {
        hasHeader = true;
        cols.forEach(function (col, i) {
          const c = col.toLowerCase();
          if (c === "host" || c === "ip" || c === "address") colMap.host = i;
          else if (c === "port") colMap.port = i;
          else if (c === "type" || c === "protocol") colMap.type = i;
          else if (c === "username" || c === "user") colMap.username = i;
          else if (c === "password" || c === "pass") colMap.password = i;
        });
        return; // skip header row
      }

      if (cols.length === 1) {
        // Single column: treat as URL
        const p = _parseProxyUrl(cols[0]);
        if (p) proxies.push(p);
        return;
      }

      const host = cols[colMap.host];
      const port = parseInt(cols[colMap.port], 10);
      if (!host || isNaN(port)) return;

      proxies.push({
        type: (cols[colMap.type] || "http").toLowerCase(),
        host: host,
        port: port,
        username: cols[colMap.username] || null,
        password: cols[colMap.password] || null
      });
    });
    console.log("[PROXY] Loaded " + proxies.length + " proxies from CSV:", abs);
    return proxies;
  } catch (e) {
    console.error("[PROXY] Failed to load CSV proxies:", e.message);
    return [];
  }
}

/**
 * Load proxies from a JSON file.
 * Supported formats:
 *   Array: [ { type, host, port, username, password }, ... ]
 *   Array of URL strings: [ "socks5://1.2.3.4:1080", ... ]
 *   Object with proxies key: { "proxies": [...] }
 */
function loadProxiesFromJson(filePath) {
  try {
    const abs = path_rlm.resolve(filePath);
    const raw = fs_rlm.readFileSync(abs, "utf8");
    let data = JSON.parse(raw);
    const proxies = [];

    // Unwrap { proxies: [...] } format
    if (data && !Array.isArray(data) && Array.isArray(data.proxies)) {
      data = data.proxies;
    }

    if (!Array.isArray(data)) {
      console.error("[PROXY] JSON file must contain an array or { proxies: [] }");
      return [];
    }

    data.forEach(function (item) {
      if (typeof item === "string") {
        const p = _parseProxyUrl(item);
        if (p) proxies.push(p);
      } else if (item && typeof item === "object") {
        if (item.proxy && typeof item.proxy === "string") {
          const p = _parseProxyUrl(item.proxy);
          if (p) {
            proxies.push(p);
            return;
          }
        }
        const host = item.host || item.ip || item.address;
        const port = parseInt(item.port, 10);
        if (!host || isNaN(port)) return;
        const proto = String(item.type || item.protocol || (item.ssl ? "https" : "http")).toLowerCase();
        proxies.push({
          type: proto,
          host: host,
          port: port,
          username: item.username || item.user || null,
          password: item.password || item.pass || null
        });
      }
    });
    console.log("[PROXY] Loaded " + proxies.length + " proxies from JSON:", abs);
    return proxies;
  } catch (e) {
    console.error("[PROXY] Failed to load JSON proxies:", e.message);
    return [];
  }
}

/**
 * Load proxies from a file — auto-detects format by extension (.json, .csv, .txt).
 * @param {string} filePath
 * @param {string} [mode] - rotation mode: "round-robin" | "random" | "sticky"
 */
function loadProxyFile(filePath, mode) {
  const ext = path_rlm.extname(filePath).toLowerCase();
  let loaded = [];
  if (ext === ".json") loaded = loadProxiesFromJson(filePath);
  else if (ext === ".csv") loaded = loadProxiesFromCsv(filePath);
  else loaded = loadProxiesFromTxt(filePath); // .txt or any other

  if (loaded.length > 0) {
    _proxyPool = loaded;
    _proxyIndex = 0;
    _botStickyProxy.clear();
    if (mode) _rotationMode = mode;
    console.log("[PROXY] Pool ready: " + _proxyPool.length + " proxies | mode: " + _rotationMode);
  }
  return loaded.length;
}

/**
 * Set proxy pool manually from an array of proxy configs or URL strings.
 * @param {Array} list
 * @param {string} [mode]
 * @param {boolean} [preserveSticky] - whether to keep existing bot sticky assignments for remaining live proxies
 */
function setProxyPool(list, mode, preserveSticky) {
  const parsed = list.map(function (item) {
    if (typeof item === "string") return _parseProxyUrl(item);
    return item;
  }).filter(Boolean);
  _proxyPool = parsed;
  _proxyIndex = 0;
  if (!preserveSticky) {
    _botStickyProxy.clear();
  } else {
    // Keep existing bot sticky assignments if their proxy is still in the pool
    const activeKeys = new Set(parsed.map(function (p) { return p.host + ":" + p.port; }));
    _botStickyProxy.forEach(function (proxy, bId) {
      if (!activeKeys.has(proxy.host + ":" + proxy.port)) {
        _botStickyProxy.delete(bId);
      }
    });
  }
  if (mode) _rotationMode = mode;
  console.log("[PROXY] Pool set: " + _proxyPool.length + " proxies | mode: " + _rotationMode);
}

/**
 * Set a single global proxy (overwrites pool to single entry).
 */
function setGlobalProxy(config) {
  if (typeof config === "string") config = _parseProxyUrl(config);
  _proxyPool = config ? [config] : [];
  _proxyIndex = 0;
  _botStickyProxy.clear();
  console.log("[PROXY] Global proxy set:", config ? (config.type + "://" + config.host + ":" + config.port) : "none");
}

/**
 * Set proxy override for a specific bot (ignores pool rotation).
 */
function setBotProxy(botId, config) {
  if (typeof config === "string") config = _parseProxyUrl(config);
  if (config) {
    _botProxyOverrides.set(botId, config);
  } else {
    _botProxyOverrides.delete(botId);
    _botStickyProxy.delete(botId);
  }
}

/**
 * Get the effective proxy for a given botId.
 * Priority: per-bot override > rotation pool > null
 */
function getProxyForBot(botId) {
  // Explicit per-bot override
  if (_botProxyOverrides.has(botId)) return _botProxyOverrides.get(botId);

  // No pool
  if (_proxyPool.length === 0) return null;
  if (_proxyPool.length === 1) return _proxyPool[0];

  // Sticky: assign once, keep forever
  if (_rotationMode === "sticky") {
    if (!_botStickyProxy.has(botId)) {
      const assigned = _proxyPool[_proxyIndex % _proxyPool.length];
      _proxyIndex++;
      _botStickyProxy.set(botId, assigned);
    }
    return _botStickyProxy.get(botId);
  }

  // Random: pick random each request
  if (_rotationMode === "random") {
    return _proxyPool[Math.floor(Math.random() * _proxyPool.length)];
  }

  // Round-robin (default): cycle through pool per request
  const proxy = _proxyPool[_proxyIndex % _proxyPool.length];
  _proxyIndex++;
  return proxy;
}

// ── Pure Node.js Proxy Agent (Zero External Dependencies) ──────────────────
const _agentCache = new Map();

function _socks5Handshake(sock, proxy, targetHost, targetPort, cb) {
  const hasAuth = !!(proxy.username && proxy.password);
  const methods = hasAuth ? Buffer.from([0x05, 0x01, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
  sock.write(methods);

  sock.once("data", function (resp) {
    if (!resp || resp[0] !== 0x05) return cb(new Error("Invalid SOCKS5 greeting"));
    const selectedMethod = resp[1];

    function sendConnectCmd() {
      const hBuf = Buffer.from(targetHost);
      const pBuf = Buffer.alloc(2);
      pBuf.writeUInt16BE(targetPort, 0);
      const req = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hBuf.length]),
        hBuf,
        pBuf
      ]);
      sock.write(req);
      sock.once("data", function (cmdResp) {
        if (!cmdResp || cmdResp[0] !== 0x05 || cmdResp[1] !== 0x00) {
          return cb(new Error("SOCKS5 connection rejected: " + (cmdResp ? cmdResp[1] : "unknown")));
        }
        cb(null);
      });
    }

    if (selectedMethod === 0x00) {
      sendConnectCmd();
    } else if (selectedMethod === 0x02 && hasAuth) {
      const uBuf = Buffer.from(proxy.username);
      const pwBuf = Buffer.from(proxy.password || "");
      const authReq = Buffer.concat([
        Buffer.from([0x01, uBuf.length]),
        uBuf,
        Buffer.from([pwBuf.length]),
        pwBuf
      ]);
      sock.write(authReq);
      sock.once("data", function (authResp) {
        if (!authResp || authResp[1] !== 0x00) {
          return cb(new Error("SOCKS5 authentication failed"));
        }
        sendConnectCmd();
      });
    } else {
      cb(new Error("SOCKS5 auth method " + selectedMethod + " not supported"));
    }
  });
}

function _httpConnectHandshake(sock, proxy, targetHost, targetPort, cb) {
  let connectReq = "CONNECT " + targetHost + ":" + targetPort + " HTTP/1.1\r\n" +
                   "Host: " + targetHost + ":" + targetPort + "\r\n";
  if (proxy.username) {
    const creds = Buffer.from(proxy.username + ":" + (proxy.password || "")).toString("base64");
    connectReq += "Proxy-Authorization: Basic " + creds + "\r\n";
  }
  connectReq += "\r\n";
  sock.write(connectReq);

  let buf = "";
  function onData(chunk) {
    buf += chunk.toString("latin1");
    if (buf.indexOf("\r\n\r\n") !== -1) {
      sock.removeListener("data", onData);
      const statusLine = buf.split("\r\n")[0];
      const match = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/i);
      const code = match ? parseInt(match[1], 10) : 0;
      if (code >= 200 && code < 300) {
        cb(null);
      } else {
        cb(new Error("HTTP CONNECT proxy returned " + statusLine));
      }
    }
  }
  sock.on("data", onData);
}

function createPureProxyAgent(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return null;
  const cacheKey = proxy.type + ":" + proxy.host + ":" + proxy.port + ":" + (proxy.username || "");
  if (_agentCache.has(cacheKey)) {
    return _agentCache.get(cacheKey);
  }

  const agent = new https_rlm.Agent({
    keepAlive: false,
    timeout: 10000,
    createConnection: function (options, callback) {
      const targetHost = options.host || "discord.com";
      const targetPort = options.port || 443;
      const sock = net_rlm.connect({ host: proxy.host, port: proxy.port });
      sock.setTimeout(10000);

      let finished = false;
      function done(err, tlsSock) {
        if (finished) return;
        finished = true;
        if (err) {
          sock.destroy();
          return callback(err);
        }
        callback(null, tlsSock);
      }

      sock.once("error", function (err) { done(err); });
      sock.once("timeout", function () { done(new Error("Proxy timeout connecting to " + proxy.host + ":" + proxy.port)); });

      sock.once("connect", function () {
        if (proxy.type === "socks5" || proxy.type === "socks4") {
          _socks5Handshake(sock, proxy, targetHost, targetPort, function (err) {
            if (err) return done(err);
            const tlsSock = tls_rlm.connect({ socket: sock, servername: targetHost }, function () {
              done(null, tlsSock);
            });
            tlsSock.once("error", function (err) { done(err); });
          });
        } else {
          // Default to HTTP CONNECT tunnel for http, https, auto, or any standard proxy
          _httpConnectHandshake(sock, proxy, targetHost, targetPort, function (err) {
            if (err) return done(err);
            const tlsSock = tls_rlm.connect({ socket: sock, servername: targetHost }, function () {
              done(null, tlsSock);
            });
            tlsSock.once("error", function (err) { done(err); });
          });
        }
      });
    }
  });

  agent._proxyInfo = proxy;
  _agentCache.set(cacheKey, agent);
  return agent;
}

/**
 * Build an HTTPS agent for the given botId's effective proxy.
 * Uses pure built-in Node.js networking (zero npm dependencies required).
 */
function buildProxyAgent(botId) {
  const proxy = getProxyForBot(botId);
  if (!proxy) return null;
  return createPureProxyAgent(proxy);
}

/**
 * Get proxy pool stats.
 */
function getProxyPoolInfo() {
  return {
    total: _proxyPool.length,
    mode: _rotationMode,
    botOverrides: _botProxyOverrides.size,
    stickyAssigned: _botStickyProxy.size,
    sample: _proxyPool.slice(0, 3).map(function (p) {
      return p.type + "://" + p.host + ":" + p.port;
    })
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats helper
// ─────────────────────────────────────────────────────────────────────────────
function getStats() {
  return {
    ipTokens: Math.floor(_tokens),
    ipQueueSize: _ipQueue.length,
    identifyQueueSize: _identifyQueue.length,
    lastIdentifyAt: _lastIdentifyAt,
    trackedBots: _botBuckets.size,
    proxy: getProxyPoolInfo()
  };
}

// ── Auto-init from ENV on startup ────────────────────────────────────────────
(function initProxyFromEnv() {
  // Single proxy URL: ARIXA_PROXY_URL=socks5://user:pass@1.2.3.4:1080
  const singleUrl = process.env.ARIXA_PROXY_URL;
  if (singleUrl) {
    const p = _parseProxyUrl(singleUrl);
    if (p) {
      _proxyPool = [p];
      console.log("[PROXY] Loaded from ARIXA_PROXY_URL:", p.type + "://" + p.host + ":" + p.port);
      return;
    }
  }

  // Proxy file: ARIXA_PROXY_FILE=./proxies.txt  (or .json or .csv)
  const proxyFile = process.env.ARIXA_PROXY_FILE;
  if (proxyFile) {
    const mode = process.env.ARIXA_PROXY_MODE || "round-robin"; // round-robin | random | sticky
    loadProxyFile(proxyFile, mode);
  }
})();

/**
 * Destroy and clear any cached agent for a specific proxy host:port
 */
function destroyProxyAgent(host, port) {
  _agentCache.forEach(function (agent, key) {
    if (key.includes(":" + host + ":" + port + ":")) {
      try { agent.destroy(); } catch (e) {}
      _agentCache.delete(key);
    }
  });
}

/**
 * Handle proxy failure: clear sticky assignments so bots auto-failover to next working proxy
 */
function onProxyFailed(host, port) {
  _botStickyProxy.forEach(function (proxy, bId) {
    if (proxy.host === host && proxy.port === port) {
      _botStickyProxy.delete(bId);
      console.log("[PROXY] Re-assigning sticky proxy for bot " + bId + " because " + host + ":" + port + " failed.");
    }
  });
  destroyProxyAgent(host, port);
}

module.exports = {
  // Phase 1 — Per-bot REST rate limits
  recordRateLimit,
  getRouteWait,
  clearBotBuckets,

  // Phase 2 — Gateway IDENTIFY queue
  queueIdentify,
  cancelIdentify,

  // Phase 3 — Global IP token bucket
  acquireIpToken,

  // Phase 4 — Proxy support (multi-format + rotation)
  setGlobalProxy,
  setBotProxy,
  setProxyPool,
  loadProxyFile,
  loadProxiesFromTxt,
  loadProxiesFromCsv,
  loadProxiesFromJson,
  getProxyForBot,
  buildProxyAgent,
  destroyProxyAgent,
  onProxyFailed,
  getProxyPoolInfo,

  // Stats
  getStats
};
