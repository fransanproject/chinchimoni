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
    classList: null, // sincronizado con className (ver abajo)
    querySelectorAll() { return []; }, querySelector() { return null; },
    insertBefore(c) { e.children.unshift(c); return c; },
    remove() {},
  };
  // classList <-> className sincronizados como en un navegador real
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
    // como en un navegador: innerHTML actualiza textContent (sin etiquetas)
    set(v) { e._html = v; e.children = []; e.textContent = String(v).replace(/<[^>]*>/g, ''); }
  });
  Object.defineProperty(e, 'firstChild', { get() { return e.children[0] || null; } });
  return e;
}

const byId = {};
const sandbox = {
  console,
  setTimeout: (fn) => { fn(); return 0; }, // inmediato: la IA juega al instante
  setInterval: () => 0,
  clearTimeout: () => {},
  Math, JSON, Object, Array, String, Number,
  navigator: {},
  localStorage: { getItem: () => null, setItem: () => {} },
  window: {},
  document: {
    getElementById(id) { return byId[id] || (byId[id] = makeEl('div#' + id)); },
    createElement(tag) { return makeEl(tag); },
    querySelectorAll() { return []; },
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
function hasClass(n, c) { return (n.className || '').split(' ').indexOf(c) !== -1; }
function findAllByClass(root, cls) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (hasClass(n, cls)) out.push(n);
    stack.push(...(n.children || []));
  }
  return out;
}
function countTag(root, tag) {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const x = stack.pop();
    if (x.tag === tag) n++;
    stack.push(...(x.children || []));
  }
  return n;
}
function numButtons(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.tag && n.tag.indexOf('button') === 0 && /^\d+$/.test(n.textContent) && !n.disabled) out.push(n);
    stack.push(...(n.children || []));
  }
  return out;
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
  ok(findAllByClass($('mesa'), 'asiento').length === 4, '4 asientos alrededor de la mesa (yo + 3 IA)');

  let steps = 0, gameOvers = 0, restarts = 0, sawRound1Min1 = false, sawBubble = false, sawCentroTotal = false, sawDuelScore = false;
  while (steps++ < 800) {
    if (!$('modal').classList.contains('hidden')) {
      const txt = deepText($('modal-panel'));
      gameOvers++;
      ok(/pringado|gana el duelo|Todos salvados/i.test(txt), 'modal de fin muestra resultado: ' + txt.slice(0, 70));
      ok(findAllByClass($('modal-panel'), 'rank-row').length >= 2, 'el modal muestra la clasificación final');
      ok(findAllByClass($('modal-panel'), 'rank-row').filter(x => hasClass(x, 'champion')).length === 1,
        'el 1º lleva corona y laureles');
      if (/Pringado/.test(txt)) {
        ok(findAllByClass($('modal-panel'), 'pringado-card').length === 1, 'el pringado va en tarjeta aparte');
      }
      ok(countTag($('stats-table'), 'tr') >= 2, 'la tabla de estadísticas tiene datos');
      if (restarts === 0) {
        const again = findBtn($('modal-panel'), 'Jugar otra vez');
        ok(!!again, 'botón jugar otra vez existe');
        fireClick(again);
        restarts++;
        continue;
      }
      break;
    }
    const actions = $('actions'), mesa = $('mesa');
    const escBtn = findBtn(actions, 'Esconder', true);
    const advBtn = findBtn(actions, 'Adivinar', true);
    const nextBtn = findBtn(actions, 'Siguiente ronda') || findBtn(actions, 'Empezar el duelo');
    if (escBtn && escBtn.disabled) {
      // En la ronda 1 el 0 no debe ofrecerse (mínimo 1 moneda)
      const nums = numButtons(actions).map(b => b.textContent);
      if (/Ronda 1/.test(deepText($('game-round')))) {
        ok(nums.indexOf('0') === -1 && nums.indexOf('1') !== -1, 'ronda 1: esconder ofrece 1-3 (sin 0): [' + nums.join(',') + ']');
        sawRound1Min1 = true;
      }
      if (!clickNum(actions, 1)) throw new Error('no hay botón de número para esconder');
      const b = findBtn(actions, 'Esconder');
      if (!b) throw new Error('Esconder no se habilitó tras elegir');
      fireClick(b);
    } else if (advBtn && advBtn.disabled) {
      if (!clickNum(actions, 2)) throw new Error('no hay botón de número para adivinar');
      const b = findBtn(actions, 'Adivinar');
      if (b) fireClick(b);
    } else if (nextBtn) {
      fireClick(nextBtn);
    } else {
      throw new Error('estado desconocido. centro="' + deepText($('mesa-centro')) + '"');
    }
    // Durante la fase de apuestas debe haber bocadillos visibles;
    // al resolver, el total aparece en grande en el centro de la mesa.
    // En el duelo, el marcador de victorias está siempre arriba.
    const centroTxt = deepText($('mesa-centro'));
    if (/Te toca|Turno de/.test(centroTxt)) {
      if (findAllByClass(mesa, 'bocadillo').some(x => !hasClass(x, 'hidden'))) sawBubble = true;
    } else if (/Total|total/.test(centroTxt) || /\d/.test(centroTxt)) {
      const totalEl = findAllByClass($('mesa-centro'), 'centro-total');
      if (totalEl.length) sawCentroTotal = true;
    }
    if (!$('duel-score').classList.contains('hidden')) {
      const ds = deepText($('duel-score'));
      if (/\d+\s*—\s*\d+/.test(ds)) sawDuelScore = true;
    }
  }
  ok(sawBubble, 'las apuestas aparecen en bocadillos junto a cada jugador');
  ok(sawCentroTotal, 'al resolver, el total aparece en el centro de la mesa');
  ok(sawRound1Min1, 'se verificó el mínimo de 1 moneda en la ronda 1');
  ok(gameOvers >= 1, 'la partida termina (' + gameOvers + ' finales, ' + restarts + ' reinicio)');
  if (sawDuelScore) console.log('ok: marcador del duelo visible durante el duelo');
  ok(steps < 800, 'sin bucles infinitos (' + steps + ' pasos)');
} catch (e) {
  fails++;
  console.error('FALLA: excepción:', e.stack.split('\n').slice(0, 4).join('\n'));
}

console.log(fails === 0 ? '\nSMOKE TEST OK' : '\n' + fails + ' FALLOS');
process.exit(fails === 0 ? 0 : 1);
