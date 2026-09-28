# Vértice — estação Windows

## Instalação e conexão
1. Windows 10/11, Python 3.11 ou superior com Tk e Python Launcher (py). Instale Python pela distribuição oficial, caso necessário.
2. Extraia toda a pasta. Execute `Instalar.bat`. É preciso internet para instalar as dependências e Chromium. O pacote não é um instalador executável assinado.
3. No painel: Configurações → Gerar código de conexão. Execute `Iniciar.bat` e informe o código de uso único. Não informe nenhuma credencial da Privacy.
4. Cadastre a criadora e escolha Abrir navegador no painel. Confirme no Windows. Faça login diretamente na janela Privacy. CAPTCHA e 2FA são manuais.
5. Inicie o turno no painel. A estação não lê enquanto o turno estiver pausado, durante revisão ou sem permissão de retenção.

## O que está implementado / o que depende de validação
Gerenciamento de perfis persistentes separados, lock por perfil, confirmação local de abertura, pareamento revogável, heartbeat e leitor estrito de DOM visível estão implementados. **Não foi acessada uma conta Privacy nem validada sua estrutura de telas. Nenhum seletor específico é fornecido e a leitura começa bloqueada.** A instalação e a compatibilidade do Chromium precisam ser verificadas na estação Windows autorizada; o ambiente de construção não é Windows.

O leitor não adivinha dados. Se os atributos de sequência e horários exigidos abaixo não estiverem disponíveis, os respectivos indicadores continuarão indisponíveis. Não existe fallback por API, interceptação ou extração de cookies. A validação pode concluir que uma tela não suporta a métrica sob estas restrições.

## Validação local do adaptador — somente com responsável técnico autorizado
`Mapeamento e validação` pausa a leitura e abre `%LOCALAPPDATA%\Vertice\adapter.json`. O arquivo contém campos vazios, não exemplos fictícios. Valide na página real, sem salvar HTML, mensagens ou capturas. Inspeção deve ser manual/local e somente nos elementos permitidos. Não copiar logs de rede. Não mapear inputs, campos editáveis, senhas, cookies ou tokens. As credenciais continuam exclusivamente no navegador.

Campos de chat:
- `container`: seletor de um contêiner de conversa efetivamente visível, não do corpo genérico da página.
- `reference_attribute`: atributo estável `data-*` ou `id` de referência dessa conversa. Ele é pseudonimizado com HMAC local antes de envio.
- `rows`: seletor das linhas repetidas de mensagem dentro do contêiner.
- `time_selector` / `time_attribute`: seletor dentro da linha e atributo ISO 8601 com fuso correspondente ao horário realmente exibido. Datas relativas, abreviadas, sem dia ou sem fuso não são aceitas.
- `direction_attribute`, `incoming_value`, `outgoing_value`: atributo e valores confirmados que distinguem assinante e conta.
- `sequence_attribute`: índice numérico consecutivo real das mensagens. Não usar números de posição do DOM, pois a lista pode ser virtualizada. Se a plataforma não o expuser, não habilitar a métrica.

Uma amostra precisa de mensagem anterior da conta, seguida das mensagens consecutivas do assinante. A primeira mensagem inicia a espera. A próxima mensagem da conta encerra a espera. O baseline anterior evita calcular esperas a partir de um trecho truncado. Todas as linhas consideradas precisam estar completamente dentro da área visível; não há rolagem ou troca automática de conversas. Eventos repetidos usam a mesma referência e são deduplicados. Um indicador sem continuidade verificável não é calculado.

Campos de vendas:
- `rows`, `reference_attribute`: linhas e referência estável de transações reais.
- `time_selector`, `time_attribute`: confirmação real da venda, nunca horário da leitura.
- `amount_selector`: elemento com valor bruto em formato pt-BR, ex. moeda e centavos. Não mapear saldo ou valor ao lado do contato.
- `status_selector`, `origin_selector`: elementos visíveis que identificam situação e origem.
- `status_values`: dicionário de textos EXATAMENTE verificados para `confirmed`, `refunded`, `cancelled` ou `unknown`.
- `origin_values`: dicionário verificado para `chat`, `subscription`, `renewal`, `tip` ou `unknown`. Tudo que não corresponder fica desconhecido.

Preencher `validation_scope` com a descrição técnica dos campos/telas autorizados (sem dados pessoais), `validated_on` com data ISO e `validated: true` somente após comparar uma amostra manual. Revalidação após 30 dias ou alteração de DOM. Não configurar esse arquivo a partir de suposições. Não envie dados reais para ambientes de teste.

## Revisão de qualidade
1. Gestor pausa o turno no painel.
2. Na mesma estação, inicia revisão e reconhece o possível efeito de marcar conversas como lidas.
3. Gestor navega MANUALMENTE pela janela e registra cinco critérios no painel. Não há navegação autônoma ou transmissão da tela.
4. Finaliza a revisão; depois retoma o turno. Fechar o formulário não encerra a revisão; use Encerrar revisão.

## Segurança e persistência
- `%LOCALAPPDATA%\Vertice\profiles\<id interno>`: perfis dedicados. Nunca é usado o perfil pessoal Chrome/Edge. Apenas uma instância por pasta; há lock de arquivo no Windows.
- Sessões ficam nos perfis do Chromium, sob o usuário Windows. O código não lê, exporta nem sincroniza cookies ou arquivos de perfil. Não compartilhar nem copiar a pasta. Restrinja o usuário Windows e use proteção de disco.
- Token próprio do Vértice e chave de pseudonimização ficam no Windows Credential Manager via `keyring`, não no pacote nem no painel. Revogação do token interrompe coleta e comandos, não transfere ou apaga a sessão Privacy.
- `config.json` contém apenas URLs públicas do painel e da Privacy. Toda comunicação do agente é HTTPS ao seu próprio painel. Navegação normal é feita pelo Chromium. Não há requests Python para a Privacy.
- Sem screenshots, HTML, texto de mensagens, mídia, request listeners ou endpoints Privacy. Nenhuma automação de envio, clique, rolagem, compra, saque, CAPTCHA, proxy ou anti-detect.
- Uma aba escondida ou conteúdo fora da área visível não é lido. Estação offline, mudança de DOM ou falta de dados geram estado de interrupção/sem dados. Não há cobertura integral ou recuperação retroativa.

## Diagnóstico
- Perfil já aberto: use a janela existente; não apague arquivos de bloqueio enquanto Chromium estiver ativo.
- Código expirado/revogado: gere novo código; isso revoga a estação anterior.
- Conta exige verificação: conclua diretamente na Privacy, sem preencher pelo painel.
- Leitura aguardando validação: comportamento esperado até existir mapeamento confirmado.
- Erro após mudança de tela: pause e revalide. Não flexibilize os requisitos de sequência para produzir métricas artificiais.

A autorização informada de visualização não é presumida como autorização de cópia integral ou tratamento adicional. A permissão e a retenção de métricas devem ser definidas pela agência no alcance autorizado.