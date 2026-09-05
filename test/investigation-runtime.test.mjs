import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultConfig} from '../dist/config.js';
import {FileMemoryStore} from '../dist/sessions/file-memory-store.js';
import {DiagnosticRuntime} from '../dist/runtime/diagnostic-runtime.js';
import {WorkerDiagnosisService} from '../dist/runtime/worker-diagnosis.js';
import {CaseRuntimeEventRecorder} from '../dist/runtime/event-recorder.js';
import {buildDiagnosticRequest} from '../dist/runtime/request-builder.js';
import {findRetryableInterruption} from '../dist/sessions/stale-turn.js';
import {serializeSession} from '../dist/gateway/dto.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),'investigation-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config = defaultConfig();
  config.storage = {rootDir:root,isolateByWorkspace:false};
  config.knowledge.rootDir = join(root,'knowledge');
  config.knowledge.buildVectorIndex = false;
  config.agent.modelProvider = undefined;
  config.agent.useModelForPreflight = false;
  config.embedding.enabled = false;
  config.claude.investigationProfiles = {enabled:true,fast:{model:'fake-fast',effort:'low',maxTurns:5},deep:{model:'fake-deep',effort:'high',timeoutMs:1200000}};
  const store = new FileMemoryStore(root);
  return {config,store};
}
function partial() {return {status:'partial',summary:'还需证据',missingInfo:[],claims:[],evidence:[],recommendedNextAction:'continue_diagnosis'};}
function response(result=partial()) {return {result,trace:{command:'fake',cwd:'.',stdout:'',stderr:'',exitCode:0,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()}};}

for (const preference of ['auto','fast','deep']) test(preference+' 的实际 Worker 次数与 Run 模式',async t=>{
  const {config,store}=fixture(t);
  const runtime = new DiagnosticRuntime(config,store,{diagnose:async()=>response()});
  const turn=runtime.startUserTurn({message:'检查当前项目代码的入口行为',investigationPreference:preference});
  const session=turn.caseSession;
  const request=buildDiagnosticRequest({caseSession:session,userMessage:'检查当前项目代码的入口行为',unknowns:[],config});
  request.context.deepQuery={permission:'read_only',artifactTargets:['src/a.ts'],anchorTerms:[],likelyPaths:[],avoidAssumptions:[],correctionActions:[]};
  const calls=[];
  const reviewer={async reviewAndFormat(_session,result,run){run.result=result;return {reply:'初步判断',decision:'partial',caseStatus:'partial'};}};
  const service=new WorkerDiagnosisService(store,{async diagnose(input){calls.push(structuredClone(input));return response();}},new CaseRuntimeEventRecorder(store),reviewer,{config});
  await service.diagnose(session,request);
  assert.equal(calls.length,preference==='auto'?2:1);
  assert.equal(calls[0].investigation.requestedMode,preference);
  if (preference==='auto'){
    assert.equal(calls[1].investigation.resolvedProfile,'deep');
    assert.equal(calls[1].investigation.attempt,2);
    assert.notEqual(calls[0].runId,calls[1].runId);
    assert.deepEqual(calls[0].answerGoal.mustAnswerItems,calls[1].answerGoal.mustAnswerItems);
  }
});

test('偏好保存 round-trip、取消真实 Worker 信号并允许重试',async t=>{
  const {config,store}=fixture(t);
  let entered;
  const started=new Promise(resolve=>entered=resolve);
  let signalSeen;
  const worker={async diagnose(_request,options){
    signalSeen=options.signal;
    entered();
    await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));
    return response();
  }};
  const runtime=new DiagnosticRuntime(config,store,worker);
  const turn=runtime.startUserTurn({message:'请检查当前项目的 src/index.ts 入口代码',investigationPreference:'fast'});
  assert.equal(store.loadCase(turn.caseSession.id).messages[0].investigationPreference,'fast');
  const completion=runtime.completeUserTurn(turn.caseSession.id,turn.userMessageId);
  await started;
  assert.equal(runtime.cancelInvestigation(turn.caseSession.id,'queued_message'),false);
  assert.equal(runtime.cancelInvestigation(turn.caseSession.id,turn.userMessageId),true);
  await completion;
  assert.equal(signalSeen.aborted,true);
  const stored=store.loadCase(turn.caseSession.id);
  assert.equal(findRetryableInterruption(stored).userMessageId,turn.userMessageId);
  assert.equal(serializeSession(stored,config).retryableTurn.reason,'user_cancelled');
  assert.equal(runtime.investigationProgress(stored.id,turn.userMessageId),undefined);
});

test('历史核验直接 Deep，手动 Fast 仍有效，安全请求冻结',async t=>{
  const {config,store}=fixture(t);
  for (const preference of ['auto','fast']){
    const runtime=new DiagnosticRuntime(config,store,{diagnose:async()=>response()});
    const {caseSession}=runtime.startUserTurn({message:'核验当前项目',investigationPreference:preference});
    const request=buildDiagnosticRequest({caseSession,userMessage:'核验当前项目',unknowns:[],config});
    let actual;
    const service=new WorkerDiagnosisService(store,{async diagnose(input){actual=input;return response();}},new CaseRuntimeEventRecorder(store),{}, {config});
    const collected=await service.collectEvidence({request,leads:[]});
    assert.equal(actual.investigation.resolvedProfile,preference==='auto'?'deep':'fast');
    assert.deepEqual(collected.persistedRequest.investigation,actual.investigation);
  }
});
