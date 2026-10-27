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
    { "key": "aliases_info", "label": "Info Command Aliases", "type": "text", "default": "prefix, prefixview, prefixinfo" },
    { "key": "aliases_set", "label": "Set Command Aliases", "type": "text", "default": "prefixset, prefixadd, prefixdd, setprefix" },
    { "key": "aliases_reset", "label": "Reset Command Aliases", "type": "text", "default": "removeprefix, prefixremove, resetprefix, prefixreset" },
    { "key": "msg_set_success", "label": "Set Prefix Success Message", "type": "text", "default": "> **Successfully Set Prefix `{prefix}`**" },
    { "key": "msg_reset_success", "label": "Reset Prefix Success Message", "type": "text", "default": "> **Successfully Reset Prefix `{prefix}`**" },
    { "key": "msg_noperm", "label": "No Permission Warning Message", "type": "text", "default": "You need the Manage Server permission to use this command." },
    { "key": "msg_invalid", "label": "Invalid Prefix Warning Message", "type": "text", "default": "The prefix must be 1 to 5 characters and cannot contain spaces." }
  ]
}
```
