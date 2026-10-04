const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const cfg = require('../deployment.json');
const stack = `support-${cfg.appId}-frontend`;
function aws(args) { return JSON.parse(execFileSync('aws', [...args, '--region', cfg.region, '--output', 'json'], {encoding:'utf8',maxBuffer:10*1024*1024})); }
function outputs() {
  const s = aws(['cloudformation','describe-stacks','--stack-name',stack]).Stacks[0];
  if (!['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(s.StackStatus)) throw new Error('Hosting stack is not ready: '+s.StackStatus);
  const out = Object.fromEntries(s.Outputs.map(o=>[o.OutputKey,o.OutputValue]));
  const config = {stack,region:cfg.region,assetsBucket:out.AssetsBucket,websiteBucket:out.WebsiteBucket,websiteUrl:out.WebsiteUrl,url:out.FrontendUrl,distributionId:out.DistributionId};
  fs.writeFileSync('frontend/hosting.json',JSON.stringify(config,null,2)+'\n');
  return config;
}
const mode = process.argv[2];
if (mode === 'prepare') {
  execFileSync('aws',['cloudformation','deploy','--stack-name',stack,'--template-file','frontend/hosting-template.json','--parameter-overrides',`AppId=${cfg.appId}`,`ProjectName=${require('../package.json').name}`,'--tags',`Project=${require('../package.json').name}`,`AmplifyApp=${cfg.appId}`,'--no-fail-on-empty-changeset','--region',cfg.region],{stdio:'inherit'});
  console.log(JSON.stringify(outputs()));
} else if (mode === 'publish') {
  const config=outputs();
  execFileSync('aws',['s3','sync','frontend/dist/',`s3://${config.assetsBucket}/`,'--cache-control','public,max-age=31536000,immutable','--exclude','index.html','--exclude','build.json','--region',cfg.region],{stdio:'inherit'});
  execFileSync('aws',['s3','cp','frontend/dist/index.html',`s3://${config.assetsBucket}/index.html`,'--content-type','text/html; charset=utf-8','--cache-control','no-cache','--region',cfg.region],{stdio:'inherit'});
  execFileSync('aws',['s3','cp','frontend/dist/build.json',`s3://${config.assetsBucket}/build.json`,'--content-type','application/json','--cache-control','no-cache','--region',cfg.region],{stdio:'inherit'});
  // Hashed assets stay available to already-open browser tabs; index.html is uncached.
  fs.mkdirSync('evidence',{recursive:true});
  const report={...config,status:'published',timestamp:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA||null,build:JSON.parse(fs.readFileSync('frontend/dist/build.json'))};
  fs.writeFileSync('evidence/frontend-deployment.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({url:config.url,websiteUrl:config.websiteUrl,status:'published'}));
} else if (mode === 'outputs') { console.log(JSON.stringify(outputs())); }
else throw new Error('Use prepare, publish, or outputs');
