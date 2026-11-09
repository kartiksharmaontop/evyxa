const lavalink = require("./lavalink.js");

function resolveEmoji(input, fallback) {
  if (!input || typeof input !== "string") return fallback;
  const s = input.trim();
  if (!s) return fallback;
  if (/^<a?:[a-zA-Z0-9_]+:\d{17,20}>$/.test(s)) return s;
  return s;
}

function getEmojis(ctx) {
  const cfg = (ctx && ctx.config) || {};
  return {
    play: resolveEmoji(cfg.emoji_play, "▶"),
    queue: resolveEmoji(cfg.emoji_queue, "🎵"),
    pause: resolveEmoji(cfg.emoji_pause, "⏸"),
    stop: resolveEmoji(cfg.emoji_stop, "⏹"),
    skip: resolveEmoji(cfg.emoji_skip, "⏭")
  };
}

function isBotOwner(ctx) {
  const uid = ctx.user && String(ctx.user.id);
  if (!uid) return false;
  if (ctx.isServerOwner) return true;
  const configured = String((ctx && ctx.ownerIds) || "").split(/[\s,;]+/);
  for (let i = 0; i < configured.length; i++) {
    const d = configured[i].replace(/\D/g, "");
    if (d && d === uid) return true;
  }
  return false;
}

function resolveVoiceChannel(ctx) {
  if (typeof ctx.getVoiceChannelId === "function") {
    const cid = ctx.getVoiceChannelId();
    if (cid) return cid;
  }
  if (ctx.voiceChannelId) return ctx.voiceChannelId;
  return null;
}

async function handlePlay(ctx) {
  if (!ctx.guildId) {
    return ctx.replyWarn("This command can only be used in a server.");
  }

  const voiceCh = resolveVoiceChannel(ctx);
  if (!voiceCh) {
    return ctx.replyWarn("You must be connected to a voice channel to play music.");
  }

  const botVoice = typeof ctx.getVoiceChannelId === "function" ? ctx.getVoiceChannelId(ctx.botId) : null;
  if (botVoice && botVoice !== voiceCh) {
    return ctx.replyWarn("I am already playing in <#" + botVoice + ">. Please join that voice channel.");
  }

  let query = "";
  if (ctx.options && ctx.options.query) {
    query = String(ctx.options.query).trim();
  } else if (Array.isArray(ctx.rawArgs) && ctx.rawArgs.length > 0) {
    query = ctx.rawArgs.join(" ").trim();
  }

  if (!query) {
    return ctx.replyWarn("Please provide a song name or URL to play.");
  }

  const emojis = getEmojis(ctx);
  const node = lavalink.getNode(ctx);
  const cfg = lavalink.getNodeConfig(ctx);

  let searchRes = null;
  try {
    searchRes = await lavalink.loadTracks(cfg, query);
  } catch (err) {
    return ctx.replyError("Could not connect to the audio node. Please verify Lavalink settings.");
  }

  if (!searchRes || !searchRes.tracks || searchRes.tracks.length === 0) {
    return ctx.replyWarn("No search results were found for your query.");
  }

  const player = lavalink.createPlayer(ctx, voiceCh);
  if (typeof ctx.sendVoiceStateUpdate === "function") {
    ctx.sendVoiceStateUpdate(ctx.guildId, voiceCh, false, false);
  }

  const requesterId = ctx.user && ctx.user.id;

  // Handle Playlist (YouTube playlist, Spotify album/playlist)
  if (searchRes.loadType === "playlist" && Array.isArray(searchRes.tracks) && searchRes.tracks.length > 0) {
    const list = searchRes.tracks;
    list.forEach(function (t) { t.requesterId = requesterId; });
    const playlistName = searchRes.name || "Playlist";

    if (!player.current) {
      player.current = list[0];
      player.position = 0;
      player.paused = false;
      for (let i = 1; i < list.length; i++) {
        player.queue.push(list[i]);
      }
      if (node.online && player.voiceServer && player.voiceState) {
        node.play(player, player.current);
      }
    } else {
      for (let i = 0; i < list.length; i++) {
        player.queue.push(list[i]);
      }
    }

    return ctx.replyEmbed({
      title: emojis.queue + " Added Playlist to Queue",
      description: "**" + playlistName + "** (" + list.length + " songs) • By <@" + requesterId + ">"
    });
  }

  const track = searchRes.tracks[0];
  track.requesterId = requesterId;

  // If a track is already playing, add to queue
  if (player.current) {
    player.queue.push(track);
    const position = player.queue.length;

    return ctx.replyEmbed({
      title: emojis.queue + " Added to Queue",
      description: "[" + track.title + "](" + (track.uri || "https://discord.com") + ") • `" + lavalink.formatDuration(track.length) + "` • #" + position + " • By <@" + requesterId + ">",
      thumbnail: track.thumbnail ? { url: track.thumbnail } : undefined
    });
  }

  // Otherwise start playing immediately
  player.current = track;
  player.position = 0;
  player.paused = false;

  if (node.online && player.voiceServer && player.voiceState) {
    node.play(player, track);
  }

  return ctx.replyEmbed({
    title: emojis.play + " Now Playing",
    description: "[" + track.title + "](" + (track.uri || "https://discord.com") + ")\n" +
      "```yaml\n" +
      "Author   : " + track.author + "\n" +
      "Duration : " + lavalink.formatDuration(track.length) + "\n" +
      "Volume   : " + player.volume + "%\n" +
      "```\n" +
      "By <@" + requesterId + ">",
    thumbnail: track.thumbnail ? { url: track.thumbnail } : undefined
  });
}

async function handlePause(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || !player.current) {
    return ctx.replyWarn("There is no music currently playing.");
  }
  if (player.paused) {
    return ctx.replyWarn("The music is already paused. Use `/resume` to continue.");
  }
  const emojis = getEmojis(ctx);
  const node = lavalink.getNode(ctx);
  await node.setPause(player, true);
  return ctx.replyEmbed({
    description: emojis.pause + " Playback has been paused. Type `/resume` to continue."
  });
}

async function handleResume(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || !player.current) {
    return ctx.replyWarn("There is no music currently playing.");
  }
  if (!player.paused) {
    return ctx.replyWarn("The music is already playing.");
  }
  const emojis = getEmojis(ctx);
  const node = lavalink.getNode(ctx);
  await node.setPause(player, false);
  return ctx.replyEmbed({
    description: emojis.play + " Playback has been resumed."
  });
}

async function handleSkip(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || !player.current) {
    return ctx.replyWarn("There is no music currently playing to skip.");
  }
  const emojis = getEmojis(ctx);
  const skippedTitle = player.current.title;
  const skippedUri = player.current.uri;
  const node = lavalink.getNode(ctx);

  lavalink.playNext(player, node);

  return ctx.replyEmbed({
    description: emojis.skip + " Skipped track: [" + skippedTitle + "](" + (skippedUri || "https://discord.com") + ")"
  });
}

async function handleStop(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player) {
    return ctx.replyWarn("There is no active music session to stop.");
  }
  const emojis = getEmojis(ctx);
  lavalink.destroyPlayer(ctx.guildId, ctx);
  return ctx.replyEmbed({
    description: emojis.stop + " Playback stopped, queue cleared, and left the voice channel."
  });
}

async function handleNowPlaying(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || !player.current) {
    return ctx.replyWarn("There is no music currently playing.");
  }
  const emojis = getEmojis(ctx);
  const track = player.current;
  const loopStatus = player.loop === "track" ? "Track" : (player.loop === "queue" ? "Queue" : "Off");
  const requesterId = track.requesterId || (ctx.user && ctx.user.id);

  return ctx.replyEmbed({
    title: emojis.play + " Now Playing",
    description: "[" + track.title + "](" + (track.uri || "https://discord.com") + ")\n" +
      "```yaml\n" +
      "Author   : " + track.author + "\n" +
      "Duration : " + lavalink.formatDuration(track.length) + "\n" +
      "Volume   : " + player.volume + "%\n" +
      "Loop     : " + loopStatus + "\n" +
      "```\n" +
      "By <@" + requesterId + ">",
    thumbnail: track.thumbnail ? { url: track.thumbnail } : undefined
  });
}

async function handleQueue(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || (!player.current && player.queue.length === 0)) {
    return ctx.replyWarn("The music queue is currently empty.");
  }

  let page = 1;
  if (ctx.options && ctx.options.page) {
    page = parseInt(ctx.options.page, 10) || 1;
  } else if (Array.isArray(ctx.rawArgs) && ctx.rawArgs[0]) {
    page = parseInt(ctx.rawArgs[0], 10) || 1;
  }

  const PER_PAGE = 5;
  const totalTracks = player.queue.length;
  const totalPages = Math.max(1, Math.ceil(totalTracks / PER_PAGE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * PER_PAGE;
  const pagedTracks = player.queue.slice(start, start + PER_PAGE);

  let desc = "";
  if (player.current) {
    desc += "**Currently Playing:**\n" +
      "▶ [" + player.current.title + "](" + (player.current.uri || "https://discord.com") + ") [" + lavalink.formatDuration(player.current.length) + "]\n" +
      "By <@" + player.current.requesterId + ">\n\n";
  }

  if (pagedTracks.length > 0) {
    desc += "**Up Next:**\n";
    pagedTracks.forEach(function (t, i) {
      const idx = start + i + 1;
      desc += idx + ". [" + t.title + "](" + (t.uri || "https://discord.com") + ") [" + lavalink.formatDuration(t.length) + "] - <@" + t.requesterId + ">\n";
    });
  } else if (totalTracks === 0) {
    desc += "*No more tracks in queue.*";
  }

  let totalDurationMs = player.current ? player.current.length : 0;
  player.queue.forEach(function (t) { totalDurationMs += t.length; });

  return ctx.replyEmbed({
    title: "Music Queue — " + (ctx.guildName || "Server"),
    description: desc,
    footer: {
      text: "Page " + currentPage + "/" + totalPages + " • " + (totalTracks + (player.current ? 1 : 0)) + " Tracks • Total Duration: " + lavalink.formatDuration(totalDurationMs)
    }
  });
}

async function handleVolume(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || !player.current) {
    return ctx.replyWarn("There is no music currently playing.");
  }

  let vol = null;
  if (ctx.options && ctx.options.amount !== undefined) {
    vol = parseInt(ctx.options.amount, 10);
  } else if (Array.isArray(ctx.rawArgs) && ctx.rawArgs[0]) {
    vol = parseInt(ctx.rawArgs[0], 10);
  }

  if (vol === null || isNaN(vol)) {
    return ctx.replyEmbed({
      description: "🔊 Current volume is **" + player.volume + "%**."
    });
  }

  if (vol < 1 || vol > 100) {
    return ctx.replyWarn("Please specify a valid volume between 1 and 100.");
  }

  const node = lavalink.getNode(ctx);
  await node.setVolume(player, vol);

  return ctx.replyEmbed({
    description: "🔊 Volume set to **" + vol + "%**."
  });
}

async function handleSeek(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || !player.current) {
    return ctx.replyWarn("There is no music currently playing.");
  }

  let raw = "";
  if (ctx.options && ctx.options.time) {
    raw = String(ctx.options.time).trim();
  } else if (Array.isArray(ctx.rawArgs) && ctx.rawArgs[0]) {
    raw = ctx.rawArgs.join(" ").trim();
  }

  const ms = lavalink.parseSeekTime(raw);
  if (ms === null || isNaN(ms) || ms < 0 || ms > player.current.length) {
    return ctx.replyWarn("Please provide a valid timestamp (e.g. `1:30` or `90`) within track length.");
  }

  const node = lavalink.getNode(ctx);
  await node.seek(player, ms);

  return ctx.replyEmbed({
    description: "⏩ Jumped to **" + lavalink.formatDuration(ms) + "** in [" + player.current.title + "](" + player.current.uri + ")."
  });
}

async function handleShuffle(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || player.queue.length < 2) {
    return ctx.replyWarn("Need at least 2 tracks in queue to shuffle.");
  }

  // Fisher-Yates shuffle
  for (let i = player.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = player.queue[i];
    player.queue[i] = player.queue[j];
    player.queue[j] = temp;
  }

  return ctx.replyEmbed({
    description: "🔀 Shuffled **" + player.queue.length + "** tracks in queue."
  });
}

async function handleLoop(ctx) {
  if (!ctx.guildId) return ctx.replyWarn("This command can only be used in a server.");
  const player = lavalink.getPlayer(ctx.guildId);
  if (!player || !player.current) {
    return ctx.replyWarn("There is no music currently playing.");
  }

  let mode = null;
  if (ctx.options && ctx.options.mode) {
    mode = String(ctx.options.mode).toLowerCase().trim();
  } else if (Array.isArray(ctx.rawArgs) && ctx.rawArgs[0]) {
    mode = String(ctx.rawArgs[0]).toLowerCase().trim();
  }

  if (mode === "track" || mode === "song" || mode === "current") {
    player.loop = "track";
  } else if (mode === "queue" || mode === "all") {
    player.loop = "queue";
  } else if (mode === "off" || mode === "disable") {
    player.loop = "off";
  } else {
    // Cycle modes if no argument
    player.loop = player.loop === "off" ? "track" : (player.loop === "track" ? "queue" : "off");
  }

  const label = player.loop === "track" ? "Current Track" : (player.loop === "queue" ? "Entire Queue" : "Disabled");
  return ctx.replyEmbed({
    description: "🔁 Loop mode set to **" + label + "**."
  });
}

async function handleLavalink(ctx) {
  if (!isBotOwner(ctx)) {
    return ctx.replyWarn("This command can only be used by the bot owner.");
  }

  const node = lavalink.getNode(ctx);
  const cfg = lavalink.getNodeConfig(ctx);

  // If node is not marked online, perform a quick health check
  if (!node.online) {
    try {
      const check = await lavalink.checkHealth(cfg);
      if (check && check.ok) {
        node.online = true;
        if (check.ping) node.ping = check.ping;
      }
    } catch (e) {}
  }

  // Security: Never reveal real IP, hostname, or password!
  const statusText = node.online ? "Online ✅" : "Offline ❌";
  const protocol = cfg.secure ? "Secure (SSL/WSS)" : "Standard (WS)";
  const playersCount = node.stats ? (node.stats.playingPlayers || 0) : 0;
  const totalPlayers = node.stats ? (node.stats.players || 0) : 0;
  const memUsedMb = node.stats && node.stats.memory ? Math.round(node.stats.memory.used / 1024 / 1024) : 0;
  const memAllocMb = node.stats && node.stats.memory ? Math.round(node.stats.memory.allocated / 1024 / 1024) : 0;
  const uptimeText = node.stats && node.stats.uptime ? lavalink.formatDuration(node.stats.uptime) : "N/A";

  return ctx.replyEmbed({
    title: "Lavalink Node Status",
    description: "• **Connection:** " + statusText + " (" + protocol + ")\n" +
      "• **Ping:** " + (node.ping || 15) + " ms\n" +
      "• **Active Players:** " + playersCount + " / " + totalPlayers + "\n" +
      "• **Memory:** " + memUsedMb + " MB / " + memAllocMb + " MB\n" +
      "• **Uptime:** " + uptimeText + "\n" +
      "• **Node Security:** Protected (Credentials Hidden)"
  });
}

async function onCommand(ctx) {
  const cmd = String(
    ctx.command ||
    ctx.commandName ||
    (ctx.interaction && ctx.interaction.data && ctx.interaction.data.name) ||
    ""
  ).toLowerCase().trim();

  switch (cmd) {
    case "play":
      return handlePlay(ctx);
    case "pause":
      return handlePause(ctx);
    case "resume":
      return handleResume(ctx);
    case "skip":
      return handleSkip(ctx);
    case "stop":
    case "leave":
      return handleStop(ctx);
    case "nowplaying":
      return handleNowPlaying(ctx);
    case "queue":
      return handleQueue(ctx);
    case "volume":
      return handleVolume(ctx);
    case "seek":
      return handleSeek(ctx);
    case "shuffle":
      return handleShuffle(ctx);
    case "loop":
      return handleLoop(ctx);
    case "lavalink":
      return handleLavalink(ctx);
  }
}

module.exports = {
  name: "Music V1",
  description: "High-performance clean audio player with Lavalink V4/V3, minimal customizable embeds, and bot owner node monitoring.",
  version: "1.0.0",

  config: [
    {
      key: "lavalink_host",
      label: "Lavalink Host / IP",
      type: "text",
      default: "127.0.0.1",
      description: "Host URL or IP of your Lavalink node"
    },
    {
      key: "lavalink_port",
      label: "Lavalink Port",
      type: "number",
      default: "2333",
      description: "Port number of your Lavalink server (e.g. 2333 or 443)"
    },
    {
      key: "lavalink_pass",
      label: "Lavalink Password",
      type: "password",
      default: "youshallnotpass",
      description: "Secret authorization password for Lavalink"
    },
    {
      key: "lavalink_secure",
      label: "Enable SSL / WSS",
      type: "toggle",
      default: "false",
      description: "Turn ON if using HTTPS / WSS secure connection"
    },
    {
      key: "default_volume",
      label: "Default Starting Volume",
      type: "number",
      default: "80",
      description: "Default player volume percentage (1 to 100)"
    },
    {
      key: "emoji_play",
      label: "Play Icon",
      type: "text",
      default: "▶",
      description: "Emoji displayed on now playing alerts"
    },
    {
      key: "emoji_queue",
      label: "Queue Icon",
      type: "text",
      default: "🎵",
      description: "Emoji displayed when tracks are queued"
    },
    {
      key: "emoji_pause",
      label: "Pause Icon",
      type: "text",
      default: "⏸",
      description: "Emoji displayed when playback is paused"
    },
    {
      key: "emoji_stop",
      label: "Stop Icon",
      type: "text",
      default: "⏹",
      description: "Emoji displayed when playback is stopped"
    },
    {
      key: "emoji_skip",
      label: "Skip Icon",
      type: "text",
      default: "⏭",
      description: "Emoji displayed when tracks are skipped"
    }
  ],

  commands: [
    {
      name: "play",
      description: "Play music from a search query or URL and join your voice channel",
      slash: true,
      prefix: true,
      options: [
        {
          name: "query",
          description: "Song name, artist, YouTube, SoundCloud, or Spotify URL",
          type: 3, // STRING
          required: true
        }
      ],
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "pause",
      description: "Pause the currently playing track",
      slash: true,
      prefix: true,
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "resume",
      description: "Resume paused playback",
      slash: true,
      prefix: true,
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "skip",
      description: "Skip the current track to the next song in queue",
      slash: true,
      prefix: true,
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "stop",
      description: "Stop playback, clear queue, and leave the voice channel",
      slash: true,
      prefix: true,
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "nowplaying",
      description: "Display details about the currently playing track",
      slash: true,
      prefix: true,
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "queue",
      description: "Display upcoming songs in the server music queue",
      slash: true,
      prefix: true,
      options: [
        {
          name: "page",
          description: "Queue page number",
          type: 4, // INTEGER
          required: false
        }
      ],
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "volume",
      description: "View or change playback volume (1-100)",
      slash: true,
      prefix: true,
      options: [
        {
          name: "amount",
          description: "Volume level from 1 to 100",
          type: 4, // INTEGER
          required: false
        }
      ],
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "seek",
      description: "Seek to a specific timestamp in the song",
      slash: true,
      prefix: true,
      options: [
        {
          name: "time",
          description: "Timestamp to seek to (e.g. 1:30 or 90)",
          type: 3, // STRING
          required: true
        }
      ],
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "shuffle",
      description: "Randomize all upcoming songs in the queue",
      slash: true,
      prefix: true,
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "loop",
      description: "Toggle loop mode for current track, entire queue, or off",
      slash: true,
      prefix: true,
      options: [
        {
          name: "mode",
          description: "Loop mode (off, track, queue)",
          type: 3, // STRING
          required: false,
          choices: [
            { name: "Off", value: "off" },
            { name: "Track", value: "track" },
            { name: "Queue", value: "queue" }
          ]
        }
      ],
      execute: onCommand,
      onCommand: onCommand
    },
    {
      name: "lavalink",
      description: "Check Lavalink audio node status and health (Bot Owner Only)",
      slash: true,
      prefix: true,
      execute: onCommand,
      onCommand: onCommand
    }
  ],

  events: {
    VOICE_STATE_UPDATE: function (ctx) {
      const data = ctx.data || {};
      const guildId = String(data.guild_id || "");
      const userId = String(data.user_id || "");
      if (!guildId) return;

      const player = lavalink.getPlayer(guildId);
      if (!player) return;

      const myId = String(ctx.botUserId || ctx.botId || "");
      if (!myId || userId === myId) {
        if (!data.channel_id) {
          lavalink.destroyPlayer(guildId, ctx);
          return;
        }
        player.voiceState = data;
        player.voiceChannelId = String(data.channel_id);
        const node = lavalink.getNode(ctx);
        if (player.voiceServer && player.voiceState && node.online) {
          if (player.current && !player.paused) {
            node.play(player, player.current);
          } else {
            node.updateVoice(player);
          }
        }
      }
    },

    VOICE_SERVER_UPDATE: function (ctx) {
      const data = ctx.data || {};
      const guildId = String(data.guild_id || "");
      if (!guildId) return;

      const player = lavalink.getPlayer(guildId);
      if (!player) return;

      player.voiceServer = data;
      const node = lavalink.getNode(ctx);
      if (player.voiceState && player.voiceServer && node.online) {
        if (player.current && !player.paused) {
          node.play(player, player.current);
        } else {
          node.updateVoice(player);
        }
      }
    }
  },

  onCommand: onCommand,
  execute: onCommand
};
