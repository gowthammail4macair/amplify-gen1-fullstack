// Recreate ignored local metadata for offline compilation; never claim this is deployed.
const fs = require('node:fs');
const config = require('../amplify/backend/backend-config.json');
fs.mkdirSync('amplify/.config', { recursive: true });
if (!fs.existsSync('amplify/.config/local-env-info.json')) fs.writeFileSync('amplify/.config/local-env-info.json', JSON.stringify({ projectPath: process.cwd(), envName: 'local' }, null, 2));
if (!fs.existsSync('amplify/backend/amplify-meta.json')) fs.writeFileSync('amplify/backend/amplify-meta.json', JSON.stringify({ ...config, providers: { awscloudformation: { Region: 'us-east-1' } } }, null, 2));
for (const [name, module] of Object.entries({ ticketRest: 'rest', ticketAuthorizer: 'authorizer', ticketWorkflow: 'workflow', ticketSocketHandler: 'websocket' })) {
  const dir = `amplify/backend/function/${name}/src`;
  for (const f of fs.readdirSync('src').filter(f => f.endsWith('.cjs'))) fs.copyFileSync(`src/${f}`, `${dir}/${f}`);
  fs.writeFileSync(`${dir}/index.js`, `exports.handler = require('./${module}.cjs').handler;\n`);
}
