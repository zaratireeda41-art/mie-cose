/* Vista 3D del braccio — modello realistico, fisica e IK. Librerie locali, senza CDN. */
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";
import * as CANNON from "./vendor/cannon-es.min.js";

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

/* ---------- Materiali PBR ---------- */

function makeMaterials(dark) {
  const env = 1.05;
  const mk = (opts) =>
    new THREE.MeshPhysicalMaterial(Object.assign({ envMapIntensity: env }, opts));
  return {
    alu: mk({
      color: dark ? 0xb9bec8 : 0xc5cad3,
      metalness: 0.92,
      roughness: 0.28,
      clearcoat: 0.18,
      clearcoatRoughness: 0.4,
    }),
    aluDark: mk({
      color: dark ? 0x5c616c : 0x4a4e58,
      metalness: 0.9,
      roughness: 0.34,
      clearcoat: 0.1,
    }),
    servo: mk({
      color: dark ? 0x1c1c20 : 0x16161a,
      metalness: 0.18,
      roughness: 0.55,
      clearcoat: 0.08,
    }),
    horn: mk({
      color: 0x26262c,
      metalness: 0.25,
      roughness: 0.45,
    }),
    accent: mk({
      color: 0xff7a1a,
      metalness: 0.5,
      roughness: 0.32,
      emissive: 0xff7a1a,
      emissiveIntensity: dark ? 0.18 : 0.08,
    }),
    brass: mk({
      color: 0xc4a35a,
      metalness: 1,
      roughness: 0.24,
    }),
    rubber: mk({
      color: 0x1a1a1e,
      metalness: 0.04,
      roughness: 0.88,
    }),
    cable: mk({
      color: dark ? 0x2a2a30 : 0x1f1f24,
      metalness: 0.12,
      roughness: 0.72,
    }),
    pad: mk({
      color: 0x2b2b30,
      metalness: 0.05,
      roughness: 0.9,
    }),
    floor: mk({
      color: dark ? 0x1b1c24 : 0xe6e4ef,
      metalness: 0.12,
      roughness: 0.55,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
      envMapIntensity: 0.7,
    }),
    marker: mk({
      color: 0xff7a1a,
      metalness: 0.3,
      roughness: 0.4,
      emissive: 0xff7a1a,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.95,
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
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

function bolt(world, mats) {
  return trackGeo(world, new THREE.CylinderGeometry(0.0015, 0.0015, 0.0022, 6));
}

function buildServo(world, mats, kind) {
  const g = new THREE.Group();
  const sg = kind === "sg";
  const L = sg ? 0.023 : 0.0407;
  const W = sg ? 0.012 : 0.0197;
  const H = sg ? 0.022 : 0.036;
  const body = trackGeo(world, new THREE.BoxGeometry(W, H, L));
  addMesh(g, world, body, mats.servo, [0, -H / 2 + 0.004, 0]);
  const flangeZ = L / 2 + 0.0035;
  const fl = trackGeo(world, new THREE.BoxGeometry(W, 0.0024, 0.007));
  addMesh(g, world, fl, mats.servo, [0, -0.002, flangeZ]);
  addMesh(g, world, fl, mats.servo, [0, -0.002, -flangeZ]);
  const cap = trackGeo(world, new THREE.BoxGeometry(W + 0.0004, 0.004, L * 0.55));
  addMesh(g, world, cap, mats.aluDark, [0, 0.002, -L * 0.08]);
  const shaft = trackGeo(world, new THREE.CylinderGeometry(0.003, 0.003, 0.005, 12));
  addMesh(g, world, shaft, mats.brass, [0, 0.006, 0], [0, 0, 0], "none");
  const disc = trackGeo(world, new THREE.CylinderGeometry(sg ? 0.007 : 0.01, sg ? 0.007 : 0.01, 0.002, 16));
  const horn = addMesh(g, world, disc, mats.horn, [0, 0.0082, 0]);
  const arm = trackGeo(world, new THREE.BoxGeometry(sg ? 0.006 : 0.008, 0.0018, sg ? 0.022 : 0.032));
  addMesh(g, world, arm, mats.horn, [0, 0.0082, 0], null, "none");
  const arm2 = trackGeo(world, new THREE.BoxGeometry(sg ? 0.018 : 0.024, 0.0018, sg ? 0.006 : 0.008));
  addMesh(g, world, arm2, mats.horn, [0, 0.0082, 0], null, "none");
  const screw = trackGeo(world, new THREE.CylinderGeometry(0.0012, 0.0012, 0.003, 8));
  addMesh(g, world, screw, mats.brass, [0, 0.0102, 0], null, "none");
  const wire = trackGeo(world, new THREE.BoxGeometry(0.004, 0.003, 0.008));
  addMesh(g, world, wire, mats.cable, [0, -H + 0.005, L / 2 - 0.002], null, "none");
  g.userData.kind = kind;
  return g;
}

function buildUBracket(world, mats, width, height, depth, thick) {
  const g = new THREE.Group();
  const side = trackGeo(world, new THREE.BoxGeometry(thick, height, depth));
  addMesh(g, world, side, mats.alu, [-width / 2, 0, 0]);
  addMesh(g, world, side, mats.alu, [width / 2, 0, 0]);
  const bot = trackGeo(world, new THREE.BoxGeometry(width + thick, thick, depth));
  addMesh(g, world, bot, mats.alu, [0, -height / 2, 0]);
  return g;
}

function cableSeg(world, mats, parent, len, pos, rot) {
  const geo = trackGeo(world, new THREE.CylinderGeometry(0.0018, 0.0018, len, 6));
  const m = addMesh(parent, world, geo, mats.cable, pos, rot || [0, 0, 0], "none");
  return m;
}

function buildArm(world, mats, config) {
  const { L1, L2, L3, baseH } = config;
  const root = new THREE.Group();

  const baseFixed = new THREE.Group();
  root.add(baseFixed);
  const foot = trackGeo(world, new THREE.CylinderGeometry(0.07, 0.074, 0.01, 32));
  addMesh(baseFixed, world, foot, mats.rubber, [0, 0.005, 0], null, "recv");
  const plate = trackGeo(world, new THREE.CylinderGeometry(0.06, 0.06, 0.006, 32));
  addMesh(baseFixed, world, plate, mats.aluDark, [0, 0.012, 0]);
  const race = trackGeo(world, new THREE.TorusGeometry(0.048, 0.0045, 8, 24));
  addMesh(baseFixed, world, race, mats.brass, [0, 0.016, 0], [Math.PI / 2, 0, 0]);
  const boltGeo = bolt(world, mats);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    addMesh(baseFixed, world, boltGeo, mats.brass, [Math.cos(a) * 0.062, 0.016, Math.sin(a) * 0.062], null, "none");
  }

  const base = new THREE.Group();
  root.add(base);
  const turn = trackGeo(world, new THREE.CylinderGeometry(0.052, 0.052, 0.007, 28));
  addMesh(base, world, turn, mats.alu, [0, 0.02, 0]);
  const hub = trackGeo(world, new THREE.CylinderGeometry(0.016, 0.016, 0.012, 16));
  addMesh(base, world, hub, mats.aluDark, [0, 0.028, 0]);

  const yawServo = buildServo(world, mats, "mg");
  yawServo.position.set(0, 0.038, -0.012);
  yawServo.rotation.set(0, 0, 0);
  base.add(yawServo);

  const column = trackGeo(world, new THREE.BoxGeometry(0.036, baseH - 0.03, 0.036));
  addMesh(base, world, column, mats.alu, [0, 0.03 + (baseH - 0.03) / 2, 0]);

  const shoulder = new THREE.Group();
  shoulder.position.set(0, baseH, 0);
  base.add(shoulder);

  const shoulderBracket = buildUBracket(world, mats, 0.046, 0.046, 0.05, 0.0035);
  shoulderBracket.position.set(0, 0, 0);
  shoulder.add(shoulderBracket);

  const sServoA = buildServo(world, mats, "mg");
  sServoA.position.set(-0.026, 0, 0);
  sServoA.rotation.set(0, 0, Math.PI / 2);
  shoulder.add(sServoA);
  const sServoB = buildServo(world, mats, "mg");
  sServoB.position.set(0.026, 0, 0);
  sServoB.rotation.set(0, Math.PI, -Math.PI / 2);
  shoulder.add(sServoB);

  const upper = new THREE.Group();
  shoulder.add(upper);
  const beamH = 0.026;
  const beamT = 0.0032;
  const beam = trackGeo(world, new THREE.BoxGeometry(beamT, beamH, L1 + 0.01));
  addMesh(upper, world, beam, mats.alu, [-0.016, 0, L1 / 2]);
  addMesh(upper, world, beam, mats.alu, [0.016, 0, L1 / 2]);
  const rib = trackGeo(world, new THREE.BoxGeometry(0.028, 0.0024, L1 * 0.7));
  addMesh(upper, world, rib, mats.aluDark, [0, -0.01, L1 / 2]);
  for (let i = 1; i <= 3; i++) {
    const standoff = trackGeo(world, new THREE.CylinderGeometry(0.0025, 0.0025, 0.032, 8));
    addMesh(upper, world, standoff, mats.brass, [0, 0, (L1 * i) / 4], [0, 0, Math.PI / 2], "none");
  }
  cableSeg(world, mats, upper, L1 * 0.85, [0.02, -0.012, L1 / 2], [Math.PI / 2, 0, 0]);
  cableSeg(world, mats, upper, L1 * 0.85, [0.023, -0.012, L1 / 2], [Math.PI / 2, 0, 0]);

  const elbow = new THREE.Group();
  elbow.position.set(0, 0, L1);
  upper.add(elbow);
  const eBr = buildUBracket(world, mats, 0.04, 0.04, 0.042, 0.003);
  elbow.add(eBr);
  const eServo = buildServo(world, mats, "mg");
  eServo.position.set(-0.023, 0, 0);
  eServo.rotation.set(0, 0, Math.PI / 2);
  elbow.add(eServo);

  const fore = new THREE.Group();
  elbow.add(fore);
  const beam2 = trackGeo(world, new THREE.BoxGeometry(beamT, 0.022, L2 + 0.008));
  addMesh(fore, world, beam2, mats.alu, [-0.013, 0, L2 / 2]);
  addMesh(fore, world, beam2, mats.alu, [0.013, 0, L2 / 2]);
  const rib2 = trackGeo(world, new THREE.BoxGeometry(0.022, 0.002, L2 * 0.65));
  addMesh(fore, world, rib2, mats.aluDark, [0, -0.008, L2 / 2]);
  cableSeg(world, mats, fore, L2 * 0.8, [0.017, -0.01, L2 / 2], [Math.PI / 2, 0, 0]);

  const wrist = new THREE.Group();
  wrist.position.set(0, 0, L2);
  fore.add(wrist);
  const wBr = buildUBracket(world, mats, 0.034, 0.032, 0.034, 0.0028);
  wrist.add(wBr);
  const wServo = buildServo(world, mats, "mg");
  wServo.position.set(-0.02, 0, 0);
  wServo.rotation.set(0, 0, Math.PI / 2);
  wrist.add(wServo);

  const roll = new THREE.Group();
  wrist.add(roll);
  const rollServo = buildServo(world, mats, "mg");
  rollServo.position.set(0, 0, 0.012);
  rollServo.rotation.set(Math.PI / 2, 0, 0);
  roll.add(rollServo);
  const flange = trackGeo(world, new THREE.CylinderGeometry(0.016, 0.016, 0.004, 16));
  addMesh(roll, world, flange, mats.alu, [0, 0, 0.028], [Math.PI / 2, 0, 0]);

  const gripRoot = new THREE.Group();
  gripRoot.position.set(0, 0, 0.034);
  roll.add(gripRoot);
  const gServo = buildServo(world, mats, "sg");
  gServo.position.set(0, 0.016, 0.01);
  gServo.rotation.set(0, 0, 0);
  gripRoot.add(gServo);
  const palm = trackGeo(world, new THREE.BoxGeometry(0.028, 0.014, 0.016));
  addMesh(gripRoot, world, palm, mats.aluDark, [0, 0, 0.012]);
  const rod = trackGeo(world, new THREE.CylinderGeometry(0.0015, 0.0015, 0.05, 8));
  addMesh(gripRoot, world, rod, mats.brass, [0, 0, 0.03], [0, 0, Math.PI / 2], "none");

  const jawL = new THREE.Group();
  const jawR = new THREE.Group();
  gripRoot.add(jawL);
  gripRoot.add(jawR);
  const jawArm = trackGeo(world, new THREE.BoxGeometry(0.005, 0.012, L3 - 0.02));
  addMesh(jawL, world, jawArm, mats.alu, [0, 0, (L3 - 0.02) / 2 + 0.004]);
  addMesh(jawR, world, jawArm, mats.alu, [0, 0, (L3 - 0.02) / 2 + 0.004]);
  const tip = trackGeo(world, new THREE.BoxGeometry(0.004, 0.016, 0.018));
  addMesh(jawL, world, tip, mats.alu, [0.002, 0, L3 - 0.012]);
  addMesh(jawR, world, tip, mats.alu, [-0.002, 0, L3 - 0.012]);
  const pad = trackGeo(world, new THREE.BoxGeometry(0.003, 0.014, 0.016));
  addMesh(jawL, world, pad, mats.pad, [0.0045, 0, L3 - 0.012], null, "none");
  addMesh(jawR, world, pad, mats.pad, [-0.0045, 0, L3 - 0.012], null, "none");

  const ee = new THREE.Group();
  ee.position.set(0, 0, L3);
  gripRoot.add(ee);

  return {
    root,
    base,
    shoulder,
    elbow,
    wrist,
    roll,
    jawL,
    jawR,
    ee,
    gripRoot,
    upper,
    fore,
  };
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
}

function jawWidth(gripper) {
  return 0.008 + (clampJoint("gripper", gripper) / 100) * 0.044;
}

/* ---------- Scene, luci, fisica oggetti ---------- */

function themePalette(dark) {
  return {
    bg: dark ? 0x0b0b12 : 0xf3f0fa,
    hemiSky: dark ? 0xb8c0d8 : 0xffffff,
    hemiGround: dark ? 0x2a2436 : 0xc8c0d4,
    hemiInt: dark ? 0.55 : 0.85,
    dirInt: dark ? 1.35 : 1.7,
    fillInt: dark ? 0.35 : 0.5,
    grid: dark ? 0x3a3a48 : 0xb8b4c6,
    grid2: dark ? 0x262632 : 0xd8d4e4,
  };
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

function makeObjectVisual(world, mats, kind, size, color) {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.12,
    roughness: 0.45,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.9,
  });
  world.dynMats.push(mat);
  let mesh;
  let shape;
  let mass;
  if (kind === "cyl") {
    const r = size * 0.5;
    const h = size * 1.25;
    mesh = new THREE.Mesh(trackGeo(world, new THREE.CylinderGeometry(r, r, h, 18)), mat);
    shape = new CANNON.Cylinder(r, r, h, 10);
    mass = 0.045;
  } else {
    mesh = new THREE.Mesh(trackGeo(world, new THREE.BoxGeometry(size, size, size)), mat);
    shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
    mass = kind === "heavy" ? 0.22 : 0.04;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, shape, mass, size, kind };
}

function spawnObjects(world3, phys, mats) {
  const specs = [
    { kind: "cube", size: 0.028, color: 0xff7a1a, pos: [0.1, 0.02, 0.2], mass: 0.045 },
    { kind: "cube", size: 0.024, color: 0x4ea0ff, pos: [-0.11, 0.018, 0.16], mass: 0.03 },
    { kind: "cyl", size: 0.026, color: 0x3dcb8a, pos: [0.16, 0.02, 0.1], mass: 0.05 },
    { kind: "heavy", size: 0.032, color: 0x8b7cff, pos: [-0.05, 0.022, 0.24], mass: 0.22 },
  ];
  const list = [];
  specs.forEach((s) => {
    const vis = makeObjectVisual(world3, mats, s.kind, s.size, s.color);
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
    list.push({
      mesh: vis.mesh,
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

function syncObjects(list) {
  list.forEach((o) => {
    o.mesh.position.copy(o.body.position);
    o.mesh.quaternion.copy(o.body.quaternion);
  });
}

function objectsAwake(list) {
  return list.some((o) => o.body.sleepState !== CANNON.Body.SLEEPING);
}

function createWorld(container) {
  const dark = isDarkTheme();
  const pal = themePalette(dark);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pal.bg);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 8);
  if (cached.camPos) camera.position.copy(cached.camPos);
  else camera.position.set(0.46, 0.28, 0.12);
  camera.lookAt(0, 0.07, 0.1);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = dark ? 1.0 : 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = "arm-canvas";
  container.appendChild(renderer.domElement);

  let envMap = null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    envMap = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;
    envScene.dispose();
    pmrem.dispose();
  } catch (err) {
    console.warn("Mie Cose envmap:", err);
  }

  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiInt);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff4e8, pal.dirInt);
  dir.position.set(0.45, 0.85, 0.35);
  dir.castShadow = true;
  dir.shadow.mapSize.set(512, 512);
  dir.shadow.camera.near = 0.05;
  dir.shadow.camera.far = 2.5;
  dir.shadow.camera.left = -0.5;
  dir.shadow.camera.right = 0.5;
  dir.shadow.camera.top = 0.5;
  dir.shadow.camera.bottom = -0.5;
  dir.shadow.bias = -0.0006;
  dir.shadow.normalBias = 0.012;
  dir.shadow.radius = 2.5;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xc8d4ff, pal.fillInt);
  fill.position.set(-0.4, 0.3, -0.3);
  scene.add(fill);

  const geoms = [];
  const world = {
    scene,
    camera,
    renderer,
    hemi,
    dir,
    fill,
    envMap,
    geoms,
    dynMats: [],
    mats: null,
    parts: null,
    armRoot: null,
    floor: null,
    grid: null,
    marker: null,
    controls: null,
    pal,
    dark,
  };

  world.mats = makeMaterials(dark);

  const floorGeo = trackGeo(world, new THREE.CircleGeometry(0.55, 48));
  world.floor = addMesh(scene, world, floorGeo, world.mats.floor, [0, 0, 0], [-Math.PI / 2, 0, 0], "recv");

  world.grid = new THREE.GridHelper(1.0, 20, pal.grid, pal.grid2);
  world.grid.position.y = 0.001;
  (Array.isArray(world.grid.material) ? world.grid.material : [world.grid.material]).forEach((m) => {
    m.transparent = true;
    m.opacity = dark ? 0.28 : 0.35;
  });
  scene.add(world.grid);

  const markGeo = trackGeo(world, new THREE.RingGeometry(0.012, 0.018, 24));
  world.marker = addMesh(scene, world, markGeo, world.mats.marker, [0, 0.002, 0], [-Math.PI / 2, 0, 0], "none");
  world.marker.visible = false;

  const config = sanitizeConfig(null);
  world.parts = buildArm(world, world.mats, config);
  world.armRoot = world.parts.root;
  scene.add(world.armRoot);
  world.config = config;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.22;
  controls.maxDistance = 1.4;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0.07, 0.1);
  if (cached.camTarget) controls.target.copy(cached.camTarget);
  controls.update();
  world.controls = controls;

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
  world.scene.background = new THREE.Color(pal.bg);
  world.hemi.color.set(pal.hemiSky);
  world.hemi.groundColor.set(pal.hemiGround);
  world.hemi.intensity = pal.hemiInt;
  world.dir.intensity = pal.dirInt;
  world.fill.intensity = pal.fillInt;
  world.renderer.toneMappingExposure = dark ? 1.0 : 1.12;
  if (world.grid) {
    (Array.isArray(world.grid.material) ? world.grid.material : [world.grid.material]).forEach((m, i) => {
      if (i === 0) m.color.set(pal.grid);
      else m.color.set(pal.grid2);
      m.opacity = dark ? 0.28 : 0.35;
    });
  }
  const next = makeMaterials(dark);
  Object.keys(world.mats).forEach((k) => {
    if (next[k] && world.mats[k]) {
      world.mats[k].color.copy(next[k].color);
      if (world.mats[k].emissive && next[k].emissive) world.mats[k].emissive.copy(next[k].emissive);
      world.mats[k].emissiveIntensity = next[k].emissiveIntensity || 0;
      world.mats[k].needsUpdate = true;
      next[k].dispose();
    }
  });
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
  const hits = ray.intersectObjects(objMeshes, false);
  if (hits.length) {
    const p = hits[0].object.position;
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
  world.renderer.render(world.scene, world.camera);

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
  isMounted() {
    return !!ctx;
  },
  getStats() {
    if (!ctx) return { fps: 0, sat: false };
    return {
      fps: ctx.fps,
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
