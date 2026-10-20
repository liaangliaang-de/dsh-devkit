import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {Client} from './sdk-client.mjs';
assert.equal(process.platform,'win32','Native host adapter is currently verified on Windows only');
assert.ok(process.env.DSH_TEST_HOME,'Set DSH_TEST_HOME to a dedicated test home first');
const home=fs.realpathSync.native(process.env.DSH_TEST_HOME);
assert.notEqual(home.toLowerCase(),path.resolve(os.homedir(),'.dsh').toLowerCase(),'Never run native probes against the normal user home');
const output=path.resolve('.test-output');fs.mkdirSync(output,{recursive:true});
const run=fs.mkdtempSync(path.join(output,'native-')),fixtures=path.join(run,'fixtures'),cwd=path.join(fixtures,'project');fs.mkdirSync(cwd,{recursive:true});
const full=process.argv.includes('--browser-full'),combo=full?'B-browser-full':'core';
const report=path.join(run,'report.json'),patch=path.join(run,'probe.patch.yml');
const base=import.meta.dirname;
fs.writeFileSync(patch,`- insert:\n    - id: devkit-no-inference\n      name: ${JSON.stringify(path.join(base,'no-inference.mjs'))}\n- id: dsh-devkit\n  name: dsh-devkit\n  config:\n    stateRoot: ${JSON.stringify(path.join(run,'state'))}\n    workspaceRoots: ${JSON.stringify([fixtures])}\n- insert:\n    - id: devkit-native-probe\n      name: ${JSON.stringify(path.join(base,'native-probe.mjs'))}\n      config: ${JSON.stringify({workspace:cwd,report,combo})}\n`);
const client=new Client({home,cwd,patch,profile:process.env.DSH_TEST_PROFILE??'sdk',permissionMode:full?'danger-full-access':'workspace-write',log:path.join(run,'host.jsonl')});
try{
 await client.call('initialize',{cwd,provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'low',maxTokens:100});
 const result=JSON.parse(fs.readFileSync(report,'utf8'));
 console.log(JSON.stringify({status:result.status,cases:result.cases.map(c=>({id:c.id,status:c.status})),report}));
 if(result.status!=='PASS')process.exitCode=1;
}finally{await client.close();}
