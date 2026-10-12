# KPI Atelier

[![CI](https://github.com/BernatDuran/KPI_atelier/actions/workflows/ci.yml/badge.svg)](https://github.com/BernatDuran/KPI_atelier/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Desktop Power BI KPI card designer with a local Node/PowerShell bridge. Vanilla ES modules, no build step, no production npm dependencies and no model telemetry. Preview uses sample data; the bridge reads metadata and can write a reviewed DAX measure to Power BI Desktop.

## Run and develop

Use Node.js 22 or later. Run `npm start` and open [KPI Atelier locally](http://127.0.0.1:8080). Keep the same host and port to retain access to browser-local designs. Power BI integration additionally requires Windows, PowerShell, Power BI Desktop and the TOM assemblies located by `scripts/pbi_connection.ps1`.

Development tooling requires `npm ci`. Run `npm run typecheck`, `npm test` and `npm run test:browser`, or all three with `npm run check`. Local browser tests use installed Microsoft Edge; CI installs Chromium and checks Node 22/24 on Windows and Linux. Tests start a separate local server on port 8098. See [the quick start](INICIO_RAPIDO_ES.md) and [contribution guide](CONTRIBUTING.md).


## Features

Version 1.4.3 protects document identity during pending saves and preserves inherited window recovery drafts. Named designs and palettes use IndexedDB transactions with migration from localStorage; close older app windows before updating. Submitted Power BI writes report their original destination even after disconnecting or choosing another model; review and retry stay bound to that destination. Decorative copies cannot acquire unsupported metric dependencies. Import, TMDL scalar metadata, validation, stable notifications and desktop contrast have regression coverage. Text collisions are reviewed before HTML/DAX export; the desktop workbench fits effective viewports from 1024×640 and 1093×614. See [the implementation and validation record](docs/REMEDIACION_1_4_3.md).

## Verified source distribution

On Windows, run `npm run check` and then `npm run release`. This produces `releases/KPI-Atelier-v1.4.3/`, a matching ZIP and its SHA-256 sidecar. `package.json` is the version source; the script checks the lockfile, generates `EXPORTACION.json` and `SHA256SUMS.txt`, extracts the ZIP and verifies every file. `npm run release:verify` checks the workspace against its latest manifest. Regenerate after changing shipped files. Locally modified release directories are never silently overwritten. The manifest reports the Git commit and whether the checkout contains modifications; it does not claim uncommitted files are part of that commit.

The package excludes browser data, installed npm dependencies and machine-specific `.pbitool.json` registration. Run `scripts/install-pbitool.ps1` from the extracted directory to register that location. Old local packages under `releases/legacy/` are historical backups, not current distributions.

Template families; Essential and Advanced editing; sample-data HTML/SVG preview; dashboard context; themes and granular formatting; DAX generation; named local designs; undo/redo; JSON import/export; sample HTML export; clipboard and DAX download. Bind model references from a local PBIP folder or a connected Power BI Desktop report.

Copied charts, variations, progress and status indicators use their matching value copy. Without that value, each calculation exposes an explicit independent measure field; it never silently uses the principal measure. Every time-series chart shares the principal calendar and exact selected/default date window. Each numbered copy family has one configurable objective, shared by its goal label, progress, donut and target comparison. Explicitly empty value or objective bindings remain invalid. Binding, hover, review, preview and generated DAX use this same contract; imports explain replaced legacy bindings. Values and references retain their independent measures. Standalone numeric copies preserve their configured metric. The context preview uses labelled example visuals with consistent monthly and category totals, and its zoom controls remain centered across resolutions. Manual context zoom can grow beyond fit; drag or arrow keys move the viewport without scrollbars or document edits. Editing the result measure name in the binding modal also updates the visible KPI title in the same undo transaction.

Version 1.1 adds 16 individually editable visual elements with selection, pixel-stepped pointer dragging, keyboard nudging, corner resizing, width handles and synchronized element controls. The step is 1 or 5 px; Shift temporarily uses the alternate step. Positions are offsets from the responsive template layout. Font resizing changes the actual shared configuration property; it does not scale a screenshot. Hidden elements keep their layout slot; deleted elements are omitted. Layers and undo can recover either. Element data is validated and round-trips in the existing v1 JSON schema, HTML and DAX.

The icon picker contains inline SVG icons. The palette studio contains presets plus browser-local named palettes, keyboard-accessible HSV controls, hex entry and contrast guidance. Inspector sections keep their open state, per-tab scroll and input focus across dynamic updates. Desktop browser regressions exercise the actual module graph and event handlers.

Version 1.2 adds a per-element Appearance section with theme, semantic KPI, linked progress-label and custom HEX color sources. Every element supports opacity; delta/status/icon backgrounds and progress tracks have independent colors and opacity. Sparkline stroke, bars, dots and area follow their dedicated settings. Progress defaults to the theme accent and the label follows the bar. Reset Appearance preserves layout; Restore Element resets layout and appearance.

Surface presets include Classic, Glass, Aurora, Halo and Soft Relief, with effect intensity, optional color, glass opacity and blur. All styling is inline and is carried into HTML and DAX. Backdrop blur depends on the rendering host and content behind the card; no Power BI support guarantee is implied. Glass has a translucent color and reflection even without blur support.

Smart guides show card bounds, padding, centers and peer alignments during drag/resize and keyboard nudges. Crossing an edge leaves a red boundary and a distance readout. Guide geometry uses card pixels regardless of zoom, and does not override the chosen 1/5px movement step. The large onboarding banner is replaced with a compact Power BI help action.

Version 1.3 fixes moved-element reflow. The first real pointer, keyboard or X/Y displacement records its rendered frame in card pixels (accounting for zoom and border). An invisible, fixed-size slot preserves its original footprint; the actual element is rendered absolutely at card level. Font, width and height changes therefore cannot push the other elements. Legacy designs with offsets acquire frames on their first single-card render. Returning the offset to zero does not discard the frame; “Volver a composición automática” explicitly restores flow while retaining style. Unmoved elements retain automatic layout.

The Layers panel is ordered front to back. Drag handles, up/down buttons and Alt + Up/Down reorder it; the top item is in front. The shared HTML/DAX renderer applies global z-indices across layout groups and free elements. Selection no longer changes stacking. Hidden/deleted elements retain their place; unavailable family elements keep their order when switching types. Reordering preserves geometry, panel scroll, keyboard focus and undo history. Frames and order round-trip through the existing JSON schema. Preview and export use the same layout slots and positioning; browser/Power BI visual verification remains outstanding.

Version 1.4 replaces automatic flow with a fixed canvas. Every template accepts width 200–800 px and height 200–650 px; the card never grows when a visual is resized. All element frames are independent, including objects that have never been moved. Card resize freezes content geometry and clips overflow, with a layer-access warning in the editor. Clicking the card background or its toolbar button reveals width/height and east/south/corner handles. Dimensions commit on blur/Enter rather than clamping partial input. Legacy flow designs are measured on their first single-card preview and migrated to `geometryVersion: 2`; saved collections and imports remain compatible. The historical v1.1–v1.3 flow behavior above applies only before that migration.

Three explicit distributions (stacked, chart left, chart right) rearrange positions only when chosen. Applying one preserves content, colors, sizes, visibility and layer order; undo restores the prior geometry. Horizon, Side Story and Full Circle add horizontal trend and donut examples. Trend SVG uses coordinate dimensions matching its frame, smooth bounded cubic, straight or step paths, solid or fading gradient area, optional maximum/minimum labels, endpoint and subtle grids. Flat series show a single extreme label; tiny charts retain points but omit labels. The donut shows actual/positive target, caps the arc at 100% and keeps the uncapped percentage. It has an independent ring/track color and opacity. Graph settings are conditional and progressively disclosed.

Pending changes are compared with the opened/saved design, independently of the recoverable browser draft. Template changes, saved-design loads, imports and screen navigation offer Stay / Discard / Save and continue. A failed collection write keeps edits and navigation open. Saving an opened design updates its existing entry. Native beforeunload warns only for pending edits. Undo history is isolated per opened design. No server persistence or cross-device synchronization is implied.

## Files

- `dist/model.mjs`: configuration schema, templates and validation
- `dist/cards.mjs`: one shared HTML card renderer for sample preview and DAX
- `dist/dax.mjs`: native measure generator, safe quoting and date/series logic
- `dist/elements.mjs`: element metadata, layout validation and shared manipulation math
- `dist/appearance.mjs`: safe per-element color/alpha resolution and inline surface effects
- `dist/layout.mjs`: deterministic preset frames, fixed canvas limits and explicit layout changes
- `dist/charts.mjs`: shared SVG geometry, smooth paths, extrema, gradient and donut rendering
- `dist/guides.mjs`: zoom-independent alignment and overflow geometry
- `dist/colors.mjs`: palette schema, HSV conversion and contrast calculation
- `dist/icons.mjs`: categorized inline vector icon catalog
- `dist/app.mjs`: startup, explicit collaborator wiring and event orchestration
- `dist/shell-ui.mjs`, `dist/canvas.mjs`, `dist/inspector.mjs`: editor shell, canvas and contextual controls
- `dist/state.mjs`: configuration, history, selection and browser-local persistence
- `dist/binding-ui.mjs`, `dist/bindings.mjs`, `dist/studio-ui.mjs`: data bindings, icons and color studio
- `dist/schema.mjs`, `dist/preflight.mjs`: runtime contracts and measure review
- `dist/pbip.mjs`, `dist/model-import.mjs`: bounded, cancellable local model import
- `dist/pbi-client.mjs`, `dist/live-connection.mjs`: HTTP/SSE client and connection lifecycle
- `dist/measure-write.mjs`: fresh review, overwrite approval and single-attempt writes
- `scripts/serve.mjs`, `scripts/pbi_api.mjs`, `scripts/pbi_http.mjs`: local server, routes and HTTP security/validation
- `scripts/pbi_transport.mjs`: bounded serialized PowerShell IPC with correlated responses
- `scripts/pbi_bridge.ps1`, `scripts/pbi_connection.ps1`: TOM actions, discovery and exact target resolution
- `scripts/launch.ps1`, `kpi-atelier.cmd`: validated startup and External Tool arguments
- `dist/styles.css`, `dist/css/`: desktop editor styles

The app runtime and Node test files use standard platform APIs. Type checking and Playwright require the development dependencies installed by `npm ci`.

## Local bridge and model import

The API accepts the exact local HTTP origin and validates Host including the port. `Origin: null`, other browser origins and `file://` bridge access are rejected. `GET /api/health` reports app identity, version and protocol; the launcher verifies it before opening the app. Launcher inputs travel through `KPI_LAUNCH_SERVER` / `KPI_LAUNCH_DATABASE` environment variables and are URL-encoded.

Writes require an explicit local server, database and table. Before writing, the client refreshes the catalog and reviews references; the bridge compares `expectedExpression` with the current measure (`null` means it must not exist). A `409 CONFLICT` requires another review. Targets never silently fall back to another database or table. A connection loss or timeout after submission can mean the write succeeded: `outcomeUnknown` requires checking the model, never an automatic retry. This optimistic comparison does not lock out external editors.

PBIP import reads one semantic model locally, through either folder-selection API. It rejects ambiguous multi-model folders and enforces `PBIP_LIMITS`: 10 MB per file, 50 MB total, 1,000 model files, 10,000 entries and depth 16. A new selection cancels the previous scan. Import provides metadata, not semantic-model evaluation.

## Deliberate calculation semantics

When a card requires a calendar, it uses its explicit filters, or the last twelve rolling months ending at the last date with data when no calendar filter exists. Actual, measure-based target and custom reference evaluate over the same dates; constants remain unchanged. Other dimension filters remain. Cards that do not require a calendar keep the current filter context. User measures may implement their own filter behavior internally.

YoY/MoM shift selected days with EDATE, deduplicate dates and require complete calendar coverage of the reference dates. Previous period requires a continuous selection and a complete prior interval of equal span. Discontinuous selections are marked with an asterisk. For fiscal calendars or other business definitions, use appropriate business measures and verify their results in Power BI.

Trend values re-evaluate the measure per day/week/month bucket over its selected dates. Duplicated trends share the principal calendar and calculation period; each retains its display granularity. The calendar must have the intended model relationships and reference periods. Missing buckets are skipped and remaining points are joined within the configured chart window. Preview data is illustrative and is never exported as model data.

Progress is actual divided by a positive target, with a 0–100% capped bar and uncapped label. Status thresholds use actual metric values. Percent metrics expect decimal ratios. Relative changes divide by the absolute reference and show a dash for a zero or missing reference.

## Verification boundary

Version 1.4.3 also passed 47 read-only DAX queries in a real Power BI Desktop engine, covering all 18 templates, calculation boundaries and copy contracts. Results and query hashes are recorded in [the current validation record](docs/VALIDACION_DAX_1_4_3.json), with limits explained in [the implementation report](docs/REMEDIACION_1_4_3.md). The [original engine review](docs/DAX_ENGINE_VALIDATION.md) is historical. This manual validation is separate from the automated suite below.

Unit and integration tests cover generation, numeric boundaries, configuration, history, import and HTTP contracts. PowerShell write guards run against simulated model objects. Playwright exercises desktop interactions and write-review flows with controlled API responses. These tests neither write to a real semantic model nor evaluate DAX, relationships or business results. Verify the generated measure and rendering with the intended model and HTML visual in Power BI Desktop; visual edition and host behavior affect supported HTML/CSS.

References: [HTML visual editions](https://html-content.com/docs/visual-editions), [accepted tags](https://html-content.com/docs/accepted-tags), [sanitization](https://html-content.com/docs/sanitization), [DAX FORMAT](https://learn.microsoft.com/en-us/dax/format-function-dax).

Generated DAX places main and copied status thresholds in its editable configuration block. `__Cfg_Locale` formats visible numbers and dates; `__Svg_Locale = "en-US"` supplies the decimal point required by SVG coordinates and CSS widths. See [copy binding validation](docs/VALIDACION_VINCULOS_COPIAS.md).
