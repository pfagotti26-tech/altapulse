# Alta Pulse no servidor próprio (Hetzner)

Um servidor só roda tudo: banco (MongoDB), API (FastAPI) e site com HTTPS automático (Caddy).
O banco não fica exposto na internet; o firewall só abre SSH (22) e o site (80/443).

## Instalação (uma vez)

No PowerShell do Windows:

    ssh root@204.168.180.221

No servidor:

    ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C altapulse-server -q; cat ~/.ssh/id_ed25519.pub

Copie a linha que começa com `ssh-ed25519` e cadastre no GitHub:
repositório → Settings → Deploy keys → Add deploy key (título "servidor", **sem** marcar "Allow write access").

Depois, no servidor:

    apt-get install -y git >/dev/null; ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
    git clone git@github.com:pfagotti26-tech/altapulse.git /opt/altapulse && bash /opt/altapulse/deploy/install.sh

Ao final aparece o endereço de teste `https://204-168-180-221.sslip.io`.

## Copiar os dados do Emergent

    bash /opt/altapulse/deploy/migrate.sh

Pede a "URL do Mongo" (Emergent → Gerenciar implantações → Banco de dados). Ela não fica salva.
Pode repetir quantas vezes quiser; na virada, rode de novo para levar os dados mais recentes.

## Virada (domínio oficial)

1. `bash /opt/altapulse/deploy/migrate.sh` (cópia final)
2. Registro.br → altapulse.com.br → DNS: registro **A** de `altapulse.com.br` (e `www`, se houver) = `204.168.180.221`
3. Quando propagar: `bash /opt/altapulse/deploy/go-live.sh`

O app desktop continua apontando para https://altapulse.com.br — não precisa reinstalar.

## Dia a dia

- Atualizar para a versão do GitHub: `bash /opt/altapulse/deploy/update.sh`
- Backup: automático todo dia às 03:30 em `/opt/altapulse/deploy/backups` (guarda 14 dias). Manual: `bash /opt/altapulse/deploy/backup.sh`
- Ver erros da API: `cd /opt/altapulse/deploy && docker compose logs backend --tail 100`
- Restaurar um backup: `cd /opt/altapulse/deploy && docker compose exec -T mongo mongorestore --archive=/backups/ARQUIVO --gzip --drop`

## Segredos

- `deploy/.env` fica só no servidor (não vai para o GitHub).
- A chave do cofre de senhas está dentro do banco (coleção `secrets`), então viaja junto com a cópia dos dados. Não defina `VAULT_KEY`.
