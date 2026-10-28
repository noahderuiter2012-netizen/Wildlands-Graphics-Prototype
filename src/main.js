import * as THREE from 'three';
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
        <div class="controls-note">WASD TO MOVE · SHIFT TO SPRINT · DRAG TO LOOK</div>
      </div>
    </div>

    <div id="bottom-ui">
      <div class="objective"><span class="objective-dot"></span> OBJECTIVE: EXPLORE THE WILDERNESS</div>
      <div id="coordinates">X 0 · Z 0</div>
    </div>

    <div id="touch-controls">
      <div id="joystick"><div id="stick"></div></div>
      <button id="sprintButton">SPRINT</button>
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
  const geometry = new THREE.PlaneGeometry(
    WORLD_SIZE,
    WORLD_SIZE,
    110,
    110
  );
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    positions.setY(i, terrainHeight(x, z));
  }

  geometry.computeVertexNormals();

  const colors = [];
  const green = new THREE.Color('#40583a');
  const darkGreen = new THREE.Color('#18271d');
  const mossGreen = new THREE.Color('#596747');
  const forestSoil = new THREE.Color('#302e24');

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const y = positions.getY(i);
    const variation = Math.sin(x * 0.12 + z * 0.07) * Math.cos(z * 0.11 - x * 0.04);
    const mossAmount = THREE.MathUtils.clamp((variation - 0.05) * 0.8, 0, 0.65);
    const soilAmount = THREE.MathUtils.clamp((-variation - 0.35) * 0.4, 0, 0.3);
    const heightShade = THREE.MathUtils.clamp((y + 3) / 10, 0, 0.45);
    const c = darkGreen.clone().lerp(green, 0.45 + heightShade).lerp(mossGreen, mossAmount).lerp(forestSoil, soilAmount);
    colors.push(c.r, c.g, c.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  ground = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1
    })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // Distant, low hills make the horizon feel less empty.
  const hillMaterial = material('#263c2b');
  for (let i = 0; i < 34; i++) {
    const angle = (i / 34) * Math.PI * 2;
    const radius = 104 + random() * 25;
    const sx = 8 + random() * 16;
    const sy = 5 + random() * 12;
    const sz = 10 + random() * 18;
    const hill = addMesh(
      new THREE.SphereGeometry(1, 10, 8),
      hillMaterial,
      Math.cos(angle) * radius,
      sy * 0.35 - 1,
      Math.sin(angle) * radius
    );
    hill.scale.set(sx, sy, sz);
    hill.receiveShadow = true;
  }
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
  const points = riverCurve.getPoints(140);
  const vertices = [];
  const indices = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const direction = new THREE.Vector3().subVectors(after, before).normalize();
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    const width = 3.2 + Math.sin(i * 0.23) * 0.55;
    const y = terrainHeight(p.x, p.z) + 0.16;

    vertices.push(
      p.x + side.x * width, y, p.z + side.z * width,
      p.x - side.x * width, y, p.z - side.z * width
    );

    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const water = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: '#326c78',
      roughness: 0.22,
      metalness: 0.22,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide
    })
  );
  water.receiveShadow = true;
  scene.add(water);

  // Small pale stones along parts of the bank.
  const stoneMat = material('#7b8070');
  for (let i = 0; i < 95; i++) {
    const t = 0.04 + random() * 0.92;
    const p = riverCurve.getPoint(t);
    const tangent = riverCurve.getTangent(t);
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const offset = (random() < 0.5 ? -1 : 1) * (4.3 + random() * 2.3);
    const x = p.x + side.x * offset;
    const z = p.z + side.z * offset;

    const rock = addMesh(
      new THREE.DodecahedronGeometry(0.45 + random() * 0.7, 0),
      stoneMat,
      x,
      terrainHeight(x, z) + 0.25,
      z
    );
    rock.scale.y = 0.5 + random() * 0.6;
    rock.rotation.set(random(), random() * 3, random());
  }
}

function createTree(x, z, scale = 1) {
  const y = terrainHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.scale.setScalar(scale);

  const trunkMat = material(random() > 0.5 ? '#4d3827' : '#60452d');
  const barkLight = material('#735238');
  const leaves = [
    material('#183a28'),
    material('#21462d'),
    material('#2b5032'),
    material('#34583a'),
    material('#3b6040')
  ];

  const trunkHeight = 4.5 + random() * 3.5;
  const trunk = addMesh(
    new THREE.CylinderGeometry(0.24, 0.68, trunkHeight, 8, 2),
    trunkMat,
    0,
    trunkHeight / 2,
    0,
    group
  );
  trunk.rotation.z = (random() - 0.5) * 0.1;
  trunk.castShadow = true;
  trunk.receiveShadow = true;

  // Uneven root flares make the trunks feel anchored in the forest floor.
  for (let rootIndex = 0; rootIndex < 2; rootIndex++) {
    const root = addMesh(
      new THREE.CylinderGeometry(0.035, 0.24 + random() * 0.12, 1.15 + random() * 0.45, 5),
      rootIndex === 0 ? trunkMat : barkLight,
      (random() - 0.5) * 0.48,
      0.28,
      (random() - 0.5) * 0.48,
      group
    );
    root.rotation.z = (random() < 0.5 ? -1 : 1) * (0.65 + random() * 0.3);
    root.rotation.y = random() * Math.PI;
    root.castShadow = true;
  }

  const crownY = trunkHeight * 0.48;
  const layerCount = 5;

  for (let layer = 0; layer < layerCount; layer++) {
    const progress = layer / layerCount;
    const radius = (3.0 * (1 - progress) + 0.3) * (0.72 + random() * 0.48);
    const height = 2.5 + random() * 1.45;
    const crown = addMesh(
      new THREE.ConeGeometry(radius, height, 8 + Math.floor(random() * 3), 2),
      leaves[Math.floor(random() * leaves.length)],
      (random() - 0.5) * 1.35,
      crownY + layer * (1.02 + random() * 0.25),
      (random() - 0.5) * 1.35,
      group
    );
    crown.rotation.y = random() * Math.PI;
    crown.rotation.z = (random() - 0.5) * 0.14;
    crown.rotation.x = (random() - 0.5) * 0.1;
    crown.castShadow = true;
    crown.receiveShadow = true;
  }

  // Branches point in varied directions instead of forming a repeated pair.
  for (let i = 0; i < 3; i++) {
    const branch = addMesh(
      new THREE.CylinderGeometry(0.055, 0.19, 1.8 + random() * 0.8, 5),
      trunkMat,
      (random() - 0.5) * 1.1,
      trunkHeight * (0.5 + i * 0.11),
      (random() - 0.5) * 1.1,
      group
    );
    branch.rotation.z = (random() < 0.5 ? -1 : 1) * (0.55 + random() * 0.5);
    branch.rotation.x = (random() - 0.5) * 0.5;
    branch.rotation.y = random() * Math.PI;
    branch.castShadow = true;
  }

  scene.add(group);
  obstacles.push({ x, z, radius: 0.7 * scale });
}

function createForest() {
  // Tree placement leaves an open starting clearing.
  for (let i = 0; i < 520; i++) {
    const x = (random() - 0.5) * (WORLD_SIZE - 12);
    const z = (random() - 0.5) * (WORLD_SIZE - 12);

    if (Math.hypot(x, z) < 13) continue;

    // Keep the immediate river channel open.
    const riverPoint = riverCurve.getPoint(
      THREE.MathUtils.clamp((x + 125) / 250, 0, 1)
    );
    if (Math.hypot(x - riverPoint.x, z - riverPoint.z) < 6.8) continue;

    createTree(x, z, 0.7 + random() * 0.8);
  }

  // Scatter boulders through the woodland.
  const rockMats = [
    material('#51594f'),
    material('#62685b'),
    material('#414b43')
  ];

  for (let i = 0; i < 105; i++) {
    const x = (random() - 0.5) * (WORLD_SIZE - 20);
    const z = (random() - 0.5) * (WORLD_SIZE - 20);
    if (Math.hypot(x, z) < 10) continue;

    const rock = addMesh(
      new THREE.DodecahedronGeometry(0.7 + random() * 1.7, 1),
      rockMats[Math.floor(random() * rockMats.length)],
      x,
      terrainHeight(x, z) + 0.3,
      z
    );
    rock.scale.set(1 + random(), 0.65 + random() * 0.6, 0.8 + random() * 0.8);
    rock.rotation.set(random(), random() * 3, random());
    rock.castShadow = true;
    rock.receiveShadow = true;
    obstacles.push({ x, z, radius: 1.2 });
  }

  // Forest floor details: patches of ferns.
  const fernMat = material('#486b3d');
  for (let i = 0; i < 170; i++) {
    const x = (random() - 0.5) * 220;
    const z = (random() - 0.5) * 220;
    const group = new THREE.Group();
    group.position.set(x, terrainHeight(x, z) + 0.05, z);

    for (let j = 0; j < 4; j++) {
      const leaf = addMesh(
        new THREE.ConeGeometry(0.14, 1.1 + random() * 0.5, 5),
        fernMat,
        (random() - 0.5) * 0.65,
        0.45,
        (random() - 0.5) * 0.65,
        group
      );
      leaf.rotation.z = (random() - 0.5) * 0.9;
      leaf.rotation.x = (random() - 0.5) * 0.7;
    }
    scene.add(group);
  }

  // Batched leaf litter and moss flecks add ground variation with only one draw call.
  const litterPositions = [];
  const litterColors = [];
  const litterPalette = [new THREE.Color('#6b6542'), new THREE.Color('#4b5734'), new THREE.Color('#76694a'), new THREE.Color('#35452c')];
  for (let i = 0; i < 620; i++) {
    const x = (random() - 0.5) * 220;
    const z = (random() - 0.5) * 220;
    if (Math.hypot(x, z) < 8) continue;
    const y = terrainHeight(x, z) + 0.035;
    const length = 0.12 + random() * 0.34;
    const width = 0.035 + random() * 0.09;
    const angle = random() * Math.PI;
    const dx = Math.cos(angle) * length;
    const dz = Math.sin(angle) * length;
    const wx = -Math.sin(angle) * width;
    const wz = Math.cos(angle) * width;
    litterPositions.push(x - dx, y, z - dz, x + dx, y, z + dz, x + wx, y + 0.01, z + wz);
    const color = litterPalette[Math.floor(random() * litterPalette.length)];
    for (let k = 0; k < 3; k++) litterColors.push(color.r, color.g, color.b);
  }
  const litterGeometry = new THREE.BufferGeometry();
  litterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(litterPositions, 3));
  litterGeometry.setAttribute('color', new THREE.Float32BufferAttribute(litterColors, 3));
  litterGeometry.computeVertexNormals();
  const litter = new THREE.Mesh(litterGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }));
  litter.frustumCulled = true;
  scene.add(litter);
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
  scene.background = new THREE.Color('#9bb3a2');
  scene.fog = new THREE.FogExp2('#9bb3a2', 0.0072);

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
  renderer.toneMappingExposure = 1.15;
  game.prepend(renderer.domElement);

  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight('#d7e8cf', '#25362b', 2.0));

  const sun = new THREE.DirectionalLight('#fff0cc', 2.4);
  sun.position.set(-35, 65, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
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
  window.addEventListener('keydown', event => {
    keys[event.code] = true;

    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }

    if (event.code === 'Escape' && gameStarted) {
      intro.classList.remove('hidden');
    }
  });

  window.addEventListener('keyup', event => {
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

  player.position.y = terrainHeight(player.position.x, player.position.z);

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

  const target = player.position.clone().add(new THREE.Vector3(0, 1.5, 0));
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
  const fogPulse = 0.0085 + Math.sin(worldTime * 0.08) * 0.00025;
  scene.fog.density = fogPulse;

  renderer.render(scene, camera);
}