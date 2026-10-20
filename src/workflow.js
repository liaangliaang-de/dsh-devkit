function invariant(ok,message){if(!ok)throw new Error(`DEVKIT: ${message}`);}

export function makeWorkflow(tasks,criteria) {
 if(!tasks?.length)return [];
 invariant(tasks.length<=20,'at most 20 milestones');
 const ids=new Set(tasks.map(t=>t.id));invariant(ids.size===tasks.length,'duplicate milestone ids');
 const criterionIds=new Set(criteria.filter(c=>c.kind==='command').map(c=>c.id));
 const normalized=tasks.map(t=>{
  invariant(typeof t.id==='string'&&t.id.length>0&&typeof t.title==='string'&&t.title.trim(),'milestone id/title required');
  invariant(Array.isArray(t.criterionIds)&&t.criterionIds.length>0&&t.criterionIds.every(id=>criterionIds.has(id)),'milestones must reference acceptance criteria');
  const dependsOn=t.dependsOn??[];invariant(dependsOn.every(id=>ids.has(id)&&id!==t.id),'unknown/self dependency');
  return {id:t.id,title:t.title,criterionIds:t.criterionIds,dependsOn,status:'pending',implemented:false};
 });
 const seen=new Set(),visiting=new Set(),map=new Map(normalized.map(t=>[t.id,t]));
 const visit=id=>{invariant(!visiting.has(id),'cyclic milestone dependency');if(seen.has(id))return;visiting.add(id);map.get(id).dependsOn.forEach(visit);visiting.delete(id);seen.add(id);};
 normalized.forEach(t=>visit(t.id));return normalized;
}

export function refreshWorkflow(state,currentDigest,currentEnvironment) {
 const covered=new Set(state.evidence.filter(e=>e.valid&&e.version===state.requirementVersion&&e.epoch===state.epoch&&e.digest===currentDigest&&e.environment===currentEnvironment).flatMap(e=>e.ids));
 for(const task of state.tasks??[]){
  if(task.criterionIds.every(id=>covered.has(id))){task.status='verified';task.implemented=true;}
  else if(task.implemented)task.status='needs-recheck';else task.status='pending';
 }
 const all=state.tasks??[],ready=all.find(t=>!t.implemented&&t.dependsOn.every(id=>all.find(d=>d.id===id)?.implemented));
 state.nextTask=ready?.id??all.find(t=>t.status==='needs-recheck')?.id??null;
 if(ready)ready.status='ready';
}

export function checkpoint(state) {
 return {version:state.requirementVersion,goal:state.contractGoal??state.goal,status:state.status,nextTask:state.nextTask??null,
  milestones:(state.tasks??[]).map(t=>({id:t.id,title:t.title,status:t.status,dependsOn:t.dependsOn})),
  pending:Object.values(state.pending).map(p=>({id:p.id,name:p.name,started:p.started})),
  lastActions:Object.values(state.receipts).slice(-3).map(r=>({name:r.name,stale:r.stale,exitCode:r.exitCode,artifact:r.artifact})),
  reusePolicy:'Inspect current files and evidence before resuming. This checkpoint never replays an action.'};
}
