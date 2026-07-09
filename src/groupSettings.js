var fs = require('fs');
var path = require('path');

var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
var SETTINGS_FILE = path.join(DATA_DIR, 'group_settings.json');

function load() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch (e) { return {}; }
}

function save(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function get(groupId, key, defaultVal) {
  var data = load();
  if (!data[groupId]) return defaultVal;
  var val = data[groupId][key];
  return val !== undefined ? val : defaultVal;
}

function set(groupId, key, value) {
  var data = load();
  if (!data[groupId]) data[groupId] = {};
  data[groupId][key] = value;
  save(data);
}

module.exports = { get, set };
