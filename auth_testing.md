# Acesso de validação temporário

Aplicativo inicialmente sem usuários. `/api/auth/status` informa se o primeiro gestor deve ser criado por `/api/auth/setup`. Não existe conta padrão de produto. A criação exige `name`, `agency_name`, `email`, `password` (mínimo 8). Login depois em `/api/auth/login`. Cookie Secure/HttpOnly requer a URL HTTPS de `REACT_APP_BACKEND_URL`.

Somente testes: `gestor.validacao@example.com`, senha `Vertice!Validacao2026`. Estes dados são sintéticos, não pertencem a uma pessoa real. O domínio reservado `.test` é rejeitado por EmailStr; use `example.com` para fixtures.

Limpar integralmente apenas os registros sintéticos criados nesta execução ao terminar, incluindo gestor temporário; o produto deve retornar ao primeiro acesso. Nunca usar credenciais Privacy. Nenhuma conta privada será acessada.