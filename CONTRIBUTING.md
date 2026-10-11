# Guía de Contribución y Buenas Prácticas · KPI Atelier

Gracias por tu interés en contribuir a **KPI Atelier**. Para mantener la calidad del software, la arquitectura limpia y un historial de Git legible, seguimos estas directrices.

---

## 1. Arquitectura de Software y Principios

- **Vanilla ES Modules (Sin bundler ni build step)**: El código en `dist/` se ejecuta directamente en navegadores modernos y se sirve con Node.js estándar. No introduzcas bundlers invasivos ni dependencias externas pesadas innecesarias.
- **Privacidad y aislamiento**: la lectura de metadatos, el diseño y la generación DAX se realizan localmente. La aplicación no evalúa medidas del modelo; Power BI lo hace al utilizar la medida generada. No hay telemetría del modelo. La tipografía puede solicitar recursos de Google Fonts.
- **Módulos con responsabilidades concretas**: `app.mjs` coordina; estado, interfaz general, inspector, vínculos, estudio de color, conexión y escritura tienen módulos propios. Mantén las dependencias explícitas y evita añadir otra responsabilidad grande al coordinador. Consulta `ARQUITECTURA_ES.md`.
- **Frontera del backend**: conserva las comprobaciones de Host/origen, límites de solicitudes y destinos explícitos. Una escritura de resultado incierto nunca debe repetirse automáticamente. Los conflictos requieren refrescar y revisar el destino.
- **Pruebas Automatizadas Obligatorias**: Todo cambio en generadores DAX, esquemas JSON, parseo TMDL/TMSL o geometría de tarjetas debe incluir o actualizar pruebas en `tests/`.

---

## 2. Flujo de Trabajo en Git (Git Flow simplificado)

1. **Ramas Principales**:
   - `main`: Código en producción, siempre estable y probado. Cada versión desplegada se marca con un tag semántico (ej. `v1.4.0`).
   - `dev`: Rama de integración de este trabajo. Los cambios actuales se mantienen aquí; no se fusionan en `main` sin una decisión explícita.

2. **Ramas de Trabajo**:
   - Respeta la rama solicitada para la tarea. Si se autoriza una rama adicional, usa un nombre descriptivo y parte de `dev`; los agentes Codex utilizan el prefijo `codex/` por defecto.
   - No incluyas cambios ajenos ni promociones automáticamente una rama a producción.

---

## 3. Convención de Commits (Conventional Commits)

Utilizamos el estándar [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<alcance opcional>): <descripción concisa en imperativo>

[cuerpo opcional detallando el motivo del cambio]

[pie opcional: referencias a issues, breaking changes]
```

### Tipos comunes:
- `feat`: Nueva funcionalidad o capacidad para el usuario.
- `fix`: Corrección de un fallo o error.
- `docs`: Modificaciones en documentación o README.
- `style`: Formato, espacios en blanco (sin cambios funcionales).
- `refactor`: Refactorización de código sin alterar comportamiento.
- `perf`: Mejoras de rendimiento.
- `test`: Añadir o corregir pruebas unitarias.
- `chore`: Tareas de mantenimiento, configuración de dependencias o scripts auxiliares.
- `ci`: Modificaciones en pipelines de CI/CD (GitHub Actions).

**Ejemplo:**
```bash
feat(cards): add adaptive font scale for compact visual elements
fix(dax): resolve variable clash in YoY leap year calculations
test(pbip): add edge-case test for unquoted TMDL table names
```

---

## 4. Verificación y Calidad antes de Enviar Cambios

Utiliza Node.js 22 o superior. El runtime no necesita dependencias de producción, pero las herramientas de desarrollo sí requieren instalación:

```bash
npm ci
npm run typecheck
npm test
npm run test:browser
```

`npm run check` agrupa estas comprobaciones. Playwright utiliza Microsoft Edge en local y Chromium en CI; en CI se instala con `npx playwright install --with-deps chromium`. El servidor de pruebas ocupa el puerto 8098 y tiene almacenamiento separado del puerto habitual de la aplicación.

La CI ejecuta comprobación de tipos y tests con Node 22/24 en Windows y Linux, además de regresiones reales del editor en navegador. Las pruebas específicas de PowerShell se omiten cuando no están en Windows. Añade regresiones que reproduzcan la conducta pública, especialmente para eventos, historial, importación, contratos HTTP y escrituras inciertas; evita depender solo de un DOM simulado.

Los tests comprueban código y contratos, no ejecutan DAX ni evalúan relaciones en un modelo semántico real. Indica en la descripción del cambio qué se comprobó y qué requiere Power BI Desktop. Comprueba también `git diff --check` y que no se incluyan archivos temporales, trazas, secretos ni cambios fuera del alcance.
