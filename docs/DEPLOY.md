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

## 3. Acesso
Com `network_mode: host` o proxy do Coolify (Traefik) não enxerga o container pela rede Docker. Na igreja, o simples é
acessar pela LAN: **`http://IP-DO-SERVIDOR:8080`** (reserve o IP do servidor no roteador).
Se quiser domínio com HTTPS, crie no Traefik uma rota dinâmica para `http://host.docker.internal:8080` e use
`SECURE_COOKIES=true`. A câmera para ler QR code só funciona em HTTPS (ou use "Enviar foto do QR code").

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
