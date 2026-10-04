const fs = require('node:fs');
const { spawnSync, execFileSync } = require('node:child_process');
const cfg = require('../deployment.json');
const cli = 'node_modules/@aws-amplify/cli-internal/bin/amplify';
const envName = cfg.envName;
function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: { ...process.env, AMPLIFY_CLI_DISABLE_USAGE_DATA: 'true' } });
  if (r.status) throw new Error('Amplify CLI failed: ' + args[0]);
}
// Validation creates ignored offline metadata. Replace it with this real environment.
const team = JSON.parse(fs.readFileSync('amplify/team-provider-info.json', 'utf8'));
if (team[envName]?.awscloudformation?.AmplifyAppId !== cfg.appId) throw new Error('Deployment app/environment mismatch');
fs.writeFileSync('amplify/.config/local-env-info.json', JSON.stringify({ projectPath: process.cwd(), envName, defaultEditor: 'vscode' }));
fs.writeFileSync('amplify/backend/amplify-meta.json', JSON.stringify({ ...require('../amplify/backend/backend-config.json'), providers: { awscloudformation: team[envName].awscloudformation } }));
const ccb = 'amplify/#current-cloud-backend';
if (fs.existsSync(ccb)) fs.renameSync(ccb, ccb + '-validation-' + Date.now());
run(['init', '--amplify', JSON.stringify({ appId: cfg.appId, envName, defaultEditor: 'vscode' }), '--providers', JSON.stringify({ awscloudformation: { configLevel: 'general' } }), '--yes']);
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
