import { App } from 'aws-cdk-lib';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { override } from '../amplify/backend/api/supportRest/override';
import { cdkStack } from '../amplify/backend/custom/ticketSocket/cdk-stack';
const require = createRequire(__filename);
const { FeatureFlags } = require('@aws-amplify/amplify-cli-core');
const { AmplifyAuthTransform } = require('@aws-amplify/amplify-category-auth/lib/provider-utils/awscloudformation/auth-stack-builder/auth-stack-transform');
const { ApigwStackTransform } = require('@aws-amplify/amplify-category-api/lib/provider-utils/awscloudformation/cdk-stack-builder');
async function main() {
  await FeatureFlags.initialize({ getCurrentEnvName: () => 'local' });
  const ctx = { amplify: { loadEnvResourceParameters: () => ({}) }, print: console };
  const auth = await new AmplifyAuthTransform('ticketAuth').transform(ctx);
  // Check synthesized references, including conditional branches CloudFormation validates.
  const authDeclarations = new Set([...Object.keys(auth.Parameters || {}), ...Object.keys(auth.Resources || {})]);
  const checkAuthRefs = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (value.Ref && !value.Ref.startsWith('AWS::')) assert.ok(authDeclarations.has(value.Ref), `Unresolved Auth reference: ${value.Ref}`);
    for (const child of Object.values(value)) checkAuthRefs(child);
  };
  checkAuthRefs(auth.Resources);
  assert.ok(!JSON.stringify(auth.Resources).includes('undefined'), 'Auth resource names must have complete CLI inputs');
  const rest = new ApigwStackTransform(ctx, 'supportRest', { resourceName: 'supportRest', getCliInputPayload: () => JSON.parse(readFileSync('amplify/backend/api/supportRest/cli-inputs.json', 'utf8')), isCLIInputsValid: async () => {} });
  rest.generateStack(undefined);
  override(rest.resourceTemplateObj);
  rest.generateCfnInputParameters();
  await rest.saveBuildFiles();
  const restTemplate = rest.cfn;
  const app = new App({ outdir: 'dist/socket-cdk' });
  const socket = new cdkStack(app, 'SocketValidation', {}, { category: 'custom', resourceName: 'ticketSocket' });
  const socketTemplate = app.synth().getStackArtifact(socket.artifactId).template;
  mkdirSync('amplify/backend/custom/ticketSocket/build', { recursive: true });
  writeFileSync('amplify/backend/custom/ticketSocket/build/ticketSocket-cloudformation-template.json', JSON.stringify(socketTemplate, null, 2));
  // The CLI compiler reads a current-cloud snapshot even before first deployment.
  // Only create an offline metadata fixture if no real cloud snapshot exists.
  mkdirSync('amplify/#current-cloud-backend', { recursive: true });
  for (const file of ['amplify-meta.json', 'backend-config.json']) {
    const target = `amplify/#current-cloud-backend/${file}`;
    if (!existsSync(target)) writeFileSync(target, readFileSync(`amplify/backend/${file}`));
  }
  const compile = spawnSync(process.execPath, ['node_modules/@aws-amplify/cli-internal/bin/amplify', 'api', 'gql-compile'], { encoding: 'utf8', env: { ...process.env, AMPLIFY_CLI_DISABLE_USAGE_DATA: 'true' } });
  if (compile.status || !compile.stdout.includes('GraphQL schema compiled successfully')) throw new Error(compile.stdout + compile.stderr);
  const schema = readFileSync('amplify/backend/api/supportGraphql/build/schema.graphql', 'utf8');
  for (const operation of ['createTicket', 'getTicket', 'listTickets', 'updateTicket', 'deleteTicket', 'ticketSummary', 'closeTicket']) assert.ok(schema.includes(operation), operation);
  assert.ok(readdirSync('amplify/backend/api/supportGraphql/build/resolvers').some(f => f.includes('createTicket')));
  const body = restTemplate.Resources.supportRest.Properties.Body;
  assert.deepEqual(Object.keys(body.paths).sort(), ['/tickets', '/tickets/{id}', '/admin/tickets'].sort());
  assert.deepEqual(body.paths['/admin/tickets'].get.security, [{ AgentAuthorizer: [] }]);
  assert.deepEqual(body.paths['/tickets'].post.security, [{ Cognito: [] }]);
  const socketResources = Object.values(socketTemplate.Resources) as any[];
  const routes = socketResources.filter(r => r.Type === 'AWS::ApiGatewayV2::Route');
  assert.equal(routes.find(r => r.Properties.RouteKey === '$connect').Properties.AuthorizationType, 'CUSTOM');
  assert.equal(routes.length, 4);
  assert.ok(Object.values(auth.Resources).some((r: any) => r.Type === 'AWS::Cognito::UserPool'));
  // Verify the backend-config graph has no category-level dependency cycle.
  const config = JSON.parse(readFileSync('amplify/backend/backend-config.json', 'utf8'));
  for (const dependency of config.api.supportRest.dependsOn) {
    for (const attribute of dependency.attributes) {
      const parameter = `${dependency.category}${dependency.resourceName}${attribute}`;
      assert.ok(restTemplate.Parameters[parameter], `REST dependency parameter missing: ${parameter}`);
    }
  }
  const graph: Record<string,string[]> = {};
  for (const [category, entries] of Object.entries(config)) for (const [name, resource] of Object.entries(entries as any)) graph[`${category}/${name}`] = ((resource as any).dependsOn || []).map((d: any) => `${d.category}/${d.resourceName}`);
  const active = new Set<string>(), done = new Set<string>();
  const visit = (key: string) => { assert.ok(!active.has(key), `Circular dependency: ${key}`); if (done.has(key)) return; active.add(key); for (const dep of graph[key] || []) visit(dep); active.delete(key); done.add(key); };
  Object.keys(graph).forEach(visit);
  mkdirSync('evidence', { recursive: true });
  writeFileSync('evidence/graphql-compile.log', compile.stdout + compile.stderr);
  const summary = { status: 'passed', scope: 'Official Gen 1 Auth and REST synthesis, CLI GraphQL compilation, custom CDK synthesis; no deployment',
    graphqlOperations: ['createTicket','getTicket','listTickets','updateTicket','deleteTicket','ticketSummary','closeTicket'],
    restPaths: Object.keys(body.paths), websocketRoutes: routes.map(r => r.Properties.RouteKey), dependencyGraphAcyclic: true };
  writeFileSync('evidence/synthesis.json', JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
