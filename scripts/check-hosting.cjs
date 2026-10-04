// Check the actual hosted files, redirect, and private S3 origin after publishing.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const hosting=require('../frontend/hosting.json');
const build=JSON.parse(fs.readFileSync('frontend/dist/build.json'));
(async()=>{
  const checks=[];
  for(const asset of build.assets){
    let response;
    for(let attempt=0;attempt<18;attempt++){
      response=await fetch(hosting.url+'/'+asset.path,{signal:AbortSignal.timeout(20000)});
      if(response.ok)break;
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
    assert.equal(response.status,200,asset.path+' must be publicly served through CloudFront');
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256,'Hosted file differs from deployment build: '+asset.path);
    checks.push({name:'HTTPS asset matches build: '+asset.path,status:'passed'});
  }
  const manifest=await fetch(hosting.url+'/build.json',{signal:AbortSignal.timeout(20000)});
  assert.equal(manifest.status,200);assert.deepEqual(await manifest.json(),build);
  const redirect=await fetch(hosting.websiteUrl,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),hosting.url+'/');
  checks.push({name:'S3 website redirects to HTTPS frontend',status:'passed'});
  const privateOrigin=await fetch('https://'+hosting.assetsBucket+'.s3.'+hosting.region+'.amazonaws.com/index.html',{signal:AbortSignal.timeout(20000)});
  assert.equal(privateOrigin.status,403);
  checks.push({name:'Direct anonymous S3 asset access denied',status:'passed'});
  const report={status:'passed',timestamp:new Date().toISOString(),sourceSha:build.sourceSha,hosting,checks};
  fs.writeFileSync('evidence/frontend-hosting-checks.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
