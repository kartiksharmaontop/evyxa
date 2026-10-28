# ⚡ Arixa — Next-Gen Discord Bot Engine & Management Platform

<p align="center">
  <img src="https://img.shields.io/badge/node.js-%3E%3D18.0.0-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js Version" />
  <img src="https://img.shields.io/badge/dependencies-0%20(Pure%20Native)-blue?style=for-the-badge" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/Discord%20API-v10%20(REST%20%2B%20Gateway)-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord API v10" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License" />
</p>

Arixa is a high-performance, ultra-lightweight Discord bot hosting engine, interactive web management dashboard, and modular plugin platform. Engineered with **zero external npm dependencies**, Arixa runs entirely on native Node.js core modules, delivering blazing-fast startup times, minimal memory footprint, and high stability across local environments, VPS setups, and Pterodactyl container hosts.

---

## 📑 Table of Contents

- [✨ Key Features](#-key-features)
- [⚡ Zero-Dependency Architecture](#-zero-dependency-architecture)
- [🚀 Quickstart (Local Development)](#-quickstart-local-development)
  - [Step 1: Clone Repository](#step-1-clone-repository)
  - [Step 2: Environment Configuration](#step-2-environment-configuration)
  - [Step 3: Launch Arixa](#step-3-launch-arixa)
- [🌐 Hosting & Container Deployment (Pterodactyl / Bot Panels / VPS)](#-hosting--container-deployment-pterodactyl--bot-panels--vps)
  - [Deployment Workflow](#deployment-workflow)
  - [Step-by-Step Panel Setup](#step-by-step-panel-setup)
- [🔧 Troubleshooting Common Hosting Errors](#-troubleshooting-common-hosting-errors)
  - [Fix 1: Error: Cannot find module '/home/container/index.js'](#fix-1-error-cannot-find-module-homecontainerindexjs)
  - [Fix 2: 15 packages looking for funding / npm audit warnings](#fix-2-15-packages-looking-for-funding--npm-audit-warnings)
  - [Fix 3: Invalid Token / Gateway Login Failures](#fix-3-invalid-token--gateway-login-failures)
- [🎨 Centralized Bot Theme System](#-centralized-bot-theme-system)
- [🚨 System Alert Standards (Warn, Error, Cooldown, Success)](#-system-alert-standards-warn-error-cooldown-success)
- [🧩 Plugin Architecture & Developer Guide](#-plugin-architecture--developer-guide)
- [📂 Project Structure](#-project-structure)
- [📄 License](#-license)

---

## ✨ Key Features

- **⚡ Zero External npm Dependencies:** Built 100% on native Node.js APIs (`http`, `https`, `crypto`, `fs`, `path`, `zlib`). No dependency bloat, no vulnerable supply chain packages, instant startup.
- **🖥️ Integrated Web Dashboard:** Full-featured browser UI to manage bots, monitor uptime, configure plugins, manage API keys, and customize themes.
- **🎨 Centralized Bot Theme Engine:** Global color palettes per bot for Discord Embeds (V1) and Discord Components V2 containers, editable dynamically via the dashboard.
- **🧩 Hot-Reloadable Plugin System:** Modular plugin framework with built-in permission checks, cooldown throttles, automated Component V2 alerts, and custom command parsers.
- **🔒 Bank-Grade Security:** Tokens and user sessions encrypted at rest with AES-256-GCM.
- **🌐 Cloud & Panel Native:** Out-of-the-box support for Pterodactyl, BotGhost, FalixNodes, VPS, Docker, and Termux.

---

## ⚡ Zero-Dependency Architecture

Unlike traditional bot frameworks that pull hundreds of megabytes of nested `node_modules`, Arixa executes natively:

| Core Requirement | Traditional Bots | Arixa Platform |
| :--- | :--- | :--- |
| **HTTP Web Server** | Express / Fastify (~30 MB) | Native `http` & `https` (0 MB) |
| **Discord Gateway** | Discord.js / Eris (~50 MB) | Native WebSocket / TLS (0 MB) |
| **Encryption** | bcrypt / crypto-js (~20 MB) | Native `crypto` (AES-256-GCM) |
| **Data Compression** | pako / zlib packages (~15 MB) | Native `zlib` |
| **npm install Time** | 30s – 2 minutes | **0 seconds (Instant)** |

---

## 🚀 Quickstart (Local Development)

Follow these 3 simple steps to get Arixa running locally on your machine or Termux:

### Step 1: Clone Repository

Open your terminal and clone the repository:

```bash
git clone https://github.com/tuzhicodes/arixa.git
cd arixa
```

### Step 2: Environment Configuration

Create a `.env` file in the root directory:

```bash
touch .env
```

Open `.env` and configure your credentials:

```ini
# ==========================================
# 🤖 Discord Bot Core Credentials
# ==========================================
TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_application_id_here
DISCORD_CLIENT_SECRET=your_discord_client_secret_here
MASTER_KEY=generate_a_random_32_character_hex_key

# ==========================================
# 🌐 Web Dashboard & Networking
# ==========================================
PORT=3000
DISCORD_REDIRECT_URI=http://localhost:3000/auth/callback
BASE_URL=http://localhost:3000

# ==========================================
# 🏷️ Branding & Webhooks (Optional)
# ==========================================
NAME=Arixa
FOOTER=Powered by Arixa Engine
USER_LOGIN=
BOT_UPTIME=
BOT_CREATE=
ALLOWED_IDS=
```

### Step 3: Launch Arixa

Since there are no external dependencies, launch immediately without `npm install`:

```bash
npm start
```

Or run directly with Node:

```bash
node index.js
```

Your server will boot and display:
```text
[Arixa Server] HTTP dashboard listening on port 3000
[Arixa Gateway] Connecting to Discord Gateway API v10...
```

Open `http://localhost:3000` in your browser to access the management dashboard.

---

## 🌐 Hosting & Container Deployment (Pterodactyl / Bot Panels / VPS)

Deploying Arixa on container-based hosting panels (e.g., Pterodactyl, FalixNodes, BotGhost, PebbleHost) requires specific care regarding working directories.

### Deployment Workflow

```text
[GitHub Repo: tuzhicodes/arixa]
            │
            ▼  git clone <url> .  (trailing dot is critical!)
[/home/container/]
   ├── index.js          <-- Panel executes: node index.js
   ├── package.json
   ├── dashboard/
   ├── src/
   ├── utils/
   └── .env              <-- Manually created via File Manager
```

### Step-by-Step Panel Setup

#### 1. Clean Pre-installed Template Files
Many bot hosting panels initialize containers with template files (`package.json`, `index.js`, or sample bots).
- Go to **File Manager** in your hosting panel.
- Select and **Delete** any pre-existing files to prevent merge conflicts or path errors.

#### 2. Clone Repository to the Root Directory
In the panel console or startup Git option, clone using a trailing space and period (`.`):

```bash
git clone https://github.com/tuzhicodes/arixa.git .
```

> [!IMPORTANT]
> **Always append the trailing space and dot (`.`)!**
> If you run `git clone https://github.com/tuzhicodes/arixa.git` without the `.`, Git will create a subfolder `/home/container/arixa/`. The panel will then fail to find `/home/container/index.js`.

#### 3. Create the `.env` File
Because `.env` contains private tokens, it is excluded from Git via `.gitignore`.
1. Go to **File Manager**.
2. Click **New File** and name it `.env`.
3. Paste your environment keys (as shown in [Step 2](#step-2-environment-configuration)).
4. Save the file.

#### 4. Verify Panel Startup Settings
1. Navigate to the **Startup** tab in your hosting panel.
2. Verify that **Main File** / **JS_FILE** is set to `index.js`.
3. Click **Start** or **Restart** on the Console page.

---

## 🔧 Troubleshooting Common Hosting Errors

### Fix 1: `Error: Cannot find module '/home/container/index.js'`

```text
node: internal/modules/cjs/loader: 1607
Error: Cannot find module '/home/container/index.js'
code: 'MODULE_NOT_FOUND'
```

- **Why this happens:** The repository was cloned into a subfolder (`/home/container/arixa/index.js`) instead of the container root.
- **Solution (Move Files via File Manager):**
  1. Open your panel's **File Manager**.
  2. Open the `arixa/` folder.
  3. Select all files and folders (`index.js`, `package.json`, `dashboard/`, `src/`, `utils/`).
  4. Click **Move** and specify `/home/container/` (or target root `/`).
  5. Confirm that `index.js` is now directly visible in `/home/container/`.
  6. Restart the server.
- **Alternative Solution:** Change **Startup File** / **JS_FILE** under the **Startup** tab to `arixa/index.js`.

---

### Fix 2: `15 packages looking for funding` / `npm audit` warnings

```text
15 packages are looking for funding run npm fund for details
2 vulnerabilities (1 moderate, 1 high) To address all issues, run: npm audit fix
```

- **Why this happens:** The hosting container pre-loaded an egg template with unwanted npm packages before cloning Arixa.
- **Solution:** Arixa has **0 dependencies**. Once Arixa's clean `package.json` is placed in `/home/container/package.json`, you never need to run `npm install` or `npm audit fix`. Simply run `node index.js`.

---

### Fix 3: Invalid Token / Gateway Login Failures

- **Why this happens:** The `.env` file was not created or the `TOKEN` is malformed.
- **Solution:** Ensure `/home/container/.env` exists and contains your valid bot token without quotes or spaces.

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

### How It Works:
1. Bot owners choose colors directly in the web dashboard.
2. Changes are saved to `bot.json` via `/api/bot/:botId/theme-colors`.
3. The host engine (`dashboard/botHost.js`) dynamically attaches `ctx.colors` to every interaction, message, and component execution context.
4. When any plugin calls `ctx.replyWarn`, `ctx.replyError`, or `ctx.replyCooldown`, the host engine renders a standard Discord Component V2 card with the bot's configured color.

---

## 🚨 System Alert Standards (Warn, Error, Cooldown, Success)

All plugins follow this unified notification standard:

### 1. Warning Notice (`ctx.replyWarn`)
- **When to use:** Invalid user arguments, missing permissions, server-only commands in DMs.
- **Visuals:** System warning emoji (`<:Warning:...>`), bot's `warning` color accent, auto-deletes after 10s.
```javascript
if (!ctx.hasPermission("MANAGE_GUILD")) {
  return ctx.replyWarn("You need Manage Server permission to use this command.");
}
```

### 2. Error Notice (`ctx.replyError`)
- **When to use:** Caught exceptions, failed Discord API requests, internal errors.
- **Visuals:** System error emoji (`<:error:...>`), bot's `error` color accent, auto-deletes after 10s.
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
```javascript
if (!ctx.cooldown(10)) return;
```

### 4. Success Notice (`ctx.replySuccess`)
- **When to use:** Action completions, prefix changes, moderation confirmations.
- **Visuals:** Green / Main v2 card with success emoji (`✅`).

---

## 🧩 Plugin Architecture & Developer Guide

Plugins are isolated, self-contained modules located under `src/plugins/` (built-in) or `data/plugins/` (user-installed).

### Plugin Template (`index.js`)

```javascript
module.exports = {
  name: "ping",
  version: "1.0.0",
  description: "High-precision latency monitor",
  
  // Text & Slash Commands
  commands: {
    ping: {
      description: "Check bot latency and gateway ping",
      async execute(ctx) {
        if (!ctx.cooldown(5)) return;
        return ctx.replySuccess(`🏓 Pong! Latency: ${ctx.ping}ms`);
      }
    }
  },

  // Gateway Event Listeners
  events: {
    MESSAGE_CREATE(msg, ctx) {
      // Custom event handling
    }
  }
};
```

For comprehensive plugin specifications, component builders, and complete examples, refer to:
- [`src/plugins/README.md`](src/plugins/README.md) — Detailed Plugin Developer Reference & Templates.
- Web Dashboard Documentation view at `/docs` (or [`dashboard/views/docs.html`](dashboard/views/docs.html)).

---

## 📂 Project Structure

```text
arixa/
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
├── LICENSE               # MIT Open Source License
└── .gitignore            # Excludes sensitive data (.env, data/) & cache
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
