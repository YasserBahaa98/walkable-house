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
- Tools: select/move, draw walls (chained, with angle/endpoint/wall/grid snapping and live length), doors, windows, rooms (click inside walls to make a room), stairs, measure, calibrate.
- Drag wall ends (connected walls follow), drag whole walls, curve walls into arcs, slide doors/windows along walls, rotate furniture with a handle, snap furniture flush against walls.
- Straight, L-shaped and U-shaped stairs with landings; flat, gable and hip roofs with pitch, overhang, ridge direction and covering.
- Inspector for every object with free-form length input (`240cm`, `8' 6"`, `1200 mm`…), metric or imperial units.
- Multiple levels, duplicate level, the level below shown as a ghost, reference drawing underlay with opacity.
- Undo/redo for everything (drags count as one step), autosave to IndexedDB.

**Furnish & decorate**
- **Furnish room**: fills a room with furniture that suits its name and size (bedroom, living room, kitchen, dining room, bathroom, WC, study, hall or landing; names in several languages). Beds and sofas go against walls facing into the room, the TV faces the sofa, chairs sit at tables and desks, plants go in corners, and nothing blocks doors, stairs or windows. Press again for another layout; **Furnish empty rooms** does a whole level.
- **Wall paint** per room (presets or any colour), painted only on the faces of the walls around that room. Floor finish per room.
- Decor: wall art, mirrors, curtains, vases with flowers, nightstands, side tables, rugs, plants and lamps.
- **Furniture styles**: arms or none, solid/slatted/upholstered backs, round-tapered, square, hairpin or sled legs, round or rectangular tops on four legs or a pedestal, and for storage the number of doors and drawers, open or closed shelves and bar, knob or push handles. Door and drawer counts follow the piece's size unless you set them.
- **Materials per part**: wood, painted, fabric, velvet, leather, metal, stone, glass or plastic for the whole piece and separately for legs, seat, top, fronts or frame (oak legs on a grey fabric chair).
- **Add from photo or link**: paste a product link (IKEA or any shop) and/or a picture or screenshot, and Claude describes the piece in the app's own vocabulary (type, measurements, colours, finishes, style options and per-part materials). You check the result, then it is built like any other piece and can be edited in the inspector. Uses your own Anthropic API key, kept only in your browser; each item costs a few cents. Measurements come from the listing when available and are marked as estimated otherwise.
- Sideboards and TV units, stools and bar stools, ottomans and poufs, bunk beds, chests of drawers and open shelving, plus a **labelled box** of the right size, colour and material for anything else.

**Experience (3D)**
- Orbit view showing the active level and those below, optional cutaway walls.
- First-person **walk mode** with collisions, doors you can walk through, and stairs (including landings) between levels. Mouse + keyboard (pointer lock), keyboard only (arrow keys turn), gamepad, or touch (drag to look, on-screen joystick).
- Photo-scanned PBR materials: wood, tile, marble, carpet and concrete floors, plaster walls, clay/slate/metal roofs, grass, and furniture in real wood grain, woven fabric with sheen, glazed ceramic and metal, all tinted by each item's colour.
- Ambient occlusion (soft shading in corners, under and between furniture), soft sun shadows and bounce light on ceilings.
- Hinged doors (single or double, adjustable opening), framed windows, slabs with stairwell holes, parametric furniture (beds, sofas, tables, kitchen, bath…), day/evening lighting with sun direction.
- **Quality**: *High* (1k textures, ambient occlusion, shadows, sharp on high-DPI screens) for computers, *Fast* (512 px textures, no AO or shadows) for phones and tablets, which start on Fast.

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
| Create a room | **Add room** (`R`), click inside an area enclosed by walls (doors count as walls) |
| Furnish / paint a room | Select the room → **Furnish & decorate** (Inspect tab) |
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

On a phone or tablet:

| Action | How |
| --- | --- |
| Pan / zoom the plan | drag with one finger / pinch. Neither selects nor moves anything |
| Select | tap |
| Move something | tap it to select it, then drag it (or its handles) |
| Draw walls, place doors and windows | tap; dragging pans instead |
| Orbit / zoom the 3D view | drag / pinch |
| Walk | drag to look around, use the on-screen joystick to move |

Tips for CAD files:
- If walls are missing, open the import dialog's **Wall layers** list and tick the layers that hold wall outlines.
- If the house is the wrong size, change **Drawing units**, or use **Calibrate scale** later (Inspect tab, with nothing selected).
- Rooms are created from text labels inside enclosed areas. The **Report** tab lists anything that needs fixing (for example a room left open because a wall was drawn on another layer); fix it with the wall tool.

## Configuration

There is no server-side configuration. User-facing settings (units, lighting, quality, snapping, grid, eye
height, etc.) live in the **View** tab and are saved per browser. Build-time options are in `vite.config.ts`
(PWA manifest and caching) and `playwright.config.ts` (end-to-end tests).

**Add from photo or link** calls the Anthropic API directly from the browser with the user's own key (asked for
the first time, optionally remembered in `localStorage`). It uses Claude Opus 5.5 with structured JSON output,
the web fetch tool for links, and server-side refusal fallback. The SDK loads only when the feature is used.

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
- Textures load on demand (only the materials in view), at 512 px on Fast, and are cached for offline use. Until a
  texture arrives, or offline before it was ever fetched, a small procedural stand-in is drawn instead.
- Ambient occlusion adds a normal/depth pass, roughly doubling draw calls, so it only runs on High.

## Known limitations

- Plan recognition is heuristic. Clean architectural drawings (double-line walls on dedicated layers, door blocks or swing arcs, room labels) work best; anything missed can be fixed in the editor, and the Report tab lists rooms that are not enclosed.
- U-shaped stairs and winders are not detected automatically from drawings (straight and L-shaped are); set the shape in the stair inspector.
- Roofs cover the bounding rectangle of a level's walls, so L-shaped footprints get one roof over the whole rectangle.
- Curved walls are made of short straight segments (smooth at normal viewing distances).

## Credits

Material textures in `public/textures` come from [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com),
both CC0 (public domain). `scripts/textures.py` downloads and converts them; run it again to change or add materials.

## Tech

TypeScript · Vite · Three.js · LibreDWG (WebAssembly, via `@mlightcad/libredwg-web`) · dxf-parser · vite-plugin-pwa (Workbox) · Vitest · Playwright.
