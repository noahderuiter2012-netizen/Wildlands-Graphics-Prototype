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
  return (
    Math.sin(x * 0.035) * 1.6 +
    Math.cos(z * 0.04) * 1.3 +
    Math.sin((x + z) * 0.021) * 2.2 +
    Math.cos((x - z) * 0.032) * 0.8
  );
}

function createTerrain() {
  // Simple walkable ground plane only; all visible woodland dressing comes from imported 3D assets.
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: '#3b4532', roughness: 1, metalness: 0
  });
  ground = new THREE.Mesh(geometry, groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);
}

const riverCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-125, 0, -55),
  new THREE.Vector3(-80, 0, -38),
  new THREE.Vector3(-48, 0, -8),
  new THREE.Vector3(-22, 0, 20),
  new THREE.Vector3(5, 0, 28),
  new THREE.Vector3(38, 0, 12),
  new THREE.Vector3(65, 0, -12),
  new THREE.Vector3(100, 0, -5),
  new THREE.Vector3(125, 0, 20)
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
    vertices.push(p.x + side.x * width, 0.03, p.z + side.z * width,
                  p.x - side.x * width, 0.03, p.z - side.z * width);
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

function createTree(x, z, scale = 1) {
  const y = terrainHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.scale.setScalar(scale);

  const bark = material('#624632', 1, { map: getBarkTexture() });
  const barkLit = material('#806044', 1, { map: getBarkTexture() });
  const moss = material('#344b2c', 1);
  const leafMats = [
    material('#172f20', 1), material('#203b26', 1),
    material('#29462b', 1), material('#354f30', 1),
    material('#405b35', 1), material('#4b6139', 1)
  ];
  const trunkHeight = 6.2 + random() * 4.2;
  const trunkLeanX = (random() - 0.5) * 0.9;
  const trunkLeanZ = (random() - 0.5) * 0.9;

  // A slightly leaning, irregular trunk built from tapered sections, not one perfect tube.
  const trunkSegments = 4;
  for (let s = 0; s < trunkSegments; s++) {
    const t0 = s / trunkSegments;
    const t1 = (s + 1) / trunkSegments;
    const h = trunkHeight / trunkSegments + 0.12;
    const bottomRadius = 0.62 * (1 - t0 * 0.76);
    const topRadius = 0.62 * (1 - t1 * 0.76);
    const segment = addMesh(
      new THREE.CylinderGeometry(Math.max(0.13, topRadius), bottomRadius, h, 7, 2),
      s % 2 ? barkLit : bark,
      trunkLeanX * (t0 + t1) * 0.5,
      trunkHeight * (t0 + t1) * 0.5,
      trunkLeanZ * (t0 + t1) * 0.5,
      group
    );
    segment.rotation.z = trunkLeanX / trunkHeight;
    segment.rotation.x = -trunkLeanZ / trunkHeight;
    segment.rotation.y = random() * 0.2;
    segment.castShadow = true;
    segment.receiveShadow = true;
  }

  // Exposed roots spread over the forest floor and merge into the trunk base.
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5 + random() * 0.45;
    const length = 1.0 + random() * 1.1;
    const root = addMesh(
      new THREE.CylinderGeometry(0.025, 0.24 + random() * 0.12, length, 5),
      i % 2 ? bark : barkLit,
      Math.cos(angle) * length * 0.35,
      0.16,
      Math.sin(angle) * length * 0.35,
      group
    );
    root.rotation.z = Math.cos(angle) * 1.12;
    root.rotation.x = Math.sin(angle) * 1.12;
    root.rotation.y = angle;
    root.castShadow = true;
  }

  // Main limbs branch outward and upward from the trunk, breaking the lollipop silhouette.
  const limbData = [];
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5 + random() * 0.6;
    const startY = trunkHeight * (0.48 + random() * 0.25);
    const length = 1.9 + random() * 1.8;
    const rise = 0.8 + random() * 1.4;
    const start = new THREE.Vector3(trunkLeanX * startY / trunkHeight, startY, trunkLeanZ * startY / trunkHeight);
    const endPoint = new THREE.Vector3(start.x + Math.cos(angle) * length, startY + rise, start.z + Math.sin(angle) * length);
    const delta = new THREE.Vector3().subVectors(endPoint, start);
    const limb = addMesh(
      new THREE.CylinderGeometry(0.055, 0.19, delta.length(), 5),
      bark,
      (start.x + endPoint.x) / 2,
      (start.y + endPoint.y) / 2,
      (start.z + endPoint.z) / 2,
      group
    );
    limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    limb.castShadow = true;
    limbData.push({ x: endPoint.x, y: endPoint.y, z: endPoint.z, angle });
  }

  // Irregular low-poly leaf clumps make a broken, branching canopy instead of six smooth balls.
  const leafGeometry = new THREE.IcosahedronGeometry(1, 1);
  const canopyY = trunkHeight * 0.66;
  for (let i = 0; i < 18; i++) {
    const angle = random() * Math.PI * 2;
    const spread = i < 5 ? 0.8 + random() * 1.5 : 1.5 + random() * 3.0;
    const radius = 1.0 + random() * 1.25;
    const cluster = addMesh(
      leafGeometry,
      leafMats[Math.floor(random() * leafMats.length)],
      Math.cos(angle) * spread + trunkLeanX * 0.4,
      canopyY + (random() - 0.35) * 3.5,
      Math.sin(angle) * spread + trunkLeanZ * 0.4,
      group
    );
    cluster.scale.set(radius * (0.85 + random() * 0.55), radius * (0.55 + random() * 0.65), radius * (0.8 + random() * 0.65));
    cluster.rotation.set(random() * 0.8, random() * Math.PI, random() * 0.8);
    cluster.castShadow = true;
    cluster.receiveShadow = true;
  }
  // Smaller foliage clusters follow the branch tips, so the canopy silhouette stays uneven.
  for (const limb of limbData) {
    for (let j = 0; j < 2; j++) {
      const puff = addMesh(
        leafGeometry,
        leafMats[Math.floor(random() * leafMats.length)],
        limb.x + (random() - 0.5) * 1.6,
        limb.y + random() * 1.3,
        limb.z + (random() - 0.5) * 1.6,
        group
      );
      const r = 0.8 + random() * 0.9;
      puff.scale.set(r * 1.2, r * 0.8, r);
      puff.rotation.set(random(), random() * Math.PI, random());
      puff.castShadow = true;
    }
  }

  // Moss patches break up the lower bark with muted, non-glossy colour.
  for (let i = 0; i < 3; i++) {
    const patch = addMesh(new THREE.IcosahedronGeometry(0.18 + random() * 0.12, 0), moss,
      (random() - 0.5) * 0.7, 0.8 + random() * 1.7, (random() - 0.5) * 0.7, group);
    patch.scale.set(0.7, 1.4, 0.35);
  }

  scene.add(group);
  obstacles.push({ x, z, radius: 0.85 * scale });
}
function createGrass() {
  // Instanced grass gives the ground a layered, wind-swept surface with only a few draw calls.
  const bladeGeometry = new THREE.ConeGeometry(0.075, 0.72, 4, 1);
  bladeGeometry.translate(0, 0.36, 0);
  const bladeGeometrySmall = new THREE.ConeGeometry(0.052, 0.48, 4, 1);
  bladeGeometrySmall.translate(0, 0.24, 0);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: '#9aaa62', roughness: 1, vertexColors: true, side: THREE.DoubleSide
  });
  const bladeCount = 2200;
  const tallGrass = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, bladeCount);
  const shortGrass = new THREE.InstancedMesh(bladeGeometrySmall, bladeMaterial, bladeCount);
  const dummy = new THREE.Object3D();
  const palette = ['#71874b', '#8a9b58', '#536e3d', '#a4a56a', '#647a42'];
  let placed = 0;
  let attempts = 0;
  while (placed < bladeCount && attempts < bladeCount * 3) {
    attempts++;
    const x = (random() - 0.5) * 224;
    const z = (random() - 0.5) * 224;
    if (Math.hypot(x, z) < 12) continue;
    const riverPoint = riverCurve.getPoint(THREE.MathUtils.clamp((x + 125) / 250, 0, 1));
    if (Math.hypot(x - riverPoint.x, z - riverPoint.z) < 5.5) continue;
    // Keep grass away from tree trunks and boulders so the player can still read the terrain.
    if (obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.radius + 0.45)) continue;
    const y = terrainHeight(x, z) + 0.025;
    const scale = 0.55 + random() * 1.0;
    dummy.position.set(x, y, z);
    dummy.rotation.set((random() - 0.5) * 0.16, random() * Math.PI, (random() - 0.5) * 0.28);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    tallGrass.setMatrixAt(placed, dummy.matrix);
    tallGrass.setColorAt(placed, new THREE.Color(palette[Math.floor(random() * palette.length)]));
    dummy.position.set(x + (random() - 0.5) * 0.22, y, z + (random() - 0.5) * 0.22);
    dummy.rotation.set((random() - 0.5) * 0.18, random() * Math.PI, (random() - 0.5) * 0.3);
    dummy.scale.setScalar(scale * (0.65 + random() * 0.35));
    dummy.updateMatrix();
    shortGrass.setMatrixAt(placed, dummy.matrix);
    shortGrass.setColorAt(placed, new THREE.Color(palette[Math.floor(random() * palette.length)]));
    placed++;
  }
  tallGrass.count = placed;
  shortGrass.count = placed;
  tallGrass.instanceMatrix.needsUpdate = true;
  shortGrass.instanceMatrix.needsUpdate = true;
  tallGrass.receiveShadow = true;
  shortGrass.receiveShadow = true;
  scene.add(tallGrass, shortGrass);
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
    floor: 'https://cdn.3dassets.dev/assets/36160/v1/model.glb'
  };
  const cache = new Map();
  const loadModel = url => new Promise((resolve, reject) => {
    if (cache.has(url)) { resolve(cache.get(url)); return; }
    loader.load(url, gltf => {
      cache.set(url, gltf.scene);
      resolve(gltf.scene);
    }, undefined, reject);
  });
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
  // A separate, light scattering of the complete scene asset adds background depth only.
  // Kept small and behind the foreground tree line to avoid the former clumped-up starting view.
  addInstance(assets.floor, -8, -92, 0.42, 0, 'DistantWoodlandBackdrop');
  setTimeout(() => {
    if (status.textContent.includes('Loading')) status.textContent = 'Woodland models placed — explore the open river corridor.';
  }, 9000);
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
  scene.background = new THREE.Color('#a8b9a7');
  scene.fog = new THREE.FogExp2('#a8b9a7', 0.0078);

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

  scene.add(new THREE.HemisphereLight('#e2edda', '#1c2b20', 1.75));

  // A soft green fill keeps shaded trunks and foliage readable under the canopy.
  const forestFill = new THREE.DirectionalLight('#b7d3a0', 0.55);
  forestFill.position.set(28, 24, 18);
  scene.add(forestFill);

  const sun = new THREE.DirectionalLight('#ffe6b5', 2.8);
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