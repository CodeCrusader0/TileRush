import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import mongoose from "mongoose";
import { Server } from "socket.io";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const MONGO_URI = process.env.MONGO_URI || "";

const GRID_SIZE = 24;
const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
const CLAIM_COOLDOWN_MS = 1200;
const TILE_LOCK_MS = 8000;
const MAX_FEED_EVENTS = 30;
const MAX_CHAT_MESSAGES = 40;

const app = express();

function getAllowedOrigin() {
  if (CLIENT_ORIGIN === "*") return true;
  return CLIENT_ORIGIN.split(",").map((origin) => origin.trim());
}

app.use(
  cors({
    origin: getAllowedOrigin(),
  })
);

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: getAllowedOrigin(),
    methods: ["GET", "POST"],
  },
});

const TEAMS = {
  violet: {
    id: "violet",
    name: "Violet Vanguard",
    color: "#7c3aed",
  },
  cyan: {
    id: "cyan",
    name: "Cyan Syndicate",
    color: "#0891b2",
  },
  emerald: {
    id: "emerald",
    name: "Emerald Empire",
    color: "#16a34a",
  },
  amber: {
    id: "amber",
    name: "Amber Alliance",
    color: "#f59e0b",
  },
};

const tileSchema = new mongoose.Schema(
  {
    tileId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    x: Number,
    y: Number,
    ownerId: String,
    ownerName: String,
    teamId: String,
    teamName: String,
    teamColor: String,
    claimedAt: Date,
    lockedUntil: Date,
    version: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const captureEventSchema = new mongoose.Schema(
  {
    tileId: Number,
    playerId: String,
    playerName: String,
    teamId: String,
    teamName: String,
    previousOwnerId: String,
    previousOwnerName: String,
    previousTeamId: String,
    previousTeamName: String,
    type: {
      type: String,
      enum: ["claim", "capture"],
      default: "claim",
    },
  },
  {
    timestamps: true,
  }
);

const chatMessageSchema = new mongoose.Schema(
  {
    playerId: String,
    playerName: String,
    teamId: String,
    teamName: String,
    teamColor: String,
    message: {
      type: String,
      required: true,
      maxlength: 240,
    },
  },
  {
    timestamps: true,
  }
);

const ChatMessage =
  mongoose.models.ChatMessage ||
  mongoose.model("ChatMessage", chatMessageSchema);

const Tile = mongoose.models.Tile || mongoose.model("Tile", tileSchema);
const CaptureEvent =
  mongoose.models.CaptureEvent ||
  mongoose.model("CaptureEvent", captureEventSchema);

let databaseConnected = false;
let tiles = [];
const users = new Map();
const lastClaimByUser = new Map();
const activityFeed = [];
const chatMessages = [];

function createEmptyTiles() {
  return Array.from({ length: TOTAL_TILES }, (_, id) => ({
    id,
    x: id % GRID_SIZE,
    y: Math.floor(id / GRID_SIZE),
    ownerId: null,
    ownerName: null,
    teamId: null,
    teamName: null,
    teamColor: null,
    claimedAt: null,
    lockedUntil: null,
    version: 0,
  }));
}

function mapDbTile(tile) {
  return {
    id: tile.tileId,
    x: tile.x,
    y: tile.y,
    ownerId: tile.ownerId || null,
    ownerName: tile.ownerName || null,
    teamId: tile.teamId || null,
    teamName: tile.teamName || null,
    teamColor: tile.teamColor || null,
    claimedAt: tile.claimedAt || null,
    lockedUntil: tile.lockedUntil || null,
    version: tile.version || 0,
  };
}

async function connectDatabase() {
  if (!MONGO_URI) {
    console.warn("No MONGO_URI provided. Running with in-memory board only.");
    databaseConnected = false;
    return;
  }

  await mongoose.connect(MONGO_URI);
  databaseConnected = true;
  console.log("MongoDB connected. Board state will persist.");
}

async function loadOrCreateBoard() {
  if (!databaseConnected) {
    tiles = createEmptyTiles();
    return;
  }

  const existingTiles = await Tile.find().sort({ tileId: 1 });

  if (existingTiles.length === TOTAL_TILES) {
    tiles = existingTiles.map(mapDbTile);
    console.log("Loaded persistent board from MongoDB.");
    return;
  }

  await Tile.deleteMany({});

  const freshTiles = createEmptyTiles().map((tile) => ({
    tileId: tile.id,
    x: tile.x,
    y: tile.y,
    ownerId: null,
    ownerName: null,
    teamId: null,
    teamName: null,
    teamColor: null,
    claimedAt: null,
    lockedUntil: null,
    version: 0,
  }));

  await Tile.insertMany(freshTiles);
  tiles = freshTiles.map(mapDbTile);

  console.log("Created new persistent board in MongoDB.");
}

async function loadRecentActivity() {
  if (!databaseConnected) return;

  const events = await CaptureEvent.find()
    .sort({ createdAt: -1 })
    .limit(MAX_FEED_EVENTS);

  activityFeed.length = 0;

  for (const event of events) {
    activityFeed.push({
      id: String(event._id),
      type: event.type,
      createdAt: event.createdAt,
      message:
        event.type === "capture"
          ? `${event.playerName} captured tile #${event.tileId} from ${event.previousOwnerName}`
          : `${event.playerName} claimed tile #${event.tileId}`,
    });
  }
}

async function loadRecentChatMessages() {
  if (!databaseConnected) return;

  const messages = await ChatMessage.find()
    .sort({ createdAt: -1 })
    .limit(MAX_CHAT_MESSAGES);

  chatMessages.length = 0;

  for (const message of messages.reverse()) {
    chatMessages.push({
      id: String(message._id),
      playerId: message.playerId,
      playerName: message.playerName,
      teamId: message.teamId,
      teamName: message.teamName,
      teamColor: message.teamColor,
      message: message.message,
      createdAt: message.createdAt,
    });
  }
}

function sanitizeName(name) {
  return String(name || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 24);
}

function getSafeTeam(teamId) {
  return TEAMS[teamId] || TEAMS.violet;
}

function getTile(tileId) {
  const numericId = Number(tileId);

  if (!Number.isInteger(numericId)) {
    return null;
  }

  return tiles[numericId] || null;
}

function getPlayerScore(playerId) {
  return tiles.filter((tile) => tile.ownerId === playerId).length;
}

function getTeamStats() {
  const stats = Object.values(TEAMS).map((team) => ({
    ...team,
    score: 0,
  }));

  for (const tile of tiles) {
    if (!tile.teamId) continue;

    const team = stats.find((item) => item.id === tile.teamId);

    if (team) {
      team.score += 1;
    }
  }

  return stats.sort((a, b) => b.score - a.score);
}

function getLeaderboard() {
  const scores = new Map();

  for (const user of users.values()) {
    scores.set(user.id, {
      id: user.id,
      name: user.name,
      teamId: user.teamId,
      teamName: user.teamName,
      teamColor: user.teamColor,
      score: 0,
    });
  }

  for (const tile of tiles) {
    if (!tile.ownerId) continue;

    const existing = scores.get(tile.ownerId) || {
      id: tile.ownerId,
      name: tile.ownerName,
      teamId: tile.teamId,
      teamName: tile.teamName,
      teamColor: tile.teamColor,
      score: 0,
    };

    existing.score += 1;
    scores.set(tile.ownerId, existing);
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function addActivity(message, type = "info") {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    type,
    createdAt: new Date().toISOString(),
  };

  activityFeed.unshift(event);

  if (activityFeed.length > MAX_FEED_EVENTS) {
    activityFeed.pop();
  }

  io.emit("activity:new", event);
}

function getNeighbourIds(tile) {
  const positions = [
    { x: tile.x, y: tile.y - 1 },
    { x: tile.x + 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x - 1, y: tile.y },
  ];

  return positions
    .filter(
      (position) =>
        position.x >= 0 &&
        position.x < GRID_SIZE &&
        position.y >= 0 &&
        position.y < GRID_SIZE
    )
    .map((position) => position.y * GRID_SIZE + position.x);
}

function playerHasAdjacentTile(playerId, tile) {
  return getNeighbourIds(tile).some(
    (neighbourId) => tiles[neighbourId]?.ownerId === playerId
  );
}

function publicState() {
  return {
    gridSize: GRID_SIZE,
    tiles,
    teams: Object.values(TEAMS),
    onlineCount: users.size,
    leaderboard: getLeaderboard(),
    teamStats: getTeamStats(),
    activityFeed,
    chatMessages,
    persistence: {
      enabled: databaseConnected,
    },
  };
}

async function persistTile(tile) {
  if (!databaseConnected) return;

  await Tile.updateOne(
    { tileId: tile.id },
    {
      $set: {
        ownerId: tile.ownerId,
        ownerName: tile.ownerName,
        teamId: tile.teamId,
        teamName: tile.teamName,
        teamColor: tile.teamColor,
        claimedAt: tile.claimedAt,
        lockedUntil: tile.lockedUntil,
        version: tile.version,
      },
    }
  );
}

async function persistCaptureEvent(event) {
  if (!databaseConnected) return;

  await CaptureEvent.create(event);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    online: users.size,
    totalTiles: TOTAL_TILES,
    gridSize: GRID_SIZE,
    persistence: databaseConnected,
  });
});

app.get("/api/state", (_req, res) => {
  res.json(publicState());
});

io.on("connection", (socket) => {
  socket.emit("connection:ready", {
    socketId: socket.id,
    teams: Object.values(TEAMS),
    state: publicState(),
  });

  socket.on("player:join", (payload = {}, ack) => {
    const name = sanitizeName(payload.name);

    if (!name) {
      ack?.({
        ok: false,
        reason: "Enter a player name.",
      });
      return;
    }

    const team = getSafeTeam(payload.teamId);

    const user = {
      id: socket.id,
      name,
      teamId: team.id,
      teamName: team.name,
      teamColor: team.color,
      joinedAt: new Date().toISOString(),
    };

    users.set(socket.id, user);

    addActivity(`${user.name} joined ${team.name}`, "join");

    socket.emit("player:joined", {
      user,
      state: publicState(),
    });

    io.emit("presence:update", {
      onlineCount: users.size,
      leaderboard: getLeaderboard(),
      teamStats: getTeamStats(),
    });

    ack?.({
      ok: true,
      user,
    });
  });

  socket.on("cursor:move", (payload = {}) => {
    const user = users.get(socket.id);
    if (!user) return;

    socket.broadcast.emit("cursor:update", {
      userId: user.id,
      name: user.name,
      teamColor: user.teamColor,
      x: Number(payload.x) || 0,
      y: Number(payload.y) || 0,
    });
  });

  socket.on("chat:send", async (payload = {}, ack) => {
    try {
      const user = users.get(socket.id);

      if (!user) {
        ack?.({
          ok: false,
          reason: "Join the arena before chatting.",
        });
        return;
      }

      const messageText = String(payload.message || "")
        .trim()
        .replace(/[<>]/g, "")
        .slice(0, 240);

      if (!messageText) {
        ack?.({
          ok: false,
          reason: "Message cannot be empty.",
        });
        return;
      }

      const chatMessage = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        playerId: user.id,
        playerName: user.name,
        teamId: user.teamId,
        teamName: user.teamName,
        teamColor: user.teamColor,
        message: messageText,
        createdAt: new Date().toISOString(),
      };

      chatMessages.push(chatMessage);

      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages.shift();
      }

      if (databaseConnected) {
        const savedMessage = await ChatMessage.create({
          playerId: user.id,
          playerName: user.name,
          teamId: user.teamId,
          teamName: user.teamName,
          teamColor: user.teamColor,
          message: messageText,
        });

        chatMessage.id = String(savedMessage._id);
        chatMessage.createdAt = savedMessage.createdAt;
      }

      io.emit("chat:new", chatMessage);

      ack?.({
        ok: true,
        message: chatMessage,
      });
    } catch (error) {
      console.error("Chat send failed:", error);

      ack?.({
        ok: false,
        reason: "Server error while sending message.",
      });
    }
  });

  socket.on("tile:claim", async ({ tileId } = {}, ack) => {
    try {
      const user = users.get(socket.id);
      const tile = getTile(tileId);

      if (!user) {
        ack?.({
          ok: false,
          reason: "Join the arena first.",
        });
        return;
      }

      if (!tile) {
        ack?.({
          ok: false,
          reason: "Invalid tile.",
        });
        return;
      }

      const now = Date.now();
      const lastClaimAt = lastClaimByUser.get(socket.id) || 0;

      if (now - lastClaimAt < CLAIM_COOLDOWN_MS) {
        const waitMs = CLAIM_COOLDOWN_MS - (now - lastClaimAt);

        ack?.({
          ok: false,
          reason: `Cooldown active. Wait ${Math.ceil(waitMs / 1000)}s.`,
        });

        return;
      }

      const alreadyOwnedByPlayer = tile.ownerId === user.id;
      const isLocked = tile.lockedUntil && now < new Date(tile.lockedUntil).getTime();
      const playerScore = getPlayerScore(user.id);

      if (alreadyOwnedByPlayer) {
        ack?.({
          ok: false,
          reason: "You already own this tile.",
        });
        return;
      }

      if (isLocked) {
        ack?.({
          ok: false,
          reason: "This tile is temporarily locked.",
        });
        return;
      }

      if (playerScore > 0 && !playerHasAdjacentTile(user.id, tile)) {
        ack?.({
          ok: false,
          reason: "Expand or attack from your existing territory.",
        });
        return;
      }

      const previousOwnerId = tile.ownerId;
      const previousOwnerName = tile.ownerName;
      const previousTeamId = tile.teamId;
      const previousTeamName = tile.teamName;

      lastClaimByUser.set(socket.id, now);

      tile.ownerId = user.id;
      tile.ownerName = user.name;
      tile.teamId = user.teamId;
      tile.teamName = user.teamName;
      tile.teamColor = user.teamColor;
      tile.claimedAt = new Date(now).toISOString();
      tile.lockedUntil = new Date(now + TILE_LOCK_MS).toISOString();
      tile.version += 1;

      await persistTile(tile);

      await persistCaptureEvent({
        tileId: tile.id,
        playerId: user.id,
        playerName: user.name,
        teamId: user.teamId,
        teamName: user.teamName,
        previousOwnerId,
        previousOwnerName,
        previousTeamId,
        previousTeamName,
        type: previousOwnerId ? "capture" : "claim",
      });

      const leaderboard = getLeaderboard();
      const teamStats = getTeamStats();

      io.emit("tile:claimed", {
        tile,
        leaderboard,
        teamStats,
      });

      if (previousOwnerName) {
        addActivity(
          `${user.name} captured tile #${tile.id} from ${previousOwnerName}`,
          "capture"
        );
      } else {
        addActivity(`${user.name} claimed tile #${tile.id}`, "claim");
      }

      ack?.({
        ok: true,
        tile,
      });
    } catch (error) {
      console.error("Tile claim failed:", error);

      ack?.({
        ok: false,
        reason: "Server error while claiming tile.",
      });
    }
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);

    if (user) {
      addActivity(`${user.name} left the arena`, "leave");
    }

    users.delete(socket.id);
    lastClaimByUser.delete(socket.id);

    io.emit("presence:update", {
      onlineCount: users.size,
      leaderboard: getLeaderboard(),
      teamStats: getTeamStats(),
    });

    io.emit("cursor:remove", {
      userId: socket.id,
    });
  });
});

async function startServer() {
  await connectDatabase();
  await loadOrCreateBoard();
  await loadRecentActivity();
  await loadRecentChatMessages();

  server.listen(PORT, () => {
    console.log(`TileRush Arena server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});