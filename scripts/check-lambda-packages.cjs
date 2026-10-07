// Verify the actual AWS packages, including source copies and installed direct dependencies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const cfg = require('../deployment.json');
const meta = JSON.parse(fs.readFileSync('amplify/backend/amplify-meta.json'));
const names = ['ticketAuthorizer', 'ticketRest', 'ticketWorkflow', 'ticketSocketHandler'];
const directDependencies = Object.keys(require('../package.json').dependencies);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deployed-ticket-lambdas-'));

(async () => {
  const functions = [];
  try {
    for (const name of names) {
      const functionName = meta.function[name]?.output?.Name;
      assert.ok(functionName, `${name}: missing deployed function name`);
      const deployed = JSON.parse(execFileSync('aws', ['lambda', 'get-function', '--function-name', functionName, '--region', cfg.region, '--output', 'json'], { encoding: 'utf8' }));
      assert.equal(deployed.Configuration.LastUpdateStatus, 'Successful', `${name}: deployment not complete`);
      assert.equal(deployed.Configuration.Runtime, 'nodejs22.x');
      const response = await fetch(deployed.Code.Location, { signal: AbortSignal.timeout(30000) });
      assert.ok(response.ok, `${name}: could not download deployed package`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('base64'), deployed.Configuration.CodeSha256, `${name}: package checksum mismatch`);
      const archive = path.join(temporary, `${name}.zip`);
      fs.writeFileSync(archive, bytes);
      const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
      const source = `amplify/backend/function/${name}/src`;
      const expected = fs.readdirSync(source).filter(file => file.endsWith('.cjs') || file === 'index.js').sort();
      const actual = entries.filter(file => !file.includes('/') && (file.endsWith('.cjs') || file === 'index.js')).sort();
      assert.deepEqual(actual, expected, `${name}: unnecessary or missing application files`);
      for (const file of expected) assert.equal(execFileSync('unzip', ['-p', archive, file], { encoding: 'utf8' }), fs.readFileSync(`${source}/${file}`, 'utf8'), `${name}: deployed source differs from this commit`);
      const dependencies = JSON.parse(fs.readFileSync(`${source}/package.json`)).dependencies;
      const installed = JSON.parse(execFileSync('unzip', ['-p', archive, 'package.json'], { encoding: 'utf8' })).dependencies;
      assert.deepEqual(installed, dependencies, `${name}: incorrect package dependencies`);
      for (const dependency of directDependencies) assert.equal(entries.some(file => file.startsWith(`node_modules/${dependency}/`)), Object.hasOwn(dependencies, dependency), `${name}: missing or unnecessary installed ${dependency}`);
      functions.push({ name, functionName, status: 'passed', codeSha256: deployed.Configuration.CodeSha256, codeSizeBytes: bytes.length, files: actual, dependencies: Object.keys(dependencies), lastModified: deployed.Configuration.LastModified });
      console.log(`PASS ${name}: deployed files and dependencies match the cleaned package (${bytes.length} bytes)`);
    }
    fs.mkdirSync('evidence', { recursive: true });
    fs.writeFileSync('evidence/deployed-lambda-packages.json', JSON.stringify({ timestamp: new Date().toISOString(), commit: process.env.GITHUB_SHA || null, region: cfg.region, appId: cfg.appId, environment: cfg.envName, scope: 'Downloaded actual AWS Lambda deployment archives and verified checksums, source files and dependencies', functions }, null, 2) + '\n');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
