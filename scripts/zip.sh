#!/usr/bin/env bash
# Empacota o código-fonte (sem node_modules, dist, banco e .git) em ../caixa-certo.zip
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"; NAME="$(basename "$ROOT")"; OUT="$(dirname "$ROOT")/caixa-certo.zip"
rm -f "$OUT"
python3 - "$ROOT" "$OUT" "$NAME" <<'PY'
import os, sys, zipfile
root, out, name = sys.argv[1:4]
skip_dirs = {'node_modules', 'dist', '.git', 'data'}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in skip_dirs]
        for f in files:
            if f.endswith(('.log', '.db', '.db-wal', '.db-shm')) or f in ('.store_login', '.env.local'): continue  # nunca empacota credenciais
            full = os.path.join(d, f)
            z.write(full, os.path.join(name, os.path.relpath(full, root)))
PY
echo "Gerado: $OUT ($(du -h "$OUT" | cut -f1))"
