function getProcessedMessages() {
  if (!global.__arixa_avatar_processed) {
    global.__arixa_avatar_processed = new Map();
  }
  return global.__arixa_avatar_processed;
}

function cleanExpiredMessages() {
  const processed = getProcessedMessages();
  const now = Date.now();
  if (processed.size > 200) {
    for (const [mid, time] of processed.entries()) {
      if (now - time > 60000) {
        processed.delete(mid);
      }
    }
  }
}

function parseUserId(str) {
  if (!str || typeof str !== "string") return null;
  const cleaned = str.trim();
  const match = cleaned.match(/<@!?(\d+)>/);
  if (match) return match[1];
  if (/^\d{4,22}$/.test(cleaned)) return cleaned;
  return null;
}

function getDefaultAvatarUrl(user) {
  const uid = user && user.id ? BigInt(user.id) : 0n;
  const disc = user && user.discriminator;
  if (disc && disc !== "0") {
    return "https://cdn.discordapp.com/embed/avatars/" + (Number(disc) % 5) + ".png";
  }
  const index = Number((uid >> 22n) % 6n);
  return "https://cdn.discordapp.com/embed/avatars/" + index + ".png";
}

function getAvatarUrl(user, format, size) {
  const s = size || 1024;
  if (!user || !user.avatar) return getDefaultAvatarUrl(user);
  const isGif = String(user.avatar).startsWith("a_");
  const ext = format || (isGif ? "gif" : "png");
  return "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + "." + ext + "?size=" + s;
}

function getBannerUrl(user, format, size) {
  const s = size || 1024;
  if (!user || !user.banner) return null;
  const isGif = String(user.banner).startsWith("a_");
  const ext = format || (isGif ? "gif" : "png");
  return "https://cdn.discordapp.com/banners/" + user.id + "/" + user.banner + "." + ext + "?size=" + s;
}

function buildImageLinks(baseUrl, isGif) {
  const baseNoExt = baseUrl.split("?")[0].replace(/\.[a-z]+$/, "");
  const png = baseNoExt + ".png?size=1024";
  const jpg = baseNoExt + ".jpg?size=1024";
  const webp = baseNoExt + ".webp?size=1024";
  let links = "[PNG](" + png + ") | [JPG](" + jpg + ") | [WEBP](" + webp + ")";
  if (isGif) {
    const gif = baseNoExt + ".gif?size=1024";
    links += " | [GIF](" + gif + ")";
  }
  return links;
}

function resolveTargetId(ctx) {
  const opts = ctx.options || {};
  const rawArgs = Array.isArray(ctx.rawArgs) ? ctx.rawArgs : [];
  const msgData = ctx.data || (ctx.message && ctx.message.data) || {};
  const isReply = msgData.message_reference && (msgData.referenced_message || msgData.message_reference.message_id);

  let targetId = null;

  if (opts.user) {
    targetId = typeof opts.user === "object" ? (opts.user.id || parseUserId(opts.user.query)) : parseUserId(String(opts.user));
  }

  if (!targetId && rawArgs.length > 0) {
    const parsed = parseUserId(rawArgs[0]);
    if (parsed) targetId = parsed;
  }

  if (!targetId && isReply && msgData.referenced_message && msgData.referenced_message.author) {
    targetId = msgData.referenced_message.author.id;
  }

  if (!targetId && !rawArgs.length && !opts.user) {
    targetId = ctx.user && ctx.user.id;
  }

  return { targetId: targetId, isReply: isReply, msgData: msgData };
}

function handleMediaRequest(ctx, cmdName, targetId) {
  const userPromise = (typeof ctx.discordRequest === "function")
    ? ctx.discordRequest("GET", "/users/" + targetId)
    : Promise.resolve(null);

  const memberPromise = (ctx.guildId && typeof ctx.fetchMember === "function")
    ? ctx.fetchMember(ctx.guildId, targetId)
    : Promise.resolve(null);

  return Promise.all([userPromise, memberPromise]).then(function (results) {
    const userRes = results[0];
    const memberRes = results[1];

    let user = (userRes && userRes.body && userRes.body.id) ? userRes.body : null;
    const member = (memberRes && memberRes.status === 200 && memberRes.body) ? memberRes.body : null;

    if (!user && member && member.user) {
      user = member.user;
    }

    if (!user) {
      return ctx.replyWarn("Could not find user <@" + targetId + ">.");
    }

    const displayName = (member && member.nick) || user.global_name || user.username || "User";
    const avatarUrl = getAvatarUrl(user);

    if (cmdName === "banner") {
      const bannerUrl = getBannerUrl(user);
      if (!bannerUrl) {
        return ctx.replyWarn("User **" + displayName + "** does not have a custom profile banner.");
      }
      const isGif = user.banner && String(user.banner).startsWith("a_");
      const links = buildImageLinks(bannerUrl, isGif);

      return ctx.replyEmbed({
        author: {
          name: displayName + "'s Banner",
          icon_url: avatarUrl
        },
        description: links,
        image: {
          url: bannerUrl
        }
      });
    }

    const isGif = user.avatar && String(user.avatar).startsWith("a_");
    const links = buildImageLinks(avatarUrl, isGif);

    return ctx.replyEmbed({
      author: {
        name: displayName + "'s Avatar",
        icon_url: avatarUrl
      },
      description: links,
      image: {
        url: avatarUrl
      }
    });
  }).catch(function (err) {
    return ctx.replyWarn("An error occurred while fetching the profile media.");
  });
}

module.exports = {
  commands: [
    {
      name: "avatar",
      description: "Display a user's avatar in full resolution",
      slash: true,
      prefix: true,
      aliases: ["av", "pfp"],
      cooldown: 3,
      options: [
        {
          type: 6,
          name: "user",
          description: "Target user whose avatar you want to view",
          required: false
        }
      ]
    },
    {
      name: "banner",
      description: "Display a user's profile banner",
      slash: true,
      prefix: true,
      aliases: ["userbanner"],
      cooldown: 3,
      options: [
        {
          type: 6,
          name: "user",
          description: "Target user whose banner you want to view",
          required: false
        }
      ]
    }
  ],

  onCommand: function (ctx) {
    cleanExpiredMessages();
    const msgData = ctx.data || (ctx.message && ctx.message.data) || {};
    const mid = msgData.id;
    if (mid) {
      const dedupeKey = (ctx.botId || "bot") + ":" + mid;
      if (!ctx._fromLocalMessage && getProcessedMessages().has(dedupeKey)) {
        return;
      }
      getProcessedMessages().set(dedupeKey, Date.now());
    }

    const cmdName = String(ctx.command || "").toLowerCase();
    const resolved = resolveTargetId(ctx);
    let targetId = resolved.targetId;
    const isReply = resolved.isReply;

    if (!targetId && isReply && msgData.message_reference && msgData.message_reference.message_id && typeof ctx.fetchMessage === "function") {
      return ctx.fetchMessage(ctx.channelId, msgData.message_reference.message_id).then(function (fetched) {
        if (fetched && fetched.body && fetched.body.author) {
          targetId = fetched.body.author.id;
        } else if (fetched && fetched.author) {
          targetId = fetched.author.id;
        } else {
          targetId = ctx.user && ctx.user.id;
        }
        return handleMediaRequest(ctx, cmdName, targetId);
      }).catch(function () {
        return handleMediaRequest(ctx, cmdName, ctx.user && ctx.user.id);
      });
    }

    if (!targetId) {
      targetId = ctx.user && ctx.user.id;
    }

    return handleMediaRequest(ctx, cmdName, targetId);
  },

  events: {
    MESSAGE_CREATE: function (ctx) {
      cleanExpiredMessages();
      const msgData = ctx.data || {};
      if (!msgData || (msgData.author && msgData.author.bot)) return;

      const mid = msgData.id;
      const dedupeKey = (ctx.botId || "bot") + ":" + mid;
      if (mid && getProcessedMessages().has(dedupeKey)) {
        return;
      }

      const content = String(msgData.content || "").trim();
      if (!content) return;

      const prefixCfg = ctx.storage.get("prefix_" + ctx.guildId);
      let prefixes = ["+"];
      if (typeof prefixCfg === "string" && prefixCfg.trim()) {
        prefixes = [prefixCfg.trim()];
      } else if (Array.isArray(prefixCfg) && prefixCfg.length > 0) {
        prefixes = prefixCfg;
      }

      let matchedPrefix = null;
      for (let i = 0; i < prefixes.length; i++) {
        const p = prefixes[i];
        if (content.toLowerCase().startsWith(p.toLowerCase())) {
          matchedPrefix = p;
          break;
        }
      }

      if (!matchedPrefix) return;

      const commandBody = content.slice(matchedPrefix.length).trim();
      if (!commandBody) return;

      const parts = commandBody.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const rawArgs = parts.slice(1);

      let resolvedCmd = null;
      if (cmd === "avatar" || cmd === "av" || cmd === "pfp") {
        resolvedCmd = "avatar";
      } else if (cmd === "banner" || cmd === "userbanner") {
        resolvedCmd = "banner";
      }

      if (!resolvedCmd) return;

      if (mid) {
        getProcessedMessages().set(dedupeKey, Date.now());
      }

      ctx.command = resolvedCmd;
      ctx.rawArgs = rawArgs;
      ctx.options = {};
      ctx._fromLocalMessage = true;
      return module.exports.onCommand(ctx);
    }
  }
};
