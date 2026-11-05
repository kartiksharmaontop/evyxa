name: Auto React
tag: Utility
description: Set emojis for a person and the bot reacts with them every time someone pings that person.
version: 1.0.2
author: @community

# Auto React

Pick a user, give them up to 5 emojis, and let the bot do the reacting. Any time somebody pings that person in the server, the bot drops those emojis on the message.

## Commands (bot owner only)

| Command | What it does |
|---------|-------------|
| `/autoreact set user:<user> emoji:<emoji>` | Give a user an auto react emoji (5 per person max). |
| `/autoreact remove user:<user> emoji:<emoji>` | Take one emoji away. Leave the emoji empty to clear all of them. |
| `/autoreact list` | Shows everything set up in this server, with buttons to page through. |

Prefix works too: `!autoreact set @user 😀`.

## Notes

- Regular emojis and custom ones (`<:name:id>` / `<a:name:id>`) both work, as long as the bot can use that custom emoji.
- It only reacts to real pings. `@everyone`, `@here` and role mentions do nothing, and a plain reply won't trigger it either — you have to actually type the `@user` in the message.
- The bot needs **Add Reactions** and **Read Message History** in the channel.
- Who counts as the owner: the Discord application owner, plus anyone you add in **Dashboard → Bot → Advanced Settings → Owner IDs**.
- The list buttons (⏪ ◀️ ▶️ ⏩) can be changed in **Customize**.
