import { classifyPlayer, lookupCoordinate, summarize, findPlanets, csvCell } from './core.js';

const $ = id => document.getElementById(id);
const state = { manifest: null, source: null, sourceNumber: 182, playerId: null,
  targets: new Set(), cache: new Map(), players: [], matches: [], highlight: -1,
  sourceRequest: 0, comparisonRequest: 0, result: null, busy: false };
const date = timestamp => new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
}).format(new Date(timestamp * 1000));

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function message(text, kind = '') { $('message').textContent = text; $('message').className = `message ${kind}`; }
function entries() { return state.manifest.universes; }
function selectedTargets() { return entries().filter(u => state.targets.has(u.number) && u.number !== state.sourceNumber); }
function updateButton() { $('check').disabled = state.busy || !state.playerId || !selectedTargets().length; }
function clearResult() {
  state.comparisonRequest++; state.result = null; state.busy = false;
  $('results').hidden = true; $('empty-state').hidden = false;
  $('check').textContent = 'Проверить координаты ↗';
}

async function loadUniverse(entry) {
  if (entry.state === 'unavailable') throw new Error(`${entry.name}: снимок недоступен`);
  if (!state.cache.has(entry.number)) {
    const query = Object.values(entry.timestamps).join('-');
    state.cache.set(entry.number, (async () => {
      const response = await fetch(`${entry.file}?v=${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.schemaVersion !== 1 || data.number !== entry.number || !data.players || !data.planets || !data.timestamps) throw new Error('Неверный формат снимка');
      if (Object.keys(entry.timestamps).some(key => data.timestamps[key] !== entry.timestamps[key])) throw new Error('Снимок обновляется. Перезагрузи страницу.');
      return data;
    })().catch(error => { state.cache.delete(entry.number); throw error; }));
  }
  return state.cache.get(entry.number);
}

function renderTargets() {
  $('targets').replaceChildren();
  for (const universe of entries()) {
    const label = el('label', undefined, 'target-chip');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = universe.number;
    checkbox.checked = state.targets.has(universe.number) && universe.number !== state.sourceNumber;
    checkbox.disabled = universe.number === state.sourceNumber;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.targets.add(universe.number); else state.targets.delete(universe.number);
      clearResult(); updateTargetsCount(); updateButton();
      message('Набор вселенных изменён. Нажми «Проверить координаты».');
    });
    label.append(checkbox, el('span', universe.name + (checkbox.disabled ? ' · своя' : '')));
    if (universe.state !== 'ok') label.title = universe.state === 'stale' ? 'Последнее обновление не удалось. Используется предыдущий снимок.' : 'Нет снимка API';
    $('targets').append(label);
  }
  updateTargetsCount();
}
function updateTargetsCount() { $('target-count').textContent = `· ${selectedTargets().length} вселенных`; }
function preset(name) {
  state.targets = new Set(entries().filter(u => name === 'all' || (name === 'classic' && u.number >= 103 && u.number <= 264)).map(u => u.number));
  clearResult(); renderTargets(); updateButton();
}

async function selectSource(number) {
  const request = ++state.sourceRequest;
  state.sourceNumber = number; state.source = null; state.playerId = null; state.players = [];
  clearResult(); closeOptions(); renderTargets(); updateButton();
  $('player-search').value = ''; $('player-search').disabled = true;
  $('selected-player').textContent = 'Загрузка игроков…';
  const entry = entries().find(u => u.number === number);
  message(`Загружаем ${entry.name}…`);
  try {
    const snapshot = await loadUniverse(entry);
    if (request !== state.sourceRequest) return false;
    state.source = snapshot;
    state.players = Object.entries(snapshot.players).map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru') || Number(a.id) - Number(b.id));
    $('player-search').disabled = false;
    $('selected-player').textContent = `${state.players.length.toLocaleString('ru-RU')} игроков в базе · карта ${date(snapshot.timestamps.universe)} UTC`;
    message(entry.state === 'stale' ? 'Обновление API не удалось. Используется предыдущий снимок.' : 'Введи ник, затем выбери игрока из списка.', entry.state === 'stale' ? 'warning' : '');
    return true;
  } catch (error) {
    if (request !== state.sourceRequest) return false;
    $('selected-player').textContent = 'Список игроков недоступен.';
    message(`Не удалось загрузить ${entry.name}. ${error.message}. Попробуй выбрать вселенную ещё раз.`, 'error');
    return false;
  }
}

function closeOptions() {
  $('player-options').hidden = true; $('player-search').setAttribute('aria-expanded', 'false');
  $('player-search').removeAttribute('aria-activedescendant'); state.highlight = -1;
}
function selectPlayer(id) {
  const player = state.source?.players[id]; if (!player) return;
  state.playerId = id; $('player-search').value = player.name; closeOptions(); clearResult();
  const planets = findPlanets(state.source, id);
  const label = $('selected-player'); label.replaceChildren(el('strong', player.name), document.createTextNode(` · ID ${id} · планет: ${planets.length} · ${classifyPlayer(player).label}`));
  updateButton();
  message(planets.length ? 'Игрок выбран. Можно проверить координаты.' : 'В снимке карты у этого игрока нет планет.', planets.length ? '' : 'warning');
}
function highlightMatch(index) {
  state.highlight = index;
  [...$('player-options').children].forEach((li, i) => li.setAttribute('aria-selected', String(i === index)));
  const item = $('player-options').children[index];
  if (item) { $('player-search').setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
}
function showOptions() {
  if (!state.source) return;
  const query = $('player-search').value.trim().toLocaleLowerCase('ru');
  const matches = state.players.filter(p => p.name.toLocaleLowerCase('ru').includes(query) || p.id === query);
  matches.sort((a, b) => Number(b.name.toLocaleLowerCase('ru') === query) - Number(a.name.toLocaleLowerCase('ru') === query));
  state.matches = matches.slice(0, 40); state.highlight = -1;
  $('player-options').replaceChildren();
  state.matches.forEach((p, i) => {
    const option = el('li'); option.id = `player-option-${i}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
    option.append(el('span', p.name), el('small', `#${p.id} · ${classifyPlayer(p).label}`));
    option.addEventListener('mousedown', event => event.preventDefault());
    option.addEventListener('click', () => selectPlayer(p.id));
    $('player-options').append(option);
  });
  if (!state.matches.length) { const li = el('li', 'Игрок не найден. Попробуй часть ника или ID.'); li.setAttribute('role', 'presentation'); $('player-options').append(li); }
  $('player-options').hidden = false; $('player-search').setAttribute('aria-expanded', 'true');
}

function renderSummary(summary) {
  const td = el('td', undefined, 'summary');
  if (!summary.occupied && !summary.unavailable) {
    td.append(el('span', summary.outside ? (summary.free ? 'Свободно в доступных' : 'Вне выбранных вселенных') : 'Пусто по API', 'summary-free'));
  } else if (!summary.occupied) td.append(el('span', 'Нет подтверждённой занятости', 'summary-total'));
  else {
    td.append(el('span', `Занято: ${summary.occupied}`, 'summary-total'));
    const counts = el('div', undefined, 'summary-counts');
    [['active', 'Активных'], ['inactive', 'Неактивных'], ['vacation', 'РО']].forEach(([key, label]) => counts.append(el('span', `${label}: ${summary[key]}`)));
    if (summary.unknown) counts.append(el('span', `Неизвестно: ${summary.unknown}`));
    if (summary.other) counts.append(el('span', `Другой статус: ${summary.other}`));
    td.append(counts);
  }
  if (summary.unavailable) td.append(el('span', `Нет данных: ${summary.unavailable}`, 'summary-warning'));
  if (summary.outside) td.append(el('span', `Вне вселенной: ${summary.outside}`, 'summary-warning'));
  return td;
}

function renderResults(result) {
  const { player, planets, targets, datasets, rows } = result;
  $('results-title').textContent = player.name;
  $('results-description').textContent = `${state.source.name} · планет: ${planets.length} · вселенных для сравнения: ${targets.length} · своя исключена`;
  const totals = summarize(rows.flatMap(r => r.cells));
  $('metrics').replaceChildren();
  for (const [number, text] of [[planets.length, 'координат'], [totals.free, 'свободных позиций'], [totals.occupied, 'занятых позиций'], [rows.filter(r => r.summary.free === targets.length).length, 'координат свободны везде']]) {
    const metric = el('div', undefined, 'metric'); metric.append(el('strong', String(number)), el('span', text)); $('metrics').append(metric);
  }
  const header = el('tr'); header.append(el('th', 'Координаты', 'coord'), el('th', 'Итого без своей', 'summary'));
  targets.forEach((universe, i) => {
    const th = el('th', universe.name, 'universe-col');
    th.append(el('small', datasets[i] ? `Карта ${date(datasets[i].timestamps.universe).split(',')[0]}` : 'Снимок недоступен'));
    th.title = datasets[i] ? `Карта: ${date(datasets[i].timestamps.universe)} UTC\nСтатусы: ${date(datasets[i].timestamps.players)} UTC` : 'Ошибка загрузки данных';
    header.append(th);
  });
  $('comparison').querySelector('thead').replaceChildren(header);
  const body = $('comparison').querySelector('tbody'); body.replaceChildren();
  for (const row of rows) {
    const tr = el('tr'); const coord = el('td', undefined, 'coord'); coord.append(el('strong', row.coords), el('small', row.planet.name));
    tr.append(coord, renderSummary(row.summary));
    row.cells.forEach(cell => {
      const td = el('td', undefined, `planet-cell ${cell.kind} ${cell.group || ''}`);
      if (cell.kind === 'occupied') {
        td.append(el('strong', cell.name));
        const status = el('div', undefined, 'cell-status'); status.append(el('i', undefined, `dot ${cell.group}`), el('span', cell.label)); td.append(status);
        td.title = `ID ${cell.playerId} · ${cell.planet.name}${cell.code ? ` · API: ${cell.code}` : ''}`;
      } else td.textContent = cell.label;
      tr.append(td);
    });
    body.append(tr);
  }
  $('freshness').replaceChildren();
  const sourceEntry = entries().find(e => e.number === state.sourceNumber);
  for (const [entry, dataset] of [[sourceEntry, state.source], ...targets.map((t, i) => [t, datasets[i]])]) {
    const item = el('div', undefined, 'freshness-item');
    item.append(el('strong', entry.name + (entry.number === state.sourceNumber ? ' · своя' : '')));
    item.append(el('span', dataset ? `Карта: ${date(dataset.timestamps.universe)} UTC · статусы: ${date(dataset.timestamps.players)} UTC` : 'Данные не загружены. Занятость неизвестна.'));
    const link = el('a', 'Открыть API ↗'); link.href = `${entry.api}universe.xml`; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link);
    if (entry.state === 'stale') item.append(el('em', 'Последнее обновление не удалось. Показан сохранённый снимок.'));
    $('freshness').append(item);
  }
  $('results').hidden = false; $('empty-state').hidden = true;
}

function shareUrl() {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  url.searchParams.set('universe', state.sourceNumber); url.searchParams.set('player', state.playerId);
  url.searchParams.set('targets', selectedTargets().map(t => t.number).join(','));
  return url;
}

async function compare() {
  if (!state.source || !state.playerId || !selectedTargets().length || state.busy) return;
  const planets = findPlanets(state.source, state.playerId);
  if (!planets.length) { message('В снимке карты нет планет этого игрока. Возможно, игрок появился после обновления карты.', 'warning'); return; }
  const request = ++state.comparisonRequest; state.busy = true; updateButton();
  $('check').textContent = 'Проверяем…'; closeOptions(); message('Загружаем снимки выбранных вселенных…');
  const targets = selectedTargets();
  const loaded = await Promise.allSettled(targets.map(loadUniverse));
  if (request !== state.comparisonRequest) return;
  const datasets = loaded.map(r => r.status === 'fulfilled' ? r.value : null);
  const rows = planets.map(([coords, planet]) => {
    const cells = datasets.map(d => lookupCoordinate(d, coords)); return { coords, planet, cells, summary: summarize(cells) };
  });
  state.result = { player: state.source.players[state.playerId], planets, targets, datasets, rows };
  renderResults(state.result); state.busy = false; updateButton(); $('check').textContent = 'Проверить координаты ↗';
  const failed = datasets.filter(d => !d).length;
  const unknown = rows.reduce((s, r) => s + r.summary.unknown, 0);
  const stale = [entries().find(e => e.number === state.sourceNumber), ...targets].some(e => e.state === 'stale');
  const warning = [failed ? `Нет данных для ${failed} вселенных.` : '', unknown ? `Статус владельца неизвестен на ${unknown} позициях.` : '', stale ? 'Есть сохранённые снимки после ошибки обновления.' : ''].filter(Boolean).join(' ');
  message(warning || 'Готово. Занятость показана на дату снимка карты API.', warning ? 'warning' : '');
  history.replaceState(null, '', shareUrl());
}

$('universe').addEventListener('change', () => selectSource(Number($('universe').value)));
$('player-search').addEventListener('input', () => { state.playerId = null; clearResult(); updateButton(); $('selected-player').textContent = 'Выбери игрока из подсказок.'; showOptions(); });
$('player-search').addEventListener('focus', showOptions);
$('player-search').addEventListener('blur', closeOptions);
$('player-search').addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeOptions(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); if ($('player-options').hidden) showOptions();
    if (state.matches.length) highlightMatch((state.highlight + (event.key === 'ArrowDown' ? 1 : -1) + state.matches.length) % state.matches.length);
  } else if (event.key === 'Enter' && !$('player-options').hidden) {
    event.preventDefault();
    const match = state.matches[state.highlight >= 0 ? state.highlight : 0]; if (match) selectPlayer(match.id);
  }
});
$('search-form').addEventListener('submit', event => { event.preventDefault(); compare(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { preset(button.dataset.preset); message('Вселенным задан новый набор. Нажми «Проверить координаты».'); }));
$('example').addEventListener('click', async () => {
  $('universe').value = '182'; preset('classic');
  if (await selectSource(182)) {
    if (state.source.players['103183']) { selectPlayer('103183'); await compare(); }
    else message('Proconsul Tiger больше нет в текущем снимке Dione. Выбери другого игрока.', 'warning');
  }
});
$('share').addEventListener('click', async () => {
  if (!state.result) return;
  try { await navigator.clipboard.writeText(shareUrl().href); $('share').textContent = 'Ссылка скопирована'; setTimeout(() => { $('share').textContent = 'Скопировать ссылку'; }, 2000); }
  catch { message('Не удалось скопировать автоматически. Ссылка на эту проверку уже находится в адресной строке.', 'warning'); }
});
$('export').addEventListener('click', () => {
  if (!state.result) return;
  const data = [['Координаты', 'Вселенная', 'Занятость', 'Ник', 'Статус', 'Код API', 'ID игрока', 'Карта API UTC', 'Статусы API UTC']];
  state.result.rows.forEach(row => row.cells.forEach((cell, i) => {
    const snap = state.result.datasets[i];
    data.push([row.coords, state.result.targets[i].name, cell.kind === 'occupied' ? 'Занято' : cell.label,
      cell.name || '', cell.kind === 'occupied' ? cell.label : '', cell.code || '', cell.playerId || '',
      snap ? new Date(snap.timestamps.universe * 1000).toISOString() : '', snap ? new Date(snap.timestamps.players * 1000).toISOString() : '']);
  }));
  const blob = new Blob(['\uFEFF' + data.map(row => row.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = `ogame-ru-${state.sourceNumber}-${state.playerId}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function init() {
  try {
    const response = await fetch('./data/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    if (manifest.schemaVersion !== 1 || !manifest.universes?.length) throw new Error('Некорректный список вселенных');
    state.manifest = manifest;
    const params = new URLSearchParams(location.search);
    const desired = Number(params.get('universe') || 182);
    state.sourceNumber = entries().some(e => e.number === desired) ? desired : entries().find(e => e.state !== 'unavailable').number;
    $('universe').replaceChildren(...entries().map(u => { const option = el('option', `${u.name} · RU ${u.number}${u.state === 'unavailable' ? ' · нет данных' : ''}`); option.value = u.number; return option; }));
    $('universe').value = String(state.sourceNumber); $('universe').disabled = false;
    $('example').disabled = !entries().some(e => e.number === 182 && e.state !== 'unavailable');
    const generated = date(Date.parse(manifest.generatedAt) / 1000);
    $('updated-at').textContent = `База собрана: ${generated} UTC`;
    preset('classic');
    if (params.has('targets')) {
      const numbers = new Set(params.get('targets').split(',').map(Number));
      state.targets = new Set(entries().filter(u => numbers.has(u.number)).map(u => u.number)); renderTargets();
    }
    if (await selectSource(state.sourceNumber)) {
      const id = params.get('player');
      if (id && state.source.players[id]) { selectPlayer(id); await compare(); }
      else if (id) message('Игрок по ссылке отсутствует в текущем списке API. Выбери игрока заново.', 'warning');
    }
  } catch (error) { message(`Не удалось загрузить базу. ${error.message}. Обнови страницу позже.`, 'error'); }
}
init();
