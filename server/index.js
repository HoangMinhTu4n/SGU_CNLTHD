const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAX_ROOM_SIZE = 5;
const rooms = new Map();
const clients = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  return rooms.get(roomId);
}

function safeSend(client, payload) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

function broadcast(roomId, payload, exceptClient) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  room.forEach((client) => {
    if (client !== exceptClient) {
      safeSend(client, payload);
    }
  });
}

function findClientInRoom(roomId, clientId) {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }
  for (const client of room) {
    if (client.id === clientId) {
      return client;
    }
  }
  return null;
}

wss.on("connection", (ws) => {
  ws.id = randomUUID();
  ws.roomId = null;
  clients.set(ws.id, ws);

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      safeSend(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (message.type === "join") {
      const roomId = (message.roomId || "").trim();
      if (!roomId) {
        safeSend(ws, { type: "error", message: "Room ID is required" });
        return;
      }

      const room = getRoom(roomId);
      if (room.size >= MAX_ROOM_SIZE) {
        safeSend(ws, { type: "full" });
        return;
      }

      ws.roomId = roomId;
      room.add(ws);
      const peers = Array.from(room)
        .filter((client) => client !== ws)
        .map((client) => client.id);
      safeSend(ws, { type: "joined", roomId, selfId: ws.id, peers });
      broadcast(roomId, { type: "peer-joined", peerId: ws.id }, ws);
      return;
    }

    if (!ws.roomId) {
      safeSend(ws, { type: "error", message: "Join a room first" });
      return;
    }

    if (message.type === "signal") {
      const targetId = message.targetId;
      if (!targetId) {
        safeSend(ws, { type: "error", message: "targetId is required" });
        return;
      }
      const targetClient = findClientInRoom(ws.roomId, targetId);
      if (!targetClient) {
        return;
      }
      safeSend(targetClient, {
        type: "signal",
        fromId: ws.id,
        data: message.data
      });
      return;
    }

    if (message.type === "leave") {
      const room = rooms.get(ws.roomId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          rooms.delete(ws.roomId);
        }
      }
      broadcast(ws.roomId, { type: "peer-left", peerId: ws.id }, ws);
      ws.roomId = null;
      return;
    }
  });

  ws.on("close", () => {
    clients.delete(ws.id);
    if (!ws.roomId) {
      return;
    }
    const room = rooms.get(ws.roomId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        rooms.delete(ws.roomId);
      }
    }
    broadcast(ws.roomId, { type: "peer-left", peerId: ws.id }, ws);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`WebRTC demo server running on http://localhost:${PORT}`);
});
