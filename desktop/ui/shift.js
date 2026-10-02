// Pergunta do fim de turno: "Vai continuar?" Sim → até que horas; Não ou sem resposta → encerra todos os turnos.
const $ = (id) => document.getElementById(id);
const FULL = 119.4;
let prompt = null;
const pad = (n) => String(n).padStart(2, '0');
const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function render() {
  if (!prompt) return;
  const list = prompt.creators.join(', ');
  $('title').textContent = `Seu turno terminou às ${hm(prompt.endsAt)}`;
  $('sub').textContent = prompt.creators.length > 1 ? `Turnos ativos: ${list}.` : `Turno ativo: ${list}.`;
  $('ask').classList.toggle('hidden', prompt.stage !== 'ask');
  $('until').classList.toggle('hidden', prompt.stage !== 'until');
  $('err').textContent = prompt.error || '';
  if (prompt.stage === 'until' && document.activeElement !== $('time')) {
    if (!$('time').value) { const d = new Date(Date.now() + 60 * 60e3); $('time').value = `${pad(d.getHours())}:00`; }
    $('time').focus();
  }
  tick();
}
function tick() {
  if (!prompt) return;
  const left = Math.max(0, Math.ceil((prompt.deadline - Date.now()) / 1000));
  $('secs').textContent = left;
  $('ring').style.strokeDashoffset = String(FULL * (1 - left / (prompt.total / 1000)));
  document.querySelector('.clock').classList.toggle('urgent', left <= 15);
}
setInterval(tick, 250);
window.pulse.onShiftPrompt((p) => { prompt = p; render(); });
$('yes').onclick = () => window.pulse.shiftAnswer({ answer: 'yes' });
$('no').onclick = () => window.pulse.shiftAnswer({ answer: 'no' });
$('until-form').onsubmit = (e) => { e.preventDefault(); window.pulse.shiftAnswer({ answer: 'until', time: $('time').value }); };
window.pulse.shiftAnswer({ answer: 'ready' });
