const fs = require('node:fs');
const path = require('node:path');
// Hosting is provisioned before backend deployment, so its final origin is known.
const file=path.join(__dirname,'hosting.json');
const hosting=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
module.exports = { allowedOrigins: [...new Set(['http://localhost:3000',...(hosting?[hosting.url]:[])])] };
