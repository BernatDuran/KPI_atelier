# Copias independientes, título y zoom contextual

Revisión del 2026-10-12 sobre el espacio de trabajo 1.4.3.

## Vínculos

Los gráficos, variaciones, avances y semáforos de copia N usan `value_copyN` cuando existe y no está eliminado. Sin ese valor, cada elemento expone su propio campo de medida en Conectar datos; un campo vacío permanece vacío y bloquea la aplicación en Power BI. Las etiquetas de objetivo solo requieren su objetivo, ya que no muestran un valor actual.

Una copia independiente conserva su medida al importar y al usar el portapapeles. Copiar un gráfico vinculado captura su medida efectiva. Crear después su valor asociado cambia el vínculo al valor de esa copia; eliminarlo vuelve a mostrar el campo independiente, pendiente de configurar si no tenía asignación. El hover, la vista previa, la revisión y el DAX aplican este mismo contrato. El calendario y el período de cálculo continúan compartidos.

Editar el nombre de la medida DAX resultante en el modal actualiza también el título visible del KPI. Ambos cambios forman una única transacción de historial; Deshacer los recupera juntos. Elegir otra medida de negocio conserva el título personalizado.

## Navegación

La barra de tarjetas dice «Elige tu tarjeta» y mantiene el contador 01—N en una línea. En contexto, el ajuste automático y el zoom manual son independientes. + y − cambian la escala hasta el 200 %; arrastrar el informe ampliado o usar las flechas con el lienzo enfocado permite recorrerlo sin barras de desplazamiento. Ajustar vista / Ctrl+1 vuelve al informe completo; Ctrl+0 aplica el 100 %. El informe conserva sus límites y márgenes internos, y esta navegación no modifica la tarjeta ni su historial.

## Validación

- Tipos y 239 pruebas unitarias correctos.
- 70 pruebas de navegador correctas, incluyendo nombre/título, Deshacer, medidas independientes, hover, DAX, zoom, arrastre, ajuste, ausencia de scroll y contador en una línea a 1024 × 640.
- Cinco consultas correctas en el motor de Power BI Desktop del modelo de prueba AventureWorksDW: medidas explícitas de copias sin valor asociado, objetivo independiente, datos vacíos, color vinculado y compatibilidad con copias que sí tienen valor asociado.
- Exclusivamente consultas con `DEFINE TABLE` y `DEFINE MEASURE`; no se guardaron objetos en el modelo. [Resultados y hashes](VALIDACION_COPIAS_INDEPENDIENTES.json).

La validación de 49 consultas de [la revisión anterior](VALIDACION_VINCULOS_COPIAS.md) es un registro histórico. Los casos actuales se generan desde `tests/helpers/dax-engine-fixtures.mjs`.
