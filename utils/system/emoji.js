/**
 * Arixa System Emojis & Components V2 Formatter
 * 
 * Edit the raw JSON below to customize emojis.
 * Supports unicode emojis (e.g. "❌") or Discord custom emojis (e.g. "<:error:1301217730950660146>").
 */

const raw = {
  error: "<:error:1563618179891208242>",
  warn: "<:Warning:1563618139051131033>",
  cooldown: "<a:cooldown:1563618102841708624>",
  success: "✅",
  info: "ℹ️"
};

const COLORS = {
  error: 0xed4245,    // Red
  warn: 0xfaa61a,     // Yellow / Amber
  cooldown: 0x5865f2, // Blurple
  success: 0x3ba55d,  // Green
  info: 0x5865f2      // Blurple
};

function getEmoji(type) {
  const key = String(type || "error").toLowerCase().trim();
  return raw[key] || raw.error || "<:error:1563618179891208242>";
}

function getColor(type) {
  const key = String(type || "error").toLowerCase().trim();
  return typeof COLORS[key] === "number" ? COLORS[key] : 0x5865f2;
}

function formatMessage(type, message) {
  const emoji = getEmoji(type);
  let text = "";
  if (typeof message === "number") {
    if (String(type).toLowerCase() === "cooldown") {
      text = "Please wait " + message + " second" + (message === 1 ? "" : "s") + " before reusing this command.";
    } else {
      text = String(message);
    }
  } else {
    text = String(message || "").trim();
  }
  return "> " + emoji + " " + text;
}

function buildComponentV2(type, message, options) {
  const opts = options || {};
  const t = String(type || "error").toLowerCase().trim();
  const color = typeof opts.accent === "number" ? opts.accent : getColor(t);
  const content = formatMessage(t, message);

  const payload = {
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: color,
        components: [
          {
            type: 10,
            content: content
          }
        ]
      }
    ]
  };

  if (opts.ephemeral) {
    payload.ephemeral = true;
    payload.flags = 32768 | 64;
  }

  // Auto-delete after 10 seconds for warn, error, and cooldown messages
  if (opts.deleteAfter !== undefined) {
    if (Number(opts.deleteAfter) > 0) {
      payload.deleteAfter = Number(opts.deleteAfter);
    }
  } else if (t === "error" || t === "warn" || t === "cooldown") {
    payload.deleteAfter = 10000;
  }

  // Attach message reference for direct reply
  if (opts.message_reference) {
    payload.message_reference = opts.message_reference;
  } else if (opts.messageId) {
    payload.message_reference = { message_id: opts.messageId, fail_if_not_exists: false };
  }

  return payload;
}

module.exports = {
  raw: raw,
  emojis: raw,
  COLORS: COLORS,
  getEmoji: getEmoji,
  getColor: getColor,
  formatMessage: formatMessage,
  buildComponentV2: buildComponentV2
};
