const express = require('express');
const router = express.Router();
const { StemModel } = require('./models/Stem');
const { AuditEventModel } = require('./models/AuditEvent');
const { notifyOwner } = require('./notifications/notifyOwner');

// ✅ APPROVE — moves a stem out of review and into the encrypted vault
router.post('/api/stems/:stemId/approve', async function (req, res) {
  try {
    const { stemId } = req.params;
    const { actorId, actorLabel, reviewerName } = req.body || {};

    const stem = await StemModel.findOne({ stemId });
    if (!stem) {
      return res.status(404).json({ error: 'Stem not found' });
    }
    if (stem.status !== 'awaiting_review') {
      return res.status(409).json({
        error: `Stem is "${stem.status}", not awaiting review — nothing to approve`,
      });
    }

    stem.status = 'encrypted';
    stem.reviewedBy = reviewerName || actorLabel || 'Unknown reviewer';
    stem.reviewedAt = new Date();
    await stem.save();

    await AuditEventModel.create({
      actorId,
      actorLabel: actorLabel || reviewerName || 'Producer',
      action: 'stem_approved',
      resourceType: 'stem',
      resourceId: stem.stemId,
      detail: { title: stem.title, owner: stem.owner },
      createdAt: new Date(),
    });

    await notifyOwner({ stem, action: 'stem_approved' });

    res.status(200).json({ ok: true, success: true, stem });
  } catch (error) {
    console.error('❌ Approve stem failed:', error.message);
    res.status(500).json({ error: 'Failed to approve stem' });
  }
});


// ❌ REJECT — sends a stem back with a reason, never reaches the vault
router.post('/api/stems/:stemId/reject', async function (req, res) {
  try {
    const { stemId } = req.params;
    const { actorId, actorLabel, reviewerName, reason } = req.body || {};

    const stem = await StemModel.findOne({ stemId });
    if (!stem) {
      return res.status(404).json({ error: 'Stem not found' });
    }
    if (stem.status !== 'awaiting_review') {
      return res.status(409).json({
        error: `Stem is "${stem.status}", not awaiting review — nothing to reject`,
      });
    }

    stem.status = 'rejected';
    stem.reviewedBy = reviewerName || actorLabel || 'Unknown reviewer';
    stem.reviewedAt = new Date();
    stem.rejectionReason = reason || 'No reason provided';
    await stem.save();

    await AuditEventModel.create({
      actorId,
      actorLabel: actorLabel || reviewerName || 'Producer',
      action: 'stem_rejected',
      resourceType: 'stem',
      resourceId: stem.stemId,
      detail: { title: stem.title, owner: stem.owner, reason: stem.rejectionReason },
      createdAt: new Date(),
    });

    await notifyOwner({ stem, action: 'stem_rejected' });

    res.status(200).json({ ok: true, success: true, stem });
  } catch (error) {
    console.error('❌ Reject stem failed:', error.message);
    res.status(500).json({ error: 'Failed to reject stem' });
  }
});

module.exports = router;