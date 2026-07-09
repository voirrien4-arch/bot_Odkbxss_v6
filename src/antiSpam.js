var config = require('./config');

var spamTracker = new Map();
var tempBanned = new Map();

function checkSpam(userId) {
  var now = Date.now();

  if (tempBanned.has(userId)) {
    var banEnd = tempBanned.get(userId);
    if (now < banEnd) {
      return { isSpam: true, isBanned: true, remaining: Math.ceil((banEnd - now) / 1000) };
    }
    tempBanned.delete(userId);
  }

  if (!spamTracker.has(userId)) {
    spamTracker.set(userId, { count: 0, firstMessage: now });
  }

  var tracker = spamTracker.get(userId);

  if (now - tracker.firstMessage > config.spamWindow) {
    tracker.count = 1;
    tracker.firstMessage = now;
    return { isSpam: false, count: 1 };
  }

  tracker.count++;

  if (tracker.count > config.spamLimit) {
    tempBanned.set(userId, now + 5 * 60 * 1000);
    spamTracker.delete(userId);
    return { isSpam: true, isBanned: true, remaining: 300 };
  }

  return { isSpam: false, count: tracker.count };
}

function unbanUser(userId) {
  tempBanned.delete(userId);
  spamTracker.delete(userId);
}

function isBanned(userId) {
  return tempBanned.has(userId);
}

module.exports = { checkSpam, unbanUser, isBanned };

// ══════════════════════════════════════════
// PROTECTION OWNER — surveille le spam dirigé vers le propriétaire du bot
// (messages privés répétés OU mentions/tags répétés en groupe)
// ══════════════════════════════════════════
var ownerProtectionActive = false;
var ownerSpamTracker = new Map(); // userId -> { count, firstMessage }

var OWNER_SPAM_LIMIT = 6;      // messages/mentions tolérés
var OWNER_SPAM_WINDOW = 15000; // sur 15 secondes

function setOwnerProtection(state) {
  ownerProtectionActive = state;
  if (!state) ownerSpamTracker.clear();
}

function isOwnerProtectionActive() {
  return ownerProtectionActive;
}

// Appelé à chaque message privé reçu par le owner, ou chaque mention du owner en groupe
function checkOwnerSpam(userId) {
  if (!ownerProtectionActive) return { isSpam: false };

  var now = Date.now();
  if (!ownerSpamTracker.has(userId)) {
    ownerSpamTracker.set(userId, { count: 0, firstMessage: now });
  }
  var tracker = ownerSpamTracker.get(userId);

  if (now - tracker.firstMessage > OWNER_SPAM_WINDOW) {
    tracker.count = 1;
    tracker.firstMessage = now;
    return { isSpam: false, count: 1 };
  }

  tracker.count++;

  if (tracker.count > OWNER_SPAM_LIMIT) {
    ownerSpamTracker.delete(userId);
    return { isSpam: true, count: tracker.count };
  }

  return { isSpam: false, count: tracker.count };
}

function resetOwnerTracker(userId) {
  ownerSpamTracker.delete(userId);
}

module.exports.setOwnerProtection = setOwnerProtection;
module.exports.isOwnerProtectionActive = isOwnerProtectionActive;
module.exports.checkOwnerSpam = checkOwnerSpam;
module.exports.resetOwnerTracker = resetOwnerTracker;
