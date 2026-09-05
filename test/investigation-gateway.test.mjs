import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultConfig} from '../dist/config.js';
import {startServer} from '../dist/gateway/http-server.js';

test('HTTP 模式校验、脱敏进度、取消与原模式重试端到端',async t=>{
  const root=mkdtempSync(join(tmpdir(),'investigation-http-'));
  const config=defaultConfig();
  config.server.port=0;
  config.storage={rootDir:root,isolateByWorkspace:false};
  config.knowledge.rootDir=join(root,'knowledge');
  config.knowledge.buildVectorIndex=false;
  config.agent.modelProvider=undefined;
  config.agent.useModelForPreflight=false;
  config.embedding.enabled=false;
  config.onboarding.completedAt=new Date().toISOString();
  config.claude.investigationProfiles={enabled:true,fast:{model:'fake',effort:'low',maxTurns:5},deep:{model:'fake',effort:'high',timeoutMs:1200000}};
  let entered;const started=new Promise(resolve=>entered=resolve);
  const modes=[];
  const server=await startServer({config,workerFactory:()=>({async diagnose(request,options){
    modes.push(request.investigation.requestedMode);
    options.onProgress({stage:'reading',searchCount:3,filesRead:2,lastActivityAt:new Date().toISOString(),raw:'secret text'});
    entered();
    if(modes.length===1)await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));
    return {result:{status:'partial',summary:'未定位',evidence:[],claims:[],missingInfo:[],recommendedNextAction:'continue_diagnosis'},trace:{command:'fake',cwd:'',stdout:'',stderr:'',exitCode:0,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()}};
  }})});
  t.after(async()=>{await server.close();rmSync(root,{recursive:true,force:true});});
  const post=(path,body)=>fetch(server.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/settings/claude',{investigationProfiles:{enabled:true}})).status,400);
  assert.equal((await post('/api/chat',{message:'检查代码',investigationPreference:'max'})).status,400);
  const accepted=await (await post('/api/chat',{message:'检查当前项目 src/index.ts 入口行为',investigationPreference:'fast',async:true})).json();
  await started;
  const query='?caseId='+accepted.caseId+'&userMessageId='+accepted.userMessageId;
  const progress=await(await fetch(server.url+'/api/chat/progress'+query)).json();
  assert.equal(progress.progress.filesRead,2);
  assert.equal(progress.progress.requestedMode,'fast');
  assert.equal(JSON.stringify(progress).includes('secret'),false);
  assert.equal((await post('/api/chat/cancel',{caseId:accepted.caseId,userMessageId:'other'})).status,409);
  assert.equal((await post('/api/chat/cancel',accepted)).status,202);
  let session;
  for(let i=0;i<100;i++){
    session=(await(await fetch(server.url+'/api/session?caseId='+accepted.caseId+'&includeKnowledgeHealth=false')).json()).session;
    if(session.retryableTurn)break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(session.retryableTurn.reason,'user_cancelled');
  assert.equal(session.messages.find(m=>m.id===accepted.userMessageId).investigationPreference,'fast');
  assert.equal((await post('/api/chat/retry',accepted)).status,202);
  for(let i=0;i<100&&modes.length<2;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(modes,['fast','fast']);
});
