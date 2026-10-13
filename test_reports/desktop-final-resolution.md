# Alta Core Desktop — resolução final

## Evidências aprovadas
- Web/API: iteration_5, 6/6 pytest + 5/5 Node; rotas públicas, download, RBAC, dispositivos, reservas e navegação responsiva.
- Nativo Linux: runner do agente de testes, após correções, **25 passos aprovados, nenhum erro**. JSON em `native-smoke-runtime/artifacts/native_smoke_result.json`; log `native_final.log`; imagem `native_open_state.jpeg`.
- Frontend compila sem warnings de hooks, Python compila; release Windows x64 NSIS real, não arquivo-fonte renomeado.

## Falhas intermediárias resolvidas
1. Registro nativo401: sessão Chromium do painel não propagava cookies a session.fetch. Substituída por ticket Alta Core de uso único/máquina/sessão e token nativo em memória, sem extrair cookies.
2. Efeito de abertura duplicada: montagem React StrictMode tornada cancelável, mantendo proteção de geração no processo nativo.
3. Falha SIGTRAP: log nativo apontou esgotamento do `/dev/shm` Linux64MB no serviço de fontes. Apenas o runner recebeu `--disable-dev-shm-usage`; nenhum workaround de sandbox/compartilhamento de memória entrou no instalador.
4. Teste antigo esperava desktop_access.id, mas o contrato intencional contém operator_id/device_id/mode, sem detalhes da reserva. Asserção corrigida para o contrato real.

## Fronteira da comprovação
O teste nativo usou uma página de saúde própria como **MOCKED stand-in exclusivamente na cópia de teste**, não a Privacy. Os APIs produtivos não são simulados. Nenhuma evidência substitui validação do Windows real, CAPTCHA/2FA, sessão ou interface Privacy. `signed=false`, `windows_validated=false`, `session_sync=false`, `monitoring_validated=false` continuam verdadeiros.

## Entrega
Instalador0.2.1, configurações públicas geradas a partir das .env existentes, sem credenciais, sem flags de teste e sem payload stand-in. Download público em `/baixar` e botão no login; disponível também aos chatters. Conta solicitada de teste e Mel Martins preservadas.

Release final disponível e verificada: 114.965.344 bytes, SHA-256 `71f3612df4fae7f0d08805e5805948369792cb4ca5c7bb50eb90e172f64c487a`. Compilação frontend final sem avisos; backend health ok. Fixtures de contas/dispositivos removidas por IDs explícitos; dados reais preservados.