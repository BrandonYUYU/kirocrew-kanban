# Kanban — a KiroCrew app

A simple, **editable** Kanban board for the KiroCrew dashboard. Create, edit,
delete and move cards across **To Do → In Progress → Done**. Everything is
stored **locally** on your machine — no account, no external service, no paid
backend.

![columns: To Do / In Progress / Done](docs/screenshot.png)

## Why

The KiroCrew App Store's Kanban-shaped app (Dynatrace) is a read-only window
into a paid monitoring product. This app is the opposite: a plain, free,
offline task board you own and edit.

## Features

- Create, edit and delete cards (title, description, priority)
- Move cards between columns with ◀ ▶
- Per-card priority (low / medium / high) with a colour dot
- Local JSON storage under the app data directory — nothing leaves your machine
- **No build step**: the UI ships as a plain ESM module, so there is no
  `npm install` / bundler to run

## Data

The board lives in a single JSON file:

```
<KIROCREW_HOME>/apps/kanban/data/board.json
```

Deleting that file resets the board to a fresh starter set.

## Backend API

The UI talks to a small local aiohttp backend (stdlib + aiohttp only). All
routes are reverse-proxied by the gateway and HMAC-signed; the backend
fail-closes on a bad signature when `KIROCREW_PROXY_SECRET` is set.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/board` | Columns with their cards |
| GET | `/api/status` | App + card count |
| POST | `/api/cards` | Create a card |
| PATCH | `/api/cards/{id}` | Edit title / description / priority / column |
| DELETE | `/api/cards/{id}` | Delete a card |
| POST | `/api/cards/move` | Move a card to a column / position |

## Install

```
kirocrew app install /path/to/kirocrew-kanban
kirocrew app enable kanban
kirocrew restart
```

Then open the **Kanban** page in the dashboard.

## Architecture

```
dashboard UI (ui/index.mjs, build-free ESM)
  → gateway reverse-proxy (/apps/kanban/api/… → /api/…, HMAC-signed)
    → backend (backend/server.py, aiohttp)
      → data/board.json  (local storage)
```

- `ui/index.mjs` — the board UI. React, the app SDK, and icons are resolved
  from the host import map (`window.__kirocrew_modules`), so no bundler is
  needed.
- `backend/server.py` — CRUD + move endpoints over a local JSON file.

## License

[Apache License 2.0](LICENSE).
