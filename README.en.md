# ZCode Skin

Reskin the ZCode desktop client. Themes are injected at runtime over the local CDP debug port
and only override CSS variables — the app bundle, code signature, and session data are never
touched. One-click restore to the official look at any time.

Requirements: macOS + Node.js 22+ (uses built-in WebSocket/fetch, zero npm dependencies).

## Highlights

- **In-app Theme Center** — a 🎨 button in the bottom-right corner of ZCode: theme list with
  color swatches, one-click switching, random theme, upload an image to generate a new theme,
  restore button, and toggles — all without restarting ZCode.
- **Skin daemon (LaunchAgent)** — re-injects the skin within seconds if ZCode reloads or
  updates, serves the theme list to the panel, and sends a macOS notification when the debug
  port is lost (e.g. ZCode was restarted normally). It never restarts ZCode on its own.
- **One image → one theme** — automatic palette extraction, light/dark detection, and accent
  visibility correction. Available from the terminal and from the panel's upload row.
- **"ZCode 皮肤.app" launcher** — double-click to restore the last skin, self-check the daemon,
  or get instructions when the debug port is missing.
- **Reading enhancement** — optional translucent backdrop for AI replies and thinking blocks.
- **22 built-in themes** — 8 gradient + 14 image-based (anime wallpapers for personal use).

## Quick start

```bash
bash apply-skin.sh        # one-time enable: restarts ZCode with the debug port, injects default skin
bash install-daemon.sh    # optional: theme center + auto-recovery + notifications
bash use-skin.sh          # terminal menu
```

Daily switching never restarts ZCode. Full documentation is in [README.md](README.md) (Chinese).

## Security

Both local ports (9343 CDP, 9344 theme API) bind to 127.0.0.1 only and have no authentication —
same-user processes on this machine can reach them. See [SECURITY.md](SECURITY.md).

## License

MIT.
