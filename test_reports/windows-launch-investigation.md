# Bloqueio de abertura Windows — status da investigação

**Não resolvido. Não reproduzido no Windows.** Fonte do relato: screenshot do usuário ao abrir Alta-Core-0.2.1-Setup-x64.exe na pasta Downloads; mensagem genérica de acesso ao dispositivo/caminho/arquivo.

## Verificado pelo testing_agent (iteration_9.json)
- Download público completo corresponde ao manifesto e binário local.
- SHA256: 71f3612df4fae7f0d08805e5805948369792cb4ca5c7bb50eb90e172f64c487a.
- Tamanho:114965344 bytes; NSIS íntegro e extraível; aplicativo interno x64.
- Bootstrap NSIS32bits não é defeito de arquitetura. Instalação per-user não solicita administrador.
- Instalador sem assinatura digital, já divulgado. Isso não prova a causa do erro mostrado.
- Troca do logotipo para Alta Pulse e ferramenta local de conferência aprovadas; esta última não envia/executa o arquivo.

## Evidência pendente do computador do usuário
1. Histórico de proteção: registro no momento da tentativa, detalhes do bloqueio se houver.
2. Arquivo ainda presente em Downloads? Conferência local pode excluir download incompleto/diferente.
3. Se não houver registro: tipo de Windows, computador gerenciado ou pessoal e eventual política de execução/controle de aplicativos, consultados sem alterar configurações.

Nenhuma recomendação de desativar antivirus, burlar Smart App Control, executar como admin às cegas ou restaurar arquivo em quarentena. Não contornar o bloqueio com outro nome/pacote. Somente aplicar correção após causa identificada e repetir testing_agent, conforme solicitado.