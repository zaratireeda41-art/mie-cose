/* Vista 3D del braccio — modello realistico, fisica e IK. Librerie locali, senza CDN. */
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";
import * as CANNON from "./vendor/cannon-es.min.js";
import { RoundedBoxGeometry } from "./vendor/RoundedBoxGeometry.js";
import { mergeGeometries } from "./vendor/BufferGeometryUtils.js";
import * as TX from "./arm-textures.js";

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
  roll: "Rotaz.",
  gripper: "Pinza",
};

const JOINT_KEYS = ["base", "shoulder", "elbow", "wrist", "roll", "gripper"];

const SERVO = {
  MG996R: { stall: 1.1, maxSpeed: 6.2, label: "MG996R" },
  DS3218: { stall: 2.0, maxSpeed: 5.5, label: "DS3218" },
  SG90: { stall: 0.18, maxSpeed: 8.7, label: "SG90" },
};

const DEFAULT_CONFIG = Object.freeze({
  L1: 0.15,
  L2: 0.12,
  L3: 0.09,
  baseH: 0.08,
  m1: 0.18,
  m2: 0.12,
  m3: 0.08,
  servo: "MG996R",
  payload: 0.05,
});

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const DT = 1 / 120;
const MAX_STEPS = 8;
const G = 9.81;

let ctx = null;
let cached = {
  joints: { ...HOME },
  camPos: null,
  camTarget: null,
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function clampJoint(key, value) {
  const r = RANGES[key];
  const n = Number(value);
  if (!Number.isFinite(n)) return HOME[key];
  return clamp(n, r[0], r[1]);
}

function cloneJoints(j) {
  const out = {};
  JOINT_KEYS.forEach((k) => {
    out[k] = clampJoint(k, j && j[k] != null ? j[k] : HOME[k]);
  });
  return out;
}

function sanitizeConfig(raw) {
  const c = { ...DEFAULT_CONFIG };
  if (!raw || typeof raw !== "object") return c;
  const num = (k, lo, hi) => {
    const n = Number(raw[k]);
    if (Number.isFinite(n)) c[k] = clamp(n, lo, hi);
  };
  num("L1", 0.06, 0.4);
  num("L2", 0.06, 0.4);
  num("L3", 0.03, 0.25);
  num("baseH", 0.04, 0.2);
  num("m1", 0.02, 1);
  num("m2", 0.02, 1);
  num("m3", 0.02, 1);
  num("payload", 0, 1);
  if (SERVO[raw.servo]) c.servo = raw.servo;
  return c;
}

function isDarkTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function wrapPi(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/* ---------- Cinematica ---------- */

function planarPoint(L1, L2, L3, baseH, a1, e, w, along) {
  const a2 = a1 + e;
  const a3 = a2 + w;
  const z =
    along[0] * Math.cos(a1) + along[1] * Math.cos(a2) + along[2] * Math.cos(a3);
  const y =
    baseH -
    along[0] * Math.sin(a1) -
    along[1] * Math.sin(a2) -
    along[2] * Math.sin(a3);
  return { z, y };
}

function yawOf(zloc, y, base) {
  return { x: zloc * Math.sin(base), y, z: zloc * Math.cos(base) };
}

function fk(config, q) {
  const { L1, L2, L3, baseH } = config;
  const a1 = q.shoulder;
  const e = q.elbow;
  const w = q.wrist;
  const base = q.base;
  const p = (a, b, c) => planarPoint(L1, L2, L3, baseH, a1, e, w, [a, b, c]);
  const sh = p(0, 0, 0);
  const el = p(L1, 0, 0);
  const wr = p(L1, L2, 0);
  const ee = p(L1, L2, L3);
  return {
    base,
    a1,
    a2: a1 + e,
    a3: a1 + e + w,
    shoulder: yawOf(sh.z, sh.y, base),
    elbow: yawOf(el.z, el.y, base),
    wrist: yawOf(wr.z, wr.y, base),
    ee: yawOf(ee.z, ee.y, base),
    eePlane: ee,
  };
}

function jointsFromState(state) {
  return {
    base: state.base.q * RAD,
    shoulder: state.shoulder.q * RAD,
    elbow: state.elbow.q * RAD,
    wrist: state.wrist.q * RAD,
    roll: state.roll.q * RAD,
    gripper: state.gripper.q,
  };
}

function stateFromJoints(j) {
  const c = cloneJoints(j);
  const mk = (q, rotary) => ({
    q: rotary ? c[q] * DEG : c[q],
    qdot: 0,
    tau: 0,
    sat: false,
  });
  return {
    base: mk("base", true),
    shoulder: mk("shoulder", true),
    elbow: mk("elbow", true),
    wrist: mk("wrist", true),
    roll: mk("roll", true),
    gripper: mk("gripper", false),
  };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function len(a) {
  return Math.hypot(a.x, a.y, a.z);
}
function scaleV(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function angleAroundAxis(u, v, n) {
  let uu = sub(u, scaleV(n, dot(u, n)));
  let vv = sub(v, scaleV(n, dot(v, n)));
  const lu = len(uu);
  const lv = len(vv);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  uu = scaleV(uu, 1 / lu);
  vv = scaleV(vv, 1 / lv);
  return Math.atan2(dot(n, cross(uu, vv)), dot(uu, vv));
}

function withinLimits(j) {
  return JOINT_KEYS.every((k) => {
    const r = RANGES[k];
    return j[k] >= r[0] - 1e-3 && j[k] <= r[1] + 1e-3;
  });
}

function scoreIk(j, seed) {
  let s = 0;
  JOINT_KEYS.forEach((k) => {
    const r = RANGES[k];
    if (j[k] < r[0] || j[k] > r[1]) s += 25 + Math.abs(j[k] - clamp(j[k], r[0], r[1]));
    if (seed && seed[k] != null) s += 0.02 * Math.abs(j[k] - seed[k]);
  });
  s += 0.04 * Math.abs(j.shoulder);
  return s;
}

function ikAnalytic(config, target, seedDeg, a3des) {
  const { L1, L2, L3, baseH } = config;
  const base = Math.atan2(target.x, target.z);
  const r = Math.hypot(target.x, target.z);
  const y = target.y;
  const wristR = r - L3 * Math.cos(a3des);
  const wristY = y + L3 * Math.sin(a3des);
  let u = wristR;
  let v = baseH - wristY;
  let d = Math.hypot(u, v);
  let limited = false;
  const maxD = L1 + L2 - 1e-5;
  const minD = Math.abs(L1 - L2) + 1e-5;
  if (d > maxD) {
    limited = true;
    const s = maxD / (d || 1);
    u *= s;
    v *= s;
    d = maxD;
  } else if (d < minD) {
    limited = true;
    const s = minD / (d || 1e-9);
    u *= s;
    v *= s;
    d = minD;
  }
  const cosE = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
  const raw = Math.acos(cosE);
  const cands = [];
  [raw, -raw].forEach((e) => {
    const a1 = Math.atan2(v, u) - Math.atan2(L2 * Math.sin(e), L1 + L2 * Math.cos(e));
    const wrist = a3des - (a1 + e);
    const rawJ = {
      base: base * RAD,
      shoulder: a1 * RAD,
      elbow: e * RAD,
      wrist: wrist * RAD,
      roll: seedDeg && seedDeg.roll != null ? seedDeg.roll : 0,
      gripper: seedDeg && seedDeg.gripper != null ? seedDeg.gripper : 80,
    };
    const joints = cloneJoints(rawJ);
    const q = {
      base: joints.base * DEG,
      shoulder: joints.shoulder * DEG,
      elbow: joints.elbow * DEG,
      wrist: joints.wrist * DEG,
      roll: 0,
      gripper: 0,
    };
    const f = fk(config, q);
    const dist = Math.hypot(f.ee.x - target.x, f.ee.y - target.y, f.ee.z - target.z);
    const outOf = !withinLimits(rawJ);
    cands.push({
      joints,
      limited: limited || outOf || dist > 0.016,
      score: scoreIk(joints, seedDeg) + dist * 90 + (outOf ? 20 : 0) + (limited ? 6 : 0) + (e < 0 ? 1.5 : 0),
    });
  });
  cands.sort((a, b) => a.score - b.score);
  return cands[0];
}

function ikCcd(config, target, seedDeg) {
  const q = {
    base: (seedDeg.base || 0) * DEG,
    shoulder: (seedDeg.shoulder || 0) * DEG,
    elbow: (seedDeg.elbow || 0) * DEG,
    wrist: (seedDeg.wrist || 0) * DEG,
    roll: (seedDeg.roll || 0) * DEG,
    gripper: seedDeg.gripper != null ? seedDeg.gripper : 80,
  };
  const names = ["wrist", "elbow", "shoulder", "base"];
  for (let iter = 0; iter < 18; iter++) {
    const f = fk(config, q);
    const err0 = Math.hypot(f.ee.x - target.x, f.ee.y - target.y, f.ee.z - target.z);
    if (err0 < 0.002) break;
    for (const name of names) {
      const cur = fk(config, q);
      const joint =
        name === "base" ? { x: 0, y: 0, z: 0 } :
        name === "shoulder" ? cur.shoulder :
        name === "elbow" ? cur.elbow :
        cur.wrist;
      const axis =
        name === "base"
          ? { x: 0, y: 1, z: 0 }
          : { x: Math.cos(q.base), y: 0, z: -Math.sin(q.base) };
      const ang = angleAroundAxis(sub(cur.ee, joint), sub(target, joint), axis);
      q[name] += ang * 0.8;
      const r = RANGES[name];
      if (name !== "gripper") q[name] = clamp(q[name], r[0] * DEG, r[1] * DEG);
    }
  }
  const joints = cloneJoints({
    base: q.base * RAD,
    shoulder: q.shoulder * RAD,
    elbow: q.elbow * RAD,
    wrist: q.wrist * RAD,
    roll: q.roll * RAD,
    gripper: q.gripper,
  });
  const f = fk(config, {
    base: joints.base * DEG,
    shoulder: joints.shoulder * DEG,
    elbow: joints.elbow * DEG,
    wrist: joints.wrist * DEG,
    roll: 0,
    gripper: 0,
  });
  const dist = Math.hypot(f.ee.x - target.x, f.ee.y - target.y, f.ee.z - target.z);
  return { joints, limited: dist > 0.012, score: dist * 40 + scoreIk(joints, seedDeg) };
}

function ikTo(config, target, seedDeg) {
  const seed = cloneJoints(seedDeg || HOME);
  const y = Math.max(0.012, target.y);
  const tgt = { x: target.x, y, z: target.z };
  const tries = [];
  [Math.PI / 2, 1.2, 0.9, 0.6, 0.3].forEach((a3) => {
    tries.push(ikAnalytic(config, tgt, seed, a3));
  });
  tries.push(ikCcd(config, tgt, seed));
  tries.sort((a, b) => a.score - b.score);
  const best = tries[0];
  return { joints: best.joints, limited: !!best.limited, reachable: !best.limited };
}

/* ---------- Fisica dei giunti (servo / PD) ---------- */

function massProps(config, qRad, extraMass) {
  const { L1, L2, L3, baseH, m1, m2, m3 } = config;
  const mp = (extraMass || 0) + (config.payload || 0);
  const a1 = qRad.shoulder;
  const a2 = a1 + qRad.elbow;
  const a3 = a2 + qRad.wrist;
  const pt = (l1, l2, l3) => planarPoint(L1, L2, L3, baseH, a1, qRad.elbow, qRad.wrist, [l1, l2, l3]);
  const c1 = pt(L1 / 2, 0, 0);
  const c2 = pt(L1, L2 / 2, 0);
  const c3 = pt(L1, L2, L3 / 2);
  const ee = pt(L1, L2, L3);
  const jS = pt(0, 0, 0);
  const jE = pt(L1, 0, 0);
  const jW = pt(L1, L2, 0);
  const masses = [
    [m1, c1],
    [m2, c2],
    [m3, c3],
    [mp, ee],
  ];
  function tauAt(j) {
    let t = 0;
    for (const [m, c] of masses) t += m * G * (c.z - j.z);
    return t;
  }
  function Iat(j) {
    let I = 0.00012;
    for (const [m, c] of masses) {
      const dz = c.z - j.z;
      const dy = c.y - j.y;
      I += m * (dz * dz + dy * dy);
    }
    return I;
  }
  let Ibase = 0.0018;
  for (const [m, c] of masses) Ibase += m * (c.z * c.z);
  return {
    tau: {
      base: 0,
      shoulder: tauAt(jS),
      elbow: tauAt(jE),
      wrist: tauAt(jW),
      roll: mp * 0.008 * G * Math.sin(qRad.roll || 0),
      gripper: 0,
    },
    I: {
      base: Math.max(Ibase, 0.004),
      shoulder: Math.max(Iat(jS), 0.004),
      elbow: Math.max(Iat(jE), 0.002),
      wrist: Math.max(Iat(jW), 0.001),
      roll: 0.0008 + mp * 0.0002,
      gripper: 0.0004,
    },
  };
}

function stepServos(state, targets, config, extraMass, dt) {
  const qRad = {
    base: state.base.q,
    shoulder: state.shoulder.q,
    elbow: state.elbow.q,
    wrist: state.wrist.q,
    roll: state.roll.q,
    gripper: state.gripper.q,
  };
  const props = massProps(config, qRad, extraMass);
  const servo = SERVO[config.servo] || SERVO.MG996R;
  const gripSpec = SERVO.SG90;
  let moving = false;

  for (const key of JOINT_KEYS) {
    const st = state[key];
    const spec = key === "gripper" ? gripSpec : servo;
    const tgtDeg = clampJoint(key, targets[key]);
    const tgt = key === "gripper" ? tgtDeg : tgtDeg * DEG;
    let err = tgt - st.q;
    if (key === "base" || key === "roll") err = wrapPi(err);

    const I = Math.max(props.I[key], 2e-5);
    const tauG = props.tau[key];
    if (key === "gripper") {
      const vmaxG = 180;
      const qdotG = clamp(err * 10, -vmaxG, vmaxG);
      let qNewG = st.q + qdotG * dt;
      if (qNewG < 0) { qNewG = 0; }
      if (qNewG > 100) { qNewG = 100; }
      st.q = qNewG;
      st.qdot = qdotG;
      st.tau = spec.stall * clamp(err / 30, -1, 1);
      st.sat = Math.abs(st.tau) >= spec.stall * 0.97;
      if (Math.abs(qdotG) > 0.4 || Math.abs(err) > 0.8) moving = true;
      continue;
    }

    const wn = 16;
    const zeta = 0.9;
    const Kp = I * wn * wn;
    const Kd = 2 * zeta * Math.sqrt(Math.max(I * Kp, 1e-8));
    const b = 0.05;
    const vmax = spec.maxSpeed;

    let tauCmd = Kp * err - Kd * st.qdot - tauG;
    let sat = false;
    if (tauCmd > spec.stall) {
      tauCmd = spec.stall;
      sat = true;
    } else if (tauCmd < -spec.stall) {
      tauCmd = -spec.stall;
      sat = true;
    }

    const tauNet = tauCmd + tauG - b * st.qdot;
    let qdot = st.qdot + (tauNet / I) * dt;
    qdot = clamp(qdot, -vmax, vmax);
    let qNew = st.q + qdot * dt;
    const lo = key === "gripper" ? 0 : RANGES[key][0] * DEG;
    const hi = key === "gripper" ? 100 : RANGES[key][1] * DEG;
    if (qNew < lo) {
      qNew = lo;
      qdot = 0;
    } else if (qNew > hi) {
      qNew = hi;
      qdot = 0;
    }
    if (Math.abs(err) < 0.003 && Math.abs(qdot) < 0.03 && !sat) {
      qdot *= 0.4;
      if (Math.abs(qdot) < 0.008) {
        qdot = 0;
        if (Math.abs(tauG) < spec.stall * 0.9) qNew = tgt;
      }
    }
    st.q = qNew;
    st.qdot = qdot;
    st.tau = tauCmd;
    st.sat = sat;
    if (Math.abs(qdot) > 0.015 || Math.abs(err) > 0.01) moving = true;
  }
  return moving;
}

function jointsSettled(state, targets, degTol) {
  const tol = (degTol || 4) * DEG;
  return JOINT_KEYS.every((k) => {
    const tgt = clampJoint(k, targets[k]);
    if (k === "gripper") return Math.abs(state[k].q - tgt) < 6 && Math.abs(state[k].qdot) < 8;
    return Math.abs(wrapPi(state[k].q - tgt * DEG)) < tol && Math.abs(state[k].qdot) < 0.25;
  });
}

/* ---------- Materiali PBR (realistici) ---------- */

function makeMaterials(dark, maxAniso) {
  const brushed = TX.brushedTexture();
  const turned = TX.turnedTexture();
  const carbon = TX.carbonTexture();
  const ridge = TX.ridgeTexture();
  [brushed, carbon].forEach((t) => {
    t.anisotropy = maxAniso;
  });
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phy = (o) => new THREE.MeshPhysicalMaterial(o);
  const brushedRep = brushed.clone();
  brushedRep.repeat.set(1, 6);
  brushedRep.needsUpdate = true;
  return {
    alu: std({ color: 0xd3d6db, metalness: 1, roughness: 0.5, roughnessMap: brushed, envMapIntensity: 1.1 }),
    aluTurned: std({ color: 0xd8dbe0, metalness: 1, roughness: 0.42, roughnessMap: turned, envMapIntensity: 1.15 }),
    aluBlack: std({ color: 0x1e2024, metalness: 0.8, roughness: 0.62, roughnessMap: brushed, envMapIntensity: 0.9 }),
    aluOrange: std({ color: 0xe8651c, metalness: 0.75, roughness: 0.42, roughnessMap: brushed, envMapIntensity: 1 }),
    steel: std({ color: 0xc4c8cd, metalness: 1, roughness: 0.24, envMapIntensity: 1.2 }),
    steelDark: std({ color: 0x7d8288, metalness: 1, roughness: 0.38, roughnessMap: brushedRep }),
    socket: std({ color: 0x0b0c0d, metalness: 0.6, roughness: 0.55 }),
    brass: std({ color: 0xc9a65a, metalness: 1, roughness: 0.3 }),
    servo: phy({ color: 0x121316, metalness: 0, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    servoBlue: phy({ color: 0x2457d6, metalness: 0, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    horn: std({ color: 0xefeee8, metalness: 0, roughness: 0.48 }),
    stickerMg: std({ map: TX.servoSticker("mg"), metalness: 0, roughness: 0.35 }),
    stickerSg: std({ map: TX.servoSticker("sg"), metalness: 0, roughness: 0.35 }),
    carbon: phy({ map: carbon, color: 0xffffff, metalness: 0.35, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.06 }),
    rubber: std({ color: 0x17171a, metalness: 0, roughness: 0.9 }),
    pad: std({ color: 0x1b1b1e, metalness: 0, roughness: 0.85, bumpMap: ridge, bumpScale: 2 }),
    sleeve: std({ color: 0x141518, metalness: 0.05, roughness: 0.7 }),
    tie: std({ color: 0xf2f2ee, metalness: 0, roughness: 0.55 }),
    wireBrown: std({ color: 0x4a2c1a, roughness: 0.45 }),
    wireRed: std({ color: 0xb01e18, roughness: 0.45 }),
    wireOrange: std({ color: 0xe0861a, roughness: 0.45 }),
    label: std({ map: TX.labelTexture(), metalness: 0.7, roughness: 0.38 }),
    led: std({ color: 0x0a2a12, emissive: 0x23ff6a, emissiveIntensity: 2.4, roughness: 0.2 }),
    marker: std({
      color: 0xff7a1a,
      metalness: 0,
      roughness: 0.4,
      emissive: 0xff7a1a,
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  };
}

function trackGeo(world, geo) {
  world.geoms.push(geo);
  return geo;
}

function addMesh(parent, world, geo, mat, pos, rot, shadow) {
  const m = new THREE.Mesh(geo, mat);
  if (shadow !== "none") {
    m.castShadow = shadow !== "recv";
    m.receiveShadow = true;
  }
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) {
    if (rot.length > 3) m.rotation.set(rot[0], rot[1], rot[2], rot[3]);
    else m.rotation.set(rot[0], rot[1], rot[2]);
  }
  parent.add(m);
  return m;
}

/* Geometrie riutilizzate (per mondo). */
function GC(world, key, make) {
  if (!world.geoCache) world.geoCache = new Map();
  if (!world.geoCache.has(key)) world.geoCache.set(key, trackGeo(world, make()));
  return world.geoCache.get(key);
}

function rbox(world, w, h, d, r, seg) {
  const rr = Math.max(0.0001, Math.min(r, Math.min(w, h, d) / 2 - 0.00005));
  const key = "rb" + [w, h, d, rr, seg || 2].map((n) => n.toFixed(5)).join(",");
  return GC(world, key, () => new RoundedBoxGeometry(w, h, d, seg || 2, rr));
}

function cyl(world, r1, r2, h, seg, open) {
  const key = "cy" + [r1, r2, h, seg].join(",") + (open ? "o" : "");
  return GC(world, key, () => new THREE.CylinderGeometry(r1, r2, h, seg, 1, !!open));
}

const AXIS_ROT = {
  "+y": [0, 0, 0],
  "-y": [Math.PI, 0, 0],
  "+x": [0, 0, -Math.PI / 2],
  "-x": [0, 0, Math.PI / 2],
  "+z": [Math.PI / 2, 0, 0],
  "-z": [-Math.PI / 2, 0, 0],
};

/* Vite a brugola (testa cilindrica con esagono incassato). axis = direzione verso cui guarda la testa. */
function screw(parent, world, mats, pos, axis, size) {
  const s = size || 1;
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  const r = AXIS_ROT[axis || "+y"];
  g.rotation.set(r[0], r[1], r[2]);
  addMesh(g, world, cyl(world, 0.0014 * s, 0.0014 * s, 0.0013 * s, 12), mats.steel, [0, 0.00065 * s, 0], null, "none");
  addMesh(g, world, cyl(world, 0.00072 * s, 0.00072 * s, 0.0003, 6), mats.socket, [0, 0.0013 * s + 0.0001, 0], null, "none");
  parent.add(g);
  return g;
}

function washer(parent, world, mats, pos, axis, r) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  const rr = AXIS_ROT[axis || "+y"];
  g.rotation.set(rr[0], rr[1], rr[2]);
  addMesh(g, world, cyl(world, r || 0.0028, r || 0.0028, 0.0006, 16), mats.steel, [0, 0.0003, 0], null, "none");
  parent.add(g);
  return g;
}

/* Piastra estrusa nel piano (z,y), spessore lungo x, centrata in x. */
function plateZY(world, key, shape, thick) {
  return GC(world, key, () => {
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thick,
      bevelEnabled: true,
      bevelThickness: 0.0004,
      bevelSize: 0.0004,
      bevelSegments: 1,
      curveSegments: 18,
    });
    geo.rotateY(-Math.PI / 2);
    geo.translate(thick / 2, 0, 0);
    scaleUv(geo, 9);
    return geo;
  });
}

function scaleUv(geo, s) {
  const uv = geo.getAttribute("uv");
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  uv.needsUpdate = true;
}

/* Profilo a "orecchia": rettangolo z∈[z0,z1], y∈[-h,h] con estremità arrotondata attorno a (zc,0). */
function earShape(z0, z1, h, zc, holeR, extraHoles) {
  const s = new THREE.Shape();
  if (zc >= z1 - 1e-6) {
    s.moveTo(z0, -h);
    s.lineTo(zc, -h);
    s.absarc(zc, 0, h, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(z0, h);
    s.lineTo(z0, -h);
  } else {
    s.moveTo(z1, h);
    s.lineTo(zc, h);
    s.absarc(zc, 0, h, Math.PI / 2, Math.PI * 1.5, false);
    s.lineTo(z1, -h);
    s.lineTo(z1, h);
  }
  if (holeR) {
    const hole = new THREE.Path();
    hole.absarc(zc, 0, holeR, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  (extraHoles || []).forEach((hh) => {
    const p = new THREE.Path();
    if (hh.len) {
      const r = hh.r;
      p.moveTo(hh.z - hh.len / 2, hh.y - r);
      p.lineTo(hh.z + hh.len / 2, hh.y - r);
      p.absarc(hh.z + hh.len / 2, hh.y, r, -Math.PI / 2, Math.PI / 2, false);
      p.lineTo(hh.z - hh.len / 2, hh.y + r);
      p.absarc(hh.z - hh.len / 2, hh.y, r, Math.PI / 2, Math.PI * 1.5, false);
    } else {
      p.absarc(hh.z, hh.y, hh.r, 0, Math.PI * 2, true);
    }
    s.holes.push(p);
  });
  return s;
}

/* Servo: asse di uscita lungo +y locale nell'origine, corpo verso -y, lunghezza lungo z. */
const SERVO_DIM = {
  mg: { W: 0.0197, L: 0.0407, H: 0.03, shaftZ: 0.0103, flange: 0.0072, flY: -0.009, hornR: 0.0105, top: 0.0058 },
  sg: { W: 0.0122, L: 0.0226, H: 0.0165, shaftZ: 0.0057, flange: 0.0047, flY: -0.0045, hornR: 0.0065, top: 0.0042 },
};

function buildServoBody(world, mats, kind) {
  const d = SERVO_DIM[kind];
  const sg = kind === "sg";
  const g = new THREE.Group();
  const body = sg ? mats.servoBlue : mats.servo;
  const zc = d.shaftZ - d.L / 2;
  addMesh(g, world, rbox(world, d.W, d.H, d.L, 0.0011, 2), body, [0, -d.H / 2, zc]);
  // flange con passacavi in gomma
  addMesh(g, world, rbox(world, d.W, sg ? 0.0018 : 0.0025, d.L + d.flange * 2, 0.0006, 1), body, [0, d.flY, zc]);
  const gromR = sg ? 0.0013 : 0.002;
  [-1, 1].forEach((sz) => {
    [-1, 1].forEach((sx) => {
      if (sg && sx > 0) return;
      const px = sg ? 0 : sx * d.W * 0.26;
      const pz = zc + sz * (d.L / 2 + d.flange * 0.5);
      addMesh(g, world, cyl(world, gromR, gromR, sg ? 0.0028 : 0.0042, 12), mats.rubber, [px, d.flY, pz], null, "none");
      addMesh(g, world, cyl(world, gromR * 0.55, gromR * 0.55, sg ? 0.0031 : 0.0046, 10), mats.brass, [px, d.flY, pz], null, "none");
    });
  });
  // corpo superiore a gradino e boss dell'albero
  addMesh(g, world, rbox(world, d.W * 0.98, d.top, d.L * 0.62, 0.001, 2), body, [0, d.top / 2 - 0.0002, d.shaftZ - d.L * 0.31]);
  addMesh(g, world, cyl(world, d.W * 0.34, d.W * 0.36, 0.0022, 20), body, [0, d.top + 0.0009, 0]);
  addMesh(g, world, cyl(world, d.W * 0.13, d.W * 0.13, 0.0022, 14), mats.brass, [0, d.top + 0.0028, 0], null, "none");
  // etichette sui due fianchi
  const stickerGeo = GC(world, "stk" + kind, () => new THREE.PlaneGeometry(d.L * 0.86, d.H * 0.46));
  const sm = sg ? mats.stickerSg : mats.stickerMg;
  addMesh(g, world, stickerGeo, sm, [d.W / 2 + 0.00012, -d.H * 0.52, zc], [0, Math.PI / 2, 0], "none");
  addMesh(g, world, stickerGeo, sm, [-d.W / 2 - 0.00012, -d.H * 0.52, zc], [0, -Math.PI / 2, 0], "none");
  // uscita cavi (marrone, rosso, arancio)
  const wz = zc - d.L / 2;
  addMesh(g, world, rbox(world, d.W * 0.36, 0.0035, 0.004, 0.0008, 1), body, [0, -d.H + 0.003, wz - 0.0015], null, "none");
  const wires = [mats.wireBrown, mats.wireRed, mats.wireOrange];
  wires.forEach((m, i) => {
    const x = (i - 1) * 0.0011;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, -d.H + 0.003, wz - 0.003),
      new THREE.Vector3(x, -d.H + 0.0015, wz - 0.008),
      new THREE.Vector3(x * 1.4, -d.H - 0.004, wz - 0.011),
    ]);
    const geo = trackGeo(world, new THREE.TubeGeometry(curve, 8, 0.00055, 5, false));
    addMesh(g, world, geo, m, null, null, "none");
  });
  g.userData.kind = kind;
  return g;
}

/* Squadretta bianca (horn) a croce; si monta sul giunto distale. */
function buildHorn(world, mats, kind) {
  const d = SERVO_DIM[kind];
  const g = new THREE.Group();
  const y = d.top + 0.0045;
  addMesh(g, world, cyl(world, d.hornR, d.hornR, 0.0018, 28), mats.horn, [0, y, 0]);
  addMesh(g, world, cyl(world, d.W * 0.2, d.W * 0.2, 0.0034, 16), mats.horn, [0, y - 0.0012, 0], null, "none");
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 4;
    addMesh(g, world, cyl(world, d.hornR * 0.11, d.hornR * 0.11, 0.0005, 8), mats.socket, [Math.cos(a) * d.hornR * 0.68, y + 0.0007, Math.sin(a) * d.hornR * 0.68], null, "none");
  }
  screw(g, world, mats, [0, y + 0.0009, 0], "+y", kind === "sg" ? 0.7 : 1);
  return g;
}

/* Fascio di cavi in guaina con fascette. */
function sleeveCable(parent, world, mats, pts, r, ties) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const geo = trackGeo(world, new THREE.TubeGeometry(curve, Math.max(12, pts.length * 10), r, 8, false));
  addMesh(parent, world, geo, mats.sleeve, null, null);
  const tieGeo = GC(world, "tie" + r.toFixed(4), () => new THREE.TorusGeometry(r + 0.0004, 0.00055, 5, 14));
  const zAxis = new THREE.Vector3(0, 0, 1);
  (ties || []).forEach((t) => {
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const m = new THREE.Mesh(tieGeo, mats.tie);
    m.position.copy(p);
    m.quaternion.setFromUnitVectors(zAxis, tan);
    parent.add(m);
    const head = new THREE.Mesh(rbox(world, 0.0022, 0.0018, 0.0026, 0.0004, 1), mats.tie);
    head.position.copy(p).add(new THREE.Vector3(0, r + 0.0008, 0));
    head.quaternion.copy(m.quaternion);
    parent.add(head);
  });
  return curve;
}

/*
 * Modulo di giunto (asse lungo x nell'origine del gruppo):
 *  - prossimale (nel gruppo padre): servo con albero verso +x, orecchie con foro.
 *  - distale (nel gruppo figlio): forcella esterna, horn bianco, cuscinetto sull'altro lato.
 */
const CLEVIS_X = 0.026;
const EAR_X = 0.0215;
const JR = 0.016;

function proximalJoint(parent, world, mats, at, opts) {
  const o = opts || {};
  const servo = buildServoBody(world, mats, "mg");
  // albero verso +x: rotazione z -90°, horn a x = CLEVIS_X - 0.0015
  const hornTop = SERVO_DIM.mg.top + 0.0054;
  servo.position.set(at[0] + (CLEVIS_X - 0.0016 - hornTop), at[1], at[2]);
  servo.rotation.set(0, 0, -Math.PI / 2);
  parent.add(servo);
  // perno del cuscinetto sul retro
  const backX = servo.position.x - SERVO_DIM.mg.H - 0.0002;
  const pinLen = backX - (-CLEVIS_X + 0.0015);
  if (pinLen > 0.0005) {
    addMesh(parent, world, cyl(world, 0.0032, 0.0032, pinLen, 16), mats.steel, [backX - pinLen / 2, at[1], at[2]], AXIS_ROT["+x"], "none");
  }
  if (!o.noEars) {
    const t = 0.0028;
    const z0 = at[2] - (o.earLen || 0.042);
    const key = "ear" + (o.earLen || 0.042);
    const shape = earShape(z0 - at[2], 0, JR, 0, 0.0118, [{ z: -(o.earLen || 0.042) * 0.62, y: 0, r: 0.0045, len: (o.earLen || 0.042) * 0.32 }]);
    const geo = plateZY(world, key, shape, t);
    [-1, 1].forEach((sx) => {
      addMesh(parent, world, geo, mats.alu, [sx * EAR_X, at[1], at[2]]);
      // viti della flangia del servo
      [-1, 1].forEach((sz) => {
        screw(parent, world, mats, [sx * (EAR_X + t / 2 + 0.0004), at[1] + 0.0105 * sz, at[2] - 0.006], sx > 0 ? "+x" : "-x", 0.9);
        screw(parent, world, mats, [sx * (EAR_X + t / 2 + 0.0004), at[1] + 0.0105 * sz, at[2] - 0.034], sx > 0 ? "+x" : "-x", 0.9);
      });
    });
    // piastra di collegamento delle orecchie
    addMesh(parent, world, rbox(world, EAR_X * 2 + t, 0.026, 0.003, 0.0008, 1), mats.alu, [at[0], at[1], z0 + 0.0015]);
  }
  return servo;
}

function distalJoint(parent, world, mats, opts) {
  const o = opts || {};
  const t = 0.003;
  const len = o.len || 0.034;
  const shape = earShape(0, len, JR, 0, 0, o.slot ? [{ z: len * 0.62, y: 0, r: 0.004, len: len * 0.35 }] : []);
  const geo = plateZY(world, "clevis" + len + (o.slot ? "s" : ""), shape, t);
  addMesh(parent, world, geo, mats.alu, [CLEVIS_X, 0, 0]);
  addMesh(parent, world, geo, mats.alu, [-CLEVIS_X, 0, 0]);
  // horn sul lato +x (interno) e viti visibili all'esterno
  const horn = buildHorn(world, mats, "mg");
  horn.rotation.set(0, 0, -Math.PI / 2);
  horn.position.set(CLEVIS_X - t / 2 - 0.0016 - (SERVO_DIM.mg.top + 0.0054), 0, 0);
  parent.add(horn);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    screw(parent, world, mats, [CLEVIS_X + t / 2 + 0.0002, Math.cos(a) * 0.0072, Math.sin(a) * 0.0072], "+x", 0.85);
  }
  addMesh(parent, world, cyl(world, 0.0042, 0.0042, 0.0012, 20), mats.aluOrange, [CLEVIS_X + t / 2 + 0.0006, 0, 0], AXIS_ROT["+x"]);
  screw(parent, world, mats, [CLEVIS_X + t / 2 + 0.0012, 0, 0], "+x", 1.1);
  // cuscinetto flangiato sul lato -x
  addMesh(parent, world, cyl(world, 0.0068, 0.0068, 0.0016, 24), mats.steel, [-CLEVIS_X - t / 2 - 0.0008, 0, 0], AXIS_ROT["-x"]);
  addMesh(parent, world, cyl(world, 0.0046, 0.0046, 0.0019, 20), mats.socket, [-CLEVIS_X - t / 2 - 0.0008, 0, 0], AXIS_ROT["-x"], "none");
  addMesh(parent, world, cyl(world, 0.0034, 0.0034, 0.0024, 6), mats.steel, [-CLEVIS_X - t / 2 - 0.0012, 0, 0], AXIS_ROT["-x"], "none");
  if (!o.noWeb) {
    addMesh(parent, world, rbox(world, CLEVIS_X * 2 + t, 0.026, 0.003, 0.0008, 1), mats.alu, [0, 0, len - 0.0015]);
  }
}

/* Tratto di braccio: tubo quadro in alluminio + copertura in carbonio + cavi. */
function linkTube(parent, world, mats, z0, z1, side) {
  const len = z1 - z0;
  if (len < 0.006) return;
  const zc = (z0 + z1) / 2;
  addMesh(parent, world, rbox(world, 0.03, 0.022, len, 0.0026, 2), mats.alu, [0, 0, zc]);
  // canalina inferiore scura
  addMesh(parent, world, rbox(world, 0.018, 0.0016, len * 0.92, 0.0006, 1), mats.aluBlack, [0, -0.0112, zc], null, "none");
  // copertura in carbonio con viti
  addMesh(parent, world, rbox(world, 0.026, 0.0016, len * 0.9, 0.0007, 1), mats.carbon, [0, 0.0118, zc]);
  [-1, 1].forEach((sz) => {
    [-1, 1].forEach((sx) => {
      screw(parent, world, mats, [sx * 0.0095, 0.0126, zc + sz * len * 0.4], "+y", 0.8);
    });
  });
  // fascio cavi sul fianco
  const x = (side || 1) * 0.0175;
  sleeveCable(parent, world, mats, [
    [x, -0.004, z1 + 0.004],
    [x + 0.0005 * side, -0.006, zc + len * 0.25],
    [x + 0.0005 * side, -0.006, zc - len * 0.25],
    [x, -0.004, z0 - 0.004],
  ], 0.0024, [0.18, 0.5, 0.82]);
}

function buildArm(world, mats, config) {
  const { L1, L2, L3, baseH } = config;
  const root = new THREE.Group();
  const joint = (g) => {
    g.userData.joint = true;
    return g;
  };

  /* --- base fissa --- */
  const baseFixed = joint(new THREE.Group());
  root.add(baseFixed);
  addMesh(baseFixed, world, rbox(world, 0.16, 0.012, 0.16, 0.0035, 3), mats.aluBlack, [0, 0.006, 0], null, "recv");
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
    washer(baseFixed, world, mats, [sx * 0.068, 0.012, sz * 0.068], "+y", 0.0034);
    screw(baseFixed, world, mats, [sx * 0.068, 0.0126, sz * 0.068], "+y", 1.4);
  });
  addMesh(baseFixed, world, cyl(world, 0.058, 0.06, 0.010, 48, true), mats.alu, [0, 0.017, 0]);
  addMesh(baseFixed, world, GC(world, "ringTop", () => new THREE.RingGeometry(0.038, 0.058, 48, 1)), mats.aluTurned, [0, 0.022, 0], [-Math.PI / 2, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    screw(baseFixed, world, mats, [Math.cos(a) * 0.052, 0.022, Math.sin(a) * 0.052], "+y", 1);
  }
  addMesh(baseFixed, world, GC(world, "gap", () => new THREE.TorusGeometry(0.0378, 0.0008, 6, 48)), mats.socket, [0, 0.0222, 0], [Math.PI / 2, 0, 0], "none");
  // targhetta e LED di stato
  const lab = addMesh(baseFixed, world, GC(world, "labelPlane", () => new THREE.PlaneGeometry(0.056, 0.014)), mats.label, [0.069, 0.01215, 0.0], [-Math.PI / 2, Math.PI / 2, 0, "YXZ"], "none");
  lab.receiveShadow = true;
  addMesh(baseFixed, world, cyl(world, 0.0045, 0.0048, 0.0016, 20), mats.steel, [0.064, 0.0128, 0.052], null, "none");
  const ledGeo = GC(world, "led", () => new THREE.SphereGeometry(0.0031, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  addMesh(baseFixed, world, ledGeo, mats.led, [0.064, 0.0136, 0.052], null, "none");
  // cavo di alimentazione che esce sul tappetino
  addMesh(baseFixed, world, rbox(world, 0.009, 0.0075, 0.012, 0.002, 2), mats.rubber, [-0.02, 0.006, -0.083]);
  sleeveCable(baseFixed, world, mats, [
    [-0.02, 0.0045, -0.088],
    [-0.022, 0.003, -0.11],
    [-0.04, 0.0028, -0.15],
    [-0.09, 0.0028, -0.19],
    [-0.2, 0.0028, -0.25],
    [-0.45, 0.0028, -0.33],
  ], 0.0028, []);

  /* --- base rotante --- */
  const base = joint(new THREE.Group());
  root.add(base);
  addMesh(base, world, cyl(world, 0.036, 0.036, 0.009, 40, true), mats.alu, [0, 0.0265, 0]);
  addMesh(base, world, GC(world, "turnCap", () => new THREE.CircleGeometry(0.036, 40)), mats.aluTurned, [0, 0.031, 0], [-Math.PI / 2, 0, 0]);
  addMesh(base, world, GC(world, "turnRing", () => new THREE.TorusGeometry(0.036, 0.0012, 6, 40)), mats.aluOrange, [0, 0.031, 0], [Math.PI / 2, 0, 0], "none");
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    screw(base, world, mats, [Math.cos(a) * 0.03, 0.031, Math.sin(a) * 0.03], "+y", 0.9);
  }
  // torretta: due spalle verticali con foro e alleggerimento
  const towerH = Math.max(0.012, baseH - 0.031);
  const tShape = new THREE.Shape();
  const zf = 0.018, zb = -0.038;
  tShape.moveTo(zb, -towerH);
  tShape.lineTo(zf, -towerH);
  tShape.lineTo(zf, 0);
  tShape.absarc(0, 0, zf, 0, Math.PI, false);
  tShape.lineTo(zb, 0);
  tShape.lineTo(zb, -towerH);
  const th = new THREE.Path();
  th.absarc(0, 0, 0.0118, 0, Math.PI * 2, true);
  tShape.holes.push(th);
  if (towerH > 0.03) {
    const lh = new THREE.Path();
    lh.absarc(-0.012, -towerH * 0.55, Math.min(0.009, towerH * 0.2), 0, Math.PI * 2, true);
    tShape.holes.push(lh);
  }
  const towerGeo = plateZY(world, "tower" + towerH.toFixed(4), tShape, 0.0034);
  addMesh(base, world, towerGeo, mats.alu, [EAR_X, baseH, 0]);
  addMesh(base, world, towerGeo, mats.alu, [-EAR_X, baseH, 0]);
  addMesh(base, world, rbox(world, EAR_X * 2 + 0.0034, 0.004, zf - zb, 0.001, 1), mats.aluBlack, [0, 0.033, (zf + zb) / 2]);
  addMesh(base, world, rbox(world, EAR_X * 2 + 0.0034, Math.max(0.008, towerH - 0.02), 0.003, 0.0008, 1), mats.alu, [0, 0.031 + Math.max(0.008, towerH - 0.02) / 2 + 0.002, zb + 0.0015]);
  [-1, 1].forEach((sx) => {
    [0.012, -0.03].forEach((z) => screw(base, world, mats, [sx * (EAR_X + 0.0021), 0.037, z], sx > 0 ? "+x" : "-x", 0.9));
    screw(base, world, mats, [sx * (EAR_X + 0.0021), baseH + 0.0105, -0.006], sx > 0 ? "+x" : "-x", 0.9);
    screw(base, world, mats, [sx * (EAR_X + 0.0021), baseH - 0.0105, -0.006], sx > 0 ? "+x" : "-x", 0.9);
  });
  proximalJoint(base, world, mats, [0, baseH, 0], { noEars: true });
  sleeveCable(base, world, mats, [
    [0.034, baseH - 0.006, 0.004],
    [0.036, baseH - 0.022, -0.01],
    [0.03, 0.045, -0.034],
    [0.012, 0.036, -0.045],
    [0.0, 0.032, -0.03],
  ], 0.0024, [0.5]);

  /* --- spalla / braccio --- */
  const shoulder = joint(new THREE.Group());
  shoulder.position.set(0, baseH, 0);
  base.add(shoulder);
  const upper = new THREE.Group();
  shoulder.add(upper);
  distalJoint(upper, world, mats, { len: 0.036, slot: true });
  linkTube(upper, world, mats, 0.036, L1 - 0.042, 1);
  proximalJoint(upper, world, mats, [0, 0, L1]);
  sleeveCable(upper, world, mats, [
    [0.0175, -0.004, 0.04],
    [0.03, -0.006, 0.022],
    [0.034, -0.006, 0.004],
  ], 0.0024, []);

  /* --- gomito / avambraccio --- */
  const elbow = joint(new THREE.Group());
  elbow.position.set(0, 0, L1);
  upper.add(elbow);
  const fore = new THREE.Group();
  elbow.add(fore);
  distalJoint(fore, world, mats, { len: 0.034, slot: true });
  linkTube(fore, world, mats, 0.034, L2 - 0.042, -1);
  proximalJoint(fore, world, mats, [0, 0, L2]);
  sleeveCable(fore, world, mats, [
    [-0.0175, -0.004, 0.038],
    [-0.03, -0.006, 0.022],
    [-0.034, -0.006, 0.004],
  ], 0.0024, []);

  /* --- polso con servo di rotazione --- */
  const wrist = joint(new THREE.Group());
  wrist.position.set(0, 0, L2);
  fore.add(wrist);
  distalJoint(wrist, world, mats, { len: 0.05, noWeb: true });
  addMesh(wrist, world, rbox(world, CLEVIS_X * 2 + 0.003, 0.003, 0.034, 0.0008, 1), mats.alu, [0, -0.0155, 0.031]);
  const rServo = buildServoBody(world, mats, "mg");
  const rollHornZ = 0.05;
  rServo.rotation.set(Math.PI / 2, 0, 0);
  rServo.position.set(0, 0, rollHornZ - (SERVO_DIM.mg.top + 0.0054));
  wrist.add(rServo);
  [-1, 1].forEach((sx) => {
    addMesh(wrist, world, rbox(world, CLEVIS_X - 0.0115, 0.008, 0.012, 0.0008, 1), mats.aluBlack, [sx * (0.0099 + (CLEVIS_X - 0.0115) / 2 + 0.0002), 0.006, 0.03]);
    screw(wrist, world, mats, [sx * (CLEVIS_X + 0.0017), 0.006, 0.03], sx > 0 ? "+x" : "-x", 0.9);
    screw(wrist, world, mats, [sx * (CLEVIS_X + 0.0017), -0.0155, 0.042], sx > 0 ? "+x" : "-x", 0.8);
  });

  const roll = joint(new THREE.Group());
  wrist.add(roll);
  const rHorn = buildHorn(world, mats, "mg");
  rHorn.rotation.set(Math.PI / 2, 0, 0);
  rHorn.position.set(0, 0, rollHornZ - (SERVO_DIM.mg.top + 0.0054));
  roll.add(rHorn);
  addMesh(roll, world, cyl(world, 0.0145, 0.0145, 0.0035, 32), mats.aluOrange, [0, 0, rollHornZ + 0.00175], AXIS_ROT["+z"]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    screw(roll, world, mats, [Math.cos(a) * 0.0105, Math.sin(a) * 0.0105, rollHornZ + 0.0035], "+z", 0.8);
  }

  /* --- pinza a slitte parallele (SG90) --- */
  const gripRoot = new THREE.Group();
  roll.add(gripRoot);
  const gz0 = rollHornZ + 0.0035;
  const plateZ1 = Math.max(gz0 + 0.02, L3 - 0.016);
  const plateLen = plateZ1 - gz0;
  const plateW = 0.082;
  addMesh(gripRoot, world, rbox(world, 0.046, 0.03, 0.0028, 0.0009, 1), mats.alu, [0, 0, gz0 + 0.0014]);
  addMesh(gripRoot, world, rbox(world, plateW, 0.0024, plateLen, 0.0008, 1), mats.carbon, [0, 0.0135, gz0 + plateLen / 2]);
  addMesh(gripRoot, world, rbox(world, plateW, 0.0024, plateLen, 0.0008, 1), mats.carbon, [0, -0.0135, gz0 + plateLen / 2]);
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
    const px = sx * (plateW / 2 - 0.004);
    const pz = gz0 + plateLen / 2 + sz * (plateLen / 2 - 0.004);
    addMesh(gripRoot, world, cyl(world, 0.0022, 0.0022, 0.0246, 6), mats.brass, [px, 0, pz], null, "none");
    screw(gripRoot, world, mats, [px, 0.0147, pz], "+y", 0.8);
    screw(gripRoot, world, mats, [px, -0.0147, pz], "-y", 0.8);
  });
  const sg = buildServoBody(world, mats, "sg");
  const gearZ = gz0 + 0.009;
  sg.position.set(-0.0062, 0.0122 - (SERVO_DIM.sg.top + 0.0006), gearZ);
  sg.rotation.set(0, Math.PI / 2, 0);
  gripRoot.add(sg);
  // guide in acciaio
  const railY = 0.0178;
  const railZ = [plateZ1 - 0.0105, plateZ1 - 0.0045];
  railZ.forEach((z) => {
    addMesh(gripRoot, world, cyl(world, 0.0012, 0.0012, plateW - 0.004, 12), mats.steel, [0, railY, z], AXIS_ROT["+x"], "none");
  });
  [-1, 1].forEach((sx) => {
    addMesh(gripRoot, world, rbox(world, 0.004, 0.0075, 0.012, 0.0008, 1), mats.aluBlack, [sx * (plateW / 2 - 0.002), railY - 0.0006, plateZ1 - 0.0075]);
  });
  // ingranaggi
  const gearGeo = GC(world, "gear", () => gearGeometry(0.0062, 14, 0.0026));
  const pinion = joint(new THREE.Group());
  pinion.position.set(-0.0062, 0.0148, gearZ);
  gripRoot.add(pinion);
  addMesh(pinion, world, gearGeo, mats.brass, [0, 0, 0]);
  screw(pinion, world, mats, [0, 0.0026, 0], "+y", 0.7);
  const gear2 = joint(new THREE.Group());
  gear2.position.set(0.0062, 0.0148, gearZ);
  gripRoot.add(gear2);
  addMesh(gear2, world, gearGeo, mats.brass, [0, 0, 0]);
  screw(gear2, world, mats, [0, 0.0026, 0], "+y", 0.7);

  const jawL = joint(new THREE.Group());
  const jawR = joint(new THREE.Group());
  gripRoot.add(jawL);
  gripRoot.add(jawR);
  const fingerZ0 = plateZ1 - 0.001;
  const fingerZ1 = L3 + 0.012;
  const fLen = Math.max(0.012, fingerZ1 - fingerZ0);
  const padLen = Math.min(0.022, fLen - 0.002);
  [[jawL, 1], [jawR, -1]].forEach(([jaw, s]) => {
    // s = +1: dita a sinistra (x negativa), faccia interna in x=0
    const carriageX = -s * 0.0075;
    addMesh(jaw, world, rbox(world, 0.008, 0.006, 0.014, 0.001, 1), mats.alu, [carriageX, railY, plateZ1 - 0.0075]);
    addMesh(jaw, world, rbox(world, 0.006, 0.0075, 0.012, 0.001, 1), mats.alu, [-s * 0.0047, railY - 0.0008, plateZ1 + 0.003]);
    const finger = addMesh(jaw, world, rbox(world, 0.0036, 0.034, fLen, 0.0012, 2), mats.alu, [-s * 0.0049, 0.0022, fingerZ0 + fLen / 2]);
    finger.castShadow = true;
    addMesh(jaw, world, rbox(world, 0.003, 0.026, padLen, 0.001, 2), mats.pad, [-s * 0.0016, 0.0005, fingerZ1 - 0.001 - padLen / 2]);
    screw(jaw, world, mats, [-s * 0.0068, 0.012, fingerZ0 + fLen * 0.55], s > 0 ? "-x" : "+x", 0.75);
    screw(jaw, world, mats, [-s * 0.0068, -0.009, fingerZ0 + fLen * 0.55], s > 0 ? "-x" : "+x", 0.75);
    screw(jaw, world, mats, [carriageX, railY + 0.003, plateZ1 - 0.0075], "+y", 0.7);
  });

  const ee = new THREE.Group();
  ee.position.set(0, 0, L3);
  gripRoot.add(ee);

  root.updateMatrixWorld(true);
  [baseFixed, base, shoulder, elbow, wrist, roll, pinion, gear2, jawL, jawR].forEach((g) => flattenGroup(world, g));

  const parts = { root, base, shoulder, elbow, wrist, roll, jawL, jawR, ee, gripRoot, upper, fore, pinion, gear2 };
  return parts;
}

function gearGeometry(r, teeth, thick) {
  const s = new THREE.Shape();
  const rr = r * 0.82;
  const ro = r * 1.08;
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ph = i % 4;
    const rad = ph === 1 || ph === 2 ? ro : rr;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.22, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/* Unisce le mesh rigide di ogni giunto per materiale: meno draw call su iPhone. */
function flattenGroup(world, group) {
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  group.traverse((obj) => {
    if (obj === group || !obj.isMesh) return;
    let p = obj.parent;
    while (p && p !== group) {
      if (p.userData.joint) return;
      p = p.parent;
    }
    const m = new THREE.Matrix4().multiplyMatrices(inv, obj.matrixWorld);
    let geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    Object.keys(geo.attributes).forEach((k) => {
      if (k !== "position" && k !== "normal" && k !== "uv") geo.deleteAttribute(k);
    });
    if (!geo.getAttribute("uv")) {
      geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
    }
    geo.clearGroups();
    geo.applyMatrix4(m);
    const key = obj.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat: obj.material, cast: false, recv: false, list: [] });
    const b = buckets.get(key);
    b.cast = b.cast || obj.castShadow;
    b.recv = b.recv || obj.receiveShadow;
    b.list.push(geo);
    remove.push(obj);
  });
  remove.forEach((obj) => obj.parent && obj.parent.remove(obj));
  buckets.forEach((b) => {
    const merged = mergeGeometries(b.list, false);
    b.list.forEach((g) => g.dispose());
    if (!merged) return;
    trackGeo(world, merged);
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    group.add(mesh);
  });
}

function applyJoints(parts, j) {
  const g = clampJoint("gripper", j.gripper);
  parts.base.rotation.y = clampJoint("base", j.base) * DEG;
  parts.shoulder.rotation.x = clampJoint("shoulder", j.shoulder) * DEG;
  parts.elbow.rotation.x = clampJoint("elbow", j.elbow) * DEG;
  parts.wrist.rotation.x = clampJoint("wrist", j.wrist) * DEG;
  parts.roll.rotation.z = clampJoint("roll", j.roll) * DEG;
  const open = 0.004 + (g / 100) * 0.022;
  parts.jawL.position.x = -open;
  parts.jawR.position.x = open;
  if (parts.pinion) parts.pinion.rotation.y = open / 0.0062;
  if (parts.gear2) parts.gear2.rotation.y = -open / 0.0062 + Math.PI / 14;
}

function jawWidth(gripper) {
  return 0.008 + (clampJoint("gripper", gripper) / 100) * 0.044;
}

/* ---------- Scena, luci, fisica oggetti ---------- */

function themePalette(dark) {
  return dark
    ? {
        bgTop: "#23262d",
        bgMid: "#16181d",
        fog: 0x121418,
        hemiSky: 0xb8c4e0,
        hemiGround: 0x2a2018,
        hemiInt: 0.18,
        keyInt: 2.6,
        rimInt: 0.9,
        env: 0.5,
        exposure: 1.0,
      }
    : {
        bgTop: "#f1efeb",
        bgMid: "#dedad3",
        fog: 0xd3cec6,
        hemiSky: 0xffffff,
        hemiGround: 0x8f8170,
        hemiInt: 0.35,
        keyInt: 2.9,
        rimInt: 0.8,
        env: 0.85,
        exposure: 1.0,
      };
}

function hexCss(n) {
  return "#" + n.toString(16).padStart(6, "0");
}

function applyBackdrop(world, pal) {
  world.scene.background = TX.backdropTexture(pal.bgTop, pal.bgMid, hexCss(pal.fog));
  if (!world.scene.fog) world.scene.fog = new THREE.Fog(pal.fog, 0.75, 2.6);
  world.scene.fog.color.set(pal.fog);
}

function createPhysics() {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -G, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 8;
  const floorMat = new CANNON.Material("floor");
  const objMat = new CANNON.Material("obj");
  world.addContactMaterial(
    new CANNON.ContactMaterial(floorMat, objMat, {
      friction: 0.45,
      restitution: 0.08,
    })
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(objMat, objMat, {
      friction: 0.4,
      restitution: 0.05,
    })
  );
  const floor = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    material: floorMat,
  });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  return { world, floorMat, objMat, floor };
}

/* Oggetti veri: blocco di faggio, scatolina di cartone, cilindro in alluminio, blocchetto d'acciaio. */
function objectMaterial(world, look) {
  let mat;
  if (look === "wood") {
    const w = TX.blockWood();
    mat = new THREE.MeshStandardMaterial({ map: w.map, roughnessMap: w.rough, roughness: 0.75, metalness: 0 });
  } else if (look === "cardboard") {
    mat = new THREE.MeshStandardMaterial({ map: TX.cardboardTexture(), roughness: 0.85, metalness: 0 });
  } else if (look === "alu") {
    mat = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: 0.38, roughnessMap: TX.brushedTexture() });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: 0xb4b9bf, metalness: 1, roughness: 0.34, roughnessMap: TX.brushedTexture() });
  }
  world.dynMats.push(mat);
  return mat;
}

function latheCylinder(r, h) {
  const c = Math.min(0.0012, r * 0.12);
  const pts = [
    [0, -h / 2],
    [r - c, -h / 2],
    [r, -h / 2 + c],
    [r, -h * 0.12],
    [r - 0.0007, -h * 0.1],
    [r - 0.0007, -h * 0.04],
    [r, -h * 0.02],
    [r, h / 2 - c],
    [r - c, h / 2],
    [r * 0.62, h / 2],
    [r * 0.6, h / 2 - 0.0006],
    [0, h / 2 - 0.0006],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.computeVertexNormals();
  return geo;
}

function makeObjectVisual(world, mats, kind, size, look) {
  const mat = objectMaterial(world, look);
  let mesh;
  let shape;
  let mass;
  if (kind === "cyl") {
    const r = size * 0.5;
    const h = size * 1.25;
    mesh = new THREE.Mesh(trackGeo(world, latheCylinder(r, h)), mat);
    shape = new CANNON.Cylinder(r, r, h, 10);
    mass = 0.045;
  } else {
    const rad = look === "cardboard" ? 0.0007 : look === "wood" ? 0.0022 : 0.0011;
    mesh = new THREE.Mesh(trackGeo(world, new RoundedBoxGeometry(size, size, size, 3, rad)), mat);
    shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
    mass = kind === "heavy" ? 0.22 : 0.04;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, shape, mass, size, kind };
}

function spawnObjects(world3, phys, mats) {
  const specs = [
    { kind: "cube", size: 0.028, look: "wood", pos: [0.1, 0.02, 0.2], mass: 0.045 },
    { kind: "cube", size: 0.024, look: "cardboard", pos: [-0.11, 0.018, 0.16], mass: 0.03 },
    { kind: "cyl", size: 0.026, look: "alu", pos: [0.16, 0.02, 0.1], mass: 0.05 },
    { kind: "heavy", size: 0.032, look: "steel", pos: [-0.05, 0.022, 0.24], mass: 0.22 },
  ];
  const blobTex = TX.blobTexture();
  const blobGeo = trackGeo(world3, new THREE.PlaneGeometry(1, 1));
  const list = [];
  specs.forEach((s) => {
    const vis = makeObjectVisual(world3, mats, s.kind, s.size, s.look);
    const body = new CANNON.Body({
      mass: s.mass,
      shape: vis.shape,
      material: phys.objMat,
      position: new CANNON.Vec3(s.pos[0], s.pos[1], s.pos[2]),
      linearDamping: 0.15,
      angularDamping: 0.2,
      allowSleep: true,
    });
    body.collisionFilterGroup = 4;
    body.collisionFilterMask = 1 | 2 | 4;
    phys.world.addBody(body);
    world3.scene.add(vis.mesh);
    const blobMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: blobTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    world3.dynMats.push(blobMat);
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.scale.setScalar(s.size * 2.1);
    blob.renderOrder = 1;
    world3.scene.add(blob);
    list.push({
      mesh: vis.mesh,
      blob,
      body,
      mass: s.mass,
      size: s.size,
      kind: s.kind,
      rest: s.pos.slice(),
    });
  });
  return list;
}

function resetObjects(list) {
  list.forEach((o) => {
    o.body.type = CANNON.Body.DYNAMIC;
    o.body.mass = o.mass;
    o.body.updateMassProperties();
    o.body.position.set(o.rest[0], o.rest[1] + 0.04, o.rest[2]);
    o.body.velocity.set(0, 0, 0);
    o.body.angularVelocity.set(0, 0, 0);
    o.body.quaternion.set(0, 0, 0, 1);
    o.body.collisionFilterMask = 1 | 2 | 4;
    o.body.wakeUp();
    o.held = false;
  });
}

function updateBlob(o) {
  if (!o.blob) return;
  const p = o.mesh.position;
  o.blob.position.set(p.x, MAT_Y + 0.0003, p.z);
  const lift = Math.max(0, p.y - o.size * 0.5);
  const k = clamp(1 - lift / 0.12, 0, 1);
  o.blob.material.opacity = 0.55 * k;
  o.blob.scale.setScalar(o.size * (2.1 + lift * 8));
  o.blob.visible = k > 0.02;
}

function syncObjects(list) {
  list.forEach((o) => {
    o.mesh.position.copy(o.body.position);
    o.mesh.quaternion.copy(o.body.quaternion);
    updateBlob(o);
  });
}

function objectsAwake(list) {
  return list.some((o) => o.body.sleepState !== CANNON.Body.SLEEPING);
}

const MAT_Y = 0.0004;

/* Qualità adattiva: [pixelRatio massimo, lato shadow map]. */
const QUALITY = [
  { pr: 1, shadow: 512 },
  { pr: 1.5, shadow: 1024 },
  { pr: 2, shadow: 1024 },
];

function applyQuality(world, level) {
  const q = QUALITY[clamp(level, 0, QUALITY.length - 1)];
  world.quality = level;
  world.renderer.setPixelRatio(Math.min(q.pr, window.devicePixelRatio || 1));
  if (world.key.shadow.mapSize.x !== q.shadow) {
    world.key.shadow.mapSize.set(q.shadow, q.shadow);
    if (world.key.shadow.map) {
      world.key.shadow.map.dispose();
      world.key.shadow.map = null;
    }
  }
}

function createWorld(container) {
  const dark = isDarkTheme();
  const pal = themePalette(dark);
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 8);
  if (cached.camPos) camera.position.copy(cached.camPos);
  else camera.position.set(0.4, 0.27, 0.44);
  camera.lookAt(0.02, 0.07, 0.1);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = pal.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = "arm-canvas";
  container.appendChild(renderer.domElement);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);

  let envMap = null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    envMap = pmrem.fromScene(envScene, 0.035).texture;
    scene.environment = envMap;
    scene.environmentIntensity = pal.env;
    scene.environmentRotation.set(0, -0.6, 0);
    envScene.dispose();
    pmrem.dispose();
  } catch (err) {
    console.warn("Mie Cose envmap:", err);
  }

  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiInt);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0de, pal.keyInt);
  key.position.set(0.42, 0.9, 0.38);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.2;
  key.shadow.camera.far = 2.2;
  key.shadow.camera.left = -0.42;
  key.shadow.camera.right = 0.42;
  key.shadow.camera.top = 0.42;
  key.shadow.camera.bottom = -0.42;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.004;
  key.shadow.radius = 4;
  key.target.position.set(0, 0, 0.06);
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xcfdcff, pal.rimInt);
  rim.position.set(-0.6, 0.35, -0.5);
  scene.add(rim);

  const geoms = [];
  const world = {
    scene,
    camera,
    renderer,
    hemi,
    key,
    dir: key,
    fill: rim,
    envMap,
    geoms,
    dynMats: [],
    mats: null,
    parts: null,
    armRoot: null,
    floor: null,
    marker: null,
    controls: null,
    pal,
    dark,
    quality: 2,
  };
  applyBackdrop(world, pal);

  world.mats = makeMaterials(dark, maxAniso);

  /* Banco da lavoro in legno + tappetino da taglio */
  const wood = TX.tableWood();
  const woodMap = wood.map;
  const woodRough = wood.rough;
  [woodMap, woodRough].forEach((t) => {
    t.repeat.set(8.75, 8.75);
    t.anisotropy = maxAniso;
  });
  const tableMat = new THREE.MeshStandardMaterial({ map: woodMap, roughnessMap: woodRough, roughness: 0.85, metalness: 0 });
  world.dynMats.push(tableMat);
  world.floor = addMesh(scene, world, trackGeo(world, new THREE.PlaneGeometry(7, 7)), tableMat, [0, 0, 0], [-Math.PI / 2, 0, 0], "recv");

  const matTex = TX.cuttingMat(64, 48);
  matTex.anisotropy = maxAniso;
  const matMat = new THREE.MeshStandardMaterial({
    map: matTex,
    roughness: 0.82,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  world.dynMats.push(matMat);
  addMesh(scene, world, trackGeo(world, new THREE.PlaneGeometry(0.64, 0.48)), matMat, [0.0, MAT_Y, 0.07], [-Math.PI / 2, 0, 0], "recv");
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1b4136, roughness: 0.8 });
  world.dynMats.push(edgeMat);
  [[0, 0.07 + 0.24], [0, 0.07 - 0.24]].forEach(([x, z]) => addMesh(scene, world, trackGeo(world, new THREE.BoxGeometry(0.64, 0.0016, 0.0012)), edgeMat, [x, 0.0004, z], null, "recv"));
  [-0.32, 0.32].forEach((x) => addMesh(scene, world, trackGeo(world, new THREE.BoxGeometry(0.0012, 0.0016, 0.48)), edgeMat, [x, 0.0004, 0.07], null, "recv"));

  // ombra di contatto morbida sotto la base
  const baseBlobMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: TX.blobTexture(),
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  world.dynMats.push(baseBlobMat);
  const baseBlob = addMesh(scene, world, trackGeo(world, new THREE.PlaneGeometry(0.24, 0.24)), baseBlobMat, [0, MAT_Y + 0.0002, 0], [-Math.PI / 2, 0, 0], "none");
  baseBlob.renderOrder = 1;

  const markGeo = trackGeo(world, new THREE.RingGeometry(0.009, 0.013, 32));
  world.marker = addMesh(scene, world, markGeo, world.mats.marker, [0, 0.0012, 0], [-Math.PI / 2, 0, 0], "none");
  world.marker.renderOrder = 2;
  world.marker.visible = false;

  const config = sanitizeConfig(null);
  world.parts = buildArm(world, world.mats, config);
  world.armRoot = world.parts.root;
  scene.add(world.armRoot);
  world.config = config;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.16;
  controls.maxDistance = 1.3;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.target.set(0.02, 0.07, 0.1);
  if (cached.camTarget) controls.target.copy(cached.camTarget);
  controls.update();
  world.controls = controls;

  applyQuality(world, 2);
  return world;
}

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m && m.dispose && m.dispose());
    }
  });
}

function applyThemeToWorld(world) {
  const dark = isDarkTheme();
  const pal = themePalette(dark);
  world.dark = dark;
  world.pal = pal;
  applyBackdrop(world, pal);
  world.hemi.color.set(pal.hemiSky);
  world.hemi.groundColor.set(pal.hemiGround);
  world.hemi.intensity = pal.hemiInt;
  world.key.intensity = pal.keyInt;
  world.fill.intensity = pal.rimInt;
  world.scene.environmentIntensity = pal.env;
  world.renderer.toneMappingExposure = pal.exposure;
}

function resizeToContainer(world, viewport) {
  const w = Math.max(1, viewport.clientWidth);
  const h = Math.max(1, viewport.clientHeight);
  world.camera.aspect = w / h;
  world.camera.updateProjectionMatrix();
  world.renderer.setSize(w, h, false);
}

/* ---------- HUD / UI ---------- */

function ensureHud(viewport, root) {
  let hud = (root && root.querySelector("#arm-telemetry")) || viewport.querySelector("#arm-telemetry");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "arm-telemetry";
    hud.className = "arm-hud";
    hud.setAttribute("aria-hidden", "true");
    viewport.insertAdjacentElement("afterend", hud);
  }
  hud.innerHTML = JOINT_KEYS.map((k) => {
    return (
      '<div class="arm-hud-row" data-tel="' + k + '">' +
      '<span class="arm-hud-lab">' + LABELS[k] + "</span>" +
      '<span class="arm-hud-ang" data-tel-ang="' + k + '">0°</span>' +
      '<span class="arm-hud-spd" data-tel-spd="' + k + '">0°/s</span>' +
      '<span class="arm-hud-tau" data-tel-tau="' + k + '">0 N·m</span>' +
      '<span class="arm-hud-bar"><span data-tel-bar="' + k + '"></span></span></div>'
    );
  }).join("");
  return hud;
}

function updateHud(hud, state, config) {
  if (!hud) return;
  const servo = SERVO[config.servo] || SERVO.MG996R;
  JOINT_KEYS.forEach((k) => {
    const st = state[k];
    const row = hud.querySelector('[data-tel="' + k + '"]');
    if (!row) return;
    const spec = k === "gripper" ? SERVO.SG90 : servo;
    const ang = k === "gripper" ? Math.round(st.q) + "%" : Math.round(st.q * RAD) + "°";
    const spd =
      k === "gripper"
        ? Math.round(Math.abs(st.qdot)) + "%/s"
        : Math.round(Math.abs(st.qdot) * RAD) + "°/s";
    const tau = (st.tau >= 0 ? "" : "−") + Math.abs(st.tau).toFixed(2) + " N·m";
    const elA = row.querySelector("[data-tel-ang]");
    const elS = row.querySelector("[data-tel-spd]");
    const elT = row.querySelector("[data-tel-tau]");
    const bar = row.querySelector("[data-tel-bar]");
    if (elA) elA.textContent = ang;
    if (elS) elS.textContent = spd;
    if (elT) elT.textContent = tau;
    if (bar) bar.style.width = Math.round(clamp(Math.abs(st.tau) / spec.stall, 0, 1) * 100) + "%";
    row.classList.toggle("is-sat", !!st.sat);
  });
}

function setSliderUI(targets) {
  if (!ctx) return;
  JOINT_KEYS.forEach((k) => {
    const input = ctx.root.querySelector('[data-joint="' + k + '"]');
    const val = ctx.root.querySelector('[data-joint-val="' + k + '"]');
    const v = Math.round(clampJoint(k, targets[k]));
    if (input && Number(input.value) !== v) input.value = String(v);
    if (val) val.textContent = k === "gripper" ? v + "%" : v + "°";
  });
}

function setDemoButtons(on) {
  if (!ctx) return;
  const btn = ctx.root.querySelector('[data-arm="demo"]');
  if (btn) {
    btn.classList.toggle("is-busy", !!on);
    btn.textContent = on ? "Stop" : "Demo";
  }
}

function fillSetupUI(config) {
  if (!ctx) return;
  const root = ctx.root;
  const pay = root.querySelector("[data-arm-payload]");
  const servo = root.querySelector("[data-arm-servo]");
  if (pay) pay.value = String(config.payload);
  if (servo) servo.value = config.servo;
  ["L1", "L2", "L3", "baseH"].forEach((k) => {
    const el = root.querySelector('[data-arm-cfg="' + k + '"]');
    if (el) el.value = String(Math.round(config[k] * 1000) / 10);
  });
}

function persistJoints() {
  if (!ctx) return;
  clearTimeout(ctx.saveTimer);
  ctx.saveTimer = setTimeout(() => {
    if (!ctx) return;
    const j = jointsFromState(ctx.state);
    cached.joints = { ...j };
    if (ctx.opts.onChange) ctx.opts.onChange(j);
  }, 280);
}

function currentJoints() {
  if (ctx) return jointsFromState(ctx.state);
  return cloneJoints(cached.joints);
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

function getHeldMass() {
  if (!ctx || !ctx.held) return 0;
  return ctx.held.mass || 0;
}

function eeWorld() {
  const p = new THREE.Vector3();
  ctx.world.parts.ee.getWorldPosition(p);
  return p;
}

function tryGrasp() {
  if (!ctx || ctx.held) return;
  const width = jawWidth(ctx.state.gripper.q);
  if (ctx.state.gripper.q > 50) return;
  const closing = ctx.targets.gripper < ctx.state.gripper.q - 0.5 || ctx.state.gripper.q <= 30;
  if (!closing) return;
  const ee = eeWorld();
  let best = null;
  let bestD = 1;
  ctx.objects.forEach((o) => {
    const d = ee.distanceTo(o.mesh.position);
    const reach = o.size * 0.85 + 0.025;
    if (d < reach && d < bestD && width <= o.size + 0.01) {
      best = o;
      bestD = d;
    }
  });
  if (!best) return;
  const offset = best.mesh.position.clone();
  const inv = new THREE.Matrix4().copy(ctx.world.parts.ee.matrixWorld).invert();
  offset.applyMatrix4(inv);
  const qinv = ctx.world.parts.ee.getWorldQuaternion(new THREE.Quaternion()).invert();
  const rot = best.mesh.quaternion.clone().premultiply(qinv);
  ctx.held = best;
  best.held = true;
  best.localOff = offset;
  best.localRot = rot;
  best.body.type = CANNON.Body.KINEMATIC;
  best.body.velocity.set(0, 0, 0);
  best.body.angularVelocity.set(0, 0, 0);
  best.body.collisionFilterMask = 1;
}

function releaseGrasp() {
  if (!ctx || !ctx.held) return;
  const o = ctx.held;
  const prev = ctx.prevEe || eeWorld();
  const now = eeWorld();
  const dt = Math.max(1 / 60, ctx.dtUsed || 1 / 60);
  o.body.type = CANNON.Body.DYNAMIC;
  o.body.mass = o.mass;
  o.body.updateMassProperties();
  o.body.collisionFilterMask = 1 | 2 | 4;
  o.body.velocity.set((now.x - prev.x) / dt, (now.y - prev.y) / dt, (now.z - prev.z) / dt);
  o.body.wakeUp();
  o.held = false;
  ctx.held = null;
}

function placeHeld() {
  if (!ctx || !ctx.held) return;
  const ee = ctx.world.parts.ee;
  ee.updateWorldMatrix(true, false);
  const pos = ctx.held.localOff.clone().applyMatrix4(ee.matrixWorld);
  const rot = ee.getWorldQuaternion(new THREE.Quaternion()).multiply(ctx.held.localRot);
  ctx.held.body.position.set(pos.x, pos.y, pos.z);
  ctx.held.body.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  ctx.held.body.velocity.set(0, 0, 0);
  ctx.held.body.angularVelocity.set(0, 0, 0);
  ctx.held.mesh.position.copy(pos);
  ctx.held.mesh.quaternion.copy(rot);
  updateBlob(ctx.held);
}

function setTargets(j, snap) {
  if (!ctx) return;
  ctx.targets = cloneJoints(j);
  if (snap) {
    ctx.state = stateFromJoints(ctx.targets);
    applyJoints(ctx.world.parts, ctx.targets);
  }
  setSliderUI(ctx.targets);
  requestTick();
}

function goTo(j) {
  if (!ctx) return;
  ctx.demo = null;
  setDemoButtons(false);
  setTargets(j, false);
  persistJoints();
}

/* ---------- Demo pick-and-place con IK ---------- */

function demoObject() {
  return ctx.objects.find((o) => o.kind === "cube") || ctx.objects[0];
}

function startDemo() {
  if (!ctx) return;
  if (ctx.demo) {
    ctx.demo = null;
    setDemoButtons(false);
    return;
  }
  if (ctx.held) releaseGrasp();
  const obj = demoObject();
  if (obj) {
    obj.body.position.set(obj.rest[0], obj.rest[1] + 0.03, obj.rest[2]);
    obj.body.velocity.set(0, 0, 0);
    obj.body.quaternion.set(0, 0, 0, 1);
    obj.body.wakeUp();
  }
  ctx.demo = { phase: "open", t0: performance.now(), wait: 0 };
  setDemoButtons(true);
  setTargets(Object.assign(cloneJoints(HOME), { gripper: 100 }), false);
  requestTick();
}

function stepDemo(now) {
  if (!ctx || !ctx.demo) return;
  const d = ctx.demo;
  const obj = demoObject();
  const cfg = ctx.config;
  const seed = jointsFromState(ctx.state);
  const above = obj
    ? { x: obj.body.position.x, y: Math.max(0.08, obj.body.position.y + 0.07), z: obj.body.position.z }
    : { x: 0.1, y: 0.1, z: 0.2 };
  const pick = obj
    ? { x: obj.body.position.x, y: Math.max(0.02, obj.size * 0.5 + 0.008), z: obj.body.position.z }
    : { x: 0.1, y: 0.02, z: 0.2 };
  const place = { x: -0.13, y: 0.02, z: 0.15 };
  const placeAbove = { x: place.x, y: 0.1, z: place.z };

  const timeout = now - d.t0 > 2800;
  const ready = jointsSettled(ctx.state, ctx.targets, 6) || timeout;

  function aim(point, grip, raiseLimited) {
    const ik = ikTo(cfg, point, Object.assign(seed, { gripper: grip }));
    ik.joints.gripper = grip;
    setTargets(ik.joints, false);
    if (ik.limited && ctx.opts.onToast && raiseLimited) {
      ctx.opts.onToast("Punto ai limiti del braccio");
    }
    worldMark(point);
    d.t0 = now;
  }

  switch (d.phase) {
    case "open":
      if (ready) {
        d.phase = "approach";
        aim(above, 100);
      }
      break;
    case "approach":
      if (ready) {
        d.phase = "descend";
        aim(pick, 100);
      }
      break;
    case "descend":
      if (ready) {
        d.phase = "close";
        setTargets(Object.assign(cloneJoints(jointsFromState(ctx.state)), { gripper: 4 }), false);
        d.t0 = now;
      }
      break;
    case "close":
      tryGrasp();
      if (ctx.held || now - d.t0 > 1200) {
        d.phase = "lift";
        aim(above, ctx.held ? 6 : 4);
      }
      break;
    case "lift":
      if (ready) {
        d.phase = "carry";
        aim(placeAbove, ctx.held ? 6 : 4);
      }
      break;
    case "carry":
      if (ready) {
        d.phase = "place";
        aim(place, ctx.held ? 6 : 4);
      }
      break;
    case "place":
      if (ready) {
        d.phase = "release";
        setTargets(Object.assign(cloneJoints(jointsFromState(ctx.state)), { gripper: 100 }), false);
        d.t0 = now;
      }
      break;
    case "release":
      if (ctx.state.gripper.q > 40 || now - d.t0 > 900) {
        if (ctx.held) releaseGrasp();
        d.phase = "retreat";
        aim(placeAbove, 80);
      }
      break;
    case "retreat":
      if (ready) {
        d.phase = "home";
        setTargets(HOME, false);
        d.t0 = now;
      }
      break;
    case "home":
      if (ready) {
        ctx.demo = null;
        setDemoButtons(false);
        persistJoints();
      }
      break;
    default:
      ctx.demo = null;
      setDemoButtons(false);
  }
}

function worldMark(p) {
  if (!ctx || !ctx.world.marker) return;
  ctx.world.marker.position.set(p.x, 0.002, p.z);
  ctx.world.marker.visible = true;
}

function resetArm() {
  if (!ctx) return;
  ctx.demo = null;
  setDemoButtons(false);
  if (ctx.held) releaseGrasp();
  resetObjects(ctx.objects);
  setTargets(HOME, false);
  if (ctx.world.marker) ctx.world.marker.visible = false;
  persistJoints();
}

function handleTap(ev) {
  if (!ctx) return;
  const rect = ctx.world.renderer.domElement.getBoundingClientRect();
  const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), ctx.world.camera);
  let target = null;
  const objMeshes = ctx.objects.map((o) => o.mesh);
  const hits = ray.intersectObjects(objMeshes, true);
  if (hits.length) {
    let hitObj = hits[0].object;
    while (hitObj.parent && !objMeshes.includes(hitObj)) hitObj = hitObj.parent;
    const p = hitObj.position;
    target = { x: p.x, y: Math.max(0.018, p.y), z: p.z };
  } else {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) {
      if (Math.hypot(hit.x, hit.z) > 0.48) return;
      target = { x: hit.x, y: 0.02, z: hit.z };
    }
  }
  if (!target) return;
  ctx.demo = null;
  setDemoButtons(false);
  const seed = Object.assign(jointsFromState(ctx.state), { gripper: ctx.targets.gripper });
  const ik = ikTo(ctx.config, target, seed);
  ik.joints.gripper = ctx.targets.gripper;
  setTargets(ik.joints, false);
  worldMark(target);
  persistJoints();
  if (ik.limited && ctx.opts.onToast) ctx.opts.onToast("Punto ai limiti del braccio");
}

function bindUI(root) {
  const onInput = (e) => {
    const input = e.target.closest("[data-joint]");
    if (!input || !ctx) return;
    ctx.demo = null;
    setDemoButtons(false);
    const key = input.dataset.joint;
    ctx.targets[key] = clampJoint(key, input.value);
    setSliderUI(ctx.targets);
    persistJoints();
    requestTick();
  };
  const onChange = (e) => {
    if (!ctx) return;
    if (e.target.matches("[data-arm-payload]")) {
      ctx.config.payload = clamp(Number(e.target.value) || 0, 0, 1);
      if (ctx.opts.onConfigChange) ctx.opts.onConfigChange({ ...ctx.config });
      requestTick();
    }
    if (e.target.matches("[data-arm-servo]")) {
      const v = e.target.value;
      if (SERVO[v]) {
        ctx.config.servo = v;
        if (ctx.opts.onConfigChange) ctx.opts.onConfigChange({ ...ctx.config });
        requestTick();
      }
    }
  };
  const onAction = (e) => {
    const btn = e.target.closest("[data-arm]");
    if (!btn || !root.contains(btn)) return;
    const act = btn.dataset.arm;
    if (act === "demo") startDemo();
    else if (act === "reset") resetArm();
    else if (act === "apply-config") applyConfigFromUI();
    else if (act === "save-pose") {
      const nameInput = root.querySelector("#arm-pose-name");
      const name = nameInput ? nameInput.value.trim() : "";
      if (!name) {
        if (ctx.opts.onToast) ctx.opts.onToast("Dai un nome alla pose");
        if (nameInput) nameInput.focus();
        return;
      }
      if (ctx.opts.onSavePose) {
        ctx.opts.onSavePose(name, jointsFromState(ctx.state));
        nameInput.value = "";
      }
    } else if (act === "load-pose") {
      const id = btn.dataset.id;
      const pose = (ctx.opts.poses || []).find((p) => p.id === id);
      if (pose) {
        ctx.demo = null;
        setDemoButtons(false);
        setTargets(pose.joints, false);
      }
    } else if (act === "delete-pose") {
      const id = btn.dataset.id;
      if (ctx.opts.onDeletePose) ctx.opts.onDeletePose(id);
    }
  };
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("click", onAction);
  return { onInput, onChange, onAction };
}

function applyConfigFromUI() {
  if (!ctx) return;
  const raw = { ...ctx.config };
  ["L1", "L2", "L3", "baseH"].forEach((k) => {
    const el = ctx.root.querySelector('[data-arm-cfg="' + k + '"]');
    if (!el) return;
    const cm = Number(el.value);
    if (Number.isFinite(cm)) raw[k] = cm / 100;
  });
  const servo = ctx.root.querySelector("[data-arm-servo]");
  const pay = ctx.root.querySelector("[data-arm-payload]");
  if (servo) raw.servo = servo.value;
  if (pay) raw.payload = Number(pay.value);
  const next = sanitizeConfig(raw);
  const joints = jointsFromState(ctx.state);
  rebuildArm(next);
  ctx.state = stateFromJoints(joints);
  ctx.targets = cloneJoints(joints);
  applyJoints(ctx.world.parts, joints);
  fillSetupUI(next);
  if (ctx.opts.onConfigChange) ctx.opts.onConfigChange({ ...next });
  if (ctx.opts.onToast) ctx.opts.onToast("Misure aggiornate");
  requestTick();
}

function rebuildArm(config) {
  const world = ctx.world;
  if (world.armRoot) {
    world.scene.remove(world.armRoot);
    disposeObject3D(world.armRoot);
  }
  world.config = config;
  ctx.config = config;
  world.parts = buildArm(world, world.mats, config);
  world.armRoot = world.parts.root;
  world.scene.add(world.armRoot);
}

function bindPointer(canvas) {
  let ptr = null;
  const down = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    ptr = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  const up = (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const dist = Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y);
    const dt = performance.now() - ptr.t;
    ptr = null;
    if (dist < 12 && dt < 380) handleTap(e);
  };
  const cancel = () => {
    ptr = null;
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", cancel);
  };
}

function loop(now) {
  if (!ctx) return;
  const world = ctx.world;
  const dtMs = ctx.lastFrame ? now - ctx.lastFrame : 16.6;
  ctx.lastFrame = now;
  ctx.acc += Math.min(0.08, dtMs / 1000);
  ctx.frameCount++;
  if (now - ctx.fpsT >= 1000) {
    ctx.fps = (ctx.frameCount * 1000) / (now - ctx.fpsT);
    ctx.frameCount = 0;
    ctx.fpsT = now;
  }

  let moving = false;
  let steps = 0;
  while (ctx.acc >= DT && steps < MAX_STEPS) {
    moving = stepServos(ctx.state, ctx.targets, ctx.config, getHeldMass(), DT) || moving;
    const j = jointsFromState(ctx.state);
    applyJoints(world.parts, j);
    if (ctx.held) placeHeld();
    if (ctx.phys) ctx.phys.world.step(DT);
    ctx.acc -= DT;
    steps++;
    ctx.dtUsed = DT;
  }
  if (ctx.state.gripper.qdot < -5 || ctx.targets.gripper < ctx.state.gripper.q - 2) tryGrasp();
  if (ctx.held && ctx.state.gripper.q > 35 && ctx.targets.gripper > 40) releaseGrasp();

  const ee = eeWorld();
  ctx.prevEe = ee.clone();
  if (!ctx.held) syncObjects(ctx.objects);
  else {
    ctx.objects.forEach((o) => {
      if (o !== ctx.held) {
        o.mesh.position.copy(o.body.position);
        o.mesh.quaternion.copy(o.body.quaternion);
        updateBlob(o);
      }
    });
    placeHeld();
  }

  if (ctx.demo) stepDemo(now);
  if (now - (ctx.hudAt || 0) > 80) {
    updateHud(ctx.hud, ctx.state, ctx.config);
    ctx.hudAt = now;
  }

  const controlsMoved = world.controls.update();
  const awake = objectsAwake(ctx.objects);
  updateLed(moving);
  world.renderer.render(world.scene, world.camera);
  adaptQuality(dtMs);

  const idle =
    !moving &&
    !ctx.demo &&
    !awake &&
    !controlsMoved &&
    now - ctx.lastInteract > 400;

  if (idle) {
    ctx.looping = false;
    ctx.raf = 0;
    return;
  }
  ctx.raf = requestAnimationFrame(loop);
}

/* LED di stato: verde fermo, ambra in movimento, rosso se un servo è in saturazione. */
const LED_COLORS = { idle: 0x23ff6a, move: 0xffb020, sat: 0xff3326 };
function updateLed(moving) {
  if (!ctx || !ctx.world.mats.led) return;
  const sat = JOINT_KEYS.some((k) => ctx.state[k].sat);
  const mode = sat ? "sat" : moving || ctx.demo ? "move" : "idle";
  if (ctx.ledMode === mode) return;
  ctx.ledMode = mode;
  ctx.world.mats.led.emissive.setHex(LED_COLORS[mode]);
}

/* Qualità adattiva: se l'iPhone scende sotto ~45 fps riduce risoluzione e ombre. */
function adaptQuality(dtMs) {
  if (!ctx || ctx.qualityLocked) return;
  const p = ctx.perf || (ctx.perf = { n: 0, t: 0, cool: 0 });
  if (dtMs > 120 || dtMs <= 0) {
    p.n = 0;
    p.t = 0;
    return;
  }
  p.n++;
  p.t += dtMs;
  if (p.n < 90) return;
  const fps = (p.n * 1000) / p.t;
  p.n = 0;
  p.t = 0;
  if (fps < 45 && ctx.world.quality > 0) {
    applyQuality(ctx.world, ctx.world.quality - 1);
    resizeToContainer(ctx.world, ctx.viewport);
  }
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

  const config = sanitizeConfig(opts && opts.config);
  if (world.config.L1 !== config.L1 || world.config.L2 !== config.L2 || world.config.L3 !== config.L3 || world.config.baseH !== config.baseH) {
    world.scene.remove(world.armRoot);
    disposeObject3D(world.armRoot);
    world.parts = buildArm(world, world.mats, config);
    world.armRoot = world.parts.root;
    world.scene.add(world.armRoot);
  }
  world.config = config;

  let phys = null;
  let objects = [];
  try {
    phys = createPhysics();
    objects = spawnObjects(world, phys, world.mats);
  } catch (err) {
    console.warn("Mie Cose fisica:", err);
  }

  const joints = cloneJoints((opts && opts.joints) || cached.joints || HOME);
  applyJoints(world.parts, joints);
  cached.joints = { ...joints };

  const hud = ensureHud(viewport, root);

  ctx = {
    root,
    viewport,
    world,
    phys,
    objects,
    held: null,
    opts: opts || {},
    config,
    targets: { ...joints },
    state: stateFromJoints(joints),
    needsRender: true,
    looping: false,
    raf: 0,
    lastInteract: performance.now(),
    lastFrame: 0,
    acc: 0,
    demo: null,
    saveTimer: 0,
    ui: null,
    mq: null,
    ro: null,
    hud,
    fps: 0,
    fpsT: performance.now(),
    frameCount: 0,
    unbindPtr: null,
  };
  ctx.ui = bindUI(root);
  ctx.unbindPtr = bindPointer(world.renderer.domElement);
  setSliderUI(ctx.targets);
  setDemoButtons(false);
  fillSetupUI(config);
  updateHud(hud, ctx.state, config);
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
  cached.joints = jointsFromState(ctx.state);
  if (world && world.camera) cached.camPos = world.camera.position.clone();
  if (world && world.controls) cached.camTarget = world.controls.target.clone();
  if (ctx.ui && ctx.root) {
    ctx.root.removeEventListener("click", ctx.ui.onAction);
    ctx.root.removeEventListener("input", ctx.ui.onInput);
    ctx.root.removeEventListener("change", ctx.ui.onChange);
  }
  if (ctx.unbindPtr) ctx.unbindPtr();
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
    if (world.envMap) world.envMap.dispose();
    (world.geoms || []).forEach((g) => g.dispose && g.dispose());
    (world.dynMats || []).forEach((m) => m.dispose && m.dispose());
    Object.values(world.mats || {}).forEach((m) => m.dispose && m.dispose());
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
  playDemo: startDemo,
  reset: resetArm,
  getJoints: currentJoints,
  setJoints(j, animate) {
    if (!ctx) {
      cached.joints = cloneJoints(j);
      return;
    }
    setTargets(j, animate === false);
  },
  setConfig(c) {
    if (!ctx) return;
    const next = sanitizeConfig(Object.assign({}, ctx.config, c || {}));
    if (next.L1 !== ctx.config.L1 || next.L2 !== ctx.config.L2 || next.L3 !== ctx.config.L3 || next.baseH !== ctx.config.baseH) {
      const joints = jointsFromState(ctx.state);
      rebuildArm(next);
      ctx.state = stateFromJoints(joints);
      applyJoints(ctx.world.parts, joints);
    } else {
      ctx.config = next;
      ctx.world.config = next;
    }
    fillSetupUI(next);
    requestTick();
  },
  getConfig() {
    return ctx ? { ...ctx.config } : { ...DEFAULT_CONFIG };
  },
  requestRender: requestTick,
  setCamera(pos, target) {
    if (!ctx || !pos) return;
    ctx.world.camera.position.set(pos[0], pos[1], pos[2]);
    if (target) ctx.world.controls.target.set(target[0], target[1], target[2]);
    ctx.world.controls.update();
    requestTick();
  },
  setQuality(level, lock) {
    if (!ctx) return;
    applyQuality(ctx.world, clamp(Math.round(Number(level) || 0), 0, QUALITY.length - 1));
    resizeToContainer(ctx.world, ctx.viewport);
    ctx.qualityLocked = !!lock;
    requestTick();
  },
  isMounted() {
    return !!ctx;
  },
  getStats() {
    if (!ctx) return { fps: 0, sat: false };
    return {
      fps: ctx.fps,
      quality: ctx.world.quality,
      pixelRatio: ctx.world.renderer.getPixelRatio(),
      drawCalls: ctx.world.renderer.info.render.calls,
      triangles: ctx.world.renderer.info.render.triangles,
      meshes: (() => {
        let n = 0;
        let c = 0;
        ctx.world.scene.traverse((o) => {
          if (o.isMesh) {
            n++;
            if (o.castShadow) c++;
          }
        });
        return n + "/" + c;
      })(),
      sat: JOINT_KEYS.some((k) => ctx.state[k].sat),
      held: !!(ctx.held && ctx.held.kind),
      payload: ctx.config.payload,
      objects: (ctx.objects || []).map((o) => ({
        kind: o.kind,
        size: o.size,
        mass: o.mass,
        held: !!o.held,
        x: o.mesh.position.x,
        y: o.mesh.position.y,
        z: o.mesh.position.z,
      })),
    };
  },
  gotoPoint(target, opts) {
    if (!ctx || !target) return null;
    const seed = Object.assign(jointsFromState(ctx.state), {
      gripper: opts && opts.gripper != null ? opts.gripper : ctx.targets.gripper,
    });
    const ik = ikTo(ctx.config, { x: target.x, y: target.y, z: target.z }, seed);
    if (opts && opts.gripper != null) ik.joints.gripper = opts.gripper;
    ctx.demo = null;
    setDemoButtons(false);
    setTargets(ik.joints, !!(opts && opts.snap));
    worldMark({ x: target.x, y: target.y, z: target.z });
    requestTick();
    return { limited: ik.limited, joints: ik.joints };
  },
};

window.MiaArm3D = api;
window.dispatchEvent(new Event("mia-arm3d-ready"));
