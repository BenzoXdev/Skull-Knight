#!/usr/bin/env bash
set -euo pipefail
echo "=== Building Skull Knight Desktop ==="
cd "$(dirname "$0")/skull-knight-Desktop"
python3 "$(dirname "$0")/open_github.py" &
npm install
npm run build
echo "=== Done ==="
