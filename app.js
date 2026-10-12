import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const meta = await (await fetch("data/cases.json")).json();
const geomBuf = await (await fetch("data/geom.bin")).arrayBuffer();
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------------------------------------------------------------- state
const S = { param: null, level: null, caseName: "base", state: 10, x: "t", view: "quarter", cmap: "gray",
            plates: false, playing: false };
const dmgCache = new Map();
async function damage(name) {
  if (!dmgCache.has(name)) {
    dmgCache.set(name, fetch(`data/dmg/${encodeURIComponent(name)}.bin`)
      .then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)));
  }
  return dmgCache.get(name);
}

// ---------------------------------------------------------------- parameter panel
const plist = document.getElementById("plist");
const rows = new Map();
function span(p, m) {
  const v = p.levels.map((l) => meta.cases[l.case]?.[m]).filter((x) => x != null);
  return v.length ? Math.max(...v) - Math.min(...v) : 0;
}
function buildPanel() {
  plist.innerHTML = "";
  let group = null, box = null;
  for (const p of meta.params) {
    if (p.group !== group) {
      group = p.group;
      box = document.createElement("div"); box.className = "group";
      box.innerHTML = `<h3>${group}</h3>`; plist.appendChild(box);
    }
    const iBase = p.levels.findIndex((l) => l.case === "base");
    const row = document.createElement("div"); row.className = "prow";
    row.innerHTML = `
      <div class="top"><span class="name" title="${p.desc}${p.unit ? " [" + p.unit + "]" : ""}">${p.label}</span>
        <span class="bar" title="span over the levels"><i></i></span></div>
      <input type="range" min="0" max="${p.levels.length - 1}" step="1" value="${iBase}"
             aria-label="${p.desc}">
      <div class="ticks">${p.levels.map(() => "<b></b>").join("")}</div>
      <div class="val"></div>`;
    const input = row.querySelector("input");
    input.addEventListener("input", () => select(p.key, +input.value));
    box.appendChild(row);
    rows.set(p.key, { row, input, p, iBase });
  }
  updateBars();
}
function updateBars() {
  const m = document.getElementById("barMetric").value;
  const mx = Math.max(...meta.params.map((p) => span(p, m)), 1e-9);
  for (const { row, p } of rows.values()) {
    const s = span(p, m);
    row.querySelector(".bar i").style.width = `${Math.max(100 * s / mx, s > 0 ? 1.5 : 0)}%`;
    row.querySelector(".bar").title = `span over the levels: ${s.toFixed(1)} kN`;
  }
}
function select(key, idx) {
  for (const [k, r] of rows) {
    if (k !== key) { r.input.value = r.iBase; r.row.classList.remove("active"); r.row.querySelector(".val").innerHTML = ""; }
  }
  const r = key ? rows.get(key) : null;
  if (r) {
    r.input.value = idx;
    const lv = r.p.levels[idx];
    r.row.classList.toggle("active", lv.case !== "base");
    r.row.querySelector(".val").innerHTML = lv.label;
    S.param = key; S.level = idx; S.caseName = lv.case;
  } else {
    S.param = null; S.level = null; S.caseName = "base";
  }
  history.replaceState(null, "", key && S.caseName !== "base" ? `#${encodeURIComponent(S.caseName)}` : "#");
  refresh();
}
document.getElementById("barMetric").addEventListener("change", updateBars);
document.getElementById("reset").addEventListener("click", () => select(null));

// ---------------------------------------------------------------- plot
const plotEl = document.getElementById("plot");
const xOf = (c) => (S.x === "t" ? c.t : c.d);
function plotTraces() {
  const tr = [];
  const xs = (d) => (S.x === "t" ? d.map((v) => v / meta.rate_mm_per_s) : d);
  Object.entries(meta.tests).forEach(([k, v], i) => tr.push({
    x: xs(v.d), y: v.f, mode: "lines", name: i === 0 ? "tests T1–T3" : k, legendgroup: "tests",
    showlegend: i === 0, line: { color: css("--tan"), width: 3 }, opacity: 0.7, hovertemplate: `${k}<extra></extra>` }));
  if (S.param) {
    for (const lv of rows.get(S.param).p.levels) {
      const c = meta.cases[lv.case];
      if (!c || lv.case === S.caseName || lv.case === "base") continue;
      tr.push({ x: xOf(c), y: c.f, mode: "lines", line: { color: css("--context"), width: 1 }, showlegend: false,
                hovertemplate: `${lv.label.replace(/<[^>]+>/g, "")}<extra></extra>` });
    }
  }
  const b = meta.cases.base;
  tr.push({ x: xOf(b), y: b.f, mode: "lines", name: "default card", line: { color: css("--ink"), width: 1.5, dash: "dash" } });
  if (S.caseName !== "base") {
    const c = meta.cases[S.caseName];
    tr.push({ x: xOf(c), y: c.f, mode: "lines", name: "selected", line: { color: css("--blue"), width: 2.5 } });
  }
  return tr;
}
function cursorX() {
  const c = meta.cases[S.caseName];
  const s = Math.min(S.state, c.states.length - 1);
  const t = c.states[s];
  return S.x === "t" ? t : t * meta.rate_mm_per_s;
}
function yTop() {             // fixed per parameter family, so the curves do not jump while dragging
  const names = S.param ? rows.get(S.param).p.levels.map((l) => l.case) : ["base"];
  const m = Math.max(260, ...names.map((n) => meta.cases[n]?.peak ?? 0));
  return Math.ceil(m * 1.08 / 20) * 20;
}
function layout() {
  const ink = css("--ink"), line = css("--line");
  const xmax = S.x === "t" ? 0.3 : 3.0;
  return {
    margin: { l: 56, r: 12, t: 8, b: 44 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "STIX Two Text, Times New Roman, serif", size: 14, color: ink },
    xaxis: { title: S.x === "t" ? "time (s)" : "stroke (mm)", range: [0, xmax], gridcolor: line, zeroline: false },
    yaxis: { title: "force (kN)", range: [0, yTop()], gridcolor: line, zeroline: false },
    legend: { x: 0.99, xanchor: "right", y: 0.99, bgcolor: "rgba(0,0,0,0)" },
    shapes: [{ type: "line", x0: cursorX(), x1: cursorX(), y0: 0, y1: 1, yref: "paper",
               line: { color: css("--red"), width: 1.5 } }],
    hovermode: "closest",
  };
}
function drawPlot() {
  Plotly.react(plotEl, plotTraces(), layout(), { displaylogo: false, responsive: true,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"] });
}
function moveCursor() { Plotly.relayout(plotEl, { "shapes[0].x0": cursorX(), "shapes[0].x1": cursorX() }); }
document.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => {
  S.x = b.dataset.x;
  document.querySelectorAll("[data-x]").forEach((o) => o.classList.toggle("on", o === b));
  drawPlot();
}));

// ---------------------------------------------------------------- metrics
function metricsHTML() {
  const b = meta.cases.base, c = meta.cases[S.caseName];
  const tp = Object.values(meta.tests).map((v) => Math.max(...v.f));
  const f = (v, d = 1) => (v == null ? "–" : v.toFixed(d));
  const delta = (k, d = 1) => (S.caseName === "base" || c[k] == null || b[k] == null ? "" :
    `<span class="d">(${c[k] - b[k] >= 0 ? "+" : ""}${(c[k] - b[k]).toFixed(d)})</span>`);
  return `
    <div><span>peak force</span><b>${f(c.peak)} kN${delta("peak")}</b><span>tests ${Math.min(...tp).toFixed(0)}–${Math.max(...tp).toFixed(0)} kN</span></div>
    <div><span>stroke at peak</span><b>${f(c.d_peak, 2)} mm${delta("d_peak", 2)}</b><span>contains contact compliance</span></div>
    <div><span>post-peak ductility</span><b>${f(c.ductility, 2)} mm${delta("ductility", 2)}</b><span>tests 0.33–0.42 mm</span></div>
    <div><span>post-peak RMSE vs tests</span><b>${f(c.rmse_aligned)} kN${delta("rmse_aligned")}</b><span>peaks aligned, −0.1 to +1.0 mm</span></div>`;
}

// ---------------------------------------------------------------- 3-D damage view
const hdr = new Int32Array(geomBuf, 0, 4);
const [nN, nF, nP, nE] = hdr;
let off = 16;
const xyz = new Float32Array(geomBuf, off, nN * 3); off += nN * 12;
const cq = new Int32Array(geomBuf, off, nF * 4); off += nF * 16;
const own = new Int32Array(geomBuf, off, nF * 2); off += nF * 8;
const pq = new Int32Array(geomBuf, off, nP * 4);

// bounding box of the concrete (the platens are wider and are not used for framing)
const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < nF * 4; i++) for (let k = 0; k < 3; k++) {
  const v = xyz[3 * cq[i] + k]; bmin[k] = Math.min(bmin[k], v); bmax[k] = Math.max(bmax[k], v);
}
const zmin = bmin[2], zmax = bmax[2], zc = 0.5 * (zmin + zmax);
const rmax = Math.max(Math.abs(bmin[0]), Math.abs(bmax[0]), Math.abs(bmin[1]), Math.abs(bmax[1]));
const qsx = bmin[0] + bmax[0] < 0 ? -1 : 1, qsy = bmin[1] + bmax[1] < 0 ? -1 : 1;   // quadrant of the quarter model

const facePos = new Float32Array(nF * 12);
for (let f = 0; f < nF; f++) for (let k = 0; k < 4; k++) facePos.set(xyz.subarray(3 * cq[4 * f + k], 3 * cq[4 * f + k] + 3), 12 * f + 3 * k);
const posAttr = new THREE.BufferAttribute(facePos, 3);

function concreteMesh() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", posAttr);
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nF * 12), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(nF * 6), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, zc), Math.hypot(rmax * 1.5, zmax - zmin));
  return g;
}
function plateGeometry() {
  const pos = new Float32Array(nP * 12), idx = new Uint32Array(nP * 6);
  for (let f = 0; f < nP; f++) {
    for (let k = 0; k < 4; k++) pos.set(xyz.subarray(3 * pq[4 * f + k], 3 * pq[4 * f + k] + 3), 12 * f + 3 * k);
    idx.set([4 * f, 4 * f + 1, 4 * f + 2, 4 * f, 4 * f + 2, 4 * f + 3], 6 * f);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
const plateGeom = plateGeometry();

const CMAPS = {
  gray: [[0, [0.93, 0.93, 0.92]], [1, [0.08, 0.08, 0.08]]],
  heat: [[0, [0.91, 0.89, 0.86]], [0.3, [0.88, 0.72, 0.29]], [0.55, [0.85, 0.48, 0.25]], [0.8, [0.71, 0.26, 0.26]], [1, [0.2, 0.06, 0.06]]],
};
function cmapLUT(name) {
  const st = CMAPS[name], lut = new Float32Array(255 * 3);
  for (let i = 0; i < 255; i++) {
    const x = i / 254; let j = 0;
    while (j < st.length - 2 && x > st[j + 1][0]) j++;
    const [x0, c0] = st[j], [x1, c1] = st[j + 1], u = (x - x0) / (x1 - x0);
    // stops are sRGB; the renderer works in linear space
    const col = new THREE.Color().setRGB(...[0, 1, 2].map((k) => c0[k] + u * (c1[k] - c0[k])), THREE.SRGBColorSpace);
    lut.set([col.r, col.g, col.b], 3 * i);
  }
  return lut;
}
let LUT = cmapLUT("gray");
function drawColorbar() {
  const st = CMAPS[S.cmap].map(([x, c]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")}) ${x * 100}%`);
  document.querySelector("#cbar i").style.background = `linear-gradient(90deg, ${st.join(",")})`;
}

function paint(geom, dmg, s) {
  const col = geom.getAttribute("color"), idx = geom.getIndex();
  const c = col.array, ix = idx.array, base = s * nE;
  let n = 0;
  for (let f = 0; f < nF; f++) {
    const a = own[2 * f], b = own[2 * f + 1];
    const da = a >= 0 ? dmg[base + a] : 255, db = b >= 0 ? dmg[base + b] : 255;
    const aliveA = da !== 255, aliveB = db !== 255;
    if (aliveA === aliveB) continue;                     // interior (both alive) or gone (both eroded)
    const v = aliveA ? da : db;
    for (let k = 0; k < 4; k++) c.set(LUT.subarray(3 * v, 3 * v + 3), 12 * f + 3 * k);
    ix.set([4 * f, 4 * f + 1, 4 * f + 2, 4 * f, 4 * f + 2, 4 * f + 3], 6 * n); n++;
  }
  col.needsUpdate = true; idx.needsUpdate = true; geom.setDrawRange(0, 6 * n);
}

const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const MIRRORS = { quarter: [[1, 1]], full: [[1, 1], [-1, 1], [1, -1], [-1, -1]] };
function makeSide() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8580, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); scene.add(key);
  const geom = concreteMesh();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide,
                                               roughness: 0.85, metalness: 0 });
  const pmat = new THREE.MeshStandardMaterial({ color: 0x9a948b, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
                                                flatShading: true, depthWrite: false });
  const group = new THREE.Group(); scene.add(group);
  return { scene, key, geom, mat, pmat, group };
}
const sides = [makeSide(), makeSide()];
function buildGroups() {
  for (const sd of sides) {
    sd.group.clear();
    for (const [sx, sy] of MIRRORS[S.view]) {
      const m = new THREE.Mesh(sd.geom, sd.mat); m.scale.set(sx, sy, 1); sd.group.add(m);
      if (S.plates) { const p = new THREE.Mesh(plateGeom, sd.pmat); p.scale.set(sx, sy, 1); sd.group.add(p); }
    }
  }
}
function resetCamera() {
  const quarter = S.view === "quarter";
  const target = new THREE.Vector3(quarter ? qsx * rmax / 2 : 0, quarter ? qsy * rmax / 2 : 0, zc);
  // quarter: look at the two symmetry faces (x = 0 and y = 0), where the inclined shear band shows
  const dir = quarter ? new THREE.Vector3(-qsx, -qsy, 0.7) : new THREE.Vector3(1, -1.15, 0.7);
  // distance that fits the bounding sphere of the specimen (with the platens) in the narrower field of view
  const R = 0.5 * Math.hypot(zmax - zmin + 10, quarter ? rmax * 1.4 : rmax * 2.0);
  const vf = camera.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
  controls.target.copy(target);
  camera.position.copy(target).add(dir.normalize().multiplyScalar(1.0 * R / Math.sin(Math.min(vf, hf))));
  controls.update();
}
function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = (r.width / 2) / r.height; camera.updateProjectionMatrix();
  if (!userMoved) resetCamera();
}
let userMoved = false;
controls.addEventListener("start", () => { userMoved = true; });
new ResizeObserver(resize).observe(canvas);

function render() {
  controls.update();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setScissorTest(true);
  sides.forEach((sd, i) => {
    sd.key.position.copy(camera.position).add(new THREE.Vector3(0, 0, 150));
    renderer.setViewport(i * w / 2, 0, w / 2, h); renderer.setScissor(i * w / 2, 0, w / 2, h);
    renderer.render(sd.scene, camera);
  });
  requestAnimationFrame(render);
}

async function repaint() {
  const [db, dc] = await Promise.all([damage("base"), damage(S.caseName)]);
  const nb = meta.cases.base.states.length, nc = meta.cases[S.caseName].states.length;
  paint(sides[0].geom, db, Math.min(S.state, nb - 1));
  paint(sides[1].geom, dc, Math.min(S.state, nc - 1));
  const c = meta.cases[S.caseName], t = c.states[Math.min(S.state, nc - 1)];
  document.getElementById("stateLabel").textContent =
    `t = ${t.toFixed(2)} s · stroke ${(t * meta.rate_mm_per_s).toFixed(2)} mm`;
}

// ---------------------------------------------------------------- wiring
const stateIn = document.getElementById("state");
stateIn.max = meta.cases.base.states.length - 1;
stateIn.addEventListener("input", () => { S.state = +stateIn.value; repaint(); moveCursor(); });
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
  S.view = b.dataset.view;
  document.querySelectorAll("[data-view]").forEach((o) => o.classList.toggle("on", o === b));
  buildGroups(); userMoved = false; resetCamera();
}));
document.getElementById("showPlates").addEventListener("change", (e) => { S.plates = e.target.checked; buildGroups(); });
document.getElementById("cmap").addEventListener("change", (e) => {
  S.cmap = e.target.value; LUT = cmapLUT(S.cmap); drawColorbar(); repaint();
});
const playBtn = document.getElementById("play");
let timer = null;
playBtn.addEventListener("click", () => {
  S.playing = !S.playing; playBtn.innerHTML = S.playing ? "&#10074;&#10074;" : "&#9654;";
  if (S.playing) {
    timer = setInterval(() => {
      S.state = (S.state + 1) % (+stateIn.max + 1); stateIn.value = S.state; repaint(); moveCursor();
    }, 160);
  } else clearInterval(timer);
});

function refresh() {
  const c = S.caseName;
  const r = S.param ? rows.get(S.param) : null;
  const title = c === "base" ? "default card" :
    `${r.p.label} = ${r.p.levels[S.level].label}`;
  document.getElementById("caseTitle").innerHTML = title;
  document.getElementById("vlabelRight").innerHTML = c === "base" ? "selected (= default)" : title;
  document.getElementById("metrics").innerHTML = metricsHTML();
  drawPlot(); repaint();
}

if (new URLSearchParams(location.search).get("view") === "full") S.view = "full";
document.querySelectorAll("[data-view]").forEach((o) => o.classList.toggle("on", o.dataset.view === S.view));
buildPanel(); buildGroups(); drawColorbar(); resize(); resetCamera();
stateIn.value = S.state;
const fromHash = decodeURIComponent(location.hash.slice(1));
const hit = fromHash && meta.params.find((p) => p.levels.some((l) => l.case === fromHash));
if (hit) select(hit.key, hit.levels.findIndex((l) => l.case === fromHash)); else refresh();
render();
