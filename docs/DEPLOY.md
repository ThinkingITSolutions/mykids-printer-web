# Deploy no Coolify (servidor local da igreja)

O container precisa estar **na mesma rede (Wi-Fi/LAN) das Brother QL-810W**. Ele usa `network_mode: host` para
achar as impressoras por mDNS e falar com elas na porta 9100.

## 1. Pré-requisitos
- Servidor com Docker gerenciado pelo Coolify, ligado na rede da igreja (cabo ou Wi-Fi), com saída para a internet
  (`web.appmykids.com.br`, `printer.appmykids.com.br`, `s3.sa-east-1.amazonaws.com`).
- ~2 GB de RAM livres e ~1,5 GB de disco para o build. Imagem final ≈ 800 MB (Node + Java + poppler).
- Porta **8080** livre no servidor (ou outra, via `PORT`).

## 2. Criar o recurso
1. Coolify → *Projects* → *+ New* → **Public Repository** → URL deste repositório, branch `main`.
2. *Build Pack*: **Docker Compose**, arquivo `docker-compose.yml`.
3. *Environment Variables*:
   | Variável | Valor |
   |---|---|
   | `APP_SECRET` | gerar com `openssl rand -hex 32`. **Não trocar depois**: cifra a senha da conta MyKids. |
   | `PORT` | `8080` (padrão) |
   | `SECURE_COOKIES` | `false` no acesso por IP; `true` se publicar com HTTPS |
4. *Deploy*. O primeiro build demora uns 5 a 10 min: baixa o instalador oficial do MyKids Printer para extrair os modelos
   de etiqueta embutidos e as bibliotecas do iText.
5. Volume `mykids-printer-data` (`/data`): banco SQLite, modelos em cache e prévias. **Incluir no backup do Coolify.**

## 3. Acesso e HTTPS (necessário para instalar o app no celular)
O painel é um **webapp instalável** (PWA). Android e iPhone **só instalam por HTTPS com certificado válido**:
pelo IP (`http://192.168.x.y:8080`) o painel funciona, mas não aparece "Instalar". A câmera para ler QR code
também exige HTTPS.

**Recomendado: domínio próprio apontando para o IP da rede da igreja + certificado Let's Encrypt via DNS.**
1. Reserve o IP do servidor no roteador (ex.: `192.168.0.10`).
2. No DNS (ex.: Cloudflare), crie `mykids.seudominio.com.br` → registro **A** `192.168.0.10`, **sem proxy** (nuvem cinza).
   O nome só resolve para dentro da rede da igreja, então nada fica exposto na internet.
3. Como o IP é privado, o Let's Encrypt não valida por HTTP: use o **desafio DNS**.
   - **Coolify (Traefik):** em *Servers → Proxy*, configure o resolvedor `letsencrypt` com `dnsChallenge` do provedor
     (Cloudflare: variável `CF_DNS_API_TOKEN`) e, em *Dynamic Configuration*, uma rota para o container
     (que roda em `network_mode: host`):
     ```yaml
     http:
       routers:
         mykids:
           rule: Host(`mykids.seudominio.com.br`)
           entryPoints: [https]
           service: mykids
           tls: { certResolver: letsencrypt }
       services:
         mykids:
           loadBalancer:
             servers: [{ url: "http://host.docker.internal:8080" }]
     ```
   - **Sem Traefik:** gere o certificado (ex.: `certbot --dns-cloudflare` / `acme.sh`), monte os arquivos no container
     e defina `TLS_CERT_FILE` e `TLS_KEY_FILE`. O próprio app passa a servir HTTPS na `PORT`, e os cookies
     ficam seguros automaticamente.
4. Use `SECURE_COOKIES=true` quando o HTTPS estiver no Traefik.

> Certificado autoassinado **não** serve: o iPhone não instala e o Android mostra alerta.

### Instalar nos celulares
- **Android (Chrome):** abra o endereço HTTPS; o painel mostra a faixa **"Instale o MyKids Printer" → Instalar**
  (ou menu ⋮ → *Instalar app*).
- **iPhone (Safari):** a faixa abre o passo a passo: **Compartilhar → Adicionar à Tela de Início**.
- O app abre em tela cheia com o ícone da INCC, tem atalhos (Painel, Impressoras, Logs) e mostra
  "Nova versão disponível → Atualizar" quando houver deploy novo. Sem rede, mostra uma tela própria de "Sem conexão".

## 4. Primeira configuração (no painel)
1. Criar o **administrador** (primeiro acesso).
2. **Conta MyKids** → e-mail/senha do MyKids → organização.
3. **Impressoras** → *Incluir* → ID da impressora do MyKids (lista, ID ou QR code) → *Procurar impressoras na rede*
   → escolher a QL-810W → modelo de etiqueta, rolo e orientação → *Salvar* → **Imprimir teste**.
4. **Usuários** → criar os operadores (só veem o status e o botão *Reconectar*).
5. **Desligar o MyKids Printer antigo** dos PCs Windows que usam os mesmos IDs. Senão as etiquetas saem em dobro.

## 5. Checklist das Brother QL-810W
- [ ] Wi-Fi em modo infraestrutura, na mesma rede do servidor; **reserva de IP no roteador** (recomendado).
- [ ] Modo **Editor Lite desligado** (LED verde apagado).
- [ ] Rolo instalado bate com o escolhido no painel (DK-11201 29x90, DK-11202 62x100 ou DK-22205 62 mm).
- [ ] "Imprimir teste": texto legível, QR code lido pelo celular, corte automático no fim.
- [ ] Se sair de cabeça para baixo: orientação → "Paisagem invertida".
- [ ] Check-in real no MyKids imprime em até ~3 s (ver **Logs → Impressões**).
- [ ] Desligar e ligar a impressora: continua imprimindo (o painel reencontra pelo MAC se o IP mudar).

## 6. Atualizar
Coolify → *Redeploy* (ou ative o *auto deploy* no push). O volume `/data` mantém usuários, conta e vínculos.
