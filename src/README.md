# Arixa Plugin Developer Guide

Welcome to the **Arixa Plugin Development Guide**. This comprehensive reference covers everything you need to create fast, crash-proof, and modern Discord plugins for Arixa bots without inspecting the core engine source code.

---

## 📑 Table of Contents

- [1. Plugin Folder Structure](#1-plugin-folder-structure)
- [2. Metadata & Dashboard Configuration (`readme.md`)](#2-metadata--dashboard-configuration-readmemd)
- [3. Golden Rule: No Hardcoded Colors](#3-golden-rule-no-hardcoded-colors)
- [4. Built-in System Alert Standard (`warn`, `error`, `cooldown`)](#4-built-in-system-alert-standard-warn-error-cooldown)
- [5. Command Cooldowns & Rate Limiting](#5-command-cooldowns--rate-limiting)
- [6. Context (`ctx`) API Reference](#6-context-ctx-api-reference)
- [7. Discord Components V2 & Nested Buttons](#7-discord-components-v2--nested-buttons)
- [8. Safe Discord Moderation & Role Hierarchy](#8-safe-discord-moderation--role-hierarchy)
- [9. Persistent Storage & Bot Configuration](#9-persistent-storage--bot-configuration)
- [10. Complete Production Plugin Templates](#10-complete-production-plugin-templates)

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
Use for missing permissions, invalid arguments, role hierarchy blocks, or server-only command restrictions:

```javascript
if (!ctx.guildId) {
  return ctx.replyWarn("This command can only be used inside a server.");
}

if (!ctx.hasPermission("BAN_MEMBERS")) {
  return ctx.replyWarn("You need Ban Members permission to use this command.");
}

if (!targetId) {
  return ctx.replyWarn("Please mention a user or provide a user ID.");
}
```

- **Visuals:** Bot's warning color accent + system warning emoji (`⚠️`).
- **Auto-Delete:** Automatically deletes after **10 seconds** to keep channels clean.

### 2. Error Notice (`ctx.replyError`)
Use for caught runtime exceptions or fatal API failures:

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

## 5. Command Cooldowns & Rate Limiting

Arixa provides built-in rate-limiting at both the host and dispatcher level.

### Automatic Declarative Cooldown (Recommended)
Set `cooldown: <seconds>` directly in your command specification:

```javascript
commands: [
  {
    name: "ban",
    description: "Ban a member from the server",
    slash: true,
    prefix: true,
    cooldown: 5
  }
]
```

- When declared in `commands`, the engine automatically tracks cooldowns and responds with the animated system cooldown warning.
- Do not call `ctx.cooldown()` inside `onCommand` if `cooldown` is already declared in your command definition.

### Manual Cooldown Check
For subcommands or dynamic rate-limiting:

```javascript
if (typeof ctx.cooldown === "function" && !ctx.cooldown(10)) {
  return;
}
```

---

## 6. Context (`ctx`) API Reference

Every command execution receives a rich `ctx` object containing all necessary data:

| Property / Method | Return Type | Description |
| :--- | :--- | :--- |
| `ctx.guildId` | `string \| null` | ID of the current Discord server (`null` in direct messages). |
| `ctx.guildName` | `string \| null` | Name of the current Discord server. |
| `ctx.guildOwnerId` | `string \| null` | Discord ID of the server owner. |
| `ctx.channelId` | `string` | ID of the channel where the command was executed. |
| `ctx.user.id` | `string` | Discord ID of the user who triggered the command. |
| `ctx.user.username` | `string` | Username of the command author. |
| `ctx.botId` | `string` | Client application / bot ID. |
| `ctx.member` | `object \| null` | Guild member object including server roles and permissions. |
| `ctx.hasPermission(name)` | `boolean` | Checks if user has a permission (e.g. `"ADMINISTRATOR"`, `"BAN_MEMBERS"`). |
| `ctx.isServerOwner` | `boolean` | `true` if the command author is the Discord server owner. |
| `ctx.ownerIds` | `string` | Comma-separated owner user IDs saved in **Dashboard → Bot → Advanced Settings → Owner IDs** (empty string if none). |
| `ctx.isBotOwner([uid])` | `boolean` | `true` if `uid` (defaults to `ctx.user.id`) is listed in the dashboard Owner IDs. |
| `ctx.options` | `object` | Parsed options object for both slash and prefix commands. |
| `ctx.rawArgs` | `string[]` | Array of words following the command name (prefix commands). |
| `ctx.rawText` | `string` | Full raw text following the command name. |
| `ctx.config` | `object` | Key-value settings configured by the bot owner in Dashboard. |
| `ctx.storage` | `object` | Persistent storage instance isolated to this plugin and bot (`get`, `set`, `delete`). |
| `ctx.session` | `object` | Stateful interactive session engine (`create`, `get`, `getSession`, `touch`, `delete`) with automatic timer reset on button/modal clicks. |
| `ctx.ping` / `ctx.botPing` | `number` | Live Gateway WebSocket ping in milliseconds. |
| `ctx.uptime` / `ctx.botUptime` | `number` | Bot online uptime duration in seconds. |
| `ctx.cooldown(seconds)` | `boolean` | Automatically tracks rate limits and sends cooldown warnings. |
| `ctx.replyWarn(message)` | `Promise` | Sends a standardized auto-deleting warning card (10s TTL). |
| `ctx.replyError(message)` | `Promise` | Sends a standardized auto-deleting error card (10s TTL). |
| `ctx.replySuccess(message)` | `Promise` | Sends a standardized Components V2 success card. |
| `ctx.reply(payload)` | `Promise` | Sends a custom message or Components V2 container. |
| `ctx.defer(ephemeral)` | `boolean` | Acknowledges slash/modal interaction with thinking state. |
| `ctx.editReply(payload)` | `Promise` | Updates previously deferred interaction response. |
| `ctx.deleteReply()` | `Promise` | Deletes the interaction response message. |
| `ctx.deleteReplyAfter(ms)` | `void` | Deletes the interaction response after specified milliseconds. |
| `ctx.showModal(payload)` | `Promise` | Opens native Discord popup modal form (Type 9). |
| `ctx.respondAutocomplete(choices)` | `Promise` | Returns up to 25 live autocomplete suggestions (`[{ name, value }]`). |
| `ctx.sendChannel(id, payload)` | `Promise` | Sends a message directly to a target channel ID. |
| `ctx.fetchRoles(gid)` | `Promise<Role[]>` | Fetches guild roles with positions and permissions (cached 30s). |
| `ctx.fetchMember(gid, uid)` | `Promise<Response>` | Fetches a guild member and their roles. |
| `ctx.fetchBan(gid, uid)` | `Promise<Response>` | Fetches guild ban status for a user ID. |
| `ctx.banMember(gid, uid, opts)` | `Promise<Response>` | Bans a user via Discord API. Returns `{ status, body }`. |
| `ctx.unbanMember(gid, uid)` | `Promise<Response>` | Unbans a user via Discord API. Returns `{ status, body }`. |
| `ctx.kickMember(gid, uid)` | `Promise<Response>` | Kicks a member from the guild. |
| `ctx.timeoutMember(gid, uid, ms)` | `Promise<Response>` | Times out a member (pass `null` to remove timeout). |
| `ctx.deleteMessage(cid, mid)` | `Promise<Response>` | Deletes a message from a channel. |
| `ctx.editMessage(cid, mid, payload)` | `Promise<Response>` | Edits an existing channel message. |
| `ctx.update(payload)` | `Promise<Response>` | Updates the message of a button interaction. |
| `ctx.deferUpdate()` | `boolean` | Acknowledges a button interaction without altering the message. |

### Owner-Only Commands

The bot owner decides who counts as an owner in **Dashboard → Bot → Advanced Settings → Owner IDs** (comma-separated user IDs, e.g. `123456789012345678, 987654321098765432`). Every plugin reads the same list:

```javascript
module.exports = {
  commands: [{ name: "ownerpanel", slash: true, prefix: true }],
  onCommand: function (ctx) {
    if (!ctx.isBotOwner()) {
      return ctx.replyWarn("Only the bot owner can use this command!");
    }
    // ctx.ownerIds -> raw comma-separated string, parse it yourself if needed
    return ctx.replySuccess("Owner confirmed.");
  }
};
```

- `ctx.isBotOwner()` checks `ctx.user.id` by default; pass a user object or ID to check someone else: `ctx.isBotOwner(ctx.options.user)`.
- `ctx.isBotOwner()` only consults the dashboard Owner IDs (synchronous, no API calls). If your plugin must also trust the Discord application owner, fetch `/oauth2/applications/@me` and merge that ID yourself.

---

## 7. Discord Components V2 & Nested Buttons

Arixa fully supports modern Discord Components V2 (`flags: 32768`). You can place Action Rows (`type: 1`) containing interactive Buttons (`type: 2`) directly inside a Container (`type: 17`) with dynamic theme colors.

### Unified Container Structure:

```javascript
const payload = {
  flags: 32768,
  components: [
    {
      type: 17,
      accent_color: ctx.colors.v2,
      components: [
        {
          type: 10,
          content: "> **Are you sure you want to proceed?**"
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Confirm",
              custom_id: "action_confirm_" + actionId
            },
            {
              type: 2,
              style: 2,
              label: "Cancel",
              custom_id: "action_cancel_" + actionId
            }
          ]
        }
      ]
    }
  ]
};
```

### Button Interaction Routing (`mod.buttons` & `onButton`):

When multiple plugins are active, buttons must be uniquely namespaced to avoid interaction collisions and false "expired" alerts. Always register specific wildcard button patterns in `buttons`:

```javascript
module.exports = {
  buttons: {
    "kick_confirm_*": function (ctx) {
      return handleButton(ctx);
    },
    "kick_cancel_*": function (ctx) {
      return handleButton(ctx);
    }
  },

  onButton: function (ctx) {
    const customId = String(ctx.customId || "");
    if (!customId.startsWith("kick_confirm_") && !customId.startsWith("kick_cancel_")) {
      return false; // Return false so the engine continues to other plugins!
    }
    return handleButton(ctx);
  }
};
```

> [!IMPORTANT]
> **Button Namespacing Rule:**
> - Never use generic custom IDs like `mod_confirm_` across different plugins. Always prefix with your plugin name: `kick_confirm_<actionId>`, `ban_confirm_<actionId>`, `ticket_open_<id>`.
> - If an interaction arrives in `onButton` that does not match your plugin's prefix, **MUST return `false`**. Never send *"This confirmation has expired"* for an unrecognized custom ID, or you will break buttons for other plugins.

---

## 8. Safe Discord Moderation & Role Hierarchy

When building moderation plugins, always follow these essential rules to prevent false success messages, permission glitches, and command collisions:

### 1. Pre-Check Role Hierarchy Before Showing Buttons
Never prompt a moderator to confirm an action if the action cannot possibly succeed. Check roles upfront:

```javascript
if (ctx.guildOwnerId && targetId === String(ctx.guildOwnerId)) {
  return ctx.replyWarn("You cannot ban the server owner.");
}

if (targetId === ctx.botId) {
  return ctx.replyWarn("I cannot ban myself.");
}

if (targetId === ctx.user.id) {
  return ctx.replyWarn("You cannot ban yourself.");
}

const targetMemberPromise = ctx.fetchMember(ctx.guildId, targetId);
const botMemberPromise = ctx.fetchMember(ctx.guildId, ctx.botId);
const rolesPromise = ctx.fetchRoles(ctx.guildId);

return Promise.all([targetMemberPromise, botMemberPromise, rolesPromise]).then(function (results) {
  const targetMember = results[0] && results[0].status === 200 ? results[0].body : null;
  const botMember = results[1] && results[1].status === 200 ? results[1].body : null;
  const roles = Array.isArray(results[2]) ? results[2] : [];

  if (!targetMember) {
    return ctx.replyWarn("User <@" + targetId + "> is not in this server.");
  }

  if (roles.length) {
    const rolePosMap = {};
    roles.forEach(function (r) { if (r && r.id) rolePosMap[r.id] = Number(r.position) || 0; });

    let targetMaxPos = 0;
    (targetMember.roles || []).forEach(function (rid) {
      const pos = rolePosMap[rid] || 0;
      if (pos > targetMaxPos) targetMaxPos = pos;
    });

    let botMaxPos = 0;
    if (botMember) {
      (botMember.roles || []).forEach(function (rid) {
        const pos = rolePosMap[rid] || 0;
        if (pos > botMaxPos) botMaxPos = pos;
      });
    }

    if (targetMaxPos >= botMaxPos) {
      return ctx.replyWarn("I cannot ban <@" + targetId + "> because their role is higher than or equal to my role.");
    }

    if (!ctx.isServerOwner && ctx.member) {
      let modMaxPos = 0;
      (ctx.member.roles || []).forEach(function (rid) {
        const pos = rolePosMap[rid] || 0;
        if (pos > modMaxPos) modMaxPos = pos;
      });

      if (targetMaxPos >= modMaxPos) {
        return ctx.replyWarn("You cannot ban <@" + targetId + "> because their role is higher than or equal to your role.");
      }
    }
  }

  return sendConfirmationPrompt();
});
```

### 2. Inspect Discord API Response Status
Discord API methods resolve with `{ status: number, body: object }`. Always inspect `res.status`:
- `res.status === 200` or `204`: Success.
- `res.status === 403`: Check `res.body.code === 50013` (Role hierarchy / missing permissions).
- `res.status === 404`: Target user or member not found.

### 3. Safe Argument Shift (Preventing Target Mention in Reason)
When a command is executed via text prefix (e.g. `+ban <@user> 1h spam`), the target user mention arrives as the first argument in `ctx.rawArgs`. If not properly shifted, the user mention will leak into the `reason` variable, causing messages like `Successfully banned <@user> for <@user>`.

Always use this defensive argument shifting pattern:

```javascript
let targetId = null;
let duration = null;
let reason = "";
let argsStartIdx = 0;

if (opts.user) {
  targetId = typeof opts.user === "object" ? opts.user.id : parseUserId(String(opts.user));
}

if (rawArgs.length > 0) {
  const parsedFirst = parseUserId(rawArgs[0]);
  if (parsedFirst) {
    if (!targetId) targetId = parsedFirst;
    if (targetId === parsedFirst) argsStartIdx = 1; // Shift target mention out of remaining args!
  }
}

const remainingArgs = rawArgs.slice(argsStartIdx);
if (remainingArgs.length > 0) {
  const possibleTime = parseDuration(remainingArgs[0]);
  if (possibleTime) {
    duration = possibleTime;
    reason = remainingArgs.slice(1).join(" ").trim();
  } else {
    reason = remainingArgs.join(" ").trim();
  }
}
```

### 4. Standard Moderation Response Formatting
To maintain consistent grammar across all moderation plugins:
- **No duration, no reason**: `> ✅ **Successfully banned <@targetId>**`
- **With reason only**: `> ✅ **Successfully banned <@targetId> | <reason>**`
- **With duration & reason**: `> ✅ **Successfully banned <@targetId> for <duration> | <reason>**`
- **With duration only**: `> ✅ **Successfully banned <@targetId> for <duration>**`

*(Notice `for` is reserved strictly for durations, and `|` is used for reasons. Never output `for <reason>`!)*

---

## 9. Persistent Storage & Bot Configuration

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

## 10. Complete Production Plugin Templates

### Template 1: Standard Server Utility Plugin

```javascript
module.exports = {
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
