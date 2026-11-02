const crypto = require("crypto");

const ACTION_EXPIRE_MS = 120000;

function getPendingActions() {
  if (!global.__arixa_ban_actions) {
    global.__arixa_ban_actions = {};
  }
  return global.__arixa_ban_actions;
}

function getProcessedMessages() {
  if (!global.__arixa_ban_processed) {
    global.__arixa_ban_processed = new Map();
  }
  return global.__arixa_ban_processed;
}

function cleanExpiredActions() {
  const actions = getPendingActions();
  const now = Date.now();
  Object.keys(actions).forEach(function (k) {
    if (!actions[k] || (now - actions[k].createdAt > ACTION_EXPIRE_MS)) {
      delete actions[k];
    }
  });

  const processed = getProcessedMessages();
  if (processed.size > 200) {
    for (const [mid, time] of processed.entries()) {
      if (now - time > 60000) {
        processed.delete(mid);
      }
    }
  }
}

function parseDuration(input) {
  if (!input || typeof input !== "string") return null;
  const match = input.trim().match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (isNaN(num) || num <= 0) return null;
  const unit = match[2].toLowerCase();
  if (unit === "s") {
    return { ms: num * 1000, label: num === 1 ? "1 Second" : num + " Seconds" };
  }
  if (unit === "m") {
    return { ms: num * 60 * 1000, label: num === 1 ? "1 Minute" : num + " Minutes" };
  }
  if (unit === "h") {
    return { ms: num * 60 * 60 * 1000, label: num === 1 ? "1 Hour" : num + " Hours" };
  }
  if (unit === "d") {
    return { ms: num * 24 * 60 * 60 * 1000, label: num === 1 ? "1 Day" : num + " Days" };
  }
  if (unit === "w") {
    return { ms: num * 7 * 24 * 60 * 60 * 1000, label: num === 1 ? "1 Week" : num + " Weeks" };
  }
  return null;
}

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

function resolveErrorColor(ctx) {
  if (ctx && ctx.colors && typeof ctx.colors.error === "number") {
    return ctx.colors.error;
  }
  return 0xed4245;
}

function buildAlertCard(message, accentColor) {
  return {
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [
          {
            type: 10,
            content: message
          }
        ]
      }
    ]
  };
}

function sendV2Update(ctx, mid, payload) {
  if (typeof ctx.update === "function") {
    return ctx.update(payload);
  }
  if (mid && typeof ctx.editMessage === "function") {
    return ctx.editMessage(ctx.channelId, mid, payload);
  }
  if (typeof ctx.reply === "function") {
    return ctx.reply(payload);
  }
  return ctx.sendChannel(ctx.channelId, payload);
}

function hasBanPermission(ctx) {
  if (ctx.isServerOwner === true) return true;
  const uid = ctx.user && ctx.user.id;
  if (uid && ctx.guildOwnerId && String(ctx.guildOwnerId) === String(uid)) return true;
  if (typeof ctx.hasPermission === "function") {
    return ctx.hasPermission("BAN_MEMBERS") || ctx.hasPermission("ADMINISTRATOR");
  }
  if (!ctx.member || !ctx.member.permissions) return false;
  try {
    const p = BigInt(ctx.member.permissions);
    return (p & 4n) === 4n || (p & 8n) === 8n;
  } catch (e) {
    return false;
  }
}

function parseUserId(str) {
  if (!str || typeof str !== "string") return null;
  const cleaned = str.trim();
  const match = cleaned.match(/<@!?(\d+)>/);
  if (match) return match[1];
  if (/^\d{15,22}$/.test(cleaned)) return cleaned;
  return null;
}

function buildPromptCard(actionId, action, accentColor) {
  let promptText = "";
  if (action.type === "ban") {
    if (action.timeLabel && action.reason && action.reason !== "No reason provided") {
      promptText = "> **Are you sure you want to ban <@" + action.targetId + "> for " + action.timeLabel + "?**\n> **Reason:** " + action.reason;
    } else if (action.timeLabel) {
      promptText = "> **Are you sure you want to ban <@" + action.targetId + "> for " + action.timeLabel + "?**";
    } else if (action.reason && action.reason !== "No reason provided") {
      promptText = "> **Are you sure you want to ban <@" + action.targetId + ">?**\n> **Reason:** " + action.reason;
    } else {
      promptText = "> **Are you sure you want to ban <@" + action.targetId + ">?**";
    }
  } else {
    if (action.reason && action.reason !== "No reason provided") {
      promptText = "> **Are you sure you want to unban <@" + action.targetId + ">?**\n> **Reason:** " + action.reason;
    } else {
      promptText = "> **Are you sure you want to unban <@" + action.targetId + ">?**";
    }
  }

  return {
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [
          {
            type: 10,
            content: promptText
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                style: action.type === "ban" ? 4 : 3,
                label: "Confirm",
                custom_id: "ban_confirm_" + actionId
              },
              {
                type: 2,
                style: 2,
                label: "Cancel",
                custom_id: "ban_cancel_" + actionId
              }
            ]
          }
        ]
      }
    ]
  };
}

function checkAutoUnbans(ctx) {
  if (!ctx || !ctx.storage || !ctx.guildId) return;
  const list = ctx.storage.get("tempbans_" + ctx.guildId, []);
  if (!Array.isArray(list) || !list.length) return;
  const now = Date.now();
  const remaining = [];
  list.forEach(function (entry) {
    if (entry && entry.targetId && entry.unbanAt) {
      if (now >= entry.unbanAt) {
        if (typeof ctx.unbanMember === "function") {
          ctx.unbanMember(ctx.guildId, entry.targetId);
        }
      } else {
        remaining.push(entry);
      }
    }
  });
  if (remaining.length !== list.length) {
    ctx.storage.set("tempbans_" + ctx.guildId, remaining);
  }
}

function initiateModeration(ctx, type, targetId, duration, reason) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used inside a server.");
  }

  if (!hasBanPermission(ctx)) {
    return ctx.replyWarn("You need Ban Members permission to use this command.");
  }

  if (!targetId) {
    return ctx.replyWarn("Please mention a user, provide a user ID, or reply to a user's message.");
  }

  const executorId = ctx.user && ctx.user.id;
  if (targetId === executorId) {
    return ctx.replyWarn("You cannot ban yourself.");
  }

  if (targetId === ctx.botId) {
    return ctx.replyWarn("I cannot ban myself.");
  }

  if (ctx.guildOwnerId && targetId === String(ctx.guildOwnerId)) {
    return ctx.replyWarn("You cannot ban the server owner.");
  }

  function sendConfirmationPrompt() {
    cleanExpiredActions();

    const actionId = crypto.randomBytes(8).toString("hex");
    const action = {
      actionId: actionId,
      type: type,
      targetId: targetId,
      guildId: ctx.guildId,
      authorId: executorId,
      timeMs: duration ? duration.ms : 0,
      timeLabel: duration ? duration.label : null,
      reason: reason || "No reason provided",
      channelId: ctx.channelId,
      createdAt: Date.now()
    };

    getPendingActions()[actionId] = action;

    const accentColor = resolveAccentColor(ctx);
    const payload = buildPromptCard(actionId, action, accentColor);

    if (typeof ctx.reply === "function") {
      return ctx.reply(payload);
    }
    return ctx.sendChannel(ctx.channelId, payload);
  }

  if (type === "unban") {
    if (typeof ctx.fetchBan === "function") {
      return ctx.fetchBan(ctx.guildId, targetId).then(function (banRes) {
        if (banRes && banRes.status === 404) {
          return ctx.replyWarn("User <@" + targetId + "> is not banned.");
        }
        return sendConfirmationPrompt();
      }).catch(function () {
        return sendConfirmationPrompt();
      });
    }
    return sendConfirmationPrompt();
  }

  const targetMemberPromise = (typeof ctx.fetchMember === "function")
    ? ctx.fetchMember(ctx.guildId, targetId)
    : Promise.resolve(null);

  const botMemberPromise = (typeof ctx.fetchMember === "function" && ctx.botId)
    ? ctx.fetchMember(ctx.guildId, ctx.botId)
    : Promise.resolve(null);

  const rolesPromise = (typeof ctx.fetchRoles === "function")
    ? ctx.fetchRoles(ctx.guildId)
    : Promise.resolve(null);

  return Promise.all([targetMemberPromise, botMemberPromise, rolesPromise]).then(function (results) {
    const targetRes = results[0];
    const botRes = results[1];
    const rolesList = results[2];

    const targetMember = (targetRes && targetRes.status === 200 && targetRes.body) ? targetRes.body : null;
    const botMember = (botRes && botRes.status === 200 && botRes.body) ? botRes.body : null;
    const roles = Array.isArray(rolesList) ? rolesList : ((rolesList && Array.isArray(rolesList.body)) ? rolesList.body : []);

    if (targetMember && roles.length) {
      const rolePosMap = {};
      roles.forEach(function (r) {
        if (r && r.id) {
          rolePosMap[r.id] = Number(r.position) || 0;
        }
      });

      const targetRoles = Array.isArray(targetMember.roles) ? targetMember.roles : [];
      let targetMaxPos = 0;
      targetRoles.forEach(function (rid) {
        const pos = rolePosMap[rid] || 0;
        if (pos > targetMaxPos) targetMaxPos = pos;
      });

      if (botMember) {
        const botRoles = Array.isArray(botMember.roles) ? botMember.roles : [];
        let botMaxPos = 0;
        botRoles.forEach(function (rid) {
          const pos = rolePosMap[rid] || 0;
          if (pos > botMaxPos) botMaxPos = pos;
        });

        if (targetMaxPos >= botMaxPos) {
          return ctx.replyWarn("I cannot ban <@" + targetId + "> because their role is higher than or equal to my role.");
        }
      }

      const isModOwner = ctx.isServerOwner === true || (ctx.guildOwnerId && String(ctx.guildOwnerId) === String(executorId));
      if (!isModOwner && ctx.member) {
        const modRoles = Array.isArray(ctx.member.roles) ? ctx.member.roles : [];
        let modMaxPos = 0;
        modRoles.forEach(function (rid) {
          const pos = rolePosMap[rid] || 0;
          if (pos > modMaxPos) modMaxPos = pos;
        });

        if (targetMaxPos >= modMaxPos) {
          return ctx.replyWarn("You cannot ban <@" + targetId + "> because their role is higher than or equal to your role.");
        }
      }
    }

    return sendConfirmationPrompt();
  }).catch(function () {
    return sendConfirmationPrompt();
  });
}

module.exports = {
  commands: [
    {
      name: "ban",
      description: "Ban a member from the server with confirmation protection",
      slash: true,
      prefix: true,
      cooldown: 5,
      options: [
        {
          type: 6,
          name: "user",
          description: "Target member to ban",
          required: true
        },
        {
          type: 3,
          name: "time",
          description: "Duration (e.g. 30m, 2h, 7d, 1w) or leave empty for permanent ban",
          required: false
        },
        {
          type: 3,
          name: "reason",
          description: "Reason for the ban",
          required: false
        }
      ]
    },
    {
      name: "unban",
      description: "Unban a user from the server with confirmation protection",
      slash: true,
      prefix: true,
      cooldown: 5,
      options: [
        {
          type: 3,
          name: "user",
          description: "Target user ID to unban",
          required: true
        },
        {
          type: 3,
          name: "reason",
          description: "Reason for the unban",
          required: false
        }
      ]
    }
  ],

  onCommand: function (ctx) {
    checkAutoUnbans(ctx);
    const cmdName = String(ctx.command || "").toLowerCase();
    const opts = ctx.options || {};
    const rawArgs = Array.isArray(ctx.rawArgs) ? ctx.rawArgs : [];
    const msgData = ctx.data || {};
    const mid = msgData.id;
    if (mid) {
      const dedupeKey = (ctx.botId || "bot") + ":" + mid;
      getProcessedMessages().set(dedupeKey, Date.now());
    }

    if (cmdName === "unban") {
      let targetId = null;
      let reason = "";

      if (opts.user) {
        targetId = typeof opts.user === "object" ? (opts.user.id || parseUserId(opts.user.query)) : parseUserId(String(opts.user));
      }
      if (!targetId && rawArgs[0]) {
        targetId = parseUserId(rawArgs[0]);
      }

      if (opts.reason) {
        reason = String(opts.reason).trim();
      } else if (rawArgs.length > 1) {
        reason = rawArgs.slice(1).join(" ").trim();
      }

      return initiateModeration(ctx, "unban", targetId, null, reason);
    }

    let targetId = null;
    let duration = null;
    let reason = "";
    let argsStartIdx = 0;

    const isReply = msgData.message_reference && (msgData.referenced_message || msgData.message_reference.message_id);
    if (isReply && msgData.referenced_message && msgData.referenced_message.author) {
      targetId = msgData.referenced_message.author.id;
    }

    if (!targetId && opts.user) {
      targetId = typeof opts.user === "object" ? (opts.user.id || parseUserId(opts.user.query)) : parseUserId(String(opts.user));
    }

    if (rawArgs.length > 0) {
      const parsedFirst = parseUserId(rawArgs[0]);
      if (parsedFirst) {
        if (!targetId) {
          targetId = parsedFirst;
        }
        if (targetId === parsedFirst) {
          argsStartIdx = 1;
        }
      }
    }

    const remainingArgs = rawArgs.slice(argsStartIdx);

    if (remainingArgs.length > 0) {
      const possibleTime = parseDuration(remainingArgs[0]);
      if (possibleTime) {
        duration = possibleTime;
        reason = remainingArgs.slice(1).join(" ").trim();
      } else {
        reason = remainingArgs.join(" ").trim();
      }
    }

    if (!duration && opts.time) {
      duration = parseDuration(String(opts.time));
    }

    if (!reason && opts.reason) {
      reason = String(opts.reason).trim();
    }

    if (!targetId && isReply && msgData.message_reference && msgData.message_reference.message_id && typeof ctx.fetchMessage === "function") {
      return ctx.fetchMessage(ctx.channelId, msgData.message_reference.message_id).then(function (fetched) {
        if (fetched && fetched.author) {
          targetId = fetched.author.id;
        }
        return initiateModeration(ctx, "ban", targetId, duration, reason);
      }).catch(function () {
        return ctx.replyWarn("Could not find the replied message to ban.");
      });
    }

    return initiateModeration(ctx, "ban", targetId, duration, reason);
  },

  buttons: {
    "ban_confirm_*": function (ctx) {
      return module.exports.onButton(ctx);
    },
    "ban_cancel_*": function (ctx) {
      return module.exports.onButton(ctx);
    }
  },

  onButton: function (ctx) {
    const customId = String(ctx.customId || "");
    let actionId = "";
    let isConfirm = false;
    let isCancel = false;

    if (customId.startsWith("ban_confirm_")) {
      actionId = customId.slice("ban_confirm_".length);
      isConfirm = true;
    } else if (customId.startsWith("ban_cancel_")) {
      actionId = customId.slice("ban_cancel_".length);
      isCancel = true;
    } else {
      return false;
    }

    cleanExpiredActions();
    const actions = getPendingActions();
    const action = actions[actionId];
    if (!action) {
      if (customId.startsWith("ban_confirm_") || customId.startsWith("ban_cancel_")) {
        return ctx.replyWarn("This confirmation has expired.");
      }
      return false;
    }
    if (Date.now() - action.createdAt > ACTION_EXPIRE_MS) {
      delete actions[actionId];
      return ctx.replyWarn("This confirmation has expired.");
    }

    const currentUserId = ctx.user && ctx.user.id;
    if (currentUserId !== action.authorId) {
      return ctx.replyWarn("Only the moderator who ran this command can use these buttons.");
    }

    const mid = (ctx.data && ctx.data.message && ctx.data.message.id) || ctx.messageId;

    if (isCancel) {
      delete actions[actionId];
      if (typeof ctx.deferUpdate === "function") {
        ctx.deferUpdate();
      }
      if (typeof ctx.deleteReply === "function") {
        ctx.deleteReply();
      }
      if (mid && typeof ctx.deleteMessage === "function") {
        ctx.deleteMessage(ctx.channelId, mid);
      }
      return;
    }

    if (isConfirm) {
      delete actions[actionId];
      const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
      const accentColor = resolveAccentColor(ctx);
      const warningColor = resolveWarningColor(ctx);
      const errorColor = resolveErrorColor(ctx);

      if (action.type === "ban") {
        const banPromise = (typeof ctx.banMember === "function")
          ? ctx.banMember(action.guildId, action.targetId, { reason: action.reason })
          : Promise.resolve({ status: 204 });

        return banPromise.then(function (res) {
          const status = res && typeof res.status === "number" ? res.status : 204;
          const body = (res && res.body) || {};

          if (status === 403) {
            if (body && body.code === 50013) {
              const warnPayload = buildAlertCard("> ⚠️ **I cannot ban <@" + action.targetId + "> because their role is higher than or equal to my role.**", warningColor);
              return sendV2Update(ctx, mid, warnPayload);
            }
            const warnPayload = buildAlertCard("> ⚠️ **I do not have permission to ban <@" + action.targetId + "> in this server.**", warningColor);
            return sendV2Update(ctx, mid, warnPayload);
          }

          if (status === 404) {
            const warnPayload = buildAlertCard("> ⚠️ **User <@" + action.targetId + "> was not found.**", warningColor);
            return sendV2Update(ctx, mid, warnPayload);
          }

          if (status >= 400) {
            const errMsg = (body && body.message) || "Unknown error";
            const errPayload = buildAlertCard("> ❌ **Failed to ban member: " + errMsg + "**", errorColor);
            return sendV2Update(ctx, mid, errPayload);
          }

          if (action.timeMs > 0 && ctx.storage) {
            const list = ctx.storage.get("tempbans_" + action.guildId, []);
            list.push({
              targetId: action.targetId,
              guildId: action.guildId,
              unbanAt: Date.now() + action.timeMs
            });
            ctx.storage.set("tempbans_" + action.guildId, list);
          }

          const emoji = resolveEmoji(cfg.emoji_ban, "✅");
          let messageText = "> " + emoji + " **Successfully banned <@" + action.targetId + ">**";
          if (action.timeLabel && action.reason && action.reason !== "No reason provided") {
            messageText = "> " + emoji + " **Successfully banned <@" + action.targetId + "> for " + action.timeLabel + " | " + action.reason + "**";
          } else if (action.timeLabel) {
            messageText = "> " + emoji + " **Successfully banned <@" + action.targetId + "> for " + action.timeLabel + "**";
          } else if (action.reason && action.reason !== "No reason provided") {
            messageText = "> " + emoji + " **Successfully banned <@" + action.targetId + "> | " + action.reason + "**";
          }

          const resultPayload = buildAlertCard(messageText, accentColor);
          return sendV2Update(ctx, mid, resultPayload);
        }).catch(function (err) {
          const errMsg = (err && err.message) || "Unknown error";
          const errPayload = buildAlertCard("> ❌ **Failed to ban member: " + errMsg + "**", errorColor);
          return sendV2Update(ctx, mid, errPayload);
        });
      }

      if (action.type === "unban") {
        const unbanPromise = (typeof ctx.unbanMember === "function")
          ? ctx.unbanMember(action.guildId, action.targetId)
          : Promise.resolve({ status: 204 });

        return unbanPromise.then(function (res) {
          const status = res && typeof res.status === "number" ? res.status : 204;
          const body = (res && res.body) || {};

          if (status === 404) {
            const warnPayload = buildAlertCard("> ⚠️ **User <@" + action.targetId + "> is not banned.**", warningColor);
            return sendV2Update(ctx, mid, warnPayload);
          }

          if (status === 403) {
            const warnPayload = buildAlertCard("> ⚠️ **I do not have permission to unban <@" + action.targetId + "> in this server.**", warningColor);
            return sendV2Update(ctx, mid, warnPayload);
          }

          if (status >= 400) {
            const errMsg = (body && body.message) || "Unknown error";
            const errPayload = buildAlertCard("> ❌ **Failed to unban member: " + errMsg + "**", errorColor);
            return sendV2Update(ctx, mid, errPayload);
          }

          if (ctx.storage) {
            const list = ctx.storage.get("tempbans_" + action.guildId, []);
            const filtered = list.filter(function (e) { return e && e.targetId !== action.targetId; });
            ctx.storage.set("tempbans_" + action.guildId, filtered);
          }

          const emoji = resolveEmoji(cfg.emoji_unban, "✅");
          let messageText = "> " + emoji + " **Successfully unbanned <@" + action.targetId + ">**";
          if (action.reason && action.reason !== "No reason provided") {
            messageText = "> " + emoji + " **Successfully unbanned <@" + action.targetId + "> | " + action.reason + "**";
          }

          const resultPayload = buildAlertCard(messageText, accentColor);
          return sendV2Update(ctx, mid, resultPayload);
        }).catch(function (err) {
          const errMsg = (err && err.message) || "Unknown error";
          const errPayload = buildAlertCard("> ❌ **Failed to unban member: " + errMsg + "**", errorColor);
          return sendV2Update(ctx, mid, errPayload);
        });
      }
    }
  },

  events: {
    MESSAGE_CREATE: function (ctx) {
      checkAutoUnbans(ctx);
      const data = ctx.data;
      if (!data || (data.author && data.author.bot)) return;

      const mid = data.id;
      const dedupeKey = (ctx.botId || "bot") + ":" + mid;
      if (mid && getProcessedMessages().has(dedupeKey)) {
        return;
      }

      const content = String(data.content || "").trim();
      if (!content) return;

      const guildId = ctx.guildId;
      let matchedPrefix = null;

      let customPrefix = null;
      if (ctx.storage && guildId) {
        customPrefix = ctx.storage.get("prefix_" + guildId, null);
      }

      const botId = ctx.botId;
      if (botId) {
        const mentionRegex = new RegExp("^<@!?" + botId + ">(\\s+|$)", "i");
        const match = content.match(mentionRegex);
        if (match) {
          matchedPrefix = match[0];
        }
      }

      if (!matchedPrefix && customPrefix) {
        const cp = String(customPrefix).trim();
        if (cp && content.toLowerCase().startsWith(cp.toLowerCase())) {
          matchedPrefix = content.slice(0, cp.length);
        }
      }

      if (!matchedPrefix && content.startsWith("!")) {
        matchedPrefix = "!";
      }

      if (!matchedPrefix) return;

      const commandBody = content.slice(matchedPrefix.length).trim();
      if (!commandBody) return;

      const parts = commandBody.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const rawArgs = parts.slice(1);

      if (cmd !== "ban" && cmd !== "unban") return;

      if (mid) {
        getProcessedMessages().set(dedupeKey, Date.now());
      }

      ctx.command = cmd;
      ctx.rawArgs = rawArgs;
      ctx.options = {};
      return module.exports.onCommand(ctx);
    }
  }
};
