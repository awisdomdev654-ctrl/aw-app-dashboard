// notifications/notifyOwner.js
//
// Stub notification dispatcher for the review workflow. Right now it just
// logs — that's intentional for the prototype. In a real deployment, swap
// the body of `notifyOwner` for a call to SES / SNS / Slack / a push
// service. Nothing in crypt.js or routes/stemReview.js has to change,
// since they only depend on this function's signature.

async function notifyOwner({ stem, action = 'review_requested' }) {
    const messages = {
      review_requested: `📨 Review requested — "${stem.title}" (${stem.stemId}) is awaiting approval from ${stem.owner}.`,
      stem_approved: `✅ "${stem.title}" (${stem.stemId}) was approved and moved into the encrypted vault.`,
      stem_rejected: `❌ "${stem.title}" (${stem.stemId}) was rejected${stem.rejectionReason ? `: ${stem.rejectionReason}` : '.'}`,
    };
  
    console.log(messages[action] ?? `Notification: ${action} for ${stem.stemId}`);
  
    // Example real integration, once you're ready:
    // await sesClient.send(new SendEmailCommand({
    //   Destination: { ToAddresses: [ownerEmailFor(stem.owner)] },
    //   ...
    // }))
  
    return { delivered: true, channel: 'console-stub' };
  }
  
  module.exports = { notifyOwner };