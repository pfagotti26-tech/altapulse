# Alta Pulse — Piloto Chrome real (0.3.0)

PROTÓTIPO EXPERIMENTAL para Windows 11 x64. Não substitui o Alta Pulse regular0.2.2 e NÃO comprova correção do WAF403 da Privacy. O comportamento de encaixe, foco, escalas de tela e janelas auxiliares depende de validação real no Windows. Google Chrome não fornece contrato oficial estável para esse encaixe de janela.

## Antes de abrir
- Google Chrome legítimo já instalado no Windows. O piloto procura as instalações padrão e valida a assinatura local e o publicador Google antes de executá-lo. Não baixa nem modifica o Chrome.
- Instalador, aplicativo piloto e componente de encaixe ainda NÃO têm assinatura digital. O Windows pode bloqueá-los. Não desative antivírus, Smart App Control, TLS, sandbox ou outras proteções para forçar a execução.
- Use o mesmo acesso pessoal Alta Pulse. O piloto aparece como outro computador/instalação; permissões e regras de aprovação continuam no servidor. Não há acesso livre às contas das criadoras.

## O que acontece ao abrir uma criadora
1. O servidor valida seu usuário, computador, criadora e turno. Uma reserva impede dois acessos simultâneos à mesma criadora.
2. O piloto inicia o Chrome instalado, com um perfil novo e exclusivo dessa criadora, dentro da pasta de dados do PILOTO. Só usa --user-data-dir e --app com endereço público de login configurado.
3. Um componente Windows encaixa APENAS a janela daquele processo Chrome recém-iniciado e seu grupo de processos. Nunca procura por título para anexar uma janela pessoal.
4. O estado “Chrome encaixado” só aparece depois de confirmar o parentesco das janelas. Isso NÃO confirma que a página Privacy carregou, aceitou o navegador ou efetuou login.
5. Você navega e digita manualmente. “Focar Chrome” só passa o foco do teclado para a janela; não digita nem envia mensagens. Voltar/recarregar são manuais pelos controles/atalhos do próprio Chrome; não há automação de navegação.

O Chrome pode aparecer brevemente como uma janela separada durante a abertura. Isso não é contado como sucesso do encaixe. Se o encaixe falhar ou for perdido, o processo do piloto é encerrado e o erro é mostrado. Pop-ups e caixas auxiliares legítimas do Chrome podem aparecer em janelas separadas; isso é uma limitação do protótipo, não uma reprodução completa do Lauth.

## Sessões e dados
- Produção0.2.2: pastas e credenciais locais existentes permanecem intactas.
- Piloto: `%APPDATA%\Alta Pulse Chrome Pilot`, com `ChromeProfiles\<identificador interno>` por criadora. Não utiliza nem migra o perfil pessoal Chrome ou os perfis do aplicativo regular.
- Cada primeiro perfil precisa de novo login manual na Privacy. Depois, o próprio Chrome pode manter a sessão naquele perfil enquanto válida. Não há cópia de cookies/sessões entre computadores ou produtos.
- Não ative sincronização pessoal do Chrome nesses perfis. Faça somente o acesso autorizado necessário ao site.
- Credenciais da Privacy são digitadas diretamente no Chrome. Alta Pulse não lê DOM, cookies, senhas, conversas, telas ou rede; não consegue verificar qual conta está conectada no Chrome.
- Não existe CDP, WebDriver, porta de depuração remota, mudança de User-Agent, ocultação de automação, proxy, relatório/contato com Privacy ou bypass de WAF/CAPTCHA.
- Não há monitoramento de mensagens ou métricas neste piloto. Um perfil Chrome novo pode continuar bloqueado mesmo que o perfil pessoal existente funcione; não há garantia de aceitação.

## Encerramento e segurança
Logout, revogação, perda da autorização ou falha de comunicação encerram somente a janela/processos iniciados pelo piloto para aquela abertura, liberando a reserva. O componente usa um Job Object próprio do Windows com encerramento dos processos filhos; ele NÃO encerra todo processo chamado chrome.exe. O Chrome pessoal não pertence a esse grupo.

O componente usa um protocolo local limitado a dimensões, foco e fechamento. Não recebe comandos de shell, credenciais, URL arbitrária, IDs de janelas escolhidos pelo renderer ou instruções de rede. A assinatura do Chrome é conferida com o cache de confiança do Windows, sem relatório a serviços da Privacy.

## Limites da validação da entrega
O helper e o instalador podem ser compilados e conferidos em Linux para Windows x64; testes locais verificam formatos, limites e protocolo. Isso NÃO prova encaixe real em Windows, renderização, teclado, pop-ups, comportamento em100/125/150/200% de escala ou aceitação pela Privacy. O problema anterior da Privacy permanece aberto até confirmação real.

Instalação separada, atalho “Alta Pulse - Piloto Chrome” e desinstalador próprio. Atualização manual. A remoção preserva os perfis do piloto, sem tocar os dados da versão regular. Electron/Chromium incluem suas licenças junto ao executável; Google Chrome é a instalação existente do usuário.