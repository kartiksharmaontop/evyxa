"use strict";

const CHANGE_NICKNAME = 1n << 26n;
const MANAGE_NICKNAMES = 1n << 27n;
const ADMINISTRATOR = 8n;
const MAX_NICK_LENGTH = 32;

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

function resolveInvocation(ctx) {
  const authorId = getUserId(ctx);

  if (isSlashInvocation(ctx)) {
    const opts = (ctx && ctx.options) || {};
    return {
      targetId: extractUserId(opts.user) || authorId,
      name: typeof opts.name === "string" ? opts.name.trim() : "",
      usage: false
    };
  }

  const rawArgs = Array.isArray(ctx.rawArgs) ? ctx.rawArgs : [];
  if (!rawArgs.length) {
    return { targetId: authorId, name: "", usage: true };
  }

  const firstId = extractUserId(rawArgs[0]);
  if (firstId) {
    return { targetId: firstId, name: rawArgs.slice(1).join(" ").trim(), usage: false };
  }

  const rawText = (typeof ctx.rawText === "string" && ctx.rawText.trim()) ? ctx.rawText : rawArgs.join(" ");
  return { targetId: authorId, name: String(rawText).trim(), usage: false };
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

async function onCommand(ctx) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used in a server.");
  }

  const input = resolveInvocation(ctx);
  if (input.usage) {
    return ctx.replyWarn("Usage: `nick [@user] [name]`");
  }

  const authorId = getUserId(ctx);
  const botId = ctx.botId ? String(ctx.botId) : "";
  const targetId = String(input.targetId || authorId);
  const name = String(input.name || "").trim();
  const isReset = !name;
  const isAuthorTarget = targetId === authorId;
  const isBotTarget = Boolean(botId) && targetId === botId;

  if (name.length > MAX_NICK_LENGTH) {
    return ctx.replyWarn("Nicknames cannot exceed " + MAX_NICK_LENGTH + " characters.");
  }

  if (ctx.guildOwnerId && String(ctx.guildOwnerId) === targetId) {
    return ctx.replyWarn("The server owner's nickname cannot be changed.");
  }

  if (!isAuthorTarget && typeof ctx.hasPermission === "function" && !ctx.hasPermission("MANAGE_NICKNAMES")) {
    return ctx.replyWarn("You need the `MANAGE_NICKNAMES` permission to change someone else's nickname.");
  }

  const targetMember = await fetchMemberSafe(ctx, targetId);
  if (!targetMember) {
    return ctx.replyWarn("User <@" + targetId + "> is not in this server.");
  }

  const botMember = isBotTarget ? null : await fetchMemberSafe(ctx, botId);
  if (!isBotTarget) {
    if (!botMember || !hasPermissionBit(botMember.permissions, MANAGE_NICKNAMES)) {
      return ctx.replyWarn("I need the `MANAGE_NICKNAMES` permission to change that nickname.");
    }
  }

  const roles = await fetchRolesSafe(ctx);
  if (roles.length) {
    const rolePositionMap = buildRolePositionMap(roles);
    const targetHighest = maxRolePosition(targetMember.roles, rolePositionMap);

    if (!isBotTarget && botMember) {
      const botHighest = maxRolePosition(botMember.roles, rolePositionMap);
      if (targetHighest >= botHighest) {
        return ctx.replyWarn("I cannot change <@" + targetId + ">'s nickname because their role is higher than or equal to my role.");
      }
    }

    const isAuthorGuildOwner = ctx.isServerOwner === true || (ctx.guildOwnerId && String(ctx.guildOwnerId) === String(authorId));
    if (!isAuthorTarget && !isAuthorGuildOwner && ctx.member) {
      const authorHighest = maxRolePosition(ctx.member.roles, rolePositionMap);
      if (targetHighest >= authorHighest) {
        return ctx.replyWarn("You cannot change <@" + targetId + ">'s nickname because their role is higher than or equal to your role.");
      }
    }
  }

  if (typeof ctx.discordRequest !== "function") {
    return ctx.replyError("The nickname could not be changed because the Discord API is unavailable.");
  }

  let res = null;
  try {
    res = await ctx.discordRequest("PATCH", "/guilds/" + ctx.guildId + "/members/" + targetId, {
      nick: isReset ? null : name
    });
  } catch (err) {
    res = null;
  }

  const status = (res && typeof res.status === "number") ? res.status : 0;
  const body = (res && res.body && typeof res.body === "object") ? res.body : null;

  if (status === 403 || (body && body.code === 50013)) {
    return ctx.replyWarn("I do not have permission to change that nickname.");
  }
  if (status < 200 || status >= 300) {
    const reason = (body && body.message) ? String(body.message) : "HTTP " + (status || "error");
    return ctx.replyError("Failed to change the nickname (" + reason + ").");
  }

  const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
  const emoji = resolveEmoji(cfg.emoji_success, "✅");
  const safeName = name.replace(/[`*]/g, "'");
  const content = isReset
    ? "> " + emoji + " **Successfully reset nickname of <@" + targetId + ">**"
    : "> " + emoji + " **Successfully changed nickname of <@" + targetId + "> | `" + safeName + "`**";

  return ctx.reply(content, { allowed_mentions: { parse: [] } });
}

module.exports = {
  name: "Nickname",
  description: "Set or reset any member's server nickname with one command, with role hierarchy and permission safety checks.",
  version: "1.0.0",

  config: [
    {
      key: "emoji_success",
      label: "Success Emoji",
      type: "text",
      default: "✅",
      description: "Emoji displayed in the success message"
    }
  ],

  commands: [
    {
      name: "nick",
      description: "Set or reset a member's nickname in this server",
      slash: true,
      prefix: true,
      cooldown: 3,
      category: "Moderation",
      aliases: ["nickname", "setnick"],
      options: [
        {
          type: 6,
          name: "user",
          description: "Member to change the nickname of (defaults to you)",
          required: false
        },
        {
          type: 3,
          name: "name",
          description: "New nickname, leave empty to reset to the default name",
          required: false,
          max_length: 32
        }
      ]
    }
  ],

  onCommand: onCommand
};
