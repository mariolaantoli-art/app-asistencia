#!/usr/bin/env bash
# Genera la versión web de la app (para abrir en el navegador sin instalar nada)
# y la deja en /app/backend/web_app, que el backend sirve en /api/app/.
# No modifica app.json de forma permanente.
set -euo pipefail
cd /app/frontend
cp app.json /tmp/app.json.bak
trap 'cp /tmp/app.json.bak app.json' EXIT
node -e '
const fs=require("fs");const c=JSON.parse(fs.readFileSync("app.json"));
c.expo.experiments={...(c.expo.experiments||{}),baseUrl:"/api/app"};
c.expo.web={...c.expo.web,output:"single"};
fs.writeFileSync("app.json",JSON.stringify(c,null,2));'
rm -rf /tmp/web_export
npx expo export --platform web --output-dir /tmp/web_export --clear
mkdir -p /app/backend/web_app
find /app/backend/web_app -mindepth 1 -delete
cp -r /tmp/web_export/. /app/backend/web_app/
echo "Web export listo en /app/backend/web_app"
