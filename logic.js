/* ============================================================
 * Chinchimoni — el juego de las monedas escondidas (los chinos).
 * Lógica pura, sin DOM ni red: se puede probar con node.
 *
 * Reglas de la casa (v2):
 *  - Cada jugador esconde en el puño 0..3 monedas a la vez.
 *  - Por turnos (rotando quién empieza), cada jugador apuesta la suma
 *    total. No se puede repetir número.
 *  - Quien acierta en una ronda queda SALVADO y no juega más.
 *    (En la primera ronda hay que esconder mínimo 1 moneda.)
 *  - Cuando solo quedan 2 jugadores: DUELO FINAL, el primero en
 *    acertar 3 rondas se salva; el otro es el pringado.
 * ============================================================ */

var Chinchimoni = (function () {
  'use strict';

  var MAX_PLAYERS = 12;
  var START_COINS = 3;
  var FINAL_HITS_TO_WIN = 3; // en el duelo final, el primero en acertar 3 rondas se salva

  // Suma máxima que se puede apostar = total de monedas en juego.
  function maxTotal(coins) {
    var t = 0;
    Object.keys(coins).forEach(function (id) { t += coins[id]; });
    return t;
  }

  // Orden de la mesa empezando por starterId (rota cada ronda).
  function turnOrder(roster, starterId) {
    var i = roster.indexOf(starterId);
    if (i === -1) return roster.slice();
    return roster.slice(i).concat(roster.slice(0, i));
  }

  function roundTotal(hides) {
    var t = 0;
    Object.keys(hides).forEach(function (id) { t += hides[id]; });
    return t;
  }

  function correctGuessers(guesses, total) {
    return Object.keys(guesses).filter(function (id) { return guesses[id] === total; });
  }

  return {
    MAX_PLAYERS: MAX_PLAYERS,
    START_COINS: START_COINS,
    FINAL_HITS_TO_WIN: FINAL_HITS_TO_WIN,
    maxTotal: maxTotal,
    turnOrder: turnOrder,
    roundTotal: roundTotal,
    correctGuessers: correctGuessers
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Chinchimoni;
