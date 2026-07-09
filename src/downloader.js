var axios = require('axios');
var ytdl = require('@distube/ytdl-core');
var ytSearch = require('yt-search');

var TIMEOUT = 20000;

// ══════════════════════════════════════════
// TIKTOK — via tikwm.com (API publique, sans clé, stable)
// ══════════════════════════════════════════
async function downloadTikTok(url) {
  try {
    var res = await axios.post(
      'https://www.tikwm.com/api/',
      'url=' + encodeURIComponent(url) + '&hd=1',
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: TIMEOUT,
      }
    );
    var data = res.data && res.data.data;
    if (!data) return { success: false, error: 'Vidéo TikTok introuvable ou lien invalide.' };
    return {
      success: true,
      videoUrl: data.hdplay || data.play,
      audioUrl: data.music,
      title: data.title || '',
    };
  } catch (e) {
    return { success: false, error: 'Service TikTok indisponible pour le moment. Réessaie plus tard.' };
  }
}

// ══════════════════════════════════════════
// YOUTUBE — via @distube/ytdl-core (librairie directe, pas d'API tierce)
// ══════════════════════════════════════════
function isValidYoutubeUrl(url) {
  try { return ytdl.validateURL(url); } catch (e) { return false; }
}

async function getYouTubeInfo(url) {
  try {
    if (!isValidYoutubeUrl(url)) {
      return { success: false, error: 'Lien YouTube invalide.' };
    }
    var info = await ytdl.getInfo(url);
    return {
      success: true,
      title: info.videoDetails.title,
      lengthSeconds: parseInt(info.videoDetails.lengthSeconds, 10) || 0,
      thumbnail: (info.videoDetails.thumbnails && info.videoDetails.thumbnails.length) ?
        info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url : null,
    };
  } catch (e) {
    return { success: false, error: 'Impossible de récupérer les infos de la vidéo. Elle est peut-être privée ou restreinte.' };
  }
}

// Retourne un flux (stream) prêt à envoyer — audioOnly=true pour la musique
function getYouTubeStream(url, audioOnly) {
  var options = audioOnly
    ? { quality: 'highestaudio', filter: 'audioonly' }
    : { quality: 'highest', filter: function (f) { return f.hasVideo && f.hasAudio; } };
  return ytdl(url, options);
}

// ══════════════════════════════════════════
// INSTAGRAM / FACEBOOK / SNAPCHAT
// Pas d'API publique confirmée fiable sans clé au moment du développement.
// Structure prête : chaque fonction retourne un échec explicite plutôt que
// de prétendre fonctionner avec une URL non vérifiée. À brancher sur une
// API testée (RapidAPI, ou une instance Cobalt personnelle) quand disponible.
// ══════════════════════════════════════════
async function downloadInstagram(url) {
  return {
    success: false,
    error: 'Le téléchargement Instagram n\'est pas encore activé — API en cours de validation. Réessaie bientôt.',
  };
}

async function downloadFacebook(url) {
  return {
    success: false,
    error: 'Le téléchargement Facebook n\'est pas encore activé — API en cours de validation. Réessaie bientôt.',
  };
}

async function downloadSnapchat(url) {
  return {
    success: false,
    error: 'Le téléchargement Snapchat n\'est pas encore activé — API en cours de validation. Réessaie bientôt.',
  };
}

// ══════════════════════════════════════════
// MUSIQUE — via YouTube (lien direct uniquement pour l'instant)
// ══════════════════════════════════════════
async function downloadSongInfo(query) {
  if (!/^https?:\/\//i.test(query) || !isValidYoutubeUrl(query)) {
    return { success: false, error: 'Merci de fournir un lien YouTube valide (recherche par nom bientôt disponible).' };
  }
  return await getYouTubeInfo(query);
}

// ══════════════════════════════════════════
// PLAY — recherche par mots-clés (artiste + titre) via yt-search, puis stream audio
// ══════════════════════════════════════════
async function searchAndPlay(query) {
  try {
    if (!query || !query.trim()) {
      return { success: false, error: 'Merci de préciser un artiste et/ou un titre.' };
    }
    var result = await ytSearch(query);
    var video = result && result.videos && result.videos.length ? result.videos[0] : null;
    if (!video) {
      return { success: false, error: 'Aucun résultat trouvé pour "' + query + '".' };
    }
    return {
      success: true,
      url: video.url,
      title: video.title,
      author: video.author ? video.author.name : '',
      duration: video.timestamp || '',
      thumbnail: video.thumbnail,
    };
  } catch (e) {
    return { success: false, error: 'Recherche indisponible pour le moment. Réessaie plus tard.' };
  }
}

module.exports = {
  downloadTikTok,
  isValidYoutubeUrl,
  getYouTubeInfo,
  getYouTubeStream,
  downloadInstagram,
  downloadFacebook,
  downloadSnapchat,
  downloadSongInfo,
  searchAndPlay,
};
