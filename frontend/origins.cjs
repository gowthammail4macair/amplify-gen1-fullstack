// Static JSON is bundled with the backend by ampx, preserving the hosted origin.
// Hosting is prepared before backend deployment and updates this public configuration.
const hosting = require('./hosting.json');
module.exports = { allowedOrigins: [...new Set(['http://localhost:3000', hosting.url])] };
