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

---

## 🌐 Hosting & Deployment Guide (Pterodactyl / Bot Panels / VPS)

This guide covers deploying Arixa to containerized hosting platforms (such as Pterodactyl-based bot hosting panels, VPS, or cloud containers).

### 📋 Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended).
- **Zero-Dependency Architecture**: Arixa uses native Node.js core modules (`http`, `https`, `crypto`, `fs`, `path`, `zlib`), so external `npm install` packages are not required for the core engine.

---

### 🚀 Step-by-Step Deployment

#### 1. Clone the Repository to the Root Directory
When deploying on hosting panels (where the default working directory is `/home/container`), clone into the current directory by appending a trailing space and period (`.`):

```bash
git clone https://github.com/tuzhicodes/Arixa-devs.git .
```

> [!IMPORTANT]
> Always include the trailing `.` when cloning. If omitted, Git will create a subfolder `/home/container/Arixa-devs/`, causing startup errors because the panel expects `index.js` at `/home/container/index.js`.

#### 2. Create the `.env` Configuration File
Because `.env` contains sensitive secrets, it is excluded from Git via `.gitignore`. You must create it manually in the hosting File Manager:

1. Open the hosting **File Manager**.
2. Click **New File** and name it `.env`.
3. Add your environment variables:

```ini
# Bot Credentials
TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
MASTER_KEY=generate_random_secure_hex_key

# Web Dashboard
PORT=3000
DISCORD_REDIRECT_URI=http://your-server-domain-or-ip:3000/auth/callback
BASE_URL=http://your-server-domain-or-ip:3000

# Branding & Logs
NAME=Arixa
FOOTER=Powered by Arixa Engine
USER_LOGIN=
BOT_UPTIME=
BOT_CREATE=
ALLOWED_IDS=
```

#### 3. Start the Server
Start the application from the panel console or command line:
```bash
npm start
# or directly:
node index.js
```

---

### 🔧 Troubleshooting Common Hosting Issues

#### 1. `Error: Cannot find module '/home/container/index.js' (MODULE_NOT_FOUND)`

**Cause:**
The hosting panel attempts to run `node index.js` in `/home/container`, but the project was cloned into a subfolder (e.g., `/home/container/Arixa-devs/index.js`).

**Solutions:**
- **Solution A (Move Files to Root - Recommended):**
  1. Open your panel's **File Manager**.
  2. Open the subfolder (e.g. `Arixa-devs/`).
  3. Select all files and folders (`index.js`, `package.json`, `dashboard/`, `src/`, `utils/`, etc.).
  4. Click **Move** and set the target path to `/home/container/` (or the root directory).
  5. Confirm that `index.js` is directly in `/home/container/`.
- **Solution B (Update Startup Command):**
  1. Go to the **Startup** tab in your panel.
  2. Change **Startup File** / **JS_FILE** from `index.js` to `Arixa-devs/index.js`.
- **Solution C (Fresh Clone):**
  1. Delete any existing template files in the File Manager.
  2. Clone using the trailing period: `git clone <repo_url> .`

---

#### 2. `15 packages are looking for funding` / `npm audit fix` warnings

**Cause:**
Many hosting panels initialize containers using pre-configured NodeJS egg templates that contain default dependencies in `/home/container/package.json`.

**Solution:**
Arixa core has **0 external npm dependencies**. When you move or clone the real Arixa `package.json` into the root directory, no external package installation is required. You can safely ignore `npm fund` / `npm audit` warnings from leftover panel templates.

---

#### 3. Bot Does Not Connect or Gateway Authentication Errors

**Cause:**
Missing or invalid `TOKEN` or `DISCORD_CLIENT_ID` in the `.env` file.

**Solution:**
Check the panel console logs and verify that `.env` exists in `/home/container/.env` with valid Discord Developer Portal credentials.

