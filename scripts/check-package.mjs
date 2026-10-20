import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
for(const name of fs.readdirSync('src').filter(n=>n.endsWith('.js'))){
 assert.deepEqual(fs.readFileSync(path.join('src',name)),fs.readFileSync(path.join('lib',name)),`Run npm run build before packaging: ${name}`);
}
fs.mkdirSync('.test-output/pack',{recursive:true});
const [pack]=JSON.parse(execSync('npm pack --ignore-scripts --json --pack-destination .test-output/pack',{encoding:'utf8'}));
const files=new Set(pack.files.map(f=>f.path));
for(const name of ['lib/plugin.js','cordis.patch.yml','LICENSE','THIRD-PARTY-NOTICES.md','node_modules/playwright-core/LICENSE','node_modules/playwright-core/NOTICE','node_modules/typescript/LICENSE.txt','node_modules/typescript/ThirdPartyNoticeText.txt'])assert.ok(files.has(name),`Missing package file: ${name}`);
for(const name of files)assert.ok(!/^(?:\.git|\.github|\.test-output|tests|scripts|installer)\//.test(name),`Development file in runtime package: ${name}`);
assert.ok(pack.bundled.includes('typescript')&&pack.bundled.includes('playwright-core'));
console.log(JSON.stringify({status:'PASS',runtimeSourceEqualsBuild:true,package:pack.filename,files:files.size,bundled:pack.bundled}));
