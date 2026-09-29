import json
import os
from pathlib import Path

from pymongo import MongoClient


RESULT_PATH = Path('/app/test_reports/native-smoke-runtime/artifacts/native_smoke_result.json')
BACKEND_ENV = Path('/app/backend/.env')


def load_backend_env(path: Path):
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        value = v.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        env[k.strip()] = value
    return env


def main():
    if not RESULT_PATH.exists():
        print('No native smoke result found; skipping DB cleanup')
        return

    result = json.loads(RESULT_PATH.read_text())
    cleanup = result.get('cleanup', {})
    machine_id = cleanup.get('machine_id')
    user_id = cleanup.get('user_id')
    creator_id = cleanup.get('temp_creator_id')

    env = load_backend_env(BACKEND_ENV)
    mongo_url = env.get('MONGO_URL')
    db_name = env.get('DB_NAME')
    if not mongo_url or not db_name:
        print('Missing MONGO_URL/DB_NAME; cannot cleanup native temporary device')
        return

    client = MongoClient(mongo_url)
    db = client[db_name]

    deleted = {
        'desktop_devices': 0,
        'desktop_leases': 0,
        'shifts': 0,
        'creators': 0,
    }

    if machine_id and user_id:
        deleted['desktop_devices'] = db.desktop_devices.delete_many({'machine_id': machine_id, 'user_id': user_id}).deleted_count
    if machine_id:
        deleted['desktop_leases'] = db.desktop_leases.delete_many({'machine_id': machine_id}).deleted_count
    if creator_id:
        deleted['shifts'] = db.shifts.delete_many({'creator_id': creator_id}).deleted_count
        deleted['creators'] = db.creators.delete_many({'id': creator_id, 'name': {'$regex': '^TEMP_NATIVE_'}}).deleted_count

    result['cleanup_db'] = deleted
    RESULT_PATH.write_text(json.dumps(result, indent=2))
    print(json.dumps(deleted))


if __name__ == '__main__':
    main()