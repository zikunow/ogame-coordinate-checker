export function coordinateOrder(a, b) {
  const left = a.split(':').map(Number), right = b.split(':').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function classifyPlayer(player) {
  if (!player) return { group: 'unknown', label: 'Статус неизвестен', code: '' };
  const code = player.status || '';
  const labels = [];
  if (code.includes('v')) labels.push('РО');
  if (code.includes('I')) labels.push('Неактивен ≥28 дней');
  else if (code.includes('i')) labels.push('Неактивен ≥7 дней');
  if (code.includes('b')) labels.push('Заблокирован');
  if (code.includes('o')) labels.push('Вне закона');
  if (code.includes('a')) labels.push('Администратор');
  const unknown = [...code].filter(c => !'vIiboa'.includes(c));
  if (unknown.length) labels.push(`Код API: ${unknown.join('')}`);
  const group = code.includes('v') ? 'vacation' : /[iI]/.test(code) ? 'inactive'
    : code === '' ? 'active' : 'other';
  return { group, label: labels.join(' · ') || 'Без отметок API', code };
}

export function lookupCoordinate(snapshot, coords) {
  if (!snapshot) return { kind: 'unavailable', label: 'Нет данных' };
  const [galaxy, system, position] = coords.split(':').map(Number);
  const planet = snapshot.planets[coords];
  if (!planet && !(galaxy >= 1 && galaxy <= snapshot.galaxies && system >= 1 && system <= snapshot.systems && position >= 1 && position <= 15)) {
    return { kind: 'outside', label: 'Вне вселенной' };
  }
  if (!planet) return { kind: 'free', label: 'Свободно по API' };
  const player = snapshot.players[planet.player];
  return { kind: 'occupied', planet, playerId: planet.player,
    name: player?.name || `Игрок #${planet.player}`, rank: player?.rank, score: player?.score, ...classifyPlayer(player) };
}

export function summarize(cells) {
  const summary = { occupied: 0, free: 0, active: 0, inactive: 0, vacation: 0, unknown: 0, other: 0, unavailable: 0, outside: 0 };
  for (const cell of cells) {
    if (cell.kind === 'occupied') { summary.occupied++; summary[cell.group]++; }
    else summary[cell.kind]++;
  }
  return summary;
}

export function aggregateStatus(summary) {
  if (summary.active > 0) return { key: 'occupied', label: 'Занято' };
  if (summary.vacation > 0) return { key: 'likely-occupied', label: 'Вероятно занято' };
  // Missing statuses or snapshots must not imply a position is free.
  if (summary.unknown > 0 || summary.other > 0 || summary.unavailable > 0) {
    return { key: 'likely-occupied', label: 'Вероятно занято' };
  }
  if (summary.inactive > 0) return { key: 'likely-free', label: 'Вероятно свободен' };
  return { key: 'free', label: 'Свободен' };
}

export function findPlanets(snapshot, playerId) {
  return Object.entries(snapshot.planets).filter(([, p]) => p.player === String(playerId))
    .sort(([a], [b]) => coordinateOrder(a, b));
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Prevent a public player name from becoming a spreadsheet formula.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
