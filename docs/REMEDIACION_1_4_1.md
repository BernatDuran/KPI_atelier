# Mejoras de escritorio 1.4.1

Fecha: 12 de octubre de 2026. Alcance autorizado: puntos 1–9 de la auditoría; quedan fuera el punto 10 y las mejoras para móvil. Se conserva la arquitectura de módulos ES, Node y puente PowerShell/TOM.

Las notas siguientes son una valoración técnica posterior a los cambios y las pruebas, no una certificación externa. Se consideran corrección del defecto, coherencia del contrato, tratamiento de errores y cobertura de regresión.

| Punto | Resultado | Evidencia principal | Valoración /10 |
|---|---|---|---:|
| 1. Almacenamiento entre ventanas | Guardados y borrados bajo un bloqueo compartido; lectura actual dentro de la transacción; conflictos conservados como otra versión; borradores independientes y recuperables. Fallos de cuota conservan el editor. | Pruebas con dos páginas reales, bloqueo simultáneo, recargas, conflicto y borrado concurrente. | 8,5 |
| 2. Dependencias DAX de copias inactivas | Un único criterio de activación para generación, dependencias y revisión. Las copias excluidas por familia, interruptor o borrado no cambian el contexto del valor principal. | Regresión de contexto ejecutada en el motor DAX y tests de referencias emitidas. | 8,5 |
| 3. Números de duplicados | Confirmación al terminar la entrada, rechazo de vacío/no finito y cambio deshacible. | Edge: editar umbral, dejar vacío, deshacer y rehacer. | 8,5 |
| 4. Distribución | Versión 1.4.1 consistente, inventario explícito, hashes, ZIP extraído y verificado, registro de commit y modificaciones locales. | Pruebas de corrupción y archivos inesperados; verificación real del paquete. | 8,5 |
| 5. Contraste oscuro | Campos, ayudas, secciones, pestañas, modos y navegación usan colores del tema en vez de verdes fijos que anulaban el modo oscuro. | Revisión visual a 1440 × 1000 y contraste comprobado en seis tipos de controles de Edge con umbral mínimo 4,5:1. | 8,0 |
| 6. Simulación de copias | Comparación, objetivo, dirección, formato y estados vacío/cero/negativo se calculan por copia; se conserva la independencia en DAX. | Tests de muestras y consultas reales de objetivo/formato independiente. | 8,0 |
| 7. Contratos y TMDL | Granularidad preservada, enums/apariencias validados, límites comunes de copias, importación de hasta 512.000 bytes y extracción TMDL por ámbito/indentación y bloques de expresión. | Roundtrip JSON, límites, expresiones DAX/M con declaraciones falsas y metadatos anidados. | 8,0 |
| 8. Foco, accesibilidad y atajos | Foco/selección restaurados, pestañas con teclado y ARIA, autocompletado con opción activa anunciada; Ctrl+Y/Ctrl+Shift+Z y zoom documentados; tiradores permiten reducir tamaño. | Navegación y foco probados en Edge; regresiones del editor. | 8,0 |
| 9. Destino, exportación y diagnóstico | Tabla persistida y validada; tabla existente preservada; JSON/HTML independientes de preflight DAX; errores con código, referencia y detalle acotado. Guía distingue Secure/Regular y datos simulados/reales. | Pruebas de destino explícito/inexistente, exportaciones y diagnóstico limitado con secretos habituales ocultos. | 8,0 |

Media orientativa de estos nueve puntos: **8,2/10**. No se recalifican aquí todas las áreas de la auditoría original ni el punto 10.

## Validación

- `npm run typecheck`: correcto.
- `node --test tests/*.test.mjs`: 193 pruebas aprobadas.
- `npm run test:browser`: 23 pruebas de escritorio aprobadas en Microsoft Edge, con servidor local y API Power BI controlada. Incluye guardado simultáneo con Web Locks reales.
- 32 consultas DAX aprobadas en Power BI Desktop mediante MCP: 18 plantillas, los 11 escenarios anteriores y tres regresiones nuevas. Se generaron desde el código actual de `tests/helpers/dax-engine-fixtures.mjs` y se ejecutaron con `DEFINE TABLE`/`DEFINE MEASURE` acotados a cada consulta. No se usó `SaveChanges` ni se crearon medidas persistentes.
- La distribución se verifica por inventario completo, versión y SHA-256, incluida una extracción nueva del ZIP. La integridad de archivos no sustituye a las pruebas funcionales.

## Límites concretos

Las pruebas de escritura usan un modelo simulado; no se ha escrito en informes del usuario. Las consultas reales comprueban el cálculo con datos de prueba, no las relaciones ni las reglas de negocio de cada informe. La vista previa sigue usando muestras compartidas: una medida distinta no implica una consulta de sus datos reales.

El extractor TMDL obtiene metadatos de tablas, columnas y medidas respetando la estructura de expresiones; no es un compilador completo de TMDL. La validación visual final dentro de HTML Content Secure depende de la edición y versión instalada. No se ha realizado una certificación WCAG completa con lectores de pantalla; sí regresiones de teclado, foco, ARIA y contraste de los controles corregidos.

El guardado seguro requiere Web Locks. Si no están disponibles, el usuario recibe un error y puede exportar JSON. Los borradores recuperables no se eliminan automáticamente para evitar pérdida de trabajo: se pueden guardar o borrar desde Mis diseños. No hay sincronización entre equipos.

Referencias de la guía: [ediciones de HTML Content](https://html-content.com/docs/visual-editions) y [filtrado de Secure](https://html-content.com/docs/sanitization).
