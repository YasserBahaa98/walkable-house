import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Level, Selection } from '../model/types';
import type { ChangeKind, Store } from '../model/store';
import { roomRegions } from '../geometry/rooms';
import { levelBounds } from '../geometry/walls';
import { boundsValid } from '../geometry/math';
import { buildItem, buildLevel, type Pickable, stairHole } from './levelMesh';
import { groundMaterial } from './materials';
import type { ModelLibrary } from './models';
import { buildWalkWorld, step, type WalkWorld, type Walker } from './walk';

export interface Pose { x: number; z: number; dirX: number; dirZ: number; levelId: string; walking: boolean }

interface LevelView {
  group: THREE.Group;
  staticKey: string;
  staticGroup: THREE.Group | null;
  items: Map<string, { key: string; group: THREE.Group }>;
}

const WALK_SPEED = 1.5;
const RUN_SPEED = 3.2;

export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private look: PointerLockControls;
  private house = new THREE.Group();
  private levels = new Map<string, LevelView>();
  private lights = { hemi: new THREE.HemisphereLight(), sun: new THREE.DirectionalLight(), rooms: new THREE.Group() };
  private ground: THREE.Mesh;
  private outline: THREE.LineSegments | null = null;
  private walker: Walker | null = null;
  private world: WalkWorld | null = null;
  private keys = new Set<string>();
  private joystick = { x: 0, y: 0 };
  private dirty = true;
  private lastTime = performance.now();
  private savedOrbit: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private resizeObs: ResizeObserver;
  private disposers: (() => void)[] = [];
  private hint: HTMLElement;
  private touchLook: { id: number; x: number; y: number } | null = null;
  onPose: (p: Pose) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private host: HTMLElement, private store: Store, private models: ModelLibrary) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'viewport-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '3D view of the house. Drag to orbit, scroll to zoom, double-click a floor to walk there.');
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 600);
    this.camera.position.set(14, 14, 18);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(150, 48), groundMaterial());
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.21;
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground, this.house, this.lights.hemi, this.lights.sun, this.lights.sun.target, this.lights.rooms);

    const sun = this.lights.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 120;
    this.orbit.addEventListener('change', () => { this.dirty = true; });

    this.look = new PointerLockControls(this.camera, this.renderer.domElement);
    this.look.pointerSpeed = 0.8;
    this.look.addEventListener('lock', () => { this.hint.hidden = true; this.onLockChange(true); });
    this.look.addEventListener('unlock', () => { this.updateHint(); this.onLockChange(false); });
    this.look.addEventListener('change', () => { this.dirty = true; });

    this.hint = document.createElement('div');
    this.hint.className = 'walk-hint';
    this.hint.hidden = true;
    host.appendChild(this.hint);
    this.buildJoystick();

    this.bindInput();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();

    models.onLoaded = () => { this.levels.forEach((lv) => lv.items.forEach((v) => { v.key = ''; })); this.sync(new Set(['project'])); };
    this.disposers.push(store.subscribe((k) => this.sync(k)));
    this.sync(new Set(['project', 'view', 'level', 'selection']));
    this.frame();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ------------------------------------------------------------ public API
  /** Fit the camera to the active level (orbit mode). */
  frame() {
    const b = levelBounds(this.store.level);
    if (!boundsValid(b)) {
      this.orbit.target.set(0, this.store.level.elevation, 0);
      this.camera.position.set(10, this.store.level.elevation + 10, 12);
    } else {
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 4);
      const y = this.store.level.elevation;
      this.orbit.target.set(cx, y + 1, cz);
      this.camera.position.set(cx + size * 0.75, y + size * 0.95, cz + size * 1.05);
    }
    this.orbit.update();
    this.dirty = true;
  }

  /** Enter walk mode at a plan position (defaults to the middle of the largest room). */
  startWalk(at?: { x: number; z: number; levelId?: string }) {
    if (at?.levelId) this.store.setLevel(at.levelId);
    const level = this.store.level;
    const spot = at ?? this.defaultSpawn(level);
    this.walker = { x: spot.x, z: spot.z, y: level.elevation };
    if (this.store.view.mode !== 'walk') {
      this.store.setView({ mode: 'walk' });
    } else {
      this.applyMode();
    }
  }

  teleport(x: number, z: number) {
    const level = this.store.level;
    this.walker = { x, z, y: level.elevation };
    this.dirty = true;
    this.emitPose();
  }

  lockPointer() {
    if (this.store.view.mode === 'walk' && matchMedia('(pointer: fine)').matches) this.look.lock();
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  async exportGLB(): Promise<Blob> {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const vis = [...this.levels.values()].map((lv) => lv.group.visible);
    this.levels.forEach((lv) => { lv.group.visible = true; });
    this.outline?.removeFromParent();
    try {
      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(this.house, { binary: true, onlyVisible: true });
      return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
    } finally {
      [...this.levels.values()].forEach((lv, i) => { lv.group.visible = vis[i]; });
      this.updateOutline();
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.disposers.forEach((d) => d());
    this.resizeObs.disconnect();
    this.orbit.dispose();
    this.look.dispose();
    this.renderer.dispose();
  }

  // ----------------------------------------------------------- sync state
  private sync(kinds: Set<ChangeKind>) {
    const v = this.store.view;
    if (kinds.has('view') || kinds.has('project')) {
      this.renderer.shadowMap.enabled = v.quality === 'high';
      this.renderer.setPixelRatio(v.quality === 'high' ? Math.min(devicePixelRatio, 2) : 1);
    }
    if (kinds.has('project') || kinds.has('view') || kinds.has('level')) {
      this.rebuild();
      this.world = buildWalkWorld(this.store.project.levels);
      this.updateLighting();
    }
    if (kinds.has('view')) this.applyMode();
    if (kinds.has('selection') || kinds.has('project') || kinds.has('level')) this.updateOutline();
    this.dirty = true;
  }

  private rebuild() {
    const { view } = this.store;
    const sorted = this.store.sortedLevels();
    const activeElev = this.store.level.elevation;
    const walking = view.mode === 'walk';
    const seen = new Set<string>();
    sorted.forEach((level, i) => {
      seen.add(level.id);
      const above = sorted[i + 1];
      const below = sorted[i - 1];
      const wallHeight = above ? Math.max(1, above.elevation - level.elevation) : level.height;
      const isActive = level.id === this.store.activeLevelId;
      const opts = {
        wallHeight,
        cutaway: !walking && view.cutaway && isActive ? 1.1 : null,
        doorsOpen: view.doorsOpen,
        ceiling: walking && !above,
        holes: below ? below.stairs.map(stairHole) : [],
        model: (id: string) => this.models.get(id),
        shadows: view.quality === 'high',
      };
      let lv = this.levels.get(level.id);
      if (!lv) {
        lv = { group: new THREE.Group(), staticKey: '', staticGroup: null, items: new Map() };
        lv.group.name = level.name;
        this.levels.set(level.id, lv);
        this.house.add(lv.group);
      }
      const key = JSON.stringify([level.elevation, level.height, level.walls, level.openings, level.rooms, level.stairs, opts.wallHeight,
        opts.cutaway, opts.doorsOpen, opts.ceiling, below?.stairs, opts.shadows]);
      if (key !== lv.staticKey) {
        if (lv.staticGroup) { disposeGroup(lv.staticGroup); lv.staticGroup.removeFromParent(); }
        lv.staticGroup = buildLevel(level, opts);
        lv.group.add(lv.staticGroup);
        lv.staticKey = key;
      }
      // Furniture: rebuild only items whose shape changed; just move the rest.
      const itemIds = new Set<string>();
      for (const it of level.items) {
        itemIds.add(it.id);
        const shapeKey = `${it.type}|${it.w}|${it.d}|${it.h}|${it.color}|${it.modelId ?? ''}|${opts.shadows}`;
        let entry = lv.items.get(it.id);
        if (!entry || entry.key !== shapeKey) {
          if (entry) { disposeGroup(entry.group); entry.group.removeFromParent(); }
          const g = buildItem(it, opts, level.id);
          if (!opts.shadows) g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false; } });
          entry = { key: shapeKey, group: g };
          lv.items.set(it.id, entry);
          lv.group.add(g);
        }
        entry.group.position.set(it.x, level.elevation + (it.elevation ?? 0), it.z);
        entry.group.rotation.y = it.rot;
      }
      for (const [id, entry] of lv.items) {
        if (!itemIds.has(id)) { disposeGroup(entry.group); entry.group.removeFromParent(); lv.items.delete(id); }
      }
      // Orbit mode shows the active level and everything below it.
      lv.group.visible = walking || level.elevation <= activeElev + 1e-6;
    });
    for (const [id, lv] of this.levels) {
      if (!seen.has(id)) { disposeGroup(lv.group); lv.group.removeFromParent(); this.levels.delete(id); }
    }
    this.fitShadowCamera();
  }

  private fitShadowCamera() {
    const box = new THREE.Box3();
    this.store.project.levels.forEach((l) => {
      const b = levelBounds(l);
      if (boundsValid(b)) box.expandByPoint(new THREE.Vector3(b.minX, l.elevation, b.minZ)).expandByPoint(new THREE.Vector3(b.maxX, l.elevation + l.height, b.maxZ));
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2 + 2;
    const az = (this.store.view.sun * Math.PI) / 180;
    const el = this.store.view.night ? 0.9 : 0.85;
    const sun = this.lights.sun;
    sun.position.set(c.x + Math.cos(az) * Math.cos(el) * r * 2, c.y + Math.sin(el) * r * 2, c.z + Math.sin(az) * Math.cos(el) * r * 2);
    sun.target.position.copy(c);
    const cam = sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.5; cam.far = r * 4.5;
    cam.updateProjectionMatrix();
    this.ground.position.set(c.x, -0.21, c.z);
  }

  private updateLighting() {
    const night = this.store.view.night;
    const { hemi, sun, rooms } = this.lights;
    this.scene.background = new THREE.Color(night ? '#0d1420' : '#cfe1ef');
    this.scene.environmentIntensity = night ? 0.06 : 0.45;
    hemi.color.set(night ? '#4a5a7a' : '#eef4ff');
    hemi.groundColor.set(night ? '#1a1814' : '#b9a68c');
    hemi.intensity = night ? 0.15 : 1.1;
    sun.color.set(night ? '#9fb4ff' : '#fff4e2');
    sun.intensity = night ? 0.25 : 2.6;
    (this.ground.material as THREE.MeshStandardMaterial).color.set(night ? '#3a4636' : '#ffffff');

    rooms.clear();
    if (night) {
      // Warm ceiling lights in every enclosed room (capped for performance).
      let count = 0;
      for (const level of this.store.project.levels) {
        const regions = roomRegions(level);
        for (const r of level.rooms) {
          const reg = regions.get(r.id);
          if (!reg?.enclosed || count >= 16) continue;
          const light = new THREE.PointLight('#ffd6a0', Math.min(9, 2 + reg.area * 0.35), Math.sqrt(reg.area) * 2.6 + 2, 1.6);
          light.position.set(reg.centroid.x, level.elevation + level.height - 0.35, reg.centroid.z);
          rooms.add(light);
          count++;
        }
      }
    }
  }

  private applyMode() {
    const walking = this.store.view.mode === 'walk';
    this.orbit.enabled = !walking;
    this.joystickEl.hidden = !walking || !matchMedia('(pointer: coarse)').matches;
    if (walking) {
      if (!this.savedOrbit) this.savedOrbit = { pos: this.camera.position.clone(), target: this.orbit.target.clone() };
      if (!this.walker) {
        const s = this.defaultSpawn(this.store.level);
        this.walker = { x: s.x, z: s.z, y: this.store.level.elevation };
      }
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.camera.position.set(this.walker.x, this.walker.y + this.store.view.eye, this.walker.z);
      const flat = new THREE.Vector3(dir.x, 0, dir.z);
      if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
      flat.normalize();
      this.camera.lookAt(this.camera.position.clone().add(flat));
      this.camera.fov = 70;
    } else {
      if (this.look.isLocked) this.look.unlock();
      this.camera.fov = 55;
      if (this.savedOrbit) {
        this.camera.position.copy(this.savedOrbit.pos);
        this.orbit.target.copy(this.savedOrbit.target);
        this.savedOrbit = null;
        this.orbit.update();
      }
    }
    this.camera.updateProjectionMatrix();
    this.updateHint();
    this.emitPose();
  }

  private updateHint() {
    const walking = this.store.view.mode === 'walk';
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.hint.hidden = !walking || this.look.isLocked;
    this.hint.textContent = coarse
      ? 'Drag to look around · use the joystick to move'
      : 'Click to look around · W A S D or arrows to move · Shift to run · Esc to release';
  }

  private defaultSpawn(level: Level) {
    const regions = roomRegions(level);
    let best: { x: number; z: number } | null = null, bestArea = 0;
    for (const r of level.rooms) {
      const reg = regions.get(r.id);
      if (reg?.enclosed && reg.area > bestArea) { bestArea = reg.area; best = reg.centroid; }
    }
    if (best) return best;
    const b = levelBounds(level);
    return boundsValid(b) ? { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 } : { x: 0, z: 0 };
  }

  // -------------------------------------------------------------- outline
  private updateOutline() {
    this.outline?.removeFromParent();
    this.outline?.geometry.dispose();
    this.outline = null;
    const sel = this.store.selection;
    if (!sel) return;
    const target = this.findPickable(sel);
    if (!target) return;
    const box = localBox(target);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).addScalar(0.04);
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    const mat = new THREE.LineBasicMaterial({ color: '#e8467c', depthTest: false, transparent: true });
    this.outline = new THREE.LineSegments(geo, mat);
    this.outline.renderOrder = 20;
    box.getCenter(this.outline.position);
    target.add(this.outline);
    this.dirty = true;
  }

  private findPickable(sel: Selection): THREE.Object3D | null {
    const lv = this.levels.get(this.store.activeLevelId);
    if (!lv) return null;
    if (sel.kind === 'item') return lv.items.get(sel.id)?.group ?? null;
    let found: THREE.Object3D | null = null;
    lv.group.traverse((o) => {
      if (found) return;
      const p = o.userData.pick as Pickable | undefined;
      if (p && p.kind === sel.kind && p.id === sel.id) found = o;
      if (sel.kind === 'opening' && o.userData.opening === sel.id && o.parent && o.parent.userData.opening !== sel.id) found = o;
    });
    return found;
  }

  // ---------------------------------------------------------------- input
  private bindInput() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.store.view.mode === 'walk' && e.pointerType === 'touch') {
        this.touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (this.touchLook && e.pointerId === this.touchLook.id) {
        const dx = e.clientX - this.touchLook.x, dy = e.clientY - this.touchLook.y;
        this.touchLook.x = e.clientX; this.touchLook.y = e.clientY;
        const euler = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion);
        euler.y -= dx * 0.005;
        euler.x = Math.max(-1.4, Math.min(1.4, euler.x - dy * 0.005));
        this.camera.quaternion.setFromEuler(euler);
        this.dirty = true;
        this.emitPose();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (this.touchLook?.id === e.pointerId) this.touchLook = null;
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 400;
      down = null;
      if (moved > 5 || !quick || e.button !== 0) return;
      if (this.store.view.mode === 'walk') { this.lockPointer(); return; }
      const hit = this.pick(e);
      if (hit?.pick) {
        if (hit.pick.levelId !== this.store.activeLevelId) this.store.setLevel(hit.pick.levelId);
        this.store.select({ kind: hit.pick.kind, id: hit.pick.id });
      } else this.store.select(null);
    };
    const onDbl = (e: MouseEvent) => {
      if (this.store.view.mode === 'walk') return;
      const hit = this.pick(e);
      if (!hit) return;
      const levelId = hit.pick?.levelId ?? this.levelAtHeight(hit.point.y);
      this.startWalk({ x: hit.point.x, z: hit.point.z, levelId });
    };
    const onKey = (e: KeyboardEvent, isDown: boolean) => {
      if (this.store.view.mode !== 'walk') return;
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      const code = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(code)) {
        if (isDown) this.keys.add(code); else this.keys.delete(code);
        if (code.startsWith('Arrow') && (this.look.isLocked || document.activeElement === el)) e.preventDefault();
      }
    };
    const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => this.keys.clear();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('dblclick', onDbl);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.disposers.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('dblclick', onDbl);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });
  }

  private joystickEl!: HTMLElement;
  private buildJoystick() {
    const pad = document.createElement('div');
    pad.className = 'joystick';
    pad.hidden = true;
    pad.setAttribute('aria-hidden', 'true');
    const knob = document.createElement('div');
    knob.className = 'joystick-knob';
    pad.appendChild(knob);
    this.host.appendChild(pad);
    this.joystickEl = pad;
    let active: number | null = null;
    const move = (e: PointerEvent) => {
      if (active !== e.pointerId) return;
      const r = pad.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      this.joystick = { x, y };
      knob.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
    };
    const end = (e: PointerEvent) => {
      if (active !== e.pointerId) return;
      active = null;
      this.joystick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    pad.addEventListener('pointerdown', (e) => { active = e.pointerId; pad.setPointerCapture(e.pointerId); move(e); e.stopPropagation(); });
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  private pick(e: MouseEvent): { pick: Pickable | null; point: THREE.Vector3 } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.house.children, true).filter((h) => isVisible(h.object) && !(h.object instanceof THREE.LineSegments));
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      let openingId: string | undefined;
      while (o) {
        if (o.userData.opening && !openingId) openingId = o.userData.opening as string;
        const p = o.userData.pick as Pickable | undefined;
        if (p) {
          if (openingId && p.kind === 'wall') return { pick: { kind: 'opening', id: openingId, levelId: p.levelId }, point: h.point };
          return { pick: p, point: h.point };
        }
        o = o.parent;
      }
      return { pick: null, point: h.point };
    }
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.store.level.elevation);
    const pt = new THREE.Vector3();
    return ray.ray.intersectPlane(ground, pt) ? { pick: null, point: pt } : null;
  }

  private levelAtHeight(y: number): string {
    let best = this.store.sortedLevels()[0];
    for (const l of this.store.sortedLevels()) if (l.elevation <= y + 0.3) best = l;
    return best.id;
  }

  // ----------------------------------------------------------------- loop
  private tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.store.view.mode === 'walk') this.walkStep(dt);
    else if (this.orbit.update()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  }

  private walkStep(dt: number) {
    if (!this.walker || !this.world) return;
    const k = this.keys;
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    fwd -= this.joystick.y;
    side += this.joystick.x;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    let mx = dir.x * fwd + right.x * side, mz = dir.z * fwd + right.z * side;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const speed = (run ? RUN_SPEED : WALK_SPEED) * dt;
    const before = this.walker;
    this.walker = step(this.world, this.walker, mx * speed, mz * speed, dt);
    const eye = this.walker.y + this.store.view.eye;
    if (before.x !== this.walker.x || before.z !== this.walker.z || Math.abs(this.camera.position.y - eye) > 1e-4) {
      this.camera.position.set(this.walker.x, eye, this.walker.z);
      this.dirty = true;
      // Keep the active level in sync with where the walker stands.
      const lvl = this.levelAtHeight(this.walker.y);
      if (lvl !== this.store.activeLevelId) this.store.setLevel(lvl);
      this.emitPose();
    }
  }

  private emitPose() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const walking = this.store.view.mode === 'walk';
    const p = this.walker ?? { x: this.orbit.target.x, z: this.orbit.target.z, y: 0 };
    this.onPose({ x: p.x, z: p.z, dirX: dir.x, dirZ: dir.z, levelId: this.store.activeLevelId, walking });
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
}

function localBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox!).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    box.union(tmp);
  });
  return box;
}

function isVisible(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) { if (!cur.visible) return false; cur = cur.parent; }
  return true;
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      // Shared/cached geometries (furniture) are small and reused; dispose only unique ones.
      if (!o.geometry.userData.shared) o.geometry.dispose();
    }
  });
}
