/* Vista 3D del braccio — three.js locale, senza CDN */
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const HOME = Object.freeze({
  base: 25,
  shoulder: -35,
  elbow: 55,
  wrist: 20,
  roll: 0,
  gripper: 40,
});

const RANGES = {
  base: [-180, 180],
  shoulder: [-90, 90],
  elbow: [-135, 135],
  wrist: [-90, 90],
  roll: [-180, 180],
  gripper: [0, 100],
};

const LABELS = {
  base: "Base",
  shoulder: "Spalla",
  elbow: "Gomito",
  wrist: "Polso",
  roll: "Rotazione polso",
  gripper: "Pinza",
};

const JOINT_KEYS = ["base", "shoulder", "elbow", "wrist", "roll", "gripper"];

const DEMO = [
  { t: 0.0, joints: { base: 25, shoulder: -35, elbow: 55, wrist: 20, roll: 0, gripper: 40 } },
  { t: 0.7, joints: { base: 25, shoulder: -35, elbow: 55, wrist: 20, roll: 0, gripper: 100 } },
  { t: 1.6, joints: { base: 8, shoulder: -8, elbow: 78, wrist: 28, roll: 0, gripper: 100 } },
  { t: 2.3, joints: { base: 8, shoulder: 8, elbow: 92, wrist: 22, roll: 0, gripper: 100 }, grab: true },
  { t: 2.8, joints: { base: 8, shoulder: 8, elbow: 92, wrist: 22, roll: 0, gripper: 6 } },
  { t: 3.6, joints: { base: 8, shoulder: -42, elbow: 48, wrist: 18, roll: 0, gripper: 6 } },
  { t: 4.7, joints: { base: 125, shoulder: -42, elbow: 48, wrist: 18, roll: 40, gripper: 6 } },
  { t: 5.5, joints: { base: 125, shoulder: 2, elbow: 88, wrist: 24, roll: 40, gripper: 6 }, drop: true },
  { t: 6.0, joints: { base: 125, shoulder: 2, elbow: 88, wrist: 24, roll: 40, gripper: 100 } },
  { t: 6.8, joints: { base: 125, shoulder: -35, elbow: 55, wrist: 20, roll: 0, gripper: 80 } },
  { t: 7.8, joints: { base: 25, shoulder: -35, elbow: 55, wrist: 20, roll: 0, gripper: 40 } },
];

const DEG = Math.PI / 180;

let ctx = null;
let cached = {
  joints: { ...HOME },
  camPos: null,
  camTarget: null,
};

function clampJoint(key, value) {
  const r = RANGES[key];
  const n = Number(value);
  if (!Number.isFinite(n)) return HOME[key];
  return Math.max(r[0], Math.min(r[1], n));
}

function cloneJoints(j) {
  const out = {};
  JOINT_KEYS.forEach((k) => {
    out[k] = clampJoint(k, j && j[k] != null ? j[k] : HOME[k]);
  });
  return out;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpJoints(a, b, t) {
  const out = {};
  JOINT_KEYS.forEach((k) => {
    out[k] = lerp(a[k], b[k], t);
  });
  return out;
}

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function isDarkTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function makeMaterials(dark) {
  const metalColor = dark ? 0x9a9aa8 : 0x3d3d48;
  const metal2 = dark ? 0x6e6e7a : 0x2a2a32;
  const amber = 0xff7a1a;
  const amberSoft = 0xffb020;
  const rubber = dark ? 0x2a2a30 : 0x1a1a1e;
  return {
    metal: new THREE.MeshStandardMaterial({
      color: metalColor,
      metalness: 0.82,
      roughness: 0.28,
    }),
    metalDark: new THREE.MeshStandardMaterial({
      color: metal2,
      metalness: 0.88,
      roughness: 0.22,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: amber,
      metalness: 0.55,
      roughness: 0.32,
      emissive: amber,
      emissiveIntensity: dark ? 0.22 : 0.08,
    }),
    accentSoft: new THREE.MeshStandardMaterial({
      color: amberSoft,
      metalness: 0.45,
      roughness: 0.4,
      emissive: amberSoft,
      emissiveIntensity: dark ? 0.12 : 0.04,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: rubber,
      metalness: 0.08,
      roughness: 0.72,
    }),
    markA: new THREE.MeshStandardMaterial({
      color: 0xff7a1a,
      metalness: 0.2,
      roughness: 0.5,
      emissive: 0xff7a1a,
      emissiveIntensity: dark ? 0.15 : 0.06,
    }),
    markB: new THREE.MeshStandardMaterial({
      color: 0x12b981,
      metalness: 0.2,
      roughness: 0.5,
      emissive: 0x12b981,
      emissiveIntensity: dark ? 0.15 : 0.06,
    }),
    cube: new THREE.MeshStandardMaterial({
      color: 0xffb020,
      metalness: 0.15,
      roughness: 0.45,
    }),
  };
}

function addMesh(parent, geom, mat, pos, rot, cast = true, receive = false) {
  const m = new THREE.Mesh(geom, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

function jointDisc(mats, r, h) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28), mats.accent);
}

function buildArm(scene, mats) {
  const root = new THREE.Group();
  scene.add(root);

  const geo = {
    plate: new THREE.CylinderGeometry(1.05, 1.12, 0.1, 48),
    yaw: new THREE.CylinderGeometry(0.5, 0.58, 0.38, 32),
    cap: new THREE.CylinderGeometry(0.42, 0.42, 0.08, 28),
    upper: new THREE.BoxGeometry(0.26, 1.15, 0.26),
    fore: new THREE.BoxGeometry(0.22, 0.95, 0.22),
    wrist: new THREE.CylinderGeometry(0.13, 0.15, 0.28, 20),
    roll: new THREE.CylinderGeometry(0.12, 0.12, 0.22, 20),
    palm: new THREE.BoxGeometry(0.28, 0.1, 0.16),
    jaw: new THREE.BoxGeometry(0.05, 0.22, 0.14),
    pad: new THREE.BoxGeometry(0.03, 0.2, 0.12),
    discS: new THREE.CylinderGeometry(0.28, 0.28, 0.16, 28),
    discE: new THREE.CylinderGeometry(0.22, 0.22, 0.14, 28),
    discW: new THREE.CylinderGeometry(0.16, 0.16, 0.12, 24),
  };

  const plate = addMesh(root, geo.plate, mats.metalDark, [0, 0.05, 0], null, true, true);

  const yaw = new THREE.Group();
  yaw.position.y = 0.1;
  root.add(yaw);
  addMesh(yaw, geo.yaw, mats.metal, [0, 0.22, 0]);
  addMesh(yaw, geo.cap, mats.accentSoft, [0, 0.43, 0], null, false);
  const shoulderPivot = new THREE.Group();
  shoulderPivot.position.set(0, 0.5, 0);
  yaw.add(shoulderPivot);
  const sDisc = jointDisc(mats, 0.28, 0.18);
  sDisc.rotation.z = Math.PI / 2;
  sDisc.castShadow = true;
  shoulderPivot.add(sDisc);

  const shoulder = new THREE.Group();
  shoulderPivot.add(shoulder);
  addMesh(shoulder, geo.upper, mats.metal, [0, 0.58, 0]);
  addMesh(shoulder, mats && geo.discS, mats.accentSoft, [0, 1.15, 0], null, false);

  const elbowPivot = new THREE.Group();
  elbowPivot.position.set(0, 1.15, 0);
  shoulder.add(elbowPivot);
  const eDisc = jointDisc(mats, 0.22, 0.15);
  eDisc.rotation.z = Math.PI / 2;
  eDisc.castShadow = true;
  elbowPivot.add(eDisc);

  const elbow = new THREE.Group();
  elbowPivot.add(elbow);
  addMesh(elbow, geo.fore, mats.metal, [0, 0.48, 0]);

  const wristPivot = new THREE.Group();
  wristPivot.position.set(0, 0.95, 0);
  elbow.add(wristPivot);
  const wDisc = jointDisc(mats, 0.16, 0.12);
  wDisc.rotation.z = Math.PI / 2;
  wDisc.castShadow = true;
  wristPivot.add(wDisc);

  const wrist = new THREE.Group();
  wristPivot.add(wrist);
  addMesh(wrist, geo.wrist, mats.metal, [0, 0.14, 0]);

  const roll = new THREE.Group();
  roll.position.y = 0.28;
  wrist.add(roll);
  addMesh(roll, geo.roll, mats.metalDark, [0, 0.08, 0]);
  addMesh(roll, geo.palm, mats.metal, [0, 0.2, 0]);

  const jawL = new THREE.Group();
  const jawR = new THREE.Group();
  jawL.position.set(-0.09, 0.32, 0);
  jawR.position.set(0.09, 0.32, 0);
  roll.add(jawL);
  roll.add(jawR);
  addMesh(jawL, geo.jaw, mats.metalDark, [0, 0.1, 0]);
  addMesh(jawR, geo.jaw, mats.metalDark, [0, 0.1, 0]);
  addMesh(jawL, geo.pad, mats.rubber, [0.03, 0.1, 0], null, false);
  addMesh(jawR, geo.pad, mats.rubber, [-0.03, 0.1, 0], null, false);

  const geoms = Object.values(geo);

  return {
    root,
    yaw,
    shoulder,
    elbow,
    wrist,
    roll,
    jawL,
    jawR,
    geoms,
  };
}

function applyJoints(parts, j) {
  parts.yaw.rotation.y = j.base * DEG;
  parts.shoulder.rotation.z = j.shoulder * DEG;
  parts.elbow.rotation.z = j.elbow * DEG;
  parts.wrist.rotation.z = j.wrist * DEG;
  parts.roll.rotation.y = j.roll * DEG;
  const open = 0.02 + (j.gripper / 100) * 0.09;
  parts.jawL.position.x = -open;
  parts.jawR.position.x = open;
}

function themePalette(dark) {
  return {
    hemiSky: dark ? 0x3a3268 : 0xf3efff,
    hemiGround: dark ? 0x1a1420 : 0xe8e0d4,
    hemiInt: dark ? 0.85 : 1.05,
    dirColor: dark ? 0xffe4c8 : 0xffffff,
    dirInt: dark ? 1.35 : 1.7,
    fillInt: dark ? 0.35 : 0.45,
    gridA: dark ? 0x4a4558 : 0xc8c2d8,
    gridB: dark ? 0x2a2834 : 0xe6e2ee,
    shadowOp: dark ? 0.45 : 0.2,
  };
}

function createWorld(container) {
  const dark = isDarkTheme();
  const pal = themePalette(dark);
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, 1, 0.08, 40);
  if (cached.camPos) {
    camera.position.copy(cached.camPos);
  } else {
    camera.position.set(3.8, 2.55, 4.15);
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "arm-canvas";
  renderer.domElement.setAttribute("aria-label", "Modello 3D del braccio robotico");
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiInt);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(pal.dirColor, pal.dirInt);
  dir.position.set(4.5, 7, 3.2);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 18;
  dir.shadow.camera.left = -5;
  dir.shadow.camera.right = 5;
  dir.shadow.camera.top = 5;
  dir.shadow.camera.bottom = -5;
  dir.shadow.bias = -0.0008;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xb8c0ff, pal.fillInt);
  fill.position.set(-3, 2.2, -2);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 48),
    new THREE.ShadowMaterial({ opacity: pal.shadowOp })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(6, 18, pal.gridA, pal.gridB);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = dark ? 0.35 : 0.55;
  scene.add(grid);

  const mats = makeMaterials(dark);
  const parts = buildArm(scene, mats);

  // Pick / place pads + cube
  const padGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 24);
  const pickPad = addMesh(scene, padGeo, mats.markA, [1.15, 0.02, 0.55], null, false, true);
  const placePad = addMesh(scene, padGeo, mats.markB, [-0.15, 0.02, 1.25], null, false, true);
  const cube = addMesh(scene, new THREE.BoxGeometry(0.16, 0.16, 0.16), mats.cube, [1.15, 0.11, 0.55], null, true, true);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.2;
  controls.maxDistance = 8;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.target.set(0, 0.85, 0);
  if (cached.camTarget) controls.target.copy(cached.camTarget);
  controls.update();

  return {
    scene,
    camera,
    renderer,
    controls,
    parts,
    lights: { hemi, dir, fill },
    floor,
    grid,
    mats,
    cube,
    pickPad,
    placePad,
    dark,
    carrying: false,
  };
}

function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((m) => m.dispose && m.dispose());
    }
  });
}

function applyThemeToWorld(world) {
  const dark = isDarkTheme();
  if (world.dark === dark) return;
  world.dark = dark;
  const pal = themePalette(dark);
  world.lights.hemi.color.setHex(pal.hemiSky);
  world.lights.hemi.groundColor.setHex(pal.hemiGround);
  world.lights.hemi.intensity = pal.hemiInt;
  world.lights.dir.color.setHex(pal.dirColor);
  world.lights.dir.intensity = pal.dirInt;
  world.lights.fill.intensity = pal.fillInt;
  world.floor.material.opacity = pal.shadowOp;
  world.grid.material.color.setHex(pal.gridB);
  world.grid.material.opacity = dark ? 0.35 : 0.55;
  const next = makeMaterials(dark);
  const map = [
    ["metal", world.mats.metal],
    ["metalDark", world.mats.metalDark],
    ["accent", world.mats.accent],
    ["accentSoft", world.mats.accentSoft],
    ["rubber", world.mats.rubber],
    ["markA", world.mats.markA],
    ["markB", world.mats.markB],
    ["cube", world.mats.cube],
  ];
  map.forEach(([key, mat]) => {
    const src = next[key];
    mat.color.copy(src.color);
    mat.emissive && src.emissive && mat.emissive.copy(src.emissive);
    mat.emissiveIntensity = src.emissiveIntensity;
    mat.metalness = src.metalness;
    mat.roughness = src.roughness;
    src.dispose();
  });
}

function resizeToContainer(world, container) {
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  world.camera.aspect = w / h;
  world.camera.updateProjectionMatrix();
  world.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  world.renderer.setSize(w, h, false);
}

function setSliderUI(joints) {
  if (!ctx) return;
  JOINT_KEYS.forEach((k) => {
    const input = ctx.root.querySelector('[data-joint="' + k + '"]');
    const val = ctx.root.querySelector('[data-joint-val="' + k + '"]');
    if (input && input.value !== String(Math.round(joints[k]))) input.value = String(Math.round(joints[k]));
    if (val) {
      val.textContent = k === "gripper" ? Math.round(joints[k]) + "%" : Math.round(joints[k]) + "°";
    }
  });
}

function setDemoButtons(playing) {
  if (!ctx) return;
  const demo = ctx.root.querySelector('[data-arm="demo"]');
  if (demo) {
    demo.textContent = playing ? "Ferma" : "Demo";
    demo.setAttribute("aria-pressed", playing ? "true" : "false");
  }
}

function grabCube() {
  if (!ctx || ctx.world.carrying) return;
  const { cube, parts } = ctx.world;
  parts.roll.attach(cube);
  ctx.world.carrying = true;
}

function dropCube() {
  if (!ctx || !ctx.world.carrying) return;
  const { cube, scene } = ctx.world;
  scene.attach(cube);
  cube.position.y = 0.11;
  cube.rotation.set(0, 0, 0);
  ctx.world.carrying = false;
}

function resetCube() {
  if (!ctx) return;
  const { cube, scene } = ctx.world;
  if (ctx.world.carrying) scene.attach(cube);
  cube.position.set(1.15, 0.11, 0.55);
  cube.rotation.set(0, 0, 0);
  ctx.world.carrying = false;
}

function currentJoints() {
  return ctx ? { ...ctx.joints } : { ...cached.joints };
}

function goTo(target, duration, hooks) {
  if (!ctx) return Promise.resolve();
  hooks = hooks || {};
  const from = { ...ctx.joints };
  const to = cloneJoints(target);
  const ms = Math.max(200, duration || 700);
  ctx.anim = { from, to, start: performance.now(), ms, hooks };
  requestTick();
  return new Promise((resolve) => {
    ctx.anim.resolve = resolve;
  });
}

function stepAnim(now) {
  if (!ctx || !ctx.anim) return false;
  const a = ctx.anim;
  const t = smoothstep((now - a.start) / a.ms);
  ctx.joints = lerpJoints(a.from, a.to, t);
  applyJoints(ctx.world.parts, ctx.joints);
  setSliderUI(ctx.joints);
  if (t >= 1) {
    ctx.joints = { ...a.to };
    applyJoints(ctx.world.parts, ctx.joints);
    const resolve = a.resolve;
    const hooks = a.hooks;
    ctx.anim = null;
    if (hooks.grab) grabCube();
    if (hooks.drop) dropCube();
    if (resolve) resolve();
    persistJoints();
    return false;
  }
  return true;
}

function persistJoints() {
  if (!ctx || !ctx.opts || !ctx.opts.onChange) return;
  clearTimeout(ctx.saveTimer);
  ctx.saveTimer = setTimeout(() => {
    cached.joints = { ...ctx.joints };
    ctx.opts.onChange(cloneJoints(ctx.joints));
  }, 280);
}

function requestTick() {
  if (!ctx) return;
  ctx.needsRender = true;
  ctx.lastInteract = performance.now();
  if (!ctx.looping) {
    ctx.looping = true;
    ctx.raf = requestAnimationFrame(loop);
  }
}

function loop(now) {
  if (!ctx) return;
  const world = ctx.world;
  let keep = false;
  if (ctx.anim) keep = stepAnim(now) || keep;
  if (ctx.demo) keep = stepDemo(now) || keep;
  world.controls.update();
  if (ctx.needsRender || keep || now - ctx.lastInteract < 450) {
    world.renderer.render(world.scene, world.camera);
    ctx.needsRender = false;
    keep = true;
  }
  if (keep) {
    ctx.raf = requestAnimationFrame(loop);
  } else {
    ctx.looping = false;
  }
}

function stepDemo(now) {
  if (!ctx || !ctx.demo) return false;
  const d = ctx.demo;
  const elapsed = (now - d.start) / 1000;
  const frames = d.frames;
  const endT = frames[frames.length - 1].t;
  if (elapsed >= endT) {
    const last = frames[frames.length - 1];
    ctx.joints = cloneJoints(last.joints);
    applyJoints(ctx.world.parts, ctx.joints);
    setSliderUI(ctx.joints);
    if (last.drop) dropCube();
    ctx.demo = null;
    setDemoButtons(false);
    persistJoints();
    return false;
  }
  let i = 0;
  while (i < frames.length - 1 && elapsed >= frames[i + 1].t) i += 1;
  const a = frames[i];
  const b = frames[i + 1];
  const u = smoothstep((elapsed - a.t) / Math.max(0.0001, b.t - a.t));
  ctx.joints = lerpJoints(a.joints, b.joints, u);
  applyJoints(ctx.world.parts, ctx.joints);
  setSliderUI(ctx.joints);
  if (b.grab && u > 0.85 && !ctx.world.carrying) grabCube();
  if (b.drop && u > 0.85 && ctx.world.carrying) dropCube();
  return true;
}

function playDemo() {
  if (!ctx) return;
  if (ctx.demo) {
    ctx.demo = null;
    ctx.anim = null;
    setDemoButtons(false);
    persistJoints();
    requestTick();
    return;
  }
  resetCube();
  ctx.anim = null;
  ctx.joints = cloneJoints(DEMO[0].joints);
  applyJoints(ctx.world.parts, ctx.joints);
  setSliderUI(ctx.joints);
  ctx.demo = { start: performance.now(), frames: DEMO };
  setDemoButtons(true);
  requestTick();
}

function resetArm() {
  if (!ctx) return;
  ctx.demo = null;
  setDemoButtons(false);
  resetCube();
  goTo(HOME, 800);
}

function bindUI(root) {
  root.querySelectorAll("[data-joint]").forEach((input) => {
    const apply = () => {
      if (!ctx) return;
      ctx.demo = null;
      setDemoButtons(false);
      const key = input.dataset.joint;
      ctx.joints[key] = clampJoint(key, input.value);
      applyJoints(ctx.world.parts, ctx.joints);
      setSliderUI(ctx.joints);
      persistJoints();
      requestTick();
    };
    input.addEventListener("input", apply);
    input.addEventListener("change", apply);
  });
  const onAction = (e) => {
    const btn = e.target.closest("[data-arm]");
    if (!btn || !root.contains(btn)) return;
    const act = btn.dataset.arm;
    if (act === "demo") playDemo();
    else if (act === "reset") resetArm();
    else if (act === "save-pose") {
      const nameInput = root.querySelector("#arm-pose-name");
      const name = nameInput ? nameInput.value.trim() : "";
      if (!name) {
        if (ctx.opts.onToast) ctx.opts.onToast("Dai un nome alla pose");
        if (nameInput) nameInput.focus();
        return;
      }
      if (ctx.opts.onSavePose) {
        ctx.opts.onSavePose(name, cloneJoints(ctx.joints));
        nameInput.value = "";
      }
    } else if (act === "load-pose") {
      const id = btn.dataset.id;
      const pose = (ctx.opts.poses || []).find((p) => p.id === id);
      if (pose) {
        ctx.demo = null;
        setDemoButtons(false);
        goTo(pose.joints, 700);
      }
    } else if (act === "delete-pose") {
      const id = btn.dataset.id;
      if (ctx.opts.onDeletePose) ctx.opts.onDeletePose(id);
    }
  };
  root.addEventListener("click", onAction);
  return onAction;
}

function mount(container, opts) {
  if (ctx) unmount();
  const root = container.closest("#arm-3d") || container;
  const viewport = container.id === "arm-viewport" ? container : root.querySelector("#arm-viewport") || container;
  if (!viewport) return;

  let world;
  try {
    world = createWorld(viewport);
  } catch (err) {
    viewport.innerHTML = '<p class="arm-fallback">La vista 3D non è disponibile su questo dispositivo.</p>';
    console.warn("Mie Cose 3D:", err);
    return;
  }

  const joints = cloneJoints((opts && opts.joints) || cached.joints || HOME);
  applyJoints(world.parts, joints);
  cached.joints = { ...joints };

  ctx = {
    root,
    viewport,
    world,
    opts: opts || {},
    joints,
    needsRender: true,
    looping: false,
    raf: 0,
    lastInteract: performance.now(),
    anim: null,
    demo: null,
    saveTimer: 0,
    onAction: null,
    mq: null,
    ro: null,
  };
  ctx.onAction = bindUI(root);
  setSliderUI(joints);
  setDemoButtons(false);
  resizeToContainer(world, viewport);

  const onControls = () => requestTick();
  world.controls.addEventListener("change", onControls);
  world.controls.addEventListener("start", onControls);
  ctx.onControls = onControls;

  ctx.mq = window.matchMedia("(prefers-color-scheme: dark)");
  ctx.onTheme = () => {
    applyThemeToWorld(world);
    requestTick();
  };
  if (ctx.mq.addEventListener) ctx.mq.addEventListener("change", ctx.onTheme);
  else if (ctx.mq.addListener) ctx.mq.addListener(ctx.onTheme);

  ctx.ro = new ResizeObserver(() => {
    resizeToContainer(world, viewport);
    requestTick();
  });
  ctx.ro.observe(viewport);

  requestTick();
}

function unmount() {
  if (!ctx) return;
  if (ctx.raf) cancelAnimationFrame(ctx.raf);
  clearTimeout(ctx.saveTimer);
  const { world, viewport } = ctx;
  cached.joints = { ...ctx.joints };
  if (world && world.camera) cached.camPos = world.camera.position.clone();
  if (world && world.controls) cached.camTarget = world.controls.target.clone();
  if (ctx.onAction && ctx.root) ctx.root.removeEventListener("click", ctx.onAction);
  if (ctx.mq && ctx.onTheme) {
    if (ctx.mq.removeEventListener) ctx.mq.removeEventListener("change", ctx.onTheme);
    else if (ctx.mq.removeListener) ctx.mq.removeListener(ctx.onTheme);
  }
  if (ctx.ro) ctx.ro.disconnect();
  if (world) {
    if (ctx.onControls) {
      world.controls.removeEventListener("change", ctx.onControls);
      world.controls.removeEventListener("start", ctx.onControls);
    }
    world.controls.dispose();
    disposeObject3D(world.scene);
    world.renderer.dispose();
    if (world.renderer.domElement && world.renderer.domElement.parentNode) {
      world.renderer.domElement.parentNode.removeChild(world.renderer.domElement);
    }
  }
  ctx = null;
}

const api = {
  mount,
  unmount,
  playDemo,
  reset: resetArm,
  getJoints: currentJoints,
  setJoints(j, animate) {
    if (!ctx) {
      cached.joints = cloneJoints(j);
      return;
    }
    if (animate === false) {
      ctx.joints = cloneJoints(j);
      applyJoints(ctx.world.parts, ctx.joints);
      setSliderUI(ctx.joints);
      requestTick();
    } else {
      goTo(j, 700);
    }
  },
  requestRender: requestTick,
  isMounted() {
    return !!ctx;
  },
};

window.MiaArm3D = api;
window.dispatchEvent(new Event("mia-arm3d-ready"));
