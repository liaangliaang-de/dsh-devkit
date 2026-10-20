import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {Store,canonical,safePath,hash,invariant} from './core.js';

const OMIT=new Set(['.git','node_modules','.next','.cache','.devkit-artifacts','.dsh-devkit','dist','build','coverage','__pycache__','.browser-check','.browser-check2']);
const EXT=new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx','.html','.htm','.css','.scss','.json','.md','.py','.vue','.svelte','.go','.rs','.yml','.yaml','.toml']);
const JS=/\.[cm]?[jt]sx?$/i;
const PARSER_VERSION=`${ts.version}/devkit-map-2`;
const secret=p=>/(^|\/)(?:\.env(?:\.|$)|\.credentials|credentials\.|id_rsa|id_ed25519|secrets?\.)|\.(pem|key|pfx)$/i.test(p);
const lock=p=>/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/.test(p);
const slash=p=>p.replaceAll('\\','/');
function scriptKind(file){return /\.tsx$/i.test(file)?ts.ScriptKind.TSX:/\.jsx$/i.test(file)?ts.ScriptKind.JSX:/\.[cm]?ts$/i.test(file)?ts.ScriptKind.TS:ts.ScriptKind.JS;}
export function parseCode(file,text) {
 const symbols=[],imports=[];
 const add=(name,kind,start,end)=>symbols.push({name,kind,start,end,line:text.slice(0,start).split('\n').length});
 const parse=(source,offset=0)=>{
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,scriptKind(file));
  const visit=node=>{
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))imports.push(node.moduleSpecifier.text);
   if(ts.isCallExpression(node)&&node.arguments.length&&ts.isStringLiteral(node.arguments[0])&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(ast)==='require'))imports.push(node.arguments[0].text);
   if(node.name&&(ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isMethodDeclaration(node)||ts.isVariableDeclaration(node))){const statement=ts.isVariableDeclaration(node)&&node.parent.declarations?.length===1&&ts.isVariableStatement(node.parent.parent)?node.parent.parent:node;add(node.name.getText(ast),ts.SyntaxKind[node.kind],offset+statement.getStart(ast),offset+statement.getEnd());}
   ts.forEachChild(node,visit);
  };visit(ast);return ast;
 };
 let diagnostics=[];
 if(JS.test(file)){const ast=parse(text);diagnostics=ast.parseDiagnostics.map(d=>({start:d.start,code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}));}
 else if(/\.html?$/i.test(file)){
  for(const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))parse(m[1],m.index+m[0].indexOf('>')+1);
  for(const m of text.matchAll(/<(title|h[1-6]|button|input|textarea|select)\b[^>]*(?:>[\s\S]*?<\/\1\s*>|\/?>)/gi))add(m[0].match(/\bid=["']([^"']+)/i)?.[1]??m[1],`html:${m[1]}`,m.index,m.index+m[0].length);
 }
 else if(file.endsWith('.py'))for(const m of text.matchAll(/^(\s*)(?:async\s+)?(def|class)\s+(\w+)/gm))add(m[3],`python-lexical:${m[2]}`,m.index,m.index+m[0].length);
 return {symbols:symbols.slice(0,300),imports:[...new Set(imports)],diagnostics,parser:JS.test(file)?`typescript-${ts.version}`:/\.html?$/i.test(file)?`html-regions/typescript-${ts.version}`:'lexical-only'};
}
const expansions=[[/导出|CSV/i,['export','csv','download','Blob']],[/标题/,['title','h1','header']],[/没反应|点不了|按钮/,['onclick','addEventListener','button','handler']],[/太乱|布局|排版/,['layout','grid','container','style','header']],[/记账|余额|金额/,['amount','balance','record','income','expense']],[/登录|账号/,['login','auth','session','account']]];
function terms(query){const set=new Set((query.match(/[A-Za-z_$][\w$.-]{1,50}/g)??[]).map(s=>s.toLowerCase()));for(const [rx,words]of expansions)if(rx.test(query))words.forEach(s=>set.add(s.toLowerCase()));return [...set].slice(0,30);}

export class Materials {
 constructor(root,options={}){this.store=new Store(path.join(root,'materials'));this.options={maxFiles:3000,maxBytes:12*1024*1024,maxFileBytes:256*1024,...options};this.memory=new Map();}
 scan(workspace){
  const root=canonical(workspace),files=[],warnings=[];let bytes=0,visited=0;
  const walk=dir=>{
   for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(OMIT.has(entry.name)||entry.isSymbolicLink())continue;
    const full=path.join(dir,entry.name),rel=slash(path.relative(root,full));
    if(++visited>this.options.maxFiles*4){warnings.push('directory-entry budget reached');return;}
    if(entry.isDirectory()){walk(full);continue;}
    if(!entry.isFile()||!EXT.has(path.extname(entry.name))||secret(rel)||lock(rel))continue;
    const size=fs.statSync(full).size;
    if(size>this.options.maxFileBytes){warnings.push(`large file omitted: ${rel}`);continue;}
    if(files.length>=this.options.maxFiles||bytes+size>this.options.maxBytes){warnings.push('source byte/file budget reached');return;}
    const text=fs.readFileSync(full,'utf8');if(text.includes('\0'))continue;bytes+=size;files.push({path:rel,text,hash:hash(text),size});
   }
  };walk(root);
  let cache=this.memory.get(root)??this.store.read(root);if(!cache||cache.parser!==PARSER_VERSION)cache={schema:1,revision:0,parser:PARSER_VERSION,files:{}};
  let cacheHits=0,parsed=0;const next={};
  for(const file of files){const old=cache.files[file.path];if(old?.hash===file.hash){file.info=old.info;cacheHits++;}else{file.info=parseCode(file.path,file.text);parsed++;}next[file.path]={hash:file.hash,info:file.info};}
  if(parsed||Object.keys(next).length!==Object.keys(cache.files).length)this.store.transaction(root,()=>({schema:1,revision:0}),s=>{s.parser=PARSER_VERSION;s.files=next;});
  this.memory.set(root,{...cache,files:next});if(this.memory.size>8)this.memory.delete(this.memory.keys().next().value);
  const available=new Map(files.map(f=>[f.path,f]));
  const resolve=(from,imp)=>{
   if(!imp.startsWith('.'))return null;const stem=slash(path.posix.normalize(path.posix.join(path.posix.dirname(from),imp)));
   const stems=[stem,...(/\.[mc]?js$/.test(stem)?[stem.replace(/\.[mc]?js$/,'.ts'),stem.replace(/\.[mc]?js$/,'.tsx')]:[])];
   for(const s of stems)for(const candidate of [s,...['.ts','.tsx','.js','.jsx','.mjs','.json','/index.ts','/index.js'].map(ext=>s+ext)])if(available.has(candidate))return candidate;return null;
  };
  for(const file of files)file.dependencies=file.info.imports.map(module=>({module,path:resolve(file.path,module)}));
  let manifest=null;const pkg=available.get('package.json');if(pkg)try{const p=JSON.parse(pkg.text);manifest={scripts:p.scripts??{},dependencies:Object.keys({...p.dependencies,...p.devDependencies}),name:p.name??null};}catch{warnings.push('package.json is not valid JSON');}
  return {root,files,digest:hash(files.map(f=>[f.path,f.hash])),manifest,stats:{files:files.length,bytes,parsed,cacheHits},warnings:[...new Set(warnings)].slice(0,12)};
 }
 reference(root,file,start,end,version){
  const text=file.text.slice(start,end);const ref={kind:'devkit-source-span',workspace:root,path:file.path,fileHash:file.hash,start,end,text,version};
  return {ref:this.store.artifact(ref),path:file.path,line:file.text.slice(0,start).split('\n').length,endLine:file.text.slice(0,end).split('\n').length,text};
 }
 query(workspace,{query='',path:filterPath,maxCharacters=6000,version=0,startLine,endLine}={}){
  invariant(Number.isSafeInteger(maxCharacters)&&maxCharacters>=1000&&maxCharacters<=16000,'context budget must be 1000..16000 characters');
  const index=this.scan(workspace),words=terms(query),candidates=[];
  for(const file of index.files){
   if(filterPath&&file.path!==slash(filterPath))continue;
   const pathBoost=words.reduce((n,w)=>n+(file.path.toLowerCase().includes(w)?5:0),0);
   if(startLine!==undefined){invariant(Number.isInteger(startLine)&&startLine>0&&Number.isInteger(endLine)&&endLine>=startLine&&endLine-startLine<=200,'invalid line range');const lines=file.text.split(/\n/);invariant(startLine<=lines.length,'line outside file');const start=lines.slice(0,startLine-1).reduce((n,l)=>n+l.length+1,0),end=Math.min(file.text.length,lines.slice(0,endLine).reduce((n,l)=>n+l.length+1,0));candidates.push({file,start,end,score:100,label:'explicit-lines'});continue;}
   for(const sym of file.info.symbols){let score=pathBoost;const name=sym.name.toLowerCase(),body=file.text.slice(sym.start,sym.end).toLowerCase();for(const word of words)score+=(name.includes(word)?9:0)+(body.includes(word)?2:0);if(/标题/.test(query)&&['app','title','h1','app-title'].includes(name))score+=10;if(score>0)candidates.push({file,start:sym.start,end:sym.end,score,label:sym.name});}
   let first=-1;for(const word of words){const offset=file.text.toLowerCase().indexOf(word);if(offset!==-1&&(first===-1||offset<first))first=offset;}
   if(first>=0){const start=Math.max(0,file.text.lastIndexOf('\n',Math.max(0,first-300))+1);candidates.push({file,start,end:Math.min(file.text.length,start+2000),score:pathBoost+3,label:'text-match'});}
   if(!words.length||/^(README(?:\.md)?|package\.json|index\.html)$/.test(file.path))candidates.push({file,start:0,end:Math.min(file.text.length,1600),score:pathBoost+(file.path==='package.json'?3:1),label:'entry'});
  }
  candidates.sort((a,b)=>b.score-a.score||a.file.size-b.file.size);
  const snippets=[],seen=new Set();
  const result={repository:index.digest,stack:index.manifest,stats:index.stats,warnings:index.warnings,entryFiles:index.files.filter(f=>/^(src\/)?(index|main|app|server)\.|^README|^package\.json|test|spec/.test(f.path)).slice(0,16).map(f=>({path:f.path,symbols:f.info.symbols.slice(0,5).map(s=>s.name)})),snippets,related:[],budget:{maxCharacters,usedCharacters:0,truncated:false}};
  for(const item of candidates){const key=`${item.file.path}:${item.start}`;if(seen.has(key))continue;seen.add(key);
   const remaining=maxCharacters-JSON.stringify(result).length-350;if(remaining<150){result.budget.truncated=true;break;}
   const end=Math.min(item.end,item.start+Math.min(remaining,2200));const snippet=this.reference(index.root,item.file,item.start,end,version);snippet.symbol=item.label;snippets.push(snippet);
   if(JSON.stringify(result).length>maxCharacters-100){snippets.pop();result.budget.truncated=true;break;}
   if(snippets.length>=5){result.budget.truncated=candidates.length>5;break;}
  }
  const chosen=new Set(snippets.map(s=>s.path));result.related=index.files.filter(f=>chosen.has(f.path)||f.dependencies.some(d=>chosen.has(d.path))).slice(0,6).map(f=>({path:f.path,imports:f.dependencies.filter(d=>d.path).map(d=>d.path).slice(0,6)}));
  while(JSON.stringify(result).length>maxCharacters-60){if(result.related.length)result.related.pop();else if(result.entryFiles.length)result.entryFiles.pop();else if(result.snippets.length)result.snippets.pop();else {result.stack=null;result.warnings=['context budget exhausted'];break;}result.budget.truncated=true;}
  result.budget.usedCharacters=JSON.stringify(result).length;
  return result;
 }
 preparePatch(workspace,id,replacement,version){
  invariant(typeof replacement==='string','replacement required');const ref=JSON.parse(this.store.artifactRead(id));
  const root=canonical(workspace);invariant(ref.kind==='devkit-source-span'&&ref.workspace===root,'source reference belongs to another workspace');invariant(ref.version===version,'source reference is from an old requirement');
  const full=safePath(root,ref.path);invariant(!secret(ref.path),'secret file is not a patch target');const text=fs.readFileSync(full,'utf8');
  invariant(hash(text)===ref.fileHash&&text.slice(ref.start,ref.end)===ref.text,'source changed; fetch a fresh context reference before patching');
  const content=text.slice(0,ref.start)+replacement+text.slice(ref.end);
  if(JS.test(ref.path))invariant(parseCode(ref.path,content).diagnostics.length<=parseCode(ref.path,text).diagnostics.length,'patch introduces a syntax error');
  return {file_path:ref.path,original:text,content,change:{start:ref.start,end:ref.end,replacedCharacters:ref.text.length,replacementCharacters:replacement.length,fileCharacters:text.length}};
 }
 dispose(){this.memory.clear();}
}
