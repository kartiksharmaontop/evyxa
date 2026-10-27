# Arixa Discord Bot Hosting & Plugin Platform

Arixa is a high-performance Discord bot hosting engine and modular plugin ecosystem built on Node.js and the Discord REST & Gateway APIs. It features central bot theme management, Discord Components V2 rendering, and an interactive web dashboard.

---

## 🎨 Centralized Bot Theme System

In Arixa, branding and visual styles are controlled centrally at the bot level rather than inside fragmented individual plugins. Every bot has its own color palette configured via the Dashboard under **Theme Colors**:

| Theme Setting | Context Key | Purpose |
| :--- | :--- | :--- |
| **Main v1** | `ctx.colors.v1` / `ctx.color` | Discord Embeds (V1 plugins) |
| **Main v2** | `ctx.colors.v2` | Discord Components V2 Containers (V2 plugins) |
| **Warning** | `ctx.colors.warning` | System Warning Notices (`ctx.replyWarn`) |
| **Error** | `ctx.colors.error` | System Error Rejections (`ctx.replyError`) |
| **Cooldown** | `ctx.colors.cooldown` | Command Cooldown Notices (`ctx.replyCooldown`) |

### How It Works
1. Bot owners choose their colors directly in the web dashboard.
2. Changes are saved to `bot.json` via `/api/bot/:botId/theme-colors`.
3. The host engine (`dashboard/botHost.js`) dynamically attaches `ctx.colors` to every interaction, message, and component execution context.
4. When any plugin calls `ctx.replyWarn`, `ctx.replyError`, or `ctx.replyCooldown`, the host engine renders a standard Discord Component V2 card with the bot's configured color.

---

## 🚀 System Alerts Standard (`warn`, `error`, `cooldown`)

All present and future plugins must follow this unified notification standard:

### 1. Warning Notice (`ctx.replyWarn`)
- **When to use:** Invalid user arguments, missing permissions, server-only commands executed in DMs.
- **Visuals:** System warning emoji (`<:Warning:...>`), bot's `warning` color accent, auto-deletes after 10s.
- **Example:**
  ```javascript
  if (!ctx.hasPermission("MANAGE_GUILD")) {
    return ctx.replyWarn("You need Manage Server permission to use this command.");
  }
  ```

### 2. Error Notice (`ctx.replyError`)
- **When to use:** Caught exceptions, failed Discord API requests, internal errors.
- **Visuals:** System error emoji (`<:error:...>`), bot's `error` color accent, auto-deletes after 10s.
- **Example:**
  ```javascript
  try {
    await doOperation();
  } catch (err) {
    return ctx.replyError("Operation failed: " + err.message);
  }
  ```

### 3. Cooldown Notice (`ctx.replyCooldown` & `ctx.cooldown`)
- **When to use:** Rate-limiting commands to prevent spam.
- **Visuals:** Animated cooldown emoji (`<a:cooldown:...>`), bot's `cooldown` color accent, auto-deletes after 10s.
- **Example:**
  ```javascript
  // Limits user to once every 10 seconds
  if (!ctx.cooldown(10)) return;
  ```

### 4. Success Notice (`ctx.replySuccess`)
- **When to use:** Action completions, prefix changes, moderation confirmations.
- **Visuals:** Green/Main v2 card with success emoji (`✅`).

---

## 📂 Project Structure

```
├── dashboard/
│   ├── botHost.js        # Core Gateway WebSocket and plugin execution engine
│   ├── crypto.js         # AES-256-GCM token and session encryption
│   └── views/            # Dashboard HTML templates (dashboard, docs, login, main, plans)
├── src/
│   ├── README.md         # Developer guide for bot theme colors & alert standards
│   └── plugins/          # Built-in plugins
│       ├── README.md     # Plugin developer reference & templates
│       └── prefix-v2/    # Built-in Prefix V2 plugin implementation
├── utils/
│   ├── system/emoji.js   # Components V2 payload builder & system emojis
│   └── log.js            # Structured panel logger
├── index.js              # HTTP server, routing, REST APIs, and auth lifecycle
├── package.json          # Project configuration & start scripts
└── .gitignore            # Excludes sensitive data (.env, data/) & dependencies
```

---

## 🛠️ Developer Documentation
For comprehensive API specifications, component builders, and examples, refer to:
- [`src/plugins/README.md`](file:///storage/emulated/0/app/src/plugins/README.md) — Plugin developer reference & complete templates.
- In-app documentation view at `/docs` (or [`dashboard/views/docs.html`](file:///storage/emulated/0/app/dashboard/views/docs.html)).
