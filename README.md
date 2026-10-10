# KPI Atelier

[![CI](https://github.com/BernatDuran/KPI_atelier/actions/workflows/ci.yml/badge.svg)](https://github.com/BernatDuran/KPI_atelier/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Static, private Power BI KPI card designer. Vanilla ES modules, no build step and no backend data collection.


## Features

18 templates in six families; Essential, Professional and Advanced editing; live sample-data HTML/SVG preview; dashboard context; themes and granular formatting; DAX generation; named local designs; undo/redo; JSON import/export; sample HTML export; clipboard and DAX download.

Version 1.1 adds 16 individually editable visual elements with selection, pixel-stepped pointer dragging, keyboard nudging, corner resizing, width handles and synchronized element controls. The step is 1 or 5 px; Shift temporarily uses the alternate step. Positions are offsets from the responsive template layout. Font resizing changes the actual shared configuration property; it does not scale a screenshot. Hidden elements keep their layout slot; deleted elements are omitted. Layers and undo can recover either. Element data is validated and round-trips in the existing v1 JSON schema, HTML and DAX.

The icon picker has 47 inline SVG icons. The palette studio contains 10 presets plus browser-local named palettes, keyboard-accessible HSV controls, hex entry and contrast guidance. Inspector sections keep their open state, per-tab scroll and input focus across dynamic updates. These interactions still require browser QA in a supported environment.

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
- `dist/app.mjs`: editor and browser-local persistence
- `dist/styles.css`: responsive editor design

Run `npm test` (or `node --test tests/*.test.mjs`) for static generation and numerical edge-case checks. No installation is required for the app or core tests.

## Deliberate calculation semantics

The main metric evaluates the configured existing measure in current filter context. Temporal comparisons remove filters only from the configured calendar, then apply reference dates; all other dimension filters remain. YoY/MoM shift each selected day with EDATE and deduplicate the date set, including end-of-month clamping. Previous period uses a contiguous date range equal to the selected min/max span. For fiscal calendars or other business definitions, use a custom reference measure.

Trend values re-evaluate the measure per selected day/week/month bucket using KEEPFILTERS. The selected calendar must be related to the model and include reference periods. Missing buckets are skipped and remaining points are joined. Maximum 90 points. Preview data is illustrative and is never exported as model data.

Progress is actual divided by a positive target, with a 0–100% capped bar and uncapped label. Status thresholds use actual metric values. Percent metrics expect decimal ratios. Relative changes divide by the absolute reference and show a dash for a zero or missing reference.

## Verification boundary

Core and mocked-editor tests verify fixed geometry, limits, dirty-navigation/save failures, conditional controls, chart edge cases, generation, static DAX identifier/parenthesis consistency, formatting guards, thresholds and sanitization; they do not evaluate DAX. Power BI Desktop and HTML Content Secure rendering must be verified with the user's real model. Browser QA was unavailable in the build environment. No browser or Power BI validation is claimed.

References: https://html-content.com/docs/visual-editions , https://html-content.com/docs/accepted-tags , https://html-content.com/docs/sanitization , https://learn.microsoft.com/en-us/dax/format-function-dax .
