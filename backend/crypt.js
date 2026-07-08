const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { encryptStem } = require('./cryptoHelper');
const { StemModel } = require('./models/Stem');
const { AuditEventModel } = require('./models/AuditEvent');
const { notifyOwner } = require('./notifications/notifyOwner');

const upload = multer({ storage: multer.memoryStorage() });

// 🔒 THE LOCAL ENCRYPTION ROUTE
router.post('/api/upload/mongo', upload.single('file'), async function(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const stemId = `STEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const secureFilename = `secure-${Date.now()}-${req.file.originalname}`;
        const outputPath = path.join(__dirname, 'uploads', secureFilename);

        // Run local encryption pipeline
        encryptStem(req.file.buffer, outputPath);

        // 🚦 Land the stem in the review queue, not the vault. It only flips
        // to "encrypted" once a producer hits Approve on the dashboard.
        const stem = await StemModel.create({
            stemId,
            title: req.body.title || req.file.originalname,
            owner: req.body.owner || 'Unknown Artist',
            s3Key: secureFilename,
            contentType: req.file.mimetype || 'application/octet-stream',
            sizeBytes: req.file.size,
            status: 'awaiting_review',
        });

        await AuditEventModel.create({
            actorId: req.body.actorId,
            actorLabel: req.body.actorLabel || req.body.owner,
            action: 'review_requested',
            resourceType: 'stem',
            resourceId: stem.stemId,
            detail: { title: stem.title, owner: stem.owner },
            createdAt: new Date(),
        });

        // 📨 Tell the owner/producer a stem is waiting on their sign-off.
        // Swap the inside of notifyOwner() for real email/Slack later —
        // nothing here has to change.
        await notifyOwner({ stem, action: 'review_requested' });

        res.status(200).json({
            ok: true,
            success: true,
            message: 'Stem encrypted and sent to the producer for review.',
            stem,
        });
    } catch (error) {
        console.error("❌ Cryptographic Encryption Failure:", error.message);
        res.status(500).json({ error: 'Encryption pipeline breakdown' });
    }
});

module.exports = router;