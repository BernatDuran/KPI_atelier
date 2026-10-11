# Revisión de las mejoras de backend y frontend

Fecha: 12 de octubre de 2026. Rama: `dev`. Base: `d51b04e`.

Se han corregido los 20 puntos de backend y frontend cuya valoración anterior era inferior a 7,5. La revisión se limita a escritorio. No se ha rediseñado la aplicación, desactivado móvil ni incorporado un framework o dependencias de producción. Las dependencias nuevas sirven para comprobación de tipos y pruebas de navegador.

Las notas posteriores son una valoración técnica sobre el código y las comprobaciones descritas: **8/10 por punto** significa que el defecto identificado está resuelto, existe cobertura relevante y quedan límites explícitos. No constituye una certificación de seguridad, ausencia de errores o compatibilidad con todos los modelos de Power BI.

Las prioridades indican la urgencia que tenían las correcciones, ya aplicadas: **P1 alta** antes de uso habitual o escrituras; **P2 media** para fiabilidad y mantenimiento. Impactos: seguridad, integridad, exactitud, estabilidad, productividad, rendimiento y mantenibilidad.

## Backend

| ID · Punto | Antes | Después | Prioridad e impacto | Cambio y valoración | Evidencia principal |
| --- | ---: | ---: | --- | --- | --- |
| B1 · Frontera de seguridad local | 3 | **8** | P1 alta · Seguridad | Servidor en loopback; comprobación exacta de Host, puerto y origen; rechazo de origen nulo/externo; métodos y cuerpos acotados; CSP en la interfaz. Reduce exposición a peticiones desde otras páginas y DNS rebinding. | `scripts/serve.mjs`, `scripts/pbi_http.mjs`; pruebas HTTP reales de `tests/backend.test.mjs`. |
| B2 · Destino de escrituras | 3 | **8** | P1 alta · Integridad | Base y tabla explícitas, identidad estable del modelo y resolución exacta. Comparación de la expresión revisada antes de guardar; conflicto 409 si cambia. Se elimina la selección silenciosa de otro destino. | `scripts/pbi_connection.ps1`, `scripts/pbi_bridge.ps1`; guardas PowerShell con objetos simulados y escenarios de sobrescritura en navegador. |
| B3 · Transporte Node–PowerShell | 4 | **8** | P1 alta · Integridad y estabilidad | Solicitudes serializadas y correlacionadas, cola y esperas acotadas, salida de error drenada y cierre controlado. Una escritura de resultado incierto nunca se repite automáticamente. | `scripts/pbi_transport.mjs`; pruebas de timeout, cierre, identificador incorrecto y cancelación de cola. |
| B4 · Cálculos de elementos duplicados | 4 | **8** | P1 alta · Exactitud | Cada tendencia duplicada utiliza su calendario, período y serie. Los estados copiados generan texto y estado dinámicos, incluido BLANK. | `dist/dax.mjs`, `dist/cards.mjs`; pruebas de generación y cinco casos específicos en motor DAX. |
| B5 · Semántica temporal | 5 | **8** | P1 alta · Exactitud | Valor, objetivo y referencia comparten período. Período anterior exige continuidad y cobertura completa; YoY deduplica fechas desplazadas. Las reglas quedan documentadas. | `tests/core.test.mjs`; seis casos de objetivos, referencias, período anterior y bisiesto en motor real. |
| B6 · Contratos y errores | 5 | **8** | P1 alta · Integridad y estabilidad | Validación de tipos, límites, destino y configuración; errores diferenciados de validación, conflicto y resultado incierto. Cliente con espera acotada y catálogo validado. | `scripts/pbi_http.mjs`, `dist/schema.mjs`, `dist/pbi-client.mjs`; pruebas HTTP, esquema y cliente. |
| B7 · Lectura PBIP/TMDL/BIM | 6 | **8** | P2 media · Integridad y rendimiento | Importación de un único modelo, exclusión de metadatos ajenos a tablas, límites de tamaño/cantidad/profundidad y cancelación. Selector moderno y alternativo comparten parser. | `dist/pbip.mjs`; pruebas de carpetas ambiguas, presupuestos, cancelación y equivalencia entre selectores. |
| B8 · Arranque y herramienta externa | 6 | **8** | P2 media · Estabilidad | Comprobación de identidad, versión y protocolo del servidor; espera máxima y rechazo de servicio ajeno en el puerto. Argumentos de conexión codificados; proceso sin ventana adicional. | `scripts/launch.ps1`, `kpi-atelier.cmd`; pruebas de herramienta externa y endpoint de salud real. |
| B9 · Ciclo de vida de conexiones | 6 | **8** | P2 media · Estabilidad | SSE con primer descubrimiento fresco, sin sondeos superpuestos, límite de clientes y liberación de recursos. Cliente distingue reconexión breve de desconexión sostenida; conserva seguimiento al entrar desde herramienta externa. | `scripts/pbi_api.mjs`, `dist/live-connection.mjs`; pruebas SSE y escenario de desconexión en navegador. |

**Media del bloque corregido: 8/10.**

## Frontend

| ID · Punto | Antes | Después | Prioridad e impacto | Cambio y valoración | Evidencia principal |
| --- | ---: | ---: | --- | --- | --- |
| F1 · Inyección en confirmación de cambios | 3 | **8** | P1 alta · Seguridad | Títulos y nombres se escapan al insertarse en el diálogo. La navegación con cambios pendientes falla de forma conservadora si no hay diálogo disponible. | `dist/state.mjs`; prueba de título con comillas y carga XSS en navegador real. |
| F2 · Acciones y controles incompletos | 3 | **8** | P1 alta · Productividad | Conexión de iconos, paletas, HEX, temas, capas, restablecimiento y acciones asíncronas. Cambios relevantes participan en Deshacer y los fallos se comunican. | `dist/app.mjs`, `dist/studio-ui.mjs`, `dist/layer-events.mjs`; pruebas del editor y navegador. |
| F3 · Registro de colaboradores del editor | 4 | **8** | P1 alta · Estabilidad | Registro explícito de callbacks de historial, selección, controles, guías y geometría. El entorno de pruebas deja de proporcionar accidentalmente estos colaboradores como globales. | `dist/app.mjs`, `tests/editor.test.mjs`; comprobación de interacción real mediante Playwright. |
| F4 · Importación alternativa de carpetas | 4 | **8** | P2 media · Productividad e integridad | Entrada persistente de archivos conectada al mismo parser que el selector de carpetas. Cancelación de lecturas anteriores y actualización visible del catálogo. | `dist/model-import.mjs`, `dist/index.html`; escenario PBIP real desde archivos de prueba hasta exportación DAX. |
| F5 · Apertura de diseños y referencias | 4 | **8** | P1 alta · Integridad | Cargar un diseño conserva medidas, calendario y referencias de copias. El comportamiento de plantilla nueva es explícito. Abrir el diálogo de datos no modifica el documento. | `dist/state.mjs`, `dist/binding-ui.mjs`; pruebas de importación, recarga y edición de referencias. |
| F6 · Distribución y elementos duplicados | 4 | **8** | P1 alta · Integridad y productividad | Aplicar una distribución conserva contenido, referencias, copias y orden. Se actualizan controles activos y el historial permite recuperar la geometría anterior. | `dist/layout.mjs`; pruebas geométricas y escenario de distribución con copia configurada. |
| F7 · Protección frente a regresiones | 4 | **8** | P1 alta · Estabilidad | Ampliación de pruebas unitarias, integración HTTP/PowerShell y 14 escenarios de navegador. CI configurada para Node 22/24 y navegador; lockfile versionado. | `tests/`, `playwright.config.mjs`, `.github/workflows/ci.yml`; ejecución local completa satisfactoria. |
| F8 · Esquema y tipado | 5 | **8** | P1 alta · Integridad y mantenibilidad | Contrato de marcos coherente con el renderizador, límites y enteros validados, rechazo de JSON ajeno y normalización de cachés. Tipado del backend incluido en la comprobación. | `dist/schema.mjs`, `dist/types.d.ts`, `tsconfig.json`; pruebas de esquema y `tsc --noEmit`. No se afirma migración a TypeScript estricto. |
| F9 · Estado, historial y persistencia | 6 | **8** | P1 alta · Integridad y productividad | Agrupación de cambios por control, cancelación sin consumir historial, recuperación de selección válida, restablecimiento deshacible y conservación del modo avanzado. Tab mantiene la navegación habitual. | `dist/state.mjs`, `dist/editor-events.mjs`; pruebas ESM de estado y escenarios de edición/recarga en navegador. |
| F10 · Catálogos grandes | 6 | **8** | P2 media · Rendimiento | Preflight indexado; desplegables renderizan hasta 100 coincidencias buscando sobre el catálogo completo. Eliminadas listas nativas ocultas que duplicaban miles de opciones. | Pruebas con 10.000 medidas y 100 copias, y búsqueda de la última medida del catálogo. Sin umbral temporal dependiente del equipo. |
| F11 · Tamaño y responsabilidades | 7 | **8** | P2 media · Mantenibilidad | Extracción de interfaz de datos, estudio de color, escritura de medidas, conexión, importación, eventos y portapapeles en módulos específicos. Se mantiene la arquitectura ES nativa. | `dist/app.mjs`, `dist/modals.mjs` y módulos extraídos; tipos, pruebas de integración y navegador pasan tras la extracción. |

**Media del bloque corregido: 8/10.**

## Refactorización y alcance

Recuento de líneas no vacías, comparado con la base de la rama:

| Módulo | Antes | Después | Responsabilidades extraídas |
| --- | ---: | ---: | --- |
| `dist/app.mjs` | 1.531 | 726 | Estructura de pantallas, gestos/teclado, conexión, importación, escritura y eventos de capas. |
| `dist/modals.mjs` | 1.205 | 490 | Edición de datos y estudio de iconos/color. |
| `dist/canvas.mjs` | 930 | 843 | Portapapeles del editor. |
| `scripts/pbi_api.mjs` | 362 | 74 | Frontera HTTP y transporte PowerShell. |

No se fragmenta cada función en un archivo ni se añade una capa genérica de servicios. Se conservan módulos cohesionados de renderizado y cálculo; el objetivo de la división es aislar responsabilidades y permitir pruebas, no alcanzar un número arbitrario de líneas.

## Verificación final

| Comprobación | Resultado | Alcance |
| --- | --- | --- |
| `npm run typecheck` | Correcto | JavaScript/JSDoc y contratos del frontend y backend. |
| `npm test` | **178/178** | Unitarias e integración; cero fallos y cero omisiones en Windows. |
| `npm run test:browser` | **14/14** | Edge de escritorio, 1440 × 1000; interacciones y flujos de escritura con respuestas controladas. |
| Motor Power BI real | **29/29** | 18 plantillas y 11 escenarios de cálculo con datos sintéticos y consultas de solo lectura. |
| Backend contra Power BI real | Correcto | Descubrimiento y lectura del catálogo: 60 tablas, 23 medidas y 17 tablas con fechas detectadas. |
| `git diff --check` | Correcto | Sin errores de espacios en el diff. |

La ejecución DAX, sus consultas reproducibles y sus límites están en [DAX_ENGINE_VALIDATION.md](DAX_ENGINE_VALIDATION.md). El modelo conservó las mismas tablas y medidas y no recibió objetos persistentes de prueba.

La escritura TOM real no se ha ejecutado sobre el modelo del usuario: las guardas se prueban con objetos simulados y los flujos completos de confirmación, conflicto y pérdida de respuesta con API controlada. La comparación optimista evita guardar sobre una versión ya cambiada, pero no bloquea editores externos. La visualización del HTML dentro del visual concreto de Power BI, los calendarios fiscales particulares y los modelos de gran volumen requieren comprobación en su contexto. CI está configurada; no se presenta como una ejecución remota ya realizada.

## Resumen de valoración

| Bloque | Puntos corregidos | Media posterior |
| --- | ---: | ---: |
| Backend | 9 | **8/10** |
| Frontend | 11 | **8/10** |
| Total del alcance corregido | 20 | **8/10** |

El avance principal es la fiabilidad de los datos y del trabajo del usuario: destino explícito al escribir, cálculos temporales coherentes, diseños que conservan sus referencias y controles que actúan de forma predecible. Las mejoras de rendimiento y modularidad acompañan esas correcciones sin cambiar la experiencia visual existente. La nota se aplica al alcance corregido; no reevalúa diseño, UX general ni móvil.
