# Alta Pulse — PRD

## Problema original
Sistema para uma agência autorizada a operar contas de criadoras em plataformas de conteúdo adulto
(Privacy, FatalFans, CloseFans, OnlyFans): monitorar as conversas dos chatters, tempo de resposta,
condução da mensagem e vendas por chatter no período. Evoluiu para um painel web (somente leitura)
+ app desktop Electron (gerenciador de perfis anti-detect com login em 1 clique).

## Arquitetura
- `backend/` FastAPI + MongoDB. Routers: server, core, auth_routes, people, extension_routes, fans,
  performance, quality_ai, scorecard, assist (Grok/xAI), vault, radar, team_live, reporting,
  shift_clock, plantao, mailer, password_reset, stations.
- `frontend/` React + shadcn. Páginas: Team, Quality, Creators, Fans, Performance, Credentials,
  Plantao, Account, ResetPassword, AltaAjudaSettings.
- `desktop/` Electron (main.js, plantao-app.js, reader.js, loader.js, platforms.js, scripts de página).
- `backend/desktop_dist/` instaladores Windows em chunks (~260 MB) servidos por `/api/desktop/release`.

## Fluxo de trabalho com o usuário (IMPORTANTE)
O GitHub do usuário (`pfagotti26-tech/altapulse`, branch `main`) é a fonte da verdade. O agente atua
como pipeline: `git fetch origin && git merge origin/main` → verificar compilação e `/api/health` →
publicar. **Não reescrever código do usuário.** Exceção: tarefas em que ele pede explicitamente que o
agente construa (ex.: Alta Auto).

Restrições declaradas pelo usuário:
- Não retirar instaladores nem `desktop-tools/` do histórico do git. Só limpeza leve quando o disco apertar.
- Não gerar instalador/asar nem mexer em `backend/desktop_dist` ou na versão de `desktop/package.json`.

## Implementado
- Até 07/10/2026: merges e deploys das versões do app v1.2.0 → v1.4.19 (PRs #1 a #30+).
- Reset de senha por e-mail (Resend): `backend/mailer.py`, `backend/password_reset.py`, `ResetPassword.jsx`.
  Secrets em produção: `RESEND_API_KEY`, `MAIL_FROM`, `OWNER_EMAIL` (todos configurados).
- Plantão noturno (copiloto), construído pelo usuário: `backend/plantao.py`, `frontend/src/pages/Plantao.jsx`,
  `desktop/plantao-app.js` + IPC `plantao:prepare`. Permissão `plantao` concedida só pelo dono.
- **07/10/2026 — Alta Auto (módulo autônomo do plantão)**, construído pelo agente (commit `ad89d44`):
  - `backend/plantao.py`: `app_reply` implementa o modo "segurar a conversa" com a persona da criadora
    (`db.assist_profiles`) pela mesma Grok da Alta Ajuda; nova rota `POST /extension/plantao/opener`
    (modo `ai` das aberturas). Travas: plantão desligado/pausado, `after_reply != hold`, `hold_max`,
    sinal de menor de idade (gera alerta ao gestor), "é bot?", contato fora da plataforma e pedido de
    preço/conteúdo (os dois últimos marcam a oportunidade como quente). Trava de saída bloqueia `R$`,
    números de 2+ dígitos, venda e contato. Registro em `db.plantao_log` com `kind: 'reply'` (sem `sent_at`).
  - `desktop/main.js` + `desktop/plantao-app.js` (blocos `// ALTA AUTO`): laço de 60 s que envia sozinho
    com digitação caractere a caractere (45–150 ms, pausa na pontuação) + Enter, confirmação pelo DOM,
    `per_hour`, intervalo aleatório `gap_min`–`gap_max`, uma conversa por vez, janela com variação diária
    de ±6 min, acesso salvo quando a criadora cai no login, e resposta no modo "segurar" com atraso de
    40 s a 4 min. Reporta `start/skip/stop/error` em `/extension/plantao/run`.
  - Teste: `backend/tests/test_alta_auto_plantao.py` (19 asserções, todas passando) + testes em node
    dos scripts injetados e do gatilho `onHold`/`rearm`.

## Backlog
- P0: aguardar validação do usuário do Alta Auto em produção (Fase 3 do plano: envio autônomo).
- P1: `extension_routes.py:23` lê `/app/extension/manifest.json` no import **sem guarda** — se a pasta
  `extension/` não entrar na imagem, o backend não sobe e o Cloudflare devolve 520. `DESKTOP_VERSION`
  na linha seguinte já usa `.exists()`; `VERSION` não. Candidato real do 520 relatado.
- P1: disco do pod — `.git` cresce ~110 MB por release (teto 9,8 GB). `git prune-packed` + `git repack`
  recuperam espaço (7,6 GB → 2 GB em 07/10). Sem rewrite por decisão do usuário.
- P2: Fase 2 do Alta Auto (painel de critérios por intenção/faixa de fã) e Fase 4 (A/B humano vs autônomo
  no Scorecard), caso o usuário queira evoluir.
- P2: conflito pip `emergentintegrations==0.2.1` vs `litellm 1.80.0` — ignorado por decisão do usuário.

## Credenciais de teste
Ver `/app/memory/test_credentials.md`.
