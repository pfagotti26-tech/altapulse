# Alta Core — Gerenciador de criadoras e supervisão de chatters

## Pedido original
“Você consegue criar um sistema que entra num sistema de uma privacy.com.br já logado porque sou uma agência autorizado pela criadora a operar na conta para que fique monitorando as conversas dos chatter que atuam na conta, verifique o tempo de resposta, a condução de mensagem que está sendo trabalhada, vendas realizada por aquele chatter no período. Me responda antes de fazer e qual seria a proposta”.

O usuário aprovou posteriormente o plano completo **Gerenciador de criadoras e supervisão de chatters**, preservado em `/app/plan/plan.md`, e autorizou a execução: **“Painel em português, componente Windows, revisão manual e nenhuma API da Privacy.”** Só a fase 1 pertence à construção inicial. A aprovação de visualização relatada pelo usuário não foi ampliada para permissão de cópia de conversas, acesso por API ou uso de IA.

## Personas
- Gestor da agência: cadastra criadoras e operadores, define acesso, supervisiona turnos, revisa atendimento na estação local, consulta resultados e corrige registros com justificativa.
- Chatter: acesso próprio ao gerenciador, somente criadoras autorizadas e controles do próprio turno; login Privacy é separado e local.
- Criadora: titular da conta operada pela agência conforme autorização informada; perfis e sessões precisam permanecer separados.

## Requisitos estáticos
- Interface PT-BR, clara, grafite, estados verdes/âmbar/vermelhos; rotas separadas Criadoras, Operação, Vendas, Qualidade, Equipe e turnos, Relatórios, Configurações. Responsiva; sem fotos/conteúdo íntimo.
- Uma estação Windows no MVP. Perfis persistentes isolados por criadora, não usar perfil pessoal, impedir duplicação. Login/2FA/CAPTCHA manuais diretamente na Privacy.
- Integração somente pelo DOM realmente visível. Proibidos endpoints/API Privacy, chamadas ocultas, interceptação de tráfego, cookies/tokens da Privacy, bypass, mensagens automáticas, compras/saques ou qualquer escrita financeira.
- Acompanhamento parcial passivo, sem clicar, rolar ou trocar conversas. Revisão manual local apenas com turno pausado e aviso sobre marcação de leitura. Sem varredura nem transmissão remota.
- Gestor/chatter com credenciais próprias. Um responsável por criadora em cada intervalo; conflitos explícitos. Correções justificadas e auditadas.
- Espera entre primeira mensagem do assinante após resposta anterior da conta e próxima resposta. Mensagens consecutivas não reiniciam relógio; troca de turno não zera espera. Incompletos não entram como zero. Meta inicial 5 min ajustável.
- Vendas de chat somente quando origem, situação e confirmação estão identificadas; associação pelo instante de confirmação, nunca de observação. Sem causalidade/autoria presumida. Desconhecidos não atribuídos; mimos/assinaturas/renovações separados. Estornos/cancelamentos não somam vendas confirmadas. Sem comissões.
- Qualidade humana em 5 critérios, opções adequado/atenção/não avaliável. Sem texto de conversa, identificação de assinantes, IA ou pontuação disciplinar automática.
- CSV com período/amostra, correções e auditoria. Retenção proposta máxima de 90 dias para métricas/avaliações quando autorizada, exclusão antecipada. Sem HTML, screenshots, mensagens, imagens, áudio ou vídeo no banco.

## Decisões de arquitetura
- React 19 + React Router, shadcn/Radix, Lucide, Sonner; identidade Vértice; DM Sans/Manrope.
- FastAPI modular: `core.py`, `auth_routes.py`, `people.py`, `metrics.py`, `reporting.py`, `stations.py`, `schemas.py`, `responses.py`.
- MongoDB/Motor somente pelo MONGO_URL existente, timezone UTC-aware, índices únicos (e-mail, turno ativo por criadora, evento por referência), TTL nativo. Não há cron ou agendamento adicional.
- Sessões próprias opacas aleatórias, hash no MongoDB, cookie Secure/HttpOnly/SameSite=Lax, expiração 12h; scrypt para senhas. Não são sessões Privacy. RBAC imposto no servidor.
- URLs protegidas do ambiente preservadas. CORS e proteção de origem em allowlist exata: APP_ORIGIN público e INGRESS_APP_ORIGIN (reescrita observada no encaminhamento). URL pública segue sendo a origem dos links/pacote local.
- Observações estritas sem campos livres de conteúdo. HMAC local para referências, payloads com hashes/timestamps/valores/status. Atribuição por turnos calculada ao consultar para refletir correções.
- Componente Windows em `/app/local-agent`: Python/Tkinter + Playwright Chromium visível, requests exclusivamente para o próprio painel, keyring/Windows Credential Manager para token próprio e segredo HMAC. Pasta de perfis em LOCALAPPDATA, lock msvcrt por perfil.
- Pareamento de código único de 10 minutos, token revogável, uma estação ativa, heartbeat, fila autenticada de abertura com expiração e confirmação local. Sem API localhost aberta ou controle cloud direto do Windows.
- Pacote ZIP autenticado gerado pelo backend com URLs públicas de configuração, scripts Instalar.bat/Iniciar.bat, documentação e fontes. Requer Windows 10/11 e Python 3.11+. Não é instalador EXE assinado.
- Adaptador local **desabilitado por padrão e sem seletores Privacy presumidos**. Mapeamento técnico explícito de elementos visíveis e atributos reais; precisa de horários ISO com fuso, direção e índices numéricos consecutivos reais para chat. Sem esses dados a métrica permanece indisponível. Sem alternativa oculta por API. Revalidação após 30 dias.

## Implementado — 2026-09-28
- Primeiro cadastro do gestor, login/logout, permissões gestor/chatter, limite de tentativas de login.
- Catálogo CRUD de criadoras, cores/identificador, busca, filtros, grade/lista, estado de sessão e turno; erros reais quando não há estação.
- Equipe com criação/desativação e edição de permissões. Turnos início/pausa/retomada/encerramento; unicidade e proteção concorrente; correção de intervalos passados com auditoria e detecção de sobreposição.
- Operação: média/mediana, pendências, atrasos, amostra e registros incompletos; herança na troca de turno; filtros por criadora/operador/período.
- Vendas: confirmação/origem/situação/valor, totais sem estornos/cancelamentos, desconhecidos, associação temporal ou ajuste manual explícito com motivo/histórico, sem comissões.
- Qualidade: bloqueio sem turno pausado e navegador local aberto/atualizado, reconhecimento do efeito de leitura, revisão estruturada e finalização sem retomar automaticamente o atendimento.
- CSV UTF-8 BOM e proteção contra fórmulas, exportação de operação/vendas/qualidade/auditoria.
- Configurações de agência, meta, retenção 1–90 dias, opt-in de armazenamento inicialmente **desativado**, exclusão antecipada; desativação remove métricas/avaliações.
- Pacote Windows, pareamento, revogação, comandos/heartbeat e leitor condicional implementados. Nenhuma conta privada foi acessada.
- Estados distintos sem dados, leitura não validada, pausa, amostra parcial e interrupção. Nenhum percentual artificial de cobertura nem receita fabricada.
- Correções de QA: origem reescrita pelo encaminhamento, descrições acessíveis de dialogs, opções nativas sem span aninhado, validação de datas futuras no cliente e precisão de intervalos, timezone de comandos locais, serialização pública via Pydantic e isolamento concorrente de revisão/retomada.

## Evidência de validação — 2026-09-28
- Agente de testes: `/app/test_reports/iteration_1.json`, `iteration_2.json`, `iteration_3.json`.
- Primeira interrupção foi credencial de fixture com domínio `.test` reservado; corrigida para `example.com`, sem relaxar validação de e-mail do produto.
- Bloqueio real de origem identificado na segunda iteração; corrigido com allowlist explícita do ingresso. Login e escritas pela interface novamente funcionais, sem injeção de cookies.
- Última regressão: **14/14 testes passaram** em execução serial; `/app/test_reports/pytest/final-regression.xml`.
- Compilação frontend e sintaxe backend/agent aprovadas; `/app/test_reports/frontend-build.log`.
- Fluxos de UI testados: login/logout, criadoras CRUD/busca/filtros/grade-lista/turnos, operador e permissões, chatter restrito, correção, qualidade, configurações, downloads CSV e ajuste de venda. Desktop e celular sem overflow horizontal segundo QA.
- Última checagem visual confirmou restrição de datas futuras, navegação e ausência dos avisos de Dialog/option; falhas intermediárias de automação decorrentes de clique durante animação e formato de fill de datetime foram contornadas no teste, sem esconder falhas de produto.
- Pacote ZIP baixado e persistido via API externa: `/app/test_reports/Vertice-Windows-verified.zip`, íntegro com scripts/fontes/config; também houve evento de download no navegador.
- Dados e estações **sintéticos de testes** usados somente para validar protocolo/algoritmos e permitir fluxos de revisão. Não representam vendas, criadoras ou leitura real de Privacy. Não há API de produção simulada.
- Runtime Windows, compatibilidade Chromium/Privacy e leitura nas telas reais **não validados**. Teste de reader usou fixture de retorno DOM, não acesso à conta real. Não prometer monitoramento ativo ou integral.
- Limpeza final remove gestor temporário e fixtures sintéticas, mantendo índices e workspace pronto para primeiro cadastro. Credenciais temporárias não devem ser usadas pelo usuário.

## Backlog priorizado / próximos passos
### Atualização de marca e acesso — 2026-09-29
- Pedido literal: “qual o login e senha para teste? e o nome precisa mudar porque é um produto da alta deveria ser Alta Core. Este é o site da Alta Agency www.altaagency.com.br”.
- Escolha confirmada: “Aplicar também os logotipos enviados e a identidade visual do site da Alta Agency”, com pedido “se puder no logo mudar agency por core porque ai fica dentro do nome do produto”.
- Quatro PDFs originais preservados em `/app/brand-assets`. Assets derivados pelo script `/app/scripts/build_alta_brand.py` preservam os caminhos originais do símbolo e lettering alta; somente o descritor agency foi substituído por core em Poppins Light. Variantes horizontais/empilhadas branca/preta/vermelha e favicon publicados localmente.
- Site Alta consultado; vermelho oficial identificado no CSS: #C41E3A. Aplicados preto/branco/vermelho no login, menu e ações, com painel claro, texto grafite e estados positivos verdes/alertas âmbar preservados.
- Nome público Alta Core em title, metadata pt-BR, favicon, login, rodapé, carregamento, API health, relatórios CSV e pacote Windows. Pacote `Alta-Core-Windows.zip` inclui logos locais; novos perfis em pasta AltaCore. Identificadores internos de sessão/keyring e pasta antiga preservados por compatibilidade, não renomeados destrutivamente.
- Usuário solicitou acesso pronto: gestor `teste@altaagency.com.br`, nome Gestor de teste, workspace Alta Agency. Senha local em `/root/alta-core-test.env` (600). **Preservar esta conta após testes; a limpeza anterior da entrega inicial não se aplica a ela.** Nenhuma conta Privacy, nenhuma autenticação externa nova.
- Sem preenchimento com vendas ou métricas fictícias e sem ativação automática de retenção. Conta de teste tem permissão gestor; antes de usar dados reais, criar acessos nominativos e desativar o acesso compartilhado pela Equipe.
- QA `/app/test_reports/iteration_4.json`: 8/8 testes backend, login/logout real, nomes de arquivos e integridade ZIP, navegação desktop/mobile. Ajuste final do botão de fechar menu móvel: posição contida, largura responsiva e abertura sem transição de deslocamento; sidebar rolável em alturas menores.
- Limitação já existente mantida: execução Windows/compatibilidade das telas Privacy ainda dependem de validação na estação autorizada; a mudança de marca não habilita coleta por si só.

### P0 — dependências para monitoramento real
1. Usuário criar gestor e cadastrar perfis/operadores; instalar componente na estação Windows autorizada.
2. Validar abertura/isolamento/login manual na Privacy no computador real, sem transmitir credenciais.
3. Validar tecnicamente mapeamento de campos, sequência e semântica de vendas na conta autorizada; se atributos não existirem, manter métricas indisponíveis. Essa dependência não foi resolvida nesta construção.
4. Confirmar alcance de armazenamento mínimo, informação à equipe e retenção conforme autorização da agência; somente então ativar opt-in.
5. Comparar amostras locais com telas oficiais antes de declarar qualquer indicador integrado. Não habilitar coleta com seletores fictícios.

### P1 — evolução do MVP após piloto
- Instalador Windows assinado e simplificação assistida da validação de campos, sem flexibilizar regras de dados insuficientes.
- Paginação/otimização de relatórios para maior volume (consultas atuais limitadas a amostras de até 10 mil eventos e 1 mil registros em algumas listas).
- Recuperação/alteração de senha própria pelo fluxo definido da agência; não afeta credenciais Privacy.
- Melhores comparativos de turnos com amostras equivalentes, sem rankings disciplinares automáticos.

### P2 — fora do escopo inicial
- Operação distribuída em várias estações, permissões por equipe e relatórios individuais.
- Supervisão avançada. IA somente mediante escopo/autorização próprios; nenhuma integração de IA existe nesta versão.
- Não sincronizar cookies ou sessões prontas entre máquinas e manter a proibição de API Privacy em todas as fases.
