/* GoBase · problemas incluidos y datos de apertura.
   Cada problema se comprueba con los lectores exactos del núcleo (Go.solveLD y Go.readCapture): en la aplicación
   se acepta cualquier jugada que funcione, no sólo la del libro, y la CPU defiende o ataca a la perfección.
   Diagramas: X negras, O blancas, «,» vacío dentro de la zona del problema, «.» vacío fuera. Juegan siempre negras. */
"use strict";

const PROBLEMS = [
  { id: "ld-recta3-m", kind: "ld", goal: "kill", level: 1, title: "Tres en línea · matar",
    text: "Las blancas tienen un espacio de tres puntos en línea. Juegan negras: mata al grupo blanco.",
    diagram: [",,,OX....", "OOOOX....", "XXXX....."], target: [3, 0], answer: ["B9"],
    explain: "El punto vital de los tres en línea es el del medio. Si juegan ahí las blancas hacen dos ojos; si juegas tú, sólo les queda espacio para uno." },
  { id: "ld-recta3-v", kind: "ld", goal: "live", level: 1, title: "Tres en línea · vivir",
    text: "Tu grupo tiene tres puntos en línea. Juegan negras: haz dos ojos.",
    diagram: [",,,XO....", "XXXXO....", "OOOO....."], target: [3, 0], answer: ["B9"],
    explain: "Jugando en el centro divides el espacio en dos ojos de un punto: el grupo vive." },
  { id: "ld-curva3-m", kind: "ld", goal: "kill", level: 1, title: "Tres en ángulo · matar",
    text: "Tres puntos en forma de ángulo en la esquina. Juegan negras y matan.",
    diagram: [",,OX.....", ",OOX.....", "OOX......", "XX......."], target: [2, 0], answer: ["A9"],
    explain: "En los tres en ángulo el punto vital es el vértice, el que toca a los otros dos (aquí, la esquina)." },
  { id: "ld-curva3-v", kind: "ld", goal: "live", level: 1, title: "Tres en ángulo · vivir",
    text: "Tu grupo tiene tres puntos en ángulo. Juegan negras: vive.",
    diagram: [",,XO.....", ",XXO.....", "XXO......", "OO......."], target: [2, 0], answer: ["A9"],
    explain: "Ocupar el vértice del ángulo deja dos ojos separados." },
  { id: "ld-t4-m", kind: "ld", goal: "kill", level: 2, title: "Cuatro en T · matar",
    text: "Cuatro puntos en forma de T (pirámide). Juegan negras y matan.",
    diagram: [",,,OX....", "O,OOX....", "OOOX.....", "XXX......"], target: [3, 0], answer: ["B9"],
    explain: "El punto vital de la pirámide de cuatro es el que toca a los otros tres. Después, cualquier jugada blanca deja un solo ojo." },
  { id: "ld-t4-v", kind: "ld", goal: "live", level: 2, title: "Cuatro en T · vivir",
    text: "Tu grupo tiene un espacio en forma de T. Juegan negras: vive.",
    diagram: [",,,XO....", "X,XXO....", "XXXO.....", "OOO......"], target: [3, 0], answer: ["B9"],
    explain: "El mismo punto que mata es el que da la vida: el centro de la T deja tres ojos posibles, y las blancas sólo pueden quitar uno." },
  { id: "ld-abultado5-m", kind: "ld", goal: "kill", level: 2, title: "Cinco abultado · matar",
    text: "Cinco puntos en forma abultada (un cuadrado y uno más). Juegan negras y matan.",
    diagram: [",,,OX....", ",,OOX....", "OOOX.....", "XXX......"], target: [3, 0], answer: ["B9"],
    explain: "En el cinco abultado el punto vital es el que toca a otros tres puntos del espacio." },
  { id: "ld-abultado5-v", kind: "ld", goal: "live", level: 2, title: "Cinco abultado · vivir",
    text: "Tu grupo tiene un espacio abultado de cinco puntos. Juegan negras: vive.",
    diagram: [",,,XO....", ",,XXO....", "XXXO.....", "OOO......"], target: [3, 0], answer: ["B9"],
    explain: "Ocupar el punto vital deja dos ojos que las blancas no pueden quitar a la vez." },
  { id: "ld-cruz5-m", kind: "ld", goal: "kill", level: 2, title: "Cinco en cruz · matar",
    text: "Cinco puntos en forma de cruz. Juegan negras y matan.",
    diagram: ["OO,OOX...", "O,,,OX...", "OO,OOX...", "OOOOXX...", "XXXXX...."], target: [0, 0], answer: ["C8"],
    explain: "El centro de la cruz es el único punto vital: tras él, los cuatro brazos no pueden convertirse en dos ojos." },
  { id: "ld-cruz5-v", kind: "ld", goal: "live", level: 2, title: "Cinco en cruz · vivir",
    text: "Tu grupo tiene un espacio en cruz. Juegan negras: vive.",
    diagram: ["XX,XXO...", "X,,,XO...", "XX,XXO...", "XXXXOO...", "OOOOO...."], target: [0, 0], answer: ["C8"],
    explain: "En el centro haces cuatro ojos posibles de un punto: vivo con holgura." },
  { id: "ld-conejo6-m", kind: "ld", goal: "kill", level: 3, title: "Seis en conejo · matar",
    text: "Seis puntos en la forma llamada «conejo» o «flor». Juegan negras y matan.",
    diagram: ["OO,OOX...", "O,,,OX...", "OO,,OX...", "OOOOOX...", "XXXXXX..."], target: [0, 0], answer: ["C8"],
    explain: "El conejo de seis muere si el atacante ocupa el punto que toca a cuatro de los otros cinco. Hay que seguir con calma: las blancas no consiguen dos ojos." },
  { id: "ld-conejo6-v", kind: "ld", goal: "live", level: 3, title: "Seis en conejo · vivir",
    text: "Tu grupo tiene un espacio de conejo de seis puntos. Juegan negras: vive.",
    diagram: ["XX,XXO...", "X,,,XO...", "XX,,XO...", "XXXXXO...", "OOOOOO..."], target: [0, 0], answer: ["C8", "D8", "C7"],
    explain: "La jugada más clara es el centro, el punto vital; hay otras que también viven, y GoBase las acepta." },
  { id: "cap-escalera", kind: "cap", level: 1, title: "Escalera",
    text: "Captura la piedra blanca de E5. Juegan negras.",
    diagram: [".........", ".........", ".........", ".........", "...XO....", "....XX..."], target: [4, 4], answer: ["E6"],
    explain: "Atari desde E6: cada vez que la piedra blanca se alarga vuelve a quedar en atari y la escalera (shicho) la lleva hasta el borde. Con el atari desde el otro lado (F5), las blancas salen por E6 con tres libertades." },
  { id: "cap-red", kind: "cap", level: 2, title: "Red",
    text: "La escalera no funciona por la piedra blanca de B8. Captura de todos modos la piedra de E5.",
    diagram: [".........", ".O.......", ".........", ".....X...", "....OX...", "...XX...."], target: [4, 4], answer: ["D6"],
    explain: "Si das atari, la escalera choca con B8 y las blancas escapan. La red (geta) de D6 no da atari pero cierra las dos salidas a la vez." },
  { id: "cap-red2", kind: "cap", level: 2, title: "Red · otra forma",
    text: "La piedra blanca de F7 rompería una escalera. Captura la piedra de E5.",
    diagram: [".........", ".........", "....XO...", ".........", "...XO....", "....XX..."], target: [4, 4], answer: ["F6"],
    explain: "F6 encierra a la piedra de E5 sin darle atari: si empuja por E6 o por F5, cada salida queda tapada por tus piedras." },
  { id: "cap-contragolpe", kind: "cap", level: 3, title: "Contragolpe",
    text: "Captura las cuatro piedras blancas del centro (E3). Juegan negras.",
    diagram: [".........", ".........", ".........", ".........", "XXXXXXX..", "OO.XXXX..", ".O.XOOX..", ".O.XOOX..", ".OOO..X.."], target: [4, 6], answer: ["E1"],
    explain: "Sacrifica una piedra en E1. Si las blancas la capturan en F1, se quedan con una sola libertad y recapturas todo en E1 (contragolpe, uttegaeshi). El atari normal en F1 deja que conecten en E1 con el grupo grande." }
];

// Puntos de la esquina (posición en 19×19 desde la esquina de arriba a la derecha)
const CORNER_POINTS = [
  { name: "Hoshi (punto estrella, 4-4)", pt: "Q16", idea: "Rápido y equilibrado: mira a los dos lados, pero deja la invasión en el 3-3." },
  { name: "Komoku (3-4)", pt: "R16", idea: "Clásico y sólido: asegura la esquina con una jugada más y se desarrolla hacia un lado." },
  { name: "San-san (3-3)", pt: "R17", idea: "Territorio seguro en la esquina desde el principio; poca influencia hacia el centro." },
  { name: "Takamoku (4-5)", pt: "P16", idea: "Alto: apunta al centro y a la influencia; la esquina queda menos cerrada." },
  { name: "Mokuhazushi (3-5)", pt: "Q17", idea: "Fuera del komoku: pide una respuesta concreta y lleva a luchas poco conocidas." },
  { name: "Tengen (centro)", pt: "K10", idea: "El centro del tablero: original, sin territorio inmediato." }
];
const FUSEKI = [
  { name: "Nirensei", moves: "Q16 Q4", idea: "Dos puntos estrella en el mismo lado: rápido y orientado a la influencia." },
  { name: "Sanrensei", moves: "Q16 Q4 Q10", idea: "Tres puntos estrella en línea en el lado derecho: un gran marco (moyo)." }
];
const OPENING_TIPS = [
  "Primero las esquinas, luego los lados y por último el centro: en las esquinas se hace territorio con menos piedras.",
  "La tercera línea es la del territorio y la cuarta la de la influencia; la primera y la segunda son pequeñas al principio.",
  "Extiéndete desde tus grupos a una distancia que puedas defender: dos espacios desde una piedra, tres desde dos.",
  "No acerques tus piedras a la fuerza del rival: un muro fuerte cerca reduce el valor de tus piedras.",
  "Juega primero las jugadas grandes que son también urgentes: un grupo débil vale más que un punto grande.",
  "Con hándicap, las piedras negras ya ocupan los puntos estrella: usa su fuerza para atacar y no te encierres."
];
