const http = require("http");
const https = require("https");
const { URL } = require("url");

let WSClient = null;
try {
  WSClient = require("ws");
} catch (e) {
  if (typeof WebSocket !== "undefined") {
    WSClient = WebSocket;
  }
}

// Global players map: guildId -> Player (persisted on globalThis across plugin reloads)
const players = globalThis.__ARIXA_LAVALINK_PLAYERS__ || new Map();
globalThis.__ARIXA_LAVALINK_PLAYERS__ = players;

// Global node connections: nodeKey -> LavalinkNode (persisted across plugin reloads)
const nodes = globalThis.__ARIXA_LAVALINK_NODES__ || new Map();
globalThis.__ARIXA_LAVALINK_NODES__ = nodes;

function formatDuration(ms) {
  const num = Number(ms) || 0;
  if (num <= 0) return "00:00";
  const totalSeconds = Math.floor(num / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = function (n) { return String(n).padStart(2, "0"); };
  if (days > 0) {
    return days + "d " + pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
  }
  if (hours > 0) {
    return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
  }
  return pad(minutes) + ":" + pad(seconds);
}

function parseSeekTime(str) {
  if (!str) return null;
  const clean = String(str).trim();
  if (/^\d+$/.test(clean)) {
    return parseInt(clean, 10) * 1000;
  }
  const parts = clean.split(":").map(function (s) { return parseInt(s, 10); });
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  if (parts.length === 3) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }
  return null;
}

function getNodeConfig(ctx) {
  const cfg = (ctx && ctx.config) || {};
  let rawHost = String(cfg.lavalink_host || "127.0.0.1").trim();
  let secure = String(cfg.lavalink_secure || "false").toLowerCase() === "true" || cfg.lavalink_secure === true;
  let port = parseInt(cfg.lavalink_port, 10);

  // Auto-detect secure protocol from URL prefix
  if (rawHost.startsWith("https://") || rawHost.startsWith("wss://")) {
    secure = true;
    rawHost = rawHost.replace(/^(https?|wss?):\/\//i, "");
  } else if (rawHost.startsWith("http://") || rawHost.startsWith("ws://")) {
    rawHost = rawHost.replace(/^(https?|wss?):\/\//i, "");
  }

  // Strip path or trailing slashes
  rawHost = rawHost.replace(/\/.*$/, "").trim();

  // Handle embedded port in host string (e.g. host.com:25839)
  if (rawHost.includes(":")) {
    const parts = rawHost.split(":");
    rawHost = parts[0];
    if (!port || isNaN(port)) {
      port = parseInt(parts[1], 10);
    }
  }

  if (!port || isNaN(port)) {
    port = secure ? 443 : 2333;
  }

  return {
    host: rawHost || "127.0.0.1",
    port: port,
    password: String(cfg.lavalink_pass || "youshallnotpass").trim(),
    secure: secure,
    defaultVolume: Math.min(100, Math.max(1, parseInt(cfg.default_volume, 10) || 80))
  };
}

function getNodeKey(config) {
  return (config.secure ? "https://" : "http://") + config.host + ":" + config.port;
}

function restRequest(config, method, path, body) {
  return new Promise(function (resolve, reject) {
    const isHttps = config.secure;
    const client = isHttps ? https : http;
    const postData = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: config.password,
      "User-Agent": "Arixa-Music/1.0",
      Accept: "application/json"
    };
    if (postData) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(postData);
    }
    const options = {
      hostname: config.host,
      port: config.port,
      path: path,
      method: method,
      headers: headers,
      timeout: 8000
    };

    const req = client.request(options, function (res) {
      let data = "";
      res.on("data", function (chunk) { data += chunk; });
      res.on("end", function () {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({ status: res.statusCode, data: json });
      });
    });

    req.on("timeout", function () {
      req.destroy(new Error("Lavalink request timed out"));
    });
    req.on("error", function (err) {
      reject(err);
    });
    if (postData) req.write(postData);
    req.end();
  });
}

function checkHealth(config) {
  const start = Date.now();
  return restRequest(config, "GET", "/version").then(function (res) {
    if (res && res.status === 200) {
      return {
        ok: true,
        version: String(res.data || "").trim(),
        ping: Math.max(1, Date.now() - start)
      };
    }
    return { ok: false };
  }).catch(function () {
    return { ok: false };
  });
}

async function loadTracks(config, query) {
  const clean = query.trim();
  const isUrl = /^https?:\/\//i.test(clean);
  let identifier = isUrl ? clean : (clean.includes(":") ? clean : ("ytsearch:" + clean));

  let res = null;
  // Try v4 endpoint first
  try {
    res = await restRequest(config, "GET", "/v4/loadtracks?identifier=" + encodeURIComponent(identifier));
  } catch (err) {
    throw err;
  }

  // Fallback to v3 if v4 returned 404
  if (res && res.status === 404) {
    try {
      res = await restRequest(config, "GET", "/loadtracks?identifier=" + encodeURIComponent(identifier));
    } catch (e) {}
  }

  // If ytsearch returned empty, fallback to YouTube Music search (ytmsearch:)
  if (!isUrl && (!res || !res.data || res.data.loadType === "empty" || (Array.isArray(res.data.data) && res.data.data.length === 0))) {
    try {
      const ytmRes = await restRequest(config, "GET", "/v4/loadtracks?identifier=" + encodeURIComponent("ytmsearch:" + clean));
      if (ytmRes && ytmRes.data && ytmRes.data.loadType !== "empty") {
        res = ytmRes;
      }
    } catch (e) {}
  }

  if (!res || !res.data) return { loadType: "empty", tracks: [] };

  const raw = res.data;
  // Parse Lavalink v4
  if (raw.loadType === "track") {
    const t = raw.data;
    return { loadType: "track", tracks: [formatTrack(t)] };
  }
  if (raw.loadType === "playlist") {
    const list = Array.isArray(raw.data.tracks) ? raw.data.tracks.map(formatTrack) : [];
    return { loadType: "playlist", name: raw.data.info && raw.data.info.name, tracks: list };
  }
  if (raw.loadType === "search") {
    const list = Array.isArray(raw.data) ? raw.data.map(formatTrack) : [];
    return { loadType: "search", tracks: list };
  }

  // Parse Lavalink v3 fallback
  if (raw.loadType === "TRACK_LOADED" && Array.isArray(raw.tracks)) {
    return { loadType: "track", tracks: raw.tracks.slice(0, 1).map(formatTrackV3) };
  }
  if (raw.loadType === "PLAYLIST_LOADED" && Array.isArray(raw.tracks)) {
    return { loadType: "playlist", name: raw.playlistInfo && raw.playlistInfo.name, tracks: raw.tracks.map(formatTrackV3) };
  }
  if (raw.loadType === "SEARCH_RESULT" && Array.isArray(raw.tracks)) {
    return { loadType: "search", tracks: raw.tracks.map(formatTrackV3) };
  }

  return { loadType: "empty", tracks: [] };
}

function formatTrack(t) {
  if (!t) return null;
  const info = t.info || {};
  return {
    encoded: t.encoded,
    title: String(info.title || "Unknown Title").slice(0, 100),
    author: String(info.author || "Unknown Artist").slice(0, 60),
    length: Number(info.length || 0),
    uri: info.uri || null,
    identifier: info.identifier || null,
    isStream: Boolean(info.isStream),
    thumbnail: info.artworkUrl || (info.identifier ? ("https://img.youtube.com/vi/" + info.identifier + "/mqdefault.jpg") : null)
  };
}

function formatTrackV3(t) {
  if (!t) return null;
  const info = t.info || {};
  return {
    encoded: t.track,
    title: String(info.title || "Unknown Title").slice(0, 100),
    author: String(info.author || "Unknown Artist").slice(0, 60),
    length: Number(info.length || 0),
    uri: info.uri || null,
    identifier: info.identifier || null,
    isStream: Boolean(info.isStream),
    thumbnail: info.identifier ? ("https://img.youtube.com/vi/" + info.identifier + "/mqdefault.jpg") : null
  };
}

class LavalinkNode {
  constructor(config, botId) {
    this.config = config;
    this.botId = botId;
    this.key = getNodeKey(config);
    this.sessionId = null;
    this.ws = null;
    this.online = false;
    this.ping = 0;
    this.stats = {
      players: 0,
      playingPlayers: 0,
      uptime: 0,
      memory: { used: 0, free: 0, allocated: 0 }
    };
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.connect();
    this.startPingInterval();
  }

  startPingInterval() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const self = this;
    this.pingTimer = setInterval(function () {
      if (self.online) {
        const start = Date.now();
        restRequest(self.config, "GET", "/version").then(function (res) {
          if (res && res.status === 200) {
            self.ping = Math.max(1, Date.now() - start);
            self.online = true;
          }
        }).catch(function () {});
      }
    }, 30000);
  }

  connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        if (typeof this.ws.terminate === "function") this.ws.terminate();
        else if (typeof this.ws.close === "function") this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    if (!WSClient) {
      try {
        WSClient = require("ws");
      } catch (e) {
        if (typeof WebSocket !== "undefined") {
          WSClient = WebSocket;
        }
      }
    }

    if (!WSClient) {
      this.online = false;
      return;
    }

    const proto = this.config.secure ? "wss://" : "ws://";
    const wsUrl = proto + this.config.host + ":" + this.config.port + "/v4/websocket";
    const headers = {
      Authorization: this.config.password,
      "User-Id": String(this.botId || "1144576489661149288"),
      "Client-Name": "Arixa-Music/1.0"
    };

    try {
      this.ws = new WSClient(wsUrl, { headers: headers });
      const self = this;
      const startPing = Date.now();

      const onOpen = function () {
        self.online = true;
        self.ping = Math.max(1, Date.now() - startPing);
      };

      const onMessage = function (event) {
        try {
          const raw = (event && event.data !== undefined) ? event.data : event;
          const text = typeof raw === "string" ? raw : (raw ? raw.toString("utf8") : "");
          const msg = JSON.parse(text);

          if (msg.op === "ready") {
            self.sessionId = msg.sessionId;
            self.online = true;

            // Immediately replay or sync voice on any pending players
            players.forEach(function (player) {
              if (player && player.voiceServer && player.voiceState) {
                if (player.current && !player.paused) {
                  self.play(player, player.current);
                } else {
                  self.updateVoice(player);
                }
              }
            });
          } else if (msg.op === "stats") {
            self.stats = msg;
            self.online = true;
          } else if (msg.op === "event") {
            self.handleEvent(msg);
          } else if (msg.op === "playerUpdate" && msg.guildId) {
            const p = players.get(msg.guildId);
            if (p && msg.state && typeof msg.state.position === "number") {
              p.position = msg.state.position;
            }
          }
        } catch (e) {}
      };

      const onError = function () {
        self.online = false;
      };

      const onClose = function () {
        self.online = false;
        self.sessionId = null;
        if (!self.reconnectTimer) {
          self.reconnectTimer = setTimeout(function () {
            self.reconnectTimer = null;
            self.connect();
          }, 5000);
        }
      };

      this.ws.onopen = onOpen;
      this.ws.onmessage = onMessage;
      this.ws.onerror = onError;
      this.ws.onclose = onClose;

      if (typeof this.ws.on === "function") {
        this.ws.on("open", onOpen);
        this.ws.on("message", onMessage);
        this.ws.on("error", onError);
        this.ws.on("close", onClose);
      }
    } catch (err) {
      this.online = false;
      const self = this;
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(function () {
          self.reconnectTimer = null;
          self.connect();
        }, 5000);
      }
    }
  }

  handleEvent(event) {
    const guildId = event.guildId;
    if (!guildId) return;
    const p = players.get(guildId);
    if (!p) return;

    if (event.type === "TrackEndEvent") {
      // Reason: finished, loadFailed, stopped, replaced, cleanup
      if (event.reason === "finished" || event.reason === "loadFailed") {
        if (p.loop === "track" && p.current) {
          // Replay current track
          this.play(p, p.current);
          return;
        }
        if (p.loop === "queue" && p.current) {
          // Push current to back of queue
          p.queue.push(p.current);
        }
        playNext(p, this);
      }
    } else if (event.type === "TrackExceptionEvent" || event.type === "TrackStuckEvent") {
      playNext(p, this);
    }
  }

  async play(player, track) {
    if (!player || !track) return;
    player.current = track;
    player.position = 0;
    player.paused = false;

    if (!this.sessionId) return;
    const path = "/v4/sessions/" + this.sessionId + "/players/" + player.guildId + "?noReplace=false";
    const body = {
      track: { encoded: track.encoded },
      volume: player.volume,
      paused: false
    };
    if (player.voiceState && player.voiceServer) {
      const channelId = (player.voiceState && player.voiceState.channel_id) || player.voiceChannelId || null;
      body.voice = {
        token: player.voiceServer.token,
        endpoint: player.voiceServer.endpoint,
        sessionId: player.voiceState.session_id,
        channelId: channelId ? String(channelId) : null
      };
    }
    try {
      const res = await restRequest(this.config, "PATCH", path, body);
      if (res && res.status >= 400) {
        console.error("[Lavalink] Player PATCH failed:", res.status, JSON.stringify(res.data));
      }
    } catch (e) {
      console.error("[Lavalink] Player PATCH error:", e.message);
    }
  }

  async updateVoice(player) {
    if (!this.sessionId || !player || !player.voiceState || !player.voiceServer) return;
    const path = "/v4/sessions/" + this.sessionId + "/players/" + player.guildId;
    const channelId = (player.voiceState && player.voiceState.channel_id) || player.voiceChannelId || null;
    const body = {
      voice: {
        token: player.voiceServer.token,
        endpoint: player.voiceServer.endpoint,
        sessionId: player.voiceState.session_id,
        channelId: channelId ? String(channelId) : null
      }
    };
    try {
      const res = await restRequest(this.config, "PATCH", path, body);
      if (res && res.status >= 400) {
        console.error("[Lavalink] Voice PATCH failed:", res.status, JSON.stringify(res.data));
      }
    } catch (e) {
      console.error("[Lavalink] Voice PATCH error:", e.message);
    }
  }

  async setPause(player, paused) {
    if (!player) return;
    player.paused = Boolean(paused);
    if (!this.sessionId) return;
    const path = "/v4/sessions/" + this.sessionId + "/players/" + player.guildId;
    try {
      await restRequest(this.config, "PATCH", path, { paused: player.paused });
    } catch (e) {}
  }

  async setVolume(player, volume) {
    if (!player) return;
    player.volume = Math.min(100, Math.max(1, volume));
    if (!this.sessionId) return;
    const path = "/v4/sessions/" + this.sessionId + "/players/" + player.guildId;
    try {
      await restRequest(this.config, "PATCH", path, { volume: player.volume });
    } catch (e) {}
  }

  async seek(player, positionMs) {
    if (!player) return;
    player.position = positionMs;
    if (!this.sessionId) return;
    const path = "/v4/sessions/" + this.sessionId + "/players/" + player.guildId;
    try {
      await restRequest(this.config, "PATCH", path, { position: positionMs });
    } catch (e) {}
  }

  async stop(player) {
    if (!player) return;
    player.current = null;
    player.queue = [];
    player.paused = false;
    player.position = 0;
    if (!this.sessionId) return;
    const path = "/v4/sessions/" + this.sessionId + "/players/" + player.guildId;
    try {
      await restRequest(this.config, "PATCH", path, { track: { encoded: null } });
    } catch (e) {}
  }

  async destroy(player) {
    if (!player) return;
    player.current = null;
    player.queue = [];
    if (this.sessionId) {
      const path = "/v4/sessions/" + this.sessionId + "/players/" + player.guildId;
      try {
        await restRequest(this.config, "DELETE", path);
      } catch (e) {}
    }
  }
}

function getNode(ctx) {
  const cfg = getNodeConfig(ctx);
  const botId = (ctx && (ctx.botUserId || ctx.botId)) || "1144576489661149288";
  const key = getNodeKey(cfg) + ":" + botId;
  let node = nodes.get(key);
  if (!node) {
    node = new LavalinkNode(cfg, botId);
    nodes.set(key, node);
  } else {
    // If node was marked offline and ws is closed or terminating, trigger reconnect
    if (!node.online && (!node.ws || node.ws.readyState === 2 || node.ws.readyState === 3)) {
      node.connect();
    }
  }
  return node;
}

function getPlayer(guildId) {
  return players.get(String(guildId));
}

function createPlayer(ctx, voiceChannelId) {
  const guildId = String(ctx.guildId);
  const cfg = getNodeConfig(ctx);
  let player = players.get(guildId);
  if (!player) {
    player = {
      guildId: guildId,
      textChannelId: String(ctx.channelId),
      voiceChannelId: String(voiceChannelId),
      current: null,
      queue: [],
      volume: cfg.defaultVolume || 80,
      paused: false,
      loop: "off", // off | track | queue
      position: 0,
      voiceState: null,
      voiceServer: null,
      idleTimer: null,
      ctx: ctx
    };
    players.set(guildId, player);
  } else {
    player.textChannelId = String(ctx.channelId);
    player.voiceChannelId = String(voiceChannelId);
    player.ctx = ctx;
  }
  return player;
}

function playNext(player, node) {
  if (!player) return;
  if (player.idleTimer) {
    clearTimeout(player.idleTimer);
    player.idleTimer = null;
  }

  if (player.queue.length === 0) {
    player.current = null;
    // Auto-leave after 2 minutes idle if no tracks are added
    player.idleTimer = setTimeout(function () {
      if (player.queue.length === 0 && !player.current) {
        destroyPlayer(player.guildId, player.ctx);
      }
    }, 120000);
    return;
  }

  const next = player.queue.shift();
  node.play(player, next);
}

function destroyPlayer(guildId, ctx) {
  const p = players.get(String(guildId));
  if (!p) return;
  if (p.idleTimer) clearTimeout(p.idleTimer);
  players.delete(String(guildId));

  if (ctx) {
    const node = getNode(ctx);
    if (node) node.destroy(p);
    if (typeof ctx.sendVoiceStateUpdate === "function") {
      ctx.sendVoiceStateUpdate(guildId, null);
    }
  }
}

module.exports = {
  formatDuration: formatDuration,
  parseSeekTime: parseSeekTime,
  getNodeConfig: getNodeConfig,
  checkHealth: checkHealth,
  getNode: getNode,
  getPlayer: getPlayer,
  createPlayer: createPlayer,
  playNext: playNext,
  destroyPlayer: destroyPlayer,
  loadTracks: loadTracks,
  players: players,
  nodes: nodes
};
