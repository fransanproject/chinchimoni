# 🃏 Chinchimoni

El chinchón de toda la vida, online con amigos. Salas con código, hasta 12 jugadores.

**Jugar:** https://fransanproject.github.io/chinchimoni/

## Cómo funciona

- Sin servidor propio: el primer jugador en entrar es el **anfitrión** (reparte y arbitra).
- Tiempo real con **Supabase Realtime** (canales Broadcast, sin tablas): solo viajan eventos diminutos.
- Si el anfitrión se desconecta, el siguiente jugador toma el mando y la ronda se reinicia.

## Reglas de la casa (v1)

- Baraja española **doble** (2 × 48 cartas) para que quepan 12 jugadores.
- 7 cartas por jugador. En tu turno robas 1 (mazo o descarte) y descartas 1.
- Jugadas: **trío+** (mismo número) o **escalera** (mismo palo, correlativas; el as solo vale como 1).
- **Cierre**: con 8 cartas, si 7 ligan, cierras (la 8ª va al descarte).
- **Chinchón** = escalera de 7 del mismo palo → **−25 puntos**.
- Al cerrar, los demás ligan lo que puedan y cuentan las cartas sueltas (figuras = 10).
- Con **100 puntos o más** quedas eliminado. Gana el último en pie.

## Archivos

- `index.html` — pantallas (portada, sala, partida)
- `style.css` — estilo de tapete
- `logic.js` — lógica pura del juego (testeable con `node`)
- `app.js` — interfaz + multijugador

Tests: `node /tmp/test-logic.js` (lógica pura, 20 casos).
