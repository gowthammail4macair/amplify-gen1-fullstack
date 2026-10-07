const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isBuiltin } = require('node:module');
const { spawnSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');

test('Cleaned Lambda packages contain only required files/dependencies and pass the runtime suites in isolation', async t => {
  const prepared = spawnSync(process.execPath, ['scripts/prepare-local.cjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-lambda-packages-'));
  try {
    const modules = { ticketRest: 'rest', ticketAuthorizer: 'authorizer', ticketWorkflow: 'workflow', ticketSocketHandler: 'websocket' };
    const runtime = path.join(temporary, 'src');
    fs.mkdirSync(runtime);
    for (const [name, module] of Object.entries(modules)) {
      const original = path.join(root, 'amplify/backend/function', name, 'src');
      const dir = path.join(temporary, name, 'src');
      fs.cpSync(original, dir, { recursive: true, filter: source => path.basename(source) !== 'node_modules' });
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
      const graph = buildSync({ entryPoints: [path.join(dir, 'index.js')], bundle: true, platform: 'node', packages: 'external', write: false, metafile: true }).metafile;
      const inputs = Object.keys(graph.inputs).map(file => path.resolve(file));
      assert.deepEqual(inputs.map(file => path.basename(file)).sort(), fs.readdirSync(dir).filter(file => file.endsWith('.cjs') || file === 'index.js').sort(), `${name}: unnecessary application files`);
      for (const file of inputs.filter(file => file.endsWith('.cjs'))) assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(root, 'src', path.basename(file)), 'utf8'), `${name}: stale source copy`);
      const dependencies = [...new Set(Object.values(graph.outputs).flatMap(output => output.imports).filter(item => item.external && !isBuiltin(item.path)).map(item => item.path))].sort();
      assert.deepEqual(dependencies, Object.keys(manifest.dependencies).sort(), `${name}: missing or unused dependencies`);
      // Only declared packages are visible to this Lambda; installed libraries resolve their own transitive dependencies.
      for (const dependency of dependencies) {
        const target = path.join(dir, 'node_modules', dependency);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(path.join(root, 'node_modules', dependency), target, 'dir');
      }
      assert.equal(typeof require(path.join(dir, 'index.js')).handler, 'function', `${name}: entry point cannot load`);
      fs.symlinkSync(path.join(dir, `${module}.cjs`), path.join(runtime, `${module}.cjs`));
      if (name === 'ticketRest') for (const file of ['database.cjs','agents.cjs']) fs.symlinkSync(path.join(dir, file), path.join(runtime, file));
      if (name === 'ticketSocketHandler') fs.symlinkSync(path.join(dir, 'notifications.cjs'), path.join(runtime, 'notifications.cjs'));
    }
    const tests = path.join(temporary, 'test');
    fs.mkdirSync(path.join(tests, 'node_modules'), { recursive: true });
    // The JWT fixture needs its own verifier. It cannot supply an undeclared dependency to a Lambda in a sibling directory.
    fs.symlinkSync(path.join(root, 'node_modules/aws-jwt-verify'), path.join(tests, 'node_modules/aws-jwt-verify'), 'dir');
    const suites = ['runtime.test.cjs', 'live-updates.test.cjs'];
    for (const suite of suites) fs.copyFileSync(path.join(root, 'test', suite), path.join(tests, suite));
    const childEnv = { ...process.env, NODE_PATH: '' };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...suites.map(suite => path.join(tests, suite))], { cwd: temporary, encoding: 'utf8', env: childEnv });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# fail 0\b/);
    t.diagnostic('Isolated Lambda packages: runtime/comment/notification checks passed');
    const messages = [];
    const socket = require(path.join(runtime, 'websocket.cjs')).createHandler({
      db: {},
      doc: { send: async () => ({ Items: [{ connectionId: 'owner', owner: 'alice-sub::alice', endpoint: 'https://socket.example.invalid/dev', expiresAt: Math.floor(Date.now() / 1000) + 600 }] }) },
      management: { send: async command => messages.push(JSON.parse(command.input.Data.toString())) }
    });
    const processed = await socket({ Records: [{ eventName: 'INSERT', eventID: 'one', dynamodb: { NewImage: { id: { S: 'one' }, owner: { S: 'alice-sub::alice' }, title: { S: 'Printer' }, status: { S: 'OPEN' } } } }] });
    assert.equal(processed.processed, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'ticketChanged');
    assert.equal(messages[0].change, 'created');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
