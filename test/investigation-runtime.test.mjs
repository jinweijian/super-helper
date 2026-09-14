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
import {failedExecutionDiagnosticResult} from '../dist/workers/claude/claude-output-parser.js';
import {ReviewPresentationService} from '../dist/runtime/review-presentation.js';
import {InvestigationControl} from '../dist/runtime/investigation-control.js';
import {completePresentedTurn} from '../dist/runtime/turn-completion.js';

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

function reviewedFixture(config, store, onReview = () => {}, full = false) {
  const model = {async complete(messages) {
    onReview();
    const input = JSON.parse(messages[1].content);
    const bindings = input.claimSegments.filter(claim => claim.evidenceIds.some(id => input.evidenceSegments.some(ev => ev.id === id)))
      .map(claim => ({claimId:claim.id,answerItemIds:claim.candidateAnswerItemIds,evidenceIds:claim.evidenceIds}));
    return JSON.stringify({status:'accepted',bindings,fullQuestion:full?'full':'partial',fullQuestionClaimIds:bindings.map(b=>b.claimId),missingElements:[]});
  }};
  return new ReviewPresentationService(config,model,new CaseRuntimeEventRecorder(store),'','','','COVERAGE_SPEC');
}

function usableResponse(request, full = false) {
  const value = response({...partial(), status:full?'concluded':'partial', recommendedNextAction:full?'final_answer':'continue_diagnosis',
    claims:[{id:'claim_entry',type:'fact',role:full?'primary_answer':'supporting_context',text:'请求经过入口校验。',evidenceIds:['ev_entry'],answers:request.answerGoal.mustAnswerItems}],
    evidence:[{id:'ev_entry',kind:'workspace',source:'src/index.ts',summary:'请求经过入口校验。',confidence:'high'}]});
  value.coverageEvidence=[{evidenceId:'ev_entry',kind:'workspace',runId:request.runId,safeText:'请求经过入口校验。',validated:true}];
  return value;
}

test('presentation cancellation preserves accepted facts without accepting late model output', async t => {
  const {config,store}=fixture(t);
  config.agent.modelProvider='fixture';
  const runtime=new DiagnosticRuntime(config,store,{diagnose:async()=>response()});
  const {caseSession}=runtime.startUserTurn({message:'检查当前项目入口代码'});
  const request=buildDiagnosticRequest({caseSession,userMessage:'检查当前项目入口代码',unknowns:[],config});
  const value=usableResponse(request,true);
  const run={id:request.runId,caseId:caseSession.id,status:'running',request};
  const controller=new AbortController();
  let calls=0;
  let signalSeen;
  const model={async complete(messages,options){
    calls++;
    const input=JSON.parse(messages[1].content);
    if(input.projection){
      signalSeen=options.signal;
      controller.abort();
      return '{"reply":"未经审核的迟到结果"}';
    }
    return JSON.stringify({status:'accepted',bindings:input.claimSegments.map(c=>({claimId:c.id,answerItemIds:c.candidateAnswerItemIds,evidenceIds:c.evidenceIds})),fullQuestion:'full',fullQuestionClaimIds:['claim_entry'],missingElements:[]});
  }};
  const reviewer=new ReviewPresentationService(config,model,new CaseRuntimeEventRecorder(store),'','','','COVERAGE_SPEC');
  const result=await reviewer.reviewAndFormat(caseSession,value.result,run,{
    signal:controller.signal,
    coverageEvidenceEnvelopes:value.coverageEvidence.map(ev=>({...ev,freshness:'current_worker_run'})),
  });
  assert.equal(signalSeen,controller.signal);
  assert.equal(calls,2);
  assert.equal(result.hasReviewedAnswer,true);
  assert.match(result.reply,/请求经过入口校验/);
  assert.doesNotMatch(result.reply,/未经审核的迟到结果/);
});

test('真实 parser 的失败 process_note 在取消后不能阻止一键重试',async t=>{
  const {config,store}=fixture(t);
  let runtime;
  const worker={async diagnose(request){
    runtime.cancelInvestigation(request.caseId,request.answerGoal.sourceMessageIds.at(-1));
    const failed=response(failedExecutionDiagnosticResult(request,{stdout:'',stderr:'',exitCode:1,error:'failed'}));
    failed.trace.error='failed';
    return failed;
  }};
  runtime=new DiagnosticRuntime(config,store,worker);
  const turn=runtime.startUserTurn({message:'检查当前项目的 src/index.ts 入口代码',investigationPreference:'fast'});
  const result=await runtime.completeUserTurn(turn.caseSession.id,turn.userMessageId);
  assert.equal(result.decision,'partial');
  assert.equal(serializeSession(store.loadCase(turn.caseSession.id),config).retryableTurn.reason,'user_cancelled');
  assert.equal(result.caseSession.messages.filter(m=>m.role==='helper').length,1);
});

for (const scenario of ['parser_failure','parser_cancel','empty_cancel','before_review_cancel']) test(`Fast 已审核初步在 Deep ${scenario} 后保留`,async t=>{
  const cancel=scenario!=='parser_failure';
  const {config,store}=fixture(t);
  const runtime=new DiagnosticRuntime(config,store,{diagnose:async()=>response()});
  const turn=runtime.startUserTurn({message:'检查当前项目入口代码'});
  const session=turn.caseSession;
  const request=buildDiagnosticRequest({caseSession:session,userMessage:'检查当前项目入口代码',unknowns:[],config});
  request.context.deepQuery={permission:'read_only',artifactTargets:['src/index.ts'],anchorTerms:[],likelyPaths:[],avoidAssumptions:[],correctionActions:[]};
  const control=new InvestigationControl();
  control.begin(session.id,turn.userMessageId,'auto');
  let calls=0;
  const reviewer=reviewedFixture(config,store);
  const originalReview=reviewer.reviewAndFormat.bind(reviewer);
  reviewer.reviewAndFormat=async(...args)=>{
    const review=await originalReview(...args);
    if(calls===1) assert.equal(review.hasReviewedAnswer,true);
    if(calls===2 && cancel) control.cancel(session.id,turn.userMessageId);
    return review;
  };
  const worker={async diagnose(input){
    calls++;
    if(calls===1)return usableResponse(input);
    if(scenario==='before_review_cancel') {
      control.cancel(session.id,turn.userMessageId);
      return usableResponse(input,true);
    }
    if(scenario==='empty_cancel')return response();
    const failed=response(failedExecutionDiagnosticResult(input,{stdout:'',stderr:'',exitCode:1,error:'failed'}));
    failed.trace.error='failed';
    return failed;
  }};
  const service=new WorkerDiagnosisService(store,worker,new CaseRuntimeEventRecorder(store),reviewer,{config,control});
  const review=await service.diagnose(session,request);
  assert.equal(calls,2);
  assert.equal(review.hasReviewedAnswer,true);
  assert.equal(review.decision,'partial');
  assert.match(review.reply,/请求经过入口校验/);
});

for (const route of ['knowledgeTurn','caseInvestigation']) test(`${route} 审核期间取消统一降为初步并同步唯一 helper 与持久化状态`,async t=>{
  const {config,store}=fixture(t);
  if (route === 'knowledgeTurn') config.knowledge.onlineDiagnosisEnabled = true;
  const runtime=new DiagnosticRuntime(config,store,{diagnose:async()=>{throw new Error('不应派发');}});
  if(route==='caseInvestigation') runtime.hasHistoricalCaseSource=()=>true;
  runtime.services.experienceTurn.answer=async()=>undefined;
  runtime.services[route].answer=async(session,...args)=>{
    const request=route==='knowledgeTurn'?args[2]:args[0];
    const replyToMessageId=args[1];
    const workerResponse=usableResponse(request,true);
    const run={id:request.runId,caseId:session.id,status:'running',request};
    store.addRun(session,run);
    const reviewer=reviewedFixture(config,store,()=>runtime.cancelInvestigation(session.id,replyToMessageId),true);
    const review=await reviewer.reviewAndFormat(session,workerResponse.result,run,{coverageEvidenceEnvelopes:workerResponse.coverageEvidence.map(ev=>({...ev,freshness:'current_worker_run'}))});
    assert.equal(review.hasReviewedAnswer,true);
    assert.equal(review.decision,'final');
    return completePresentedTurn({store,events:new CaseRuntimeEventRecorder(store),caseSession:session,review,replyToMessageId});
  };
  const turn=runtime.startUserTurn({message:'请检查当前项目的 src/index.ts 入口代码'});
  const result=await runtime.completeUserTurn(turn.caseSession.id,turn.userMessageId);
  assert.equal(result.decision,'partial');
  assert.match(result.assistantMessage,/排查已停止.*初步判断/);
  assert.match(result.assistantMessage,/请求经过入口校验/);
  const stored=store.loadCase(turn.caseSession.id);
  assert.equal(stored.status,'partial');
  const helpers=stored.messages.filter(m=>m.role==='helper');
  assert.equal(helpers.length,1);
  assert.equal(helpers[0].body,result.assistantMessage);
});
