import {Store,invariant,now} from './core.js';
import {randomUUID} from 'node:crypto';

export class UsageLedger {
 constructor(root,{requestLimit,reportedTokenLimit}={}){this.store=new Store(root);this.requestLimit=requestLimit;this.reportedTokenLimit=reportedTokenLimit;}
 reserve(options={}){
  const id=randomUUID();
  this.store.transaction('global-model-budget',()=>({schema:1,revision:0,count:0,attempts:[]}),s=>{
   invariant(!this.requestLimit||s.count<this.requestLimit,'global model request cap reached');
   invariant(!this.reportedTokenLimit||(s.usage?.totalTokens??0)<this.reportedTokenLimit,'reported token budget reached; no new request');
   s.count++;s.attempts.push({id,at:now(),provider:options.provider??null,model:options.model??null});
  });return id;
 }
 observe(id,usage){
  const keys=['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalTokens'];
  this.store.transaction('global-model-budget',()=>{throw new Error('missing reservation');},s=>{
   const attempt=s.attempts.find(a=>a.id===id);invariant(attempt,'unknown model attempt');if(attempt.usage)return;
   attempt.usage={};s.usage??={};
   for(const key of keys){const value=usage[key];if(Number.isSafeInteger(value)&&value>=0){attempt.usage[key]=value;s.usage[key]=(s.usage[key]??0)+value;}}
   attempt.settledAt=now();
  });
 }
 summary(){const s=this.store.read('global-model-budget');return{reserved:s?.count??0,usage:s?.usage??null,requestLimit:this.requestLimit??null,reportedTokenLimit:this.reportedTokenLimit??null};}
}
