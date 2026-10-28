---
name: Prefix V2
tag: Utility
description: Modern prefix manager powered by Discord Components V2 with multi-prefix and dual slash support.
version: 2.0.0
author: @community
---

# Prefix V2
Modern, clean prefix manager built with Discord Components V2. Supports per-server custom prefixes, global prefix fallback, direct bot mentions, and independent customizable aliases.

```config
{
  "fields": [
    { "key": "main_prefix", "label": "Default Global Prefix", "type": "text", "default": "!" },
    { "key": "enable_global_prefix", "label": "Enable Global Prefix", "type": "toggle", "default": "true" },
    { "key": "enable_mention_prefix", "label": "Enable Bot Mention Prefix", "type": "toggle", "default": "true" },
    { "key": "emoji_set", "label": "Set Prefix Emoji", "type": "text", "default": "✅" },
    { "key": "emoji_reset", "label": "Reset Prefix Emoji", "type": "text", "default": "✅" },
    { "key": "emoji_info", "label": "View Prefix Emoji", "type": "text", "default": "🔹" },
    { "key": "aliases_info", "label": "Info Command Aliases", "type": "text", "default": "prefix, prefixview, prefixinfo" },
    { "key": "aliases_set", "label": "Set Command Aliases", "type": "text", "default": "prefixset, setprefix, prefixadd" },
    { "key": "aliases_reset", "label": "Reset Command Aliases", "type": "text", "default": "prefixreset, resetprefix, removeprefix" }
  ]
}
```
