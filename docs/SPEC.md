# SPEC — MyKids Printer Web (tkit)

Status: rascunho v0.1 · 2026-11-12 · base: `docs/ANALISE.md`

## Objetivo
Substituir o MyKids Printer de Windows por um serviço **self-hosted no Coolify**, com painel web, que:
- entra com a **mesma conta MyKids** (API `web.appmykids.com.br/gileadeweb-api`);
- recebe os pedidos do Socket.IO `printer.appmykids.com.br` exatamente como o app original;
- imprime em **Brother QL-810W via Wi-Fi** (e, em segundo plano, nos demais modelos do original);
- **encontra as impressoras da rede local sozinho**, com um clique.

## Escopo funcional (paridade com o 1.3.5)
| # | Função original | Versão web |
|---|---|---|
| F1 | Login usuário/senha, esqueci a senha | Tela de login → mesmos endpoints; token só no servidor (nunca no browser) |
| F2 | Escolher organização (`hierarchyCode`) + changeorganization | Seletor de organização |
| F3 | Listar impressoras do MyKids (`/api/impressora`) | Lista "impressoras do MyKids" para vincular |
| F4 | Vincular impressora MyKids → impressora física, apelido, modelo de etiqueta, orientação | Cartão por vínculo |
| F5 | Socket.IO: `join(printerId)`, evento `print`, reconexão | Agente Node com `socket.io-client@2` (servidor é v2/EIO3) |
| F6 | Modelos HTML/ZPL/PPLA embutidos + modelos online por organização (S3, com cache) | Mesmos arquivos (extraídos do jar) + download/cache por `oi` |
| F7 | Mesclar vários pedidos PDF num único job | Mantido |
| F8 | Impressão de teste com dados fictícios | Botão "Imprimir teste" |
| F9 | Status da impressora / do socket | Online/offline/imprimindo + status da QL via rede |
| F10 | Janela de log | Página de logs (últimos N eventos, sem dados sensíveis) |
| F11 | Idiomas pt-BR/en/es | pt-BR primeiro; arquivos de idioma reaproveitados |
| F12 | Bloqueio das configurações por senha local | Senha de admin do painel (hash, definida no 1º acesso) — sem senha fixa no código |
| — | Driver Windows, USB, Editor Lite, WMI, bandeja, auto-update S3 | **Fora** (não se aplicam a rede/servidor) |

## Busca de impressoras (requisito-chave: simples)
Botão **"Procurar impressoras"** → em até ~5 s lista as Brother da rede com modelo, IP e status, pronta para vincular.
1. **mDNS/Bonjour** (`_pdl-datastream._tcp`, `_printer._tcp`, `_ipp._tcp`) → nome, modelo (`ty`/`product`), IP.
2. **Varredura TCP 9100** na sub-rede do host (fallback para redes que bloqueiam multicast).
3. **SNMP v1 `public`** em cada candidato → `sysDescr`/`hrDeviceDescr` confirma "Brother QL-810W" e lê o status.
4. Resultado filtrado por padrão para Brother QL; "mostrar todas" exibe as outras.
5. Vínculo guarda o **MAC/nome mDNS**, não só o IP: se o DHCP trocar o IP, o agente reencontra a impressora sozinho.
6. Entrada manual de IP como último recurso.

## Impressão na QL-810W
- Render: modelo HTML + dados → **Chromium headless** (Playwright) → PNG em 300 dpi no tamanho da etiqueta
  (62 mm contínua, 29x90, 62x100 etc.), com orientação/rotação iguais às do original.
- Envio: **Brother Raster** via TCP 9100 (protocolo do `brother_ql`; corte automático, 2 cores DK-22251 quando o modelo pedir).
- ZPL/PPLA (Zebra/Argox de rede): envio RAW na porta 9100 — compatibilidade secundária.

## Arquitetura
```
[Navegador] ⇄ HTTPS ⇄ [Container mykids-printer-web — network_mode: host]
                         ├─ API + painel (Fastify + SPA)
                         ├─ Agente: login MyKids · Socket.IO v2 · templates · render · fila
                         ├─ Descoberta: mDNS + scan 9100 + SNMP
                         └─ SQLite (config, vínculos, logs) em volume
                                  ⇣ TCP 9100 / SNMP 161
                         [Brother QL-810W no Wi-Fi]
```
- **`network_mode: host` é obrigatório**: o multicast mDNS não atravessa a rede bridge do Docker.
- O host do Coolify precisa estar **na mesma LAN das impressoras** (por igreja/local: um host pequeno com Docker).
- Stack: TypeScript, pnpm, Fastify, React/Vite, Playwright-chromium, better-sqlite3, `socket.io-client@2`, `bonjour-service`, `net-snmp`.

## Segurança
- Token e senha MyKids guardados cifrados no volume (chave em env do Coolify); nunca vão ao browser nem aos logs.
- Painel com senha própria; TLS verificado (o original aceitava qualquer certificado).
- Logs sem nome de criança / QR (só código e status).

## Critérios de aceite
1. Login com uma conta MyKids real lista organizações e impressoras.
2. "Procurar impressoras" encontra a QL-810W em ≤ 5 s numa LAN comum.
3. Impressão de teste sai correta em 62 mm e 29x90.
4. Check-in feito no MyKids imprime no QL-810W vinculado em ≤ 3 s.
5. Reinício do container retoma login e vínculos sem nova configuração; troca de IP da impressora não quebra o vínculo.

## Plano de validação (desenvolvimento em casa, sem QL-810W)
- **Impressora MyKids de teste**: cadastrar uma impressora nova no MyKids só para o dev. Usar o `printerId` da igreja
  faria o agente de casa entrar na mesma sala do Socket.IO e **imprimir em duplicidade**.
- **Destino "documento"**: imprimir a etiqueta em tamanho real numa impressora comum (IPP/PDF, ex.: uma laser de rede) para conferir layout.
- **Simulador QL-810W**: servidor TCP 9100 local que decodifica o Brother Raster recebido e salva PNG.
- **Arquivos de referência**: comparar byte a byte o raster gerado com a saída do `brother_ql` para as mesmas etiquetas.
- **Checklist na igreja** (~15 min): busca, teste 62 mm/29x90, corte, check-in real, troca de IP.

## Pendências / riscos
- Desenvolvimento feito sem QL-810W física → validação final (orientação, corte, rolo) depende de uma impressora real.
- Conferir no aparelho: modo "Editor Lite" desligado, porta 9100 ativa, SNMP habilitado (padrão de fábrica).
- Modelos online do S3 são por `oi`: validar com a organização real.
