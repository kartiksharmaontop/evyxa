const crypto = require("crypto");

function getPendingActions() {
  if (!global.__arixa_purge_pending_actions) {
    global.__arixa_purge_pending_actions = {};
  }
  return global.__arixa_purge_pending_actions;
}

function getProcessedMessages() {
  if (!global.__arixa_purge_processed_messages) {
    global.__arixa_purge_processed_messages = new Map();
  }
  return global.__arixa_purge_processed_messages;
}

const ACTION_EXPIRE_MS = 60000;

function cleanExpiredActions() {
  const actions = getPendingActions();
  const now = Date.now();
  Object.keys(actions).forEach(function (id) {
    if (!actions[id] || (now - actions[id].createdAt > ACTION_EXPIRE_MS)) {
      delete actions[id];
    }
  });

  const processed = getProcessedMessages();
  if (processed.size > 200) {
    for (const [key, time] of processed.entries()) {
      if (now - time > 60000) {
        processed.delete(key);
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

function buildAlertCard(message, accentColor, deleteAfter) {
  const payload = {
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
  if (typeof deleteAfter === "number" && deleteAfter > 0) {
    payload.deleteAfter = deleteAfter;
  }
  return payload;
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

function hasPurgePermission(ctx) {
  if (ctx.isServerOwner === true) return true;
  const uid = ctx.user && ctx.user.id;
  if (uid && ctx.guildOwnerId && String(ctx.guildOwnerId) === String(uid)) return true;
  if (typeof ctx.hasPermission === "function") {
    return ctx.hasPermission("MANAGE_MESSAGES") || ctx.hasPermission("ADMINISTRATOR");
  }
  if (!ctx.member || !ctx.member.permissions) return false;
  try {
    const p = BigInt(ctx.member.permissions);
    return (p & (1n << 13n)) === (1n << 13n) || (p & 8n) === 8n;
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
  let promptText = "> **Are you sure you want to purge " + action.amount + " messages in this channel?**";
  if (action.targetId) {
    promptText = "> **Are you sure you want to purge " + action.amount + " messages from <@" + action.targetId + "> in this channel?**";
  } else if (action.filterBot) {
    promptText = "> **Are you sure you want to purge " + action.amount + " bot messages in this channel?**";
  } else if (action.filterHuman) {
    promptText = "> **Are you sure you want to purge " + action.amount + " human messages in this channel?**";
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
                custom_id: "purge_confirm_" + actionId
              },
              {
                type: 2,
                style: 2,
                label: "Cancel",
                custom_id: "purge_cancel_" + actionId
              }
            ]
          }
        ]
      }
    ]
  };
}

function initiatePurge(ctx, amount, targetId, filterBot, filterHuman, commandMessageId) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used inside a server.");
  }

  if (!hasPurgePermission(ctx)) {
    return ctx.replyWarn("You need Manage Messages permission to use this command.");
  }

  const parsedAmount = parseInt(amount, 10);
  if (isNaN(parsedAmount) || parsedAmount < 1 || parsedAmount > 100) {
    return ctx.replyWarn("Please provide a valid number of messages to purge (1 to 100).");
  }

  cleanExpiredActions();

  const actionId = crypto.randomBytes(8).toString("hex");
  const action = {
    actionId: actionId,
    amount: parsedAmount,
    targetId: targetId || null,
    filterBot: Boolean(filterBot),
    filterHuman: Boolean(filterHuman),
    guildId: ctx.guildId,
    channelId: ctx.channelId,
    authorId: ctx.user && ctx.user.id,
    commandMessageId: commandMessageId || null,
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

function handlePurgeButton(ctx) {
  const customId = String(ctx.customId || "");
  let actionId = "";
  let isConfirm = false;
  let isCancel = false;

  if (customId.startsWith("purge_confirm_")) {
    actionId = customId.slice("purge_confirm_".length);
    isConfirm = true;
  } else if (customId.startsWith("purge_cancel_")) {
    actionId = customId.slice("purge_cancel_".length);
    isCancel = true;
  } else {
    return false;
  }

  cleanExpiredActions();
  const actions = getPendingActions();
  const action = actions[actionId];
  if (!action) {
    if (customId.startsWith("purge_confirm_") || customId.startsWith("purge_cancel_")) {
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

    const fetchLimit = (action.targetId || action.filterBot || action.filterHuman) ? 100 : Math.min(action.amount + 5, 100);
    const fetchPath = "/channels/" + action.channelId + "/messages?limit=" + fetchLimit;

    const requestFn = (typeof ctx.discordRequest === "function")
      ? ctx.discordRequest
      : (typeof ctx.request === "function" ? ctx.request : null);

    if (!requestFn) {
      const errPayload = buildAlertCard("> ❌ **Unable to access Discord API.**", errorColor, 5000);
      return sendV2Update(ctx, mid, errPayload);
    }

    return requestFn("GET", fetchPath).then(function (res) {
      const fetchedList = Array.isArray(res && res.body) ? res.body : (Array.isArray(res) ? res : []);
      const now = Date.now();
      const maxAgeMs = 14 * 24 * 60 * 60 * 1000 - 60000;
      const messagesToDelete = [];

      for (let i = 0; i < fetchedList.length; i++) {
        const m = fetchedList[i];
        if (!m || !m.id) continue;
        if (mid && m.id === mid) continue;
        if (action.commandMessageId && m.id === action.commandMessageId) continue;

        const msgCreatedAt = new Date(m.timestamp).getTime();
        if (now - msgCreatedAt >= maxAgeMs) continue;

        if (action.targetId && (!m.author || m.author.id !== action.targetId)) continue;
        if (action.filterBot && (!m.author || !m.author.bot)) continue;
        if (action.filterHuman && m.author && m.author.bot) continue;

        messagesToDelete.push(m.id);
        if (messagesToDelete.length >= action.amount) break;
      }

      if (action.commandMessageId && !messagesToDelete.includes(action.commandMessageId)) {
        messagesToDelete.push(action.commandMessageId);
      }

      if (messagesToDelete.length === 0) {
        const warnPayload = buildAlertCard("> ⚠️ **No messages found within the last 14 days matching the filter.**", warningColor, 5000);
        const updateRes = sendV2Update(ctx, mid, warnPayload);
        setTimeout(function () {
          if (mid && typeof ctx.deleteMessage === "function") {
            ctx.deleteMessage(ctx.channelId, mid);
          } else if (typeof ctx.deleteReply === "function") {
            ctx.deleteReply();
          }
        }, 5000);
        return updateRes;
      }

      let deletePromise;
      if (messagesToDelete.length >= 2) {
        deletePromise = requestFn("POST", "/channels/" + action.channelId + "/messages/bulk-delete", {
          messages: messagesToDelete
        });
      } else {
        deletePromise = requestFn("DELETE", "/channels/" + action.channelId + "/messages/" + messagesToDelete[0]);
      }

      return deletePromise.then(function (delRes) {
        const status = delRes && typeof delRes.status === "number" ? delRes.status : 204;
        const body = (delRes && delRes.body) || {};

        if (status === 403) {
          const warnPayload = buildAlertCard("> ⚠️ **I do not have permission to manage messages in this channel.**", warningColor, 5000);
          return sendV2Update(ctx, mid, warnPayload);
        }

        if (status >= 400) {
          const errMsg = (body && body.message) || "Unknown error";
          const errPayload = buildAlertCard("> ❌ **Failed to purge messages: " + errMsg + "**", errorColor, 5000);
          return sendV2Update(ctx, mid, errPayload);
        }

        const emoji = resolveEmoji(cfg.emoji_purge, "🧹");
        const count = action.commandMessageId ? Math.max(1, messagesToDelete.length - 1) : messagesToDelete.length;

        let messageText = "> " + emoji + " **Successfully purged " + count + " message" + (count === 1 ? "" : "s") + ".**";
        if (action.targetId) {
          messageText = "> " + emoji + " **Successfully purged " + count + " message" + (count === 1 ? "" : "s") + " from <@" + action.targetId + ">.**";
        } else if (action.filterBot) {
          messageText = "> " + emoji + " **Successfully purged " + count + " bot message" + (count === 1 ? "" : "s") + ".**";
        } else if (action.filterHuman) {
          messageText = "> " + emoji + " **Successfully purged " + count + " human message" + (count === 1 ? "" : "s") + ".**";
        }

        const resultPayload = buildAlertCard(messageText, accentColor, 5000);
        const updateRes = sendV2Update(ctx, mid, resultPayload);

        setTimeout(function () {
          if (mid && typeof ctx.deleteMessage === "function") {
            ctx.deleteMessage(ctx.channelId, mid);
          } else if (typeof ctx.deleteReply === "function") {
            ctx.deleteReply();
          }
        }, 5000);

        return updateRes;
      }).catch(function (err) {
        const errMsg = (err && err.message) || "Unknown error";
        const errPayload = buildAlertCard("> ❌ **Failed to purge messages: " + errMsg + "**", errorColor, 5000);
        return sendV2Update(ctx, mid, errPayload);
      });
    }).catch(function (err) {
      const errMsg = (err && err.message) || "Unknown error";
      const errPayload = buildAlertCard("> ❌ **Failed to fetch channel messages: " + errMsg + "**", errorColor, 5000);
      return sendV2Update(ctx, mid, errPayload);
    });
  }
}

module.exports = {
  commands: [
    {
      name: "purge",
      description: "Bulk delete messages from the channel with confirmation protection",
      slash: true,
      prefix: true,
      aliases: ["clear", "clean", "prune"],
      cooldown: 5,
      options: [
        {
          type: 4,
          name: "amount",
          description: "Number of messages to delete (1-100)",
          required: true,
          min_value: 1,
          max_value: 100
        },
        {
          type: 6,
          name: "target",
          description: "Only delete messages from this user",
          required: false
        },
        {
          type: 5,
          name: "bot",
          description: "Only delete messages sent by bots",
          required: false
        },
        {
          type: 5,
          name: "human",
          description: "Only delete messages sent by human users",
          required: false
        }
      ]
    }
  ],

  onCommand: function (ctx) {
    const cmdName = String(ctx.command || "").toLowerCase();
    const opts = ctx.options || {};
    const rawArgs = Array.isArray(ctx.rawArgs) ? ctx.rawArgs : [];
    const msgData = ctx.data || (ctx.message && ctx.message.data) || {};
    const mid = msgData.id;
    if (mid) {
      const dedupeKey = (ctx.botId || "bot") + ":" + mid;
      getProcessedMessages().set(dedupeKey, Date.now());
    }

    if (cmdName !== "purge" && cmdName !== "clear" && cmdName !== "clean" && cmdName !== "prune") {
      return;
    }

    let amount = opts.amount;
    let targetId = null;
    let filterBot = opts.bot === true;
    let filterHuman = opts.human === true;

    if (opts.target) {
      targetId = typeof opts.target === "object" ? (opts.target.id || parseUserId(opts.target.query)) : parseUserId(String(opts.target));
    }

    const isReply = msgData.message_reference && (msgData.referenced_message || msgData.message_reference.message_id);
    let replyAuthorId = null;
    if (isReply && msgData.referenced_message && msgData.referenced_message.author) {
      replyAuthorId = msgData.referenced_message.author.id;
    }

    if (amount === undefined && rawArgs.length > 0) {
      for (let i = 0; i < rawArgs.length; i++) {
        const arg = String(rawArgs[i]).trim().toLowerCase();
        const num = parseInt(arg, 10);
        if (!isNaN(num) && amount === undefined) {
          amount = num;
          continue;
        }

        const parsedUser = parseUserId(arg);
        if (parsedUser && !targetId) {
          targetId = parsedUser;
          continue;
        }

        if ((arg === "bot" || arg === "bots") && !filterBot) {
          filterBot = true;
          continue;
        }

        if ((arg === "human" || arg === "humans" || arg === "user" || arg === "users") && !filterHuman) {
          filterHuman = true;
          continue;
        }
      }
    }

    if (!targetId && replyAuthorId) {
      targetId = replyAuthorId;
    }

    if (amount === undefined) {
      return ctx.replyWarn("Please provide a valid number of messages to purge (1 to 100).");
    }

    const commandMessageId = (ctx.channelId && mid && !ctx.interaction) ? mid : null;
    return initiatePurge(ctx, amount, targetId, filterBot, filterHuman, commandMessageId);
  },

  buttons: {
    "purge_confirm_*": function (ctx) {
      return handlePurgeButton(ctx);
    },
    "purge_cancel_*": function (ctx) {
      return handlePurgeButton(ctx);
    }
  },

  onButton: function (ctx) {
    return handlePurgeButton(ctx);
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
      } else if (!matchedPrefix && content.startsWith("+")) {
        matchedPrefix = "+";
      }

      if (!matchedPrefix) return;

      const commandBody = content.slice(matchedPrefix.length).trim();
      if (!commandBody) return;

      const parts = commandBody.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const rawArgs = parts.slice(1);

      if (cmd !== "purge" && cmd !== "clear" && cmd !== "clean" && cmd !== "prune") {
        return;
      }

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
