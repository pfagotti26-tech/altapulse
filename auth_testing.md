# Alta Core — acesso de teste solicitado pelo usuário

Login de gestor ativo: `teste@altaagency.com.br`. Credenciais em `/root/alta-core-test.env`, permissão 600. Este é o acesso de entrega solicitado pelo usuário e **não deve ser removido** ao terminar QA.

Login via `/api/auth/login`, cookie Secure/HttpOnly pela origem HTTPS em `REACT_APP_BACKEND_URL`. Não há e-mail real enviado para essa conta. A identificação pertence somente ao gerenciador Alta Core e não acessa a Privacy.

Workspace: Alta Agency. Não habilitar retenção/coleta nem inserir conversas/vendas fictícias ao testar identidade visual. Excluir apenas fixtures novas criadas pelo próprio teste, nunca a conta de entrega nem dados do usuário.

Regressão de marca: `/app/backend/tests/test_iteration4_alta_core_followup.py`. As suítes antigas de primeiro cadastro usam fixtures de outra execução e não devem ser disparadas sem isolamento sobre o workspace atual.

## Contas pessoais dos gestores
`pfagotti26@gmail.com` e `fernanda.fagotti1@gmail.com` são contas REAIS, criadas a pedido do usuário. Credenciais iniciais em `/root/alta-manager-onboarding.env`; ambos os acessos foram entregues com troca obrigatória no primeiro login. NÃO mudar senhas/flags, remover ou redefinir esses usuários nos testes. Se já trocaram a senha, o arquivo de provisionamento deixa de ser válido; nunca reverter a senha do usuário.

Regressão de senha: `/app/backend/tests/test_iteration8_password_onboarding.py`. Testar troca/invalidação somente em fixtures TEMP_PASSWORD_QA @example.com, preservando dados reais e o instalador existente. Não há alteração da distribuição dos downloads.