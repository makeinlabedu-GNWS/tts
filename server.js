const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECRET_KEY = "Prakash360";
const DEEPGRAM_API_KEY = "YOUR_DEEPGRAM_API_KEY_HERE"; 

const deepgram = createClient(DEEPGRAM_API_KEY);
let deepgramLive = null;
let esp32Socket = null;

function setupDeepgram() {
  deepgramLive = deepgram.listen.live({
    model: "nova-2",
    language: "hi-Latn", // Hindi + English mix detection
    smart_format: true,
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1
  });

  deepgramLive.on(LiveTranscriptionEvents.Open, () => {
    console.log("Deepgram Engine Ready!");
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

  deepgramLive.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("Deepgram Error:", err);
  });
}

setupDeepgram();

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
    console.log("New ESP32 STT Device Connected!");
    esp32Socket = ws;

    ws.on('message', (data, isBinary) => {
      if (isBinary && deepgramLive && deepgramLive.getReadyState() === 1) {
        deepgramLive.send(data);
      }
    });

    ws.on('close', () => {
      if (esp32Socket === ws) esp32Socket = null;
    });
  }
});

app.get('/', (req, res) => {
  res.send("<h2>ESP32 Speech-To-Text Separate Relay Server Active 🚀</h2>");
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('STT Server running on port ' + PORT));
