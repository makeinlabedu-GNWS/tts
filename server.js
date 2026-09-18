const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECRET_KEY = "Prakash360";
const GROQ_API_KEY = process.env.GROQ_API_KEY; 

const groq = new Groq({ apiKey: GROQ_API_KEY });

let esp32Socket = null;
let pcmAudioBuffer = [];
// Reduced buffer to 16000 bytes (~0.5 seconds of 16kHz PCM audio) for ultra-fast STT
const BUFFER_TARGET_SIZE = 16000; 
let isProcessing = false;

function createWavBuffer(pcmData) {
  const dataLength = pcmData.length;
  const wavBuffer = Buffer.alloc(44 + dataLength);

  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + dataLength, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16); 
  wavBuffer.writeUInt16LE(1, 20);  
  wavBuffer.writeUInt16LE(1, 22);  
  wavBuffer.writeUInt32LE(16000, 24); 
  wavBuffer.writeUInt32LE(32000, 28); 
  wavBuffer.writeUInt16LE(2, 32);  
  wavBuffer.writeUInt16LE(16, 34); 
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataLength, 40);

  pcmData.copy(wavBuffer, 44);
  return wavBuffer;
}

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
      temperature: 0.0,
      // Strong prompt forcing Latin script to stop garbage Unicode rendering on SSD1306
      prompt: "Output ONLY in Hinglish or English using standard Latin alphabets (e.g., 'Aap kaise ho', 'Mera naam Prakash hai'). Do NOT use Devanagari or special characters.",
      response_format: "json"
    });

    const textResult = transcription.text ? transcription.text.trim() : "";

    if (textResult !== "" && esp32Socket && esp32Socket.readyState === WebSocket.OPEN) {
      console.log("Instant Text:", textResult);
      esp32Socket.send(JSON.stringify({
        type: "stt_text",
        text: textResult
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
    console.log("🟢 Fast ESP32 STT Connected!");
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
  res.send("<h2>Ultra-Fast ESP32 STT Relay Running 🚀</h2>");
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
