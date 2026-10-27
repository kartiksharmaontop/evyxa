# Arixa Plugin Developer Guide: System Alerts & Bot Theme Colors

Welcome to the **Arixa Plugin Development Standard**. This document specifies the architectural rules, helper APIs, and best practices for creating plugins that seamlessly integrate with Arixa bots.

---

## 1. Golden Rule: No Hardcoded Colors

> [!IMPORTANT]
> **Plugin developers must NEVER hardcode custom colors** (e.g. `#ED4245`, `0x5865F2`) in plugins.
> Every bot owner customizes their bot's branding and alert palette directly in the **Bot Dashboard &rarr; Theme Colors**. Your plugin must always adapt dynamically to the bot's configured colors.

### Bot-Connected Theme Variables (`ctx.colors`)

Every command, event, and component execution context automatically provides `ctx.colors`:

| Property | Type | Description | Intended Use |
| :--- | :--- | :--- | :--- |
| `ctx.colors.v1` | `number` | Primary Discord Embed color | Embed messages in V1 plugins (`ctx.replyEmbed`). |
| `ctx.colors.v2` | `number` | Primary Components V2 accent color | Action cards & success containers in V2 plugins. |
| `ctx.colors.warning` | `number` | Warning alert accent color | Automatically used by `ctx.replyWarn()`. |
| `ctx.colors.error` | `number` | Error & rejection accent color | Automatically used by `ctx.replyError()`. |
| `ctx.colors.cooldown` | `number` | Command rate-limit accent color | Automatically used by `ctx.replyCooldown()`. |

---

## 2. Built-in System Alert Methods

Whenever you need to notify the user about a validation failure, missing permission, rate limit, or unexpected error, **always use the built-in system helpers**. Do not craft custom embed errors or fake warning containers.

### 1. `ctx.replyWarn(message, options)`
Used for:
- Missing user input or invalid arguments.
- Missing permissions (e.g. user lacks `MANAGE_GUILD`).
- Server-only command used in DMs.
- Action disallowed by configuration.

```javascript
if (!ctx.hasPermission("MANAGE_MESSAGES")) {
  return ctx.replyWarn("You need **Manage Messages** permission to use this command.");
}

if (!args[0]) {
  return ctx.replyWarn("Please provide a valid user or ID.");
}
```
* **Styling:** Dynamic `ctx.colors.warning` with system warning emoji (`<:Warning:...>`).
* **Auto-Delete:** Automatically deletes after **10 seconds** to avoid channel clutter.
* **Options:** `{ ephemeral: true }` (for slash interactions) or `{ deleteAfter: 0 }` (to keep permanent).

---

### 2. `ctx.replyError(message, options)`
Used for:
- API errors (Discord API rate limits, external webhook failures).
- Unhandled runtime exceptions or database failures.
- Bot hierarchy errors (e.g. bot cannot kick someone with higher role).

```javascript
try {
  await performAction();
} catch (err) {
  return ctx.replyError("An error occurred while executing this action: " + err.message);
}
```
* **Styling:** Dynamic `ctx.colors.error` with system error emoji (`<:error:...>`).
* **Auto-Delete:** Automatically deletes after **10 seconds**.
* **Options:** `{ ephemeral: true }`, `{ deleteAfter: ms }`.

---

### 3. `ctx.replyCooldown(seconds, options)` & `ctx.cooldown(seconds)`
Used for:
- Command rate-limiting and anti-spam protection.

#### Method A: Automatic Cooldown Enforcement (Recommended)
`ctx.cooldown(seconds)` handles tracking, remaining time calculation, and auto-reply in one call:

```javascript
if (!ctx.cooldown(5)) return;
```

#### Method B: Manual Cooldown Reply
```javascript
return ctx.replyCooldown(12);
```
* **Styling:** Dynamic `ctx.colors.cooldown` with animated cooldown emoji (`<a:cooldown:...>`).
* **Auto-Delete:** Automatically deletes after **10 seconds**.

---

### 4. `ctx.replySuccess(message, options)`
Used for:
- Confirmation of successful operations (e.g. prefix updated, member warned, ticket created).

```javascript
return ctx.replySuccess("Successfully set server prefix to `" + newPrefix + "`");
```
* **Styling:** Dynamic `ctx.colors.v2` (Components V2 accent).
* **Auto-Delete:** Permanent by default.

---

## 3. V1 (Embed) vs V2 (Components V2) Standards

### V1 Plugins (Embed Based)
1. Use `ctx.replyEmbed(embedData, opts)` or `ctx.sendEmbed(channelId, embedData, opts)`.
2. Do **not** allow plugin makers or users to hardcode embed colors. The system host sanitizes and locks outgoing embeds to `ctx.colors.v1`.
3. Validation and error handling in V1 plugins must still use `ctx.replyWarn()` and `ctx.replyError()`.

### V2 Plugins (Discord Components V2)
1. Use Discord Components V2 format (`flags: 32768`, Container `type: 17`, Text Display `type: 10`).
2. Set Container `accent_color: ctx.colors.v2`.
3. In `readme.md`, do **NOT** include `"embed": "color"` in the config schema. Theme colors belong to the bot, not individual plugins.

```markdown
```config
{
  "fields": [
    { "key": "custom_option", "label": "Option Name", "type": "text", "default": "value" }
  ]
}
```
```

---

## 4. Complete Plugin Template

```javascript
module.exports = {
  commands: [
    {
      name: "example",
      description: "Standard compliant example command",
      slash: true,
      prefix: true,
      options: [
        { type: 3, name: "text", description: "Text input", required: true }
      ]
    }
  ],

  onCommand: async function (ctx) {
    if (!ctx.guildId) {
      return ctx.replyWarn("This command can only be used inside a server.");
    }

    if (!ctx.hasPermission("MANAGE_MESSAGES")) {
      return ctx.replyWarn("You need **Manage Messages** permission to use this command.");
    }

    if (!ctx.cooldown(5)) return;

    const input = (ctx.options.text || ctx.rawArgs[0] || "").trim();
    if (!input || input.length < 3) {
      return ctx.replyWarn("Please provide text with at least 3 characters.");
    }

    return ctx.replySuccess("Successfully received input: **" + input + "**");
  }
};
```

---

## 5. How Bot Owners Customize Theme Colors

Bot owners can change alert colors at any time:
1. Open the Bot Dashboard.
2. Under **Theme Colors**, adjust:
   - **Main v1**: Embed response color.
   - **Main v2**: Components V2 accent color.
   - **Warning**: Color for all warning alerts.
   - **Error**: Color for all error alerts.
   - **Cooldown**: Color for all cooldown alerts.
3. Changes save automatically to `bot.json` and take effect immediately across all installed plugins without restarting the bot.
