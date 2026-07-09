var baileys = require('baileys');
var makeWASocket = baileys.default;
var useMultiFileAuthState = baileys.useMultiFileAuthState;
var DisconnectReason = baileys.DisconnectReason;
var fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
var jidNormalizedUser = baileys.jidNormalizedUser;
var Browsers = baileys.Browsers;

var pino = require('pino');
var http = require('http');
var path = require('path');
var fs = require('fs');
var config = require('./config');
var ai = require('./ai');
var antiSpam = require('./antiSpam');
var memberManager = require('./memberManager');
var commands = require('./commands');
var groupManager = require('./groupManager');

// ── Thumbnail globale (affichée sur chaque réponse du bot) ──
var THUMBNAIL_PATH = path.join(__dirname, '..', 'assets', 'thumbnail.jpg');
var GLOBAL_THUMBNAIL = null;
try { GLOBAL_THUMBNAIL = fs.readFileSync(THUMBNAIL_PATH); } catch (e) { GLOBAL_THUMBNAIL = null; }

// ── Dossier de stockage des sessions (persistant) ──
// Sur Render/Katabump, configure un disque persistant monte sur ce chemin
// via la variable DATA_DIR (ex: /data). Sinon, fallback local.
var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
var AUTH_DIR = path.join(DATA_DIR, 'sessions');
try { fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch (e) {}

// ── Sessions multi-connexion ──
// Format: { id, phone, pairingCode, isConnected, sock, status, retries }
var sessions = [];
var nextSessionId = 1;

// ── Serveur web ──
function startWebServer(port) {
  http.createServer(function (req, res) {
    // ── API : ajouter une session ──
    if (req.url === '/add-session' && req.method === 'POST') {
      var body = '';
      req.on('data', function (chunk) { body += chunk; });
      req.on('end', async function () {
        try {
          var data = JSON.parse(body || '{}');
          var phone = (data.phone || '').replace(/[^0-9]/g, '');
          if (!phone || phone.length < 10) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Numero invalide (format international, ex: 226XXXXXXXXX)' }));
            return;
          }

          // Eviter les doublons : si une session existe deja pour ce numero, on la reutilise
          var existing = null;
          for (var k = 0; k < sessions.length; k++) {
            if (sessions[k].phone === phone) { existing = sessions[k]; break; }
          }
          if (existing) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, sessionId: existing.id, existing: true }));
            return;
          }

          var sessionId = nextSessionId++;
          var session = {
            id: sessionId,
            phone: phone,
            pairingCode: null,
            isConnected: false,
            sock: null,
            status: 'starting',
            retries: 0,
          };
          sessions.push(session);
          console.log('Nouvelle session #' + sessionId + ' pour: +' + phone);
          startSession(session).catch(function (e) {
            session.status = 'error';
            console.error('Erreur session #' + sessionId + ':', e.message);
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sessionId: sessionId }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ── API : supprimer / deconnecter une session ──
    if (req.url === '/remove-session' && req.method === 'POST') {
      var rbody = '';
      req.on('data', function (chunk) { rbody += chunk; });
      req.on('end', async function () {
        try {
          var rdata = JSON.parse(rbody || '{}');
          var id = parseInt(rdata.id, 10);
          await removeSession(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ── API : statut de toutes les sessions ──
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessions: sessions.map(function (s) {
          return {
            id: s.id,
            phone: s.phone,
            pairingCode: s.pairingCode,
            isConnected: s.isConnected,
            status: s.status,
          };
        }),
      }));
      return;
    }

    // ── Health check (keep-alive) ──
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        sessions: sessions.length,
        connected: sessions.filter(function (s) { return s.isConnected; }).length,
        uptime: Math.floor(process.uptime()),
      }));
      return;
    }

    // ── Page principale ──
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHTML());
  }).listen(port, function () {
    console.log('Serveur web demarre sur le port ' + port);
  });
}

// ── Restaurer les sessions existantes au demarrage (apres redeploiement) ──
async function restoreSessions() {
  var dirs;
  try {
    dirs = fs.readdirSync(AUTH_DIR);
  } catch (e) {
    return;
  }
  for (var i = 0; i < dirs.length; i++) {
    var name = dirs[i];
    // Format du dossier: session_<phone>
    if (name.indexOf('session_') !== 0) continue;
    var phone = name.replace('session_', '');
    var credsPath = path.join(AUTH_DIR, name, 'creds.json');
    if (!fs.existsSync(credsPath)) continue;

    var sessionId = nextSessionId++;
    var session = {
      id: sessionId,
      phone: phone,
      pairingCode: null,
      isConnected: false,
      sock: null,
      status: 'restoring',
      retries: 0,
    };
    sessions.push(session);
    console.log('Restauration session #' + sessionId + ' (+' + phone + ')');
    startSession(session).catch(function (e) {
      console.error('Erreur restauration:', e.message);
    });
  }
}

// ── Supprimer une session ──
async function removeSession(id) {
  var idx = -1;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return;
  var session = sessions[idx];
  try {
    if (session.sock) {
      await session.sock.logout().catch(function () {});
    }
  } catch (e) {}
  // Supprimer le dossier d'auth
  var dir = path.join(AUTH_DIR, 'session_' + session.phone);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  sessions.splice(idx, 1);
  console.log('Session #' + id + ' supprimee.');
}

// ── Démarrer une session WhatsApp ──
async function startSession(session) {
  var authDir = path.join(AUTH_DIR, 'session_' + session.phone);
  try { fs.mkdirSync(authDir, { recursive: true }); } catch (e) {}

  var stateResult = await useMultiFileAuthState(authDir);
  var state = stateResult.state;
  var saveCreds = stateResult.saveCreds;

  var versionResult = await fetchLatestBaileysVersion();
  var version = versionResult.version;

  var usePairingCode = !state.creds.registered;

  var sock = makeWASocket({
    version: version,
    auth: state,
    // IMPORTANT : navigateur canonique sinon WhatsApp rejette l'appairage.
    browser: Browsers.macOS('Safari'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    logger: pino({ level: 'silent' }),
    keepAliveIntervalMs: 25000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    retryRequestDelayMs: 2000,
  });

  session.sock = sock;
  session.status = usePairingCode ? 'pairing' : 'connecting';
  sock.ev.on('creds.update', saveCreds);

  // ── Injection automatique du thumbnail sur chaque réponse texte du bot ──
  var originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = function (jid, content, options) {
    if (
      GLOBAL_THUMBNAIL &&
      content && typeof content.text === 'string' &&
      !content.image && !content.video && !content.audio && !content.sticker && !content.document &&
      !(content.delete)
    ) {
      content = Object.assign({}, content);
      content.contextInfo = Object.assign({}, content.contextInfo, {
        externalAdReply: Object.assign(
          { title: config.botNameStyled, body: config.ownerStyled, thumbnail: GLOBAL_THUMBNAIL, mediaType: 1, renderLargerThumbnail: false },
          (content.contextInfo && content.contextInfo.externalAdReply) || {}
        ),
      });
    }
    return originalSendMessage(jid, content, options);
  };

  // ── Demande du code d'appairage AU BON MOMENT ──
  // On attend un court instant que le socket initialise sa connexion WebSocket,
  // PUIS on demande le code. Demander trop tot genere un "code mort".
  if (usePairingCode) {
    var requested = false;
    var requestCode = async function () {
      if (requested) return;
      if (state.creds.registered) return;
      requested = true;
      try {
        // Petit delai pour laisser le socket s'ouvrir proprement
        await new Promise(function (r) { setTimeout(r, 3000); });
        var code = await sock.requestPairingCode(session.phone);
        // Format lisible : XXXX-XXXX
        var grouped = (code || '').match(/.{1,4}/g);
        session.pairingCode = grouped ? grouped.join('-') : code;
        session.status = 'pairing';
        console.log('Session #' + session.id + ' (+' + session.phone + ') code: ' + session.pairingCode);
      } catch (e) {
        requested = false;
        console.error('Erreur pairage session #' + session.id + ':', e.message);
      }
    };
    // Declenche la demande peu apres la creation du socket
    setTimeout(requestCode, 1000);
  }

  // ── Connexion update ──
  sock.ev.on('connection.update', async function (update) {
    var connection = update.connection;
    var lastDisconnect = update.lastDisconnect;

    if (connection === 'connecting') {
      if (session.status === 'starting') session.status = 'connecting';
    }

    if (connection === 'close') {
      var statusCode =
        lastDisconnect &&
        lastDisconnect.error &&
        lastDisconnect.error.output &&
        lastDisconnect.error.output.statusCode;

      session.isConnected = false;

      // 401 / loggedOut : session invalide, on nettoie tout
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log('Session #' + session.id + ' deconnectee definitivement (logout).');
        session.status = 'logged_out';
        session.pairingCode = null;
        var dir = path.join(AUTH_DIR, 'session_' + session.phone);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
        return;
      }

      // 515 (restart required) : NORMAL juste apres l'appairage.
      // Il faut simplement relancer la connexion.
      if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
        console.log('Session #' + session.id + ' restart requis (515) — reconnexion immediate...');
        startSession(session).catch(function (e) {
          console.error('Reconnexion 515 echouee #' + session.id + ':', e.message);
        });
        return;
      }

      // Autres deconnexions : reconnexion avec backoff
      session.retries = (session.retries || 0) + 1;
      if (session.retries > 8) {
        console.log('Session #' + session.id + ' trop de tentatives — arret.');
        session.status = 'error';
        return;
      }
      var delay = Math.min(3000 * session.retries, 30000);
      session.status = 'reconnecting';
      console.log('Session #' + session.id + ' reconnexion dans ' + (delay / 1000) + 's (tentative ' + session.retries + ')');
      setTimeout(function () {
        startSession(session).catch(function (e) {
          console.error('Reconnexion echouee #' + session.id + ':', e.message);
        });
      }, delay);
    }

    if (connection === 'open') {
      session.isConnected = true;
      session.pairingCode = null;
      session.status = 'connected';
      session.retries = 0;
      console.log('Session #' + session.id + ' (+' + session.phone + ') connectee !');
    }
  });

  // ── Membres groupe (welcome/goodbye géré par commands.js) ──
  sock.ev.on('group-participants.update', async function (event) {
    await commands.handleGroupParticipantUpdate(sock, event).catch(console.error);
  });

  // ── Messages ──
  sock.ev.on('messages.upsert', async function (upsert) {
    if (upsert.type !== 'notify') return;
    var msgs = upsert.messages;
    for (var i = 0; i < msgs.length; i++) {
      cacheMessage(msgs[i]);
      await handleMessage(sock, msgs[i], session);
    }
  });

  // ── Anti-suppression : détecte la révocation d'un message et le sauvegarde ──
  sock.ev.on('messages.update', async function (updates) {
    for (var u = 0; u < updates.length; u++) {
      await handleMessageDelete(sock, updates[u], session).catch(console.error);
    }
  });

  return sock;
}

// ── Cache anti-suppression (mémoire, TTL ~2h) ──
var deletedMsgCache = new Map(); // key: remoteJid_id -> { text, senderId, senderName, isStatus, timestamp }
var CACHE_TTL = 2 * 60 * 60 * 1000;

function cacheKey(remoteJid, id) { return remoteJid + '_' + id; }

function cacheMessage(msg) {
  try {
    if (!msg.message || msg.key.fromMe) return;
    var remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;

    var text = '';
    if (msg.message.conversation) text = msg.message.conversation;
    else if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text || '';
    else if (msg.message.imageMessage) text = '[Image] ' + (msg.message.imageMessage.caption || '');
    else if (msg.message.videoMessage) text = '[Vidéo] ' + (msg.message.videoMessage.caption || '');
    else if (msg.message.audioMessage) text = '[Audio/Vocal]';
    else if (msg.message.stickerMessage) text = '[Sticker]';
    else if (msg.message.documentMessage) text = '[Document] ' + (msg.message.documentMessage.fileName || '');
    if (!text) return;

    var isStatus = remoteJid === 'status@broadcast';
    var senderId = isStatus ? (msg.key.participant || msg.pushName || 'Inconnu') : (msg.key.participant || remoteJid);

    deletedMsgCache.set(cacheKey(remoteJid, msg.key.id), {
      text: text,
      senderId: senderId,
      senderName: msg.pushName || (senderId.split ? senderId.split('@')[0] : senderId),
      isStatus: isStatus,
      remoteJid: remoteJid,
      timestamp: Date.now(),
    });

    // Nettoyage périodique simple (évite fuite mémoire)
    if (deletedMsgCache.size > 500) {
      var now = Date.now();
      deletedMsgCache.forEach(function (v, k) {
        if (now - v.timestamp > CACHE_TTL) deletedMsgCache.delete(k);
      });
    }
  } catch (e) {}
}

async function handleMessageDelete(sock, update, session) {
  var key = update.key;
  if (!key) return;

  // La révocation arrive soit via update.message === null avec protocolMessage TYPE REVOKE,
  // soit directement en messageStubType. On couvre le cas standard Baileys :
  var isRevoke =
    (update.update && update.update.message === null) ||
    (update.update && update.update.messageStubType === 68); // REVOKE

  if (!isRevoke) return;

  var found = deletedMsgCache.get(cacheKey(key.remoteJid, key.id));
  if (!found) return; // message pas en cache, on ne peut rien récupérer

  deletedMsgCache.delete(cacheKey(key.remoteJid, key.id));

  var ownerJid = config.ownerNumber + '@s.whatsapp.net';
  var location = found.isStatus ? '📵 *Statut supprimé*' : '🗑️ *Message supprimé*';
  var origin = found.isStatus ? '' : ('\n📍 *Dans:* ' + (found.remoteJid.endsWith('@g.us') ? 'un groupe' : 'privé'));

  await sock.sendMessage(ownerJid, {
    text: location + '\n\n👤 *De:* ' + found.senderName +
      origin +
      '\n💬 *Contenu:*\n' + found.text +
      '\n\n> 🚀 *' + config.botNameStyled + '* | ' + config.ownerStyled,
  }).catch(function () {});
}

// ── Traitement message ──
async function handleMessage(sock, msg, session) {
  try {
    if (!msg.message) return;
    if (msg.key.fromMe) return;

    var groupId = msg.key.remoteJid;
    if (!groupId) return;
    var isGroup = groupId.endsWith('@g.us');
    var isPrivate = groupId.endsWith('@s.whatsapp.net');
    if (!isGroup && !isPrivate) return;

    var senderId = isGroup ? (msg.key.participant || msg.key.remoteJid) : msg.key.remoteJid;
    var senderName = msg.pushName || senderId.split('@')[0];

    var text = '';
    if (msg.message.conversation) {
      text = msg.message.conversation;
    } else if (msg.message.extendedTextMessage) {
      text = msg.message.extendedTextMessage.text || '';
    } else if (msg.message.imageMessage) {
      text = msg.message.imageMessage.caption || '';
    }
    text = text.trim();
    if (!text) return;

    var permBanned = await memberManager.isPermanentlyBanned(senderId);
    if (permBanned) return;

    var isAdminInGroup = false;
    if (isGroup) {
      var groupMetadata = await sock.groupMetadata(groupId).catch(function () { return null; });
      if (groupMetadata && groupMetadata.participants) {
        for (var j = 0; j < groupMetadata.participants.length; j++) {
          var p = groupMetadata.participants[j];
          if (jidNormalizedUser(p.id) === jidNormalizedUser(senderId)) {
            if (p.admin) isAdminInGroup = true;
            break;
          }
        }
      }
    }

    var isAdminDB = await memberManager.isAdmin(senderId);
    var isAdminUser =
      isAdminInGroup ||
      isAdminDB ||
      senderId === (session.phone + '@s.whatsapp.net');

    await memberManager.registerMember(senderId, senderName, isAdminUser);

    if (!isAdminUser) {
      var spamResult = antiSpam.checkSpam(senderId);
      if (spamResult.isSpam) {
        if (spamResult.isBanned) {
          await sock.sendMessage(groupId, {
            text: '⛔ @' + senderId.split('@')[0] + ' Banni temporairement pour spam. ' + spamResult.remaining + 's',
            mentions: [senderId],
          });
        }
        return;
      }
    }

    // L'anti-lien ne s'applique qu'en groupe
    if (isGroup) {
      var linkBlocked = await commands.checkAntiLink(sock, msg, groupId, senderId, isAdminUser);
      if (linkBlocked) return;
    }

    var validPrefixes = ['.', '!', '?', '/', '-', '_'];
    var firstChar = text.charAt(0);
    var isCommand = validPrefixes.indexOf(firstChar) !== -1;
    var normalizedText = isCommand ? ('!' + text.slice(1)) : text;
    var parts = normalizedText.toLowerCase().split(' ');
    var command = parts[0];
    var args = normalizedText.split(' ').slice(1);

    var groupOnlyCommands = [
      '!ban', '!unban', '!kick', '!promote', '!demote', '!mute', '!unmute',
      '!tagall', '!hidetag', '!welcome', '!goodbye', '!antilink', '!antispam',
      '!annonce', '!lien', '!groupinfo', '!vv',
      '!warn', '!warnlist', '!resetwarn'
    ];

    if (isCommand && !isGroup && groupOnlyCommands.indexOf(command) !== -1) {
      await sock.sendMessage(groupId, {
        text: '⚠️ Cette commande fonctionne uniquement dans les groupes.',
      });
      return;
    }

    if (isCommand) {
      if (isAdminUser) {
        var handledAdmin = await commands.handleAdminCommand(sock, msg, command, args, senderId, groupId);
        if (handledAdmin) return;
      }
      var handledMember = await commands.handleMemberCommand(sock, msg, command, args, senderId, groupId);
      if (handledMember) return;
    }

    if (!commands.isBotActive()) return;

    // ── En groupe : le bot ne réagit en mode chat libre QUE s'il est mentionné ──
    // ou si on répond (cite) un de ses propres messages. Les commandes .xxx marchent toujours.
    if (isGroup) {
      var botJid = jidNormalizedUser(session.phone + '@s.whatsapp.net');
      var contextInfo =
        (msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo) || null;

      var mentionedJids = (contextInfo && contextInfo.mentionedJid) || [];
      var isBotMentioned = mentionedJids.some(function (j) {
        return jidNormalizedUser(j) === botJid;
      });

      var quotedParticipant = contextInfo && contextInfo.participant;
      var isBotQuoted = quotedParticipant && jidNormalizedUser(quotedParticipant) === botJid;

      if (!isBotMentioned && !isBotQuoted) return;
    }

    // ── Protection owner : messages privés répétés OU mentions répétées en groupe ──
    if (antiSpam.isOwnerProtectionActive() && senderId !== (config.ownerNumber + '@s.whatsapp.net')) {
      var ownerCheck = antiSpam.checkOwnerSpam(senderId);
      if (ownerCheck.isSpam) {
        try {
          await sock.updateBlockStatus(senderId, 'block');
        } catch (blockErr) {}
        await sock.sendMessage(config.ownerNumber + '@s.whatsapp.net', {
          text: '🛡️ *Protection activée*\n\n@' + senderId.split('@')[0] + ' a été bloqué automatiquement pour spam répété.' +
            '\n\n> 🚀 *' + config.botNameStyled + '* | ' + config.ownerStyled,
          mentions: [senderId],
        }).catch(function () {});
        return;
      }
    }

    await sock.sendPresenceUpdate('composing', groupId);
    await new Promise(function (resolve) { setTimeout(resolve, config.aiDelay); });

    var aiResponse = await ai.askAssist(senderId, text, senderName);

    await sock.sendMessage(groupId, {
      text: '🚀 @' + senderId.split('@')[0] + '\n\n' + aiResponse +
        '\n\n— *' + config.botNameStyled + '* | ' + config.ownerStyled +
        '\n🖤 _' + config.getRandomDarkQuote() + '_',
      mentions: [senderId],
    });

    await sock.sendPresenceUpdate('paused', groupId);
  } catch (error) {
    console.error('Handler Error:', error.message);
  }
}

// ── Démarrage principal ──
async function startBot() {
  startWebServer(process.env.PORT || 3000);
  await restoreSessions();
  console.log('Bot demarre. Ouvre la page web pour connecter un numero.');
}

module.exports = { startBot, getSessions: function() { return sessions; }, getNextId: function() { return nextSessionId++; }, pushSession: function(s) { sessions.push(s); }, startSession: startSession };

// ── Page HTML multi-connexion ──
function getHTML() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${config.botName} — Connexion</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root{
      --ink:#0c0a10;
      --ink-2:#161219;
      --panel:#1b1620;
      --line:rgba(240,237,230,0.09);
      --cream:#f0ede6;
      --cream-dim:#a39d95;
      --green:#25d366;
      --green-dim:rgba(37,211,102,0.14);
      --amber:#e8a33d;
      --amber-dim:rgba(232,163,61,0.14);
      --red:#e8574d;
      --red-dim:rgba(232,87,77,0.14);
    }
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      background:
        radial-gradient(ellipse 900px 500px at 15% -5%,rgba(37,211,102,0.09),transparent 60%),
        radial-gradient(ellipse 700px 500px at 100% 10%,rgba(232,163,61,0.06),transparent 55%),
        var(--ink);
      font-family:'Inter',Arial,sans-serif;
      min-height:100vh;
      padding:28px 20px 60px;
      color:var(--cream);
    }
    ::selection{background:var(--green);color:#04140a}

    .header{max-width:900px;margin:0 auto 34px;display:flex;align-items:center;gap:16px}
    .mark{
      width:52px;height:52px;border-radius:14px;flex-shrink:0;
      background:linear-gradient(155deg,var(--green),#129c4a);
      display:flex;align-items:center;justify-content:center;
      font-size:24px;box-shadow:0 8px 24px -8px rgba(37,211,102,0.5);
    }
    .header h1{
      font-family:'Sora',sans-serif;font-weight:700;font-size:21px;color:var(--cream);
      letter-spacing:-0.01em;
    }
    .header .sub{color:var(--cream-dim);font-size:12.5px;margin-top:3px}
    .header .sub b{color:var(--green);font-weight:600}

    .add-card{
      background:var(--panel);
      border:1px solid var(--line);
      border-radius:18px;padding:26px 28px;max-width:520px;margin:0 auto 40px;
      position:relative;overflow:hidden;
    }
    .add-card::before{
      content:'';position:absolute;top:0;left:0;right:0;height:2px;
      background:linear-gradient(90deg,var(--green),transparent 70%);
    }
    .eyebrow{
      font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;
      color:var(--green);letter-spacing:0.14em;text-transform:uppercase;margin-bottom:10px;
    }
    .add-card h2{font-family:'Sora',sans-serif;font-size:17px;font-weight:600;margin-bottom:6px}
    .add-card .hint{color:var(--cream-dim);font-size:12.5px;margin-bottom:18px;line-height:1.6}
    .add-card .hint b{color:var(--cream);font-family:'JetBrains Mono',monospace;font-weight:600}
    .input-row{display:flex;gap:10px}
    input[type=tel]{
      flex:1;background:var(--ink-2);border:1px solid var(--line);border-radius:11px;
      padding:13px 15px;color:var(--cream);font-size:15px;font-family:'JetBrains Mono',monospace;
      outline:none;transition:border-color .15s;
    }
    input[type=tel]:focus{border-color:var(--green)}
    input[type=tel]::placeholder{color:#4a4550}
    .btn-add{
      padding:13px 22px;background:var(--green);border:none;
      border-radius:11px;color:#04140a;font-weight:700;font-size:13.5px;cursor:pointer;
      white-space:nowrap;transition:transform .12s, box-shadow .12s;font-family:'Sora',sans-serif;
    }
    .btn-add:hover{transform:translateY(-1px);box-shadow:0 6px 18px -6px rgba(37,211,102,0.55)}
    .btn-add:active{transform:translateY(0)}
    .btn-add:disabled{opacity:0.45;cursor:not-allowed;transform:none;box-shadow:none}

    .sessions-title{
      max-width:900px;margin:0 auto 16px;color:var(--cream-dim);font-size:12px;
      font-family:'JetBrains Mono',monospace;letter-spacing:0.06em;text-transform:uppercase;
      display:flex;align-items:center;gap:8px;
    }
    .sessions-title span{color:var(--green);font-weight:700}
    .sessions-grid{
      display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));
      gap:16px;max-width:900px;margin:0 auto;
    }
    .session-card{
      background:var(--panel);border-radius:16px;padding:22px;position:relative;
      border:1px solid var(--line);
    }
    .session-card.connected{border-color:rgba(37,211,102,0.35)}
    .session-card.waiting{border-color:rgba(232,163,61,0.35)}
    .session-card.errored{border-color:rgba(232,87,77,0.3)}
    .session-num{
      font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#5a5560;
      margin-bottom:10px;letter-spacing:0.05em;
    }
    .session-phone{
      font-family:'Sora',sans-serif;font-size:17px;font-weight:700;color:var(--cream);
      margin-bottom:14px;
    }
    .badge{
      display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;
      font-size:11px;font-weight:600;margin-bottom:14px;font-family:'JetBrains Mono',monospace;
    }
    .badge.ok{background:var(--green-dim);color:var(--green)}
    .badge.code{background:var(--amber-dim);color:var(--amber)}
    .badge.wait{background:rgba(163,157,149,0.1);color:var(--cream-dim)}
    .badge.err{background:var(--red-dim);color:var(--red)}
    .dot{width:6px;height:6px;border-radius:50%;background:currentColor}

    .ticket{
      background:var(--ink-2);border-radius:12px;padding:16px;margin:4px 0 14px;
      border:1.5px dashed rgba(232,163,61,0.4);cursor:pointer;text-align:center;
      transition:border-color .15s, background .15s;
    }
    .ticket:hover{border-color:var(--amber);background:#1f1a24}
    .ticket-label{
      font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--cream-dim);
      letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;
    }
    .ticket-code{
      font-family:'JetBrains Mono',monospace;font-size:25px;font-weight:700;
      color:var(--amber);letter-spacing:0.08em;
    }
    .steps{background:rgba(0,0,0,0.22);border-radius:10px;padding:12px 14px}
    .steps p{color:#8b8590;font-size:11.5px;margin:4px 0;line-height:1.55}
    .steps b{color:var(--cream)}

    .btn-remove{
      position:absolute;top:14px;right:14px;background:rgba(240,237,230,0.06);border:none;
      color:var(--cream-dim);border-radius:8px;width:26px;height:26px;font-size:13px;cursor:pointer;
      transition:background .15s, color .15s;
    }
    .btn-remove:hover{background:var(--red-dim);color:var(--red)}

    .empty{
      text-align:center;color:#5a5560;padding:50px 20px;grid-column:1/-1;
      font-family:'JetBrains Mono',monospace;font-size:12.5px;
    }
    .msg{
      background:var(--green-dim);border:1px solid rgba(37,211,102,0.3);border-radius:10px;
      padding:11px 15px;color:var(--green);font-size:12.5px;margin-top:12px;display:none;
      font-family:'JetBrains Mono',monospace;
    }
    .msg.error{background:var(--red-dim);border-color:rgba(232,87,77,0.3);color:var(--red)}

    @media (max-width:520px){
      .input-row{flex-direction:column}
      .header{gap:12px}
      .mark{width:44px;height:44px;font-size:20px}
    }
  </style>
</head>
<body>
<div class="header">
  <div class="mark">🚀</div>
  <div>
    <h1>${config.botName}</h1>
    <div class="sub">Panneau de connexion · par <b>${config.owner}</b></div>
  </div>
</div>

<div class="add-card">
  <div class="eyebrow">Nouvelle session</div>
  <h2>Connecter un numéro WhatsApp</h2>
  <div class="hint">Format international, sans le <b>+</b>, sans espaces ni zéro initial. Exemple Burkina Faso : <b>22662408620</b></div>
  <div class="input-row">
    <input type="tel" id="phoneInput" placeholder="22662408620" maxlength="15"/>
    <button class="btn-add" onclick="addSession()" id="btnAdd">Connecter</button>
  </div>
  <div class="msg" id="addMsg"></div>
</div>

<div class="sessions-title">Sessions actives — <span id="sessionCount">0</span></div>
<div class="sessions-grid" id="sessionsGrid">
  <div class="empty">Aucune session pour le moment — ajoute un numéro ci-dessus</div>
</div>

<script>
  loadSessions();
  setInterval(loadSessions, 3000);

  async function loadSessions() {
    try {
      var res = await fetch('/status');
      var data = await res.json();
      renderSessions(data.sessions || []);
    } catch(e) {}
  }

  function renderSessions(sessions) {
    var grid = document.getElementById('sessionsGrid');
    document.getElementById('sessionCount').textContent = sessions.length;
    if (sessions.length === 0) {
      grid.innerHTML = '<div class="empty">Aucune session pour le moment — ajoute un numéro ci-dessus</div>';
      return;
    }
    grid.innerHTML = sessions.map(function(s) {
      var removeBtn = '<button class="btn-remove" onclick="removeSession(' + s.id + ')" title="Supprimer">✕</button>';
      if (s.isConnected) {
        return '<div class="session-card connected">' + removeBtn +
          '<div class="session-num">SESSION #' + s.id + '</div>' +
          '<div class="session-phone">+' + s.phone + '</div>' +
          '<span class="badge ok"><span class="dot"></span>Connecté</span>' +
          '<div style="color:#8b8590;font-size:12px">${config.botName} actif et à l\\'écoute 🚀</div></div>';
      } else if (s.pairingCode) {
        return '<div class="session-card waiting">' + removeBtn +
          '<div class="session-num">SESSION #' + s.id + '</div>' +
          '<div class="session-phone">+' + s.phone + '</div>' +
          '<span class="badge code"><span class="dot"></span>En attente du code</span>' +
          '<div class="ticket" onclick="copyCode(this)">' +
          '<div class="ticket-label">Code de connexion — touche pour copier</div>' +
          '<div class="ticket-code">' + s.pairingCode + '</div></div>' +
          '<div class="steps">' +
          '<p><b>1.</b> Ouvre WhatsApp sur le téléphone du numéro</p>' +
          '<p><b>2.</b> Réglages → Appareils connectés</p>' +
          '<p><b>3.</b> Connecter un appareil</p>' +
          '<p><b>4.</b> Connecter avec le numéro de téléphone</p>' +
          '<p><b>5.</b> Entre le code ci-dessus</p>' +
          '</div></div>';
      } else if (s.status === 'error' || s.status === 'logged_out') {
        return '<div class="session-card errored">' + removeBtn +
          '<div class="session-num">SESSION #' + s.id + '</div>' +
          '<div class="session-phone">+' + s.phone + '</div>' +
          '<span class="badge err"><span class="dot"></span>' + (s.status === 'logged_out' ? 'Déconnecté' : 'Erreur') + '</span>' +
          '<div style="color:#8b8590;font-size:12px">Supprime cette session et reconnecte-toi</div></div>';
      } else {
        return '<div class="session-card">' + removeBtn +
          '<div class="session-num">SESSION #' + s.id + '</div>' +
          '<div class="session-phone">+' + s.phone + '</div>' +
          '<span class="badge wait"><span class="dot"></span>Génération du code…</span>' +
          '<div style="color:#5a5560;font-size:12px">Patiente quelques secondes</div></div>';
      }
    }).join('');
  }

  function copyCode(el) {
    var code = el.querySelector('.ticket-code').textContent.replace(/-/g, '');
    navigator.clipboard.writeText(code).catch(function(){});
    var label = el.querySelector('.ticket-label');
    var old = label.textContent;
    label.textContent = '✓ Copié dans le presse-papiers';
    setTimeout(function(){ label.textContent = old; }, 1200);
  }

  async function addSession() {
    var input = document.getElementById('phoneInput').value.replace(/[^0-9]/g, '');
    var btn = document.getElementById('btnAdd');
    if (!input || input.length < 10) {
      showMsg('❌ Entre un numéro complet au format international (ex: 22662408620)', true);
      return;
    }
    btn.disabled = true;
    showMsg('⏳ Connexion en cours…', false);
    try {
      var res = await fetch('/add-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: input }),
      });
      var data = await res.json();
      if (data.success) {
        showMsg('✅ Session créée ! Le code apparaît dans quelques secondes.', false);
        document.getElementById('phoneInput').value = '';
      } else {
        showMsg('❌ Erreur : ' + (data.error || 'Inconnue'), true);
      }
    } catch(e) {
      showMsg('❌ Erreur réseau', true);
    }
    btn.disabled = false;
  }

  async function removeSession(id) {
    if (!confirm('Supprimer cette session ?')) return;
    try {
      await fetch('/remove-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id }),
      });
      loadSessions();
    } catch(e) {}
  }

  function showMsg(text, isError) {
    var el = document.getElementById('addMsg');
    el.textContent = text;
    el.className = 'msg' + (isError ? ' error' : '');
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 5000);
  }
</script>
</body>
</html>`;
}
