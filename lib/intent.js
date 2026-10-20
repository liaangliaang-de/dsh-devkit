// Bounded local interpretation supports the primary model; it is not a second model.
export function interpret(text,{active=false}={}) {
 const stop=/^\s*(先别动|先别改|(?:先)?(?:不要|别)(?:动|改)(?:了)?|等一下|停一下|不用了|算了|暂停|停止|取消|stop\b|cancel\b)/i;
 const question=/(只解释|只读|别改代码|read.only)/i;
 let intent='unknown';
 if(stop.test(text))intent='stop';
 else if(question.test(text)||(/(想问问|为什么|explain\b)/i.test(text)&&!/(修好|修复|并修改|然后修改|fix\b)/i.test(text)))intent='discussion';
 else if(/^\s*不要修改(?:代码|项目|任何|文件)/i.test(text))intent='discussion';
 else if(/(做|写|修|建|改|搞个|弄个|整一个|来个|优化|实现|继续|接着|不要登录|build\b|fix\b|create\b|implement\b|change\b|continue\b)/i.test(text))intent='work';
 else if(active&&/(太乱|太挤|看不清|不好用|没反应|点不了|打不开|有问题|报错|不对|太慢|太丑|不喜欢|再简单|换个颜色|不需要登录|doesn.t work|broken|too slow)/i.test(text))intent='work';
 const features=[];
 const rules=[
  [/记账|收支|余额/, 'accounting','优先跑通新增记录→余额更新→持久化，不擅自增加账户系统。'],
  [/导出|CSV|download|export/i,'export','真实触发下载，并检查内容；不要只检查按钮是否存在。'],
  [/太乱|太挤|看不清|不好看|太丑|布局|排版/,'layout','把反馈转为主次、间距、文字可读性等可观察改动；主观满意仍待用户反馈。'],
  [/没反应|点不了|报错|打不开|bug|broken/i,'bug','先定位现有事件/调用链并复现；修复根因后检查相邻行为。'],
  [/不要登录|不需要登录|自己用|本地/,'local-first','优先复用本地存储和现有结构；不要擅自引入登录、服务器或付费服务。'],
 ];
 for(const [pattern,id,guidance]of rules){const match=text.match(pattern);if(match)features.push({id,source:{text:match[0],start:match.index,end:match.index+match[0].length},guidance});}
 return {intent,kind:intent==='work'?(active?'revision':'new-task'):intent,features,
  defaults:[{value:'Reuse the existing stack; choose the smallest runnable vertical slice.',confirmed:false,source:'devkit-default'}],
  source:text,clarificationPolicy:'Ask only when the answer changes irreversible effects, credentials, real cost, or the core user behavior.'};
}
