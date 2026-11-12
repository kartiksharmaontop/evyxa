---
name: Timeout & Mute
tag: Moderation
description: Time out or mute members with duration parsing, role hierarchy checks and clean plain-text alerts for slash and prefix commands.
version: 1.0.0
author: @community
---

# Timeout & Mute

Temporarily silence members with Discord timeouts. Slash gets the exact `timeout` and `untimeout` commands, while `mute` and `unmute` are prefix shortcuts that use your default mute duration.

::: card ⏱️ Key Highlights
* **Dual Execution**: Slash for `timeout`/`untimeout`, prefix for `timeout`, `untimeout`, `mute` and `unmute`.
* **Smart Mute**: `mute` applies your configured duration (28 days by default), `mute @user 1h` overrides it.
* **Safe by Default**: Guild owner, bot, role hierarchy and `MODERATE_MEMBERS` checks run before every action.
* **State Aware**: Warns when a timeout already exists or when there is nothing to remove.
* **Clean Alerts**: Plain one-line success messages and native system warnings for failures.
:::

### Commands

| Command | Type | Description |
| :--- | :--- | :--- |
| `/timeout <user> <duration> [reason]` | Slash + Prefix | Time a member out for the given duration. |
| `/untimeout <user> [reason]` | Slash + Prefix | Remove an active timeout. |
| `mute <user> [duration] [reason]` | Prefix only | Mute with the default duration. |
| `unmute <user> [reason]` | Prefix only | Remove an active mute. |

### Duration Formats

`10s`, `30m`, `1h`, `1d`, `1w` — maximum **28 days**, which is Discord's own timeout limit.

### Examples

```text
/timeout user:@John duration:10m reason:spamming
/untimeout user:@John
!timeout @John 1h warning
!mute @John repeated pings
!mute @John 30m warning
!unmute @John
```

### Permissions
* Requires **Moderate Members** for you and for the bot.
* The bot's highest role must sit above the target member's highest role.
* The server owner and the bot itself can never be timed out.

```config
{
  "fields": [
    {
      "key": "emoji_success",
      "label": "Success Emoji",
      "type": "text",
      "default": "✅",
      "description": "Emoji displayed in the success message"
    },
    {
      "key": "mute_duration",
      "label": "Default Mute Duration",
      "type": "text",
      "default": "28d",
      "description": "Duration used when mute is run without one"
    }
  ]
}
```

> [!TIP]
> Give the bot the **Moderate Members** permission and keep its role above the members you manage. Both values can be changed anytime from the Bot Dashboard!
