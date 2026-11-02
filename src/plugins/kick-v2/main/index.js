const crypto = require("crypto");

const ACTION_EXPIRE_MS = 120000;

function getPendingActions() {
  if (!global.__arixa_kick_actions) {
    global.__arixa_kick_actions = {};
  }
  return global.__arixa_kick_actions;
}

function getProcessedMessages() {
  if (!global.__arixa_kick_processed) {
    global.__arixa_kick_processed = new Map();
  }
  return global.__arixa_kick_processed;
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

function hasKickPermission(ctx) {
  if (ctx.isServerOwner === true) return true;
  const uid = ctx.user && ctx.user.id;
  if (uid && ctx.guildOwnerId && String(ctx.guildOwnerId) === String(uid)) return true;
  if (typeof ctx.hasPermission === "function") {
    return ctx.hasPermission("KICK_MEMBERS") || ctx.hasPermission("ADMINISTRATOR");
  }
  if (!ctx.member || !ctx.member.permissions) return false;
  try {
    const p = BigInt(ctx.member.permissions);
    return (p & 2n) === 2n || (p & 8n) === 8n;
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
  let promptText = "> **Are you sure you want to kick <@" + action.targetId + ">?**";
  if (action.reason && action.reason !== "No reason provided") {
    promptText += "\n> **Reason:** " + action.reason;
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
                style: 4,
                label: "Confirm",
                custom_id: "kick_confirm_" + actionId
              },
              {
                type: 2,
                style: 2,
                label: "Cancel",
                custom_id: "kick_cancel_" + actionId
              }
            ]
          }
        ]
      }
    ]
  };
}

function initiateModeration(ctx, type, targetId, reason) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used inside a server.");
  }

  if (!hasKickPermission(ctx)) {
    return ctx.replyWarn("You need Kick Members permission to use this command.");
  }

  if (!targetId) {
    return ctx.replyWarn("Please mention a user, provide a user ID, or reply to a user's message.");
  }

  const executorId = ctx.user && ctx.user.id;
  if (targetId === executorId) {
    return ctx.replyWarn("You cannot kick yourself.");
  }

  if (targetId === ctx.botId) {
    return ctx.replyWarn("I cannot kick myself.");
  }

  if (ctx.guildOwnerId && targetId === String(ctx.guildOwnerId)) {
    return ctx.replyWarn("You cannot kick the server owner.");
  }

  function sendConfirmationPrompt() {
    cleanExpiredActions();

    const actionId = crypto.randomBytes(8).toString("hex");
    const action = {
      actionId: actionId,
      type: "kick",
      targetId: targetId,
      guildId: ctx.guildId,
      authorId: executorId,
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

    if (!targetMember) {
      return ctx.replyWarn("User <@" + targetId + "> is not in this server.");
    }

    if (roles.length) {
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
          return ctx.replyWarn("I cannot kick <@" + targetId + "> because their role is higher than or equal to my role.");
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
          return ctx.replyWarn("You cannot kick <@" + targetId + "> because their role is higher than or equal to your role.");
        }
      }
    }

    return sendConfirmationPrompt();
  }).catch(function () {
    return sendConfirmationPrompt();
  });
}

function handleKickButton(ctx) {
  const customId = String(ctx.customId || "");
  let actionId = "";
  let isConfirm = false;
  let isCancel = false;

  if (customId.startsWith("kick_confirm_")) {
    actionId = customId.slice("kick_confirm_".length);
    isConfirm = true;
  } else if (customId.startsWith("kick_cancel_")) {
    actionId = customId.slice("kick_cancel_".length);
    isCancel = true;
  } else {
    return false;
  }

  cleanExpiredActions();
  const actions = getPendingActions();
  const action = actions[actionId];
  if (!action) {
    if (customId.startsWith("kick_confirm_") || customId.startsWith("kick_cancel_")) {
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
    return true;
  }

  if (isConfirm) {
    delete actions[actionId];
    const cfg = (ctx.config && typeof ctx.config === "object") ? ctx.config : {};
    const accentColor = resolveAccentColor(ctx);
    const warningColor = resolveWarningColor(ctx);
    const errorColor = resolveErrorColor(ctx);

    const kickPromise = (typeof ctx.kickMember === "function")
      ? ctx.kickMember(action.guildId, action.targetId, { reason: action.reason })
      : (typeof ctx.request === "function"
        ? ctx.request("DELETE", "/guilds/" + action.guildId + "/members/" + action.targetId, null, {
          "X-Audit-Log-Reason": encodeURIComponent(action.reason)
        })
        : Promise.resolve({ status: 204 }));

    return kickPromise.then(function (res) {
      const status = res && typeof res.status === "number" ? res.status : 204;
      const body = (res && res.body) || {};

      if (status === 403) {
        if (body && body.code === 50013) {
          const warnPayload = buildAlertCard("> ⚠️ **I cannot kick <@" + action.targetId + "> because their role is higher than or equal to my role.**", warningColor);
          return sendV2Update(ctx, mid, warnPayload);
        }
        const warnPayload = buildAlertCard("> ⚠️ **I do not have permission to kick <@" + action.targetId + "> in this server.**", warningColor);
        return sendV2Update(ctx, mid, warnPayload);
      }

      if (status === 404) {
        const warnPayload = buildAlertCard("> ⚠️ **User <@" + action.targetId + "> is not in this server.**", warningColor);
        return sendV2Update(ctx, mid, warnPayload);
      }

      if (status >= 400) {
        const errMsg = (body && body.message) || "Unknown error";
        const errPayload = buildAlertCard("> ❌ **Failed to kick member: " + errMsg + "**", errorColor);
        return sendV2Update(ctx, mid, errPayload);
      }

      const emoji = resolveEmoji(cfg.emoji_kick, "✅");
      let messageText = "> " + emoji + " **Successfully kicked <@" + action.targetId + ">**";
      if (action.reason && action.reason !== "No reason provided") {
        messageText = "> " + emoji + " **Successfully kicked <@" + action.targetId + "> | " + action.reason + "**";
      }

      const resultPayload = buildAlertCard(messageText, accentColor);
      return sendV2Update(ctx, mid, resultPayload);
    }).catch(function (err) {
      const errMsg = (err && err.message) || "Unknown error";
      const errPayload = buildAlertCard("> ❌ **Failed to kick member: " + errMsg + "**", errorColor);
      return sendV2Update(ctx, mid, errPayload);
    });
  }
}

module.exports = {
  commands: [
    {
      name: "kick",
      description: "Kick a member from the server with confirmation protection",
      slash: true,
      prefix: true,
      cooldown: 5,
      options: [
        {
          type: 6,
          name: "user",
          description: "Target member to kick",
          required: true
        },
        {
          type: 3,
          name: "reason",
          description: "Reason for the kick",
          required: false
        }
      ]
    }
  ],

  onCommand: function (ctx) {
    const cmdName = String(ctx.command || "").toLowerCase();
    const opts = ctx.options || {};
    const rawArgs = Array.isArray(ctx.rawArgs) ? ctx.rawArgs : [];
    const msgData = ctx.data || {};
    const mid = msgData.id;
    if (mid) {
      const dedupeKey = (ctx.botId || "bot") + ":" + mid;
      getProcessedMessages().set(dedupeKey, Date.now());
    }

    if (cmdName !== "kick") return;

    let targetId = null;
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
      reason = remainingArgs.join(" ").trim();
    }

    if (!reason && opts.reason) {
      reason = String(opts.reason).trim();
    }

    if (!targetId && isReply && msgData.message_reference && msgData.message_reference.message_id && typeof ctx.fetchMessage === "function") {
      return ctx.fetchMessage(ctx.channelId, msgData.message_reference.message_id).then(function (fetched) {
        if (fetched && fetched.author) {
          targetId = fetched.author.id;
        }
        return initiateModeration(ctx, "kick", targetId, reason);
      }).catch(function () {
        return ctx.replyWarn("Could not find the replied message to kick.");
      });
    }

    return initiateModeration(ctx, "kick", targetId, reason);
  },

  buttons: {
    "kick_confirm_*": function (ctx) {
      return handleKickButton(ctx);
    },
    "kick_cancel_*": function (ctx) {
      return handleKickButton(ctx);
    }
  },

  onButton: function (ctx) {
    return handleKickButton(ctx);
  },

  events: {
    MESSAGE_CREATE: function (ctx) {
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

      if (cmd !== "kick") return;

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
