"use strict";

const NS = "ebui";
const MODAL_NS = "ebmod";
const LIST_NS = "ebli";
const PER_PAGE = 6;
const SESSION_MS = 300000;
const DEFAULT_NAV = { first: "\u23EA", prev: "\u25C0\uFE0F", next: "\u25B6\uFE0F", last: "\u23E9" };
const NO_PING = { allowed_mentions: { parse: [] } };

const pendingSessions = global.__arixa_embed_builder_actions = global.__arixa_embed_builder_actions || new Map();

function storeKey(guildId) {
  return "embeds_" + guildId;
}

function draftKey(guildId, userId) {
  return "draft_" + guildId + "_" + userId;
}

function sessionKey(guildId, userId) {
  return String(guildId) + ":" + String(userId);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeName(raw) {
  const name = String(raw === undefined || raw === null ? "" : raw).trim().replace(/\s+/g, " ");
  if (!name) return { error: "Provide a name for the embed." };
  if (name.length > 32) return { error: "Name must be 32 characters or fewer." };
  if (!/^[a-z0-9 _-]+$/i.test(name)) return { error: "Name may only contain letters, numbers, spaces, `_`, and `-`." };
  return { name: name, key: name.toLowerCase() };
}

function parseHexColor(raw) {
  let s = String(raw || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

function colorToHex(n) {
  return "#" + (Number(n) >>> 0).toString(16).padStart(6, "0");
}

function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || ""));
}

function findFocused(list) {
  if (!Array.isArray(list)) return null;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o || typeof o !== "object") continue;
    if (o.focused) return o;
    const nested = findFocused(o.options);
    if (nested) return nested;
  }
  return null;
}

function getUser(ctx) {
  return (ctx && (ctx.user || ctx.author)) || {};
}

function getUserId(ctx) {
  const u = getUser(ctx);
  return u && u.id ? String(u.id) : "";
}

function canManage(ctx) {
  if (ctx.hasPermission("MANAGE_MESSAGES")) return true;
  try {
    const user = getUser(ctx);
    if (typeof ctx.isBotOwner === "function" && ctx.isBotOwner(user)) return true;
  } catch (e) {}
  return false;
}

function loadEmbeds(ctx, guildId) {
  const list = ctx.storage.get(storeKey(guildId), []);
  return Array.isArray(list) ? list : [];
}

function saveEmbeds(ctx, guildId, list) {
  ctx.storage.set(storeKey(guildId), list);
}

function findEntry(list, key) {
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].nameKey === key) return list[i];
  }
  return null;
}

function loadDraft(ctx, guildId, userId) {
  const d = ctx.storage.get(draftKey(guildId, userId), null);
  return d && typeof d === "object" && !Array.isArray(d) ? d : null;
}

function saveDraft(ctx, guildId, userId, draft) {
  ctx.storage.set(draftKey(guildId, userId), draft);
}

function deleteDraft(ctx, guildId, userId) {
  ctx.storage.delete(draftKey(guildId, userId));
}

function clearExpiry(ctx, guildId, userId) {
  const key = sessionKey(guildId, userId);
  const prev = pendingSessions.get(key);
  if (prev) {
    if (prev.timer) clearTimeout(prev.timer);
    pendingSessions.delete(key);
  }
  if (ctx && ctx.session && typeof ctx.session.delete === "function") {
    ctx.session.delete(key);
  }
}

function scheduleExpiry(ctx, guildId, draft) {
  clearExpiry(ctx, guildId, draft.ownerId);
  const key = sessionKey(guildId, draft.ownerId);
  const onExpireHandler = function () {
    pendingSessions.delete(key);
    const current = loadDraft(ctx, guildId, draft.ownerId);
    if (!current) return;
    deleteDraft(ctx, guildId, draft.ownerId);
    if (current.builderCid && current.builderMid) {
      const p = ctx.editMessage(current.builderCid, current.builderMid, buildBuilderPayload(ctx, current, true));
      if (p && typeof p.catch === "function") p.catch(function () {});
    }
  };
  const timer = setTimeout(onExpireHandler, SESSION_MS);
  pendingSessions.set(key, { timer: timer, onExpire: onExpireHandler });
  if (ctx && ctx.session && typeof ctx.session.create === "function") {
    ctx.session.create(key, draft, {
      ttl: SESSION_MS,
      guildId: guildId,
      ownerId: draft.ownerId,
      messageId: draft.builderMid,
      channelId: draft.builderCid,
      onTouch: function (sObj) {
        const prev = pendingSessions.get(key);
        if (prev && prev.timer) clearTimeout(prev.timer);
        const nextTimer = setTimeout(onExpireHandler, SESSION_MS);
        pendingSessions.set(key, { timer: nextTimer, onExpire: onExpireHandler });
        const cur = loadDraft(ctx, guildId, draft.ownerId);
        if (cur) {
          cur.updatedAt = Date.now();
          saveDraft(ctx, guildId, draft.ownerId, cur);
        }
      },
      onExpire: onExpireHandler
    });
  }
}

function finalizeEmbed(draft) {
  const e = (draft && draft.embed) || {};
  const out = {};
  const title = String(e.title || "").trim();
  const desc = String(e.description || "").trim();
  if (title) out.title = title.slice(0, 256);
  if (desc) out.description = desc.slice(0, 4096);
  if (typeof e.color === "number" && e.color >= 0 && e.color <= 0xffffff) out.color = e.color;
  if (e.author && e.author.name) {
    const a = { name: String(e.author.name).slice(0, 256) };
    if (e.author.icon_url) a.icon_url = String(e.author.icon_url);
    if (e.author.url) a.url = String(e.author.url);
    out.author = a;
  }
  if (e.footer && e.footer.text) {
    const f = { text: String(e.footer.text).slice(0, 2048) };
    if (e.footer.icon_url) f.icon_url = String(e.footer.icon_url);
    out.footer = f;
  }
  if (e.timestamp) out.timestamp = String(e.timestamp);
  if (e.image && e.image.url) out.image = { url: String(e.image.url) };
  if (e.thumbnail && e.thumbnail.url) out.thumbnail = { url: String(e.thumbnail.url) };
  return out;
}

function buildPreviewEmbed(ctx, draft) {
  const out = finalizeEmbed(draft);
  if (!out.title && !out.description) {
    out.description = "*Empty embed \u2014 use the buttons below to start building.*";
  }
  if (out.color === undefined) out.color = ctx.color;
  return out;
}

function buildBuilderPayload(ctx, draft, disabled) {
  const dis = !!disabled;
  const vid = String(draft.ownerId);
  const mk = function (action, label, style) {
    return { type: 2, style: style, label: label, custom_id: NS + ":" + action + ":" + vid, disabled: dis };
  };
  return {
    embeds: [buildPreviewEmbed(ctx, draft)],
    components: [
      { type: 1, components: [mk("title", "Title", 2), mk("author", "Author", 2), mk("footer", "Footer", 2), mk("image", "Image", 2)] },
      { type: 1, components: [mk("save", "Save", 1), mk("cancel", "Cancel", 4)] }
    ],
    allowed_mentions: { parse: [] }
  };
}

function buildListPayload(ctx, entries, page, viewerId) {
  const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * PER_PAGE;
  const slice = entries.slice(start, start + PER_PAGE);
  const lines = slice.map(function (e, i) {
    return (start + i + 1) + ". **" + e.name + "** - by <@" + e.authorId + ">";
  });
  const atStart = current <= 1;
  const atEnd = current >= totalPages;
  const id = function (a) { return LIST_NS + ":" + a + ":" + viewerId + ":" + current; };
  return {
    embeds: [{
      title: "Embed List",
      description: lines.join("\n"),
      color: ctx.color,
      footer: { text: entries.length + (entries.length === 1 ? " embed saved" : " embeds saved") }
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 2, emoji: { name: DEFAULT_NAV.first }, custom_id: id("first"), disabled: atStart },
        { type: 2, style: 2, emoji: { name: DEFAULT_NAV.prev }, custom_id: id("prev"), disabled: atStart },
        { type: 2, style: 2, label: current + "/" + totalPages, custom_id: id("noop"), disabled: true },
        { type: 2, style: 2, emoji: { name: DEFAULT_NAV.next }, custom_id: id("next"), disabled: atEnd },
        { type: 2, style: 2, emoji: { name: DEFAULT_NAV.last }, custom_id: id("last"), disabled: atEnd }
      ]
    }],
    allowed_mentions: { parse: [] }
  };
}

function textInput(custom_id, label, style, value, placeholder, max_length) {
  const item = { type: 4, custom_id: custom_id, label: label, style: style, required: false, max_length: max_length, placeholder: placeholder };
  const v = String(value === undefined || value === null ? "" : value);
  if (v) {
    item.value = v;
  }
  return item;
}

function buildModal(draft, userId, action) {
  const e = draft.embed || {};
  const uid = ":" + userId;
  if (action === "title") {
    return {
      title: "Title & Description",
      customId: MODAL_NS + ":title" + uid,
      components: [
        { type: 1, components: [textInput("f_title", "Title", 1, e.title, "Embed title (optional)", 256)] },
        { type: 1, components: [textInput("f_desc", "Description", 2, e.description, "Markdown supported", 4000)] },
        { type: 1, components: [textInput("f_color", "Color hex", 1, typeof e.color === "number" ? colorToHex(e.color) : "", "#5865f2", 7)] }
      ]
    };
  }
  if (action === "author") {
    const a = e.author || {};
    return {
      title: "Author",
      customId: MODAL_NS + ":author" + uid,
      components: [
        { type: 1, components: [textInput("f_author_name", "Author name", 1, a.name, "Shown at the top of the embed", 256)] },
        { type: 1, components: [textInput("f_author_icon", "Icon URL", 1, a.icon_url, "https://... (optional)", 512)] },
        { type: 1, components: [textInput("f_author_url", "Profile URL", 1, a.url, "https://... (optional)", 512)] }
      ]
    };
  }
  if (action === "footer") {
    const f = e.footer || {};
    return {
      title: "Footer & Timestamp",
      customId: MODAL_NS + ":footer" + uid,
      components: [
        { type: 1, components: [textInput("f_footer_text", "Footer text", 1, f.text, "Bottom line of the embed", 2048)] },
        { type: 1, components: [textInput("f_footer_icon", "Icon URL", 1, f.icon_url, "https://... (optional)", 512)] },
        { type: 1, components: [textInput("f_footer_ts", "Timestamp", 1, e.timestamp ? "on" : "off", "on or off", 3)] }
      ]
    };
  }
  if (action === "image") {
    const img = e.image || {};
    const th = e.thumbnail || {};
    return {
      title: "Image & Thumbnail",
      customId: MODAL_NS + ":image" + uid,
      components: [
        { type: 1, components: [textInput("f_image", "Image URL", 1, img.url, "Large image at the bottom", 512)] },
        { type: 1, components: [textInput("f_thumb", "Thumbnail URL", 1, th.url, "Small corner image", 512)] }
      ]
    };
  }
  return null;
}

function applyModalFields(draft, action, fields) {
  const e = draft.embed = draft.embed || {};
  if (action === "title") {
    const colorRaw = String(fields.f_color || "").trim();
    let colorVal = null;
    if (colorRaw) {
      colorVal = parseHexColor(colorRaw);
      if (colorVal === null) return { error: "Invalid color. Use a hex value like `#5865f2`." };
    }
    const t = String(fields.f_title || "").trim();
    const d = String(fields.f_desc || "").trim();
    if (colorRaw) e.color = colorVal; else delete e.color;
    if (t) e.title = t; else delete e.title;
    if (d) e.description = d; else delete e.description;
    return { label: "Title & description" };
  }
  if (action === "author") {
    const name = String(fields.f_author_name || "").trim();
    const icon = String(fields.f_author_icon || "").trim();
    const url = String(fields.f_author_url || "").trim();
    if (!name && !icon && !url) {
      delete e.author;
      return { label: "Author" };
    }
    if (!name) return { error: "Author name is required to set an author. Clear all three fields to remove it." };
    if (icon && !isHttpUrl(icon)) return { error: "Icon URL must start with `http://` or `https://`." };
    if (url && !isHttpUrl(url)) return { error: "Profile URL must start with `http://` or `https://`." };
    const a = { name: name };
    if (icon) a.icon_url = icon;
    if (url) a.url = url;
    e.author = a;
    return { label: "Author" };
  }
  if (action === "footer") {
    const text = String(fields.f_footer_text || "").trim();
    const icon = String(fields.f_footer_icon || "").trim();
    const ts = String(fields.f_footer_ts || "").trim().toLowerCase();
    if (ts && ts !== "on" && ts !== "off") return { error: "Timestamp must be `on` or `off`." };
    if (!text && icon) return { error: "Footer text is required to set a footer. Clear the icon too to remove it." };
    if (icon && !isHttpUrl(icon)) return { error: "Icon URL must start with `http://` or `https://`." };
    if (ts === "on") e.timestamp = new Date().toISOString();
    else delete e.timestamp;
    if (!text && !icon) delete e.footer;
    else {
      const f = { text: text };
      if (icon) f.icon_url = icon;
      e.footer = f;
    }
    return { label: "Footer & timestamp" };
  }
  if (action === "image") {
    const img = String(fields.f_image || "").trim();
    const th = String(fields.f_thumb || "").trim();
    if (img && !isHttpUrl(img)) return { error: "Image URL must start with `http://` or `https://`." };
    if (th && !isHttpUrl(th)) return { error: "Thumbnail URL must start with `http://` or `https://`." };
    if (img) e.image = { url: img }; else delete e.image;
    if (th) e.thumbnail = { url: th }; else delete e.thumbnail;
    return { label: "Image & thumbnail" };
  }
  return { error: "Unknown builder section." };
}

function clearPreviousSession(ctx, guildId, userId) {
  const prev = loadDraft(ctx, guildId, userId);
  clearExpiry(ctx, guildId, userId);
  if (prev && prev.builderCid && prev.builderMid) {
    const p = ctx.deleteMessage(prev.builderCid, prev.builderMid);
    if (p && typeof p.catch === "function") p.catch(function () {});
  }
}

async function openBuilder(ctx, draft) {
  if (!ctx.defer(true)) return;
  const userId = getUserId(ctx);
  let res = null;
  try { res = await ctx.sendChannel(draft.targetCh, buildBuilderPayload(ctx, draft, false)); } catch (e) { res = null; }
  const st = statusOf(res);
  const body = bodyOf(res);
  if (!res || st < 200 || st >= 300 || !body || !body.id) {
    return ctx.editReply({
      embeds: [{
        title: "Embed Builder",
        description: "I could not open the builder in <#" + draft.targetCh + ">. Check that I can **send messages** and **embed links** there.",
        color: (ctx.colors && ctx.colors.error) || 0xED4245
      }],
      allowed_mentions: { parse: [] }
    });
  }
  draft.builderCid = draft.targetCh;
  draft.builderMid = String(body.id);
  draft.updatedAt = Date.now();
  saveDraft(ctx, ctx.guildId, userId, draft);
  scheduleExpiry(ctx, ctx.guildId, draft);
  return ctx.editReply({
    embeds: [{
      title: "Embed Builder",
      description: "Building **" + draft.name + "** \u2014 use the buttons on the card above. Active session resets on every button click (5 min inactivity timeout).",
      color: (ctx.colors && ctx.colors.v1) || 0x5865f2
    }],
    allowed_mentions: { parse: [] }
  });
}

async function handleSetCommand(ctx) {
  if (!canManage(ctx)) {
    return ctx.replyWarn("You need `MANAGE_MESSAGES` to build embeds.", NO_PING);
  }
  const norm = normalizeName(ctx.options && ctx.options.name);
  if (norm.error) return ctx.replyWarn(norm.error, NO_PING);
  const list = loadEmbeds(ctx, ctx.guildId);
  if (findEntry(list, norm.key)) {
    return ctx.replyWarn("The name `" + norm.name + "` already exists \u2014 use `/embed edit name:" + norm.name + "` instead.", NO_PING);
  }
  const userId = getUserId(ctx);
  clearPreviousSession(ctx, ctx.guildId, userId);
  const targetCh = ctx.channelId;
  const draft = {
    mode: "set",
    name: norm.name,
    nameKey: norm.key,
    targetCh: targetCh,
    embed: {},
    ownerId: userId,
    builderCid: null,
    builderMid: null,
    updatedAt: Date.now()
  };
  return openBuilder(ctx, draft);
}

async function handleEditCommand(ctx) {
  if (!canManage(ctx)) {
    return ctx.replyWarn("You need `MANAGE_MESSAGES` to build embeds.", NO_PING);
  }
  const norm = normalizeName(ctx.options && ctx.options.name);
  if (norm.error) return ctx.replyWarn(norm.error, NO_PING);
  const list = loadEmbeds(ctx, ctx.guildId);
  const entry = findEntry(list, norm.key);
  if (!entry) {
    return ctx.replyWarn("No embed named `" + norm.name + "` was found in this server.", NO_PING);
  }
  const userId = getUserId(ctx);
  clearPreviousSession(ctx, ctx.guildId, userId);
  const draft = {
    mode: "edit",
    name: entry.name,
    nameKey: entry.nameKey,
    targetCh: entry.channelId,
    embed: clone(entry.embed || {}),
    ownerId: userId,
    origCh: entry.channelId,
    origMid: entry.messageId,
    builderCid: null,
    builderMid: null,
    updatedAt: Date.now()
  };
  return openBuilder(ctx, draft);
}

async function handleDeleteCommand(ctx) {
  if (!canManage(ctx)) {
    return ctx.replyWarn("You need `MANAGE_MESSAGES` to delete embeds.", NO_PING);
  }
  const norm = normalizeName(ctx.options && ctx.options.name);
  if (norm.error) return ctx.replyWarn(norm.error, NO_PING);
  const list = loadEmbeds(ctx, ctx.guildId);
  const entry = findEntry(list, norm.key);
  if (!entry) {
    return ctx.replyWarn("No embed named `" + norm.name + "` was found in this server.", NO_PING);
  }
  if (!ctx.defer(true)) return;
  let res = null;
  try { res = await ctx.deleteMessage(entry.channelId, entry.messageId); } catch (e) { res = null; }
  const st = statusOf(res);
  if (res && st && st !== 404 && (st < 200 || st >= 300)) {
    return ctx.editReply({
      embeds: [{
        title: "Embed Builder",
        description: "Could not delete the message (HTTP " + st + "). It may already be gone, or I may lack **Manage Messages**.",
        color: (ctx.colors && ctx.colors.error) || 0xED4245
      }],
      allowed_mentions: { parse: [] }
    });
  }
  const next = loadEmbeds(ctx, ctx.guildId).filter(function (e) { return e.nameKey !== entry.nameKey; });
  saveEmbeds(ctx, ctx.guildId, next);
  return ctx.editReply({
    embeds: [{
      title: "Embed Builder",
      description: "Deleted **" + entry.name + "**.",
      color: (ctx.colors && ctx.colors.v1) || 0x5865f2
    }],
    allowed_mentions: { parse: [] }
  });
}

async function handleViewCommand(ctx) {
  if (!canManage(ctx)) {
    return ctx.replyWarn("You need `MANAGE_MESSAGES` to send saved embeds.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  const norm = normalizeName(ctx.options && ctx.options.name);
  if (norm.error) return ctx.replyWarn(norm.error, { ephemeral: true, allowed_mentions: { parse: [] } });
  const list = loadEmbeds(ctx, ctx.guildId);
  const entry = findEntry(list, norm.key);
  if (!entry) {
    return ctx.replyWarn("No embed named `" + norm.name + "` was found in this server.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  let targetCh = ctx.options && ctx.options.channel;
  if (targetCh && typeof targetCh === "object" && targetCh.id) {
    targetCh = targetCh.id;
  }
  if (!targetCh || typeof targetCh !== "string") {
    targetCh = ctx.channelId;
  }

  if (!ctx.defer(true)) return;

  let res = null;
  try {
    res = await ctx.sendChannel(targetCh, { embeds: [entry.embed], allowed_mentions: { parse: [] } });
  } catch (e) {
    res = null;
  }
  const st = statusOf(res);
  const body = bodyOf(res);
  if (!res || st < 200 || st >= 300 || !body || !body.id) {
    return ctx.editReply({
      embeds: [{
        title: "Embed Builder",
        description: "Could not send the embed to <#" + targetCh + "> (HTTP " + (st || "error") + "). Please check that I have permission to **Send Messages** and **Embed Links** in that channel.",
        color: (ctx.colors && ctx.colors.error) || 0xED4245
      }],
      allowed_mentions: { parse: [] }
    });
  }

  return ctx.editReply({
    embeds: [{
      title: "Embed Builder",
      description: "Successfully sent **" + entry.name + "** to <#" + targetCh + ">.",
      color: (ctx.colors && ctx.colors.v1) || 0x5865f2
    }],
    allowed_mentions: { parse: [] }
  });
}

async function handleListCommand(ctx) {
  const list = loadEmbeds(ctx, ctx.guildId);
  if (!list.length) return ctx.replyWarn("No embeds saved yet.", NO_PING);
  return ctx.reply(buildListPayload(ctx, list, 1, getUserId(ctx)));
}

async function handleSave(ctx, draft) {
  const userId = getUserId(ctx);
  const final = finalizeEmbed(draft);
  if (!final.title && !final.description) {
    return ctx.replyWarn("Add a title or description before saving \u2014 open the **Title** button first.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  if (!ctx.defer(true)) return;
  const list = loadEmbeds(ctx, ctx.guildId);
  if (draft.mode === "edit") {
    const entry = findEntry(list, draft.nameKey);
    if (!entry) {
      return ctx.editReply({
        embeds: [{
          title: "Embed Builder",
          description: "**" + draft.name + "** was deleted while you were editing. Use `/embed set name:" + draft.name + "` to recreate it.",
          color: (ctx.colors && ctx.colors.error) || 0xED4245
        }],
        allowed_mentions: { parse: [] }
      });
    }
    let res = null;
    try { res = await ctx.editMessage(draft.origCh, draft.origMid, { embeds: [final], allowed_mentions: { parse: [] } }); } catch (e) { res = null; }
    const st = statusOf(res);
    if (!res || st < 200 || st >= 300) {
      return ctx.editReply({
        embeds: [{
          title: "Embed Builder",
          description: "Could not update the original message (HTTP " + (st || "error") + "). It may have been deleted \u2014 use `/embed set name:" + draft.name + "` to recreate it.",
          color: (ctx.colors && ctx.colors.error) || 0xED4245
        }],
        allowed_mentions: { parse: [] }
      });
    }
    entry.embed = final;
    entry.updatedAt = Date.now();
    saveEmbeds(ctx, ctx.guildId, list);
    clearExpiry(ctx, ctx.guildId, userId);
    deleteDraft(ctx, ctx.guildId, userId);
    if (draft.builderCid && draft.builderMid) {
      try { await ctx.deleteMessage(draft.builderCid, draft.builderMid); } catch (e) {}
    }
    return ctx.editReply({
      embeds: [{
        title: "Embed Builder",
        description: "Updated **" + draft.name + "** in <#" + draft.origCh + ">.",
        color: (ctx.colors && ctx.colors.v1) || 0x5865f2
      }],
      allowed_mentions: { parse: [] }
    });
  }
  if (findEntry(list, draft.nameKey)) {
    return ctx.editReply({
      embeds: [{
        title: "Embed Builder",
        description: "The name `" + draft.name + "` was taken while you were building \u2014 use `/embed edit name:" + draft.name + "` to update it.",
        color: (ctx.colors && ctx.colors.error) || 0xED4245
      }],
      allowed_mentions: { parse: [] }
    });
  }
  let res = null;
  try { res = await ctx.sendChannel(draft.targetCh, { embeds: [final], allowed_mentions: { parse: [] } }); } catch (e) { res = null; }
  const st = statusOf(res);
  const body = bodyOf(res);
  if (!res || st < 200 || st >= 300 || !body || !body.id) {
    return ctx.editReply({
      embeds: [{
        title: "Embed Builder",
        description: "Could not post the embed (HTTP " + (st || "error") + "). Check that I can **send messages** and **embed links** in <#" + draft.targetCh + ">.",
        color: (ctx.colors && ctx.colors.error) || 0xED4245
      }],
      allowed_mentions: { parse: [] }
    });
  }
  list.push({
    name: draft.name,
    nameKey: draft.nameKey,
    channelId: draft.targetCh,
    messageId: String(body.id),
    embed: final,
    authorId: userId,
    updatedAt: Date.now()
  });
  saveEmbeds(ctx, ctx.guildId, list);
  clearExpiry(ctx, ctx.guildId, userId);
  deleteDraft(ctx, ctx.guildId, userId);
  if (draft.builderCid && draft.builderMid) {
    try { await ctx.deleteMessage(draft.builderCid, draft.builderMid); } catch (e) {}
  }
  return ctx.editReply({
    embeds: [{
      title: "Embed Builder",
      description: "Saved **" + draft.name + "** \u2192 <#" + draft.targetCh + ">\nPreview it with `/embed view name:" + draft.name + "`.",
      color: (ctx.colors && ctx.colors.v1) || 0x5865f2
    }],
    allowed_mentions: { parse: [] }
  });
}

async function handleCancel(ctx, draft) {
  const userId = getUserId(ctx);
  if (!ctx.defer(true)) return;
  clearExpiry(ctx, ctx.guildId, userId);
  deleteDraft(ctx, ctx.guildId, userId);
  if (draft.builderCid && draft.builderMid) {
    try { await ctx.deleteMessage(draft.builderCid, draft.builderMid); } catch (e) {}
  }
  return ctx.editReply({
    embeds: [{
      title: "Embed Builder",
      description: "Cancelled \u2014 **" + draft.name + "** was not saved.",
      color: (ctx.colors && ctx.colors.v1) || 0x5865f2
    }],
    allowed_mentions: { parse: [] }
  });
}

async function handleBuilderButton(ctx) {
  const cid = String(ctx.customId || "");
  if (cid.indexOf(NS + ":") !== 0) return false;
  const parts = cid.split(":");
  const action = parts[1] || "";
  const viewerId = parts[2] || "";
  const userId = getUserId(ctx);
  if (viewerId && userId !== viewerId) {
    return ctx.replyWarn("Only <@" + viewerId + "> can use this builder.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  const guildId = ctx.guildId;
  const draft = loadDraft(ctx, guildId, userId);
  if (!draft) {
    return ctx.replyWarn("This builder session has ended \u2014 use `/embed set` to start a new one.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  const sKey = sessionKey(guildId, userId);
  const activeSess = (ctx.session && typeof ctx.session.getSession === "function" && ctx.session.getSession(sKey)) || null;
  if (activeSess && activeSess.updatedAt) {
    draft.updatedAt = Math.max(draft.updatedAt || 0, activeSess.updatedAt);
  }
  if (Date.now() - (draft.updatedAt || 0) > SESSION_MS) {
    clearExpiry(ctx, guildId, userId);
    deleteDraft(ctx, guildId, userId);
    if (draft.builderCid && draft.builderMid) {
      const p = ctx.editMessage(draft.builderCid, draft.builderMid, buildBuilderPayload(ctx, draft, true));
      if (p && typeof p.catch === "function") p.catch(function () {});
    }
    return ctx.replyWarn("This builder expired after 5 minutes of inactivity \u2014 use `/embed set` to start again.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  draft.updatedAt = Date.now();
  saveDraft(ctx, guildId, userId, draft);
  scheduleExpiry(ctx, guildId, draft);
  if (action === "save") return handleSave(ctx, draft);
  if (action === "cancel") return handleCancel(ctx, draft);
  const modal = buildModal(draft, userId, action);
  if (!modal) return ctx.replyWarn("Unknown builder action.", { ephemeral: true, allowed_mentions: { parse: [] } });
  return ctx.showModal(modal);
}

async function handleListButton(ctx) {
  const cid = String(ctx.customId || "");
  if (cid.indexOf(LIST_NS + ":") !== 0) return false;
  const parts = cid.split(":");
  const action = parts[1] || "";
  const viewerId = parts[2] || "";
  const page = parseInt(parts[3], 10) || 1;
  const userId = getUserId(ctx);
  if (viewerId && userId !== viewerId) {
    return ctx.replyWarn("Only <@" + viewerId + "> can use these buttons.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  if (action === "noop") return ctx.deferUpdate();
  const list = loadEmbeds(ctx, ctx.guildId);
  if (!list.length) {
    return ctx.update({
      embeds: [{ title: "Embed List", description: "No embeds saved yet.", color: (ctx.colors && ctx.colors.v1) || 0x5865f2 }],
      components: [],
      allowed_mentions: { parse: [] }
    });
  }
  const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  let target = page;
  if (action === "first") target = 1;
  else if (action === "prev") target = page - 1;
  else if (action === "next") target = page + 1;
  else if (action === "last") target = totalPages;
  return ctx.update(buildListPayload(ctx, list, target, viewerId));
}

async function handleModal(ctx) {
  const cid = String(ctx.customId || "");
  if (cid.indexOf(MODAL_NS + ":") !== 0) return false;
  const parts = cid.split(":");
  const action = parts[1] || "";
  const viewerId = parts[2] || "";
  const userId = getUserId(ctx);
  if (viewerId && userId !== viewerId) {
    return ctx.replyWarn("Only <@" + viewerId + "> can use this builder.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  const draft = loadDraft(ctx, ctx.guildId, userId);
  if (!draft) {
    return ctx.replyWarn("This builder session has ended \u2014 use `/embed set` to start a new one.", { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  const sKey = sessionKey(ctx.guildId, userId);
  const activeSess = (ctx.session && typeof ctx.session.getSession === "function" && ctx.session.getSession(sKey)) || null;
  if (activeSess && activeSess.updatedAt) {
    draft.updatedAt = Math.max(draft.updatedAt || 0, activeSess.updatedAt);
  }
  const result = applyModalFields(draft, action, ctx.fields || {});
  if (result.error) {
    return ctx.replyWarn(result.error, { ephemeral: true, allowed_mentions: { parse: [] } });
  }
  draft.updatedAt = Date.now();
  saveDraft(ctx, ctx.guildId, userId, draft);
  scheduleExpiry(ctx, ctx.guildId, draft);
  if (!ctx.defer(true)) return;
  if (draft.builderCid && draft.builderMid) {
    try { await ctx.editMessage(draft.builderCid, draft.builderMid, buildBuilderPayload(ctx, draft, false)); } catch (e) {}
  }
  return ctx.editReply({
    embeds: [{
      title: "Embed Builder",
      description: "**" + draft.name + "** \u2014 " + result.label + " updated.",
      color: (ctx.colors && ctx.colors.v1) || 0x5865f2
    }],
    allowed_mentions: { parse: [] }
  });
}

async function handleAutocomplete(ctx) {
  const focused = findFocused(ctx.interaction && ctx.interaction.data && ctx.interaction.data.options);
  if (!focused || String(focused.name) !== "name") return ctx.respondAutocomplete([]);
  const q = String(focused.value || "").toLowerCase();
  const list = loadEmbeds(ctx, ctx.guildId);
  const matches = list.filter(function (e) {
    return e && e.nameKey && (!q || e.nameKey.indexOf(q) !== -1);
  }).slice(0, 25);
  return ctx.respondAutocomplete(matches.map(function (e) {
    return { name: String(e.name).slice(0, 100), value: e.name };
  }));
}

async function onCommand(ctx) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used in a server.", NO_PING);
  }
  const sub = String(ctx.subcommand || "").toLowerCase();
  if (sub === "set") return handleSetCommand(ctx);
  if (sub === "edit") return handleEditCommand(ctx);
  if (sub === "delete") return handleDeleteCommand(ctx);
  if (sub === "view") return handleViewCommand(ctx);
  if (sub === "list") return handleListCommand(ctx);
  return ctx.replyWarn("Unknown subcommand \u2014 try `/embed set`, `/embed edit`, `/embed delete`, `/embed view`, or `/embed list`.", NO_PING);
}

module.exports = {
  name: "Embed Builder",
  description: "Live-preview embed builder with named saves and autocomplete.",
  version: "1.0.0",
  commands: [
    {
      name: "embed",
      description: "Build and manage saved embeds with a live preview",
      slash: true,
      prefix: false,
      cooldown: 3,
      category: "Utility",
      options: [
        {
          type: 1,
          name: "set",
          description: "Create a new named embed with the live builder",
          options: [
            { type: 3, name: "name", description: "Unique name for this embed (1-32 chars)", required: true, max_length: 32 }
          ]
        },
        {
          type: 1,
          name: "edit",
          description: "Open the builder for an existing embed",
          options: [
            { type: 3, name: "name", description: "Embed name", required: true, autocomplete: true, max_length: 32 }
          ]
        },
        {
          type: 1,
          name: "delete",
          description: "Delete a saved embed",
          options: [
            { type: 3, name: "name", description: "Embed name", required: true, autocomplete: true, max_length: 32 }
          ]
        },
        {
          type: 1,
          name: "view",
          description: "Send or preview a saved embed in a channel",
          options: [
            { type: 3, name: "name", description: "Embed name", required: true, autocomplete: true, max_length: 32 },
            { type: 7, name: "channel", description: "Channel to send embed to (optional, defaults to current channel)", required: false, channel_types: [0, 5] }
          ]
        },
        {
          type: 1,
          name: "list",
          description: "List all saved embeds in this server"
        }
      ]
    }
  ],
  onCommand: onCommand,
  buttons: {
    "ebui:*": handleBuilderButton,
    "ebli:*": handleListButton
  },
  modals: {
    "ebmod:*": handleModal
  },
  autocompletes: {
    embed: handleAutocomplete
  }
};
