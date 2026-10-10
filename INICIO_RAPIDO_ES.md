# KPI Atelier · Código fuente completo · v1.4.0

Esta copia corresponde al código de la aplicación publicada y republicada el 9 de octubre de 2026. Permite estudiarla, modificarla y ejecutar una réplica local. El código de la aplicación está en `dist/`: a pesar del nombre de esa carpeta, son los archivos fuente originales, sin compilar ni minificar mediante un proceso de build.

## 1. Ejecutar en tu ordenador

Necesitas Node.js 20 o superior disponible en la terminal. Compruébalo con `node --version`.

1. Extrae **todo el ZIP** en una carpeta.
2. Abre la carpeta `KPI-Atelier-v1.4.0` en VS Code, o abre una terminal en ella.
3. Ejecuta:

```bash
node scripts/serve.mjs
```

4. Abre **http://127.0.0.1:8080** en tu navegador.
5. Mantén la terminal abierta mientras utilizas la app. Para detenerla, pulsa **Ctrl+C**.

No hay dependencias que instalar: no necesitas `npm install`, claves API, base de datos ni una cuenta de Power BI para diseñar y probar los datos de ejemplo. El servidor incluido utiliza únicamente módulos de Node y escucha en tu propio equipo.

Si el puerto está ocupado, usa `node scripts/serve.mjs 8081` y abre http://127.0.0.1:8081. Mantén la misma dirección y puerto en sesiones posteriores: el almacenamiento del navegador depende de ellos.

No abras `dist/index.html` con doble clic: los módulos JavaScript deben servirse por HTTP. Tras editar el código, guarda y recarga el navegador; el servidor de este ZIP no hace recarga automática.

## 2. Comprobar las pruebas

Desde la carpeta principal:

```bash
node --test tests/core.test.mjs tests/editor.test.mjs
```

También puedes usar `npm test`. En la preparación de este ZIP se han superado **45 pruebas** sobre la copia extraída. Cubren geometría, generación de HTML/DAX, datos de ejemplo, navegación con cambios y controles con DOM simulado. No equivalen a una prueba visual en navegador ni a ejecutar el DAX dentro de Power BI.

## 3. Qué incluye

- Todo el HTML, CSS y JavaScript de la aplicación, conservado byte a byte.
- Las 18 plantillas, 10 temas y 47 iconos vectoriales.
- El editor, capas, tamaños, guías, colores, efectos, gráficos y generador DAX.
- Las pruebas originales y el README técnico original.
- `ARQUITECTURA_ES.md`: explicación de los módulos y de los principales flujos.
- `scripts/serve.mjs`: servidor local añadido a esta exportación.
- `EXPORTACION.json`: versión, commit e inventario de procedencia.
- `SHA256SUMS.txt`: huellas de los archivos para comprobar su integridad.
- `docs/hosting.example.json`: configuración estática de referencia, sin vincular tu réplica al sitio original.

El `package.json` se conserva sin cambios. El ZIP no contiene credenciales, sesiones, historial Git ni el identificador activo de despliegue del sitio original; estos no son necesarios para ejecutar la app.

## 4. Tus diseños guardados

Los diseños, borradores y temas personales se guardan en `localStorage`, en tu navegador, y **no forman parte del código fuente**. La réplica local tendrá su propio almacenamiento, separado del sitio publicado.

Para trasladar un diseño, expórtalo como JSON desde la app original y usa **Importar** en la réplica. Las plantillas y datos de ejemplo sí están incluidos en el código.

## 5. Power BI

La app no se conecta a tu modelo ni ejecuta sus medidas. La vista previa usa datos de muestra. La exportación genera una medida DAX de texto con HTML/SVG; los nombres de medidas y calendario deben coincidir con los de tu modelo. Valida la medida y el renderizado en Power BI con el visual de HTML correspondiente.

## 6. Publicar tu réplica

Para un alojamiento estático, publica el **contenido de `dist/`**, con `index.html` en la raíz pública. No hay compilación ni backend de la aplicación.

La protección de acceso del sitio original pertenece al alojamiento y no es código de autenticación de la app. Si necesitas una réplica privada, configura el acceso en tu propio alojamiento. El servidor incluido es únicamente para desarrollo local.
