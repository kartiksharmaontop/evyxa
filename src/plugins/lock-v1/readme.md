---
name: Lock & Unlock
tag: Moderation
description: Quick text channel lock and unlock moderation tool for slash and prefix commands with 1-line clean embed alerts.
version: 1.0.0
author: @community
---

# Lock & Unlock

Quickly lock and unlock text or announcement channels in your server to control member chat permissions during raids, maintenance, or announcements.

::: card 🛡️ Key Highlights
* **Dual Execution**: Supports both Slash (`/lock`, `/unlock`) and Prefix (`!lock`, `!unlock`) commands.
* **Auto-Current Channel Fallback**: Target `channel` is optional; defaults to the channel where the command is used.
* **Clean 1-Line Embeds**: Responds with clean 1-line alerts styled with your bot's master accent color.
* **Smart Overwrite Handling**: Preserves existing channel permission overrides while denying or restoring member message privileges.
* **System Alerts**: Automatically triggers system warnings if the channel is already locked/unlocked or if the bot lacks permissions.
:::

### Commands

| Command | Type | Description |
| :--- | :--- | :--- |
| `/lock [channel]` | Slash | Lock a text channel for `@everyone`. |
| `!lock [channel]` | Prefix | Lock a text channel for `@everyone`. |
| `/unlock [channel]` | Slash | Unlock a text channel for `@everyone`. |
| `!unlock [channel]` | Prefix | Unlock a text channel for `@everyone`. |

### Permissions
* Requires **Manage Channels** permission (or Server Owner / Administrator / Bot Owner).

```config
{
  "fields": [
    {
      "key": "emoji_lock",
      "label": "Lock Channel Emoji",
      "type": "text",
      "default": "🔒",
      "description": "Emoji displayed in the lock notification embed"
    },
    {
      "key": "emoji_unlock",
      "label": "Unlock Channel Emoji",
      "type": "text",
      "default": "🔓",
      "description": "Emoji displayed in the unlock notification embed"
    }
  ]
}
```

> [!TIP]
> Ensure your bot has the **Manage Channels** permission granted in the target channel so it can update permissions. Customize your lock/unlock emojis anytime from the Bot Dashboard!
