#!/usr/bin/env python3
"""Build public, moon-free JSON snapshots from the official OGame API (stdlib only)."""
import argparse
import concurrent.futures
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
LOBBY = 'https://lobby.ogame.gameforge.com/api/servers'


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def fetch(url):
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'OGameCoordinateChecker/1.0 (public API snapshots)'})
            with urlopen(request, timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt * 2)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def parse_snapshot(server, xml):
    number = int(server['number'])
    roots = {kind: ET.fromstring(xml[kind]) for kind in ('serverData', 'players', 'universe')}
    for kind, root in roots.items():
        if root.tag != kind or root.get('serverId') != f'ru{number}':
            raise ValueError(f'Wrong API identity for {kind}, ru{number}')
        if int(root.get('timestamp', '0')) <= 0:
            raise ValueError(f'Missing API timestamp for {kind}')
    settings = roots['serverData']
    if settings.findtext('name') != server['name'] and number != 1:
        raise ValueError('Lobby and API universe names differ')
    galaxies, systems = int(settings.findtext('galaxies')), int(settings.findtext('systems'))
    if not 1 <= galaxies <= 100 or not 1 <= systems <= 10000:
        raise ValueError('Invalid universe dimensions')
    players = {p.get('id'): {'name': p.attrib['name'], 'status': p.get('status', '')}
               for p in roots['players'].findall('player')}
    planets = {}
    for p in roots['universe'].findall('planet'):
        coords = p.attrib['coords']
        galaxy, system, position = map(int, coords.split(':'))
        # Some official snapshots include administrative planets outside playable galaxies.
        # Retain these API records, rather than rejecting an otherwise valid universe.
        if not (1 <= galaxy <= 100 and 1 <= system <= 10000 and 1 <= position <= 15):
            raise ValueError(f'Invalid planet coordinate: {coords}')
        if coords in planets:
            raise ValueError(f'Duplicate coordinate: {coords}')
        planets[coords] = {'id': p.attrib['id'], 'player': p.attrib['player'], 'name': p.get('name', '')}
    if not players or not planets:
        raise ValueError('Empty API snapshot')
    return {'schemaVersion': 1, 'number': number, 'name': server['name'],
            'galaxies': galaxies, 'systems': systems,
            'timestamps': {kind: int(root.attrib['timestamp']) for kind, root in roots.items()},
            'players': players, 'planets': planets}


def add_highscores(data, raw):
    root = ET.fromstring(raw)
    if (root.tag != 'highscore' or root.get('serverId') != f"ru{data['number']}"
            or root.get('category') != '1' or root.get('type') != '0'):
        raise ValueError('Wrong highscore identity or category')
    timestamp = int(root.get('timestamp', '0'))
    if timestamp <= 0:
        raise ValueError('Missing highscore timestamp')
    rankings, positions = {}, set()
    for player in root.findall('player'):
        player_id = player.attrib['id']
        rank, score = int(player.attrib['position']), player.attrib['score']
        if rank <= 0 or not score.isdigit() or player_id in rankings or rank in positions:
            raise ValueError('Invalid highscore record')
        rankings[player_id] = {'rank': rank, 'score': score}
        positions.add(rank)
    if not rankings:
        raise ValueError('Empty highscore snapshot')
    for player_id, player in data['players'].items():
        if player_id in rankings:
            player.update(rankings[player_id])
    data['timestamps']['highscore'] = timestamp
    data['rankingState'] = 'ok'


def collect(server, data_dir, cache_dir):
    number = int(server['number'])
    base = f'https://s{number}-ru.ogame.gameforge.com/api/'
    entry = {'number': number, 'name': server['name'], 'file': f'data/ru-{number}.json',
             'api': base, 'state': 'ok'}
    path = data_dir / f'ru-{number}.json'
    try:
        xml = {}
        for kind in ('serverData', 'players', 'universe'):
            cached = cache_dir / f'{number}_{kind}.xml' if cache_dir else None
            xml[kind] = cached.read_bytes() if cached and cached.exists() else fetch(f'{base}{kind}.xml')
        data = parse_snapshot(server, xml)
        try:
            cached = cache_dir / f'{number}_highscore.xml' if cache_dir else None
            ranking_xml = cached.read_bytes() if cached and cached.exists() else fetch(f'{base}highscore.xml?category=1&type=0')
            add_highscores(data, ranking_xml)
        except Exception as error:
            print(f'ru-{number}: ranking unavailable: {type(error).__name__}: {error}', file=sys.stderr)
            data['rankingState'] = 'unavailable'
        write_json(path, data)
        entry['lastSuccessAt'] = now()
    except Exception as error:
        print(f'ru-{number}: {type(error).__name__}: {error}', file=sys.stderr)
        if path.exists():
            data = json.loads(path.read_text(encoding='utf-8'))
            entry['state'] = 'stale'
            entry['lastSuccessAt'] = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec='seconds')
        else:
            entry.update(state='unavailable', error='API недоступен при обновлении')
            return entry
    entry.update(galaxies=data['galaxies'], systems=data['systems'], timestamps=data['timestamps'],
                 rankingState=data.get('rankingState', 'unavailable'),
                 playerCount=len(data['players']), planetCount=len(data['planets']))
    print(f"{entry['name']}: {entry['playerCount']} players, {entry['planetCount']} planets ({entry['state']})", flush=True)
    return entry


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'site' / 'data')
    parser.add_argument('--cache-dir', type=Path, help='Reuse exact XML files for reproducible local builds')
    parser.add_argument('--lobby-file', type=Path)
    args = parser.parse_args()
    raw = args.lobby_file.read_bytes() if args.lobby_file else fetch(LOBBY)
    servers = sorted((s for s in json.loads(raw) if s['language'] == 'ru'
                      and 103 <= int(s['number']) <= 266 and not s.get('serverClosed')),
                     key=lambda s: int(s['number']))
    if not servers or len({s['number'] for s in servers}) != len(servers):
        raise ValueError('Invalid RU server list')
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        entries = list(pool.map(lambda s: collect(s, args.output, args.cache_dir), servers))
    if not any(e['state'] == 'ok' for e in entries):
        raise RuntimeError('No fresh server snapshots; keeping the previous manifest')
    write_json(args.output / 'manifest.json', {'schemaVersion': 1, 'generatedAt': now(),
               'community': 'ru', 'lobbyApi': LOBBY, 'universes': entries})
    included_files = {f"ru-{entry['number']}.json" for entry in entries}
    for path in args.output.glob('ru-*.json'):
        if path.name not in included_files:
            path.unlink()


if __name__ == '__main__':
    main()
