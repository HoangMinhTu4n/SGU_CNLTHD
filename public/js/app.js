const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const toggleMicBtn = document.getElementById("toggleMicBtn");
const toggleCamBtn = document.getElementById("toggleCamBtn");
const roomInput = document.getElementById("roomId");
const statusEl = document.getElementById("status");
const logOutput = document.getElementById("logOutput");
const localVideo = document.getElementById("localVideo");
const remoteGrid = document.getElementById("remoteGrid");

let socket;
let localStream;
let selfId = null;
const peerConnections = new Map();

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function log(message) {
  const time = new Date().toLocaleTimeString();
  logOutput.textContent = `[${time}] ${message}\n` + logOutput.textContent;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function getSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}`;
}

async function startLocalStream() {
  if (localStream) {
    return localStream;
  }
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  localVideo.srcObject = localStream;
  updateToggleButtons();
  return localStream;
}

function createRemoteTile(peerId) {
  const tile = document.createElement("div");
  tile.className = "remote-tile";
  tile.dataset.peerId = peerId;
  tile.dataset.muted = "false";

  const title = document.createElement("h3");
  title.textContent = `Peer ${peerId.slice(0, 8)}`;

  const actions = document.createElement("div");
  actions.className = "remote-actions";

  const muteBtn = document.createElement("button");
  muteBtn.className = "ghost remote-mute";
  muteBtn.type = "button";
  muteBtn.textContent = "Mute";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;

  muteBtn.addEventListener("click", () => {
    const nextMuted = tile.dataset.muted !== "true";
    tile.dataset.muted = nextMuted ? "true" : "false";
    video.muted = nextMuted;
    muteBtn.textContent = nextMuted ? "Unmute" : "Mute";
    muteBtn.classList.toggle("is-off", nextMuted);
  });

  tile.appendChild(title);
  actions.appendChild(muteBtn);
  tile.appendChild(actions);
  tile.appendChild(video);
  remoteGrid.appendChild(tile);
  return video;
}

function getRemoteVideo(peerId) {
  const tile = remoteGrid.querySelector(`[data-peer-id="${peerId}"]`);
  if (tile) {
    return tile.querySelector("video");
  }
  return createRemoteTile(peerId);
}

function removeRemoteTile(peerId) {
  const tile = remoteGrid.querySelector(`[data-peer-id="${peerId}"]`);
  if (tile) {
    tile.remove();
  }
}

function sendSignal(targetId, data) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: "signal",
      targetId,
      data
    })
  );
}

function createPeerConnection(peerId, isInitiator) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnections.set(peerId, peerConnection);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, { candidate: event.candidate });
    }
  };

  peerConnection.ontrack = (event) => {
    const video = getRemoteVideo(peerId);
    if (!video.srcObject) {
      video.srcObject = event.streams[0];
    }
  };

  peerConnection.onconnectionstatechange = () => {
    log(`Peer ${peerId.slice(0, 6)} state: ${peerConnection.connectionState}`);
    if (["failed", "closed"].includes(peerConnection.connectionState)) {
      cleanupPeer(peerId);
    }
  };

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  if (isInitiator) {
    peerConnection
      .createOffer()
      .then((offer) => peerConnection.setLocalDescription(offer))
      .then(() => {
        sendSignal(peerId, { sdp: peerConnection.localDescription });
      })
      .catch(() => {
        log(`Failed to create offer for ${peerId.slice(0, 6)}`);
      });
  }

  return peerConnection;
}

async function handleSignalMessage(fromId, data) {
  const peerConnection = createPeerConnection(fromId, false);

  if (data.sdp) {
    const description = new RTCSessionDescription(data.sdp);
    await peerConnection.setRemoteDescription(description);
    if (description.type === "offer") {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      sendSignal(fromId, { sdp: peerConnection.localDescription });
    }
  }

  if (data.candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      log(`Failed to add ICE candidate for ${fromId.slice(0, 6)}`);
    }
  }
}

function cleanupPeer(peerId) {
  const peerConnection = peerConnections.get(peerId);
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.close();
    peerConnections.delete(peerId);
  }
  removeRemoteTile(peerId);
}

function resetCall() {
  peerConnections.forEach((_, peerId) => cleanupPeer(peerId));
  peerConnections.clear();
  selfId = null;
}

function stopLocalStream() {
  if (!localStream) {
    return;
  }
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  localVideo.srcObject = null;
  updateToggleButtons();
}

function connectSocket(roomId) {
  socket = new WebSocket(getSocketUrl());

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", roomId }));
    setStatus(`Joined room: ${roomId}`);
    log(`Socket connected. Room ${roomId}`);
  });

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "joined") {
      selfId = message.selfId;
      log(`You are ${selfId.slice(0, 8)}`);
      const peers = message.peers || [];
      peers.forEach((peerId) => {
        createPeerConnection(peerId, true);
      });
      if (peers.length === 0) {
        setStatus("Waiting for peers...");
      } else {
        setStatus(`Connected to ${peers.length} peer(s)`);
      }
      return;
    }

    if (message.type === "peer-joined") {
      log(`Peer joined: ${message.peerId.slice(0, 6)}`);
      return;
    }

    if (message.type === "signal") {
      await handleSignalMessage(message.fromId, message.data);
      return;
    }

    if (message.type === "peer-left") {
      log(`Peer left: ${message.peerId.slice(0, 6)}`);
      cleanupPeer(message.peerId);
      return;
    }

    if (message.type === "full") {
      log("Room is full");
      setStatus("Room is full. Try another.");
      return;
    }

    if (message.type === "error") {
      log(message.message);
    }
  });

  socket.addEventListener("close", () => {
    setStatus("Disconnected");
    log("Socket disconnected");
  });
}

function updateToggleButton(button, isOn, labelOn, labelOff) {
  button.textContent = isOn ? labelOn : labelOff;
  button.classList.toggle("is-off", !isOn);
}

function updateToggleButtons() {
  const audioTrack = localStream ? localStream.getAudioTracks()[0] : null;
  const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
  updateToggleButton(toggleMicBtn, audioTrack ? audioTrack.enabled : false, "Mic: On", "Mic: Off");
  updateToggleButton(toggleCamBtn, videoTrack ? videoTrack.enabled : false, "Camera: On", "Camera: Off");
}

joinBtn.addEventListener("click", async () => {
  const roomId = roomInput.value.trim();
  if (!roomId) {
    setStatus("Please enter a room ID");
    return;
  }

  joinBtn.disabled = true;
  leaveBtn.disabled = false;

  try {
    await startLocalStream();
  } catch (error) {
    setStatus("Camera/mic permission denied");
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    return;
  }

  connectSocket(roomId);

  toggleMicBtn.disabled = false;
  toggleCamBtn.disabled = false;
  setStatus("Joining room...");
  log("Joined room");
});

leaveBtn.addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "leave" }));
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  resetCall();
  stopLocalStream();
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  toggleMicBtn.disabled = true;
  toggleCamBtn.disabled = true;
  setStatus("Disconnected");
  log("Left room");
});

toggleMicBtn.addEventListener("click", () => {
  if (!localStream) {
    return;
  }
  const tracks = localStream.getAudioTracks();
  if (!tracks.length) {
    return;
  }
  const nextState = !tracks[0].enabled;
  tracks.forEach((track) => {
    track.enabled = nextState;
  });
  updateToggleButtons();
});

toggleCamBtn.addEventListener("click", () => {
  if (!localStream) {
    return;
  }
  const tracks = localStream.getVideoTracks();
  if (!tracks.length) {
    return;
  }
  const nextState = !tracks[0].enabled;
  tracks.forEach((track) => {
    track.enabled = nextState;
  });
  updateToggleButtons();
});

window.addEventListener("beforeunload", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "leave" }));
  }
});
