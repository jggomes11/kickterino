'use strict';
// Everything mutable in this factory belongs to one persistent account slot.
const { app, BrowserWindow, dialog, session, Notification, powerSaveBlocker, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { selectReportAccount } = require('./security/accounts');
const { migrateBonuses } = require('./security/bonuses');
function createAccountRuntime({ id, partition, dataDirectory, emit, onChanged, showMain, isSelected = () => true, isOpenAtLogin, getPartners }) {
const PARTITION = partition;
const KICK = 'https://kick.com';
const POLL_MS = 60 * 1000;
const PLAYER_CHECK_MS = 30 * 1000;

const configPath = () => path.join(dataDirectory, 'config.json');
const DEFAULT_CONFIG = {
  channels: [
    'yetz', 'biscoitao', 'surskity', 'tftoddy', 'techzz', 'clovaobengalalol', 'axt', 'yulla', 'faturetosl',
    'cogu', 'rodil', 'patopapao2', 'matta', 'luccatv', 'guaxilol1', 'dersin2k', 'mecmeno',
  ],
  farming: true,
  // Medido em 30/10/2026: a Kick só contou pontos em ~2 lives por vez (12 abertas renderam o
  // mesmo que 2). Mais vagas só gastam memória; o rodízio espalha os pontos entre os canais.
  maxWatchers: 2,
  lowQuality: true,
  rotation: true,
  bonusTarget: '', // 0 = automático (300, 500, 1.000); ou o custo do único bônus que a pessoa quer
  notifyBonus: true,
  notifyChat: true,  // menções ao seu nome e sorteios no chat
  sleepMode: false,  // "antes de dormir": só aparece para quem ligar
  favorites: [],
  purchases: [],     // bônus comprados: { t, cost, slug } (cronômetro e relatório)
  daily: {},         // pontos ganhos por dia: { 'AAAA-MM-DD': pts }
};
let config = structuredClone(DEFAULT_CONFIG);
let firstRun = false;

function loadConfig() {
  firstRun = !fs.existsSync(configPath());
  try { config = { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }; } catch {}
  // Canais oficiais novos de uma versão nova entram uma vez; os que a pessoa removeu não voltam.
  const seen = new Set(config.seenDefaults || config.channels);
  for (const slug of DEFAULT_CONFIG.channels) {
    if (!seen.has(slug) && !config.channels.includes(slug)) config.channels.push(slug);
  }
  config.seenDefaults = [...new Set([...seen, ...DEFAULT_CONFIG.channels])];
  // v2: instalações antigas vinham com 20 lives; passa para o padrão novo (2 + rodízio) uma vez.
  if ((config.configVersion || 1) < 2) {
    config.maxWatchers = DEFAULT_CONFIG.maxWatchers;
    config.rotation = true;
    config.configVersion = 2;
  }
  migrateBonuses(config);
  saveConfig();
}
function saveConfig() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

let mainWin = null;
let stopped = false;
const timers = require('./security/timers').createTimers({setTimeout,clearTimeout,setInterval,clearInterval});
const later=timers.after,repeat=timers.every,withTimeout=timers.withTimeout;
let apiWin = null;
let apiReady = null;
let loginStartedForAccount = null;
const watchers = new Map(); // slug -> BrowserWindow
const status = new Map();   // slug -> { live, viewers, chatroomId, title, points, watchedMs, watchingSince, error }

function send(channel, payload) { if (!stopped) emit(id, channel, payload); }
const updateTray = () => onChanged();
// Anúncios e rastreadores de terceiros: não fazem parte da live e só gastam memória/CPU.
const BLOCKED_HOSTS = [
  'googlesyndication.com', 'doubleclick.net', 'googletagmanager.com', 'google-analytics.com',
  'googleadservices.com', 'adservice.google.com', 'imasdk.googleapis.com', 'amazon-adsystem.com',
  'facebook.net', 'facebook.com/tr', 'quora.com', 'analytics.tiktok.com', 'criteo.com', 'criteo.net',
  'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'taboola.com', 'hotjar.com', 'clarity.ms',
];

// Lives ocultas não precisam de imagens nem fontes: ninguém está olhando para elas.
const watcherIds = new Set();
const HIDDEN_SKIP = new Set(['image', 'font']);

function isHiddenWatcher(webContents) {
  if (!webContents || !watcherIds.has(webContents.id)) return false;
  const win = BrowserWindow.fromWebContents(webContents);
  return !!win && !userOpened.has(win);
}

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

let sessionSetup=false;
function setupSession() {
  if(sessionSetup)return;sessionSetup=true;
  const ses = session.fromPartition(PARTITION);
  ses.setSpellCheckerEnabled(false);
  ses.cookies.on('changed', (_event, cookie) => {
    if (!stopped && !suspended && ['session_token', 'XSRF-TOKEN'].includes(cookie.name)) {
      invalidateSession(true);
      later(() => { if (!suspended) poll(); }, 250);
    }
  });
  // Câmera, microfone, localização e afins: nenhuma página precisa disso aqui.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const url = details.url;
    cb({
      cancel: BLOCKED_HOSTS.some((h) => url.includes(h)) || url.startsWith('https://static.kick.com/ads/')
        || (HIDDEN_SKIP.has(details.resourceType) && isHiddenWatcher(details.webContents)),
    });
  });
}

// Mantém a menor variante real de vídeo; áudio e metadados permanecem associados.
function lowestQualityOnly(playlist) {
  const lines = playlist.split('\n');
  const keep = [];
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) { variants.push([lines[i], lines[i + 1]]); i++; } else keep.push(lines[i]);
  }
  const video = variants.filter(([inf]) => /RESOLUTION=/.test(inf) && !/audio_only/i.test(inf));
  if (video.length < 2) return null;
  const bandwidth = (l) => Number((l.match(/BANDWIDTH=(\d+)/) || [0, Infinity])[1]);
  video.sort((a, b) => bandwidth(a[0]) - bandwidth(b[0]));
  return [...keep.filter((l) => l.trim()), ...video[0]].join('\n') + '\n';
}


function releaseLoginWindow(win=apiWin) {
  if(!win)return;
  if(apiWin===win){apiWin=null;apiReady=null;loginStartedForAccount=null;}
  if(!win.isDestroyed())win.destroy();
}
function createApiWindow() {
  if(stopped || suspended)throw new Error('Session changed');
  if(apiWin && !apiWin.isDestroyed())return apiWin;
  const win=new BrowserWindow({
    width:1100,height:800,show:false,title:'Kick — login',autoHideMenuBar:true,
    icon:path.join(__dirname,'build','icon.png'),
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:PARTITION,backgroundThrottling:false},
  });
  apiWin=win;apiReady=null;
  loginStartedForAccount=loggedIn&&!sessionChecking?identity:null;
  win.webContents.setAudioMuted(true);
  win.webContents.on('render-process-gone',()=>releaseLoginWindow(win));
  win.on('closed',()=>{
    if(apiWin===win){apiWin=null;apiReady=null;loginStartedForAccount=null;}
    send('status');
    if(!stopped && !suspended)void poll();
  });
  send('status');
  return win;
}
function loadApi(url,win=apiWin) {
  if(stopped || suspended || !win || win.isDestroyed())return Promise.reject(new Error('Session changed'));
  if(apiReady)return apiReady;
  let onClosed;
  const closed=new Promise((_,reject)=>{onClosed=()=>reject(new Error('Session changed'));win.once('closed',onClosed);});
  const task=withTimeout(Promise.race([Promise.resolve().then(()=>win.loadURL(url)),closed]),45000)
    .catch(()=>{if(!stopped && !suspended && apiWin===win && !win.isDestroyed())throw new Error('Não foi possível abrir o login da Kick. Tente novamente.');})
    .finally(()=>{win.removeListener('closed',onClosed);if(apiReady===task)apiReady=null;});
  apiReady=task;
  return task;
}

// Loja de pontos: o chat popout oficial da Kick, que tem o saldo e as recompensas do canal.
const storeWindows = new Map();
function openStore(slug, title = `Pontos — ${slug}`) {
  if (!loggedIn || suspended) return;
  const epoch = sessionEpoch;
  let win = storeWindows.get(slug);
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 420, height: 720, title, autoHideMenuBar: true, backgroundColor: '#0b0e0f',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION },
  });
  win.loadURL(`${KICK}/popout/${slug}/chat`);
  win.on('page-title-updated', (e) => e.preventDefault()); // mantém o "(2 de 4)" do modo antes de dormir
  win.on('closed', () => {
    if (storeWindows.get(slug) === win) storeWindows.delete(slug);
    if (!sessionCurrent(epoch) || !loggedIn) return;
    refreshChannel(slug).then(() => send('status'));
    if (storeSequence && storeSequence.current === slug) openNextStore();
  });
  storeWindows.set(slug, win);
}

// Modo antes de dormir: abre as lojas uma de cada vez; a próxima abre quando a pessoa fecha a atual.
let storeSequence = null;
function openNextStore() {
  if (!loggedIn || suspended) { storeSequence = null; return; }
  const seq = storeSequence;
  const slug = seq && seq.queue.shift();
  if (!slug) { storeSequence = null; send('status'); return; }
  seq.current = slug;
  seq.done++;
  const name = (status.get(slug) || {}).displayName || slug;
  openStore(slug, `Pontos — ${name} (${seq.done} de ${seq.total})`);
  send('status');
}

// Application transport belongs exclusively to this account session.
const { createPlatformClient } = require('./security/platform');
const apiClient = createPlatformClient('kick', () => session.fromPartition(PARTITION));
let sessionEpoch = 0, suspended = false, identity = null, cookieFingerprint = null;
let sessionChecking = true;
function sessionCurrent(epoch) { return !stopped && !suspended && epoch === sessionEpoch; }
function invalidateSession(preservePlayers = false) {
  sessionEpoch++; apiClient.invalidate(); loggedIn = false; sessionChecking = true;
  storeSequence = null;
  syncKeepAwake();
  stopLimitTest();
  if (!preservePlayers) for (const slug of [...watchers.keys()]) stopWatcher(slug);
  for (const win of [...storeWindows.values()]) if (!win.isDestroyed()) win.destroy();
}
function resetBalances() { status.clear(); }
async function readSessionFingerprint() {
  const cookies = await session.fromPartition(PARTITION).cookies.get({url: KICK});
  const relevant = cookies.filter(c => ['session_token', 'XSRF-TOKEN'].includes(c.name));
  const { createHash } = require('node:crypto');
  return createHash('sha256').update(JSON.stringify(relevant.map(c => [c.name,c.value]).sort())).digest('hex');
}
async function kickFetch(apiPath, options) {
  const epoch = sessionEpoch;
  const result = await apiClient.request(apiPath, options);
  if (!sessionCurrent(epoch)) throw new Error('Session changed');
  return result;
}
async function verifyIdentity() {
  for (const path of ['/api/v1/user', '/api/v2/user']) {
    const {status: code, json} = await kickFetch(path);
    if (code === 401 || code === 403) continue;
    const user = json && (json.user || json.data?.user || json.data || json);
    const id = user?.id;
    if (code === 200 && ((typeof id === 'number' && Number.isSafeInteger(id) && id > 0) || (typeof id === 'string' && /^[1-9][0-9]{0,19}$/.test(id)))
      && typeof user.username === 'string' && user.username.length <= 200 && user.username.trim()) {
      return { id: 'id:' + id, username: user.username };
    }
  }
  return null;
}

// Na janela de cada live: força 160p enquanto ela está oculta e lê o chat do websocket
// que a própria página da Kick abre (realtime.*.kick.com), repassando mensagens e resgates.
function instrumentWatcher(slug, win) {
  const epoch = sessionEpoch;
  const dbg = win.webContents.debugger;
  try { dbg.attach('1.3'); } catch { return; }
  const seen = new Set();
  dbg.on('message', async (_e, method, p) => {
    if (!loggedIn || sessionChecking || stopped || suspended || watchers.get(slug) !== win) return;
    if (method === 'Fetch.requestPaused') {
      const pass = () => dbg.sendCommand('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
      if (!config.lowQuality || win.isDestroyed() || userOpened.has(win)) return pass();
      try {
        const { body, base64Encoded } = await dbg.sendCommand('Fetch.getResponseBody', { requestId: p.requestId });
        const text = base64Encoded ? Buffer.from(body, 'base64').toString() : body;
        const low = text.includes('#EXT-X-STREAM-INF') ? lowestQualityOnly(text) : null;
        if (!low) return pass();
        await dbg.sendCommand('Fetch.fulfillRequest', {
          requestId: p.requestId, responseCode: p.responseStatusCode || 200,
          responseHeaders: p.responseHeaders, body: Buffer.from(low).toString('base64'),
        });
      } catch { pass(); }
      return;
    }
    if (method !== 'Network.webSocketFrameReceived') return;
    for (const line of p.response.payloadData.split('\n')) {
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }
      const pub = frame.push && frame.push.pub && frame.push.pub.data;
      if (!pub || typeof pub.data !== 'string') continue;
      let data;
      try { data = JSON.parse(pub.data); } catch { continue; }
      if (pub.event === 'App\\Events\\ChatMessageEvent') {
        if (seen.has(data.id)) continue;
        seen.add(data.id);
        if (seen.size > 2000) seen.clear();
        send('chat', { slug, kind: 'message', data });
      } else if (pub.event === 'RewardRedeemedEvent') {
        send('chat', { slug, kind: 'reward', data });
      }
    }
  });
  dbg.sendCommand('Network.enable').catch(() => {});
  dbg.sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*.m3u8*', requestStage: 'Response' }] }).catch(() => {});
}

// Lives que a pessoa abriu para ver (com imagem, som e qualidade normal).
const userOpened = new WeakSet();

// Janela "invisível": existe para o Windows (o vídeo é desenhado e anda de verdade, ao contrário
// de uma janela oculta, que o Chromium congela), mas é transparente, não recebe cliques e não
// aparece na barra de tarefas nem no Alt+Tab.
// No Linux a transparência não existe (a janela apareceria na tela) e o Chromium não congela
// janela oculta, então lá ela só fica escondida.
const isLinux = process.platform === 'linux';
function makeInvisible(win) {
  userOpened.delete(win);
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.setFocusable(false);
  win.setSize(480, 270);
  win.setPosition(0, 0);
  if (isLinux) win.hide();
  else win.showInactive();
}

function startWatcher(slug) {
  if (!loggedIn || suspended || watchers.has(slug)) return;
  const win = new BrowserWindow({
    width: 480, height: 270, x: 0, y: 0, show: false, title: `Kick — ${slug}`, autoHideMenuBar: true,
    type: 'toolbar', skipTaskbar: true, focusable: false, opacity: 0,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION, backgroundThrottling: false, spellcheck: false },
  });
  win.webContents.setAudioMuted(true);
  const wcId = win.webContents.id;
  watcherIds.add(wcId);
  win.on('closed', () => watcherIds.delete(wcId));
  instrumentWatcher(slug, win);
  win.loadURL(`${KICK}/${slug}`);
  makeInvisible(win);
  // Fechar a live aberta só a torna invisível de novo: volta para 160p, sem som e sem imagens.
  win.on('close', (e) => {
    if (app.isQuitting || watchers.get(slug) !== win) return;
    e.preventDefault();
    makeInvisible(win);
    win.webContents.setAudioMuted(true);
    win.webContents.reload();
  });
  win.on('closed', () => { if (watchers.get(slug) === win) watchers.delete(slug); });
  // Página que caiu ou não carregou: fecha, e a próxima rodada abre de novo (ou põe outra live).
  const drop = () => setImmediate(() => { if (watchers.get(slug) === win) stopWatcher(slug); });
  win.webContents.on('render-process-gone', drop);
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) drop();
  });
  watchers.set(slug, win);
  const s = status.get(slug) || {};
  s.watchingSince = Date.now();
  status.set(slug, s);
}

function stopWatcher(slug) {
  const win = watchers.get(slug);
  if (!win) return;
  watchers.delete(slug);
  const s = status.get(slug);
  if (s && s.watchingSince) { s.watchedMs = (s.watchedMs || 0) + (Date.now() - s.watchingSince); s.watchingSince = null; }
  if (!win.isDestroyed()) win.destroy();
}

// Avisa quando o saldo do canal alcança um bônus do PokeIdle. O saldo ao abrir o app é a
// referência: só o que for alcançado depois gera aviso.
const KINDS = [
  { kind: 'xp', name: '+15% XP', re: /\bXP\b/i, def: 300 },
  { kind: 'capture', name: '+15% Capture Boost', re: /capture/i, def: 500 },
  { kind: 'lure', name: '+15% Secret Lure', re: /secret\s*lure|\blure\b/i, def: 1000 },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k]));
// Specific boosts must win over the generic XP word in "Capture XP Boost".
const REWARD_KINDS = [KIND.capture, KIND.lure, KIND.xp];

function parseRewards(list) {
  const out = [];
  for (const r of list || []) {
    const title = String(r.title || '');
    if (!/15\s*%|pokeidle|b[oô]nus|\b(?:capture\s+(?:xp\s+)?|xp\s+)boost\b/i.test(title)) continue;
    const k = REWARD_KINDS.find((x) => x.re.test(title));
    if (!k) continue;
    const hours = Number((title.match(/\((\d+)\s*h\)/i) || [0, 1])[1]) || 1;
    if (!HOURS.includes(hours) || !Number.isSafeInteger(r.cost) || r.cost <= 0 || !['string','number'].includes(typeof r.id)) continue;
    out.push({ id: r.id, kind: k.kind, hours, cost: r.cost, title, available: r.is_enabled === true && r.is_paused === false });
  }
  return out;
}

// Preço de 1 h de cada bônus no canal (padrão do jogo se o canal não tiver a recompensa).
function costsOf(s) {
  const costs = {};
  for (const k of KINDS) {
    const r = (s.rewards || []).filter((x) => x.kind === k.kind && x.available).sort((a, b) => a.hours - b.hours)[0];
    costs[k.kind] = r ? Math.round(r.cost / r.hours) : k.def;
  }
  return costs;
}
const hasBonus = (s) => (s.rewards || []).some((r) => r.available);

const BONUS_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_PURCHASES_MS = 10 * DAY_MS;
let configDirty = false;

const liveNotifications = new Set(); // sem referência, o Windows perde o clique na notificação

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const epoch = sessionEpoch;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'build', 'icon.png') });
  liveNotifications.add(n);
  n.on('click', () => { liveNotifications.delete(n); if (onClick && sessionCurrent(epoch)) { showMain(); onClick(); } });
  n.on('close', () => liveNotifications.delete(n));
  n.show();
}

const HOURS = [1, 3, 5, 10];
function parseTarget(t = config.bonusTarget) {
  const m = /^(xp|capture|lure)(?::(\d+))?$/.exec(String(t || ''));
  return m ? { kind: m[1], hours: Number(m[2] || 1) } : null;
}
// Preço do pacote escolhido neste canal: o da loja dele; se o canal não tiver esse pacote,
// as horas pelo preço de 1 h (é o que a pessoa pagaria comprando de 1 em 1).
function targetCost(s, target = parseTarget()) {
  if (!target) return null;
  const r = (s.rewards || []).find((x) => x.kind === target.kind && x.hours === target.hours && x.available);
  return r ? r.cost : costsOf(s)[target.kind] * target.hours;
}
// Pacotes que existem nas lojas dos canais da lista, com o preço mais comum de cada um.
function bonusOptions() {
  const out = [];
  for (const k of KINDS) for (const hours of HOURS) {
    const prices = {};
    let channels = 0;
    for (const st of status.values()) {
      const r = (st.rewards || []).find((x) => x.kind === k.kind && x.hours === hours && x.available);
      if (r) { channels++; prices[r.cost] = (prices[r.cost] || 0) + 1; }
    }
    const common = Object.entries(prices).sort((a, b) => b[1] - a[1])[0];
    out.push({ value: `${k.kind}:${hours}`, kind: k.kind, hours, cost: common ? Number(common[0]) : k.def * hours, channels, estimated: !common, varies: Object.keys(prices).length > 1 });
  }
  return out;
}
const targetName = (target) => `${KIND[target.kind].name}${target.hours > 1 ? ` (${target.hours} h)` : ''}`;

// Avisa quando o saldo alcança um bônus do canal (o saldo ao abrir o app é a referência).
// Com um pacote escolhido, avisa só quando dá para comprar esse pacote.
function checkBonus(slug, s) {
  const target = parseTarget();
  if (target) {
    const cost = targetCost(s, target);
    const n = Math.floor((s.points || 0) / cost);
    if (s.targetTier != null && n > s.targetTier && config.notifyBonus && hasBonus(s)) {
      notify(`${s.displayName || slug}: ${s.points} pontos`, `Já dá para resgatar ${targetName(target)} (${cost} pts). Clique para abrir a loja.`, () => openStore(slug));
    }
    s.targetTier = n;
    s.bonusTier = null;
    return;
  }
  s.targetTier = null;
  const costs = costsOf(s);
  const reach = KINDS.filter((k) => s.points >= costs[k.kind]);
  const tier = reach.length;
  if (s.bonusTier != null && tier > s.bonusTier && config.notifyBonus && hasBonus(s)) {
    const k = reach.sort((a, b) => costs[b.kind] - costs[a.kind])[0];
    notify(`${s.displayName || slug}: ${s.points} pontos`, `Já dá para resgatar ${k.name} (${costs[k.kind]} pts). Clique para abrir a loja.`, () => openStore(slug));
  }
  s.bonusTier = tier;
}

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function addDaily(n) {
  const k = dayKey(Date.now());
  config.daily[k] = (config.daily[k] || 0) + n;
  configDirty = true;
}

function matchPurchase(drop, rewards) {
  const list = rewards.filter((r) => r.available).sort((a, b) => a.hours - b.hours);
  let best = null;
  let signature = null;
  let ambiguous = false;
  const walk = (start, picked, sum) => {
    if (sum >= drop && sum <= drop + 25) {
      const key = picked.map((r) => `${r.kind}:${r.hours}`).sort().join(',');
      if (!best || picked.length < best.length) {
        best = picked;
        signature = key;
        ambiguous = false;
      } else if (picked.length === best.length && key !== signature) ambiguous = true;
      return;
    }
    if (picked.length >= 4 || sum > drop + 25) return;
    for (let i = start; i < list.length; i++) walk(i, [...picked, list[i]], sum + list[i].cost);
  };
  walk(0, [], 0);
  // A balance alone cannot distinguish equally plausible bonus packages.
  return ambiguous ? [] : best || [];
}

function registerPurchases(slug, s, drop) {
  const now = Date.now();
  matchPurchase(drop, s.rewards || []).forEach((r, i) => config.purchases.push({t:now+i,kind:r.kind,hours:r.hours,cost:r.cost,slug,source:'inferred'}));
  config.purchases=config.purchases.filter(p=>now-p.t<KEEP_PURCHASES_MS);
  configDirty=true;
}

// Fim de cada bônus, somando as horas na ordem das compras.
function bonusIntervals(purchases = config.purchases) {
  const byKind = {};
  for (const p of [...purchases].sort((a, b) => a.t - b.t)) {
    const list = byKind[p.kind] || (byKind[p.kind] = []);
    const last = list[list.length - 1];
    const dur = (p.hours || 1) * BONUS_MS;
    if (last && last.end >= p.t) last.end += dur;
    else list.push({ start: p.t, end: p.t + dur });
  }
  return byKind;
}

function activeBonuses(now = Date.now()) {
  const byKind = bonusIntervals();
  return KINDS.map((k) => {
    const cur = (byKind[k.kind] || []).find((i) => i.start <= now && i.end > now);
    return { kind: k.kind, name: k.name, endsAt: cur ? cur.end : null };
  });
}

const warnedEnds = new Set();
function checkBonusEnding() {
  const now = Date.now();
  for (const b of activeBonuses(now)) {
    if (!b.endsAt || b.endsAt - now > 5 * 60 * 1000 || warnedEnds.has(`${b.kind}:${b.endsAt}`)) continue;
    warnedEnds.add(`${b.kind}:${b.endsAt}`);
    if (!config.notifyBonus) continue;
    const rich = config.channels.map((slug) => [slug, status.get(slug) || {}])
      .filter(([, s]) => hasBonus(s) && (s.points || 0) >= costsOf(s)[b.kind]).sort((x, y) => y[1].points - x[1].points)[0];
    notify(`Seu ${b.name} acaba em ${Math.max(1, Math.round((b.endsAt - now) / 60000))} min`,
      rich ? `${rich[1].displayName || rich[0]} tem ${rich[1].points} pts. Clique para abrir a loja.` : 'Nenhum canal tem pontos para renovar agora.',
      () => (rich ? openStore(rich[0]) : showMain()));
  }
}

// Relatório dos últimos 7 dias.
const PERIODS = [['Madrugada', 0, 6], ['Dia', 6, 18], ['Noite', 18, 24]];
function weeklyReport(now = Date.now()) {
  const from = now - 7 * DAY_MS;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const t = now - i * DAY_MS, k = dayKey(t);
    const bought = config.purchases.filter((p) => dayKey(p.t) === k);
    days.push({ day: k, weekday: new Date(t).toLocaleDateString('pt-BR', { weekday: 'short' }), gained: config.daily[k] || 0,
      bought: KINDS.map((b) => bought.filter((p) => p.kind === b.kind).reduce((h, p) => h + (p.hours || 1), 0)) });
  }
  const all = Object.values(bonusIntervals()).flat();
  const isOn = (t) => all.some((i) => i.start <= t && i.end > t);
  const per = PERIODS.map(([name]) => ({ name, on: 0, total: 0 }));
  let on = 0, total = 0;
  for (let t = Math.ceil(from / 60000) * 60000; t < now; t += 60000) {
    const h = new Date(t).getHours();
    const p = per[PERIODS.findIndex(([, a, b]) => h >= a && h < b)];
    const active = isOn(t);
    p.total++; total++;
    if (active) { p.on++; on++; }
  }
  const timeline = [];
  for (let i = 47; i >= 0; i--) timeline.push(isOn(now - i * 30 * 60000 - 15 * 60000));
  const recent = config.purchases.filter((p) => p.t >= from);
  return {
    days, timeline, timelineStart: now - DAY_MS,
    gained: days.reduce((t, d) => t + d.gained, 0),
    bought: KINDS.map((b) => ({ name: b.name, kind: b.kind, count: recent.filter((p) => p.kind === b.kind).reduce((h, p) => h + (p.hours || 1), 0) })),
    bonusHours: Math.round(on / 60),
    coverage: total ? Math.round((on / total) * 100) : 0,
    periods: per.map((p) => ({ name: p.name, pct: p.total ? Math.round((p.on / p.total) * 100) : 0 })),
    channels: new Set(recent.map((p) => p.slug).filter(Boolean)).size,
  };
}

// Lista de parceiros no site: parceiro novo entra para todos sem precisar de versão nova.
// Quem a pessoa removeu não volta (mesma regra dos canais padrão).
async function syncPartners() {
  try {
    const list=await getPartners();
    if(stopped)return;
    const seen = new Set(config.seenDefaults || []);
    const fresh = list.filter((slug) => !seen.has(slug) && !config.channels.includes(slug));
    config.seenDefaults = [...new Set([...seen, ...list])];
    if (fresh.length) { config.channels.push(...fresh); poll(); }
    saveConfig();
  } catch {}
}

async function refreshChannel(slug) {
  const epoch = sessionEpoch;
  if (!loggedIn || suspended) return;
  const s = status.get(slug) || { watchedMs: 0 };
  try {
    const { status: code, json } = await kickFetch(`/api/v2/channels/${slug}`);
    if (!sessionCurrent(epoch) || !loggedIn || !config.channels.includes(slug)) return;
    if (code !== 200 || !json) throw new Error(`HTTP ${code}`);
    s.chatroomId = json.chatroom && json.chatroom.id;
    const wasLive = s.live;
    s.live = !!json.livestream;
    // Favorito que acabou de entrar ao vivo (no primeiro carregamento não avisa).
    if (wasLive === false && s.live && config.favorites.includes(slug)) {
      const name = (json.user && json.user.username) || slug;
      notify(`★ ${name} entrou ao vivo`, json.livestream.session_title || 'Clique para abrir o chat.', () => { showMain(); send('select', slug); });
    }
    s.viewers = json.livestream ? json.livestream.viewer_count : 0;
    s.title = json.livestream ? json.livestream.session_title : '';
    s.displayName = (json.user && json.user.username) || slug;
    s.error = null;
  } catch (e) {
    s.error = String(e.message || e);
  }
  // Se a conta segue o canal (só logado) — para conferir se seguir influencia nos pontos.
  try {
    const { status: code, json } = await kickFetch(`/api/v2/channels/${slug}/me`);
    if (!sessionCurrent(epoch) || !loggedIn || !config.channels.includes(slug)) return;
    if (code === 200 && json && typeof json.is_following === 'boolean') s.following = json.is_following;
    // Quem é sub ganha o dobro de pontos naquele canal (20 a cada 5 min).
    if (code === 200 && json && 'subscription' in json) s.subscribed = !!json.subscription;
  } catch {}
  try {
    const { status: code, json } = await kickFetch(`/api/v2/channels/${slug}/rewards?is_enabled=true`);
    if (!sessionCurrent(epoch) || !loggedIn || !config.channels.includes(slug)) return;
    if (code !== 200 || !Array.isArray(json?.data)) throw new Error('Catalog unavailable');
    s.rewards = parseRewards(json.data);
    s.catalog = {state:'known', observedAt:Date.now()};
  } catch {
    if (!sessionCurrent(epoch)) return;
    s.rewards=[]; s.catalog={state:'error',observedAt:Date.now()};
  }
  // Saldo de pontos — endpoint não documentado; se falhar, só mostramos "—".
  try {
    const { status: code, json } = await kickFetch(`/api/v2/channels/${slug}/points`);
    if (!sessionCurrent(epoch) || !loggedIn || !config.channels.includes(slug)) return;
    if (code === 200 && json) {
      const p = json.data ? json.data.points : json.points;
      if (typeof p === 'number' && Number.isFinite(p) && p >= 0) {
        // Ganho de assistir (gastos na loja fazem o saldo cair e não contam).
        if (s.points != null && p > s.points) {
          s.gainedTotal = (s.gainedTotal || 0) + (p - s.points);
          if (watchers.has(slug)) s.lastGainAt = Date.now();
          addDaily(p - s.points);
        }
        if (s.points != null && p < s.points) registerPurchases(slug, s, s.points - p);
        s.points = p;
        checkBonus(slug, s);
      }
    }
  } catch {}
  if (sessionCurrent(epoch) && loggedIn && config.channels.includes(slug)) status.set(slug, s);
}

// Confere cada live oculta: aviso +18 (só a pessoa pode confirmar) e estado do player, para o
// histórico. O tempo do vídeo NÃO indica se a live conta: no player da Kick ele fica em 0–1 s
// mesmo com os pontos subindo, então quem diz se está valendo é o saldo (ver lastGainAt).
async function checkPlayers() {
  const epoch = sessionEpoch;
  for (const [slug, win] of watchers) {
    const s = status.get(slug);
    if (!s || win.isDestroyed() || userOpened.has(win)) continue;
    const info = await withTimeout(win.webContents.executeJavaScript(`(() => {
      const v = document.querySelector('video');
      return {
        gate: !!document.querySelector('[data-testid="mature"]'),
        visibility: document.visibilityState,
        video: v ? { paused: v.paused, time: Math.round(v.currentTime), height: v.videoHeight, ready: v.readyState } : null,
      };
    })()`), PLAYER_CHECK_MS).catch((err) => {
      // Página congelada não responde nunca: fecha, e a próxima rodada abre de novo (ou põe outra live).
      if (sessionCurrent(epoch) && loggedIn && err.message === 'timeout' && watchers.get(slug) === win) stopWatcher(slug);
      return null;
    });
    if (!sessionCurrent(epoch) || watchers.get(slug) !== win) return;
    if (!info) continue;
    s.ageGate = info.gate;
    s.visibility = info.visibility;
    s.video = info.video;
  }
}

// "Ganhando": o saldo subiu nos últimos minutos enquanto a live tocava. A primeira contagem
// leva ~6–7 min depois que a live abre; depois, +10 a cada ~5–6 min.
const EARN_WINDOW_MS = 13 * 60 * 1000;
function earningState(slug, now) {
  const s = status.get(slug) || {};
  if (!watchers.has(slug)) return null;
  if (s.lastGainAt && now - s.lastGainAt < EARN_WINDOW_MS) return 'earning';
  if (now - (s.watchingSince || now) < EARN_WINDOW_MS) return 'warming';
  return 'idle';
}

// Histórico em points-log.jsonl (pasta de dados do app): uma linha por minuto com pontos e
// estado de cada live. Serve para conferir se os pontos sobem com o app minimizado.
function logHistory() {
  const now = Date.now();
  const channels = {};
  for (const slug of config.channels) {
    const s = status.get(slug) || {};
    if (!s.live && s.points == null) continue;
    channels[slug] = {
      live: !!s.live, watching: watchers.has(slug), points: s.points ?? null, following: s.following ?? null,
      subscribed: !!s.subscribed, earning: earningState(slug, now), video: s.video || null, visibility: s.visibility || null,
      gate: !!s.ageGate, watchedMin: Math.floor(totalWatched(slug, now) / 60000),
    };
  }
  const line = JSON.stringify({
    t: new Date(now).toISOString(), mainMinimized: !!mainWin && mainWin.isMinimized(),
    mainFocused: !!mainWin && mainWin.isFocused(), loggedIn,
    maxWatchers: config.maxWatchers, limitTest: limitTestSnapshot(), channels,
  });
  const file = path.join(dataDirectory, 'points-log.jsonl');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, line + '\n');
  } catch {}
}

// Foco em bônus: o saldo é separado por canal, então espalhar pontos atrasa as compras. As vagas
// vão para quem está mais perto do próximo bônus, e todos os canais ao vivo chegam a 300 antes
// de alguém buscar 500, depois 1.000 e cada milhar seguinte. Cada troca perde ~6–7 min até a primeira contagem, por isso só troca
// quando o canal bateu a meta ou quando a diferença compensa (SWITCH_MARGIN).
// Canal com sub rende o dobro: entra na frente de todos e fica enquanto estiver ao vivo, sem meta.
const SWITCH_MARGIN = 50;
const IDLE_COOLDOWN_MS = 30 * 60 * 1000;

function goalRank(s) {
  const p = s.points || 0;
  const costs = costsOf(s);
  if (parseTarget()) {
    const target = targetCost(s);
    const tier = Math.floor(p / target);
    const goal = (tier + 1) * target;
    return { tier, goal, left: goal - p };
  }
  const list = [...new Set(Object.values(costs))].sort((a, b) => a - b);
  const top = list[list.length - 1];
  if (p >= top) {
    const m = Math.floor(p / top);
    return { tier: list.length - 1 + m, goal: (m + 1) * top, left: (m + 1) * top - p };
  }
  const tier = list.filter((c) => p >= c).length;
  return { tier, goal: list[tier], left: list[tier] - p };
}

const compareGoal = (a, b) => {
  const ra = goalRank(a), rb = goalRank(b);
  return !!b.sub - !!a.sub || !!a.cooling - !!b.cooling || !a.bonus - !b.bonus || ra.tier - rb.tier || ra.left - rb.left;
};

function worthSwitching(candidate, current) {
  if (current.sub) return false;
  if (candidate.sub) return true;
  if (candidate.cooling) return false;
  if (candidate.bonus !== current.bonus) return candidate.bonus;
  const c = goalRank(candidate), w = goalRank(current);
  return c.tier < w.tier || (c.tier === w.tier && c.left + SWITCH_MARGIN < w.left);
}

const totalWatched = (slug, now) => {
  const s = status.get(slug) || {};
  return (s.watchedMs || 0) + (s.watchingSince ? now - s.watchingSince : 0);
};
const turnTime = (slug, now) => now - ((status.get(slug) || {}).watchingSince || now);
const isShown = (slug) => { const w = watchers.get(slug); return !!w && !w.isDestroyed() && userOpened.has(w); };

// Rodando direto, a página da Kick vai acumulando memória: renova a live de tempos em tempos.
const RECYCLE_MS = 6 * 60 * 60 * 1000;

function reconcileWatchers() {
  if (config.farming && sessionChecking) return;
  const now = Date.now();
  // Sem login a Kick não dá pontos: abrir live só gastaria memória.
  const canFarm = config.farming && loggedIn && !suspended;
  for (const slug of [...watchers.keys()]) {
    const s = status.get(slug);
    if (isShown(slug)) continue;
    if (!canFarm || !config.channels.includes(slug) || (s && s.live === false)) stopWatcher(slug);
  }
  if (!canFarm) return;

  // Vaga não pode ficar parada: com o limite de 2 lives, quem não rende cede o lugar.
  // Com mais vagas que isso, ficar sem ganhar é esperado, então não mexe.
  for (const slug of [...watchers.keys()]) {
    if (isShown(slug)) continue;
    const idle = !status.get(slug)?.subscribed && loggedIn && !limitTest && config.maxWatchers <= 2 && earningState(slug, now) === 'idle';
    const s = status.get(slug);
    if (idle && s) s.cooldownUntil = now + IDLE_COOLDOWN_MS; // senão voltaria na mesma hora
    if (idle || turnTime(slug, now) >= RECYCLE_MS) stopWatcher(slug);
  }

  // Limite reduzido: libera primeiro quem está há mais tempo na vez.
  const rotatable = () => [...watchers.keys()].filter((slug) => !isShown(slug))
    .sort((a, b) => turnTime(b, now) - turnTime(a, now));
  while (watchers.size > config.maxWatchers && rotatable().length) stopWatcher(rotatable()[0]);

  // Sem foco, as vagas seguem a ordem da lista de canais e ninguém troca de lugar.
  const focusInfo = (slug) => {
    const s = status.get(slug) || {};
    const cooling = !s.subscribed && (s.cooldownUntil || 0) > now;
    return { ...s, cooling, bonus: hasBonus(s), sub: !!s.subscribed };
  };
  const byGoal = (a, b) => compareGoal(focusInfo(a), focusInfo(b));
  const waiting = config.channels.filter((slug) => !watchers.has(slug) && (status.get(slug) || {}).live);
  waiting.sort((a,b)=>Number(focusInfo(b).sub)-Number(focusInfo(a).sub) || (config.rotation?byGoal(a,b):0));
  while (watchers.size < config.maxWatchers && waiting.length) startWatcher(waiting.shift());

  for (const slug of rotatable().sort((a, b) => byGoal(b, a))) {
    if (!config.rotation && (!waiting.length || !focusInfo(waiting[0]).sub)) break;
    if (!waiting.length || !worthSwitching(focusInfo(waiting[0]), focusInfo(slug))) break;
    stopWatcher(slug);
    startWatcher(waiting.shift());
  }
}

// Teste de limite: descobre quantas lives a Kick conta ao mesmo tempo. Em cada etapa abre N
// lives (sem rodízio), ignora o aquecimento e mede quantos pontos entraram no resto da etapa.
// Uma live no ritmo cheio rende 10 pts a cada 5 min, então "lives contando" ≈ pts / (min × 2).
// A 1ª etapa abre TODAS as lives ao vivo: se todas contarem, acaba ali. Senão, testa só os
// números até um pouco acima do que contou, para achar o menor que rende o máximo.
const LIMIT_LADDER = [2, 3, 4, 6, 8, 10, 13, 16, 20];
const LIMIT_STEP_MS = (Number(process.env.KICKTERINO_LIMIT_STEP_MIN) || 20) * 60 * 1000;
const LIMIT_WARMUP_MS = (Number(process.env.KICKTERINO_LIMIT_WARMUP_MIN) || 8) * 60 * 1000;
let limitTest = null;

const sumGained = () => [...status.values()].reduce((t, s) => t + (s.gainedTotal || 0), 0);
const liveCount = () => config.channels.filter((slug) => (status.get(slug) || {}).live).length;

function startLimitTest() {
  const all = Math.max(2, liveCount());
  limitTest = {
    i: 0, steps: [all, ...LIMIT_LADDER.filter((n) => n < all)],
    stepStart: Date.now(), baseline: null, results: [],
    prev: { maxWatchers: config.maxWatchers, rotation: config.rotation },
  };
  config.maxWatchers = all;
  config.rotation = false;
}

function stopLimitTest() {
  if (!limitTest) return;
  config.maxWatchers = limitTest.prev.maxWatchers;
  config.rotation = limitTest.prev.rotation;
  limitTest = null;
  saveConfig();
}

function advanceLimitTest() {
  if (!limitTest) return;
  const now = Date.now();
  const elapsed = now - limitTest.stepStart;
  if (limitTest.baseline == null && elapsed >= LIMIT_WARMUP_MS) {
    limitTest.baseline = sumGained();
    limitTest.baselineAt = now;
  }
  if (elapsed < LIMIT_STEP_MS || limitTest.baseline == null) return;

  const minutes = (now - limitTest.baselineAt) / 60000;
  const pts = sumGained() - limitTest.baseline;
  const result = {
    lives: limitTest.steps[limitTest.i], playing: watchers.size, minutes: Math.round(minutes),
    pts, counting: Math.round((pts / (minutes * 2)) * 10) / 10,
  };
  limitTest.results.push(result);
  if (limitTest.i === 0) {
    // Todas contaram (≥ 85%)? Então não há limite para achar. Senão, só testa até um pouco
    // acima do que contou.
    const cap = result.counting >= result.playing * 0.85 ? 0 : Math.ceil(result.counting) + 2;
    limitTest.steps = [limitTest.steps[0], ...limitTest.steps.slice(1).filter((n) => n <= Math.max(cap, 3) && cap > 0)];
  }
  limitTest.i++;
  if (limitTest.i < limitTest.steps.length) {
    Object.assign(limitTest, { stepStart: now, baseline: null });
    config.maxWatchers = limitTest.steps[limitTest.i];
    return;
  }
  // Fim: fica com o menor número de lives que rendeu pelo menos 90% do melhor resultado.
  const best = Math.max(...limitTest.results.map((r) => r.pts));
  const chosen = [...limitTest.results].sort((a, b) => a.lives - b.lives).find((r) => r.pts >= best * 0.9)
    || limitTest.results[0];
  config.limitResult = { at: new Date(now).toISOString(), results: limitTest.results, chosen: chosen.lives };
  config.maxWatchers = chosen.lives;
  config.rotation = true;
  limitTest = null;
  saveConfig();
}

function limitTestSnapshot() {
  if (!limitTest) return null;
  const elapsed = Date.now() - limitTest.stepStart;
  return {
    step: limitTest.i + 1, steps: limitTest.steps.length, lives: limitTest.steps[limitTest.i],
    warming: limitTest.baseline == null, leftMin: Math.max(0, Math.ceil((LIMIT_STEP_MS - elapsed) / 60000)),
    totalLeftMin: Math.ceil(((limitTest.steps.length - limitTest.i) * LIMIT_STEP_MS - elapsed) / 60000),
    results: limitTest.results,
  };
}

function summary() {
  return {id,username:loggedIn?username:null,loggedIn,sessionChecking,farming:config.farming,watching:watchers.size,today:loggedIn?config.daily[dayKey(Date.now())]||0:0};
}
function snapshot() {
  const now = Date.now();
  return {
    farming: config.farming,
    today: loggedIn ? config.daily[dayKey(now)] || 0 : 0,
    maxWatchers: config.maxWatchers,
    lowQuality: config.lowQuality,
    rotation: config.rotation,
    bonusTarget: config.bonusTarget,
    bonusOptions: bonusOptions(),
    limitTest: limitTestSnapshot(),
    limitResult: config.limitResult || null,
    openAtLogin: isOpenAtLogin(),
    platform: process.platform,
    notifyBonus: config.notifyBonus,
    notifyChat: config.notifyChat,
    sleepMode: config.sleepMode,
    favorites: config.favorites,
    username: loggedIn ? username : null,
    version: app.getVersion(),
    intro: config.lastSeenVersion === app.getVersion() ? null : (firstRun ? 'welcome' : 'news'),
    bonuses: loggedIn ? activeBonuses(now) : KINDS.map(k=>({kind:k.kind,name:k.name,endsAt:null})),
    purchases: !loggedIn ? [] : [...config.purchases].sort((a, b) => b.t - a.t).slice(0, 6),
    storeSequence: storeSequence ? { done: storeSequence.done, total: storeSequence.total } : null,
    channels: config.channels.map((slug) => {
      const s = status.get(slug) || {};
      const watchedMs = (s.watchedMs || 0) + (s.watchingSince ? now - s.watchingSince : 0);
      return {
        slug, displayName: s.displayName || slug, live: !!s.live, viewers: s.viewers || 0,
        title: s.title || '', chatroomId: loggedIn ? s.chatroomId || null : null, points: loggedIn ? s.points ?? null : null,
        watching: watchers.has(slug), ageGate: !!s.ageGate, earning: earningState(slug, now),
        following: loggedIn ? s.following ?? null : null, subscribed: loggedIn && !!s.subscribed,
        gained: loggedIn ? s.gainedTotal || 0 : 0,
        rewards: s.rewards || [], catalog: s.catalog || {state:'unknown',observedAt:null},
        rewardsLoaded: s.catalog?.state === 'known', hasBonus: hasBonus(s),
        costs: costsOf(s), targetCost: targetCost(s), targetEstimated: !((s.rewards||[]).some(r=>r.available && r.kind===parseTarget()?.kind && r.hours===parseTarget()?.hours)),
        goal: loggedIn && s.points != null ? goalRank(s).goal : null,
        goalLeft: loggedIn && s.points != null ? goalRank(s).left : null,
        watchedMin: Math.floor(watchedMs / 60000), error: s.error || null,
      };
    }),
    memoryMB: Math.round(app.getAppMetrics().reduce((t, m) => t + m.memory.workingSetSize, 0) / 1024),
    loggedIn, sessionChecking,
  };
}

// Uma rodada presa não pode parar o app: passado esse tempo, a seguinte começa mesmo assim.
const POLL_STUCK_MS = 90 * 1000;
let polling = false;
let activePoll = null;
let loggedIn = false;
// Nome da conta logada: o chat destaca quando alguém menciona você.
let username = null;
async function poll() {
  if (polling || suspended || stopped) return;
  polling = true;
  const cycle={};activePoll=cycle;
  const deadline=later(()=>{
    if(activePoll!==cycle)return;
    invalidateSession(true);activePoll=null;polling=false;
    void poll();
  },POLL_STUCK_MS);
  let epoch = sessionEpoch;
  try {
    const fingerprint = await readSessionFingerprint();
    if (!sessionCurrent(epoch)) return;
    if (cookieFingerprint !== fingerprint) {
      invalidateSession(true); cookieFingerprint = fingerprint; epoch = sessionEpoch;
    }
    const verified = await verifyIdentity();
    if (!sessionCurrent(epoch)) return;
    sessionChecking = false;
    if (!verified) {
      invalidateSession(); resetBalances(); identity=null;
      sessionChecking = false; username = null; return;
    }
    if (identity !== verified.id) {
      invalidateSession(); epoch = sessionEpoch;
      resetBalances(); selectReportAccount(config, verified.id); identity = verified.id; saveConfig();
    }
    loggedIn = true; sessionChecking = false; username = verified.username;
    if(apiWin && loginStartedForAccount!==verified.id)releaseLoginWindow();
    const queue=[...config.channels];
    const worker=async()=>{
      while(queue.length && sessionCurrent(epoch) && activePoll===cycle){
        await refreshChannel(queue.shift());
      }
    };
    await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));
    if(!sessionCurrent(epoch) || activePoll!==cycle)return;
    if (configDirty) { configDirty = false; saveConfig(); }
    advanceLimitTest(); reconcileWatchers();
    await checkPlayers();
    if (!sessionCurrent(epoch)) return;
    logHistory();
  } catch {
    if (sessionCurrent(epoch)) { invalidateSession(true); username = null; }
  } finally {
    timers.cancel(deadline);
    if(activePoll===cycle){activePoll=null;polling=false;syncKeepAwake();send('status');updateTray();}
  }
}

// ---------- Modo 24/7 ----------
// Impede o PC de suspender enquanto farma. O monitor pode apagar normalmente.
let awakeBlocker = null;
function syncKeepAwake() {
  const shouldStayAwake = config.farming && loggedIn && !suspended && !stopped;
  if (shouldStayAwake && awakeBlocker == null) awakeBlocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!shouldStayAwake && awakeBlocker != null) { powerSaveBlocker.stop(awakeBlocker); awakeBlocker = null; }
}

function setFarming(on) {
  config.farming = !!on;
  saveConfig();
  syncKeepAwake();
  reconcileWatchers();
  updateTray();
  send('status');
}

// Depois de suspender ou ficar sem rede, as lives abertas não voltam sozinhas: reabre tudo.
function recoverAfterResume() {
  for (const slug of [...watchers.keys()]) if (!isShown(slug)) stopWatcher(slug);
  later(poll, 15 * 1000);
}

// Updates are manual for this maintained fork.
const commands = new Map();
const handleIpc = (command, handler) => commands.set(command, handler);
handleIpc('state:get', () => snapshot());
handleIpc('channels:add', async (_e, slug) => {
  slug = String(slug || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?kick\.com\//, '').replace(/[^a-z0-9_-]/g, '');
  if (slug && !config.channels.includes(slug)) { config.channels.push(slug); saveConfig(); poll(); }
  return snapshot();
});
handleIpc('channels:remove', (_e, slug) => {
  config.channels = config.channels.filter((c) => c !== slug);
  stopWatcher(slug); status.delete(slug); saveConfig();
  return snapshot();
});
handleIpc('farming:set', (_e, on) => { setFarming(on); return snapshot(); });
handleIpc('notifyBonus:set', (_e, on) => { config.notifyBonus = !!on; saveConfig(); return snapshot(); });
handleIpc('notifyChat:set', (_e, on) => { config.notifyChat = !!on; saveConfig(); return snapshot(); });
handleIpc('sleepMode:set', (_e, on) => { config.sleepMode = !!on; saveConfig(); return snapshot(); });
handleIpc('favorite:toggle', (_e, slug) => {
  if (!config.channels.includes(slug)) return snapshot();
  config.favorites = config.favorites.includes(slug) ? config.favorites.filter((s) => s !== slug) : [...config.favorites, slug];
  saveConfig();
  return snapshot();
});
handleIpc('purchase:add', (_e, cost) => {
  const target = parseTarget(cost);
  if (target && HOURS.includes(target.hours)) { config.purchases.push({t:Date.now(),kind:target.kind,hours:target.hours,cost:KIND[target.kind].def*target.hours,slug:null,source:'manual'});saveConfig(); }
  updateTray();
  return snapshot();
});
handleIpc('purchase:remove', (_e, t) => { config.purchases = config.purchases.filter((p) => p.t !== t); saveConfig(); updateTray(); return snapshot(); });
handleIpc('stores:sequence', (_e, slugs) => {
  const queue = (Array.isArray(slugs) ? slugs : []).filter((s) => config.channels.includes(s));
  if (!queue.length) return snapshot();
  storeSequence = { queue, total: queue.length, done: 0, current: null };
  openNextStore();
  return snapshot();
});
handleIpc('stores:cancel', () => { if (storeSequence) storeSequence.queue = []; return snapshot(); });
handleIpc('report:get', () => weeklyReport());
// Salva o card do relatório como imagem (o recorte é a área do card na janela).
handleIpc('report:save', async (_e, rect) => {
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  const epoch = sessionEpoch;
  const image = await mainWin.webContents.capturePage(r);
  if (!sessionCurrent(epoch) || !isSelected(id)) return null;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Salvar resumo da semana',
    defaultPath: path.join(app.getPath('pictures'), `kickterino-semana-${dayKey(Date.now())}.png`),
    filters: [{ name: 'Imagem PNG', extensions: ['png'] }],
  });
  if (canceled || !filePath || !sessionCurrent(epoch) || !isSelected(id)) return null;
  fs.writeFileSync(filePath, image.toPNG());
  return filePath;
});
handleIpc('intro:done', () => { config.lastSeenVersion = app.getVersion(); firstRun = false; saveConfig(); return snapshot(); });
handleIpc('maxWatchers:set', (_e, n) => {
  limitTest = null; // mexer na mão cancela o teste de limite
  config.maxWatchers = Math.max(1, Math.min(30, Number(n) || 1)); saveConfig(); reconcileWatchers(); return snapshot();
});
handleIpc('rotation:set', (_e, on) => { limitTest = null; config.rotation = !!on; saveConfig(); reconcileWatchers(); return snapshot(); });
handleIpc('bonusTarget:set', (_e, cost) => {
  const target=parseTarget(cost);
  config.bonusTarget=target && HOURS.includes(target.hours) ? `${target.kind}:${target.hours}` : '';
  for(const st of status.values()){st.targetTier=null;st.bonusTier=null;}
  saveConfig();
  reconcileWatchers();
  return snapshot();
});
handleIpc('limitTest:start', () => {
  if (!loggedIn) return snapshot(); // sem login a Kick não dá pontos: o teste não mediria nada
  startLimitTest(); reconcileWatchers(); return snapshot(); });
handleIpc('limitTest:stop', () => { stopLimitTest(); reconcileWatchers(); return snapshot(); });
handleIpc('lowQuality:set', (_e, on) => {
  config.lowQuality = !!on; saveConfig();
  for (const win of watchers.values()) if (!win.isDestroyed() && !userOpened.has(win)) win.webContents.reload();
  return snapshot();
});
handleIpc('refresh', async () => { await poll(); return snapshot(); });
handleIpc('login:show', async () => {
  const win=createApiWindow();
  win.show(); win.focus();
  await loadApi(`${KICK}/login`,win);
});
// Sair da conta: apaga cookies, cache e tudo que as páginas guardaram, inclusive o login do
// Google, Apple ou Discord. A lista de canais e as preferências ficam.
handleIpc('logout', async () => {
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'question', buttons: ['Sair da conta', 'Cancelar'], defaultId: 1, cancelId: 1,
    title: 'Sair da conta', message: 'Sair da conta da Kick neste PC?',
    detail: 'Os dados de login salvos no app serão apagados. Para farmar de novo, será preciso entrar outra vez.',
  });
  if (response !== 0) return snapshot();
  suspended = true; invalidateSession(); apiClient.suspend(); username = null;
  for (const slug of [...watchers.keys()]) stopWatcher(slug);
  for (const win of storeWindows.values()) if (!win.isDestroyed()) win.close();
  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  ses.flushStorageData();
  status.clear();
  cookieFingerprint = null;
  releaseLoginWindow();
  suspended = false; apiClient.resume(); sessionChecking = false;
  return snapshot();
});
handleIpc('store:open', (_e, slug) => openStore(slug));
// Mostra a live de verdade, com imagem, som e qualidade normal (e o aviso +18, se houver, para a pessoa confirmar).
handleIpc('channel:show', (_e, slug) => {
  if (!loggedIn || suspended) return snapshot();
  let win = watchers.get(slug);
  if (!win) { startWatcher(slug); win = watchers.get(slug); }
  userOpened.add(win);
  win.webContents.setAudioMuted(false);
  win.setOpacity(1);
  win.setIgnoreMouseEvents(false);
  win.setFocusable(true);
  win.setSize(960, 600); win.center();
  win.show(); win.focus();
  win.webContents.reload();
  const s = status.get(slug);
  if (s) s.ageGate = false;
  send('status');
});
handleIpc('chat:send', async (_e, { chatroomId, content }) => {
  const { status: code, json } = await kickFetch(`/api/v2/messages/send/${chatroomId}`, {
    method: 'POST', body: { content, type: 'message' },
  });
  return { ok: code >= 200 && code < 300, status: code, message: json && (json.message || (json.status && json.status.message)) };
});


const runtime = {
  id, partition, snapshot, summary, poll, recoverAfterResume,
  resources:()=>[{role:'login',accountId:id,window:apiWin},...Array.from(watchers,([slug,window])=>({role:'player',accountId:id,window,manual:userOpened.has(window)})),...Array.from(storeWindows.values(),window=>({role:'store',accountId:id,window,manual:true}))],
  getIpcContext: () => ({ channels: config.channels, chatroomIds: [...status.values()].map(s => s.chatroomId).filter(Boolean), viewport: mainWin?.getContentSize() || [0,0] }),
  invoke(command, event, args) {
    const handler = commands.get(command);
    if (!handler) throw new Error('Invalid account command');
    return handler(event, ...args);
  },
  start(window) {
    if (stopped || mainWin) return;
    mainWin = window;
    loadConfig(); setupSession(); syncKeepAwake(); poll();
    repeat(poll, POLL_MS);
    repeat(() => { checkBonusEnding(); updateTray(); }, 30000);
    later(syncPartners, 30000);
    repeat(syncPartners, 6 * 60 * 60 * 1000);
  },
  stop() {
    if (stopped) return;
    stopped = true; suspended = true; invalidateSession(); apiClient.suspend();
    timers.stop();
    if (awakeBlocker != null) { powerSaveBlocker.stop(awakeBlocker); awakeBlocker = null; }
    if (apiWin && !apiWin.isDestroyed()) apiWin.destroy();
    for (const notification of liveNotifications) notification.close();
    liveNotifications.clear();
  },
};
return runtime;
}
module.exports = { createAccountRuntime };
