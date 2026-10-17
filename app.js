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
  var AI_NAMES = ['Ada', 'Turing', 'Pepe Bot', 'Lola Bot', 'Curro Bot'];

  // ---------- estado ----------
  var S = {
    name: '', playerId: '', joinedAt: 0, roomCode: '', photo: null,
    channel: null, sb: null, local: false,
    isHost: false, players: [],
    screen: 'home',
    selHide: null, selGuess: null, soloCount: 3,
    stats: {}, // estadísticas de la partida: id -> {apuestas, aciertos, rondaSalvado}
    game: null,   // estado de la ronda
    host: null    // {hides:{}, guesses:{}, order:[], idx:0} solo anfitrión
  };

  // ---------- utilidades ----------
  function $(id) { return document.getElementById(id); }
  function randId() { return 'p' + Math.random().toString(36).slice(2, 10); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
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

  // ---------- iconos SVG modernos (en vez de emojis básicos) ----------
  var ICON_PATHS = {
    fist: '<g fill="currentColor" stroke="none"><rect x="4.8" y="7.2" width="3.4" height="6.4" rx="1.7"/><rect x="8.7" y="5.6" width="3.4" height="8" rx="1.7"/><rect x="12.9" y="5.6" width="3.4" height="8" rx="1.7"/><rect x="17.1" y="7.2" width="3.4" height="6.4" rx="1.7"/><rect x="4.5" y="13" width="15" height="3.1" rx="1.55"/><path d="M5.5 16.6h13a1.9 1.9 0 0 1 1.9 1.9v.6a3.9 3.9 0 0 1-3.9 3.9H7.5a3.9 3.9 0 0 1-3.9-3.9v-.6a1.9 1.9 0 0 1 1.9-1.9z"/></g>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5.5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5C3 10 5 12 7.5 12"/><path d="M17 6h2.5A1.5 1.5 0 0 1 21 7.5C21 10 19 12 16.5 12"/>',
    bot: '<rect x="4.5" y="9" width="15" height="10" rx="2.5"/><path d="M12 9V4.5"/><circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none"/><circle cx="9.3" cy="14" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.7" cy="14" r="1.1" fill="currentColor" stroke="none"/><path d="M9.5 17h5"/>',
    chart: '<path d="M3 21h18"/><path d="M7 21v-6"/><path d="M12 21V8"/><path d="M17 21v-9"/>',
    camera: '<rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><circle cx="12" cy="13.5" r="3.2"/><path d="M8.5 7.5L10 4.5h4l1.5 3"/>',
    eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
    play: '<path d="M7 4.5l12.5 7.5L7 19.5z"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0"/><path d="M15.5 4.9a3.4 3.4 0 0 1 0 6.2"/><path d="M17.8 13.7a6.2 6.2 0 0 1 3.4 5.8"/>',
    think: '<path d="M21 11.5a7.5 7.5 0 0 1-7.5 7.5c-1.2 0-2.4-.3-3.4-.8L4 19.5l1.3-2.6A7.5 7.5 0 1 1 21 11.5z"/><circle cx="9" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="17" cy="11.5" r="1" fill="currentColor" stroke="none"/>',
    medal: '<circle cx="12" cy="14.5" r="4.5"/><path d="M9.2 10.8L6.5 3.5h3.8l1.7 3.6 1.7-3.6h3.8l-2.7 7.3"/>',
    crown: '<path d="M3 8.5l3.8 3.2L12 5.5l5.2 6.2L21 8.5l-1.6 9H4.6z"/>',
    laurels: '<path d="M7 21C4.5 15.5 5.5 9.5 10 5" fill="none"/><ellipse cx="5.9" cy="17.6" rx="2.1" ry="1" transform="rotate(-48 5.9 17.6)" fill="currentColor" stroke="none"/><ellipse cx="5.5" cy="14.2" rx="2.1" ry="1" transform="rotate(-32 5.5 14.2)" fill="currentColor" stroke="none"/><ellipse cx="6.2" cy="10.8" rx="2.1" ry="1" transform="rotate(-16 6.2 10.8)" fill="currentColor" stroke="none"/><ellipse cx="7.8" cy="7.8" rx="2.1" ry="1" transform="rotate(0 7.8 7.8)" fill="currentColor" stroke="none"/>',
    frown: '<circle cx="12" cy="12" r="9"/><path d="M8.5 16.5s1.4-2.6 3.5-2.6 3.5 2.6 3.5 2.6"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/>'
  };
  function icon(n) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICON_PATHS[n] || '') + '</svg>';
  }
  // Botón con icono + etiqueta (la etiqueta queda en un span para localizarla).
  function btnIcon(label, iconName, cls) {
    var b = el('button', null, cls);
    b.innerHTML = icon(iconName) + '<span>' + label + '</span>';
    return b;
  }
  function showScreen(name) {
    S.screen = name;
    ['home', 'lobby', 'game'].forEach(function (s) {
      $('screen-' + s).classList.toggle('hidden', s !== name);
    });
  }
  // En la partida, el swipe vertical no mueve la página (en móvil es incómodo);
  // solo el teclado numérico conserva su desplazamiento interno.
  document.getElementById('screen-game').addEventListener('touchmove', function (e) {
    if (!e.target.closest || !e.target.closest('.numpad')) e.preventDefault();
  }, { passive: false });
  var toastTimer = null;
  function toast(html, ms) {
    var t = $('toast');
    t.innerHTML = html;
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
    S.photo = localStorage.getItem('chinchimoni-photo') || null;
    renderPhotoPreview();
  } catch (e) {}

  // ---------- foto de perfil ----------
  function renderPhotoPreview() {
    var pv = $('photo-preview');
    if (S.photo) {
      pv.style.backgroundImage = 'url("' + S.photo + '")';
      pv.textContent = '';
    } else {
      pv.style.backgroundImage = '';
      pv.textContent = '?';
    }
  }
  $('photo-input').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var img = new Image();
    var url = URL.createObjectURL(f);
    img.onload = function () {
      try {
        var size = 96, cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        var cx = cv.getContext('2d');
        // recorte cuadrado centrado
        var s = Math.min(img.width, img.height);
        cx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        S.photo = cv.toDataURL('image/jpeg', 0.82);
        try { localStorage.setItem('chinchimoni-photo', S.photo); } catch (e) {}
        renderPhotoPreview();
      } catch (e) {}
      URL.revokeObjectURL(url);
      ev.target.value = '';
    };
    img.src = url;
  });

  // Iconos en el HTML estático: <i data-icon="fist"></i>
  (function enhanceStaticIcons() {
    var nodes = document.querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) nodes[i].innerHTML = icon(nodes[i].getAttribute('data-icon'));
  })();

  function playerPhoto(id) {
    if (id === S.playerId) return S.photo;
    for (var i = 0; i < S.players.length; i++) {
      if (S.players[i].id === id) return S.players[i].photo || null;
    }
    return null;
  }

  function startLocalGame(nAI) {
    var name = getName();
    S.name = name;
    S.playerId = 'humano';
    S.joinedAt = Date.now();
    S.roomCode = 'SOLO';
    S.local = true;
    S.isHost = true;
    S.channel = null;
    S.players = [{ id: 'humano', name: name, joinedAt: 0, photo: S.photo }];
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
        ch.track({ name: S.name, joinedAt: S.joinedAt, photo: S.photo });
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
    hideTableOverlay();
    showScreen('home');
  }
  $('btn-leave-lobby').addEventListener('click', leaveRoom);
  $('btn-leave-game').addEventListener('click', leaveRoom);
  $('btn-copy').addEventListener('click', function () {
    var code = $('lobby-code').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast(icon('check') + ' Código copiado'); });
    else toast('Código: ' + code, 4000);
  });

  // ---------- presence (online) ----------
  function onPresenceSync() {
    var state = S.channel.presenceState();
    var players = [];
    Object.keys(state).forEach(function (key) {
      var pres = state[key];
      if (pres && pres.length) players.push({ id: key, name: String(pres[0].name || '¿?').slice(0, 12), joinedAt: pres[0].joinedAt || 0, photo: pres[0].photo || null });
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
        renderCentro(); renderMesa();
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
      var li = el('li', null, 'lobby-player');
      var av = el('span', null, 'lobby-avatar');
      if (p.photo) av.style.backgroundImage = 'url("' + p.photo + '")';
      else av.textContent = (p.name || '?').charAt(0).toUpperCase();
      li.appendChild(av);
      var nm = el('span');
      nm.innerHTML = (i === 0 ? icon('crown') + ' ' : '') + escapeHtml(p.name);
      li.appendChild(nm);
      if (p.id === S.playerId) li.appendChild(el('span', '(tú)', 'muted'));
      ul.appendChild(li);
    });
    $('lobby-count').textContent = S.players.length + ' / ' + L.MAX_PLAYERS + ' jugadores';
    var startBtn = $('btn-start');
    startBtn.classList.toggle('hidden', !S.isHost);
    startBtn.disabled = S.players.length < 2;
    var note = $('lobby-note');
    if (S.players.length >= L.MAX_PLAYERS) {
      note.textContent = 'Sala llena: quien entre ahora mirará hasta la próxima ronda.';
    } else {
      note.innerHTML = 'Comparte el código con tus amigos. El primero en entrar es el anfitrión ' + icon('crown') + '.';
    }
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
    if (reset) S.stats = {};
    hideModal();
    hideTableOverlay();

    send('start_round', {
      roster: roster, names: names, coins: coins, saved: saved,
      finalDuel: finalDuel, hits: hits,
      round: S.game.round, starterId: starterId, maxTotal: S.game.maxTotal
    });
    showScreen('game');
    renderAll();
    toast(finalDuel
      ? icon('zap') + ' ¡Duelo final! El primero en acertar ' + L.FINAL_HITS_TO_WIN + ' rondas se salva'
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
    renderCentro(); renderMesa();
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
    if (S.host.idx >= S.host.order.length) {
      // Todos anunciaron: se deja ver el último bocadillo y se espera
      // 1,5s antes de anunciar el resultado en la mesa.
      var round = g.round;
      setTimeout(function () {
        if (!S.game || !S.host || S.game.round !== round || S.game.state !== 'guessing') return;
        finishRound();
      }, 1500);
      return;
    }
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
    if (p.round === 1) S.stats = {}; // partida nueva: estadísticas a cero
    hideModal();
    hideTableOverlay();
    showScreen('game');
    renderAll();
    toast(p.finalDuel
      ? icon('zap') + ' ¡Duelo final! El primero en acertar ' + L.FINAL_HITS_TO_WIN + ' rondas se salva'
      : '🪙 Ronda ' + p.round + ': esconde tus monedas');
    if (S.local) scheduleAiHides();
  }

  function onHideProgress(p) {
    if (!S.game) return;
    S.game.hideDone = p.done;
    S.game.hideTotal = p.total;
    renderCentro(); renderMesa();
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
      toast(icon('target') + ' Te toca: ¿cuántas monedas suman entre todos?');
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
    trackStats(p);
    renderAll();
    // 2s después del resultado, anuncio grande de quién se salva.
    if (p.newlySaved && p.newlySaved.length) {
      var ids = p.newlySaved.slice(), round = S.game.round;
      setTimeout(function () {
        if (!S.game || S.game.state !== 'reveal' || S.game.round !== round) return;
        showTableOverlay(ids, '¡Salvado!', '');
      }, 2000);
    }
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
    trackStats(p); // la ronda final no pasa por onReveal
    renderAll();
    hideTableOverlay();
    // Final dramático: primero el pringado en grande, luego el modal.
    if (p.loserId) {
      var loser = p.loserId;
      setTimeout(function () {
        if (!S.game || S.game.state !== 'gameOver') return;
        showTableOverlay([loser], '¡Pringado!', 'pringado');
      }, 1500);
      setTimeout(function () {
        if (!S.game || S.game.state !== 'gameOver') return;
        showGameOverModal(p);
      }, 4300);
    } else {
      setTimeout(function () {
        if (!S.game || S.game.state !== 'gameOver') return;
        showGameOverModal(p);
      }, 1500);
    }
  }

  // Estadísticas de la partida (las calcula cada cliente con lo que ve por la sala).
  function trackStats(p) {
    if (!S.game || !S.stats) return;
    var round = S.game.round;
    function st(id) {
      if (!S.stats[id]) S.stats[id] = { apuestas: 0, aciertos: 0, rondaSalvado: 0 };
      return S.stats[id];
    }
    S.game.roster.forEach(st);
    Object.keys(p.guesses || {}).forEach(function (id) { st(id).apuestas++; });
    (p.correct || []).forEach(function (id) { st(id).aciertos++; });
    (p.newlySaved || []).forEach(function (id) {
      if (!st(id).rondaSalvado) st(id).rondaSalvado = round;
    });
    if (p.winnerId) st(p.winnerId); // el ganador del duelo también queda registrado
  }

  function onRoundAbort(p) {
    if (!S.game) return;
    hideModal();
    hideTableOverlay();
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
  // Marcador del duelo arriba: victorias de cada duelista, siempre visible.
  function renderDuelScore() {
    var d = $('duel-score');
    var g = S.game;
    if (!g || !g.finalDuel || g.state === 'gameOver' || g.roster.length !== 2) {
      d.classList.add('hidden');
      return;
    }
    d.classList.remove('hidden');
    var a = g.roster[0], b = g.roster[1];
    d.innerHTML = '';
    d.appendChild(el('span', playerName(a), 'ds-name'));
    var sc = el('span', null, 'ds-score');
    sc.innerHTML = '<b>' + (g.hits[a] || 0) + '</b> — <b>' + (g.hits[b] || 0) + '</b>';
    d.appendChild(sc);
    d.appendChild(el('span', playerName(b), 'ds-name'));
    d.appendChild(el('span', 'primero en ' + L.FINAL_HITS_TO_WIN, 'ds-sub'));
  }

  function renderAll() {
    renderDuelScore(); renderCentro(); renderMesa(); renderActions(); renderScores(); renderStats();
    $('game-round').textContent = S.game && S.game.finalDuel
      ? 'Duelo final'
      : 'Ronda ' + (S.game ? S.game.round : 1);
    $('game-code').textContent = S.local ? 'en solitario' : 'sala ' + S.roomCode;
  }

  // Centro de la mesa: el estado de la partida, siempre visible.
  // Quien está salvado mira la partida igual que los demás (solo no participa).
  function renderCentro() {
    var c = $('mesa-centro');
    c.innerHTML = '';
    c.className = '';
    var g = S.game;
    if (!g) return;
    var big = el('div', null, 'centro-big');
    var sub = el('div', null, 'centro-sub');
    var watching = !inRoster(); // salvado o a la espera: mira sin jugar
    var savedMe = isSaved();

    if (watching && !savedMe) {
      big.innerHTML = icon('eye');
      sub.textContent = 'Entras en la próxima ronda';
    } else if (g.state === 'hiding') {
      c.className = 'fase-hiding';
      big.innerHTML = icon('fist');
      if (watching) {
        sub.textContent = 'Escondiendo (' + g.hideDone + '/' + g.hideTotal + ')';
      } else {
        sub.textContent = g.myHide === null
          ? 'Esconde (' + g.hideDone + '/' + g.hideTotal + ')' + (g.round === 1 ? ' · mín. 1' : '')
          : 'Puño cerrado (' + g.hideDone + '/' + g.hideTotal + ')';
      }
      if (savedMe) sub.textContent += ' · estás salvado';
    } else if (g.state === 'guessing') {
      c.className = 'fase-guessing';
      var myTurn = !watching && g.turnId === S.playerId && g.guesses[S.playerId] === undefined;
      var firstToSay = Object.keys(g.guesses).length === 0;
      if (g.finalDuel && myTurn && firstToSay) {
        // Aviso explícito: en el duelo sales tú primero diciendo.
        big.innerHTML = icon('zap');
        big.classList.add('alerta');
        sub.innerHTML = '<strong>¡Sales primero!</strong> Di tu número';
      } else {
        big.innerHTML = icon('target');
        sub.textContent = myTurn ? 'Te toca adivinar' : 'Turno de ' + playerName(g.turnId);
        if (savedMe) sub.textContent += ' · estás salvado';
      }
    } else if (g.state === 'reveal' && g.lastReveal) {
      c.className = 'fase-reveal';
      var r = g.lastReveal;
      big.textContent = r.total;
      big.className = 'centro-total';
      if (r.finalDuel) {
        sub.textContent = 'aciertos: ' + g.roster.map(function (id) {
          return playerName(id) + ' ' + (g.hits[id] || 0);
        }).join(' · ');
      } else if (r.newlySaved && r.newlySaved.length) {
        sub.textContent = 'Salvados: ' + r.newlySaved.map(playerName).join(', ');
      } else {
        sub.textContent = 'nadie acertó';
      }
      if (r.startDuel) sub.textContent += ' · ¡duelo final la próxima!';
    } else if (g.state === 'gameOver') {
      big.innerHTML = icon('trophy');
      sub.textContent = 'Partida terminada';
    }
    c.appendChild(big);
    c.appendChild(sub);
  }

  // Asientos alrededor de la mesa: se construyen una vez por ronda
  // y luego solo se actualiza su estado (todos siempre en pantalla).
  function seatKey() {
    var g = S.game;
    return g.round + '|' + g.roster.join(',') + '|' + g.saved.join(',');
  }

  function buildSeats() {
    var mesa = $('mesa');
    var olds = mesa.querySelectorAll('.asiento');
    for (var k = 0; k < olds.length; k++) olds[k].remove();
    S.seats = {};
    var g = S.game;
    // En la mesa solo los que van a jugar: el roster activo.
    // Yo siempre tengo mi asiento abajo (aunque ya esté salvado, miro desde ahí).
    var order = [S.playerId].concat(g.roster.filter(function (id) { return id !== S.playerId; }));
    var dedup = [];
    order.forEach(function (id) { if (dedup.indexOf(id) === -1) dedup.push(id); });
    order = dedup;
    var n = order.length;
    order.forEach(function (id, i) {
      var ang = Math.PI / 2 + i * (2 * Math.PI / n); // empiezo abajo, sentido horario
      var x = 50 + 45 * Math.cos(ang);
      var y = 50 + 45 * Math.sin(ang);
      var s = el('div', null, 'asiento');
      s.style.left = x.toFixed(2) + '%';
      s.style.top = y.toFixed(2) + '%';
      var bub = el('div', null, 'bocadillo hidden');
      var av = el('div', null, 'avatar');
      var photo = playerPhoto(id);
      if (photo) {
        av.style.backgroundImage = 'url("' + photo + '")';
      } else if (isAI(id)) {
        av.innerHTML = icon('bot');
      } else {
        av.textContent = (playerName(id) || '?').charAt(0).toUpperCase();
      }
      var nm = el('div', playerName(id) + (id === S.playerId ? ' (tú)' : ''), 'anombre');
      var est = el('div', null, 'aestado');
      s.appendChild(bub); s.appendChild(av); s.appendChild(nm); s.appendChild(est);
      mesa.appendChild(s);
      S.seats[id] = { root: s, bubble: bub, estado: est };
    });
    S.builtSeatsKey = seatKey();
  }

  // Avatar reutilizable: foto, robot de la IA o inicial.
  function avatarEl(id, cls) {
    var av = el('div', null, 'avatar' + (cls ? ' ' + cls : ''));
    var photo = playerPhoto(id);
    if (photo) av.style.backgroundImage = 'url("' + photo + '")';
    else if (isAI(id)) av.innerHTML = icon('bot');
    else av.textContent = (playerName(id) || '?').charAt(0).toUpperCase();
    return av;
  }

  // Anuncio grande encima de la mesa (quién se salva / quién pringa),
  // para que lo vea toda la mesa. No bloquea: se esconde solo.
  function showTableOverlay(ids, tagText, tagClass) {
    var ov = $('saved-overlay');
    ov.innerHTML = '';
    ids.forEach(function (id) {
      var item = el('div', null, 'saved-star' + (tagClass ? ' ' + tagClass : ''));
      item.appendChild(avatarEl(id, 'big'));
      item.appendChild(el('div', playerName(id), 'saved-name'));
      item.appendChild(el('div', tagText, 'saved-tag' + (tagClass ? ' ' + tagClass : '')));
      ov.appendChild(item);
    });
    ov.classList.remove('hidden');
    setTimeout(function () { ov.classList.add('hidden'); }, 2700);
  }
  function hideTableOverlay() { $('saved-overlay').classList.add('hidden'); }

  function renderMesa() {
    var g = S.game;
    if (!g) return;
    if (S.builtSeatsKey !== seatKey()) buildSeats();
    Object.keys(S.seats).forEach(function (id) {
      var st = S.seats[id];
      var savedP = g.saved.indexOf(id) !== -1;
      var inR = g.roster.indexOf(id) !== -1;
      st.root.classList.toggle('salvado', savedP);
      var active = inR && !savedP && g.state === 'guessing' && g.turnId === id && g.guesses[id] === undefined;
      st.root.classList.toggle('activo', active);
      // Bocadillo con el número anunciado (se esconde al resolver: el total va al centro).
      var showBubble = inR && !savedP && g.state === 'guessing' && g.guesses[id] !== undefined;
      st.bubble.classList.toggle('hidden', !showBubble);
      if (showBubble) st.bubble.textContent = g.guesses[id];
      // Estado bajo el nombre (iconos modernos, con color por fase).
      var html = '';
      if (savedP && id === S.playerId) html = '<span class="est-check">' + icon('check') + '</span>';
      else if (g.state === 'hiding') html = '<span class="est-fist">' + ((id === S.playerId && g.myHide !== null) ? icon('fist') : icon('think')) + '</span>';
      else if (g.state === 'guessing' && active) html = '<span class="est-target">' + icon('target') + '</span>';
      else if (g.state === 'reveal' && g.lastReveal) html = '🪙 <b>' + (g.lastReveal.hides[id] || 0) + '</b>';
      else if (g.finalDuel && inR && g.state !== 'reveal') html = '<span class="est-target">' + icon('target') + '</span> <b>' + (g.hits[id] || 0) + '/' + L.FINAL_HITS_TO_WIN + '</b>';
      st.estado.innerHTML = html;
    });
  }

  function renderActions() {
    var box = $('actions');
    box.innerHTML = '';
    var g = S.game;
    if (!g) return;
    // El anfitrión avanza la partida aunque él ya esté salvado.
    if (g.state === 'reveal' && S.isHost) {
      var b3 = g.lastReveal && g.lastReveal.startDuel
        ? btnIcon('Empezar el duelo', 'zap', 'btn btn-big')
        : btnIcon('Siguiente ronda', 'play', 'btn btn-big');
      b3.onclick = function () { hostStartRound(false); };
      box.appendChild(b3);
      return;
    }
    if (!inRoster()) return;
    if (g.state === 'hiding' && g.myHide === null) {
      var minH = g.round === 1 ? 1 : 0;
      box.appendChild(el('p', '¿Cuántas escondes?' + (g.round === 1 ? ' (mínimo 1)' : ''), 'pad-title'));
      var row = el('div', null, 'numpad');
      for (var i = minH; i <= L.START_COINS; i++) {
        (function (n) {
          var btn = el('button', String(n), 'num' + (S.selHide === n ? ' sel' : ''));
          btn.onclick = function () { S.selHide = n; renderActions(); };
          row.appendChild(btn);
        })(i);
      }
      box.appendChild(row);
      var b = btnIcon('Esconder', 'fist', 'btn btn-big');
      b.disabled = S.selHide === null;
      b.onclick = doHide;
      box.appendChild(b);
    } else if (g.state === 'guessing' && g.turnId === S.playerId && g.guesses[S.playerId] === undefined) {
      box.appendChild(el('p', 'Di un número del 0 al ' + g.maxTotal + ' (sin repetir):', 'pad-title'));
      var used = {};
      Object.keys(g.guesses).forEach(function (id) { used[g.guesses[id]] = true; });
      var pad = el('div', null, 'numpad');
      for (var n2 = 0; n2 <= g.maxTotal; n2++) {
        (function (n) {
          var bb = el('button', String(n), 'num' + (S.selGuess === n ? ' sel' : ''));
          bb.disabled = !!used[n];
          bb.onclick = function () { S.selGuess = n; renderActions(); };
          pad.appendChild(bb);
        })(n2);
      }
      box.appendChild(pad);
      var b2 = btnIcon('Adivinar', 'target', 'btn btn-big');
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
      li0.innerHTML = icon('check') + ' ';
      li0.appendChild(el('span', 'Salvados'));
      li0.appendChild(el('span', g.saved.map(playerName).join(', ')));
      ul.appendChild(li0);
    }
    g.roster.forEach(function (id) {
      var li = el('li');
      li.appendChild(el('span', playerName(id) + (id === S.playerId ? ' (tú)' : '')));
      var right = el('span');
      right.innerHTML = (g.finalDuel ? icon('target') + ' ' + (g.hits[id] || 0) + '/' + L.FINAL_HITS_TO_WIN + ' ' : '') + '🪙';
      li.appendChild(right);
      ul.appendChild(li);
    });
  }

  function renderStats() {
    var t = $('stats-table');
    t.innerHTML = '';
    var g = S.game;
    if (!g) return;
    var ids = Object.keys(S.stats || {});
    if (!ids.length) {
      var tr0 = el('tr');
      tr0.appendChild(el('td', 'Sin apuestas todavía.', 'muted'));
      t.appendChild(tr0);
      return;
    }
    ids.sort(function (a, b) {
      var sa = S.stats[a], sb = S.stats[b];
      return (sb.aciertos - sa.aciertos) || (sa.apuestas - sb.apuestas);
    });
    var head = el('tr');
    ['Jugador', 'Apuestas', 'Aciertos', '%'].forEach(function (h) { head.appendChild(el('th', h)); });
    t.appendChild(head);
    ids.forEach(function (id) {
      var s = S.stats[id];
      var pct = s.apuestas ? Math.round(100 * s.aciertos / s.apuestas) : 0;
      var tr = el('tr');
      var tdName = el('td');
      tdName.textContent = playerName(id) + (id === S.playerId ? ' (tú)' : '');
      if (g.saved.indexOf(id) !== -1) tdName.innerHTML = icon('check') + ' ' + tdName.textContent;
      tr.appendChild(tdName);
      tr.appendChild(el('td', String(s.apuestas)));
      tr.appendChild(el('td', String(s.aciertos)));
      tr.appendChild(el('td', pct + '%'));
      t.appendChild(tr);
    });
  }

  function buildRanking(p) {
    // Orden por salvación: el primero en salvarse, primero en el ranking.
    // (El pringado va aparte, no en la lista.)
    var order = [];
    function push(id) { if (id && id !== p.loserId && order.indexOf(id) === -1) order.push(id); }
    var savedSorted = (p.saved || []).slice().sort(function (a, b) {
      var ra = (S.stats[a] && S.stats[a].rondaSalvado) || 99;
      var rb = (S.stats[b] && S.stats[b].rondaSalvado) || 99;
      return ra - rb;
    });
    if (p.finalDuel && p.winnerId) push(p.winnerId);
    savedSorted.forEach(push);
    return order;
  }

  function rankingDetail(id, p) {
    var s = S.stats[id] || { apuestas: 0, aciertos: 0, rondaSalvado: 0 };
    var acc = s.aciertos + '/' + s.apuestas + ' aciertos';
    if (id === p.loserId) return 'pringado · ' + acc;
    if (p.finalDuel && id === p.winnerId) return 'ganó el duelo · ' + acc;
    return 'salvado en ronda ' + (s.rondaSalvado || '—') + ' · ' + acc;
  }

  function showGameOverModal(p) {
    var g = S.game;
    var wrap = el('div');
    // El pringado, por un lado y bien visible.
    if (p.loserId) {
      var pc = el('div', null, 'pringado-card');
      pc.appendChild(el('div', 'Pringado', 'pringado-tag'));
      pc.appendChild(avatarEl(p.loserId, 'big'));
      pc.appendChild(el('div', playerName(p.loserId) + (p.loserId === S.playerId ? ' (tú)' : ''), 'pringado-name'));
      wrap.appendChild(pc);
    }
    if (p.finalDuel) {
      var wicon = el('div', null, 'winner'); wicon.innerHTML = icon('trophy'); wrap.appendChild(wicon);
      var h = el('h2', '¡' + playerName(p.winnerId) + ' gana el duelo!');
      h.style.textAlign = 'center';
      wrap.appendChild(h);
      var sub = el('p', 'Acertó ' + L.FINAL_HITS_TO_WIN + ' rondas antes que nadie.', 'muted');
      sub.style.textAlign = 'center'; sub.style.color = '#555';
      wrap.appendChild(sub);
    } else if (p.everyoneSaved) {
      var wicon2 = el('div', null, 'winner'); wicon2.innerHTML = icon('check'); wrap.appendChild(wicon2);
      var h2 = el('h2', '¡Todos salvados!');
      h2.style.textAlign = 'center';
      wrap.appendChild(h2);
      var sub2 = el('p', 'No hay pringado esta vez.', 'muted');
      sub2.style.textAlign = 'center'; sub2.style.color = '#555';
      wrap.appendChild(sub2);
    } else if (!p.loserId) {
      var wicon3 = el('div', null, 'winner'); wicon3.innerHTML = icon('check'); wrap.appendChild(wicon3);
      var h3 = el('h2', '¡Partida terminada!');
      h3.style.textAlign = 'center';
      wrap.appendChild(h3);
    }
    // Clasificación: por orden de salvación; el 1º con corona de oro y laureles.
    wrap.appendChild(el('h3', 'Clasificación', 'rank-title'));
    var rankList = el('div', null, 'rank-list');
    buildRanking(p).forEach(function (id, i) {
      var row = el('div', null, 'rank-row' + (i === 0 ? ' champion' : ''));
      var box = el('div');
      if (i === 0) {
        row.appendChild(el('span', '👑', 'rank-crown'));
        var champ = el('div', null, 'rank-champ-name');
        var l1 = el('span', null, 'laurel'); l1.innerHTML = icon('laurels');
        var l2 = el('span', null, 'laurel flip'); l2.innerHTML = icon('laurels');
        champ.appendChild(l1);
        champ.appendChild(el('span', playerName(id) + (id === S.playerId ? ' (tú)' : ''), 'rank-name'));
        champ.appendChild(l2);
        box.appendChild(champ);
      } else {
        row.appendChild(el('span', String(i + 1), 'rank-pos'));
        box.appendChild(el('div', playerName(id) + (id === S.playerId ? ' (tú)' : ''), 'rank-name'));
      }
      box.appendChild(el('div', rankingDetail(id, p), 'muted rank-det'));
      row.appendChild(box);
      rankList.appendChild(row);
    });
    wrap.appendChild(rankList);
    var row = el('div', null, 'row');
    if (S.isHost) {
      var btnR = btnIcon('Jugar otra vez', 'refresh', 'btn btn-big');
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
