# Alta Pulse Chrome Pilot 0.3.0 — entrega do protótipo aprovado

## O que existe
Instalador próprio NSIS Windowsx64 com aplicativo Electron de controle e helper Win32 que lança o Google Chrome instalado e tenta encaixar somente sua própria janela. Perfis, userData, diretório de instalação, atalhos e registro separados da versão regular0.2.2.

Página: `/piloto-chrome` (gestores autenticados).
Download: `/api/desktop/pilot/download/windows` (gestores autenticados).
Arquivo: `Alta-Pulse-Chrome-Pilot-0.3.0-Setup-x64.exe`.
Tamanho: 115534967 bytes.
SHA256: d7f195e7e7fdbd99b22c1ca95d0382b00fb1896360ae5e33bbd9c52eadbd9dfb.

## Validação efetivamente realizada
Agente de testes iteration12 (8/8) e pós-correção iteration13. Permissões API, download completo, extração NSIS, executáveis/helper x64, dependências do helper, contratos locais com processos SINTÉTICOS, UI/roles/mobile, importação direta e ASAR independente.

Produção0.2.2 preservada com hash d8277227bdca75fe87e1e9cb9f0e77e6dc26d5e2adaf7536f5f621bc1e2ecb41.

## Não validado / não prometer
Nenhum Windows real disponível aqui. SetParent/DPI/foco/teclado/pop-ups/encerramento e aceitação/login/WAF Privacy NÃO comprovados. Protocolos mockados em testes não substituem essa evidência. O403 original permanece sem correção confirmada.

## Primeiro uso orientado
Google Chrome legítimo instalado. Instalar o piloto na pasta própria, fechar o perfil na versão regular, abrir o atalho do piloto e entrar com o acesso pessoal existente. O piloto registra outro dispositivo; respeita aprovação e atribuição atuais. Nova sessão Privacy precisa de login manual. Não desativar proteções se Windows bloquear.

Nenhuma conta privada acessada pelos agentes. Sem reporte/contato à Privacy, APIPrivacy, mudança de User-Agent, CDP, interceptação, cookies transferidos ou automação de atendimento. Não retirar essas restrições para forçar resultado positivo.