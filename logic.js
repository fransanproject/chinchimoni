/* ============================================================
 * Chinchimoni — el juego de las monedas escondidas (los chinos).
 * Lógica pura, sin DOM ni red: se puede probar con node.
 *
 * Reglas de la casa (v1):
 *  - Cada jugador empieza con 3 monedas.
 *  - Cada ronda, todos esconden en el puño 0..(sus monedas) a la vez.
 *  - Por turnos (rotando quién empieza), cada jugador dice un número:
 *    su apuesta de la suma total escondida. No se puede repetir número.
 *  - Se abren los puños: quien acertó la suma exacta descarta 1 moneda.
 *  - Gana el primero en quedarse sin monedas.
 * ============================================================ */

var Chinchimoni = (function () {
  'use strict';

  var MAX_PLAYERS = 12;
  var START_COINS = 3;

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

  // Aplica el descarte de los acertantes. Devuelve {coins, winners}.
  function applyRound(coins, correct) {
    var next = {};
    Object.keys(coins).forEach(function (id) { next[id] = coins[id]; });
    correct.forEach(function (id) { if (next[id] > 0) next[id]--; });
    var winners = Object.keys(next).filter(function (id) { return next[id] === 0; });
    return { coins: next, winners: winners };
  }

  return {
    MAX_PLAYERS: MAX_PLAYERS,
    START_COINS: START_COINS,
    maxTotal: maxTotal,
    turnOrder: turnOrder,
    roundTotal: roundTotal,
    correctGuessers: correctGuessers,
    applyRound: applyRound
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Chinchimoni;
