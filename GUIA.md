# Guía de uso de GoBase

Esta guía es la misma que aparece en la aplicación con el botón **❓ Ayuda** (o la tecla `?`).
Se genera automáticamente a partir de `src/help.html` con `python3 build.py`.

[▶️ Abrir GoBase](https://rkarillo-tech.github.io/gobase/) · [Volver al README](README.md)

## 🧭 1. De un vistazo: cómo está organizada la pantalla
- **Columna izquierda**: el tablero con la **barra de victoria** a su izquierda (abajo negras, arriba blancas), los nombres de los jugadores con sus capturas y, si juegas con reloj, el tiempo; debajo, el **panel del motor**, el **gráfico de la partida**, los botones de navegación y la **lista de jugadas** con sus variantes.
- **Columna derecha**, arriba: la **partida actual** (título, ⭐ favorita, etiquetas, 💾 guardar y 📌 marcar). Debajo, cinco pestañas:
**📖 Estudio** (importar, comentar, analizar), **🧮 Recuento**, **🌍 Aperturas**, **📚 Biblioteca** (partidas, marcadores, búsqueda, estadísticas y ficheros .sgf) y **🎯 Entrenar** (problemas, tus errores y tarjetas).
- **Barra superior**: dibujo de las piedras, color del tablero, jugar contra la CPU, sonido 🔊, ajustes ⚙, esta ayuda ❓ y «Nueva» partida.
- **En el móvil**, en vertical: bajo el tablero están los botones para avanzar y retroceder y la lista de jugadas; más abajo, el motor y las pestañas (deslízalas a los lados). Las piedras, los colores y el sonido están en el botón **☰**. En horizontal, el tablero ocupa la izquierda y las jugadas la derecha.

> **Ejemplo rápido (2 minutos):** pega un SGF en «📖 Estudio» → **Importar** → recórrelo con `←` `→` → pulsa **🤖 Analizar y comentar** → si te interesa, **💾 Guardar en biblioteca**.

## ⚫ 2. Poner piedras y recorrer la partida
- **Jugar**: pulsa un punto del tablero. Al pasar el ratón se ve una piedra fantasma del color que juega. **✋ Pasar** (o `P`) pasa el turno.
- Se aplican todas las reglas: capturas, **ko** (no se puede recapturar enseguida), prohibición del **suicidio** y, si lo dejas en ⚙ Ajustes, **superko posicional** (ninguna posición puede repetirse). Si una jugada no vale, la línea de estado explica por qué.
- **Escribir la jugada**: en «⌨ Escribe una jugada», teclea `D4`, `Q16`, `pd` (coordenadas SGF) o `pasa` y pulsa `Intro`.
- **Navegar**: **|◀ ◀◀ ◀ ▶ ▶▶ ▶|**, el teclado (`←` `→`, `RePág` `AvPág` de 10 en 10, `Inicio` `Fin`) o la **rueda del ratón** sobre el tablero. También puedes pulsar cualquier jugada de la lista o cualquier punto del gráfico.
- **▶ Auto** (o `Espacio`) reproduce la partida sola. **Números** (`N`) escribe el número de jugada en cada piedra.
- La última jugada lleva un círculo; un cuadrado vacío marca el punto de ko que no se puede retomar ahora.
- Las coordenadas son las habituales: letras de la A a la T **sin la I** y números desde abajo (D4, Q16…).

## 🌿 3. Variantes, comentarios y marcas
- Si juegas en mitad de la partida se crea una **variante** (o se sobrescribe la línea, si lo eliges en «Al jugar en mitad de la partida»). Las variantes aparecen sangradas en la lista; en el tablero, un círculo azul señala los puntos donde hay otras ramas.
- `↑` `↓` cambian entre variantes hermanas. **⬆ Promover variante** la sube un puesto; **★ Hacer principal** la convierte en la línea principal; **✂ Cortar** borra la jugada actual y todo lo que la sigue.
- **Comentario**: escribe en «📖 Estudio › Comentario»; se guarda en la jugada que lleva a la posición. Los símbolos `!` `!!` `!?` `?!` `?` `??` y la valoración de la posición se exportan al SGF (TE, BM, IT, DO, GB, GW, DM, UC).
- **Marcas en el tablero**: elige △ □ ○ ✕, letras (A, B, C…) o números y pulsa puntos del tablero; 🧽 borra una marca. Mientras haya una marca elegida, el clic marca en lugar de jugar (púlsala otra vez o `Esc` para volver a jugar).
- **✏ Colocar piedras** monta posiciones libremente (por ejemplo, un problema): ⚫, ⚪ o 🧽 y clic en el tablero; clic derecho pone el otro color. Las piedras se colocan sin capturar (AB/AW/AE en SGF) y eliges quién juega después.

## 📄 4. Importar y exportar (SGF)
- **Importar**: pega en «📖 Estudio» un SGF de OGS, KGS, Fox, Tygem, GoGoD, Sabaki, CGoban… y pulsa **Importar**. Se leen variantes, comentarios, marcas, colocaciones, hándicap, komi, reglas, rangos y resultado; las propiedades que GoBase no usa se conservan al exportar.
- También entiende **jugadas sueltas**: `D4 Q16 C3 pasa` o `pd dp cc`. «Añadir desde aquí» las añade a partir de la posición actual.
- **📂 Abrir .sgf**: un fichero con una partida la abre; un fichero (o varios) con muchas partidas los abre en **📚 Biblioteca › 🗂 Fichero**, sólo en memoria. Respeta la codificación declarada (CA), por ejemplo GB2312 o Shift_JIS.
- **Exportar**: 📋 Copiar SGF, ⬇ Descargar .sgf o ⬇ Completa (.json, con el análisis). Con «Incluir el análisis», los comentarios del motor van dentro del SGF con el prefijo `[GoBase]`.
- **🖼 Imagen** descarga la posición en PNG (y la copia al portapapeles); **🖨 Imprimir** genera la partida en **figuras de 50 jugadas numeradas** con sus comentarios (también sirve para guardar en PDF); **🔗 Enlace** copia una dirección que abre la partida en esa jugada.

## 🤖 5. El motor y el análisis de la partida
- GoBase trae su propio motor, **de Monte Carlo** (búsqueda en árbol con UCT y RAVE): juega miles de partidas simuladas desde la posición y cuenta cuántas gana cada bando. No necesita conexión ni descarga nada.
- **Analizar** (`E`) lo pone a pensar en la posición del tablero: muestra la **probabilidad de ganar**, la **ventaja estimada en puntos** (con el komi) y las mejores jugadas con su variante. Pulsa una línea para jugarla; **⚡ Jugar** juega la mejor.
- **Candidatas** pinta en el tablero las mejores jugadas con su porcentaje (azul la mejor). **Territorio** (`T`) pinta de quién es cada punto según el motor; las piedras con un cuadrado del otro color están, probablemente, muertas.
- **💡 Pista** (`H`) marca con un círculo la jugada que elige el motor.
- **🤖 Analizar y comentar** (📖 Estudio) evalúa cada posición de la línea principal (o de la variante, con 🌿), marca ?! ? ?? según cuánto baja la probabilidad de ganar (6, 12 y 24 %), redacta comentarios en español (capturas, ataris, conexiones, puntos de la esquina, la mejor alternativa y su línea) y dibuja el gráfico.
- El **informe** resume la partida: coincidencia con el motor, pérdida media, errores por fases (apertura, medio juego, final), momentos clave y qué practicar. **🎯 Aprende de tus errores** te lleva a cada ? y ?? para que busques tú la jugada buena; se acepta cualquiera casi igual de buena que la del motor.
- **✍ Redactar comentario con el motor** comenta sólo la jugada actual.

El motor no tiene red neuronal: en 9×9 y 13×13 juega con sentido y señala bien los errores claros, pero en 19×19 es mucho más débil que KataGo o Leela Zero. Tómalo como una orientación; para revisar una partida importante, descarga el SGF y ábrelo en esos programas.

## 🎮 6. Jugar contra la CPU
- **🤖 Jugar vs CPU**: elige tamaño (9×9 es donde mejor juega), tu color, **nivel 1 a 8**, **hándicap** de 2 a 9 piedras, komi, reglas y reloj.
- El **reloj** usa tiempo principal y **byo-yomi** japonés: cuando se acaba el tiempo principal, tienes varios periodos (por ejemplo, 3 × 30 s); si juegas dentro del periodo, se repone; si lo agotas, pierdes uno. Sin periodos, pierdes por tiempo.
- Durante la partida: **✋ Pasar**, **🏳 Rendirse**, **↶ Deshacer** (sólo sin reloj) y **🔁 Revancha**. La CPU pasa cuando la partida está acabada y se rinde si va claramente perdida.
- Cuando los dos pasáis se abre el **recuento**: el motor propone las piedras muertas, puedes corregirlas pulsando los grupos y **✔ Aceptar el resultado**, que queda escrito en la partida (RE). Si no estás de acuerdo, **↩ Seguir jugando**.
- La partida es como cualquier otra: puedes guardarla con 💾 y analizarla después.

## 🧮 7. Recuento: territorio, prisioneros y komi
- **🧮 Contar ahora** cuenta la posición del tablero. El motor propone qué grupos están muertos (se ven transparentes); pulsa un grupo para cambiarlo de vivo a muerto.
- **Reglas japonesas**: territorio + prisioneros (capturas y piedras muertas). **Reglas chinas**: piedras vivas en el tablero + territorio. Las blancas suman el **komi**.
- Los puntos neutrales (dame) no son de nadie; en seki, los ojos compartidos tampoco cuentan.
- **✔ Poner este resultado en la partida** escribe el resultado (B+3.5, W+0.5…) en los datos de la partida.
- **📈 Estimación en vivo**: con «Analizar» encendido, el motor da la ventaja en cualquier momento de la partida.
- **🎲 ¿Quién gana?** es un ejercicio para aprender a contar: la CPU juega una partida rápida de 9×9 y tú dices quién gana y por cuánto (se acepta un punto de margen).

## 🌍 8. Aperturas
- El **explorador de tus partidas** muestra qué se jugó desde la posición del tablero en tu biblioteca y en el fichero abierto, y cómo acabaron esas partidas. Reconoce la misma posición aunque esté **girada o reflejada** (las 8 simetrías del tablero). Pulsa una fila para jugarla.
- **Puntos de la esquina**: hoshi (4-4), komoku (3-4), san-san (3-3), takamoku (4-5), mokuhazushi (3-5) y tengen, con su idea. Pulsa uno para verlo.
- **Formaciones** (nirensei, sanrensei) y **consejos** para la apertura.

## 📚 9. Biblioteca, marcadores y estadísticas
- **Nada se guarda solo**: importar o abrir un fichero no guarda nada. Pulsa **💾 Guardar en biblioteca** en las partidas que te interesen; a partir de ahí sus cambios se guardan solos.
- En **📚 Partidas**: buscador, ⭐ favoritas, etiquetas, orden, borrado individual o de varias, **⬇ Exportar .sgf** y **copias de seguridad** (⬇ y ⬆) con partidas y marcadores.
- **📌 Marcar** (`M`) guarda la posición con una categoría (idea, táctica, vida y muerte, forma, error típico, plan, yose…) y una nota. En **📌 Marcadores** las ves con un minitablero y vuelves a ellas con un clic.
- **🔎 Buscar** encuentra un texto en los comentarios de todas tus partidas y en las notas de los marcadores.
- **📊 Estadísticas**: con tu nombre tal como sale en las partidas, verás victorias por color y tamaño de tablero, coincidencia con el motor, errores por partida y en qué fase pierdes más.
- **🗂 Fichero**: las colecciones .sgf se abren sólo en memoria; filtra y guarda las que quieras.
- El medidor de **💾 Ocupación** dice cuánto ocupa todo; **🔒 Proteger datos** pide al navegador que no lo borre si le falta espacio.

## 🎯 10. Entrenar
- **🧩 Problemas** de vida y muerte (formas de ojos: tres en línea, en ángulo, cuatro en T, cinco abultado, cinco en cruz, conejo de seis) y de capturas (escalera, red, contragolpe). Juegas con negras dentro de la zona azul; la CPU defiende o ataca con **lectura exacta**, así que **cualquier jugada que funcione vale**, aunque no sea la del libro. Al acabar verás por qué funciona.
- **📂 Abrir problemas .sgf**: colecciones de problemas en SGF. La solución es la rama marcada con `RIGHT`, `Correcto` o `!`, o la línea principal si el fichero no marca nada.
- **❌ Errores de tus partidas**: los ? y ?? de todas tus partidas analizadas, al azar. Busca la jugada buena; el motor acepta cualquiera casi igual de buena.
- **🧠 Tarjetas**: cada marcador con «entrenar» es una tarjeta. Las que aciertas vuelven en 1, 3, 7, 16, 35 y 75 días; las que fallas, al rato.

> **Plan de una semana:** cada día 5 problemas, repasa las tarjetas pendientes y analiza una partida tuya. El fin de semana, «Errores de tus partidas».

## 📲 11. Instalar y usar sin conexión
- La versión web se puede **instalar como aplicación** (botón «⬇ Instalar», o «Añadir a pantalla de inicio» en el móvil) y entonces funciona **sin conexión**.
- También puedes descargar el archivo `gobase.html` y abrirlo con doble clic: es la aplicación completa en un solo fichero.
- La biblioteca vive en tu navegador y depende de la dirección: la de la versión web no es la misma que la del archivo descargado. Para pasarla de un sitio a otro, usa **⬇ Copia de seguridad** y **⬆ Restaurar copia**.

## ⌨ 12. Atajos de teclado
| Tecla | Acción |
| --- | --- |
| `←` `→` | Jugada anterior / siguiente |
| `RePág` `AvPág` | 10 jugadas atrás / adelante |
| `↑` `↓` | Cambiar entre variantes |
| `Inicio` `Fin` | Principio / final de la línea |
| `Espacio` | Reproducción automática |
| `P` | Pasar |
| `E` | Activar / pausar el análisis continuo |
| `T` | Mostrar u ocultar el territorio estimado |
| `H` | Pista: la mejor jugada |
| `N` | Números en las piedras |
| `M` | Marcar la posición |
| `?` | Esta ayuda |
| `Esc` | Cerrar ventanas y dejar de marcar |

## ❔ 13. Preguntas frecuentes
**¿Dónde se guardan mis partidas?**

Sólo en tu navegador (IndexedDB). Nada se sube a ningún servidor; GoBase no se conecta a internet.

**¿Qué reglas usa?**

Las del go: capturas, ko y suicidio prohibido. Para la repetición de posiciones puedes elegir superko posicional (por defecto) o sólo ko simple. El recuento puede ser japonés (territorio) o chino (área).

**¿Por qué el motor a veces no ve una jugada evidente?**

Es un motor de Monte Carlo sin red neuronal: es bueno en luchas locales y en tableros pequeños, pero en 19×19 necesita muchas simulaciones y puede despistarse. Déjalo pensar más (análisis continuo) o usa «Profundo» en ⚙ Ajustes.

**¿Cómo sé que los problemas están bien?**

Cada problema lo resuelve un lector exacto: el de vida y muerte prueba todas las jugadas de la zona, y el de capturas lee escaleras, redes y contragolpes. Las pruebas automáticas del proyecto comprueban la solución de cada uno.

**¿Puedo usarlo, modificarlo o compartirlo?**

Sí, con licencia MIT. El código está en [github.com/rkarillo-tech/gobase](https://github.com/rkarillo-tech/gobase).
