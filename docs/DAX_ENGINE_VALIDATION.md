# Validación DAX en motor Power BI

La revisión más reciente de los vínculos de copias, objetivos independientes y formatos técnicos se documenta en [Vínculos coherentes de las copias](VALIDACION_VINCULOS_COPIAS.md), con 49 consultas correctas de 49.

Registro histórico de la primera validación. Para el contrato actual de calendario compartido y copias, consulta [el cierre 1.4.3](REMEDIACION_1_4_3.md) y [sus 47 resultados con hashes](VALIDACION_DAX_1_4_3.json).

Fecha: 2026-10-12. Se ejecutó el DAX generado por la versión de desarrollo en el motor tabular de Power BI Desktop, conectado explícitamente al modelo AdventureWorksDW de prueba.

**Resultado: 29 consultas correctas de 29.** Cada consulta devolvió únicamente `pass = true`; no se guardaron cifras ni resultados de negocio.

## Método y seguridad de la validación

- Conexión y ejecución mediante Power BI Modeling MCP (`Connect`, operaciones de metadatos `List` y consultas `Execute`).
- Calendarios y métricas sintéticos mediante `DEFINE TABLE` y `DEFINE MEASURE`, con duración limitada a cada consulta.
- Cada caso evalúa tanto su condición de aceptación como el HTML completo generado, para que el motor también evalúe las ramas visuales usadas por la tarjeta.
- No se utilizaron operaciones de creación/actualización de objetos, `SaveChanges`, refresco ni escrituras de datos.
- Comprobación posterior: siguen existiendo las mismas **60 tablas y 23 medidas**; no apareció ningún objeto persistente con el prefijo de las pruebas. La conexión de validación se cerró al terminar.

## Cobertura ejecutada

| Casos | Cantidad | Resultado comprobado |
|---|---:|---|
| Catálogo completo | 18 | Las 18 plantillas generan HTML no vacío ejecutado por el motor, incluyendo comparativas, objetivos, semáforos, líneas, barras, área y donut. |
| Tendencia duplicada independiente | 1 | La tarjeta principal utiliza la ventana de 2025 y su copia la de 2022, con sus propias fechas de inicio/fin, extensión y puntos. |
| Objetivos y referencias temporales | 2 | Con filtro explícito y sin filtros: objetivo = dos veces el valor actual, referencia = la mitad y avance = 50 %. El caso sin filtros comprueba que las tres expresiones comparten los últimos doce meses, evitando mezclar el total histórico con el período actual. |
| Período anterior | 3 | Resultado numérico exacto con cobertura completa; BLANK cuando faltan fechas anteriores o la selección es discontinua. |
| Año anterior y bisiesto | 1 | El 28/29 de febrero se compara con el conjunto único desplazado del año anterior. |
| Semáforo duplicado | 4 | Estados favorable, alerta, desfavorable y BLANK, incluyendo el texto dinámico dentro del HTML exportado. |

Los tiempos observados por consulta estuvieron entre 31 y 985 ms. Son evidencia de esta ejecución; no constituyen un presupuesto de rendimiento ni una comparación entre máquinas.

## Reproducción

Las consultas se generan desde [tests/helpers/dax-engine-fixtures.mjs](../tests/helpers/dax-engine-fixtures.mjs), importando el generador de producción. El archivo no abre conexiones ni ejecuta consultas por sí mismo.

Ejemplo para obtener una consulta:

```powershell
node --input-type=module -e "import {engineQueries} from './tests/helpers/dax-engine-fixtures.mjs'; console.log(engineQueries.find(x => x.id === 'default-window-goal-reference').query);"
```

En una conexión de prueba explícita, ejecutar el texto mediante la operación DAX `Execute` y comprobar que la única fila devuelve `pass = true`. El modelo anfitrión debe contener la tabla `_Measures`; los datos utilizados por las comprobaciones se definen en la propia consulta. No convertir estas definiciones temporales en objetos persistentes.

## Límites de la evidencia

La ejecución demuestra compilación y evaluación real de los casos definidos. No certifica todas las relaciones, cálculos personalizados, calendarios fiscales o volúmenes de cualquier modelo de usuario. La presentación del HTML dentro de cada edición del visual de Power BI requiere su propia comprobación visual.
