# Walkable House

Turn house plans into an editable 3D home you can walk through — right in the browser, fully offline.

Drop in a **DWG** or **DXF** drawing (or trace over a photo of a plan) and Walkable House detects
walls, doors, windows, rooms, stairs and furniture, stacks the floors, and lets you walk from room
to room and up the stairs in first person. Everything stays editable: move walls, swap floor finishes,
rearrange furniture and compare layouts, with a live room schedule and design checks.

It is a Progressive Web App: install it from the browser menu to use it like a desktop app on Windows,
macOS, Linux, tablets and phones. Your work is saved locally; nothing is uploaded anywhere.

## Features

**Import**
- **DWG** (AutoCAD R13 and later; verified with AutoCAD 2018 files) via LibreDWG compiled to WebAssembly, and **DXF** via dxf-parser — parsed in a background worker.
- Automatic detection of: drawing units, wall layers (by name, or geometrically by double-line pairs), separate floor plans drawn side by side, wall thickness, doors (swing arcs and door blocks), windows (glazing lines and thin window blocks), passages, wide glass façades, room names from text labels, furniture blocks, stairs (stair blocks or evenly spaced treads, with UP/DOWN labels), and floor-to-floor alignment.
- Import dialog with a live preview: change units, wall layers, which plan becomes which level, floor height, furniture and reference-drawing options and see the result immediately.
- **Images** (PNG/JPG/WebP) as a scaled tracing underlay, with two-point calibration.
- **Projects** (`.walkhouse.json`) and **3D models** (`.glb` / self-contained `.gltf`) for custom furniture, stored in the browser library.

**Edit (2D plan)**
- Tools: select/move, draw walls (chained, with angle/endpoint/wall/grid snapping and live length), doors, windows, room detection, stairs, measure, calibrate.
- Drag wall ends (connected walls follow), drag whole walls, slide doors/windows along walls, rotate furniture with a handle, snap furniture flush against walls.
- Inspector for every object with free-form length input (`240cm`, `8' 6"`, `1200 mm`…), metric or imperial units.
- Multiple levels, duplicate level, the level below shown as a ghost, reference drawing underlay with opacity.
- Undo/redo for everything (drags count as one step), autosave to IndexedDB.

**Experience (3D)**
- Orbit view showing the active level and those below, optional cutaway walls.
- First-person **walk mode** with collisions, doors you can walk through, and stairs between levels. Mouse + keyboard (pointer lock) or touch (drag to look, on-screen joystick).
- Textured floors per room, hinged doors (single or double, adjustable opening), framed windows, slabs with stairwell holes, parametric furniture (beds, sofas, tables, kitchen, bath…), day/evening lighting with sun direction, shadows.

**Check & share**
- Report: room schedule with areas per level, totals, wall length, door/window/furniture counts, CSV export.
- Design checks: overlapping furniture, furniture through walls, blocked doors and stairs, rooms not enclosed, overlapping openings — click an issue to jump to it.
- Furniture **layouts**: save alternatives and switch between them to compare.
- Export project file, **GLB** (open in Blender, SketchUp, Unreal, Unity…), 3D screenshot, plan image.

## Getting started

Prerequisites: **Node.js 20+** and npm.

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). The first run offers a demo house, an import, or an empty project.

### Production build / install as an app

```bash
npm run build
npm run preview
```

`dist/` is a static site: host it anywhere (GitHub Pages, Netlify, any web server). Open it in Chrome or Edge
and choose **Install** from the address bar or browser menu to get a desktop app that works offline. The app
shell is precached on first load; the CAD reader (~11 MB WebAssembly) is downloaded and cached the first time
you import a DWG.

## Usage

| Action | How |
| --- | --- |
| Import a plan | **Import** in the top bar, `Ctrl+O`, or drop a file anywhere |
| Draw walls | `W`, click corners, double-click / `Enter` / right-click to finish |
| Doors, windows | `D` / `N`, click a wall |
| Create a room | `R`, click inside an area enclosed by walls (doors count as walls) |
| Stairs | `S`, click; stairs lead to the level above |
| Measure | `M`, drag |
| Move / rotate furniture | drag; rotate handle, `Q` / `E` (`Shift` = 90°), arrow keys to nudge |
| Walk | **Walk** button, `2`, or double-click a room in the plan. Click the 3D view, then `W A S D`, `Shift` to run, `Esc` to release |
| Switch level | level tabs, `PageUp` / `PageDown` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Save a project file | **Export → Project file** or `Ctrl+S` |
| All shortcuts | `?` |

Tips for CAD files:
- If walls are missing, open the import dialog's **Wall layers** list and tick the layers that hold wall outlines.
- If the house is the wrong size, change **Drawing units**, or use **Calibrate scale** later (Inspect tab, with nothing selected).
- Rooms are created from text labels inside enclosed areas. The **Report** tab lists anything that needs fixing (for example a room left open because a wall was drawn on another layer); fix it with the wall tool.

## Configuration

There is no server-side configuration. User-facing settings (units, lighting, quality, snapping, grid, eye
height, etc.) live in the **View** tab and are saved per browser. Build-time options are in `vite.config.ts`
(PWA manifest and caching) and `playwright.config.ts` (end-to-end tests).

## Development

```bash
npm run typecheck   # TypeScript, strict
npm run lint        # ESLint
npm test            # Vitest unit + integration tests
npm run e2e         # Playwright end-to-end tests (builds and serves the app)
npm run check       # typecheck + lint + test + build
```

The end-to-end tests need a Chromium for Playwright: `npx playwright install chromium` (or set
`PW_CHROMIUM_PATH` to an existing Chromium binary). To also test DWG import with your own drawing:
`SAMPLE_DWG=/path/to/plan.dwg npm test`.

### Project structure

```
src/
  model/      domain types, store (undo/redo, layouts), validation, units, catalog, persistence
  geometry/   walls & openings, room detection (grid flood fill), stairs, design checks — pure, unit-tested
  importer/   CAD worker (LibreDWG / dxf-parser), block flattening, plan extraction heuristics
  view2d/     canvas plan editor
  view3d/     Three.js scene, procedural materials, parametric furniture, walk physics, glTF models
  ui/         application shell, panels, dialogs, import dialog
tests/        Vitest suites and a DXF fixture
e2e/          Playwright specs (desktop and phone)
```

The store is the single source of truth: the plan, the 3D view and the panels subscribe to it and every edit
goes through `store.mutate()`, which records undo history and schedules autosave. Room shapes are never stored —
they are derived from the walls, so editing walls updates room floors and areas automatically.

## Known limitations

- Plan recognition is heuristic. Clean architectural drawings (double-line walls on dedicated layers, door blocks or swing arcs, room labels) work best; anything missed can be fixed in the editor.
- Stairs are modelled as straight flights; L- and U-shaped stairs import as their straight footprint.
- Curved walls are imported as straight segments; walls are vertical extrusions (no sloped roofs yet).
- Custom glTF models must be self-contained (`.glb` or `.gltf` with embedded data).
- Pointer-lock walking needs a mouse; on touch devices use the joystick and drag to look.

## Tech

TypeScript · Vite · Three.js · LibreDWG (WebAssembly, via `@mlightcad/libredwg-web`) · dxf-parser · vite-plugin-pwa (Workbox) · Vitest · Playwright.
