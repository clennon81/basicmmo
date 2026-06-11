# ⚔ BasicMMO

A full-stack real-time MMO prototype built with Node.js, Socket.io, and SQLite.

## Features
- 🗺 **Shared procedural world** — 40×30 tile map with grass, water, trees, sand, mountains
- 🧍 **Real-time movement** — see all players move live via WebSockets
- 💬 **Live chat** — talk to other players in-world
- 💾 **Persistent players** — SQLite saves your position between sessions
- 🎨 **Random player colours** — each player gets a distinct colour

## Setup

```bash
npm install
npm start
```

Then open: http://localhost:3000

## Architecture

```
mmo/
├── server/
│   └── index.js        # Express + Socket.io server + SQLite DB
├── client/
│   └── index.html      # Canvas renderer + Socket.io client
├── package.json
└── README.md
```

### Stack
| Layer | Tech |
|-------|------|
| Server | Node.js + Express |
| Real-time | Socket.io (WebSockets) |
| Database | sql.js (SQLite in-memory, persisted to file) |
| Frontend | Vanilla JS + HTML5 Canvas |

### Socket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `join` | client → server | `{ playerId }` |
| `init` | server → client | map data + all players |
| `move` | client → server | `{ dx, dy }` |
| `playerMoved` | server → all | `{ id, x, y }` |
| `playerJoined` | server → all | player object |
| `playerLeft` | server → all | `{ id }` |
| `chat` | client → server | `{ message }` |
| `chat` | server → all | `{ name, color, message }` |

## Extending This

Some ideas for what to add next:
- **Combat system** — HP, attack, respawn
- **Inventory & items** — pick up items on the map
- **Quests / NPCs** — server-side NPC logic
- **Authentication** — add a password field to `/api/login`
- **Zones/instances** — multiple rooms with portals
- **PostgreSQL migration** — swap sql.js for `pg` for production scale
