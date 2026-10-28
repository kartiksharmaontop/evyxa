# Arixa Plugin Developer Guide

Welcome to the **Arixa Plugin Development Guide**. This comprehensive reference covers everything you need to create fast, crash-proof, and modern Discord plugins for Arixa bots without inspecting the core engine source code.

---

## 📑 Table of Contents

- [1. Plugin Folder Structure](#1-plugin-folder-structure)
- [2. Metadata & Dashboard Configuration (`readme.md`)](#2-metadata--dashboard-configuration-readmemd)
- [3. Golden Rule: No Hardcoded Colors](#3-golden-rule-no-hardcoded-colors)
- [4. Built-in System Alert Standard (`warn`, `error`, `cooldown`)](#4-built-in-system-alert-standard-warn-error-cooldown)
- [5. Custom Command Cooldowns (`ctx.cooldown`)](#5-custom-command-cooldowns-ctxcooldown)
- [6. Context (`ctx`) API Reference](#6-context-ctx-api-reference)
- [7. Persistent Storage & Bot Configuration](#7-persistent-storage--bot-configuration)
- [8. Complete Beginner-Friendly Plugin Template](#8-complete-beginner-friendly-plugin-template)

---

## 1. Plugin Folder Structure

Every Arixa plugin lives in its own directory with two required files:

```text
my-plugin/
├── readme.md       Metadata, description, and dashboard settings schema
└── main/
    └── index.js    Plugin logic, command handlers, and gateway events
```

- **`readme.md`**: Defines your plugin name, description, version, and the settings fields that appear in the Bot Owner Dashboard.
- **`main/index.js`**: Contains your plugin export, command definitions, permissions, and execution handlers.

---

## 2. Metadata & Dashboard Configuration (`readme.md`)

The `readme.md` file uses YAML frontmatter at the top, followed by a markdown description, and an optional ````config```` JSON block that automatically generates UI settings in the web dashboard.

### Example `readme.md`:

```markdown
---
name: Announcement System
tag: Utility
description: Broadcast formatted announcements across server channels with Components V2 cards.
version: 1.0.0
author: @community
---

# Announcement System
Send clean, formatted announcements using bot theme accents and permission controls.

```config
{
  "fields": [
    { "key": "default_channel", "label": "Default Channel ID", "type": "text", "default": "" },
    { "key": "mention_everyone", "label": "Mention Everyone", "type": "toggle", "default": "false" },
    { "key": "emoji_icon", "label": "Announcement Icon Emoji", "type": "text", "default": "📢" }
  ]
}
```
```

### Supported Field Types:
- **`text`**: Standard text input (strings, channel IDs, emoji characters).
- **`toggle`**: Boolean switch (`"true"` or `"false"`).
- **`number`**: Numeric values (counts, intervals, thresholds).

Inside your code, read these values anytime using `ctx.config.<key>`.

---

## 3. Golden Rule: No Hardcoded Colors

> [!IMPORTANT]
> **Never hardcode hex colors** (such as `#ED4245` or `0x5865F2`) inside your plugin.
> Bot owners choose their unified color palette directly in the **Bot Dashboard &rarr; Theme Colors**. Every plugin must dynamically use the bot's configured colors.

### Bot Theme Keys (`ctx.colors`):

| Property | Type | Description | Where to Use |
| :--- | :--- | :--- | :--- |
| `ctx.colors.v1` / `ctx.color` | `number` | Main Embed Color | V1 Discord Embeds (`ctx.replyEmbed`). |
| `ctx.colors.v2` | `number` | Main Container Accent | Discord Components V2 Containers (`type: 17`). |
| `ctx.colors.warning` | `number` | System Warning Accent | Automatically used by `ctx.replyWarn()`. |
| `ctx.colors.error` | `number` | System Error Accent | Automatically used by `ctx.replyError()`. |
| `ctx.colors.cooldown` | `number` | System Cooldown Accent | Automatically used by `ctx.replyCooldown()`. |

---

## 4. Built-in System Alert Standard (`warn`, `error`, `cooldown`)

Never build custom error boxes or fake warning cards. Always use Arixa's native system alert helpers so all warnings, errors, and cooldowns look identical and consistent across every installed plugin.

### 1. Warning Notice (`ctx.replyWarn`)
Use for missing permissions, invalid arguments, or server-only command restrictions:

```javascript
if (!ctx.guildId) {
  return ctx.replyWarn("This command can only be used inside a server.");
}

if (!ctx.hasPermission("MANAGE_MESSAGES")) {
  return ctx.replyWarn("You need Manage Messages permission to use this command.");
}

if (!args[0]) {
  return ctx.replyWarn("Please provide a valid text input.");
}
```

- **Visuals:** Bot's warning color accent + system warning emoji (`⚠️`).
- **Auto-Delete:** Automatically deletes after **10 seconds** to keep channels clean.

### 2. Error Notice (`ctx.replyError`)
Use for caught runtime exceptions, failed API requests, or hierarchy errors:

```javascript
try {
  await performAction();
} catch (err) {
  return ctx.replyError("Operation failed: " + err.message);
}
```

- **Visuals:** Bot's error color accent + system error emoji (`❌`).
- **Auto-Delete:** Automatically deletes after **10 seconds**.

### 3. Success Notice (`ctx.replySuccess`)
Use for confirming actions:

```javascript
return ctx.replySuccess("Successfully updated settings.");
```

- **Visuals:** Bot's Main V2 container accent color + success emoji (`✅`).

---

## 5. Custom Command Cooldowns (`ctx.cooldown`)

Every plugin can set custom cooldown times per command to prevent spam.

### One-Line Automatic Cooldown:
Call `ctx.cooldown(seconds)` at the beginning of your command handler:

```javascript
if (!ctx.cooldown(5)) return;
```

- Returns `true` if the user is allowed to run the command.
- Returns `false` and automatically displays the system animated cooldown alert with the remaining seconds if the user is rate-limited.
- Set any duration you need: `ctx.cooldown(3)` (fast commands), `ctx.cooldown(15)` (moderation), `ctx.cooldown(60)` (heavy tasks).

---

## 6. Context (`ctx`) API Reference

Every command execution receives a rich `ctx` object containing all necessary data:

| Property / Method | Return Type | Description |
| :--- | :--- | :--- |
| `ctx.guildId` | `string \| null` | ID of the current Discord server (`null` in direct messages). |
| `ctx.guildName` | `string \| null` | Name of the current Discord server. |
| `ctx.channelId` | `string` | ID of the channel where the command was executed. |
| `ctx.user.id` | `string` | Discord ID of the user who triggered the command. |
| `ctx.user.username` | `string` | Username of the command author. |
| `ctx.member` | `object \| null` | Guild member object including server roles and permissions. |
| `ctx.hasPermission(name)` | `boolean` | Checks if user has a permission (e.g. `"ADMINISTRATOR"`, `"MANAGE_GUILD"`). |
| `ctx.isServerOwner` | `boolean` | `true` if the command author is the Discord server owner. |
| `ctx.options` | `object` | Parsed options object for both slash and prefix commands. |
| `ctx.rawArgs` | `string[]` | Array of words following the command name (prefix commands). |
| `ctx.rawText` | `string` | Full raw text following the command name. |
| `ctx.config` | `object` | Key-value settings configured by the bot owner in Dashboard. |
| `ctx.storage` | `object` | Persistent storage instance isolated to this plugin and bot. |
| `ctx.cooldown(seconds)` | `boolean` | Automatically tracks rate limits and sends cooldown warnings. |
| `ctx.replyWarn(message)` | `Promise` | Sends a standardized auto-deleting warning card. |
| `ctx.replyError(message)` | `Promise` | Sends a standardized auto-deleting error card. |
| `ctx.replySuccess(message)` | `Promise` | Sends a standardized Components V2 success card. |
| `ctx.reply(payload)` | `Promise` | Sends a custom message or Components V2 container. |
| `ctx.sendChannel(id, payload)` | `Promise` | Sends a message directly to a target channel ID. |

---

## 7. Persistent Storage & Bot Configuration

Arixa provides an isolated, persistent JSON database for each plugin per bot. Data is stored safely with atomic file writes and automatic backup recovery.

### Reading & Writing Data:

```javascript
const currentCount = ctx.storage.get("user_points_" + ctx.user.id, 0);

ctx.storage.set("user_points_" + ctx.user.id, currentCount + 10);

ctx.storage.delete("user_points_" + ctx.user.id);
```

- `ctx.storage.get(key, defaultValue)`: Retrieves a stored value. If the key does not exist, returns `defaultValue`.
- `ctx.storage.set(key, value)`: Atomically saves data to disk.
- `ctx.storage.delete(key)`: Removes a key from storage.

---

## 8. Complete Beginner-Friendly Plugin Template

Here is a complete, production-ready plugin template you can copy and customize:

```javascript
module.exports = {
  name: "welcome",
  version: "1.0.0",
  description: "Custom server welcome card manager",

  commands: [
    {
      name: "welcome",
      description: "Manage welcome greeting settings",
      slash: true,
      prefix: true,
      cooldown: 5,
      options: [
        {
          type: 1,
          name: "view",
          description: "View current welcome channel settings"
        },
        {
          type: 1,
          name: "set",
          description: "Set the welcome channel for this server",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Target channel to send greetings",
              required: true
            }
          ]
        }
      ]
    }
  ],

  onCommand: async function (ctx) {
    if (!ctx.guildId) {
      return ctx.replyWarn("This command can only be used inside a server.");
    }

    if (typeof ctx.cooldown === "function" && !ctx.cooldown(5)) {
      return;
    }

    const sub = String(ctx.subcommand || "view").toLowerCase();

    if (sub === "set") {
      if (!ctx.hasPermission("MANAGE_GUILD")) {
        return ctx.replyWarn("You need Manage Server permission to configure the welcome channel.");
      }

      const targetChannel = ctx.options.channel && ctx.options.channel.id;
      if (!targetChannel) {
        return ctx.replyWarn("Please mention a valid channel.");
      }

      ctx.storage.set("welcome_channel_" + ctx.guildId, targetChannel);
      return ctx.replySuccess("Successfully set welcome channel to <#" + targetChannel + ">");
    }

    const savedChannel = ctx.storage.get("welcome_channel_" + ctx.guildId, null);
    if (!savedChannel) {
      return ctx.replySuccess("No welcome channel configured for this server. Use `/welcome set` to configure.");
    }

    return ctx.replySuccess("Current welcome channel is set to <#" + savedChannel + ">");
  },

  events: {
    GUILD_MEMBER_ADD: function (member, ctx) {
      if (!member || !member.guild_id) return;
      const targetChannel = ctx.storage.get("welcome_channel_" + member.guild_id, null);
      if (!targetChannel) return;

      const welcomeText = "Welcome to the server, <@" + member.user.id + ">!";
      ctx.sendChannel(targetChannel, { content: welcomeText });
    }
  }
};
```
