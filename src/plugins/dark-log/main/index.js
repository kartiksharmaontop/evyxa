function parseChannelIds(str) {
  if (!str || typeof str !== "string") return [];
  return str.split(",").map(function (s) {
    return s.trim().replace(/[^0-9]/g, "");
  }).filter(function (id) {
    return id.length >= 15 && id.length <= 22;
  });
}

function getDefaultAvatarUrl(user) {
  let uid = 0n;
  try {
    uid = user && user.id ? BigInt(user.id) : 0n;
  } catch (e) {
    uid = 0n;
  }
  const disc = user && user.discriminator;
  if (disc && disc !== "0") {
    return "https://cdn.discordapp.com/embed/avatars/" + (Number(disc) % 5) + ".png";
  }
  const index = Number((uid >> 22n) % 6n);
  return "https://cdn.discordapp.com/embed/avatars/" + index + ".png";
}

function getUserAvatarUrl(user) {
  if (!user || !user.avatar) return getDefaultAvatarUrl(user);
  const isGif = String(user.avatar).startsWith("a_");
  const ext = isGif ? "gif" : "png";
  return "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + "." + ext + "?size=256";
}

function getGuildIconUrl(guildId, iconHash) {
  if (!guildId || !iconHash) return "https://cdn.discordapp.com/embed/avatars/0.png";
  const isGif = String(iconHash).startsWith("a_");
  const ext = isGif ? "gif" : "png";
  return "https://cdn.discordapp.com/icons/" + guildId + "/" + iconHash + "." + ext + "?size=256";
}

function resolveAccentColor(ctx) {
  if (ctx && ctx.colors && typeof ctx.colors.v2 === "number") {
    return ctx.colors.v2;
  }
  return 0x5865f2;
}

function resolveWarningColor(ctx) {
  if (ctx && ctx.colors && typeof ctx.colors.warning === "number") {
    return ctx.colors.warning;
  }
  return 0xfaa61a;
}

function buildLogCard(headerText, lines, thumbnailUrl, accentColor) {
  const bodyContent = "### " + headerText + "\n" + lines.map(function (line) {
    return "> - " + line;
  }).join("\n");

  const sectionComp = {
    type: 9,
    components: [
      {
        type: 10,
        content: bodyContent
      }
    ]
  };

  if (thumbnailUrl) {
    sectionComp.accessory = {
      type: 11,
      media: {
        url: thumbnailUrl
      }
    };
  }

  return {
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [
          sectionComp
        ]
      }
    ]
  };
}

function dispatchLog(ctx, channelListRaw, payload) {
  const channelIds = parseChannelIds(channelListRaw);
  if (!channelIds.length) return Promise.resolve();

  const reqFn = (typeof ctx.discordRequest === "function")
    ? ctx.discordRequest.bind(ctx)
    : (typeof ctx.request === "function" ? ctx.request.bind(ctx) : null);

  if (!reqFn) return Promise.resolve();

  return Promise.all(channelIds.map(function (cid) {
    return reqFn("POST", "/channels/" + cid + "/messages", payload).catch(function () {});
  }));
}

module.exports = {
  events: {
    COMMAND_EXECUTE: function (ctx) {
      const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
      const channelCfg = cfg.command_logs;
      if (!channelCfg) return;

      const data = ctx.data || {};
      const user = data.user || ctx.user || {};
      if (!user.id) return;

      const userName = user.global_name || user.username || "Unknown";
      const userHandle = user.username ? " • `" + user.username + "`" : "";
      const userId = user.id;

      let cmdDisplay = data.command ? "/" + data.command : "/unknown";
      if (data.type === "prefix") {
        const argsStr = Array.isArray(data.args) && data.args.length ? " " + data.args.join(" ") : "";
        cmdDisplay = (data.prefix || "!") + (data.command || "command") + argsStr;
      } else if (data.options && typeof data.options === "object") {
        const optKeys = Object.keys(data.options);
        if (optKeys.length) {
          const optsFormatted = optKeys.map(function (k) {
            const v = data.options[k];
            const valStr = (v && typeof v === "object" && v.id) ? "<@" + v.id + ">" : String(v);
            return k + ":" + valStr;
          }).join(" ");
          cmdDisplay += " " + optsFormatted;
        }
      }

      const guildName = data.guildName || data.guild_name || ctx.guildName || "Server";
      const guildId = data.guildId || data.guild_id || ctx.guildId || "Direct Message";
      const channelId = data.channelId || data.channel_id || ctx.channelId;
      const timestamp = data.timestamp || Math.floor(Date.now() / 1000);

      const lines = [
        "**User:** <@" + userId + "> (`" + userName + "`" + userHandle + " • `" + userId + "`)",
        "**Command:** `" + cmdDisplay + "`",
        "**Server:** " + guildName + " (`" + guildId + "`)",
        "**Channel:** <#" + channelId + ">",
        "**Time:** <t:" + timestamp + ":F> (<t:" + timestamp + ":R>)"
      ];

      const thumbnailUrl = getUserAvatarUrl(user);
      const accentColor = resolveAccentColor(ctx);
      const payload = buildLogCard("Command Executed", lines, thumbnailUrl, accentColor);

      return dispatchLog(ctx, channelCfg, payload);
    },

    GUILD_CREATE: function (ctx) {
      const data = ctx.data || {};
      if (data._isInitialSync) return;

      const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
      const channelCfg = cfg.join_logs;
      if (!channelCfg) return;

      const guildId = data.id;
      if (!guildId) return;

      const guildName = data.name || "Server";
      const ownerId = data.owner_id ? "<@" + data.owner_id + "> (`" + data.owner_id + "`)" : "Unknown";
      const memberCount = Number(data.member_count || data.approximate_member_count || 0);
      const totalServers = Number(data._totalGuilds || 1);
      const timestamp = Math.floor(Date.now() / 1000);

      const lines = [
        "**Server:** " + guildName + " (`" + guildId + "`)",
        "**Owner:** " + ownerId,
        "**Members:** " + memberCount.toLocaleString() + " members",
        "**Total Servers:** Currently in " + totalServers + " server" + (totalServers === 1 ? "" : "s"),
        "**Time:** <t:" + timestamp + ":F> (<t:" + timestamp + ":R>)"
      ];

      const thumbnailUrl = getGuildIconUrl(guildId, data.icon);
      const accentColor = resolveAccentColor(ctx);
      const payload = buildLogCard("Bot Added to Server", lines, thumbnailUrl, accentColor);

      return dispatchLog(ctx, channelCfg, payload);
    },

    GUILD_DELETE: function (ctx) {
      const data = ctx.data || {};
      if (data.unavailable) return;

      const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
      const channelCfg = cfg.leave_logs;
      if (!channelCfg) return;

      const guildId = data.id;
      if (!guildId) return;

      const guildName = data.name || "Server";
      const remainingServers = Number(data._remainingGuilds || 0);
      const timestamp = Math.floor(Date.now() / 1000);

      const lines = [
        "**Server:** " + guildName + " (`" + guildId + "`)",
        "**Remaining Servers:** Currently in " + remainingServers + " server" + (remainingServers === 1 ? "" : "s"),
        "**Time:** <t:" + timestamp + ":F> (<t:" + timestamp + ":R>)"
      ];

      const thumbnailUrl = getGuildIconUrl(guildId, data.icon);
      const warningColor = resolveWarningColor(ctx);
      const payload = buildLogCard("Bot Removed from Server", lines, thumbnailUrl, warningColor);

      return dispatchLog(ctx, channelCfg, payload);
    }
  }
};
