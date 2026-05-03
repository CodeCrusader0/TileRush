# Real-time Shared Grid App

A small full-stack multiplayer grid app. Anyone who opens the site gets a random user name/color, can claim tiles, and all connected users see updates instantly.

## Tech choices

- **React + Vite** for a fast, clean interactive frontend.
- **Node.js + Express** for the backend API and static serving.
- **Socket.IO** for real-time bidirectional updates, reconnect handling, and broadcasting tile changes.
- **In-memory store** for simplicity in the assignment. The store is centralized on the server, so conflicts are handled server-side. We can replace it with postgres\redis.

## Features

- 400-tile shared board.
- Unclaimed and owned tile states.
- Random guest name and user color.
- Real-time tile updates across all clients.
- Server-side conflict handling: claimed tiles cannot be overwritten.
- Live online user count.
- Leaderboard and user stats.
- Smooth hover/click interactions and visual feedback.
- Reset board button for local/demo use.

## Run locally

npm run install:all
npm run dev


Frontend runs on:

http://localhost:5173


Backend runs on:

http://localhost:4000


# TileRush
