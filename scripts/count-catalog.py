"""Check docs/TOOL-CATALOG.md: section counts, totals, unique names, valid marks, cards that exist.

Run: python3 scripts/count-catalog.py   (prints the totals; exits 1 on any mismatch)
A-1 adds it to `npm run check`. Any PR that adds, removes or renames a catalog tool keeps this green.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
text = (ROOT / 'docs/TOOL-CATALOG.md').read_text()
cards = {c['id'] for c in json.loads((ROOT / 'docs/pr-cards/work-index.json').read_text())['cards']}
errors = []
sections = []
current = None
for line in text.splitlines():
    m = re.match(r'^## (.+?) \(`([^`]+)`\) — (\d+)$', line)
    if m:
        current = {'title': m.group(1), 'prefix': m.group(2), 'claimed': int(m.group(3)), 'rows': []}
        sections.append(current)
        continue
    if line.startswith('## '):
        current = None
        continue
    if current is not None and line.startswith('| `'):
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) != 8:
            errors.append(f'{current["title"]}: row has {len(cells)} cells, expected 8: {line[:80]}')
            continue
        current['rows'].append(cells)

names = set()
# The only non-read tools allowed in read_only: github_call runs whatever tool it names (that tool's own profile
# applies), the scanner gateway dispatches each action through its original guards, and github_workflow_app_readiness previews fixes but only applies them on a profile that allows writes.
READ_ONLY_WRITE_EXCEPTIONS = {'github_call', 'github_workflow_app_readiness', 'github_secret_scanner'}
SAFETY = re.compile(r'^(—|as the tool|C \(always\)|(P|C)(·(D|Prod\*?|A\*?|M\*?|\$\*?))*)$')
for s in sections:
    if len(s['rows']) != s['claimed']:
        errors.append(f'{s["title"]}: heading says {s["claimed"]}, table has {len(s["rows"])}')
    for name, desc, safety, origin, cred, audience, profile, card in s['rows']:
        tool = name.strip('`')
        if tool in names:
            errors.append(f'duplicate tool {tool}')
        names.add(tool)
        if not re.match(r'^github_[a-z0-9]+(_[a-z0-9]+)*$', tool):
            errors.append(f'{tool}: name is not snake_case github_… (every tool starts with the service prefix)')
        if not SAFETY.match(safety):
            errors.append(f'{tool}: unknown safety mark {safety!r}')
        if origin not in ('C', 'F', 'N') and not origin.startswith(('C ', 'F ', 'N ')):
            errors.append(f'{tool}: origin {origin!r}')
        if profile not in ('R', 'E', 'F'):
            errors.append(f'{tool}: profile {profile!r}')
        if not set(audience.split(',')) <= {'B', 'O', 'Op'}:
            errors.append(f'{tool}: audience {audience!r}')
        if card.split(' ')[0] not in cards:
            errors.append(f'{tool}: card {card!r} not in work-index.json')
        if safety != '—' and profile == 'R' and tool not in READ_ONLY_WRITE_EXCEPTIONS:
            errors.append(f'{tool}: a write tool cannot be in read_only')

total = sum(len(s['rows']) for s in sections)
universal = sum(len(s['rows']) for s in sections if s['prefix'].startswith('github_api_'))
m = re.search(r'\*\*Totals:\*\* (\d+) tools: (\d+) hand-built \+ (\d+) universal', text)
if not m:
    errors.append('Totals line missing')
elif (int(m.group(1)), int(m.group(2)), int(m.group(3))) != (total, total - universal, universal):
    errors.append(f'Totals line says {m.group(0)}; tables give {total} = {total - universal} + {universal}')
m = re.search(r'\| \*\*Total\*\* \| \*\*(\d+)\*\* \|', text)
if not m or int(m.group(1)) != total:
    errors.append('summary table total does not match')

if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f'catalog OK: {total} tools ({total - universal} hand-built + {universal} universal) in {len(sections)} sections')
