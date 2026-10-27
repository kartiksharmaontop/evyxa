const https = require("https");

const state = {
  token: "",
  login: "",
  uptime: "",
  create: "",
  footer: ""
};

function configure(env) {
  env = env || {};
  state.token = String(env.TOKEN || "").trim();
  state.login = String(env.USER_LOGIN || "").trim();
  state.uptime = String(env.BOT_UPTIME || "").trim();
  state.create = String(env.BOT_CREATE || "").trim();
  state.footer = String(env.FOOTER || "").trim();
}

function post(channelId, body) {
  const payload = JSON.stringify(body);
  const req = https.request({
    hostname: "discord.com",
    path: "/api/v10/channels/" + channelId + "/messages",
    method: "POST",
    headers: {
      Authorization: "Bot " + state.token,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    }
  }, function (res) {
    res.on("data", function () {});
    res.on("end", function () {});
  });
  req.on("error", function () {});
  req.write(payload);
  req.end();
}

function avatarUrl(id, avatar) {
  if (avatar) return "https://cdn.discordapp.com/avatars/" + id + "/" + avatar + ".png?size=64";
  try {
    return "https://cdn.discordapp.com/embed/avatars/" + (Number(BigInt(String(id)) >> 22n) % 6) + ".png";
  } catch (e) {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

function send(channelId, opts) {
  channelId = String(channelId || "").trim();
  opts = opts || {};
  if (!channelId || !state.token) return;
  const texts = [];
  if (opts.title) texts.push({ type: 10, content: "**" + opts.title + "**" });
  if (opts.lines && opts.lines.length) texts.push({ type: 10, content: opts.lines.join("\n") });
  const parts = [];
  if (opts.thumbnail) {
    parts.push({ type: 9, components: texts, accessory: { type: 11, media: { url: opts.thumbnail } } });
  } else {
    texts.forEach(function (t) { parts.push(t); });
  }
  parts.push({ type: 14, spacing: 1, divider: true });
  if (state.footer) parts.push({ type: 10, content: state.footer });
  post(channelId, {
    flags: 32768,
    components: [{
      type: 17,
      spoiler: false,
      accent_color: typeof opts.accent === "number" ? opts.accent : 0x5865f2,
      components: parts
    }]
  });
}

function guildCount(token, cb) {
  token = String(token || "").trim();
  if (!token) return cb(null);
  const req = https.request({
    hostname: "discord.com",
    path: "/api/users/@me/guilds",
    method: "GET",
    headers: { Authorization: "Bot " + token }
  }, function (res) {
    let data = "";
    res.on("data", function (c) { data += c; });
    res.on("end", function () {
      let json = null;
      try { json = JSON.parse(data); } catch (e) {}
      cb(json && Array.isArray(json) ? json.length : null);
    });
  });
  req.on("error", function () { cb(null); });
  req.end();
}

function login(user) {
  user = user || {};
  send(state.login, {
    accent: 0x3ba55d,
    title: "User Logged In",
    lines: [
      "**User** — " + (user.username || "Unknown"),
      "**User ID** — `" + user.id + "`"
    ],
    thumbnail: avatarUrl(user.id, user.avatar)
  });
}

function botAdded(bot, actor, token) {
  bot = bot || {};
  actor = actor || {};
  guildCount(token, function (count) {
    send(state.create, {
      accent: 0x5865f2,
      title: "Bot Added",
      lines: [
        "**Added By** — " + (actor.name || "Unknown") + " (`" + actor.id + "`)",
        "**Bot Name** — " + (bot.username || "Unknown"),
        "**Bot ID** — `" + bot.id + "`",
        "**Servers** — " + (count === null ? "Unknown" : String(count))
      ],
      thumbnail: avatarUrl(bot.id, bot.avatar)
    });
  });
}

const ACTIONS = {
  started: { accent: 0x3ba55d, title: "Bot Started" },
  stopped: { accent: 0xed4245, title: "Bot Stopped" },
  restarted: { accent: 0xfaa61a, title: "Bot Restarted" }
};

function botAction(action, bot, actor) {
  const info = ACTIONS[action];
  if (!info) return;
  bot = bot || {};
  actor = actor || null;
  send(state.uptime, {
    accent: info.accent,
    title: info.title,
    lines: [
      "**By** — " + (actor ? (actor.name || "Unknown") + " (`" + actor.id + "`)" : "Automatic (server boot)"),
      "**Bot** — " + (bot.username || "Unknown") + " (`" + bot.id + "`)"
    ]
  });
}

module.exports = {
  configure,
  login,
  botAdded,
  botAction,
  guildCount,
  send,
  avatarUrl
};
