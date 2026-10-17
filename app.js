/* ============================================================
 * Chinchimoni — el juego de las monedas escondidas, online.
 * Sin servidor propio: el anfitrión (host) arbitra la ronda;
 * los eventos viajan por broadcast en el canal `chinchimoni-XXXX`.
 * Cada jugador esconde 0..N monedas en el puño (viaja etiquetado
 * con su destinatario: entre amigos se juega con confianza).
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
    isHost: false, players: [],
    screen: 'home',
    selHide: null, selGuess: null,
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
    S.isHost = false; S.selHide = null; S.selGuess = null;
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
      if (S.isHost && !wasHost) {
        // Migración de anfitrión: el siguiente toma el mando.
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
    if (!g || !S.host) return;
    var pr = presentIds();
    if (g.state === 'hiding') {
      var need = g.roster.filter(function (id) { return pr[id]; });
      if (need.length && need.every(function (id) { return S.host.hides[id] !== undefined; })) beginGuessing();
      else send('hide_progress', { done: need.filter(function (id) { return S.host.hides[id] !== undefined; }).length, total: need.length });
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

  // ---------- ronda (anfitrión) ----------
  function hostStartRound(reset) {
    var present = S.players.slice(0, L.MAX_PLAYERS);
    var prevCoins = (S.game && S.game.coins) || {};
    var prevStarter = S.game && S.game.starterId;

    var roster = present.map(function (p) { return p.id; });
    if (roster.length < 2) { toast('Se necesitan al menos 2 jugadores.'); return; }

    var names = {};
    present.forEach(function (p) { names[p.id] = p.name; });
    var coins = {};
    roster.forEach(function (id) { coins[id] = reset ? L.START_COINS : (prevCoins[id] !== undefined ? prevCoins[id] : L.START_COINS); });

    var starterId = roster[0];
    if (!reset && prevStarter) {
      var ni = roster.indexOf(prevStarter);
      starterId = ni === -1 ? roster[0] : roster[(ni + 1) % roster.length];
    }

    S.host = { hides: {}, guesses: {}, order: [], idx: 0 };
    S.game = {
      roster: roster, names: names, coins: coins,
      round: (S.game && !reset) ? S.game.round + 1 : 1,
      state: 'hiding', starterId: starterId, turnId: null,
      maxTotal: L.maxTotal(coins),
      myHide: null, hideDone: 0, hideTotal: roster.length,
      guesses: {}, guessOrder: [],
      lastReveal: null, lastGameOver: null, winnerId: null
    };
    S.selHide = null; S.selGuess = null;
    hideModal();

    send('start_round', {
      roster: roster, names: names, coins: coins,
      round: S.game.round, starterId: starterId, maxTotal: S.game.maxTotal
    });
    showScreen('game');
    renderAll();
    toast('🪙 Ronda ' + S.game.round + ': esconde tus monedas');
  }

  function onHide(p) {
    if (!S.isHost || !S.game || S.game.state !== 'hiding') return;
    if (S.game.roster.indexOf(p.playerId) === -1) return;
    var max = S.game.coins[p.playerId] || 0;
    var n = Math.max(0, Math.min(max, p.count | 0));
    S.host.hides[p.playerId] = n;
    var pr = presentIds();
    var need = S.game.roster.filter(function (id) { return pr[id]; });
    var done = need.filter(function (id) { return S.host.hides[id] !== undefined; }).length;
    send('hide_progress', { done: done, total: need.length });
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
    if (!S.game) return;
    if (S.game.state !== 'guessing') return;
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
    var res = L.applyRound(g.coins, correct);
    if (res.winners.length) {
      var payload = {
        winnerId: res.winners[0], hides: hides, total: total,
        guesses: S.host.guesses, correct: correct,
        coins: res.coins, round: g.round
      };
      send('game_over', payload);
      onGameOver(payload);
    } else {
      var payload2 = {
        hides: hides, total: total,
        guesses: S.host.guesses, correct: correct,
        coins: res.coins, round: g.round
      };
      send('reveal', payload2);
      onReveal(payload2);
    }
  }

  // ---------- eventos (todos) ----------
  function onStartRound(p) {
    S.game = {
      roster: p.roster, names: p.names, coins: p.coins,
      round: p.round, state: 'hiding', starterId: p.starterId, turnId: null,
      maxTotal: p.maxTotal,
      myHide: null, hideDone: 0, hideTotal: p.roster.length,
      guesses: {}, guessOrder: [],
      lastReveal: S.game ? S.game.lastReveal : null,
      lastGameOver: S.game ? S.game.lastGameOver : null,
      winnerId: null
    };
    S.selHide = null; S.selGuess = null;
    hideModal();
    showScreen('game');
    renderAll();
    toast('🪙 Ronda ' + p.round + ': esconde tus monedas');
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
    if (p.playerId === S.playerId && inRoster()) toast('🎯 Te toca: ¿cuántas monedas hay en total?');
  }

  function onReveal(p) {
    if (!S.game) return;
    S.game.state = 'reveal';
    S.game.coins = p.coins;
    S.game.lastReveal = p;
    renderAll();
  }

  function onGameOver(p) {
    if (!S.game) return;
    S.game.state = 'gameOver';
    S.game.coins = p.coins;
    S.game.winnerId = p.winnerId;
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
  function doHide() {
    if (!S.game || S.game.state !== 'hiding' || !inRoster()) return;
    if (S.selHide === null || S.game.myHide !== null) return;
    S.game.myHide = S.selHide;
    send('hide', { playerId: S.playerId, count: S.selHide });
    if (S.isHost) onHide({ playerId: S.playerId, count: S.selHide }); // self:false: aplicar local
    renderAll();
  }

  function doGuess() {
    if (!S.game || S.game.state !== 'guessing' || !inRoster()) return;
    if (S.game.turnId !== S.playerId || S.selGuess === null) return;
    if (S.game.guesses[S.playerId] !== undefined) return;
    var used = {};
    Object.keys(S.game.guesses).forEach(function (id) { used[S.game.guesses[id]] = true; });
    if (used[S.selGuess]) { toast('Ese número ya lo dijo otro.'); return; }
    var n = S.selGuess;
    S.game.guesses[S.playerId] = n;
    send('guess', { playerId: S.playerId, number: n });
    if (S.isHost) onGuess({ playerId: S.playerId, number: n });
    S.selGuess = null;
    renderAll();
  }

  // ---------- render ----------
  function renderAll() {
    renderBanner(); renderPlayers(); renderStage(); renderActions(); renderScores();
    $('game-round').textContent = 'Ronda ' + (S.game ? S.game.round : 1);
    $('game-code').textContent = 'sala ' + S.roomCode;
  }

  function renderBanner() {
    var b = $('turn-banner');
    var g = S.game;
    b.classList.remove('my-turn');
    if (!g) { b.textContent = '…'; return; }
    if (!inRoster()) { b.textContent = 'Estás de espectador: entrarás en la próxima ronda.'; return; }
    if (g.state === 'hiding') {
      if (g.myHide === null) {
        b.textContent = '✊ Esconde tus monedas en el puño (0–' + (g.coins[S.playerId] || 0) + ')';
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
      b.textContent = r.correct.length
        ? '🎉 ¡Manos arriba! Total: ' + r.total + ' — aciertan ' + r.correct.map(playerName).join(', ')
        : '🖐️ ¡Manos arriba! Total: ' + r.total + ' — nadie acertó';
    } else if (g.state === 'gameOver') {
      b.textContent = '🏆 ¡' + playerName(g.winnerId) + ' se queda sin monedas y gana!';
    }
  }

  function coinsStr(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '🪙';
    return s || '—';
  }

  function renderPlayers() {
    var box = $('opponents');
    box.innerHTML = '';
    var g = S.game;
    if (!g) return;
    g.roster.forEach(function (id) {
      var active = g.state === 'guessing' && g.turnId === id && g.guesses[id] === undefined;
      var chip = el('div', null, 'chip' + (active ? ' activo' : ''));
      chip.appendChild(el('span', playerName(id) + (id === S.playerId ? ' (tú)' : '')));
      chip.appendChild(el('span', coinsStr(g.coins[id] || 0), 'ncartas'));
      box.appendChild(chip);
    });
  }

  function renderStage() {
    var st = $('stage');
    st.innerHTML = '';
    var g = S.game;
    if (!g || !inRoster()) return;

    if (g.state === 'hiding' && g.myHide === null) {
      var max = g.coins[S.playerId] || 0;
      st.appendChild(el('p', '¿Cuántas escondes?', 'stage-title'));
      var row = el('div', null, 'numpad');
      for (var i = 0; i <= max; i++) {
        (function (n) {
          var b = el('button', String(n), 'num' + (S.selHide === n ? ' sel' : ''));
          b.onclick = function () { S.selHide = n; renderStage(); renderActions(); };
          row.appendChild(b);
        })(i);
      }
      st.appendChild(row);
    } else if (g.state === 'guessing') {
      // lista de apuestas en orden
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
    } else if (g.state === 'reveal' && g.lastReveal) {
      var r = g.lastReveal;
      st.appendChild(el('p', '🖐️ Total: ' + r.total + ' monedas', 'stage-title big'));
      var list = el('div', null, 'reveal-list');
      g.roster.forEach(function (id) {
        var ok = r.correct.indexOf(id) !== -1;
        var row2 = el('div', null, 'reveal-row' + (ok ? ' hit' : ''));
        row2.appendChild(el('span', (ok ? '✅ ' : '') + playerName(id) + (id === S.playerId ? ' (tú)' : '')));
        row2.appendChild(el('span', '✊ ' + coinsStr(r.hides[id] || 0), 'fist'));
        row2.appendChild(el('span', 'dijo ' + (r.guesses[id] !== undefined ? r.guesses[id] : '—'), 'muted'));
        list.appendChild(row2);
      });
      st.appendChild(list);
    }
  }

  function renderActions() {
    var box = $('actions');
    box.innerHTML = '';
    var g = S.game;
    if (!g || !inRoster()) return;
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
    } else if (g.state === 'reveal' && S.isHost) {
      var b3 = el('button', '▶ Siguiente ronda', 'btn btn-big');
      b3.onclick = function () { hostStartRound(false); };
      box.appendChild(b3);
    }
  }

  function renderScores() {
    var ul = $('scores-list');
    ul.innerHTML = '';
    var g = S.game;
    if (!g) return;
    var ids = g.roster.slice().sort(function (a, b) { return (g.coins[a] || 0) - (g.coins[b] || 0); });
    ids.forEach(function (id) {
      var li = el('li');
      li.appendChild(el('span', playerName(id) + (id === S.playerId ? ' (tú)' : '')));
      li.appendChild(el('span', coinsStr(g.coins[id] || 0)));
      ul.appendChild(li);
    });
  }

  function showGameOverModal(p) {
    var wrap = el('div');
    wrap.appendChild(el('div', '🏆', 'winner'));
    var h = el('h2', '¡' + playerName(p.winnerId) + ' gana la partida!');
    h.style.textAlign = 'center';
    wrap.appendChild(h);
    var sub = el('p', 'Se quedó sin monedas en la ronda ' + p.round + '.', 'muted');
    sub.style.textAlign = 'center'; sub.style.color = '#555';
    wrap.appendChild(sub);
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
