name: Embed Builder
tag: Utility
description: Build, edit, and manage named embeds with a live preview builder, saved names, and autocomplete suggestions.
version: 1.0.0
author: @community

# Embed Builder

Create rich Discord embeds with a live preview card. Every change you make in the pop-up forms updates the preview instantly, and finished embeds are saved under a name so you can view, edit, or delete them later.

## Commands

| Command | Description |
| --- | --- |
| `/embed set name:<text>` | Open the live builder for a new embed. The name must be unique in the server. |
| `/embed edit name:<text>` | Re-open the builder for a saved embed. Name suggestions appear while you type. |
| `/embed delete name:<text>` | Delete a saved embed and its message. Name suggestions included. |
| `/embed view name:<text> [channel]` | Send a saved embed to a channel (defaults to current channel). |
| `/embed list` | Paginated list of every saved embed with its owner. |

## Builder Buttons

- **Title** — title, description, and color (hex like `#5865f2`)
- **Author** — author name, icon URL, and profile URL
- **Footer** — footer text, icon URL, and timestamp on/off
- **Image** — large image URL and thumbnail URL
- **Save** — posts or updates the embed and stores it under its name
- **Cancel** — closes the builder without saving

Builder sessions expire after 5 minutes of inactivity (timer auto-resets on every button click). Empty fields clear that section.

## Permissions

- `set`, `edit`, `delete`, and `view` require **Manage Messages**. Server administrators and the server owner pass automatically, and configured bot owners always pass.
- `list` is available to everyone.

## Notes

- Names are case-insensitive, up to 32 characters, and may contain letters, numbers, spaces, `_`, and `-`.
- Saved embeds live per server. Editing one updates the original message in place, so the link never changes.
- The saved message is posted with no allowed mentions, so `@everyone` in a description stays silent.
