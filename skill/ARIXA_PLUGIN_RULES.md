# Arixa Plugin Development Rules & Standards for AI Assistants

> [!IMPORTANT]
> **MANDATORY INSTRUCTIONS FOR ALL AI ASSISTANTS DEVELOPING ARIXA PLUGINS**
> Arixa is an enterprise-grade, multi-tenant Discord bot host framework. When generating, refactoring, or reviewing plugins for Arixa, you MUST adhere to every rule outlined in this document. Any deviation will cause runtime errors, break dashboard configuration, or trigger permission issues.

---

## 1. Absolute Golden Rules (Zero-Tolerance)

### 1.1 ZERO Code Comments
- **NEVER** write comments (`//`, `/* ... */`, or `#`) anywhere in JavaScript files (`index.js`).
- No comments, no TODOs, no section dividers, no inline explanations.
- All documentation belongs exclusively in `readme.md` or markdown reference files.

### 1.2 NEVER Hardcode Colors
- Never hardcode hex values (e.g. `#5865F2`, `#ED4245`, `#FAA61A`) or decimal color integers in plugin code.
- Dynamic theme colors are managed per-bot by the user from the dashboard.
- Always use `ctx.colors`:
  - `ctx.colors.v1` (or `ctx.color`): Primary color for traditional V1 Discord Embeds.
  - `ctx.colors.v2`: Primary accent color for modern Discord Components V2 (`type: 17` Container).
  - `ctx.colors.warning`: Warning color used by `ctx.replyWarn()`.
  - `ctx.colors.error`: Error color used by `ctx.replyError()`.
  - `ctx.colors.cooldown`: Cooldown color used by `ctx.replyCooldown()`.

### 1.3 Folder Suffix Standard (`-v1` vs `-v2`)
- Plugin directory names follow the format: `src/plugins/<name>-v<version>/`
- **`-v1` suffix**: Dedicated strictly to traditional Discord Embed plugins (`ctx.replyEmbed` / `embeds: [...]`).
- **`-v2` suffix**: Dedicated strictly to Discord Components V2 plugins (`flags: 32768`, Container `type: 17`, Text Display `type: 10`).
- **CRITICAL**: If your plugin uses Components V2 containers, its directory name MUST end in `-v2` (e.g. `src/plugins/ban-v2`, `src/plugins/prefix-v2`). Never use `-v1` for a Components V2 plugin.

### 1.4 NEVER Double-Declare Cooldowns
- When registering commands via the `commands` array:
  If you specify `cooldown: 5` in the command definition, the bot engine automatically handles rate limiting.
- **DO NOT** call `ctx.cooldown(5)` inside `onCommand` when `cooldown` is already defined in the command options. Doing so will trigger an immediate duplicate cooldown block on the first execution.

### 1.5 Role Hierarchy & Permission Pre-Checks (No False Prompts)
- For administrative/moderation actions (ban, unban, kick, timeout, role edit):
  **NEVER** show interactive confirmation buttons if the action cannot be performed!
- Pre-validate all conditions before displaying the confirmation UI:
  1. Check if target is Guild Owner: Server owners cannot be banned or kicked.
  2. Check if target is the bot itself: The bot cannot ban itself.
  3. Fetch roles using `await ctx.fetchRoles(guildId)` and fetch members using `await ctx.fetchMember(guildId, userId)`.
  4. Compare role positions:
     - If Target Highest Role >= Bot Highest Role: Abort immediately with `ctx.replyWarn(...)`.
     - If Target Highest Role >= Author Highest Role (and author is not Guild Owner): Abort immediately with `ctx.replyWarn(...)`.
- When making Discord REST API calls via `ctx.request`:
  Always verify `res.status` and `res.body`. If `res.status === 403` or `body.code === 50013` (Missing Permissions), treat as failure. **NEVER announce success if the Discord API returned an error.**

### 1.6 Interactive Button Confirmation, Unique Namespaces & 2-Minute Expiration
- Confirmation dialogs (e.g. Confirm Ban, Confirm Kick) must expire after strictly **2 minutes (120,000 ms)**.
- **Unique Custom ID Namespace**: NEVER use generic custom IDs like `mod_confirm_` across multiple plugins. Always prefix with your plugin slug:
  - Kick plugin: `kick_confirm_<actionId>`, `kick_cancel_<actionId>`
  - Ban plugin: `ban_confirm_<actionId>`, `ban_cancel_<actionId>`
- **Export `buttons` with Wildcards**: Always register explicit wildcard handlers in `buttons`:
  ```javascript
  buttons: {
    "kick_confirm_*": function (ctx) { return handleButton(ctx); },
    "kick_cancel_*": function (ctx) { return handleButton(ctx); }
  }
  ```
- **Fallback Safety in `onButton`**: If `customId` does not match your plugin's prefix, **MUST return `false`** so other plugins can process their buttons. NEVER send "This confirmation has expired." for an unrecognized custom ID.
- Store pending action state in a process-safe global map:
  `global.__arixa_<plugin>_actions = global.__arixa_<plugin>_actions || {};`
- Author Validation: Verify that the user clicking the button is the one who initiated the command (`ctx.user.id === action.authorId`). If not, send an ephemeral warning.

### 1.7 Persistent Storage via `ctx.storage` (NEVER `fs`)
- Multi-tenant bots must never write directly to local disk with `fs.writeFileSync`.
- Always use `ctx.storage`:
  - `await ctx.storage.get(key, defaultValue)`
  - `await ctx.storage.set(key, value)`
  - `await ctx.storage.delete(key)`

### 1.8 Case-Insensitive Prefix Matching & Word Prefixes
- When parsing prefixes, always match case-insensitively:
  `content.toLowerCase().startsWith(prefix.toLowerCase())`
- Support both symbol prefixes (`!`, `?`, `+`) and multi-character alphanumeric word prefixes (`lol`, `arixa`).

### 1.9 English Only
- All code identifiers, error messages, user-facing text, and documentation must be in standard English.

### 1.10 Workspace & Git Repository Identification
- Arixa strictly resides in `/storage/emulated/0/app`.
- Git remote: `https://github.com/tuzhicodes/arixa.git` (branch: `main`).
- Git credentials: `~/.git-credentials-arixa`.
- All plugin developments, test scripts, and modifications for Arixa must strictly target `/storage/emulated/0/app`. Never execute git actions or place Arixa files in `/storage/emulated/0/A+` (which belongs exclusively to ZarKos).

### 1.11 Argument Shift & Reason Formatting Standard
- **Never Leak Target Mention into Reason**: When parsing prefix command arguments (`rawArgs`), always verify if `rawArgs[0]` is the target user mention (`<@id>`). If it matches `targetId`, shift arguments (`argsStartIdx = 1`). Never allow the target mention to remain in `remainingArgs` and become the `reason`.
- **Grammar Formatting Standard**:
  - Without reason: `> ✅ **Successfully banned <@targetId>**`
  - With reason: `> ✅ **Successfully banned <@targetId> | <reason>**`
  - With duration & reason: `> ✅ **Successfully banned <@targetId> for <duration> | <reason>**`
  - With duration only: `> ✅ **Successfully banned <@targetId> for <duration>**`
  *(Never output `for <reason>` if there is no duration!)*

---

## 2. Plugin File & Directory Structure

Every plugin directory must contain exactly:
```text
src/plugins/<name>-v<version>/
├── readme.md       Metadata, dashboard settings schema, and documentation
└── main/
    └── index.js    Plugin logic, command handlers, and gateway events
```

### 2.1 Metadata & Settings Schema (`readme.md`)
The `readme.md` file defines YAML frontmatter and an optional ````config```` JSON block for dashboard configuration:

```markdown
---
name: Ban & Unban
tag: Moderation
description: Enterprise moderation plugin with Components V2 alerts, role hierarchy validation, and interactive confirmations.
version: 1.0.0
author: @community
---

# Ban & Unban
Plugin description and usage instructions.

```config
{
  "fields": [
    { "key": "emoji_ban", "label": "Ban Success Emoji", "type": "text", "default": "✅" },
    { "key": "emoji_unban", "label": "Unban Success Emoji", "type": "text", "default": "✅" }
  ]
}
```
```

#### Supported Config Field Types:
- `text`: String values (IDs, emojis, custom formats).
- `toggle`: Boolean flags (`"true"` or `"false"`).
- `number`: Numeric thresholds or counts.

Read user-configured settings in code via `ctx.config[key]`. Always provide fallbacks if unset.

---

## 3. UI Standards: V1 (Embed) vs V2 (Components V2)

### 3.1 V1 Standard: Traditional Discord Embeds
- Directory name ends in `-v1`.
- Uses `ctx.replyEmbed(embed)` or `embeds: [...]`.
- Color: `ctx.colors.v1` or `ctx.color`.

```javascript
await ctx.replyEmbed({
  title: 'Server Settings',
  description: 'Prefix updated successfully.',
  color: ctx.colors.v1,
  fields: [
    { name: 'New Prefix', value: `\`${newPrefix}\``, inline: true }
  ],
  footer: { text: `Requested by ${ctx.author.username}` }
});
```

### 3.2 V2 Standard: Modern Discord Components V2
- Directory name ends in `-v2`.
- Message flags must include `flags: 32768` (IS_COMPONENTS_V2).
- Container: `type: 17` with `accent_color: ctx.colors.v2`.
- Text Element: `type: 10` (Text Display) with markdown `content`.
- Nested Buttons: ActionRow (`type: 1`) placed **inside** the container `components: [...]` array so buttons render inside the card container.

```javascript
await ctx.reply('', {
  flags: 32768,
  components: [
    {
      type: 17,
      accent_color: ctx.colors.v2,
      components: [
        {
          type: 10,
          content: '### Action Confirmation\nAre you sure you want to proceed with this operation?'
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 4,
              custom_id: 'confirm_action_123',
              label: 'Confirm'
            },
            {
              type: 2,
              style: 2,
              custom_id: 'cancel_action_123',
              label: 'Cancel'
            }
          ]
        }
      ]
    }
  ]
});
```

---

## 4. Built-in Alert System Helpers

Never build custom error boxes. Always use the bot host's native system alert helpers:

| Helper Method | When to Use | Default Accent Color |
| :--- | :--- | :--- |
| `await ctx.replyWarn(message)` | Missing permissions, invalid arguments, hierarchy blocks | `ctx.colors.warning` |
| `await ctx.replyError(message)` | System faults, API execution rejections, unhandled exceptions | `ctx.colors.error` |
| `await ctx.replyCooldown(sec)` | Custom rate-limiting notifications | `ctx.colors.cooldown` |

---

## 5. Context (`ctx`) API Quick Reference

### Messaging
- `await ctx.reply(content, options)`: Sends message to current channel.
- `await ctx.replyEmbed(embed)`: Sends a styled V1 embed.
- `await ctx.replyWarn(msg)`: Sends a Components V2 warning card.
- `await ctx.replyError(msg)`: Sends a Components V2 error card.
- `await ctx.replyCooldown(seconds)`: Sends a Components V2 cooldown card.

### REST & Entity Fetching
- `await ctx.fetchRoles(guildId)`: Returns cached array of guild roles with `id`, `name`, `position`.
- `await ctx.fetchMember(guildId, userId)`: Fetches guild member object with `roles`, `user`, etc.
- `await ctx.fetchUser(userId)`: Fetches global Discord user object.
- `await ctx.fetchBan(guildId, userId)`: Checks if a user is currently banned in the guild.
- `await ctx.request(method, path, body, headers)`: Makes authenticated requests to Discord REST API.

### Isolated Storage
- `await ctx.storage.get(key, defaultValue)`
- `await ctx.storage.set(key, value)`
- `await ctx.storage.delete(key)`

### Properties
- `ctx.author`: User object of command invoker (`id`, `username`, etc.).
- `ctx.member`: Member object in guild.
- `ctx.guildId`: Current guild ID.
- `ctx.channelId`: Current channel ID.
- `ctx.botId` / `ctx.applicationId`: ID of the bot user.
- `ctx.config`: Object containing dashboard configuration values.
- `ctx.colors`: Theme colors object (`v1`, `v2`, `warning`, `error`, `cooldown`).

---

## 6. Complete Production Template (Components V2, Zero Comments)

Below is an exemplary, production-grade V2 plugin implementation adhering to all Arixa standards. Note the complete absence of code comments.

```javascript
const pendingActions = global.__arixa_demo_actions = global.__arixa_demo_actions || new Map();

function cleanTargetId(input) {
  if (!input) return null;
  const match = String(input).match(/\d{17,20}/);
  return match ? match[0] : null;
}

function computeHighestRole(memberRoles, guildRoles) {
  if (!Array.isArray(memberRoles) || !Array.isArray(guildRoles)) return -1;
  const roleMap = new Map(guildRoles.map(r => [r.id, Number(r.position) || 0]));
  let highest = -1;
  for (const rid of memberRoles) {
    const pos = roleMap.get(rid);
    if (pos !== undefined && pos > highest) highest = pos;
  }
  return highest;
}

module.exports = {
  name: 'Demo Plugin',
  description: 'Production-ready Components V2 plugin demonstrating clean standards.',
  version: '1.0.0',
  commands: [
    {
      name: 'demokick',
      description: 'Kick a user with safety checks and confirmation dialog',
      cooldown: 5,
      options: [
        {
          name: 'user',
          description: 'The user to kick',
          type: 6,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for kick',
          type: 3,
          required: false
        }
      ]
    }
  ],
  async onCommand(ctx) {
    if (ctx.commandName !== 'demokick') return;
    if (!ctx.guildId) {
      await ctx.replyWarn('This command can only be executed in a server.');
      return;
    }
    const targetRaw = ctx.args[0] || (ctx.options && ctx.options.user);
    const targetId = cleanTargetId(targetRaw);
    if (!targetId) {
      await ctx.replyWarn('Please specify a valid user to kick.');
      return;
    }
    const reason = ctx.args.slice(1).join(' ') || (ctx.options && ctx.options.reason) || 'No reason provided';
    const botId = ctx.botId || ctx.applicationId;
    if (targetId === botId) {
      await ctx.replyWarn('I cannot kick myself.');
      return;
    }
    const guildRoles = await ctx.fetchRoles(ctx.guildId);
    const botMember = await ctx.fetchMember(ctx.guildId, botId);
    const targetMember = await ctx.fetchMember(ctx.guildId, targetId);
    if (!targetMember) {
      await ctx.replyWarn('Target user is not a member of this server.');
      return;
    }
    const botHighest = computeHighestRole(botMember.roles, guildRoles);
    const targetHighest = computeHighestRole(targetMember.roles, guildRoles);
    const authorHighest = computeHighestRole(ctx.member ? ctx.member.roles : [], guildRoles);
    if (targetHighest >= botHighest) {
      await ctx.replyWarn('I cannot kick this user because their role is equal to or higher than my highest role.');
      return;
    }
    if (ctx.guild && ctx.guild.owner_id !== ctx.author.id && targetHighest >= authorHighest) {
      await ctx.replyWarn('You cannot kick this user because their role is equal to or higher than your highest role.');
      return;
    }
    const actionId = `kick_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timer = setTimeout(async () => {
      pendingActions.delete(actionId);
    }, 120000);
    pendingActions.set(actionId, {
      guildId: ctx.guildId,
      targetId,
      targetTag: targetMember.user ? targetMember.user.username : targetId,
      authorId: ctx.author.id,
      reason,
      timer
    });
    await ctx.reply('', {
      flags: 32768,
      components: [
        {
          type: 17,
          accent_color: ctx.colors.v2,
          components: [
            {
              type: 10,
              content: `### Confirmation Required\nAre you sure you want to kick **${targetMember.user ? targetMember.user.username : targetId}**?\n**Reason:** ${reason}`
            },
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 4,
                  custom_id: `confirm_${actionId}`,
                  label: 'Confirm Kick'
                },
                {
                  type: 2,
                  style: 2,
                  custom_id: `cancel_${actionId}`,
                  label: 'Cancel'
                }
              ]
            }
          ]
        }
      ]
    });
  },
  async onInteraction(ctx) {
    const customId = ctx.customId;
    if (!customId) return;
    if (!customId.startsWith('confirm_kick_') && !customId.startsWith('cancel_kick_')) return;
    const isConfirm = customId.startsWith('confirm_kick_');
    const actionId = customId.replace(isConfirm ? 'confirm_' : 'cancel_', '');
    const action = pendingActions.get(actionId);
    if (!action) {
      await ctx.replyWarn('This confirmation has expired or is invalid.');
      return;
    }
    if (ctx.author.id !== action.authorId) {
      await ctx.replyWarn('You are not authorized to interact with this confirmation.');
      return;
    }
    clearTimeout(action.timer);
    pendingActions.delete(actionId);
    if (!isConfirm) {
      await ctx.reply('', {
        flags: 32768,
        components: [
          {
            type: 17,
            accent_color: ctx.colors.v2,
            components: [
              {
                type: 10,
                content: `### Action Cancelled\nKick operation for **${action.targetTag}** was cancelled.`
              }
            ]
          }
        ]
      });
      return;
    }
    try {
      const res = await ctx.request('DELETE', `/guilds/${action.guildId}/members/${action.targetId}`, null, {
        'X-Audit-Log-Reason': encodeURIComponent(action.reason)
      });
      if (res && (res.status === 403 || (res.body && res.body.code === 50013))) {
        await ctx.replyWarn('Failed to kick user due to missing Discord permissions.');
        return;
      }
      await ctx.reply('', {
        flags: 32768,
        components: [
          {
            type: 17,
            accent_color: ctx.colors.v2,
            components: [
              {
                type: 10,
                content: `### Member Kicked\n**${action.targetTag}** has been kicked successfully.\n**Reason:** ${action.reason}`
              }
            ]
          }
        ]
      });
    } catch (err) {
      await ctx.replyError('An unexpected error occurred while executing the kick.');
    }
  }
};
```
