const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECRET_KEY = "Prakash360";

// Yahan apni wahi copied API Key daalein (Spaces ka dhyan rakhein)
const DEEPGRAM_API_KEY = "afc00946e5652af1e454c83466c42efa5bdcfe2d"; 

const deepgram = createClient(DEEPGRAM_API_KEY);

let deepgramLive = null;
let esp32Socket = null;

function startDeepgramStream() {
  if (deepgramLive) return;

  deepgramLive = deepgram.listen.live({
    model: "nova-2",
    language: "hi-Latn", 
    smart_format: true,
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1
  });

  deepgramLive.on(LiveTranscriptionEvents.Open, () => {
    console.log("🟢 Deepgram Realtime Engine Ready!");
  });

  deepgramLive.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript && transcript.trim() !== "") {
      console.log("Spoken Text:", transcript);
      
      if (esp32Socket && esp32Socket.readyState === WebSocket.OPEN) {
        esp32Socket.send(JSON.stringify({
          type: "stt_text",
          text: transcript,
          is_final: data.is_final
        }));
      }
    }
  });

  deepgramLive.on(LiveTranscriptionEvents.Close, () => {
    console.log("🔴 Deepgram Connection Closed.");
    deepgramLive = null;
  });

  deepgramLive.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("⚠️ Deepgram Error:", err);
  });
}

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.replace('/?', ''));
  const key = urlParams.get('key');
  const role = urlParams.get('role');

  if (key !== SECRET_KEY) {
    ws.send("AUTH_FAILED");
    ws.close();
    return;
  }

  if (role === 'esp32_stt') {
    console.log("🟢 ESP32 STT Device Connected!");
    esp32Socket = ws;

    // ESP32 connect hote hi Deepgram session start hoga
    startDeepgramStream();

    ws.on('message', (data, isBinary) => {
      if (isBinary && deepgramLive && deepgramLive.getReadyState() === 1) {
        deepgramLive.send(data);
      }
    });

    ws.on('close', () => {
      console.log("🔴 ESP32 Disconnected!");
      if (esp32Socket === ws) esp32Socket = null;
      if (deepgramLive) {
        deepgramLive.finish();
        deepgramLive = null;
      }
    });
  }
});

app.get('/', (req, res) => {
  res.send("<h2>ESP32 Speech-To-Text Relay Server Running 🚀</h2>");
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
