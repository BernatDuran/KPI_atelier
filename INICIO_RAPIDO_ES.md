# KPI Atelier · Inicio rápido

El código del editor está en `dist/`: son módulos JavaScript fuente que se ejecutan directamente, sin compilación. El servidor local de `scripts/` sirve la interfaz y proporciona la conexión con Power BI Desktop.

## 1. Ejecutar en tu PC

Necesitas Node.js 22 o superior. Desde la carpeta principal:

```bash
node --version
npm start
```

Abre [http://127.0.0.1:8080](http://127.0.0.1:8080). Mantén la terminal abierta; Ctrl+C detiene el servidor. Para otro puerto, ejecuta `node scripts/serve.mjs 8081`. Conserva la misma dirección y puerto entre sesiones: los diseños locales pertenecen a ese origen del navegador.

El runtime no necesita paquetes npm de producción, claves API ni una base de datos. Puedes diseñar y exportar con datos de muestra sin Power BI abierto. Las fuentes pueden descargarse de Google Fonts; sin conexión se utilizan las alternativas del sistema.

No abras `dist/index.html` mediante `file://`. Los módulos necesitan HTTP y el bridge rechaza orígenes nulos o distintos al del servidor local. `GET /api/health` permite comprobar identidad, versión y protocolo del servidor.

## 2. Preparar el entorno de desarrollo

Las herramientas de tipos y navegador requieren dependencias de desarrollo:

```bash
npm ci
npm run typecheck
npm test
npm run test:browser
```

`npm run check` ejecuta las tres comprobaciones. Las pruebas de navegador usan Microsoft Edge instalado en el PC y arrancan su propio servidor en el puerto 8098. La CI utiliza Chromium, instalado con `npx playwright install --with-deps chromium`, y comprueba Node 22/24 en Windows y Linux.

Los tests cubren código, contratos y flujos del editor. Las escrituras del bridge se prueban con objetos simulados y las del navegador con respuestas HTTP controladas. No evalúan DAX ni modifican un modelo semántico real; verifica los resultados de negocio y la representación visual en Power BI.

## 3. Conectar datos

**Carpeta PBIP:** selecciona la carpeta de un solo modelo `.SemanticModel`. Se leen tablas, medidas y calendarios de TMDL o `model.bim`, localmente y sin subirlos. El lector admite hasta 10 MB por archivo, 50 MB acumulados, 1.000 archivos de modelo, 10.000 entradas y 16 niveles de profundidad. Si la carpeta contiene varios modelos, selecciona directamente el que necesitas. Una nueva selección cancela la lectura anterior.

**Power BI Desktop:** requiere Windows, PowerShell, un informe abierto y las bibliotecas TOM. `scripts/pbi_connection.ps1` busca estas bibliotecas en las instalaciones compatibles y en la carpeta `bin` del proyecto. Utiliza Conectar para elegir el informe.

La herramienta externa puede registrarse mediante `scripts/install-pbitool.ps1`. Su lanzador `kpi-atelier.cmd` entrega servidor y base a `scripts/launch.ps1` mediante `KPI_LAUNCH_SERVER` y `KPI_LAUNCH_DATABASE`. Comprueba la identidad del servicio, inicia el servidor oculto cuando hace falta y codifica los parámetros antes de abrir la app. Si el puerto está ocupado por otro servicio o versión, informa del problema y no abre ese destino.

Conectar permite revisar metadatos. La tarjeta del editor sigue mostrando datos de muestra, no el resultado evaluado del modelo.

## 4. Aplicar una medida con revisión

Configura las referencias, revisa el destino y aplica la medida. La app vuelve a consultar el catálogo y pide confirmación al sobrescribir. El backend exige base y tabla explícitas y comprueba que la expresión existente coincida con la revisada.

Un conflicto `409` significa que el destino cambió: actualiza y revisa antes de continuar. Si una escritura termina con resultado incierto por desconexión o tiempo agotado, comprueba primero la medida en Power BI. La app no repite esa escritura automáticamente.

En tarjetas con calendario, el período corresponde a los filtros de calendario o, sin filtro, a los últimos doce meses móviles hasta la última fecha con datos. Valor actual, objetivo basado en medida y referencia personalizada comparten esas fechas. Los gráficos y las variaciones duplicados usan la medida de su **Valor principal (Copia N)**; si ese valor no existe o está eliminado, aparece un campo de medida independiente para el elemento. Ese campo no hereda silenciosamente la medida principal. Los gráficos temporales comparten calendario y período de cálculo. En **Objetivos de las copias** puedes asignar una medida o un número independiente por copia: su etiqueta, avance, anillo y comparativa de objetivo usan ese mismo objetivo. Vaciar una asignación la deja pendiente y bloquea la aplicación en Power BI. Al cargar diseños antiguos se explican las referencias que se sustituyen por este contrato. Las comparaciones temporales requieren cobertura suficiente del calendario. Consulta [la arquitectura](ARQUITECTURA_ES.md) para las reglas de períodos discontinuos y tendencias duplicadas.

## 5. Conservar y trasladar diseños

Los diseños nombrados y las paletas se guardan en IndexedDB, con un espejo en localStorage. Los borradores y las preferencias continúan en localStorage/sessionStorage. Los datos existentes se migran al abrir la nueva versión; no forman parte del repositorio ni se sincronizan entre equipos o puertos. Exporta JSON e impórtalo en el destino para trasladar una configuración.

Puedes alojar estáticamente el contenido de `dist/` para diseñar y exportar. La conexión directa con Power BI requiere el servidor local y su política de mismo origen; publicar solo `dist/` no publica el bridge. La compatibilidad HTML/SVG depende del visual y del entorno de Power BI utilizado.
## Actualización 1.4.3 · escritorio

Usa la carpeta o el ZIP de `releases/` que contiene la versión 1.4.3. Cierra las ventanas de versiones anteriores y reinicia el servidor de Atelier. La colección permanece en el navegador al conservar el mismo origen y puerto.

Los guardados entre ventanas se coordinan mediante Web Locks y transacciones IndexedDB en Edge/Chrome. Si otra ventana modificó el mismo diseño, se conserva una «Copia en conflicto». Cada ventana recupera su borrador; los de otras sesiones aparecen como «Borrador recuperable» en Mis diseños. El almacenamiento sigue siendo local: exporta JSON para trasladarlo o conservar una copia independiente.

Un guardado pendiente conserva la tarjeta que enviaste y no cambia la identidad de otra que abras después. Las ventanas duplicadas no retiran la recuperación de la original. También se conservan borradores anteriores a una recarga: puedes revisar y eliminar esas recuperaciones desde Mis diseños.

Si desconectas o cambias de informe durante una escritura, el resultado identifica el destino original. Para revisar o reintentar, selecciona de nuevo ese informe. Un resultado incierto requiere comprobar el contenido antes de volver a aplicarlo.

Las copias de títulos, textos decorativos e iconos conservan contenido y apariencia; sus antiguas propiedades de datos se retiran con un aviso. Las copias de valor, referencia y estado mantienen los enlaces admitidos; las tendencias heredan su valor asociado. Los avisos de legibilidad detectan textos superpuestos o recortados en la muestra, también antes de exportar HTML o DAX; no recolocan elementos. Se comprueba el escritorio en 1024×640 y 1093×614, además de los tamaños mayores.

El borrado comprueba la versión mostrada al abrir la confirmación. Si cambia en otra ventana, se conserva y debes revisarla de nuevo. Las paletas también se coordinan entre ventanas; una edición simultánea conserva una copia en conflicto. Desconectar un modelo conserva medidas y calendario del diseño. Una respuesta de una conexión anterior se descarta cuando eliges otra o desconectas.

En Conectar datos puedes elegir la **tabla de destino**. Automático muestra la tabla resuelta; una medida existente conserva su tabla. Si una tabla elegida desaparece, corrígela antes de aplicar. JSON y Vista HTML se descargan aunque existan referencias incompletas; el HTML utiliza muestras. DAX conserva su revisión de referencias.

Para generar una distribución: `npm run check` y `npm run release`. Para comprobar sus hashes: `node scripts/release.mjs verify releases/KPI-Atelier-v1.4.3`.

En «Conectar datos del modelo», editar el nombre de la medida resultante actualiza también el título visible del KPI. Deshacer recupera ambos nombres juntos. En «En contexto», + y − amplían o reducen la vista; arrastra el informe ampliado o usa las flechas con el lienzo enfocado. Ajustar vista / Ctrl+1 muestra el informe completo; Ctrl+0 muestra el 100 %.
