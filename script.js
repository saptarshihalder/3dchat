import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js';

const $ = s => document.querySelector(s);
const world = $('#world');
const onlineEl = $('#online');
const networkEl = $('#network');
const joinScreen = $('#join-screen');
const nameInput = $('#name');
const enterButton = $('#enter');
const chatForm = $('#chat-form');
const chatInput = $('#msg');
const chatLog = $('#chat-log');
const fatal = $('#fatal');

let entered = false;
let displayName = localStorage.getItem('3dchat-name') || '';
nameInput.value = displayName;

const clientId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
const roomId = new URLSearchParams(location.search).get('room') || 'main-lobby';
const keys = new Set();
const peers = new Map();
const transportToClient = new Map();
const seenMessages = new Set();
let p2p = null;
let p2pState = null;
let p2pProfile = null;
let p2pChat = null;
let cameraYaw = Math.PI;
let cameraPitch = 0.34;
let cameraDistance = 7.5;
let lastStateSent = 0;
let lastHeartbeat = 0;
let pointerDown = false;
let lastPointerX = 0;
let lastPointerY = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
scene.fog = new THREE.Fog(0x0b1220, 38, 92);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 180);
camera.position.set(0, 5, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
world.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbddcff, 0x1a2030, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(12, 24, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x182231, roughness: 0.92, metalness: 0.02 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(100, 100, 0x507195, 0x26384e);
grid.position.y = 0.012;
scene.add(grid);

const plaza = new THREE.Mesh(
  new THREE.CylinderGeometry(11, 11, 0.22, 64),
  new THREE.MeshStandardMaterial({ color: 0x25374d, roughness: 0.78 })
);
plaza.position.y = 0.11;
plaza.receiveShadow = true;
scene.add(plaza);

function box(x, y, z, sx, sy, sz, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.72 }));
  m.position.set(x, y + sy / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

for (let i = 0; i < 18; i++) {
  const a = i / 18 * Math.PI * 2;
  const r = 24 + (i % 3) * 4;
  const h = 3 + (i % 5) * 1.5;
  box(Math.cos(a) * r, 0, Math.sin(a) * r, 3.5, h, 3.5, i % 2 ? 0x243752 : 0x2c405e);
}

for (const [x, z] of [[-8,-8],[8,-8],[-8,8],[8,8]]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.35,.5,4.5,10), new THREE.MeshStandardMaterial({color:0x6d89a8, roughness:.4, metalness:.3}));
  post.position.set(x,2.25,z); post.castShadow = true; scene.add(post);
  const lamp = new THREE.PointLight(0x8ac7ff, 12, 13, 2);
  lamp.position.set(x,4.6,z); scene.add(lamp);
}

function makeTextSprite(text, scale = 1, bg = 'rgba(8,13,21,.78)', fg = '#ffffff') {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const dpr = 2;
  ctx.font = `${15 * dpr}px system-ui, sans-serif`;
  const width = Math.min(900, Math.max(120, ctx.measureText(text).width + 28 * dpr));
  canvas.width = width;
  canvas.height = 38 * dpr;
  ctx.font = `${15 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 14 * dpr);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set((canvas.width / canvas.height) * scale, scale, 1);
  sprite.userData.texture = texture;
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : (
    ctx.moveTo(x+r,y), ctx.arcTo(x+w,y,x+w,y+h,r), ctx.arcTo(x+w,y+h,x,y+h,r), ctx.arcTo(x,y+h,x,y,r), ctx.arcTo(x,y,x+w,y,r)
  );
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const c = new THREE.Color();
  c.setHSL((h % 360) / 360, .58, .58);
  return c.getHex();
}

function createAvatar(id, name, color = colorFromId(id), local = false) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .06 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(.9, 1.15, .62), mat);
  body.position.y = .82;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(.66, .66, .66), mat.clone());
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff });
  for (const x of [-.16, .16]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(.09,.09,.035), eyeMat);
    eye.position.set(x, 1.8, -.345);
    group.add(eye);
  }
  const label = makeTextSprite(name || 'guest', .7);
  label.position.y = 2.45;
  group.add(label);
  group.userData = { id, name, label, bubble: null, bubbleUntil: 0, local };
  scene.add(group);
  return group;
}

function replaceNameLabel(group, name) {
  if (group.userData.label) {
    group.remove(group.userData.label);
    group.userData.label.material.map?.dispose();
    group.userData.label.material.dispose();
  }
  const label = makeTextSprite(name || 'guest', .7);
  label.position.y = 2.45;
  group.add(label);
  group.userData.label = label;
  group.userData.name = name;
}

function showBubble(group, message) {
  if (group.userData.bubble) {
    group.remove(group.userData.bubble);
    group.userData.bubble.material.map?.dispose();
    group.userData.bubble.material.dispose();
  }
  const bubble = makeTextSprite(message.slice(0, 120), .92, 'rgba(245,248,255,.94)', '#111827');
  bubble.position.y = 3.25;
  group.add(bubble);
  group.userData.bubble = bubble;
  group.userData.bubbleUntil = performance.now() + 8000;
}

const me = createAvatar(clientId, displayName || 'you', colorFromId(clientId), true);
me.position.set(0, 0, 2.5);

const lobbyTitle = makeTextSprite('MY LOBBY', 1.3, 'rgba(14,24,38,.86)', '#a9d7ff');
lobbyTitle.position.set(0, 5.5, -10.5);
scene.add(lobbyTitle);

function ensurePeer(id, name, color) {
  if (!id || id === clientId) return null;
  let peer = peers.get(id);
  if (!peer) {
    const group = createAvatar(id, name || 'visitor', color ?? colorFromId(id), false);
    group.position.set((Math.random()-.5)*5, 0, (Math.random()-.5)*5);
    peer = { group, target: group.position.clone(), ry: 0, targetRy: 0, name: name || 'visitor', lastSeen: performance.now() };
    peers.set(id, peer);
    updateOnline();
  }
  if (name && peer.name !== name) {
    peer.name = name;
    replaceNameLabel(peer.group, name);
  }
  peer.lastSeen = performance.now();
  return peer;
}

function removePeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  scene.remove(peer.group);
  peer.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material?.map) o.material.map.dispose();
    if (o.material) o.material.dispose();
  });
  peers.delete(id);
  updateOnline();
}

function updateOnline() {
  onlineEl.textContent = `${1 + peers.size} online`;
}

function appendChat(name, message, system = false) {
  const line = document.createElement('div');
  line.className = `chat-line${system ? ' system' : ''}`;
  if (system) line.textContent = message;
  else {
    const b = document.createElement('b');
    b.textContent = `${name}: `;
    line.append(b, document.createTextNode(message));
  }
  chatLog.appendChild(line);
  while (chatLog.children.length > 18) chatLog.firstChild.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
}

const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`3dchat:${roomId}`) : null;
function bcSend(payload) { channel?.postMessage(payload); }
channel?.addEventListener('message', e => receivePacket(e.data, 'local-tab'));

function packetBase(type) {
  return { type, clientId, name: displayName, color: colorFromId(clientId), t: Date.now() };
}

function currentState(type = 'state') {
  return { ...packetBase(type), x: me.position.x, z: me.position.z, ry: me.rotation.y };
}

function receivePacket(data, transportPeerId) {
  if (!data || data.clientId === clientId) return;
  if (transportPeerId && transportPeerId !== 'local-tab') transportToClient.set(transportPeerId, data.clientId);
  const peer = ensurePeer(data.clientId, data.name, data.color);
  if (!peer) return;
  peer.lastSeen = performance.now();
  if (data.type === 'state' || data.type === 'hello') {
    if (Number.isFinite(data.x) && Number.isFinite(data.z)) peer.target.set(data.x, 0, data.z);
    if (Number.isFinite(data.ry)) peer.targetRy = data.ry;
    if (data.type === 'hello') bcSend(currentState('state'));
  }
  if (data.type === 'chat' && data.message) {
    const id = data.messageId || `${data.clientId}:${data.t}:${data.message}`;
    if (seenMessages.has(id)) return;
    seenMessages.add(id);
    appendChat(data.name || peer.name, String(data.message));
    showBubble(peer.group, String(data.message));
  }
}

async function connectP2P() {
  networkEl.textContent = 'connecting peer-to-peer…';
  try {
    const { joinRoom } = await import('https://esm.run/trystero@0.25.4');
    p2p = joinRoom({ appId: 'saptarshi-halder-3dchat-revival-2026' }, roomId);
    p2pState = p2p.makeAction('state');
    p2pProfile = p2p.makeAction('profile');
    p2pChat = p2p.makeAction('chat');

    p2pState.onMessage = (data, { peerId }) => receivePacket({ ...data, type: 'state' }, peerId);
    p2pProfile.onMessage = (data, { peerId }) => receivePacket({ ...data, type: 'hello' }, peerId);
    p2pChat.onMessage = (data, { peerId }) => receivePacket({ ...data, type: 'chat' }, peerId);

    p2p.onPeerJoin = peerId => {
      networkEl.textContent = 'peer-to-peer online';
      p2pProfile.send(currentState('hello'), { target: peerId }).catch(() => {});
      p2pState.send(currentState(), { target: peerId }).catch(() => {});
    };
    p2p.onPeerLeave = peerId => {
      const id = transportToClient.get(peerId);
      if (id) removePeer(id);
      transportToClient.delete(peerId);
    };
    networkEl.textContent = 'peer-to-peer ready';
  } catch (err) {
    console.warn('P2P unavailable, local world still active', err);
    networkEl.textContent = 'local world · P2P unavailable';
  }
}

function sendState(force = false) {
  const now = performance.now();
  if (!force && now - lastStateSent < 90) return;
  lastStateSent = now;
  const data = currentState();
  bcSend(data);
  p2pState?.send(data).catch(() => {});
}

function sendChat(message) {
  const text = message.trim().slice(0, 120);
  if (!text) return;
  const data = { ...packetBase('chat'), message: text, messageId: `${clientId}:${Date.now()}:${Math.random().toString(36).slice(2,8)}` };
  seenMessages.add(data.messageId);
  appendChat(displayName, text);
  showBubble(me, text);
  bcSend(data);
  p2pChat?.send(data).catch(() => {});
}

function enterLobby() {
  displayName = (nameInput.value.trim() || `Guest-${clientId.slice(0,4)}`).slice(0,24);
  localStorage.setItem('3dchat-name', displayName);
  replaceNameLabel(me, displayName);
  entered = true;
  joinScreen.style.display = 'none';
  appendChat('', `Welcome to ${roomId}.`, true);
  bcSend(currentState('hello'));
  connectP2P();
  chatInput.focus({ preventScroll: true });
  chatInput.blur();
}

enterButton.addEventListener('click', enterLobby);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') enterLobby(); });

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!entered) return;
  sendChat(chatInput.value);
  chatInput.value = '';
});

addEventListener('keydown', e => {
  if (!entered) return;
  if (document.activeElement === chatInput || document.activeElement === nameInput) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    chatInput.focus();
    return;
  }
  keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));

for (const btn of document.querySelectorAll('[data-key]')) {
  const code = btn.dataset.key;
  const down = e => { e.preventDefault(); keys.add(code); };
  const up = e => { e.preventDefault(); keys.delete(code); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
}

renderer.domElement.addEventListener('pointerdown', e => {
  pointerDown = true; lastPointerX = e.clientX; lastPointerY = e.clientY;
  renderer.domElement.setPointerCapture?.(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!pointerDown || !entered) return;
  cameraYaw -= (e.clientX - lastPointerX) * .006;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch - (e.clientY - lastPointerY) * .004, .08, .95);
  lastPointerX = e.clientX; lastPointerY = e.clientY;
});
renderer.domElement.addEventListener('pointerup', () => pointerDown = false);
renderer.domElement.addEventListener('wheel', e => {
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + e.deltaY * .006, 4.5, 12);
}, { passive: true });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
});

const clock = new THREE.Clock();
const move = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
let moving = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  const now = performance.now();

  if (entered && document.activeElement !== chatInput) {
    cameraYaw += ((keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0)) * 1.65 * dt;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + ((keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)) * 1.05 * dt, .08, .95);

    forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    right.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    move.set(0,0,0);
    if (keys.has('KeyW')) move.add(forward);
    if (keys.has('KeyS')) move.sub(forward);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
    moving = move.lengthSq() > 0;
    if (moving) {
      move.normalize().multiplyScalar(5.4 * dt);
      me.position.add(move);
      me.position.x = THREE.MathUtils.clamp(me.position.x, -45, 45);
      me.position.z = THREE.MathUtils.clamp(me.position.z, -45, 45);
      me.rotation.y = Math.atan2(move.x, move.z) + Math.PI;
      sendState();
    }
  }

  for (const [id, peer] of peers) {
    peer.group.position.lerp(peer.target, 1 - Math.pow(.001, dt));
    let dr = peer.targetRy - peer.group.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    peer.group.rotation.y += dr * Math.min(1, dt * 9);
    if (peer.group.userData.bubble && now > peer.group.userData.bubbleUntil) {
      peer.group.remove(peer.group.userData.bubble);
      peer.group.userData.bubble.material.map?.dispose();
      peer.group.userData.bubble.material.dispose();
      peer.group.userData.bubble = null;
    }
    if (now - peer.lastSeen > 15000 && ![...transportToClient.values()].includes(id)) removePeer(id);
  }

  if (me.userData.bubble && now > me.userData.bubbleUntil) {
    me.remove(me.userData.bubble);
    me.userData.bubble.material.map?.dispose();
    me.userData.bubble.material.dispose();
    me.userData.bubble = null;
  }

  const cp = Math.cos(cameraPitch), sp = Math.sin(cameraPitch);
  const camOffset = new THREE.Vector3(
    Math.sin(cameraYaw) * cp * cameraDistance,
    sp * cameraDistance + 1.5,
    Math.cos(cameraYaw) * cp * cameraDistance
  );
  const desiredCam = me.position.clone().add(camOffset);
  camera.position.lerp(desiredCam, 1 - Math.pow(.00005, dt));
  camera.lookAt(me.position.x, 1.1, me.position.z);

  if (entered && now - lastHeartbeat > 1800) {
    lastHeartbeat = now;
    sendState(true);
  }

  renderer.render(scene, camera);
}

try {
  updateOnline();
  animate();
} catch (err) {
  fatal.hidden = false;
  fatal.textContent = `3D Chat could not start.\n\n${err?.stack || err}`;
}

addEventListener('beforeunload', () => {
  channel?.close();
  p2p?.leave();
});
