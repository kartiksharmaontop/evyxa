"use strict";

const ADMINISTRATOR = 8n;
const MODERATE_MEMBERS = 1n << 40n;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

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

function getUser(ctx) {
  return (ctx && (ctx.user || ctx.author)) || {};
}

function getUserId(ctx) {
  const u = getUser(ctx);
  return u && u.id ? String(u.id) : "";
}

function extractUserId(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object" && value.id) return String(value.id);
  const s = String(value).trim();
  const m = s.match(/^<@!?(\d{17,20})>$/) || s.match(/^(\d{17,20})$/);
  return m ? m[1] : null;
}

function isSlashInvocation(ctx) {
  return Boolean(ctx && ctx.interaction && ctx.interaction.type === 2);
}

function getCommandName(ctx) {
  return String(
    (ctx && (ctx.command || ctx.commandName)) ||
    (ctx && ctx.interaction && ctx.interaction.data && ctx.interaction.data.name) ||
    ""
  ).toLowerCase().trim();
}

function usageFor(cmd) {
  if (cmd === "timeout") return "Usage: `timeout <user> <duration> [reason]`";
  if (cmd === "untimeout") return "Usage: `untimeout <user> [reason]`";
  if (cmd === "mute") return "Usage: `mute <user> [duration] [reason]`";
  return "Usage: `unmute <user> [reason]`";
}

function parseDuration(input) {
  if (!input || typeof input !== "string") return null;
  const match = input.trim().match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (isNaN(num) || num <= 0) return null;
  const unit = match[2].toLowerCase();
  if (unit === "s") return { ms: num * 1000, label: num === 1 ? "1 Second" : num + " Seconds" };
  if (unit === "m") return { ms: num * 60 * 1000, label: num === 1 ? "1 Minute" : num + " Minutes" };
  if (unit === "h") return { ms: num * 60 * 60 * 1000, label: num === 1 ? "1 Hour" : num + " Hours" };
  if (unit === "d") return { ms: num * 24 * 60 * 60 * 1000, label: num === 1 ? "1 Day" : num + " Days" };
  if (unit === "w") return { ms: num * 7 * 24 * 60 * 60 * 1000, label: num === 1 ? "1 Week" : num + " Weeks" };
  return null;
}

function defaultMuteDuration(ctx) {
  const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
  const parsed = parseDuration(String(cfg.mute_duration || ""));
  if (parsed && parsed.ms <= MAX_TIMEOUT_MS) return parsed;
  return parseDuration("28d");
}

function buildRolePositionMap(roles) {
  const map = {};
  if (Array.isArray(roles)) {
    roles.forEach(function (r) {
      if (r && r.id) map[String(r.id)] = Number(r.position) || 0;
    });
  }
  return map;
}

function maxRolePosition(memberRoles, rolePositionMap) {
  if (!Array.isArray(memberRoles) || !memberRoles.length) return -1;
  let highest = -1;
  for (let i = 0; i < memberRoles.length; i++) {
    const pos = rolePositionMap[String(memberRoles[i])];
    if (typeof pos === "number" && pos > highest) highest = pos;
  }
  return highest;
}

function hasPermissionBit(permissions, bit) {
  try {
    const p = BigInt(permissions || 0);
    if ((p & ADMINISTRATOR) === ADMINISTRATOR) return true;
    return (p & bit) === bit;
  } catch (e) {
    return false;
  }
}

async function fetchMemberSafe(ctx, userId) {
  if (typeof ctx.fetchMember !== "function" || !userId) return null;
  try {
    const res = await ctx.fetchMember(ctx.guildId, userId);
    if (res && res.status === 200 && res.body) return res.body;
    if (res && typeof res.roles !== "undefined" && res.id) return res;
    return null;
  } catch (e) {
    return null;
  }
}

async function fetchRolesSafe(ctx) {
  if (typeof ctx.fetchRoles !== "function") return [];
  try {
    const res = await ctx.fetchRoles(ctx.guildId);
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.body)) return res.body;
    return [];
  } catch (e) {
    return [];
  }
}

function hasActiveTimeout(member) {
  if (!member || !member.communication_disabled_until) return false;
  const until = Date.parse(member.communication_disabled_until);
  return !isNaN(until) && until > Date.now();
}

function cleanReason(value, targetId) {
  let s = String(value || "");
  if (targetId) {
    s = s.split("<@" + targetId + ">").join(" ");
    s = s.split("<@!" + targetId + ">").join(" ");
  }
  s = s.replace(/[`*]/g, "'").replace(/\s+/g, " ").trim();
  return s.slice(0, 120).trim();
}

function resolveInvocation(ctx, cmd, isSet) {
  const authorId = getUserId(ctx);

  if (isSlashInvocation(ctx)) {
    const opts = (ctx && ctx.options) || {};
    const targetId = extractUserId(opts.user);
    const durationRaw = typeof opts.duration === "string" ? opts.duration.trim() : "";
    const reason = typeof opts.reason === "string" ? opts.reason.trim() : "";
    return { targetId: targetId, durationRaw: durationRaw, reason: reason, usage: !targetId };
  }

  const rawArgs = Array.isArray(ctx.rawArgs) ? ctx.rawArgs : [];
  if (!rawArgs.length) return { targetId: null, durationRaw: "", reason: "", usage: true };

  const targetId = extractUserId(rawArgs[0]);
  if (!targetId) return { targetId: null, durationRaw: "", reason: "", usage: true };

  const rest = rawArgs.slice(1);

  if (!isSet) {
    return { targetId: targetId, durationRaw: "", reason: rest.join(" ").trim(), usage: false };
  }

  if (cmd === "timeout") {
    if (!rest.length) return { targetId: targetId, durationRaw: "", reason: "", usage: true };
    return { targetId: targetId, durationRaw: String(rest[0]).trim(), reason: rest.slice(1).join(" ").trim(), usage: false };
  }

  if (rest.length && parseDuration(String(rest[0]))) {
    return { targetId: targetId, durationRaw: String(rest[0]).trim(), reason: rest.slice(1).join(" ").trim(), usage: false };
  }

  return { targetId: targetId, durationRaw: "", reason: rest.join(" ").trim(), usage: false };
}

async function applyTimeout(ctx, targetId, ms) {
  if (typeof ctx.timeoutMember === "function") {
    return ctx.timeoutMember(ctx.guildId, targetId, ms);
  }
  if (typeof ctx.discordRequest !== "function") return null;
  return ctx.discordRequest("PATCH", "/guilds/" + ctx.guildId + "/members/" + targetId, {
    communication_disabled_until: ms > 0 ? new Date(Date.now() + ms).toISOString() : null
  });
}

async function onCommand(ctx) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used in a server.");
  }

  const cmd = getCommandName(ctx);
  const isSet = cmd === "timeout" || cmd === "mute";
  const isClear = cmd === "untimeout" || cmd === "unmute";
  if (!isSet && !isClear) return;

  const input = resolveInvocation(ctx, cmd, isSet);
  if (input.usage || !input.targetId) {
    return ctx.replyWarn(usageFor(cmd));
  }

  const authorId = getUserId(ctx);
  const botId = ctx.botId ? String(ctx.botId) : "";
  const targetId = String(input.targetId);
  const reason = cleanReason(input.reason, targetId);
  const isAuthorTarget = targetId === authorId;
  const isBotTarget = Boolean(botId) && targetId === botId;

  let duration = null;
  if (isSet) {
    const raw = input.durationRaw || "";
    if (raw) {
      duration = parseDuration(raw);
      if (!duration) {
        return ctx.replyWarn("Invalid duration. Use formats like `10m`, `1h` or `1d`.");
      }
      if (duration.ms > MAX_TIMEOUT_MS) {
        return ctx.replyWarn("Discord allows a maximum timeout of 28 days.");
      }
    } else if (cmd === "mute") {
      duration = defaultMuteDuration(ctx);
      if (duration.ms > MAX_TIMEOUT_MS) duration = { ms: MAX_TIMEOUT_MS, label: "28 Days" };
    } else {
      return ctx.replyWarn(usageFor(cmd));
    }
  }

  if (ctx.guildOwnerId && String(ctx.guildOwnerId) === targetId) {
    return ctx.replyWarn("The server owner cannot be timed out.");
  }

  if (isBotTarget) {
    return ctx.replyWarn("I cannot time out myself.");
  }

  if (typeof ctx.hasPermission === "function" && !ctx.hasPermission("MODERATE_MEMBERS")) {
    return ctx.replyWarn("You need the `MODERATE_MEMBERS` permission to use this command.");
  }

  const targetMember = await fetchMemberSafe(ctx, targetId);
  if (!targetMember) {
    return ctx.replyWarn("User <@" + targetId + "> is not in this server.");
  }

  const isActive = hasActiveTimeout(targetMember);
  if (isSet && isActive) {
    return ctx.replyWarn("This user already has an active timeout. Remove it with `untimeout` first.");
  }
  if (isClear && !isActive) {
    return ctx.replyWarn("This user does not have an active timeout.");
  }

  const botMember = await fetchMemberSafe(ctx, botId);
  if (!botMember || !hasPermissionBit(botMember.permissions, MODERATE_MEMBERS)) {
    return ctx.replyWarn("I need the `MODERATE_MEMBERS` permission to use this command.");
  }

  const roles = await fetchRolesSafe(ctx);
  if (roles.length) {
    const rolePositionMap = buildRolePositionMap(roles);
    const targetHighest = maxRolePosition(targetMember.roles, rolePositionMap);
    const botHighest = maxRolePosition(botMember.roles, rolePositionMap);

    if (targetHighest >= botHighest) {
      return ctx.replyWarn("I cannot time out <@" + targetId + "> because their role is higher than or equal to my role.");
    }

    const isAuthorGuildOwner = ctx.isServerOwner === true || (ctx.guildOwnerId && String(ctx.guildOwnerId) === String(authorId));
    if (!isAuthorTarget && !isAuthorGuildOwner && ctx.member) {
      const authorHighest = maxRolePosition(ctx.member.roles, rolePositionMap);
      if (targetHighest >= authorHighest) {
        return ctx.replyWarn("You cannot time out <@" + targetId + "> because their role is higher than or equal to your role.");
      }
    }
  }

  let res = null;
  try {
    res = await applyTimeout(ctx, targetId, isSet ? duration.ms : 0);
  } catch (err) {
    res = null;
  }

  const status = (res && typeof res.status === "number") ? res.status : 0;
  const body = (res && res.body && typeof res.body === "object") ? res.body : null;

  if (status === 403 || (body && body.code === 50013)) {
    return ctx.replyWarn("I do not have permission to time out that member.");
  }
  if (status < 200 || status >= 300) {
    const message = (body && body.message) ? String(body.message) : "HTTP " + (status || "error");
    return ctx.replyError("Failed to apply the timeout (" + message + ").");
  }

  const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
  const emoji = resolveEmoji(cfg.emoji_success, "✅");
  let inner;

  if (cmd === "timeout") {
    inner = "Successfully timed out <@" + targetId + "> for " + duration.label;
  } else if (cmd === "mute") {
    inner = "Successfully muted <@" + targetId + "> for " + duration.label;
  } else if (cmd === "untimeout") {
    inner = "Successfully removed timeout of <@" + targetId + ">";
  } else {
    inner = "Successfully unmuted <@" + targetId + ">";
  }

  if (reason) {
    inner += " | " + reason;
  }

  return ctx.reply("> " + emoji + " **" + inner + "**", { allowed_mentions: { parse: [] } });
}

module.exports = {
  name: "Timeout & Mute",
  description: "Time out or mute members with duration parsing, role hierarchy checks and clean plain-text alerts for slash and prefix commands.",
  version: "1.0.0",

  config: [
    {
      key: "emoji_success",
      label: "Success Emoji",
      type: "text",
      default: "✅",
      description: "Emoji displayed in the success message"
    },
    {
      key: "mute_duration",
      label: "Default Mute Duration",
      type: "text",
      default: "28d",
      description: "Duration used when mute is run without one"
    }
  ],

  commands: [
    {
      name: "timeout",
      description: "Temporarily prevent a member from sending messages",
      slash: true,
      prefix: true,
      cooldown: 3,
      category: "Moderation",
      options: [
        {
          type: 6,
          name: "user",
          description: "Member to time out",
          required: true
        },
        {
          type: 3,
          name: "duration",
          description: "How long, for example 10m, 1h or 1d",
          required: true
        },
        {
          type: 3,
          name: "reason",
          description: "Reason for the timeout",
          required: false
        }
      ]
    },
    {
      name: "untimeout",
      description: "Remove an active timeout from a member",
      slash: true,
      prefix: true,
      cooldown: 3,
      category: "Moderation",
      options: [
        {
          type: 6,
          name: "user",
          description: "Member to remove the timeout from",
          required: true
        },
        {
          type: 3,
          name: "reason",
          description: "Reason for removing the timeout",
          required: false
        }
      ]
    },
    {
      name: "mute",
      description: "Mute a member with the default duration, prefix command",
      slash: false,
      prefix: true,
      cooldown: 3,
      category: "Moderation",
      options: [
        {
          type: 6,
          name: "user",
          description: "Member to mute",
          required: false
        },
        {
          type: 3,
          name: "duration",
          description: "How long, for example 10m, 1h or 1d",
          required: false
        },
        {
          type: 3,
          name: "reason",
          description: "Reason for the mute",
          required: false
        }
      ]
    },
    {
      name: "unmute",
      description: "Remove an active mute from a member, prefix command",
      slash: false,
      prefix: true,
      cooldown: 3,
      category: "Moderation",
      options: [
        {
          type: 6,
          name: "user",
          description: "Member to unmute",
          required: false
        },
        {
          type: 3,
          name: "reason",
          description: "Reason for removing the mute",
          required: false
        }
      ]
    }
  ],

  onCommand: onCommand
};
