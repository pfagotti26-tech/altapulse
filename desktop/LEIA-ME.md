# Alta Core Desktop — versão inicial Windows

Produto Alta Agency. Este aplicativo instalado apresenta os perfis autorizados na barra lateral e um navegador Chromium real integrado na mesma janela. Não é iframe, transmissão de navegador remoto nem importação de sessões do Lauth.

## Instalar
Windows 10/11 x64 com internet. Execute Alta-Core-Setup, escolha a pasta de instalação do seu usuário e abra o atalho Alta Core. Não precisa de Python, PowerShell, conta de administrador Windows ou componente separado. Faça login com seu próprio acesso Alta Core.

Esta versão NÃO possui assinatura digital. O Windows/antivírus pode mostrar aviso. Não desative proteções. Verifique a procedência e o SHA-256 publicado na página de download. O instalador foi compilado, mas a execução real Windows e a compatibilidade Privacy ainda precisam ser validadas em estação autorizada.

## Gestores e chatters
- Você e Fernanda podem ter usuários distintos com função Gestor, cadastrados em Equipe e turnos. Nenhum e-mail pessoal ou credencial foi presumido pelo instalador.
- Computadores que entram com gestor são autorizados para o próprio gestor. Novos computadores de chatters aguardam aprovação em Computadores.
- Autorizar computador NÃO concede todas as criadoras: o gestor também define as criadoras permitidas no cadastro do integrante.
- Selecione uma criadora na lateral. Chatter inicia/retoma seu turno antes do navegador; gestor pode preparar login sem turno quando não existe atendimento em andamento, ou com turno pausado.
- Somente um acesso integrado por criadora de cada vez. Outro computador deve aguardar o perfil ser fechado ou a autorização expirar. Não há tomada silenciosa do atendimento.

## Onde ocorre o login Privacy
O administrador digita usuário, senha, CAPTCHA e 2FA diretamente na página Privacy dentro do navegador. O Alta Core não lê, guarda em banco, envia ou transfere essas credenciais. A sessão pertence ao Chromium LOCAL.

Cada instalação mantém uma partição persistente por criadora. A mesma instalação pode alternar o usuário Alta Core de gestor para chatter autorizado, sem mover arquivos da sessão. Isso não é sincronização: em OUTRO computador é necessário novo login direto na Privacy. Para uma primeira autenticação feita pelo gestor na máquina do chatter, o gestor acessa o Alta Core nessa máquina, autentica o perfil Privacy e sai do gerenciador; o chatter entra com sua própria identificação e computador autorizado.

## Login único entre computadores — NÃO IMPLEMENTADO
O usuário indicou interesse também em login único liberado para vários computadores. Essa funcionalidade exige arquitetura separada (por exemplo navegador remoto compartilhado) e validação de escopo, infraestrutura e autorização. Nesta versão não se copiam cookies, tokens, senhas ou arquivos de perfil entre computadores, e não se promete esse compartilhamento.

## Isolamento e revogação
- Sandbox e contextIsolation ativos; nodeIntegration e ferramentas de desenvolvimento desativados no conteúdo Privacy. Nenhum preload Alta Core é carregado na Privacy.
- A interface Alta Core pode pedir apenas operações limitadas; cada abertura é autorizada novamente no servidor com usuário, criadora e computador.
- Após seu login Alta Core, um código temporário de uso único autoriza o processo nativo. O token próprio fica somente na memória do aplicativo, não vai para a página Privacy e depende da sessão Alta Core original. Isso não copia nenhum cookie da Privacy nem extrai os cookies do painel.
- Autorização de navegador expira em 45 segundos e é renovada a cada 10 segundos. Falha de conexão, pausa/fim de turno, perda de permissão ou revogação fecha o navegador na próxima verificação. Não há modo de atendimento offline.
- Logout fecha os navegadores desta instalação, mas não apaga a sessão Privacy persistente. Revogar o acesso Alta Core não equivale a revogar a sessão na plataforma. Para revogar completamente a conta Privacy, use os controles da própria Privacy e proteja o usuário Windows/disco.
- Não compartilhe pastas de perfil. Não há importação/exportação dessas pastas pelo aplicativo.
- Somente origem Privacy HTTPS explicitamente configurada pode ser aberta. Pop-ups, destinos externos, protocolos especiais e downloads da página Privacy são bloqueados. Se uma etapa legítima precisar de outro domínio ou permissão, ela precisa de validação antes de liberação; não existe contorno automático.

## O que o aplicativo não faz
Sem API Privacy, interceptação de tráfego, cookies.get/exportação de tokens, proxy, anti-detect, camuflagem, bypass de CAPTCHA/2FA, automação de cliques, mensagens, compras ou saques. O atendimento é realizado manualmente pela pessoa no site. O acesso humano à interface Privacy continua sujeito às permissões nativas da conta; Alta Core não é uma garantia de bloqueio de ações financeiras dentro do site.

Este navegador não envia mensagens, HTML, mídia, screenshots ou conteúdo de conversas ao painel. A leitura automática de indicadores permanece DESATIVADA e depende de escopo e validação próprios. O componente assistido anterior não se conecta automaticamente a este navegador.

## Licenças e manutenção
Electron/Chromium incluem LICENSE e LICENSES.chromium.html junto ao executável. Interface Alta Core e marca Alta Agency. Atualização nesta versão é manual: instale a nova versão disponibilizada no site, com o aplicativo fechado. Não há atualização automática de binários. Não instale de links desconhecidos.

## Limite da validação
Build produzido em Linux ARM64 para Windows x64, compilado com NSIS. Cabeçalho PE, pacote, checksum, APIs de permissão e interface web podem ser verificados automaticamente. Isso NÃO prova renderização nativa, login, CAPTCHA, GPU ou compatibilidade da Privacy no Windows. Nenhuma conta privada foi acessada na construção.