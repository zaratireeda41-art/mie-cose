/* Texture procedurali per la vista 3D del braccio (generate su canvas, nessun file esterno). */
import * as THREE from "./vendor/three.module.min.js";

const cache = new Map();

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/* Value noise tileabile: periodo potenza di 2 (<= 256). */
const LAT = (() => {
  const r = rng(1337);
  const a = new Float32Array(256 * 256);
  for (let i = 0; i < a.length; i++) a[i] = r();
  return a;
})();

function noise(x, y, period) {
  const P = period - 1;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = xi & P, x1 = (xi + 1) & P, y0 = yi & P, y1 = (yi + 1) & P;
  const a = LAT[y0 * 256 + x0], b = LAT[y0 * 256 + x1];
  const c = LAT[y1 * 256 + x0], d = LAT[y1 * 256 + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(u, v, basePeriod, oct) {
  let sum = 0, amp = 0.5, norm = 0, p = basePeriod;
  for (let o = 0; o < oct; o++) {
    sum += amp * noise(u * p, v * p, Math.min(256, p));
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, opts) {
  const t = new THREE.CanvasTexture(c);
  const o = opts || {};
  if (o.color) t.colorSpace = THREE.SRGBColorSpace;
  if (o.repeat !== false) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = o.aniso || 4;
  t.needsUpdate = true;
  return t;
}

function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

/* Alluminio spazzolato: righe orizzontali fini, usato come roughnessMap. */
export function brushedTexture() {
  return memo("brushed", () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext("2d");
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      const row = noise(0.5, y * 0.75, 256) * 0.6 + noise(3.1, y * 0.19, 64) * 0.4;
      for (let x = 0; x < S; x++) {
        const n = row * 0.7 + 0.3 * noise((x / S) * 4, y * 0.75, 256);
        const v = Math.round(255 * (0.55 + 0.4 * n));
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tex(c);
  });
}

/* Superficie tornita (anelli concentrici) per i dischi. */
export function turnedTexture() {
  return memo("turned", () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext("2d");
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x / S - 0.5, dy = y / S - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy);
        const ring = 0.5 + 0.5 * Math.sin(r * 900 + noise(r * 60, 0.5, 64) * 4);
        const v = Math.round(255 * (0.5 + 0.28 * ring + 0.12 * noise(x * 0.3, y * 0.3, 64)));
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tex(c, { repeat: false });
  });
}

/* Legno: venature con fbm. planks = numero di assi (0 = blocco unico). */
function woodCanvas(S, planks, light, dark, seed) {
  const c = canvas(S, S);
  const g = c.getContext("2d");
  const img = g.createImageData(S, S);
  const rough = canvas(S, S);
  const gr = rough.getContext("2d");
  const imgR = gr.createImageData(S, S);
  const n = Math.max(1, planks);
  const tint = [];
  const r = rng(seed);
  for (let k = 0; k < n; k++) tint.push(0.85 + r() * 0.3);
  for (let y = 0; y < S; y++) {
    const vv = y / S;
    const k = Math.min(n - 1, Math.floor(vv * n));
    const local = vv * n - k;
    for (let x = 0; x < S; x++) {
      const uu = x / S;
      const warp = fbm(uu + k * 0.37, vv * 2 + k * 0.11, 4, 4);
      const ringsF = (local * 16 + warp * 2.2 + k * 3.7) * Math.PI * 2;
      const ring = Math.pow(0.5 + 0.5 * Math.sin(ringsF), 4);
      const fine = noise(uu * 256, vv * 64 * n, 256);
      const streak = noise(uu * 8, vv * 96 * n, 256);
      let t = clamp01(0.22 + ring * 0.32 + fine * 0.16 + streak * 0.22 + (warp - 0.5) * 0.25);
      let shade = tint[k];
      if (planks > 0) {
        const edge = Math.min(local, 1 - local) * (S / n);
        if (edge < 1.5) shade *= 0.45;
        else if (edge < 3) shade *= 0.8;
        const seam = (uu * 1 + k * 0.43) % 1;
        if (Math.abs(seam - 0.5) * S < 1) shade *= 0.55;
      }
      const i = (y * S + x) * 4;
      img.data[i] = Math.round(mix(light[0], dark[0], t) * shade);
      img.data[i + 1] = Math.round(mix(light[1], dark[1], t) * shade);
      img.data[i + 2] = Math.round(mix(light[2], dark[2], t) * shade);
      img.data[i + 3] = 255;
      const rv = Math.round(255 * (0.55 + t * 0.35));
      imgR.data[i] = imgR.data[i + 1] = imgR.data[i + 2] = rv;
      imgR.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  gr.putImageData(imgR, 0, 0);
  return { map: tex(c, { color: true, aniso: 8 }), rough: tex(rough, { aniso: 8 }) };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function tableWood() {
  return memo("tableWood", () => woodCanvas(512, 4, [186, 160, 130], [118, 92, 66], 7));
}

export function blockWood() {
  return memo("blockWood", () => woodCanvas(256, 0, [226, 184, 132], [178, 128, 78], 21));
}

/* Tappetino da taglio verde con griglia in cm. w,h in cm. */
export function cuttingMat(wcm, hcm) {
  return memo("mat" + wcm + "x" + hcm, () => {
    const PX = 20;
    const W = wcm * PX, H = hcm * PX;
    const c = canvas(W, H);
    const g = c.getContext("2d");
    g.fillStyle = "#24584a";
    g.fillRect(0, 0, W, H);
    const r = rng(99);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
      g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
    }
    const margin = 1.5 * PX;
    for (let x = 0; x <= wcm - 3; x++) {
      const px = margin + x * PX;
      g.strokeStyle = x % 5 === 0 ? "rgba(225,240,232,0.62)" : "rgba(225,240,232,0.26)";
      g.lineWidth = x % 5 === 0 ? 2 : 1;
      g.beginPath();
      g.moveTo(px, margin);
      g.lineTo(px, H - margin);
      g.stroke();
    }
    for (let y = 0; y <= hcm - 3; y++) {
      const py = margin + y * PX;
      g.strokeStyle = y % 5 === 0 ? "rgba(225,240,232,0.62)" : "rgba(225,240,232,0.26)";
      g.lineWidth = y % 5 === 0 ? 2 : 1;
      g.beginPath();
      g.moveTo(margin, py);
      g.lineTo(W - margin, py);
      g.stroke();
    }
    g.strokeStyle = "rgba(225,240,232,0.3)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(margin, H - margin);
    g.lineTo(margin + (H - 2 * margin), margin);
    g.moveTo(W - margin, H - margin);
    g.lineTo(W - margin - (H - 2 * margin), margin);
    g.stroke();
    g.beginPath();
    g.arc(margin, H - margin, 10 * PX, -Math.PI / 2, 0);
    g.stroke();
    g.fillStyle = "rgba(225,240,232,0.75)";
    g.font = "bold 13px Helvetica, Arial, sans-serif";
    g.textAlign = "center";
    for (let x = 0; x <= wcm - 3; x += 5) g.fillText(String(x), margin + x * PX, margin - 8);
    g.textAlign = "right";
    for (let y = 5; y <= hcm - 3; y += 5) g.fillText(String(y), margin - 6, margin + y * PX + 4);
    g.textAlign = "left";
    g.font = "bold 15px Helvetica, Arial, sans-serif";
    g.fillText("MIE COSE · LAB", W - margin - 150, H - 9);
    g.font = "12px Helvetica, Arial, sans-serif";
    g.fillText("tappetino autorigenerante · cm", margin, H - 9);
    return tex(c, { color: true, repeat: false, aniso: 8 });
  });
}

/* Fibra di carbonio twill 2x2. */
export function carbonTexture() {
  return memo("carbon", () => {
    const S = 256, N = 16, cell = S / N;
    const c = canvas(S, S);
    const g = c.getContext("2d");
    g.fillStyle = "#111214";
    g.fillRect(0, 0, S, S);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const horiz = (i + j) % 4 < 2;
        const x = i * cell, y = j * cell;
        const grad = horiz ? g.createLinearGradient(x, y, x, y + cell) : g.createLinearGradient(x, y, x + cell, y);
        grad.addColorStop(0, "#151618");
        grad.addColorStop(0.5, horiz ? "#3a3d42" : "#2a2c30");
        grad.addColorStop(1, "#151618");
        g.fillStyle = grad;
        g.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }
    }
    return tex(c, { color: true });
  });
}

/* Cartone kraft con nastro adesivo e stampa. */
export function cardboardTexture() {
  return memo("cardboard", () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext("2d");
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = fbm(x / S, y / S, 8, 4);
        const corr = 0.5 + 0.5 * Math.sin((x / S) * Math.PI * 2 * 40);
        const t = n * 0.8 + corr * 0.06;
        const i = (y * S + x) * 4;
        img.data[i] = Math.round(mix(196, 160, t));
        img.data[i + 1] = Math.round(mix(152, 118, t));
        img.data[i + 2] = Math.round(mix(102, 74, t));
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = "rgba(214,184,128,0.85)";
    g.fillRect(S * 0.38, 0, S * 0.24, S);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(S * 0.38, 0, 3, S);
    g.fillRect(S * 0.62 - 3, 0, 3, S);
    g.fillStyle = "rgba(30,24,18,0.78)";
    g.font = "bold 22px Helvetica, Arial, sans-serif";
    g.fillText("↑↑", 18, 44);
    g.font = "bold 14px Helvetica, Arial, sans-serif";
    g.fillText("ALTO", 16, 64);
    g.font = "bold 13px Helvetica, Arial, sans-serif";
    g.fillText("FRAGILE", 176, 236);
    return tex(c, { color: true, repeat: false });
  });
}

/* Gomma rigata per i polpastrelli della pinza (bump). */
export function ridgeTexture() {
  return memo("ridge", () => {
    const S = 64;
    const c = canvas(S, S);
    const g = c.getContext("2d");
    for (let y = 0; y < S; y++) {
      const v = Math.round(255 * (0.5 + 0.5 * Math.sin((y / S) * Math.PI * 2 * 8)));
      g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
      g.fillRect(0, y, S, 1);
    }
    return tex(c);
  });
}

/* Etichetta del servo. */
export function servoSticker(kind) {
  return memo("sticker-" + kind, () => {
    const c = canvas(256, 96);
    const g = c.getContext("2d");
    const sg = kind === "sg";
    g.fillStyle = sg ? "#e9edf5" : "#0e0f12";
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = sg ? "#1f4fd1" : "#c8202a";
    g.fillRect(0, 70, 256, 8);
    g.fillStyle = sg ? "#10204a" : "#f4f4f4";
    g.font = "bold 40px Helvetica, Arial, sans-serif";
    g.fillText(sg ? "SG90" : "MG996R", 14, 46);
    g.font = "bold 13px Helvetica, Arial, sans-serif";
    g.fillStyle = sg ? "#30406a" : "#b9bcc4";
    g.fillText(sg ? "MICRO SERVO · 9 g · 1.8 kg·cm" : "METAL GEAR · 11 kg·cm · 4.8–6.6 V", 14, 64);
    g.fillStyle = sg ? "#30406a" : "#8a8d94";
    g.font = "11px Helvetica, Arial, sans-serif";
    g.fillText("DIGITAL HI-TORQUE", 14, 92);
    return tex(c, { color: true, repeat: false });
  });
}

/* Targhetta incisa sulla base. */
export function labelTexture() {
  return memo("label", () => {
    const c = canvas(512, 128);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "#d9dce1");
    grad.addColorStop(1, "#b6bac1");
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 128);
    const r = rng(5);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = "rgba(255,255,255," + (0.05 + r() * 0.08) + ")";
      g.fillRect(0, r() * 128, 512, 1);
    }
    g.strokeStyle = "rgba(40,42,48,0.55)";
    g.lineWidth = 3;
    g.strokeRect(6, 6, 500, 116);
    g.fillStyle = "#ff7a1a";
    g.beginPath();
    g.arc(56, 64, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "bold 34px Helvetica, Arial, sans-serif";
    g.textAlign = "center";
    g.fillText("M", 56, 76);
    g.textAlign = "left";
    g.fillStyle = "#24262b";
    g.font = "bold 46px Helvetica, Arial, sans-serif";
    g.fillText("MIE COSE · R6", 104, 64);
    g.font = "bold 20px Helvetica, Arial, sans-serif";
    g.fillStyle = "#3a3d44";
    g.fillText("BRACCIO ROBOTICO 6 ASSI · N. 001", 106, 100);
    return tex(c, { color: true, repeat: false });
  });
}

/* Ombra di contatto morbida. */
export function blobTexture() {
  return memo("blob", () => {
    const S = 128;
    const c = canvas(S, S);
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.35, "rgba(0,0,0,0.75)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.22)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    return tex(c, { repeat: false });
  });
}

/* Sfondo a gradiente (studio). */
export function backdropTexture(top, mid, bottom) {
  const key = "bg" + top + mid + bottom;
  return memo(key, () => {
    const c = canvas(4, 512);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, top);
    grad.addColorStop(0.45, mid);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 512);
    return tex(c, { color: true, repeat: false });
  });
}
