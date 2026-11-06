"use strict";

const SAFE_NO_PING = { allowed_mentions: { parse: [] } };

function getUser(ctx) {
  return (ctx && (ctx.user || ctx.author)) || {};
}

function canManage(ctx) {
  if (ctx.hasPermission("MANAGE_MESSAGES")) return true;
  try {
    const user = getUser(ctx);
    if (typeof ctx.isBotOwner === "function" && ctx.isBotOwner(user)) return true;
  } catch (e) {}
  return false;
}

function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || ""));
}

function statusOf(res) {
  if (!res || typeof res !== "object") return 0;
  return Number(res.status || res.statusCode || 0);
}

function bodyOf(res) {
  if (!res || typeof res !== "object") return null;
  let b = res.body !== undefined ? res.body : res;
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch (e) { return null; }
  }
  return b && typeof b === "object" ? b : null;
}

async function handleSlash(ctx) {
  const text = String(ctx.options.message || "").trim();
  if (!text) {
    return ctx.replyWarn("Please provide a message to send.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }

  let targetCh = ctx.options.channel;
  if (targetCh && typeof targetCh === "object" && targetCh.id) {
    targetCh = targetCh.id;
  }
  if (!targetCh || typeof targetCh !== "string") {
    targetCh = ctx.channelId;
  }

  const thumbRaw = String(ctx.options.thumbnail || "").trim();
  const bannerRaw = String(ctx.options.banner || "").trim();

  if (thumbRaw && !isHttpUrl(thumbRaw)) {
    return ctx.replyWarn("Thumbnail must be a valid HTTP or HTTPS image URL.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  if (bannerRaw && !isHttpUrl(bannerRaw)) {
    return ctx.replyWarn("Banner must be a valid HTTP or HTTPS image URL.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }

  // Defer ephemeral so command response is clean and invisible to regular chat
  if (!ctx.defer(true)) return;

  const hasMedia = Boolean(thumbRaw || bannerRaw);
  let payload = {};

  if (hasMedia) {
    // Rich Embed mode when thumbnail or banner is provided
    const embed = {
      description: text.slice(0, 4000),
      color: (ctx.colors && ctx.colors.v1) || (typeof ctx.color === "number" ? ctx.color : 0x5865f2)
    };
    if (thumbRaw) embed.thumbnail = { url: thumbRaw };
    if (bannerRaw) embed.image = { url: bannerRaw };

    payload = {
      embeds: [embed],
      allowed_mentions: { parse: [] }
    };
  } else {
    // Plain text mode
    payload = {
      content: text.slice(0, 2000),
      allowed_mentions: { parse: [] }
    };
  }

  let res = null;
  try {
    res = await ctx.sendChannel(targetCh, payload);
  } catch (e) {
    res = null;
  }

  const st = statusOf(res);
  const body = bodyOf(res);

  if (!res || st < 200 || st >= 300 || !body || !body.id) {
    return ctx.editReply({
      embeds: [{
        title: "Say",
        description: "Could not send the message to <#" + targetCh + "> (HTTP " + (st || "error") + "). Please verify that I have permission to **Send Messages** and **Embed Links** in that channel.",
        color: (ctx.colors && ctx.colors.error) || 0xED4245
      }],
      allowed_mentions: { parse: [] }
    });
  }

  return ctx.editReply({
    embeds: [{
      title: "Say",
      description: "Successfully sent message to <#" + targetCh + ">.",
      color: (ctx.colors && ctx.colors.v1) || 0x5865f2
    }],
    allowed_mentions: { parse: [] }
  });
}

async function handlePrefix(ctx) {
  const text = String(ctx.rawText || (ctx.rawArgs && ctx.rawArgs.join(" ")) || "").trim();
  if (!text) {
    return ctx.replyWarn("Please provide a message to send: `say <message>`", SAFE_NO_PING);
  }

  // Delete author message for clean appearance if messageId is available
  if (ctx.channelId && ctx.message && ctx.message.id) {
    try {
      await ctx.deleteMessage(ctx.channelId, ctx.message.id);
    } catch (e) {}
  }

  return ctx.sendChannel(ctx.channelId, {
    content: text.slice(0, 2000),
    allowed_mentions: { parse: [] }
  });
}

async function onCommand(ctx) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used in a server.", SAFE_NO_PING);
  }

  if (!canManage(ctx)) {
    return ctx.replyWarn("You need `MANAGE_MESSAGES` permission to use this command.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }

  // Check if invocation is slash interaction or prefix message
  if (ctx.interaction && ctx.interaction.type === 2) {
    return handleSlash(ctx);
  }

  return handlePrefix(ctx);
}

module.exports = {
  name: "Say V1",
  description: "Send plain text announcements or rich embeds with thumbnail and banner via slash or prefix command.",
  version: "1.0.0",
  commands: [
    {
      name: "say",
      description: "Send a message as the bot with optional channel, thumbnail, and banner",
      slash: true,
      prefix: true,
      cooldown: 2,
      category: "Utility",
      options: [
        {
          type: 3, // STRING
          name: "message",
          description: "The message text to send",
          required: true
        },
        {
          type: 7, // CHANNEL
          name: "channel",
          description: "Target channel to send the message in (defaults to current channel)",
          required: false,
          channel_types: [0, 5]
        },
        {
          type: 3, // STRING
          name: "thumbnail",
          description: "Optional top-right corner image URL (embed mode)",
          required: false
        },
        {
          type: 3, // STRING
          name: "banner",
          description: "Optional bottom banner image URL (embed mode)",
          required: false
        }
      ]
    }
  ],
  onCommand: onCommand
};
