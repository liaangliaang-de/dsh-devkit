import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Controller, Store, snapshot, classify, summarizeOutput, safePath} from '../src/core.js';
function fixture() {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-')),ws=path.join(base,'workspace');fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws,'app.js'),'export const value = 1;');
  const c=new Controller(path.join(base,'state'));
  c.ingest(ws,'session','message1','修复项目');
  c.plan(ws,'session',{goal:'修复项目',criteria:[{id:'works',description:'works',kind:'command'}]});
  return {base,ws,c};
}
const ok={isError:false,value:{kind:'foreground',exitCode:0,timedOut:false,aborted:false},content:[{type:'text',text:'actual executor output'}]};
test('C01/C02 source versions, discussion, illegal completion and duplicate messages',()=>{
 const {ws,c}=fixture();assert.throws(()=>c.deliver(ws),/verification/);
 const v=c.read(ws).requirementVersion;c.ingest(ws,'session','message1','修复项目');assert.equal(c.read(ws).requirementVersion,v);
 c.ingest(ws,'session','question','先别动，我想问问为什么');assert.match(c.guard(ws,'session','write'),/stop\/discussion/);
 assert.throws(()=>c.plan(ws,'session',{goal:'hack',criteria:[{id:'x',description:'x',kind:'command'}]}),/stopped/);
});
test('C03/C04 real-shaped receipt, contract ids required, technical/delivery/feedback independent',()=>{
 const {ws,c}=fixture(),s=c.read(ws),t=c.begin(ws,'session','call1','pwsh',{});
 const receipt=c.settle(ws,t,ok);assert.equal(receipt.exitCode,0);assert.equal(c.read(ws).usage.observations,1);
 c.verifyResult(ws,{epoch:s.epoch,requirementVersion:s.requirementVersion},['works'],'node check.js',ok,snapshot(ws).digest);
 assert.equal(c.read(ws).status,'verified');c.deliver(ws);assert.equal(c.read(ws).feedback,'awaiting-user');
 assert.throws(()=>c.verifyResult(ws,{epoch:s.epoch,requirementVersion:s.requirementVersion},['fake'],'echo ok',ok,snapshot(ws).digest),/unknown/);
});
test('C05 user edits invalidate old verification even without plugin write events',()=>{
 const {ws,c}=fixture(),s=c.read(ws);
 c.verifyResult(ws,{epoch:s.epoch,requirementVersion:s.requirementVersion},['works'],'test',ok,snapshot(ws).digest);
 fs.writeFileSync(path.join(ws,'app.js'),'changed by user');assert.throws(()=>c.deliver(ws),/invalidated/);
 c.recover(ws);assert.notEqual(c.read(ws).status,'verified');
});
test('C06 two writers, outside workspace and user-edit protection preconditions',()=>{
 const {ws,c}=fixture(),t=c.begin(ws,'session','a','write',{});
 assert.throws(()=>c.begin(ws,'session','b','write',{}),/busy/);
 assert.throws(()=>safePath(ws,'../outside'),/outside/);
 c.settle(ws,t,ok);assert.throws(()=>c.begin(ws,'other-session','b','write',{}),/Another session/);
});
test('C09 stale results after user revision cannot restore completed state',()=>{
 const {ws,c}=fixture(),t=c.begin(ws,'session','a','write',{});
 c.ingest(ws,'session','revision','改成深色');fs.writeFileSync(path.join(ws,'app.js'),'old attempt');
 const r=c.settle(ws,t,ok);assert.equal(r.stale,true);assert.equal(c.read(ws).status,'needs-plan');
 assert.throws(()=>c.verifyResult(ws,t,['works'],'test',ok,snapshot(ws).digest),/stale/);
});
test('C08 bounded calls and cancellation do not convert failure into completion',()=>{
 const {ws,c}=fixture();c.options.maxRequests=1;c.request(ws,'req');c.request(ws,'req');assert.equal(c.read(ws).usage.requests,1);
 assert.throws(()=>c.request(ws,'req2'),/budget/);
 c.ingest(ws,'session','stop','停止');assert.match(c.guard(ws,'session','pwsh'),/stop/);
 assert.throws(()=>c.deliver(ws),/verification/);
});
test('C09 interrupted actions are unknown, never silently replayed',()=>{
 const {ws,c}=fixture(),t=c.begin(ws,'session','a','write',{});t.unlock();
 c.update(ws,s=>{s.pending.a.pid=2147483647;});
 const restored=new Controller(c.store.root);restored.recover(ws);
 assert.equal(restored.read(ws).status,'blocked');assert.ok(restored.read(ws).pending.a);
 assert.match(restored.guard(ws,'session','write'),/blocked/);
});
test('C10 lossless artifact and conservative output reduction',()=>{
 const {c}=fixture(),id=c.store.artifact(ok);assert.deepEqual(JSON.parse(c.store.artifactRead(id)),ok);
 const content=[{type:'text',text:['PASS fine\n'.repeat(2000),'ERROR middle failure','unknown important output'].join('\n')}];
 const short=summarizeOutput(content,1000);assert.match(short,/ERROR middle failure/);assert.match(short,/unknown important/);
 assert.equal(summarizeOutput([{type:'text',text:'x'.repeat(10000)}],100),null);
});
test('corrupt or future state cannot be overwritten',()=>{
 const {ws,c}=fixture(),file=c.store.file(fs.realpathSync.native(ws));fs.writeFileSync(file,'{"schema":99,"revision":2}');
 assert.throws(()=>c.read(ws),/unsupported/);assert.match(fs.readFileSync(file,'utf8'),/99/);
 fs.writeFileSync(file,'{bad');assert.throws(()=>c.read(ws),/corrupt/);
});
test('verification failed, timed out, no exit status or changed workspace is never accepted',()=>{
 for(const result of [{isError:true}, {isError:false,value:{exitCode:0}}, {...ok,value:{...ok.value,timedOut:true}}, {...ok,value:{...ok.value,exitCode:1}}]){
  const {ws,c}=fixture(),s=c.read(ws);c.verifyResult(ws,{epoch:s.epoch,requirementVersion:s.requirementVersion},['works'],'test',result,snapshot(ws).digest);
  assert.notEqual(c.read(ws).status,'verified');
 }
});
test('input classification keeps direct discussion read-only',()=>{
 assert.equal(classify('先别动，我想问问为什么这样'),'stop');assert.equal(classify('为什么这样'),'discussion');
 assert.equal(classify('导出点了没反应，修好'),'work');assert.equal(classify('不要登录了，我自己用'),'work');
 assert.equal(classify('继续把网页验收完，不要修改我新增的 user-note.txt'),'work');
 assert.equal(classify('不要修改代码，只解释问题'),'discussion');
});
test('external changes block blind overwrite before any write starts',()=>{
 const {ws,c}=fixture();fs.writeFileSync(path.join(ws,'app.js'),'user edit');
 assert.throws(()=>c.begin(ws,'session','overwriter','write',{}),/external workspace/);
 assert.equal(c.read(ws).status,'blocked');assert.equal(Object.keys(c.read(ws).pending).length,0);
});
test('duplicate settlement charges observation once and failure budget stops subsequent writes',()=>{
 const {ws,c}=fixture(),t=c.begin(ws,'session','same','pwsh',{});c.settle(ws,t,ok);c.settle(ws,t,ok);
 assert.equal(c.read(ws).usage.observations,1);c.options.maxFailures=1;
 const s=c.read(ws);c.verifyResult(ws,s,['works'],'exit 1',{...ok,value:{...ok.value,exitCode:1}},snapshot(ws).digest);
 assert.match(c.guard(ws,'session','write'),/blocked/);assert.throws(()=>c.deliver(ws),/verification/);
});
test('environment change cannot reuse an otherwise matching verification',()=>{
 const {ws,c}=fixture(),s=c.read(ws),original=process.env.DEVKIT_BROWSER_PATH;
 c.verifyResult(ws,s,['works'],'check',ok,snapshot(ws).digest);
 try{process.env.DEVKIT_BROWSER_PATH='changed-browser-binary';assert.throws(()=>c.deliver(ws),/invalidated/);}
 finally{if(original===undefined)delete process.env.DEVKIT_BROWSER_PATH;else process.env.DEVKIT_BROWSER_PATH=original;}
});
