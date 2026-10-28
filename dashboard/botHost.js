const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const emojiUtil = require("../utils/system/emoji.js");

const runningBots = new Map();

const PLUGINS_DIR = path.join(__dirname, "..", "src", "plugins");
const USER_PLUGINS_DIR = path.join(__dirname, "..", "data", "plugins");
const PLUGIN_DIRS = [PLUGINS_DIR, USER_PLUGINS_DIR];
const USERS_DIR = path.join(__dirname, "..", "data", "users");

const INTENT_BITS = {
  GUILDS: 1,
  GUILD_MEMBERS: 2,
  GUILD_MODERATION: 4,
  GUILD_EXPRESSIONS: 8,
  GUILD_INTEGRATIONS: 16,
  GUILD_WEBHOOKS: 32,
  GUILD_INVITES: 64,
  GUILD_VOICE_STATES: 128,
  GUILD_PRESENCES: 256,
  GUILD_MESSAGES: 512,
  GUILD_MESSAGE_REACTIONS: 1024,
  GUILD_MESSAGE_TYPING: 2048,
  DIRECT_MESSAGES: 4096,
  DIRECT_MESSAGE_REACTIONS: 8192,
  DIRECT_MESSAGE_TYPING: 16384,
  MESSAGE_CONTENT: 32768,
  GUILD_SCHEDULED_EVENTS: 65536,
  AUTO_MODERATION_CONFIGURATION: 1048576,
  AUTO_MODERATION_EXECUTION: 2097152,
  GUILD_MESSAGE_POLLS: 16777216,
  DIRECT_MESSAGE_POLLS: 33554432
};

function activeIntentMask(botData, entry) {
  let mask = 0;
  if (botData && Array.isArray(botData.intents) && botData.intents.length) {
    botData.intents.forEach(function (n) {
      const bit = INTENT_BITS[String(n || "").toUpperCase()];
      if (bit !== undefined) mask |= bit;
    });
  }
  if (!mask) mask = 513 | 32768;
  if (entry && entry.noContentIntent) mask &= ~32768;
  return mask;
}

function intentsOk(required, mask) {
  if (!Array.isArray(required) || required.length === 0) return true;
  return required.every(function (n) {
    const bit = INTENT_BITS[String(n || "").toUpperCase()];
    return bit !== undefined && (mask & bit) === bit;
  });
}

function readBotData(userId, botId) {
  const filePath = path.join(USERS_DIR, String(userId).replace(/[^a-zA-Z0-9_-]/g, ""), String(botId).replace(/[^a-zA-Z0-9_-]/g, ""), "bot.json");
  try {
    if (!fs.existsSync(filePath)) {
      if (fs.existsSync(filePath + ".bak")) {
        try {
          const bak = fs.readFileSync(filePath + ".bak", "utf8");
          if (bak && bak.trim()) return JSON.parse(bak);
        } catch (e) {}
      }
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) {
      if (fs.existsSync(filePath + ".bak")) {
        try {
          const bak = fs.readFileSync(filePath + ".bak", "utf8");
          if (bak && bak.trim()) return JSON.parse(bak);
        } catch (e) {}
      }
      return null;
    }
    return JSON.parse(raw);
  } catch (e) {
    try {
      if (fs.existsSync(filePath + ".bak")) {
        const bak = fs.readFileSync(filePath + ".bak", "utf8");
        if (bak && bak.trim()) return JSON.parse(bak);
      }
    } catch (err) {}
    return null;
  }
}

function resolvePluginMain(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  for (let i = 0; i < PLUGIN_DIRS.length; i++) {
    try {
      return require.resolve(path.join(PLUGIN_DIRS[i], id, "main", "index.js"));
    } catch (e) {}
  }
  return null;
}

function loadBotCommands(botData) {
  const out = [];
  const seen = {};
  const state = (botData && botData.plugins && typeof botData.plugins === "object") ? botData.plugins : {};
  const mask = activeIntentMask(botData);
  Object.keys(state).forEach(function (id) {
    const entry = state[id];
    if (!entry || entry.enabled === false) return;
    const mainPath = resolvePluginMain(id);
    if (!mainPath) return;
    let mod = null;
    try {
      delete require.cache[mainPath];
      mod = require(mainPath);
    } catch (e) {
      return;
    }
    const list = Array.isArray(mod && mod.commands) ? mod.commands : [];
    list.forEach(function (c) {
      const name = String((c && c.name) || "").toLowerCase().trim();
      if (!/^[a-z0-9_-]{1,32}$/.test(name) || seen[name]) return;
      if (c.slash === false) return;
      if (!intentsOk(c.intents, mask)) return;
      seen[name] = 1;
      const category = (c && typeof c.category === "string" && c.category.trim()) ? c.category.trim() : "General";
      const uPerms = Array.isArray(c && c.userPermissions) ? c.userPermissions : (Array.isArray(c && c.permissions) ? c.permissions : []);
      const bPerms = Array.isArray(c && c.botPermissions) ? c.botPermissions : [];

      out.push({
        pluginId: id,
        name: name,
        category: category,
        description: (String((c && c.description) || "").trim() || name).slice(0, 100),
        options: Array.isArray(c && c.options) ? c.options : [],
        cooldown: typeof c.cooldown === "number" ? c.cooldown : null,
        userPermissions: uPerms,
        botPermissions: bPerms,
        onCommand: typeof c.execute === "function" ? c.execute : (typeof c.onCommand === "function" ? c.onCommand : (typeof mod.onCommand === "function" ? mod.onCommand : null))
      });

      const userAliases = (entry.config && entry.config.aliases && Array.isArray(entry.config.aliases[name])) ? entry.config.aliases[name] : [];
      userAliases.forEach(function (alias) {
        const aName = String(alias || "").toLowerCase().trim();
        if (!/^[a-z0-9_-]{1,32}$/.test(aName) || seen[aName]) return;
        seen[aName] = 1;
        out.push({
          pluginId: id,
          name: aName,
          category: category,
          description: ("Alias for /" + name + ": " + (String((c && c.description) || "").trim() || name)).slice(0, 100),
          options: Array.isArray(c && c.options) ? c.options : [],
          cooldown: typeof c.cooldown === "number" ? c.cooldown : null,
          userPermissions: uPerms,
          botPermissions: bPerms,
          onCommand: typeof c.execute === "function" ? c.execute : (typeof c.onCommand === "function" ? c.onCommand : (typeof mod.onCommand === "function" ? mod.onCommand : null))
        });
      });
    });
  });
  return out;
}

function mapCommandOptions(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (o) {
    if (!o || typeof o !== "object") return null;
    const name = String(o.name || "").toLowerCase().trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) return null;
    const type = parseInt(o.type, 10);
    if (!(type >= 1 && type <= 11)) return null;
    const item = {
      type: type,
      name: name,
      description: (String(o.description || "").trim() || name).slice(0, 100)
    };
    if (o.required === true) item.required = true;
    if (Array.isArray(o.channel_types)) item.channel_types = o.channel_types;
    if (o.min_value !== undefined) item.min_value = o.min_value;
    if (o.max_value !== undefined) item.max_value = o.max_value;
    if (o.min_length !== undefined) item.min_length = o.min_length;
    if (o.max_length !== undefined) item.max_length = o.max_length;
    if (o.autocomplete !== undefined) item.autocomplete = !!o.autocomplete;
    if (Array.isArray(o.choices) && o.choices.length) {
      item.choices = o.choices.slice(0, 25).map(function (ch) {
        return { name: String(ch && ch.name || "").slice(0, 100), value: ch && ch.value };
      }).filter(function (ch) { return ch.name; });
    }
    if (Array.isArray(o.options) && o.options.length) {
      const nested = mapCommandOptions(o.options);
      if (nested.length) item.options = nested;
    }
    return item;
  }).filter(Boolean);
}

function buildCommandPayload(botData) {
  return loadBotCommands(botData).map(function (c) {
    const opts = mapCommandOptions(c.options);
    const payload = { type: 1, name: c.name, description: c.description };
    if (opts.length) payload.options = opts;
    return payload;
  });
}

function loadPluginModules(botData) {
  const out = [];
  const state = (botData && botData.plugins && typeof botData.plugins === "object") ? botData.plugins : {};
  Object.keys(state).forEach(function (id) {
    const entry = state[id];
    if (!entry || entry.enabled === false) return;
    const mainPath = resolvePluginMain(id);
    if (!mainPath) return;
    let mod = null;
    try {
      delete require.cache[mainPath];
      mod = require(mainPath);
    } catch (e) { return; }
    out.push({ pluginId: id, mod: mod });
  });
  return out;
}

let globalRateLimitReset = 0;
const commandPayloadCache = new Map();

function discordRequest(token, method, apiPath, body, retriesLeft) {
  const maxRetries = typeof retriesLeft === "number" ? retriesLeft : 1;
  const remainingWait = globalRateLimitReset - Date.now();
  if (remainingWait > 0) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(discordRequest(token, method, apiPath, body, maxRetries));
      }, Math.min(remainingWait + 100, 30000));
    });
  }

  return new Promise(function (resolve) {
    const data = body !== undefined && body !== null ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "discord.com",
      path: "/api/v10" + apiPath,
      method: method,
      headers: {
        Authorization: "Bot " + token,
        "Content-Type": "application/json",
        "Content-Length": data ? Buffer.byteLength(data) : 0
      }
    }, function (res) {
      let buf = "";
      res.on("data", function (c) { buf += c; });
      res.on("end", function () {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) {}

        if (res.statusCode === 429) {
          const retryAfterSec = (json && typeof json.retry_after === "number")
            ? json.retry_after
            : (parseFloat(res.headers["retry-after"]) || 5);
          const waitMs = Math.min(Math.max(Math.ceil(retryAfterSec * 1000), 1000), 60000);
          globalRateLimitReset = Math.max(globalRateLimitReset, Date.now() + waitMs);
          console.warn("[RATE_LIMIT] Discord 429 hit on " + method + " " + apiPath + ". Pausing requests for " + (waitMs / 1000) + "s.");

          if (maxRetries > 0) {
            setTimeout(function () {
              resolve(discordRequest(token, method, apiPath, body, maxRetries - 1));
            }, waitMs + 200);
            return;
          }
        }

        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", function () { resolve({ status: 0, body: null }); });
    if (data) req.write(data);
    req.end();
  });
}

function registerGlobalCommands(botId, token, botData) {
  const payload = buildCommandPayload(botData);
  const jsonStr = JSON.stringify(payload);
  const hash = crypto.createHash("md5").update(jsonStr).digest("hex");
  if (commandPayloadCache.get(botId) === hash) {
    return Promise.resolve({ status: 200, body: payload, cached: true });
  }
  return discordRequest(token, "PUT", "/applications/" + botId + "/commands", payload).then(function (res) {
    if (res && res.status >= 200 && res.status < 300) {
      commandPayloadCache.set(botId, hash);
    }
    return res;
  });
}

function registerGuildCommands(botId, token, guildId, botData) {
  return discordRequest(token, "PUT", "/applications/" + botId + "/guilds/" + guildId + "/commands", []);
}

function refreshBotCommands(botId) {
  const entry = runningBots.get(botId);
  if (!entry || !entry.token || entry.status === "offline") return;
  const botData = readBotData(entry.userId, botId);
  if (!botData) return;
  commandPayloadCache.delete(botId);
  registerGlobalCommands(botId, entry.token, botData);
  Object.keys(entry.guilds || {}).forEach(function (guildId) {
    registerGuildCommands(botId, entry.token, guildId, botData);
  });
}

const DISCORD_PERMISSIONS = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n
};

function getPluginStorageDir(userId, botId) {
  const dir = path.join(USERS_DIR, String(userId).replace(/[^a-zA-Z0-9_-]/g, ""), String(botId).replace(/[^a-zA-Z0-9_-]/g, ""), "storage");
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

function createPluginStorage(userId, botId, pluginId) {
  const safePlugin = String(pluginId || "default").replace(/[^a-zA-Z0-9_-]/g, "");
  const file = path.join(getPluginStorageDir(userId, botId), safePlugin + ".json");
  let cache = null;

  function load() {
    if (cache !== null) return cache;
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, "utf8");
        if (raw && raw.trim()) {
          cache = JSON.parse(raw) || {};
        } else if (fs.existsSync(file + ".bak")) {
          cache = JSON.parse(fs.readFileSync(file + ".bak", "utf8")) || {};
        } else {
          cache = {};
        }
      } else if (fs.existsSync(file + ".bak")) {
        cache = JSON.parse(fs.readFileSync(file + ".bak", "utf8")) || {};
      } else {
        cache = {};
      }
    } catch (e) {
      try {
        if (fs.existsSync(file + ".bak")) {
          cache = JSON.parse(fs.readFileSync(file + ".bak", "utf8")) || {};
        } else {
          cache = {};
        }
      } catch (err) {
        cache = {};
      }
    }
    return cache;
  }

  function save() {
    try {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, { recursive: true });
      const str = JSON.stringify(cache || {}, null, 2);
      const tmp = file + ".tmp." + process.pid + "." + Date.now();
      fs.writeFileSync(tmp, str, "utf8");
      if (fs.existsSync(file)) {
        try { fs.copyFileSync(file, file + ".bak"); } catch (err) {}
      }
      fs.renameSync(tmp, file);
    } catch (e) {
      try {
        fs.writeFileSync(file, JSON.stringify(cache || {}, null, 2), "utf8");
      } catch (err) {}
    }
  }

  return {
    get: function (key, def) {
      const data = load();
      return (key in data) ? data[key] : (def !== undefined ? def : null);
    },
    set: function (key, val) {
      const data = load();
      data[key] = val;
      save();
      return val;
    },
    delete: function (key) {
      const data = load();
      const existed = key in data;
      delete data[key];
      if (existed) save();
      return existed;
    },
    has: function (key) {
      const data = load();
      return Object.prototype.hasOwnProperty.call(data, key);
    },
    all: function () {
      return Object.assign({}, load());
    },
    clear: function () {
      cache = {};
      save();
    }
  };
}

function parseInteractionOptions(rawOptions, resolved) {
  let subcommand = null;
  let subcommandGroup = null;
  const options = {};

  function traverse(list) {
    if (!Array.isArray(list)) return;
    list.forEach(function (o) {
      if (!o || !o.name) return;
      if (o.type === 1) {
        subcommand = o.name;
        traverse(o.options);
      } else if (o.type === 2) {
        subcommandGroup = o.name;
        traverse(o.options);
      } else if (o.type === 6) {
        const u = (resolved && resolved.users && resolved.users[o.value]) || null;
        options[o.name] = u || { id: String(o.value) };
      } else if (o.type === 7) {
        const c = (resolved && resolved.channels && resolved.channels[o.value]) || null;
        options[o.name] = c || { id: String(o.value) };
      } else if (o.type === 8) {
        const r = (resolved && resolved.roles && resolved.roles[o.value]) || null;
        options[o.name] = r || { id: String(o.value) };
      } else if (o.type === 11) {
        const a = (resolved && resolved.attachments && resolved.attachments[o.value]) || null;
        options[o.name] = a || { id: String(o.value) };
      } else {
        options[o.name] = o.value;
      }
    });
  }

  traverse(rawOptions);
  return { options: options, subcommand: subcommand, subcommandGroup: subcommandGroup };
}

function parseModalFields(components) {
  const fields = {};
  if (!Array.isArray(components)) return fields;
  components.forEach(function (row) {
    if (row && Array.isArray(row.components)) {
      row.components.forEach(function (input) {
        if (input && input.custom_id) {
          fields[input.custom_id] = input.value !== undefined ? input.value : "";
        }
      });
    }
  });
  return fields;
}

function parseHexToDecimal(input, fallback) {
  if (typeof input === "number" && !isNaN(input) && input >= 0) return input;
  if (typeof input === "string") {
    const clean = input.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(clean)) return parseInt(clean, 16);
  }
  return fallback;
}

function getBotThemeColors(botData) {
  const tc = (botData && botData.themeColors && typeof botData.themeColors === "object") ? botData.themeColors : {};
  const v1Fallback = (botData && (botData.embedColor || botData.color)) || 0x5865f2;
  return {
    v1: parseHexToDecimal(tc.main_v1, parseHexToDecimal(v1Fallback, 0x5865f2)),
    v2: parseHexToDecimal(tc.main_v2, parseHexToDecimal(v1Fallback, 0x5865f2)),
    warning: parseHexToDecimal(tc.warning, 0xfaa61a),
    error: parseHexToDecimal(tc.error, 0xed4245),
    cooldown: parseHexToDecimal(tc.cooldown, 0xeb459e)
  };
}

function getBotMasterColor(botData) {
  const tc = getBotThemeColors(botData);
  return tc.v1;
}

function sanitizeEmbedColors(embeds, masterColor) {
  if (!Array.isArray(embeds)) return embeds;
  const col = (typeof masterColor === "number" && masterColor >= 0) ? masterColor : 0x5865f2;
  return embeds.map(function (emb) {
    if (!emb || typeof emb !== "object") return emb;
    const copy = Object.assign({}, emb);
    copy.color = col;
    return copy;
  });
}

function callbackBody(payload, masterColor) {
  if (payload && payload.type === 9) {
    return {
      type: 9,
      data: {
        title: String(payload.title || "Form").slice(0, 45),
        custom_id: String(payload.customId || payload.custom_id || "modal"),
        components: Array.isArray(payload.components) ? payload.components : []
      }
    };
  }
  const data = {};
  if (payload && payload.content !== undefined && payload.content !== null) {
    data.content = String(payload.content).slice(0, 4000);
  }
  if (payload && Array.isArray(payload.embeds)) {
    data.embeds = sanitizeEmbedColors(payload.embeds.slice(0, 10), masterColor);
  }
  if (payload && Array.isArray(payload.components)) {
    data.components = payload.components;
  }
  if (payload && payload.flags !== undefined) data.flags = payload.flags;
  if (payload && payload.ephemeral) data.flags = (data.flags !== undefined ? data.flags : 0) | 64;
  if (payload && payload.allowed_mentions) data.allowed_mentions = payload.allowed_mentions;

  let type = 4;
  if (payload && typeof payload.type === "number") type = payload.type;
  if (type !== 7 && !data.content && !data.embeds && !data.components) {
    data.content = "";
  }
  return { type: type, data: data };
}

function sendInteractionResponse(token, inter, payload) {
  discordRequest(token, "POST", "/interactions/" + inter.id + "/" + inter.token + "/callback", payload);
}

const commandCooldowns = new Map();

function pruneCooldowns() {
  const now = Date.now();
  if (commandCooldowns.size > 1000) {
    for (const [key, exp] of commandCooldowns.entries()) {
      if (now >= exp) commandCooldowns.delete(key);
    }
    if (commandCooldowns.size > 2000) {
      let count = 0;
      for (const key of commandCooldowns.keys()) {
        commandCooldowns.delete(key);
        count++;
        if (count > 500) break;
      }
    }
  }
}

const guildRoleCache = {};

function pruneGuildRoleCache() {
  const now = Date.now();
  const keys = Object.keys(guildRoleCache);
  if (keys.length > 200) {
    keys.forEach(function (k) {
      if (!guildRoleCache[k] || (now - guildRoleCache[k].at) > 120000) {
        delete guildRoleCache[k];
      }
    });
  }
}

function getGuildRoles(token, gid) {
  const now = Date.now();
  const cached = guildRoleCache[gid];
  if (cached && (now - cached.at) < 30000) {
    return Promise.resolve(cached.data);
  }
  return discordRequest(token, "GET", "/guilds/" + gid + "/roles").then(function (res) {
    if (res && res.status === 200 && Array.isArray(res.body)) {
      pruneGuildRoleCache();
      guildRoleCache[gid] = { at: now, data: res.body };
      return res.body;
    }
    return (cached && cached.data) ? cached.data : [];
  });
}

function createBaseContext(entry, token, inter, pluginId, extra) {
  const meta = extra || {};
  const guildId = (inter && inter.guild_id) || meta.guildId || null;
  const channelId = (inter && inter.channel_id) || meta.channelId || null;
  const member = (inter && inter.member) || meta.member || null;
  const user = (inter && (inter.user || (inter.member && inter.member.user))) || meta.user || {};
  const guildName = (entry && entry.guildNames && guildId && entry.guildNames[guildId]) ||
    (inter && inter.guild && inter.guild.name) ||
    (meta && meta.guildName) ||
    "Server";
  const guildOwnerId = (entry && entry.guildOwners && guildId && entry.guildOwners[guildId]) ||
    (inter && inter.guild && inter.guild.owner_id) ||
    (meta && meta.guildOwnerId) ||
    null;
  const isServerOwner = Boolean(guildOwnerId && user && user.id && String(guildOwnerId) === String(user.id));

  return {
    user: user,
    member: member,
    guildId: guildId,
    guildName: guildName,
    guildOwnerId: guildOwnerId,
    isServerOwner: isServerOwner,
    channelId: channelId,
    botId: entry.botId,
    userId: entry.userId,
    get ping() {
      return (entry && typeof entry.ping === "number") ? entry.ping : null;
    },
    get botPing() {
      return (entry && typeof entry.ping === "number") ? entry.ping : null;
    },
    get wsPing() {
      return (entry && typeof entry.ping === "number") ? entry.ping : null;
    },
    getBotPing: function () {
      return (entry && typeof entry.ping === "number") ? entry.ping : null;
    },
    get uptime() {
      return (entry && entry.status === "online" && entry.uptimeStart)
        ? Math.max(0, Math.floor((Date.now() - entry.uptimeStart) / 1000))
        : 0;
    },
    get botUptime() {
      return (entry && entry.status === "online" && entry.uptimeStart)
        ? Math.max(0, Math.floor((Date.now() - entry.uptimeStart) / 1000))
        : 0;
    },
    get uptimeStart() {
      return (entry && entry.uptimeStart) || null;
    },
    getBotUptime: function () {
      return (entry && entry.status === "online" && entry.uptimeStart)
        ? Math.max(0, Math.floor((Date.now() - entry.uptimeStart) / 1000))
        : 0;
    },
    pluginId: pluginId,
    interaction: inter,
    customId: meta.customId || null,
    componentType: meta.componentType || null,
    values: meta.values || [],
    fields: meta.fields || {},
    options: meta.options || {},
    subcommand: meta.subcommand || null,
    subcommandGroup: meta.subcommandGroup || null,
    command: meta.command || null,
    message: meta.message || null,
    storage: createPluginStorage(entry.userId, entry.botId, pluginId),
    createStorage: function (pid) {
      return createPluginStorage(entry.userId, entry.botId, pid || pluginId);
    },
    cooldown: function (seconds) {
      const sec = Number(seconds) || 0;
      if (sec <= 0) return true;
      const now = Date.now();
      const uid = (user && user.id) || "anon";
      const cmdName = (this && this.command) || meta.command || "default";
      const pid = (this && this.pluginId) || pluginId || "cmd";
      const key = entry.botId + ":" + pid + ":" + cmdName + ":" + uid;
      const expiresAt = commandCooldowns.get(key) || 0;
      if (now < expiresAt) {
        const remaining = Math.ceil((expiresAt - now) / 1000);
        this.replyCooldown(remaining);
        return false;
      }
      pruneCooldowns();
      commandCooldowns.set(key, now + (sec * 1000));
      return true;
    },
    get colors() {
      const bData = readBotData(entry.userId, entry.botId);
      return getBotThemeColors(bData);
    },
    get color() {
      return this.colors.v1;
    },
    get embedColor() {
      return this.colors.v1;
    },
    get hexColor() {
      const c = this.color;
      return "#" + c.toString(16).padStart(6, "0");
    },
    replyEmbed: function (embedData, opts) {
      const col = this.color;
      const emb = Object.assign({ color: col }, embedData || {});
      emb.color = col;
      const payload = Object.assign({}, opts || {}, { embeds: [emb] });
      if (typeof this.reply === "function") return this.reply(payload);
      return this.sendChannel(channelId, payload);
    },
    sendEmbed: function (targetChannelId, embedData, opts) {
      const col = this.color;
      const emb = Object.assign({ color: col }, embedData || {});
      emb.color = col;
      const payload = Object.assign({}, opts || {}, { embeds: [emb] });
      return this.sendChannel(targetChannelId, payload);
    },
    replyError: function (message, opts) {
      const options = Object.assign({}, opts);
      if (!options.messageId && !options.message_reference && meta && meta.messageId) {
        options.messageId = meta.messageId;
      }
      if (typeof options.accent !== "number") {
        options.accent = this.colors.error;
      }
      const payload = emojiUtil.buildComponentV2("error", message, options);
      if (typeof this.reply === "function") return this.reply(payload);
      return this.sendChannel(channelId, payload);
    },
    replyWarn: function (message, opts) {
      const options = Object.assign({}, opts);
      if (!options.messageId && !options.message_reference && meta && meta.messageId) {
        options.messageId = meta.messageId;
      }
      if (typeof options.accent !== "number") {
        options.accent = this.colors.warning;
      }
      const payload = emojiUtil.buildComponentV2("warn", message, options);
      if (typeof this.reply === "function") return this.reply(payload);
      return this.sendChannel(channelId, payload);
    },
    replyCooldown: function (message, opts) {
      const options = Object.assign({}, opts);
      if (!options.messageId && !options.message_reference && meta && meta.messageId) {
        options.messageId = meta.messageId;
      }
      if (typeof options.accent !== "number") {
        options.accent = this.colors.cooldown;
      }
      const payload = emojiUtil.buildComponentV2("cooldown", message, options);
      if (typeof this.reply === "function") return this.reply(payload);
      return this.sendChannel(channelId, payload);
    },
    replySuccess: function (message, opts) {
      const options = Object.assign({}, opts);
      if (!options.messageId && !options.message_reference && meta && meta.messageId) {
        options.messageId = meta.messageId;
      }
      if (typeof options.accent !== "number") {
        options.accent = this.colors.v2;
      }
      const payload = emojiUtil.buildComponentV2("success", message, options);
      if (typeof this.reply === "function") return this.reply(payload);
      return this.sendChannel(channelId, payload);
    },
    sendChannel: function (targetChannelId, payload) {
      const cid = targetChannelId || channelId;
      if (!cid) return Promise.resolve(null);
      let body = payload;
      if (typeof payload === "string") {
        body = { content: String(payload).slice(0, 2000) };
      } else if (body && typeof body === "object") {
        const bData = readBotData(entry.userId, entry.botId);
        const mColor = getBotMasterColor(bData);
        body = {
          content: body.content !== undefined ? String(body.content).slice(0, 2000) : undefined,
          embeds: Array.isArray(body.embeds) ? sanitizeEmbedColors(body.embeds.slice(0, 10), mColor) : undefined,
          components: Array.isArray(body.components) ? body.components : undefined,
          allowed_mentions: body.allowed_mentions !== undefined ? body.allowed_mentions : (body.message_reference ? { replied_user: false } : undefined),
          flags: body.flags !== undefined ? body.flags : undefined,
          message_reference: body.message_reference || undefined
        };
      }
      const p = discordRequest(token, "POST", "/channels/" + cid + "/messages", body);
      const deleteAfter = payload && Number(payload.deleteAfter);
      if (deleteAfter > 0) {
        p.then(function (res) {
          if (res && res.status >= 200 && res.status < 300 && res.body && res.body.id) {
            setTimeout(function () {
              discordRequest(token, "DELETE", "/channels/" + cid + "/messages/" + res.body.id);
            }, deleteAfter);
          }
        });
      }
      return p;
    },
    createChannel: function (gid, options) {
      const targetGid = gid || guildId;
      if (!targetGid) return Promise.resolve(null);
      return discordRequest(token, "POST", "/guilds/" + targetGid + "/channels", options || {});
    },
    deleteChannel: function (cid) {
      const targetCid = cid || channelId;
      if (!targetCid) return Promise.resolve(null);
      return discordRequest(token, "DELETE", "/channels/" + targetCid);
    },
    editChannel: function (cid, options) {
      const targetCid = cid || channelId;
      if (!targetCid) return Promise.resolve(null);
      return discordRequest(token, "PATCH", "/channels/" + targetCid, options || {});
    },
    fetchChannel: function (cid) {
      const targetCid = cid || channelId;
      if (!targetCid) return Promise.resolve(null);
      return discordRequest(token, "GET", "/channels/" + targetCid);
    },
    setChannelPermissions: function (cid, targetId, allow, deny, type) {
      const targetCid = cid || channelId;
      if (!targetCid || !targetId) return Promise.resolve(null);
      return discordRequest(token, "PUT", "/channels/" + targetCid + "/permissions/" + targetId, {
        allow: String(allow || "0"),
        deny: String(deny || "0"),
        type: type !== undefined ? type : 0
      });
    },
    fetchMember: function (gid, uid) {
      const targetGid = gid || guildId;
      if (!targetGid || !uid) return Promise.resolve(null);
      return discordRequest(token, "GET", "/guilds/" + targetGid + "/members/" + uid);
    },
    addRole: function (gid, uid, roleId) {
      const targetGid = gid || guildId;
      if (!targetGid || !uid || !roleId) return Promise.resolve(null);
      return discordRequest(token, "PUT", "/guilds/" + targetGid + "/members/" + uid + "/roles/" + roleId);
    },
    removeRole: function (gid, uid, roleId) {
      const targetGid = gid || guildId;
      if (!targetGid || !uid || !roleId) return Promise.resolve(null);
      return discordRequest(token, "DELETE", "/guilds/" + targetGid + "/members/" + uid + "/roles/" + roleId);
    },
    timeoutMember: function (gid, uid, durationMs) {
      const targetGid = gid || guildId;
      if (!targetGid || !uid) return Promise.resolve(null);
      const until = (typeof durationMs === "number" && durationMs > 0) ? new Date(Date.now() + durationMs).toISOString() : null;
      return discordRequest(token, "PATCH", "/guilds/" + targetGid + "/members/" + uid, {
        communication_disabled_until: until
      });
    },
    kickMember: function (gid, uid) {
      const targetGid = gid || guildId;
      if (!targetGid || !uid) return Promise.resolve(null);
      return discordRequest(token, "DELETE", "/guilds/" + targetGid + "/members/" + uid);
    },
    banMember: function (gid, uid, options) {
      const targetGid = gid || guildId;
      if (!targetGid || !uid) return Promise.resolve(null);
      return discordRequest(token, "PUT", "/guilds/" + targetGid + "/bans/" + uid, options || {});
    },
    unbanMember: function (gid, uid) {
      const targetGid = gid || guildId;
      if (!targetGid || !uid) return Promise.resolve(null);
      return discordRequest(token, "DELETE", "/guilds/" + targetGid + "/bans/" + uid);
    },
    fetchRoles: function (gid) {
      const targetGid = gid || guildId;
      if (!targetGid) return Promise.resolve(null);
      return getGuildRoles(token, targetGid);
    },
    fetchBan: function (gid, uid) {
      const targetGid = gid || guildId;
      if (!targetGid || !uid) return Promise.resolve(null);
      return discordRequest(token, "GET", "/guilds/" + targetGid + "/bans/" + uid);
    },
    fetchMessage: function (cid, mid) {
      const targetCid = cid || channelId;
      if (!targetCid || !mid) return Promise.resolve(null);
      return discordRequest(token, "GET", "/channels/" + targetCid + "/messages/" + mid);
    },
    editMessage: function (cid, mid, payload) {
      const targetCid = cid || channelId;
      if (!targetCid || !mid) return Promise.resolve(null);
      return discordRequest(token, "PATCH", "/channels/" + targetCid + "/messages/" + mid, payload || {});
    },
    deleteMessage: function (cid, mid) {
      const targetCid = cid || channelId;
      if (!targetCid || !mid) return Promise.resolve(null);
      return discordRequest(token, "DELETE", "/channels/" + targetCid + "/messages/" + mid);
    },
    sendDM: function (uid, payload) {
      if (!uid) return Promise.resolve(null);
      return discordRequest(token, "POST", "/users/@me/channels", { recipient_id: String(uid) }).then(function (dmRes) {
        const dmChannelId = dmRes && dmRes.body && dmRes.body.id;
        if (!dmChannelId) return dmRes;
        let body = payload;
        if (typeof payload === "string") body = { content: String(payload).slice(0, 2000) };
        return discordRequest(token, "POST", "/channels/" + dmChannelId + "/messages", body);
      });
    },
    hasPermission: function (perm) {
      if (isServerOwner) return true;
      if (!member || !member.permissions) return false;
      try {
        const userPerms = BigInt(member.permissions);
        if ((userPerms & 8n) === 8n) return true;
        let bit = 0n;
        if (typeof perm === "bigint" || typeof perm === "number") {
          bit = BigInt(perm);
        } else if (typeof perm === "string") {
          const key = perm.toUpperCase().replace(/\s+/g, "_");
          if (DISCORD_PERMISSIONS[key] !== undefined) bit = DISCORD_PERMISSIONS[key];
          else bit = BigInt(perm);
        }
        return (userPerms & bit) === bit;
      } catch (e) {
        return false;
      }
    },
    discordRequest: function (method, apiPath, body) {
      return discordRequest(token, method, apiPath, body);
    }
  };
}

const guildPermCache = {};

function pruneGuildPermCache() {
  const now = Date.now();
  const keys = Object.keys(guildPermCache);
  if (keys.length > 200) {
    keys.forEach(function (k) {
      if (!guildPermCache[k] || (now - guildPermCache[k].at) > 120000) {
        delete guildPermCache[k];
      }
    });
  }
}

function computeMessageMemberPermissions(token, data) {
  const gid = data.guild_id;
  const cached = guildPermCache[gid];
  const fresh = cached && (Date.now() - cached.at) < 60000;
  const info = fresh ? Promise.resolve(cached) : Promise.all([
    discordRequest(token, "GET", "/guilds/" + gid),
    discordRequest(token, "GET", "/guilds/" + gid + "/roles")
  ]).then(function (r) {
    const g = r[0], roles = r[1];
    if (!g || g.status !== 200 || !roles || roles.status !== 200 || !Array.isArray(roles.body)) return null;
    const map = {};
    roles.body.forEach(function (role) { map[role.id] = String(role.permissions || "0"); });
    pruneGuildPermCache();
    guildPermCache[gid] = { at: Date.now(), owner: g.body && g.body.owner_id, roles: map };
    return guildPermCache[gid];
  });
  return info.then(function (c) {
    if (!c) return null;
    const uid = data.author && data.author.id;
    if (uid && c.owner === uid) return "8";
    let perms = BigInt(c.roles[gid] || "0");
    (data.member.roles || []).forEach(function (rid) {
      if (c.roles[rid]) perms |= BigInt(c.roles[rid]);
    });
    if ((perms & 8n) === 8n) return "8";
    return perms.toString();
  });
}

function emitPluginEvent(entry, token, name, data) {
  if (!name || name === "READY" || name === "RESUMED") return;
  if (name === "MESSAGE_CREATE" && data && data.guild_id && data.member && data.member.permissions === undefined && data.content && !(data.author && data.author.bot)) {
    const rawMsg = String(data.content || "").trim();
    if (!rawMsg) {
      emitPluginEventNow(entry, token, name, data);
      return;
    }
    computeMessageMemberPermissions(token, data).then(function (p) {
      if (p !== null) data.member.permissions = p;
    }).catch(function () {}).then(function () {
      emitPluginEventNow(entry, token, name, data);
    });
    return;
  }
  emitPluginEventNow(entry, token, name, data);
}

function emitPluginEventNow(entry, token, name, data) {
  const botData = readBotData(entry.userId, entry.botId);
  if (!botData) return;
  loadPluginModules(botData).forEach(function (item) {
    const mod = item.mod;
    if (!mod || !mod.events) return;
    const handler = typeof mod.events[name] === "function" ? mod.events[name] : (typeof mod.events["*"] === "function" ? mod.events["*"] : null);
    if (!handler) return;
    const state = (botData.plugins && botData.plugins[item.pluginId]) || {};
    const ctx = createBaseContext(entry, token, null, item.pluginId, {
      guildId: data && data.guild_id,
      channelId: data && data.channel_id,
      user: data && (data.user || data.author),
      member: data && data.member,
      messageId: data && data.id
    });
    ctx.event = name;
    ctx.data = data || {};
    ctx.config = (state.config && typeof state.config === "object") ? state.config : {};
    ctx.reply = function (payload) {
      const channelId = data && data.channel_id;
      if (!channelId) return Promise.resolve(null);
      let p = payload;
      if (typeof p === "string") p = { content: p };
      else if (p && typeof p === "object") p = Object.assign({}, p);
      if (p && !p.message_reference && data && data.id) {
        p.message_reference = { message_id: data.id, fail_if_not_exists: false };
      }
      return ctx.sendChannel(channelId, p);
    };
    try {
      const r = handler(ctx);
      if (r && typeof r.catch === "function") r.catch(function () {});
    } catch (e) {}
  });
}

function handleInteraction(entry, token, inter) {
  if (!inter || !inter.type) return;
  const botData = readBotData(entry.userId, entry.botId);
  if (!botData) return;
  const masterColor = getBotMasterColor(botData);

  const plugins = loadPluginModules(botData);
  let responded = false;
  let isDeferred = false;
  let timeoutTimer = null;

  function makeContext(pluginId, extra) {
    const base = createBaseContext(entry, token, inter, pluginId, extra);
    const pluginState = (botData.plugins && botData.plugins[pluginId]) || {};
    const savedConfig = (pluginState.config && typeof pluginState.config === "object") ? pluginState.config : {};
    base.config = Object.assign({}, savedConfig);

    const mainPath = resolvePluginMain(pluginId);
    if (mainPath) {
      try {
        const mod = require(mainPath);
        if (mod && Array.isArray(mod.config)) {
          mod.config.forEach(function (f) {
            if (f && f.key && base.config[f.key] === undefined && f.default !== undefined) {
              base.config[f.key] = f.default;
            }
          });
        }
      } catch (e) {}
    }

    base.reply = function (payload) {
      if (isDeferred) {
        return base.editReply(payload);
      }
      if (responded) return false;
      responded = true;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      sendInteractionResponse(token, inter, callbackBody(payload || {}, masterColor));
      const deleteAfter = payload && Number(payload.deleteAfter);
      if (deleteAfter > 0 && !payload.ephemeral) {
        const appId = inter.application_id || entry.botId;
        setTimeout(function () {
          discordRequest(token, "DELETE", "/webhooks/" + appId + "/" + inter.token + "/messages/@original");
        }, deleteAfter);
      }
      return true;
    };

    base.editReply = function (payload) {
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      const appId = inter.application_id || entry.botId;
      const data = {};
      if (payload && payload.content !== undefined && payload.content !== null) {
        data.content = String(payload.content).slice(0, 4000);
      }
      if (payload && Array.isArray(payload.embeds)) {
        data.embeds = sanitizeEmbedColors(payload.embeds.slice(0, 10), masterColor);
      }
      if (payload && Array.isArray(payload.components)) {
        data.components = payload.components;
      }
      if (payload && payload.allowed_mentions) data.allowed_mentions = payload.allowed_mentions;
      if (payload && payload.flags !== undefined) data.flags = payload.flags;
      if (payload && payload.ephemeral) data.flags = (data.flags !== undefined ? data.flags : 0) | 64;
      if (!data.content && !data.embeds && !data.components) data.content = "";
      const deleteAfter = payload && Number(payload.deleteAfter);
      if (deleteAfter > 0 && !payload.ephemeral) {
        setTimeout(function () {
          discordRequest(token, "DELETE", "/webhooks/" + appId + "/" + inter.token + "/messages/@original");
        }, deleteAfter);
      }
      return discordRequest(token, "PATCH", "/webhooks/" + appId + "/" + inter.token + "/messages/@original", data);
    };

    base.followUp = function (payload) {
      const appId = inter.application_id || entry.botId;
      const data = {};
      if (payload && payload.content !== undefined && payload.content !== null) {
        data.content = String(payload.content).slice(0, 4000);
      }
      if (payload && Array.isArray(payload.embeds)) {
        data.embeds = sanitizeEmbedColors(payload.embeds.slice(0, 10), masterColor);
      }
      if (payload && Array.isArray(payload.components)) {
        data.components = payload.components;
      }
      if (payload && payload.ephemeral) data.flags = 64;
      if (payload && payload.allowed_mentions) data.allowed_mentions = payload.allowed_mentions;
      if (payload && payload.flags !== undefined) data.flags = payload.flags;
      if (payload && payload.ephemeral) data.flags = (data.flags !== undefined ? data.flags : 0) | 64;
      return discordRequest(token, "POST", "/webhooks/" + appId + "/" + inter.token, data);
    };

    base.update = function (payload) {
      if (responded) return false;
      responded = true;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      const body = Object.assign({}, payload || {}, { type: 7 });
      sendInteractionResponse(token, inter, callbackBody(body, masterColor));
      return true;
    };

    base.defer = function (ephemeral) {
      if (responded) return false;
      responded = true;
      isDeferred = true;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      sendInteractionResponse(token, inter, { type: 5, data: { flags: ephemeral ? 64 : 0 } });
      return true;
    };

    base.deferUpdate = function () {
      if (responded) return false;
      responded = true;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      sendInteractionResponse(token, inter, { type: 6 });
      return true;
    };

    base.showModal = function (modalPayload) {
      if (responded) return false;
      responded = true;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      sendInteractionResponse(token, inter, callbackBody(Object.assign({}, modalPayload || {}, { type: 9 }), masterColor));
      return true;
    };

    base.respondAutocomplete = function (choices) {
      if (responded) return false;
      responded = true;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      sendInteractionResponse(token, inter, {
        type: 8,
        data: { choices: Array.isArray(choices) ? choices.slice(0, 25) : [] }
      });
      return true;
    };

    base.deleteReply = function () {
      const appId = inter.application_id || entry.botId;
      return discordRequest(token, "DELETE", "/webhooks/" + appId + "/" + inter.token + "/messages/@original");
    };

    base.deleteReplyAfter = function (ms) {
      const appId = inter.application_id || entry.botId;
      setTimeout(function () {
        discordRequest(token, "DELETE", "/webhooks/" + appId + "/" + inter.token + "/messages/@original");
      }, Math.max(0, Number(ms) || 0));
    };

    return base;
  }

  function safeRun(handler, ctx) {
    const errAccent = (ctx && ctx.colors && typeof ctx.colors.error === "number") ? ctx.colors.error : masterColor;
    try {
      const result = handler(ctx);
      if (result && typeof result.catch === "function") {
        result.catch(function (err) {
          const errMsg = (err && err.message) || "This interaction failed to run.";
          const payload = emojiUtil.buildComponentV2("error", errMsg, { ephemeral: true, accent: errAccent });
          if (isDeferred) {
            ctx.editReply(payload);
          } else if (!responded) {
            responded = true;
            if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
            sendInteractionResponse(token, inter, callbackBody(payload, masterColor));
          }
        });
      }
      return result;
    } catch (e) {
      const errMsg = (e && e.message) || "This interaction failed to run.";
      const payload = emojiUtil.buildComponentV2("error", errMsg, { ephemeral: true, accent: errAccent });
      if (isDeferred) {
        ctx.editReply(payload);
      } else if (!responded) {
        responded = true;
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
        sendInteractionResponse(token, inter, callbackBody(payload, masterColor));
      }
      return false;
    }
  }

  if (inter.type === 2) {
    const name = inter.data && inter.data.name ? String(inter.data.name).toLowerCase().trim() : "";
    if (!name) return;
    const commands = loadBotCommands(botData);
    let hit = null;
    commands.forEach(function (c) { if (c.name === name) hit = c; });
    if (!hit || !hit.onCommand) {
      sendInteractionResponse(token, inter, callbackBody(emojiUtil.buildComponentV2("warn", "This command is unavailable.", { ephemeral: true }), masterColor));
      return;
    }
    const parsed = parseInteractionOptions(inter.data.options, (inter.data && inter.data.resolved) || {});
    const ctx = makeContext(hit.pluginId, {
      command: hit.name,
      options: parsed.options,
      subcommand: parsed.subcommand,
      subcommandGroup: parsed.subcommandGroup
    });

    if (Array.isArray(hit.userPermissions) && hit.userPermissions.length) {
      const missing = [];
      hit.userPermissions.forEach(function (p) {
        if (!ctx.hasPermission(p)) missing.push(p);
      });
      if (missing.length) {
        return ctx.replyWarn("You need permission " + missing.map(function (m) { return "`" + m + "`"; }).join(", ") + " to use this command.", { ephemeral: true });
      }
    }

    if (typeof hit.cooldown === "number" && hit.cooldown > 0) {
      if (!ctx.cooldown(hit.cooldown)) return;
    }
    safeRun(hit.onCommand, ctx);
  } else if (inter.type === 3) {
    const customId = inter.data && inter.data.custom_id ? String(inter.data.custom_id) : "";
    const compType = inter.data && inter.data.component_type;
    const values = (inter.data && Array.isArray(inter.data.values)) ? inter.data.values : [];
    const resolved = (inter.data && inter.data.resolved) || {};
    const message = inter.message || null;

    let handled = false;
    for (let i = 0; i < plugins.length; i++) {
      const item = plugins[i];
      const mod = item.mod;
      if (!mod) continue;
      let handler = null;

      if (mod.components) {
        if (typeof mod.components[customId] === "function") {
          handler = mod.components[customId];
        } else {
          const keys = Object.keys(mod.components);
          for (let k = 0; k < keys.length; k++) {
            const pat = keys[k];
            if (pat.endsWith("*") && customId.startsWith(pat.slice(0, -1))) {
              handler = mod.components[pat];
              break;
            }
          }
        }
      }

      if (!handler && compType === 2 && mod.buttons) {
        if (typeof mod.buttons[customId] === "function") {
          handler = mod.buttons[customId];
        } else {
          const bKeys = Object.keys(mod.buttons);
          for (let k = 0; k < bKeys.length; k++) {
            const pat = bKeys[k];
            if (pat.endsWith("*") && customId.startsWith(pat.slice(0, -1))) {
              handler = mod.buttons[pat];
              break;
            }
          }
        }
      }

      if (!handler && compType >= 3 && mod.selects) {
        if (typeof mod.selects[customId] === "function") {
          handler = mod.selects[customId];
        } else {
          const sKeys = Object.keys(mod.selects);
          for (let k = 0; k < sKeys.length; k++) {
            const pat = sKeys[k];
            if (pat.endsWith("*") && customId.startsWith(pat.slice(0, -1))) {
              handler = mod.selects[pat];
              break;
            }
          }
        }
      }

      if (!handler) {
        if (compType === 2 && !mod.buttons && typeof mod.onButton === "function") handler = mod.onButton;
        else if (compType >= 3 && !mod.selects && typeof mod.onSelect === "function") handler = mod.onSelect;
        else if (typeof mod.onComponent === "function") handler = mod.onComponent;
        else if (mod.components && typeof mod.components["*"] === "function") handler = mod.components["*"];
      }

      if (handler) {
        const ctx = makeContext(item.pluginId, {
          customId: customId,
          componentType: compType,
          values: values,
          resolved: resolved,
          message: message
        });
        const runRes = safeRun(handler, ctx);
        if (runRes !== false) {
          handled = true;
          break;
        }
      }
    }
    if (!handled && !responded) {
      sendInteractionResponse(token, inter, callbackBody(emojiUtil.buildComponentV2("warn", "This component is not recognized.", { ephemeral: true }), masterColor));
    }
  } else if (inter.type === 5) {
    const customId = inter.data && inter.data.custom_id ? String(inter.data.custom_id) : "";
    const fields = parseModalFields(inter.data && inter.data.components);

    let handled = false;
    for (let i = 0; i < plugins.length; i++) {
      const item = plugins[i];
      const mod = item.mod;
      if (!mod) continue;
      let handler = null;
      if (mod.modals) {
        if (typeof mod.modals[customId] === "function") {
          handler = mod.modals[customId];
        } else {
          const mKeys = Object.keys(mod.modals);
          for (let k = 0; k < mKeys.length; k++) {
            const pat = mKeys[k];
            if (pat.endsWith("*") && customId.startsWith(pat.slice(0, -1))) {
              handler = mod.modals[pat];
              break;
            }
          }
        }
      }
      if (!handler && typeof mod.onModal === "function") handler = mod.onModal;
      if (!handler && mod.modals && typeof mod.modals["*"] === "function") handler = mod.modals["*"];

      if (handler) {
        handled = true;
        const ctx = makeContext(item.pluginId, {
          customId: customId,
          fields: fields
        });
        safeRun(handler, ctx);
        break;
      }
    }
    if (!handled && !responded) {
      sendInteractionResponse(token, inter, callbackBody(emojiUtil.buildComponentV2("warn", "This form submission could not be processed.", { ephemeral: true }), masterColor));
    }
  } else if (inter.type === 4) {
    const optionsRaw = (inter.data && inter.data.options) || [];
    let focused = null;
    optionsRaw.forEach(function (o) { if (o && o.focused) focused = o; });
    const cmdName = inter.data && inter.data.name ? String(inter.data.name).toLowerCase().trim() : "";

    for (let i = 0; i < plugins.length; i++) {
      const item = plugins[i];
      const mod = item.mod;
      if (!mod) continue;
      let handler = null;
      if (mod.autocompletes && typeof mod.autocompletes[cmdName] === "function") {
        handler = mod.autocompletes[cmdName];
      } else if (typeof mod.onAutocomplete === "function") {
        handler = mod.onAutocomplete;
      }
      if (handler) {
        const ctx = makeContext(item.pluginId, {
          command: cmdName,
          focused: focused
        });
        safeRun(handler, ctx);
        break;
      }
    }
    if (!responded) {
      sendInteractionResponse(token, inter, { type: 8, data: { choices: [] } });
    }
  }

  timeoutTimer = setTimeout(function () {
    if (!responded) {
      if (inter.type === 2) {
        responded = true;
        isDeferred = true;
        sendInteractionResponse(token, inter, { type: 5, data: { flags: 0 } });
      } else if (inter.type === 4) {
        responded = true;
        sendInteractionResponse(token, inter, { type: 8, data: { choices: [] } });
      } else {
        responded = true;
        sendInteractionResponse(token, inter, callbackBody(emojiUtil.buildComponentV2("warn", "This interaction timed out.", { ephemeral: true }), masterColor));
      }
    }
  }, 2500);
}

const STATUS_TYPE_CODES = { playing: 0, streaming: 1, listening: 2, watching: 3, competing: 4 };

function normalizeStatuses(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (s) {
    if (typeof s === "string") {
      const text = s.trim();
      if (text) out.push({ type: "playing", text: text });
      return;
    }
    if (s && typeof s === "object") {
      const text = String(s.text || s.name || "").trim();
      if (!text) return;
      let type = String(s.type || "playing").toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(STATUS_TYPE_CODES, type)) type = "playing";
      out.push({ type: type, text: text });
    }
  });
  return out;
}

function statusCodeOf(status) {
  if (status && typeof status === "object") {
    const code = STATUS_TYPE_CODES[status.type];
    if (typeof code === "number") return code;
  }
  return 0;
}

function statusNameOf(status) {
  if (typeof status === "string") return status.trim() || "Hosted on Arixa";
  if (status && typeof status === "object") return String(status.text || "").trim() || "Hosted on Arixa";
  return "Hosted on Arixa";
}

function normalizePresence(status) {
  const t = String(status || "").toLowerCase().trim();
  return (t === "idle" || t === "dnd") ? t : "online";
}

function updateGuildStats(entry) {
  const guilds = entry.guilds || {};
  let guildCount = 0;
  let memberCount = 0;
  Object.keys(guilds).forEach(function (id) {
    guildCount++;
    memberCount += guilds[id] || 0;
  });
  entry.guildCount = guildCount;
  entry.memberCount = memberCount;
}

function getBotEntry(botId) {
  if (!runningBots.has(botId)) {
    runningBots.set(botId, {
      botId: botId,
      status: "offline",
      uptimeStart: null,
      ping: null,
      ws: null,
      heartbeatTimer: null,
      lastHeartbeatSend: 0,
      manualStop: false,
      seq: null,
      sessionId: null,
      resumeGatewayUrl: null,
      errorMsg: null,
      userId: null,
      token: null,
      restartTimer: null,
      rotationTimer: null,
      customStatuses: [],
      statusInterval: 10,
      statusIndex: 0,
      currentActivity: null,
      presenceStatus: "online",
      guilds: {},
      guildNames: {},
      guildOwners: {},
      guildCount: 0,
      memberCount: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
      preserveError: false
    });
  }
  return runningBots.get(botId);
}

function cleanHeartbeat(entry) {
  if (entry.heartbeatInitTimer) {
    clearTimeout(entry.heartbeatInitTimer);
    entry.heartbeatInitTimer = null;
  }
  if (entry.heartbeatTimer) {
    clearInterval(entry.heartbeatTimer);
    entry.heartbeatTimer = null;
  }
}

function cleanRotation(entry) {
  if (entry.rotationTimer) {
    clearInterval(entry.rotationTimer);
    entry.rotationTimer = null;
  }
}

function cleanReconnect(entry) {
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
}

function buildActivity(status) {
  const code = statusCodeOf(status);
  const text = statusNameOf(status);
  const act = { name: text, type: code };
  if (code === 1) {
    act.url = (status && status.url) || "https://twitch.tv/discord";
  }
  return act;
}

function setBotPresence(entry, status) {
  if (!entry.ws || entry.ws.readyState !== 1) return;
  const statusText = statusNameOf(status);
  entry.currentActivity = statusText;
  try {
    entry.ws.send(JSON.stringify({
      op: 3,
      d: {
        since: null,
        activities: [buildActivity(status)],
        status: entry.presenceStatus || "online",
        afk: false
      }
    }));
  } catch (e) {}
}

function startStatusRotation(entry, statuses, intervalSec) {
  cleanRotation(entry);

  let list = normalizeStatuses(statuses);

  if (list.length === 0) {
    list = [{ type: "playing", text: "Hosted on Arixa" }];
  }

  entry.customStatuses = list;
  entry.statusInterval = Math.max(3, parseInt(intervalSec, 10) || 10);
  entry.statusIndex = 0;
  entry.currentActivity = list[0].text;

  if (entry.status === "online" && entry.ws && entry.ws.readyState === 1) {
    setBotPresence(entry, list[0]);
  }

  if (list.length > 1) {
    entry.rotationTimer = setInterval(function () {
      if (!entry.ws || entry.ws.readyState !== 1 || entry.status !== "online") return;
      entry.statusIndex = (entry.statusIndex + 1) % entry.customStatuses.length;
      const next = entry.customStatuses[entry.statusIndex];
      entry.currentActivity = next.text;
      setBotPresence(entry, next);
    }, entry.statusInterval * 1000);
  }
}

function updateBotStatuses(botId, statuses, intervalSec) {
  const entry = getBotEntry(botId);
  startStatusRotation(entry, statuses, intervalSec);
}

function updateBotPresenceStatus(botId, status) {
  const entry = getBotEntry(botId);
  entry.presenceStatus = normalizePresence(status);
  if (entry.status === "online" && entry.ws && entry.ws.readyState === 1) {
    const list = entry.customStatuses || [];
    const current = list.length ? list[entry.statusIndex || 0] : null;
    setBotPresence(entry, current);
  }
  return entry.presenceStatus;
}

function sendHeartbeat(entry) {
  if (!entry.ws || entry.ws.readyState !== 1) return;
  if (!entry.heartbeatAcked) {
    try {
      entry.ws.close(4000, "Heartbeat ACK timeout");
    } catch (e) {}
    return;
  }
  entry.heartbeatAcked = false;
  entry.lastHeartbeatSend = Date.now();
  try {
    entry.ws.send(JSON.stringify({ op: 1, d: entry.seq }));
  } catch (e) {}
}

function startBot(userId, botId, token, botData) {
  const entry = getBotEntry(botId);
  entry.userId = userId;
  entry.token = token;
  entry.manualStop = false;
  entry.heartbeatAcked = true;
  if (botData) {
    const normalized = normalizeStatuses(botData.customStatuses);
    if (normalized.length > 0) {
      entry.customStatuses = normalized;
    }
    if (botData.statusInterval) {
      entry.statusInterval = Math.max(3, parseInt(botData.statusInterval, 10) || 10);
    }
    if (botData.presenceStatus) {
      entry.presenceStatus = normalizePresence(botData.presenceStatus);
    }
  }

  cleanReconnect(entry);
  if (entry.status === "online" && entry.ws && entry.ws.readyState === 1) {
    return Promise.resolve({ ok: true, status: "online", ping: entry.ping });
  }

  if (entry.restartTimer) {
    clearTimeout(entry.restartTimer);
    entry.restartTimer = null;
  }

  entry.status = "connecting";
  if (!entry.preserveError) {
    entry.errorMsg = null;
  }
  entry.preserveError = false;

  cleanHeartbeat(entry);
  cleanRotation(entry);
  if (entry.ws) {
    try {
      entry.ws.onclose = null;
      entry.ws.onerror = null;
      entry.ws.onmessage = null;
      entry.ws.close();
    } catch (e) {}
    entry.ws = null;
  }

  return new Promise(function (resolve) {
    let resolved = false;
    function safeResolve(res) {
      if (!resolved) {
        resolved = true;
        resolve(res);
      }
    }

    const baseGateway = (entry.resumeGatewayUrl || "wss://gateway.discord.gg").replace(/\/+$/, "");
    const gatewayUrl = baseGateway + "/?v=10&encoding=json";

    let ws;
    try {
      ws = new WebSocket(gatewayUrl);
    } catch (err) {
      entry.status = "offline";
      entry.errorMsg = err.message;
      return safeResolve({ ok: false, error: err.message });
    }

    entry.ws = ws;
    entry.connectStart = Date.now();

    const timeout = setTimeout(function () {
      if (entry.status === "connecting") {
        safeResolve({ ok: true, status: "connecting", message: "Connecting to Discord Gateway..." });
      }
    }, 4000);

    ws.onopen = function () {
      if (entry.connectStart && (entry.ping === null || entry.ping === undefined)) {
        entry.ping = Math.max(1, Date.now() - entry.connectStart);
      }
    };

    ws.onmessage = function (event) {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (typeof msg.s === "number") {
        entry.seq = msg.s;
      }

      if (msg.op === 10) {
        if (entry.connectStart && (entry.ping === null || entry.ping === undefined)) {
          entry.ping = Math.max(1, Date.now() - entry.connectStart);
        }
        const interval = msg.d && msg.d.heartbeat_interval ? msg.d.heartbeat_interval : 41250;
        cleanHeartbeat(entry);
        entry.heartbeatAcked = true;

        entry.heartbeatInitTimer = setTimeout(function () {
          entry.heartbeatInitTimer = null;
          sendHeartbeat(entry);
          entry.heartbeatTimer = setInterval(function () {
            sendHeartbeat(entry);
          }, interval);
        }, Math.floor(Math.random() * interval * 0.5));

        if (entry.sessionId && entry.seq !== null) {
          try {
            ws.send(JSON.stringify({
              op: 6,
              d: {
                token: token,
                session_id: entry.sessionId,
                seq: entry.seq
              }
            }));
            return;
          } catch (e) {}
        }

        const identifyStatus = (entry.customStatuses && entry.customStatuses[0]) || { type: "playing", text: "Hosted on Arixa" };
        const identifyPayload = {
          op: 2,
          d: {
            token: token,
            intents: activeIntentMask(botData, entry),
            properties: {
              os: "linux",
              browser: "Arixa",
              device: "Arixa"
            },
            presence: {
              status: entry.presenceStatus || "online",
              afk: false,
              activities: [buildActivity(identifyStatus)]
            }
          }
        };

        try {
          ws.send(JSON.stringify(identifyPayload));
        } catch (e) {
          entry.status = "offline";
          entry.errorMsg = e.message;
          safeResolve({ ok: false, error: e.message });
        }
      }

      if (msg.op === 11) {
        entry.heartbeatAcked = true;
        if (entry.lastHeartbeatSend > 0) {
          entry.ping = Math.max(1, Date.now() - entry.lastHeartbeatSend);
        }
      }

      if (msg.op === 1) {
        sendHeartbeat(entry);
      }

      if (msg.op === 7) {
        if (!entry.manualStop && entry.status !== "restarting") {
          cleanHeartbeat(entry);
          cleanRotation(entry);
          try {
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
          } catch (e) {}
          setTimeout(function () {
            startBot(userId, botId, token, readBotData(userId, botId) || botData);
          }, 1500);
        }
      }

      if (msg.op === 9) {
        if (!entry.manualStop && entry.status !== "restarting") {
          if (!msg.d) {
            entry.sessionId = null;
            entry.seq = null;
            entry.resumeGatewayUrl = null;
          }
          cleanHeartbeat(entry);
          cleanRotation(entry);
          try {
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
          } catch (e) {}
          setTimeout(function () {
            startBot(userId, botId, token, readBotData(userId, botId) || botData);
          }, 1500);
        }
      }

      if (msg.op === 0) {
        if (msg.t === "READY") {
          clearTimeout(timeout);
          entry.reconnectAttempts = 0;
          entry.status = "online";
          entry.uptimeStart = Date.now();
          entry.sessionId = msg.d.session_id || null;
          entry.resumeGatewayUrl = msg.d.resume_gateway_url || null;
          entry.guilds = {};
          entry.guildNames = {};
          entry.guildOwners = {};
          updateGuildStats(entry);
          startStatusRotation(entry, entry.customStatuses, entry.statusInterval);
          safeResolve({ ok: true, status: "online", ping: entry.ping });
          const readyBotData = readBotData(userId, botId) || botData;
          registerGlobalCommands(botId, token, readyBotData);
          if (msg.d && Array.isArray(msg.d.guilds)) {
            msg.d.guilds.forEach(function (g) {
              if (g && g.id) registerGuildCommands(botId, token, g.id, readyBotData);
            });
          }
        }

        if (msg.t === "RESUMED") {
          clearTimeout(timeout);
          entry.reconnectAttempts = 0;
          entry.status = "online";
          if (!entry.uptimeStart) entry.uptimeStart = Date.now();
          safeResolve({ ok: true, status: "online", ping: entry.ping });
        }

        if (msg.t === "GUILD_CREATE" && msg.d && msg.d.id) {
          const members = parseInt(msg.d.member_count || msg.d.approximate_member_count, 10) || 0;
          if (!entry.guilds) entry.guilds = {};
          if (!entry.guildNames) entry.guildNames = {};
          if (!entry.guildOwners) entry.guildOwners = {};
          entry.guilds[msg.d.id] = members;
          if (msg.d.name) entry.guildNames[msg.d.id] = String(msg.d.name);
          if (msg.d.owner_id) entry.guildOwners[msg.d.id] = String(msg.d.owner_id);
          updateGuildStats(entry);
        }

        if (msg.t === "GUILD_DELETE" && msg.d && msg.d.id && !msg.d.unavailable) {
          if (entry.guilds) delete entry.guilds[msg.d.id];
          if (entry.guildNames) delete entry.guildNames[msg.d.id];
          if (entry.guildOwners) delete entry.guildOwners[msg.d.id];
          updateGuildStats(entry);
        }

        if (msg.t === "INTERACTION_CREATE" && msg.d) {
          handleInteraction(entry, token, msg.d);
        } else if (msg.t && msg.t !== "READY" && msg.t !== "RESUMED") {
          emitPluginEvent(entry, token, msg.t, msg.d);
        }
      }
    };

    ws.onerror = function (err) {
      if (entry.manualStop) return;
      entry.errorMsg = (err && err.message) || "WebSocket error";
      if (entry.status !== "restarting") {
        entry.status = "offline";
      }
      safeResolve({ ok: false, error: entry.errorMsg });
    };

    ws.onclose = function (event) {
      cleanHeartbeat(entry);
      cleanRotation(entry);
      if (entry.manualStop) {
        entry.status = "offline";
        entry.uptimeStart = null;
        entry.errorMsg = null;
        entry.sessionId = null;
        entry.seq = null;
        entry.resumeGatewayUrl = null;
      } else if (entry.status === "restarting") {
      } else {
        const nonRecoverable = [4004, 4010, 4011, 4012, 4013];
        if (event.code === 4004) {
          entry.status = "offline";
          entry.errorMsg = "Invalid Bot Token (Discord 4004)";
        } else if (nonRecoverable.indexOf(event.code) > -1) {
          entry.status = "offline";
          entry.errorMsg = "Discord error (" + event.code + ") - check bot settings";
        } else if (event.code === 4014 && !entry.noContentIntent) {
          entry.noContentIntent = true;
          entry.preserveError = true;
          entry.status = "restarting";
          entry.errorMsg = "MESSAGE CONTENT INTENT is disabled in the Discord Developer Portal - prefix commands will not work until it is enabled.";
          setTimeout(function () {
            startBot(userId, botId, token, readBotData(userId, botId) || botData);
          }, 1000);
        } else {
          entry.errorMsg = "Connection dropped (" + event.code + "), reconnecting...";
          entry.status = "connecting";
          entry.reconnectAttempts = (entry.reconnectAttempts || 0) + 1;
          const delay = Math.min(30000, Math.max(2000, entry.reconnectAttempts * 2000));
          cleanReconnect(entry);
          entry.reconnectTimer = setTimeout(function () {
            entry.reconnectTimer = null;
            if (!entry.manualStop && entry.status !== "offline") {
              startBot(userId, botId, token, readBotData(userId, botId) || botData);
            }
          }, delay);
        }
      }
      if (entry.status === "offline") {
        entry.guilds = {};
        entry.guildNames = {};
        entry.guildOwners = {};
        updateGuildStats(entry);
      }
      safeResolve({ ok: false, error: entry.errorMsg, status: entry.status });
    };
  });
}

function stopBot(userId, botId) {
  const entry = getBotEntry(botId);
  entry.manualStop = true;
  entry.status = "offline";
  entry.uptimeStart = null;
  entry.errorMsg = null;
  entry.noContentIntent = false;
  entry.reconnectAttempts = 0;
  entry.heartbeatAcked = true;
  entry.sessionId = null;
  entry.seq = null;
  entry.resumeGatewayUrl = null;

  cleanReconnect(entry);
  if (entry.restartTimer) {
    clearTimeout(entry.restartTimer);
    entry.restartTimer = null;
  }

  cleanHeartbeat(entry);
  cleanRotation(entry);
  entry.guilds = {};
  entry.guildNames = {};
  entry.guildOwners = {};
  updateGuildStats(entry);

  if (entry.ws) {
    try {
      entry.ws.onerror = null;
      entry.ws.onclose = null;
      if (entry.ws.readyState === 1) {
        entry.ws.send(JSON.stringify({
          op: 3,
          d: {
            since: null,
            activities: [],
            status: "invisible",
            afk: false
          }
        }));
      }
      entry.ws.close(1000, "Stopped by user");
    } catch (e) {}
    entry.ws = null;
  }

  return { ok: true, status: "offline" };
}

function restartBot(userId, botId, token, botData) {
  const entry = getBotEntry(botId);
  entry.manualStop = false;
  entry.status = "restarting";
  entry.uptimeStart = null;
  entry.reconnectAttempts = 0;
  entry.heartbeatAcked = true;

  cleanReconnect(entry);
  cleanHeartbeat(entry);
  cleanRotation(entry);

  if (entry.ws) {
    try {
      entry.ws.onerror = null;
      entry.ws.onclose = null;
      entry.ws.close(1000, "Restarting");
    } catch (e) {}
    entry.ws = null;
  }

  if (entry.restartTimer) {
    clearTimeout(entry.restartTimer);
  }

  return new Promise(function (resolve) {
    entry.restartTimer = setTimeout(function () {
      entry.restartTimer = null;
      startBot(userId, botId, token, botData).then(resolve);
    }, 1500);
  });
}

function getBotStatus(botId) {
  const entry = runningBots.get(botId);
  if (!entry) {
    return {
      status: "offline",
      uptime: 0,
      ping: null,
      error: null,
      presenceStatus: "online",
      guildCount: 0,
      memberCount: 0,
      currentActivity: null
    };
  }

  const uptime = (entry.status === "online" && entry.uptimeStart)
    ? Math.floor((Date.now() - entry.uptimeStart) / 1000)
    : 0;

  return {
    status: entry.status,
    uptime: uptime,
    ping: entry.ping || null,
    error: entry.errorMsg || null,
    presenceStatus: entry.presenceStatus || "online",
    guildCount: entry.status === "online" ? (entry.guildCount || 0) : 0,
    memberCount: entry.status === "online" ? (entry.memberCount || 0) : 0,
    currentActivity: entry.currentActivity || statusNameOf(entry.customStatuses && entry.customStatuses[0]) || null
  };
}

module.exports = {
  startBot,
  stopBot,
  restartBot,
  getBotStatus,
  updateBotStatuses,
  updateBotPresenceStatus,
  refreshBotCommands,
  emitPluginEvent,
  createBaseContext,
  commandCooldowns
};
