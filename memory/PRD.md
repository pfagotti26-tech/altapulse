# Alta Pulse — Gerenciador de criadoras e supervisão de chatters

## Pedido original
“Você consegue criar um sistema que entra num sistema de uma privacy.com.br já logado porque sou uma agência autorizado pela criadora a operar na conta para que fique monitorando as conversas dos chatter que atuam na conta, verifique o tempo de resposta, a condução de mensagem que está sendo trabalhada, vendas realizada por aquele chatter no período. Me responda antes de fazer e qual seria a proposta”.

O usuário aprovou posteriormente o plano completo **Gerenciador de criadoras e supervisão de chatters**, preservado em `/app/plan/plan.md`, e autorizou a execução: **“Painel em português, componente Windows, revisão manual e nenhuma API da Privacy.”** Só a fase 1 pertence à construção inicial. A aprovação de visualização relatada pelo usuário não foi ampliada para permissão de cópia de conversas, acesso por API ou uso de IA.

## Personas
- Gestor da agência: cadastra criadoras e operadores, define acesso, supervisiona turnos, revisa atendimento na estação local, consulta resultados e corrige registros com justificativa.
- Chatter: acesso próprio ao gerenciador, somente criadoras autorizadas e controles do próprio turno; login Privacy é separado e local.
- Criadora: titular da conta operada pela agência conforme autorização informada; perfis e sessões precisam permanecer separados.

## Requisitos estáticos
- Interface PT-BR, clara, grafite, estados verdes/âmbar/vermelhos; rotas separadas Criadoras, Operação, Vendas, Qualidade, Equipe e turnos, Relatórios, Configurações. Responsiva; sem fotos/conteúdo íntimo.
- Escopo inicial: uma estação Windows com componente assistido. Ampliação solicitada em 2026-09-29: aplicativo desktop com instalações em computadores distintos, perfis locais por criadora e autorização de dispositivos. Não usar perfil pessoal; impedir abertura simultânea da mesma criadora no navegador integrado. Login/2FA/CAPTCHA manuais diretamente na Privacy, por computador.
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
### WAF403 e proibição de contato com Privacy — 2026-09-29
- Usuário forneceu print do aplicativo em execução no Windows: navegador integrado carrega página da Privacy “ACESSO BLOQUEADO -403”, “Sua solicitação foi bloqueada”, código WAF-403, antes do login. Isso evidencia que a janela nativa está rodando naquele cenário, mas NÃO que a compatibilidade Privacy foi resolvida.
- Confirmou mesmo notebook/rede com Chrome normal carregando a tela pública `https://privacy.com.br/auth?route=sign-in`. Não houve comprovação de login concluído na conta privada. Não transcrever nem armazenar as credenciais/dados pessoais visíveis nos prints.
- O código publicado0.2.2 inicia pela origem Privacy; o Chrome mostrado está na rota pública de login. Código candidato usa `PRIVACY_LOGIN_URL` igual à rota fornecida e `navigation.cjs` para classificar resultadoHTTP de navegação principal sem interceptar tráfego/ler DOM. Fatores como versão, perfil, redirecionamento e identificação são HIPÓTESES, sem causa raiz confirmada. Não alegar saber a implementação proprietária ou permissões internas do Lauth.
- Usuário cobrou a diferença em relação ao Lauth e proibiu expressamente “não quero que reporte nada para eles”. **Não houve nem deve haver envio de relatório, mensagem, credencial, print ou conteúdo privado ao suporte da Privacy. Não condicionar a investigação a contato/solicitação de autorização especial.** Consultas anteriores foram apenas documentação pública.
- Propostas não publicadas de copiar diagnóstico, abrir suporte e abrir navegador externo foram RETIRADAS: `external-actions.cjs` excluído, IPCs/métodos de preload/URLdeSuporte/açõesUI removidos. Não apresentar navegador externo como equivalente à experiência integrada solicitada.
- Nova indicação web para clientes antigos: “Janela aberta · acesso não verificado”, sem sugerir Privacy disponível só porque o loading terminou. Código nativo candidato distingueHTTP403/429 bloqueado, outrosHTTP>=400 erro, sucesso2xx/3xx e resposta não confirmada; did-stop-loading não sobrescreve recusa. Não há retries automáticos. Esses ajustes não resolvem a aceitação pela Privacy.
- **Versão pública permanece0.2.2** (nomePulse/hash d8277227bdca75fe87e1e9cb9f0e77e6dc26d5e2adaf7536f5f621bc1e2ecb41). Código0.2.3 existe apenas em desenvolvimento, SEM installer distribuído; não indicar “atualize para0.2.3” enquanto não publicado. Bloqueio temporário de publicação foi removido e o download0.2.2 preservado.
- Restrições: sem alteração de User-Agent para fingir outro navegador, proxies, rotação de IP, captura/transferência de cookies, APIPrivacy, enfraquecimentoTLS, bypassWAF/CAPTCHA ou acesso a contas privadas nos testes. Nenhuma integração/APIdeprodução simulada.
- Verificação obrigatória após alterações pelo testing_agent: `/app/test_reports/iteration_11.json`, **7/7 testes passaram** para remoção de reporte, contrato público0.2.2 e watcherHTTP com eventos SINTÉTICOS EventEmitter. Nenhuma chamada de rede à Privacy, nenhuma fixture em dados reais. Artefatos de teste não comprovam aceitação Windows/Privacy.
- **BUG ORIGINAL CONTINUA ABERTO**: o Alta Pulse ainda não entrega a mesma experiência integrada demonstrada no Lauth para esse acesso. Próxima investigação deve focar o componente/fluxo de navegação real, sem transferir a responsabilidade ao usuário e sem afirmar causa ou solução ainda não demonstradas.

### Distribuição Alta Pulse 0.2.2 — 2026-09-29
- Após a troca apenas do logotipo, o usuário pediu expressamente: “ok, me passe por favor o link de instação e vamos tentar instalar assim mesmo, mas agora com o nome certo alta pulse”. Isso confirma a atualização completa do nome público do produto/instalador, sem solicitar separação gestor/chatter, remoção de proteções ou assinatura fictícia.
- Novo instalador compilado: `Alta-Pulse-0.2.2-Setup-x64.exe`, executável interno `AltaPulse.exe`, metadados/menus/títulos/atalhos públicos Alta Pulse. Interface, título HTML, textos de login/conta/download, CSV e pacote assistido legado alinhados à marca. Credenciais, funções e banco de dados preservados.
- Arquivo publicado com 114.903.998 bytes e SHA256 `d8277227bdca75fe87e1e9cb9f0e77e6dc26d5e2adaf7536f5f621bc1e2ecb41`. Link público existente `/api/desktop/download/windows` serve a nova versão; página `/baixar` exibe aviso de que renomear não corrige bloqueio Windows. Publicação atômica após build; não alterar certificado/reputação artificialmente.
- Compatibilidade de dados locais: processo nativo reutiliza a pasta anterior Alta Core quando existe machine.json; novas instalações usam Alta Pulse. Sem copiar/exportar cookies ou sessões. IDs internos estáveis de cofre/sessão/registro mantidos; NSIS detecta caminho anterior quando disponível, atualiza atalhos e mantém uma entrada de desinstalação. Compatibilidade lógica de código/pacote não equivale a upgrade validado no Windows real.
- Verificação OBRIGATÓRIA pelo testing_agent: `/app/test_reports/iteration_10.json`, **6/6 testes aprovados** para release, download completo/hash/cabeçalhos, extração NSIS e payloadPE32+ x64/ASAR, ZIP legado e nomes CSV. UI desktop/mobile, texto de advertência, logo/title e ajuda de integridade aprovados. Não foram criadas fixtures nem alteradas contas reais.
- Build frontend compila e Python compila. Comentários internos remanescentes da marca anterior ajustados; nomes legados deliberados para compatibilidade não indicam perda de branding público.
- **O bloqueio original do Windows NÃO está corrigido nem validado como resolvido.** O usuário confirmou Controle Inteligente de Aplicativos ATIVADO, mas não há evento específico confirmando a causa. A hipótese de bloqueio por aplicativo desconhecido/sem assinatura foi explicada sem tratá-la como certeza.
- Instalação continua sem assinatura digital (`signed=false`), Windows real não validado (`windows_validated=false`), sem sincronização de sessão e sem monitoramento automático ativado. Não orientar desativação de SAC/Defender, liberação de quarentena, exclusões, certificados autoassinados ou renomeação como evasão. Se bloquear de novo, interromper a tentativa.
- Próximas dependências separadas: assinatura legítima de código/validação do publicador (se escolhida pela agência) e comprovação do cenário Windows antes de declarar a instalação resolvida. A distribuição Pulse solicitada não substitui essa etapa.

### Logotipo Pulse e bloqueio do instalador — 2026-09-29
- Pedido literal: “favor substituir o core do logotipo por pulse. E também mostrou quando tentei executar que não tenho permissão para executar”. Foi solicitada clarificação sobre momento do erro e alcance da marca. O usuário enviou apenas o print; por padrão conservador foi alterado SOMENTE o descritor do logotipo para Pulse, preservando nomes das telas, instalador, sessões, permissões e distribuição atual.
- Brand.jsx usa assets novos `/brand/alta-pulse-*` (horizontal/empilhado, branco/preto/vermelho), alt Alta Pulse. Símbolo e lettering alta originais preservados; aliases de arquivos anteriores também recebem a arte atualizada para compatibilidade. Margem inferior preserva o descendente da letra p. Não foi prometida renomeação completa do produto.
- Print identifica falha ANTES da instalação ao abrir `C:\Users\SAMSUNG\Downloads\Alta-Core-0.2.1-Setup-x64.exe`: “O Windows não pode acessar o dispositivo, caminho ou arquivo especificado. Talvez você não tenha as permissões adequadas para acessar o item.” O aviso não confirma causa, não é erro de login Alta Core e não demonstra por si só SmartScreen/antivírus/assinatura/política corporativa.
- O executável não foi reempacotado, renomeado ou alterado como tentativa de contornar proteção. Permanece v0.2.1, 114.965.344 bytes, SHA256 `71f3612df4fae7f0d08805e5805948369792cb4ca5c7bb50eb90e172f64c487a`.
- Acrescentada ajuda em `/baixar#ajuda-instalacao`, com leitura local opcional do arquivo escolhido: compara tamanho e SHA256 no navegador via WebCrypto, sem upload, execução, instalação ou alteração das proteções. Resultado correspondente comprova somente igualdade ao arquivo publicado, NÃO segurança absoluta/autorização Windows. Arquivo diferente ou incompleto gera aviso para não executar.
- Orientações somente de diagnóstico: conferir existência/conclusão do download, consultar Segurança do Windows → Proteção contra vírus e ameaças → Histórico de proteção, ou responsável TI quando computador gerenciado. Não orientar desativação, bypass, liberação de quarentena ou execução elevada indiscriminada.
- Agente de testes obrigatório chamado após as mudanças. `/app/test_reports/iteration_9.json`: logos/fluxos desktop e mobile aprovados; download completo coincide com manifesto e arquivo local; NSIS passa `7z t` e extração; payload AltaCore.exe é PE32+ x86-64. Bootstrap PE32 NSIS é esperado, não incompatibilidade arquitetural. Instalação configurada por usuário (`RequestExecutionLevel user`, LOCALAPPDATA).
- Testes UI do verificador local: arquivo original→íntegro; truncado→tamanho diferente; mesmo tamanho alterado→SHA diferente; nenhum upload do conteúdo. Compilação frontend aprovada.
- **BUG WINDOWS CONTINUA NÃO RESOLVIDO / NÃO REPRODUZIDO** no ambiente Linux. Não declarar correção, funcionamento Windows, ausência de bloqueios ou segurança do arquivo com base nesses testes. Próxima dependência: obter evento local no horário da tentativa e confirmar se o arquivo ainda existe no Downloads.
- Observação de QA sobre401 de auth/me em sessão anônima é resposta esperada ao carregamento inicial sem login, não perda de autenticação nem motivo do erro Windows. Não relaxar controles para suprimir esse status.
- Fonte Microsoft consultada: https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions . A documentação confirma que apps sem assinatura podem ser bloqueados pelo Smart App Control quando não confiáveis; isso é hipótese possível, NÃO diagnóstico confirmado deste computador. Uma assinatura legítima é dependência futura, não foi fabricada nem adicionada.

### Acessos nominativos e troca de senha — 2026-09-29
- Usuário decidiu explicitamente **não alterar a distribuição/downloads por enquanto**. Não separar instaladores gestor/chatter, não restringir novo link, não implementar multiagências nesta alteração.
- Pedido: link para instalar nos notebooks dele e de Fernanda, acessos gestores para `pfagotti26@gmail.com` e `fernanda.fagotti1@gmail.com`, com senhas provisórias substituíveis no próprio sistema.
- Criadas duas contas reais ativas de gestor: Admin Alta (nome pessoal não informado) e Fernanda. Senhas provisórias aleatórias distintas guardadas somente em `/root/alta-manager-onboarding.env` (600), fora de repositório/instalador; armazenadas no banco somente por scrypt. Não enviados e-mails automáticos.
- Ambas começam com `must_change_password=true`. Primeiro login abre a criação da senha pessoal, com senha atual/provisória, nova senha e confirmação. Restrições também no servidor: antes da troca só auth/me, auth/password e logout são permitidos; não há bypass por URL ou por token nativo.
- Nova página `/minha-conta`, acessível pelo nome no menu lateral com texto “Minha conta · Alterar senha”, para gestor ou chatter. Troca exige senha atual e nova diferente, mínimo10 caracteres com letras/números; campos mostrar/ocultar, validação de confirmação e mensagens claras.
- `POST /api/auth/password` rotaciona a sessão atual, invalida outras sessões/tokens/tickets/reservas nativas somente do mesmo usuário e grava auditoria sem senhas/hashes. `auth_version` impede uso de sessões/tokens antigos inclusive em concorrência com login. Limite5 tentativas de senha atual incorreta em15 minutos.
- Não implementado esqueci senha, recuperação por e-mail ou consulta/admin visualizando senhas. A mudança não altera credenciais Privacy.
- QA em `/app/test_reports/iteration_8.json`: **7/7 testes aprovados**, fluxos web/mobile e proteção de sessões. Contas reais testadas apenas com login/me/logout; **senhas provisórias e flags de primeiro acesso preservadas** para a entrega. Trocas exercitadas somente em fixtures próprias.
- Instalador0.2.1 e SHA-256 permanecem inalterados (`71f3612df4fae7f0d08805e5805948369792cb4ca5c7bb50eb90e172f64c487a`). Download público atual: `/api/desktop/download/windows` e página `/baixar`. Não afirmar que downloads gestor/chatter já foram separados.
- Conta de teste compartilhada existente e criadora real Mel Martins preservadas. Recomenda-se futuramente desativar acesso compartilhado após os gestores confirmarem seus acessos pessoais; não foi desativado sem solicitação.

### Aplicativo desktop e distribuição — 2026-09-29
- Pedido do usuário: aplicativo instalado para ele e a sócia Fernanda, criadoras na lateral e navegador dentro do sistema como no Lauth, com botão de instalação fácil para chatters no próprio site Alta Core.
- Referência https://lauth-lp.framer.website/ analisada; anuncia perfis isolados, grupos e permissões de equipe, mas não documenta o mecanismo de sessão. Não foram reproduzidos recursos anti-detect, proxies, camuflagem ou garantias de evitar bloqueios.
- Na clarificação, o usuário marcou ambos os modelos: login direto por computador e login único do admin distribuído para computadores. Foi comunicado antes de construir que esta entrega implementa **login local por computador**; login único entre máquinas exige arquitetura adicional. Não considerar o modelo B entregue.
- Novo `/app/desktop`: Electron 44.4.5, WebContentsView nativo (não iframe/webview), sandbox/contextIsolation ativos, Node desativado na Privacy, sem preload Alta Core no conteúdo externo. Chromium persistente isolado por instalação+criadora; administradores podem autenticar diretamente na máquina do chatter e trocar o usuário Alta Core local, sem transportar arquivos ou cookies.
- Web React existente carregada pelo aplicativo; novas telas `/navegador/:creatorId`, `/computadores`, página pública `/baixar`. Barra lateral tem lista pesquisável de criadoras autorizadas para gestor/chatter. No navegador web comum, a área informa instalação necessária; não simula Privacy conectada.
- Download público na tela de login, `/baixar`, navegação autenticada e acesso do chatter. Instalador real Windows x64 NSIS, versão corrigida **0.2.1**, cerca de 110 MB, sem dependência de Python e sem exigência de administrador Windows. Atalhos e desinstalador por usuário; atualizações manuais. Pacote Python anterior preservado em Configurações → Componente assistido anterior, claramente separado.
- Novo backend `desktop_routes.py`: computadores do gestor aprovados para o próprio acesso; instalações de chatter pendentes até autorização de gestor; permissões de criadora continuam independentes. Revogação disponível, listagens por função. Fernanda NÃO recebeu conta com e-mail presumido; pode ser cadastrada como Gestor em Equipe e turnos com dados reais fornecidos pela agência.
- Reservas de navegador (`desktop_leases`) exclusivas por criadora, TTL45s e heartbeat10s; revalidação de usuário ativo, sessão Alta Core original, atribuição, computador e turno. Logout/revogação invalidam reservas. Chatter precisa do próprio turno ativo e não pausado; gestor pode preparar login sem turno ou com atendimento pausado, sem tomar janela ocupada.
- Autenticação nativa própria em `desktop_auth.py`: código temporário de uso único, 45s, vinculado à máquina e à sessão web Alta Core, trocado por token em memória no processo nativo. Somente rotas desktop aceitam esse token, sempre rechecando sessão de origem. Não lê/extrai cookies do painel ou Privacy; nenhum token chega à página Privacy ou ao instalador.
- Perfil integrado NÃO coleta mensagens/metadados, não envia conteúdos ao painel, não usa API Privacy e não ativa o leitor Python anterior. Indicadores continuam indisponíveis até validação específica de leitura. Atendimento e login são humanos.
- O instalador é **sem assinatura digital** e isso é exibido no download. Não desativar proteções Windows. Compatibilidade Windows/Privacy real não foi validada; a compilação e os testes abaixo não a substituem.

#### Validação desktop e correções
- `/app/test_reports/iteration_5.json`: 6/6 testes backend de permissões/dispositivos/reservas, 5/5 testes Node de política de URL/partição/bounds e fluxos web/mobile aprovados. Instalador completo anterior foi baixado e seu SHA-256 conferido via URL pública.
- Teste nativo adicional Linux arm64/Xvfb descobriu falha real de autenticação: session.fetch do processo nativo não recebia a sessão web. Corrigido com tickets próprios de uso único, sem extrair cookies. Relatórios intermediários iteration_6 e iteration_7 registram falhas já tratadas e não representam o estado final.
- Ajuste React StrictMode: abertura automática agendada/cancelável para evitar abertura duplicada durante montagem de desenvolvimento; aviso exhaustive-deps removido. Geração de abertura nativa cancela operações pendentes quando a rota fecha.
- Uma falha SIGTRAP adicional foi rastreada a `font_data_service_impl.cc: No space left on device` no `/dev/shm` de 64 MB do contêiner Linux. O teste isolado passou com `--disable-dev-shm-usage`; essa opção e `--no-sandbox` foram usadas SOMENTE no runner Linux root. **Não estão no aplicativo Windows publicado.**
- Resultado nativo final em `/app/test_reports/native-smoke-runtime/artifacts/native_smoke_result.json`: **25 passos aprovados**, incluindo login real Alta Core, ticket vinculado e uso único, registro, criação de reserva, WebContentsView com dimensões não nulas, partição distinta, ausência de preload/Node no conteúdo, fechamento/reabertura, desmontagem de rota, logout e recusa de token pós-logout.
- A página externa nesse teste foi substituída por `/api/health` SOMENTE na cópia isolada de teste (MOCKED stand-in). Não é integração Privacy validada nem endpoint simulado em produção. Nenhuma conta privada foi aberta. A configuração de distribuição usa PRIVACY_URL real da .env e nenhum flag de teste.
- Binário0.2.0 foi retirado de circulação durante a correção; manifesto0.2.1 será publicado atomicamente após build, com checksum. Não entregar o binário antigo como atualizado.
- Publicação concluída: `/api/desktop/release` retorna versão0.2.1 disponível; `Alta-Core-0.2.1-Setup-x64.exe`, 114.965.344 bytes; SHA-256 `71f3612df4fae7f0d08805e5805948369792cb4ca5c7bb50eb90e172f64c487a`. Manifesto e hash local verificados após a compilação final. Indicadores de assinatura, validação Windows, sincronização e monitoramento permanecem falsos, como divulgado.
- Preservar a criadora real Mel Martins (`e004895129b339393d0da552`), conta gestor de teste e quaisquer registros reais. Apenas fixtures TEMP_* e computadores do runner são removidos após QA.

#### Pendências deste novo escopo
- P0: validar instalação, janela nativa, entrada manual e eventuais redirecionamentos legítimos na Privacy usando Windows autorizado; mapeamento/monitoramento do chat ainda não implementado no navegador integrado.
- P0 separado: decidir arquitetura/autorização para login único do admin acessível em computadores distintos. Não há sincronização de cookies/sessões; eventual navegador remoto exigirá escopo próprio.
- P1: assinatura digital do instalador, atualização automática segura e política de revisão de versões do Chromium.
- P1: UI de exclusão de perfis locais e encerramento explícito de sessão Privacy; revogar Alta Core não é revogar a sessão da plataforma nem impedir acesso físico ao diretório de perfil.

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
