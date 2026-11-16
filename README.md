# Arixa

A lightweight Discord bot management platform and dashboard built on Node.js.

Arixa lets you run and manage multiple Discord bots from a single web interface. It includes a modular plugin system, customizable themes, and secure token storage without relying on heavy frameworks. Designed to run smoothly on small VPS instances, Pterodactyl panels, local machines, and Termux.

---

## Highlights

- **Web Dashboard:** Manage bots, monitor status, and tweak settings directly from the browser.
- **Multi-Bot Hosting:** Run multiple bots simultaneously from one instance.
- **Modular Plugins:** Drop-in plugins for moderation, music, embeds, utility commands, and auto-moderation with hot-reloading.
- **Minimal Footprint:** Built primarily around Node's standard library for quick boot times and low memory usage.
- **Theme Customization:** Centralized color schemes and embeds configured per bot.
- **Secure Token Storage:** Tokens and sensitive credentials are encrypted at rest with AES-256-GCM.

---

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- A Discord Application (Bot Token and Client credentials from the [Discord Developer Portal](https://discord.com/developers/applications))

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/tuzhicodes/arixa.git
   cd arixa
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Create a `.env` file in the project root:
   ```ini
   TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_client_id_here
   DISCORD_CLIENT_SECRET=your_client_secret_here
   MASTER_KEY=generate_a_random_32_character_hex_key
   PORT=3000
   DISCORD_REDIRECT_URI=http://localhost:3000/auth/callback
   BASE_URL=http://localhost:3000
   NAME=Arixa
   FOOTER=Powered by Arixa
   ```

4. **Start the server:**
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in your browser to log in and set up your bots.

---

## Hosting on Pterodactyl / VPS

When deploying to container panels like Pterodactyl, PebbleHost, or FalixNodes:

1. Clone directly into the container root:
   ```bash
   git clone https://github.com/tuzhicodes/arixa.git .
   ```
   *(Notice the trailing `.` so it doesn't create an unnecessary subfolder).*

2. Create your `.env` file using the panel's file manager.
3. Make sure the startup command points to `node index.js`.
4. Start the server.

---

## Writing Plugins

Plugins live in `src/plugins/<plugin-id>/main/index.js`. A minimal plugin looks like this:

```javascript
module.exports = {
  commands: [
    {
      name: "ping",
      description: "Check bot latency",
      slash: true,
      prefix: true,
      cooldown: 5
    }
  ],

  onCommand: async function (ctx) {
    return ctx.replyEmbed({
      description: `🏓 Pong! Latency: ${ctx.ping || 0}ms`
    });
  }
};
```

You can view available plugins or install custom ones through the dashboard at `/plugins`.

---

## Project Structure

```text
arixa/
├── dashboard/       # Web server, bot manager & views
├── src/
│   └── plugins/     # Built-in plugins (music, moderation, etc.)
├── utils/           # Helper functions & logging
├── index.js         # Entry point
└── package.json
```

---

## License

This project is licensed under the [MIT License](LICENSE).
