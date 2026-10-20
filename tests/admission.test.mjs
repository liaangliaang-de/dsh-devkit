import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {interpret} from '../src/intent.js';
import {Controller} from '../src/core.js';

test('reported natural requests admit work while informational questions never grant write intent',()=>{
 const discussion=['dsh-devkit装了个新插件你看看有什么用','他报错了吗','帮我看看这个插件有什么用','这个插件怎么用','这个插件是做什么的','怎么修复这个问题','如何添加导出功能','只解释怎么新增功能，不要写代码','这个模块为什么要修改','我已经加了功能，只想问为什么失败','how do I add an export button?'];
 const work=['能不能加个导出功能','加一个导出按钮','帮我添加个导出功能','新增一个登录页面','给我做个记账本','我想做一个待办清单','这个功能有点问题','页面打不开','这个按钮没反应','帮我安装这个插件','为什么报错，并帮我修复','can you add an export button?'];
 for(const active of [false,true]){
  for(const text of discussion)assert.equal(interpret(text,{active}).intent,'discussion',`${active}: ${text}`);
  for(const text of work)assert.equal(interpret(text,{active}).intent,'work',`${active}: ${text}`);
  for(const text of ['先别动，我想看看怎么改','停止','等一下','先不要改'])assert.equal(interpret(text,{active}).intent,'stop',text);
 }
 // A vague complaint still needs context, rather than authorizing a new task in an unrelated session.
 assert.equal(interpret('太慢了').intent,'unknown');assert.equal(interpret('太慢了',{active:true}).intent,'work');
});

test('read-only discovery cannot manufacture a task, and contextual revisions are scoped to their actual session',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-admission-')),ws=path.join(root,'project');fs.mkdirSync(ws);
 try{
  const c=new Controller(path.join(root,'state'));
  c.ingest(ws,'s','intro','dsh-devkit装了个新插件你看看有什么用');c.ingest(ws,'s','error-question','他报错了吗');
  assert.equal(c.read(ws).status,'unmanaged');assert.equal(c.read(ws).requirementVersion,0);
  assert.throws(()=>c.plan(ws,'s',{goal:'model-invented task',criteria:[{id:'a',description:'a',kind:'command'}]}),/stopped|work request/);
  c.ingest(ws,'s','request','能不能加个导出功能');assert.equal(c.read(ws).status,'needs-plan');assert.equal(c.read(ws).requirementVersion,1);
  c.plan(ws,'s',{goal:'export',criteria:[{id:'a',description:'export works',kind:'command'}]});
  c.ingest(ws,'other-session','vague','太慢了');assert.equal(c.read(ws).requirementVersion,1);assert.equal(c.read(ws).messages.at(-1).intent,'unknown');
  c.ingest(ws,'s','vague-in-task','太慢了');assert.equal(c.read(ws).requirementVersion,2);
  c.ingest(ws,'s','question-after-work','他报错了吗');assert.equal(c.read(ws).mode,'read-only');assert.equal(c.read(ws).requirementVersion,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
