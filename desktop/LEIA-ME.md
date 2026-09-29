# Alta Pulse Desktop — Windows

Produto Alta Agency. Nome atualizado: Alta Pulse (anteriormente Alta Core). Navegador real integrado para criadoras autorizadas, com sessões isoladas no computador. Não é transmissão remota nem importação de sessões do Lauth.

## Aviso de distribuição
O código em desenvolvimento para 0.2.3 distingue respostas HTTP recusadas de uma página carregada e utiliza o endereço de login público mostrado pelo usuário. Não contém contato, reporte à Privacy ou alternativa de abertura externa. **NÃO é uma correção comprovada dos bloqueios do Windows ou da Privacy e NÃO adiciona assinatura digital.** A distribuição pública continua na versão indicada pelo manifesto; não há nova versão liberada apenas por existir este código em desenvolvimento.

O instalador continua SEM assinatura digital. O Windows, Smart App Control ou antivírus pode bloquear a execução. Não desative proteções, não adicione exclusões e não restaure arquivos em quarentena por orientação deste aplicativo. Se houver bloqueio, pare a tentativa. Assinatura legítima e validação Windows são pendências separadas; não se utiliza certificado autoassinado para contornar controles.

## Instalação e acesso
Windows 10/11 x64 e conexão com a internet. Execute o instalador Alta-Pulse, escolha a pasta do seu usuário e use o atalho Alta Pulse. Não precisa de Python nem de administrador Windows para a instalação por usuário. O aplicativo deve estar fechado durante atualizações.

Se o Windows permitir a execução, entre com seu próprio acesso. Os e-mails e as senhas existentes não mudaram com a marca. Senhas provisórias devem ser substituídas no primeiro acesso; depois podem ser trocadas em Minha conta. A senha da Privacy nunca é solicitada pelo painel.

As pastas de dados de instalações anteriores são reutilizadas no próprio computador, sem mover ou copiar cookies. Identificadores internos estáveis são mantidos por compatibilidade. Não transferir pastas entre máquinas. O desinstalador preserva perfis locais; a exclusão desses dados é uma ação separada, após encerrar sessões e confirmar a necessidade.

## Gestores e chatters
Gestores cadastram pessoas e definem criadoras autorizadas. Computadores de chatters precisam de aprovação em Computadores; autorizar a máquina não concede outras criadoras. Apenas gestores podem aprovar ou revogar.

Selecione uma criadora na barra lateral. Chatter inicia/retoma seu próprio turno. Gestor pode preparar login sem turno ou com atendimento pausado, sem assumir silenciosamente uma janela ocupada. Só um acesso integrado por criadora de cada vez; outro acesso precisa aguardar fechamento ou expiração da autorização.

## Sessão Privacy por computador
Login, senha, CAPTCHA e 2FA são digitados manualmente na página Privacy do navegador integrado. O aplicativo não lê nem envia essas credenciais. Cada instalação mantém uma partição local persistente por criadora.

O gestor pode preparar a sessão na própria máquina do chatter e sair apenas do Alta Pulse. O chatter então entra com sua identificação, computador e criadora autorizados. Fazer login em uma máquina NÃO autentica outra. Login único distribuído, sincronização de cookies/sessões e navegador remoto NÃO estão implementados.

## Recusa da Privacy (403/429)
A página pode recusar o navegador integrado mesmo abrindo no Chrome no mesmo computador. Isso indica uma diferença de acesso/compatibilidade, não comprova a causa nem autoriza contornar o bloqueio.

O aplicativo observa somente o código HTTP dos eventos de navegação da janela principal, sem interceptar rede ou ler o conteúdo das conversas. HTTP403/429 exibe aviso e não é substituído por “Página carregada” ao parar o carregamento. Não há repetição automática da navegação; recarregar/início ficam indisponíveis enquanto a recusa estiver registrada. A página de bloqueio permanece visível.

Por solicitação explícita do usuário, não há botão, envio automático, mensagem, relatório ou coleta para suporte da Privacy. As propostas de contato/reporte e de abertura externa foram retiradas antes de qualquer publicação de binário com esses recursos. Nenhum relatório foi enviado.

Não há alteração de User-Agent para fingir Chrome, rotação de IP, proxy, ocultação de automação, captura de cookies, acesso à API Privacy, alteração de TLS ou bypass de WAF/CAPTCHA. A investigação deve focar a compatibilidade do componente e do fluxo de navegação; não presumir causa específica nem tratar navegador externo como equivalente ao integrado solicitado.

## Segurança e limites
- Sandbox e isolamento de contexto ativos; sem Node/preload do aplicativo na Privacy. Nenhum flag de teste desativa essas proteções na distribuição Windows.
- Abertura exige autorização do servidor por usuário, dispositivo e criadora. Token próprio temporário vinculado à sessão Alta Pulse; não é cookie ou token da Privacy.
- Acesso expira sem renovação. Logout, falha de conexão, alteração de senha, revogação ou perda de permissão encerram a autorização. Não há atendimento offline.
- A revogação Alta Pulse não apaga nem revoga a sessão da plataforma Privacy. Acesso físico à máquina/pastas precisa ser protegido pela agência.
- Navegação limitada à origem HTTPS Privacy configurada. Pop-ups, destinos externos, protocolos especiais e downloads da Privacy não são liberados indiscriminadamente. Necessidades legítimas exigem validação prévia.
- Nenhuma API Privacy, interceptação de rede, extração de cookies, proxy, anti-detect, camuflagem, bypass, automação de cliques/mensagens/compras/saques.
- Atendimento humano usa as permissões nativas da conta; o aplicativo não garante bloqueio de ações financeiras que a própria conta permite.

## Monitoramento e validação
Este navegador integrado NÃO coleta nem envia textos, screenshots, HTML, mídia ou indicadores de conversas ao painel. Monitoramento automático continua desativado e depende de escopo/validação próprios. O componente assistido anterior não é conectado automaticamente.

Build e arquivo podem ser conferidos por checksum/extração, mas isso não comprova execução, login, CAPTCHA/2FA ou compatibilidade real da Privacy no Windows. Nenhuma conta privada foi acessada para validar esta distribuição. O bloqueio original permanece não confirmado como resolvido.

Electron/Chromium incluem LICENSE e LICENSES.chromium.html. Atualizações são manuais pela página oficial de download. Não instale de links desconhecidos e não altere as proteções para forçar a execução.