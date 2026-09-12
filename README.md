# HomeBot

Persistent "living home" bot swarm for Minecraft anarchy servers (1.21.1, offline-mode).

Repository: [lama2923/homebot](https://github.com/lama2923/homebot)

Each bot anchors a respawn point (bed) and auto-accepts `/tpa` requests from allowlisted players — a reliable way to return home on servers without `/home`.

## Features

- **Multi-bot daemon** — one process, many bots (20+ per instance)
- **AuthMe integration** — register/login with configurable regex prompts
- **TPA guard** — allowlist-gated, FIFO-queued, rate-limited, with race-condition hardening for bare-`/tpaccept` servers
- **Bed anchoring** — click-to-register respawn point, auto-reclick on reconnect
- **Auto-reconnect** — TCP probe + exponential backoff on disconnect/kick
- **GUI** — Iced-based desktop client with EN/DE/ES/FR/RU/TR locales
- **IPC** — NDJSON JSON-RPC 2.0 over Unix socket (mode 0600)

## Architecture

```
daemon/src/        Node.js + mineflayer bot swarm
  main.js          Entry: config, DB, registry, IPC, auto-start
  bot.js           BotRunner: mineflayer, AuthMe, bed, death/respawn, reconnect
  tpaguard.js      TPA guard S1–S7: system-chat parse, allowlist, FIFO, rate limits
  auth.js          Auth profile compilation (regex from TOML only — no hardcoded patterns)
  db.js            SQLite via node:sqlite (no native deps)
  registry.js      BotRegistry: manages runners, wires events to DB + IPC
  ipc.js           IPC server: Unix socket, NDJSON JSON-RPC, event streaming

crates/ui/         Rust + Iced 0.13.1 GUI (separate workspace)
crates/protocol/   JSON-RPC message types (serde)
locales/           UI string tables (en/de/es/fr/tr)
systemd/           homebotd.service
```

## Quick Start

```bash
# Install daemon + GUI + config + systemd service
make install

# Edit config
$EDITOR ~/.config/homebot/homebot.toml

# Run daemon
make run-daemon

# Run GUI
make run-gui
```

## Configuration

`~/.config/homebot/homebot.toml` — all settings including regex patterns for AuthMe prompts, TPA messages, and kick detection. See `config.example.toml`.

All regex patterns are defined in TOML. The daemon refuses to start with missing/empty pattern keys.

## Security

- DB and socket are `0600`
- No secrets in logs (passwords masked in command history)
- `tpa_log` is append-only
- TPA guard never sends a named accept on bare-`/tpaccept` servers — race safety comes from freeze/rival/confirm layers

## License

GNU Affero General Public License v3 (AGPLv3)

See [LICENSE](LICENSE). Network-based deployment (including the daemon's IPC server) must provide source to users under AGPLv3 
