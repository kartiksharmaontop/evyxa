"use strict";

function getUser(ctx) {
  return (ctx && (ctx.user || ctx.author)) || {};
}

function getUserId(ctx) {
  const u = getUser(ctx);
  return u && u.id ? String(u.id) : "";
}

function resolvePing(ctx) {
  let p = null;
  if (typeof ctx.ping === "number" && ctx.ping > 0) p = ctx.ping;
  else if (typeof ctx.botPing === "number" && ctx.botPing > 0) p = ctx.botPing;
  else if (typeof ctx.wsPing === "number" && ctx.wsPing > 0) p = ctx.wsPing;
  else if (typeof ctx.getBotPing === "function") {
    const val = ctx.getBotPing();
    if (typeof val === "number" && val > 0) p = val;
  }
  return p !== null ? Math.round(p) : 0;
}

async function onCommand(ctx) {
  const uid = getUserId(ctx);
  const mention = uid ? "<@" + uid + ">" : "there";
  const pingMs = resolvePing(ctx);

  const text = `🏓 **| ${mention} Pong ${pingMs}ms **.`;

  return ctx.reply({
    content: text,
    allowed_mentions: { parse: [] }
  });
}

module.exports = {
  name: "Ping V1",
  description: "Simple, ultra-fast latency check showing real WebSocket ping.",
  version: "1.0.0",
  commands: [
    {
      name: "ping",
      description: "Check bot latency and response time",
      slash: true,
      prefix: true,
      cooldown: 3,
      category: "Utility",
      aliases: ["latency", "pong", "p"]
    }
  ],
  onCommand: onCommand
};
