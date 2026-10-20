import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export const name='devkit-native-test-probe';
export const inject=['agentLoop','agents','tools','workingDirectory','systemPrompt'];
export async function apply(ctx,config) {
 const report={layer:'real-host/native-tools; no model inference',at:new Date().toISOString(),cases:[],executions:[]};
 const cwd=config.workspace;fs.mkdirSync(cwd,{recursive:true});
 const handles=[];let recordedController;
 try{
  const presets=ctx.get('agentPresets');const setup=presets?async(agentCtx)=>{await presets.mount(agentCtx,'standard');}:undefined;
  // Do not inject devkit as a hard dependency: lifecycle cases intentionally unload it.
  for(let n=0;n<100&&!ctx.get('devkit');n++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(ctx.get('devkit'),'DevKit service did not mount before native probe');
  const mainSession=`native-${config.combo}-${Date.now()}`;
  // Reproduce an already-persisted 0.2.6 session: unknown messages must never activate on load.
  ctx.get('devkit').controller.update(cwd,s=>{s.messages.push({id:'legacy-info',sessionId:mainSession,text:'他报错了吗',intent:'unknown',at:new Date().toISOString()});});
  const handle=await ctx.agents.create({sessionId:mainSession,meta:{cwd,...(presets?{agentPreset:'standard'}:{})},setup,agentOptions:{provider:'deepseek-account',model:'deepseek-flash'}});handles.push(handle);
  const agent=handle.agent,session=String(agent.session.id),c=ctx.get('devkit').controller;
  recordedController=c;
  report.devkitVersion=ctx.get('devkit').version;
  report.inventory=[...ctx.get('loader').entries()].filter(e=>!e.options.group).map(e=>({id:e.id,name:e.options.name,disabled:e.disabled,state:e.fiber?.state??null}));
  report.tools=ctx.tools.schemas(agent).map(t=>t.name);
  const call=async(name,args,id)=>{const callId=id??`probe-${Date.now()}-${Math.random()}`,startedAt=new Date().toISOString();const result=await ctx.tools.execute({name,arguments:args,callId,agent,signal:new AbortController().signal});report.executions.push({name,args,callId,startedAt,finishedAt:new Date().toISOString(),isError:result.isError,error:result.error??null,artifact:c.store.artifact(result)});return result;};
  const run=async(id,fn)=>{const startedAt=new Date().toISOString(),start=Date.now(),firstExecution=report.executions.length;try{await fn();report.cases.push({id,status:'PASS',startedAt,durationMs:Date.now()-start,executions:[firstExecution,report.executions.length]});}catch(e){report.cases.push({id,status:'FAIL',error:e.message,startedAt,durationMs:Date.now()-start,executions:[firstExecution,report.executions.length]});}};
  let discoverySpan;
  await run('legacy-unknown-session-is-not-auto-admitted',async()=>{
   const r=await call('devkit_project',{action:'status'});assert.equal(r.isError,false,JSON.stringify(r));assert.equal(r.value.managed,false);assert.equal(c.read(cwd).requirementVersion,0);assert.equal(c.read(cwd).messages[0].intent,'unknown');
  });
  await run('unmanaged-discovery-status-and-context-are-read-only',async()=>{
   for(const [i,text] of ['dsh-devkit装了个新插件你看看有什么用','他报错了吗'].entries())agent.inject({role:'user',id:`discovery-${i}`,source:{kind:'user'},content:[{type:'text',text}]});
   fs.writeFileSync(path.join(cwd,'guide.ts'),'export function feature(){return "original";}');
   const state=c.read(cwd),r=await call('devkit_project',{action:'status'});assert.equal(r.isError,false);assert.equal(r.value.managed,false);assert.match(r.value.guidance,/只读/);
   const q=await call('devkit_context',{query:'feature',path:'guide.ts',maxCharacters:2200});assert.equal(q.isError,false,JSON.stringify(q));discoverySpan=q.value.snippets.find(s=>s.symbol==='feature');assert.ok(discoverySpan);
   assert.equal((await call('devkit_context',{action:'checkpoint'})).isError,false);await call('devkit_project',{action:'status'});
   assert.equal(c.read(cwd).requirementVersion,0);assert.equal(c.read(cwd).epoch,state.epoch);assert.equal(c.read(cwd).planSession,undefined);assert.equal(c.read(cwd).status,'unmanaged');
  });
  await run('unmanaged-mutation-tools-decline-without-activation-or-shell',async()=>{
   for(const [name,args]of [
    ['devkit_project',{action:'plan',goal:'invented',criteria:[{id:'x',description:'x',kind:'command'}]}],
    ['devkit_patch',{ref:discoverySpan.ref,replacement:'changed'}],['devkit_create',{title:'invented',fields:[{name:'note',label:'note',type:'text'}]}],
    ['devkit_verify',{command:'Set-Content should-not-exist.txt unexpected',criterionIds:['x']}],['devkit_browser',{action:'inspect',file:'index.html'}],['devkit_artifact',{id:'a'.repeat(64)}]]){
    const r=await call(name,args);assert.equal(r.isError,false,JSON.stringify(r));assert.equal(r.value.requiresUserWorkMessage,true,JSON.stringify(r));
   }
   assert.equal(fs.existsSync(path.join(cwd,'should-not-exist.txt')),false);assert.equal(fs.existsSync(path.join(cwd,'index.html')),false);assert.equal(c.read(cwd).usage.tools,0);assert.equal(c.read(cwd).requirementVersion,0);
  });
  await run('natural-feature-request-admits-without-a-magic-verb',async()=>{
   agent.inject({role:'user',id:`feature-${Date.now()}`,source:{kind:'user'},content:[{type:'text',text:'能不能加个导出功能'}]});
   const r=await call('devkit_project',{action:'status'});assert.equal(r.value.managed,true);assert.equal(r.value.status,'needs-plan');assert.equal(r.value.version,1);
  });
  await run('native-unplanned-write-denied',async()=>{const r=await call('write',{file_path:'app.js',content:'x'});assert.equal(r.isError,true);assert.equal(fs.existsSync(path.join(cwd,'app.js')),false);});
  await run('native-contract-and-executor-receipt',async()=>{
   const r=await call('devkit_project',{action:'plan',goal:'小工具',criteria:[{id:'run',description:'node exits successfully',kind:'command'}],scope:['app.js']});assert.equal(r.isError,false,JSON.stringify(r));
   const w=await call('write',{file_path:'app.js',content:'console.log("native-host-ok")'});assert.equal(w.isError,false,JSON.stringify(w));
   assert.equal(fs.readFileSync(path.join(cwd,'app.js'),'utf8'),'console.log("native-host-ok")');
   assert.equal(Object.values(c.read(cwd).receipts).length,1);
  });
  await run('native-verification-via-host-shell',async()=>{
   const r=await call('devkit_verify',{command:'node app.js',criterionIds:['run'],timeoutMs:10000});assert.equal(r.isError,false,JSON.stringify(r));
   assert.equal(r.value.evidence.passed,true,JSON.stringify(r));
   const d=await call('devkit_project',{action:'deliver'});assert.equal(d.isError,false,JSON.stringify(d));assert.equal(d.value.feedback,'awaiting-user');
  });
  await run('pre-admission-source-reference-is-stale-after-a-real-work-request',async()=>{
   const r=await call('devkit_patch',{ref:discoverySpan.ref,replacement:'export function feature(){return "changed";}'});assert.equal(r.isError,true);assert.match(r.error.message,/old requirement/);assert.match(fs.readFileSync(path.join(cwd,'guide.ts'),'utf8'),/original/);
  });
  await run('external-edit-invalidates-evidence',async()=>{
   fs.writeFileSync(path.join(cwd,'app.js'),'console.log("user-edit")');
   const r=await call('devkit_project',{action:'deliver'});assert.equal(r.isError,true);assert.match(r.error.message,/invalidated/);
  });
  await run('external-edit-blocks-blind-overwrite',async()=>{
   const r=await call('write',{file_path:'app.js',content:'bad-overwrite'});assert.equal(r.isError,true);assert.equal(fs.readFileSync(path.join(cwd,'app.js'),'utf8'),'console.log("user-edit")');
  });
  await run('other-session-cannot-bypass-project-writer',async()=>{
   const other=await ctx.agents.create({sessionId:`other-${Date.now()}`,meta:{cwd,...(presets?{agentPreset:'standard'}:{})},setup,agentOptions:{provider:'deepseek-account',model:'deepseek-flash'}});handles.push(other);
   const r=await ctx.tools.execute({name:'write',arguments:{file_path:'other.js',content:'unsafe'},callId:'other-writer',agent:other.agent,signal:new AbortController().signal});
   assert.equal(r.isError,true);assert.equal(fs.existsSync(path.join(cwd,'other.js')),false);
  });
  await run('native-cancel-reconciles-side-effects-without-progress',async()=>{
   const r=await call('devkit_project',{action:'resume',reason:'Inspected changed app.js; preserve user edits before cancellation test.'});assert.equal(r.isError,false,JSON.stringify(r));
   const abort=new AbortController();const pending=ctx.tools.execute({name:'pwsh',arguments:{command:"Set-Content -LiteralPath cancel-before.txt -Value happened; Start-Sleep -Seconds 5; Set-Content -LiteralPath cancel-after.txt -Value unexpected",description:'Isolated cancellation fault',workdir:cwd,timeoutMs:10000},callId:'cancel-fault',agent,signal:abort.signal});
   await new Promise(resolve=>setTimeout(resolve,600));agent.inject({role:'user',id:`stop-${Date.now()}`,source:{kind:'user'},content:[{type:'text',text:'停止'}]});
   const result=await pending;assert.ok(result.isError||result.value?.aborted||result.value?.exitCode!==0);assert.equal(fs.existsSync(path.join(cwd,'cancel-after.txt')),false);
   assert.equal(c.read(cwd).delivery,'not-delivered');assert.equal(c.read(cwd).mode,'stopped');assert.equal(Object.keys(c.read(cwd).pending).length,0);
  });
  await run('only-one-context-contribution',async()=>{
   const assembly=await ctx.systemPrompt.assemble({scope:agent,agent});
   assert.equal(assembly.contexts.filter(x=>x.name==='devkit:project').length,1);
   assert.equal(assembly.sections.filter(x=>x.name==='devkit:policy').length,1);assert.ok(assembly.sections.find(x=>x.name==='devkit:policy').text.includes('devkit_create'));
   assert.ok(!assembly.contexts.find(x=>x.name==='devkit:project').text.includes('DSH DevKit：'));
  });
  await run('discussion-guard-monotonic',async()=>{
   c.ingest(cwd,session,`${session}:discussion`,'先别动，我想问问为什么这样');
   const dispose=ctx.on('tools/pre-execute',async(_exec,_next)=>({kind:'allow'}));
   try{const r=await call('write',{file_path:'blocked.js',content:'bad'});assert.equal(r.isError,true);assert.equal(fs.existsSync(path.join(cwd,'blocked.js')),false);}finally{dispose();}
  });
  await run('read-only-tool-remains-available',async()=>{const r=await call('read',{file_path:'app.js'});assert.equal(r.isError,false,JSON.stringify(r));});
  await run('unknown-native-call-does-not-fake-success',async()=>{const r=await call('definitely_missing_tool',{});assert.equal(r.isError,true);});
  await run('disable-in-flight-and-reload-drains-native-action',async()=>{
   c.ingest(cwd,session,`${session}:lifecycle`,'继续修复这个项目');
   const p=await call('devkit_project',{action:'plan',goal:'lifecycle fault test',scope:['.'],criteria:[{id:'run',description:'native lifecycle',kind:'command'}]});assert.equal(p.isError,false,JSON.stringify(p));
   const entry=[...ctx.get('loader').entries()].find(e=>e.options.name==='dsh-devkit');assert.ok(entry);
   const pending=call('pwsh',{command:'Start-Sleep -Seconds 5; Set-Content -LiteralPath late-write.txt -Value unsafe',description:'Isolated unload fault',workdir:cwd,timeoutMs:10000},'lifecycle-fault');
   await new Promise(resolve=>setTimeout(resolve,400));await entry.update({...entry.options,disabled:true},false,true);
   const result=await pending;assert.equal(fs.existsSync(path.join(cwd,'late-write.txt')),false);assert.ok(result.isError||result.value?.aborted||result.value?.exitCode!==0);
   assert.equal(Object.keys(c.read(cwd).pending).length,0);assert.notEqual(c.read(cwd).status,'verified');
   await entry.update({...entry.options,disabled:false},false,true);await entry.fiber?.await();
   const own=ctx.tools.schemas(agent).filter(t=>t.name.startsWith('devkit_'));assert.equal(own.length,7);assert.equal(new Set(own.map(t=>t.name)).size,7);
   const assembly=await ctx.systemPrompt.assemble({scope:agent,agent});assert.equal(assembly.contexts.filter(x=>x.name==='devkit:project').length,1);
  });
  await run('duplicate-final-events-are-not-recharged',async()=>{
   c.ingest(cwd,session,`${session}:duplicate`,'继续写入事件去重测试');
   await call('devkit_project',{action:'plan',goal:'duplicate result check',scope:['dedup.txt'],criteria:[{id:'run',description:'event settlement',kind:'command'}]});
   let captured;const off=ctx.on('tools/result',(exec,result)=>{if(exec.callId==='dedup-native')captured={exec,result};});
   try{const r=await call('write',{file_path:'dedup.txt',content:'once'},'dedup-native');assert.equal(r.isError,false);assert.ok(captured);const count=c.read(cwd).usage.observations;ctx.emit('tools/result',captured.exec,captured.result);ctx.emit('tools/result',captured.exec,captured.result);assert.equal(c.read(cwd).usage.observations,count);}finally{off();}
  });
  await run('late-native-result-cannot-advance-new-requirement',async()=>{
   const action=call('pwsh',{command:'Start-Sleep -Milliseconds 700; Write-Output old-result',description:'Out of order requirement test',workdir:cwd,timeoutMs:5000},'old-version');
   await new Promise(resolve=>setTimeout(resolve,200));agent.inject({role:'user',id:`change-${Date.now()}`,source:{kind:'user'},content:[{type:'text',text:'改成新的需求'}]});await action;
   assert.equal(c.read(cwd).status,'needs-plan');assert.equal(c.read(cwd).receipts[`${session}:old-version`].stale,true);
  });
  await run('state-observation-does-not-schedule-model-work',async()=>{
   let requests=0;const off=ctx.on('agent/request',()=>{requests++;});
   try{for(let i=0;i<20;i++)c.update(cwd,s=>{s.observationTest=i;});await new Promise(resolve=>setTimeout(resolve,300));assert.equal(requests,0);}finally{off();}
  });
  await run('native-material-query-and-span-edit',async()=>{
   c.ingest(cwd,session,`${session}:materials`,'继续修复导出');await call('devkit_project',{action:'plan',goal:'export fix',scope:['exports.mjs'],criteria:[{id:'export',description:'export returns fixed',kind:'command'}]});
   const w=await call('write',{file_path:'exports.mjs',content:'export function exportCsv(){return "broken";}'});assert.equal(w.isError,false);
   const q=await call('devkit_context',{query:'exportCsv',maxCharacters:2200});assert.equal(q.isError,false,JSON.stringify(q));assert.ok(JSON.stringify(q.value).length<=2200);
   const span=q.value.snippets.find(s=>s.symbol==='exportCsv');assert.ok(span);
   const edit=await call('devkit_patch',{ref:span.ref,replacement:'export function exportCsv(){return "fixed";}'});assert.equal(edit.isError,false,JSON.stringify(edit));assert.match(fs.readFileSync(path.join(cwd,'exports.mjs'),'utf8'),/fixed/);
   const check=await call('devkit_verify',{command:`node -e "import('./exports.mjs').then(m=>{if(m.exportCsv()!=='fixed')process.exit(1)})"`,criterionIds:['export']});assert.equal(check.value?.evidence.passed,true,JSON.stringify(check));
   const again=await call('devkit_context',{query:'exportCsv',maxCharacters:2200});assert.ok(again.value.stats.cacheHits>0);
   const patchOld=await call('devkit_patch',{ref:span.ref,replacement:'bad'});assert.equal(patchOld.isError,true);
  });
  await run('informational-question-pauses-active-modification-but-keeps-query-available',async()=>{
   const version=c.read(cwd).requirementVersion;agent.inject({role:'user',id:`info-${Date.now()}`,source:{kind:'user'},content:[{type:'text',text:'他报错了吗'}]});
   const status=await call('devkit_project',{action:'status'});assert.equal(status.isError,false);assert.equal(status.value.mode,'read-only');assert.equal(status.value.version,version);
   assert.equal((await call('devkit_context',{query:'exportCsv'})).isError,false);
   assert.equal((await call('write',{file_path:'question-write.txt',content:'must not write'})).isError,true);assert.equal(fs.existsSync(path.join(cwd,'question-write.txt')),false);
  });
  await run('native-colloquial-feedback-and-checkpoint',async()=>{
   const version=c.read(cwd).requirementVersion;agent.inject({role:'user',id:`colloquial-${Date.now()}`,source:{kind:'user'},content:[{type:'text',text:'这个页面太乱'}]});
   assert.equal(c.read(cwd).requirementVersion,version+1);assert.equal(c.read(cwd).status,'needs-plan');
   const result=await call('devkit_context',{action:'checkpoint'});assert.equal(result.isError,false);assert.match(result.value.goal,/太乱/);assert.equal(result.value.version,version+1);
  });
  if(config.combo==='B-browser-full')await run('native-generator-auto-verification-and-feedback',async()=>{
   const generated=path.join(path.dirname(cwd),`generated-${Date.now()}`);fs.mkdirSync(generated);
   const handle=await ctx.agents.create({sessionId:`generated-${Date.now()}`,meta:{cwd:generated},agentOptions:{provider:'deepseek-account',model:'deepseek-flash'}});handles.push(handle);const ga=handle.agent,gs=String(ga.session.id);
   const invoke=async(name,args)=>{const callId=`generator-${Math.random()}`,startedAt=new Date().toISOString(),result=await ctx.tools.execute({name,arguments:args,callId,agent:ga,signal:new AbortController().signal});report.executions.push({name,args,callId,startedAt,finishedAt:new Date().toISOString(),isError:result.isError,error:result.error??null,artifact:c.store.artifact(result)});return result;};
   ga.inject({role:'user',id:`generate-${Date.now()}`,source:{kind:'user'},content:[{type:'text',text:'做个本地库存小工具'}]});
   const plan=await invoke('devkit_project',{action:'plan',goal:'本地库存记录',scope:['index.html','style.css','app.js'],criteria:[{id:'form',description:'add/persist/delete records',kind:'command'},{id:'csv',description:'download contains retained record',kind:'command'}],tasks:[{id:'records',title:'记录',criterionIds:['form']},{id:'csv',title:'导出',criterionIds:['csv'],dependsOn:['records']}]});assert.equal(plan.isError,false);
   const created=await invoke('devkit_create',{title:'库存记录',fields:[{name:'item',label:'物品',type:'text'},{name:'quantity',label:'数量',type:'number'}],summaries:[{id:'total',label:'总数',operation:'sum',field:'quantity'}],criterionIds:['form','csv']});
   assert.equal(created.isError,false,JSON.stringify(created));assert.equal(created.value.smoke.browser.passed,true,JSON.stringify(created));assert.equal(created.value.smoke.evidence.passed,true);assert.equal(c.read(generated).tasks.every(t=>t.status==='verified'),true);
   const delivered=await invoke('devkit_project',{action:'deliver'});assert.equal(delivered.isError,false);assert.equal(delivered.value.feedback,'awaiting-user');
   const repeated=await invoke('devkit_create',{title:'overwrite',fields:[{name:'note',label:'内容',type:'text'}]});assert.equal(repeated.isError,true);
   fs.writeFileSync(path.join(generated,'user-note.txt'),'用户保留');ga.inject({role:'user',id:`feedback-${Date.now()}`,source:{kind:'user'},content:[{type:'text',text:'标题改成库存新名，保留我的备注'}]});
   await invoke('devkit_project',{action:'plan',goal:'标题修改',scope:['app.js'],criteria:[{id:'title',description:'visible title changed',kind:'command'}]});
   const q=await invoke('devkit_context',{path:'app.js',query:'APP',maxCharacters:2600}),span=q.value.snippets.find(s=>s.symbol==='APP');assert.ok(span.text.startsWith('const APP'));
   const patch=await invoke('devkit_patch',{ref:span.ref,replacement:span.text.replace('库存记录','库存新名')});assert.equal(patch.isError,false,JSON.stringify(patch));
   const check=await invoke('devkit_browser',{file:'index.html',criterionIds:['title'],steps:[{action:'text',selector:'#app-title',value:'库存新名'}]});assert.equal(check.value?.evidence.passed,true,JSON.stringify(check));
   assert.equal(fs.readFileSync(path.join(generated,'user-note.txt'),'utf8'),'用户保留');assert.equal((await invoke('devkit_project',{action:'deliver'})).isError,false);
   report.generatedWorkspace=generated;
  });
  if(['B','B-browser-full','H-web'].includes(config.combo))await run('native-browser-assertion-and-download-content',async()=>{
   c.ingest(cwd,session,`${session}:browser`,'继续实现浏览器验收');
   const p=await call('devkit_project',{action:'plan',goal:'browser adapter native contract',scope:['browser.html'],criteria:[{id:'download',description:'download contains expected content',kind:'command'}]});assert.equal(p.isError,false);
   const w=await call('write',{file_path:'browser.html',content:'<!doctype html><button id="export">export</button><script>document.querySelector("#export").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["native-download-content"]));a.download="proof.txt";a.click();}</script>'});assert.equal(w.isError,false);
   const r=await call('devkit_browser',{file:'browser.html',criterionIds:['download'],steps:[{action:'download',selector:'#export',value:'native-download-content'}]});assert.equal(r.isError,false,JSON.stringify(r));assert.equal(r.value.evidence.passed,true,JSON.stringify(r));assert.equal(r.value.browser.results[0].contentSnippetVerified,true);assert.ok(fs.existsSync(r.value.browser.results[0].file));
  });
 }catch(e){report.cases.push({id:'probe-bootstrap',status:'FAIL',error:e.stack});}
 finally{
  if(recordedController)report.finalState=recordedController.summary(cwd);
  report.finishedAt=new Date().toISOString();
  report.finalInventory=[...ctx.get('loader').entries()].filter(e=>!e.options.group).map(e=>({id:e.id,name:e.options.name,disabled:e.disabled,state:e.fiber?.state??null}));
  for(const h of handles)await h.dispose();
  report.status=report.cases.every(c=>c.status==='PASS')?'PASS':'FAIL';
  fs.mkdirSync(path.dirname(config.report),{recursive:true});fs.writeFileSync(config.report,JSON.stringify(report,null,2));
 }
}
