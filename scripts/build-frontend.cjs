const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const deployment = require('../deployment.json');
const labels={ 'amplify-gen1-fullstack':'Amplify Gen 1', 'amplify-gen2-fullstack':'Native Gen 2', 'amplify-gen1-to-gen2-migration':'Migrated Gen 2' };
async function main() {
  const file=fs.existsSync('amplify_outputs.json')?'amplify_outputs.json':'evidence/deployed-outputs.json';
  if(process.env.CI && file!=='amplify_outputs.json')throw new Error('CI must build with outputs exported by this deployment.');
  const outputs=JSON.parse(fs.readFileSync(file));
  const name=require('../package.json').name;
  const config={project:{label:labels[name],repository:deployment.repository},auth:{poolId:outputs.auth.user_pool_id,clientId:outputs.auth.user_pool_client_id,region:outputs.auth.aws_region},api:{rest:outputs.custom.rest.endpoint.replace(/\/$/,''),graphql:outputs.data.url,websocket:outputs.custom.websocket.endpoint}};
  for(const url of Object.values(config.api))if(!['https:','wss:'].includes(new URL(url).protocol))throw new Error('Frontend requires HTTPS/WSS backend endpoints');
  fs.rmSync('frontend/dist',{recursive:true,force:true});fs.mkdirSync('frontend/dist/assets',{recursive:true});
  const bundle=await esbuild.build({entryPoints:['frontend/src/main.js'],bundle:true,platform:'browser',minify:true,format:'iife',target:['es2022'],write:false,define:{__APP_CONFIG__:JSON.stringify(config),global:'globalThis','process.env.NODE_ENV':'"production"'}});
  const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  const js=bundle.outputFiles[0].contents,css=fs.readFileSync('frontend/style.css');
  const jsPath=`assets/app-${hash(js).slice(0,12)}.js`,cssPath=`assets/style-${hash(css).slice(0,12)}.css`;
  fs.writeFileSync('frontend/dist/'+jsPath,js);fs.writeFileSync('frontend/dist/'+cssPath,css);
  const origins=[...new Set([`https://cognito-idp.${config.auth.region}.amazonaws.com`,...Object.values(config.api).map(u=>new URL(u).origin)])];
  const csp=`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${origins.join(' ')}; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`;
  let html=fs.readFileSync('frontend/index.html','utf8').replaceAll('__PROJECT__',labels[name]).replace('__CSP__',csp).replace('__SCRIPT__','/'+jsPath).replace('__STYLE__','/'+cssPath);
  fs.writeFileSync('frontend/dist/index.html',html);
  const manifest={project:name,configSource:file,sourceSha:process.env.GITHUB_SHA||null,builtAt:new Date().toISOString(),frontendLabel:labels[name],assets:[{path:jsPath,sha256:hash(js),bytes:js.length},{path:cssPath,sha256:hash(css),bytes:css.length},{path:'index.html',sha256:hash(html),bytes:Buffer.byteLength(html)}],auth:config.auth,api:config.api};
  fs.writeFileSync('frontend/dist/build.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({status:'built',project:name,assets:manifest.assets,configSource:file},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
