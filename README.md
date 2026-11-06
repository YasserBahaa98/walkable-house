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
- Automatic detection of: drawing units (from wall thickness, so wrong unit headers don't matter), wall layers (by name, or geometrically by double-line pairs), separate floor plans drawn side by side, wall thickness, curved walls, doors (swing arcs and door blocks), windows (glazing lines and thin window blocks), passages, wide glass façades, short gaps left by walls drawn on other layers, room names from text labels, furniture blocks, straight and L-shaped stairs (stair blocks or evenly spaced treads, with UP/DOWN labels), and floor-to-floor alignment.
- Import dialog with a live preview: change units, wall layers, which plan becomes which level, floor height, furniture and reference-drawing options and see the result immediately.
- **Images** (PNG/JPG/WebP) as a scaled tracing underlay, with two-point calibration.
- **Projects** (`.walkhouse.json`) and **3D models** for custom furniture — `.glb`, a `.gltf` with its `.bin`/texture files, or a `.zip` — packed into the browser library.

**Edit (2D plan)**
- Tools: select/move, draw walls (chained, with angle/endpoint/wall/grid snapping and live length), doors, windows, room detection, stairs, measure, calibrate.
- Drag wall ends (connected walls follow), drag whole walls, curve walls into arcs, slide doors/windows along walls, rotate furniture with a handle, snap furniture flush against walls.
- Straight, L-shaped and U-shaped stairs with landings; flat, gable and hip roofs with pitch, overhang, ridge direction and covering.
- Inspector for every object with free-form length input (`240cm`, `8' 6"`, `1200 mm`…), metric or imperial units.
- Multiple levels, duplicate level, the level below shown as a ghost, reference drawing underlay with opacity.
- Undo/redo for everything (drags count as one step), autosave to IndexedDB.

**Experience (3D)**
- Orbit view showing the active level and those below, optional cutaway walls.
- First-person **walk mode** with collisions, doors you can walk through, and stairs (including landings) between levels. Mouse + keyboard (pointer lock), keyboard only (arrow keys turn), gamepad, or touch (drag to look, on-screen joystick).
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

### Hosted app

**Live: https://yasserbahaa98.github.io/walkable-house/**

`.github/workflows/deploy.yml` rebuilds the app and publishes it to the `gh-pages` branch on every push to
`main`; GitHub Pages serves that branch (Settings → Pages → Deploy from a branch → `gh-pages`). Forks get their
own copy at `https://<user>.github.io/walkable-house/` after enabling Pages the same way.

Any other static HTTPS host works too: run `npm run build` and upload `dist/`.

### Install it like an app

- **Windows / macOS / Linux (Chrome or Edge):** open the link and click the install icon in the address bar
  (or browser menu → *Install Walkable House*). It gets a Start-menu entry and its own window.
- **iPhone / iPad (Safari):** open the link, tap *Share* → *Add to Home Screen*. It opens full-screen from the
  home screen; walk with the on-screen joystick and drag to look around.
- **Android (Chrome):** menu → *Install app*.

### Production build

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
| Walk | **Walk** button, `2`, or double-click a room in the plan. `W A S D` to move, `←` `→` to turn, `Shift` to run; click the 3D view to look with the mouse; gamepads work too; `Esc` to leave |
| Roof | Level settings (Inspect tab, nothing selected); show it in orbit view with `T` |
| Curve a wall | Select it → **Curve…** |
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
  geometry/   walls & openings, rooms (grid flood fill), stairs, roofs, checks, transforms — pure, unit-tested
  importer/   CAD worker (LibreDWG / dxf-parser) and block flattening, then extraction steps:
              units, walls (pairing, openings, joints, gaps), stairs, furniture, build (alignment, project)
  view2d/     canvas plan editor and colour helpers
  view3d/     Three.js scene, level/roof/furniture builders, mesh merging, walk physics, glTF models
  ui/         application shell, file importer, shortcuts, panel and form fields, dialogs
tests/        Vitest suites and CAD/glTF fixtures
e2e/          Playwright specs (desktop and phone)
```

The store is the single source of truth: the plan, the 3D view and the panels subscribe to it and every edit
goes through `store.mutate()`, which records undo history and schedules autosave. Room shapes are never stored —
they are derived from the walls, so editing walls updates room floors and areas automatically.

### Performance notes

- Each level's static geometry and each piece of furniture is merged into one mesh per material, so a house
  renders in a few dozen draw calls. Picking maps hit triangles back to walls, openings, rooms and stairs.
- Furniture is rebuilt individually; moving an item only updates its transform.
- The 3D view renders on demand (only when something changed), and the plan redraws at most once per frame
  with cached paths for reference drawings and room floors.
- The CAD reader runs in a Web Worker and its 11 MB WebAssembly module loads only when a DWG is imported.
  three.js sits in its own chunk so app updates don't re-download it.

## Known limitations

- Plan recognition is heuristic. Clean architectural drawings (double-line walls on dedicated layers, door blocks or swing arcs, room labels) work best; anything missed can be fixed in the editor, and the Report tab lists rooms that are not enclosed.
- U-shaped stairs and winders are not detected automatically from drawings (straight and L-shaped are); set the shape in the stair inspector.
- Roofs cover the bounding rectangle of a level's walls, so L-shaped footprints get one roof over the whole rectangle.
- Curved walls are made of short straight segments (smooth at normal viewing distances).

## Tech

TypeScript · Vite · Three.js · LibreDWG (WebAssembly, via `@mlightcad/libredwg-web`) · dxf-parser · vite-plugin-pwa (Workbox) · Vitest · Playwright.
