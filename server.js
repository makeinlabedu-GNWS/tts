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
let isProcessing = false;
let silenceTimer = null;

// Common Whisper Hallucinations Filter List
const IGNORED_PHRASES = [
  "subtitles", "amara.org", "community", "thank you", 
  "watching", "subscribe", "mbc", "copyright", "bye"
];

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

async function processSentence() {
  if (pcmAudioBuffer.length === 0 || isProcessing) return;

  const totalLength = pcmAudioBuffer.reduce((acc, val) => acc + val.length, 0);
  // Ignore audio buffers shorter than 0.4 seconds
  if (totalLength < 12800) { 
    pcmAudioBuffer = [];
    return;
  }

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
      // Strict instruction: NO translation, NO Devanagari Unicode, preserve English words as-is
      prompt: "Transcribe exact spoken sounds using Latin alphabet only. Hindi words into Hinglish (e.g. 'Aap kya kar rahe ho'), English words in pure English (e.g. 'How are you system'). Do NOT translate. Do NOT use Devanagari.",
      response_format: "json"
    });

    let textResult = transcription.text ? transcription.text.trim() : "";
    let lowerText = textResult.toLowerCase();

    // Check if output contains unwanted subtitle hallucination
    let isHallucination = IGNORED_PHRASES.some(phrase => lowerText.includes(phrase));

    if (textResult !== "" && !isHallucination && esp32Socket && esp32Socket.readyState === WebSocket.OPEN) {
      console.log("Verified Speech:", textResult);
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
    console.log("🟢 Turn-Taking STT Active!");
    esp32Socket = ws;
    pcmAudioBuffer = [];

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        pcmAudioBuffer.push(data);

        if (silenceTimer) clearTimeout(silenceTimer);
        // Pause threshold: 400ms silence marks end of sentence
        silenceTimer = setTimeout(() => {
          processSentence();
        }, 400);
      }
    });

    ws.on('close', () => {
      console.log("🔴 ESP32 Disconnected!");
      if (esp32Socket === ws) esp32Socket = null;
      if (silenceTimer) clearTimeout(silenceTimer);
      pcmAudioBuffer = [];
    });
  }
});

app.get('/', (req, res) => {
  res.send("<h2>Native Phonetic Hinglish Assistive Server Running 🚀</h2>");
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
