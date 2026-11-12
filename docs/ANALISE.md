# Como funciona o MyKids Printer 1.3.5 (resumo de interoperabilidade)

Resumo do comportamento do agente de impressão oficial do MyKids (Gileade Sistemas), levantado para que esta
versão web seja compatível com o mesmo serviço. Não contém código nem material da Gileade.

## Papel do app
É um **agente de impressão**: não faz check-in. Recebe da nuvem MyKids os pedidos de etiqueta e imprime localmente.

## Fluxo
1. **Login com a conta MyKids** (`gileadeweb-api`): usuário/senha → token. Lista as organizações da conta; com mais
   de uma, troca a organização ativa do token. Lista as impressoras cadastradas no MyKids (`id`, `nome`).
2. **Recebimento** via Socket.IO (servidor **v2 / EIO3**): ao conectar, emite `join` com o ID de cada impressora
   configurada; os pedidos chegam no evento `print` como lista de objetos com `codigo`, `primeiroNome`,
   `ultimoNome`, `sala`, `QRCodeData`, `printerId`, indicadores (`visitante`, `atencao`, `necessidadesEspeciais`,
   `aceitoUsoImagem`, `fazAniversarioNaSemana`, `passeLivre`), `data`/`dataPattern`, `adicional[]`, `origin`, `nomeEvento`.
3. **Etiqueta**: modelos HTML com marcadores (`$qrcode`, `$primeiroNome`, `$ultimoNome`, `$codigo`, `$sala`, `$data`,
   `$...Icone`), preenchidos por substituição de texto e convertidos em PDF com iText html2pdf 2.1.3
   (página = dimensão do modelo × 3 pt). O QR code é gerado localmente a partir de `QRCodeData`.
   Cada organização pode ter **modelos personalizados** publicados em `mykidsprinter/{organização}/templates/`.
4. **Impressão** no spooler do sistema operacional (Windows/Linux), com papel e orientação calculados.

## Detalhes que a versão web trata melhor
- Lista de impressoras paginada (o original lia só a primeira página, 10 itens).
- Código de organização sem "." não quebra a troca de organização.
- Token renovado automaticamente; a impressão não depende dele (só a configuração).

## Fora de escopo (específico de desktop)
Instalação de driver USB, modo "Editor Lite", WMI/PowerShell, bandeja do sistema e atualização automática.
