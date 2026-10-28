---
name: arixa-plugin-developer
description: Official rules, standards, and architecture guide for developing crash-proof Discord plugins for the Arixa platform. Use when creating, refactoring, or verifying Arixa plugins.
---

# Arixa Plugin Developer Skill

This skill provides the complete architectural standards, zero-tolerance rules, and SDK reference for building plugins on the Arixa multi-tenant Discord bot framework.

When generating or editing any Arixa plugin, every AI assistant must strictly follow the specifications below.

---

## 1. Zero-Tolerance Rules

1. **NO Comments in Code**: Absolutely NO comments (`//`, `/* ... */`, `#`) in JavaScript files. Zero comments.
2. **NO Hardcoded Colors**: Never write hex codes (like `#5865F2`). Always use `ctx.colors.v1`, `ctx.colors.v2`, `ctx.colors.warning`, `ctx.colors.error`, and `ctx.colors.cooldown`.
3. **Naming Suffix Rule (`-v1` vs `-v2`)**:
   - Folders ending in `-v1` are strictly traditional Discord Embeds (`ctx.replyEmbed`).
   - Folders ending in `-v2` are strictly Discord Components V2 (`flags: 32768`, Container `type: 17`, Text Display `type: 10`).
   - If using Components V2, folder MUST end in `-v2`.
4. **NO Double Cooldowns**: When `cooldown` is defined in the command options, the bot engine automatically handles it. Do NOT call `ctx.cooldown(...)` manually in `onCommand`.
5. **Role Hierarchy & Safety Pre-Checks**:
   - Never show confirmation buttons if an action will fail.
   - Always pre-check if target is Guild Owner, Bot, or has a role position higher than or equal to the Bot or Author.
   - If checks fail, immediately send `ctx.replyWarn(...)` and do not display confirmation buttons.
   - Never announce success if `ctx.request` returns HTTP 403 or Discord error code `50013` (Missing Permissions).
6. **Confirmation Expiration**:
   - Interactive buttons expire after exactly 2 minutes (120,000 ms).
   - Use `global.__arixa_<plugin>_actions = global.__arixa_<plugin>_actions || new Map();`.
   - Clear timer (`clearTimeout`) upon confirmation or cancellation.
7. **Storage**:
   - Always use `ctx.storage.get/set/delete`. Never use `fs` directly in plugins.
8. **Case-Insensitive Prefixes**:
   - Always use `content.toLowerCase().startsWith(prefix.toLowerCase())`.
9. **English Only**:
   - All code, variable names, messages, and docs must be in English.
10. **Workspace & Repository Identification**:
   - Arixa root path is `/storage/emulated/0/app` (`https://github.com/tuzhicodes/arixa.git`, branch `main`). All Arixa plugins belong here, never in `/storage/emulated/0/A+` (ZarKos).

---

## 2. Full Rulebook Reference

For the comprehensive guide with code templates and full SDK method breakdowns, refer to:
[ARIXA_PLUGIN_RULES.md](file:///storage/emulated/0/app/skill/ARIXA_PLUGIN_RULES.md)
