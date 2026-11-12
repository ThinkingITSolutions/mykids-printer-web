# MyKids Printer Web (INCC)

Substituto web/self-hosted do **MyKids Printer 1.3.5** (Gileade) para imprimir as etiquetas do check-in do
Ministério Infantil em **Brother QL-810W via Wi-Fi**, rodando no Coolify da igreja.

- Mesma conta MyKids (configurada uma vez pelo admin, guardada cifrada).
- Recebe os pedidos do Socket.IO `printer.appmykids.com.br` como o app original (join por ID de impressora).
- Etiquetas idênticas ao original: mesmo motor iText e os modelos personalizados da igreja (S3).
- Busca de impressoras na rede: mDNS + porta 9100 + SNMP; reencontra a impressora se o IP mudar (MAC).
- Painel com usuários próprios: **admin** configura; **operador** só vê o status e clica em **Reconectar**.

Docs: [`docs/ANALISE.md`](docs/ANALISE.md) · [`docs/SPEC.md`](docs/SPEC.md) · [`docs/DECISIONS.md`](docs/DECISIONS.md) · [`docs/DEPLOY.md`](docs/DEPLOY.md)

## Estrutura
| Pasta | O quê |
|---|---|
| `apps/server` | Fastify + agente Socket.IO v2 + descoberta + Brother Raster + IPP (TypeScript, Node 26, SQLite nativo) |
| `apps/web` | Painel React (identidade visual nazareno.com.br) |
| `apps/renderer` | `RenderServer.java` — HTML→PDF com iText html2pdf 2.1.3 (libs do Maven Central) |
| `scripts/extract-templates.sh` | Extrai os modelos embutidos do jar oficial para `vendor-templates/` |

## Desenvolvimento local
Requisitos: Node 26, pnpm 11, Java 17+ (javac), `pdftoppm` (poppler-utils).
```sh
pnpm install
sh apps/renderer/fetch-libs.sh && javac --release 17 -cp "apps/renderer/lib/*" -d apps/renderer/build apps/renderer/src/RenderServer.java
sh scripts/extract-templates.sh /caminho/mykids-printer-1.0.jar   # do instalador oficial (innoextract)
pnpm --filter web build
cd apps/server && DATA_DIR=../../data npx tsx src/index.ts          # http://localhost:8080
pnpm --filter server simulator 9100                                  # simulador de QL-810W (salva PNG)
```
Para testar sem a Brother: vincule a impressora com IP `127.0.0.1` (tipo Brother QL) — o simulador grava as etiquetas
em `data/simulator/` — ou use uma impressora comum de rede (tipo IPP).

> ⚠️ Em desenvolvimento, use um ID de impressora MyKids **de teste** (ou deixe o vínculo desativado). O Socket.IO não
> autentica: com o mesmo ID da igreja, cada check-in sai também aqui.

## Deploy (Coolify da igreja)
Recurso **Docker Compose** apontando para este repositório (`docker-compose.yml`):
- `network_mode: host` (obrigatório para enxergar as impressoras do Wi-Fi);
- variável `APP_SECRET` (obrigatória, não trocar depois) e `SECURE_COOKIES=true` se houver HTTPS;
- volume `/data` (banco, cache de modelos, prévias).
O primeiro acesso pede a criação do administrador.

Licença: [AGPL-3.0](LICENSE).

> Projeto independente, sem vínculo com a Gileade Sistemas. "MyKids" é marca da Gileade; este repositório não
> distribui código nem arquivos do aplicativo oficial: os modelos embutidos são extraídos do instalador público
> no momento do build.
