const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const cfg = require('../deployment.json');
const cli = 'node_modules/@aws-amplify/cli-internal/bin/amplify';
const envName = cfg.envName;
// CLI 14.5.1's Auth post-push hook cannot load configLevel=general.
// Use the job's temporary OIDC session in a separate, short-lived SDK v2 profile.
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.AWS_SESSION_TOKEN) throw new Error('Temporary AWS session credentials are required');
const credentialDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amplify-ci-'));
const credentialFile = path.join(credentialDir, 'credentials');
const configFile = path.join(credentialDir, 'config');
fs.writeFileSync(credentialFile, `[amplify-ci]\naws_access_key_id=${process.env.AWS_ACCESS_KEY_ID}\naws_secret_access_key=${process.env.AWS_SECRET_ACCESS_KEY}\naws_session_token=${process.env.AWS_SESSION_TOKEN}\n`, { mode: 0o600 });
fs.writeFileSync(configFile, `[profile amplify-ci]\nregion=${cfg.region}\n`, { mode: 0o600 });
Object.assign(process.env, { AWS_SHARED_CREDENTIALS_FILE: credentialFile, AWS_CONFIG_FILE: configFile, AWS_PROFILE: 'amplify-ci', AWS_SDK_LOAD_CONFIG: 'true' });
function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: { ...process.env, AMPLIFY_CLI_DISABLE_USAGE_DATA: 'true' } });
  if (r.status) throw new Error('Amplify CLI failed: ' + args[0]);
}
try {
// Validation creates ignored offline metadata. Replace it with this real environment.
const team = JSON.parse(fs.readFileSync('amplify/team-provider-info.json', 'utf8'));
if (team[envName]?.awscloudformation?.AmplifyAppId !== cfg.appId) throw new Error('Deployment app/environment mismatch');
fs.writeFileSync('amplify/.config/local-env-info.json', JSON.stringify({ projectPath: process.cwd(), envName, defaultEditor: 'vscode' }));
fs.writeFileSync('amplify/backend/amplify-meta.json', JSON.stringify({ ...require('../amplify/backend/backend-config.json'), providers: { awscloudformation: team[envName].awscloudformation } }));
const ccb = 'amplify/#current-cloud-backend';
if (fs.existsSync(ccb)) fs.renameSync(ccb, ccb + '-validation-' + Date.now());
fs.writeFileSync('amplify/.config/local-aws-info.json', JSON.stringify({ [envName]: { configLevel: 'project', useProfile: true, profileName: 'amplify-ci' } }));
run(['init', '--amplify', JSON.stringify({ appId: cfg.appId, envName, defaultEditor: 'vscode' }), '--providers', JSON.stringify({ awscloudformation: { configLevel: 'project', useProfile: true, profileName: 'amplify-ci' } }), '--yes']);
require('./prepare-local.cjs');
run(['push', '--yes']);
const meta = JSON.parse(fs.readFileSync('amplify/backend/amplify-meta.json', 'utf8'));
const aws = args => JSON.parse(execFileSync('aws', [...args, '--region', cfg.region, '--output', 'json'], { encoding: 'utf8' }));
const provider = meta.providers.awscloudformation;
const root = aws(['cloudformation', 'list-stack-resources', '--stack-name', provider.StackName]);
const nested = root.StackResourceSummaries.find(r => r.LogicalResourceId === 'customticketSocket');
if (!nested) throw new Error('Missing custom WebSocket stack');
const socket = aws(['cloudformation', 'describe-stacks', '--stack-name', nested.PhysicalResourceId]).Stacks[0];
const socketOut = Object.fromEntries(socket.Outputs.map(o => [o.OutputKey, o.OutputValue]));
const auth = meta.auth.ticketAuth.output, graphql = meta.api.supportGraphql.output, rest = meta.api.supportRest.output;
const output = { version: '1.4', auth: { aws_region: cfg.region, user_pool_id: auth.UserPoolId, user_pool_client_id: auth.AppClientIDWeb },
 data: { url: graphql.GraphQLAPIEndpointOutput, aws_region: cfg.region }, custom: { rest: { endpoint: rest.RootUrl, region: cfg.region }, websocket: { endpoint: socketOut.WebSocketUrl },
 ticketTableName: 'Ticket-' + graphql.GraphQLAPIIdOutput + '-' + envName, connectionsTableName: 'Connections-' + auth.UserPoolId } };
fs.writeFileSync('amplify_outputs.json', JSON.stringify(output, null, 2) + '\n');
console.log('Exported deployed endpoints to amplify_outputs.json');
} finally {
  fs.unlinkSync(credentialFile);
  fs.unlinkSync(configFile);
  fs.rmdirSync(credentialDir);
}
