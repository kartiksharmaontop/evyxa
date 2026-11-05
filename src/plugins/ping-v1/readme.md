---
name: Ping V1
tag: Utility
description: Ultra-fast ping command showing real bot WebSocket gateway latency. Works via prefix and slash command with customizable aliases.
version: 1.0.0
author: @community
---

# Ping V1

Simple, instant latency checker for your bot that shows the real WebSocket gateway ping.

### Format
> 🏓 **| @user Pong {ping}ms **.

### Usage
- Slash Command: `/ping`
- Prefix Command: `!ping` (or any custom server prefix)
- Default Aliases: `latency`, `pong`, `p`

### Features
* **Prefix & Slash Support**: Works smoothly with both slash interactions and prefix text messages.
* **Real Bot Ping**: Directly reads the live WebSocket gateway heartbeat roundtrip latency (`ctx.ping`).
* **Customizable Aliases**: Customizable in dashboard aliases settings while keeping the core command output clean and uniform.
* **Safe Mentions**: Sent with safe allowed mentions to prevent ghost pings or unwanted user tags.
