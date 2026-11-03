/**
 * Arixa Proxy Health Manager
 * ==========================
 * Free proxies ke liye smart auto-filter + health checking system.
 *
 * Features:
 * - Startup pe saari proxies ko test kare, dead ko skip kare
 * - Har X minutes me background me re-check kare
 * - Failed proxies ko cooldown me daale (turant remove nahi, cooldown ke baad retry)
 * - Working proxies me se best (fastest) ko prefer kare
 * - rateLimitManager ke pool ko automatically update kare
 */

"use strict";

const net = require("net");
const tls = require("tls");
const path = require("path");
const fs = require("fs");
const rlm = require("./rateLimitManager.js");

// ── Config ──────────────────────────────────────────────────────────────────
const CHECK_TIMEOUT_MS = 2500;      // 2.5s max per proxy test
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Har 5 minute me background re-check
const FAIL_COOLDOWN_MS = 3 * 60 * 1000;          // Failed proxy 3 min baad retry
const MIN_WORKING_PROXIES = 1;      // Warning threshold
const TARGET_WORKING_PROXIES = 15;  // Stop checking as soon as 15 working proxies found (fast boot)
const MAX_CONCURRENT_CHECKS = 8;    // Safe concurrency on Android / Termux

// ── State ───────────────────────────────────────────────────────────────────
let _allProxies = [];       // Full original list
let _workingProxies = [];   // Abhi kaam karne wali
let _failedCooldown = new Map(); // ip:port → failedAt timestamp
let _checkTimer = null;
let _isChecking = false;
let _rotationMode = "round-robin";

// ── Core: Test ek proxy ki real Discord tunnel connectivity (SOCKS5 + HTTP) ──
function _testSocks5(proxy) {
  return new Promise(function (resolve) {
    let sock = null;
    let resolved = false;

    function safeResolve(res) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { if (sock) { sock.removeAllListeners(); sock.destroy(); } } catch (e) {}
      resolve(res);
    }

    const timer = setTimeout(function () {
      safeResolve({ ok: false, proxy: proxy });
    }, CHECK_TIMEOUT_MS);

    try {
      sock = net.connect({ host: proxy.host, port: proxy.port });
    } catch (e) {
      return safeResolve({ ok: false, proxy: proxy });
    }

    const start = Date.now();
    sock.once("error", function () { safeResolve({ ok: false, proxy: proxy }); });
    sock.once("timeout", function () { safeResolve({ ok: false, proxy: proxy }); });

    sock.once("connect", function () {
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
      sock.once("data", function (g) {
        if (!g || g[0] !== 0x05 || g[1] !== 0x00) {
          return safeResolve({ ok: false, proxy: proxy });
        }
        proxy.type = "socks5";
        const hBuf = Buffer.from("discord.com");
        const pBuf = Buffer.alloc(2);
        pBuf.writeUInt16BE(443, 0);
        sock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hBuf.length]), hBuf, pBuf]));
        sock.once("data", function (c) {
          if (c && c[0] === 0x05 && c[1] === 0x00) {
            safeResolve({ ok: true, ms: Date.now() - start, proxy: proxy });
          } else {
            safeResolve({ ok: false, proxy: proxy });
          }
        });
      });
    });
  });
}

function _testHttpConnect(proxy) {
  return new Promise(function (resolve) {
    let sock = null;
    let resolved = false;

    function safeResolve(res) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { if (sock) { sock.removeAllListeners(); sock.destroy(); } } catch (e) {}
      resolve(res);
    }

    const timer = setTimeout(function () {
      safeResolve({ ok: false, proxy: proxy });
    }, CHECK_TIMEOUT_MS);

    try {
      sock = net.connect({ host: proxy.host, port: proxy.port });
    } catch (e) {
      return safeResolve({ ok: false, proxy: proxy });
    }

    const start = Date.now();
    sock.once("error", function () { safeResolve({ ok: false, proxy: proxy }); });
    sock.once("timeout", function () { safeResolve({ ok: false, proxy: proxy }); });

    sock.once("connect", function () {
      let connectReq = "CONNECT discord.com:443 HTTP/1.1\r\nHost: discord.com:443\r\n";
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
          if (/HTTP\/\d\.\d\s+200/i.test(buf)) {
            proxy.type = "http";
            safeResolve({ ok: true, ms: Date.now() - start, proxy: proxy });
          } else {
            safeResolve({ ok: false, proxy: proxy });
          }
        }
      }
      sock.on("data", onData);
    });
  });
}

function testProxy(proxy) {
  const isSocks = proxy.type === "socks5" || proxy.type === "socks4" ||
    (proxy.type !== "http" && proxy.type !== "https" && [1080, 1081, 1082, 4145, 9050, 10808, 18765, 15303].indexOf(proxy.port) !== -1);

  if (isSocks) {
    return _testSocks5(proxy).then(function (res) {
      if (res.ok) return res;
      if (proxy.type === "auto" || !proxy.type) {
        return _testHttpConnect(proxy);
      }
      return res;
    });
  } else {
    return _testHttpConnect(proxy).then(function (res) {
      if (res.ok) return res;
      if (proxy.type === "auto" || !proxy.type) {
        return _testSocks5(proxy);
      }
      return res;
    });
  }
}

// ── Batch test with smart early-exit (stops once 15 working proxies found) ───
function testBatch(proxies, concurrency) {
  return new Promise(function (resolve) {
    const results = [];
    let idx = 0;
    let active = 0;
    let workingFound = 0;
    const maxToTest = Math.min(proxies.length, 120);

    function next() {
      if (workingFound >= TARGET_WORKING_PROXIES) {
        if (active === 0) resolve(results);
        return;
      }

      while (active < concurrency && idx < maxToTest && workingFound < TARGET_WORKING_PROXIES) {
        const p = proxies[idx++];
        active++;
        testProxy(p).then(function (res) {
          results.push(res);
          if (res.ok) workingFound++;
          active--;
          next();
          if (active === 0 && (idx >= maxToTest || workingFound >= TARGET_WORKING_PROXIES)) {
            resolve(results);
          }
        });
      }
    }
    next();
    if (proxies.length === 0) resolve([]);
  });
}

// ── Main health check ────────────────────────────────────────────────────────
function runHealthCheck(silent) {
  if (_isChecking || _allProxies.length === 0) return Promise.resolve();
  _isChecking = true;
  if (!silent) console.log("[PROXY_HEALTH] Checking " + _allProxies.length + " proxies...");

  return testBatch(_allProxies, MAX_CONCURRENT_CHECKS).then(function (results) {
    const working = [];
    const now = Date.now();

    results.forEach(function (res) {
      const key = res.proxy.host + ":" + res.proxy.port;
      if (res.ok) {
        res.proxy._lastCheckMs = res.ms;
        res.proxy._lastSeen = now;
        _failedCooldown.delete(key);
        working.push(res.proxy);
      } else {
        _failedCooldown.set(key, now);
      }
    });

    // Sort by response time (fastest first)
    working.sort(function (a, b) { return (a._lastCheckMs || 9999) - (b._lastCheckMs || 9999); });
    _workingProxies = working;

    // Update rateLimitManager pool
    rlm.setProxyPool(_workingProxies, _rotationMode);

    if (!silent) {
      console.log("[PROXY_HEALTH] Working: " + working.length + "/" + _allProxies.length +
        " | Mode: " + _rotationMode +
        (working.length > 0 ? " | Fastest: " + working[0].host + ":" + working[0].port + " (" + working[0]._lastCheckMs + "ms)" : ""));
    }

    if (working.length < MIN_WORKING_PROXIES) {
      console.warn("[PROXY_HEALTH] WARNING: Only " + working.length + " working proxies left! Bots may use direct connection.");
    }

    _isChecking = false;
    return working;
  });
}

// ── Mark a proxy as failed (called by discordRequest on connection error) ──
function markProxyFailed(host, port) {
  const key = host + ":" + port;
  _failedCooldown.set(key, Date.now());

  // Remove from working list immediately
  const before = _workingProxies.length;
  _workingProxies = _workingProxies.filter(function (p) {
    return !(p.host === host && p.port === port);
  });

  if (_workingProxies.length < before) {
    console.warn("[PROXY_HEALTH] Proxy marked dead: " + key + " | Remaining: " + _workingProxies.length);
    rlm.setProxyPool(_workingProxies, _rotationMode, true);
  }
  // Free any cached sockets/agent and clear sticky bot assignments for this dead proxy
  try {
    rlm.onProxyFailed(host, port);
  } catch (e) {}
}

// ── Periodic re-check ────────────────────────────────────────────────────────
function startAutoCheck() {
  if (_checkTimer) clearInterval(_checkTimer);
  _checkTimer = setInterval(function () {
    runHealthCheck(false);
  }, HEALTH_CHECK_INTERVAL_MS);
  // Keep timer non-blocking so process can exit if needed
  if (_checkTimer.unref) _checkTimer.unref();
}

function stopAutoCheck() {
  if (_checkTimer) {
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}

// ── Load from file (JSON/TXT/CSV) + run initial health check ─────────────────
/**
 * Load proxies from ONE file and run initial health check.
 * @param {string} filePath  - Path to proxy file (.json, .txt, .csv)
 * @param {string} [mode]    - "round-robin" | "random" | "sticky"
 * @param {boolean} [skipCheck] - Skip initial health check (use all proxies as-is)
 * @returns {Promise<number>} - Count of working proxies after check
 */
function loadAndCheck(filePath, mode, skipCheck) {
  _rotationMode = mode || "round-robin";
  const loaded = _loadFile(filePath);
  _allProxies = _dedup(loaded);
  console.log("[PROXY_HEALTH] Loaded " + _allProxies.length + " proxies from 1 file. Mode: " + _rotationMode);
  return _finishLoad(skipCheck);
}

/**
 * Load proxies from MULTIPLE files, merge + deduplicate, then health check.
 * @param {string[]} filePaths - Array of file paths
 * @param {string} [mode]
 * @param {boolean} [skipCheck]
 * @returns {Promise<number>}
 */
function loadMultipleAndCheck(filePaths, mode, skipCheck) {
  _rotationMode = mode || "round-robin";
  let combined = [];
  filePaths.forEach(function (f) {
    try {
      const loaded = _loadFile(f);
      combined = combined.concat(loaded);
    } catch (e) {
      console.warn("[PROXY_HEALTH] Skipping file (error):", f, e.message);
    }
  });
  _allProxies = _dedup(combined);
  console.log("[PROXY_HEALTH] Loaded " + _allProxies.length + " unique proxies from " + filePaths.length + " files. Mode: " + _rotationMode);
  return _finishLoad(skipCheck);
}

// Internal helper: load one file by extension
function _loadFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return rlm.loadProxiesFromJson(filePath);
  if (ext === ".csv") return rlm.loadProxiesFromCsv(filePath);
  return rlm.loadProxiesFromTxt(filePath);
}

// Internal helper: deduplicate by host:port
function _dedup(list) {
  const seen = new Set();
  return list.filter(function (p) {
    const key = p.host + ":" + p.port;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Internal helper: finish loading (skipCheck or health check)
function _finishLoad(skipCheck) {
  if (skipCheck) {
    _workingProxies = _allProxies;
    rlm.setProxyPool(_workingProxies, _rotationMode);
    startAutoCheck();
    return Promise.resolve(_allProxies.length);
  }
  return runHealthCheck(false).then(function (working) {
    startAutoCheck();
    return working.length;
  });
}

/**
 * Load from env vars at startup.
 * Supports:
 *   ARIXA_PROXY_FILE=./path/to/file.json          (single file)
 *   ARIXA_PROXY_FILES=./f1.json,./f2.json,./f3.json  (multiple files, comma-separated)
 *   ARIXA_PROXY_DIR=./src/proxy                   (load ALL files in a directory)
 */
function initFromEnv() {
  const mode = process.env.ARIXA_PROXY_MODE || "round-robin";
  const skipCheck = process.env.ARIXA_PROXY_SKIP_CHECK === "true";

  // Option 1: Directory — load all .json/.txt/.csv files in folder
  const proxyDir = process.env.ARIXA_PROXY_DIR;
  if (proxyDir) {
    const absDir = path.resolve(proxyDir);
    if (!fs.existsSync(absDir)) {
      console.warn("[PROXY_HEALTH] ARIXA_PROXY_DIR not found:", absDir);
      return Promise.resolve(0);
    }
    const files = fs.readdirSync(absDir)
      .filter(function (f) { return /\.(json|txt|csv)$/i.test(f); })
      .map(function (f) { return path.join(absDir, f); });
    if (files.length === 0) {
      console.warn("[PROXY_HEALTH] No proxy files found in dir:", absDir);
      return Promise.resolve(0);
    }
    console.log("[PROXY_HEALTH] Found " + files.length + " file(s) in dir:", absDir);
    return loadMultipleAndCheck(files, mode, skipCheck);
  }

  // Option 2: Multiple files (comma-separated)
  const proxyFiles = process.env.ARIXA_PROXY_FILES;
  if (proxyFiles) {
    const files = proxyFiles.split(",").map(function (f) { return f.trim(); }).filter(Boolean);
    const existing = files.filter(function (f) {
      if (!fs.existsSync(path.resolve(f))) {
        console.warn("[PROXY_HEALTH] File not found (skipping):", f);
        return false;
      }
      return true;
    });
    if (existing.length === 0) return Promise.resolve(0);
    return loadMultipleAndCheck(existing, mode, skipCheck);
  }

  // Option 3: Single file
  const proxyFile = process.env.ARIXA_PROXY_FILE;
  if (proxyFile) {
    if (!fs.existsSync(path.resolve(proxyFile))) {
      console.warn("[PROXY_HEALTH] ARIXA_PROXY_FILE not found:", proxyFile);
      return Promise.resolve(0);
    }
    return loadAndCheck(proxyFile, mode, skipCheck);
  }

  return Promise.resolve(0);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function getHealthStats() {
  return {
    total: _allProxies.length,
    working: _workingProxies.length,
    dead: _failedCooldown.size,
    mode: _rotationMode,
    isChecking: _isChecking,
    fastest: _workingProxies[0]
      ? (_workingProxies[0].host + ":" + _workingProxies[0].port + " (" + (_workingProxies[0]._lastCheckMs || "?") + "ms)")
      : "none"
  };
}

module.exports = {
  loadAndCheck,
  loadMultipleAndCheck,
  initFromEnv,
  runHealthCheck,
  markProxyFailed,
  startAutoCheck,
  stopAutoCheck,
  getHealthStats
};
