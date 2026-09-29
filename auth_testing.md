# Alta Core — acesso de teste solicitado pelo usuário

Login de gestor ativo: `teste@altaagency.com.br`. Credenciais em `/root/alta-core-test.env`, permissão 600. Este é o acesso de entrega solicitado pelo usuário e **não deve ser removido** ao terminar QA.

Login via `/api/auth/login`, cookie Secure/HttpOnly pela origem HTTPS em `REACT_APP_BACKEND_URL`. Não há e-mail real enviado para essa conta. A identificação pertence somente ao gerenciador Alta Core e não acessa a Privacy.

Workspace: Alta Agency. Não habilitar retenção/coleta nem inserir conversas/vendas fictícias ao testar identidade visual. Excluir apenas fixtures novas criadas pelo próprio teste, nunca a conta de entrega nem dados do usuário.

Regressão desta alteração: `/app/backend/tests/test_iteration4_alta_core_followup.py`. As suítes antigas de primeiro cadastro usam fixtures de outra execução e não devem ser disparadas sem isolamento sobre o workspace atual.