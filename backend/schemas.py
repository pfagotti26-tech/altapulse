from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator, model_validator
from typing import Literal, Optional
from datetime import datetime

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
class Login(Strict):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
class Setup(Login):
    name: str = Field(min_length=2, max_length=70)
    agency_name: str = Field(min_length=2, max_length=70)
class Operator(Login):
    name: str = Field(min_length=2, max_length=70)
    role: Literal['manager', 'chatter'] = 'chatter'
    creator_ids: list[str] = Field(default_factory=list, max_length=100)
    temporary_password: bool = False

class PasswordChange(Strict):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)
    confirm_password: str = Field(min_length=10, max_length=128)
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)

    @field_validator('new_password')
    @classmethod
    def strong_password(cls, value):
        if value != value.strip(): raise ValueError('Não use espaços no início ou no fim da senha.')
        if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
            raise ValueError('Use pelo menos uma letra e um número.')
        return value

    @model_validator(mode='after')
    def same_confirmation(self):
        if self.new_password != self.confirm_password: raise ValueError('A confirmação da nova senha não confere.')
        return self
class OperatorUpdate(Strict):
    creator_ids: list[str] = Field(max_length=100)
    active: bool = True
class Creator(Strict):
    name: str = Field(min_length=2, max_length=70)
    handle: str = Field(default='', max_length=60)
    color: Literal['green', 'rose', 'blue', 'amber', 'lavender'] = 'green'
    group: str = Field(default='', max_length=40)
    tag: str = Field(default='', max_length=30)
    notes: str = Field(default='', max_length=2000)
class CreatorMeta(Strict):
    group: Optional[str] = Field(default=None, max_length=40)
    tag: Optional[str] = Field(default=None, max_length=30)
    notes: Optional[str] = Field(default=None, max_length=2000)
class Reason(Strict):
    reason: str = Field(min_length=5, max_length=200)
class SaleAssignment(Reason):
    shift_id: Optional[str] = None
class ShiftStart(Strict):
    creator_id: str
class ShiftAction(Strict):
    action: Literal['pause', 'resume', 'end']
class ShiftCorrection(Reason):
    operator_id: str
    started_at: datetime
    ended_at: Optional[datetime] = None
class SettingsUpdate(Strict):
    agency_name: str = Field(min_length=2, max_length=70)
    sla_minutes: int = Field(ge=1, le=120)
    retention_days: int = Field(ge=1, le=90)
    storage_allowed: bool
    fan_names_allowed: bool = False
    # bloco E: amostras anonimizadas da conversa para análise por IA (tarefa agendada do Claude)
    quality_ai_allowed: bool = False
class ReviewStart(Strict):
    acknowledge_read: Literal[True]
class Review(Strict):
    creator_id: str
    review_session_id: str
    answers: dict[str, Literal['adequado', 'atencao', 'nao_avaliavel']]
    @field_validator('answers')
    @classmethod
    def valid_answers(cls, value):
        if set(value) != {'resposta', 'continuidade', 'clareza', 'orientacoes', 'acompanhamento'}:
            raise ValueError('Avalie os cinco critérios.')
        return value
class Observation(Strict):
    creator_id: str
    event_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    kind: Literal['pending', 'response', 'sale', 'offer']
    started_at: Optional[datetime] = None
    responded_at: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None
    sequence_complete: bool = False
    amount_cents: Optional[int] = Field(default=None, ge=0, le=100000000)
    sale_status: Optional[Literal['confirmed', 'pending', 'refunded', 'cancelled', 'unknown']] = None
    sale_origin: Optional[Literal['chat', 'subscription', 'renewal', 'post', 'tip', 'unknown']] = None
    # bloco A: vendas lidas do extrato da Privacy (aba oculta do app) trazem produto, pagamento e comissão exatos
    sale_source: Optional[Literal['list', 'extrato']] = None
    payment_method: Optional[str] = Field(default=None, max_length=30)
    commission_cents: Optional[int] = Field(default=None, ge=0, le=100000000)
    # bloco C: oferta de mídia paga enviada no chat (etiqueta 'R$ X ainda não pago' / 'pago')
    offered_at: Optional[datetime] = None
    offer_status: Optional[Literal['sent', 'paid', 'expired']] = None
    offer_type: Optional[Literal['ppv', 'request']] = None  # mídia paga enviada x "Solicitação Mídia"
    media_type: Optional[Literal['photo', 'video', 'mixed']] = None
    fan_ref: Optional[str] = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    fan_name: Optional[str] = Field(default=None, max_length=80)
    @model_validator(mode='after')
    def valid_event(self):
        from datetime import timezone, timedelta
        for timestamp in [self.started_at, self.responded_at, self.confirmed_at, self.offered_at]:
            if timestamp and (timestamp.tzinfo is None or timestamp > datetime.now(timezone.utc) + timedelta(minutes=2)):
                raise ValueError('Horário inválido ou sem fuso.')
        if self.kind in ['pending', 'response'] and not self.started_at:
            raise ValueError('A espera precisa de um início conhecido.')
        if self.kind == 'response' and (not self.responded_at or self.responded_at < self.started_at):
            raise ValueError('Sequência de resposta inválida.')
        if self.kind == 'sale' and (self.amount_cents is None or self.sale_status is None or self.sale_origin is None):
            raise ValueError('Informe valor, origem e situação observados.')
        if self.kind == 'offer' and (self.amount_cents is None or self.offer_status is None or self.offered_at is None):
            raise ValueError('A oferta precisa de valor, situação e instante.')
        return self
class AvatarIn(Strict):
    # data URL de imagem já reduzida (256 px); limite de ~90 KB
    image: str = Field(min_length=100, max_length=120000, pattern=r'^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')
