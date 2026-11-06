---
name: Say V1
tag: Utility
description: Send announcements or messages as the bot in plain text or rich embeds with thumbnail and banner images. Ghost pings disabled by default.
version: 1.0.0
author: @community
---

# Say V1

Easily send messages and announcements as your bot in plain text or styled embeds with custom thumbnails and banners.

::: card 🌟 Features & Highlights
* **Dual Execution Mode**: Supports both Slash (`/say`) and Prefix (`!say`) commands.
* **Smart Auto-Switching Format**:
  - Without media: Posts as clean **Plain Text Message**.
  - With `thumbnail` or `banner`: Automatically formats as a **Rich Embed** with the text in `description` and your bot's master accent color.
* **Multi-Channel Delivery**: Option to route the message to any text channel or announcement channel.
* **Safe Mentions Protection**: Disables ghost pings (`allowed_mentions: { parse: [] }`) so text containing `@everyone`, `@here`, roles, or users appears formatted but will not ping/disturb members.
* **Clean Prefix Mode**: Automatically deletes the user's `!say` trigger message when possible for seamless announcements.
:::

> [!TIP]
> Use direct image URLs (ending in `.png`, `.jpg`, or `.webp`) for thumbnail and banner options for optimal embed formatting!

### Commands

| Command | Type | Description |
| :--- | :--- | :--- |
| `/say message:<text> [channel] [thumbnail] [banner]` | Slash | Send plain text or embed with custom image options to any channel. |
| `!say <message>` | Prefix | Send plain text message to the current channel. |

### Permissions
* Requires **Manage Messages** permission (or Server Owner / Administrator / Bot Owner).
