import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const GRID_SIZE = 20;
const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
const CLAIM_COOLDOWN_MS = 450;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

const tiles = Array.from({ length: TOTAL_TILES }, (_, id) => ({
  id,
  ownerId: null,
  ownerName: null,
  ownerColor: null,
  claimedAt: null
}));

const users = new Map();
const lastClaimByUser = new Map();

const names = [
  "Pixel Panda", "Grid Ghost", "Tile Tiger", "Block Boss", "Map Mage",
  "Cell Surfer", "Color Coder", "Board Ninja", "Claim King", "Dot Wizard"
];

const colors = [
  "#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#ca8a04",
  "#ea580c", "#dc2626", "#db2777", "#4f46e5", "#0f766e"
];

function makeGuest(socketId) {
  const name = `${names[Math.floor(Math.random() * names.length)]} ${socketId.slice(0, 4)}`;
  const color = colors[Math.floor(Math.random() * colors.length)];
  return { id: socketId, name, color, score: 0 };
}

function getLeaderboard() {
  const scores = new Map();

  for (const user of users.values()) {
    scores.set(user.id, { ...user, score: 0 });
  }

  for (const tile of tiles) {
    if (!tile.ownerId) continue;
    const current = scores.get(tile.ownerId) || {
      id: tile.ownerId,
      name: tile.ownerName,
      color: tile.ownerColor,
      score: 0
    };
    current.score += 1;
    scores.set(tile.ownerId, current);
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function publicState() {
  return {
    gridSize: GRID_SIZE,
    tiles,
    onlineCount: users.size,
    leaderboard: getLeaderboard()
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, online: users.size, totalTiles: TOTAL_TILES });
});

app.get("/api/state", (_req, res) => {
  res.json(publicState());
});

io.on("connection", (socket) => {
  const user = makeGuest(socket.id);
  users.set(socket.id, user);

  socket.emit("welcome", { user, state: publicState() });
  io.emit("presence:update", {
    onlineCount: users.size,
    leaderboard: getLeaderboard()
  });

  socket.on("user:update", (payload = {}) => {
    const existing = users.get(socket.id);
    if (!existing) return;

    const safeName = String(payload.name || existing.name).trim().slice(0, 24);
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(payload.color) ? payload.color : existing.color;

    const updated = { ...existing, name: safeName || existing.name, color: safeColor };
    users.set(socket.id, updated);

    socket.emit("user:updated", updated);
    io.emit("presence:update", {
      onlineCount: users.size,
      leaderboard: getLeaderboard()
    });
  });

  socket.on("tile:claim", ({ tileId } = {}, ack) => {
    const user = users.get(socket.id);
    const tile = tiles[Number(tileId)];

    if (!user || !tile) {
      ack?.({ ok: false, reason: "Invalid tile." });
      return;
    }

    const now = Date.now();
    const lastClaimAt = lastClaimByUser.get(socket.id) || 0;
    if (now - lastClaimAt < CLAIM_COOLDOWN_MS) {
      ack?.({ ok: false, reason: "Slow down a little." });
      return;
    }

    if (tile.ownerId) {
      ack?.({ ok: false, reason: "This tile is already claimed." });
      return;
    }

    lastClaimByUser.set(socket.id, now);

    tile.ownerId = user.id;
    tile.ownerName = user.name;
    tile.ownerColor = user.color;
    tile.claimedAt = new Date(now).toISOString();

    const leaderboard = getLeaderboard();

    io.emit("tile:claimed", { tile, leaderboard });
    ack?.({ ok: true, tile });
  });

  socket.on("board:reset", () => {
    for (const tile of tiles) {
      tile.ownerId = null;
      tile.ownerName = null;
      tile.ownerColor = null;
      tile.claimedAt = null;
    }

    io.emit("board:state", publicState());
  });

  socket.on("disconnect", () => {
    users.delete(socket.id);
    lastClaimByUser.delete(socket.id);
    io.emit("presence:update", {
      onlineCount: users.size,
      leaderboard: getLeaderboard()
    });
  });
});

server.listen(PORT, () => {
  console.log(`Realtime grid server running on http://localhost:${PORT}`);
});
