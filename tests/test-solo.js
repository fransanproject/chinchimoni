// Smoke test: juega una partida COMPLETA en solitario contra la IA
// con un DOM simulado. Detecta errores de ejecución en app.js.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEl(tag) {
  const e = {
    tag, children: [], _html: '', textContent: '', className: '',
    style: {}, disabled: false, title: '', onclick: null, value: '',
    appendChild(c) { e.children.push(c); return c; },
    _listeners: {},
    addEventListener(ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    fire(ev) { (e._listeners[ev] || []).forEach(fn => fn()); if (ev === 'click' && e.onclick) e.onclick(); },
    classList: {
      _s: new Set(),
      toggle(c, force) { force === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (force ? this._s.add(c) : this._s.delete(c)); },
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }
    },
    querySelectorAll() { return []; }, querySelector() { return null; },
    insertBefore(c) { e.children.unshift(c); return c; },
    remove() {},
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return e._html; },
    set(v) { e._html = v; e.children = []; }
  });
  Object.defineProperty(e, 'firstChild', { get() { return e.children[0] || null; } });
  return e;
}

const byId = {};
const sandbox = {
  console,
  setTimeout: (fn) => { fn(); return 0; }, // inmediato: la IA juega al instante
  clearTimeout: () => {},
  Math, JSON, Object, Array, String, Number,
  navigator: {},
  localStorage: { getItem: () => null, setItem: () => {} },
  window: {},
  document: {
    getElementById(id) { return byId[id] || (byId[id] = makeEl('div#' + id)); },
    createElement(tag) { return makeEl(tag); },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const dir = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(dir, 'logic.js'), 'utf8') +
  '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
vm.runInNewContext(code, sandbox);
const doc = sandbox.document;
const $ = (id) => doc.getElementById(id);

function fireClick(n) { n.fire('click'); }
function deepText(n) {
  let t = n.textContent || '';
  (n.children || []).forEach(c => { t += ' ' + deepText(c); });
  return t;
}
function findBtn(root, text, includeDisabled) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    const clickable = (n.tag && n.tag.indexOf('button') === 0) &&
      (n.onclick || (n._listeners.click && n._listeners.click.length));
    if (clickable && (includeDisabled || !n.disabled) && n.textContent === text) return n;
    stack.push(...(n.children || []));
  }
  return null;
}
function clickNum(stageRoot, prefer) {
  const nums = [];
  const stack = [stageRoot];
  while (stack.length) {
    const n = stack.pop();
    if (n.tag && n.tag.indexOf('button') === 0 && /^\d+$/.test(n.textContent) && !n.disabled) nums.push(n);
    stack.push(...(n.children || []));
  }
  if (!nums.length) return false;
  fireClick(nums.find(b => b.textContent === String(prefer)) || nums[0]);
  return true;
}

let fails = 0;
function ok(c, name) { if (!c) { fails++; console.error('FALLA:', name); } else console.log('ok:', name); }

try {
  $('input-name').value = 'Yo';
  fireClick($('btn-solo'));
  fireClick($('btn-solo-start')); // 3 rivales por defecto
  ok(!$('screen-game').classList.contains('hidden'), 'empieza la partida en solitario');

  let steps = 0, gameOvers = 0, restarts = 0, sawRound1Min1 = false;
  while (steps++ < 800) {
    if (!$('modal').classList.contains('hidden')) {
      const txt = deepText($('modal-panel'));
      gameOvers++;
      ok(/pringado|gana el duelo|Todos salvados/.test(txt), 'modal de fin muestra resultado: ' + txt.slice(0, 70));
      if (restarts === 0) {
        const again = findBtn($('modal-panel'), '🔄 Jugar otra vez');
        ok(!!again, 'botón jugar otra vez existe');
        fireClick(again);
        restarts++;
        continue;
      }
      break;
    }
    const actions = $('actions'), stage = $('stage');
    const escBtn = findBtn(actions, 'Esconder ✊', true);
    const advBtn = findBtn(actions, 'Adivinar 🎯', true);
    const nextBtn = findBtn(actions, '▶ Siguiente ronda') || findBtn(actions, '⚔️ Empezar el duelo');
    if (escBtn && escBtn.disabled) {
      // En la ronda 1 el 0 no debe ofrecerse (mínimo 1 moneda)
      const nums = [];
      const stack = [stage];
      while (stack.length) {
        const n = stack.pop();
        if (n.tag && n.tag.indexOf('button') === 0 && /^\d+$/.test(n.textContent)) nums.push(n.textContent);
        stack.push(...(n.children || []));
      }
      if (/Ronda 1/.test(deepText($('game-round')))) {
        ok(nums.indexOf('0') === -1 && nums.indexOf('1') !== -1, 'ronda 1: esconder ofrece 1-3 (sin 0): [' + nums.join(',') + ']');
        sawRound1Min1 = true;
      }
      if (!clickNum(stage, 1)) throw new Error('no hay botón de número para esconder');
      const b = findBtn(actions, 'Esconder ✊');
      if (!b) throw new Error('Esconder no se habilitó tras elegir');
      fireClick(b);
    } else if (advBtn && advBtn.disabled) {
      if (!clickNum(stage, 2)) throw new Error('no hay botón de número para adivinar');
      const b = findBtn(actions, 'Adivinar 🎯');
      if (b) fireClick(b);
    } else if (nextBtn) {
      fireClick(nextBtn);
    } else {
      throw new Error('estado desconocido. banner="' + $('turn-banner').textContent + '"');
    }
  }
  ok(sawRound1Min1, 'se verificó el mínimo de 1 moneda en la ronda 1');
  ok(gameOvers >= 1, 'la partida termina (' + gameOvers + ' finales, ' + restarts + ' reinicio)');
  ok(steps < 800, 'sin bucles infinitos (' + steps + ' pasos)');
} catch (e) {
  fails++;
  console.error('FALLA: excepción:', e.stack.split('\n').slice(0, 4).join('\n'));
}

console.log(fails === 0 ? '\nSMOKE TEST OK' : '\n' + fails + ' FALLOS');
process.exit(fails === 0 ? 0 : 1);
