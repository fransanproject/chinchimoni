// Tests de la lógica pura + simulación de partidas con las normas vigentes:
// - acertar en una ronda => salvado (también en la ronda 1)
// - en la ronda 1 hay que esconder mínimo 1 moneda
// - con 2 jugadores: duelo final, primero en acertar 3 rondas se salva
const L = require('../logic.js');
let fails = 0;
function ok(cond, name) {
  if (!cond) { fails++; console.error('FALLA:', name); }
  else console.log('ok:', name);
}

ok(L.START_COINS === 3 && L.MAX_PLAYERS === 12 && L.FINAL_HITS_TO_WIN === 3, 'constantes');
ok(L.maxTotal({ a: 3, b: 3, c: 3 }) === 9, 'maxTotal');
const o = L.turnOrder(['a', 'b', 'c', 'd'], 'c');
ok(JSON.stringify(o) === JSON.stringify(['c', 'd', 'a', 'b']), 'turnOrder rota');
ok(L.roundTotal({ a: 2, b: 0, c: 3 }) === 5, 'roundTotal');
ok(JSON.stringify(L.correctGuessers({ a: 5, b: 7, c: 5 }, 5)) === JSON.stringify(['a', 'c']), 'varios acertantes');
ok(L.correctGuessers({ a: 5, b: 7 }, 6).length === 0, 'nadie acierta');

function simGame(nPlayers) {
  let roster = Array.from({ length: nPlayers }, (_, i) => 'p' + i);
  let saved = [], starter = roster[0], round = 0, loser = null, duelWinner = null;
  let hits = {};
  while (round < 300) {
    round++;
    const finalDuel = roster.length === 2;
    const minHide = round === 1 ? 1 : 0;
    const hides = {};
    roster.forEach(id => { hides[id] = minHide + Math.floor(Math.random() * (4 - minHide)); });
    const total = L.roundTotal(hides);
    const max = 3 * roster.length;
    const order = L.turnOrder(roster, starter);
    const guesses = {}, used = {};
    order.forEach(id => {
      let g, guard = 0;
      do { g = Math.floor(Math.random() * (max + 1)); guard++; } while (used[g] && guard < 500);
      used[g] = true; guesses[id] = g;
    });
    const correct = L.correctGuessers(guesses, total);
    if (finalDuel) {
      correct.forEach(id => { hits[id] = (hits[id] || 0) + 1; });
      const champs = roster.filter(id => hits[id] >= L.FINAL_HITS_TO_WIN);
      if (champs.length) { duelWinner = champs[0]; loser = roster.find(id => id !== duelWinner); break; }
    } else {
      correct.forEach(id => { saved.push(id); }); // acertar salva, también en ronda 1
      roster = roster.filter(id => saved.indexOf(id) === -1);
      if (roster.length <= 1) { loser = roster[0] || null; break; }
      if (roster.length === 2) hits = {};
    }
    starter = order[1] && roster.indexOf(order[1]) !== -1 ? order[1] : roster[0];
  }
  return { loser, duelWinner, saved, rounds: round };
}

for (let n = 2; n <= 6; n++) {
  const r = simGame(n);
  ok(r.rounds < 300 && (r.loser !== undefined || r.duelWinner),
    n + ' jugadores: termina (' + r.rounds + ' rondas, ' +
    (r.duelWinner ? 'duelo ganado por ' + r.duelWinner + ', pringado ' + r.loser : (r.loser ? 'pringado ' + r.loser : 'todos salvados')) + ')');
}

console.log(fails === 0 ? '\nTODOS LOS TESTS PASAN' : '\n' + fails + ' TESTS FALLAN');
process.exit(fails === 0 ? 0 : 1);
