#!/bin/sh
# Copia os modelos HTML embutidos no MyKids Printer oficial para vendor-templates/ (não versionado).
# Uso: sh scripts/extract-templates.sh [caminho/para/mykids-printer-1.0.jar]
set -e
JAR="${1:-extracted/app/mykids-printer-1.0.jar}"
OUT="vendor-templates"
[ -f "$JAR" ] || { echo "jar não encontrado: $JAR"; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT"
unzip -q -o "$JAR" 'printers/*' 'modelos/*' -d "$OUT"
# logo Voluts (constante em RequestFile.class) — usado só em pedidos de origem VOLUTS
unzip -p "$JAR" br/com/gileade/mykidsprinter/printer/RequestFile.class \
  | grep -aoE 'data:image/png;base64,[A-Za-z0-9+/=]+' | head -1 > "$OUT/voluts-logo.txt" || true
mkdir -p "$OUT/fonts" && unzip -q -o -j "$JAR" "fonts/Golos*.ttf" -d "$OUT/fonts" || true
echo "modelos em $OUT/:"; ls "$OUT/printers"
