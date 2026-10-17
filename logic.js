/* ============================================================
 * Chinchimoni — lógica pura del juego (chinchón).
 * Sin DOM ni red: se puede probar con node.
 * Reglas de la casa (v1):
 *  - Baraja española doble (2 x 48 cartas: con 8 y 9) -> 96 cartas.
 *    Con 12 jugadores x 7 cartas = 84, sobra mazo.
 *  - 7 cartas por jugador. En tu turno robas 1 (del mazo o del
 *    descarte) y descartas 1.
 *  - Jugadas: trío+ (3 o más del mismo número) o escalera (3 o más
 *    correlativas del mismo palo; el as solo vale como 1).
 *  - Cierre: con 8 cartas en mano, si 7 forman jugadas válidas se
 *    puede cerrar (la 8ª va al descarte). Chinchón = escalera de 7
 *    del mismo palo -> -25 puntos de bonus.
 *  - Al cerrar, los demás ligan lo que puedan: solo cuentan los
 *    puntos de las cartas que no forman jugada.
 *  - Puntos: número = su valor (1-9), figuras (10,11,12) = 10.
 *  - Se acumulan por rondas; con 100 o más quedas eliminado.
 *    Gana el último en pie.
 * ============================================================ */

var Chinchimoni = (function () {
  'use strict';

  var SUITS = ['oros', 'copas', 'espadas', 'bastos'];
  var SUIT_GLYPH = { oros: '◆', copas: '♥', espadas: '♠', bastos: '♣' };
  var SUIT_NAME = { oros: 'oros', copas: 'copas', espadas: 'espadas', bastos: 'bastos' };

  var MAX_PLAYERS = 12;
  var HAND_SIZE = 7;
  var BUST_SCORE = 100;
  var CHINCHON_BONUS = -25;

  function buildDeck() {
    var deck = [];
    for (var copy = 0; copy < 2; copy++) {
      for (var s = 0; s < SUITS.length; s++) {
        for (var r = 1; r <= 12; r++) {
          deck.push({ suit: SUITS[s], rank: r, copy: copy, id: SUITS[s] + '-' + r + '#' + copy });
        }
      }
    }
    return deck; // 96 cartas
  }

  function shuffle(deck) {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }

  function cardPoints(c) { return c.rank <= 9 ? c.rank : 10; }

  function cardLabel(c) {
    var r = c.rank === 1 ? 'A' : String(c.rank);
    return r + SUIT_GLYPH[c.suit];
  }

  function isTrio(cards) {
    if (cards.length < 3) return false;
    var r = cards[0].rank;
    for (var i = 1; i < cards.length; i++) if (cards[i].rank !== r) return false;
    return true;
  }

  function isStraight(cards) {
    if (cards.length < 3) return false;
    var suit = cards[0].suit;
    var ranks = [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].suit !== suit) return false;
      ranks.push(cards[i].rank);
    }
    ranks.sort(function (a, b) { return a - b; });
    for (var k = 1; k < ranks.length; k++) {
      if (ranks[k] === ranks[k - 1]) return false; // duplicada: no vale en escalera
      if (ranks[k] !== ranks[k - 1] + 1) return false;
    }
    return true; // el as solo vale como 1 (no hay K-A)
  }

  function isValidMeld(cards) {
    return cards.length >= 3 && (isTrio(cards) || isStraight(cards));
  }

  // Jugadas candidatas: tríos (grupo completo por número) + todas las
  // sub-rachas de escalera de longitud >= 3.
  function candidateMelds(cards) {
    var melds = [];
    var byRank = {};
    cards.forEach(function (c) {
      (byRank[c.rank] = byRank[c.rank] || []).push(c);
    });
    Object.keys(byRank).forEach(function (rk) {
      if (byRank[rk].length >= 3) melds.push(byRank[rk].slice());
    });
    SUITS.forEach(function (suit) {
      var byR = {};
      cards.forEach(function (c) {
        if (c.suit === suit && !byR[c.rank]) byR[c.rank] = c;
      });
      var ranks = Object.keys(byR).map(Number).sort(function (a, b) { return a - b; });
      var run = [];
      function flush() {
        for (var a = 0; a < run.length; a++) {
          for (var b = a + 2; b < run.length; b++) {
            melds.push(run.slice(a, b + 1).map(function (r) { return byR[r]; }));
          }
        }
        run = [];
      }
      ranks.forEach(function (r) {
        if (run.length && r !== run[run.length - 1] + 1) flush();
        run.push(r);
      });
      flush();
    });
    return melds;
  }

  // Parte TODAS las cartas en jugadas válidas, o null si no se puede.
  function findPartition(cards) {
    if (cards.length === 0) return [];
    var melds = candidateMelds(cards);
    function contains(list, id) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return true;
      return false;
    }
    function search(remaining, acc) {
      if (remaining.length === 0) return acc;
      var first = remaining[0];
      for (var i = 0; i < melds.length; i++) {
        var m = melds[i];
        if (!contains(m, first.id)) continue;
        var ok = true;
        for (var k = 0; k < m.length; k++) {
          if (!contains(remaining, m[k].id)) { ok = false; break; }
        }
        if (!ok) continue;
        var rest = remaining.filter(function (r) { return !contains(m, r.id); });
        var res = search(rest, acc.concat([m]));
        if (res) return res;
      }
      return null;
    }
    return search(cards.slice(), []);
  }

  // Mejor forma de ligar: minimiza los puntos de las cartas sueltas.
  function bestDeadwood(cards) {
    var melds = candidateMelds(cards);
    var total = cards.reduce(function (s, c) { return s + cardPoints(c); }, 0);
    var best = { melds: [], points: total };
    function search(used, acc, covered) {
      var pts = total - covered;
      if (pts < best.points) best = { melds: acc.slice(), points: pts };
      if (pts === 0) return;
      for (var i = 0; i < melds.length; i++) {
        var m = melds[i];
        var clash = false;
        for (var k = 0; k < m.length; k++) if (used[m[k].id]) { clash = true; break; }
        if (clash) continue;
        var gain = 0;
        for (var j = 0; j < m.length; j++) { used[m[j].id] = true; gain += cardPoints(m[j]); }
        acc.push(m);
        search(used, acc, covered + gain);
        acc.pop();
        for (var q = 0; q < m.length; q++) delete used[m[q].id];
      }
    }
    search({}, [], 0);
    return best;
  }

  // ¿Se puede cerrar con estas 8 cartas? Devuelve {discard, melds, chinchon} o null.
  function canClose(hand) {
    if (!hand || hand.length !== HAND_SIZE + 1) return null;
    var best = null;
    for (var i = 0; i < hand.length; i++) {
      var discard = hand[i];
      var rest = hand.filter(function (_, k) { return k !== i; });
      var part = findPartition(rest);
      if (part) {
        var chinchon = rest.length === 7 && isStraight(rest);
        var cand = { discard: discard, melds: chinchon ? [rest] : part, chinchon: chinchon };
        if (!best || (chinchon && !best.chinchon)) best = cand;
        if (chinchon) break;
      }
    }
    return best;
  }

  // Puntos de la ronda. hands: {playerId: [cartas]} (el que cierra: sus 7 ligadas).
  function scoreRound(hands, closerId, chinchon) {
    var res = {};
    Object.keys(hands).forEach(function (pid) {
      if (pid === closerId) res[pid] = chinchon ? CHINCHON_BONUS : 0;
      else res[pid] = bestDeadwood(hands[pid]).points;
    });
    return res;
  }

  // Siguiente jugador activo en el orden de la mesa.
  function nextTurn(roster, activeIds, currentId) {
    if (!roster.length) return null;
    var active = {};
    activeIds.forEach(function (id) { active[id] = true; });
    var idx = roster.indexOf(currentId);
    for (var k = 1; k <= roster.length; k++) {
      var cand = roster[(idx + k) % roster.length];
      if (active[cand]) return cand;
    }
    return null;
  }

  return {
    SUITS: SUITS,
    SUIT_GLYPH: SUIT_GLYPH,
    SUIT_NAME: SUIT_NAME,
    MAX_PLAYERS: MAX_PLAYERS,
    HAND_SIZE: HAND_SIZE,
    BUST_SCORE: BUST_SCORE,
    CHINCHON_BONUS: CHINCHON_BONUS,
    buildDeck: buildDeck,
    shuffle: shuffle,
    cardPoints: cardPoints,
    cardLabel: cardLabel,
    isTrio: isTrio,
    isStraight: isStraight,
    isValidMeld: isValidMeld,
    candidateMelds: candidateMelds,
    findPartition: findPartition,
    bestDeadwood: bestDeadwood,
    canClose: canClose,
    scoreRound: scoreRound,
    nextTurn: nextTurn
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Chinchimoni;
