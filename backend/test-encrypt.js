const fs = require('fs');
const { encryptStem } = require('./cryptoHelper');

// 1. Path to your raw test audio file (change 'test.mp3' to your actual file name)
const RAW_AUDIO_PATH = './test.mp3'; 
const OUTPUT_PATH = './uploads/secure-test.mp3';

try {
    console.log("Reading raw audio file...");
    const fileBuffer = fs.readFileSync(RAW_AUDIO_PATH);

    console.log("Running AES-256-GCM Encryption Engine...");
    encryptStem(fileBuffer, OUTPUT_PATH);

    console.log("Success! Check your 'uploads' folder for 'secure-test.mp3'.");
} catch (error) {
    console.error("Encryption failed:", error.message);
}