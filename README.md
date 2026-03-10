# ERPNext Level

Multi-instance ERPNext dashboard for managing multiple ERPNext sites from a single interface. Built by the [OpenAEC Foundation](https://github.com/OpenAEC-Foundation).

## Features

- **Multi-instance support** — Connect and switch between multiple ERPNext sites
- **Real-time caching** — Polls all instances every 60 seconds for incremental updates
- **25+ dashboard pages** — Sales, purchases, projects, tasks, HR, financial reports, and more
- **Quick time booking** — Book hours directly from the dashboard with project/task selection
- **Agent assistant** — Natural language command interface for common ERPNext actions
- **Integrated terminal** — WebSocket-based terminal for direct access
- **Windows installer** — NSIS installer and portable executable via Electron
- **Dutch financial reports** — BTW-aangifte, loonaangifte, jaarrekening, rendabiliteit

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 7, TailwindCSS 4 |
| Backend | Node.js, Express, WebSocket (ws) |
| Desktop | Electron 35, electron-builder (NSIS + portable) |
| Maps | Leaflet + react-leaflet |
| Terminal | xterm.js |

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### Install dependencies

```bash
npm install
```

### Configure ERPNext instances

Create `~/.erpnext-level/instances.json`:

```json
[
  {
    "id": "my-site",
    "name": "My ERPNext",
    "url": "https://erp.example.com",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  }
]
```

### Development

```bash
# Frontend only (proxies directly to configured instance)
npm run dev

# Backend + frontend (full local stack)
npm run dev:all

# Backend only
npm run dev:server
```

### Build

```bash
# Production build (frontend)
npm run build

# Windows installer (Setup.exe + Portable.exe)
npm run build:exe

# Portable only
npm run build:portable
```

Output goes to `release/`.

### Electron (development)

```bash
npm run electron:dev
```

## Project Structure

```
server/
  index.ts          Express backend with API proxy and caching
  cache.ts          Multi-instance cache manager
  erpnext-client.ts ERPNext API client and instance config loader
  agent.ts          Agent chat handler
  terminal.ts       WebSocket terminal handler
  vault.ts          Encrypted credential storage
src/
  App.tsx           Main React component with routing
  components/       Shared UI components (Sidebar, AgentPanel, etc.)
  pages/            Dashboard pages (25+)
  lib/              API client, data context, intent system
electron/
  main.ts           Electron main process
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `USE_BACKEND` | — | Set to `true` to proxy Vite dev to local backend |
| `ERPNEXT_LEVEL_CONFIG_DIR` | `~/.erpnext-level` | Config directory |
| `ERPNEXT_LEVEL_DIST` | `./dist` | Frontend dist directory |

## License

Copyright OpenAEC Foundation.
