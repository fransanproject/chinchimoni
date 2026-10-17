# 🪙 Chinchimoni

El juego de las monedas escondidas (los chinos), online con amigos o en solitario contra la IA. Salas con código, hasta 12 jugadores.

**Jugar:** https://fransanproject.github.io/chinchimoni/

## Cómo se juega

- Cada ronda, todos esconden **a la vez** 0, 1, 2 o 3 monedas en el puño ✊.
- Por turnos (rotando quién empieza), cada jugador **dice un número**: su apuesta de cuántas monedas suman **entre todos**. No se puede repetir un número ya dicho.
- ¡Manos arriba! 🖐️ Quien **acierte la suma exacta** queda **salvado** ✅ y no juega más. En la primera ronda nadie queda salvado.
- Cuando solo quedan **2 jugadores**: ⚔️ **duelo final**, el primero en acertar **3 rondas** se salva. El otro es el pringado 😅.
- **Modo en solitario**: botón "🤖 Jugar solo contra la IA" en la portada (1-5 rivales), para probar sin amigos.

## Cómo funciona

- Sin servidor propio: el primer jugador en entrar es el **anfitrión** (arbitra la ronda).
- Tiempo real con **Supabase Realtime** (canales Broadcast, sin tablas): solo viajan eventos diminutos.
- Si el anfitrión se desconecta, el siguiente jugador toma el mando y la ronda se reinicia. Si alguien se desconecta a mitad de ronda, el juego sigue sin él.
- Lo que escondes viaja etiquetado por la sala: entre amigos se juega con confianza (no mires la consola, tramposo).

## Archivos

- `index.html` — pantallas (portada, sala, partida)
- `style.css` — estilos
- `logic.js` — lógica pura del juego (testeable con `node`)
- `app.js` — interfaz + multijugador + IA local

Tests: `node /tmp/test-chinchimoni.js` (lógica y simulación de partidas con las normas nuevas),
`node /tmp/test-solo.js` (smoke test: partida completa en solitario con DOM simulado).
