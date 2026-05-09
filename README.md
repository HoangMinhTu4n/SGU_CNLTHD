# WebRTC Video Call Demo

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start server:
   ```bash
   npm start
   ```
3. Open http://localhost:3000 in two devices and join the same room ID.

## Share via ngrok

1. Run server:
   ```bash
   npm start
   ```
2. In another terminal, start ngrok:
   ```bash
   ngrok http 3000
   ```
3. Share the HTTPS forwarding URL with others.

Notes:

- WebRTC needs HTTPS for camera/mic on mobile browsers. Use the ngrok HTTPS URL.
- This demo supports 1-1 calls only.
