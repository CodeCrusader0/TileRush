import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  autoConnect: true,
});

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function App() {
  const boardRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [player, setPlayer] = useState(null);

  const [playerName, setPlayerName] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("violet");

  const [gridSize, setGridSize] = useState(24);
  const [tiles, setTiles] = useState([]);
  const [teams, setTeams] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [teamStats, setTeamStats] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);

  const [selectedTile, setSelectedTile] = useState(null);
  const [toast, setToast] = useState("");
  const [lastCapturedTileId, setLastCapturedTileId] = useState(null);
  const [cursors, setCursors] = useState({});

  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState("");

  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("connection:ready", ({ teams, state }) => {
      setTeams(teams || []);
      hydrateState(state);
    });

    socket.on("player:joined", ({ user, state }) => {
      setPlayer(user);
      setJoined(true);
      hydrateState(state);
    });

    socket.on("board:state", hydrateState);

    socket.on("tile:claimed", ({ tile, leaderboard, teamStats }) => {
      setTiles((current) =>
        current.map((item) => (item.id === tile.id ? tile : item)),
      );

      setLeaderboard(leaderboard || []);
      setTeamStats(teamStats || []);
      setSelectedTile(tile);
      setLastCapturedTileId(tile.id);

      window.setTimeout(() => setLastCapturedTileId(null), 650);
    });

    socket.on("presence:update", ({ onlineCount, leaderboard, teamStats }) => {
      setOnlineCount(onlineCount || 0);
      setLeaderboard(leaderboard || []);
      setTeamStats(teamStats || []);
    });

    socket.on("activity:new", (event) => {
      setActivityFeed((current) => [event, ...current].slice(0, 30));
    });

    socket.on("cursor:update", (cursor) => {
      setCursors((current) => ({
        ...current,
        [cursor.userId]: cursor,
      }));
    });

    socket.on("cursor:remove", ({ userId }) => {
      setCursors((current) => {
        const copy = { ...current };
        delete copy[userId];
        return copy;
      });
    });

    socket.on("chat:new", (message) => {
      setChatMessages((current) => [...current, message].slice(-40));
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connection:ready");
      socket.off("player:joined");
      socket.off("board:state");
      socket.off("tile:claimed");
      socket.off("presence:update");
      socket.off("activity:new");
      socket.off("cursor:update");
      socket.off("cursor:remove");
      socket.off("chat:new");
    };
  }, []);

  function hydrateState(state) {
    if (!state) return;

    setGridSize(state.gridSize || 24);
    setTiles(state.tiles || []);
    setTeams(state.teams || []);
    setOnlineCount(state.onlineCount || 0);
    setLeaderboard(state.leaderboard || []);
    setTeamStats(state.teamStats || []);
    setActivityFeed(state.activityFeed || []);
    setChatMessages(state.chatMessages || []);
  }

  function joinArena(event) {
    event.preventDefault();

    socket.emit(
      "player:join",
      {
        name: playerName,
        teamId: selectedTeam,
      },
      (response) => {
        if (!response?.ok) {
          showToast(response?.reason || "Could not join arena.");
          return;
        }

        setPlayer(response.user);
      },
    );
  }

  function claimTile(tile) {
    if (!tile) return;

    setSelectedTile(tile);

    socket.emit("tile:claim", { tileId: tile.id }, (response) => {
      if (!response?.ok) {
        showToast(response?.reason || "Could not claim tile.");
      }
    });
  }

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function handleBoardMouseMove(event) {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || !player) return;

    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    socket.emit("cursor:move", {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
  }

  function sendChatMessage(event) {
    event.preventDefault();

    const message = chatDraft.trim();

    if (!message) return;

    socket.emit("chat:send", { message }, (response) => {
      if (!response?.ok) {
        showToast(response?.reason || "Could not send message.");
        return;
      }

      setChatDraft("");
    });
  }

  const claimedCount = useMemo(
    () => tiles.filter((tile) => tile.ownerId).length,
    [tiles],
  );

  const myTiles = useMemo(
    () => tiles.filter((tile) => tile.ownerId === player?.id).length,
    [tiles, player],
  );

  const claimPercent = Math.round((claimedCount / (tiles.length || 1)) * 100);

  if (!joined) {
    return (
      <main className="join-page">
        <section className="join-card">
          <div className="brand-orb" />

          <p className="eyebrow">Realtime Multiplayer Territory Arena</p>
          <h1>TileRush Arena</h1>
          <p className="subtitle">
            Capture tiles, expand territory, attack nearby rivals, and climb the
            live leaderboard. Every move is synced instantly.
          </p>

          <form className="join-form" onSubmit={joinArena}>
            <label>
              Player name
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Enter your name"
                maxLength={24}
              />
            </label>

            <div>
              <span className="label-text">Choose your faction</span>
              <div className="team-picker">
                {teams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    className={`team-option ${
                      selectedTeam === team.id ? "active" : ""
                    }`}
                    onClick={() => setSelectedTeam(team.id)}
                  >
                    <span
                      className="team-dot"
                      style={{ background: team.color }}
                    />
                    <span>{team.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {toast && <p className="error-text">{toast}</p>}

            <button className="primary-button" type="submit">
              Join Arena
            </button>
          </form>

          <div className="connection-pill">
            <span className={connected ? "online-dot" : "offline-dot"} />
            {connected ? "Connected to server" : "Connecting..."}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="arena-page">
      {toast && <div className="toast">{toast}</div>}

      <header className="topbar">
        <div>
          <p className="eyebrow">TileRush Arena</p>
          <h1>Live Territory Control</h1>
          <p className="topbar-copy">
            Cooldowns, tile locks, adjacent expansion, team scoring, and
            real-time multiplayer updates.
          </p>
        </div>

        <div className="topbar-stats">
          <StatCard label="Online" value={onlineCount} />
          <StatCard label="Your tiles" value={myTiles} />
          <StatCard label="Map claimed" value={`${claimPercent}%`} />
        </div>
      </header>

      <section className="arena-layout">
        <aside className="panel">
          <div className="panel-header">
            <h2>Your Player</h2>
            <span className="mini-chip">Live</span>
          </div>

          <div className="player-card">
            <span className="avatar" style={{ background: player?.teamColor }}>
              {player?.name?.[0]?.toUpperCase()}
            </span>
            <div>
              <strong>{player?.name}</strong>
              <p>{player?.teamName}</p>
            </div>
          </div>

          <div className="rules-box">
            <h3>Rules</h3>
            <p>First tile can be anywhere.</p>
            <p>After that, expand only from your existing territory.</p>
            <p>Captured tiles are briefly locked from attacks.</p>
          </div>

          <div className="panel-header">
            <h2>Team Control</h2>
          </div>

          <div className="team-stats">
            {teamStats.map((team) => (
              <div key={team.id} className="team-stat">
                <div>
                  <span
                    className="team-dot"
                    style={{ background: team.color }}
                  />
                  <span>{team.name}</span>
                </div>
                <strong>{team.score}</strong>
              </div>
            ))}
          </div>
        </aside>

        <section className="board-card">
          <div className="board-toolbar">
            <div>
              <h2>Battle Map</h2>
              <p>
                Click a tile to capture it. Owned tiles can be attacked only
                from adjacent territory.
              </p>
            </div>

            <div className="progress-wrap">
              <span>
                {claimedCount}/{tiles.length} tiles claimed
              </span>
              <div className="progress-bar">
                <div style={{ width: `${claimPercent}%` }} />
              </div>
            </div>
          </div>

          <div
            ref={boardRef}
            className="grid-wrap"
            onMouseMove={handleBoardMouseMove}
          >
            {Object.values(cursors).map((cursor) => (
              <div
                key={cursor.userId}
                className="remote-cursor"
                style={{
                  left: `${cursor.x}%`,
                  top: `${cursor.y}%`,
                  color: cursor.teamColor,
                }}
              >
                <span />
                <b>{cursor.name}</b>
              </div>
            ))}

            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${gridSize}, minmax(15px, 1fr))`,
              }}
            >
              {tiles.map((tile) => (
                <button
                  key={`${tile.id}-${tile.version}`}
                  className={[
                    "tile",
                    tile.ownerId ? "claimed" : "free",
                    tile.ownerId === player?.id ? "mine" : "",
                    lastCapturedTileId === tile.id ? "captured" : "",
                  ].join(" ")}
                  style={{ background: tile.teamColor || undefined }}
                  onMouseEnter={() => setSelectedTile(tile)}
                  onClick={() => claimTile(tile)}
                  title={
                    tile.ownerName
                      ? `#${tile.id} owned by ${tile.ownerName}`
                      : `#${tile.id} unclaimed`
                  }
                />
              ))}
            </div>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h2>Leaderboard</h2>
            <span className="mini-chip">Top 10</span>
          </div>

          <div className="leaderboard">
            {leaderboard.length === 0 && (
              <p className="empty">No captures yet. Be first.</p>
            )}

            {leaderboard.map((item, index) => (
              <div className="leader-row" key={item.id}>
                <span className="rank">#{index + 1}</span>
                <span
                  className="leader-avatar"
                  style={{ background: item.teamColor }}
                />
                <div className="leader-name">
                  <strong>{item.name}</strong>
                  <small>{item.teamName}</small>
                </div>
                <b>{item.score}</b>
              </div>
            ))}
          </div>

          <div className="tile-detail">
            <h3>Tile Inspector</h3>
            {selectedTile ? (
              <>
                <p>
                  <strong>Tile #{selectedTile.id}</strong>
                </p>
                <p>
                  Owner:{" "}
                  {selectedTile.ownerName
                    ? selectedTile.ownerName
                    : "Unclaimed"}
                </p>
                <p>
                  Team: {selectedTile.teamName ? selectedTile.teamName : "None"}
                </p>
                <p>
                  Claimed:{" "}
                  {selectedTile.claimedAt
                    ? formatClock(selectedTile.claimedAt)
                    : "Not yet"}
                </p>
              </>
            ) : (
              <p>Hover or click a tile to inspect it.</p>
            )}
          </div>

          <div className="chat-box">
            <h3>Arena Chat</h3>

            <div className="chat-messages">
              {chatMessages.length === 0 && (
                <p className="empty">
                  No messages yet. Start the conversation.
                </p>
              )}

              {chatMessages.map((message) => (
                <div key={message.id} className="chat-message">
                  <div className="chat-meta">
                    <span
                      className="chat-dot"
                      style={{ background: message.teamColor }}
                    />
                    <strong>{message.playerName}</strong>
                  </div>
                  <p>{message.message}</p>
                </div>
              ))}
            </div>

            <form className="chat-form" onSubmit={sendChatMessage}>
              <input
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                placeholder="Type message..."
                maxLength={240}
              />
              <button type="submit">Send</button>
            </form>
          </div>

          <div className="activity-box">
            <h3>Live Feed</h3>
            <div className="activity-feed">
              {activityFeed.length === 0 && (
                <p className="empty">No activity yet.</p>
              )}

              {activityFeed.map((event) => (
                <p key={event.id}>{event.message}</p>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
