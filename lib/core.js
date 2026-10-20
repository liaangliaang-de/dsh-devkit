import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import {interpret} from './intent.js';
import {makeWorkflow,refreshWorkflow} from './workflow.js';

export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
export const now = () => new Date().toISOString();
export const environment = () => hash({node:process.version,platform:process.platform,arch:process.arch,executable:process.execPath,browser:process.env.DEVKIT_BROWSER_PATH ?? null});
export function invariant(condition, message) { if (!condition) throw new Error(`DEVKIT: ${message}`); }
export function canonical(dir) { return fs.realpathSync.native(path.resolve(dir)); }
export function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function safePath(root, target) {
  const full = path.resolve(root, target); invariant(inside(root, full), 'path outside workspace');
  let existing = full;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  invariant(inside(canonical(root), canonical(existing)), 'symlink escapes workspace');
  return full;
}
const ignored = new Set(['.git', 'node_modules', '.dsh-devkit', '.devkit-artifacts', '.browser-check', '.next', '.cache', 'coverage', '__pycache__']);
export function snapshot(root, maxFiles = 4000, maxBytes = 32 * 1024 * 1024) {
  root = canonical(root); const files = {}; let bytes = 0;
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name), rel = path.relative(root, full).replaceAll('\\', '/');
      invariant(Object.keys(files).length < maxFiles, 'snapshot file limit exceeded; narrow workspace');
      if (entry.isSymbolicLink()) { files[rel] = `symlink:${fs.readlinkSync(full)}`; continue; }
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const size = fs.statSync(full).size; bytes += size;
        invariant(bytes <= maxBytes, 'snapshot byte limit exceeded; narrow workspace');
        files[rel] = hash(fs.readFileSync(full));
      }
    }
  }
  visit(root); return { digest: hash(files), files };
}
export function delta(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]);
}
export function classify(text,context) { return interpret(text,context).intent; }

/** Atomic JSON transactions. Locks are only reclaimed from provably dead processes. */
export class Store {
  constructor(root) { this.root = path.resolve(root); fs.mkdirSync(this.root, { recursive: true }); }
  file(key) { return path.join(this.root, `${hash(key)}.json`); }
  read(key) {
    const file = this.file(key); if (!fs.existsSync(file)) return null;
    let value; try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('DEVKIT: corrupt state; refusing to overwrite'); }
    invariant(value.schema === 1 && typeof value.revision === 'number', 'unsupported state format');
    return value;
  }
  lock(key) {
    const file = `${this.file(key)}.lock`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const fd = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd); let released=false; return () => { if(released)return; released=true; fs.unlinkSync(file); }; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let owner; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('DEVKIT: invalid lock; manual inspection required'); }
        try { process.kill(owner.pid, 0); throw new Error('DEVKIT: workspace busy'); }
        catch (err) { if (err.code !== 'ESRCH') throw err; fs.unlinkSync(file); }
      }
    }
    throw new Error('DEVKIT: cannot acquire lock');
  }
  transaction(key, create, change) {
    const unlock = this.lock(`state:${key}`);
    try {
      const state = this.read(key) ?? create(); const answer = change(state); state.revision++;
      const file = this.file(key), tmp = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      try { fs.renameSync(tmp, file); } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
      return answer === undefined ? structuredClone(state) : answer;
    } finally { unlock(); }
  }
  artifact(value) {
    const text = JSON.stringify(value, null, 2), id = hash(text);
    const dir = path.join(this.root, 'artifacts'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.json`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, text, { mode: 0o600 });
    return id;
  }
  artifactRead(id) { invariant(/^[a-f0-9]{64}$/.test(id), 'invalid artifact id'); return fs.readFileSync(path.join(this.root, 'artifacts', `${id}.json`), 'utf8'); }
}

function initial(workspace) {
  return { schema: 1, revision: 0, workspace, requirementVersion: 0, epoch: 0, status: 'unmanaged', mode: 'work',
    messages: [], goal: '', assumptions: [], criteria: [], evidence: [], receipts: {}, pending: {}, delivery: 'not-delivered', feedback: 'unknown',
    usage: { requests: 0, tools: 0, observations: 0 }, warnings: [] };
}
export class Controller {
  constructor(root, options = {}) { this.store = new Store(root); this.options = { maxRequests: 100, maxTools: 200, maxFailures: 3, ...options }; }
  read(workspace) { return this.store.read(canonical(workspace)) ?? initial(canonical(workspace)); }
  update(workspace, change) { const root = canonical(workspace); return this.store.transaction(root, () => initial(root), change); }
  ingest(workspace, sessionId, messageId, text) {
    return this.update(workspace, s => {
      if (s.messages.some(m => m.id === messageId)) return;
      const understanding=interpret(text,{active:s.messages.some(m=>m.sessionId===sessionId&&m.intent==='work')}),intent=understanding.intent;
      s.messages.push({ id: messageId, sessionId, text, intent, at: now() });
      if (intent === 'stop' || intent === 'discussion') { s.epoch++; s.mode = intent === 'stop' ? 'stopped' : 'read-only'; if (s.status !== 'unmanaged') s.status = intent === 'stop' ? 'cancelled' : 'paused'; s.delivery='not-delivered'; return; }
      if (intent === 'work') {
        s.requirementVersion++; s.epoch++; s.mode = 'work'; s.status = 'needs-plan'; s.goal = text;
        s.criteria = [];s.contractGoal=null;s.bootstrapAwaitingProbe=false; s.tasks=[];s.nextTask=null; s.delivery = 'not-delivered'; s.feedback = 'unknown';
        s.understanding=understanding;
      }
    });
  }
  plan(workspace, sessionId, args) {
    invariant(typeof args.goal === 'string' && args.goal.trim().length > 0, 'goal required');
    invariant(Array.isArray(args.criteria) && args.criteria.length > 0 && args.criteria.length <= 12, '1..12 criteria required');
    invariant(args.criteria.every(c => typeof c.id === 'string' && typeof c.description === 'string' && ['command','user'].includes(c.kind)), 'invalid criterion');
    invariant(new Set(args.criteria.map(c => c.id)).size === args.criteria.length, 'duplicate criterion ids');
    return this.update(workspace, s => {
      invariant(s.mode === 'work', 'user has stopped or requested discussion');
      invariant(s.messages.some(m => m.intent === 'work' && m.sessionId === sessionId), 'no direct user work request in this session');
      invariant(Object.keys(s.pending).length === 0, 'cannot replace contract while action pending');
      invariant(s.status === 'needs-plan', 'contract already set; require user revision');
      s.contractGoal = args.goal; s.criteria = args.criteria; s.assumptions = args.assumptions ?? [];
      s.tasks=makeWorkflow(args.tasks,args.criteria);s.nextTask=s.tasks.find(t=>t.dependsOn.length===0)?.id??null;
      s.scope = args.scope ?? []; s.status = 'implementing';
      s.baseline = snapshot(workspace); s.observed = s.baseline; s.failures = 0; s.planSession = sessionId;
    });
  }
  guard(workspace, sessionId, name) {
    const s = this.read(workspace);
    if (s.mode !== 'work') return 'User requested stop/discussion; no mutating tools.';
    if (s.status === 'needs-plan') return 'Call devkit_project action=plan with user behaviors and checks before modifying.';
    if (s.status === 'unmanaged') return undefined;
    if(s.bootstrapAwaitingProbe&&['write','edit','devkit_patch','devkit_create'].includes(name))return 'Generated app requires its first actual browser/command smoke check before customization. Use devkit_browser now; repair only a concrete failure.';
    if (s.planSession !== sessionId) return 'Another session owns this project contract.';
    if (s.usage.tools >= this.options.maxTools) return 'Tool budget reached.';
    if (['cancelled', 'blocked'].includes(s.status)) return `Project is ${s.status}.`;
  }
  begin(workspace, sessionId, id, name, args) {
    const denied = this.guard(workspace, sessionId, name); invariant(!denied, denied);
    const unlock = this.store.lock(`writer:${canonical(workspace)}`);
    try {
      const before = snapshot(workspace); let token;
      const current = this.read(workspace);
      if(current.observed && before.digest !== current.observed.digest) {
        this.update(workspace,s=>{s.status='blocked';s.epoch++;s.warnings.push({kind:'external-change',files:delta(s.observed.files,before.files),message:'Inspect user changes before explicit reconciliation; no write started.'});});
        throw new Error('DEVKIT: external workspace changes; inspect files before action=resume');
      }
      this.update(workspace, s => {
        invariant(!s.receipts[id] && !s.pending[id], 'duplicate action id');
        token = { id, name, args, sessionId, pid:process.pid, epoch: s.epoch, requirementVersion: s.requirementVersion, before, started: now() };
        s.pending[id] = token; s.usage.tools++;
      });
      return { ...token, unlock };
    } catch (e) { unlock(); throw e; }
  }
  settle(workspace, token, result) {
    try {
      const after = snapshot(workspace), artifact = this.store.artifact(result);
      return this.update(workspace, s => {
        if (s.receipts[token.id]) return s.receipts[token.id];
        const stale = s.epoch !== token.epoch || s.requirementVersion !== token.requirementVersion;
        const changed = delta(token.before.files, after.files);
        const receipt = { id: token.id, name: token.name, sessionId: token.sessionId, version: token.requirementVersion,
          epoch: token.epoch, stale, artifact, changed, before: token.before.digest, after: after.digest,
          started: token.started, ended: now(), isError: Boolean(result.isError), exitCode: result.value?.exitCode ?? null,
          timedOut: Boolean(result.value?.timedOut), aborted: Boolean(result.value?.aborted), status: 'settled' };
        s.receipts[token.id] = receipt; delete s.pending[token.id]; s.usage.observations++;
        s.observed = after;
        if (changed.length) {
          for (const e of s.evidence) if (e.digest !== after.digest) e.valid = false;
          if (!stale) { s.status = 'implementing'; s.delivery = 'not-delivered'; }
          const outside = s.scope?.length ? changed.filter(p => !s.scope.some(prefix => p === prefix || p.startsWith(`${prefix}/`))) : [];
          if (outside.length) s.warnings.push({ kind: 'scope-change', files: outside, action: token.id });
          if (changed.some(p => /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./.test(p))) s.warnings.push({ kind: 'test-change-review', files: changed, action: token.id });
        }
        if(!stale)refreshWorkflow(s,after.digest,environment());
        return receipt;
      });
    } finally { token.unlock?.(); }
  }
  recover(workspace) {
    return this.update(workspace, s => {
      const interrupted=Object.values(s.pending).filter(p=>{
        if(!p.pid)return true;
        try{process.kill(p.pid,0);return false;}catch(e){return e.code==='ESRCH';}
      });
      if (interrupted.length) { s.epoch++; s.status = 'blocked'; s.warnings.push({ kind: 'interrupted-actions', ids: interrupted.map(p=>p.id), message: 'Inspect artifacts/files; do not replay automatically.' }); }
      const current = snapshot(workspace).digest;
      for (const e of s.evidence) if (e.digest !== current||e.environment!==environment()||e.epoch!==s.epoch||e.version!==s.requirementVersion) e.valid = false;
      refreshWorkflow(s,current,environment());
      if (s.status === 'verified' && !s.evidence.some(e => e.valid)) s.status = 'needs-verification';
    });
  }
  verifyResult(workspace, token, ids, command, result, before) {
    invariant(ids.length > 0, 'criterion ids required');
    const after = snapshot(workspace).digest;
    return this.update(workspace, s => {
      invariant(s.epoch === token.epoch && s.requirementVersion === token.requirementVersion, 'stale verification');
      invariant(ids.every(id => s.criteria.some(c => c.id === id && c.kind === 'command')), 'unknown command criterion');
      const v = result.value;
      const passed = !result.isError && v?.kind === 'foreground' && v.exitCode === 0 && !v.timedOut && !v.aborted && before === after;
      const evidence = { id: randomUUID(), ids, command, digest: after, version: s.requirementVersion, epoch: s.epoch,
        valid: passed, passed, environment: environment(), artifact: this.store.artifact(result), at: now() };
      s.evidence.push(evidence);
      refreshWorkflow(s,after,environment());
      const covered = new Set(s.evidence.filter(e => e.valid && e.version === s.requirementVersion && e.epoch === s.epoch && e.digest === after && e.environment === environment()).flatMap(e => e.ids));
      const checks = s.criteria.filter(c => c.kind === 'command');
      s.status = checks.length && checks.every(c => covered.has(c.id)) ? 'verified' : 'needs-verification';
      s.failures = passed ? 0 : (s.failures ?? 0) + 1;
      if(s.failures >= this.options.maxFailures) {s.status='blocked';s.warnings.push({kind:'failure-budget',count:s.failures});}
      return evidence;
    });
  }
  deliver(workspace) {
    const current = snapshot(workspace).digest;
    return this.update(workspace, s => {
      invariant(s.mode === 'work' && s.status === 'verified', 'technical verification not complete');
      const covered = new Set(s.evidence.filter(e => e.valid && e.version === s.requirementVersion && e.epoch === s.epoch && e.digest === current && e.environment === environment()).flatMap(e => e.ids));
      invariant(s.criteria.filter(c => c.kind === 'command').every(c => covered.has(c.id)), 'evidence invalidated by workspace changes');
      invariant(Object.keys(s.pending).length === 0, 'action still pending');
      invariant(!s.warnings.some(w => ['scope-change','test-change-review'].includes(w.kind) && !w.review), 'review test/scope changes with action=review and a reason');
      s.delivery = 'delivered'; s.feedback = 'awaiting-user';
    });
  }
  request(workspace, id) {
    return this.update(workspace, s => {
      s.requests ??= {};
      if (s.requests[id]) return;
      invariant(s.usage.requests < this.options.maxRequests, 'model request budget reached');
      s.requests[id] = now(); s.usage.requests++;
    });
  }
  summary(workspace) {
    const s = this.read(workspace);
    return { workspace: s.workspace, status: s.status, mode: s.mode, version: s.requirementVersion, epoch: s.epoch,
      goal: s.goal, contractGoal: s.contractGoal ?? null, assumptions: s.assumptions, criteria: s.criteria,
      tasks:s.tasks??[],nextTask:s.nextTask??null,
      nextAction:s.bootstrapAwaitingProbe?'run-first-real-smoke-check':null,
      delivery: s.delivery, feedback: s.feedback, usage: s.usage, warnings: s.warnings.slice(-6),
      pending: Object.keys(s.pending), recentEvidence: s.evidence.slice(-4), recentReceipts: Object.values(s.receipts).slice(-4) };
  }
}

export function summarizeOutput(content, limit = 6000) {
  const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (text.length <= limit) return null;
  // Only shorten recognisable progress/pass lines; retain every other line, especially errors.
  const lines = text.split('\n'), removable = /^(?:\s*(?:PASS\b|✓|✔|Downloading\b|Progress:|\d+%\s*\|)|\s*$)/;
  const kept = lines.filter(line => !removable.test(line));
  const result = kept.join('\n');
  if (result.length >= text.length || result.length > limit) return null;
  return `${result}\n[DevKit omitted ${lines.length-kept.length} progress/pass lines; original artifact available. Not a verification verdict.]`;
}
