var axios = require('axios');
var FormData = require('form-data');
var config = require('./config');

var conversationHistory = new Map();
var generalHistory = new Map();
var assistHistory = new Map();

// ── .ai : IA generaliste (branchee sur bj-tricks-ai, prete pour Claude AI des que la cle ANTHROPIC_API_KEY est fournie) ──
async function askAI(userId, message, memberName) {
  memberName = memberName || 'Membre';

  // Si une cle Anthropic est configuree, on pourra basculer ici vers l'API Claude.
  // En attendant, .ai utilise la meme API que .assist / .ia2.
  try {
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, []);
    }
    var history = conversationHistory.get(userId);

    var fullMessage = config.systemPrompt + '\n\nMembre: ' + memberName +
      '\nHistorique: ' + history.slice(-4).map(function(h) {
        return h.role + ': ' + h.content;
      }).join(' | ') +
      '\nQuestion: ' + message;

    history.push({ role: 'user', content: message });
    if (history.length > 20) history.splice(0, history.length - 20);

    var fd = new FormData();
    fd.append('text', fullMessage);

    var response = await axios.post(config.apiUrl, fd, {
      headers: fd.getHeaders(),
      timeout: 15000,
    });

    var aiReply =
      response.data && response.data.result ? response.data.result :
      response.data && response.data.reply ? response.data.reply :
      response.data && response.data.message ? response.data.message :
      'Reponds bientot. Reessaie.';

    history.push({ role: 'assistant', content: aiReply });
    return aiReply;

  } catch (error) {
    console.error('[AI Error]', error.message);
    if (error.code === 'ECONNABORTED') return 'Timeout — reessaie.';
    if (error.response && error.response.status === 429) return 'Trop de requetes — attends.';
    return 'Probleme technique — reessaie bientot. 🚀';
  }
}

// ── .assist (ou chat direct sans commande) : identite du bot, aide, discussion libre ──
async function askAssist(userId, message, memberName) {
  memberName = memberName || 'Membre';
  try {
    if (!assistHistory.has(userId)) {
      assistHistory.set(userId, []);
    }
    var aHistory = assistHistory.get(userId);

    var fullMessage = config.assistPrompt + '\n\nMembre: ' + memberName +
      '\nHistorique: ' + aHistory.slice(-4).map(function(h) {
        return h.role + ': ' + h.content;
      }).join(' | ') +
      '\nQuestion: ' + message;

    aHistory.push({ role: 'user', content: message });
    if (aHistory.length > 20) aHistory.splice(0, aHistory.length - 20);

    var fdA = new FormData();
    fdA.append('text', fullMessage);

    var responseA = await axios.post(config.apiUrl, fdA, {
      headers: fdA.getHeaders(),
      timeout: 15000,
    });

    var replyA =
      responseA.data && responseA.data.result ? responseA.data.result :
      responseA.data && responseA.data.reply ? responseA.data.reply :
      responseA.data && responseA.data.message ? responseA.data.message :
      'Reponds bientot. Reessaie.';

    aHistory.push({ role: 'assistant', content: replyA });
    return replyA;

  } catch (error) {
    console.error('[Assist Error]', error.message);
    if (error.code === 'ECONNABORTED') return 'Timeout — reessaie.';
    if (error.response && error.response.status === 429) return 'Trop de requetes — attends.';
    return 'Probleme technique — reessaie bientot. 🚀';
  }
}

// ── 2e IA : chat général (pas limité au hacking) ──
async function askGeneralAI(userId, message, memberName) {
  memberName = memberName || 'Membre';
  try {
    if (!generalHistory.has(userId)) {
      generalHistory.set(userId, []);
    }
    var gHistory = generalHistory.get(userId);

    var generalPrompt = 'Tu es ' + config.botName + ', un assistant IA generaliste cree par ' + config.owner + '. ' +
      'Tu reponds a toutes les questions (culture generale, conseils, discussion, aide diverse) de maniere claire, ' +
      'sympathique et concise. Tu reponds en francais par defaut, sauf si on te parle dans une autre langue. ' +
      'Si on te demande ton createur, reponds : ' + config.owner + '.';

    var fullMessage = generalPrompt + '\n\nMembre: ' + memberName +
      '\nHistorique: ' + gHistory.slice(-4).map(function(h) {
        return h.role + ': ' + h.content;
      }).join(' | ') +
      '\nQuestion: ' + message;

    gHistory.push({ role: 'user', content: message });
    if (gHistory.length > 20) gHistory.splice(0, gHistory.length - 20);

    var fd2 = new FormData();
    fd2.append('text', fullMessage);

    var response2 = await axios.post(config.apiUrl, fd2, {
      headers: fd2.getHeaders(),
      timeout: 15000,
    });

    var reply2 =
      response2.data && response2.data.result ? response2.data.result :
      response2.data && response2.data.reply ? response2.data.reply :
      response2.data && response2.data.message ? response2.data.message :
      'Reponds bientot. Reessaie.';

    gHistory.push({ role: 'assistant', content: reply2 });
    return reply2;

  } catch (error) {
    console.error('[General AI Error]', error.message);
    if (error.code === 'ECONNABORTED') return 'Timeout — reessaie.';
    if (error.response && error.response.status === 429) return 'Trop de requetes — attends.';
    return 'Probleme technique — reessaie bientot. 🚀';
  }
}

function resetConversation(userId) {
  conversationHistory.delete(userId);
  generalHistory.delete(userId);
  assistHistory.delete(userId);
}

function getHistoryCount(userId) {
  var h = conversationHistory.get(userId);
  var hA = assistHistory.get(userId);
  return (h ? h.length : 0) + (hA ? hA.length : 0);
}

module.exports = { askAI, askGeneralAI, askAssist, resetConversation, getHistoryCount };
