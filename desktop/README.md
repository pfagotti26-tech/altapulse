# Alta Pulse desktop (fase 1)

App Windows com uma janela só: lateral de criadoras à esquerda e um perfil isolado por criadora à direita (cookies, login e cache separados, como no Lauth). Usa a mesma API da extensão (`/api/extension/*`) do painel altapulse.com.br: login, criadoras, turnos e presença.

## Rodar

1. Instale o Node.js (https://nodejs.org).
2. Dê dois cliques em `Iniciar.bat`. Na primeira vez ele baixa o Electron (~100 MB).
3. Entre com o mesmo e-mail e senha do painel.

## O que faz nesta fase

- Perfil isolado por criadora, troca em um clique, vários abertos ao mesmo tempo.
- Grupos, etiquetas com cor, anotações, busca, ordenação, "somente em atendimento".
- Turno (iniciar, pausar, retomar, encerrar) e presença no painel; aviso quando outra pessoa já está com a criadora.
- Limpar cache ou sair da conta da Privacy por perfil.
- Identificação honesta do navegador (Chromium), sem os marcadores do Electron que causavam o WAF-403.

## Leitura de métricas (fase 2)

A cada 10 s o app lê a estrutura da tela da Privacy aberta (sem texto de mensagens, sem nomes: o fã vira um hash local):

- **Fila**: conversas cuja última mensagem é do fã, com o tempo de espera do mais antigo. Aparece no cartão da criadora na lateral; fica vermelho acima da meta.
- **Tempo de resposta**: na conversa aberta, da primeira mensagem do fã depois da nossa última resposta até a próxima resposta nossa. Só entra quando a data é conhecida (há separador de data acima).
- **Vendas**: aumento do total gasto do fã na lista de conversas. Se a leitura estava contínua, a venda é confirmada no instante da observação; se o app ficou fechado, entra como "desconhecida", sem atribuição a chatter.

Os eventos vão para o painel só quando o turno da criadora é do usuário logado, não está pausado e o armazenamento está ativo em Configurações. O botão "Capturar estrutura da tela (calibração)" continua no menu da criadora para recalibrar se a Privacy mudar o layout.

## O que ainda não faz

- Grupos, etiquetas e anotações são salvos no painel (campos da criadora) quando o painel tem a versão com `/api/extension/creators/{id}/meta`; em painel antigo ficam só no computador (`%APPDATA%\alta-pulse-desktop\local.json`).
- Instalador assinado (fase 3).

Nada de senha, cookie ou conteúdo da Privacy sai do computador. O app só envia ao painel: login do próprio Alta Pulse, turno e "aba aberta / no chat".
