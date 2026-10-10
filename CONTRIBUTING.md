# Guía de Contribución y Buenas Prácticas · KPI Atelier

Gracias por tu interés en contribuir a **KPI Atelier**. Para mantener la calidad del software, la arquitectura limpia y un historial de Git legible, seguimos estas directrices.

---

## 1. Arquitectura de Software y Principios

- **Vanilla ES Modules (Sin bundler ni build step)**: El código en `dist/` se ejecuta directamente en navegadores modernos y se sirve con Node.js estándar. No introduzcas bundlers invasivos ni dependencias externas pesadas innecesarias.
- **Privacidad y Aislamiento**: KPI Atelier no envía telemetría ni datos del modelo a servicios externos. Todo el cálculo de medidas DAX y generación de tarjetas SVG/HTML se realiza localmente.
- **Pruebas Automatizadas Obligatorias**: Todo cambio en generadores DAX, esquemas JSON, parseo TMDL/TMSL o geometría de tarjetas debe incluir o actualizar pruebas en `tests/`.

---

## 2. Flujo de Trabajo en Git (Git Flow simplificado)

1. **Ramas Principales**:
   - `main`: Código en producción, siempre estable y probado. Cada versión desplegada se marca con un tag semántico (ej. `v1.4.0`).
   - `develop`: Rama de integración donde convergen las nuevas funcionalidades antes de pasar a `main`.

2. **Ramas de Trabajo**:
   - Funcionalidades: `feature/nombre-descriptivo` (desde `develop`)
   - Correcciones de errores: `fix/descripcion-del-bug` (desde `develop` o `hotfix/` si es crítico sobre `main`)
   - Documentación o tareas de soporte: `docs/tema`, `chore/tarea`

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

Antes de hacer commit o abrir una Pull Request:

1. Ejecuta la suite de pruebas completa:
   ```bash
   node --test tests/*.test.mjs
   ```
2. Asegúrate de que los 73 tests (o más) pasen sin fallos.
3. Comprueba que no se hayan añadido archivos temporales, logs o claves secretas.
