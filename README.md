# 🪙 Chinchimoni

El juego de las monedas escondidas (los chinos), online con amigos. Salas con código, hasta 12 jugadores.

**Jugar:** https://fransanproject.github.io/chinchimoni/

## Cómo se juega

- Cada jugador empieza con **3 monedas**.
- Cada ronda, todos esconden **a la vez** 0, 1, 2 o 3 monedas en el puño ✊.
- Por turnos (rotando quién empieza), cada jugador **dice un número**: su apuesta de cuántas monedas suman **entre todos**. No se puede repetir un número ya dicho.
- ¡Manos arriba! 🖐️ Quien haya **acertado la suma exacta** descarta una moneda.
- Gana el **primero en quedarse sin monedas** 🏆.

## Cómo funciona

- Sin servidor propio: el primer jugador en entrar es el **anfitrión** (arbitra la ronda).
- Tiempo real con **Supabase Realtime** (canales Broadcast, sin tablas): solo viajan eventos diminutos.
- Si el anfitrión se desconecta, el siguiente jugador toma el mando y la ronda se reinicia.
- Lo que escondes viaja etiquetado por la sala: entre amigos se juega con confianza (no mires la consola, tramposo).

## Archivos

- `index.html` — pantallas (portada, sala, partida)
- `style.css` — estilos
- `logic.js` — lógica pura del juego (testeable con `node`)
- `app.js` — interfaz + multijugador

Tests: `node /tmp/test-chinchimoni.js` (lógica pura).
