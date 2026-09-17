const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECRET_KEY = "Prakash360";
// Dynamic Environment Variable (Safe Way)
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const groq = new Groq({ apiKey: GROQ_API_KEY });

let esp32Socket = null;
let pcmAudioBuffer = [];
const BUFFER_TARGET_SIZE = 48000; // ~1.5 Seconds of 16kHz PCM Audio
let isProcessing = false;

// PCM Data ko Groq-compatible WAV Buffer mein convert karne ka function
function createWavBuffer(pcmData) {
  const dataLength = pcmData.length;
  const wavBuffer = Buffer.alloc(44 + dataLength);

  // RIFF Header
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + dataLength, 4);
  wavBuffer.write('WAVE', 8);

  // Subchunk1: fmt (PCM Specification)
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16); 
  wavBuffer.writeUInt16LE(1, 20);  // AudioFormat = 1 (Linear PCM)
  wavBuffer.writeUInt16LE(1, 22);  // Channels = 1 (Mono)
  wavBuffer.writeUInt32LE(16000, 24); // Sample Rate = 16000Hz
  wavBuffer.writeUInt32LE(32000, 28); // Byte Rate (16000 * 1 * 2)
  wavBuffer.writeUInt16LE(2, 32);  // Block Align
  wavBuffer.writeUInt16LE(16, 34); // Bits Per Sample = 16

  // Subchunk2: data
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataLength, 40);

  // Copy raw PCM audio bytes
  pcmData.copy(wavBuffer, 44);
  return wavBuffer;
}

// Groq Whisper API Call Handler
async function processAudioWithGroq() {
  if (pcmAudioBuffer.length === 0 || isProcessing) return;

  isProcessing = true;
  const rawPcm = Buffer.concat(pcmAudioBuffer);
  pcmAudioBuffer = []; 

  try {
    const wavBuffer = createWavBuffer(rawPcm);
    const audioFile = await Groq.toFile(wavBuffer, 'speech.wav', { type: 'audio/wav' });

    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3",
      language: "hi", // Hindi + English Accent Detection
      response_format: "json"
    });

    const textResult = transcription.text ? transcription.text.trim() : "";

    if (textResult !== "" && esp32Socket && esp32Socket.readyState === WebSocket.OPEN) {
      console.log("Transcribed Text:", textResult);
      esp32Socket.send(JSON.stringify({
        type: "stt_text",
        text: textResult,
        is_final: true
      }));
    }
  } catch (err) {
    console.error("Groq Processing Error:", err.message);
  } finally {
    isProcessing = false;
  }
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
    pcmAudioBuffer = [];

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        pcmAudioBuffer.push(data);
        
        let currentLength = pcmAudioBuffer.reduce((acc, val) => acc + val.length, 0);
        if (currentLength >= BUFFER_TARGET_SIZE) {
          processAudioWithGroq();
        }
      }
    });

    ws.on('close', () => {
      console.log("🔴 ESP32 Disconnected!");
      if (esp32Socket === ws) esp32Socket = null;
      pcmAudioBuffer = [];
    });
  }
});

app.get('/', (req, res) => {
  res.send("<h2>ESP32 Groq Whisper Relay Server Running 🚀</h2>");
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
