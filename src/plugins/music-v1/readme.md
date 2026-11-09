---
name: Music V1
tag: Music
description: High-performance audio player with Lavalink V4/V3, minimal customizable embeds, and bot owner node monitoring.
version: 1.0.0
author: @community
---

# Music V1

A clean, high-performance music player powered by Lavalink V4/V3 audio servers with minimal modern embeds and customizable dashboard controls.

::: card 🎵 Key Highlights
* **Universal Search**: Supports YouTube, SoundCloud, Spotify, and direct audio stream links.
* **Minimalist Embeds**: Clean English typography with track thumbnails, duration, requester tag, and no cluttered progress bars.
* **Customizable Icons**: Customize play, pause, queue, stop, and skip emojis directly from the Bot Dashboard.
* **Protected Node Monitoring**: `/lavalink` command displays node health, ping, and memory for bot owners while keeping node credentials completely hidden.
* **Auto-Resource Saving**: Disconnects automatically after idle timeout to conserve server memory and network bandwidth. No 24/7 or autoplay bloat.
:::

### Commands

| Command | Permission | Description |
| :--- | :---: | :--- |
| `/play <query>` | Everyone | Search or URL play, automatically connects to your voice channel. |
| `/pause` | Everyone | Pause current playback. |
| `/resume` | Everyone | Resume paused playback. |
| `/skip` | Everyone | Skip the current track to the next song in the queue. |
| `/stop` | Everyone | Stop playback, clear the queue, and leave the voice channel. |
| `/nowplaying` | Everyone | View current track details with volume and loop status. |
| `/queue [page]` | Everyone | Display upcoming songs in a clean numbered list with pagination. |
| `/volume [1-100]` | Everyone | Check or adjust the playback volume. |
| `/seek <time>` | Everyone | Jump to a timestamp (e.g. `1:30` or `90`). |
| `/shuffle` | Everyone | Randomize the order of upcoming tracks in the queue. |
| `/loop [mode]` | Everyone | Toggle loop mode (`off`, `track`, `queue`). |
| `/lavalink` | **Bot Owner Only** | View audio node status, ping, and memory (credentials hidden). |

```config
{
  "fields": [
    {
      "key": "lavalink_host",
      "label": "Lavalink Host / IP",
      "type": "text",
      "default": "127.0.0.1",
      "description": "Host URL or IP of your Lavalink node"
    },
    {
      "key": "lavalink_port",
      "label": "Lavalink Port",
      "type": "number",
      "default": "2333",
      "description": "Port number of your Lavalink server (e.g. 2333 or 443)"
    },
    {
      "key": "lavalink_pass",
      "label": "Lavalink Password",
      "type": "password",
      "default": "youshallnotpass",
      "description": "Secret authorization password for Lavalink"
    },
    {
      "key": "lavalink_secure",
      "label": "Enable SSL / WSS",
      "type": "toggle",
      "default": "false",
      "description": "Turn ON if using HTTPS / WSS secure connection"
    },
    {
      "key": "default_volume",
      "label": "Default Starting Volume",
      "type": "number",
      "default": "80",
      "description": "Default player volume percentage (1 to 100)"
    },
    {
      "key": "emoji_play",
      "label": "Play Icon",
      "type": "text",
      "default": "▶",
      "description": "Emoji displayed on now playing alerts"
    },
    {
      "key": "emoji_queue",
      "label": "Queue Icon",
      "type": "text",
      "default": "🎵",
      "description": "Emoji displayed when tracks are queued"
    },
    {
      "key": "emoji_pause",
      "label": "Pause Icon",
      "type": "text",
      "default": "⏸",
      "description": "Emoji displayed when playback is paused"
    },
    {
      "key": "emoji_stop",
      "label": "Stop Icon",
      "type": "text",
      "default": "⏹",
      "description": "Emoji displayed when playback is stopped"
    },
    {
      "key": "emoji_skip",
      "label": "Skip Icon",
      "type": "text",
      "default": "⏭",
      "description": "Emoji displayed when tracks are skipped"
    }
  ]
}
```

> [!TIP]
> Ensure your Lavalink node is running and accessible from this machine. You can test your connection anytime using the owner-only `/lavalink` command!
