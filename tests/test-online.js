// Test online simulado: 3 clientes (A anfitrión, B, C) conectados por un
// canal falso que imita Supabase Realtime (broadcast con self:false + presence).
// A se salva en la ronda 1 y mira la ronda 2 como espectador: debe ver TODAS
// las apuestas en bocadillos y el total al resolver.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEl(tag) {
  const e = {
    tag, children: [], _html: '', textContent: '', _parent: null,
    style: {}, disabled: false, title: '', onclick: null, value: '',
    appendChild(c) { c._parent = e; e.children.push(c); return c; },
    _listeners: {},
    addEventListener(ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    fire(ev) { (e._listeners[ev] || []).forEach(fn => fn()); if (ev === 'click' && e.onclick) e.onclick(); },
    classList: null,
    querySelectorAll(sel) {
      const out = [];
      const cls = sel[0] === '.' ? sel.slice(1) : null;
      const stack = [...e.children];
      while (stack.length) {
        const n = stack.pop();
        if (cls && (n.className || '').split(' ').indexOf(cls) !== -1) out.push(n);
        stack.push(...(n.children || []));
      }
      return out;
    },
    querySelector() { return null; },
    insertBefore(c) { c._parent = e; e.children.unshift(c); return c; },
    remove() { if (e._parent) e._parent.children = e._parent.children.filter(x => x !== e); },
  };
  const clsSet = new Set();
  e.classList = {
    toggle(c, force) {
      if (force === undefined) clsSet.has(c) ? clsSet.delete(c) : clsSet.add(c);
      else force ? clsSet.add(c) : clsSet.delete(c);
    },
    add(c) { clsSet.add(c); }, remove(c) { clsSet.delete(c); }, contains(c) { return clsSet.has(c); }
  };
  Object.defineProperty(e, 'className', {
    get() { return [...clsSet].join(' '); },
    set(v) { clsSet.clear(); (v || '').split(' ').filter(Boolean).forEach(c => clsSet.add(c)); }
  });
  Object.defineProperty(e, 'innerHTML', {
    get() { return e._html; },
    set(v) { e._html = v; e.children = []; e.textContent = String(v).replace(/<[^>]*>/g, ''); }
  });
  Object.defineProperty(e, 'firstChild', { get() { return e.children[0] || null; } });
  return e;
}

// ---- red falsa ----
const netClients = [];
function makeFakeSupabase() {
  return {
    createClient() {
      return {
        channel(name, opts) {
          const ch = {
            _handlers: {}, _presence: {},
            _key: (opts && opts.config && opts.config.presence && opts.config.presence.key) || 'x',
            on(type, filter, fn) {
              (ch._handlers[filter.event] = ch._handlers[filter.event] || []).push(fn);
              return ch;
            },
            send(msg) {
              netClients.forEach(o => {
                if (o.ch === ch) return; // self:false
                (o.ch._handlers[msg.event] || []).forEach(fn => fn(msg.payload));
              });
            },
            track(data) {
              ch._presence[ch._key] = [data];
              netClients.forEach(o => { (o.ch._handlers['sync'] || []).forEach(fn => fn()); });
            },
            presenceState() {
              const st = {};
              netClients.forEach(o => Object.assign(st, o.ch._presence));
              return st;
            },
            subscribe(cb) { netClients.push({ ch }); cb('SUBSCRIBED'); return ch; }
          };
          return ch;
        }
      };
    }
  };
}

function newClient(name) {
  const byId = {};
  const sandbox = {
    console,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    Math, JSON, Object, Array, String, Number,
    navigator: {},
    localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } },
    window: {},
    document: {
      getElementById(id) { return byId[id] || (byId[id] = makeEl('div#' + id)); },
      createElement(t) { return makeEl(t); },
      querySelectorAll() { return []; },
    },
    supabase: makeFakeSupabase(),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const dir = path.join(__dirname, '..');
  vm.runInNewContext(
    fs.readFileSync(path.join(dir, 'logic.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(dir, 'app.js'), 'utf8'),
    sandbox);
  const doc = sandbox.document;
  const $ = (id) => doc.getElementById(id);
  $('input-name').value = name;
  return { doc, $, name };
}

function deepText(n) {
  let t = n.textContent || '';
  (n.children || []).forEach(c => { t += ' ' + deepText(c); });
  return t;
}
function hasClass(n, c) { return (n.className || '').split(' ').indexOf(c) !== -1; }
function walk(root, cb) {
  const stack = [root];
  while (stack.length) { const n = stack.pop(); cb(n); stack.push(...(n.children || [])); }
}
function findBtn(client, text) {
  let found = null;
  walk(client.$('actions'), n => {
    if (!found && n.tag && n.tag.indexOf('button') === 0 &&
      (n.onclick || (n._listeners.click && n._listeners.click.length)) &&
      !n.disabled && n.textContent === text) found = n;
  });
  return found;
}
function clickNum(client, num) {
  let target = null;
  walk(client.$('actions'), n => {
    if (!target && n.tag && n.tag.indexOf('button') === 0 && n.textContent === String(num) && !n.disabled) target = n;
  });
  if (target) target.fire('click');
  return !!target;
}
function hideFor(client, n) {
  if (!clickNum(client, n)) throw new Error(client.name + ': sin botón para esconder ' + n);
  const b = findBtn(client, 'Esconder');
  if (!b) throw new Error(client.name + ': Esconder no habilitado');
  b.fire('click');
}
function guessFor(client, n) {
  if (!clickNum(client, n)) throw new Error(client.name + ': sin botón para adivinar ' + n);
  const b = findBtn(client, 'Adivinar');
  if (!b) throw new Error(client.name + ': Adivinar no habilitado');
  b.fire('click');
}
function bubblesOf(client) {
  const out = {};
  walk(client.$('mesa'), n => {
    if (hasClass(n, 'asiento')) {
      let name = '', bub = null;
      walk(n, x => {
        if (hasClass(x, 'anombre')) name = x.textContent.replace(' (tú)', '');
        if (hasClass(x, 'bocadillo') && !hasClass(x, 'hidden')) bub = x.textContent;
      });
      if (bub !== null) out[name] = bub;
    }
  });
  return out;
}
function centroTotalOf(client) {
  let total = null;
  walk(client.$('mesa-centro'), n => { if (hasClass(n, 'centro-total')) total = n.textContent; });
  return total;
}
function seatCountOf(client) {
  let n = 0;
  walk(client.$('mesa'), x => { if (hasClass(x, 'asiento')) n++; });
  return n;
}

let fails = 0;
function ok(c, name) { if (!c) { fails++; console.error('FALLA:', name); } else console.log('ok:', name); }

try {
  const A = newClient('Ana');
  const B = newClient('Beto');
  const C = newClient('Carlos');

  // A crea sala, B y C se unen
  A.$('btn-create').fire('click');
  const code = A.$('lobby-code').textContent;
  ok(/^[A-Z0-9]{4}$/.test(code), 'sala creada con código ' + code);
  B.$('input-code').value = code; B.$('btn-join').fire('click');
  C.$('input-code').value = code; C.$('btn-join').fire('click');
  ok(B.$('lobby-players').children.length === 3, 'B ve 3 jugadores en el lobby');

  // A (anfitriona) empieza. Ronda 1: todos esconden 1 → total 3. A empieza y dice 3 → salvada.
  A.$('btn-start').fire('click');
  hideFor(A, 1); hideFor(B, 1); hideFor(C, 1);
  guessFor(A, 3); // ¡acierta! se salva
  guessFor(B, 0);
  guessFor(C, 1);
  ok(String(centroTotalOf(A)) === '3', 'A ve el total 3 en el centro al resolver');
  ok(String(centroTotalOf(B)) === '3', 'B ve el total 3 en el centro al resolver');

  // Duelo final: juegan Beto y Carlos; Ana mira salvada.
  const next = findBtn(A, 'Siguiente ronda') || findBtn(A, 'Empezar el duelo');
  ok(!!next, 'la anfitriona puede avanzar al duelo');
  next.fire('click');
  ok(seatCountOf(A) === 3, 'A ve 3 asientos (ella + 2 duelistas): ' + seatCountOf(A));

  // Duelo, ronda 1: B esconde 2, C esconde 1 → total 3. Empieza B (rotación).
  hideFor(B, 2); hideFor(C, 1);
  guessFor(B, 5); // falla
  let bub = bubblesOf(A);
  ok(String(bub['Beto']) === '5', 'A (salvada) ve el bocadillo de Beto con el 5: ' + JSON.stringify(bub));
  ok(/Turno de Carlos/.test(deepText(A.$('mesa-centro'))),
    'A (salvada) ve el turno de Carlos en el centro');
  guessFor(C, 3); // acierta (1 de 3) → el duelo continúa
  ok(String(centroTotalOf(A)) === '3', 'A (salvada) ve el total 3 del duelo en el centro');
  ok(String(centroTotalOf(C)) === '3', 'C ve el total 3 en el centro');
  ok(/Carlos 1/.test(deepText(A.$('mesa-centro'))), 'A ve los aciertos del duelo en el centro');
} catch (e) {
  fails++;
  console.error('FALLA: excepción:', e.stack.split('\n').slice(0, 5).join('\n'));
}

console.log(fails === 0 ? '\nONLINE TEST OK' : '\n' + fails + ' FALLOS');
process.exit(fails === 0 ? 0 : 1);
