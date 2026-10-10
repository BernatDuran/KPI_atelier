# Cómo está construida KPI Atelier

## 1. Tecnología y estructura

Es una aplicación de una sola página con HTML, CSS y JavaScript nativo. Utiliza módulos ES (`.mjs`) y genera las tarjetas con HTML y SVG. No usa React, Vue, TypeScript, un bundler, un backend ni una base de datos. Node se utiliza para las pruebas y, en esta exportación, para servir los archivos localmente.

La interfaz se monta sobre `#app`, definido en `dist/index.html`. Ese HTML carga `styles.css` y el módulo `app.mjs`. Los iconos y gráficos se dibujan con SVG; no hay un paquete de imágenes que falte por descargar.

| Archivo | Responsabilidad |
| --- | --- |
| `dist/index.html` | Página inicial, contenedor de la app, diálogo modal y entrada de archivos. |
| `dist/app.mjs` | Estado del editor, construcción de pantallas, eventos de ratón/teclado, paneles, guardado, historial, modales y descargas. |
| `dist/model.mjs` | Configuración base `BASE`, 18 plantillas `TEMPLATES`, temas `THEMES`, límites, enumeraciones, saneamiento y validación. |
| `dist/cards.mjs` | Formato de números, datos de ejemplo, iconos generales y `cardHTML()`, el renderizador compartido. |
| `dist/elements.mjs` | Catálogo de 16 elementos, tamaños, visibilidad, desplazamiento, marcos y orden de capas. |
| `dist/layout.mjs` | Posiciones de las distribuciones, límites de tarjeta, congelación de geometría y redimensionado del lienzo. |
| `dist/charts.mjs` | Geometría y SVG de tendencias, curvas, áreas, degradados, puntos extremos y donut. |
| `dist/appearance.mjs` | Resolución de colores, opacidad, fondos y efectos de superficie. |
| `dist/guides.mjs` | Cálculo de guías, alineaciones y desbordamiento de los límites. |
| `dist/colors.mjs` | Paletas, conversión HEX/HSV y contraste. |
| `dist/icons.mjs` | Catálogo adicional de iconos y sus trazados SVG. |
| `dist/dax.mjs` | Generación de la medida DAX, referencias a medidas/calendario, formato y composición del HTML dinámico. |
| `dist/styles.css` | Apariencia y adaptación de la interfaz del editor. |
| `tests/core.test.mjs` | Pruebas de funciones y generación de HTML/DAX. |
| `tests/editor.test.mjs` | Pruebas de controles y guardado usando un DOM simulado. |
| `scripts/serve.mjs` | Servidor local añadido al ZIP, independiente de la app publicada. |

## 2. El objeto de configuración es la pieza central

En `app.mjs`, la variable `c` representa la tarjeta que se está editando. Contiene texto, datos de muestra, nombres de medidas, tipo de tarjeta, tema, dimensiones, opciones de gráficos y configuración de cada elemento.

`sanitizeConfig()` normaliza el objeto: valida enumeraciones, limita tamaños, controla colores y descarta claves ajenas al esquema. Si añades una propiedad nueva, revisa `BASE` y, cuando corresponda, `LIMITS` o `ENUMS`; de lo contrario, esa propiedad puede perderse al importar o editar.

`elements` guarda personalizaciones individuales: desplazamiento X/Y, ancho, marco de referencia, color, opacidad y visibilidad. `layerOrder` representa el orden de superposición. La plantilla ofrece un punto de partida; a partir de él se modifica la configuración.

## 3. Qué ocurre al editar un control

Los campos de la interfaz llevan atributos como `data-key`, `data-elprop` o `data-appearance`. Los manejadores delegados de `app.mjs` detectan el cambio, actualizan la configuración y la normalizan.

Antes de una operación relevante se guarda una copia en el historial. Los cambios continuos de ciertos controles se agrupan temporalmente para que Deshacer no tenga un paso por cada pequeño evento. Después se persiste el borrador y se vuelve a generar la tarjeta. El inspector conserva el estado de sus secciones, desplazamiento y foco en las actualizaciones compatibles.

Los niveles Esencial, Profesional y Avanzado muestran distintas cantidades de controles sobre el mismo objeto. No son tres motores de renderizado diferentes.

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

## 8. Guardado y protección de cambios

El estado se conserva en el navegador con claves como `kpi-atelier-draft`, `kpi-atelier-saved`, `kpi-atelier-themes` y `kpi-atelier-edit-state`. No hay un servicio remoto de diseños.

El borrador recuperable y el diseño guardado son conceptos distintos. `baseline` guarda la referencia limpia y `dirty()` detecta si la configuración actual difiere de ella. `requestNavigation()` ofrece guardar, descartar o seguir editando antes de sustituir el diseño o cambiar de pantalla.

`saveCurrent()` crea o actualiza la entrada de la colección. Si falla la escritura, conserva los cambios abiertos. El evento `beforeunload` pide al navegador que avise cuando quedan cambios pendientes.

## 9. Dónde empezar a modificarla

| Quieres cambiar… | Empieza por… |
| --- | --- |
| Un tema o una plantilla | `THEMES` y `TEMPLATES` en `model.mjs`. |
| La interfaz de un panel | `renderInspector()`, `elementInspector()` o `chartPanel()` en `app.mjs`. |
| Las posiciones iniciales | `presetFrames()` en `layout.mjs`. |
| Cómo se pinta una tarjeta | `cardHTML()` en `cards.mjs`. |
| Colores y efectos | `appearance.mjs`. |
| El aspecto de los gráficos | `charts.mjs` y la generación equivalente en `dax.mjs`. |
| El cálculo o formato exportado | `generateDAX()` y sus auxiliares en `dax.mjs`. |
| El diseño general de la aplicación | `styles.css`. |

Como primer ejercicio, duplica una plantilla en `TEMPLATES`, dale un `id` único y cambia el título y el tema. Después revisa su vista previa, exporta HTML y DAX y ejecuta las pruebas. La prueba de catálogo contiene un recuento explícito de plantillas; si amplías el catálogo, actualiza también esa expectativa.

## 10. Límites de esta copia

Es una exportación del código actual, no una reescritura ni una certificación de ausencia de errores. Las 45 pruebas automáticas pasan, pero no sustituyen la validación interactiva y visual en navegador ni la ejecución de la medida con un modelo real en Power BI. El acceso privado del sitio original y su infraestructura de publicación no forman parte del motor de la aplicación.
