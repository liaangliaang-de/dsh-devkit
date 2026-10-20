export function scaffoldSmoke(config){
 const steps=[],samples=[];
 for(let n=0;n<2;n++){
  const row={};
  for(const f of config.fields){
   const value=f.type==='choice'?f.choices[n%f.choices.length]:f.type==='date'?'2026-01-02':['money','number'].includes(f.type)?(n===0?'12.50':'7.25'):`DevKit ${f.name} ${n+1}`;
   row[f.name]=['money','number'].includes(f.type)?Number(value):value;
   steps.push({action:f.type==='choice'?'select':'fill',selector:`#field-${f.name}`,value});
  }
  samples.push(row);steps.push({action:'click',selector:'#add'},{action:'count',selector:'#records tr',value:String(n+1)});
 }
 for(const s of config.summaries){const value=s.operation==='count'?samples.length:samples.reduce((sum,r)=>sum+(s.signField&&r[s.signField]===s.negativeValue?-1:1)*Math.round(r[s.field]*100),0)/100;steps.push({action:'text',selector:`#summary-${s.id}`,value:s.operation==='count'?String(value):value.toFixed(2)});}
 steps.push({action:'reload'},{action:'count',selector:'#records tr',value:'2'},{action:'click',selector:'#records tr:first-child button'},{action:'count',selector:'#records tr',value:'1'});
 const proof=config.fields.find(f=>f.type==='text')??config.fields[0];steps.push({action:'download',selector:'#export',value:String(samples[0][proof.name])});
 return{file:'index.html',steps,coverage:['two valid records','configured summaries','reload persistence','delete','CSV contains retained record'],sampleRecords:samples};
}
