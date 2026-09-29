import csv, io
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from core import db, now, iso, uid, manager, settings, audit, creator_access, lock, expiration, clean_time
from schemas import SettingsUpdate, ReviewStart, Review, Reason, SaleAssignment
from metrics import report_data
from responses import SettingsOut, AuditOut, ReviewOut, MetricsOut

router = APIRouter()
@router.patch('/sales/{event_id}/assignment')
async def correct_sale_assignment(event_id: str, body: SaleAssignment, user=Depends(manager)):
    event = await db.events.find_one({'id': event_id, 'kind': 'sale', 'expires_at': {'$gt': now()}}, {'_id': 0, 'expires_at': 0})
    if not event: raise HTTPException(404, 'Venda não encontrada.')
    if body.shift_id:
        if event.get('sale_origin') != 'chat' or not event.get('confirmed_at') or event.get('sale_status') not in ['confirmed', 'refunded', 'cancelled']:
            raise HTTPException(422, 'Somente vendas de chat com confirmação conhecida podem ser associadas a um turno.')
        shift = await db.shifts.find_one({'id': body.shift_id, 'creator_id': event['creator_id']}, {'_id': 0})
        if not shift: raise HTTPException(422, 'O turno precisa pertencer à mesma criadora.')
    update = {'shift_id': body.shift_id, 'reason': body.reason, 'actor_id': user['id'], 'corrected_at': iso()}
    await db.events.update_one({'id': event_id}, {'$set': {'manual_assignment': update}})
    await audit(user, 'Associação de venda corrigida', event['creator_id'], {'before': event.get('manual_assignment'), 'after': update}, body.reason)
    return {'ok': True}
@router.get('/settings', response_model=SettingsOut)
async def get_settings(user=Depends(manager)): return await settings()
@router.patch('/settings', response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, user=Depends(manager)):
    old = await settings()
    await db.settings.update_one({'id': 'main'}, {'$set': body.model_dump()}, upsert=True)
    if not body.storage_allowed:
        for collection in ['events', 'reviews']: await db[collection].delete_many({})
    if body.retention_days < old['retention_days']:
        from datetime import timedelta
        cutoff = now() - timedelta(days=body.retention_days)
        for collection in ['events', 'reviews', 'audit', 'shifts']:
            date_field = 'observed_at' if collection == 'events' else 'started_at' if collection == 'shifts' else 'created_at'
            docs = await db[collection].find({'active': {'$ne': True}}, {'_id': 0, 'id': 1, date_field: 1}).to_list(50000)
            for doc in docs:
                created = datetime.fromisoformat(doc[date_field])
                if created < cutoff: await db[collection].delete_one({'id': doc['id']})
                else: await db[collection].update_one({'id': doc['id']}, {'$min': {'expires_at': created + timedelta(days=body.retention_days)}})
    await audit(user, 'Política de dados atualizada', 'Workspace', {'before': old, 'after': body.model_dump()})
    return await settings()
@router.delete('/data')
async def delete_data(body: Reason, creator_id: str = '', user=Depends(manager)):
    query = {'creator_id': creator_id} if creator_id else {}
    for collection in ['events', 'reviews']: await db[collection].delete_many(query)
    await audit(user, 'Métricas e avaliações excluídas', creator_id or 'Todas as criadoras', reason=body.reason)
    return {'ok': True}
@router.get('/metrics', response_model=MetricsOut)
async def metrics(creator_id: str = '', operator_id: str = '', start: datetime | None = None, end: datetime | None = None, user=Depends(manager)):
    return await report_data(creator_id, operator_id, clean_time(start) if start else None, clean_time(end) if end else None)
@router.get('/audit', response_model=list[AuditOut])
async def audit_log(user=Depends(manager)):
    return await db.audit.find({'expires_at': {'$gt': now()}}, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(1000)
@router.post('/creators/{creator_id}/review/start')
async def start_review(creator_id: str, body: ReviewStart, user=Depends(manager)):
    async with lock:
        creator = await creator_access(creator_id, user)
        if creator.get('review'): raise HTTPException(409, 'Já há uma revisão aberta para este perfil.')
        shift = await db.shifts.find_one({'creator_id': creator_id, 'active': True, 'paused': True}, {'_id': 0})
        if not shift: raise HTTPException(409, 'Pause o turno antes de iniciar a revisão local.')
        browser = await db.browsers.find_one({'creator_id': creator_id, 'state': 'open'}, {'_id': 0})
        from datetime import timedelta
        if not browser or browser['last_seen'] < (now() - timedelta(seconds=30)).isoformat():
            raise HTTPException(409, 'Abra o perfil na estação conectada antes da revisão.')
        review = {'id': uid(), 'manager_id': user['id'], 'operator_id': shift['operator_id'], 'operator_name': shift['operator_name'],
            'shift_id': shift['id'], 'started_at': iso(), 'period_start': shift['started_at'], 'period_end': iso()}
        await db.creators.update_one({'id': creator_id}, {'$set': {'review': review}})
        await audit(user, 'Revisão local iniciada; aviso de leitura reconhecido', creator['name'])
        return review
@router.post('/creators/{creator_id}/review/end')
async def end_review(creator_id: str, user=Depends(manager)):
    creator = await creator_access(creator_id, user)
    await db.creators.update_one({'id': creator_id}, {'$set': {'review': None}})
    await audit(user, 'Revisão local finalizada', creator['name'])
    return {'ok': True}
@router.get('/reviews', response_model=list[ReviewOut])
async def reviews(user=Depends(manager)):
    if not (await settings())['storage_allowed']: return []
    return await db.reviews.find({'expires_at': {'$gt': now()}}, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(1000)
@router.post('/reviews', status_code=201, response_model=ReviewOut)
async def save_review(body: Review, user=Depends(manager)):
    if not (await settings())['storage_allowed']: raise HTTPException(409, 'O armazenamento de avaliações não está autorizado nas configurações.')
    creator = await creator_access(body.creator_id, user)
    session = creator.get('review')
    if not session or session['id'] != body.review_session_id or session['manager_id'] != user['id']:
        raise HTTPException(409, 'Inicie a revisão local para registrar uma avaliação.')
    row = {**body.model_dump(), 'id': uid(), 'creator_name': creator['name'], 'operator_id': session['operator_id'], 'operator_name': session['operator_name'],
        'period_start': session['period_start'], 'period_end': session['period_end'], 'manager_name': user['name'], 'created_at': iso()}
    await db.reviews.insert_one({**row, 'expires_at': await expiration()})
    await audit(user, 'Avaliação estruturada registrada', creator['name'])
    return row

def csv_safe(value):
    text = str(value) if value is not None else 'Indisponível'
    return "'" + text if text and text[0] in '=+-@\t\r' else text
@router.get('/reports/export')
async def export_report(kind: str = Query('summary', pattern='^(summary|sales|reviews|audit)$'), creator_id: str = '', operator_id: str = '', start: datetime | None = None, end: datetime | None = None, user=Depends(manager)):
    data = await report_data(creator_id, operator_id, clean_time(start) if start else None, clean_time(end) if end else None)
    output = io.StringIO(); writer = csv.writer(output, delimiter=';')
    if kind == 'summary':
        writer.writerow(['Indicador', 'Valor', 'Cobertura'])
        labels = {'mean_seconds': 'Tempo médio (segundos)', 'median_seconds': 'Mediana (segundos)', 'response_count': 'Respostas observadas', 'pending_count': 'Pendências observadas', 'late_count': 'Pendências atrasadas', 'sample_count': 'Tamanho da amostra', 'incomplete_count': 'Sequências incompletas', 'confirmed_cents': 'Vendas de chat confirmadas (centavos)', 'refunded_cents': 'Estornos (centavos)', 'unassigned_sales': 'Vendas sem atribuição'}
        for key, label in labels.items(): writer.writerow([label, csv_safe(data['summary'][key]), 'Parcial' if data['summary']['coverage'] == 'partial' else 'Sem dados'])
    elif kind == 'sales':
        writer.writerow(['Criadora', 'Operador associado ao turno', 'Confirmação', 'Valor bruto (centavos)', 'Situação', 'Origem', 'Tipo de associação'])
        for s in data['sales']: writer.writerow([csv_safe(s.get(k)) for k in ['creator_name', 'operator_name', 'confirmed_at', 'amount_cents', 'sale_status', 'sale_origin', 'assignment_type']])
    elif kind == 'reviews':
        writer.writerow(['Criadora', 'Operador', 'Supervisor', 'Data', 'Resposta', 'Continuidade', 'Clareza', 'Orientações', 'Acompanhamento'])
        for r in await reviews(user):
            if creator_id and r['creator_id'] != creator_id or operator_id and r['operator_id'] != operator_id: continue
            if start and r['created_at'] < clean_time(start) or end and r['created_at'] >= clean_time(end): continue
            writer.writerow([csv_safe(r[k]) for k in ['creator_name', 'operator_name', 'manager_name', 'created_at']] + [r['answers'][k] for k in ['resposta', 'continuidade', 'clareza', 'orientacoes', 'acompanhamento']])
    else:
        writer.writerow(['Responsável', 'Ação', 'Registro', 'Motivo', 'Data'])
        for a in await audit_log(user):
            if start and a['created_at'] < clean_time(start) or end and a['created_at'] >= clean_time(end): continue
            writer.writerow([csv_safe(a.get(k)) for k in ['actor', 'action', 'target', 'reason', 'created_at']])
    await audit(user, 'Relatório CSV exportado', kind)
    return Response('\ufeff' + output.getvalue(), media_type='text/csv; charset=utf-8', headers={'Content-Disposition': f'attachment; filename="alta-pulse-{kind}.csv"'})