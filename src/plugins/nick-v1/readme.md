---
name: Nickname
tag: Moderation
description: Set or reset any member's server nickname with a single slash and prefix command, guarded by role hierarchy and permission pre-checks.
version: 1.0.0
author: @community
---

# Nickname

Change or reset server nicknames for yourself or any other member with one simple command. Leave the name empty and the member goes back to their default global username.

::: card ✨ Key Highlights
* **One Command**: `/nick` handles both setting and resetting, no subcommands.
* **Smart Reset**: Empty name restores the member's default global username.
* **Safe by Default**: Guild owner, role hierarchy and permission checks run before any change.
* **Clean Alerts**: Plain one-line success messages with native system warnings for failures.
:::

### Commands

| Command | Type | Description |
| :--- | :--- | :--- |
| `/nick name:<name>` | Slash | Set your own nickname. |
| `/nick user:<user> name:<name>` | Slash | Set a member's nickname. |
| `/nick user:<user>` | Slash | Reset that member's nickname to default. |
| `nick <name>` | Prefix | Set your own nickname. |
| `nick @user <name>` | Prefix | Set a member's nickname. |
| `nick @user` | Prefix | Reset that member's nickname to default. |
| `nick` | Prefix | Shows the usage hint. |

Aliases: `nickname`, `setnick`

### Examples

```text
/nick name:Raven
/nick user:@John name:John Doe
!nick @John Doe
!nick John Doe
```

### Permissions
* Changing your own nickname requires **Change Nickname** (granted to everyone by default).
* Changing another member's nickname requires **Manage Nicknames** for both you and the bot.
* The bot's highest role must sit above the target member's highest role.

```config
{
  "fields": [
    {
      "key": "emoji_success",
      "label": "Success Emoji",
      "type": "text",
      "default": "✅",
      "description": "Emoji displayed in the success message"
    }
  ]
}
```

> [!TIP]
> Give the bot the **Manage Nicknames** permission and keep its role above the members you want to manage. Customize the success emoji anytime from the Bot Dashboard!
