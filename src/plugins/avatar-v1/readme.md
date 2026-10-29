---
name: Avatar & Banner
tag: Utility
description: Display high-resolution user avatars and profile banners with smart reply/mention hierarchy and direct download links.
version: 1.0.0
author: @community
---

# Avatar & Banner
Comprehensive profile media plugin providing `/avatar` and `/banner` commands with intelligent target resolution, high-resolution CDN media rendering, and dynamic theme colors.

### Features
* **Smart Target Hierarchy**:
  1. Mention/ID passed in arguments or slash option (takes precedence over message replies).
  2. Replied message author when replying without arguments.
  3. Command author (self) when no arguments or reply are provided.
* **Full-Resolution Media**: Automatically renders 1024px avatar and banner images with animated GIF support.
* **Direct Asset Links**: Includes one-click links for PNG, JPG, WEBP, and GIF formats.
* **No Confirmation Overhead**: Direct, instant response in traditional Discord Embed format.
