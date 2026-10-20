import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
const allowed=new Set(['initialize','shutdown']);
export class Client{
 constructor({home,cwd,patch,log,profile='sdk',permissionMode='workspace-write'}){
  const installation=process.env.DSH_INSTALLATION??path.join(process.env.LOCALAPPDATA??'','Programs/DeepSeek Harness');
  const exe=path.join(installation,'DeepSeek Harness.exe');
  if(!fs.existsSync(exe))throw new Error('Set DSH_INSTALLATION to the local DeepSeek Harness installation');
  this.seq=0;this.pending=new Map();this.errors='';
  this.proc=spawn(exe,['--expose-internals',path.join(installation,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'--profile',profile,'--patch',patch],{cwd,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,MDCG_AUX_ROOT:path.join(home,'mdcg-aux'),DSH_PERMISSION_MODE:permissionMode,NO_COLOR:'1'}});
  createInterface({input:this.proc.stdout}).on('line',line=>{
   if(log)fs.appendFileSync(log,line+'\n');let msg;try{msg=JSON.parse(line);}catch{return;}
   if(msg.id!==undefined){const p=this.pending.get(msg.id);if(p){clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result);}}
  });
  this.proc.stderr.on('data',b=>{this.errors+=b.toString();if(log)fs.appendFileSync(log+'.stderr',b);});
  this.proc.on('error',e=>this.rejectAll(e));this.proc.on('exit',code=>this.rejectAll(new Error(`Host exited ${code}: ${this.errors.slice(-1500)}`)));
 }
 rejectAll(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
 call(method,params={},timeout=120000){
  if(!allowed.has(method))throw new Error('This test client does not expose model prompt or continuation methods');
  const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`RPC timeout: ${method}`));},timeout);this.pending.set(id,{resolve,reject,timer});this.proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 }
 async close(){if(this.proc.exitCode===null){try{await this.call('shutdown',{},10000);}catch{this.proc.stdin.end();}}}
}
