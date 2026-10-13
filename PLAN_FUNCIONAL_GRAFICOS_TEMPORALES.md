# Propuesta funcional: gráficos temporales y contexto del período

**Aplicación:** KPI Atelier · **Fecha:** 13 de octubre de 2026  
**Estado:** borrador para validación. Este documento no autoriza ni ejecuta cambios de código.  
**Alcance:** gráficos temporales de barras, líneas y áreas, originales y duplicados. El donut queda fuera de las reglas de agrupación temporal.

## 1. Qué es «Rendimiento del período» actualmente

Es el contenido predeterminado del elemento **Texto del pie**. Es texto informativo; no es una medida de rendimiento adicional ni interviene en el cálculo de las barras, del KPI, de la variación o del objetivo.

En la previsualización del editor aparece el texto configurado, inicialmente «Rendimiento del período». La demostración usa una serie de muestra, por lo que ese texto no confirma qué agrupación habrá al filtrar el informe real.

En el DAX exportado, cuando existe el gráfico temporal principal, el pie puede cambiar:

| Situación | Texto actual |
|---|---|
| El gráfico conserva el período y no hay discontinuidad | Texto configurado, inicialmente «Rendimiento del período» |
| El gráfico muestra solo la ventana más reciente | «Últimos N días», «Últimas N sem.» o «Últimos N meses» |
| Hay fechas discontinuas, sin que tenga prioridad un recorte | «Fechas discontinuas» |
| No se genera el gráfico temporal principal | Texto configurado |

El elemento **Período** es independiente y muestra las fechas del período del KPI, o un texto genérico si no se requiere calendario. Se puede mover, ocultar o eliminar cada elemento por separado.

**Limitación actual:** el pie ayuda a advertir determinados recortes, pero no dice normalmente si cada barra corresponde a un día, una semana o un mes. Además, su mensaje dinámico se calcula para el gráfico principal, no individualmente para todas sus copias.

**Propuesta:** usar etiquetas mínimas: **`[Diaria]`, `[Semanal]`, `[Mensual]`**. Conservar el texto personalizado y las fechas en el elemento Período.

## 2. Objetivo y principios

El usuario debe poder responder sin conocer el DAX:

1. ¿Qué período representa el KPI?
2. ¿Qué período representa el gráfico?
3. ¿Qué intervalo representa cada barra o punto?
4. ¿Hay períodos parciales, valores cero o períodos sin datos?

Principios funcionales:

- El gráfico cubre todo el filtro por defecto; cualquier ventana más corta debe ser una elección explícita.
- En automática, hasta 31 días siempre son diarios: adaptar barras y puntos al ancho, nunca cambiar a semanal por falta de espacio.
- La medida se evalúa para las fechas exactas de cada grupo. No se suman resultados diarios ni se promedian porcentajes para fabricar un grupo.
- Agrupar cambia el nivel temporal, no la definición de la medida ni sus demás filtros de negocio.
- La lectura debe funcionar en escritorio sin depender del hover. El hover puede ampliar información, pero no contener la única explicación relevante. El móvil queda fuera del alcance.
- Los cambios de zoom del editor no alteran la agrupación ni los datos.
- El usuario conserva el control sobre las agrupaciones manuales.
- Los límites técnicos se comunican; no se eliminan fechas silenciosamente para cumplirlos.

## 3. Alcance recomendado

| Primera fase | Segunda fase, sujeta a validación posterior |
|---|---|
| Todo el período filtrado en modo automático | Ventana explícita «Últimos N períodos» |
| Hasta 31 días siempre diarios; adaptar barras y puntos al ancho | Agrupación trimestral o anual para históricos muy largos |
| Contexto visible de agrupación y fechas | Detalle interactivo por barra, si el visual HTML utilizado lo permite |
| Indicador de períodos parciales | Calendarios fiscales o semanas con inicio configurable |
| Barras con base cero y tratamiento fiel de cero/BLANK | Preferencias adicionales de densidad para usuarios avanzados |
| Simulación de semana, mes y año en el editor | Simulación con datos reales del modelo |
| Compatibilidad y activación explícita para diseños existentes | Retirada del comportamiento anterior tras comprobar la migración |

No se propone rediseñar la aplicación, añadir scroll al gráfico ni cambiar las vinculaciones entre medidas, copias y calendario.

## 4. Comportamiento temporal de la primera fase

### 4.1. Período del KPI y período del gráfico

El conjunto de fechas de partida sigue siendo el que ya calcula la tarjeta a partir del calendario principal y los filtros del informe.

- Con filtro de calendario: se respetan las fechas efectivamente seleccionadas.
- Sin filtro de calendario: se conserva la regla actual de los últimos doce meses móviles hasta la última fecha con datos de la medida principal. No se introduce otra regla en esta fase.
- Con selección discontinua: solo se evalúan las fechas seleccionadas; no se rellenan los huecos con fechas excluidas.
- Las copias continúan utilizando ese mismo conjunto de fechas y el calendario principal. Conservan sus medidas según las vinculaciones existentes.

Un intervalo de doce meses móviles puede tocar trece meses de calendario, con el primero y el último parciales. No debe prometerse siempre «12 barras» en ese caso. Un año natural completo sí contiene doce grupos mensuales.

### 4.2. Agrupación automática

La duración determina la agrupación. El ancho adapta la representación y solo puede cambiar la agrupación automática en intervalos de más de 31 días. Pantalla y zoom no intervienen.

Reglas:

1. **1–31 días: diaria siempre**, tanto en barras como en líneas y áreas.
2. **32–161 días: semanal**; mensual si los grupos semanales resultan demasiado densos. Validar ese umbral visualmente.
3. **Más de 161 días: mensual.**

La densidad se calcula con todos los grupos, incluidos BLANK. Cambiar un filtro de negocio no cambia la agrupación por haber menos valores.

**01/01–31/01 = 31 posiciones diarias en cualquier ancho admitido.** Febrero y meses de 30 días conservan 28/29 y 30 posiciones, respectivamente. La misma regla cubre cualquier intervalo de hasta 31 días, aunque cruce de mes.

El ancho nunca elimina ni fusiona días. Ajuste visual:

- **Barras:** distribuir todas las posiciones dentro del área útil; estrechar barras y separaciones, admitiendo tamaños fraccionarios. Retirar el mínimo propuesto de 8 px por grupo. Reservar margen para que las barras extremas no salgan del gráfico.
- **Líneas/áreas:** conservar todos los valores en el trazado; acercar puntos, sin muestreo ni reducción de datos. Los marcadores son opcionales; si están activos, reducir su tamaño para evitar solapes.
- **Etiquetas:** reducir su cantidad, no la cantidad de datos. Priorizar inicio y fin.
- **Sin scroll ni desbordamiento.** En tamaños extremos, avisar de legibilidad sin cambiar la agrupación diaria.

Las copias siguen estas mismas reglas, independientemente de su ancho. Una agrupación manual semanal o mensual continúa teniendo prioridad sobre automática.

### 4.3. Agrupación manual

Las opciones **Diaria, Semanal y Mensual** mantienen exactamente la selección del usuario. No se sustituyen silenciosamente por otra granularidad.

Si el gráfico es demasiado estrecho, mostrar **`[Estrecho]`** y ofrecer ampliarlo. Hasta 31 días, automática tampoco reduce el detalle diario. Para intervalos mayores, se puede sugerir automática. Es un aviso visual, no un error de vinculación.

El período real del informe puede cambiar después de generar la medida. Por tanto, el DAX también debe prever una selección que supere el límite técnico, aunque la configuración fuera válida al crearla.

### 4.4. Límite técnico y períodos excesivos

El actual «máximo de puntos» deja de servir como recorte implícito en la política nueva. Se mantiene inicialmente un techo técnico de **90 grupos evaluados por gráfico**, sujeto a las pruebas de rendimiento.

- En automática, se intenta una agrupación permitida más amplia antes de alcanzar ese techo. No afecta a los intervalos de hasta 31 días, siempre diarios.
- Si incluso mensual supera el techo: **`[Período amplio]`**. Ayuda: «Acorta el filtro».
- En manual, si se supera el techo: **`[Límite: 90]`**, conservando la etiqueta de agrupación. Ayuda: «Acorta el filtro o cambia la agrupación».
- El KPI y las demás medidas válidas siguen mostrando el resultado de todo el período. El estado del gráfico debe ser inequívoco.
- No se bloquea la creación de una medida correctamente vinculada por un filtro futuro que todavía no se conoce.

La agrupación trimestral/anual sería una ampliación posterior para resolver históricos extensos sin mostrar este estado.

### 4.5. Ejemplos de aceptación

Supuestos: año 2026, calendario completo y medida con datos en todos los grupos. El resultado diario no depende del ancho.

| Filtro | Resultado automático esperado | Observación |
|---|---|---|
| 01/01–31/12 | 12 barras mensuales | Año natural completo |
| 01/01–31/01 | **31 barras o puntos diarios** | Siempre; estrechar barras o acercar puntos |
| 01/04–30/04 | 30 barras o puntos diarios | Siempre |
| 01/02–28/02 | 28 barras o puntos diarios | 29 en año bisiesto |
| 01/03–30/04 | 10 grupos semanales; 2 mensuales si resultan demasiado densos | En semanal, primera y última semana parciales |
| 02/03–08/03 | 7 barras diarias | Semana completa |
| Enero con diaria manual | 31 grupos diarios | No se elimina el 1–7 de enero |
| Un año con diaria manual | Estado de exceso de períodos | No se muestran solo los últimos 90 días |
| Más de 90 meses con automática | Estado de período demasiado amplio | Sin recorte silencioso |

BLANK conserva su posición como hueco: 31 posiciones no implica inventar 31 valores. Cero no es ausencia de datos.

## 5. Semanas, períodos parciales y datos ausentes

### 5.1. Límites de los grupos

- Día: fecha del calendario principal.
- Semana: lunes–domingo, conservando la regla actual.
- Mes: mes natural.
- El grupo solo incluye fechas seleccionadas; no incorpora días exteriores al filtro para completar una semana o un mes.

Se distingue entre **grupo parcial por selección de fechas** y **grupo con medida BLANK**. No son el mismo estado. Tampoco se afirma que los datos estén completos o actualizados: conocer la última carga requiere información que no está disponible actualmente.

### 5.2. Tratamiento visual

- Grupo parcial: marca o trama discreta y **`[Parcial]`**. No depender solo del color.
- Fechas seleccionadas discontinuas: **`[Discontinuo]`**, conservando la cronología. Una semana con solo lunes y viernes no representa una semana completa.
- BLANK: conservar el hueco temporal, sin inventar un cero ni desplazar los grupos posteriores para cerrar el hueco.
- Cero: situar el valor en la base cero. No dibujar una altura positiva mínima que sugiera una cantidad distinta de cero.
- Negativo: barra por debajo de cero, con referencia de cero visible.
- Sin resultados en ningún grupo: **`[Sin datos]`**.
- Línea/área: no conectar períodos sin datos como si se conociera su evolución; no rellenar áreas a través de huecos.

No se introduce normalización automática por número de días. Las medidas de ventas, medias, porcentajes, acumulados y saldos mantienen su propia definición DAX.

## 6. Contexto visible y función del pie

### 6.1. Pie automático

Propuesta para diseños nuevos:

| Situación | Pie o contexto esperado |
|---|---|
| Gráfico semanal, filtro completo | `[Semanal]`; las fechas van en Período |
| Gráfico diario | `[Diaria]` |
| Gráfico mensual con extremos parciales | `[Mensual] [Parcial]` |
| Selección discontinua | `[Semanal] [Discontinuo]`, adaptando la agrupación |
| Sin gráfico temporal | No asignar automáticamente una explicación temporal al donut o a otra composición |
| Gráfico en estado de exceso de períodos | Mensaje dentro de la zona del gráfico; el pie no debe prometer una evolución visible |

Una etiqueta de agrupación y solo los estados necesarios. Sin «Evolución», sin repetir fechas ni añadir el número de puntos al pie. Mantener posición y apariencia del elemento.

Los estados combinables se muestran juntos: `[Diaria] [Parcial] [Discontinuo]`. Si no hay gráfico válido, el estado sustituye a la agrupación: `[Sin datos]` o `[Período amplio]`. `[Límite: 90]` puede acompañar la agrupación manual.

La explicación de cada estado queda en la ayuda del editor; la etiqueta visible debe ser comprensible sin hover. No añadir textos largos permanentes.

### 6.2. Texto personalizado

El usuario puede mantener un pie personalizado. Nunca se sustituye permanentemente su contenido al migrar o cambiar de agrupación.

La información imprescindible sobre agrupación y cobertura debe aparecer en una pequeña leyenda asociada al gráfico si el pie personalizado no la contiene. Ocultar el pie no puede ocultar la única advertencia de un estado de datos.

El modo de texto y su contenido se guardan por separado, de forma que pasar a automático y volver a personalizado recupera el texto anterior.

### 6.3. Gráficos duplicados

Cada gráfico comparte las fechas principales y conserva su medida y agrupación configurada. En automática, hasta 31 días todos son diarios: el ancho solo adapta barras, puntos y etiquetas. Para intervalos mayores puede influir en la agrupación.

- Si todas las agrupaciones son iguales y cubren el mismo período, el pie puede ofrecer un contexto común.
- Si son distintas, cada gráfico necesita su leyenda de agrupación. El pie común no debe describir todas las copias como «semanales» cuando una sea mensual.
- Los pies duplicados existentes siguen siendo elementos de texto independientes. No se vinculan automáticamente a un gráfico por coincidir el número de copia.
- Un gráfico independiente sin valor principal gemelo mantiene su medida propia y sus comprobaciones estrictas actuales.
- No se añaden nuevos campos de medidas ni calendarios para resolver la agrupación.

### 6.4. Etiquetas y escala

En barras, la base cero es obligatoria en la política nueva. En líneas, se conserva la opción de incluir cero.

Fechas en orden cronológico; inicio y fin, con referencias intermedias solo si caben. No etiquetar todas las barras. Quitar etiquetas nunca quita barras ni puntos.

Las etiquetas, leyendas y marcas de parcialidad deben reservar espacio dentro de los límites del elemento. Si el gráfico es demasiado pequeño para el contexto necesario, el editor muestra una advertencia de legibilidad; no se solapan textos ni se introduce scroll.

## 7. Configuración y previsualización

### 7.1. Conectar datos del modelo

Renombrar el control a **«Agrupación»**. Opciones: Automática / Diaria / Semanal / Mensual. Ayuda:

> «Hasta 31 días: diaria. Siempre todo el período.»

La agrupación común se conserva y los overrides de copias existentes se respetan. Los overrides se explican junto al gráfico seleccionado en el inspector; no se añaden controles de medidas duplicados al modal.

Las fechas y la granularidad mantienen el hover con los elementos realmente afectados. No se amplía el hover a iconos, títulos decorativos o medidas sin relación directa.

### 7.2. Inspector del elemento

Para el ejemplo activo: **`[Diaria] · 31 grupos`** o **`[Semanal] · 10 grupos`**. El recuento va solo en el inspector; incluye las posiciones BLANK.

Añadir, en la configuración del pie, **«Contenido: automático / personalizado»**. El control de texto personalizado aparece solo cuando corresponde.

### 7.3. Simulaciones del editor

Ofrecer **Semana / Mes / Año / Serie personalizada**, en una zona secundaria del editor, con la indicación «Simulación».

- Usar una serie diaria determinista de ejemplo y medidas de demostración conocidas para agregarla.
- Simular la misma política de agrupación, los mismos límites temporales y el mismo tratamiento visual que el DAX.
- No presentar la simulación como ejecución de la medida real del usuario. Medias, acumulados y porcentajes arbitrarios no pueden reproducirse fielmente sin consultar el modelo.
- Conservar la serie de muestra existente mediante la opción personalizada, sin sobrescribirla al cambiar de simulación.
- Cambiar de simulación no cambia medidas, campos, calendario, filtros del informe ni el nombre del KPI.
- Probar la simulación en vista Tarjeta y En contexto; el zoom no cambia los grupos ni añade scroll al lienzo.

## 8. Compatibilidad y migración

La política actual debe identificarse como comportamiento anterior; la nueva, como política temporal nueva. La representación persistida concreta se decidirá en el diseño técnico.

Reglas recomendadas:

1. Nuevas tarjetas creadas desde plantillas: política nueva.
2. Diseños guardados, JSON importados y configuraciones recuperadas desde el modelo que no indiquen política: conservar la anterior inicialmente.
3. Acción explícita **«Actualizar gráficos»**. Resumen: «Todo el período · hasta 31 días, diaria · barras desde cero». El pie automático es opcional.
4. Conservar medidas, nombres, calendario, estilos, textos personalizados, geometría, orden de capas y asociaciones entre copias.
5. La actualización debe poder deshacerse antes de guardar y funcionar con guardado, duplicación e importación/exportación.
6. Reabrir un diseño existente no ejecuta cambios ni sobrescrituras en Power BI.
7. Las medidas ya creadas en Power BI mantienen su DAX hasta que el usuario las regenere y confirme la sobrescritura mediante el flujo actual.

No se cambia la versión del paquete ni se preparan commits de implementación durante la validación de este documento.

## 9. Comprobación antes de aplicar y exportaciones

Añadir al resumen existente el comportamiento temporal elegido y, cuando exista simulación, la agrupación resultante **del ejemplo**, sin afirmar que equivale al filtro real del informe.

- Los errores de medidas/campos inexistentes o vacíos siguen bloqueando crear/sobrescribir en Power BI.
- Las advertencias de legibilidad o densidad se distinguen de los errores de vinculación.
- Una agrupación técnicamente válida no se considera errónea porque un filtro futuro pueda superar el techo de grupos.
- Las exportaciones JSON conservan la política y los overrides. Las HTML identifican los datos de demostración. El DAX incorpora las reglas elegidas.
- Se mantiene el flujo vigente de confirmación de exportaciones con referencias incompletas y el bloqueo estricto de escrituras inválidas en Power BI.

## 10. Plan de ejecución después de la aprobación

| Paso | Trabajo | Resultado revisable |
|---|---|---|
| 1. Diseño funcional final | Validar ejemplos, anchos representativos, mensajes y migración | Tabla definitiva de comportamientos y boceto estático del contexto |
| 2. Contrato temporal | Definir período, agrupación, grupos parciales, huecos y techo | Casos de entrada/salida compartidos por simulación y DAX |
| 3. Integración | Actualizar renderizado, DAX, configuración, persistencia, copias, hover y resumen | Tras autorizar la implementación, integrar en main con pruebas y revisión |
| 4. Validación | Verificar cálculos en motor DAX y comportamiento en navegador | Evidencia de resultados y capturas en tamaños representativos |
| 5. Aceptación | Revisar con el usuario ejemplos, medidas especiales y diseños antiguos | Aprobación de publicación; promoción de ramas en una acción posterior |

La futura implementación previsiblemente afecta a `dist/dax.mjs`, `dist/charts.mjs`, `dist/cards.mjs`, `dist/model.mjs`, `dist/schema.mjs`, `dist/elements.mjs`, `dist/inspector.mjs`, `dist/binding-ui.mjs`, persistencia y preflight. Los nombres de propiedades nuevas y la división de responsabilidades pertenecen al diseño técnico posterior.

El ancho procede de la geometría del elemento. Hasta 31 días adapta la representación, no la agrupación. El DAX no depende del viewport ni del zoom.

## 11. Criterios de aceptación y pruebas

| Área | Criterio |
|---|---|
| Cobertura | En la política nueva, el gráfico no elimina silenciosamente fechas seleccionadas |
| Año natural | Año completo con ancho suficiente: doce grupos mensuales |
| Mes natural | Enero: 31 grupos diarios en automática y diaria manual, en todos los anchos admitidos; 30/28/29 para los demás meses |
| Gráfico estrecho | 31 barras más estrechas o 31 valores en línea/área; sin agrupación semanal, muestreo, scroll ni recorte |
| Agrupación semanal | Las semanas comienzan en lunes y no incorporan fechas exteriores al filtro |
| Meses móviles | Un período que toca trece meses conserva los trece grupos si no supera el techo |
| Límites | Probar 24/25, 31/32 y 161/162 días; 89/90/91 grupos; y anchos a ambos lados de cada umbral |
| Bisiesto | Febrero: 29 grupos diarios en automática y diaria manual |
| Fechas discontinuas | Los días excluidos nunca se añaden al cálculo; el usuario recibe contexto claro |
| Cero y BLANK | Cero no se dibuja como valor positivo; BLANK conserva el hueco y no se rellena |
| Medidas especiales | Ratios, medias, acumulados y saldos se evalúan sobre las fechas del grupo; no se reconstruyen a partir de totales diarios |
| Negativos | Barras a ambos lados de cero y proporciones correctas |
| Copias | Copias vinculadas e independientes usan su medida efectiva y el calendario compartido |
| Contexto | Etiquetas `[Diaria]`, `[Semanal]`, `[Mensual]`; estados mínimos; sin granularidad común falsa entre copias |
| Diseño | Ningún texto o marca invade otro elemento o sale de sus límites; no aparece scroll |
| Zoom | Misma configuración y filtro producen los mismos grupos con cualquier zoom; enero conserva 31 posiciones |
| Migración | Abrir un diseño antiguo no cambia su resultado; activar la política nueva es reversible |
| Exportación | Reimportar JSON conserva política y overrides; HTML y DAX expresan el mismo comportamiento temporal |
| Motor DAX | Validar grupos y valores mediante consultas de prueba sin escribir medidas de negocio |

Probar tarjetas de 200, 360 y 800 px, gráficos estrechos laterales y copias. Enero debe conservar 31 posiciones en barras, líneas y áreas; ajustar separaciones y marcadores al gráfico real. Repetir con BLANK, ceros y negativos.

La comprobación de legibilidad requiere revisión visual; las pruebas automáticas por sí solas no demuestran que las etiquetas se entiendan bien.

## 12. Decisiones para validar

| Decisión | Propuesta recomendada |
|---|---|
| Primera fase | Cobertura completa, agrupación adaptada, contexto visible, parcialidad y fidelidad de barras |
| Hasta 31 días, incluido enero completo | Diaria siempre en automática; conservar 31 barras/puntos cuando hay 31 valores |
| Una tarjeta muy estrecha | Estrechar barras y acercar puntos; hasta 31 días, nunca agrupar más |
| Agrupación manual | Respetarla; avisar o mostrar estado explícito si supera el techo |
| Pie de nuevas tarjetas | `[Diaria]` / `[Semanal]` / `[Mensual]`; texto personalizado disponible |
| Diseños existentes | Activación explícita, conservando el comportamiento previo al abrirlos |
| Ventana «Últimos N períodos» | Segunda fase; no convertir automáticamente el límite actual en esa elección |
| Histórico extremadamente largo | Estado explícito en primera fase; trimestre/año en segunda |

**Requisitos incorporados:** hasta 31 días siempre diarios en automática y etiquetas mínimas. **Pendiente:** resto del alcance, migración y ajustes visuales. Las pruebas no pueden sustituir el detalle diario por semanal.

## 13. Fundamento y fuentes

Los 31 días son un requisito del usuario. Los 161 días y 90 grupos son propuestas para KPI Atelier, no límites prescritos por las fuentes. Se retira el mínimo de 8 px por grupo.

- [Microsoft: recomendaciones de diseño de dashboards](https://learn.microsoft.com/en-us/power-bi/create-reports/service-dashboards-design-tips). Contexto, coherencia temporal y reducción de etiquetas innecesarias.
- [Microsoft: gráficos de columnas](https://learn.microsoft.com/en-nz/power-bi/visuals/power-bi-visualization-column-chart-format-settings). Ajuste de intervalos teniendo en cuenta datos y tamaño del visual; referencia conceptual, no implementación directa de nuestro HTML/SVG.
- [Nielsen Norman Group: visibilidad del estado del sistema](https://www.nngroup.com/articles/visibility-system-status/). Comunicar qué está mostrando el sistema y sus cambios.
- [Nielsen Norman Group: gráficos sin ruido visual](https://www.nngroup.com/articles/clutter-charts/). Mantener las etiquetas que explican los datos y eliminar decoración redundante.
- [Datawrapper: base cero en barras](https://www.datawrapper.de/academy/why-our-column-and-bar-charts-start-at-zero). Evitar distorsionar la percepción de magnitudes.
- [Datawrapper: datos ausentes en líneas](https://www.datawrapper.de/academy/patchy-data). No sugerir una evolución conocida donde faltan datos.

El diagnóstico del comportamiento actual procede de la revisión de `dist/dax.mjs`, `dist/cards.mjs`, `dist/model.mjs`, `dist/inspector.mjs`, `dist/binding-ui.mjs`, `dist/elements.mjs` y `dist/layout.mjs` en este repositorio.
