require('dotenv').config();
const { startBot } = require('./src/bot');
const config = require('./src/config');

console.log(`
╔══════════════════════════════════════╗
║   🎩  ${config.botName} WhatsApp Bot         ║
║   👨‍💻  by ${config.owner}                     ║
║   🔐  Hacking Ethique Assistant      ║
╚══════════════════════════════════════╝
`);

startBot().catch(function(err) {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
