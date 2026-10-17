/* ============================================================
 * Chinchimoni — el juego de las monedas escondidas, online o
 * en solitario contra la IA.
 *
 * Normas (v2):
 *  - Todos esconden 0..3 monedas en el puño a la vez.
 *  - Por turnos (rotando quién empieza) se apuesta la suma total,
 *    sin repetir número.
 *  - Quien acierta en una ronda queda SALVADO y no juega más
 *    (en la primera ronda nadie queda salvado).
 *  - Con 2 jugadores: DUELO FINAL, el primero en acertar 3 rondas
 *    se salva; el otro es el pringado.
 *
 * Online: sin servidor propio; el anfitrión arbitra y los eventos
 * viajan por Supabase Realtime (canal `chinchimoni-XXXX`).
 * En solitario: partida local contra la IA, sin red.
 * ============================================================ */
(function () {
  'use strict';

  var SB_URL = 'https://zjcthmglltdrefwnflqm.supabase.co';
  var SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqY3RobWdsbHRkcmVmd25mbHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODA5OTMsImV4cCI6MjEwNzY1Njk5M30.hWorZSMT1C5dMVXYAaR2_fuduVwit4uJ9qrPGXcBk7o';

  var L = Chinchimoni;
  var AI_NAMES = ['Ada 🤖', 'Turing 🤖', 'Pepe Bot', 'Lola Bot', 'Curro Bot'];

  // ---------- estado ----------
  var S = {
    name: '', playerId: '', joinedAt: 0, roomCode: '',
    channel: null, sb: null, local: false,
    isHost: false, players: [],
    screen: 'home',
    selHide: null, selGuess: null, soloCount: 3,
    game: null,   // estado de la ronda
    host: null    // {hides:{}, guesses:{}, order:[], idx:0} solo anfitrión
  };

  // ---------- utilidades ----------
  function $(id) { return document.getElementById(id); }
  function randId() { return 'p' + Math.random().toString(36).slice(2, 10); }
  function makeRoomCode() {
    var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', c = '';
    for (var i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }
  function isAI(id) { return id.indexOf('ai-') === 0; }
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
  function showModal(node) {
    $('modal-panel').innerHTML = '';
    $('modal-panel').appendChild(node);
    $('modal').classList.remove('hidden');
  }
  function hideModal() { $('modal').classList.add('hidden'); }
  function send(type, payload) {
    if (S.channel) S.channel.send({ type: 'broadcast', event: type, payload: payload });
  }
  function presentIds() {
    var m = {};
    S.players.forEach(function (p) { m[p.id] = true; });
    return m;
  }
  function playerName(id) {
    return (S.game && S.game.names[id]) || '¿?';
  }
  function inRoster() {
    return S.game && S.game.roster.indexOf(S.playerId) !== -1;
  }
  function isSaved() {
    return S.game && S.game.saved.indexOf(S.playerId) !== -1;
  }
  function earliestInOrder(ids, order) {
    for (var i = 0; i < order.length; i++) {
      if (ids.indexOf(order[i]) !== -1) return order[i];
    }
    return ids[0];
  }

  // ---------- portada ----------
  function getName() {
    var n = $('input-name').value.trim().slice(0, 12) || 'Tú';
    try { localStorage.setItem('chinchimoni-name', n); } catch (e) {}
    return n;
  }
  $('btn-create').addEventListener('click', function () {
    var n = $('input-name').value.trim().slice(0, 12);
    if (!n) { $('home-error').textContent = 'Escribe tu nombre primero.'; return; }
    try { localStorage.setItem('chinchimoni-name', n); } catch (e) {}
    joinRoom(makeRoomCode(), n);
  });
  $('btn-join').addEventListener('click', function () {
    var n = $('input-name').value.trim().slice(0, 12);
    if (!n) { $('home-error').textContent = 'Escribe tu nombre primero.'; return; }
    try { localStorage.setItem('chinchimoni-name', n); } catch (e) {}
    var code = $('input-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { $('home-error').textContent = 'El código tiene 4 letras/números.'; return; }
    joinRoom(code, n);
  });
  // --- modo en solitario ---
  $('btn-solo').addEventListener('click', function () {
    $('solo-setup').classList.toggle('hidden');
  });
  (function buildSoloCount() {
    var box = $('solo-count');
    for (var n = 1; n <= 5; n++) {
      (function (k) {
        var b = el('button', String(k), 'num' + (S.soloCount === k ? ' sel' : ''));
        b.style.minWidth = '52px';
        b.onclick = function () {
          S.soloCount = k;
          var btns = box.querySelectorAll('.num');
          for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('sel', i === k - 1);
        };
        box.appendChild(b);
      })(n);
    }
  })();
  $('btn-solo-start').addEventListener('click', function () {
    startLocalGame(S.soloCount);
  });
  try {
    var saved = localStorage.getItem('chinchimoni-name');
    if (saved) $('input-name').value = saved;
  } catch (e) {}

  function startLocalGame(nAI) {
    var name = getName();
    S.name = name;
    S.playerId = 'humano';
    S.joinedAt = Date.now();
    S.roomCode = 'SOLO';
    S.local = true;
    S.isHost = true;
    S.channel = null;
    S.players = [{ id: 'humano', name: name, joinedAt: 0 }];
    for (var i = 0; i < nAI; i++) {
      S.players.push({ id: 'ai-' + i, name: AI_NAMES[i % AI_NAMES.length], joinedAt: i + 1 });
    }
    S.game = null;
    S.host = null;
    hostStartRound(true);
  }

  // ---------- conexión a la sala (online) ----------
  function joinRoom(code, name) {
    $('home-error').textContent = '';
    S.name = name;
    S.playerId = randId();
    S.joinedAt = Date.now();
    S.roomCode = code;
    S.local = false;
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
    ch.on('broadcast', { event: 'hide' }, onHide);
    ch.on('broadcast', { event: 'hide_progress' }, onHideProgress);
    ch.on('broadcast', { event: 'guessing_start' }, onGuessingStart);
    ch.on('broadcast', { event: 'guess_turn' }, onGuessTurn);
    ch.on('broadcast', { event: 'guess' }, onGuess);
    ch.on('broadcast', { event: 'reveal' }, onReveal);
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
    S.isHost = false; S.local = false; S.selHide = null; S.selGuess = null;
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

  // ---------- presence (online) ----------
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
      if (S.isHost && !wasHost) {
        if (S.game.state === 'gameOver' && S.game.lastGameOver) {
          send('game_over', S.game.lastGameOver);
        } else {
          send('round_abort', { reason: 'El anfitrión se desconectó. Nueva ronda.' });
          hostStartRound(false);
          return;
        }
      }
      if (S.isHost) hostWatchdog();
      renderAll();
    }
  }

  function hostWatchdog() {
    var g = S.game;
    if (!g || !S.host || S.local) return;
    var pr = presentIds();
    if (g.state === 'hiding') {
      var need = g.roster.filter(function (id) { return pr[id]; });
      var doneIds = need.filter(function (id) { return S.host.hides[id] !== undefined; });
      if (need.length && doneIds.length === need.length) beginGuessing();
      else {
        g.hideDone = doneIds.length; g.hideTotal = need.length;
        send('hide_progress', { done: g.hideDone, total: g.hideTotal });
        renderBanner(); renderStage();
      }
    } else if (g.state === 'guessing') {
      if (!pr[g.turnId]) advanceGuess();
    }
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
      ? 'Sala llena: quien entre ahora mirará hasta la próxima ronda.'
      : 'Comparte el código con tus amigos. El primero en entrar es el anfitrión 👑.';
  }
  $('btn-start').addEventListener('click', function () {
    if (!S.isHost || S.players.length < 2) return;
    hostStartRound(true);
  });

  // ---------- ronda (anfitrión / local) ----------
  function hostStartRound(reset) {
    var present = S.players.slice(0, L.MAX_PLAYERS);
    var prevSaved = (S.game && S.game.saved) || [];
    var prevStarter = S.game && S.game.starterId;
    var prevFinal = S.game && S.game.finalDuel;
    var saved = reset ? [] : prevSaved;

    var roster = present.map(function (p) { return p.id; })
      .filter(function (id) { return saved.indexOf(id) === -1; });
    if (roster.length < 2) { toast('Se necesitan al menos 2 jugadores.'); return; }

    var names = {};
    present.forEach(function (p) { names[p.id] = p.name; });
    var coins = {};
    roster.forEach(function (id) { coins[id] = L.START_COINS; });

    var finalDuel = roster.length === 2;
    var hits = (finalDuel && prevFinal && !reset) ? Object.assign({}, S.game.hits) : {};
    roster.forEach(function (id) { if (hits[id] === undefined) hits[id] = 0; });

    var starterId = roster[0];
    if (!reset && prevStarter) {
      var ni = roster.indexOf(prevStarter);
      starterId = ni === -1 ? roster[0] : roster[(ni + 1) % roster.length];
    }

    S.host = { hides: {}, guesses: {}, order: [], idx: 0 };
    S.game = {
      roster: roster, names: names, coins: coins,
      saved: saved, finalDuel: finalDuel, hits: hits,
      round: (S.game && !reset) ? S.game.round + 1 : 1,
      state: 'hiding', starterId: starterId, turnId: null,
      maxTotal: L.maxTotal(coins),
      myHide: null, hideDone: 0, hideTotal: roster.length,
      guesses: {}, guessOrder: [],
      lastReveal: null, lastGameOver: null, winnerId: null, loserId: null
    };
    S.selHide = null; S.selGuess = null;
    hideModal();

    send('start_round', {
      roster: roster, names: names, coins: coins, saved: saved,
      finalDuel: finalDuel, hits: hits,
      round: S.game.round, starterId: starterId, maxTotal: S.game.maxTotal
    });
    showScreen('game');
    renderAll();
    toast(finalDuel
      ? '⚔️ ¡Duelo final! El primero en acertar ' + L.FINAL_HITS_TO_WIN + ' rondas se salva'
      : '🪙 Ronda ' + S.game.round + ': esconde tus monedas');
    if (S.local) scheduleAiHides();
  }

  function onHide(p) {
    if (!S.isHost || !S.game || S.game.state !== 'hiding') return;
    if (S.game.roster.indexOf(p.playerId) === -1) return;
    // En la primera ronda hay que esconder mínimo 1 moneda.
    var minHide = S.game.round === 1 ? 1 : 0;
    var n = Math.max(minHide, Math.min(L.START_COINS, p.count | 0));
    S.host.hides[p.playerId] = n;
    var pr = presentIds();
    var need = S.game.roster.filter(function (id) { return pr[id]; });
    var done = need.filter(function (id) { return S.host.hides[id] !== undefined; }).length;
    // El anfitrión también actualiza su propio marcador (self:false no le devuelve el evento).
    S.game.hideDone = done;
    S.game.hideTotal = need.length;
    send('hide_progress', { done: done, total: need.length });
    renderBanner(); renderStage();
    if (need.length && done === need.length) beginGuessing();
  }

  function beginGuessing() {
    var g = S.game;
    var pr = presentIds();
    var order = L.turnOrder(g.roster.filter(function (id) { return pr[id]; }), g.starterId);
    if (!order.length) { send('round_abort', { reason: 'No queda nadie en la sala.' }); return; }
    S.host.order = order;
    S.host.idx = 0;
    g.state = 'guessing';
    g.turnId = order[0];
    g.guessOrder = order;
    send('guessing_start', { order: order });
    send('guess_turn', { playerId: order[0] });
    // self:false: el anfitrión aplica sus propios eventos
    onGuessingStart({ order: order });
    onGuessTurn({ playerId: order[0] });
  }

  function onGuess(p) {
    if (!S.game || S.game.state !== 'guessing') return;
    if (S.game.guesses[p.playerId] !== undefined) return;
    S.game.guesses[p.playerId] = p.number;
    renderAll();
    if (S.isHost) {
      S.host.guesses[p.playerId] = p.number;
      advanceGuess();
    }
  }

  function advanceGuess() {
    var g = S.game;
    var pr = presentIds();
    S.host.idx++;
    while (S.host.idx < S.host.order.length && !pr[S.host.order[S.host.idx]]) S.host.idx++;
    if (S.host.idx >= S.host.order.length) { finishRound(); return; }
    var next = S.host.order[S.host.idx];
    g.turnId = next;
    send('guess_turn', { playerId: next });
    onGuessTurn({ playerId: next });
  }

  function finishRound() {
    var g = S.game;
    var hides = {};
    S.host.order.forEach(function (id) {
      if (S.host.hides[id] !== undefined) hides[id] = S.host.hides[id];
    });
    var total = L.roundTotal(hides);
    var correct = L.correctGuessers(S.host.guesses, total);

    if (g.finalDuel) {
      correct.forEach(function (id) { g.hits[id] = (g.hits[id] || 0) + 1; });
      var champs = g.roster.filter(function (id) { return (g.hits[id] || 0) >= L.FINAL_HITS_TO_WIN; });
      if (champs.length) {
        var winnerId = earliestInOrder(champs, S.host.order);
        var loserId = g.roster.filter(function (id) { return id !== winnerId; })[0] || null;
        var payload = {
          winnerId: winnerId, loserId: loserId, finalDuel: true,
          hides: hides, total: total, guesses: S.host.guesses, correct: correct,
          hits: Object.assign({}, g.hits), saved: g.saved.slice(),
          coins: g.coins, round: g.round
        };
        send('game_over', payload);
        onGameOver(payload);
      } else {
        var payload2 = {
          finalDuel: true, duelContinues: true,
          hides: hides, total: total, guesses: S.host.guesses, correct: correct,
          hits: Object.assign({}, g.hits), newlySaved: [],
          saved: g.saved.slice(), coins: g.coins, round: g.round
        };
        send('reveal', payload2);
        onReveal(payload2);
      }
      return;
    }

    // Fase normal: quien acierta queda salvado (también en la ronda 1).
    var newlySaved = correct.slice();
    var saved = g.saved.concat(newlySaved);
    var remaining = g.roster.filter(function (id) { return saved.indexOf(id) === -1; });

    if (remaining.length <= 1) {
      var payload3 = {
        winnerId: null, loserId: remaining[0] || null, finalDuel: false,
        everyoneSaved: remaining.length === 0,
        hides: hides, total: total, guesses: S.host.guesses, correct: correct,
        newlySaved: newlySaved, saved: saved, coins: g.coins, round: g.round
      };
      send('game_over', payload3);
      onGameOver(payload3);
    } else {
      var payload4 = {
        finalDuel: false, startDuel: remaining.length === 2,
        hides: hides, total: total, guesses: S.host.guesses, correct: correct,
        newlySaved: newlySaved, saved: saved, coins: g.coins, round: g.round
      };
      send('reveal', payload4);
      onReveal(payload4);
    }
  }

  // ---------- eventos (todos) ----------
  function onStartRound(p) {
    S.game = {
      roster: p.roster, names: p.names, coins: p.coins,
      saved: p.saved || [], finalDuel: !!p.finalDuel, hits: p.hits || {},
      round: p.round, state: 'hiding', starterId: p.starterId, turnId: null,
      maxTotal: p.maxTotal,
      myHide: null, hideDone: 0, hideTotal: p.roster.length,
      guesses: {}, guessOrder: [],
      lastReveal: S.game ? S.game.lastReveal : null,
      lastGameOver: S.game ? S.game.lastGameOver : null,
      winnerId: null, loserId: null
    };
    S.selHide = null; S.selGuess = null;
    hideModal();
    showScreen('game');
    renderAll();
    toast(p.finalDuel
      ? '⚔️ ¡Duelo final! El primero en acertar ' + L.FINAL_HITS_TO_WIN + ' rondas se salva'
      : '🪙 Ronda ' + p.round + ': esconde tus monedas');
    if (S.local) scheduleAiHides();
  }

  function onHideProgress(p) {
    if (!S.game) return;
    S.game.hideDone = p.done;
    S.game.hideTotal = p.total;
    renderBanner(); renderStage();
  }

  function onGuessingStart(p) {
    if (!S.game) return;
    S.game.state = 'guessing';
    S.game.guessOrder = p.order;
    renderAll();
  }

  function onGuessTurn(p) {
    if (!S.game) return;
    S.game.state = 'guessing';
    S.game.turnId = p.playerId;
    S.selGuess = null;
    renderAll();
    if (p.playerId === S.playerId && inRoster() && S.game.guesses[S.playerId] === undefined) {
      toast('🎯 Te toca: ¿cuántas monedas suman entre todos?');
    }
    if (S.local && isAI(p.playerId)) {
      var round = S.game.round, aiId = p.playerId;
      setTimeout(function () {
        if (!S.game || S.game.round !== round) return;
        if (S.game.state !== 'guessing' || S.game.turnId !== aiId) return;
        if (S.game.guesses[aiId] !== undefined) return;
        aiGuess(aiId);
      }, 700 + Math.random() * 600);
    }
  }

  function onReveal(p) {
    if (!S.game) return;
    S.game.state = 'reveal';
    S.game.saved = p.saved || S.game.saved;
    if (p.hits) S.game.hits = p.hits;
    S.game.lastReveal = p;
    renderAll();
  }

  function onGameOver(p) {
    if (!S.game) return;
    S.game.state = 'gameOver';
    S.game.winnerId = p.winnerId;
    S.game.loserId = p.loserId;
    S.game.saved = p.saved || S.game.saved;
    if (p.hits) S.game.hits = p.hits;
    S.game.lastReveal = p;
    S.game.lastGameOver = p;
    renderAll();
    showGameOverModal(p);
  }

  function onRoundAbort(p) {
    if (!S.game) return;
    hideModal();
    renderAll();
    toast(p.reason || 'Ronda anulada.', 4000);
  }

  // ---------- acciones del jugador ----------
  function submitHide(pid, n) {
    if (!S.game || S.game.state !== 'hiding') return;
    if (S.game.roster.indexOf(pid) === -1) return;
    if (pid === S.playerId) {
      if (S.game.myHide !== null) return;
      S.game.myHide = n;
    }
    send('hide', { playerId: pid, count: n });
    if (S.isHost) onHide({ playerId: pid, count: n }); // self:false: aplicar local
    renderAll();
  }

  function doHide() {
    if (S.selHide === null) return;
    submitHide(S.playerId, S.selHide);
  }

  function submitGuess(pid, n) {
    var g = S.game;
    if (!g || g.state !== 'guessing') return;
    if (g.turnId !== pid || g.guesses[pid] !== undefined) return;
    if (n < 0 || n > g.maxTotal) return;
    var used = {};
    Object.keys(g.guesses).forEach(function (id) { used[g.guesses[id]] = true; });
    if (used[n]) return;
    send('guess', { playerId: pid, number: n });
    if (S.isHost) {
      onGuess({ playerId: pid, number: n }); // el anfitrión aplica y avanza el turno
    } else {
      g.guesses[pid] = n; // self:false: mi propio evento no me vuelve
    }
    if (pid === S.playerId) S.selGuess = null;
    renderAll();
  }

  function doGuess() {
    if (S.selGuess === null) return;
    submitGuess(S.playerId, S.selGuess);
  }

  // ---------- IA (modo en solitario) ----------
  function scheduleAiHides() {
    var g = S.game;
    if (!g) return;
    var round = g.round;
    var minH = round === 1 ? 1 : 0; // en la primera ronda mínimo 1 moneda
    g.roster.forEach(function (id, i) {
      if (!isAI(id)) return;
      setTimeout(function () {
        if (!S.game || S.game.round !== round) return;
        if (S.game.state !== 'hiding') return;
        if (S.host.hides[id] !== undefined) return;
        submitHide(id, minH + Math.floor(Math.random() * (L.START_COINS + 1 - minH)));
      }, 500 + i * 450);
    });
  }

  function aiGuess(aiId) {
    var g = S.game;
    var h = S.host.hides[aiId] || 0;
    var n = g.roster.length;
    var lo = h, hi = h + L.START_COINS * (n - 1);
    var used = {};
    Object.keys(g.guesses).forEach(function (id) { used[g.guesses[id]] = true; });
    var target = h + (L.START_COINS / 2) * (n - 1) + (Math.random() * 2 - 1);
    var best = null, bestD = 1e9;
    for (var v = lo; v <= hi; v++) {
      if (used[v]) continue;
      var d = Math.abs(v - target);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best === null) {
      for (var w = 0; w <= g.maxTotal; w++) {
        if (!used[w]) { best = w; break; }
      }
    }
    if (best !== null) submitGuess(aiId, best);
  }

  // ---------- render ----------
  function renderAll() {
    renderBanner(); renderPlayers(); renderStage(); renderActions(); renderScores();
    $('game-round').textContent = S.game && S.game.finalDuel
      ? '⚔️ Duelo final'
      : 'Ronda ' + (S.game ? S.game.round : 1);
    $('game-code').textContent = S.local ? 'en solitario' : 'sala ' + S.roomCode;
  }

  function renderBanner() {
    var b = $('turn-banner');
    var g = S.game;
    b.classList.remove('my-turn');
    if (!g) { b.textContent = '…'; return; }
    if (!inRoster()) {
      b.textContent = isSaved()
        ? '✅ ¡Estás salvado! A ver quién es el pringado…'
        : 'Miras la partida: entrarás en la próxima.';
      return;
    }
    if (g.state === 'hiding') {
      if (g.myHide === null) {
        var minH = g.round === 1 ? 1 : 0;
        b.textContent = '✊ Esconde tus monedas en el puño (' + minH + '–' + L.START_COINS + ')' +
          (g.round === 1 ? ' — en la primera ronda mínimo 1' : '');
        b.classList.add('my-turn');
      } else {
        b.textContent = 'Puño cerrado… esperando al resto (' + g.hideDone + '/' + g.hideTotal + ')';
      }
    } else if (g.state === 'guessing') {
      if (g.turnId === S.playerId && g.guesses[S.playerId] === undefined) {
        b.textContent = '🎯 Te toca: ¿cuántas monedas suman entre todos?';
        b.classList.add('my-turn');
      } else if (g.guesses[S.playerId] !== undefined) {
        b.textContent = 'Dijiste ' + g.guesses[S.playerId] + '. Esperando al resto…';
      } else {
        b.textContent = playerName(g.turnId) + ' está pensando su número…';
      }
    } else if (g.state === 'reveal' && g.lastReveal) {
      var r = g.lastReveal;
      var msg = '🖐️ ¡Manos arriba! Total: ' + r.total;
      if (r.finalDuel) {
        var hs = g.roster.map(function (id) { return playerName(id) + ' ' + (g.hits[id] || 0); }).join(' · ');
        msg += ' — aciertos: ' + hs;
      } else if (r.newlySaved && r.newlySaved.length) {
        msg += ' — ✅ salvados: ' + r.newlySaved.map(playerName).join(', ');
      } else {
        msg += ' — nadie acertó';
      }
      if (r.startDuel) msg += ' — ⚔️ ¡la próxima es duelo final!';
      b.textContent = msg;
    } else if (g.state === 'gameOver') {
      b.textContent = 'Partida terminada.';
    }
  }

  function renderPlayers() {
    var box = $('opponents');
    box.innerHTML = '';
    var g = S.game;
    if (!g) return;
    var show = g.roster.concat(g.saved.filter(function (id) { return g.roster.indexOf(id) === -1; }));
    show.forEach(function (id) {
      var savedP = g.saved.indexOf(id) !== -1;
      var active = !savedP && g.state === 'guessing' && g.turnId === id && g.guesses[id] === undefined;
      var chip = el('div', null, 'chip' + (active ? ' activo' : '') + (savedP ? ' salvado' : ''));
      chip.appendChild(el('span', (savedP ? '✅ ' : '') + playerName(id) + (id === S.playerId ? ' (tú)' : '')));
      if (g.finalDuel && !savedP) {
        chip.appendChild(el('span', '🎯 ' + (g.hits[id] || 0) + '/' + L.FINAL_HITS_TO_WIN, 'ncartas'));
      }
      box.appendChild(chip);
    });
  }

  function renderStage() {
    var st = $('stage');
    st.innerHTML = '';
    var g = S.game;
    if (!g) return;

    // El revelado lo ven todos, incluidos salvados y espectadores.
    if (g.state === 'reveal' && g.lastReveal) {
      var r = g.lastReveal;
      st.appendChild(el('p', '🖐️ Total: ' + r.total + ' monedas', 'stage-title big'));
      var list = el('div', null, 'reveal-list');
      g.roster.forEach(function (id) {
        var ok = r.correct.indexOf(id) !== -1;
        var row2 = el('div', null, 'reveal-row' + (ok ? ' hit' : ''));
        row2.appendChild(el('span', (ok ? '✅ ' : '') + playerName(id) + (id === S.playerId ? ' (tú)' : '')));
        row2.appendChild(el('span', '✊ ' + (r.hides[id] || 0) + ' 🪙', 'fist'));
        row2.appendChild(el('span', 'dijo ' + (r.guesses[id] !== undefined ? r.guesses[id] : '—'), 'muted'));
        list.appendChild(row2);
      });
      st.appendChild(list);
      return;
    }

    if (!inRoster()) return;

    if (g.state === 'hiding' && g.myHide === null) {
      var minH2 = g.round === 1 ? 1 : 0;
      st.appendChild(el('p', '¿Cuántas escondes?' + (g.round === 1 ? ' (mínimo 1)' : ''), 'stage-title'));
      var row = el('div', null, 'numpad');
      for (var i = minH2; i <= L.START_COINS; i++) {
        (function (n) {
          var btn = el('button', String(n), 'num' + (S.selHide === n ? ' sel' : ''));
          btn.onclick = function () { S.selHide = n; renderStage(); renderActions(); };
          row.appendChild(btn);
        })(i);
      }
      st.appendChild(row);
    } else if (g.state === 'guessing') {
      if (g.guessOrder.length) {
        var gl = el('div', null, 'guesses');
        g.guessOrder.forEach(function (id) {
          var v = g.guesses[id];
          var chip = el('div', null, 'guess-chip' + (v === undefined ? ' pending' : ''));
          chip.appendChild(el('span', playerName(id)));
          chip.appendChild(el('strong', v === undefined ? '…' : String(v)));
          gl.appendChild(chip);
        });
        st.appendChild(gl);
      }
      if (g.turnId === S.playerId && g.guesses[S.playerId] === undefined) {
        st.appendChild(el('p', 'Di un número del 0 al ' + g.maxTotal + ' (sin repetir):', 'stage-title'));
        var used = {};
        Object.keys(g.guesses).forEach(function (id) { used[g.guesses[id]] = true; });
        var pad = el('div', null, 'numpad');
        for (var n2 = 0; n2 <= g.maxTotal; n2++) {
          (function (n) {
            var b = el('button', String(n), 'num' + (S.selGuess === n ? ' sel' : ''));
            b.disabled = !!used[n];
            b.onclick = function () { S.selGuess = n; renderStage(); renderActions(); };
            pad.appendChild(b);
          })(n2);
        }
        st.appendChild(pad);
      }
    }
  }

  function renderActions() {
    var box = $('actions');
    box.innerHTML = '';
    var g = S.game;
    if (!g) return;
    // El anfitrión avanza la partida aunque él ya esté salvado.
    if (g.state === 'reveal' && S.isHost) {
      var b3 = el('button', g.lastReveal && g.lastReveal.startDuel ? '⚔️ Empezar el duelo' : '▶ Siguiente ronda', 'btn btn-big');
      b3.onclick = function () { hostStartRound(false); };
      box.appendChild(b3);
      return;
    }
    if (!inRoster()) return;
    if (g.state === 'hiding' && g.myHide === null) {
      var b = el('button', 'Esconder ✊', 'btn btn-big');
      b.disabled = S.selHide === null;
      b.onclick = doHide;
      box.appendChild(b);
    } else if (g.state === 'guessing' && g.turnId === S.playerId && g.guesses[S.playerId] === undefined) {
      var b2 = el('button', 'Adivinar 🎯', 'btn btn-big');
      b2.disabled = S.selGuess === null;
      b2.onclick = doGuess;
      box.appendChild(b2);
    }
  }

  function renderScores() {
    var ul = $('scores-list');
    ul.innerHTML = '';
    var g = S.game;
    if (!g) return;
    if (g.saved.length) {
      var li0 = el('li');
      li0.appendChild(el('span', '✅ Salvados'));
      li0.appendChild(el('span', g.saved.map(playerName).join(', ')));
      ul.appendChild(li0);
    }
    g.roster.forEach(function (id) {
      var li = el('li');
      li.appendChild(el('span', playerName(id) + (id === S.playerId ? ' (tú)' : '')));
      var extra = g.finalDuel ? '🎯 ' + (g.hits[id] || 0) + '/' + L.FINAL_HITS_TO_WIN + '  ' : '';
      li.appendChild(el('span', extra + '🪙🪙🪙'));
      ul.appendChild(li);
    });
  }

  function showGameOverModal(p) {
    var g = S.game;
    var wrap = el('div');
    if (p.finalDuel) {
      wrap.appendChild(el('div', '🏆', 'winner'));
      var h = el('h2', '¡' + playerName(p.winnerId) + ' gana el duelo!');
      h.style.textAlign = 'center';
      wrap.appendChild(h);
      var sub = el('p', 'Acertó ' + L.FINAL_HITS_TO_WIN + ' rondas antes que nadie. ' +
        (p.loserId ? playerName(p.loserId) + ' es el pringado 😅' : ''), 'muted');
      sub.style.textAlign = 'center'; sub.style.color = '#555';
      wrap.appendChild(sub);
    } else if (p.everyoneSaved) {
      wrap.appendChild(el('div', '🎉', 'winner'));
      var h2 = el('h2', '¡Todos salvados!');
      h2.style.textAlign = 'center';
      wrap.appendChild(h2);
      var sub2 = el('p', 'No hay pringado esta vez.', 'muted');
      sub2.style.textAlign = 'center'; sub2.style.color = '#555';
      wrap.appendChild(sub2);
    } else {
      wrap.appendChild(el('div', '😅', 'winner'));
      var h3 = el('h2', '¡' + playerName(p.loserId) + ' es el pringado!');
      h3.style.textAlign = 'center';
      wrap.appendChild(h3);
      var sub3 = el('p', 'Todos los demás quedaron salvados: ' + (p.saved || []).map(playerName).join(', '), 'muted');
      sub3.style.textAlign = 'center'; sub3.style.color = '#555';
      wrap.appendChild(sub3);
    }
    var row = el('div', null, 'row');
    if (S.isHost) {
      var btnR = el('button', '🔄 Jugar otra vez', 'btn btn-big');
      btnR.onclick = function () { hostStartRound(true); };
      row.appendChild(btnR);
    } else {
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
