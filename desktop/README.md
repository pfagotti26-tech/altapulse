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

## O que ainda não faz

- Leitura de tempo de resposta e vendas (fase 2, depende da calibração).
- Grupos, etiquetas e anotações ficam no computador (`%APPDATA%\alta-pulse-desktop\local.json`); sincronização entre máquinas é fase 3.
- Instalador assinado (fase 3).

Nada de senha, cookie ou conteúdo da Privacy sai do computador. O app só envia ao painel: login do próprio Alta Pulse, turno e "aba aberta / no chat".
