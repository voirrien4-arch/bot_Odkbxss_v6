var config = require('./config');
var memberManager = require('./memberManager');
var ai = require('./ai');
var antiSpam = require('./antiSpam');
var groupSettings = require('./groupSettings');
var downloader = require('./downloader');
var os = require('os');

var botActive = true;
var startTime = Date.now();

function isBotActive() { return botActive; }
function setBotActive(state) { botActive = state; }

// ─── Helpers ───────────────────────────────────────────────────
function formatUptime() {
  var ms = Date.now() - startTime;
  var s = Math.floor((ms / 1000) % 60);
  var m = Math.floor((ms / 60000) % 60);
  var h = Math.floor((ms / 3600000) % 24);
  var d = Math.floor(ms / 86400000);
  if (d > 0) return d + 'j ' + h + 'h ' + m + 'm';
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function getRam() {
  var used = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  var total = Math.round(os.totalmem() / 1024 / 1024);
  return used + 'MB/' + total + 'MB';
}

function getDate() {
  var now = new Date();
  var days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  return now.toLocaleDateString('fr-FR') + ' • ' + days[now.getDay()];
}

function channelFooter() {
  return '\n\n> 🚀 *' + config.botNameStyled + '* | ' + config.ownerStyled +
    '\n> 🖤 _' + config.getRandomDarkQuote() + '_';
}

function isOwnerSender(senderId) {
  return senderId === (config.ownerNumber + '@s.whatsapp.net');
}

// ─── Commandes ADMIN ──────────────────────────────────────────
async function handleAdminCommand(sock, msg, command, args, senderId, groupId) {
  switch (command) {
    case '!on':
      botActive = true;
      await sock.sendMessage(groupId, { text: '✅ *' + config.botNameStyled + ' activé !* 🚀' + channelFooter() });
      break;

    case '!off':
      botActive = false;
      await sock.sendMessage(groupId, { text: '🔴 *' + config.botNameStyled + ' désactivé.*' + channelFooter() });
      break;

    case '!ban':
      if (msg.message && msg.message.extendedTextMessage &&
          msg.message.extendedTextMessage.contextInfo &&
          msg.message.extendedTextMessage.contextInfo.participant) {
        var target = msg.message.extendedTextMessage.contextInfo.participant;
        var reason = args.join(' ') || 'Violation des règles';
        await memberManager.banMember(target, reason);
        await sock.groupParticipantsUpdate(groupId, [target], 'remove').catch(function() {});
        await sock.sendMessage(groupId, { text: '🚫 *Membre banni*\nRaison: ' + reason + channelFooter() });
      }
      break;

    case '!protection': {
      if (!isOwnerSender(senderId)) {
        await sock.sendMessage(groupId, { text: '🔒 Commande réservée au propriétaire du bot.' + channelFooter() });
        break;
      }
      var protArg = (args[0] || '').toLowerCase();
      if (protArg === 'on' || protArg === 'activer') {
        antiSpam.setOwnerProtection(true);
        await sock.sendMessage(groupId, {
          text: '🛡️ *Protection activée !*\n\nJe bloque automatiquement toute personne qui te spam en privé ou te mentionne de façon répétée en groupe.' + channelFooter()
        });
      } else if (protArg === 'off' || protArg === 'desactiver' || protArg === 'désactiver') {
        antiSpam.setOwnerProtection(false);
        await sock.sendMessage(groupId, { text: '🛡️ Protection désactivée.' + channelFooter() });
      } else {
        var protStatus = antiSpam.isOwnerProtectionActive() ? '✅ Activée' : '❌ Désactivée';
        await sock.sendMessage(groupId, {
          text: '🛡️ *Protection anti-spam propriétaire*\n\nStatut actuel: ' + protStatus + '\n\nUtilise: .protection on / .protection off' + channelFooter()
        });
      }
      break;
    }

    case '!unban':
      if (args[0]) {
        await memberManager.unbanMember(args[0] + '@s.whatsapp.net');
        antiSpam.unbanUser(args[0] + '@s.whatsapp.net');
        await sock.sendMessage(groupId, { text: '✅ ' + args[0] + ' débanni.' + channelFooter() });
      }
      break;

    case '!warn': {
      var wCtx = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
      var wTarget = wCtx && wCtx.participant;
      if (!wTarget) {
        await sock.sendMessage(groupId, { text: '⚠️ Réponds au message du membre à avertir avec .warn [raison]' + channelFooter() });
        break;
      }
      var wReason = args.join(' ') || 'Non spécifiée';
      var wCount = await memberManager.addWarn(wTarget, wReason, groupId);
      await sock.sendMessage(groupId, {
        text: '⚠️ @' + wTarget.split('@')[0] + ' a reçu un avertissement (' + wCount + '/3)\nRaison: ' + wReason + channelFooter(),
        mentions: [wTarget],
      });
      if (wCount >= 3) {
        await sock.groupParticipantsUpdate(groupId, [wTarget], 'remove').catch(function () {});
        await sock.sendMessage(groupId, { text: '🚫 @' + wTarget.split('@')[0] + ' expulsé (3 avertissements atteints).' + channelFooter(), mentions: [wTarget] });
        await memberManager.resetWarns(wTarget);
      }
      break;
    }

    case '!warnlist': {
      var allWarns = await memberManager.getAllWarns();
      var wIds = Object.keys(allWarns);
      if (wIds.length === 0) {
        await sock.sendMessage(groupId, { text: '✅ Aucun avertissement enregistré.' + channelFooter() });
        break;
      }
      var wText = '⚠️ *Liste des avertissements*\n\n';
      for (var wi = 0; wi < wIds.length; wi++) {
        wText += '• @' + wIds[wi].split('@')[0] + ' — ' + allWarns[wIds[wi]].length + ' avertissement(s)\n';
      }
      await sock.sendMessage(groupId, { text: wText + channelFooter(), mentions: wIds });
      break;
    }

    case '!resetwarn': {
      var rwCtx = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
      var rwTarget = rwCtx && rwCtx.participant;
      if (!rwTarget) {
        await sock.sendMessage(groupId, { text: '⚠️ Réponds au message du membre pour réinitialiser ses avertissements.' + channelFooter() });
        break;
      }
      await memberManager.resetWarns(rwTarget);
      await sock.sendMessage(groupId, { text: '✅ Avertissements réinitialisés pour @' + rwTarget.split('@')[0] + channelFooter(), mentions: [rwTarget] });
      break;
    }

    case '!admin':
      if (msg.message && msg.message.extendedTextMessage &&
          msg.message.extendedTextMessage.contextInfo &&
          msg.message.extendedTextMessage.contextInfo.participant) {
        var t = msg.message.extendedTextMessage.contextInfo.participant;
        await memberManager.setAdmin(t, true);
        await sock.groupParticipantsUpdate(groupId, [t], 'promote').catch(function() {});
        await sock.sendMessage(groupId, { text: '⭐ Nouveau admin promu !' + channelFooter() });
      }
      break;

    case '!deadmin':
      if (msg.message && msg.message.extendedTextMessage &&
          msg.message.extendedTextMessage.contextInfo &&
          msg.message.extendedTextMessage.contextInfo.participant) {
        var t2 = msg.message.extendedTextMessage.contextInfo.participant;
        await memberManager.setAdmin(t2, false);
        await sock.groupParticipantsUpdate(groupId, [t2], 'demote').catch(function() {});
        await sock.sendMessage(groupId, { text: '🔽 Admin rétrogradé.' + channelFooter() });
      }
      break;

    case '!kick':
      var kickTarget = null;
      if (msg.message && msg.message.extendedTextMessage) {
        var ctx = msg.message.extendedTextMessage.contextInfo;
        if (ctx && ctx.participant) kickTarget = ctx.participant;
        if (ctx && ctx.mentionedJid && ctx.mentionedJid.length) kickTarget = ctx.mentionedJid[0];
      }
      if (kickTarget) {
        await sock.groupParticipantsUpdate(groupId, [kickTarget], 'remove').catch(function() {});
        await sock.sendMessage(groupId, {
          text: '👢 @' + kickTarget.split('@')[0] + ' a été expulsé.' + channelFooter(),
          mentions: [kickTarget]
        });
      } else {
        await sock.sendMessage(groupId, { text: '❌ Mentionne ou réponds au membre à expulser.' });
      }
      break;

    case '!promote':
      var promTarget = null;
      if (msg.message && msg.message.extendedTextMessage) {
        var pctx = msg.message.extendedTextMessage.contextInfo;
        if (pctx && pctx.participant) promTarget = pctx.participant;
        if (pctx && pctx.mentionedJid && pctx.mentionedJid.length) promTarget = pctx.mentionedJid[0];
      }
      if (promTarget) {
        await sock.groupParticipantsUpdate(groupId, [promTarget], 'promote').catch(function() {});
        await sock.sendMessage(groupId, {
          text: '⬆️ @' + promTarget.split('@')[0] + ' promu administrateur.' + channelFooter(),
          mentions: [promTarget]
        });
      } else {
        await sock.sendMessage(groupId, { text: '❌ Mentionne ou réponds au membre à promouvoir.' });
      }
      break;

    case '!demote':
      var demTarget = null;
      if (msg.message && msg.message.extendedTextMessage) {
        var dctx = msg.message.extendedTextMessage.contextInfo;
        if (dctx && dctx.participant) demTarget = dctx.participant;
        if (dctx && dctx.mentionedJid && dctx.mentionedJid.length) demTarget = dctx.mentionedJid[0];
      }
      if (demTarget) {
        await sock.groupParticipantsUpdate(groupId, [demTarget], 'demote').catch(function() {});
        await sock.sendMessage(groupId, {
          text: '⬇️ @' + demTarget.split('@')[0] + ' rétrogradé.' + channelFooter(),
          mentions: [demTarget]
        });
      } else {
        await sock.sendMessage(groupId, { text: '❌ Mentionne ou réponds au membre à rétrograder.' });
      }
      break;

    case '!mute':
      await sock.groupSettingUpdate(groupId, 'announcement').catch(function() {});
      await sock.sendMessage(groupId, { text: '🔇 *Groupe muté.* Seuls les admins peuvent écrire.' + channelFooter() });
      break;

    case '!unmute':
      await sock.groupSettingUpdate(groupId, 'not_announcement').catch(function() {});
      await sock.sendMessage(groupId, { text: '🔊 *Groupe démuté.* Tous les membres peuvent écrire.' + channelFooter() });
      break;

    case '!tagall':
    case '!hidetag': {
      var tagText = args.join(' ') || '📢 *Message à tous les membres* 🚀';
      var metadata = await sock.groupMetadata(groupId).catch(function() { return null; });
      if (!metadata) { await sock.sendMessage(groupId, { text: '❌ Erreur groupe.' }); break; }
      var allIds = metadata.participants.map(function(p) { return p.id; });
      var displayText = command === '!tagall' ? tagText : ' ';
      await sock.sendMessage(groupId, { text: displayText, mentions: allIds });
      break;
    }

    case '!annonce':
      var annonce = args.join(' ');
      if (annonce) {
        await sock.sendMessage(groupId, {
          text: '📢 *ANNONCE OFFICIELLE*\n\n' + annonce + '\n\n🚀 *— ' + config.ownerStyled + ' | ' + config.botNameStyled + '*' + channelFooter(),
        });
      }
      break;

    case '!setlink':
      if (args[0]) {
        config.groupLink = args[0];
        await sock.sendMessage(groupId, { text: '✅ Lien du groupe mis à jour !' + channelFooter() });
      }
      break;

    case '!welcome':
      var wSub = args[0] ? args[0].toLowerCase() : '';
      if (wSub === 'on') {
        groupSettings.set(groupId, 'welcome', true);
        await sock.sendMessage(groupId, { text: '✅ *Messages de bienvenue activés* 👋' + channelFooter() });
      } else if (wSub === 'off') {
        groupSettings.set(groupId, 'welcome', false);
        await sock.sendMessage(groupId, { text: '❌ *Messages de bienvenue désactivés.*' + channelFooter() });
      } else {
        var wStatus = groupSettings.get(groupId, 'welcome', false) ? '✅ Activé' : '❌ Désactivé';
        await sock.sendMessage(groupId, {
          text: '╭━━━ *WELCOME* ━━━\n┃\n┃ 📌 *Statut:* ' + wStatus + '\n┃\n┃ 📖 Commandes:\n┃ !welcome on  → Activer\n┃ !welcome off → Désactiver\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter()
        });
      }
      break;

    case '!goodbye':
      var gSub = args[0] ? args[0].toLowerCase() : '';
      if (gSub === 'on') {
        groupSettings.set(groupId, 'goodbye', true);
        await sock.sendMessage(groupId, { text: '✅ *Messages d\'au revoir activés* 👋' + channelFooter() });
      } else if (gSub === 'off') {
        groupSettings.set(groupId, 'goodbye', false);
        await sock.sendMessage(groupId, { text: '❌ *Messages d\'au revoir désactivés.*' + channelFooter() });
      } else {
        var gStatus = groupSettings.get(groupId, 'goodbye', false) ? '✅ Activé' : '❌ Désactivé';
        await sock.sendMessage(groupId, {
          text: '╭━━━ *GOODBYE* ━━━\n┃\n┃ 📌 *Statut:* ' + gStatus + '\n┃\n┃ 📖 Commandes:\n┃ !goodbye on  → Activer\n┃ !goodbye off → Désactiver\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter()
        });
      }
      break;

    case '!antilink':
      var alSub = args[0] ? args[0].toLowerCase() : '';
      if (alSub === 'on') {
        groupSettings.set(groupId, 'antilink', true);
        await sock.sendMessage(groupId, { text: '🔗 *Anti-liens activé.* Les liens seront supprimés.' + channelFooter() });
      } else if (alSub === 'off') {
        groupSettings.set(groupId, 'antilink', false);
        await sock.sendMessage(groupId, { text: '✅ *Anti-liens désactivé.*' + channelFooter() });
      } else {
        var alStatus = groupSettings.get(groupId, 'antilink', false) ? '✅ Activé' : '❌ Désactivé';
        await sock.sendMessage(groupId, {
          text: '╭━━━ *ANTILINK* ━━━\n┃\n┃ 📌 *Statut:* ' + alStatus + '\n┃\n┃ 📖 Commandes:\n┃ !antilink on  → Activer\n┃ !antilink off → Désactiver\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter()
        });
      }
      break;

    case '!antispam':
      var asSub = args[0] ? args[0].toLowerCase() : '';
      if (asSub === 'on') {
        groupSettings.set(groupId, 'antispam', true);
        await sock.sendMessage(groupId, { text: '🛡️ *Anti-spam activé.*' + channelFooter() });
      } else if (asSub === 'off') {
        groupSettings.set(groupId, 'antispam', false);
        await sock.sendMessage(groupId, { text: '✅ *Anti-spam désactivé.*' + channelFooter() });
      } else {
        var asStatus = groupSettings.get(groupId, 'antispam', true) ? '✅ Activé' : '❌ Désactivé';
        await sock.sendMessage(groupId, {
          text: '╭━━━ *ANTISPAM* ━━━\n┃\n┃ 📌 *Statut:* ' + asStatus + '\n┃\n┃ 📖 Commandes:\n┃ !antispam on  → Activer\n┃ !antispam off → Désactiver\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter()
        });
      }
      break;

    case '!annoncetous':
      var msg2 = args.join(' ');
      if (msg2) {
        var allMembers = await memberManager.getAllMembers();
        var ids = Object.keys(allMembers);
        for (var i = 0; i < ids.length; i++) {
          await sock.sendMessage(ids[i], {
            text: '📢 *Message de ' + config.ownerStyled + '*\n\n' + msg2 + '\n\n🚀 ' + config.botNameStyled,
          }).catch(function() {});
        }
        await sock.sendMessage(groupId, { text: '✅ Message envoyé à tous.' + channelFooter() });
      }
      break;

    case '!stats':
      var members = await memberManager.getAllMembers();
      var total = Object.keys(members).length;
      var admins = Object.values(members).filter(function(m) { return m.isAdmin; }).length;
      await sock.sendMessage(groupId, {
        text: '╭━━━ *STATISTIQUES* ━━━\n┃\n┃ 👥 *Membres:* ' + total + '\n┃ ⭐ *Admins:* ' + admins + '\n┃ 🤖 *Bot:* ' + (botActive ? '✅ Actif' : '🔴 Inactif') + '\n┃ ⏱️ *Uptime:* ' + formatUptime() + '\n┃ 💾 *RAM:* ' + getRam() + '\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter(),
      });
      break;

    case '!reset':
      if (args[0]) {
        ai.resetConversation(args[0] + '@s.whatsapp.net');
        await sock.sendMessage(groupId, { text: '🔄 Historique réinitialisé pour ' + args[0] + channelFooter() });
      } else {
        ai.resetConversation(senderId);
        await sock.sendMessage(groupId, { text: '🔄 Votre historique réinitialisé.' + channelFooter() });
      }
      break;


    // ── Pair ──
    case '!pair': {
      var pairNum = args[0] ? args[0].replace(/[^0-9]/g, '') : '';
      if (!pairNum || pairNum.length < 8 || pairNum.length > 15) {
        await sock.sendMessage(groupId, {
          text: '❌ *Utilisation:* !pair [numéro]\n\n📱 Format international sans + ni espaces\n*Exemple:* !pair 22662408620' + channelFooter()
        });
        break;
      }
      // Accès au système de sessions du bot principal
      var botModule = require('./bot');
      var existingSessions = botModule.getSessions();
      var alreadyExists = existingSessions.filter(function(s) { return s.phone === pairNum; })[0];
      if (alreadyExists) {
        var existStatus = alreadyExists.isConnected ? '✅ Déjà connecté' : '⏳ En cours de connexion';
        await sock.sendMessage(groupId, {
          text: '⚠️ Le numéro *+' + pairNum + '* a déjà une session.\n📊 Statut: ' + existStatus + channelFooter()
        });
        break;
      }
      var newSession = {
        id: botModule.getNextId(),
        phone: pairNum,
        pairingCode: null,
        isConnected: false,
        sock: null,
        status: 'starting',
        retries: 0,
      };
      botModule.pushSession(newSession);
      await sock.sendMessage(groupId, {
          text: '⏳ *Connexion de +' + pairNum + ' en cours...*\n\nGénération du code d\'appairage...' + channelFooter()
      });
      // Démarrer la session et attendre le code
      botModule.startSession(newSession).catch(function(e) {
        newSession.status = 'error';
      });
      // Attendre que le code soit généré (max 15s)
      var waited = 0;
      var checkCode = setInterval(async function() {
        waited += 1000;
        if (newSession.pairingCode) {
          clearInterval(checkCode);
          await sock.sendMessage(groupId, {
            text: '╭━━━ *CODE D\'APPAIRAGE* ━━━\n┃\n' +
              '┃ 🔑 *Code:* ' + newSession.pairingCode + '\n' +
              '┃ 📱 *Numéro:* +' + pairNum + '\n┃\n' +
              '┃ 📌 *Instructions:*\n┃\n' +
              '┃ 1️⃣ Ouvre WhatsApp sur ton téléphone\n' +
              '┃ 2️⃣ ⚙️ Paramètres\n' +
              '┃ 3️⃣ Appareils connectés\n' +
              '┃ 4️⃣ Connecter un appareil\n' +
              '┃ 5️⃣ Entre le code ci-dessus\n┃\n' +
              '┃ ⏳ *Code valable ~60 secondes*\n┃\n' +
              '╰━━━━━━━━━━━━━━━' + channelFooter(),
            contextInfo: {
              externalAdReply: {
                title: '🎩 ' + config.botNameStyled + ' — Connexion',
                body: 'by ' + config.ownerStyled + ' | Session ' + newSession.id,
                mediaType: 1,
                renderLargerThumbnail: false,
              }
            }
          });
        } else if (newSession.isConnected) {
          clearInterval(checkCode);
          await sock.sendMessage(groupId, {
            text: '✅ *+' + pairNum + ' est connecté !*\n🎩 Session active — le bot répond sur ce numéro.' + channelFooter()
          });
        } else if (waited >= 15000 || newSession.status === 'error') {
          clearInterval(checkCode);
          await sock.sendMessage(groupId, {
            text: '❌ Impossible de générer un code pour *+' + pairNum + '*\n\nVérifie le numéro et réessaie.' + channelFooter()
          });
        }
      }, 1000);
      break;
    }

    default:
      return false;
  }
  return true;
}

// ─── Commandes MEMBRES ────────────────────────────────────────
async function handleMemberCommand(sock, msg, command, args, senderId, groupId) {
  var member = await memberManager.getMember(senderId);
  var memberName = member ? member.name : (msg.pushName || 'Membre');

  switch (command) {

    // ── Aide / Menu ──
    case '!menu':
    case '!aide':
    case '!help': {
      var uptime = formatUptime();
      var ram = getRam();
      var date = getDate();
      var menuText =
'╔═══════════════════╗\n' +
'   🎩 *' + config.botNameStyled.toUpperCase() + '*\n' +
'╚═══════════════════╝\n' +
'┌─❏ *SYSTEM*\n' +
'├ ◈ Version : ' + config.botVersion + '\n' +
'├ ◈ Préfixes : [ . ! ? / - _ ]\n' +
'├ ◈ Uptime  : ' + uptime + '\n' +
'├ ◈ RAM     : ' + ram + '\n' +
'├ ◈ Date    : ' + date + '\n' +
'└──────────────❏\n\n' +
'┌──❮ 🌐 *GÉNÉRAL* ❯\n' +
'├▸ .menu — Ce menu\n' +
'├▸ .alive — Statut du bot\n' +
'├▸ .ping — Latence\n' +
'├▸ .uptime — Temps actif\n' +
'├▸ .lien — Lien du groupe\n' +
'├▸ .pair [num] — Connecter un numéro\n' +
'├▸ .regles — Règles\n' +
'├▸ .apropos — À propos\n' +
'└────────────❍\n\n' +
'┌──❮ 👤 *PROFIL* ❯\n' +
'├▸ .profil — Ton profil\n' +
'├▸ .reset — Reset historique IA\n' +
'└────────────❍\n\n' +
'┌──❮ 🤖 *IA & CHAT* ❯\n' +
'├▸ .assist [question] — Assistant du bot\n' +
'├▸ .ai [question] — IA générale\n' +
'├▸ .ia [question] — IA généraliste\n' +
'├▸ 💬 Ou pose ta question directement !\n' +
'└────────────❍\n\n' +
'┌──❮ ⬇️ *DOWNLOADER* ❯\n' +
'├▸ .tiktok [lien] — Vidéo TikTok\n' +
'├▸ .yt [lien] — Vidéo YouTube\n' +
'├▸ .song [lien YouTube] — Musique\n' +
'├▸ .play [artiste] [titre] — Jouer un son\n' +
'│    Ex: .play TRK Menace un mur\n' +
'├▸ .instagram [lien] — ⚠️ bientôt\n' +
'├▸ .facebook [lien] — ⚠️ bientôt\n' +
'├▸ .snapchat [lien] — ⚠️ bientôt\n' +
'└────────────❍\n\n' +
'┌──❮ 👁️ *VUES UNIQUES* ❯\n' +
'├▸ .vv — Révéler un msg vue unique\n' +
'└────────────❍\n\n' +
'┌──❮ 👥 *GROUPE* ❯\n' +
'├▸ .groupinfo — Infos du groupe\n' +
'└────────────❍\n\n' +
'┌──❮ 👑 *ADMIN* ❯\n' +
'├▸ .on / .off — Activer/désactiver bot\n' +
'├▸ .ban / .unban — Bannir membre\n' +
'├▸ .kick — Expulser membre\n' +
'├▸ .promote / .demote — Admin\n' +
'├▸ .mute / .unmute — Silence groupe\n' +
'├▸ .tagall — Taguer tout le monde\n' +
'├▸ .hidetag — Tag silencieux\n' +
'├▸ .warn [@membre] — Avertir\n' +
'├▸ .warnlist — Liste des avertis\n' +
'├▸ .resetwarn [@membre] — Reset avertissements\n' +
'├▸ .welcome on/off — Bienvenue\n' +
'├▸ .goodbye on/off — Au revoir\n' +
'├▸ .antilink on/off — Anti-liens\n' +
'├▸ .antispam on/off — Anti-spam\n' +
'├▸ .protection on/off — 🛡️ Protection perso (owner)\n' +
'├▸ .annonce [msg] — Annonce\n' +
'├▸ .stats — Statistiques\n' +
'└────────────❍\n\n' +
'▰▰▰▰▰▰▰▰▰▰▰▰▰\n' +
'   *' + config.botNameStyled + '*\n' +
'   🎩 Powered by Baileys\n' +
'   👨‍💻 by ' + config.ownerStyled + '\n' +
'▰▰▰▰▰▰▰▰▰▰▰▰▰';
      await sock.sendMessage(groupId, {
        text: menuText,
        contextInfo: {
          externalAdReply: {
            title: '🚀 ' + config.botNameStyled + ' — Bot WhatsApp',
            body: 'by ' + config.ownerStyled + ' | Hacking Éthique',
            mediaType: 1,
            renderLargerThumbnail: false,
          }
        }
      });
      break;
    }

    // ── Alive ──
    case '!alive': {
      var pingStart = Date.now();
      var lat = Date.now() - pingStart;
      var aliveText =
'┏━━━━━━━━━━━━━━━━━━🎩\n' +
'┃❏ `' + config.botNameStyled.toUpperCase() + ' REPORT`\n' +
'┗━━━━━━━━━━━━━━━━━━🎩\n' +
'┏━━━━━━━━━━━━━━━━━━🎩\n' +
'┃❏ `𝗕𝗢𝗧 : ' + config.botNameStyled + '`\n' +
'┗━━━━━━━━━━━━━━━━━━🎩\n' +
'┏━━━━━━━━━━━━━━━━━━🎩\n' +
'┃❏ `𝗩𝗘𝗥𝗦𝗜𝗢𝗡 : ' + config.botVersion + '`\n' +
'┗━━━━━━━━━━━━━━━━━━🎩\n' +
'┏━━━━━━━━━━━━━━━━━━🎩\n' +
'┃❏ `𝗦𝗧𝗔𝗧𝗨𝗧 : 🟢 ONLINE`\n' +
'┗━━━━━━━━━━━━━━━━━━🎩\n' +
'┏━━━━━━━━━━━━━━━━━━🎩\n' +
'┃❏ `𝗨𝗣𝗧𝗜𝗠𝗘 : ' + formatUptime() + '`\n' +
'┗━━━━━━━━━━━━━━━━━━🎩\n' +
'┏━━━━━━━━━━━━━━━━━━🎩\n' +
'┃❏ `𝗖𝗥𝗘𝗔𝗧𝗘𝗨𝗥 : ' + config.ownerStyled + '`\n' +
'┗━━━━━━━━━━━━━━━━━━🎩\n' +
'┏━━━━━━━━━━━━━━━━━━🎩\n' +
'┃❏ `𝗣𝗥𝗘𝗙𝗜𝗫𝗘 : !`\n' +
'┗━━━━━━━━━━━━━━━━━━🎩\n' +
'┏━━━━━━━━━━━━━━━━━━🎩\n' +
'┃❏ `𝗥𝗔𝗠 : ' + getRam() + '`\n' +
'┗━━━━━━━━━━━━━━━━━━🎩';
      await sock.sendMessage(groupId, {
        text: aliveText,
        contextInfo: {
          externalAdReply: {
            title: '🚀 ' + config.botNameStyled + ' — ONLINE',
            body: 'by ' + config.ownerStyled + ' | Hacking Éthique',
            mediaType: 1,
            renderLargerThumbnail: true,
          }
        }
      });
      break;
    }

    // ── Ping ──
    case '!ping': {
      var pStart = Date.now();
      await sock.sendPresenceUpdate('composing', groupId);
      var pLat = Date.now() - pStart;
      var pEmoji = pLat < 300 ? '🟢' : pLat < 700 ? '🟡' : '🔴';
      var pQuality = pLat < 300 ? 'Excellent' : pLat < 700 ? 'Bon' : 'Lent';
      await sock.sendMessage(groupId, {
        text: '╔══════════════════╗\n║   *PONG !*  🏓\n╚══════════════════╝\n\n' +
          pEmoji + ' *Latence:* ' + pLat + 'ms\n' +
          '⚡ *Qualité:* ' + pQuality + '\n' +
          '📶 *Statut:* En ligne\n' +
          '⏱️ *Uptime:* ' + formatUptime() + '\n' + channelFooter()
      });
      break;
    }

    // ── Uptime ──
    case '!uptime': {
      var uStr = formatUptime();
      var uStart = new Date(startTime).toLocaleString('fr-FR');
      await sock.sendMessage(groupId, {
        text: '╭━━━ *UPTIME* ━━━\n┃\n┃ 🟢 *Actif depuis:*\n┃ ' + uStr + '\n┃\n┃ 📅 *Démarrage:*\n┃ ' + uStart + '\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter()
      });
      break;
    }

    // ── Lien ──
    case '!lien':
      await sock.sendMessage(groupId, {
        text: '🔗 *Lien du groupe*\n\n' + (config.groupLink || 'Non configuré') + '\n\nPartage avec tes amis ! 🎩' + channelFooter(),
      });
      break;

    // ── Règles ──
    case '!regles':
      await sock.sendMessage(groupId, {
        text: '╭━━━ *RÈGLES — ' + config.botNameStyled.toUpperCase() + '* ━━━\n┃\n┃ 1️⃣ Respect mutuel\n┃ 2️⃣ Pas de spam\n┃ 3️⃣ Pas de contenu illégal\n┃ 4️⃣ Reste courtois avec les autres membres\n┃ 5️⃣ Partage tes connaissances\n┃ 6️⃣ Admins = dernier mot\n┃\n┃ ⚠️ Violation = ban immédiat\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter(),
      });
      break;

    // ── Contact ──
    case '!contact':
      await sock.sendMessage(groupId, {
        text: '╭━━━ *CONTACT* ━━━\n┃\n┃ 👨‍💻 *Créateur:* ' + config.ownerStyled + '\n┃ 📱 *Numéro:* wa.me/' + config.ownerNumber + '\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter(),
      });
      break;

    // ── À propos ──
    case '!apropos':
      await sock.sendMessage(groupId, {
        text: '╭━━━ *À PROPOS* ━━━\n┃\n┃ 🚀 *' + config.botNameStyled + ' Assistant v' + config.botVersion + '*\n┃\n┃ 👨‍💻 *Créateur:* ' + config.ownerStyled + '\n┃ 📱 *Contact:* wa.me/' + config.ownerNumber + '\n┃ ⚡ *Délai IA:* ~2.9 secondes\n┃ 🤖 *Basé sur:* Baileys\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter(),
        contextInfo: {
          externalAdReply: {
            title: '🚀 ' + config.botNameStyled + ' Bot',
            body: 'Créé par ' + config.ownerStyled + ' | Hacking Éthique',
            mediaType: 1,
            renderLargerThumbnail: false,
          }
        }
      });
      break;

    // ── Profil ──
    case '!profil': {
      var histCount = ai.getHistoryCount(senderId);
      await sock.sendMessage(groupId, {
        text: '╭━━━ *TON PROFIL* ━━━\n┃\n┃ 📛 *Nom:* ' + memberName + '\n┃ 📨 *Messages:* ' + (member ? member.messageCount : 0) + '\n┃ 💬 *Messages IA:* ' + histCount + '\n┃ ⭐ *Statut:* ' + (member && member.isAdmin ? 'Admin' : 'Membre') + '\n┃ 📅 *Depuis:* ' + (member && member.joinedAt ? new Date(member.joinedAt).toLocaleDateString('fr-FR') : 'Inconnu') + '\n┃\n╰━━━━━━━━━━━━━━━' + channelFooter(),
      });
      break;
    }



    // ── .ai : IA générale (prête pour Claude AI) ──
    case '!ai': {
      var aiQuestion = args.join(' ');
      if (!aiQuestion) {
        await sock.sendMessage(groupId, { text: '💬 Utilise : .ai [ta question]' + channelFooter() });
        break;
      }
      await sock.sendPresenceUpdate('composing', groupId);
      var aiAnswer = await ai.askAI(senderId, aiQuestion, memberName);
      await sock.sendMessage(groupId, { text: '🧠 ' + aiAnswer + channelFooter() });
      break;
    }

    // ── .ia / .ia2 : 2e IA généraliste ──
    case '!ia':
    case '!ia2':
    case '!chat': {
      var iaQuestion = args.join(' ');
      if (!iaQuestion) {
        await sock.sendMessage(groupId, { text: '💬 Utilise : .ia [ta question, tout sujet]' + channelFooter() });
        break;
      }
      await sock.sendPresenceUpdate('composing', groupId);
      var iaAnswer = await ai.askGeneralAI(senderId, iaQuestion, memberName);
      await sock.sendMessage(groupId, { text: '🤖 ' + iaAnswer + channelFooter() });
      break;
    }

    // ── .assist : assistant du bot (identité, aide, discussion libre) ──
    case '!assist': {
      var assistQuestion = args.join(' ');
      if (!assistQuestion) {
        await sock.sendMessage(groupId, { text: '💬 Utilise : .assist [ta question] — ou parle-moi direct, sans commande !' + channelFooter() });
        break;
      }
      await sock.sendPresenceUpdate('composing', groupId);
      var assistAnswer = await ai.askAssist(senderId, assistQuestion, memberName);
      await sock.sendMessage(groupId, { text: '✨ ' + assistAnswer + channelFooter() });
      break;
    }

    // ── TikTok ──
    case '!tiktok':
    case '!tt': {
      var ttUrl = args[0];
      if (!ttUrl || !/tiktok\.com/i.test(ttUrl)) {
        await sock.sendMessage(groupId, { text: '📥 Utilise : .tiktok [lien TikTok]' + channelFooter() });
        break;
      }
      await sock.sendMessage(groupId, { text: '⏳ Téléchargement en cours...' });
      var ttResult = await downloader.downloadTikTok(ttUrl);
      if (!ttResult.success) {
        await sock.sendMessage(groupId, { text: '❌ ' + ttResult.error + channelFooter() });
        break;
      }
      await sock.sendMessage(groupId, {
        video: { url: ttResult.videoUrl },
        caption: '🎬 *' + (ttResult.title || 'Vidéo TikTok') + '*' + channelFooter(),
      });
      break;
    }

    // ── YouTube (vidéo) ──
    case '!yt':
    case '!youtube': {
      var ytUrl = args[0];
      if (!ytUrl || !downloader.isValidYoutubeUrl(ytUrl)) {
        await sock.sendMessage(groupId, { text: '📥 Utilise : .yt [lien YouTube]' + channelFooter() });
        break;
      }
      var ytInfo = await downloader.getYouTubeInfo(ytUrl);
      if (!ytInfo.success) {
        await sock.sendMessage(groupId, { text: '❌ ' + ytInfo.error + channelFooter() });
        break;
      }
      if (ytInfo.lengthSeconds > 600) {
        await sock.sendMessage(groupId, { text: '⚠️ Vidéo trop longue (max 10 minutes) pour un envoi WhatsApp.' + channelFooter() });
        break;
      }
      await sock.sendMessage(groupId, { text: '⏳ Téléchargement de "' + ytInfo.title + '"...' });
      try {
        var ytStream = downloader.getYouTubeStream(ytUrl, false);
        await sock.sendMessage(groupId, {
          video: { stream: ytStream },
          caption: '🎬 *' + ytInfo.title + '*' + channelFooter(),
          mimetype: 'video/mp4',
        });
      } catch (ytErr) {
        await sock.sendMessage(groupId, { text: '❌ Échec du téléchargement. Réessaie plus tard.' + channelFooter() });
      }
      break;
    }

    // ── Musique (via lien YouTube) ──
    case '!song':
    case '!musique': {
      var songUrl = args[0];
      if (!songUrl) {
        await sock.sendMessage(groupId, { text: '🎵 Utilise : .song [lien YouTube]' + channelFooter() });
        break;
      }
      var songInfo = await downloader.downloadSongInfo(songUrl);
      if (!songInfo.success) {
        await sock.sendMessage(groupId, { text: '❌ ' + songInfo.error + channelFooter() });
        break;
      }
      await sock.sendMessage(groupId, { text: '⏳ Téléchargement de "' + songInfo.title + '"...' });
      try {
        var songStream = downloader.getYouTubeStream(songUrl, true);
        await sock.sendMessage(groupId, {
          audio: { stream: songStream },
          mimetype: 'audio/mpeg',
        });
      } catch (songErr) {
        await sock.sendMessage(groupId, { text: '❌ Échec du téléchargement audio. Réessaie plus tard.' + channelFooter() });
      }
      break;
    }

    // ── Play (recherche par artiste / titre) ──
    case '!play': {
      var playQuery = args.join(' ');
      if (!playQuery) {
        await sock.sendMessage(groupId, { text: '🎵 Utilise : .play [artiste] [titre]\nExemple : .play TRK Menace un mur' + channelFooter() });
        break;
      }
      var playResult = await downloader.searchAndPlay(playQuery);
      if (!playResult.success) {
        await sock.sendMessage(groupId, { text: '❌ ' + playResult.error + channelFooter() });
        break;
      }
      await sock.sendMessage(groupId, {
        text: '⏳ *' + playResult.title + '*' + (playResult.author ? ' — ' + playResult.author : '') +
          (playResult.duration ? ' (' + playResult.duration + ')' : '') + '\nTéléchargement en cours...'
      });
      try {
        var playStream = downloader.getYouTubeStream(playResult.url, true);
        await sock.sendMessage(groupId, {
          audio: { stream: playStream },
          mimetype: 'audio/mpeg',
        });
      } catch (playErr) {
        await sock.sendMessage(groupId, { text: '❌ Échec du téléchargement audio. Réessaie plus tard.' + channelFooter() });
      }
      break;
    }

    // ── Instagram ──
    case '!instagram':
    case '!ig': {
      var igUrl = args[0];
      if (!igUrl || !/instagram\.com/i.test(igUrl)) {
        await sock.sendMessage(groupId, { text: '📥 Utilise : .instagram [lien Instagram]' + channelFooter() });
        break;
      }
      var igResult = await downloader.downloadInstagram(igUrl);
      await sock.sendMessage(groupId, { text: (igResult.success ? '✅' : '❌') + ' ' + (igResult.error || 'Terminé') + channelFooter() });
      break;
    }

    // ── Facebook ──
    case '!facebook':
    case '!fb': {
      var fbUrl = args[0];
      if (!fbUrl || !/facebook\.com|fb\.watch/i.test(fbUrl)) {
        await sock.sendMessage(groupId, { text: '📥 Utilise : .facebook [lien Facebook]' + channelFooter() });
        break;
      }
      var fbResult = await downloader.downloadFacebook(fbUrl);
      await sock.sendMessage(groupId, { text: (fbResult.success ? '✅' : '❌') + ' ' + (fbResult.error || 'Terminé') + channelFooter() });
      break;
    }

    // ── Snapchat ──
    case '!snapchat':
    case '!snap': {
      var snapUrl = args[0];
      if (!snapUrl || !/snapchat\.com/i.test(snapUrl)) {
        await sock.sendMessage(groupId, { text: '📥 Utilise : .snapchat [lien Snapchat]' + channelFooter() });
        break;
      }
      var snapResult = await downloader.downloadSnapchat(snapUrl);
      await sock.sendMessage(groupId, { text: (snapResult.success ? '✅' : '❌') + ' ' + (snapResult.error || 'Terminé') + channelFooter() });
      break;
    }

    // ── Reset IA ──
    case '!reset':
      ai.resetConversation(senderId);
      await sock.sendMessage(groupId, {
        text: '🔄 Historique réinitialisé ! Comment puis-je t\'aider ? 🚀' + channelFooter(),
      });
      break;

    // ── GroupInfo ──
    case '!groupinfo': {
      if (!groupId.endsWith('@g.us')) {
        await sock.sendMessage(groupId, { text: '❌ Cette commande fonctionne uniquement dans un groupe.' });
        break;
      }
      var gmeta = await sock.groupMetadata(groupId).catch(function() { return null; });
      if (!gmeta) { await sock.sendMessage(groupId, { text: '❌ Impossible de récupérer les infos du groupe.' }); break; }
      var gAdmins = gmeta.participants.filter(function(p) { return p.admin; }).length;
      var gMembers = gmeta.participants.length;
      var gOwner = gmeta.owner ? gmeta.owner.split('@')[0] : 'Inconnu';
      var gDesc = gmeta.desc || 'Aucune description.';
      var gInfoText =
        '╭━━━ *INFOS DU GROUPE* ━━━\n┃\n' +
        '┃ 📌 *Nom:* ' + gmeta.subject + '\n' +
        '┃ 👥 *Membres:* ' + gMembers + '\n' +
        '┃ ⭐ *Admins:* ' + gAdmins + '\n' +
        '┃ 👑 *Créateur:* @' + gOwner + '\n' +
        '┃ 📝 *Description:*\n┃ ' + gDesc.substring(0, 100) + (gDesc.length > 100 ? '...' : '') + '\n┃\n' +
        '╰━━━━━━━━━━━━━━━' + channelFooter();
      var gpPic = null;
      try { gpPic = await sock.profilePictureUrl(groupId, 'image'); } catch(e) {}
      if (gpPic) {
        await sock.sendMessage(groupId, { image: { url: gpPic }, caption: gInfoText, mentions: [gmeta.owner || ''] });
      } else {
        await sock.sendMessage(groupId, { text: gInfoText, mentions: [gmeta.owner || ''] });
      }
      break;
    }

    // ── VV (view once) ──
    case '!vv': {
      var quotedCtx = msg.message && msg.message.extendedTextMessage &&
        msg.message.extendedTextMessage.contextInfo;
      var quotedMsg = quotedCtx && quotedCtx.quotedMessage;
      if (!quotedMsg) {
        await sock.sendMessage(groupId, { text: '❌ Réponds à un message view once (image/vidéo) avec .vv' + channelFooter() });
        break;
      }
      var vvType = null;
      if (quotedMsg.imageMessage && quotedMsg.imageMessage.viewOnce) vvType = 'image';
      else if (quotedMsg.videoMessage && quotedMsg.videoMessage.viewOnce) vvType = 'video';
      else if (quotedMsg.viewOnceMessage) {
        var innerMsg = quotedMsg.viewOnceMessage.message;
        if (innerMsg.imageMessage) { vvType = 'image'; quotedMsg = innerMsg; }
        else if (innerMsg.videoMessage) { vvType = 'video'; quotedMsg = innerMsg; }
      } else if (quotedMsg.viewOnceMessageV2) {
        var innerMsg2 = quotedMsg.viewOnceMessageV2.message;
        if (innerMsg2.imageMessage) { vvType = 'image'; quotedMsg = innerMsg2; }
        else if (innerMsg2.videoMessage) { vvType = 'video'; quotedMsg = innerMsg2; }
      }
      if (!vvType) {
        await sock.sendMessage(groupId, { text: '❌ Ce message n\'est pas un view once valide.' + channelFooter() });
        break;
      }
      try {
        var { downloadMediaMessage } = require('baileys');
        // Reconstruit un objet "message" complet et valide autour du message cité,
        // requis par downloadMediaMessage pour retrouver les clés de déchiffrement média.
        var fakeMsgWrapper = {
          key: {
            remoteJid: groupId,
            id: quotedCtx.stanzaId,
            participant: quotedCtx.participant,
            fromMe: false,
          },
          message: quotedMsg,
        };
        var vvBuffer = await downloadMediaMessage(
          fakeMsgWrapper,
          'buffer', {},
          { logger: console, reuploadRequest: sock.updateMediaMessage }
        ).catch(function() { return null; });
        if (vvBuffer) {
          if (vvType === 'image') await sock.sendMessage(groupId, { image: vvBuffer, caption: '🔓 View once déverrouillé' + channelFooter() });
          else await sock.sendMessage(groupId, { video: vvBuffer, caption: '🔓 View once déverrouillé' + channelFooter() });
        } else {
          await sock.sendMessage(groupId, { text: '⚠️ Impossible de télécharger ce view once (média peut-être expiré).' + channelFooter() });
        }
      } catch(e) {
        await sock.sendMessage(groupId, { text: '⚠️ Erreur lors du déverrouillage du view once.' + channelFooter() });
      }
      break;
    }


    default:
      return false;
  }
  return true;
}

// ─── Handler Welcome/Goodbye ──────────────────────────────────
async function handleGroupParticipantUpdate(sock, update) {
  var groupId = update.id;
  var participants = update.participants;
  var action = update.action;

  if (action === 'add' && groupSettings.get(groupId, 'welcome', false)) {
    for (var i = 0; i < participants.length; i++) {
      var newMember = participants[i];
      var gmeta = await sock.groupMetadata(groupId).catch(function() { return null; });
      var count = gmeta ? gmeta.participants.length : '?';
      var groupName = gmeta ? gmeta.subject : 'ce groupe';
      var gpPic = null;
      try { gpPic = await sock.profilePictureUrl(groupId, 'image'); } catch(e) {}
      var welcomeCaption =
        '╭━━━ *BIENVENUE* ━━━\n┃\n' +
        '┃ 👋 *Bienvenue @' + newMember.split('@')[0] + ' !*\n┃\n' +
        '┃ 📌 *Groupe:* ' + groupName + '\n' +
        '┃ 👥 *Membres:* ' + count + '\n┃\n' +
        '┃ 📖 Tape *!menu* pour voir les commandes\n' +
        '┃ 🤖 Pose tes questions en hacking éthique !\n┃\n' +
        '╰━━━━━━━━━━━━━━━' + channelFooter();
      if (gpPic) {
        await sock.sendMessage(groupId, { image: { url: gpPic }, caption: welcomeCaption, mentions: [newMember] });
      } else {
        await sock.sendMessage(groupId, { text: welcomeCaption, mentions: [newMember] });
      }
    }
  }

  if (action === 'remove' && groupSettings.get(groupId, 'goodbye', false)) {
    for (var j = 0; j < participants.length; j++) {
      var leftMember = participants[j];
      var gm2 = await sock.groupMetadata(groupId).catch(function() { return null; });
      var remaining = gm2 ? gm2.participants.length : '?';
      var groupName2 = gm2 ? gm2.subject : 'le groupe';
      var gpPic2 = null;
      try { gpPic2 = await sock.profilePictureUrl(groupId, 'image'); } catch(e) {}
      var goodbyeCaption =
        '╭━━━ *AU REVOIR* ━━━\n┃\n' +
        '┃ 👋 *@' + leftMember.split('@')[0] + ' a quitté le groupe.*\n┃\n' +
        '┃ 📌 *Groupe:* ' + groupName2 + '\n' +
        '┃ 👥 *Membres restants:* ' + remaining + '\n┃\n' +
        '╰━━━━━━━━━━━━━━━' + channelFooter();
      if (gpPic2) {
        await sock.sendMessage(groupId, { image: { url: gpPic2 }, caption: goodbyeCaption, mentions: [leftMember] });
      } else {
        await sock.sendMessage(groupId, { text: goodbyeCaption, mentions: [leftMember] });
      }
    }
  }
}

// ─── Check antilink ───────────────────────────────────────────
async function checkAntiLink(sock, msg, groupId, senderId, isAdmin) {
  if (isAdmin) return false;
  if (!groupSettings.get(groupId, 'antilink', false)) return false;
  var text = msg.message && (
    (msg.message.conversation) ||
    (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || ''
  );
  if (!text) return false;
  var linkRegex = /(https?:\/\/|www\.|chat\.whatsapp\.com)[^\s]*/i;
  if (!linkRegex.test(text)) return false;
  await sock.sendMessage(groupId, {
    text: '🔗 ⚠️ @' + senderId.split('@')[0] + ' Les liens sont interdits dans ce groupe !',
    mentions: [senderId]
  });
  try { await sock.groupParticipantsUpdate(groupId, [senderId], 'remove'); } catch(e) {}
  return true;
}

module.exports = {
  handleAdminCommand,
  handleMemberCommand,
  handleGroupParticipantUpdate,
  checkAntiLink,
  isBotActive,
  setBotActive,
};
