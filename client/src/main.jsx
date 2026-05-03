import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const socket = io(SERVER_URL, { autoConnect: true });

function App() {
  const [me, setMe] = useState(null);
  const [gridSize, setGridSize] = useState(20);
  const [tiles, setTiles] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [status, setStatus] = useState("Connecting...");
  const [nameDraft, setNameDraft] = useState("");
  const [selectedTile, setSelectedTile] = useState(null);

  useEffect(() => {
    socket.on("connect", () => setStatus("Connected"));
    socket.on("disconnect", () => setStatus("Disconnected"));

    socket.on("welcome", ({ user, state }) => {
      setMe(user);
      setNameDraft(user.name);
      setGridSize(state.gridSize);
      setTiles(state.tiles);
      setOnlineCount(state.onlineCount);
      setLeaderboard(state.leaderboard);
      setStatus("Connected");
    });

    socket.on("board:state", (state) => {
      setGridSize(state.gridSize);
      setTiles(state.tiles);
      setOnlineCount(state.onlineCount);
      setLeaderboard(state.leaderboard);
    });

    socket.on("tile:claimed", ({ tile, leaderboard }) => {
      setTiles((current) => current.map((item) => (item.id === tile.id ? tile : item)));
      setLeaderboard(leaderboard);
    });

    socket.on("presence:update", ({ onlineCount, leaderboard }) => {
      setOnlineCount(onlineCount);
      setLeaderboard(leaderboard);
    });

    socket.on("user:updated", (user) => {
      setMe(user);
      setNameDraft(user.name);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("welcome");
      socket.off("board:state");
      socket.off("tile:claimed");
      socket.off("presence:update");
      socket.off("user:updated");
    };
  }, []);

  const claimedCount = useMemo(
    () => tiles.filter((tile) => tile.ownerId).length,
    [tiles]
  );

  const myCount = useMemo(
    () => tiles.filter((tile) => tile.ownerId === me?.id).length,
    [tiles, me]
  );

  function claimTile(tile) {
    if (!tile || tile.ownerId) {
      setSelectedTile(tile);
      return;
    }

    setSelectedTile(tile);
    socket.emit("tile:claim", { tileId: tile.id }, (res) => {
      if (!res?.ok) setStatus(res?.reason || "Could not claim tile");
      else setStatus(`Claimed tile #${tile.id}`);
    });
  }

  function updateProfile(event) {
    event.preventDefault();
    socket.emit("user:update", { name: nameDraft, color: me?.color });
  }

  function updateColor(color) {
    socket.emit("user:update", { name: nameDraft, color });
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Realtime multiplayer board</p>
          <h1>TileRush</h1>
        </div>

        <div className="status-pill">
          <span className={socket.connected ? "pulse online" : "pulse offline"} />
          {status}
        </div>
      </section>

      <section className="layout">
        <aside className="panel profile-panel">
          <div className="panel-header">
            <h2>Your player</h2>
            <span className="mini-chip">{onlineCount} online</span>
          </div>

          {me && (
            <form onSubmit={updateProfile} className="profile-form">
              <label>Name</label>
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={24} />

              <label>Color</label>
              <div className="color-row">
                {["#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#ea580c", "#dc2626", "#db2777"].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-dot ${me.color === color ? "active" : ""}`}
                    style={{ background: color }}
                    onClick={() => updateColor(color)}
                    aria-label={`Use color ${color}`}
                  />
                ))}
              </div>

              <button className="primary-button">Save profile</button>
            </form>
          )}

          <div className="stats-grid">
            <Stat label="Your tiles" value={myCount} />
            <Stat label="Claimed" value={`${claimedCount}/${tiles.length || 400}`} />
          </div>

          <button className="ghost-button" onClick={() => socket.emit("board:reset")}>Reset demo board</button>
        </aside>

        <section className="board-card">
          <div className="board-toolbar">
            <div>
              <h2>Shared map</h2>
              <p>Free tiles are light. Claimed tiles use each player’s color.</p>
            </div>
            <div className="progress-wrap">
              <span>{Math.round((claimedCount / (tiles.length || 1)) * 100)}% claimed</span>
              <div className="progress-bar"><div style={{ width: `${(claimedCount / (tiles.length || 1)) * 100}%` }} /></div>
            </div>
          </div>

          <div className="grid-wrap">
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(18px, 1fr))` }}
            >
              {tiles.map((tile) => (
                <button
                  key={tile.id}
                  className={`tile ${tile.ownerId ? "claimed" : "free"} ${tile.ownerId === me?.id ? "mine" : ""}`}
                  style={{ background: tile.ownerColor || undefined }}
                  onClick={() => claimTile(tile)}
                  title={tile.ownerName ? `Owned by ${tile.ownerName}` : "Unclaimed"}
                />
              ))}
            </div>
          </div>
        </section>

        <aside className="panel leaderboard-panel">
          <div className="panel-header">
            <h2>Leaderboard</h2>
            <span className="mini-chip">Top owners</span>
          </div>

          <div className="leaderboard">
            {leaderboard.length === 0 && <p className="empty">No claims yet. Be first.</p>}
            {leaderboard.map((player, index) => (
              <div className="leader-row" key={player.id}>
                <span className="rank">#{index + 1}</span>
                <span className="avatar" style={{ background: player.color }} />
                <div className="leader-name">{player.name}</div>
                <strong>{player.score}</strong>
              </div>
            ))}
          </div>

          <div className="tile-detail">
            <h3>Selected tile</h3>
            {selectedTile ? (
              <p>
                Tile #{selectedTile.id} · {selectedTile.ownerName ? `Owned by ${selectedTile.ownerName}` : "Unclaimed"}
              </p>
            ) : (
              <p>Click any tile to inspect it.</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
