const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "..", "data");
const USERS_DIR = path.join(DATA_DIR, "users");
const BUILTIN_PLUGINS_DIR = path.join(__dirname, "..", "..");
const USER_PLUGINS_DIR = path.join(DATA_DIR, "plugins");

function parseHexColor(input, fallback) {
  if (!input) return fallback;
  const cleaned = String(input).replace("#", "").trim();
  const num = parseInt(cleaned, 16);
  return isNaN(num) ? fallback : num;
}

function resolveAccentColor(ctx) {
  if (ctx && ctx.colors && typeof ctx.colors.v2 === "number") {
    return ctx.colors.v2;
  }
  return 0x5865f2;
}

function hasAdminPerms(ctx) {
  if (ctx.isServerOwner === true) return true;
  const uid = ctx.user && ctx.user.id;
  if (uid && ctx.guildOwnerId && String(ctx.guildOwnerId) === String(uid)) return true;

  if (typeof ctx.hasPermission === "function") {
    return ctx.hasPermission("MANAGE_GUILD") || ctx.hasPermission("ADMINISTRATOR");
  }
  if (!ctx.member || !ctx.member.permissions) return false;
  try {
    const p = BigInt(ctx.member.permissions);
    return (p & 8n) === 8n || (p & 32n) === 32n;
  } catch (e) {
    return false;
  }
}

const botUserMap = {};

function isValidEmoji(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (!s) return false;
  if (/^<a?:[a-zA-Z0-9_]+:\d{17,20}>$/.test(s)) return true;
  if (/^[a-zA-Z0-9\s.,!?:;'"_+=/\\-]+$/.test(s)) return false;
  try {
    const emojiRegex = /^\p{Extended_Pictographic}+$/u;
    if (emojiRegex.test(s.replace(/[\uFE0E\uFE0F\u200D]/g, ""))) return true;
  } catch (e) {}
  return /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/.test(s);
}

function resolveEmoji(input, fallback) {
  return isValidEmoji(input) ? input.trim() : fallback;
}

function findBotData(botId, userId) {
  if (!botId) return null;
  const safeBotId = String(botId).replace(/[^a-zA-Z0-9_-]/g, "");
  const safeUserId = String(userId || botUserMap[safeBotId] || "").replace(/[^a-zA-Z0-9_-]/g, "");
  try {
    if (safeUserId) {
      const p = path.join(USERS_DIR, safeUserId, safeBotId, "bot.json");
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, "utf8"));
        if (d && typeof d === "object") delete d.token;
        botUserMap[safeBotId] = safeUserId;
        return d;
      }
    }
    const userDirs = fs.readdirSync(USERS_DIR);
    for (let i = 0; i < userDirs.length; i++) {
      const p = path.join(USERS_DIR, userDirs[i], safeBotId, "bot.json");
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, "utf8"));
        if (d && typeof d === "object") delete d.token;
        botUserMap[safeBotId] = userDirs[i];
        return d;
      }
    }
  } catch (e) {}
  return null;
}

function resolvePluginStorage(ctx, pid) {
  if (ctx && typeof ctx.createStorage === "function") {
    return ctx.createStorage(pid);
  }
  return ctx && ctx.storage ? ctx.storage : null;
}

function getServerPrefix(ctx, guildId) {
  if (!guildId) return null;
  let p = ctx.storage ? ctx.storage.get("prefix_" + guildId, null) : null;
  if (!p) {
    const v1Store = resolvePluginStorage(ctx, "00003-prefix-v1");
    if (v1Store && typeof v1Store.get === "function") {
      p = v1Store.get("prefix_" + guildId, null);
    }
  }
  return p ? String(p).trim() : null;
}

function setServerPrefix(ctx, guildId, newPrefix) {
  if (!guildId) return;
  const val = String(newPrefix || "").trim();
  if (ctx.storage && typeof ctx.storage.set === "function") {
    ctx.storage.set("prefix_" + guildId, val);
  }
  try {
    const v1Store = resolvePluginStorage(ctx, "00003-prefix-v1");
    if (v1Store && typeof v1Store.set === "function") {
      v1Store.set("prefix_" + guildId, val);
    }
  } catch (e) {}
}

function deleteServerPrefix(ctx, guildId) {
  if (!guildId || !ctx.storage) return;
  if (typeof ctx.storage.delete === "function") {
    ctx.storage.delete("prefix_" + guildId);
  } else if (typeof ctx.storage.set === "function") {
    ctx.storage.set("prefix_" + guildId, null);
  }
  try {
    const v1Store = resolvePluginStorage(ctx, "00003-prefix-v1");
    if (v1Store && typeof v1Store.delete === "function") {
      v1Store.delete("prefix_" + guildId);
    } else if (v1Store && typeof v1Store.set === "function") {
      v1Store.set("prefix_" + guildId, null);
    }
  } catch (e) {}
}

function buildV2Container(content, accentColor, messageId) {
  const payload = {
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [
          {
            type: 10,
            content: String(content || "").trim()
          }
        ]
      }
    ]
  };
  if (messageId) {
    payload.message_reference = { message_id: messageId, fail_if_not_exists: false };
  }
  return payload;
}

function handleInfo(ctx) {
  const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
  const guildId = ctx.guildId;

  if (!guildId) {
    return ctx.replyWarn("This command can only be used inside a server.");
  }

  const serverName = ctx.guildName || "Server";
  const gprefix = (cfg.main_prefix || "!").trim() || "!";
  const serverPrefix = getServerPrefix(ctx, guildId);
  const cprefix = serverPrefix || "none";
  const accentColor = resolveAccentColor(ctx);
  const msgId = ctx.data && ctx.data.id;
  const emoji = resolveEmoji(cfg.emoji_info, "🔹");

  const markdown = [
    "### " + serverName + " Prefix",
    "",
    "> " + emoji + " **Global Prefix:** `" + gprefix + "`",
    "> " + emoji + " **Custom Prefix:** `" + cprefix + "`"
  ].join("\n");

  const payload = buildV2Container(markdown, accentColor, msgId);
  if (typeof ctx.reply === "function") return ctx.reply(payload);
  return ctx.sendChannel(ctx.channelId, payload);
}

function handleSet(ctx, newPrefix) {
  const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
  const guildId = ctx.guildId;

  if (!guildId) {
    return ctx.replyWarn("This command can only be used inside a server.");
  }

  if (!hasAdminPerms(ctx)) {
    return ctx.replyWarn("You need Manage Server permission to use this command.");
  }

  const p = String(newPrefix || "").trim();
  if (!p || p.length < 1 || p.length > 5 || /\s/.test(p)) {
    return ctx.replyWarn("The prefix must be 1 to 5 characters and cannot contain spaces.");
  }

  setServerPrefix(ctx, guildId, p);

  const emoji = resolveEmoji(cfg.emoji_set, "✅");
  const formatted = "> " + emoji + " **Successfully set server prefix to `" + p + "`**";
  const accentColor = resolveAccentColor(ctx);
  const msgId = ctx.data && ctx.data.id;

  const payload = buildV2Container(formatted, accentColor, msgId);
  if (typeof ctx.reply === "function") return ctx.reply(payload);
  return ctx.sendChannel(ctx.channelId, payload);
}

function handleReset(ctx) {
  const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
  const guildId = ctx.guildId;

  if (!guildId) {
    return ctx.replyWarn("This command can only be used inside a server.");
  }

  if (!hasAdminPerms(ctx)) {
    return ctx.replyWarn("You need Manage Server permission to use this command.");
  }

  deleteServerPrefix(ctx, guildId);

  const gprefix = (cfg.main_prefix || "!").trim() || "!";
  const emoji = resolveEmoji(cfg.emoji_reset, "✅");
  const formatted = "> " + emoji + " **Successfully reset server prefix to `" + gprefix + "`**";
  const accentColor = resolveAccentColor(ctx);
  const msgId = ctx.data && ctx.data.id;

  const payload = buildV2Container(formatted, accentColor, msgId);
  if (typeof ctx.reply === "function") return ctx.reply(payload);
  return ctx.sendChannel(ctx.channelId, payload);
}

const pluginModuleCache = {};

function resolvePluginModule(pluginId) {
  const safeId = String(pluginId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (pluginModuleCache[safeId]) return pluginModuleCache[safeId];
  const dirs = [BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR];
  for (let i = 0; i < dirs.length; i++) {
    const mainFile = path.join(dirs[i], safeId, "main", "index.js");
    if (fs.existsSync(mainFile)) {
      try {
        const mod = require(mainFile);
        if (mod) {
          pluginModuleCache[safeId] = mod;
          return mod;
        }
      } catch (e) {}
    }
  }
  return null;
}

function parsePositionalOptions(schemaList, rawArgs, rawText) {
  const out = {};
  if (!Array.isArray(schemaList) || schemaList.length === 0) return out;
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const text = String(rawText || "").trim();

  const channelOpt = schemaList.find(function (o) { return o && o.type === 7; });
  if (channelOpt) {
    const chMatch = text.match(/<#(\d+)>/);
    if (chMatch) out[channelOpt.name] = { id: chMatch[1] };
  }

  const userOpt = schemaList.find(function (o) { return o && o.type === 6; });
  if (userOpt) {
    const uMatch = text.match(/<@!?(\d+)>/);
    if (uMatch) out[userOpt.name] = { id: uMatch[1] };
  }

  schemaList.forEach(function (opt, idx) {
    if (!opt || !opt.name || out[opt.name] !== undefined) return;
    const name = opt.name;
    const type = parseInt(opt.type, 10);
    const val = args[idx];
    if (val === undefined) return;

    if (type === 3) {
      const remainingOpts = schemaList.slice(idx + 1);
      const hasFurtherStringOpt = remainingOpts.some(function (o) { return o && o.type === 3; });
      if (!hasFurtherStringOpt || idx === schemaList.length - 1) {
        let remainingWords = args.slice(idx);
        if (channelOpt && out[channelOpt.name]) {
          remainingWords = remainingWords.filter(function (w) { return !/<#\d+>/.test(w); });
        }
        if (userOpt && out[userOpt.name]) {
          remainingWords = remainingWords.filter(function (w) { return !/<@!?\d+>/.test(w); });
        }
        out[name] = remainingWords.join(" ").trim();
      } else {
        out[name] = val;
      }
    } else if (type === 4 || type === 10) {
      const n = Number(val);
      if (!isNaN(n)) out[name] = n;
    } else if (type === 5) {
      out[name] = val.toLowerCase() === "true" || val === "1";
    } else if (type === 6) {
      const match = val.match(/<@!?(\d+)>/);
      if (match) out[name] = { id: match[1] };
      else if (/^\d{17,20}$/.test(val)) out[name] = { id: val };
      else out[name] = { query: val };
    } else if (type === 7) {
      const match = val.match(/<#(\d+)>/);
      const cid = match ? match[1] : (/^\d{17,20}$/.test(val) ? val : "");
      if (cid) out[name] = { id: cid };
    } else if (type === 8) {
      const match = val.match(/<@&(\d+)>/);
      const rid = match ? match[1] : (/^\d{17,20}$/.test(val) ? val : "");
      if (rid) out[name] = { id: rid };
      else out[name] = val;
    } else if (type === 9) {
      const uMatch = val.match(/<@!?(\d+)>/);
      const rMatch = val.match(/<@&(\d+)>/);
      const mid = (uMatch && uMatch[1]) || (rMatch && rMatch[1]) || (/^\d{17,20}$/.test(val) ? val : "");
      if (mid) out[name] = { id: mid };
      else out[name] = val;
    } else {
      out[name] = val;
    }
  });
  return out;
}

function executeExternalPluginCommand(ctx, cmdName, rawArgs, rawText) {
  const botData = findBotData(ctx.botId, ctx.userId);
  if (!botData || !botData.plugins || typeof botData.plugins !== "object") return false;

  const pluginIds = Object.keys(botData.plugins);
  for (let i = 0; i < pluginIds.length; i++) {
    const pid = pluginIds[i];
    if (pid === "00005-prefix-v2" || pid === "00003-prefix-v1") continue;
    const state = botData.plugins[pid];
    if (!state || state.enabled === false) continue;

    const mod = resolvePluginModule(pid);
    if (!mod || !Array.isArray(mod.commands)) continue;

    const targetCmd = mod.commands.find(function (c) {
      if (!c || !c.name) return false;
      const primary = String(c.name).toLowerCase();
      if (primary === cmdName) return true;

      const userAliases = (state.config && typeof state.config.aliases === "string")
        ? state.config.aliases.split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean)
        : null;

      const defaultAliases = Array.isArray(c.aliases)
        ? c.aliases.map(function (s) { return String(s).trim().toLowerCase(); }).filter(Boolean)
        : [];

      const activeAliases = (userAliases !== null && userAliases.length > 0) ? userAliases : defaultAliases;
      return activeAliases.indexOf(cmdName) !== -1;
    });

    if (!targetCmd || targetCmd.prefix !== true) continue;

    const handler = typeof targetCmd.execute === "function"
      ? targetCmd.execute
      : (typeof targetCmd.onCommand === "function" ? targetCmd.onCommand : (typeof mod.onCommand === "function" ? mod.onCommand : null));

    if (!handler) continue;

    const pluginCtx = Object.assign({}, ctx);
    pluginCtx.pluginId = pid;
    pluginCtx.storage = resolvePluginStorage(ctx, pid);
    pluginCtx.command = targetCmd.name;
    pluginCtx.commandName = targetCmd.name;
    pluginCtx.rawArgs = rawArgs;
    pluginCtx.rawText = rawText;
    pluginCtx.options = parsePositionalOptions(targetCmd.options || [], rawArgs, rawText);
    pluginCtx.config = (state && state.config && typeof state.config === "object") ? state.config : {};

    if (typeof targetCmd.cooldown === "number" && targetCmd.cooldown > 0) {
      if (typeof pluginCtx.cooldown === "function" && !pluginCtx.cooldown(targetCmd.cooldown)) {
        return true;
      }
    }

    if (typeof ctx.logCommand === "function") {
      ctx.logCommand(targetCmd.name, rawArgs);
    }

    try {
      const r = handler(pluginCtx);
      if (r && typeof r.catch === "function") {
        r.catch(function (err) {
          const errMsg = (err && err.message) || "An unexpected error occurred while executing this command.";
          if (typeof pluginCtx.replyError === "function") {
            pluginCtx.replyError(errMsg);
          } else if (typeof pluginCtx.reply === "function") {
            pluginCtx.reply("> ❌ " + errMsg);
          }
        });
      }
      return true;
    } catch (e) {
      const errMsg = (e && e.message) || "An unexpected error occurred while executing this command.";
      if (typeof pluginCtx.replyError === "function") {
        pluginCtx.replyError(errMsg);
      } else if (typeof pluginCtx.reply === "function") {
        pluginCtx.reply("> ❌ " + errMsg);
      }
      return true;
    }
  }
  return false;
}

module.exports = {
  commands: [
    {
      name: "prefix",
      description: "Manage and view server prefix settings",
      slash: true,
      prefix: true,
      cooldown: 10,
      options: [
        {
          type: 1,
          name: "info",
          description: "View current server and global prefix settings"
        },
        {
          type: 1,
          name: "set",
          description: "Set a custom prefix for this server",
          options: [
            {
              type: 3,
              name: "prefix",
              description: "New prefix (1 to 5 characters)",
              required: true
            }
          ]
        },
        {
          type: 1,
          name: "reset",
          description: "Reset server prefix to default settings"
        }
      ]
    }
  ],

  onCommand: function (ctx) {
    const sub = String(ctx.subcommand || "info").toLowerCase();
    const opts = ctx.options || {};

    if (sub === "set") {
      handleSet(ctx, opts.prefix);
    } else if (sub === "reset") {
      handleReset(ctx);
    } else {
      handleInfo(ctx);
    }
  },

  events: {
    MESSAGE_CREATE: function (ctx) {
      const data = ctx.data;
      if (!data || (data.author && data.author.bot)) return;

      const content = String(data.content || "").trim();
      if (!content) return;

      const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
      const guildId = ctx.guildId;
      const botId = ctx.botId;

      const mentionEnabled = cfg.enable_mention_prefix !== "false";
      const globalEnabled = cfg.enable_global_prefix !== "false";
      const mainPrefix = (cfg.main_prefix || "!").trim() || "!";
      const serverPrefix = getServerPrefix(ctx, guildId);

      let matchedPrefix = null;

      if (mentionEnabled && botId) {
        const mentionRegex = new RegExp("^<@!?" + botId + ">(\\s+|$)", "i");
        const match = content.match(mentionRegex);
        if (match) {
          const restAfterMention = content.slice(match[0].length).trim();
          if (!restAfterMention) return;
          matchedPrefix = match[0];
        }
      }

      if (!matchedPrefix && serverPrefix) {
        const sp = String(serverPrefix).trim();
        if (sp && content.toLowerCase().startsWith(sp.toLowerCase())) {
          matchedPrefix = content.slice(0, sp.length);
        }
      }

      if (!matchedPrefix && globalEnabled && mainPrefix) {
        const mp = String(mainPrefix).trim();
        if (mp && content.toLowerCase().startsWith(mp.toLowerCase())) {
          matchedPrefix = content.slice(0, mp.length);
        }
      }

      if (!matchedPrefix) return;

      const commandBody = content.slice(matchedPrefix.length).trim();
      if (!commandBody) return;

      const parts = commandBody.split(/\s+/);
      const cmdName = parts[0].toLowerCase();
      const rawArgs = parts.slice(1);
      const rawText = commandBody.slice(parts[0].length).trim();

      const parseAliases = function (val, fallback) {
        const str = (typeof val === "string" && val.trim()) ? val : fallback;
        return str.split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      };

      const infoAliases = parseAliases(cfg.aliases_info, "prefix, prefixview, prefixinfo");
      const setAliases = parseAliases(cfg.aliases_set, "prefixset, prefixadd, setprefix");
      const resetAliases = parseAliases(cfg.aliases_reset, "removeprefix, prefixremove, resetprefix, prefixreset");

      if (cmdName === "add" && rawArgs[0] && rawArgs[0].toLowerCase() === "prefix") {
        if (typeof ctx.cooldown === "function" && !ctx.cooldown(10)) return;
        return handleSet(ctx, rawArgs[1]);
      }

      if (setAliases.indexOf(cmdName) !== -1) {
        if (typeof ctx.cooldown === "function" && !ctx.cooldown(10)) return;
        return handleSet(ctx, rawArgs[0]);
      }

      if (resetAliases.indexOf(cmdName) !== -1) {
        if (typeof ctx.cooldown === "function" && !ctx.cooldown(10)) return;
        return handleReset(ctx);
      }

      if (infoAliases.indexOf(cmdName) !== -1) {
        const subAction = (rawArgs[0] || "").toLowerCase();
        if (subAction === "set" || subAction === "add") {
          if (typeof ctx.cooldown === "function" && !ctx.cooldown(10)) return;
          return handleSet(ctx, rawArgs[1]);
        }
        if (subAction === "reset" || subAction === "remove") {
          if (typeof ctx.cooldown === "function" && !ctx.cooldown(10)) return;
          return handleReset(ctx);
        }
        if (typeof ctx.cooldown === "function" && !ctx.cooldown(10)) return;
        return handleInfo(ctx);
      }

      executeExternalPluginCommand(ctx, cmdName, rawArgs, rawText);
    }
  }
};
