#!/bin/bash
# Gera dist/fiapx-auth.zip: código de src/ e dependências de produção. O mesmo pacote serve às quatro
# Lambdas (register, login, password e authorizer); cada uma aponta para o próprio handler.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf build dist
mkdir -p build dist
cp -R src package.json package-lock.json build/
(cd build && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error && find node_modules -type d -empty -delete)
(cd build && zip -qr ../dist/fiapx-auth.zip src node_modules package.json)
rm -rf build
echo "dist/fiapx-auth.zip ($(du -h dist/fiapx-auth.zip | cut -f1))"
