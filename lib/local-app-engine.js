// Bundled generic local CRUD engine. createApp prefixes a validated APP configuration.
document.title = APP.title;
document.querySelector('#app-title').textContent = APP.title;
document.querySelector('#description').textContent = APP.description;
const form = document.querySelector('#record-form'), status = document.querySelector('#status');
let rows = [];
try {
  const data = JSON.parse(localStorage.getItem(APP.storageKey) || '[]');
  if (!Array.isArray(data)) throw Error('存储内容不是列表');
  rows = data;
} catch (e) {
  status.textContent = '无法读取已有数据，不会覆盖原数据。';
  form.dataset.storageFailed = 'true';
}
function save(next) {
  if (form.dataset.storageFailed) throw Error('已有数据读取失败，已阻止覆盖');
  localStorage.setItem(APP.storageKey, JSON.stringify(next));
  rows = next;
}
function today() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
for (const field of APP.fields) {
  const label = document.createElement('label'); label.textContent = field.label;
  const input = document.createElement(field.type === 'choice' ? 'select' : 'input');
  input.id = 'field-' + field.name; input.name = field.name; input.required = field.required !== false;
  if (field.type === 'choice') for (const value of field.choices) {
    const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option);
  } else {
    input.type = ['number','money'].includes(field.type) ? 'number' : field.type;
    if (field.type === 'money') { input.step = '0.01'; input.min = '0.01'; }
    if (field.type === 'number') input.step = 'any';
    if (field.type === 'text') input.maxLength = 2000;
    if (field.type === 'date') input.value = today();
  }
  label.append(input); form.insertBefore(label, document.querySelector('#add'));
}
function render() {
  const body = document.querySelector('#records'); body.replaceChildren(); document.querySelector('#empty').hidden = rows.length > 0;
  for (const row of [...rows].reverse()) {
    const tr = document.createElement('tr');
    for (const f of APP.fields) {
      const td = document.createElement('td'); td.textContent = f.type === 'money' ? Number(row[f.name]).toFixed(2) : String(row[f.name] ?? ''); tr.append(td);
    }
    const cell = document.createElement('td'), button = document.createElement('button');
    button.className = 'delete'; button.textContent = '删除'; button.type = 'button';
    button.addEventListener('click', () => { try { save(rows.filter(r => r.id !== row.id)); status.textContent = ''; render(); } catch(e) { status.textContent = '保存失败：'+e.message; } });
    cell.append(button); tr.append(cell); body.append(tr);
  }
  for (const s of APP.summaries) {
    const value = s.operation === 'count' ? rows.length : rows.reduce((sum,r) => sum + (s.signField && r[s.signField] === s.negativeValue ? -1 : 1) * Math.round(Number(r[s.field]) * 100), 0) / 100;
    document.querySelector('#summary-' + s.id).textContent = s.operation === 'count' ? String(value) : value.toFixed(2);
  }
}
form.addEventListener('submit', event => {
  event.preventDefault(); if (!form.reportValidity()) return;
  const row = {id: Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)};
  for (const f of APP.fields) {
    let value = form.elements.namedItem(f.name).value;
    if (['number','money'].includes(f.type)) {
      value = Number(value); if (!Number.isFinite(value)) { status.textContent = '请输入有效数字'; return; }
      if (f.type === 'money') value = Math.round(value*100)/100;
    }
    row[f.name] = value;
  }
  try {
    save([...rows,row]); status.textContent = '';
    for (const f of APP.fields) if (['text','number','money'].includes(f.type)) form.elements.namedItem(f.name).value = '';
    render();
  } catch(e) { status.textContent = '保存失败：'+e.message; }
});
document.querySelector('#export').addEventListener('click', () => {
  const quote = String.fromCharCode(34), cell = v => quote + String(v ?? '').replaceAll(quote,quote+quote) + quote;
  const csv = [APP.fields.map(f=>cell(f.label)).join(','), ...rows.map(r=>APP.fields.map(f=>cell(r[f.name])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})), link = document.createElement('a');
  link.href = url; link.download = 'records.csv'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
render();
