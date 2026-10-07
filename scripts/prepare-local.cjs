// Recreate ignored local metadata for offline compilation; never claim this is deployed.
const fs = require('node:fs');
const config = require('../amplify/backend/backend-config.json');
fs.mkdirSync('amplify/.config', { recursive: true });
if (!fs.existsSync('amplify/.config/local-env-info.json')) fs.writeFileSync('amplify/.config/local-env-info.json', JSON.stringify({ projectPath: process.cwd(), envName: 'local' }, null, 2));
if (!fs.existsSync('amplify/backend/amplify-meta.json')) fs.writeFileSync('amplify/backend/amplify-meta.json', JSON.stringify({ ...config, providers: { awscloudformation: { Region: 'us-east-1' } } }, null, 2));
// ponytail: explicit file lists keep each Gen 1 package self-contained without bundling other handlers.
for (const [name, modules] of Object.entries({
  ticketRest: ['rest', 'domain', 'database'],
  ticketAuthorizer: ['authorizer', 'domain'],
  ticketWorkflow: ['workflow', 'domain', 'database'],
  ticketSocketHandler: ['websocket', 'domain', 'database', 'notifications']
})) {
  const dir = `amplify/backend/function/${name}/src`;
  const files = modules.map(module => `${module}.cjs`);
  for (const file of fs.readdirSync(dir)) if (file.endsWith('.cjs') && !files.includes(file)) fs.rmSync(`${dir}/${file}`);
  for (const file of files) fs.copyFileSync(`src/${file}`, `${dir}/${file}`);
  fs.writeFileSync(`${dir}/index.js`, `exports.handler = require('./${modules[0]}.cjs').handler;\n`);
}

// Category-add normally records this metadata. Reconstruct it from the checked-in CLI inputs.
const metaPath = 'amplify/backend/amplify-meta.json';
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const service = require('../amplify/backend/api/supportGraphql/cli-inputs.json').serviceConfiguration;
const { appSyncAuthTypeToAuthConfig } = require('@aws-amplify/amplify-category-api/lib/provider-utils/awscloudformation/utils/auth-config-to-app-sync-auth-type-bi-di-mapper');
meta.api.supportGraphql.output ||= {};
meta.api.supportGraphql.output.authConfig = {
  defaultAuthentication: appSyncAuthTypeToAuthConfig(service.defaultAuthType),
  additionalAuthenticationProviders: service.additionalAuthTypes.map(appSyncAuthTypeToAuthConfig)
};
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

// Keep CORS origins in sync with the independently hosted frontend.
const restTemplatePath='amplify/backend/function/ticketRest/ticketRest-cloudformation-template.json';
const restTemplate=JSON.parse(fs.readFileSync(restTemplatePath));
restTemplate.Resources.LambdaFunction.Properties.Environment.Variables.ALLOWED_ORIGINS=JSON.stringify(require('../frontend/origins.cjs').allowedOrigins);
fs.writeFileSync(restTemplatePath,JSON.stringify(restTemplate,null,2)+'\n');
