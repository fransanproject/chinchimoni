// Test online simulado: 3 clientes (A anfitrión, B, C) conectados por un
// broker PeerJS falso en memoria (WebRTC de mentira: las conexiones
// entregan los mensajes directamente, con 'open' asíncrono).
// A se salva en la ronda 1 y mira la ronda 2 como espectador: debe ver TODAS
// las apuestas en bocadillos y el total al resolver.
// Además: el inicio llega a los invitados y entran en partida (no solo el
// anfitrión), el reenvío del inicio no duplica la ronda, un código sin
// sala avisa sin sala fantasma, y la sala llena (12) rechaza al 13º.
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

// ---- red falsa: broker PeerJS en memoria ----
// Los eventos 'open'/'connection'/'error' son asíncronos (cola deferred
// que el test bombea); los mensajes de datos se entregan al instante,
// como en una conexión WebRTC ya abierta.
const deferred = [];
function defer(fn) { deferred.push(fn); }
function pumpDeferred() {
  for (let round = 0; round < 10 && deferred.length; round++) {
    deferred.splice(0).forEach(fn => fn());
  }
}
const peerRegistry = {};
let guestSeq = 0;
function FakePeer(id) {
  this.id = id || ('guest-' + (++guestSeq) + '-' + Math.random().toString(36).slice(2, 6));
  this._handlers = {};
  if (peerRegistry[this.id]) {
    const self = this;
    defer(function () { self._fire('error', { type: 'unavailable-id' }); });
    return;
  }
  peerRegistry[this.id] = this;
  const self = this;
  defer(function () { self._fire('open', self.id); });
}
FakePeer.prototype.on = function (ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); return this; };
FakePeer.prototype._fire = function (ev, arg) { (this._handlers[ev] || []).forEach(function (fn) { fn(arg); }); };
FakePeer.prototype.connect = function (hostId) {
  const host = peerRegistry[hostId];
  const guestConn = new FakeConn(this, hostId);
  const hostConn = new FakeConn(host, this.id);
  guestConn._other = hostConn; hostConn._other = guestConn;
  if (!host) {
    const self = this;
    defer(function () { self._fire('error', { type: 'peer-unavailable' }); });
    return guestConn;
  }
  defer(function () {
    host._fire('connection', hostConn);
    hostConn.open = true; hostConn._fire('open');
    guestConn.open = true; guestConn._fire('open');
  });
  return guestConn;
};
FakePeer.prototype.destroy = function () { delete peerRegistry[this.id]; };
FakePeer.prototype.reconnect = function () {};
function FakeConn(peer, remoteId) {
  this.peer = remoteId; this.open = false; this._handlers = {}; this._other = null;
}
FakeConn.prototype.on = function (ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); return this; };
FakeConn.prototype._fire = function (ev, arg) { (this._handlers[ev] || []).forEach(function (fn) { fn(arg); }); };
FakeConn.prototype.send = function (msg) { if (this._other) this._other._fire('data', msg); };
FakeConn.prototype.close = function () {
  this.open = false; this._fire('close');
  if (this._other) { this._other.open = false; this._other._fire('close'); }
};

const allClients = [];
function newClient(name) {
  const byId = {};
  const timers = [];
  const sandbox = {
    console,
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms: ms || 0, dead: false }); return id; },
    setInterval: () => 0,
    clearTimeout: (id) => { const t = timers.find(x => x.id === id); if (t) t.dead = true; },
    Math, JSON, Object, Array, String, Number,
    navigator: {},
    localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } },
    window: {},
    document: {
      getElementById(id) { return byId[id] || (byId[id] = makeEl('div#' + id)); },
      createElement(t) { return makeEl(t); },
      querySelectorAll() { return []; },
      addEventListener() {},
      head: makeEl('head'),
      body: makeEl('body'),
    },
    Peer: FakePeer,
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
  // Ejecuta los temporizadores pendientes (los nuevos que se programen esperan al siguiente pump).
  const pumpOnce = () => {
    const batch = timers.filter(t => !t.dead);
    batch.forEach(t => { t.dead = true; });
    batch.forEach(t => t.fn());
  };
  const client = { doc, $, name, pumpOnce };
  allClients.push(client);
  return client;
}
const pumpAll = () => { pumpDeferred(); allClients.forEach(c => c.pumpOnce()); pumpDeferred(); };

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
function inGame(client) { return !hasClass(client.$('screen-game'), 'hidden'); }
function onHome(client) { return !hasClass(client.$('screen-home'), 'hidden'); }

let fails = 0;
function ok(c, name) { if (!c) { fails++; console.error('FALLA:', name); } else console.log('ok:', name); }

try {
  const A = newClient('Ana');
  const B = newClient('Beto');
  const C = newClient('Carlos');

  // A crea sala, B y C se unen
  A.$('btn-create').fire('click');
  pumpAll();
  const code = A.$('lobby-code').textContent;
  ok(/^[0-9]{4}$/.test(code), 'sala creada con código ' + code);
  B.$('input-code').value = code; B.$('btn-join').fire('click');
  C.$('input-code').value = code; C.$('btn-join').fire('click');
  pumpAll();
  ok(B.$('lobby-players').children.length === 3, 'B ve 3 jugadores en el lobby');
  ok(A.$('lobby-players').children.length === 3, 'A ve 3 jugadores en el lobby');

  // A (anfitriona) empieza. El inicio es sincronizado (startAt): hay que
  // bombear para que se aplique en los tres. Los invitados DEBEN entrar
  // en partida, no quedarse en la sala (el bug reportado).
  A.$('btn-start').fire('click');
  pumpAll();
  ok(inGame(A), 'A entra en partida al empezar');
  ok(inGame(B), 'B entra en partida al empezar (no se queda en la sala)');
  ok(inGame(C), 'C entra en partida al empezar (no se queda en la sala)');
  ok(A.$('game-round').textContent === 'Ronda 1', 'A está en la ronda 1');
  pumpAll(); // reenvío del inicio: no debe duplicar la ronda
  ok(B.$('game-round').textContent === 'Ronda 1', 'el reenvío del inicio no duplica la ronda en B');

  // Ronda 1: todos esconden 1 → total 3. A empieza y dice 3 → salvada.
  hideFor(A, 1); hideFor(B, 1); hideFor(C, 1);
  guessFor(A, 3); // ¡acierta! se salva
  guessFor(B, 0);
  guessFor(C, 1); // última apuesta: el resultado espera 1,5s
  let bub0 = bubblesOf(A);
  ok(String(bub0['Ana']) === '3' && String(bub0['Beto']) === '0' && String(bub0['Carlos']) === '1',
    'se ven los 3 bocadillos, incluido el último: ' + JSON.stringify(bub0));
  ok(centroTotalOf(A) === null, 'el resultado aún no se anuncia (espera 1,5s)');
  pumpAll(); // se cumple la espera → se resuelve la ronda
  ok(String(centroTotalOf(A)) === '3', 'A ve el total 3 en el centro al resolver');
  ok(String(centroTotalOf(B)) === '3', 'B ve el total 3 en el centro al resolver');

  // Anuncio grande del salvado: 2s después del resultado, se esconde solo.
  ok(A.$('saved-overlay').classList.contains('hidden'), 'el anuncio está oculto justo al resolver');
  pumpAll();
  var ovTxt = deepText(A.$('saved-overlay'));
  ok(!A.$('saved-overlay').classList.contains('hidden') && /Ana/.test(ovTxt) && /¡Salvado!/.test(ovTxt),
    'toda la mesa ve en grande que Ana se salva');
  var ovTxtB = deepText(B.$('saved-overlay'));
  ok(/Ana/.test(ovTxtB), 'B también ve el anuncio de Ana salvada');
  pumpAll();
  ok(A.$('saved-overlay').classList.contains('hidden'), 'el anuncio se esconde solo');

  // Duelo final: juegan Beto y Carlos; Ana mira salvada.
  const next = findBtn(A, 'Siguiente ronda') || findBtn(A, 'Empezar el duelo');
  ok(!!next, 'la anfitriona puede avanzar al duelo');
  next.fire('click');
  pumpAll(); // el inicio del duelo también es sincronizado
  ok(inGame(B), 'B entra en el duelo al avanzar la anfitriona');
  ok(seatCountOf(A) === 3, 'A ve 3 asientos (ella + 2 duelistas): ' + seatCountOf(A));

  // Duelo, ronda 1: B esconde 2, C esconde 1 → total 3. Empieza B (rotación).
  hideFor(B, 2); hideFor(C, 1);
  guessFor(B, 5); // falla
  let bub = bubblesOf(A);
  ok(String(bub['Beto']) === '5', 'A (salvada) ve el bocadillo de Beto con el 5: ' + JSON.stringify(bub));
  ok(/Turno de Carlos/.test(deepText(A.$('mesa-centro'))),
    'A (salvada) ve el turno de Carlos en el centro');
  guessFor(C, 3); // última apuesta del duelo: también espera 1,5s
  let bub2 = bubblesOf(A);
  ok(String(bub2['Carlos']) === '3', 'el último bocadillo del duelo también se ve: ' + JSON.stringify(bub2));
  pumpAll();
  ok(String(centroTotalOf(A)) === '3', 'A (salvada) ve el total 3 del duelo en el centro');
  ok(String(centroTotalOf(C)) === '3', 'C ve el total 3 en el centro');
  ok(/Carlos 1/.test(deepText(A.$('mesa-centro'))), 'A ve los aciertos del duelo en el centro');
  // En el duelo no hay anuncio de salvado (nadie se salva aún)
  pumpAll();
  ok(A.$('saved-overlay').classList.contains('hidden'), 'sin anuncio de salvado en el duelo');

  // Código sin sala: aviso claro, sin sala fantasma ni autopromoción.
  const D = newClient('Dani');
  D.$('input-code').value = '9999'; D.$('btn-join').fire('click');
  pumpAll();
  ok(/No se encuentra ninguna sala/.test(D.$('home-error').textContent),
    'código sin sala avisa: ' + D.$('home-error').textContent);
  ok(onHome(D), 'D vuelve a la portada, sin sala fantasma');

  // Sala llena: 12 jugadores dentro, el 13º es rechazado.
  const H = newClient('Hugo');
  H.$('btn-create').fire('click');
  pumpAll();
  const code2 = H.$('lobby-code').textContent;
  ok(/^[0-9]{4}$/.test(code2), 'segunda sala creada con código ' + code2);
  for (let i = 0; i < 11; i++) {
    const g = newClient('Inv' + i);
    g.$('input-code').value = code2; g.$('btn-join').fire('click');
    pumpAll();
  }
  ok(H.$('lobby-players').children.length === 12, 'la sala se llena con 12 jugadores');
  const extra = newClient('Extra');
  extra.$('input-code').value = code2; extra.$('btn-join').fire('click');
  pumpAll();
  ok(onHome(extra), 'el 13º jugador es rechazado y vuelve a la portada');
  ok(H.$('lobby-players').children.length === 12, 'la sala sigue con 12 tras el rechazo');
} catch (e) {
  fails++;
  console.error('FALLA: excepción:', e.stack.split('\n').slice(0, 5).join('\n'));
}

console.log(fails === 0 ? '\nONLINE TEST OK' : '\n' + fails + ' FALLOS');
process.exit(fails === 0 ? 0 : 1);
