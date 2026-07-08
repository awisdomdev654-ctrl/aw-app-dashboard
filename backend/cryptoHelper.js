const crypto = require('crypto');
const fs = require('fs');


const SECRET_KEY_STRING = process.env.ENCRYPTION_KEY || 'abcdefghijklmnopqrstuvwxyz123456';
const KEY = Buffer.from(SECRET_KEY_STRING, 'utf-8');
const ALGORITHM = 'aes-256-gcm';

// 1. Encrypts raw uploaded file buffers into secure gibberish
function encryptStem(fileBuffer, outputPath) {
    const iv = crypto.randomBytes(12); // Generates a unique random vector per file
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

    const encryptedBuffer = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Slices and packages metadata (IV + Auth Tag) right into the file payload
    const finalPayload = Buffer.concat([iv, authTag, encryptedBuffer]);

    fs.writeFileSync(outputPath, finalPayload);
}

// 2. Decrypts the secure files back into playable audio buffers
function decryptStem(encryptedFilePath) {
    const filePayload = fs.readFileSync(encryptedFilePath);

    // Slice out the metadata blocks exactly by their byte lengths
    const iv = filePayload.subarray(0, 12);
    const authTag = filePayload.subarray(12, 28);
    const encryptedData = filePayload.subarray(28);

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);

    const decryptedBuffer = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return decryptedBuffer;
}

module.exports = { encryptStem, decryptStem };