# Privacy WAF403 — estado após solicitação de não reporte

O Chrome normal carrega a tela pública de login no computador do usuário; o navegador integrado exibiu WAF403 antes do login. Causa raiz NÃO confirmada. Lauth e Chrome são observações separadas; não afirmar qual implementação interna permite o acesso no Lauth.

Nenhum relatório/mensagem ao suporte da Privacy foi enviado. Recursos propostos de suporte/reporte/abertura externa foram removidos antes de uma publicação de binário que os incluísse. Não há criação de incidente externo nem envio de credenciais/prints. Nenhum dado real foi alterado.

Validação do testing_agent: iteration_11.json, 7/7 testes locais aprovados. Confirmam remoção de ações e comportamento do watcherHTTP por eventos SINTÉTICOS. Não confirmam aceitação do site em Windows. O watcher apenas evita chamar uma resposta403 de acesso bem-sucedido.

Download público continua na0.2.2. Fonte0.2.3 pendente, não publicada e não anunciada como correção do acesso. A experiência integrada solicitada continua incompleta. Próxima investigação técnica precisa comparar o fluxo real sem spoofing, proxy, cookies exportados, bypass ou contato com o suporte Privacy.