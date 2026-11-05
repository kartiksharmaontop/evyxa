---
name: Dark Log
tag: Logging
description: Clean, real-time logging plugin for bot commands, server joins, and server leaves with multi-channel routing and Discord Components V2 cards.
version: 1.0.1
author: @community
---

# Dark Log
Comprehensive logging system tracking all command executions, server joins, and server leaves with clean markdown formatting, dynamic theme colors, thumbnail previews, and comma-separated multi-channel dispatch.

```config
{
  "fields": [
    {
      "key": "command_logs",
      "label": "Command Log Channel IDs (comma-separated)",
      "type": "text",
      "placeholder": "1561325420740218962, 1454847386441617462"
    },
    {
      "key": "join_logs",
      "label": "Join Log Channel IDs (comma-separated)",
      "type": "text",
      "placeholder": "1561325420740218962"
    },
    {
      "key": "leave_logs",
      "label": "Leave Log Channel IDs (comma-separated)",
      "type": "text",
      "placeholder": "1561325420740218962"
    }
  ]
}
```
