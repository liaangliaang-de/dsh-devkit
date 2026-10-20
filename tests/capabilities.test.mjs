import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Materials,parseCode} from '../src/materials.js';
import {Controller,Store,snapshot} from '../src/core.js';
import {UsageLedger} from '../src/usage.js';
import {interpret} from '../src/intent.js';
import {createApp} from '../src/scaffold.js';
import {scaffoldSmoke} from '../src/smoke.js';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-cap-')),ws=path.join(root,'workspace');fs.mkdirSync(ws);return{root,ws,m:new Materials(path.join(root,'state'))};}
const ok={isError:false,value:{kind:'foreground',exitCode:0,timedOut:false,aborted:false},content:[]};
test('contextual colloquial revision activates work, while a new vague remark does not authorize a task',()=>{
 assert.equal(interpret('这个页面太乱',{active:true}).intent,'work');assert.equal(interpret('这个页面太乱').intent,'unknown');
 assert.equal(interpret('先别动，看看为什么',{active:true}).intent,'stop');
 const r=interpret('导出点了没反应，自己用不要登录',{active:true});assert.equal(r.intent,'work');assert.ok(r.features.some(f=>f.id==='export'));
 for(const f of r.features)assert.equal(r.source.slice(f.source.start,f.source.end),f.source.text);
 assert.equal(r.defaults[0].confirmed,false);
});
test('real compiler AST handles exported async functions, class methods, imports and JSX',()=>{
 const r=parseCode('app.tsx',`import {save} from './storage.js'; export async function exportCsv(x: string){ return save(x); } class Screen { render(){return <button/>;} }`);
 assert.equal(r.diagnostics.length,0);assert.ok(r.symbols.some(s=>s.name==='exportCsv'));assert.ok(r.symbols.some(s=>s.name==='render'));assert.deepEqual(r.imports,['./storage.js']);
});
test('repository graph resolves .js imports to TS and cache keys depend on contents rather than timestamps',()=>{
 const {ws,m}=fixture();fs.writeFileSync(path.join(ws,'main.ts'),`import {save} from './storage.js'; export const app=save;`);fs.writeFileSync(path.join(ws,'storage.ts'),'export function save(){return 1;}');
 let index=m.scan(ws);assert.equal(index.files.find(f=>f.path==='main.ts').dependencies[0].path,'storage.ts');assert.equal(index.stats.parsed,2);
 assert.equal(m.scan(ws).stats.cacheHits,2);const file=path.join(ws,'storage.ts'),time=fs.statSync(file).mtime;
 fs.writeFileSync(file,'export function save(){return 2;}');fs.utimesSync(file,time,time);
 index=m.scan(ws);assert.equal(index.stats.parsed,1);assert.equal(index.stats.cacheHits,1);
 fs.unlinkSync(file);index=m.scan(ws);assert.equal(index.files[0].dependencies[0].path,null);
});
test('query selects export implementation and caller under an explicit material budget; secrets never enter the map',()=>{
 const {ws,m}=fixture();fs.writeFileSync(path.join(ws,'export.ts'),'export function exportCsv(rows: string[]){return rows.join(",");}');fs.writeFileSync(path.join(ws,'main.ts'),'import {exportCsv} from "./export"; export const click=()=>exportCsv([]);');
 fs.writeFileSync(path.join(ws,'.env'),'SECRET_VALUE=do-not-inject');fs.writeFileSync(path.join(ws,'credentials.json'),'{"secret":"do-not-inject"}');
 const r=m.query(ws,{query:'导出点了没反应',version:2,maxCharacters:2200});assert.ok(r.snippets.some(s=>s.path==='export.ts'));
 assert.ok(r.related.some(f=>f.path==='main.ts'));assert.ok(JSON.stringify(r).length<=2200);assert.ok(!JSON.stringify(r).includes('do-not-inject'));
});
test('source-span patches reject user edits, old requirement versions and syntax regressions',()=>{
 const {ws,m}=fixture();fs.writeFileSync(path.join(ws,'export.ts'),'export function exportCsv(){return 1;}');
 const ref=m.query(ws,{query:'exportCsv',version:4,maxCharacters:3000}).snippets.find(s=>s.symbol==='exportCsv');assert.ok(ref);
 const p=m.preparePatch(ws,ref.ref,'export function exportCsv(){return 2;}',4);assert.match(p.content,/return 2/);
 assert.throws(()=>m.preparePatch(ws,ref.ref,'export function exportCsv( {',4),/syntax/);
 assert.throws(()=>m.preparePatch(ws,ref.ref,'x',5),/old requirement/);
 fs.writeFileSync(path.join(ws,'export.ts'),'export function exportCsv(){return 3;}');assert.throws(()=>m.preparePatch(ws,ref.ref,'x',4),/source changed/);
});
test('milestone DAG rejects cycles; verified work becomes needs-recheck after later changes without replaying implementation',()=>{
 const {root,ws}=fixture(),c=new Controller(path.join(root,'control'));fs.writeFileSync(path.join(ws,'app.js'),'const value=1');c.ingest(ws,'s','m','实现两个步骤');
 const criteria=[{id:'a',description:'first',kind:'command'},{id:'b',description:'second',kind:'command'}];
 assert.throws(()=>c.plan(ws,'s',{goal:'x',criteria,tasks:[{id:'one',title:'one',criterionIds:['a'],dependsOn:['two']},{id:'two',title:'two',criterionIds:['b'],dependsOn:['one']}]}),/cyclic/);
 c.plan(ws,'s',{goal:'x',criteria,tasks:[{id:'one',title:'one',criterionIds:['a']},{id:'two',title:'two',criterionIds:['b'],dependsOn:['one']}]});
 c.verifyResult(ws,c.read(ws),['a'],'check a',ok,snapshot(ws).digest);assert.equal(c.read(ws).nextTask,'two');
 const t=c.begin(ws,'s','write','write',{});fs.writeFileSync(path.join(ws,'app.js'),'const value=2');c.settle(ws,t,ok);
 assert.equal(c.read(ws).tasks[0].status,'needs-recheck');assert.equal(c.read(ws).nextTask,'two');
 c.verifyResult(ws,c.read(ws),['a','b'],'check all',ok,snapshot(ws).digest);assert.equal(c.read(ws).tasks.every(t=>t.status==='verified'),true);c.deliver(ws);
 fs.writeFileSync(path.join(ws,'app.js'),'const value=3');const restored=new Controller(c.store.root);restored.recover(ws);assert.equal(restored.read(ws).tasks.every(t=>t.status==='needs-recheck'),true);assert.equal(restored.read(ws).nextTask,'one');assert.equal(restored.read(ws).status,'needs-verification');
});
test('usage ledger preserves previous reservations and counts provider usage once per actual attempt',()=>{
 const {root}=fixture(),store=new Store(root);store.transaction('global-model-budget',()=>({schema:1,revision:0,count:50,attempts:[]}),()=>{});
 const ledger=new UsageLedger(root,{requestLimit:51,reportedTokenLimit:1000});const id=ledger.reserve({provider:'p',model:'m'});ledger.observe(id,{inputTokens:20,outputTokens:5,cacheReadTokens:100,totalTokens:125});ledger.observe(id,{totalTokens:999});
 assert.equal(ledger.summary().reserved,51);assert.equal(ledger.summary().usage.totalTokens,125);assert.throws(()=>ledger.reserve(),/cap reached/);
 const tokenCap=new UsageLedger(root,{requestLimit:80,reportedTokenLimit:120});assert.throws(()=>tokenCap.reserve(),/token budget/);
});
test('generic scaffold produces parseable JS and independently configurable notes/accounting apps',()=>{
 const app=createApp({title:'账本',fields:[{name:'amount',label:'金额',type:'money'},{name:'kind',label:'类型',type:'choice',choices:['收入','支出']}],summaries:[{id:'balance',label:'余额',operation:'sum',field:'amount',signField:'kind',negativeValue:'支出'}]});
 assert.equal(parseCode('app.js',app.files['app.js']).diagnostics.length,0);assert.equal(app.controls.fields[0].selector,'#field-amount');assert.match(app.files['app.js'],/localStorage/);
 const notes=createApp({title:'笔记',fields:[{name:'note',label:'内容',type:'text'}]});assert.notEqual(notes.config.storageKey,app.config.storageKey);
 assert.equal(createApp({title:'新标题',fields:[{name:'note',label:'内容',type:'text'}]}).config.storageKey,notes.config.storageKey);
 assert.throws(()=>createApp({title:'bad',fields:[{name:'id',label:'ID',type:'text'}]}),/reserved/);
});
test('variable source references cover the complete declaration and smoke assertions derive from schema',()=>{
 const {ws,m}=fixture();fs.writeFileSync(path.join(ws,'app.js'),'const APP = {title:"old"};\nconsole.log(APP);');
 const ref=m.query(ws,{query:'APP',maxCharacters:2400,version:1}).snippets.find(s=>s.symbol==='APP');assert.equal(ref.text,'const APP = {title:"old"};');
 const change=m.preparePatch(ws,ref.ref,'const APP = {title:"new"};',1);assert.match(change.content,/console.log\(APP\)/);
 const app=createApp({title:'库存',fields:[{name:'name',label:'物品',type:'text'},{name:'quantity',label:'数量',type:'number'}],summaries:[{id:'quantity',label:'总数',operation:'sum',field:'quantity'}]});
 const smoke=scaffoldSmoke(app.config);assert.ok(smoke.steps.some(s=>s.action==='reload'));assert.ok(smoke.steps.some(s=>s.selector==='#summary-quantity'&&s.value==='19.75'));assert.ok(smoke.steps.at(-1).value.includes('DevKit'));
 assert.equal(interpret('算了，不做了',{active:true}).intent,'stop');assert.equal(interpret('弄个本地小工具').intent,'work');
});
