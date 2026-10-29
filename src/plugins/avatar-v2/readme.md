---
name: Avatar & Banner V2
tag: Utility
description: Modern Components V2 profile media viewer with interactive direct-asset link buttons and smart target resolution.
version: 2.0.0
author: @community
---

# Avatar & Banner V2
Next-generation profile media viewer utilizing Discord Components V2 (`flags: 32768`, Container `type: 17`) with interactive asset link buttons (`PNG`, `JPG`, `WEBP`, `GIF`) and dynamic server accent colors.

### Features
* **Components V2 Container**: Renders inside a modern Discord card (`type: 17`) with dynamic accent color (`ctx.colors.v2`).
* **Direct Asset ActionRow**: Interactive link buttons for downloading full-resolution PNG, JPG, WEBP, and GIF media.
* **Smart Target Resolution Hierarchy**:
  1. Mention/ID in arguments or slash command option (overrules message reply).
  2. Replied message author when replying without arguments.
  3. Command invoker (self) when no arguments or reply are provided.
* **Multi-Bot Deduplication**: Isolated per-bot message keying ensures multiple bots in the same server execute without muting or interference.
