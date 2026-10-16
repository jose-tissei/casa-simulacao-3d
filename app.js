import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const [geo, hourly, stat] = await Promise.all(
  ['data/geometry.json', 'data/hourly.json', 'data/static.json'].map(u => fetch(u).then(r => r.json())));

const CUR = stat.project.currency || 'R$';
const st = () => stat.project.season_text[LANG];                           // {sum, win}: months of the summer / winter in this hemisphere
// ---------------------------------------------------------------- language (pt-BR default, en available) -------------------
const hashLang = new URLSearchParams(location.hash.slice(1)).get('lang');
let LANG = ['pt', 'en'].includes(hashLang) ? hashLang : (localStorage.getItem('lang') || 'pt');
let SC = stat.scales[LANG];
const X = (en, pt) => LANG === 'pt' ? pt : en;                          // text in the current language
const rn = n => LANG === 'pt' ? (stat.names_pt[n] ?? n) : n;            // room name
const nf = (v, d = 0) => (v !== null && v !== undefined && !Number.isNaN(v)) ? Number(v).toLocaleString(LANG === 'pt' ? 'pt-BR' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const MONTHS_L = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], pt: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] };
const monthsShort = () => MONTHS_L[LANG];
const dateStr = iso => { const d = new Date(iso + 'T12:00:00'); return `${d.getDate()} ${MONTHS_L[LANG][d.getMonth()]}`; };

// ---------------------------------------------------------------- scene -------------------------------------------
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const PROJ = stat.project, SK = Math.max(PROJ.size / 23, 0.5);        // SK = size of the building relative to the original house
const CENTER = new THREE.Vector3(PROJ.center[0], 1.0 * SK, -PROJ.center[1]);            // model (x, y) -> three (x, up, -y)
const m2t = (x, y, z = 0) => new THREE.Vector3(x, z, -y);       // model Z-up (x west, y south) -> three Y-up
const srgb = (r, g, b) => { const c = new THREE.Color(); c.setRGB(r, g, b, THREE.SRGBColorSpace); return c; };

// ground, street
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: srgb(0.45, 0.60, 0.36), roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(CENTER.x, -0.12, CENTER.z); ground.receiveShadow = true; scene.add(ground);
const street = new THREE.Mesh(new THREE.PlaneGeometry(400, 9), new THREE.MeshStandardMaterial({ color: srgb(0.30, 0.31, 0.33), roughness: 1 }));
street.rotation.x = -Math.PI / 2; street.position.set(4.5, -0.1, 11.5); street.receiveShadow = true; if (PROJ.has_street) scene.add(street);

// lights
const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x6f7d5c, 0.5); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d0, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera; sc.left = -26 * SK; sc.right = 26 * SK; sc.top = 26 * SK; sc.bottom = -26 * SK; sc.near = 1; sc.far = 160 * SK;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
sun.target.position.copy(CENTER);
scene.add(sun, sun.target);
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
scene.add(sunBall);
const sunLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5 }));
scene.add(sunLine);

// ---------------------------------------------------------------- house -------------------------------------------
const house = new THREE.Group(); scene.add(house);
const meshes = [];                  // {mesh, el, base: Float32Array, kind}
const hideable = [];                // roofs, gables, ceilings, beams, linings
for (const el of geo.elements) {
  const v = el.v, f = el.f, n = f.length / 3;
  const pos = new Float32Array(n * 9), col = new Float32Array(n * 9);
  const c0 = srgb(el.col[0], el.col[1], el.col[2]);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const vi = f[i * 3 + k] * 3, o = i * 9 + k * 3;
    pos[o] = v[vi]; pos[o + 1] = v[vi + 2]; pos[o + 2] = -v[vi + 1];
    col[o] = c0.r; col[o + 1] = c0.g; col[o + 2] = c0.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const glass = el.c === 'IfcWindow' || el.tr > 0.2;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
                                                transparent: glass, opacity: glass ? 0.3 : 1, depthWrite: !glass });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = !glass; mesh.receiveShadow = true;
  const lname = el.n.toLowerCase();
  const isRoof = el.rf !== undefined ? el.rf : (lname.includes('roof') && !lname.includes('lining') || lname.includes('gable'));
  const isCeil = el.c === 'IfcCovering' || el.c === 'IfcBeam';
  const entry = { mesh, el, base: col.slice(), kind: isRoof ? 'roof' : isCeil ? 'ceiling' : el.c };
  if (isRoof || isCeil) hideable.push(entry);
  meshes.push(entry); house.add(mesh);
}

// ---------------------------------------------------------------- helpers -----------------------------------------
const dateOf = d => { const dt = new Date(2023, 0, d); return `${dt.getDate()} ${monthsShort()[dt.getMonth()]}`; };
const fmtHour = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
const COMPASS = { en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
                  pt: ['N', 'NNE', 'NE', 'ENE', 'L', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'] };
const compassOf = deg => COMPASS[LANG][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

function solar(doy, hour, lat, lon, tz) {
  const rad = Math.PI / 180, g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
              - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eq + 4 * lon - 60 * tz, ha = (tst / 4 - 180) * rad, la = lat * rad;
  const cz = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha);
  const zen = Math.acos(clamp(cz, -1, 1));
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) + Math.PI) / rad;
  return { elev: 90 - zen / rad, az: (az + 360) % 360 };
}
const { lat: LAT, lon: LON, tz: TZ } = stat.site;
// direction TO the sun in three coordinates: east = -x, north = +z
const sunVec = (elev, az) => { const e = elev * Math.PI / 180, a = az * Math.PI / 180;
  return new THREE.Vector3(-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)); };

// colour ramps
function ramp(stops, t) {
  t = clamp(t, 0, 1) * (stops.length - 1); const i = Math.min(Math.floor(t), stops.length - 2), f = t - i;
  return stops[i].map((c, k) => lerp(c, stops[i + 1][k], f));
}
const VIRIDIS = [[68, 1, 84], [59, 82, 139], [33, 144, 141], [93, 201, 99], [253, 231, 37]];
const SUNRAMP = [[120, 130, 145], [250, 214, 80], [255, 150, 30]];
const COMFRAMP = [[215, 48, 39], [254, 224, 139], [26, 152, 80]];
const ENERGY = [[49, 54, 149], [116, 173, 209], [254, 224, 144], [244, 109, 67], [165, 0, 38]];
const css = c => `rgb(${c.map(Math.round).join(',')})`;
const toLinear = c => srgb(c[0] / 255, c[1] / 255, c[2] / 255);

// ---------------------------------------------------------------- sun path ----------------------------------------
const pathGroup = new THREE.Group(); scene.add(pathGroup);
for (const [d, colr] of [[355, 0xff8a3d], [80, 0x6fcf97], [172, 0x56ccf2]]) {
  const pts = [];
  for (let h = 0; h <= 24; h += 0.25) { const s = solar(d, h, LAT, LON, TZ); if (s.elev > 0) pts.push(CENTER.clone().add(sunVec(s.elev, s.az).multiplyScalar(48 * SK))); }
  pathGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colr })));
}
function textSprite(text, size = 1, color = '#ffffff', bg = null) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sp.userData = { cv, ctx, size, color, bg };
  setSprite(sp, text);
  return sp;
}
function setSprite(sp, text, color) {
  const { cv, ctx, size, bg } = sp.userData; color = color || sp.userData.color;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const lines = String(text).split('\n');
  let fs = 44; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${fs}px Segoe UI, Arial`;
  while (fs > 16 && Math.max(...lines.map(l => ctx.measureText(l).width)) > cv.width - 44) { fs -= 2; ctx.font = `bold ${fs}px Segoe UI, Arial`; }   // long names shrink to fit
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 28, h = lines.length * 52 + 14;
  if (bg) { ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect((cv.width - w) / 2, (cv.height - h) / 2, w, h, 16); ctx.fill(); }
  ctx.fillStyle = color; lines.forEach((l, i) => ctx.fillText(l, cv.width / 2, cv.height / 2 + (i - (lines.length - 1) / 2) * 52));
  sp.material.map.needsUpdate = true; sp.scale.set(4 * size, size, 1); sp.renderOrder = 20;
}
const compassSprites = [];
const compassText = () => PROJ.has_street ? [[X('N  (street, front)', 'N  (rua, frente)'), [0, 0, 1]], [X('S  (back yard)', 'S  (quintal)'), [0, 0, -1]],
                           [X('E  (left side)', 'L  (lado esquerdo)'), [-1, 0, 0]], [X('W  (right side)', 'O  (lado direito)'), [1, 0, 0]]]
  : [[X('N  (north)', 'N  (norte)'), [0, 0, 1]], [X('S  (south)', 'S  (sul)'), [0, 0, -1]], [X('E  (east)', 'L  (leste)'), [-1, 0, 0]], [X('W  (west)', 'O  (oeste)'), [1, 0, 0]]];
for (const [tx, p] of compassText()) {
  const sp = textSprite(tx, 2.2, '#ffe9a8'); sp.position.set(CENTER.x + p[0] * 40 * SK, 0.5, CENTER.z + p[2] * 40 * SK); pathGroup.add(sp); compassSprites.push(sp);
}
const sunLabel = textSprite('', 2.2, '#ffd23f'); scene.add(sunLabel);

// ---------------------------------------------------------------- room overlays -----------------------------------
const zoneNames = Object.keys(geo.zones);
const zoneMeshes = {};
const labelGroup = new THREE.Group(); scene.add(labelGroup);
for (const zn of zoneNames) {
  const pts = geo.zones[zn].map(p => new THREE.Vector2(p[0], p[1]));
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide }));
  const z0 = geo.zones_z0 ? geo.zones_z0[zn] : 0;
  m.position.y = z0 + 0.06; m.renderOrder = 5; scene.add(m);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const sp = textSprite(rn(zn), 1.25, '#ffffff', 'rgba(10,15,25,.72)'); sp.position.set(cx, z0 + 0.9, -cy); labelGroup.add(sp);
  zoneMeshes[zn] = { mesh: m, sprite: sp };
}

// ---------------------------------------------------------------- state / ui --------------------------------------
const S = { doy: 172, hour: 10.5, overlay: 'sun', season: 'annual_kWh_m2', playing: null };
const $ = id => document.getElementById(id);
const roomOf = zn => stat.zone_to_room[zn];
const comfortRow = room => stat.comfort.find(r => r.room === room);

function facadeValue(az) {      // energy for a wall facing true azimuth az, interpolated between N, E, S, W
  const f = n => stat.facade.find(r => r.name === n)[S.season];
  const vals = [f('North wall'), f('East wall'), f('South wall'), f('West wall')];
  const t = ((az % 360) + 360) % 360 / 90, i = Math.floor(t) % 4, fr = t - Math.floor(t);
  return lerp(vals[i], vals[(i + 1) % 4], fr);
}
function energyRange() {
  const names = ['North wall', 'East wall', 'South wall', 'West wall', 'Roof (horizontal)'];
  const v = names.map(n => stat.facade.find(r => r.name === n)[S.season]); return [Math.min(...v), Math.max(...v)];
}

function applyWallColours() {
  const [lo, hi] = energyRange(); const roof = stat.facade.find(r => r.name === 'Roof (horizontal)')[S.season];
  for (const e of meshes) {
    const colAttr = e.mesh.geometry.getAttribute('color'), arr = colAttr.array, o = e.el.o;
    for (let i = 0; i < arr.length / 9; i++) {
      let r, g, b;
      if (S.overlay === 'wall') {
        if (o && o[i] >= 0) { const val = o[i] === 1000 ? roof : facadeValue(o[i]); const c = toLinear(ramp(ENERGY, (val - lo) / (hi - lo))); r = c.r; g = c.g; b = c.b; }
        else { r = e.base[i * 9] * 0.45; g = e.base[i * 9 + 1] * 0.45; b = e.base[i * 9 + 2] * 0.45; }
      } else { r = e.base[i * 9]; g = e.base[i * 9 + 1]; b = e.base[i * 9 + 2]; }
      for (let k = 0; k < 3; k++) { arr[i * 9 + k * 3] = r; arr[i * 9 + k * 3 + 1] = g; arr[i * 9 + k * 3 + 2] = b; }
    }
    colAttr.needsUpdate = true;
  }
}

function setGhost() {
  const ghost = $('ghost').checked;
  for (const e of hideable) {
    const solidRoof = S.overlay === 'wall' && e.kind === 'roof';          // in wall-energy mode the roof must be visible
    const g = ghost && !solidRoof, m = e.mesh.material;
    m.transparent = g; m.opacity = g ? 0.0 : 1.0; m.depthWrite = !g;
  }
}

function updateSun() {
  const s = solar(S.doy, S.hour, LAT, LON, TZ), up = s.elev > 0;
  const v = sunVec(Math.max(s.elev, 0.5), s.az);
  sun.position.copy(CENTER).add(v.clone().multiplyScalar(80 * SK));
  sun.intensity = up ? 3.0 * clamp(Math.sin(s.elev * Math.PI / 180) * 2 + 0.1, 0, 1) : 0;
  hemi.intensity = 0.12 + 0.5 * clamp(s.elev / 25, 0, 1) + (s.elev > -6 ? 0.05 : 0);
  sun.color.set(s.elev < 12 ? 0xffc27a : 0xfff1d0);
  sun.castShadow = $('shadows').checked && up;
  scene.background = new THREE.Color().setRGB(...ramp([[8, 12, 30], [60, 80, 130], [150, 190, 235]], clamp((s.elev + 8) / 40, 0, 1)).map(x => x / 255), THREE.SRGBColorSpace);
  const pos = CENTER.clone().add(sunVec(Math.max(s.elev, -5), s.az).multiplyScalar(48 * SK));
  sunBall.position.copy(pos); sunBall.visible = up; sunLabel.position.copy(pos).add(new THREE.Vector3(0, 3.5, 0)); sunLabel.visible = up;
  setSprite(sunLabel, X(`${fmtHour(S.hour)}  ${Math.round(s.elev)}° high`, `${fmtHour(S.hour)}  ${Math.round(s.elev)}° de altura`));
  sunLine.geometry.setFromPoints([pos, CENTER]); sunLine.visible = up;
  return s;
}

function updateOverlay(h, band) {
  const mode = S.overlay, show = mode !== 'none' && mode !== 'wall', labels = $('labels').checked;
  let legendTitle = '', scale = '', gradient = '';
  for (const zn of zoneNames) {
    const z = zoneMeshes[zn]; z.mesh.visible = show; z.sprite.visible = labels && (show || mode === 'wall' || mode === 'none');
    const zl = rn(zn); let text = zl, c = null;
    const room = roomOf(zn), isIndoorRoom = hourly.rooms[room] !== undefined;
    if (mode === 'sun') { const v = hourly.zones[zn].sun[h]; c = ramp(SUNRAMP, v / 100); text = X(`${zl}\n${v}% in sun`, `${zl}\n${v}% em sol`); }
    else if (mode === 'lux') { const v = hourly.zones[zn].lux[h]; c = ramp(VIRIDIS, (Math.log10(Math.max(v, 1)) - 0.8) / 3.7); text = `${zl}\n${nf(v)} lux`; }
    else if (mode === 'temp') {
      const T = isIndoorRoom ? hourly.rooms[room][h] : hourly.temp[h];
      const lo = hourly.lo80[h], hi = hourly.hi80[h];
      c = T > hi ? ramp([[255, 200, 80], [215, 48, 39]], (T - hi) / 6) : T < lo ? ramp([[120, 200, 255], [40, 80, 200]], (lo - T) / 6) : [90, 190, 110];
      text = `${zl}\n${nf(T, 1)}°C ${isIndoorRoom ? '' : X('(outdoors)', '(ao ar livre)')}${T > hi ? X(' hot', ' quente') : T < lo ? X(' cold', ' frio') : ' ok'}`;
    } else if (mode === 'cool') {
      const row = stat.cooling.find(r => r.room === room);
      if (row && row.schedule !== 'not cooled') { const r = rateOf('cooling_kwh_m2', row.kWh_per_m2_year); c = hexRgb(r.color);
        text = `${zl}\n${CUR} ${nf(row.cost_BRL_year)}/${X('yr', 'ano')} · ${r.label}`; } else { c = [150, 150, 150]; text = `${zl}\n${X('(not air-conditioned)', '(sem ar-condicionado)')}`; }
    } else if (mode === 'comfort') {
      const row = comfortRow(room);
      if (row) { const r = rateOf('comfort_pct', row['comfort80_%']); c = hexRgb(r.color); text = `${zl}\n${row['comfort80_%']}% ${X('of the year', 'do ano')}: ${r.label}`; } else { c = [150, 150, 150]; text = `${zl}\n${X('(outdoor)', '(ao ar livre)')}`; }
    }
    if (c) z.mesh.material.color.copy(toLinear(c));
    if (labels) setSprite(z.sprite, text);
  }
  if (mode === 'sun') { legendTitle = X('Share of each room floor in DIRECT sun right now (from the ray-traced simulation)', 'Parcela do piso de cada ambiente em sol DIRETO agora (da simulação com traçado de raios)'); gradient = SUNRAMP; scale = '0%  →  100%'; }
  else if (mode === 'lux') { legendTitle = X('Natural light on a table-height plane, room average right now (lux)', 'Luz natural em um plano na altura da mesa, média do ambiente agora (lux)'); gradient = VIRIDIS; scale = X('6 lux  →  20,000 lux (log scale).  Goal at home: about 150 lux general light, 300–500 lux for reading', '6 lux  →  20.000 lux (escala log).  Meta em casa: cerca de 150 lux de luz geral, 300–500 lux para leitura'); }
  else if (mode === 'temp') { legendTitle = X('Indoor feel (operative) temperature now: green = inside the comfort band, orange/red = hot, blue = cold', 'Temperatura operativa interna agora: verde = dentro da faixa de conforto, laranja/vermelho = quente, azul = frio'); gradient = [[40, 80, 200], [120, 200, 255], [90, 190, 110], [255, 200, 80], [215, 48, 39]]; scale = X('colder  ←  comfortable  →  hotter', 'mais frio  ←  confortável  →  mais quente'); }
  else if (mode === 'cool') { legendTitle = X(`Cost to cool each room in summer with an air conditioner (${CUR} per year at ${CUR} ${nf(stat.cooling_assumptions.tariff_BRL_per_kWh, 2)}/kWh; colour = level)`, `Custo para refrigerar cada ambiente no verão com ar-condicionado (${CUR} por ano a ${CUR} ${nf(stat.cooling_assumptions.tariff_BRL_per_kWh, 2)}/kWh; cor = nível)`);
    const bs = SC.scales.cooling_kwh_m2.bands; gradient = bs.flatMap(b => [hexRgb(SC.levels[b.level].color), hexRgb(SC.levels[b.level].color)]);
    scale = bs.map(b => `${b.label} ${b.lo === null ? '<' + b.hi : b.hi === null ? '≥' + b.lo : b.lo + '–' + b.hi} kWh/m²`).join('  ·  '); }
  else if (mode === 'comfort') { legendTitle = X('Hours per year inside the comfortable range (colour = verdict)', 'Horas por ano dentro da faixa confortável (cor = veredito)');
    const bs = SC.scales.comfort_pct.bands; gradient = bs.flatMap(b => [hexRgb(SC.levels[b.level].color), hexRgb(SC.levels[b.level].color)]);
    scale = bs.map(b => `${b.label} ${b.lo === null ? '<' + b.hi : b.hi === null ? '≥' + b.lo : b.lo + '–' + b.hi}%`).join('  ·  '); }
  else if (mode === 'wall') { const [lo, hi] = energyRange(); legendTitle = X('Sunshine energy that hits each wall / the roof, ', 'Energia solar que bate em cada parede / na cobertura, ') + ({ annual_kWh_m2: X('whole year', 'ano todo'), summer_kWh_m2: X(`summer (${st().sum})`, `verão (${st().sum})`), winter_kWh_m2: X(`winter (${st().win})`, `inverno (${st().win})`) })[S.season] + X(' (kWh per m²)', ' (kWh por m²)'); gradient = ENERGY; scale = `${Math.round(lo)}  →  ${Math.round(hi)} kWh/m²`; }
  $('legend').style.display = mode === 'none' ? 'none' : 'block';
  $('legendTitle').textContent = legendTitle; $('legendScale').textContent = scale;
  if (gradient) $('bar').style.background = `linear-gradient(90deg, ${gradient.map(css).join(',')})`;
}

function updateInfo(s, h) {
  $('dateLabel').textContent = `${dateOf(S.doy)}   ${fmtHour(S.hour)}`;
  $('sunInfo').textContent = s.elev > 0 ? X(`${Math.round(s.elev)}° high, from ${compassOf(s.az)}`, `${Math.round(s.elev)}° de altura, vindo de ${compassOf(s.az)}`) : X('below the horizon', 'abaixo do horizonte');
  const wd = hourly.wdir[h], ws = hourly.wspd[h];
  $('windInfo').textContent = `${compassOf(wd)} ${nf(ws, 1)} m/s`;
  $('windarrow').style.transform = `rotate(${wd + 180}deg)`;       // arrow shows where the air is going
  $('outT').textContent = `${nf(hourly.temp[h], 1)}°C`;
  $('band').textContent = `${nf(hourly.lo80[h])}–${nf(hourly.hi80[h])}°C`;
  $('ghi').textContent = `${hourly.ghi[h]} W/m²`;
  let html = `<tr><th>${X('Room', 'Ambiente')}</th><th>${X('Sun on floor', 'Sol no piso')}</th><th>${X('Light (lux)', 'Luz (lux)')}</th><th>${X('Feels', 'Sensação')}</th></tr>`;
  for (const zn of zoneNames) {
    const room = roomOf(zn), indoor = hourly.rooms[room] !== undefined;
    let tcell = `<span class="chip na">${X('outdoor', 'ao ar livre')}</span>`;
    if (indoor) { const T = hourly.rooms[room][h], lo = hourly.lo80[h], hi = hourly.hi80[h];
      tcell = `${nf(T, 1)}° <span class="chip ${T > hi ? 'hot' : T < lo ? 'cold' : 'ok'}">${T > hi ? X('hot', 'quente') : T < lo ? X('cold', 'frio') : 'ok'}</span>`; }
    const lux = hourly.zones[zn].lux[h], goal = SC.lux_recs[kindOf(zn)].general[1];
    const lchip = s.elev <= 0 || kindOf(zn) === 'outdoor' ? '' : lux >= goal ? ` <span class="chip" style="background:${SC.levels[4].color}" title="${X(`Daylight alone gives the recommended general light (${goal} lux)`, `Só a luz natural já dá a luz geral recomendada (${goal} lux)`)}">${X('no lamp', 'sem lâmpada')}</span>`
      : lux >= goal / 2 ? ` <span class="chip" style="background:${SC.levels[2].color}" title="${X(`About half of the recommended ${goal} lux: a lamp helps`, `Cerca de metade dos ${goal} lux recomendados: uma lâmpada ajuda`)}">${X('dim', 'fraca')}</span>`
      : ` <span class="chip" style="background:${SC.levels[1].color}" title="${X(`Far below the recommended ${goal} lux: switch a lamp on`, `Muito abaixo dos ${goal} lux recomendados: acenda uma lâmpada`)}">${X('lamp', 'acenda')}</span>`;
    html += `<tr><td>${rn(zn)}</td><td>${hourly.zones[zn].sun[h]}%</td><td>${nf(lux)}${lchip}</td><td>${tcell}</td></tr>`;
  }
  $('roomTable').innerHTML = html;
  $('note').textContent = s.elev <= 0 ? X('Night: no sun. Lux values are only the simulated daylight.', 'Noite: sem sol. Os valores de lux são só a luz natural simulada.') : '';
}

function refresh() {
  const h = clamp((Math.floor(S.doy) - 1) * 24 + Math.floor(S.hour), 0, 8759);
  const s = updateSun(); updateOverlay(h); updateInfo(s, h); applyWallColours(); setGhost();
  $('doy').value = S.doy; $('hour').value = S.hour;
}

// ---------------------------------------------------------------- ratings (scales come from tools/ratings.py, one set per language) -------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const isNum = v => v !== null && v !== undefined && !Number.isNaN(v);
const COLD = !!stat.project.cold_climate;
const HEAT = (stat.cooling_assumptions.heating || {}).enabled;
function rateOf(key, v) {
  if (key === 'comfort_pct' && COLD) return { level: null, label: 'n/a', meaning: '', color: SC.neutral };
  if (!isNum(v)) return { level: null, label: 'n/a', meaning: '', color: SC.neutral };
  for (const b of SC.scales[key].bands)
    if ((b.lo === null || v >= b.lo) && (b.hi === null || v < b.hi)) return { ...b, color: SC.levels[b.level].color };
  return { level: null, label: 'n/a', meaning: '', color: SC.neutral };
}
const lvl5 = r => r.level === null ? '' : ` ${r.level + 1}/5`;
const chip = (key, v, text) => { const r = rateOf(key, v); return `<span class="chip" style="background:${r.color}" title="${esc(r.meaning)}">${text ?? r.label + lvl5(r)}</span>`; };
const overall = levels => { const v = levels.filter(x => x !== null && x !== undefined); if (!v.length) return { score: null, label: 'n/a', color: SC.neutral };
  const m = v.reduce((a, b) => a + b, 0) / v.length, l = Math.round(m); return { score: m + 1, label: SC.levels[l].name, color: SC.levels[l].color }; };
const overallChip = levels => { const o = overall(levels); return o.score === null ? '–' : `<span class="chip" style="background:${o.color}">${o.label} ${nf(o.score, 1)}/5</span>`; };
const hexRgb = hx => [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16));
const kindOf = name => stat.room_kind[name] || stat.room_kind[roomOf(name)] || 'living';
const LONG_STAY = ['living', 'bedroom', 'kitchen'];
const TYPE_COLOR = { BR: '#2e9e5b', INT: '#3b82c4', RULE: '#9a7bd1' };
const bf = v => nf(v, Number.isInteger(v) ? 0 : 1);
const bandRange = b => b.lo === null ? X(`below ${bf(b.hi)}`, `abaixo de ${bf(b.hi)}`) : b.hi === null ? X(`${bf(b.lo)} or more`, `${bf(b.lo)} ou mais`) : X(`${bf(b.lo)} to ${bf(b.hi)}`, `${bf(b.lo)} a ${bf(b.hi)}`);
const OUTDOORS = 'OUTDOORS (for reference)';
const fname = n => LANG === 'pt' ? (stat.facade_pt[n] ?? n) : n;
const cItem = r => LANG === 'pt' ? r.item_pt : r.item;
const unitFix = u => String(u).replace('2', '²');

// the house's own values for each scale: [{name, value, text}]
function houseList(key) {
  const D = stat.daylight, C = stat.comfort.filter(r => r.room !== OUTDOORS), O = stat.openings;
  const pick = (rows, nameKey, valKey, kinds, fmt = v => nf(v)) =>
    rows.filter(r => isNum(r[valKey]) && (!kinds || kinds.includes(kindOf(r[nameKey])))).map(r => ({ name: rn(r[nameKey]), value: r[valKey], text: fmt(r[valKey]) }));
  const allk = ['living', 'bedroom', 'kitchen', 'bathroom', 'hall', 'service'];
  const cc = scale => stat.construction_check.filter(r => r.scale === scale).map(r => ({ name: cItem(r), value: r.value, text: `${nf(r.value, r.value < 10 ? 2 : 0)} (${X('limit', 'limite')} ${r.limit.replace('.', LANG === 'pt' ? ',' : '.')})` }));
  switch (key) {
    case 'daylight_nbr_living': return pick(D, 'zone', 'nbr15575_centre_lux', LONG_STAY, v => `${nf(v)} lux`);
    case 'daylight_nbr_wet': return pick(D, 'zone', 'nbr15575_centre_lux', ['bathroom', 'hall'], v => `${nf(v)} lux`);
    case 'sda_dwelling': return pick(D, 'zone', 'sDA_dwelling_%', null, v => `${nf(v)}%`);
    case 'sda300': return pick(D, 'zone', 'sDA300_%', allk, v => `${nf(v)}%`);
    case 'ase': return pick(D, 'zone', 'ASE1000_250h_%', allk, v => `${nf(v)}%`);
    case 'lamps_off': return pick(D, 'zone', 'lamps_off_%', allk, v => `${nf(v)}%`);
    case 'sun_hours_window': return pick(D, 'zone', 'sun_hours_window_aug_sep', LONG_STAY, v => `${nf(v, 1)} h`);
    case 'vent_effective': return pick(O, 'room', 'openable_%_of_floor', LONG_STAY, v => `${nf(v, 1)}%`);
    case 'glazing_ratio': return pick(O, 'room', 'window_%_of_floor', LONG_STAY, v => `${nf(v, 1)}%`);
    case 'comfort_pct': return pick(stat.comfort, 'room', 'comfort80_%', null, v => `${nf(v, 0)}%`);
    case 'nbr_summer': return pick(C, 'room', 'nbr_summer_delta', ['living', 'bedroom'], v => `${v > 0 ? '+' : ''}${nf(v, 1)} °C`);
    case 'nbr_winter': return pick(C, 'room', 'nbr_winter_delta', ['living', 'bedroom'], v => `${v > 0 ? '+' : ''}${nf(v, 1)} °C`);
    case 'peak_temp': return pick(C, 'room', 'max_T', null, v => `${nf(v, 1)} °C`);
    case 'lowest_temp': return pick(C, 'room', 'min_T', null, v => `${nf(v, 1)} °C`);
    case 'wind_speed': return [{ name: X('Maringá, whole year', 'Maringá, ano todo'), value: stat.mean_wind, text: `${nf(stat.mean_wind, 1)} m/s` }];
    case 'heating_kwh_m2': return pick(stat.cooling.filter(r => r.heating_fuel_kWh_year > 0), 'room', 'heating_kWh_per_m2_year', null, v => `${nf(v, 1)} kWh/m²`);
    case 'cooling_kwh_m2': return pick(stat.cooling.filter(r => r.schedule !== 'not cooled'), 'room', 'kWh_per_m2_year', null, v => `${nf(v, 1)} kWh/m²`);
    case 'cross_vent': return pick(stat.cross, 'room', 'cross_ventilation_hours_%', LONG_STAY, v => `${nf(v)}%`);
    case 'wall_sun_summer': return stat.facade.filter(r => r.name.includes('wall')).map(r => ({ name: fname(r.name), value: r.summer_kWh_m2, text: `${nf(r.summer_kWh_m2)}` }));
    case 'wall_sun_winter': return stat.facade.filter(r => r.name.includes('wall')).map(r => ({ name: fname(r.name), value: r.winter_kWh_m2, text: `${nf(r.winter_kWh_m2)}` }));
    case 'wall_u': case 'wall_ct': case 'roof_u': return cc(key);
  }
  return [];
}

function scaleBlock(key) {
  const s = SC.scales[key];
  let h = `<div class="scale"><div class="stitle">${s.title} <span class="badge" style="background:${TYPE_COLOR[s.type]}">${SC.types[s.type]}</span></div>`;
  h += `<div class="small">${s.what}</div><table class="bands">`;
  for (const b of s.bands)
    h += `<tr><td style="width:36%"><span class="chip" style="background:${SC.levels[b.level].color}">${b.label} ${b.level + 1}/5</span></td><td class="rng">${bandRange(b)} ${s.unit}</td><td class="mean">${b.meaning}</td></tr>`;
  h += '</table>';
  const list = houseList(key);
  if (list.length) h += `<div class="small"><b>${X('This house', 'Esta casa')}:</b> ` + list.map(x => `${x.name} ${x.text} ${chip(key, x.value)}`).join(' &nbsp;·&nbsp; ') + '</div>';
  h += `<div class="small mut">${X('Source', 'Fonte')}: ${s.sources.map(x => SC.sources[x]).join('; ')}.${s.note ? ' ' + s.note : ''}</div></div>`;
  return h;
}

// ---------------------------------------------------------------- tabs (static tables) ---------------------------
function roomLevels(room) {         // levels (0-4) of every rated check for a room
  const L = [], kind = kindOf(room), lv = (k, v) => { const r = rateOf(k, v); if (r.level !== null) L.push(r.level); };
  for (const r of stat.daylight.filter(z => roomOf(z.zone) === room)) {
    if (LONG_STAY.includes(kind) || ['bathroom', 'hall'].includes(kind)) lv(['bathroom', 'hall'].includes(kind) ? 'daylight_nbr_wet' : 'daylight_nbr_living', r.nbr15575_centre_lux);
    if (kind !== 'outdoor') lv('lamps_off', r['lamps_off_%']);
    if (LONG_STAY.includes(kind) && isNum(r.sun_hours_window_aug_sep)) lv('sun_hours_window', r.sun_hours_window_aug_sep);
  }
  const c = stat.comfort.find(x => x.room === room);
  if (c) { lv('comfort_pct', c['comfort80_%']); if (['living', 'bedroom'].includes(kind)) { lv('nbr_summer', c.nbr_summer_delta); lv('nbr_winter', c.nbr_winter_delta); } }
  const o = stat.openings.find(x => x.room === room);
  if (o && LONG_STAY.includes(kind)) { lv('vent_effective', o['openable_%_of_floor']); lv('glazing_ratio', o['window_%_of_floor']); }
  const cr = stat.cooling.find(x => x.room === room);
  if (cr && cr.schedule !== 'not cooled') lv('cooling_kwh_m2', cr.kWh_per_m2_year);
  if (HEAT && cr && cr.heating_fuel_kWh_year > 0) lv('heating_kwh_m2', cr.heating_kWh_per_m2_year);
  return L;
}

const SCHED_KIND = { bedroom: ['bedrooms', 'dormitórios'], living: ['living', 'sala'], kitchen: ['kitchen', 'cozinha'] };
function coolingTable() {
  const A = stat.cooling_assumptions, tar = nf(A.tariff_BRL_per_kWh, 2), H = A.heating || {};
  const sched = Object.entries(SCHED_KIND).map(([k, [en, pt]]) => `${X(en, pt)} ${A.schedules[k]}`).join(', ');
  let h = `<h3>${X('Cost of cooling in summer (air conditioner)', 'Custo de refrigerar no verão (ar-condicionado)')}</h3><div class="small">`
        + X(`Electricity to hold each room at ${A.setpoint_C} °C while it is in use (${sched}). Efficiency COP ${nf(A.COP, 1)}, tariff <b>${CUR} ${tar}/kWh</b> (assumption).`,
            `Eletricidade para manter cada ambiente a ${A.setpoint_C} °C enquanto está em uso (${sched}). Eficiência COP ${nf(A.COP, 1)}, tarifa de <b>${CUR} ${tar}/kWh</b> (suposição).`) + '</div>';
  h += `<table><tr><th>${X('Room', 'Ambiente')}</th><th>kWh / ${X('year', 'ano')}</th><th>${CUR} / ${X('year', 'ano')}</th><th>${CUR} ${st().sum}</th><th>${X('Level', 'Nível')}</th></tr>`;
  for (const r of stat.cooling.filter(x => x.schedule !== 'not cooled'))
    h += `<tr><td>${rn(r.room)}<div class="small mut">${r.cooling_hours} h ${X('on', 'ligado')} · ${X('peak', 'pico')} ${nf(r.peak_cooling_kW, 1)} kW → ${nf(r.suggested_AC_BTU_h)} BTU/h</div></td><td>${nf(r.electricity_kWh_year)}</td><td>${CUR} ${nf(r.cost_BRL_year)}</td><td>${CUR} ${nf(r.cost_BRL_summer_Dec_Feb)}</td><td>${chip('cooling_kwh_m2', r.kWh_per_m2_year)}</td></tr>`;
  h += `<tr><td><b>Total</b></td><td><b>${nf(A.electricity_kWh_year)}</b></td><td><b>${CUR} ${nf(A.cost_BRL_year)}</b></td><td></td><td></td></tr></table>`;
  h += `<div class="small mut">${X('Sensible cooling only (no dehumidification), so real bills are higher. The peak kW is the heat to remove at the hottest hour; BTU/h adds 10% margin and rounds up to a catalogue size. 1 kW = 3,412 BTU/h.',
        'Só refrigeração sensível (sem desumidificação), então as contas reais são maiores. O pico em kW é o calor a retirar na hora mais quente; o BTU/h soma 10% de margem e arredonda para um tamanho de catálogo. 1 kW = 3.412 BTU/h.')}</div>`;
  if (H.enabled) {
    h += `<h3>${X('Cost of heating in winter', 'Custo de aquecer no inverno')}</h3><div class="small">`
       + X(`Fuel or electricity to hold each room at ${H.setpoint_C} °C while it is in use. Efficiency ${nf(H.efficiency, 2)}, price <b>${CUR} ${nf(H.price_per_kWh, 2)}/kWh</b>.`,
           `Combustível ou eletricidade para manter cada ambiente a ${H.setpoint_C} °C enquanto está em uso. Eficiência ${nf(H.efficiency, 2)}, preço de <b>${CUR} ${nf(H.price_per_kWh, 2)}/kWh</b>.`) + '</div>';
    h += `<table><tr><th>${X('Room', 'Ambiente')}</th><th>kWh / ${X('year', 'ano')}</th><th>${CUR} / ${X('year', 'ano')}</th><th>${X('Peak kW', 'Pico kW')}</th><th>${X('Level', 'Nível')}</th></tr>`;
    for (const r of stat.cooling.filter(x => x.heating_fuel_kWh_year > 0))
      h += `<tr><td>${rn(r.room)}</td><td>${nf(r.heating_fuel_kWh_year)}</td><td>${CUR} ${nf(r.heating_cost_year)}</td><td>${nf(r.peak_heating_kW, 1)}</td><td>${chip('heating_kwh_m2', r.heating_kWh_per_m2_year)}</td></tr>`;
    h += `<tr><td><b>Total</b></td><td><b>${nf(H.fuel_kWh_year)}</b></td><td><b>${CUR} ${nf(H.cost_year)}</b></td><td></td><td></td></tr></table>`;
  }
  if (COLD) h += `<div class="warn">${X('Cold climate: the adaptive comfort model does not apply, so the comfortable-hours percentage is shown but not rated; use the heating energy instead.',
        'Clima frio: o modelo de conforto adaptativo não se aplica, então a porcentagem de horas confortáveis é mostrada mas não avaliada; use a energia de aquecimento.')}</div>`;
  return h;
}

function buildYear() {
  const D = stat.daylight, ind = D.filter(r => kindOf(r.zone) !== 'outdoor');
  const th = (...c) => '<tr>' + c.map(x => `<th>${x}</th>`).join('') + '</tr>';
  const room = X('Room', 'Ambiente'), verdict = X('Verdict', 'Veredito');
  let h = `<div class="small mut">${X('Coloured tags tell you how good each number is (hover for the meaning). The “What’s good?” tab explains every scale and its source.',
    'As etiquetas coloridas dizem o quão bom é cada número (passe o mouse para ver o significado). A aba “O que é bom?” explica cada escala e sua fonte.')}</div>`;
  h += `<h3>${X('Overall level of each room (1 = bad … 5 = excellent)', 'Nível geral de cada ambiente (1 = péssimo … 5 = excelente)')}</h3><table>${th(room, X('Overall', 'Geral'), X(`Cooling ${CUR}/yr`, `Resfriamento ${CUR}/ano`), ...(HEAT ? [X(`Heating ${CUR}/yr`, `Aquecimento ${CUR}/ano`)] : []))}`;
  const allLevels = [];
  for (const o of stat.openings) { const lv = roomLevels(o.room); if (!lv.length) continue; allLevels.push(...lv);
    const cr = stat.cooling.find(c => c.room === o.room);
    h += `<tr><td>${rn(o.room)}</td><td>${overallChip(lv)}</td><td>${cr && cr.schedule !== 'not cooled' ? CUR + ' ' + nf(cr.cost_BRL_year) : '–'}</td>${HEAT ? `<td>${cr && cr.heating_fuel_kWh_year > 0 ? CUR + ' ' + nf(cr.heating_cost_year) : '–'}</td>` : ''}</tr>`; }
  h += `<tr><td><b>${X('Whole house', 'Casa inteira')}</b></td><td>${overallChip(allLevels)}</td><td><b>${CUR} ${nf(stat.cooling_assumptions.cost_BRL_year)}</b></td>${HEAT ? `<td><b>${CUR} ${nf(stat.cooling_assumptions.heating.cost_year)}</b></td>` : ''}</tr></table>`;
  h += `<div class="small mut">${X('Overall = average of each room level on each check below (daylight, lamps, sun, comfort, hot / cold day, ventilation, cooling cost).',
    'Geral = média do nível do ambiente em cada verificação abaixo (luz natural, lâmpadas, sol, conforto, dia quente / frio, ventilação, custo de climatização).')}</div>`;
  h += `<h3>${X('Is there enough daylight? (NBR 15575 test: room centre, lamps off)', 'Há luz natural suficiente? (ensaio da NBR 15575: centro do ambiente, lâmpadas apagadas)')}</h3><table>${th(room, 'Lux', verdict)}`;
  for (const r of ind) {
    const wet = ['bathroom', 'hall'].includes(kindOf(r.zone)), k = wet ? 'daylight_nbr_wet' : 'daylight_nbr_living';
    h += `<tr><td>${rn(r.zone)}</td><td>${nf(r.nbr15575_centre_lux)}</td><td>${chip(k, r.nbr15575_centre_lux)}</td></tr>`;
  }
  h += `</table><div class="small mut">${X('Worst of 23 Apr / 23 Oct at 9:30 and 15:30, sky light only. Minimum 60 lux (living rooms, bedrooms, kitchen); 30 / 45 lux for bathrooms and hallways.',
    'Pior de 23 abr / 23 out às 9h30 e 15h30, só luz do céu. Mínimo de 60 lux (salas, dormitórios, cozinha); 30 / 45 lux para banheiros e corredores.')}</div>`;
  h += `<h3>${X('How much of the room is bright, and do I need lamps?', 'Quanto do ambiente é claro, e preciso de lâmpadas?')}</h3><table>${th(room, X('Goal (lux)', 'Meta (lux)'), X('Floor at goal', 'Piso na meta'), X('Lamps off', 'Lâmpadas apagadas'))}`;
  for (const r of ind) h += `<tr><td>${rn(r.zone)}</td><td>${r.sDA_dwelling_target_lux ?? '–'}</td><td>${isNum(r['sDA_dwelling_%']) ? nf(r['sDA_dwelling_%']) + '% ' + chip('sda_dwelling', r['sDA_dwelling_%']) : '–'}</td><td>${nf(r['lamps_off_%'])}% ${chip('lamps_off', r['lamps_off_%'])}</td></tr>`;
  h += `</table><div class="small mut">${X('Floor at goal: share of the floor reaching 100 lux (bedroom) / 150 (living) / 200 (kitchen) for half of 8:00–18:00. Lamps off: daytime hours when daylight already gives the general light level.',
    'Piso na meta: parcela do piso que atinge 100 lux (dormitório) / 150 (sala) / 200 (cozinha) em metade do período 8h–18h. Lâmpadas apagadas: horas do dia em que a luz natural já dá o nível de luz geral.')}</div>`;
  h += `<h3>${X('Sun on the windows, and glare', 'Sol nas janelas e ofuscamento')}</h3><table>${th(room, X('Sun h/day Aug–Sep', 'Sol h/dia ago–set'), X('Glare area (ASE)', 'Área de ofuscamento (ASE)'))}`;
  for (const r of ind) h += `<tr><td>${rn(r.zone)}</td><td>${isNum(r.sun_hours_window_aug_sep) && LONG_STAY.includes(kindOf(r.zone)) ? nf(r.sun_hours_window_aug_sep, 1) + ' ' + chip('sun_hours_window', r.sun_hours_window_aug_sep) : (isNum(r.sun_hours_window_aug_sep) ? nf(r.sun_hours_window_aug_sep, 1) : '–')}</td><td>${nf(r['ASE1000_250h_%'])}% ${chip('ase', r['ASE1000_250h_%'])}</td></tr>`;
  h += '</table>';
  h += `<h3>${X('Windows: size and openable area', 'Janelas: tamanho e área abrível')}</h3><table>${th(room, X('Glass / floor', 'Vidro / piso'), X('Openable / floor', 'Abrível / piso'))}`;
  for (const r of stat.openings) { const ls = LONG_STAY.includes(r.kind);
    h += `<tr><td>${rn(r.room)}</td><td>${nf(r['window_%_of_floor'], 1)}% ${ls ? chip('glazing_ratio', r['window_%_of_floor']) : ''}</td><td>${nf(r['openable_%_of_floor'], 1)}% ${ls ? chip('vent_effective', r['openable_%_of_floor']) : ''}</td></tr>`; }
  h += `</table><div class="small mut">${X('NBR 15575-4: openable area at least 7% of the floor; glass at most 20% unless shaded. Openable assumes a sliding window opens half.',
    'NBR 15575-4: área abrível de pelo menos 7% do piso; vidro de no máximo 20%, salvo se sombreado. “Abrível” supõe que uma janela de correr abre metade.')}</div>`;
  h += coolingTable();
  h += `<h3>${X('Temperature comfort over the year', 'Conforto térmico ao longo do ano')}</h3><table>${th(room, X('Comfortable', 'Confortável'), X('Too hot', 'Quente demais'), X('Too cold', 'Frio demais'))}`;
  for (const r of stat.comfort) h += `<tr><td>${rn(r.room)}</td><td>${nf(r['comfort80_%'], 0)}% ${chip('comfort_pct', r['comfort80_%'])}</td><td>${nf(r.too_hot_hours)} h</td><td>${nf(r.too_cold_hours)} h</td></tr>`;
  const dd = stat.design_days;
  h += `</table><h3>${X('NBR 15575 design days', 'Dias de projeto da NBR 15575')} (${dateStr(dd.hottest_day_iso)}: ${nf(dd.outdoor_max_on_hottest_day_C, 1)}°C ${X('max outside', 'máx. externa')} · ${dateStr(dd.coldest_day_iso)}: ${nf(dd.outdoor_min_on_coldest_day_C, 1)}°C ${X('min', 'mín.')})</h3>`;
  h += `<table>${th(room, X('Hot day: in − out', 'Dia quente: dentro − fora'), X('Cold day: in − out', 'Dia frio: dentro − fora'))}`;
  for (const r of stat.comfort.filter(x => x.room !== OUTDOORS)) { const req = ['living', 'bedroom'].includes(kindOf(r.room));
    h += `<tr><td>${rn(r.room)}${req ? '' : ` <span class="mut small">(${X('not rated', 'não avaliado')})</span>`}</td><td>${nf(r.nbr_summer_delta, 1)}° ${req ? chip('nbr_summer', r.nbr_summer_delta) : ''}</td><td>+${nf(r.nbr_winter_delta, 1)}° ${req ? chip('nbr_winter', r.nbr_winter_delta) : ''}</td></tr>`; }
  h += `</table><div class="small mut">${X('Rated for living rooms and bedrooms only, as in the norm. Hot day: indoor peak minus outdoor peak (≤ 0 minimum, ≤ −2 intermediate, ≤ −4 superior). Cold day: indoor minimum minus outdoor minimum (≥ +3 / +5 / +7).',
    'Avaliado só para salas e dormitórios, como na norma. Dia quente: máxima interna menos máxima externa (≤ 0 mínimo, ≤ −2 intermediário, ≤ −4 superior). Dia frio: mínima interna menos mínima externa (≥ +3 / +5 / +7).')}</div>`;
  h += `<h3>${X('Cross-ventilation (wind hours with a through-draught)', 'Ventilação cruzada (horas com vento e corrente de ar atravessando)')}</h3><table>${th(room, X('Windy hours', 'Horas com vento'))}`;
  for (const r of stat.cross) h += `<tr><td>${rn(r.room)}</td><td>${nf(r['cross_ventilation_hours_%'])}% ${LONG_STAY.includes(kindOf(r.room)) ? chip('cross_vent', r['cross_ventilation_hours_%']) : ''}</td></tr>`;
  h += '</table>';
  h += `<h3>${X('Sun energy on the outside (kWh/m²)', 'Energia solar por fora (kWh/m²)')}</h3><table>${th(X('Surface', 'Superfície'), X('Year', 'Ano'), X('Summer', 'Verão'), X('Winter', 'Inverno'))}`;
  for (const r of stat.facade) { const wall = r.name.includes('wall');
    h += `<tr><td>${fname(r.name)}</td><td>${nf(r.annual_kWh_m2)}</td><td>${nf(r.summer_kWh_m2)} ${wall ? chip('wall_sun_summer', r.summer_kWh_m2) : ''}</td><td>${nf(r.winter_kWh_m2)} ${wall ? chip('wall_sun_winter', r.winter_kWh_m2) : ''}</td></tr>`; }
  h += `</table><h3>${X('Direct sun reaching the floor (hours per day, by month)', 'Sol direto que chega ao piso (horas por dia, por mês)')}</h3><table><tr><th>${room}</th>` + monthsShort().map(m => `<th>${m[0]}</th>`).join('') + '</tr>';
  for (const zn of Object.keys(stat.sun_month)) h += `<tr><td>${rn(zn)}</td>` + stat.sun_month[zn].map(v => `<td>${nf(v, 1)}</td>`).join('') + '</tr>';
  $('tab-year').innerHTML = h + '</table>';
}

function lampTable() {
  const rec = SC.lux_recs;
  let h = `<h3>${X('Lamps: how much light to install', 'Lâmpadas: quanta luz instalar')}</h3><div class="small">`
        + X('Light level is measured in <b>lux</b> (light arriving on a surface). A lamp gives out <b>lumens</b>. Lumens needed = lux × floor area ÷ (utilisation × maintenance = ', 'O nível de luz é medido em <b>lux</b> (luz que chega a uma superfície). Uma lâmpada emite <b>lumens</b>. Lumens necessários = lux × área do piso ÷ (utilização × manutenção = ')
        + nf(SC.uf * SC.mf, 2) + X('). The “minimum” is simply lux × m².', '). O “mínimo” é simplesmente lux × m².') + '</div>';
  h += `<table><tr><th>${X('Kind of room', 'Tipo de ambiente')}</th><th>${X('General light (lux)', 'Luz geral (lux)')}</th><th>${X('Task light (lux)', 'Luz de tarefa (lux)')}</th></tr>`;
  for (const k of Object.keys(rec)) { const r = rec[k];
    h += `<tr><td>${r.label}</td><td>${r.general[0]} – <b>${r.general[1]}</b> – ${r.general[2]}</td><td>${r.task ? `${r.task[0]} – <b>${r.task[1]}</b> – ${r.task[2]}<br><span class="small mut">${r.task_name}</span>` : '–'}</td></tr>`; }
  h += `</table><div class="small mut">${X('Min – <b>recommended</b> – max. Home values from NBR 5413 (withdrawn but still the Brazilian reference for homes); reading and writing 300–500 lux also in NBR ISO/CIE 8995-1 and EN 12464-1.',
    'Mín – <b>recomendado</b> – máx. Valores residenciais da NBR 5413 (cancelada, mas ainda a referência brasileira para residências); leitura e escrita 300–500 lux também na NBR ISO/CIE 8995-1 e na EN 12464-1.')}</div>`;
  const w0 = Math.round(SC.reading_lamp_lm[0] / SC.led_lm_per_w), w1 = Math.round(SC.reading_lamp_lm[1] / SC.led_lm_per_w);
  h += '<div class="small">' + X(`<b>Reading:</b> keep the room at the general level (100–200 lux) and add a directional reading lamp of about ${SC.reading_lamp_lm[0]}–${SC.reading_lamp_lm[1]} lumens (≈ ${w0}–${w1} W LED) near the page to reach 300–500 lux on it.`,
    `<b>Leitura:</b> mantenha o ambiente no nível geral (100–200 lux) e acrescente uma luminária de leitura direcional de cerca de ${SC.reading_lamp_lm[0]}–${SC.reading_lamp_lm[1]} lumens (≈ ${w0}–${w1} W de LED) perto da página para chegar a 300–500 lux nela.`) + '</div>';
  h += `<table><tr><th>${X('Room (m²)', 'Ambiente (m²)')}</th><th>${X('Goal', 'Meta')}</th><th>${X('Lamp lumens (min – design)', 'Lumens das lâmpadas (mín – projeto)')}</th><th>${X('LED W', 'LED W')}</th></tr>`;
  for (const r of stat.daylight.filter(x => kindOf(x.zone) !== 'outdoor'))
    h += `<tr><td>${rn(r.zone)} (${nf(r.area_m2, 1)})</td><td>${r.target_lux} lux</td><td>${nf(r.lumens_min_lux_x_m2)} – ${nf(r.design_lumens_artificial)}</td><td>${nf(r.led_watts_design)}</td></tr>`;
  h += `</table><div class="small mut">${X('Use the low end for light walls and ceiling and good fittings, the high end for dark rooms or recessed spots. For scale: ', 'Use o extremo inferior para paredes e teto claros e boas luminárias, o superior para ambientes escuros ou spots embutidos. Para ter noção: ')}`
      + SC.bulb_examples.map(b => `${b[0]} lm = ${b[1]}`).join('; ') + X('. Natural light already covers these goals for part of the day (see “Lamps off”).', '. A luz natural já cobre essas metas em parte do dia (veja “Lâmpadas apagadas”).') + '</div>';
  return h;
}

function buildGood() {
  const groups = [
    [X('Daylight inside the rooms', 'Luz natural dentro dos ambientes'), ['daylight_nbr_living', 'daylight_nbr_wet', 'sda_dwelling', 'sda300', 'ase', 'lamps_off', 'sun_hours_window', 'leed_daylight'], true],
    [X('Windows and fresh air', 'Janelas e ar fresco'), ['vent_effective', 'glazing_ratio', 'cross_vent', 'wind_speed']],
    [X('Temperature and cooling cost', 'Temperatura e custo de climatização'), [...(COLD ? [] : ['comfort_pct']), 'nbr_summer', 'nbr_winter', 'peak_temp', 'lowest_temp', 'cooling_kwh_m2', ...(HEAT ? ['heating_kwh_m2'] : [])]],
    [X('Sun on the outside of the house', 'Sol por fora da casa'), ['wall_sun_summer', 'wall_sun_winter']],
    [X('Walls and roof (NBR 15575 simplified method)', 'Paredes e cobertura (método simplificado da NBR 15575)'), ['wall_u', 'wall_ct', 'roof_u']],
  ];
  const badge = t => `<span class="badge" style="background:${TYPE_COLOR[t]}">${SC.types[t]}</span>`;
  let h = '<div class="small">' + X(`Every number in this viewer, with what counts as <b>good</b> or <b>bad</b>, on a <b>level from 1 (bad) to 5 (excellent)</b>. ${badge('BR')} from ABNT; ${badge('INT')} used where no Brazilian number exists; ${badge('RULE')} is our own guideline where no norm gives a number.`,
    `Todos os números deste visualizador, com o que conta como <b>bom</b> ou <b>ruim</b>, em um <b>nível de 1 (péssimo) a 5 (excelente)</b>. ${badge('BR')} da ABNT; ${badge('INT')} usado onde não há número brasileiro; ${badge('RULE')} é uma orientação nossa onde nenhuma norma dá um número.`) + '</div>';
  for (const [title, keys, lamps] of groups) {
    h += `<h3>${title}</h3>`;
    for (const k of keys) h += scaleBlock(k);
    if (lamps) h += lampTable();
  }
  const cc = stat.construction_check;
  h += `<h3>${X('Pass / fail summary of the walls and roof', 'Resumo de atende / não atende das paredes e da cobertura')}</h3><table><tr><th>Item</th><th>${X('Value', 'Valor')}</th><th>${X('Limit', 'Limite')}</th><th></th></tr>`;
  for (const r of cc) h += `<tr><td>${cItem(r)}</td><td>${nf(r.value, r.value < 10 ? 2 : 0)} ${unitFix(r.unit)}</td><td>${r.limit.replace('.', LANG === 'pt' ? ',' : '.')}</td><td><span class="chip" style="background:${r.passes ? SC.levels[4].color : SC.levels[0].color}">${r.passes ? X('meets', 'atende') : X('does not meet', 'não atende')}</span></td></tr>`;
  h += `</table><div class="small mut">${X(`Assumed wall paint absorptance ${cc[0].assumed_absorptance} (light colours ≤ 0.6) and roof absorptance ${cc[2].assumed_absorptance} (red clay tile). Limits change with colour: a lighter roof gets a more generous U limit.`,
    `Absortância suposta da pintura da parede ${nf(cc[0].assumed_absorptance, 2)} (cores claras ≤ 0,6) e da cobertura ${nf(cc[2].assumed_absorptance, 2)} (telha cerâmica vermelha). Os limites mudam com a cor: uma cobertura mais clara tem um limite de U mais generoso.`)}</div>`;
  $('tab-good').innerHTML = h;
}

function buildMat() {
  const bc = stat.base_case, lab = (en, pt) => LANG === 'pt' ? pt : en;
  let h = `<h3>${X('Assumed construction (base case)', 'Construção suposta (caso-base)')}</h3><div class="small"><b>${X('Walls', 'Paredes')}:</b> ${lab(bc.wall, bc.wall_pt)}<br><b>${X('Roof', 'Cobertura')}:</b> ${lab(bc.roof, bc.roof_pt)}<br><b>${X('Windows', 'Janelas')}:</b> ${X('common 2012 catalogue sizes (bedrooms 1.20×1.20 m, living / dining 2.00×1.20 m, kitchen 1.50×1.20 m, bathrooms 0.60×0.60 m)', 'medidas comuns de catálogo de 2012 (dormitórios 1,20×1,20 m, sala / jantar 2,00×1,20 m, cozinha 1,50×1,20 m, banheiros 0,60×0,60 m)')}</div>`;
  h += `<div class="warn">${X('These materials and sizes are TYPICAL for a Brazilian house, not confirmed for this house.', 'Esses materiais e medidas são TÍPICOS de uma casa brasileira, não confirmados para esta casa.')}</div>`;
  h += `<table><tr><th>${X('Part', 'Parte')}</th><th>cm</th><th>U</th><th>${X('Heat store kJ/m²K', 'Armazena calor kJ/m²K')}</th></tr>`;
  for (const r of stat.constructions) { const l = lab(r.label, r.label_pt);
    h += `<tr><td title="${esc(l)}">${l.length > 44 ? esc(l.slice(0, 42)) + '…' : esc(l)}</td><td>${nf(r.thickness_cm, 1)}</td><td>${nf(r.U_W_m2K, 2)}</td><td>${r.heat_capacity_kJ_m2K}</td></tr>`; }
  h += `</table><div class="small mut">${X('U = heat leaking per m² per degree (lower is better). Heat store = how much heat the layer soaks up before passing it on (higher smooths out day/night swings).',
    'U = calor que escapa por m² por grau (menor é melhor). Armazena calor = quanto calor a camada absorve antes de repassar (maior suaviza as oscilações entre dia e noite).')}</div>`;
  h += `<h3>${X('How much do materials matter? (average comfortable hours / year, cooling bill)', 'Quanto importam os materiais? (média de horas confortáveis / ano, conta de climatização)')}</h3>`;
  h += `<div class="small mut">${X('An existing house rarely gets new walls, but the roof / ceiling can often be improved, so each is shown on its own (the other part stays as it is today). Roof upgrades such as wool are in the Upgrades tab.',
    'Numa casa pronta é muito difícil trocar as paredes, mas a cobertura muitas vezes pode ser melhorada; por isso cada uma é mostrada separadamente (a outra parte fica como é hoje). Melhorias de cobertura, como lã, estão na aba Melhorias.')}</div>`;
  const bw = bc.wall_key, br = bc.roof_key, tot = s => s.cooling_BRL_year + (HEAT ? s.heating_cost_year : 0);
  const base = stat.scenarios.find(s => s.wall === bw && s.roof === br);
  const part = (title, rows, labf) => {
    let t = `<h3>${title}</h3><table><tr><th></th><th>${X('Comfortable h/yr', 'h confortáveis/ano')}</th><th>${X('Bill', 'Conta')} (${CUR}/${X('yr', 'ano')})</th><th>${X('vs. current', 'vs. atual')}</th></tr>`;
    for (const s of rows.sort((a, b) => b.avg_comfort_hours - a.avg_comfort_hours)) {
      const isb = s.wall === bw && s.roof === br, d = tot(s) - tot(base), l = labf(s);
      t += `<tr><td title="${esc(l)}">${l.length > 40 ? esc(l.slice(0, 38)) + '…' : esc(l)}${isb ? ` <b>(${X('current', 'atual')})</b>` : ''}</td><td>${nf(s.avg_comfort_hours)}</td><td>${nf(tot(s))}</td><td>${isb ? '–' : (d > 0 ? '+' : '') + nf(d)}</td></tr>`; }
    return t + '</table>';
  };
  h += part(X('Walls (roof kept)', 'Paredes (cobertura mantida)'), stat.scenarios.filter(s => s.roof === br), s => lab(s.wall_label, s.wall_label_pt));
  h += part(X('Roof / ceiling (walls kept)', 'Cobertura / forro (paredes mantidas)'), stat.scenarios.filter(s => s.wall === bw), s => lab(s.roof_label, s.roof_label_pt));
  $('tab-mat').innerHTML = h;
}


// ---------------------------------------------------------------- upgrades, LEED and method tabs ---------------------------------------
const CONF_COL = { verified: '#2e9e5b', typical: '#f2c94c', assumption: '#f2994a' };
const confChip = c => `<span class="chip" style="background:${CONF_COL[c]}">${X({ verified: 'verified', typical: 'typical', assumption: 'assumption' }[c], { verified: 'verificado', typical: 'típico', assumption: 'suposição' }[c])}</span>`;
function buildUp() {
  const R = stat.retrofits || [], cat = stat.retrofit_catalogue || {}, L = stat.leed || {};
  const th = (...c) => '<tr>' + c.map(x => `<th>${x}</th>`).join('') + '</tr>';
  let h = `<div class="small">${X('Each upgrade is simulated over the whole year and compared with the house as it is today. Roof wool lies on top of the ceiling; sealing = rubber gaskets and brush seals on frames and doors; fixed brise = horizontal projection over each window; movable blinds close when the sun on the window is strong.',
    'Cada melhoria é simulada no ano inteiro e comparada com a casa como ela é hoje. A lã fica sobre o forro; vedação = borrachas e escovas nas esquadrias e portas; brise fixo = projeção horizontal sobre cada janela; persianas móveis fecham quando o sol na janela é forte.')}</div>`;
  h += `<h3>${X('Results by upgrade', 'Resultados por melhoria')}</h3><table>${th(X('Upgrade', 'Melhoria'), X('Comfort', 'Conforto'), X('Hottest', 'Máxima'), X(`Cooling ${CUR}/yr`, `Resfriamento ${CUR}/ano`), ...(HEAT ? [X(`Heating ${CUR}/yr`, `Aquecimento ${CUR}/ano`)] : []), X('Bill change', 'Variação da conta'))}`;
  for (const r of R) {
    const d = r.d_total_cost, col = d < -1 ? '#2e9e5b' : '#9aa5b1';
    h += `<tr><td><b>${LANG === 'pt' ? r.package_pt : r.package}</b><div class="small mut">${LANG === 'pt' ? r.what_pt : r.what_en}</div></td><td>${nf(r['avg_comfort_%'], 1)}%</td><td>${nf(r.avg_peak_T, 1)}°C</td><td>${CUR} ${nf(r.cooling_cost_year)}</td>${HEAT ? `<td>${CUR} ${nf(r.heating_cost_year)}</td>` : ''}<td><span class="chip" style="background:${col}">${d > 0 ? '+' : ''}${CUR} ${nf(d)}</span></td></tr>`;
  }
  h += `</table><div class="small mut">${X('Negative = saving per year. Upgrade prices are not included: divide a quotation by the yearly saving to get the payback time.', 'Negativo = economia por ano. Os preços das melhorias não estão incluídos: divida um orçamento pela economia anual para obter o retorno.')}</div>`;
  const wm = stat.retrofit_wool || [];
  if (wm.length) {
    const mms = [...new Set(wm.map(x => x.mm))];
    h += `<h3>${X('Which wool, how thick? (change in yearly bill)', 'Qual lã, que espessura? (variação na conta anual)')}</h3><table><tr><th>${X('Wool', 'Lã')}</th>${mms.map(m => `<th>${m} mm</th>`).join('')}</tr>`;
    for (const wt of [...new Set(wm.map(x => x.wool))]) {
      const c = (cat.wools || {})[wt] || {};
      h += `<tr><td>${LANG === 'pt' ? c.pt : c.en}<div class="small mut">λ ${nf(c.lambda, 3)}</div></td>${mms.map(m => { const x = wm.find(y => y.wool === wt && y.mm === m); return `<td>${CUR} ${nf(x.d_total_cost)}</td>`; }).join('')}</tr>`;
    }
    h += '</table>';
  }
  h += `<h3>${X('Values used and how reliable they are', 'Valores usados e quão confiáveis são')}</h3><table><tr><th>${X('Measure', 'Medida')}</th><th>${X('Value', 'Valor')}</th><th>${X('Reliability', 'Confiança')}</th></tr>`;
  const nm = o => LANG === 'pt' ? o.pt : o.en;
  for (const c of Object.values(cat.wools || {})) h += `<tr><td title="${esc(c.source)}">${nm(c)}</td><td>λ ${nf(c.lambda, 3)} W/m·K</td><td>${confChip(c.confidence)}</td></tr>`;
  for (const c of Object.values(cat.glazings || {})) h += `<tr><td title="${esc(c.source)}">${nm(c)}</td><td>U ${nf(c.u, 1)}, g ${nf(c.g, 2)}, VT ${nf(c.vt, 2)}</td><td>${confChip(c.confidence)}</td></tr>`;
  if (cat.sealing) h += `<tr><td title="${esc(cat.sealing.source)}">${nm(cat.sealing)}</td><td>−${nf(cat.sealing.ach_reduction * 100)}% ${X('air changes', 'trocas de ar')}</td><td>${confChip(cat.sealing.confidence)}</td></tr>`;
  for (const c of Object.values(cat.shading || {})) h += `<tr><td title="${esc(c.source)}">${nm(c)}</td><td>${c.closed_gain_factor ? X('closed gain', 'ganho fechado') + ' ×' + c.closed_gain_factor : '—'}</td><td>${confChip(c.confidence)}</td></tr>`;
  h += `</table><div class="small mut">${X('Hover a name to see the source of the value.', 'Passe o mouse sobre o nome para ver a fonte do valor.')}</div>`;
  h += `<h3>${X('LEED daylight pre-assessment (IES LM-83)', 'Pré-avaliação de luz natural LEED (IES LM-83)')}</h3><div class="small">${X('LEED v4.1 daylight credit, Option 1: area-weighted sDA300/50% of 40% / 55% / 75% = 1 / 2 / 3 points; ASE1000,250 above 10% needs a glare strategy. Indicative only, not a certification.',
    'Crédito de luz natural do LEED v4.1, Opção 1: sDA300/50% ponderado pela área de 40% / 55% / 75% = 1 / 2 / 3 pontos; ASE1000,250 acima de 10% exige estratégia contra ofuscamento. Apenas indicativo, não é certificação.')}</div>`;
  h += `<table>${th(X('Room', 'Ambiente'), 'sDA300/50%', 'ASE', X('Step', 'Degrau'))}`;
  for (const r of stat.leed_rows || []) { const whole = String(r.zone).startsWith('WHOLE');
    h += `<tr><td>${whole ? `<b>${X('Whole house', 'Casa inteira')}</b>` : rn(r.zone)}</td><td>${nf(r['sDA300_50_%'])}% ${chip('leed_daylight', r['sDA300_50_%'])}</td><td>${nf(r['ASE1000_250_%'])}% ${chip('ase', r['ASE1000_250_%'])}</td><td>${r.points_if_alone} ${X('pt', 'pt')}</td></tr>`; }
  h += `</table><div class="box small" style="margin-top:6px"><b>${X('Result', 'Resultado')}:</b> ${L.points ?? '–'} / 3 ${X('daylight points', 'pontos de luz natural')} · sDA ${nf(L['sDA300_50_avg_%'], 1)}% · ASE ${nf(L['ASE1000_250_avg_%'], 1)}%</div>`;
  const EP = stat.energyplus;
  if (EP) {
    const eb = EP.base || {};
    h += `<h3>${X('Reference engine: EnergyPlus', 'Motor de referência: EnergyPlus')}</h3><div class="small">${X('Every package recalculated with EnergyPlus (ASHRAE 140 validated): heat balance of every surface, shared walls, attic above each room, real eaves, wind-driven window ventilation. Same set point, schedules and COP as the fast engine; no internal gains in either.',
      'Todos os pacotes recalculados com o EnergyPlus (validado pela ASHRAE 140): balanço de calor de cada superfície, paredes compartilhadas, forro acima de cada ambiente, beirais reais, ventilação por vento nas janelas. Mesmo ponto de ajuste, horários e COP do motor rápido; sem ganhos internos em ambos.')}</div>`;
    h += `<table>${th(X('Package', 'Pacote'), X('Comfort without A/C', 'Conforto sem ar-cond.'), X('A/C kWh fast', 'Ar-cond. kWh rápido'), X('A/C kWh EnergyPlus', 'Ar-cond. kWh EnergyPlus'), X('Saving/yr', 'Economia/ano'))}`;
    for (const r of EP.scenarios || []) { const f = R.find(x => x.package === r.package) || {};
      h += `<tr><td>${LANG === 'pt' ? r.package_pt : r.package}</td><td>${nf(r['avg_comfort_%'], 1)}%</td><td>${nf(f.cooling_kWh_year)}</td><td>${nf(r.cooling_kWh_year)}</td><td>${r.d_total_cost ? nf(-r.d_total_cost) : '—'}</td></tr>`; }
    h += `</table><div class="box small" style="margin-top:6px"><b>${X('Result with EnergyPlus', 'Resultado com o EnergyPlus')}:</b> ${X('base case', 'caso base')} ${nf(eb['ep_comfort_%'], 1)}% ${X('comfort hours', 'das horas em conforto')} (${X('fast', 'rápido')} ${nf(eb['fast_comfort_%'], 1)}%) · ${X('A/C', 'ar-cond.')} ${nf(EP.cooling_kWh_year)} kWh (${X('fast', 'rápido')} ${nf(EP.fast_cooling_kWh_year)}) · ${X('both engines rank roof insulation first', 'os dois motores colocam a isolação da cobertura em primeiro')}</div>`;
  }
  const NB = stat.nbr15575;
  if (NB) {
    const b = NB.base, LVN = { M: X('Minimum', 'Mínimo'), I: X('Intermediate', 'Intermediário'), S: X('Superior', 'Superior'), 'not met': X('Not met', 'Não atendido') };
    h += `<h3>${X('NBR 15575-1:2021 by simulation (PHFT)', 'NBR 15575-1:2021 por simulação (PHFT)')}</h3><div class="small">${X('Real house vs. reference house (100 mm walls, tile + air chamber + slab roof, windows of 17% of the floor): share of occupied hours with operative temperature between 18 and 26 °C in bedrooms and living room, windows opened only when occupied (EnergyPlus + AirflowNetwork). Section 11.4 of the standard (tables checked against the public draft).',
      'Casa real x casa de referência (paredes de 100 mm, cobertura de telha + câmara de ar + laje, janelas de 17% do piso): parcela das horas ocupadas com temperatura operativa entre 18 e 26 °C nos dormitórios e na sala, janelas abertas só quando ocupado (EnergyPlus + AirflowNetwork). Seção 11.4 da norma (tabelas conferidas com o projeto público).')}</div>`;
    h += `<table>${th(X('Package', 'Pacote'), 'PHFT', 'ΔPHFT', 'Tmax', 'Tmin', X('Load reduction', 'Redução da carga'), X('Level', 'Nível'))}`;
    for (const r of NB.packages || []) h += `<tr><td>${LANG === 'pt' ? r.package_pt : r.package}</td><td>${nf(r.PHFT_real, 1)}%</td><td>${nf(r.dPHFT, 1)}</td><td>${nf(r.Tomax_real, 1)}</td><td>${nf(r.Tomin_real, 1)}</td><td>${nf(r['RedCgTT_%'], 1)}%</td><td><b>${r.level}</b></td></tr>`;
    h += `</table><div class="box small" style="margin-top:6px"><b>${X('House as it is', 'Casa como está')}:</b> PHFT ${nf(b.PHFT_real, 1)}% ${X('vs reference', 'contra a referência')} ${nf(b.PHFT_ref, 1)}% · Tmax ${nf(b.Tomax_real, 1)} / ${nf(b.Tomax_ref, 1)} °C · Tmin ${nf(b.Tomin_real, 1)} / ${nf(b.Tomin_ref, 1)} °C · ${X('level', 'nível')}: <b>${LVN[b.level]}</b> (${X('needs ΔPHFT', 'precisa de ΔPHFT')} ≥ ${nf(b.dPHFT_min, 1)} ${X('for I / S', 'para I / S')}) · ${X('wind pressure', 'pressão do vento')}: ${NB.cp_source}</div>`;
  }
  const RD = stat.radiance;
  if (RD) {
    h += `<h3>${X('Reference engine: Radiance', 'Motor de referência: Radiance')}</h3><div class="small">${X('Same rooms and sensors, recalculated with Radiance (Perez sky, 4 light bounces, LM-83 blind rule): the validated engine behind ClimateStudio and Honeybee. The fast engine overestimates light deep inside rooms.',
      'Mesmos ambientes e sensores, recalculados com o Radiance (céu de Perez, 4 reflexões, regra de persianas da LM-83): o motor validado por trás do ClimateStudio e do Honeybee. O motor rápido superestima a luz no fundo dos ambientes.')}</div>`;
    h += `<table>${th(X('Room', 'Ambiente'), X('sDA fast', 'sDA rápido'), 'sDA Radiance', 'ASE Radiance', X('mean lux', 'lux médio'))}`;
    for (const r of RD.rows || []) if (['living', 'bedroom', 'kitchen'].includes(r.kind))
      h += `<tr><td>${rn(r.zone)}</td><td>${nf(r['fast_sDA300_%'])}%</td><td>${nf(r['sDA300_LM83_%'])}% ${chip('leed_daylight', r['sDA300_LM83_%'])}</td><td>${nf(r['ASE1000_250h_%'])}%</td><td>${nf(r.mean_lux_8_18)} <span class="mut">(${nf(r.fast_mean_lux)})</span></td></tr>`;
    h += `</table><div class="box small" style="margin-top:6px"><b>${X('Result with Radiance', 'Resultado com o Radiance')}:</b> ${RD.leed_points} / 3 ${X('daylight points', 'pontos de luz natural')} · sDA ${nf(RD['sDA300_50_avg_%'], 1)}% (${X('fast engine', 'motor rápido')} ${nf(RD.fast_engine?.['sDA300_50_avg_%'], 1)}%) · ASE ${nf(RD['ASE1000_250_avg_%'], 1)}% · ${X('sky check', 'checagem do céu')} ${RD.sky_check_ratio}</div>`;
  }
  $('tab-up').innerHTML = h;
}
function engineCards(M) {
  const E = M.engines || []; if (!E.length) return '';
  const card = e => `<a href="${e.url}" target="_blank" style="flex:1;min-width:130px;text-align:center;background:#fff;border-radius:6px;padding:8px;text-decoration:none;color:#111"><img src="${e.logo}" style="height:28px;max-width:130px;object-fit:contain"><div style="font-size:12px"><b>${e.name}</b> ${e.version}</div><div style="font-size:11px;color:#555">${e.role}</div></a>`;
  return `<h3>${X('Reference engines', 'Motores de referência')}</h3><div style="display:flex;gap:8px;flex-wrap:wrap">${E.map(card).join('')}</div><div class="small mut" style="margin-top:4px">${X('Logos belong to their projects and only credit the software used.', 'Os logos pertencem aos respectivos projetos e apenas creditam os programas usados.')}</div>`;
}
function buildMeth() {
  const M = (stat.methods || {})[LANG]; if (!M) { $('tab-meth').innerHTML = ''; return; }
  const L = M.labels;
  let h = `<div class="small">${M.intro}</div><div class="warn">${M.validation}</div>${engineCards(M)}<h3>${L.software}</h3><div class="small mut">${Object.entries(M.software).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>`;
  h += `<h3>${L.modules}</h3>`;
  for (const m of M.modules)
    h += `<div class="scale"><div class="stitle">${m.title} <span class="badge" style="background:${m.conf_color};color:#111">${L.conf}: ${m.conf_label}</span></div><div class="small">${m.text}</div><div class="small mut">${L.why}: ${m.why}</div></div>`;
  h += `<h3>${L.refs}</h3><div class="small">` + M.references.map(([a, u]) => `• ${a} — <a href="${u}" target="_blank" style="color:var(--acc)">${u.replace(/^https?:\/\//, '').slice(0, 48)}</a>`).join('<br>') + '</div>';
  $('tab-meth').innerHTML = h;
}
buildYear(); buildGood(); buildMat(); buildUp(); buildMeth();
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  for (const t of ['now', 'year', 'good', 'mat', 'up', 'meth']) $('tab-' + t).classList.toggle('hide', t !== b.dataset.tab);
});

// ---------------------------------------------------------------- controls ---------------------------------------
$('doy').oninput = e => { S.doy = +e.target.value; refresh(); };
$('hour').oninput = e => { S.hour = +e.target.value; refresh(); };
document.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { const [d, h] = b.dataset.p.split(',').map(Number); S.doy = d; S.hour = h; refresh(); });
document.querySelectorAll('input[name=ov]').forEach(r => r.onchange = () => { S.overlay = r.value; $('seasonRow').style.opacity = r.value === 'wall' ? 1 : 0.4; refresh(); });
document.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { S.season = b.dataset.s; document.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === b)); refresh(); });
$('shadows').onchange = refresh; $('labels').onchange = refresh; $('ghost').onchange = refresh;
$('sunpath').onchange = () => { pathGroup.visible = $('sunpath').checked; };
const speed = () => +$('speed').value;
function stopPlay() { if (S.playing) { cancelAnimationFrame(S.playing.id); S.playing = null; } $('playDay').classList.remove('on'); $('playYear').classList.remove('on'); }
function play(kind) {
  const wasThis = S.playing && S.playing.kind === kind; stopPlay(); if (wasThis) return;
  $(kind === 'day' ? 'playDay' : 'playYear').classList.add('on');
  let last = performance.now(); S.playing = { kind, id: 0 };
  const tick = now => {
    const dt = (now - last) / 1000; last = now;
    if (kind === 'day') { S.hour += dt * speed() * 0.6; if (S.hour >= 23.75) S.hour = 0; }
    else { S.doy += dt * speed() * 12; if (S.doy >= 365) S.doy = 1; S.doy = Math.max(1, S.doy); }
    S.doy = Math.round(S.doy * 100) / 100; refresh();
    S.playing.id = requestAnimationFrame(tick);
  };
  S.playing.id = requestAnimationFrame(tick);
}
$('playDay').onclick = () => play('day'); $('playYear').onclick = () => play('year');

// camera positions are relative to the centre of the building (offset x, y(up), z(north)) and scale with its size
const VIEWS = { front: [[0, 4, 34.5], [0, 0.5, 4.5]], aerial: [[25.5, 24, 32.5], [-1, -1, 0.5]], top: [[0, 46, 0.3], [0, -1, 0]],
                east: [[-38.5, 9, 0], [0, 0.5, 0]], west: [[37.5, 9, 0], [0, 0.5, 0]], back: [[0, 12, -35.5], [0, 0, 0]] };
function goView(name) { const [o, tg] = VIEWS[name], k = SK, asp = innerWidth / innerHeight, f = asp >= 1 ? 1 : Math.min(1.9, 0.62 / asp + 0.25);      // portrait screens: stand farther back so the whole house fits the width
  camera.position.set(CENTER.x + o[0] * k * f, Math.max(o[1] * k * f, 3), CENTER.z + o[2] * k * f);
  controls.target.set(CENTER.x + tg[0] * k, CENTER.y + tg[1] * k, CENTER.z + tg[2] * k); controls.update(); }
document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => goView(b.dataset.v));
goView('aerial');
$('seasonRow').style.opacity = 0.4;
// optional deep link, e.g. index.html#doy=355&hour=15&ov=temp&view=top&ghost=0&labels=0&season=winter_kWh_m2&tab=year
{
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get('doy')) S.doy = +q.get('doy');
  if (q.get('hour')) S.hour = +q.get('hour');
  if (q.get('ov')) { S.overlay = q.get('ov'); const r = document.querySelector(`input[name=ov][value=${S.overlay}]`); if (r) r.checked = true; }
  if (q.get('season')) { S.season = q.get('season'); document.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x.dataset.s === S.season)); }
  if (q.get('view') && VIEWS[q.get('view')]) goView(q.get('view'));
  if (q.get('ghost') === '0') $('ghost').checked = false;
  if (q.get('labels') === '0') $('labels').checked = false;
  if (q.get('tab')) document.querySelector(`[data-tab=${q.get('tab')}]`)?.click();
  $('seasonRow').style.opacity = S.overlay === 'wall' ? 1 : 0.4;
}

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
refresh();
// show / hide the two side panels (useful on small screens); on narrow windows start with the results panel hidden
{
  const phone = () => matchMedia('(max-width: 700px)').matches;            // on a phone the panels are bottom sheets, one open at a time
  const mark = (btn, panel) => { $(btn).textContent = $(btn).textContent.replace(/[▾▸]/, $(panel).classList.contains('hide') ? '▸' : '▾'); };
  const setPanel = (btn, panel, hide) => { $(panel).classList.toggle('hide', hide); mark(btn, panel); };
  const PANELS = [['tgLeft', 'left'], ['tgRight', 'right']];
  for (const [btn, panel] of PANELS) $(btn).onclick = () => {
    const hide = !$(panel).classList.contains('hide');
    if (phone() && !hide) for (const [b2, p2] of PANELS) if (p2 !== panel) setPanel(b2, p2, true);
    setPanel(btn, panel, hide);
  };
  document.querySelectorAll('.closeSheet').forEach(b => b.onclick = () => PANELS.forEach(([bt, p]) => { if (b.closest('#' + p)) setPanel(bt, p, true); }));
  const closeAll = () => PANELS.forEach(([bt, p]) => setPanel(bt, p, true));
  if (phone()) closeAll(); else if (innerWidth < 800) setPanel('tgRight', 'right', true);
  // a short tap on the 3D view (not a drag or a pinch) closes the open sheet
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (down && phone() && performance.now() - down.t < 350 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) closeAll();
    down = null;
  });
  if (matchMedia('(pointer: coarse)').matches) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));          // phones: sharper than 1x but far cheaper than 3x
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }
}
// ---- static text of the page (data-pt holds the Portuguese, the original HTML is the English) and the language buttons
function applyStatic() {
  document.documentElement.lang = LANG === 'pt' ? 'pt-BR' : 'en';
  document.title = X('House - sun, shadows, light, wall energy and comfort through the year', 'Casa - sol, sombras, luz, energia nas paredes e conforto ao longo do ano');
  document.querySelectorAll('[data-pt]').forEach(el => { if (el.dataset.en === undefined) el.dataset.en = el.innerHTML; el.innerHTML = LANG === 'pt' ? el.dataset.pt : el.dataset.en; });
  for (const [btn, panel, en, pt] of [['tgLeft', 'left', 'Controls', 'Controles'], ['tgRight', 'right', 'Results', 'Resultados']])
    $(btn).textContent = `${X(en, pt)} ${$(panel).classList.contains('hide') ? '▸' : '▾'}`;
  document.querySelectorAll('[data-pt]').forEach(el => { if (CUR !== 'R$') el.innerHTML = el.innerHTML.replaceAll('R$', CUR); });
  const south = stat.site.south;
  const setB = (sel, en, pt) => { const b = document.querySelector(sel); if (b) b.innerHTML = X(en, pt); };
  setB('[data-p="355,12"]', south ? 'Summer sun<br>21 Dec' : 'Winter sun<br>21 Dec', south ? 'Sol de verão<br>21 dez' : 'Sol de inverno<br>21 dez');
  setB('[data-p="172,12"]', south ? 'Winter sun<br>21 Jun' : 'Summer sun<br>21 Jun', south ? 'Sol de inverno<br>21 jun' : 'Sol de verão<br>21 jun');
  if (!PROJ.has_street) {
    setB('[data-v="front"]', 'North side', 'Lado norte'); setB('[data-v="east"]', 'East side', 'Lado leste');
    setB('[data-v="west"]', 'West side', 'Lado oeste'); setB('[data-v="back"]', 'South side', 'Lado sul');
    setB('#hint', 'Drag to rotate, wheel to zoom, right-drag to move. North is toward the camera in the “North side” view.', 'Arraste para girar, role para ampliar, arraste com o botão direito para mover. O norte fica voltado para a câmera na vista “Lado norte”.');
  }
  if (matchMedia('(pointer: coarse)').matches) $('hint').innerHTML = X('One finger rotates, two fingers pinch to zoom and move. North is the street side.', 'Um dedo gira; dois dedos ampliam (pinça) e movem. O norte é o lado da rua.');
  $('langPT').classList.toggle('on', LANG === 'pt'); $('langEN').classList.toggle('on', LANG === 'en');
  compassText().forEach(([tx], i) => setSprite(compassSprites[i], tx));
  zoneNames.forEach(zn => setSprite(zoneMeshes[zn].sprite, rn(zn)));
  const pdf = $('pdfLink'); pdf.textContent = matchMedia('(max-width: 700px)').matches ? 'PDF' : X('PDF report', 'Relatório em PDF'); pdf.href = LANG === 'pt' ? 'reports/Relatorio_Casa.pdf' : 'reports/House_Report.pdf';
}
function setLang(l) {
  LANG = l; SC = stat.scales[l]; localStorage.setItem('lang', l);
  applyStatic(); buildYear(); buildGood(); buildMat(); buildUp(); buildMeth(); refresh();
}
$('langPT').onclick = () => setLang('pt'); $('langEN').onclick = () => setLang('en');
fetch('reports/Relatorio_Casa.pdf', { method: 'HEAD' }).then(r => { if (!r.ok) $('pdfLink').style.display = 'none'; }).catch(() => { $('pdfLink').style.display = 'none'; });
applyStatic(); refresh();
window.__viewer = { setLang, refresh, sunLine, CENTER, SK, get LANG() { return LANG; }, S, camera, controls, pathGroup, sun, hideable, zoneMeshes };      // handle for tools/test_viewer.py
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });