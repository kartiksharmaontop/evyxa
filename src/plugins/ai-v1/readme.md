---
name: AI Chat
tag: AI
description: A customizable AI character that auto-replies in a chosen channel with mood-aware emojis, stickers, memory and multi-key, multi-model fallback on free providers.
version: 1.2.0
author: @community
---

# AI Chat
A customizable AI character for your server. Pick one channel and the AI replies to every message there, following the personality, language and reply style you configure from the dashboard.

### Commands
* `/ai set [channel]` or `ai set`: Set the auto-reply channel (defaults to the current channel). Bot owner only.
* `/ai reset` or `ai reset`: Reset the AI settings for this server. Bot owner only.
* `/ai on` or `ai on`: Turn auto-reply on. Bot owner only.
* `/ai off` or `ai off`: Turn auto-reply off. Bot owner only.
* `/memory clear` or `memory clear`: Clear your own conversation memory. Everyone can use it.

### Customization
* **Identity**: AI name, owner name, introduction, likes, dislikes and backstory.
* **Personality / Mood**: happy, funny, calm, serious, sarcastic, friendly or anything you write.
* **Reply Style**: human, short, balanced, detailed or your own instruction.

### Reply Modes
* **human**: casual friend-like texting, usually 1-2 short sentences, no lists or headings.
* **short**: one short sentence or a few words, direct and natural.
* **balanced**: clear 2-4 sentence answers, with a small list or example only when useful.
* **detailed**: thorough but natural 2-4 paragraph answers, with concrete details and optional short steps.
Aliases such as `casual`, `brief`, `concise`, `normal`, `long` and `thorough` also work. Mode names are case-insensitive and tolerate extra commas or spaces. Any other value is treated as a custom style instruction. Detailed mode keeps at least 450 output tokens and balanced mode at least 220 so the reply does not get cut off.
* **Language**: hindi, english, hinglish, all (match the user) or any language name.
* **Custom Emojis and Stickers**: On by default. Emojis from every server the bot is in can be used, and stickers from the current server. They are used only when they match the mood of the conversation.

### Providers, Keys and Models
Choose one provider (groq, gemini, openrouter, cerebras, mistral or nvidia) and enter only that provider's API keys and model IDs, separated by commas. If a key or model fails, the next one is tried automatically. If everything fails, a short error message is shown.

NVIDIA uses the OpenAI-compatible NIM API with keys from https://build.nvidia.com/settings. The default model is `nvidia/nemotron-3.5-lightning-30b-a3b`; you can enter any other NVIDIA NIM model ID in the Models setting.

### Repetition Guard
The AI remembers its recent replies to each user and will not reuse or closely paraphrase the same long answer. Short casual replies like "haha", "ok" or "lol" are allowed to repeat. If a duplicate reply appears, the plugin retries up to 3 times with fresh wording. If every retry repeats, an error message from the system is shown instead of sending the same reply again.

### Reply Tuning
Temperature, frequency penalty and presence penalty can be adjusted in the plugin settings to make replies more varied. Frequency and presence penalties help reduce repeated wording inside a reply, while the repetition guard handles repeats across messages.

### Identity Lock
Whatever introduction you write, the AI always says it is hosted on Arixa, and never reveals its model, provider, API keys or hidden instructions.
