/* ============================================================
 * Chinchimoni — interfaz + multijugador (Supabase Realtime).
 * Sin servidor propio: el anfitrión (host) reparte y arbitra;
 * los eventos viajan por broadcast en el canal `chinchimoni-XXXX`.
 * Las manos viajan etiquetadas con su destinatario: entre amigos
 * se juega con confianza (no mires la consola, tramposo).
 * ============================================================ */
(function () {
  'use strict';

  var SB_URL = 'https://zjcthmglltdrefwnflqm.supabase.co';
  var SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqY3RobWdsbHRkcmVmd25mbHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODA5OTMsImV4cCI6MjEwNzY1Njk5M30.hWorZSMT1C5dMVXYAaR2_fuduVwit4uJ9qrPGXcBk7o';

  var L = Chinchimoni;

  // ---------- estado ----------
  var S = {
    name: '', playerId: '', joinedAt: 0, roomCode: '',
    channel: null, sb: null,
    isHost: false, players: [],   // [{id, name, joinedAt}] por presence
    screen: 'home',
    awaitingCard: false,
    selectedId: null,
    spectating: false,
    game: null,   // estado de la ronda
    host: null    // {stock:[], pile:[], reveals:{}} solo en el anfitrión
  };

  // ---------- utilidades ----------
  function $(id) { return document.getElementById(id); }
  function randId() { return 'p' + Math.random().toString(36).slice(2, 10); }
  function makeRoomCode() {
    var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', c = '';
    for (var i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }
  function el(tag, text, cls) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }
  function showScreen(name) {
    S.screen = name;
    ['home', 'lobby', 'game'].forEach(function (s) {
      $('screen-' + s).classList.toggle('hidden', s !== name);
    });
  }
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2600);
  }
  function showModal(html) {
    $('modal-panel').innerHTML = '';
    if (typeof html === 'string') $('modal-panel').innerHTML = html;
    else $('modal-panel').appendChild(html);
    $('modal').classList.remove('hidden');
  }
  function hideModal() { $('modal').classList.add('hidden'); }
  function send(type, payload) {
    if (S.channel) S.channel.send({ type: 'broadcast', event: type, payload: payload });
  }
  function rankLabel(r) { return r === 1 ? 'A' : String(r); }
  function sortHand(hand) {
    var order = { oros: 0, copas: 1, espadas: 2, bastos: 3 };
    return hand.slice().sort(function (a, b) {
      return (order[a.suit] - order[b.suit]) || (a.rank - b.rank);
    });
  }
  function cardEl(c, mini) {
    var d = el('div', null, 'carta palo-' + c.suit + (mini ? ' mini' : ''));
    d.appendChild(el('div', rankLabel(c.rank), 'rango'));
    d.appendChild(el('div', L.SUIT_GLYPH[c.suit], 'palo'));
    d.appendChild(el('div', rankLabel(c.rank), 'rango inv'));
    d.title = rankLabel(c.rank) + ' de ' + L.SUIT_NAME[c.suit];
    return d;
  }
  function presentIds() {
    var m = {};
    S.players.forEach(function (p) { m[p.id] = true; });
    return m;
  }
  function activeIds() {
    if (!S.game) return [];
    var pr = presentIds();
    return S.game.roster.filter(function (id) {
      return !S.game.eliminated.has(id) && pr[id];
    });
  }
  function playerName(id) {
    return (S.game && S.game.names[id]) || '¿?';
  }

  // ---------- portada ----------
  function getName() {
    var n = $('input-name').value.trim().slice(0, 12);
    if (!n) { $('home-error').textContent = 'Escribe tu nombre primero.'; return null; }
    try { localStorage.setItem('chinchimoni-name', n); } catch (e) {}
    return n;
  }
  $('btn-create').addEventListener('click', function () {
    var n = getName(); if (!n) return;
    joinRoom(makeRoomCode(), n);
  });
  $('btn-join').addEventListener('click', function () {
    var n = getName(); if (!n) return;
    var code = $('input-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { $('home-error').textContent = 'El código tiene 4 letras/números.'; return; }
    joinRoom(code, n);
  });
  try {
    var saved = localStorage.getItem('chinchimoni-name');
    if (saved) $('input-name').value = saved;
  } catch (e) {}

  // ---------- conexión a la sala ----------
  function joinRoom(code, name) {
    $('home-error').textContent = '';
    S.name = name;
    S.playerId = randId();
    S.joinedAt = Date.now();
    S.roomCode = code;
    S.isHost = false;
    S.players = [];
    S.game = null;
    S.host = null;

    if (!window.supabase || !window.supabase.createClient) {
      $('home-error').textContent = 'No se pudo cargar la librería de red. Revisa tu conexión.';
      return;
    }
    if (!S.sb) S.sb = window.supabase.createClient(SB_URL, SB_ANON_KEY);
    var ch = S.sb.channel('chinchimoni-' + code.toLowerCase(), {
      config: { broadcast: { self: false }, presence: { key: S.playerId } }
    });
    S.channel = ch;

    ch.on('presence', { event: 'sync' }, onPresenceSync);
    ch.on('broadcast', { event: 'start_round' }, onStartRound);
    ch.on('broadcast', { event: 'deal' }, onDeal);
    ch.on('broadcast', { event: 'discard_top' }, onDiscardTop);
    ch.on('broadcast', { event: 'stock_count' }, onStockCount);
    ch.on('broadcast', { event: 'reshuffle' }, function () { toast('🔀 Mazo rehecho con el descarte'); });
    ch.on('broadcast', { event: 'turn' }, onTurn);
    ch.on('broadcast', { event: 'draw_request' }, onDrawRequest);
    ch.on('broadcast', { event: 'deal_one' }, onDealOne);
    ch.on('broadcast', { event: 'draw_discard' }, onDrawDiscard);
    ch.on('broadcast', { event: 'discard' }, onDiscard);
    ch.on('broadcast', { event: 'close' }, onClose);
    ch.on('broadcast', { event: 'reveal' }, onReveal);
    ch.on('broadcast', { event: 'round_end' }, onRoundEnd);
    ch.on('broadcast', { event: 'game_over' }, onGameOver);
    ch.on('broadcast', { event: 'round_abort' }, onRoundAbort);

    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        ch.track({ name: S.name, joinedAt: S.joinedAt });
        showScreen('lobby');
        renderLobby();
      } else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        $('home-error').textContent = 'No se pudo conectar a la sala. Revisa tu conexión e inténtalo de nuevo.';
      }
    });
  }

  function leaveRoom() {
    if (S.channel) { try { S.channel.unsubscribe(); } catch (e) {} }
    S.channel = null; S.game = null; S.host = null; S.players = [];
    S.isHost = false; S.awaitingCard = false; S.selectedId = null; S.spectating = false;
    hideModal();
    showScreen('home');
  }
  $('btn-leave-lobby').addEventListener('click', leaveRoom);
  $('btn-leave-game').addEventListener('click', leaveRoom);
  $('btn-copy').addEventListener('click', function () {
    var code = $('lobby-code').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast('Código copiado 📋'); });
    else toast('Código: ' + code, 4000);
  });

  // ---------- presence ----------
  function onPresenceSync() {
    var state = S.channel.presenceState();
    var players = [];
    Object.keys(state).forEach(function (key) {
      var pres = state[key];
      if (pres && pres.length) players.push({ id: key, name: String(pres[0].name || '¿?').slice(0, 12), joinedAt: pres[0].joinedAt || 0 });
    });
    players.sort(function (a, b) { return a.joinedAt - b.joinedAt; });
    S.players = players;

    var wasHost = S.isHost;
    var hostId = players.length ? players[0].id : null;
    S.isHost = (hostId === S.playerId);

    if (S.screen === 'lobby') renderLobby();
    if (S.screen === 'game' && S.game) {
      // Migración de anfitrión: si el host se fue, el siguiente toma el mando.
      if (S.isHost && !wasHost) {
        if (S.game.state === 'roundEnd' && S.game.lastRound) {
          send('round_end', S.game.lastRound); // reenvía el marcador
        } else if (S.game.state === 'gameOver' && S.game.lastGameOver) {
          send('game_over', S.game.lastGameOver);
        } else if (S.game.state === 'playing' || S.game.state === 'awaitingReveal') {
          send('round_abort', { reason: 'El anfitrión se desconectó. Nueva ronda.' });
          hostStartRound(false);
          return;
        }
      }
      if (S.isHost) hostWatchdog();
      renderAll();
    }
  }

  // Si al que le toca jugar ya no está, se avanza el turno.
  // Si alguien se fue durante el revelado, se comprueba si ya están todas.
  function hostWatchdog() {
    var g = S.game;
    if (!g) return;
    if (g.state === 'awaitingReveal') { checkReveals(); return; }
    if (g.state !== 'playing') return;
    var act = activeIds();
    if (act.indexOf(g.turnId) === -1) hostAdvanceTurn();
  }

  // ---------- lobby ----------
  function renderLobby() {
    $('lobby-code').textContent = S.roomCode;
    var ul = $('lobby-players');
    ul.innerHTML = '';
    S.players.forEach(function (p, i) {
      var li = el('li');
      li.appendChild(el('span', (i === 0 ? '👑 ' : '') + p.name));
      if (p.id === S.playerId) li.appendChild(el('span', '(tú)', 'muted'));
      ul.appendChild(li);
    });
    $('lobby-count').textContent = S.players.length + ' / ' + L.MAX_PLAYERS + ' jugadores';
    var startBtn = $('btn-start');
    startBtn.classList.toggle('hidden', !S.isHost);
    startBtn.disabled = S.players.length < 2;
    $('lobby-note').textContent = S.players.length >= L.MAX_PLAYERS
      ? 'Sala llena: quien entre ahora jugará de espectador hasta la próxima ronda.'
      : 'Comparte el código con tus amigos. El primero en entrar es el anfitrión 👑.';
  }
  $('btn-start').addEventListener('click', function () {
    if (!S.isHost || S.players.length < 2) return;
    hostStartRound(true);
  });

  // ---------- ronda (anfitrión) ----------
  function hostStartRound(resetScores) {
    var present = S.players.slice(0, L.MAX_PLAYERS);
    var prevScores = (S.game && S.game.scores) || {};
    var prevEliminated = (S.game && S.game.eliminated) || new Set();
    if (resetScores) { prevScores = {}; prevEliminated = new Set(); }

    var roster = present
      .filter(function (p) { return !prevEliminated.has(p.id); })
      .map(function (p) { return p.id; });
    if (roster.length < 2) { toast('Se necesitan al menos 2 jugadores.'); return; }

    var names = {};
    present.forEach(function (p) { names[p.id] = p.name; });
    var scores = {};
    roster.forEach(function (id) { scores[id] = prevScores[id] || 0; });

    var dealerIdx = 0;
    if (S.game && !resetScores && S.game.dealerId) {
      // El dealer rota entre los presentes.
      var ni = roster.indexOf(S.game.dealerId);
      dealerIdx = ni === -1 ? 0 : (ni + 1) % roster.length;
    }

    var deck = L.shuffle(L.buildDeck());
    var stock = deck, pile = [];
    var hands = {};
    roster.forEach(function (id) { hands[id] = stock.splice(0, L.HAND_SIZE); });
    var top = stock.pop();
    pile.push(top);

    var round = (S.game && !resetScores) ? S.game.round + 1 : 1;
    var counts = {};
    roster.forEach(function (id) { counts[id] = L.HAND_SIZE; });
    var firstTurn = L.nextTurn(roster, roster, roster[dealerIdx]);

    S.host = { stock: stock, pile: pile, reveals: {} };
    S.game = {
      roster: roster, names: names, scores: scores,
      eliminated: new Set(), dealerIdx: dealerIdx, dealerId: roster[dealerIdx],
      round: round, state: 'playing', turnId: firstTurn,
      hand: [], phase: 'idle', stockCount: stock.length,
      discardTop: top, counts: counts,
      closerId: null, closerMelds: null, chinchon: false, revealed: {},
      lastRound: null, lastGameOver: null
    };
    roster.forEach(function (id) { if (scores[id] >= L.BUST_SCORE) S.game.eliminated.add(id); });
    S.spectating = roster.indexOf(S.playerId) === -1;
    if (hands[S.playerId]) S.game.hand = sortHand(hands[S.playerId]);
    S.awaitingCard = false;
    S.selectedId = null;
    hideModal();

    // self:false -> el anfitrión no recibe sus propios eventos: ya aplicó todo arriba.
    send('start_round', {
      roster: roster, names: names, scores: scores, round: round,
      dealerIdx: dealerIdx, dealerId: roster[dealerIdx],
      eliminated: Array.from(S.game.eliminated)
    });
    roster.forEach(function (id) {
      if (id !== S.playerId) send('deal', { to: id, cards: hands[id] });
    });
    send('discard_top', { card: top });
    send('stock_count', { count: stock.length });
    setTurn(firstTurn);
    showScreen('game');
    renderAll();
  }

  function hostDrawStockFor(pid) {
    var g = S.game;
    if (!S.host.stock.length) {
      var top = S.host.pile.pop();
      S.host.stock = L.shuffle(S.host.pile);
      S.host.pile = top ? [top] : [];
      send('reshuffle', {});
      toast('🔀 Mazo rehecho con el descarte');
    }
    if (!S.host.stock.length) {
      send('round_abort', { reason: 'No quedan cartas en el mazo. Nueva ronda.' });
      hostStartRound(false);
      return null;
    }
    return S.host.stock.pop();
  }

  function hostAdvanceTurn() {
    var g = S.game;
    if (!g) return;
    var next = L.nextTurn(g.roster, activeIds(), g.turnId);
    if (!next) return;
    setTurn(next);
    send('turn', { playerId: next });
  }

  function setTurn(pid) {
    S.game.turnId = pid;
    S.awaitingCard = false;
    S.game.phase = (pid === S.playerId && !S.spectating && !S.game.eliminated.has(S.playerId)) ? 'draw' : 'idle';
  }

  // ---------- eventos de ronda (todos) ----------
  function onStartRound(p) {
    var counts = {};
    p.roster.forEach(function (id) { counts[id] = L.HAND_SIZE; });
    S.game = {
      roster: p.roster, names: p.names, scores: p.scores,
      eliminated: new Set(p.eliminated || []), dealerIdx: p.dealerIdx, dealerId: p.dealerId,
      round: p.round, state: 'playing', turnId: null,
      hand: [], phase: 'idle', stockCount: 0,
      discardTop: null, counts: counts,
      closerId: null, closerMelds: null, chinchon: false, revealed: {},
      lastRound: S.game ? S.game.lastRound : null,
      lastGameOver: S.game ? S.game.lastGameOver : null
    };
    S.spectating = p.roster.indexOf(S.playerId) === -1;
    S.awaitingCard = false;
    S.selectedId = null;
    hideModal();
    showScreen('game');
    renderAll();
    toast('🃏 Ronda ' + p.round + ' — ¡suerte!');
  }

  function onDeal(p) {
    if (p.to === S.playerId && S.game) {
      S.game.hand = sortHand(p.cards);
      renderHand(); renderActions(); renderBanner();
    }
  }

  function onDiscardTop(p) {
    if (!S.game) return;
    S.game.discardTop = p.card;
    renderTable();
  }

  function onStockCount(p) {
    if (!S.game) return;
    S.game.stockCount = p.count;
    renderTable();
  }

  function onTurn(p) {
    if (!S.game) return;
    setTurn(p.playerId);
    renderAll();
    if (p.playerId === S.playerId && S.game.phase === 'draw') toast('🎯 Tu turno: roba del mazo o del descarte');
  }

  // Petición de carta del mazo (solo el anfitrión la atiende)
  function onDrawRequest(p) {
    if (!S.isHost || !S.game || S.game.state !== 'playing') return;
    if (S.game.turnId !== p.playerId) return;
    var card = hostDrawStockFor(p.playerId);
    if (!card) return;
    S.game.counts[p.playerId]++;
    send('deal_one', { to: p.playerId, card: card });
    send('stock_count', { count: S.host.stock.length });
    renderAll();
  }

  function onDealOne(p) {
    if (!S.game) return;
    S.game.counts[p.to] = (S.game.counts[p.to] || 0) + 1;
    if (p.to === S.playerId) {
      S.game.hand = sortHand(S.game.hand.concat([p.card]));
      S.game.phase = 'discard';
      S.awaitingCard = false;
    }
    renderAll();
  }

  function onDrawDiscard(p) {
    if (!S.game || p.playerId === S.playerId) return; // el que roba ya lo aplicó
    S.game.discardTop = null;
    S.game.counts[p.playerId]++;
    if (S.isHost && S.host) S.host.pile.pop();
    renderAll();
  }

  function onDiscard(p) {
    if (!S.game || p.playerId === S.playerId) return; // el que descarta ya lo aplicó
    S.game.discardTop = p.card;
    S.game.counts[p.playerId]--;
    if (S.isHost && S.host) {
      S.host.pile.push(p.card);
      hostAdvanceTurn();
    }
    renderAll();
  }

  function onClose(p) {
    if (!S.game || p.playerId === S.playerId) return;
    applyClose(p.playerId, p.discard, p.melds, p.chinchon);
    var meActive = !S.spectating && !S.game.eliminated.has(S.playerId) && S.game.roster.indexOf(S.playerId) !== -1;
    if (S.isHost && S.host) {
      S.host.pile.push(p.discard);
      if (meActive) S.host.reveals[S.playerId] = S.game.hand; // el anfitrión también enseña
      checkReveals();
    } else if (meActive) {
      // Si soy jugador activo (no eliminado), enseño mis cartas.
      send('reveal', { playerId: S.playerId, cards: S.game.hand });
    }
    renderAll();
  }

  function applyClose(pid, discardCard, melds, chinchon) {
    var g = S.game;
    g.state = 'awaitingReveal';
    g.closerId = pid;
    g.closerMelds = melds;
    g.chinchon = chinchon;
    g.discardTop = discardCard;
    g.counts[pid]--;
    if (pid === S.playerId) {
      g.hand = g.hand.filter(function (c) { return c.id !== discardCard.id; });
    }
    g.phase = 'idle';
    S.selectedId = null;
  }

  function onReveal(p) {
    if (!S.isHost || !S.game || S.game.state !== 'awaitingReveal') return;
    S.host.reveals[p.playerId] = p.cards;
    checkReveals();
  }

  function revealNeeded() {
    var g = S.game;
    if (!g) return [];
    var pr = presentIds();
    return g.roster.filter(function (id) {
      return id !== g.closerId && !g.eliminated.has(id) && pr[id];
    });
  }

  function checkReveals() {
    if (!S.isHost || !S.game || S.game.state !== 'awaitingReveal') return;
    var needed = revealNeeded();
    var ok = needed.every(function (id) { return S.host.reveals[id]; });
    if (ok) finishRound();
  }

  function finishRound() {
    var g = S.game;
    var hands = {};
    hands[g.closerId] = g.closerMelds.reduce(function (a, m) { return a.concat(m); }, []);
    Object.keys(S.host.reveals).forEach(function (pid) { hands[pid] = S.host.reveals[pid]; });
    var roundScores = L.scoreRound(hands, g.closerId, g.chinchon);
    var totals = Object.assign({}, g.scores);
    Object.keys(roundScores).forEach(function (pid) { totals[pid] = (totals[pid] || 0) + roundScores[pid]; });
    var eliminated = g.roster.filter(function (id) { return totals[id] >= L.BUST_SCORE; });
    var stillIn = g.roster.filter(function (id) { return eliminated.indexOf(id) === -1; });

    if (stillIn.length <= 1) {
      var winnerId = stillIn[0] || g.roster.slice().sort(function (a, b) { return totals[a] - totals[b]; })[0];
      var payload = {
        winnerId: winnerId, totals: totals, roundScores: roundScores,
        eliminated: eliminated, closerId: g.closerId, chinchon: g.chinchon,
        reveals: S.host.reveals, closerMelds: g.closerMelds, round: g.round
      };
      send('game_over', payload);
      onGameOver(payload); // el anfitrión no se recibe a sí mismo
    } else {
      var payload2 = {
        totals: totals, roundScores: roundScores,
        eliminated: eliminated, closerId: g.closerId, chinchon: g.chinchon,
        reveals: S.host.reveals, closerMelds: g.closerMelds, round: g.round
      };
      send('round_end', payload2);
      onRoundEnd(payload2);
    }
  }

  function onRoundEnd(p) {
    if (!S.game) return;
    S.game.state = 'roundEnd';
    S.game.scores = p.totals;
    S.game.eliminated = new Set(p.eliminated);
    S.game.lastRound = p;
    renderAll();
    showRoundEndModal(p, false);
  }

  function onGameOver(p) {
    if (!S.game) return;
    S.game.state = 'gameOver';
    S.game.scores = p.totals;
    S.game.eliminated = new Set(p.eliminated);
    S.game.lastGameOver = p;
    renderAll();
    showRoundEndModal(p, true);
  }

  function onRoundAbort(p) {
    if (!S.game) return;
    S.game.state = 'aborted';
    hideModal();
    renderAll();
    toast(p.reason || 'Ronda anulada.', 4000);
  }

  // ---------- acciones del jugador ----------
  function myTurnPhase() {
    var g = S.game;
    if (!g || g.state !== 'playing' || S.spectating) return null;
    if (g.eliminated.has(S.playerId)) return null;
    if (g.turnId !== S.playerId) return null;
    return g.phase;
  }

  function doDrawStock() {
    if (myTurnPhase() !== 'draw' || S.awaitingCard) return;
    if (S.isHost) {
      var card = hostDrawStockFor(S.playerId);
      if (!card) return;
      S.game.hand = sortHand(S.game.hand.concat([card]));
      S.game.counts[S.playerId]++;
      S.game.phase = 'discard';
      send('stock_count', { count: S.host.stock.length });
      renderAll();
    } else {
      S.awaitingCard = true;
      send('draw_request', { playerId: S.playerId });
      renderActions(); renderBanner();
    }
  }

  function doDrawDiscard() {
    if (myTurnPhase() !== 'draw' || S.awaitingCard) return;
    var g = S.game;
    if (!g.discardTop) return;
    var card = g.discardTop;
    g.hand = sortHand(g.hand.concat([card]));
    g.discardTop = null;
    g.counts[S.playerId]++;
    g.phase = 'discard';
    send('draw_discard', { playerId: S.playerId });
    if (S.isHost && S.host) S.host.pile.pop();
    renderAll();
  }

  function doDiscard() {
    if (myTurnPhase() !== 'discard') return;
    var g = S.game;
    var card = null;
    for (var i = 0; i < g.hand.length; i++) {
      if (g.hand[i].id === S.selectedId) { card = g.hand[i]; break; }
    }
    if (!card) { toast('Elige una carta de tu mano.'); return; }
    g.hand = g.hand.filter(function (c) { return c.id !== card.id; });
    g.discardTop = card;
    g.counts[S.playerId]--;
    g.phase = 'idle';
    S.selectedId = null;
    send('discard', { playerId: S.playerId, card: card });
    if (S.isHost && S.host) {
      S.host.pile.push(card);
      hostAdvanceTurn();
    }
    renderAll();
  }

  function doClose() {
    if (myTurnPhase() !== 'discard') return;
    var res = L.canClose(S.game.hand);
    if (!res) { toast('Con estas cartas no puedes cerrar.'); return; }
    var g = S.game;
    applyClose(S.playerId, res.discard, res.melds, res.chinchon);
    send('close', { playerId: S.playerId, discard: res.discard, melds: res.melds, chinchon: res.chinchon });
    if (S.isHost && S.host) {
      S.host.pile.push(res.discard);
      S.host.reveals = {};
    }
    renderAll();
    toast(res.chinchon ? '🎉 ¡CHINCHÓN! −25 puntos' : '✋ ¡Has cerrado!');
  }

  // ---------- render ----------
  function renderAll() {
    renderBanner(); renderOpponents(); renderTable();
    renderHand(); renderActions(); renderScores();
    $('game-round').textContent = 'Ronda ' + (S.game ? S.game.round : 1);
    $('game-code').textContent = 'sala ' + S.roomCode;
  }

  function renderBanner() {
    var b = $('turn-banner');
    var g = S.game;
    b.classList.remove('my-turn');
    if (!g) { b.textContent = '…'; return; }
    if (g.state === 'awaitingReveal') {
      b.textContent = '✋ ' + playerName(g.closerId) + ' ha cerrado' +
        (g.chinchon ? ' con CHINCHÓN 🎉' : '') + '. Enseñando cartas…';
      return;
    }
    if (g.state === 'roundEnd' || g.state === 'gameOver') { b.textContent = 'Ronda terminada.'; return; }
    if (g.state === 'aborted') { b.textContent = 'Reiniciando ronda…'; return; }
    if (S.spectating) { b.textContent = 'Estás de espectador: entrarás en la próxima ronda.'; return; }
    if (g.eliminated.has(S.playerId)) { b.textContent = '💀 Eliminado. Puedes mirar la partida.'; return; }
    var ph = myTurnPhase();
    if (ph === 'draw') {
      b.textContent = '🎯 Tu turno: toca el mazo o el descarte para robar.';
      b.classList.add('my-turn');
    } else if (ph === 'discard') {
      var can = L.canClose(g.hand);
      b.textContent = can ? '🎉 ¡Puedes CERRAR! O descarta una carta.' : 'Elige una carta de tu mano y descártala.';
      b.classList.add('my-turn');
    } else if (g.turnId) {
      b.textContent = 'Turno de ' + playerName(g.turnId) + '…';
    } else {
      b.textContent = 'Repartiendo…';
    }
  }

  function renderOpponents() {
    var box = $('opponents');
    box.innerHTML = '';
    var g = S.game;
    if (!g) return;
    g.roster.forEach(function (id) {
      if (id === S.playerId) return;
      var chip = el('div', null, 'chip' + (g.turnId === id && g.state === 'playing' ? ' activo' : '') + (g.eliminated.has(id) ? ' eliminado' : ''));
      chip.appendChild(el('span', (g.eliminated.has(id) ? '💀 ' : '') + playerName(id)));
      chip.appendChild(el('span', '🂠 ' + (g.counts[id] || 0), 'ncartas'));
      var pts = el('span', (g.scores[id] || 0) + ' pts', 'ncartas');
      chip.appendChild(pts);
      box.appendChild(chip);
    });
  }

  function renderTable() {
    var g = S.game;
    var stock = $('pile-stock'), disc = $('pile-discard');
    stock.onclick = null; disc.onclick = null;
    stock.classList.remove('activa'); disc.classList.remove('activa');
    // limpia la carta visible del descarte
    var old = disc.querySelector('.carta');
    if (old) old.remove();
    if (!g) { $('stock-count').textContent = '0'; return; }
    $('stock-count').textContent = g.stockCount;
    if (g.discardTop) disc.insertBefore(cardEl(g.discardTop), disc.firstChild);
    if (myTurnPhase() === 'draw' && !S.awaitingCard) {
      stock.classList.add('activa'); stock.onclick = doDrawStock;
      if (g.discardTop) { disc.classList.add('activa'); disc.onclick = doDrawDiscard; }
    }
  }

  function renderHand() {
    var box = $('hand');
    box.innerHTML = '';
    var g = S.game;
    if (!g || S.spectating) return;
    var jugable = myTurnPhase() === 'discard';
    g.hand.forEach(function (c) {
      var d = cardEl(c);
      if (jugable) {
        d.classList.add('jugable');
        if (c.id === S.selectedId) d.classList.add('selected');
        (function (id) {
          d.onclick = function () {
            S.selectedId = (S.selectedId === id) ? null : id;
            renderHand(); renderActions();
          };
        })(c.id);
      }
      box.appendChild(d);
    });
  }

  function renderActions() {
    var box = $('actions');
    box.innerHTML = '';
    if (myTurnPhase() !== 'discard') return;
    var btnD = el('button', 'Descartar', 'btn');
    btnD.disabled = !S.selectedId;
    btnD.onclick = doDiscard;
    box.appendChild(btnD);
    if (S.game && L.canClose(S.game.hand)) {
      var btnC = el('button', S.game && L.canClose(S.game.hand).chinchon ? '🎉 ¡CHINCHÓN!' : '✋ Cerrar', 'btn btn-cerrar');
      btnC.onclick = doClose;
      box.appendChild(btnC);
    }
  }

  function renderScores() {
    var ul = $('scores-list');
    ul.innerHTML = '';
    var g = S.game;
    if (!g) return;
    var ids = g.roster.slice().sort(function (a, b) { return (g.scores[a] || 0) - (g.scores[b] || 0); });
    ids.forEach(function (id) {
      var li = el('li');
      var name = playerName(id) + (id === S.playerId ? ' (tú)' : '') + (g.eliminated.has(id) ? ' 💀' : '');
      li.appendChild(el('span', name));
      li.appendChild(el('span', (g.scores[id] || 0) + ' pts'));
      ul.appendChild(li);
    });
  }

  // ---------- modal de fin de ronda / partida ----------
  function showRoundEndModal(p, isGameOver) {
    var g = S.game;
    var wrap = el('div');
    if (isGameOver) {
      wrap.appendChild(el('div', '🏆', 'winner'));
      var h = el('h2', '¡' + playerName(p.winnerId) + ' gana la partida!');
      h.style.textAlign = 'center';
      wrap.appendChild(h);
    } else {
      var t = el('h2', (p.chinchon ? '🎉 ¡CHINCHÓN de ' : '✋ Cierra ') + playerName(p.closerId) + (p.chinchon ? '!' : ''));
      wrap.appendChild(t);
      var sub = el('p', 'Ronda ' + p.round + ' · puntos de la ronda:', 'muted');
      sub.style.color = '#555';
      wrap.appendChild(sub);
    }

    // jugadas del que cierra
    var cm = el('div');
    cm.appendChild(el('strong', 'Jugada de ' + playerName(p.closerId) + ':'));
    (p.closerMelds || []).forEach(function (meld) {
      var row = el('div', null, 'mano-revelada');
      meld.forEach(function (c) { row.appendChild(cardEl(c, true)); });
      cm.appendChild(row);
    });
    wrap.appendChild(cm);

    // tabla de puntos
    var table = el('table', null, 'tabla-puntos');
    var thead = el('tr');
    ['Jugador', 'Ronda', 'Total'].forEach(function (t2) { thead.appendChild(el('th', t2)); });
    table.appendChild(thead);
    var ids = g.roster.slice().sort(function (a, b) { return (p.totals[a] || 0) - (p.totals[b] || 0); });
    ids.forEach(function (id) {
      var tr = el('tr');
      var nm = playerName(id) + (id === S.playerId ? ' (tú)' : '');
      var tdN = el('td', nm);
      if (p.eliminated.indexOf(id) !== -1) {
        tdN.appendChild(el('span', ' 💀 eliminado', 'eliminado-tag'));
      }
      tr.appendChild(tdN);
      tr.appendChild(el('td', String(p.roundScores[id] !== undefined ? p.roundScores[id] : '—'), 'num'));
      tr.appendChild(el('td', String(p.totals[id] || 0), 'num'));
      table.appendChild(tr);
    });
    wrap.appendChild(table);

    var row = el('div', null, 'row');
    if (S.isHost && !isGameOver) {
      var btnN = el('button', '▶ Siguiente ronda', 'btn btn-big');
      btnN.onclick = function () { hostStartRound(false); };
      row.appendChild(btnN);
    }
    if (S.isHost && isGameOver) {
      var btnR = el('button', '🔄 Jugar otra vez', 'btn btn-big');
      btnR.onclick = function () { hostStartRound(true); };
      row.appendChild(btnR);
    }
    if (!S.isHost) {
      row.appendChild(el('p', 'Esperando al anfitrión…', 'muted'));
    }
    var btnX = el('button', 'Ver la mesa', 'btn-secondary');
    btnX.onclick = hideModal;
    row.appendChild(btnX);
    wrap.appendChild(row);

    showModal(wrap);
  }

  // ---------- arranque ----------
  showScreen('home');
})();
