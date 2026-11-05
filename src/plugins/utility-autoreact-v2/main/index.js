"use strict";

// ---------------------------------------------------------------------------
// Auto React — owner-only auto reactions triggered when a set user is pinged.
// Storage layout (per server): "autoreact_<guildId>" -> { "<userId>": ["😀", "<:name:id>"] }
// ---------------------------------------------------------------------------

const NS = "autoreact";
const MAX_EMOJIS = 5;
const PER_PAGE = 6;
const REACT_GAP_MS = 300;
const MAX_REACTIONS_PER_MESSAGE = 20;
const OWNER_CACHE_MS = 10 * 60 * 1000;

const DEFAULT_NAV = { first: "⏪", prev: "◀️", next: "▶️", last: "⏩" };
const NO_PING = { allowed_mentions: { parse: [] } };

const CUSTOM_EMOJI_RE = /<(a?):([A-Za-z0-9_~]{2,32}):(\d{17,20})>/;
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u;

// ----------------------------- small helpers ------------------------------

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function storeKey(guildId) {
  return "autoreact_" + guildId;
}

function bodyOf(res) {
  if (!res || typeof res !== "object") return null;
  let b = res.body !== undefined ? res.body : res;
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch (e) { return null; }
  }
  return b && typeof b === "object" ? b : null;
}

function statusOf(res) {
  if (!res || typeof res !== "object") return 0;
  return Number(res.status || res.statusCode || 0);
}

// Parse the first emoji found in a text. Returns { value, key, api } or null.
function parseEmoji(input) {
  const text = String(input === undefined || input === null ? "" : input).trim();
  if (!text) return null;

  const c = text.match(CUSTOM_EMOJI_RE);
  if (c) {
    return {
      value: "<" + c[1] + ":" + c[2] + ":" + c[3] + ">",
      key: "c:" + c[3],
      api: c[2] + ":" + c[3]
    };
  }

  let segments;
  try {
    segments = typeof Intl !== "undefined" && Intl.Segmenter
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), function (s) { return s.segment; })
      : Array.from(text);
  } catch (e) {
    segments = Array.from(text);
  }

  for (let i = 0; i < segments.length; i++) {
    if (UNICODE_EMOJI_RE.test(segments[i])) {
      return {
        value: segments[i],
        key: "u:" + segments[i].replace(/\uFE0F/g, ""),
        api: segments[i]
      };
    }
  }
  return null;
}

// Emoji object for buttons: { name } or { name, id, animated }
function buttonEmoji(raw, fallback) {
  const c = String(raw || "").match(CUSTOM_EMOJI_RE);
  if (c) return { name: c[2], id: c[3], animated: c[1] === "a" };
  const parsed = parseEmoji(raw);
  if (parsed && parsed.key.charAt(0) === "u") return { name: parsed.value };
  return { name: fallback };
}

function navEmoji(ctx, which) {
  const cfg = (ctx && ctx.config) || {};
  return buttonEmoji(cfg["emoji_" + which], DEFAULT_NAV[which]);
}

function loadData(ctx, guildId) {
  const d = ctx.storage.get(storeKey(guildId), {});
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}

function saveData(ctx, guildId, data) {
  ctx.storage.set(storeKey(guildId), data);
}

// Success card without the check mark emoji (replySuccess always prefixes "✅").
function replyNotice(ctx, text) {
  return ctx.reply({
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: ctx.color,
        components: [{ type: 10, content: text }]
      }
    ],
    allowed_mentions: { parse: [] }
  });
}

// ------------------------------ owner check -------------------------------

const ownerCache = new Map(); // botId -> { ids:Set, exp:number }

async function getOwnerIds(ctx) {
  const ids = new Set();

  // Owner IDs configured in Dashboard -> Bot -> Advanced Settings -> Owner IDs.
  String((ctx && ctx.ownerIds) || "")
    .split(/[\s,;]+/)
    .forEach(function (x) {
      const d = x.replace(/\D/g, "");
      if (/^\d{17,20}$/.test(d)) ids.add(d);
    });

  const botKey = String(ctx.botId || "default");
  let cached = ownerCache.get(botKey);

  if (!cached || cached.exp < Date.now()) {
    const found = new Set();
    try {
      const res = await ctx.discordRequest("GET", "/oauth2/applications/@me");
      const b = bodyOf(res);
      if (b) {
        if (b.owner && b.owner.id) found.add(String(b.owner.id));
        if (b.team && b.team.owner_user_id) found.add(String(b.team.owner_user_id));
      }
    } catch (e) { /* fall back to dashboard owner ids */ }
    cached = { ids: found, exp: Date.now() + (found.size ? OWNER_CACHE_MS : 60 * 1000) };
    ownerCache.set(botKey, cached);
  }

  cached.ids.forEach(function (id) { ids.add(id); });
  return ids;
}

async function isBotOwner(ctx) {
  if (!ctx.user || !ctx.user.id) return false;
  const ids = await getOwnerIds(ctx);
  return ids.has(String(ctx.user.id));
}

// ----------------------------- arg resolution -----------------------------

function resolveUser(ctx, args) {
  const o = ctx.options && ctx.options.user;
  if (o) {
    if (typeof o === "object" && o.id) return { id: String(o.id), used: -1 };
    if (typeof o === "string") {
      const d = o.replace(/\D/g, "");
      if (/^\d{17,20}$/.test(d)) return { id: d, used: -1 };
    }
  }
  for (let i = 0; i < args.length; i++) {
    const m = String(args[i]).match(/^<@!?(\d{17,20})>$/) || String(args[i]).match(/^(\d{17,20})$/);
    if (m) return { id: m[1], used: i };
  }
  return null;
}

function getArgs(ctx, sub) {
  const args = Array.isArray(ctx.rawArgs) ? ctx.rawArgs.slice() : [];
  if (args.length && String(args[0]).toLowerCase() === sub) args.shift();
  return args;
}

// -------------------------------- commands --------------------------------

async function handleSet(ctx, args) {
  const target = resolveUser(ctx, args);
  if (!target) return ctx.replyWarn("Please mention a valid user!", NO_PING);

  const emojiText = ctx.options && ctx.options.emoji
    ? String(ctx.options.emoji)
    : args.filter(function (_, i) { return i !== target.used; }).join(" ");
  const emoji = parseEmoji(emojiText);
  if (!emoji) {
    return ctx.replyWarn("Please provide a valid emoji! Use a unicode emoji or a custom one like <:name:id>.", NO_PING);
  }

  const data = loadData(ctx, ctx.guildId);
  const list = Array.isArray(data[target.id]) ? data[target.id] : [];

  const dup = list.some(function (e) { const p = parseEmoji(e); return p && p.key === emoji.key; });
  if (dup) return ctx.replyWarn(emoji.value + " is already set for <@" + target.id + ">!", NO_PING);

  if (list.length >= MAX_EMOJIS) {
    return ctx.replyWarn("<@" + target.id + "> already has the maximum of " + MAX_EMOJIS + " auto reacts. Remove one first!", NO_PING);
  }

  list.push(emoji.value);
  data[target.id] = list;
  saveData(ctx, ctx.guildId, data);

  return replyNotice(ctx, "> Added " + emoji.value + " auto react for <@" + target.id + ">. (" + list.length + "/" + MAX_EMOJIS + ")");
}

async function handleRemove(ctx, args) {
  const target = resolveUser(ctx, args);
  if (!target) return ctx.replyWarn("Please mention a valid user!", NO_PING);

  const data = loadData(ctx, ctx.guildId);
  const list = Array.isArray(data[target.id]) ? data[target.id] : [];

  const emojiText = ctx.options && ctx.options.emoji
    ? String(ctx.options.emoji)
    : args.filter(function (_, i) { return i !== target.used; }).join(" ").trim();

  if (!list.length) return ctx.replyWarn("<@" + target.id + "> has no auto reacts set.", NO_PING);

  // No emoji given -> remove everything for this user
  if (!emojiText) {
    delete data[target.id];
    saveData(ctx, ctx.guildId, data);
    return replyNotice(ctx, "> Removed all auto reacts from <@" + target.id + ">.");
  }

  const emoji = parseEmoji(emojiText);
  if (!emoji) {
    return ctx.replyWarn("Please provide a valid emoji! Use a unicode emoji or a custom one like <:name:id>.", NO_PING);
  }

  const idx = list.findIndex(function (e) { const p = parseEmoji(e); return p && p.key === emoji.key; });
  if (idx === -1) return ctx.replyWarn(emoji.value + " is not set for <@" + target.id + ">!", NO_PING);

  const removed = list.splice(idx, 1)[0];
  if (list.length) data[target.id] = list; else delete data[target.id];
  saveData(ctx, ctx.guildId, data);

  return replyNotice(ctx, "> Removed " + removed + " from <@" + target.id + ">'s auto reacts.");
}

// ------------------------------ list (V2 card) ----------------------------

function getEntries(data) {
  return Object.keys(data)
    .filter(function (uid) { return Array.isArray(data[uid]) && data[uid].length; })
    .map(function (uid) { return { userId: uid, emojis: data[uid] }; });
}

function separator() {
  return { type: 14, divider: true, spacing: 1 };
}

function buildListPayload(ctx, entries, page, viewerId) {
  const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * PER_PAGE;

  const lines = entries.slice(start, start + PER_PAGE).map(function (e, i) {
    return (start + i + 1) + ". " + e.emojis.join(" ") + " - <@" + e.userId + ">";
  });

  const atStart = current <= 1;
  const atEnd = current >= totalPages;
  const id = function (action) { return NS + ":" + action + ":" + viewerId + ":" + current; };

  const buttons = [
    { type: 2, style: 2, emoji: navEmoji(ctx, "first"), custom_id: id("first"), disabled: atStart },
    { type: 2, style: 2, emoji: navEmoji(ctx, "prev"), custom_id: id("prev"), disabled: atStart },
    { type: 2, style: 2, label: current + "/" + totalPages, custom_id: id("noop"), disabled: true },
    { type: 2, style: 2, emoji: navEmoji(ctx, "next"), custom_id: id("next"), disabled: atEnd },
    { type: 2, style: 2, emoji: navEmoji(ctx, "last"), custom_id: id("last"), disabled: atEnd }
  ];

  return {
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: ctx.color,
        components: [
          { type: 10, content: "### Auto React Lists" },
          separator(),
          { type: 10, content: lines.join("\n") },
          separator(),
          { type: 1, components: buttons }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

async function handleList(ctx) {
  const entries = getEntries(loadData(ctx, ctx.guildId));
  if (!entries.length) return ctx.replyWarn("No auto reacts have been set yet.", NO_PING);
  return ctx.reply(buildListPayload(ctx, entries, 1, ctx.user.id));
}

async function handleButton(ctx) {
  const cid = String(ctx.customId || "");
  if (cid.indexOf(NS + ":") !== 0) return false; // not ours -> let other plugins handle it

  const parts = cid.split(":");
  const action = parts[1];
  const viewerId = parts[2];
  const current = parseInt(parts[3], 10) || 1;

  if (viewerId && String(ctx.user.id) !== String(viewerId)) {
    return ctx.replyWarn("Only <@" + viewerId + "> can use these buttons.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }

  if (action === "noop") return ctx.deferUpdate();

  const entries = getEntries(loadData(ctx, ctx.guildId));
  if (!entries.length) {
    return ctx.update({
      flags: 32768,
      components: [{
        type: 17,
        accent_color: ctx.color,
        components: [
          { type: 10, content: "### Auto React Lists" },
          separator(),
          { type: 10, content: "No auto reacts have been set yet." }
        ]
      }]
    });
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  let target = current;
  if (action === "first") target = 1;
  else if (action === "prev") target = current - 1;
  else if (action === "next") target = current + 1;
  else if (action === "last") target = totalPages;

  return ctx.update(buildListPayload(ctx, entries, target, viewerId));
}

async function onCommand(ctx) {
  try {
    if (!(await isBotOwner(ctx))) {
      return ctx.replyWarn("Only the bot owner can use this command!", NO_PING);
    }
    if (!ctx.guildId) {
      return ctx.replyWarn("This command can only be used in a server!", NO_PING);
    }

    const args0 = Array.isArray(ctx.rawArgs) ? ctx.rawArgs : [];
    const sub = String(ctx.subcommand || args0[0] || "").toLowerCase();
    const args = getArgs(ctx, sub);

    if (sub === "set") return await handleSet(ctx, args);
    if (sub === "remove") return await handleRemove(ctx, args);
    if (sub === "list") return await handleList(ctx);

    return ctx.replyWarn("Usage: `autoreact set <user> <emoji>`, `autoreact remove <user> [emoji]` or `autoreact list`.", NO_PING);
  } catch (err) {
    return ctx.replyError("Something went wrong while saving. Please try again.", NO_PING);
  }
}

// ------------------------------ auto reacting -----------------------------

function failCode(res) {
  const status = statusOf(res);
  const b = bodyOf(res);
  const code = b && typeof b.code === "number" ? b.code : 0;
  return { status: status, code: code, failed: status >= 400 || code > 0 };
}

async function addReaction(ctx, channelId, messageId, emoji) {
  const path = "/channels/" + channelId + "/messages/" + messageId + "/reactions/" + encodeURIComponent(emoji.api) + "/@me";
  let res = await ctx.discordRequest("PUT", path);

  if (statusOf(res) === 429) {
    const b = bodyOf(res);
    const wait = Math.min(5000, Math.ceil(((b && Number(b.retry_after)) || 1) * 1000));
    await sleep(wait);
    res = await ctx.discordRequest("PUT", path);
  }
  return failCode(res);
}

async function onMessageCreate(ctx) {
  try {
    const d = ctx.data;
    if (!d || !d.guild_id || !d.id || !d.channel_id) return;       // servers only
    if (!d.author || d.author.bot || d.webhook_id) return;          // ignore bots / webhooks
    if (d.type !== undefined && d.type !== 0 && d.type !== 19) return; // normal + reply messages only

    // Reply messages carry the replied-to author in `mentions` even when no @ was
    // typed. Only react there when the mention is written out in the content.
    const isReply = d.type === 19 || !!d.message_reference;
    const content = String(d.content || "");

    const mentions = (Array.isArray(d.mentions) ? d.mentions : []).filter(function (m) {
      if (!m || !m.id) return false;
      if (!isReply) return true;
      return new RegExp("<@!?" + m.id + ">").test(content);
    });
    if (!mentions.length) return;                                    // @everyone / @here / roles are not in this list

    const data = loadData(ctx, d.guild_id);
    const seen = new Set();
    const toReact = [];

    mentions.forEach(function (m) {
      const list = m && data[m.id];
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        const e = parseEmoji(raw);
        if (e && !seen.has(e.key)) { seen.add(e.key); toReact.push(e); }
      });
    });

    if (!toReact.length) return;

    const batch = toReact.slice(0, MAX_REACTIONS_PER_MESSAGE);
    for (let i = 0; i < batch.length; i++) {
      let result;
      try {
        result = await addReaction(ctx, d.channel_id, d.id, batch[i]);
      } catch (e) {
        continue; // skip this emoji silently
      }
      // Message deleted / no access / no permission / blocked -> stop for this message
      if (result.failed && (result.code === 10008 || result.code === 50001 || result.code === 50013 || result.code === 90001 || result.status === 403)) break;
      if (i < batch.length - 1) await sleep(REACT_GAP_MS);
    }
  } catch (err) {
    // never crash the bot because of a reaction
  }
}

// -------------------------------- exports ---------------------------------

module.exports = {
  name: "Auto React",
  version: "1.0.2",

  config: [
    {
      key: "emoji_first",
      label: "First Page Button Emoji",
      type: "text",
      description: "Unicode or custom emoji (<:name:id>)",
      placeholder: "⏪",
      default: "⏪"
    },
    {
      key: "emoji_prev",
      label: "Previous Page Button Emoji",
      type: "text",
      description: "Unicode or custom emoji (<:name:id>)",
      placeholder: "◀️",
      default: "◀️"
    },
    {
      key: "emoji_next",
      label: "Next Page Button Emoji",
      type: "text",
      description: "Unicode or custom emoji (<:name:id>)",
      placeholder: "▶️",
      default: "▶️"
    },
    {
      key: "emoji_last",
      label: "Last Page Button Emoji",
      type: "text",
      description: "Unicode or custom emoji (<:name:id>)",
      placeholder: "⏩",
      default: "⏩"
    }
  ],

  commands: [
    {
      name: "autoreact",
      description: "Auto react when a user is pinged (bot owner only)",
      category: "Utility",
      slash: true,
      prefix: true,
      options: [
        {
          type: 1,
          name: "set",
          description: "Add an auto react emoji for a user",
          options: [
            { type: 6, name: "user", description: "User who will trigger the reaction when pinged", required: true },
            { type: 3, name: "emoji", description: "Unicode emoji or custom emoji like <:name:id>", required: true }
          ]
        },
        {
          type: 1,
          name: "remove",
          description: "Remove an auto react emoji (or all) from a user",
          options: [
            { type: 6, name: "user", description: "User to remove auto reacts from", required: true },
            { type: 3, name: "emoji", description: "Emoji to remove (leave empty to remove all)", required: false }
          ]
        },
        {
          type: 1,
          name: "list",
          description: "Show all auto reacts in this server"
        }
      ]
    }
  ],

  onCommand: onCommand,

  components: { "autoreact:*": handleButton },
  buttons: { "autoreact:*": handleButton },

  events: {
    MESSAGE_CREATE: onMessageCreate
  }
};
