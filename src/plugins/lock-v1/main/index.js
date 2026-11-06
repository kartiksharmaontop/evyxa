const SEND_MESSAGES = 2048n;
const SEND_THREADS = 274877906944n;
const LOCK_PERMS = SEND_MESSAGES | SEND_THREADS;

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

function hasManageChannelsPermission(ctx) {
  if (ctx.isServerOwner === true) return true;
  const uid = ctx.user && ctx.user.id;
  if (uid && ctx.guildOwnerId && String(ctx.guildOwnerId) === String(uid)) return true;
  if (typeof ctx.hasPermission === "function") {
    return ctx.hasPermission("MANAGE_CHANNELS") || ctx.hasPermission("ADMINISTRATOR");
  }
  if (!ctx.member || !ctx.member.permissions) return false;
  try {
    const p = BigInt(ctx.member.permissions);
    return (p & (1n << 4n)) === (1n << 4n) || (p & 8n) === 8n;
  } catch (e) {
    return false;
  }
}

function resolveTargetChannelId(ctx) {
  if (ctx && ctx.options && ctx.options.channel) {
    const ch = ctx.options.channel;
    if (typeof ch === "string") {
      const m = ch.match(/<#(\d+)>|(\d+)/);
      if (m) return m[1] || m[2];
    }
    if (typeof ch === "object" && ch && ch.id) {
      return String(ch.id);
    }
  }

  const args = Array.isArray(ctx.rawArgs) ? ctx.rawArgs : (Array.isArray(ctx.args) ? ctx.args : []);
  if (args.length > 0) {
    const first = String(args[0]).trim();
    const match = first.match(/<#(\d+)>/) || first.match(/^(\d+)$/);
    if (match) return match[1];
  }

  return ctx.channelId || null;
}

async function handleLockToggle(ctx, action) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used inside a server.");
  }

  if (!hasManageChannelsPermission(ctx)) {
    return ctx.replyWarn("You need Manage Channels permission to use this command.");
  }

  const targetId = resolveTargetChannelId(ctx);
  if (!targetId) {
    return ctx.replyWarn("Could not determine the target channel.");
  }

  let chRes = null;
  try {
    chRes = typeof ctx.fetchChannel === "function"
      ? await ctx.fetchChannel(targetId)
      : await ctx.discordRequest("GET", "/channels/" + targetId);
  } catch (err) {
    return ctx.replyWarn("Could not access the specified channel.");
  }

  const channel = (chRes && typeof chRes === "object" && chRes.body && typeof chRes.body === "object")
    ? chRes.body
    : chRes;

  if (!channel || typeof channel !== "object" || !channel.id) {
    return ctx.replyWarn("Could not find or access the specified channel.");
  }

  // Allow text (0), announcement (5), or forum (15)
  if (channel.type !== 0 && channel.type !== 5 && channel.type !== 15) {
    return ctx.replyWarn("Lock and unlock commands can only be used on text channels.");
  }

  const everyoneId = ctx.guildId;
  const overwrites = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
  const existing = overwrites.find(function (o) { return String(o.id) === String(everyoneId); });

  let currentAllow = 0n;
  let currentDeny = 0n;
  if (existing) {
    try { currentAllow = BigInt(existing.allow || 0); } catch (e) {}
    try { currentDeny = BigInt(existing.deny || 0); } catch (e) {}
  }

  const isCurrentlyLocked = (currentDeny & SEND_MESSAGES) === SEND_MESSAGES;
  const cfg = (ctx && ctx.config) || {};
  const lockEmoji = resolveEmoji(cfg.emoji_lock, "🔒");
  const unlockEmoji = resolveEmoji(cfg.emoji_unlock, "🔓");

  if (action === "lock") {
    if (isCurrentlyLocked) {
      return ctx.replyWarn("This channel is already locked.");
    }
    const newAllow = (currentAllow & ~LOCK_PERMS).toString();
    const newDeny = (currentDeny | LOCK_PERMS).toString();

    let putRes = null;
    try {
      putRes = typeof ctx.setChannelPermissions === "function"
        ? await ctx.setChannelPermissions(targetId, everyoneId, newAllow, newDeny, 0)
        : await ctx.discordRequest("PUT", "/channels/" + targetId + "/permissions/" + everyoneId, {
            type: 0,
            allow: newAllow,
            deny: newDeny
          });
    } catch (err) {
      return ctx.replyError("Failed to lock the channel.");
    }

    const status = putRes && putRes.status;
    if (status === 403) {
      return ctx.replyWarn("I do not have permission to manage permissions in that channel.");
    }
    if (status && status >= 400 && status !== 403) {
      return ctx.replyError("Failed to lock the channel (HTTP " + status + ").");
    }

    return ctx.replyEmbed({
      description: lockEmoji + " <#" + targetId + "> has been locked."
    });
  }

  if (action === "unlock") {
    if (!isCurrentlyLocked) {
      return ctx.replyWarn("This channel is already unlocked.");
    }
    const newAllow = currentAllow.toString();
    const newDeny = (currentDeny & ~LOCK_PERMS).toString();

    let putRes = null;
    try {
      putRes = typeof ctx.setChannelPermissions === "function"
        ? await ctx.setChannelPermissions(targetId, everyoneId, newAllow, newDeny, 0)
        : await ctx.discordRequest("PUT", "/channels/" + targetId + "/permissions/" + everyoneId, {
            type: 0,
            allow: newAllow,
            deny: newDeny
          });
    } catch (err) {
      return ctx.replyError("Failed to unlock the channel.");
    }

    const status = putRes && putRes.status;
    if (status === 403) {
      return ctx.replyWarn("I do not have permission to manage permissions in that channel.");
    }
    if (status && status >= 400 && status !== 403) {
      return ctx.replyError("Failed to unlock the channel (HTTP " + status + ").");
    }

    return ctx.replyEmbed({
      description: unlockEmoji + " <#" + targetId + "> has been unlocked."
    });
  }
}

async function onCommand(ctx) {
  const cmd = String(
    ctx.command ||
    ctx.commandName ||
    (ctx.interaction && ctx.interaction.data && ctx.interaction.data.name) ||
    ""
  ).toLowerCase().trim();

  if (cmd === "lock") {
    return handleLockToggle(ctx, "lock");
  }
  if (cmd === "unlock") {
    return handleLockToggle(ctx, "unlock");
  }
}

module.exports = {
  name: "Lock & Unlock",
  description: "Quick text channel lock and unlock moderation tool for slash and prefix commands with 1-line clean embed alerts.",
  version: "1.0.0",

  config: [
    {
      key: "emoji_lock",
      label: "Lock Channel Emoji",
      type: "text",
      default: "🔒",
      description: "Emoji displayed in the lock notification embed"
    },
    {
      key: "emoji_unlock",
      label: "Unlock Channel Emoji",
      type: "text",
      default: "🔓",
      description: "Emoji displayed in the unlock notification embed"
    }
  ],

  commands: [
    {
      name: "lock",
      description: "Lock a text channel to prevent members from sending messages",
      slash: true,
      prefix: true,
      options: [
        {
          name: "channel",
          description: "The channel to lock (defaults to current channel)",
          type: 7,
          required: false,
          channel_types: [0, 5]
        }
      ],
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "unlock",
      description: "Unlock a text channel to allow members to send messages",
      slash: true,
      prefix: true,
      options: [
        {
          name: "channel",
          description: "The channel to unlock (defaults to current channel)",
          type: 7,
          required: false,
          channel_types: [0, 5]
        }
      ],
      execute: onCommand,
      onCommand: onCommand
    }
  ],

  onCommand: onCommand,
  execute: onCommand
};
