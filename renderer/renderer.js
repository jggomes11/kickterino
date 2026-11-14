// Kickterino — interface (abas estilo Chatterino). O chat chega do processo principal,
// que o lê das janelas da live (só canais ao vivo que estão sendo assistidos).
const MAX_MESSAGES = 400;

const $ = (sel) => document.querySelector(sel);
const accountView = AccountView.createAccountViewGuard();
// All awaited UI operations capture the current view, including reports and chat replies.
const api = Object.fromEntries(Object.entries(window.kick).map(([key, method]) => [key,
  typeof method !== 'function' || key.startsWith('on') || key === 'selectAccount' ? method
    : (...args) => accountView.run(() => method(...args)),
]));
const fmt = value => Number(value).toLocaleString('pt-BR');
let state = { channels: [], farming: true, maxWatchers: 2 };
let active = null;
const buffers = new Map();   // slug -> array de elementos .msg
const unread = new Set();
const accountCards = AccountCards.create({
  container: $('#accounts'),
  onSelect: selectAccount,
  onConnect: async id => { if (await selectAccount(id)) await api.showLogin(); },
  onDisconnect: async id => {
    await window.kick.logoutAccount(id);
    applyState(await api.getState());
  },
  onError: () => toast('Não foi possível alterar esta conta. Tente novamente.'),
});

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function timeStr(d = new Date()) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Converte "[emote:123:nome]" em imagens; o resto vira texto puro (sem innerHTML).
function appendContent(parent, content) {
  const re = /\[emote:(\d+):([^\]]*)\]/g;
  let last = 0, m;
  while ((m = re.exec(content))) {
    if (m.index > last) parent.append(content.slice(last, m.index));
    const img = el('img', 'emote');
    img.src = `https://files.kick.com/emotes/${m[1]}/fullsize`;
    img.alt = img.title = m[2];
    parent.append(img);
    last = re.lastIndex;
  }
  if (last < content.length) parent.append(content.slice(last));
}

// Menção ao seu nome e sorteios ganham destaque (e aviso, se a janela não estiver à vista).
const GIVEAWAY = /\b(sorteio|sorteando|giveaway|!sorteio|!giveaway|!sortear)\b/i;
function chatFlags(data) {
  const text = String(data.content || '');
  const me = state.username && state.username.toLowerCase();
  const mention = !!me && (data.sender && data.sender.username || '').toLowerCase() !== me
    && new RegExp(`(^|[^a-z0-9_])@?${me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`, 'i').test(text);
  return { mention, giveaway: GIVEAWAY.test(text) };
}

function renderChat(data, flags = {}) {
  const wrap = document.createDocumentFragment();
  const replyTo = data.metadata && data.metadata.original_sender;
  if (data.type === 'reply' && replyTo) {
    wrap.append(el('div', 'msg reply-to', `↪ respondendo @${replyTo.username}: ${(data.metadata.original_message || {}).content || ''}`));
  }
  const row = el('div', 'msg' + (flags.mention ? ' mention' : '') + (flags.giveaway ? ' giveaway' : ''));
  row.append(el('span', 'time', timeStr(new Date(data.created_at || Date.now()))));
  if (flags.giveaway) row.append(el('span', 'badge giveaway-tag', '🎉 SORTEIO'));
  const identity = (data.sender && data.sender.identity) || {};
  for (const b of identity.badges || []) row.append(el('span', `badge ${b.type}`, b.text || b.type));
  const user = el('span', 'user', data.sender ? data.sender.username : '?');
  user.style.color = identity.color || '#ccc';
  row.append(user, ': ');
  appendContent(row, data.content || '');
  wrap.append(row);
  return wrap;
}

function systemMessage(text) {
  const row = el('div', 'msg system');
  row.append(el('span', 'time', timeStr()), text);
  return row;
}

function pushMessage(slug, node) {
  const nodes = node instanceof DocumentFragment ? [...node.childNodes] : [node];
  const buf = buffers.get(slug) || [];
  buf.push(...nodes);
  while (buf.length > MAX_MESSAGES) { const old = buf.shift(); old.remove(); }
  buffers.set(slug, buf);
  if (slug === active) {
    const box = $('#messages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.append(...nodes);
    if (atBottom) box.scrollTop = box.scrollHeight;
  } else if (!unread.has(slug)) {
    unread.add(slug);
    renderTabs();
  }
}

// ---------- Canais na lateral ----------
let offlineOpen = false;
try { offlineOpen = localStorage.getItem('offlineOpen') === '1'; } catch {}
let railFilter = '';

function avatar(ch, size = '') {
  const av = el('div', `av ${size}`);
  const pct = ch.goal && ch.points != null ? Math.min(100, Math.round((ch.points / ch.goal) * 100)) : 0;
  av.style.setProperty('--p', `${pct}%`);
  if (ch.avatar) { const img = el('img'); img.src = ch.avatar; img.alt = ''; img.loading = 'lazy'; av.append(img); }
  else av.append(el('span', 'initial', ch.displayName.slice(0, 1).toUpperCase()));
  if (ch.subscribed) { const c = el('span', 'crown', '👑'); c.title = 'Você é sub'; av.append(c); }
  if (ch.live) av.append(el('span', 'live-dot'));
  return av;
}

function pendingPlaybackLabel() {
  if (state.sessionChecking) return 'VERIFICANDO SESSÃO';
  if (!state.loggedIn) return 'ENTRAR';
  return state.rotation ? 'NA FILA' : 'SEM VAGA';
}

function channelCard(ch) {
  const favs = new Set(state.favorites || []);
  const queued = ch.live && !ch.watching;
  const card = el('div', 'ch' + (ch.live ? ' live' : '') + (ch.watching ? ' watching' : '') + (queued ? ' queued' : '')
    + (ch.slug === active ? ' active' : '') + (ch.subscribed ? ' is-sub' : '') + (ch.earning === 'earning' ? ' earning' : ''));
  const info = el('div', 'ch-info');
  const name = el('div', 'ch-name');
  if (favs.has(ch.slug)) name.append(el('span', 'fav-star', '★'));
  name.append(el('span', 'ch-label', ch.displayName));
  if (unread.has(ch.slug) && ch.slug !== active) name.append(el('span', 'unread-dot'));
  const sub = el('div', 'ch-sub');
  if (ch.ageGate) sub.append(el('span', 'warn', '⚠ confirmar idade'));
  else if (ch.earning === 'earning') sub.append(el('span', 'earn', '● ganhando'));
  else if (ch.earning === 'warming') sub.append(el('span', 'warm', '◌ aquecendo'));
  else if (ch.earning === 'idle') sub.append(el('span', 'idle', '○ sem pontos'));
  else if (ch.live) sub.append(el('span', 'viewers', `${fmt(ch.viewers)} assistindo${queued ? ' · ' + pendingPlaybackLabel().toLowerCase() : ''}`));
  else sub.append(el('span', 'off', 'offline'));
  info.append(name, sub);
  const side = el('div', 'ch-side');
  if (ch.points != null) side.append(el('span', 'ch-pts', fmt(ch.points)));
  card.append(avatar(ch), info, side);
  const goalLine = ch.goalLeft != null ? `\nFaltam ${fmt(ch.goalLeft)} pts para ${fmt(ch.goal)}` : '';
  card.title = (ch.live ? `AO VIVO · ${fmt(ch.viewers)} espectadores\n${ch.title}` : 'offline') + goalLine
    + (ch.subscribed ? `\nSub: pontos ×${'2'}` : '');
  card.dataset.slug = ch.slug;
  card.onclick = () => select(ch.slug);
  return card;
}

function renderTabs() {
  const nav = $('#tabs');
  nav.replaceChildren();
  const favs = new Set(state.favorites || []);
  const q = railFilter.trim().toLowerCase();
  const list = state.channels.filter((c) => !q || c.displayName.toLowerCase().includes(q) || c.slug.includes(q));
  const byLive = (a, b) => (b.live - a.live) || (b.watching - a.watching) || (b.viewers - a.viewers);
  const pinned = list.filter((c) => favs.has(c.slug) || c.subscribed).sort(byLive);
  const rest = list.filter((c) => !pinned.includes(c));
  const live = rest.filter((c) => c.live).sort(byLive);
  const off = rest.filter((c) => !c.live);
  const group = (title, items, extra) => {
    if (!items.length) return;
    const h = el('div', 'group', title);
    if (extra) h.append(extra);
    nav.append(h, ...items.map(channelCard));
  };
  group('📌 Fixados', pinned);
  group(`🔴 Ao vivo · ${live.length}`, live);
  if (off.length) {
    const h = el('button', 'group toggle-off', `Offline · ${off.length} ${offlineOpen || q ? '▴' : '▾'}`);
    h.onclick = () => { offlineOpen = !offlineOpen; try { localStorage.setItem('offlineOpen', offlineOpen ? '1' : '0'); } catch {} renderTabs(); };
    nav.append(h);
    if (offlineOpen || q) nav.append(...off.map(channelCard));
  }
  if (!list.length) nav.append(el('div', 'rail-empty', 'Nenhum canal com esse nome.'));
  const add = el('button', 'add-ch', '＋ Adicionar canal');
  add.onclick = () => {
    const input = el('input', 'add-input');
    input.placeholder = 'nome ou link do canal';
    add.replaceWith(input);
    input.focus();
    const done = async (commit) => {
      if (commit && input.value.trim()) { if (!applyState(await api.addChannel(input.value))) return; select(state.channels[state.channels.length - 1].slug); }
      renderTabs();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    input.onblur = () => done(false);
  };
  nav.append(add);
}
$('#rail-search').oninput = (e) => { railFilter = e.target.value; renderTabs(); };

function select(slug) {
  active = slug;
  unread.delete(slug);
  const box = $('#messages');
  box.replaceChildren(...(buffers.get(slug) || []));
  box.scrollTop = box.scrollHeight;
  renderTabs();
  renderHeader();
  $('#input').focus();
}

function renderPriceBar(ch) {
  const bar = $('#price-bar');
  bar.replaceChildren();
  if (!ch) return;
  if (ch.catalog?.state !== 'known') { bar.append(el('span', 'price-none', 'Preços estimados · catálogo indisponível')); return; }
    if (!ch.hasBonus) { bar.append(el('span', 'price-none', 'Bônus indisponíveis neste canal')); return; }
  bar.append(el('span', 'price-label', 'Preços aqui:'));
  // Pacote escolhido em "Bônus" aparece primeiro, com quanto falta neste canal.
  const [tk, th] = (state.bonusTarget || '').split(':');
  if (tk) {
    const hours = Number(th || 1);
    const chip = el('span', 'price-chip target' + (!ch.targetEstimated && ch.points != null && ch.points >= ch.targetCost ? ' ok' : ''));
    const left = ch.points != null ? Math.max(0, ch.targetCost - ch.points) : null;
    chip.append(el('b', null, `🎯 ${shortName(BONUS_NAMES[tk])}${hours > 1 ? ` ${hours}h` : ''}`), ` ${fmt(ch.targetCost)}`,
      ch.targetEstimated ? el('small', null, ' · estimativa') : left != null ? el('small', null, left ? ` · faltam ${fmt(left)}` : ' · já dá!') : '');
    chip.title = 'Pacote escolhido em Bônus';
    bar.append(chip);
  }
  for (const k of KINDS) {
    const list = ch.rewards.filter((r) => r.kind === k && r.available).sort((a, b) => a.hours - b.hours);
    if (!list.length) continue;
    const chip = el('span', 'price-chip' + (ch.points != null && ch.points >= list[0].cost ? ' ok' : ''));
    chip.append(el('b', null, `${shortName(BONUS_NAMES[k])}${list[0].hours > 1 ? ` ${list[0].hours}h` : ''}`), ` ${fmt(list[0].cost)}`);
    chip.title = list.map((r) => `${r.hours} h: ${fmt(r.cost)} pts`).join('\n');
    bar.append(chip);
  }
  if (ch.priceChange) { const w = el('span', 'price-changed', '⚠ preço mudou'); w.title = ch.priceChange; bar.append(w); }
}

function renderHeader() {
  const ch = state.channels.find((c) => c.slug === active);
  const title = $('#chat-title');
  title.replaceChildren();
  const fav = !!ch && (state.favorites || []).includes(ch.slug);
  $('#btn-fav').textContent = fav ? '★' : '☆';
  $('#btn-fav').classList.toggle('on', fav);
  renderPriceBar(ch);
  for (const button of $('#chat-actions').children) button.disabled = !ch;
  if (!ch) return;
  const info = el('div', 'hero-text');
  const line = el('div', 'hero-name');
  line.append(el('b', null, ch.displayName));
  if (ch.live) line.append(el('span', 'live-tag', 'AO VIVO'), el('span', 'hero-viewers', `👁 ${ch.viewers.toLocaleString('pt-BR')}`));
  else line.append(el('span', 'off-tag', 'offline'));
  if (ch.subscribed) line.append(subBadge());
  if (ch.following) {
    const follow = el('span', 'follow', '♥');
    follow.title = 'Você segue este canal';
    line.append(follow);
  }
  const subtitle = el('div', 'hero-title', ch.live ? ch.title : 'O chat continua aberto enquanto o canal está offline');
  subtitle.title = subtitle.textContent;
  info.append(line, subtitle);
  if (ch.ageGate) {
    const warn = el('button', 'age-gate', '⚠ Canal +18: clique para confirmar a idade');
    warn.title = 'A Kick pede confirmação de idade antes de tocar esta live. Sem isso, ela não conta pontos.';
    warn.onclick = () => api.showChannel(ch.slug);
    info.append(warn);
  }
  title.append(avatar(ch, 'big'), info);
  $('#input').placeholder = ch.chatroomId ? `Enviar mensagem em ${ch.displayName}…` : 'Carregando canal…';
  const pts = $('#points-val');
  const text = ch.points != null ? ch.points.toLocaleString('pt-BR') : '—';
  if (pts.textContent !== text) {
    if (pts.textContent !== '—' && ch.points != null) {
      const btn = $('#btn-points');
      btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
    }
    pts.textContent = text;
  }
}

// ---------- Teste de limite ----------
function resultLines(results) {
  return results.map((r) => `${r.lives} lives → +${r.pts} pts em ${r.minutes} min (≈ ${r.counting} lives contando)`);
}

function renderLimitTest() {
  const t = state.limitTest;
  const info = $('#limit-info');
  const btn = $('#btn-limit');
  info.replaceChildren();
  if (t) {
    btn.textContent = 'Cancelar teste';
    info.append(el('div', 'limit-now',
      `Etapa ${t.step}/${t.steps}: ${t.lives} lives · ${t.warming ? 'aquecendo' : 'medindo'} · ${t.leftMin} min nesta etapa (~${t.totalLeftMin} min no total)`));
    for (const line of resultLines(t.results)) info.append(el('div', null, line));
    return;
  }
  btn.textContent = state.limitResult ? 'Refazer teste de limite' : 'Descobrir limite de lives';
  btn.disabled = !state.loggedIn;
  btn.title = state.loggedIn ? 'Abre todas as lives ao vivo e mede quantas a Kick conta; se não forem todas, testa números menores (~20 min por etapa) e ajusta o app para o que rende mais pontos' : 'Faça login na Kick para testar';
  const r = state.limitResult;
  if (!r) return;
  info.append(el('div', 'limit-now', `Último teste (${new Date(r.at).toLocaleString('pt-BR')}): usando ${r.chosen} lives`));
  for (const line of resultLines(r.results)) info.append(el('div', null, line));
}

// Selo de sub: estrela + "SUB ×2" (o sub ganha pontos em dobro no canal).
function subBadge() {
  const b = el('span', 'sub-badge');
  b.title = 'Você é sub: pontos em dobro aqui. Com o foco ligado, este canal vem primeiro enquanto estiver ao vivo.';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  star.setAttribute('d', 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z');
  svg.append(star);
  b.append(svg, el('span', null, 'SUB'), el('i', null, '×2'));
  return b;
}

// ---------- Painel / status ----------
function renderPanel() {
  const rows = $('#panel-rows');
  rows.replaceChildren();
  let totalPts = 0, gained = 0, watching = 0, live = 0;
  const queued = state.channels.filter((c) => c.live && !c.watching).length;
  for (const ch of state.channels) {
    if (ch.points != null) totalPts += ch.points;
    if (ch.gained > 0) gained += ch.gained;
    if (ch.watching) watching++;
    if (ch.live) live++;
    const tr = el('tr');
    const st = ch.ageGate ? el('span', 'pill age', 'CONFIRMAR +18')
      : ch.earning === 'earning' ? el('span', 'pill watching', 'GANHANDO')
      : ch.earning === 'warming' ? el('span', 'pill warming', 'AQUECENDO')
      : ch.earning === 'idle' ? el('span', 'pill stalled', 'SEM PONTOS')
      : ch.live ? el('span', 'pill queue', state.rotation ? 'NA FILA' : 'SEM VAGA') : el('span', 'pill', 'offline');
    if (ch.earning === 'warming') st.title = 'A Kick dá a primeira contagem ~6–7 min depois que a live abre.';
    if (ch.earning === 'idle') st.title = 'Tocando há mais de 13 min sem o saldo subir. A Kick só conta ~2 lives por vez.';
    if (ch.live && ch.goalLeft != null && state.rotation) st.title = `${st.title || ''}\nFaltam ${ch.goalLeft} pts para ${ch.goal}`.trim();
    const tdStatus = el('td'); tdStatus.append(st);
    if (ch.error) tdStatus.title = ch.error;
    const tdPts = el('td', null, ch.points != null ? ch.points.toLocaleString('pt-BR') : '—');
    if (ch.gained > 0) tdPts.append(' ', el('span', 'gain', `+${ch.gained}`));
    const eta = etaText(ch);
    if (eta) { const e = el('div', 'eta', eta); e.title = 'Previsão pelo ritmo da Kick: 10 pts a cada 5 min (20 para subs)'; tdPts.append(e); }
    const tdName = el('td', null, ch.displayName);
    if (ch.following) { const f = el('span', 'follow', '♥'); f.title = 'Você segue este canal'; tdName.append(' ', f); }
    if (ch.subscribed) tdName.append(' ', subBadge());
    tr.append(tdName, tdStatus, tdPts, el('td', null, `${ch.watchedMin} min`));
    tr.style.cursor = 'pointer';
    tr.onclick = () => select(ch.slug);
    rows.append(tr);
  }
  renderLimitTest();
  renderBonusBox();
  $('#sleep-box').hidden = !state.sleepMode;
  const summary = $('#summary');
  summary.replaceChildren();
  const chip = (icon, value, label, cls = '') => {
    const item = el('span', 'stat ' + cls);
    item.append(el('i', null, icon), el('b', null, value), el('small', null, label));
    summary.append(item);
  };
  chip('🔴', String(live), 'ao vivo');
  if (state.loggedIn) {
    chip('▶', String(watching), queued ? `assistindo · ${queued} aguardando` : 'assistindo', watching ? 'on' : '');
    chip('💚', fmt(totalPts), 'pontos');
    chip('📈', `+${fmt(state.today || 0)}`, 'hoje', 'up');
  }
  summary.title = !state.loggedIn ? 'Entre com a Kick para juntar pontos' : `+${fmt(gained)} pontos nesta sessão`;

}

function renderAccounts() {
  const accounts = state.accounts || Array.from({length: 4}, (_, index) => ({id: `account-${index + 1}`, label: `Conta ${index + 1}`}));
  accountCards.render(accounts.map(account => ({ ...account,
    detail: `${account.watching} lives · +${fmt(account.today || 0)} pts hoje`,
  })), accountView.accountId);
}

async function selectAccount(id) {
  accountCards.closeMenu();
  const previous = accountView.accountId;
  if (id === previous) return true;
  const ticket = accountView.select(id);
  // Dismiss the old account's UI without issuing commands against the new account.
  $('#modal').hidden = true; modalKind = null; introShown = false;
  lastGiveawayAlert.clear();
  setSettings(false); railFilter = ''; $('#rail-search').value = '';
  buffers.clear(); unread.clear(); sleepPicked.clear(); active = null;
  $('#messages').replaceChildren(); $('#input').value = ''; $('#toasts').replaceChildren();
  state = { channels: [], accounts: state.accounts, farming: true, accountId: id };
  renderAccounts(); renderTabs(); renderHeader(); renderPanel();
  try {
    const next = await api.selectAccount(id);
    return accountView.isCurrent(ticket) && applyState(next);
  } catch {
    if (!accountView.isCurrent(ticket)) return false;
    accountView.select(previous);
    applyState(await api.selectAccount(previous));
    toast('Não foi possível trocar a conta. Tente novamente.');
    return false;
  }
}

function applyState(s) {
  if (s && s.accountId === state.accountId && Number.isSafeInteger(s.sessionRevision)
    && Number.isSafeInteger(state.sessionRevision) && s.sessionRevision < state.sessionRevision) return false;
  if (!accountView.accept(s)) return false;
  if (modalKind === 'report' && (!s.loggedIn || s.sessionChecking || s.sessionRevision !== state.sessionRevision)) closeModal();
  const prevLive = new Map(state.channels.map((c) => [c.slug, c.live]));
  celebrate(state, s);
  state = s;
  renderAccounts();
  for (const ch of state.channels) {
    const was = prevLive.get(ch.slug);
    if (was === false && ch.live) pushMessage(ch.slug, systemMessage(`${ch.displayName} entrou ao vivo.`));
    if (was === true && !ch.live) pushMessage(ch.slug, systemMessage(`${ch.displayName} está offline.`));
  }
  if (!active && state.channels.length) active = state.channels[0].slug;
  $('#low-quality').checked = state.lowQuality;
  $('#rotation').checked = state.rotation;
  renderTargetSelect();
  $('#autostart').checked = !!state.openAtLogin;
  // No Linux a bandeja pode não aparecer (GNOME sem extensão), então o Sair fica também na janela.
  if (state.platform === 'linux') {
    $('#autostart-label span').textContent = 'Iniciar com o sistema';
    $('#autostart-label').title = 'Abre sozinho, direto na bandeja, quando você entra no computador';
    $('#btn-quit').hidden = false;
  }
  $('#notify-bonus').checked = !!state.notifyBonus;
  $('#notify-chat').checked = !!state.notifyChat;
  $('#sleep-mode').checked = !!state.sleepMode;
  if (state.intro && !introShown) { introShown = true; showIntro(state.intro); }
  if (!$('#modal').hidden && modalKind === 'sleep') renderSleepList();
  $('#memory').textContent = state.memoryMB ? `${state.memoryMB} MB` : '';
  if (document.activeElement !== $('#max-watchers')) $('#max-watchers').value = state.maxWatchers;
  renderTabs();
  renderHeader();
  renderPanel();
  return true;
}

// ---------- Bônus ativos e previsão ----------
const clock = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`; };
const shortName = (name) => name.replace('+15% ', '');

// Previsão do próximo bônus no ritmo da Kick (10 pts a cada 5 min; sub ganha 20).
function etaText(ch) {
  if (!ch.watching || ch.earning === 'idle' || ch.goalLeft == null || ch.goalLeft <= 0) return '';
  const min = Math.ceil(ch.goalLeft / (ch.subscribed ? 4 : 2));
  return `⏱ ${clock(min * 60000)} → ${ch.goal.toLocaleString('pt-BR')}`;
}

let targetKey = '';
function renderTargetSelect() {
  const sel = $('#bonus-target');
  const opts = state.bonusOptions || [];
  const key = JSON.stringify(opts.map((o) => [o.value, o.cost, o.channels]));
  if (key !== targetKey && opts.length) {
    targetKey = key;
    const icons = { xp: '⚡', capture: '🎯', lure: '✨' };
    sel.replaceChildren(el('option', null, 'Bônus automático'));
    sel.firstChild.value = '';
    for (const k of KINDS) {
      const group = document.createElement('optgroup');
      group.label = `${icons[k]} ${BONUS_NAMES[k]}`;
      for (const o of opts.filter((x) => x.kind === k)) {
        const opt = el('option', null, `${shortName(BONUS_NAMES[k])} · ${o.hours} h — ${o.varies ? '~' : ''}${fmt(o.cost)} pts`);
        opt.value = o.value;
        if (o.estimated) opt.textContent += ' (estimativa)';
        group.append(opt);
      }
      sel.append(group);
    }
  }
  const value = state.bonusTarget && !state.bonusTarget.includes(':') ? `${state.bonusTarget}:1` : (state.bonusTarget || '');
  sel.value = value;
  sel.disabled = !state.rotation;
  const t = opts.find((o) => o.value === value);
  sel.title = t ? `Juntando pontos em cada canal até ${fmt(t.cost)} para comprar ${BONUS_NAMES[t.kind]} de ${t.hours} h de uma vez.`
    : 'Automático: todos os canais chegam ao XP, depois Capture Boost e Secret Lure. Ou escolha um pacote (tipo + horas) para juntar até o preço dele.';
}


function renderBonusBox() {
  const box = $('#bonus-box');
  box.replaceChildren();
  const now = Date.now();
  for (const b of state.bonuses || []) {
    const on = b.endsAt && b.endsAt > now;
    const chip = el('div', 'bonus-chip' + (on ? ' on' : ''));
    chip.append(el('span', 'bonus-name', shortName(b.name)), el('span', 'bonus-left', on ? clock(b.endsAt - now) : 'inativo'));
    const add = el('button', 'bonus-add', '+1h');
    add.title = `Registrar uma compra de ${b.name} feita fora do app (o app percebe sozinho as compras pelo saldo)`;
    add.onclick = async () => applyState(await api.addPurchase(`${b.kind}:1`));
    chip.append(add);
    box.append(chip);
  }
  const recent = state.purchases || [];
  if (recent.length) {
    const list = el('div', 'purchases');
    for (const p of recent) {
      const name = (BONUS_NAMES[p.kind] || `${p.cost} pts`);
      const ch = state.channels.find((c) => c.slug === p.slug);
      const row = el('div', 'purchase', `${shortName(name)} ${p.hours || 1}h (${p.source || "inferred"}) · ${ch ? ch.displayName : 'registrado à mão'} · ${timeStr(new Date(p.t))}`);
      const x = el('button', 'purchase-x', '✕');
      x.title = 'Não foi uma compra de bônus? Remove do cronômetro e do relatório';
      x.onclick = async () => applyState(await api.removePurchase(p.t));
      row.append(x);
      list.append(row);
    }
    box.append(list);
  }
}
const KINDS=['xp','capture','lure'];
const BONUS_NAMES = { xp: '+15% XP', capture: '+15% Capture Boost', lure: '+15% Secret Lure' };
setInterval(() => { if (!$('#panel').hidden) renderBonusBox(); }, 20 * 1000);

// ---------- Janela flutuante (relatório, antes de dormir, boas-vindas) ----------
let modalKind = null;
let introShown = false;
function openModal(kind, ...nodes) {
  modalKind = kind;
  $('#modal-card').replaceChildren(...nodes);
  $('#modal').hidden = false;
}
function closeModal() {
  if (modalKind === 'intro') api.introDone().then(applyState);
  modalKind = null;
  $('#modal').hidden = true;
  $('#modal-card').replaceChildren();
}
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
const button = (text, cls, onclick) => { const b = el('button', cls, text); b.onclick = onclick; return b; };

// Antes de dormir: canais com pontos para o bônus escolhido; as lojas abrem uma de cada vez.
const sleepPicked = new Set();
function renderSleepList() {
  // Com um pacote escolhido, conta pacotes (ex.: 2× XP 3 h); no automático, XP de 1 h.
  const [kind, h] = (state.bonusTarget || 'xp:1').split(':');
  const hours = Number(h || 1);
  const name = `${BONUS_NAMES[kind]}${hours > 1 ? ` (${hours} h)` : ''}`;
  const costOf = c => (c.rewards || []).find(r => r.available && r.kind === kind && r.hours === hours)?.cost;
  const rich = state.channels.filter(c => state.loggedIn && !state.sessionChecking && costOf(c) > 0
    && (c.points || 0) >= costOf(c)).sort((a,b) => b.points / costOf(b) - a.points / costOf(a));
  for (const s of [...sleepPicked]) if (!rich.some((c) => c.slug === s)) sleepPicked.delete(s);
  const wrap = el('div', 'sleep');
  wrap.append(el('h3', null, '🌙 Antes de dormir'));
  const seq = state.storeSequence;
  if (seq) {
    wrap.append(el('p', null, `Loja ${seq.done} de ${seq.total} aberta. Compre o bônus e feche a janela da loja: a próxima abre sozinha.`),
      button('Parar sequência', null, async () => applyState(await api.cancelStoreSequence())));
    return $('#modal-card').replaceChildren(wrap);
  }
  if (!rich.length) {
    wrap.append(el('p', null, `Nenhum canal tem pontos para ${name} agora.`), button('Fechar', null, closeModal));
    return $('#modal-card').replaceChildren(wrap);
  }
  const total = rich.reduce((t, c) => t + Math.floor(c.points / costOf(c)), 0);
  wrap.append(el('p', null, `Dá para comprar ${total}× ${name} (${total * hours} h de bônus), somando os canais. Escolha os canais e as lojas abrem uma de cada vez: você compra e fecha a janela, e a próxima aparece.`));
  const list = el('div', 'sleep-list');
  for (const c of rich) {
    const row = el('label', 'sleep-row');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = sleepPicked.has(c.slug);
    cb.onchange = () => { if (cb.checked) sleepPicked.add(c.slug); else sleepPicked.delete(c.slug); renderSleepList(); };
    row.append(cb, el('span', null, c.displayName), el('span', 'sleep-pts', `${fmt(c.points)} pts · ${fmt(costOf(c))} cada · ${Math.floor(c.points / costOf(c))}×`));
    list.append(row);
  }
  wrap.append(list);
  const go = button(`Abrir ${sleepPicked.size} loja${sleepPicked.size === 1 ? '' : 's'} em sequência`, 'primary', async () => {
    applyState(await api.openStoreSequence(state.channels.filter((c) => sleepPicked.has(c.slug)).map((c) => c.slug)));
  });
  go.disabled = !sleepPicked.size;
  const all = button('Marcar todos', null, () => { for (const c of rich) sleepPicked.add(c.slug); renderSleepList(); });
  const actions = el('div', 'modal-actions');
  actions.append(all, go, button('Fechar', null, closeModal));
  wrap.append(actions);
  $('#modal-card').replaceChildren(wrap);
}

// Relatório da semana, com opção de salvar o card como imagem para postar.
async function showReport() {
  if (!state.loggedIn || state.sessionChecking) return;
  const ticket = accountView.current(), revision = state.sessionRevision;
  const current = () => accountView.isCurrent(ticket) && state.loggedIn && !state.sessionChecking && state.sessionRevision === revision;
  const r = await api.getReport();
  if (!r || !current()) return;
  const card = el('div', 'report');
  const head = el('div', 'report-head');
  head.append(el('span', 'brand', 'K'), el('b', null, ' Kickterino · minha semana'), el('span', 'report-date', new Date().toLocaleDateString('pt-BR')));
  const big = el('div', 'report-big');
  const stat = (value, label) => { const d = el('div', 'report-stat'); d.append(el('b', null, value), el('span', null, label)); return d; };
  big.append(stat(r.gained.toLocaleString('pt-BR'), 'pontos ganhos'), stat(String(r.bought.reduce((t, b) => t + b.count, 0)), 'horas compradas'),
    stat(`${r.bonusHours} h`, 'com bônus ativo'), stat(`${r.coverage}%`, 'do tempo com bônus'));
  const days = el('div', 'report-days');
  const max = Math.max(1, ...r.days.map((d) => d.gained));
  for (const d of r.days) {
    const col = el('div', 'report-day');
    col.title = `${d.day}: ${d.gained} pts · ${d.bought.map((n, i) => `${n} h ${shortName(Object.values(BONUS_NAMES)[i])}`).join(', ')}`;
    const bar = el('i'); bar.style.height = `${Math.round((d.gained / max) * 100)}%`;
    const slot = el('div', 'report-bar'); slot.append(bar);
    col.append(el('small', null, d.gained ? d.gained.toLocaleString('pt-BR') : ''), slot, el('span', null, d.weekday.replace('.', '')));
    days.append(col);
  }
  const periods = el('div', 'report-periods');
  for (const p of r.periods) {
    const row = el('div', 'report-period');
    const track = el('div', 'track'); const fill = el('i'); fill.style.width = `${p.pct}%`; track.append(fill);
    row.append(el('span', null, p.name), track, el('b', null, `${p.pct}%`));
    periods.append(row);
  }
  const line = el('div', 'report-timeline');
  line.title = 'Últimas 24 horas: verde = algum bônus ativo';
  for (const on of r.timeline) line.append(el('i', on ? 'on' : ''));
  const bought = el('div', 'report-bought', r.bought.map((b) => `${b.count} h ${shortName(b.name)}`).join(' · ') + (r.channels ? ` · em ${r.channels} canais` : ''));
  card.append(head, big, el('h4', null, 'Pontos por dia'), days, el('h4', null, 'Bônus ativo por período'), periods,
    el('h4', null, 'Últimas 24 h'), line, bought);
  const actions = el('div', 'modal-actions');
  actions.append(button('💾 Salvar imagem', 'primary', async () => {
    if (!current()) return;
    const rect = card.getBoundingClientRect();
    const file = await api.saveReport({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    if (file && current()) actions.replaceChildren(el('span', 'saved', `Imagem salva em ${file}`), button('Fechar', null, closeModal));
  }), button('Fechar', null, closeModal));
  openModal('report', card, actions);
}

// Boas-vindas na primeira vez; depois de atualizar, o que há de novo.
function showIntro(kind) {
  const wrap = el('div', 'intro');
  if (kind === 'welcome') {
    wrap.append(el('h3', null, 'Bem-vindo ao Kickterino 👋'));
    const steps = [
      ['1. Faça login', 'Clique em Entrar com a Kick e entre com sua conta (e-mail, Google, Apple ou Discord).'],
      ['2. Escolha seu bônus', 'Em Bônus, deixe Automático ou escolha XP, Capture Boost ou Secret Lure.'],
      ['3. Acompanhe no painel', 'Em Bônus ▸ você vê o saldo de cada canal, a previsão do próximo bônus e quanto tempo falta no seu bônus ativo.'],
      ['4. Compre na loja', 'O ícone de pontos ao lado do chat abre a loja do canal. A compra é sempre feita por você.'],
    ];
    for (const [t, d] of steps) { const s = el('div', 'intro-step'); s.append(el('b', null, t), el('span', null, d)); wrap.append(s); }
  } else {
    wrap.append(el('h3', null, `Novidades da versão ${state.version} ✨`));
    const news = [
      'Canais na lateral, com busca e favoritos; chat no centro e bônus à direita.',
      'Opções de coleta, avisos e inicialização ficam na engrenagem de configurações.',
      'Até quatro contas independentes: as outras continuam coletando enquanto você troca a conta exibida.',
    ];
    const ul = el('ul');
    for (const n of news) ul.append(el('li', null, n));
    wrap.append(ul);
  }
  const actions = el('div', 'modal-actions');
  actions.append(button('Entendi', 'primary', closeModal));
  wrap.append(actions);
  openModal('intro', wrap);
}

// Aviso de menção ou sorteio quando a janela não está à vista (no máximo um por canal a cada 5 min para sorteio).
const lastGiveawayAlert = new Map();
function chatAlert(slug, data, flags) {
  if (!state.notifyChat) return;
  const ch = state.channels.find((c) => c.slug === slug);
  const name = ch ? ch.displayName : slug;
  if (document.hasFocus() && slug === active) return;
  if (flags.giveaway && !flags.mention) {
    if (Date.now() - (lastGiveawayAlert.get(slug) || 0) < 5 * 60 * 1000) return;
    lastGiveawayAlert.set(slug, Date.now());
  }
  const ownerAccountId = accountView.accountId;
  const accountName = state.username || ownerAccountId;
  const title = flags.mention ? `${data.sender.username} mencionou você em ${name}` : `🎉 Sorteio no chat de ${name}`;
  const n = new Notification(`${accountName} · ${title}`,
    { body: String(data.content || '').replace(/\[emote:[^:]+:([^\]]*)\]/g, '$1').slice(0, 140), icon: '../build/icon.png' });
  n.onclick = async () => {
    window.focus();
    const activation = selectAccount(ownerAccountId);
    const ticket = accountView.current();
    if (await activation && accountView.isCurrent(ticket) && state.channels.some(c => c.slug === slug)) select(slug);
  };
}

// ---------- Comemorações: aviso na tela e confete ----------
function toast(text, cls = '') {
  const t = el('div', `toast ${cls}`, text);
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 5000);
}

const CONFETTI_COLORS = ['#53fc18', '#ffcf4a', '#b65ad2', '#ffffff', '#4fc3ff'];
function confetti() {
  const c = $('#confetti');
  const ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 4, r: Math.random() * 6 + 3,
    rot: Math.random() * 6, vr: (Math.random() - .5) * .3, color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  }));
  const start = performance.now();
  const frame = (t) => {
    ctx.clearRect(0, 0, c.width, c.height);
    const life = (t - start) / 2200;
    for (const p of parts) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - life); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (life < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
  };
  requestAnimationFrame(frame);
}

// Canal que passou de um bônus (300, 500, 1.000 e cada milhar) ganha confete; compra nova ganha aviso.
const tierOf = (p) => (p >= 1000 ? 2 + Math.floor(p / 1000) : [300, 500].filter((c) => p >= c).length);
function celebrate(prev, next) {
  if (!prev.channels.length) return;
  const before = new Map(prev.channels.map((c) => [c.slug, c.points]));
  for (const ch of next.channels) {
    const was = before.get(ch.slug);
    if (was == null || ch.points == null || tierOf(ch.points) <= tierOf(was)) continue;
    const reached = [300, 500, 1000].filter((c) => was < c && ch.points >= c).pop() || Math.floor(ch.points / 1000) * 1000;
    toast(`🎉 ${ch.displayName} chegou a ${reached.toLocaleString('pt-BR')} pts! Já dá para comprar bônus.`, 'gold');
    confetti();
  }
  const lastBefore = (prev.purchases || [])[0];
  for (const p of next.purchases || []) {
    if (lastBefore && p.t <= lastBefore.t) break;
    if (!prev.purchases) break;
    const ch = next.channels.find((c) => c.slug === p.slug);
    toast(`⏱ +${p.hours || 1}h de ${BONUS_NAMES[p.kind] || 'bônus'}${ch ? ` (${ch.displayName})` : ''} no cronômetro`);
  }
}

// ---------- Eventos ----------
$('#btn-refresh').onclick = async () => applyState(await api.refresh());
$('#btn-limit').onclick = async () => applyState(await (state.limitTest ? api.stopLimitTest() : api.startLimitTest()));
$('#autostart').onchange = async (e) => applyState(await api.setAutostart(e.target.checked));
$('#btn-quit').onclick = () => api.quit();
$('#notify-chat').onchange = async (e) => applyState(await api.setNotifyChat(e.target.checked));
$('#sleep-mode').onchange = async (e) => applyState(await api.setSleepMode(e.target.checked));
$('#btn-sleep').onclick = () => { openModal('sleep'); renderSleepList(); };
$('#btn-report').onclick = showReport;
$('#btn-fav').onclick = async () => active && applyState(await api.toggleFavorite(active));
$('#notify-bonus').onchange = async (e) => applyState(await api.setNotifyBonus(e.target.checked));
$('#rotation').onchange = async (e) => applyState(await api.setRotation(e.target.checked));
$('#bonus-target').onchange = async (e) => applyState(await api.setBonusTarget(e.target.value));
$('#low-quality').onchange = async (e) => applyState(await api.setLowQuality(e.target.checked));
$('#max-watchers').onchange = async (e) => applyState(await api.setMaxWatchers(e.target.value));
const setPanel = (open) => {
  $('#panel').hidden = !open;
  $('#btn-panel').textContent = open ? 'Bônus ◂' : 'Bônus ▸';
  try { localStorage.setItem('panelOpen', open ? '1' : '0'); } catch {}
};
$('#btn-panel').onclick = () => setPanel($('#panel').hidden);
try { setPanel(localStorage.getItem('panelOpen') !== '0'); } catch { setPanel(true); }
const setSettings = open => {
  $('#settings').hidden = !open;
  $('#btn-settings').classList.toggle('on', open);
  $('#btn-settings').setAttribute('aria-expanded', String(open));
};
$('#btn-settings').onclick = e => { e.stopPropagation(); setSettings($('#settings').hidden); };
document.addEventListener('click', (e) => {
  if (!$('#settings').hidden && !e.target.closest('#settings')) { setSettings(false); }
});
// Atalhos: Ctrl+K busca canal; Alt+↑/↓ troca de canal.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setSettings(false);
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#rail-search').focus(); $('#rail-search').select(); }
  if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const cards = [...document.querySelectorAll('#tabs .ch')];
    const order = cards.map((c) => c.dataset.slug);
    const i = order.indexOf(active);
    const next = order[(i + (e.key === 'ArrowDown' ? 1 : -1) + order.length) % order.length];
    if (next) { e.preventDefault(); select(next); }
  }
});
$('#btn-points').onclick = () => active && api.openStore(active);
$('#btn-show').onclick = () => active && api.showChannel(active);
$('#btn-remove').onclick = async () => {
  if (!active) return;
  const slug = active;
  buffers.delete(slug);
  active = null;
  if (!applyState(await api.removeChannel(slug))) return;
  if (state.channels.length) select(state.channels[0].slug); else $('#messages').replaceChildren();
};
$('#composer').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('#input');
  const ch = state.channels.find((c) => c.slug === active);
  const text = input.value.trim();
  if (!ch || !ch.chatroomId || !text) return;
  input.value = '';
  const res = await api.sendChat(ch.chatroomId, text);
  if (res && !res.ok) pushMessage(ch.slug, systemMessage(`Falha ao enviar (${res.status}${res.message ? ': ' + res.message : ''}). Você fez login?`));
};

api.onAccountSelect(selectAccount);
api.onStatus(applyState);
api.onSelect((slug, accountId) => { if (accountId === accountView.accountId) select(slug); });
api.onChat(({ slug, kind, data }, accountId) => {
  if (accountId !== accountView.accountId) return;
  if (kind === 'message') {
    const flags = chatFlags(data);
    pushMessage(slug, renderChat(data, flags));
    if (flags.mention || flags.giveaway) chatAlert(slug, data, flags);
  }
  else if (kind === 'reward') pushMessage(slug, systemMessage(`🎁 ${data.username} resgatou "${data.reward_title}"`));
});
api.getState().then((s) => { applyState(s); if (active) select(active); });
