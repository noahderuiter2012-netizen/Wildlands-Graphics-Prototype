import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './style.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <div id="game">
    <div id="hud">
      <div class="brand">
        <div class="brand-mark">W</div>
        <div>
          <div class="brand-name">WILDLANDS</div>
          <div class="brand-sub">THE LIVING FOREST · PROTOTYPE 0.1</div>
        </div>
      </div>

      <div class="status-panel">
        <div class="status-line"><span>HEALTH</span><span id="healthText">100</span></div>
        <div class="bar"><div id="healthBar" class="health-fill"></div></div>
        <div class="status-line"><span>STAMINA</span><span id="staminaText">100</span></div>
        <div class="bar"><div id="staminaBar" class="stamina-fill"></div></div>
      </div>

      <div id="location">🌲 THE EMERALD WILDS</div>
      <div id="message">Explore the forest.</div>
    </div>

    <div id="crosshair"></div>

    <div id="intro" class="overlay">
      <div class="intro-card">
        <div class="eyebrow">A WILDLANDS EXPERIMENT</div>
        <h1>THE LIVING<br><span>FOREST</span></h1>
        <p>Ancient trees. Forgotten waters. A wilderness waiting to be explored.</p>
        <button id="startButton">ENTER THE WILDS <span>→</span></button>
        <div class="controls-note">WASD TO MOVE · SPACE TO JUMP · SHIFT TO SPRINT · DRAG TO LOOK</div>
      </div>
    </div>

    <div id="bottom-ui">
      <div class="objective"><span class="objective-dot"></span> OBJECTIVE: EXPLORE THE WILDERNESS</div>
      <div id="coordinates">X 0 · Z 0</div>
    </div>

    <div id="touch-controls">
      <div id="joystick"><div id="stick"></div></div>
      <button id="sprintButton">SPRINT</button>
      <button id="jumpButton" aria-label="Jump">JUMP</button>
    </div>

    <div id="error" hidden></div>
  </div>
`;

const game = document.querySelector('#game');
const message = document.querySelector('#message');
const intro = document.querySelector('#intro');
const startButton = document.querySelector('#startButton');
const errorBox = document.querySelector('#error');

let scene, camera, renderer, clock;
let player, playerGroup, ground;
let running = false;
let gameStarted = false;
let stamina = 100;
let jumpVelocity = 0;
let jumpHeight = 0;
let jumpRequested = false;
let yaw = 0;
let pitch = 0.22;
let cameraDistance = 6.5;
let worldTime = 0;

const keys = {};
const obstacles = [];
const touch = { x: 0, y: 0, active: false, sprint: false };
const look = { active: false, x: 0, y: 0 };
const WORLD_SIZE = 260;

function showError(error) {
  console.error(error);
  errorBox.hidden = false;
  errorBox.textContent =
    'The 3D world could not start. Check that Three.js installed successfully, then reload. ' +
    (error?.message || '');
}

function material(color, roughness = 1, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    ...extra
  });
}

let barkTexture;
function getBarkTexture() {
  if (barkTexture) return barkTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 128, 0);
  gradient.addColorStop(0, '#39291f');
  gradient.addColorStop(0.18, '#71503a');
  gradient.addColorStop(0.34, '#4b3527');
  gradient.addColorStop(0.52, '#806044');
  gradient.addColorStop(0.7, '#4a3427');
  gradient.addColorStop(1, '#30251e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 256);
  // Fine vertical ridges and broken bark fissures, generated once and reused by every tree.
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 256;
    const length = 5 + Math.random() * 60;
    ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(20,13,9,0.30)' : 'rgba(190,145,96,0.18)';
    ctx.lineWidth = 0.4 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 4, Math.min(256, y + length));
    ctx.stroke();
  }
  barkTexture = new THREE.CanvasTexture(canvas);
  barkTexture.colorSpace = THREE.SRGBColorSpace;
  barkTexture.wrapS = THREE.RepeatWrapping;
  barkTexture.wrapT = THREE.RepeatWrapping;
  barkTexture.repeat.set(1, 1.6);
  barkTexture.anisotropy = 2;
  return barkTexture;
}

function addMesh(geometry, mat, x, y, z, parent = scene) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function randomGenerator(seed = 92381) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const random = randomGenerator();

function terrainHeight(x, z) {
  // Map 2 macro-terrain: snowy northern spine, western highlands, volcanic northeast,
  // and a raised, broken rim around the central Cursed Lands.
  const ridge = (cx, cz, sx, sz, h) => h * Math.exp(-(((x-cx)/sx)**2 + ((z-cz)/sz)**2));
  const rolling = Math.sin(x * 0.035 + Math.cos(z * 0.027)) * 0.85 +
    Math.cos(z * 0.044 - x * 0.018) * 0.58 + Math.sin((x + z) * 0.075) * 0.2;
  const northernRange = ridge(-15, -103, 90, 25, 18) + ridge(42, -92, 48, 23, 11);
  const westernMountains = ridge(-94, -58, 28, 45, 15) + ridge(-104, 4, 22, 40, 8);
  const volcano = ridge(91, -71, 28, 27, 21);
  const cursedRim = ridge(7, -20, 32, 27, 3.4);
  return rolling + northernRange + westernMountains + volcano + cursedRim;
}

function createTerrain() {
  // Gently rolling terrain with a reusable leaf-litter / damp soil texture.
  const segments = 180;
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const colors = [];
  const colorA = new THREE.Color('#777c61');
  const colorB = new THREE.Color('#a0a080');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    const variation = THREE.MathUtils.clamp(0.38 + Math.sin(x * 0.045 + z * 0.031) * 0.18 + Math.sin(z * 0.13) * 0.07, 0, 1);
    const c = colorA.clone().lerp(colorB, variation);
    const blend = (cx, cz, radius) => Math.max(0, 1 - Math.hypot(x-cx, z-cz) / radius);
    const forest = blend(-74, 5, 58);
    const cursed = blend(7, -20, 38);
    const grass = blend(75, 24, 62);
    const volcanic = blend(91, -71, 43);
    const snow = Math.max(blend(-16, -105, 72), blend(38, -92, 48));
    c.lerp(new THREE.Color('#40533a'), forest * 0.74);
    c.lerp(new THREE.Color('#524b61'), cursed * 0.82);
    c.lerp(new THREE.Color('#a0a078'), grass * 0.68);
    c.lerp(new THREE.Color('#51433a'), volcanic * 0.86);
    c.lerp(new THREE.Color('#b9c3c2'), snow * 0.92);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#77735a'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const x = random() * 512, y = random() * 512;
    const kind = random();
    if (kind < 0.38) ctx.fillStyle = `rgba(38,48,31,${0.06 + random()*0.2})`;
    else if (kind < 0.70) ctx.fillStyle = `rgba(132,104,66,${0.06 + random()*0.22})`;
    else ctx.fillStyle = `rgba(177,164,119,${0.04 + random()*0.17})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.5 + random()*2.6, 0.25 + random()*1.1, random()*Math.PI, 0, Math.PI*2);
    ctx.fill();
  }
  for (let i = 0; i < 180; i++) {
    ctx.strokeStyle = `rgba(35,31,23,${0.06 + random()*0.12})`; ctx.lineWidth = 0.4 + random()*1.1;
    ctx.beginPath(); ctx.moveTo(random()*512, random()*512); ctx.lineTo(random()*512, random()*512); ctx.stroke();
  }
  const floorTexture = new THREE.CanvasTexture(canvas);
  floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(9, 9); floorTexture.colorSpace = THREE.SRGBColorSpace; floorTexture.anisotropy = 4;
  const groundMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, color: '#c4c9a7', vertexColors: true, roughness: 1, metalness: 0 });
  ground = new THREE.Mesh(geometry, groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);
}

function createDirtPaths() {
  // Winding packed-earth paths use a detailed noisy canvas texture, not a flat tan strip.
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#594733'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 18000; i++) {
    const x = random() * 512, y = random() * 512;
    const shade = Math.floor(55 + random() * 75);
    ctx.fillStyle = `rgba(${shade},${Math.floor(shade * 0.78)},${Math.floor(shade * 0.56)},${0.08 + random() * 0.24})`;
    ctx.beginPath(); ctx.ellipse(x, y, 0.4 + random() * 2.4, 0.3 + random() * 1.5, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 110; i++) {
    ctx.strokeStyle = `rgba(27,25,19,${0.06 + random() * 0.12})`;
    ctx.lineWidth = 0.4 + random() * 1.1;
    ctx.beginPath(); ctx.moveTo(random() * 512, random() * 512); ctx.lineTo(random() * 512, random() * 512); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1.8, 1.8); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: '#c0aa83', polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide });
  const routes = [
    [[0,0],[-4,-12],[-11,-22],[-18,-30],[-28,-40],[-42,-48]],
    [[-18,-30],[-5,-34],[12,-36],[28,-32],[43,-23],[53,-12]],
    [[12,-36],[16,-48],[28,-61],[43,-73]],
    [[-28,-40],[-41,-31],[-53,-18],[-61,-3]],
    [[43,-23],[54,-35],[67,-45],[80,-51]],
    [[0,0],[9,12],[20,19],[32,24],[43,31]]
  ];
  for (const route of routes) {
    const points = route.map(([x,z]) => new THREE.Vector3(x, terrainHeight(x,z) + 0.09, z));
    const curve = new THREE.CatmullRomCurve3(points);
    const divisions = 100, verts = [], uv = [], idx = [];
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions, p = curve.getPoint(t), tangent = curve.getTangent(t).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const width = 2.3 + Math.sin(t * Math.PI * 9) * 0.22 + Math.sin(t * 37) * 0.12;
      verts.push(p.x + side.x * width, p.y, p.z + side.z * width, p.x - side.x * width, p.y, p.z - side.z * width);
      uv.push(0, t * 8, 1, t * 8);
      if (i < divisions) { const a = i * 2; idx.push(a,a+1,a+2,a+1,a+3,a+2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts,3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2)); g.setIndex(idx); g.computeVertexNormals();
    const path = new THREE.Mesh(g, mat); path.receiveShadow = true; scene.add(path);
  }
}

function createMountains() {
  // Distant, irregular high-resolution ridges frame the playable woodland without blocking routes.
  const rng = randomGenerator(40819);
  const rockMat = new THREE.MeshStandardMaterial({ color: '#62675e', roughness: 1, flatShading: false, vertexColors: true });
  const ranges = [
    // Tall snow spine across the north, with a broken western mountain chain.
    {x:-88,z:-91,w:39,d:45,h:28},{x:-48,z:-108,w:50,d:34,h:34},
    {x:4,z:-112,w:52,d:38,h:40},{x:52,z:-104,w:44,d:37,h:33},
    {x:88,z:-87,w:35,d:38,h:27},
    {x:-105,z:-48,w:34,d:42,h:29},{x:-111,z:-4,w:31,d:40,h:22},
    {x:-100,z:39,w:39,d:37,h:25},
    // Lower southern coastal ridges frame the Riverlands without sealing the region.
    {x:-70,z:111,w:45,d:27,h:17},{x:-15,z:119,w:43,d:25,h:16},
    {x:46,z:115,w:45,d:28,h:18},{x:101,z:91,w:36,d:35,h:20}
  ];
  for (const r of ranges) {
    const geo = new THREE.PlaneGeometry(r.w, r.d, 42, 42);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, colors = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const edge = Math.max(Math.abs(x) / (r.w * 0.5), Math.abs(z) / (r.d * 0.5));
      const ridge = Math.max(0, 1 - edge) * r.h;
      const noise = (Math.sin((x + r.x) * 0.19) + Math.cos((z + r.z) * 0.16) + Math.sin((x + z) * 0.31)) * r.h * 0.07;
      p.setY(i, Math.max(0, ridge + noise));
      const c = new THREE.Color('#454c47').lerp(new THREE.Color('#85877c'), THREE.MathUtils.clamp((p.getY(i) / r.h) * 0.85 + rng() * 0.12, 0, 1));
      colors.push(c.r,c.g,c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors,3)); geo.computeVertexNormals();
    const mountain = new THREE.Mesh(geo, rockMat); mountain.position.set(r.x, -0.5, r.z); mountain.receiveShadow = true; scene.add(mountain);
  }
  // Detailed boulders at the foot of the ridges, built from dense irregular geometry.
  const rockPalette = ['#555b53','#686b60','#77776a','#454b46'];
  for (let i = 0; i < 58; i++) {
    const angle = rng() * Math.PI * 2, radius = 91 + rng() * 27;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const p = geo.attributes.position;
    for (let j = 0; j < p.count; j++) {
      const wobble = 0.78 + rng() * 0.42;
      p.setXYZ(j, p.getX(j) * wobble, p.getY(j) * (0.65 + rng() * 0.5), p.getZ(j) * wobble);
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: rockPalette[Math.floor(rng()*rockPalette.length)], roughness: 1, flatShading: true }));
    const scale = 1.2 + rng() * 4.8; rock.scale.set(scale, scale * (0.55 + rng()*0.6), scale * (0.8 + rng()*0.8));
    rock.position.set(x, rock.scale.y * 0.45 - 0.2, z); rock.rotation.set(rng()*0.3, rng()*Math.PI, rng()*0.25); rock.castShadow = true; rock.receiveShadow = true; scene.add(rock);
  }
  // Volcanic Region landmark: a dark, broad cone with a glowing crater and branching lava scars.
  const volcano = new THREE.Mesh(new THREE.ConeGeometry(24, 30, 48, 8, false), new THREE.MeshStandardMaterial({color:'#302d2a', roughness:1, flatShading:true}));
  volcano.position.set(91, 9, -71); volcano.scale.set(1.2, 1, 1.05); volcano.castShadow = true; volcano.receiveShadow = true; scene.add(volcano);
  const lavaMat = new THREE.MeshStandardMaterial({color:'#ff5a18', emissive:'#e33108', emissiveIntensity:2.2, roughness:0.45});
  const crater = new THREE.Mesh(new THREE.TorusGeometry(4.8, 1.05, 8, 32), lavaMat); crater.rotation.x = Math.PI/2; crater.position.set(91, 23.2, -71); scene.add(crater);
  for (const path of [[91,-71,83,-54],[91,-71,101,-82],[91,-71,107,-61],[91,-71,78,-83]]) {
    const pts = [new THREE.Vector3(path[0],20,path[1]),new THREE.Vector3((path[0]+path[2])/2,9,(path[1]+path[3])/2),new THREE.Vector3(path[2],terrainHeight(path[2],path[3])+0.3,path[3])];
    const lava = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),18,0.42,6,false),lavaMat); scene.add(lava);
  }
  // Cursed Lands boundary stones: weathered pillars with restrained violet energy.
  const cursedRock = new THREE.MeshStandardMaterial({color:'#38343f', roughness:0.96});
  const cursedGlow = new THREE.MeshStandardMaterial({color:'#7b55b7', emissive:'#44216f', emissiveIntensity:1.15, roughness:0.55});
  for (let i=0;i<11;i++) {
    const a=i/11*Math.PI*2, x=7+Math.cos(a)*29, z=-20+Math.sin(a)*25;
    const h=3.2+rng()*3.6;
    const pillar=new THREE.Mesh(new THREE.DodecahedronGeometry(1.25,1),cursedRock);
    pillar.position.set(x,terrainHeight(x,z)+h*0.42,z); pillar.scale.set(0.8,h,0.9); pillar.rotation.set(rng()*0.3,rng()*Math.PI,rng()*0.2); pillar.castShadow=true; scene.add(pillar);
    const shard=new THREE.Mesh(new THREE.OctahedronGeometry(0.24+rng()*0.22,0),cursedGlow);
    shard.position.set(x,terrainHeight(x,z)+h*0.95,z); shard.rotation.set(0, a, 0.35); scene.add(shard);
  }
}

const riverCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-126, 7, 18),
  new THREE.Vector3(-98, 0, 42),
  new THREE.Vector3(-77, 0, 74),
  new THREE.Vector3(-47, 0, 96),
  new THREE.Vector3(-12, 0, 83),
  new THREE.Vector3(15, 0, 66),
  new THREE.Vector3(43, 0, 79),
  new THREE.Vector3(70, 0, 61),
  new THREE.Vector3(92, 0, 37),
  new THREE.Vector3(126, 0, 27)
]);

function createRiver() {
  // A narrow, readable waterway; the banks are dressed with imported woodland models.
  const points = riverCurve.getPoints(140);
  const vertices = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const direction = new THREE.Vector3().subVectors(after, before).normalize();
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    const width = 2.7 + Math.sin(i * 0.13) * 0.35;
    const waterY = terrainHeight(p.x, p.z) - 0.12;
    vertices.push(p.x + side.x * width, waterY, p.z + side.z * width,
                  p.x - side.x * width, waterY, p.z - side.z * width);
    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const water = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: '#315c5a', roughness: 0.18, metalness: 0.12, transparent: true,
    opacity: 0.9, side: THREE.DoubleSide
  }));
  water.receiveShadow = true;
  scene.add(water);
}

function createForest() {
  // Rebuild the forest from separate CC0 GLB models, with deliberate gaps and a clear river corridor.
  // No generated cylinders, spheres, or primitive foliage are used as trees or plants.
  const loader = new GLTFLoader();
  const status = document.querySelector('#message');
  status.textContent = 'Loading realistic woodland models…';
  const assets = {
    tree: 'https://cdn.3dassets.dev/assets/36137/v1/model.glb',
    log: 'https://cdn.3dassets.dev/assets/36143/v1/model.glb',
  };
  const cache = new Map();
  const loadModel = url => {
    if (cache.has(url)) return cache.get(url);
    const promise = new Promise((resolve, reject) => loader.load(url, gltf => resolve(gltf.scene), undefined, reject));
    cache.set(url, promise);
    return promise;
  };
  const addInstance = async (url, x, z, scale, rotation = 0, name = 'ForestAsset') => {
    try {
      const template = await loadModel(url);
      const model = template.clone(true);
      model.name = name;
      model.position.set(x, 0, z);
      model.rotation.y = rotation;
      model.scale.setScalar(scale);
      model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
      });
      scene.add(model);
      // Coarse trunk collision for the player.
      if (name.includes('Tree')) obstacles.push({ x, z, radius: 1.4 * scale });
    } catch (error) {
      console.error('Forest model failed to load:', url, error);
      status.textContent = 'Some woodland models failed to load. Reload with a stable connection.';
    }
  };
  // Main trees form loose groups rather than a continuous wall. The centre and river stay open.
  const treeSpots = [
    [-32,-38,1.0],[-22,-47,0.82],[-43,-54,1.08],[-10,-44,0.88],
    [18,-52,1.02],[31,-43,0.86],[44,-56,1.06],[53,-38,0.9],
    [-48,-15,0.94],[-38,2,1.05],[-51,20,0.82],[-35,36,1.0],
    [43,6,0.95],[51,24,1.06],[37,39,0.84],[53,48,1.0],
    [-30,58,0.82],[-12,63,1.0],[12,58,0.9],[28,65,1.05],
    [-68,-38,1.05],[-73,-10,0.9],[-69,21,1.0],[70,-31,0.9],[73,7,1.05],[69,37,0.86],
    [-90,-58,1.0],[-96,-24,0.9],[-91,15,1.05],[-86,52,0.95],
    [92,-53,1.0],[97,-14,0.9],[91,25,1.06],[88,55,0.92]
  ];
  for (let i = 0; i < treeSpots.length; i++) {
    const [x,z,s] = treeSpots[i];
    // Leave a broad open start area and a clear strip around the stream.
    if (Math.hypot(x,z) < 17) continue;
    const nearestRiver = riverCurve.getPoints(32).reduce((best,p) => Math.min(best, Math.hypot(x-p.x,z-p.z)), Infinity);
    if (nearestRiver < 9) continue;
    addInstance(assets.tree, x, z, s, (i * 1.71) % (Math.PI * 2), 'ImportedTree');
  }
  const logs = [[-26,-30,1.0],[25,-31,0.85],[-57,31,0.9],[59,35,1.0],[-78,2,0.8],[81,-5,0.9]];
  logs.forEach(([x,z,s],i) => addInstance(assets.log,x,z,s,(i*1.1)%Math.PI,'ImportedFallenLog'));
  Promise.allSettled([...cache.values()]).then(results => {
    const failed = results.filter(r => r.status === 'rejected').length;
    status.textContent = failed ? 'Some forest assets failed to load — check connection.' : 'Forest assets loaded. Explore the river corridor.';
  });
}

function createPlayer() {
  playerGroup = new THREE.Group();

  const bodyMat = material('#6b8064');
  const darkMat = material('#302d25');
  const skinMat = material('#b18a69');

  const body = addMesh(
    new THREE.CapsuleGeometry(0.38, 0.7, 4, 8),
    bodyMat,
    0,
    1.15,
    0,
    playerGroup
  );
  body.castShadow = true;

  const head = addMesh(
    new THREE.SphereGeometry(0.25, 12, 10),
    skinMat,
    0,
    1.85,
    0,
    playerGroup
  );
  head.castShadow = true;

  const pack = addMesh(
    new THREE.BoxGeometry(0.42, 0.5, 0.22),
    darkMat,
    0,
    1.22,
    0.34,
    playerGroup
  );
  pack.castShadow = true;

  playerGroup.position.set(0, terrainHeight(0, 0), 0);
  scene.add(playerGroup);
  player = playerGroup;
}

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#9eafa0');
  scene.fog = new THREE.FogExp2('#9eafa0', 0.0062);

  camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance'
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  game.prepend(renderer.domElement);

  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight('#dce8d4', '#263126', 1.35));

  // A soft green fill keeps shaded trunks and foliage readable under the canopy.
  const forestFill = new THREE.DirectionalLight('#b8cda6', 0.38);
  forestFill.position.set(28, 24, 18);
  scene.add(forestFill);

  const sun = new THREE.DirectionalLight('#ffe4bd', 2.1);
  sun.position.set(-35, 65, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun);

  createTerrain();
  createDirtPaths();
  createMountains();
  createRiver();
  createForest();
  createPlayer();

  window.addEventListener('resize', onResize);
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
}

function beginGame() {
  gameStarted = true;
  intro.classList.add('hidden');
  message.textContent = 'Find the river and explore.';
  startButton.textContent = 'RESUME EXPLORATION →';

  if (!isTouchDevice()) {
    renderer.domElement.requestPointerLock?.();
  }
}

function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

startButton.addEventListener('click', beginGame);

document.addEventListener('pointerlockchange', () => {
  running = document.pointerLockElement === renderer?.domElement;
});

document.addEventListener('mousemove', event => {
  if (document.pointerLockElement === renderer?.domElement) {
    yaw -= event.movementX * 0.0022;
    pitch -= event.movementY * 0.0018;
    pitch = THREE.MathUtils.clamp(pitch, -0.08, 0.75);
  }
});

rendererSafeSetup();

function rendererSafeSetup() {
  try {
    setupScene();
    animate();
    setupControls();
  } catch (error) {
    showError(error);
  }
}

function setupControls() {
  document.addEventListener('keydown', event => {
    keys[event.code] = true;

    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
    if ((event.code === 'Space' || event.code === 'KeyJ') && !event.repeat && gameStarted) {
      jumpRequested = true;
    }

    if (event.code === 'Escape' && gameStarted) {
      intro.classList.remove('hidden');
    }
  });

  document.addEventListener('keyup', event => {
    keys[event.code] = false;
  });

  // Drag to look on a touchscreen.
  renderer.domElement.addEventListener('pointerdown', event => {
    if (!isTouchDevice() || !gameStarted) return;
    if (event.clientX < window.innerWidth * 0.35) return;
    look.active = true;
    look.x = event.clientX;
    look.y = event.clientY;
    renderer.domElement.setPointerCapture?.(event.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', event => {
    if (!look.active) return;
    const dx = event.clientX - look.x;
    const dy = event.clientY - look.y;
    yaw -= dx * 0.006;
    pitch = THREE.MathUtils.clamp(pitch - dy * 0.004, -0.08, 0.75);
    look.x = event.clientX;
    look.y = event.clientY;
  });

  const stopLook = () => { look.active = false; };
  renderer.domElement.addEventListener('pointerup', stopLook);
  renderer.domElement.addEventListener('pointercancel', stopLook);

  // Virtual joystick.
  const joystick = document.querySelector('#joystick');
  const stick = document.querySelector('#stick');
  const jumpButton = document.querySelector('#jumpButton');
  const requestJump = event => {
    event?.preventDefault?.();
    if (gameStarted) { jumpRequested = true; message.textContent = 'JUMP BUTTON INPUT DETECTED'; jumpButton.textContent = 'JUMP!'; } else { message.textContent = 'Press START before jumping.'; }
  };
  jumpButton.addEventListener('pointerdown', requestJump);
  jumpButton.addEventListener('click', requestJump);

  const updateJoystick = event => {
    const rect = joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = event.clientX - cx;
    let dy = event.clientY - cy;
    const max = rect.width * 0.32;
    const length = Math.hypot(dx, dy);
    if (length > max) {
      dx = dx / length * max;
      dy = dy / length * max;
    }
    touch.x = dx / max;
    touch.y = dy / max;
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  joystick.addEventListener('pointerdown', event => {
    touch.active = true;
    joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });

  joystick.addEventListener('pointermove', event => {
    if (touch.active) updateJoystick(event);
  });

  const releaseJoystick = () => {
    touch.active = false;
    touch.x = 0;
    touch.y = 0;
    stick.style.transform = 'translate(0px, 0px)';
  };

  joystick.addEventListener('pointerup', releaseJoystick);
  joystick.addEventListener('pointercancel', releaseJoystick);

  const sprintButton = document.querySelector('#sprintButton');
  sprintButton.addEventListener('pointerdown', event => {
    event.preventDefault();
    touch.sprint = true;
    sprintButton.classList.add('active');
  });

  const releaseSprint = () => {
    touch.sprint = false;
    sprintButton.classList.remove('active');
  };

  sprintButton.addEventListener('pointerup', releaseSprint);
  sprintButton.addEventListener('pointercancel', releaseSprint);
  sprintButton.addEventListener('pointerleave', releaseSprint);

  if (isTouchDevice()) {
    document.querySelector('#touch-controls').classList.add('visible');
  }
}

function movePlayer(delta) {
  if (!gameStarted) return;

  // Strong, clearly visible jump arc. The request is consumed once per frame.
  if (jumpRequested && jumpHeight <= 0.001) {
    jumpVelocity = 14;
    message.textContent = 'Jump!';
  }
  jumpRequested = false;
  if (jumpHeight > 0 || jumpVelocity > 0) {
    jumpVelocity -= 26 * delta;
    jumpHeight = Math.max(0, jumpHeight + jumpVelocity * delta);
    if (jumpHeight === 0) jumpVelocity = 0;
  }

  const forwardInput =
    (keys.KeyW || keys.ArrowUp ? 1 : 0) -
    (keys.KeyS || keys.ArrowDown ? 1 : 0) -
    touch.y;

  const sideInput =
    (keys.KeyD || keys.ArrowRight ? 1 : 0) -
    (keys.KeyA || keys.ArrowLeft ? 1 : 0) +
    touch.x;

  const moving = Math.abs(forwardInput) + Math.abs(sideInput) > 0.05;
  const wantsSprint = keys.ShiftLeft || keys.ShiftRight || touch.sprint;
  const sprinting = moving && wantsSprint && stamina > 1;

  if (sprinting) stamina = Math.max(0, stamina - 27 * delta);
  else stamina = Math.min(100, stamina + 16 * delta);

  const speed = sprinting ? 10.5 : 5.6;
  const direction = new THREE.Vector3();
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  direction.addScaledVector(forward, forwardInput);
  direction.addScaledVector(right, sideInput);

  if (direction.lengthSq() > 0) {
    direction.normalize();
    const nextX = THREE.MathUtils.clamp(
      player.position.x + direction.x * speed * delta,
      -WORLD_SIZE / 2 + 3,
      WORLD_SIZE / 2 - 3
    );
    const nextZ = THREE.MathUtils.clamp(
      player.position.z + direction.z * speed * delta,
      -WORLD_SIZE / 2 + 3,
      WORLD_SIZE / 2 - 3
    );

    // Simple tree and rock collision.
    const blocked = obstacles.some(obstacle =>
      Math.hypot(nextX - obstacle.x, nextZ - obstacle.z) < obstacle.radius + 0.45
    );

    if (!blocked) {
      player.position.x = nextX;
      player.position.z = nextZ;
    }

    player.rotation.y = Math.atan2(-direction.x, -direction.z);
  }

  player.position.y = terrainHeight(player.position.x, player.position.z) + jumpHeight;

  document.querySelector('#staminaBar').style.width = `${stamina}%`;
  document.querySelector('#staminaText').textContent = Math.round(stamina);

  document.querySelector('#coordinates').textContent =
    `X ${Math.round(player.position.x)} · Z ${Math.round(player.position.z)}`;
  const px = player.position.x, pz = player.position.z;
  const region = pz < -79 ? 'SNOWY PEAKS' : (px > 62 && pz < -43 ? 'VOLCANIC REGION' : (Math.hypot((px+7)/1.05, pz+20) < 35 ? 'CURSED LANDS' : (px < -42 && pz < 62 ? 'ANCIENT FOREST' : (pz > 53 ? 'RIVERLANDS' : (px > 35 ? 'GRASSLANDS' : (px < -76 ? 'MOUNTAINS' : 'THE WILDS'))))));
  document.querySelector('#location').textContent = '✦ ' + region;

  if (sprinting) message.textContent = 'Moving fast — stamina draining.';
  else if (stamina < 25) message.textContent = 'Stamina low — slow down to recover.';
  else if (moving) message.textContent = 'Exploring the wilderness.';
  else message.textContent = 'Find the river and explore.';
}

function updateCamera(delta) {
  if (!player) return;

  // Keep the camera target anchored to the ground while the player jumps,
  // otherwise the camera follows the vertical motion and hides the jump.
  const target = new THREE.Vector3(
    player.position.x,
    terrainHeight(player.position.x, player.position.z) + 1.5,
    player.position.z
  );
  const horizontal = cameraDistance * Math.cos(pitch);
  const offset = new THREE.Vector3(
    Math.sin(yaw) * horizontal,
    2.0 + Math.sin(pitch) * cameraDistance,
    Math.cos(yaw) * horizontal
  );

  const desired = target.clone().add(offset);
  camera.position.lerp(desired, 1 - Math.exp(-5 * delta));
  camera.lookAt(target);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.04);
  worldTime += delta;

  if (player) {
    movePlayer(delta);
    updateCamera(delta);
  }

  // Slow, subtle variation in the forest atmosphere.
  const fogPulse = 0.0082 + Math.sin(worldTime * 0.08) * 0.00022;
  scene.fog.density = fogPulse;

  renderer.render(scene, camera);
}