// Call de voz/vídeo/tela com LiveKit (SFU).
import { $, h, ICON, avatar, toast, beep } from './ui.js';
import { ZOEIRA_TOPIC, ZOEIRA_KINDS, playZoeira, preloadZoeira, stopAllZoeira, isZoeiraPlaying } from './zoeira.js';

let Room, RoomEvent, Track, DisconnectReason, ScreenSharePresets, VideoPresets;
let livekitPromise;
function ensureLiveKit() {
  if (!livekitPromise) livekitPromise = import('livekit-client').then((sdk) => {
    ({ Room, RoomEvent, Track, DisconnectReason, ScreenSharePresets, VideoPresets } = sdk);
  }).catch((error) => { livekitPromise = null; throw error; });
  return livekitPromise;
}

const SETTINGS_KEY = 'resenha:av';
const VOL_KEY = 'resenha:volumes';

export const call = {
  room: null,
  roomId: null,
  roomName: '',
  channelId: null,     // canal de voz em que estou (null = call padrão da sala)
  connecting: false,
  muted: false,
  deafened: false,
  focusKey: null,
  watch: false,        // tem vídeo passando em "Assistir junto"
  voiceEffect: 'normal', // voz zoada da Loja (normal | robo | radio)
  pinned: [],          // quadros fixados, do mais antigo para o mais novo (até 4)
  layout: 'spotlight', // spotlight | side | float
  floatCorner: 'br',   // br | bl | tl | tr
  floatSize: 2,        // 1 pequeno, 2 médio, 3 grande
  avatarUrl: null,
  onPersonClick: null,
  onChange: () => {}
};

// ---------- Preferências (dispositivos, filtros, volumes) ----------
// noiseMode: off | browser (filtro do navegador) | rnnoise (rede neural, mais forte)
export function loadSettings() {
  const def = { audioinput: '', audiooutput: '', videoinput: '', echoCancellation: true, noiseSuppression: true, autoGainControl: true, mirrorCam: true, zoeiraOnMe: true, zoeiraSound: true, screenQuality: 'nitida', screenAudio: true, screenSurface: 'window' };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const out = { ...def, ...saved };
    if (!['off', 'browser', 'rnnoise'].includes(saved.noiseMode)) out.noiseMode = saved.noiseSuppression === false ? 'off' : 'rnnoise';
    return out;
  } catch (_) { return def; }
}
export function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

function loadVolumes() {
  try { return JSON.parse(localStorage.getItem(VOL_KEY) || '{}'); } catch (_) { return {}; }
}
export function getVolume(identity) {
  const v = loadVolumes()[identity];
  return typeof v === 'number' ? v : 1;
}
export function setVolume(identity, value) {
  const all = loadVolumes();
  all[identity] = value;
  localStorage.setItem(VOL_KEY, JSON.stringify(all));
  applyVolume(identity);
}
function applyVolume(identity) {
  if (!call.room) return;
  const p = call.room.remoteParticipants.get(identity);
  if (!p) return;
  const v = call.deafened ? 0 : getVolume(identity);
  p.setVolume(v, Track.Source.Microphone);
  p.setVolume(v, Track.Source.ScreenShareAudio);
}
function applyAllVolumes() {
  if (!call.room) return;
  for (const id of call.room.remoteParticipants.keys()) applyVolume(id);
}

function audioOptions(s) {
  return {
    deviceId: s.audioinput || undefined,
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseMode === 'browser',
    autoGainControl: s.autoGainControl
  };
}

// ---------- Entrar e sair ----------
export async function joinCall(roomId, roomName, getToken, channelId = null, channelName = '') {
  if (call.connecting) return;
  if (call.room && call.roomId === roomId && (call.channelId || null) === (channelId || null)) return;
  if (call.room) await leaveCall(true);

  call.connecting = true;
  call.roomId = roomId;
  call.channelId = channelId || null;
  call.roomName = channelName ? `${roomName} · ${channelName}` : roomName;
  call.onChange();
  try {
    const [{ token, url }] = await Promise.all([getToken(roomId, channelId || null), ensureLiveKit()]);
    const s = loadSettings();
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      webAudioMix: true,
      audioCaptureDefaults: audioOptions(s),
      audioOutput: s.audiooutput ? { deviceId: s.audiooutput } : undefined,
      videoCaptureDefaults: { deviceId: s.videoinput || undefined, resolution: VideoPresets.h720.resolution },
      publishDefaults: {
        simulcast: true,
        dtx: true,
        red: true,
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
        screenShareSimulcastLayers: [ScreenSharePresets.h720fps15]
      }
    });
    wireRoom(room);
    call.room = room;
    await room.connect(url, token);

    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      if (call.muted || call.deafened) await room.localParticipant.setMicrophoneEnabled(false);
    } catch (err) {
      call.muted = true;
      toast('Não consegui acessar seu microfone. Você está só ouvindo.');
    }
    await syncAttributes();
    await applyMicChain();
    applyAllVolumes();
    preloadZoeira();
    beep(660, 880);
  } catch (err) {
    console.error(err);
    if (call.room) { try { await call.room.disconnect(); } catch (_) {} }
    call.room = null;
    call.roomId = null;
    call.channelId = null;
    const msg = String((err && err.message) || '');
    toast(/dynamically imported module|loading chunk/i.test(msg)
      ? 'Não consegui carregar a call. Recarregue o aplicativo e tente novamente.'
      : /signal connection|Failed to fetch|websocket/i.test(msg)
      ? 'Não consegui conectar na call. Confira sua internet ou as chaves do LiveKit no servidor.'
      : msg || 'Não foi possível entrar na call.', 4500);
  } finally {
    call.connecting = false;
    call.onChange();
  }
}

export async function leaveCall(silent) {
  const room = call.room;
  call.room = null;
  call.roomId = null;
  call.channelId = null;
  call.focusKey = null;
  call.voiceEffect = 'normal';
  call.pinned = [];
  stopAllZoeira();
  $('audio-bin').innerHTML = '';
  for (const v of videoEls.values()) { if (v._track) { try { v._track.detach(v); } catch (_) {} } }
  videoEls.clear();
  if (room) { try { await room.disconnect(); } catch (_) {} }
  if (!silent) beep(880, 520);
  call.onChange();
}

function wireRoom(room) {
  const changed = () => call.onChange();
  room
    .on(RoomEvent.ParticipantConnected, (p) => { applyVolume(p.identity); beep(660, 880); changed(); })
    .on(RoomEvent.ParticipantDisconnected, () => { beep(880, 520); changed(); })
    .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.dataset.sid = track.sid;
        $('audio-bin').append(el);
        applyVolume(participant.identity);
      }
      changed();
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
      changed();
    })
    .on(RoomEvent.TrackMuted, changed)
    .on(RoomEvent.TrackUnmuted, changed)
    .on(RoomEvent.LocalTrackPublished, changed)
    .on(RoomEvent.LocalTrackUnpublished, changed)
    .on(RoomEvent.ParticipantAttributesChanged, changed)
    .on(RoomEvent.ActiveSpeakersChanged, updateSpeaking)
    .on(RoomEvent.ConnectionStateChanged, changed)
    .on(RoomEvent.AudioPlaybackStatusChanged, () => {
      $('audio-unlock').hidden = room.canPlaybackAudio;
    })
    .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic === ZOEIRA_TOPIC && participant) receiveZoeira(payload, participant);
    })
    .on(RoomEvent.MediaDevicesError, () => toast('Problema ao acessar microfone ou câmera.'))
    .on(RoomEvent.Disconnected, (reason) => {
      if (call.room !== room) return;
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) toast('Você foi removido da call.', 4000);
      else if (reason === DisconnectReason.DUPLICATE_IDENTITY) toast('Você entrou na call em outra aba ou aparelho.', 4000);
      else if (reason !== DisconnectReason.CLIENT_INITIATED) toast('A call caiu. Tente entrar de novo.', 4000);
      leaveCall(true);
    });
}

$('audio-unlock').addEventListener('click', async () => {
  if (call.room) { await call.room.startAudio(); $('audio-unlock').hidden = true; }
});

async function syncAttributes() {
  if (!call.room) return;
  try {
    await call.room.localParticipant.setAttributes({ deafened: call.deafened ? '1' : '0' });
  } catch (_) {}
}

// ---------- Zoeira (golpes animados vistos por todos da call) ----------
const ZOEIRA_COOLDOWN_MS = 8000;
const lastZoeiraBy = new Map();
let myLastZoeira = 0;

function nameOf(identity) {
  if (!call.room) return 'Alguém';
  const p = identity === call.room.localParticipant.identity ? call.room.localParticipant : call.room.remoteParticipants.get(identity);
  return (p && p.name) || 'Alguém';
}

function showZoeira(kind, target, fromName) {
  const targetName = nameOf(target);
  const isMe = call.room && target === call.room.localParticipant.identity;
  toast(isMe ? `${fromName} te mandou pra privada` : `${fromName} mandou ${targetName} pra privada`);
  playZoeira({ kind, identity: target, name: targetName, avatarUrl: call.avatarUrl ? call.avatarUrl(target) : null, muted: call.deafened || loadSettings().zoeiraSound === false });
}

function receiveZoeira(payload, participant) {
  let msg;
  try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (_) { return; }
  if (!msg || msg.v !== 1 || !Object.hasOwn(ZOEIRA_KINDS, msg.kind) || typeof msg.target !== 'string') return;
  const room = call.room;
  if (!room) return;
  const targetInCall = msg.target === room.localParticipant.identity || room.remoteParticipants.has(msg.target);
  if (!targetInCall || msg.target === participant.identity) return;
  if (msg.target === room.localParticipant.identity && loadSettings().zoeiraOnMe === false) return;
  const now = Date.now();
  if (now - (lastZoeiraBy.get(participant.identity) || 0) < ZOEIRA_COOLDOWN_MS - 1000) return;
  lastZoeiraBy.set(participant.identity, now);
  showZoeira(msg.kind, msg.target, participant.name || 'Alguém');
}

export function zoeiraWait() {
  return Math.max(0, Math.ceil((ZOEIRA_COOLDOWN_MS - (Date.now() - myLastZoeira)) / 1000));
}

export async function sendZoeira(kind, target) {
  const room = call.room;
  if (!room || !Object.hasOwn(ZOEIRA_KINDS, kind)) return;
  if (target === room.localParticipant.identity || !room.remoteParticipants.has(target)) {
    toast('Essa pessoa não está na call.');
    return;
  }
  const wait = zoeiraWait();
  if (wait > 0) { toast(`Calma, espera ${wait}s pra zoar de novo.`); return; }
  if (isZoeiraPlaying(target)) { toast(`${nameOf(target)} ainda está na privada.`); return; }
  myLastZoeira = Date.now();
  try {
    const data = new TextEncoder().encode(JSON.stringify({ v: 1, kind, target }));
    await room.localParticipant.publishData(data, { reliable: true, topic: ZOEIRA_TOPIC });
  } catch (_) {
    myLastZoeira = 0;
    toast('Não consegui mandar a zoeira. Tenta de novo.');
    return;
  }
  showZoeira(kind, target, 'Você');
}

// ---------- Controles ----------
export async function toggleMic() {
  if (call.deafened) { await setDeafened(false); return; }
  call.muted = !call.muted;
  if (call.room) {
    try { await call.room.localParticipant.setMicrophoneEnabled(!call.muted); }
    catch (_) { call.muted = true; toast('Sem acesso ao microfone.'); }
  }
  beep(call.muted ? 520 : 700, call.muted ? 400 : 900);
  call.onChange();
}

export async function setDeafened(value) {
  call.deafened = value;
  if (value) call.muted = true;
  else call.muted = false;
  if (call.room) {
    try { await call.room.localParticipant.setMicrophoneEnabled(!call.muted); } catch (_) {}
    applyAllVolumes();
    await syncAttributes();
  }
  call.onChange();
}

export async function toggleCam() {
  if (!call.room) return;
  const lp = call.room.localParticipant;
  try {
    await lp.setCameraEnabled(!lp.isCameraEnabled);
  } catch (_) {
    toast('Não consegui acessar a câmera.');
  }
  call.onChange();
}

const SCREEN_QUALITY = { leve: 'h720fps30', nitida: 'h1080fps30' };
const screenPreset = (quality) => (quality === 'fluida'
  ? { resolution: { width: 1920, height: 1080, frameRate: 60 }, encoding: { maxBitrate: 8_000_000, maxFramerate: 60 } }
  : ScreenSharePresets[SCREEN_QUALITY[quality] || 'h1080fps30']);

// opts (só ao ligar): { quality: leve|nitida|fluida, audio: boolean, surface: monitor|window|browser }
export async function toggleScreen(opts = {}) {
  if (!call.room) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    toast('Seu navegador não permite transmitir a tela (use Chrome ou Edge no computador).');
    return;
  }
  const lp = call.room.localParticipant;
  const on = !lp.isScreenShareEnabled;
  try {
    const saved = loadSettings();
    const quality = opts.quality || saved.screenQuality || 'nitida';
    const preset = screenPreset(quality);
    const audio = opts.audio === undefined ? saved.screenAudio !== false : opts.audio;
    const surface = opts.surface || saved.screenSurface;
    await lp.setScreenShareEnabled(on, on ? {
      audio,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      contentHint: quality === 'fluida' ? 'motion' : 'detail',
      resolution: preset.resolution,
      ...(surface ? { video: { displaySurface: surface } } : {})
    } : undefined, on ? { screenShareEncoding: preset.encoding } : undefined);
    if (on) call.focusKey = `${lp.identity}:screen`;
  } catch (err) {
    if (err && err.name !== 'NotAllowedError') toast('Não foi possível transmitir a tela.');
  }
  call.onChange();
}

// Troca de dispositivo (funciona durante a call)
export async function switchDevice(kind, deviceId) {
  const s = loadSettings();
  s[kind] = deviceId;
  saveSettings(s);
  if (call.room) {
    try { await call.room.switchActiveDevice(kind, deviceId); } catch (_) { toast('Não foi possível trocar o dispositivo.'); }
  }
}

// Reaplica cancelamento de eco/ruído criando uma nova faixa de microfone
export async function applyAudioFilters() {
  if (!call.room) return;
  const lp = call.room.localParticipant;
  const pub = lp.getTrackPublication(Track.Source.Microphone);
  if (pub && pub.track) {
    const t = pub.track;
    await lp.unpublishTrack(t);
    t.stop();
  }
  try {
    await lp.setMicrophoneEnabled(true, audioOptions(loadSettings()));
    if (call.muted) await lp.setMicrophoneEnabled(false);
  } catch (_) {}
  await applyMicChain();
  call.onChange();
}

export async function listDevices(kind) {
  try { await ensureLiveKit(); return await Room.getLocalDevices(kind, true); } catch (_) { return []; }
}

// ---------- Estado para a interface ----------
export function participants() {
  if (!call.room) return [];
  const all = [call.room.localParticipant, ...call.room.remoteParticipants.values()];
  return all.map((p) => {
    const mic = p.getTrackPublication(Track.Source.Microphone);
    return {
      p,
      identity: p.identity,
      name: p.name || 'Alguém',
      local: p === call.room.localParticipant,
      speaking: p.isSpeaking,
      muted: !mic || mic.isMuted,
      deafened: p.attributes && p.attributes.deafened === '1',
      camera: p.getTrackPublication(Track.Source.Camera),
      screen: p.getTrackPublication(Track.Source.ScreenShare)
    };
  });
}

function updateSpeaking() {
  if (!call.room) return;
  const speaking = new Set(call.room.activeSpeakers.map((p) => p.identity));
  document.querySelectorAll('[data-identity]').forEach((el) => {
    el.classList.toggle('speaking', speaking.has(el.dataset.identity));
  });
}

// ---------- Palco ----------
const videoEls = new Map();

function videoFor(key, track) {
  let v = videoEls.get(key);
  if (!v) {
    v = h('video', { autoplay: true, playsInline: true, muted: true });
    videoEls.set(key, v);
  }
  if (v._track !== track) {
    if (v._track) { try { v._track.detach(v); } catch (_) {} }
    track.attach(v);
    v._track = track;
  } else if (!v.isConnected) {
    // O quadro saiu da tela (você foi para outra sala) e está voltando: reconecta a faixa para o vídeo não ficar congelado
    try { track.attach(v); } catch (_) {}
  }
  return v;
}

function liveTrack(pub) {
  return pub && pub.track && !pub.isMuted ? pub.track : null;
}

function screenTile(item, big) {
  const key = `${item.identity}:screen`;
  const track = liveTrack(item.screen);
  const tile = h('div', { class: 'tile' + (big ? '' : ' clickable') },
    videoFor(key, track),
    h('div', { class: 'label' }, h('span', { class: 'live-badge' }, 'AO VIVO'), h('span', null, item.local ? 'Sua tela' : `Tela de ${item.name}`)));
  const fs = h('button', { class: 'fs', 'aria-label': 'Tela cheia', title: 'Tela cheia', html: ICON.full });
  fs.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
    else tile.requestFullscreen && tile.requestFullscreen();
  });
  tile.append(fs);
  if (!big) tile.addEventListener('click', () => { call.focusKey = key; renderStage(); });
  return tile;
}

function personTile(item) {
  const cam = liveTrack(item.camera);
  const tile = h('div', { class: 'tile' + (cam ? ' cam' : ''), 'data-identity': item.identity });
  if (item.speaking) tile.classList.add('speaking');
  if (cam) tile.append(videoFor(`${item.identity}:cam`, cam));
  // Espelha só a sua própria imagem, como um espelho; os outros continuam vendo normal.
  if (cam) {
    if (item.local && loadSettings().mirrorCam) tile.classList.add('mirror');
  } else tile.append(avatar(item.identity, item.name, 'lg', call.avatarUrl ? call.avatarUrl(item.identity) : null));
  tile.append(h('div', { class: 'label' },
    item.muted ? h('span', { html: ICON.smallMicOff, style: { display: 'inline-flex' } }) : null,
    h('span', null, item.name + (item.local ? ' (você)' : ''))));
  if (!item.local && call.onPersonClick) {
    tile.classList.add('clickable');
    tile.addEventListener('click', () => call.onPersonClick(tile, item.identity));
  }
  return tile;
}

const MAX_PINS = 4;
const PIN_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/></svg>';
const LAYOUTS = [
  ['spotlight', 'Destaque', '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="20" height="12" rx="2.5"/><rect x="2" y="17.5" width="20" height="3" rx="1.5" opacity=".55"/></svg>'],
  ['side', 'Lado a lado', '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="2" y="4" width="9.5" height="16" rx="2.5"/><rect x="12.5" y="4" width="9.5" height="16" rx="2.5"/></svg>'],
  ['float', 'Câmera flutuante', '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2.5" opacity=".55"/><rect x="12" y="12" width="9" height="7" rx="2"/></svg>']
];
const CORNERS = ['br', 'bl', 'tl', 'tr'];

// Troca o layout com uma transição suave. Os vídeos são os mesmos elementos, não recarregam.
function morph(fn) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) { fn(); return; }
  try { document.startViewTransition(fn); } catch (_) { fn(); }
}

export function togglePin(key) {
  morph(() => {
    if (call.pinned.includes(key)) call.pinned = call.pinned.filter((k) => k !== key);
    else call.pinned = [...call.pinned, key].slice(-MAX_PINS); // o quinto solta o mais antigo
    renderStage();
  });
}
export function setLayout(layout) {
  if (call.layout === layout) return;
  morph(() => { call.layout = layout; renderStage(); });
}

function pinButton(key) {
  const on = call.pinned.includes(key);
  const b = h('button', { class: 'pin' + (on ? ' on' : ''), 'aria-pressed': String(on), title: on ? 'Desafixar' : 'Fixar', 'aria-label': on ? 'Desafixar este quadro' : 'Fixar este quadro', html: PIN_ICON + `<span>${on ? 'Fixado' : 'Fixar'}</span>` });
  b.addEventListener('click', (e) => { e.stopPropagation(); togglePin(key); });
  return b;
}
function named(tile, key) {
  tile.style.viewTransitionName = 'q-' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return tile;
}
function withPin(tile, key) {
  tile.append(pinButton(key));
  return named(tile, key);
}
function watchTile() {
  // O vídeo em si é um quadro solto (music.js) que se encaixa por cima deste espaço
  return h('div', { class: 'tile watch-slot' }, h('div', { class: 'label' }, h('span', { class: 'live-badge' }, 'JUNTOS'), h('span', null, 'Assistindo junto')));
}
function frameTile(f) {
  if (f.kind === 'watch') return withPin(watchTile(), f.key);
  return withPin(f.kind === 'screen' ? screenTile(f.item, true) : personTile(f.item), f.key);
}

function renderLayoutBar() {
  let bar = $('layout-bar');
  if (!bar) {
    bar = h('div', { class: 'layout-bar', id: 'layout-bar', role: 'radiogroup', 'aria-label': 'Layout da call' });
    $('stage').before(bar);
  }
  bar.hidden = !call.room;
  const n = call.pinned.length;
  bar.replaceChildren(
    h('span', { class: 'layout-hint' }, n ? `${n} fixado${n > 1 ? 's' : ''}` : 'Passe o mouse num quadro e fixe quem você quer no principal'),
    ...LAYOUTS.map(([id, label, icon]) => {
      const b = h('button', { class: 'layout-opt', role: 'radio', 'aria-checked': String(call.layout === id), title: label }, h('span', { html: icon }), h('b', null, label));
      b.addEventListener('click', () => setLayout(id));
      return b;
    }));
}

function floatControls() {
  const mk = (label, text, fn) => {
    const b = h('button', { type: 'button', 'aria-label': label, title: label }, text);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  return h('div', { class: 'float-controls' },
    mk('Mudar de canto', 'Canto', () => { call.floatCorner = CORNERS[(CORNERS.indexOf(call.floatCorner) + 1) % CORNERS.length]; renderStage(); }),
    mk('Diminuir', '−', () => { call.floatSize = Math.max(1, call.floatSize - 1); renderStage(); }),
    mk('Aumentar', '+', () => { call.floatSize = Math.min(3, call.floatSize + 1); renderStage(); }),
    mk('Trocar tela e câmera', 'Trocar', () => morph(() => { call.pinned = [call.pinned[1], call.pinned[0], ...call.pinned.slice(2)]; renderStage(); })));
}

function renderPinned(stage, frames, byKey, base) {
  const pins = call.pinned.map((k) => byKey.get(k));
  const others = frames.filter((f) => !call.pinned.includes(f.key));
  let strip = [];
  if (call.layout === 'side' && pins.length > 1) {
    stage.className = 'stage focus side-layout' + base;
    stage.append(h('div', { class: 'side-grid n' + pins.length }, ...pins.map(frameTile)));
    strip = others;
  } else {
    stage.className = 'stage focus' + base;
    const main = h('div', { class: 'focus-main' }, frameTile(pins[0]));
    if (call.layout === 'float' && pins.length > 1) {
      main.append(h('div', { class: `float-cam corner-${call.floatCorner} size-${call.floatSize}` }, frameTile(pins[1]), floatControls()));
      strip = [...pins.slice(2), ...others];
    } else strip = [...pins.slice(1), ...others];
    stage.append(main);
  }
  if (strip.length) stage.append(h('div', { class: 'focus-strip' }, ...strip.map(frameTile)));
}

export function renderStage() {
  const stage = $('stage');
  const first = !stage.firstChild;
  stage.innerHTML = '';
  const list = participants();
  if (!list.length) { const bar = $('layout-bar'); if (bar) bar.hidden = true; return; }
  const base = first ? '' : ' still';
  const screens = list.filter((x) => liveTrack(x.screen));
  // Até 4 câmeras em destaque; o resto aparece como avatar (economiza banda)
  let camCount = 0;
  for (const x of list) {
    if (liveTrack(x.camera)) {
      camCount += 1;
      if (camCount > 4 && !x.local) x.camera = null;
    }
  }
  const frames = [];
  if (call.watch) frames.push({ key: 'watch', kind: 'watch' });
  for (const x of screens) frames.push({ key: `${x.identity}:screen`, kind: 'screen', item: x });
  for (const x of list) frames.push({ key: `${x.identity}:cam`, kind: 'person', item: x });
  const byKey = new Map(frames.map((f) => [f.key, f]));
  call.pinned = call.pinned.filter((k) => byKey.has(k));
  renderLayoutBar();
  if (call.pinned.length) {
    renderPinned(stage, frames, byKey, base);
  } else if (!screens.length) {
    const people = frames.filter((f) => f.kind === 'person').length;
    stage.className = 'stage grid n' + Math.min(people, 5) + base;
    frames.filter((f) => f.kind === 'person').forEach((f) => stage.append(withPin(personTile(f.item), f.key)));
  } else {
    const keys = screens.map((x) => `${x.identity}:screen`);
    if (!keys.includes(call.focusKey)) call.focusKey = keys[0];
    const main = screens.find((x) => `${x.identity}:screen` === call.focusKey);
    stage.className = 'stage focus' + base;
    stage.append(h('div', { class: 'focus-main' }, withPin(screenTile(main, true), `${main.identity}:screen`)));
    const strip = h('div', { class: 'focus-strip' });
    screens.filter((x) => x !== main).forEach((x) => strip.append(withPin(screenTile(x, false), `${x.identity}:screen`)));
    list.forEach((x) => strip.append(withPin(personTile(x), `${x.identity}:cam`)));
    stage.append(strip);
  }
  // Vídeo que voltou para a tela depois de sair dela fica pausado: retoma
  requestAnimationFrame(() => { for (const v of videoEls.values()) if (v.isConnected && v.paused) v.play().catch(() => {}); });
  // Remove vídeos que não estão mais na tela
  for (const [key, v] of videoEls) {
    if (!v.isConnected) {
      if (v._track) { try { v._track.detach(v); } catch (_) {} }
      videoEls.delete(key);
    }
  }
}

// Cadeia do microfone: RNNoise (modo "Forte") e/ou voz zoada. Roda no navegador, antes de a voz sair para a call.
let chainFailed = false;
export async function applyMicChain() {
  if (!call.room) return false;
  const pub = call.room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = pub && pub.audioTrack;
  if (!track) return false;
  const noise = loadSettings().noiseMode === 'rnnoise' && !chainFailed;
  const voice = call.voiceEffect || 'normal';
  try {
    if (noise || voice !== 'normal') {
      const { makeMicProcessor } = await import('./mic.js');
      await track.setProcessor(makeMicProcessor({ noise, voice }));
    } else if (track.getProcessor && track.getProcessor()) {
      await track.stopProcessor();
    }
    return true;
  } catch (err) {
    console.error('microfone', err);
    if (noise) {
      // O filtro forte não carregou: cai para o do navegador para você não ficar sem filtro
      chainFailed = true;
      toast('Não consegui ligar o filtro de ruído forte. Usando o do navegador.', 4500);
      const cur = loadSettings(); cur.noiseMode = 'browser'; saveSettings(cur);
      await applyAudioFilters();
    } else toast('Não consegui aplicar a voz agora.');
    return false;
  }
}

export async function setVoiceEffect(kind) {
  call.voiceEffect = kind || 'normal';
  return applyMicChain();
}
