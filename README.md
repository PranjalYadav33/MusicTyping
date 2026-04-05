<div align="center">
  <img src="public/logo.png" alt="MusicType Logo" width="150" />
  <h1>MusicType</h1>
  <p><strong>Type the lyrics. Feel the beat.</strong></p>
  <p>A premium, high-performance music typing app combining the aesthetic of Monkeytype with live lyric-synchronized typing.</p>
  
  <h3>
    <a href="https://github.com/PranjalYadav33/MusicTyping/releases/latest">🚀 Download the Latest Release (Windows, macOS, Linux)</a>
  </h3>
</div>

---


> [!WARNING]
> **PRE-ALPHA SOFTWARE**  
> MusicType is currently in extremely early alpha. Expect bugs, edge cases, and incomplete features. This repository is intended for developers, tinkerers, and typists who want to explore the concept or contribute.

## 🎵 Features
- **Word-by-Word Sync**: Type lyrics in perfect time with the music. Advanced heuristic syncing evenly distributes typing timing for lyrics without explicit word-level stamps.
- **Premium Aesthetics**: Zero distractions. Monkeytype-inspired minimalist aesthetics.
- **Auto-Frictionless Audio Engine**: Automatically downloads and strictly sandboxes `yt-dlp` to directly stream audio to the client instantly, with zero external dependencies required for the user.
- **Multi-Provider Lyrics**: Intelligently searches and hot-swaps through lyrics providers via an active UI selector (`LRCLIB Exact`, `LRCLIB Broad`, `Lyrics.ovh`).
- **Detailed Analytics**: End-of-song SVG charts breaking down real-time WPM, accuracy drops, consistent keystrokes, and heatmap data.
- **Live Playback Controls**: Modify audio playback speed (0.5x to 2x) or skip forward without losing data.

## 🛠️ Local Development & Setup

This is a hybridized Next.js and Electron project. Ensure you have `Node.js` installed.

2. **Install dependencies:**
   ```bash
   git clone https://github.com/PranjalYadav33/MusicTyping.git
   cd MusicTyping
   npm install
   ```

3. **Start the application (Dev Mode):**
   ```bash
   npm run electron:dev
   ```
   *Note: This command concurrently boots the Next.js Turbopack compiler and attaches the Electron window via `wait-on`. Wait a few seconds for the window to appear!*

## ⚖️ Legal & Disclaimer

> **For Fun, Not For Profit**  
> This application was created entirely as a personal hobby project/experiment to merge two distinct areas of interest (music players and typing tests). The developer is not earning **any** money from this software, and there are absolutely zero native monetizations, ads, or premium subscriptions. 

**3rd-Party Streaming Notice:**  
MusicType utilizes an automated proxy extraction script exclusively to stream non-copyright-infringing audio via valid proxy requests. We do not store, download, distribute, or host any audio or copyrighted material on any of our infrastructure. By using this software, users agree that they are responsible for adhering to their local digital copyright laws, YouTube's Terms of Service, and appropriate API usage restrictions.

**Open Source Limitation of Liability:**  
Provided "as is" under standard open source licensing. The developers hold no liability for how this client is utilized. 

---

*Made with ❤️ and lots of keystrokes.*
