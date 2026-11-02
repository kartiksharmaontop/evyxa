const raw = {
  error: "❌",
  warn: "⚠️",
  warning: "⚠️",
  cooldown: "🕛",
  success: "✅",
  info: "ℹ️"
};

const COLORS = {
  error: 0xed4245,
  warn: 0xfaa61a,
  warning: 0xfaa61a,
  cooldown: 0x5865f2,
  success: 0x3ba55d,
  info: 0x5865f2
};

function getEmoji(type) {
  const key = String(type || "error").toLowerCase().trim();
  return raw[key] || raw.error || "❌";
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

  if (opts.deleteAfter !== undefined) {
    if (Number(opts.deleteAfter) > 0) {
      payload.deleteAfter = Number(opts.deleteAfter);
    }
  } else if (t === "error" || t === "warn" || t === "cooldown") {
    payload.deleteAfter = 10000;
  }

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
