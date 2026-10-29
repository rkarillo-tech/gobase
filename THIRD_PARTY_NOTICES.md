# Componentes y servicios de terceros

Todo el código de GoBase es propio y se distribuye con licencia [MIT](LICENSE): las reglas, el motor de Monte Carlo,
los lectores de capturas y de vida y muerte, el lector y escritor SGF, el dibujo del tablero, la interfaz y la biblioteca.

- **No incluye** bibliotecas, motores ni datos de terceros.
- **No se conecta** a ningún servicio en línea: funciona entero en el navegador.
- Los problemas incluidos son formas clásicas del go (formas de ojos, escalera, red, contragolpe) montadas para GoBase
  y comprobadas con sus propios lectores.

Las pruebas de desarrollo usan [Playwright](https://playwright.dev) (Apache 2.0), que no forma parte de la aplicación.
