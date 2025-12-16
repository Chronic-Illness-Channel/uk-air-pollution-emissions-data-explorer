#!/usr/bin/env python3
import re
import urllib.parse
from pathlib import Path
from typing import Match

ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / 'dataexplorer-version.txt'
HTML_PATTERN = re.compile(
    r"(<script\b[^>]*?\bsrc\s*=\s*['\"])([^'\"\s>]+)(['\"])",
    re.IGNORECASE
)
SKIP_PARTS = {'CIC-test-Archive-Charts', 'node_modules', 'dist', 'build', '.git'}
LOCAL_PREFIXES = ('http://', 'https://', '//', 'data:')

if not VERSION_FILE.exists():
    raise SystemExit('[cache-bust] dataexplorer-version.txt missing; aborting')

version_raw = VERSION_FILE.read_text(encoding='utf-8').strip()
slug = re.sub(r'[^A-Za-z0-9]+', '-', version_raw).strip('-') or 'build'

changed_files: list[str] = []

for html_path in ROOT.rglob('*.html'):
    relative_parts = html_path.relative_to(ROOT).parts
    if any(part in SKIP_PARTS for part in relative_parts):
        continue

    original = html_path.read_text(encoding='utf-8')
    changed_flag = {'value': False}

    def repl(match: Match[str]) -> str:
        prefix, src, suffix = match.groups()
        if prefix is None or src is None or suffix is None:
            return match.group(0) or ''
        lowered = src.lower()
        if lowered.startswith(LOCAL_PREFIXES):
            return match.group(0)

        base, sep, query = src.partition('?')
        params: list[tuple[str, str]] = []
        if sep:
            params = list(urllib.parse.parse_qsl(query, keep_blank_values=True))
        new_params: list[tuple[str, str]] = []
        has_version = False

        for key, value in params:
            if key == 'v':
                value = slug
                has_version = True
            new_params.append((key, value))

        if not has_version:
            new_params.append(('v', slug))

        new_src = f"{base}?{urllib.parse.urlencode(new_params)}"
        if new_src == src:
            return match.group(0)

        changed_flag['value'] = True
        return f"{prefix}{new_src}{suffix}"

    updated = HTML_PATTERN.sub(repl, original)

    if changed_flag['value']:
        html_path.write_text(updated, encoding='utf-8')
        changed_files.append(str(html_path.relative_to(ROOT)))

if changed_files:
    print(f"[cache-bust] updated {len(changed_files)} HTML file(s) using slug {slug}")
else:
    print(f"[cache-bust] no HTML updates needed (slug {slug})")
