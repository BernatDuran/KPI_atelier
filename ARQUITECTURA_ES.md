# Cómo está construida KPI Atelier

## 1. Tecnología y estructura

Es una aplicación de escritorio en navegador con HTML, CSS y JavaScript nativo. Utiliza módulos ES (`.mjs`) sin compilación y genera tarjetas HTML/SVG. El backend local Node sirve la interfaz y conecta con Power BI Desktop mediante PowerShell y TOM. No hay base de datos de diseños ni dependencias de producción; TypeScript comprueba el JavaScript y los contratos JSDoc sin generar archivos.

La interfaz se monta sobre `#app`, definido en `dist/index.html`. Ese HTML carga `styles.css` y el módulo `app.mjs`. Los iconos y gráficos se dibujan con SVG; no hay un paquete de imágenes que falte por descargar.

| Archivo | Responsabilidad |
| --- | --- |
| `dist/index.html` | Página inicial, contenedor de la app, diálogo modal y entrada de archivos. |
| `dist/app.mjs` | Arranque, registro explícito de colaboradores y coordinación de eventos del editor. |
| `dist/editor-events.mjs` | Gestos del lienzo, cancelación de interacciones y atajos de teclado. |
| `dist/shell-ui.mjs` | Biblioteca, cabecera, estructura del editor y actualización de controles compartidos. |
| `dist/state.mjs` | Configuración activa, borrador, colección guardada, selección, historial y protección de cambios. |
| `dist/canvas.mjs`, `dist/inspector.mjs` | Lienzo, manipulación de elementos e inspector contextual. |
| `dist/binding-ui.mjs`, `dist/bindings.mjs` | Edición de referencias a datos y correspondencia entre elementos y campos. |
| `dist/studio-ui.mjs` | Iconos, paletas y controles del estudio de color. |
| `dist/modals.mjs` | Infraestructura de diálogos y revisión de operaciones. |
| `dist/model.mjs`, `dist/schema.mjs` | `BASE`, plantillas, temas, normalización y contratos de configuración y catálogo. |
| `dist/cards.mjs` | Formato de números, datos de ejemplo, iconos generales y `cardHTML()`, el renderizador compartido. |
| `dist/elements.mjs` | Catálogo de elementos, tamaños, visibilidad, desplazamiento, marcos y orden de capas. |
| `dist/layout.mjs` | Posiciones de las distribuciones, límites de tarjeta, congelación de geometría y redimensionado del lienzo. |
| `dist/charts.mjs` | Geometría y SVG de tendencias, curvas, áreas, degradados, puntos extremos y donut. |
| `dist/appearance.mjs` | Resolución de colores, opacidad, fondos y efectos de superficie. |
| `dist/guides.mjs` | Cálculo de guías, alineaciones y desbordamiento de los límites. |
| `dist/colors.mjs` | Paletas, conversión HEX/HSV y contraste. |
| `dist/icons.mjs` | Catálogo adicional de iconos y sus trazados SVG. |
| `dist/dax.mjs` | Generación de la medida DAX, referencias a medidas/calendario, formato y composición del HTML dinámico. |
| `dist/preflight.mjs` | Revisión de referencias, destino y condiciones previas a exportar o escribir. |
| `dist/pbip.mjs`, `dist/model-import.mjs` | Lectura local TMDL/BIM con límites, cancelación y selección de carpeta. |
| `dist/pbi-client.mjs` | Cliente HTTP, catálogo Power BI, errores y stream SSE. |
| `dist/live-connection.mjs` | Conexión inicial desde navegador o herramienta externa y seguimiento de desconexiones. |
| `dist/measure-write.mjs` | Revisión fresca, confirmación de sobrescritura y escritura sin repetición automática. |
| `dist/layer-events.mjs`, `dist/editor-clipboard.mjs` | Eventos de capas y operaciones del portapapeles del editor. |
| `dist/styles.css` | Apariencia y adaptación de la interfaz del editor. |
| `tests/core.test.mjs` | Pruebas de funciones y generación de HTML/DAX. |
| `tests/editor.test.mjs` | Pruebas de controles y guardado usando un DOM simulado. |
| `scripts/serve.mjs` | Servidor HTTP local, archivos estáticos, CSP y endpoint de salud. |
| `scripts/pbi_api.mjs`, `scripts/pbi_http.mjs` | Rutas, SSE, validación HTTP, origen, destino y tamaño de solicitudes. |
| `scripts/pbi_transport.mjs` | Proceso PowerShell persistente, cola acotada, correlación y tiempos máximos. |
| `scripts/pbi_bridge.ps1`, `scripts/pbi_connection.ps1` | Acciones TOM, descubrimiento local y resolución exacta de base y tabla. |
| `scripts/launch.ps1`, `kpi-atelier.cmd` | Arranque local verificado y apertura de la interfaz. |

## 2. El objeto de configuración es la pieza central

`state.mjs` conserva la configuración de la tarjeta, accesible mediante `getC()`. Contiene texto, datos de muestra, nombres de medidas, tipo de tarjeta, tema, dimensiones, opciones de gráficos y configuración de cada elemento.

`sanitizeConfig()` normaliza el objeto: valida enumeraciones, limita tamaños, controla colores y descarta claves ajenas al esquema. Si añades una propiedad nueva, revisa `BASE` y, cuando corresponda, `LIMITS` o `ENUMS`; de lo contrario, esa propiedad puede perderse al importar o editar.

`elements` guarda personalizaciones individuales: desplazamiento X/Y, ancho, marco de referencia, color, opacidad y visibilidad. `layerOrder` representa el orden de superposición. La plantilla ofrece un punto de partida; a partir de él se modifica la configuración.

## 3. Qué ocurre al editar un control

Los campos de la interfaz llevan atributos como `data-key`, `data-elprop` o `data-appearance`. Los manejadores delegados de `app.mjs` detectan el cambio, actualizan la configuración y la normalizan.

Antes de una operación relevante se guarda una copia en el historial. Los cambios continuos de ciertos controles se agrupan temporalmente para que Deshacer no tenga un paso por cada pequeño evento. Después se persiste el borrador y se vuelve a generar la tarjeta. El inspector conserva el estado de sus secciones, desplazamiento y foco en las actualizaciones compatibles.

Los modos Esencial y Avanzado muestran distintas cantidades de controles sobre el mismo objeto y comparten motor de renderizado.

## 4. Lienzo, arrastre y tamaños independientes

`presetFrames()` calcula las posiciones iniciales para las distribuciones vertical, gráfico a la izquierda y gráfico a la derecha. Estos cálculos no dependen del tamaño editado de otro elemento.

En la geometría actual (`geometryVersion: 2`), la tarjeta tiene ancho y alto exactos y los elementos se pintan con posiciones absolutas. Así, aumentar la fuente de un número o la altura de un gráfico no cambia la dimensión de sus vecinos ni de la tarjeta. El contenido que sale del lienzo se recorta; el editor puede avisar de ello y recuperarlo desde Capas.

`resizeCard()` conserva los marcos de los elementos antes de cambiar el lienzo. `applyLayout()` recoloca explícitamente los elementos cuando se escoge una distribución. El mínimo de tarjeta es 200 × 200 px; los máximos actuales son 800 × 650 px.

Los eventos `pointerdown`, `pointermove` y `pointerup` manejan arrastre y asas. El desplazamiento en pantalla se convierte a píxeles de tarjeta según el zoom y se ajusta al paso de 1 o 5 px. El teclado reutiliza operaciones de movimiento y tamaño. El orden de capas utiliza `z-index`, sin alterar las coordenadas.

El código mantiene una rama de compatibilidad con diseños antiguos en flujo automático. Al abrirlos en la vista individual, mide su disposición y migra a marcos fijos. Por eso verás referencias a posiciones separadas, huecos de composición y migración en los módulos y el README histórico.

## 5. Cómo funciona la vista previa

`sampleData(c)` toma los valores y la serie de ejemplo y calcula textos, variaciones, avance y estados. `cardHTML(c, datos, editor)` devuelve el HTML completo.

En modo editor se añaden atributos de selección. En las exportaciones esos atributos no se incluyen. Las tarjetas pequeñas de la biblioteca utilizan el mismo renderizador y se reducen visualmente a su contenedor.

Los estilos de cada tarjeta son principalmente CSS en línea para poder transportarse junto al HTML. `styles.css` está dedicado a la interfaz del diseñador, sus paneles, controles, selección y guías.

## 6. Gráficos

`chartPoints()` transforma la serie numérica en coordenadas. `linePath()` produce trazados rectos, escalonados o curvas cúbicas suaves con controles acotados entre los puntos.

El SVG utiliza dimensiones coherentes con el marco del gráfico y preserva la proporción. Las áreas pueden usar color uniforme o `linearGradient` hacia transparente. Los extremos se eligen sobre los datos; en una serie plana se evita duplicar las etiquetas de mínimo y máximo. En gráficos pequeños las etiquetas se omiten y permanecen los puntos.

El donut representa valor dividido por objetivo positivo. Su arco se limita al intervalo 0–100 %, pero la etiqueta puede superar el 100 %. Un objetivo no válido o un valor vacío se muestra como «—». Al elegir donut no hace falta una serie temporal, aunque una comparativa temporal adicional sí puede requerir calendario.

## 7. Del diseño al DAX

`generateDAX(c)` construye una medida de texto. Primero declara variables que referencian las medidas del modelo y calculan la comparación, el objetivo, estados, formatos y, si procede, una serie por fechas.

Para reutilizar la estructura visual, `tokenData()` entrega marcadores como `@@value@@` o `@@progress@@` a `cardHTML()`. Luego `compileHTML()` convierte esos marcadores en concatenaciones de variables DAX y escapa el texto literal.

El trazado de tendencia dinámico se construye con tablas virtuales y `CONCATENATEX` en DAX. Las funciones SVG compartidas mantienen coherente su estructura con la vista previa. Los cálculos de muestra están en JavaScript; los cálculos reales se expresan en DAX. No se ejecuta DAX dentro de esta aplicación.

Esta separación explica por qué verás lógica de tendencia tanto en `charts.mjs` como en `dax.mjs`: una dibuja datos de muestra y la otra genera el programa que calculará y dibujará los datos del modelo.

Cuando la tarjeta requiere calendario, respeta sus filtros explícitos; sin ellos, utiliza los últimos doce meses móviles hasta la última fecha con datos de la medida. Valor actual, objetivo basado en medida y referencia personalizada comparten ese conjunto de fechas. Las constantes no se filtran. Sin calendario requerido, conserva el contexto de filtro original. Una medida del usuario que quite filtros internamente puede modificar esta semántica.

YoY/MoM desplazan las fechas con `EDATE` y requieren que existan todas las fechas de referencia. Período anterior requiere selección continua y cobertura completa del intervalo anterior. Las selecciones discontinuas se indican con un asterisco. Las tendencias duplicadas usan siempre `dateTable` y `dateColumn` de la tarjeta; heredan la medida de `value_copyN` cuando existe; sin él, usan su medida independiente obligatoria y comparten las fechas exactas de la ventana principal, incluso sin filtros. La importación y el portapapeles descartan los calendarios independientes de copias antiguas. Para reglas fiscales particulares, utiliza medidas de negocio específicas y comprueba el resultado en Power BI.

El objetivo principal alimenta sus representaciones originales. Cada grupo de copia N tiene un objetivo configurable común a su etiqueta, avance, anillo y comparativa de objetivo. `goalBinding()` determina el único campo y propietario del grupo; una asignación vacía nunca cae al objetivo principal. Al eliminar su propietario se conserva el objetivo en otro elemento del grupo. Gráficos, comparaciones y progreso duplicados toman el valor de `value_copyN` cuando existe y no está eliminado; si no, `valueBinding()` devuelve su propietario independiente y el campo `element_copyN__measure`. No hay caída automática al principal. Las etiquetas de objetivo solo requieren su objetivo, ya que no muestran una magnitud actual. Un valor duplicado vacío permanece vacío. Las copias de valor, referencia y estado mantienen sus medidas admitidas. El panel de datos, la revisión, la simulación y DAX aplican este contrato. Las configuraciones antiguas muestran los ajustes de calendario, valor u objetivo al importarlas, abrirlas desde la biblioteca o recuperar una anotación de medida.

Un objetivo positivo se cumple con `valor >= objetivo` en dirección ascendente y `valor <= objetivo` en descendente, incluida la igualdad. La dirección neutral utiliza el acento; un valor vacío o un objetivo no positivo utiliza el estado sin datos. Los objetivos numéricos se respetan exactamente también en la simulación.

`model-session.mjs` coordina una revisión y una cancelación comunes para inicio, conexión manual, actualización, carpeta PBIP y comprobación previa a escritura. Cada respuesta comprueba su revisión y el catálogo observado antes de publicarse. Desconectar invalida lecturas pendientes y conserva la configuración del diseño. Cancelar una lectura nunca reintenta una escritura.

## 8. Guardado y protección de cambios

El estado se conserva en el navegador con claves como `kpi-atelier-draft`, `kpi-atelier-saved`, `kpi-atelier-themes` y `kpi-atelier-edit-state`. No hay un servicio remoto de diseños.

El borrador recuperable y el diseño guardado son conceptos distintos. `baseline` guarda la referencia limpia y `dirty()` detecta si la configuración actual difiere de ella. `requestNavigation()` ofrece guardar, descartar o seguir editando antes de sustituir el diseño o cambiar de pantalla.

`saveCurrent()` crea o actualiza la entrada de la colección. Si falla la escritura, conserva los cambios abiertos. El evento `beforeunload` pide al navegador que avise cuando quedan cambios pendientes.

Los diseños nombrados y las paletas personales usan Web Locks y transacciones IndexedDB para releer y modificar la colección. localStorage mantiene un espejo compatible. Las transacciones eliminan la carrera medida en las cachés de localStorage de diferentes procesos del navegador. La confirmación de borrado conserva la revisión completa mostrada, incluida la representación almacenada de diseños antiguos. Una revisión externa nueva bloquea el borrado. Los avisos de normalización se mantienen como metadatos transitorios al leer; una operación sobre otro diseño conserva su entrada original hasta que el usuario guarde su versión normalizada.

## 9. Dónde empezar a modificarla

| Quieres cambiar… | Empieza por… |
| --- | --- |
| Un tema o una plantilla | `THEMES` y `TEMPLATES` en `model.mjs`. |
| La interfaz de un panel | `inspector.mjs`, `binding-ui.mjs` o `studio-ui.mjs`, según el panel. |
| Las posiciones iniciales | `presetFrames()` en `layout.mjs`. |
| Cómo se pinta una tarjeta | `cardHTML()` en `cards.mjs`. |
| Colores y efectos | `appearance.mjs`. |
| El aspecto de los gráficos | `charts.mjs` y la generación equivalente en `dax.mjs`. |
| El cálculo o formato exportado | `generateDAX()` y sus auxiliares en `dax.mjs`. |
| El diseño general de la aplicación | `styles.css`. |

Como primer ejercicio, duplica una plantilla en `TEMPLATES`, dale un `id` único y cambia el título y el tema. Después revisa su vista previa, exporta HTML y DAX y ejecuta las pruebas. La prueba de catálogo contiene un recuento explícito de plantillas; si amplías el catálogo, actualiza también esa expectativa.

## 10. Conexión local y límites de validación

La API exige el mismo origen HTTP exacto y un Host local válido, incluido el puerto. Rechaza `Origin: null`, por lo que abrir desde `file://` no permite utilizar el bridge. `GET /api/health` devuelve identidad, versión y protocolo para que el lanzador detecte un servicio ajeno o incompatible. El lanzador recibe servidor y base por `KPI_LAUNCH_SERVER` y `KPI_LAUNCH_DATABASE`, y los codifica como parámetros de URL.

Antes de guardar se consulta de nuevo el catálogo. El backend exige servidor local, base y tabla explícitos y `expectedExpression`: `null` para una medida nueva, o la expresión revisada para una existente. Si esta cambió, devuelve `409 CONFLICT` y exige nueva revisión. No sustituye un destino inexistente por otro. Esta comparación optimista no constituye un bloqueo transaccional frente a editores externos.

El transporte serializa operaciones con identificadores y tiempos máximos. Un fallo después de enviar una escritura puede devolver `outcomeUnknown`; se debe consultar el estado del modelo antes de decidir cómo continuar. No hay repetición automática de escrituras. SSE comparte un sondeo sin solapes, envía resultados frescos y libera conexiones al cerrar la página.

La lectura PBIP admite un solo modelo semántico por selección: hasta 10 MB por archivo, 50 MB acumulados, 1.000 archivos de modelo, 10.000 entradas y 16 niveles de profundidad. Ambas vías de selección de carpeta usan las mismas reglas; seleccionar otra carpeta cancela el análisis anterior. Se extraen metadatos, no se evalúan medidas ni relaciones.

Desarrollo: Node.js 22 o superior, `npm ci`, `npm run typecheck`, `npm test` y `npm run test:browser`; `npm run check` ejecuta las tres comprobaciones. CI verifica Node 22/24 en Windows y Linux y regresiones de escritorio con Chromium. Las pruebas del bridge real que requieren Windows se omiten en Linux. Los tests PowerShell de escritura usan objetos simulados y los de navegador simulan la API: no modifican ni evalúan un modelo semántico real. DAX, relaciones y compatibilidad del visual HTML/SVG requieren comprobación en Power BI.

En 1.4.3, la sesión de documento tiene una revisión independiente de los cambios ordinarios. El guardado captura configuración, origen y revisión; publica el nuevo baseline y la identidad guardada sólo si sigue abierto ese documento. La continuación de un diálogo exige además su revisión y acción de navegación originales. Las recuperaciones heredadas mediante sessionStorage no se eliminan automáticamente: una igualdad de contenido no demuestra que la ventana sea su propietaria.

La cancelación de selección descarta lecturas antiguas. Tras enviar un POST, la operación conserva un destino inmutable y comunica siempre su resultado; ni revisión ni reintento se pueden dirigir a otro modelo. El cliente exige una respuesta de éxito completa para la medida y tabla enviadas. Los tipos de sesiones, aprobación, destino y error tienen comprobaciones de consumidores positivos y negativos.

Las copias decorativas tienen un contrato explícito sin propiedades de cálculo. Importación y sanitización retiran enlaces antiguos con avisos; DAX y simulación también los ignoran en configuraciones raw. El extractor TMDL acepta valores escalares entrecomillados y escapes dobles. Los conflictos circulares comparan medidas, no columnas, y las restricciones de puntos porcentuales se aplican únicamente a variaciones activas.

El diagnóstico de legibilidad compara fragmentos de texto renderizados y métricas de glifos en píxeles de tarjeta, con tolerancias para contactos entre líneas. Si no hay tarjeta individual visible, se mide una muestra temporal fuera del viewport y se retira inmediatamente. Los avisos no alteran geometría y no garantizan ausencia de colisiones con datos reales diferentes.

El zoom contextual separa ajuste automático y escala manual. Un contenedor acotado sin barras de desplazamiento permite ampliar y desplazar el informe por transformaciones; `panContext()` limita el desplazamiento a su borde. Esta navegación no añade historial ni modifica geometría o datos de la tarjeta. La edición de `measureName` desde el modal actualiza `title` en la misma transacción de historial.
