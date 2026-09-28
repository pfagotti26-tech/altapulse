# Gerenciador de criadoras e supervisão de chatters

Gerenciador próprio para abrir perfis de navegador separados por criadora e acompanhar o atendimento realizado pelos chatters na Privacy, sem depender do Lauth.
A consulta será exclusivamente pelas telas do navegador, como no acesso de um usuário, sem uso de API da Privacy, com indicadores operacionais e revisão manual de qualidade.

## Para quem

- Agência autorizada pelas criadoras a operar suas contas, conforme informado pelo solicitante.
- Gestor responsável por acompanhar atendimento, turnos, qualidade e resultados comerciais.
- Chatters que trabalham na mesma conta em turnos separados e passam a se identificar no gerenciador antes do atendimento.

## Funcionalidades e experiência principais

### 1. Criadoras e navegadores separados

- Lista de criadoras com nome, operador em atendimento, turno e situação do navegador e do acompanhamento.
- Comando **Abrir navegador** para iniciar o perfil dedicado à criadora no computador da agência.
- Sessões separadas para não misturar contas. A sessão permanece no perfil local enquanto for válida; a Privacy poderá exigir novo login ou verificação.
- Login, senha e verificações adicionais serão realizados diretamente na Privacy. O painel de gestão não receberá a senha nem cópias dos cookies da conta.
- O perfil de trabalho não será o perfil pessoal do navegador do operador. O gerenciador impedirá a abertura duplicada do mesmo perfil local.
- A primeira versão terá um aplicativo/componente instalado em Windows e um painel de gestão. Um painel web sozinho não acessa nem controla os navegadores do computador.

### 2. Leitura exclusivamente pela interface

- O usuário informou que o acesso permitido é como usuário, para ler informações, e que o acesso por API não é permitido. Essa é a restrição central do produto.
- A captura apresentada contém resposta atribuída ao Atendimento Privacy permitindo integração para consulta e gestão, limitada à visualização. O plano considera esse escopo informado; não o amplia para acesso irrestrito ou aprovação de qualquer forma de coleta.
- A leitura será limitada a informações efetivamente exibidas nas páginas autorizadas. Não haverá consultas a APIs públicas ou privadas da Privacy, interceptação de tráfego, chamadas ocultas ou extração de tokens de sessão.
- Não haverá envio automático de mensagens, disparos, mudanças de conteúdo, compras, saques ou outras ações financeiras. Também não haverá contorno de CAPTCHA, autenticação em duas etapas ou bloqueios.
- O navegador continuará carregando o site normalmente. A proibição de API se refere à integração com a Privacy, não à comunicação do nosso aplicativo com seu próprio painel.

### 3. Dois modos de supervisão

**Acompanhamento do atendimento**

- Observa as conversas e os registros que o chatter abre durante seu trabalho, sem clicar, rolar ou trocar sua conversa automaticamente.
- Registra os indicadores possíveis com base no que foi observado, mostrando a última leitura e as limitações da amostra.
- Conversas não abertas, trechos ainda não carregados e vendas fora das telas consultadas não serão tratados como dados conhecidos.

**Revisão pelo supervisor**

- Revisão local, iniciada pelo gestor, com navegação visível nas conversas permitidas e sem envio de mensagens pelo sistema.
- O atendimento daquele perfil deverá estar pausado durante a revisão que utilize a mesma janela. O supervisor manterá o controle para abrir, continuar ou interromper a consulta.
- A revisão permitirá verificar contexto e registrar avaliações estruturadas. Não haverá varredura autônoma de todas as conversas no MVP.
- Abrir uma conversa pode marcá-la como lida na Privacy. Esse possível efeito será informado antes da revisão; não será prometida leitura invisível ou sem efeitos.
- O painel remoto exibirá métricas e avaliações, não uma cópia das conversas nem uma transmissão da tela do operador.

### 4. Operadores e turnos

- Acesso próprio ao gerenciador, com função de gestor ou chatter. As credenciais do gerenciador serão distintas das credenciais da Privacy.
- O gestor cadastra operadores e define as criadoras às quais cada um tem acesso. O chatter identifica-se e inicia ou encerra seu turno.
- Somente um responsável por criadora em cada intervalo. Períodos sem turno ficarão sem atribuição; conflitos serão sinalizados, não resolvidos por adivinhação.
- O gestor poderá corrigir turnos e atribuições, sempre com motivo e histórico da alteração.
- Identificação no gerenciador melhora a responsabilidade operacional, mas a conta compartilhada não fornece prova nativa de quem digitou cada mensagem. Os resultados continuarão identificados como associados ao operador e ao turno registrados.

### 5. Tempos, pendências e cobertura

- Tempo médio e mediano de resposta, volume de atendimentos observados, fila de pendências e quantidade de atrasos, com filtros por criadora, operador e período.
- Cada espera começa na primeira mensagem do assinante após a última resposta da conta e termina na próxima resposta. Mensagens consecutivas do assinante não reiniciam o relógio.
- Meta inicial de cinco minutos, ajustável pelo gestor, com avisos visuais no painel.
- Na troca de turno, a espera total não será zerada. A pendência será identificada como herdada e a resposta será associada ao turno em que ocorreu.
- Só serão calculados tempos quando os horários e a sequência forem suficientes. Registros incompletos não entrarão nas médias como zero.
- O painel distinguirá coleta ativa, pausada, interrompida, sem dados e cobertura parcial. Não exibirá percentual de cobertura quando o total da conta for desconhecido.
- Computador desligado, sessão expirada, página fechada ou conteúdo não carregado interrompem ou limitam a observação. Não haverá promessa de monitoramento integral, contínuo ou retroativo.

### 6. Resultados comerciais

- Quantidade e valor bruto de vendas de chat confirmadas, quando sua origem, situação e horário puderem ser identificados nas telas consultadas.
- A associação ao operador será pelo horário de confirmação da venda, não pelo horário em que ela foi observada.
- Valores mostrados ao lado dos contatos não serão automaticamente interpretados como vendas daquele turno.
- Receitas sem origem ou horário suficiente permanecerão sem atribuição. Assinaturas, renovações e mimos não serão classificados automaticamente como vendas do chatter.
- Estornos e cancelamentos observados serão apresentados separadamente e refletidos nos totais correspondentes.
- O indicador será denominado **vendas associadas ao turno**. Não comprova que aquele operador originou a compra, não calcula comissões e não substitui os registros financeiros oficiais.
- Conversão de oferta em venda só será apresentada se houver relação identificável entre ambas; não será estimada com dados insuficientes.

### 7. Qualidade do atendimento

- Avaliação manual pelo supervisor, com critérios de resposta à pergunta, continuidade, clareza, respeito às orientações da criadora e acompanhamento de dúvidas ou compromissos.
- Cada critério terá as opções adequado, precisa de atenção e não avaliável. Ausência de contexto não será interpretada como falha do chatter.
- Registro de avaliação associado à criadora, ao operador, ao período e ao momento da revisão, sem transcrever mensagens ou identificar assinantes.
- A avaliação considerará a sequência visível da conversa, não apenas a prévia da lista ou a última mensagem.
- Não haverá inteligência artificial, análise automática de conteúdo, pontuação disciplinar automática ou geração de respostas nesta versão.

### 8. Relatórios e proteção dos dados

- Relatórios por período com indicadores, tamanho da amostra observada, avaliações do supervisor e histórico de ajustes, exportáveis em CSV pelo gestor.
- O painel conservará somente métricas, metadados mínimos necessários e avaliações estruturadas, no alcance permitido para essa finalidade. Não armazenará texto integral, capturas de tela, HTML, imagens, áudios ou vídeos das conversas.
- A permissão informada de visualização não será interpretada como autorização para copiar históricos integrais, treinar modelos ou enviar conteúdo para terceiros.
- A retenção proposta para métricas e avaliações é de 90 dias, com exclusão antecipada pelo gestor. Essa retenção é uma escolha de produto, não uma condição confirmada pela Privacy; se o escopo autorizado não permitir conservar métricas, relatórios históricos não serão habilitados.
- O gestor terá visão dos relatórios; o chatter terá somente os controles necessários aos perfis autorizados e ao próprio turno. A agência deverá informar a equipe sobre a supervisão e tratar os dados conforme suas obrigações de privacidade e LGPD.

## Fluxo de uso

1. O gestor instala o componente local no computador Windows, acessa o painel e cadastra criadoras e chatters.
2. O responsável escolhe uma criadora e abre seu navegador separado. O login na Privacy ocorre diretamente na página oficial.
3. O chatter acessa o gerenciador com sua identificação, seleciona a criadora permitida e inicia o turno.
4. O atendimento acontece normalmente na Privacy. O sistema acompanha somente as informações disponíveis nas telas observadas, sem tomar o controle da janela.
5. O gestor consulta tempos, pendências e vendas associadas ao turno, sempre com indicação de atualização e cobertura.
6. Para revisar o conteúdo, o gestor pausa o atendimento daquele perfil, assume a consulta local, reconhece o possível efeito sobre marcações de leitura e registra sua avaliação estruturada.
7. Ao encerrar a revisão ou trocar de operador, o responsável devolve o perfil ao atendimento e registra a mudança de turno.
8. O gestor consulta ou exporta resultados do período e corrige eventuais atribuições com justificativa.

## Aparência e experiência de uso

- Interface em português do Brasil, aberta na lista de criadoras, com comandos claros para abrir perfil, iniciar turno e consultar resultados.
- Navegação separada entre Criadoras, Operação, Vendas, Qualidade e Equipe e turnos.
- Visual profissional, fundo claro, texto grafite, destaque verde para situações normais e âmbar ou vermelho para atenção e interrupções, sempre com rótulos textuais.
- Comparações em tabelas legíveis, indicadores de atualização sempre visíveis e poucos gráficos, sem fotografias ou conteúdo íntimo dos assinantes.
- Painel de gestão adaptado a computador e celular. A abertura dos perfis e a leitura da Privacy dependerão do componente Windows; o celular não substituirá essa parte.
- Distinção explícita entre resultado zero, informação indisponível, amostra parcial e conexão interrompida.

## Fases de implementação

### Fase 1 — MVP: gerenciador próprio e supervisão assistida

Única fase incluída na construção inicial: catálogo de criadoras, perfis locais separados em Windows, login direto na Privacy, identificação dos operadores, turnos, observação das telas, indicadores operacionais, vendas associadas ao turno, revisão manual local de qualidade, relatórios e controles de privacidade.

O uso inicial será em uma estação Windows da agência, com várias criadoras cadastráveis e um turno ativo por criadora. Não inclui sincronização de sessões entre computadores nem reprodução de todos os recursos do Lauth.

A disponibilidade de cada indicador dependerá de os campos necessários serem efetivamente exibidos pela Privacy. Se um dado não puder ser obtido pela interface permitida, o indicador correspondente ficará indisponível; não haverá alternativa oculta por API nem números inventados. A compatibilidade real do navegador e a cobertura das telas ainda não foram confirmadas em uma conta autorizada.

### Fase 2 — Operação distribuída

Possível ampliação para equipes em várias estações, regras de transferência de atendimento, permissões por equipe e relatórios individuais para os chatters. Não haverá promessa de transferência de cookies ou de sessões prontas entre máquinas; cada acesso deverá respeitar as condições da conta. Não incluída no MVP.

### Fase 3 — Supervisão avançada

Possível ampliação dos critérios de qualidade, metas e análises históricas. Qualquer avaliação por inteligência artificial ou tratamento adicional de conteúdo exigirá definição própria de escopo e permissão; não está presumida pela autorização de leitura. A restrição de não usar API da Privacy continuará válida. Não incluída no MVP.

## Premissas adotadas

- A proposta substitui a dependência do Lauth por um gerenciador próprio enxuto, conforme a alternativa apresentada pelo usuário.
- Windows é a plataforma inicial, com base no cenário mostrado, sem suporte inicial a macOS, Linux ou aplicativo móvel de coleta.
- A lista poderá conter várias criadoras; o MVP estará limitado a uma estação de operação. O acompanhamento em computadores diferentes fica para a segunda fase.
- Os chatters utilizam contas compartilhadas em turnos separados, conforme confirmado. O gestor também poderá assumir um turno, devidamente identificado.
- A consulta autorizada pelas telas e a proibição de API são restrições fornecidas pelo usuário. A captura de atendimento apresentada integra esse contexto, sem comprovar autorização adicional para conservação de conteúdo ou análise por IA.
- A revisão de qualidade será manual e local, retomando a necessidade de entender a condução das conversas esclarecida após o primeiro plano. Não haverá espelhamento remoto nem cópia integral do conteúdo.
- Não haverá leitura automática de todas as conversas no MVP. O atendimento observado e a revisão conduzida pelo supervisor terão cobertura explicitamente parcial.
- Login e sessão permanecerão sob controle do navegador local. Senhas, cookies e tokens da Privacy não serão enviados ao painel.
- Fuso inicial de Brasília, moeda em reais, meta de resposta de cinco minutos e retenção proposta de 90 dias para dados mínimos permitidos.
- A autoria de mensagens e a causalidade de vendas não serão presumidas pela existência de um turno. Casos sem informação suficiente permanecerão sem atribuição.
- Não foi acessada nenhuma conta privada nesta etapa. O plano não equivale a uma integração já validada ou a acesso ao computador do usuário.
- Referências da proposta: [Termos da Privacy](https://privacy.com.br/termos), [funcionalidades do chat descritas pela Privacy](https://blog.privacy.com.br/chat-da-privacy-conheca-todas-as-funcionalidades-e-veja-como-usa-las-para-aumentar-seus-ganhos/) e [documentação de perfis persistentes de navegador](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context). Nenhuma dessas referências comprova a disponibilidade de todos os indicadores na conta da agência.