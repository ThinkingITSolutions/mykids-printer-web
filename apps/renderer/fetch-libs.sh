#!/bin/sh
# Baixa do Maven Central as mesmas versões do iText usadas pelo MyKids Printer 1.3.5 (AGPL, open source).
set -e
cd "$(dirname "$0")" && mkdir -p lib
M=https://repo1.maven.org/maven2
for a in html2pdf:2.1.3 kernel:7.1.6 layout:7.1.6 io:7.1.6 styled-xml-parser:7.1.6 svg:7.1.6 forms:7.1.6; do
  n=${a%%:*}; v=${a##*:}
  [ -f lib/$n-$v.jar ] || curl -fsSL -o lib/$n-$v.jar $M/com/itextpdf/$n/$v/$n-$v.jar
done
[ -f lib/slf4j-api-1.7.25.jar ] || curl -fsSL -o lib/slf4j-api-1.7.25.jar $M/org/slf4j/slf4j-api/1.7.25/slf4j-api-1.7.25.jar
[ -f lib/slf4j-nop-1.7.25.jar ] || curl -fsSL -o lib/slf4j-nop-1.7.25.jar $M/org/slf4j/slf4j-nop/1.7.25/slf4j-nop-1.7.25.jar
ls lib
