# DECISIONS — MyKids Printer Web

## ADR-001 · Painel web + agente no servidor (não impressão pelo navegador) — 2026-11-12
O navegador não imprime em silêncio em impressora de rede/USB. O agente roda no container e o painel só configura.

## ADR-002 · Alvo principal: Brother QL-810W via Wi-Fi (TCP 9100, Brother Raster) — 2026-11-12
Requisito: usar as QL-810W já configuradas no Wi-Fi. Elimina driver Windows/USB/Editor Lite.

## ADR-003 · Busca de impressoras = mDNS + varredura 9100 + SNMP, vínculo por MAC/nome mDNS — 2026-11-12
Requisito "busca simples". Validado em rede doméstica: mDNS + 9100 + SNMP identificam impressoras de rede em ~6 s.
Exige `network_mode: host` no Coolify.

## ADR-004 · Compatibilidade de protocolo com o MyKids — 2026-11-12
Mesmos endpoints REST do app 1.3.5 e `socket.io-client@2` (servidor confirmado como Socket.IO v2/EIO3).
Não replicar fragilidades do original (credenciais fixas, verificação de TLS desligada, segredos em log).

## ADR-005 · Renderização com o mesmo motor do original (iText html2pdf 2.1.3) — 2026-11-12
O Chromium gerou layout bem diferente nos modelos da igreja (margens negativas, `@page`, floats pensados para o iText).
Comparado com uma referência gerada pelo próprio iText do jar oficial, o resultado só bateu usando o mesmo motor.
Solução: processo Java persistente (`apps/renderer/RenderServer.java`) com iText 7.1.6/html2pdf 2.1.3 do Maven Central
(AGPL, uso interno self-hosted), PDF → PNG 300 dpi com `pdftoppm`. Chromium/puppeteer removidos.

## ADR-006 · Dois logins: conta MyKids interna + usuários do painel — 2026-11-12
Requisito. A conta Gileade/MyKids é configuração interna (senha e token cifrados com AES-256-GCM, chave `APP_SECRET`)
usada só para listar impressoras/modelos. O painel tem usuários próprios (scrypt, sessão em cookie httpOnly):
**admin** (conta MyKids, impressoras por ID/QR code, usuários, logs) e **operador** (status + botão Reconectar).

## ADR-007 · Modelos embutidos baixados do instalador oficial no build — 2026-11-12
Os HTMLs embutidos no jar não são versionados (material da Gileade). O Dockerfile baixa o instalador público,
extrai com innoextract e copia `printers/`, `modelos/`, fontes Golos e o logo Voluts para `vendor-templates/`.
Os modelos personalizados da igreja continuam vindo do S3 por organização, em tempo de execução.

## ADR-008 · Logs em três trilhas, 90 dias, sem dados de crianças — 2026-11-12
Requisito ("pense em um log"). Tabela `logs` com `category` (sistema | impressao | auditoria) e `actor`;
tabela `jobs` com impressora, códigos, nº de etiquetas, tempo e origem (check-in | teste).
Auditoria registra login (inclusive recusado, com IP), logout, reconectar, conta MyKids, impressoras, usuários, exportações.
Tela de Logs com abas, filtros por período/nível/resultado/origem, busca, indicadores e exportação CSV (`;`, UTF-8 com BOM, abre no Excel).
Retenção: 90 dias e no máximo 50 mil linhas por tabela. Nunca gravar nome de criança, senha ou token.
