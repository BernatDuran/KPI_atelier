# Vínculos coherentes de las copias

Fecha: 2026-10-12. Registro de la revisión anterior sobre 1.4.3. El contrato posterior para copias sin valor asociado se documenta en [Copias independientes y zoom](COPIAS_INDEPENDIENTES_Y_ZOOM.md).

Cada gráfico y variación de copia N toma la medida de `value_copyN`, o la principal si ese valor no existe o está eliminado. Un valor asociado vacío permanece vacío y bloquea la aplicación en Power BI. Las series comparten el conjunto exacto de fechas principal; conservan sus opciones de presentación y granularidad.

Cada grupo de copia N puede tener un objetivo distinto al principal. Un único campo alimenta su etiqueta, barra, porcentaje, anillo y comparativa de objetivo. Se conserva la asignación al eliminar su elemento propietario. Borrar ese campo produce un error, sin sustituirlo por el objetivo principal. Importación, portapapeles, vista previa, hover, revisión y DAX usan estas mismas reglas.

El destino abre su menú al pulsar el nombre, la etiqueta o el chevrón. Pulsar de nuevo el nombre mantiene el menú abierto; el chevrón lo alterna y pulsar fuera lo cierra. Al sobrescribir, el campo es de solo lectura y el menú muestra la tabla actual, que conserva la medida existente.

La comprobación reduce ligeramente el espaciado de secciones y filas. Los umbrales de semáforos originales y duplicados se declaran en el bloque editable superior del DAX. Los formatos visibles usan `__Cfg_Locale`; las coordenadas SVG y anchuras CSS usan `__Svg_Locale = "en-US"` para conservar el punto decimal técnico. La [documentación de FORMAT](https://learn.microsoft.com/es-es/dax/format-function-dax) describe el efecto del argumento de configuración regional sobre el separador decimal.

## Validación

- Comprobación completa: tipos, 237 pruebas unitarias y 67 pruebas de navegador.
- Pruebas adicionales del destino al crear y sobrescribir, junto con la protección de la tabla original.
- 49 consultas correctas de 49 en Power BI Desktop, modelo de prueba AventureWorksDW. Incluyen las 18 plantillas, objetivos independientes por copia, medidas y fechas asociadas, formatos regionales, umbrales, datos vacíos y comparativas temporales.
- Las consultas usan exclusivamente `DEFINE TABLE` y `DEFINE MEASURE` dentro de la consulta; no crean ni sobrescriben objetos persistentes. La conexión de validación se cerró al terminar.
- [Resultados y hashes de las consultas](VALIDACION_VINCULOS_COPIAS.json). Los hashes corresponden al generador y a los casos de `tests/helpers/dax-engine-fixtures.mjs` de esta revisión.

La ejecución comprueba el generador con datos sintéticos. Las relaciones y las expresiones de negocio de cada informe siguen determinando sus resultados reales.
