import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {safePath,invariant,hash,inside} from './core.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function localUrl(url){const u=new URL(url);invariant(['http:','https:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname),'only a loopback HTTP app is supported');return u.href;}
async function connectBrowser(executablePath,root,out) {
 const profile=path.join(out,`chrome-${randomUUID()}`);fs.mkdirSync(profile);
 // The host documents inherited/ignored stdio as the confined-process supported path.
 // Keep the same native shell permission; do not request or silently change sandbox mode.
 const launchLog=path.join(out,'browser-launch.log'),log=fs.openSync(launchLog,'w');
 const child=spawn(executablePath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-crashpad-for-testing','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-proxy-server','about:blank'],{stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
 let launchError;child.on('error',e=>{launchError=e;});
 const portFile=path.join(profile,'DevToolsActivePort');let browser;
 const close=async()=>{
  await browser?.close().catch(()=>{});
  if(child.exitCode===null)child.kill();
  for(let i=0;i<20&&child.exitCode===null;i++)await delay(50);
  invariant(inside(root,path.resolve(profile))&&!fs.lstatSync(profile).isSymbolicLink(),'unexpected browser profile path');
  try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{}
 };
 try{
  for(let i=0;i<150&&!fs.existsSync(portFile);i++){if(launchError)throw launchError;invariant(child.exitCode===null,`browser process exited before readiness (exit ${child.exitCode}); diagnostic: ${fs.readFileSync(launchLog,'utf8').slice(-1500)}`);await delay(100);}
  invariant(fs.existsSync(portFile),'browser debugging endpoint did not become ready');
  const port=Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]);invariant(port>0&&port<65536,'invalid browser port');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:10000});return {browser,close,launchMode:'native-ignored-stdio/local-CDP',profile};
 }catch(e){await close();throw e;}
}

export async function browserCheck(spec) {
 const root=fs.realpathSync.native(spec.workspace),file=spec.url?null:safePath(root,spec.file??'index.html');
 if(file)invariant(fs.existsSync(file),'page file missing');
 const target=spec.url?localUrl(spec.url):pathToFileURL(file).href;
 const browsers=[spec.executablePath,process.env.DEVKIT_BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
 const executablePath=browsers.find(p=>fs.existsSync(p));invariant(executablePath,'Chrome/Edge unavailable; configure DEVKIT_BROWSER_PATH');
 const out=safePath(root,'.devkit-artifacts');fs.mkdirSync(out,{recursive:true});
 const results=[],errors=[];let browser,connection;
 try{
  connection=await connectBrowser(executablePath,root,out);browser=connection.browser;
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
  const page=await context.newPage();page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(target);
  const controls=await page.locator('input,button,select,textarea,a[href]').evaluateAll(elements=>elements.slice(0,60).map(e=>({tag:e.tagName.toLowerCase(),id:e.id||null,label:e.getAttribute('aria-label')||e.getAttribute('placeholder')||(e.labels?.[0]?.innerText??'')||e.innerText?.slice(0,80)||null,type:e.getAttribute('type'),selector:e.id?'#'+CSS.escape(e.id):null})));
  for(const [i,step] of (spec.steps??[]).entries()){
   let detail={};
   try{
    const locator=step.selector?page.locator(step.selector):null;
    switch(step.action){
     case 'fill':await locator.fill(step.value);break;
     case 'click':await locator.click();break;
     case 'select':await locator.selectOption(step.value);break;
     case 'check':await locator.check();break;
     case 'text':invariant((await locator.innerText()).includes(step.value),'expected text not found');break;
     case 'visible':await locator.waitFor({state:'visible'});break;
     case 'count':invariant(await locator.count()===Number(step.value),'unexpected element count');break;
     case 'reload':await page.reload();break;
     case 'download':{
      invariant(typeof step.value==='string'&&step.value.length>0,'download assertion requires value: expected content snippet');
      const wait=page.waitForEvent('download');await locator.click();const download=await wait;
      const dest=path.join(out,`${i}-${path.basename(download.suggestedFilename())}`);await download.saveAs(dest);
      const bytes=fs.readFileSync(dest);detail={file:dest,bytes:bytes.length,sha256:hash(bytes),preview:bytes.toString('utf8').slice(0,600),expectedContains:step.value};invariant(bytes.toString('utf8').includes(step.value),'download content mismatch');
      detail.contentSnippetVerified=true;break;
     }
     default:throw new Error('unsupported browser action');
    }
    results.push({step:i,action:step.action,status:'PASS',...detail});
   }catch(e){results.push({step:i,action:step.action,status:'FAIL',error:e.message,...detail});break;}
  }
  const screenshot=path.join(out,'browser-check.png');await page.screenshot({path:screenshot,fullPage:true,animations:'disabled'});
  return {passed:spec.action==='inspect'?false:results.length>0&&results.length===spec.steps.length&&results.every(r=>r.status==='PASS')&&errors.length===0,inspectionOnly:spec.action==='inspect',results,controls,errors,screenshot,title:await page.title(),executablePath,launchMode:connection.launchMode};
 }finally{await connection?.close();}
}
if(process.argv[2]==='--spec'){
 try{const result=await browserCheck(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));console.log(JSON.stringify(result));process.exitCode=result.passed||(result.inspectionOnly&&result.errors.length===0)?0:1;}
 catch(e){console.log(JSON.stringify({passed:false,error:e.message}));process.exitCode=1;}
}
