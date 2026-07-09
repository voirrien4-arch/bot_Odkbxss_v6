require('dotenv').config();

var groupSettings = {};

function getGroupSetting(groupId, key, defaultValue) {
  if (!groupSettings[groupId]) groupSettings[groupId] = {};
  var val = groupSettings[groupId][key];
  return val !== undefined ? val : defaultValue;
}

function setGroupSetting(groupId, key, value) {
  if (!groupSettings[groupId]) groupSettings[groupId] = {};
  groupSettings[groupId][key] = value;
}

// Police stylée (unicode gras) utilisée à chaque affichage du nom du bot ou du créateur
function toStyledBold(str) {
  var normalMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var boldMap = '𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵';
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var idx = normalMap.indexOf(str[i]);
    out += idx !== -1 ? boldMap[idx] : str[i];
  }
  return out;
}

var BOT_NAME = 'Odkbxss';
var OWNER_NAME = 'Kenzy';
var OWNER_NUMBER = '22662408620';

// Citations "dark" affichées après chaque réponse à une commande
var DARK_QUOTES = [
  '"La solitude est le prix de la lucidité."',
  '"On ne pardonne jamais vraiment, on oublie juste de compter les blessures."',
  '"Le silence en dit souvent plus long que les cris."',
  '"Tout le monde veut la vérité, jusqu\'à ce qu\'elle les concerne."',
  '"Le temps ne guérit rien, il apprend juste à vivre avec."',
  '"Certains sourires cachent des guerres qu\'on ne voit pas."',
  '"On meurt un peu chaque fois qu\'on se tait pour ne pas déranger."',
  '"La confiance, c\'est comme le verre : une fois brisée, on la voit toujours fêlée."',
  '"Les ombres ne mentent pas, elles montrent juste ce qu\'on refuse de voir."',
  '"Personne ne pleure vraiment ta chute, ils regardent juste le spectacle."',
  '"Le vide laissé par certains ne se remplit jamais, il s\'apprivoise."',
  '"On avance seul, même entouré."',
];

function getRandomDarkQuote() {
  return DARK_QUOTES[Math.floor(Math.random() * DARK_QUOTES.length)];
}

module.exports = {
  apiUrl: process.env.API_URL || 'https://bj-tricks-ai.vercel.app/chat',
  botName: BOT_NAME,
  botNameStyled: toStyledBold(BOT_NAME),
  botVersion: '3.0.0',
  botPrefix: '!',
  groupLink: process.env.GROUP_LINK || '',
  owner: OWNER_NAME,
  ownerStyled: toStyledBold(OWNER_NAME),
  ownerNumber: OWNER_NUMBER,
  toStyledBold: toStyledBold,
  aiDelay: parseInt(process.env.AI_RESPONSE_DELAY) || 2900,
  spamLimit: parseInt(process.env.SPAM_LIMIT) || 5,
  spamWindow: parseInt(process.env.SPAM_WINDOW) || 10000,
  getRandomDarkQuote,
  // ── .assist : assistant généraliste, identité du bot ──
  assistPrompt: `Tu es ${BOT_NAME}, un assistant WhatsApp intelligent cree par ${OWNER_NAME}.
Tu reponds a toutes les questions : culture generale, conseils, discussion, aide diverse, questions sur toi-meme.
Tu es sympathique, direct, concis, et tu parles francais par defaut (sauf si on te parle dans une autre langue).
Si on te demande qui t'a cree ou developpe, reponds : ${OWNER_NAME} (contact: wa.me/${OWNER_NUMBER}).
Ne mentionne jamais d'autre IA ni de societe tierce comme createur.`,
  // ── .ai : IA generaliste (branchee sur Claude AI plus tard) ──
  systemPrompt: `Tu es ${BOT_NAME} AI, assistant intelligent cree par ${OWNER_NAME}.
Tu reponds a toutes les questions de maniere claire, pedagogique et precise.
Reponds en francais par defaut. Si on te demande ton createur, reponds : ${OWNER_NAME}.`,
  getGroupSetting,
  setGroupSetting,
};
