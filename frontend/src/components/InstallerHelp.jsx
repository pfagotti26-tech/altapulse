import React, { useRef, useState } from 'react';
import { FileCheck2, ShieldAlert, Loader2, CheckCircle2, AlertTriangle, FolderOpen } from 'lucide-react';
import './InstallerHelp.css';

export const InstallerHelp = ({ release }) => {
  const input = useRef(null), sequence = useRef(0);
  const [check, setCheck] = useState(null), [busy, setBusy] = useState(false);
  async function inspect(event) {
    const file = event.target.files?.[0];
    if (!file || !release?.available) return;
    const request = ++sequence.current;
    setBusy(false); setCheck(null);
    const details = { name: file.name, size: file.size };
    if (file.size !== release.size_bytes) {
      setCheck({ ...details, status: 'different', message: 'O tamanho não corresponde ao instalador publicado. O download pode estar incompleto, ser de outra versão ou ser outro arquivo. Não execute este arquivo.' });
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (request !== sequence.current) return;
      const same = hash === release.sha256;
      setCheck({ ...details, hash, status: same ? 'match' : 'different', message: same
        ? 'O arquivo corresponde exatamente ao disponibilizado neste site. Isso confirma a integridade do download, não uma autorização do Windows nem a ausência de riscos.'
        : 'O conteúdo não corresponde ao instalador publicado. Não execute este arquivo. Baixe novamente pelo link oficial e confira se a versão é a mesma.' });
    } catch {
      if (request === sequence.current) setCheck({ ...details, status: 'error', message: 'Não foi possível ler o arquivo neste navegador. Tente selecionar o arquivo novamente. Nenhum conteúdo foi enviado.' });
    } finally { if (request === sequence.current) setBusy(false); }
  }
  return <section className="installer-help" id="ajuda-instalacao" data-testid="installer-help"><div className="installer-help-heading"><ShieldAlert size={23}/><div><h2 data-testid="installer-help-title">O Windows não deixou abrir o instalador?</h2><p data-testid="installer-help-description">A mensagem “O Windows não pode acessar o dispositivo, caminho ou arquivo” não aponta uma causa única. Pode haver arquivo indisponível, bloqueio de segurança ou restrição do computador.</p></div></div>
    <div className="installer-help-steps"><div><span>01</span><h3 data-testid="installer-file-step-title">Confira o arquivo</h3><p data-testid="installer-file-step-text">Confirme que ele ainda está na pasta Downloads e que o download terminou. A conferência abaixo compara o arquivo com a versão publicada, sem executá-lo.</p></div><div><span>02</span><h3 data-testid="installer-protection-step-title">Veja o motivo do bloqueio</h3><p data-testid="installer-protection-step-text">Abra <strong>Segurança do Windows → Proteção contra vírus e ameaças → Histórico de proteção</strong>. Veja se há um registro no horário da tentativa e envie um print dos detalhes, sem informações pessoais.</p></div><div><span>03</span><h3 data-testid="installer-policy-step-title">Mantenha as proteções ligadas</h3><p data-testid="installer-policy-step-text">Não desative o antivírus nem libere um arquivo em quarentena. Se o notebook for gerenciado por uma empresa, peça ao responsável de TI para verificar as regras de execução.</p></div></div>
    <div className="installer-file-check"><FileCheck2 size={22}/><div><h3 data-testid="installer-check-title">Conferir meu download</h3><p data-testid="installer-check-privacy">A análise acontece apenas neste navegador. O arquivo não é enviado ao servidor, instalado ou executado.</p>{release?.available && <span className="installer-expected-file" data-testid="installer-expected-file">Esperado: {release.filename} · {release.size_bytes.toLocaleString('pt-BR')} bytes</span>}</div><input ref={input} type="file" accept=".exe" data-testid="installer-file-input" aria-label="Selecionar instalador para conferir a integridade" onChange={inspect} hidden/><button type="button" className="installer-select-button" data-testid="installer-select-file" disabled={busy || !release?.available} onClick={() => { if (input.current) input.current.value = ''; input.current?.click(); }}>{busy ? <Loader2 size={16} className="spin"/> : <FolderOpen size={16}/>} {busy ? 'Conferindo…' : 'Selecionar arquivo baixado'}</button></div>
    {check && <div role="status" className={`installer-check-result ${check.status}`} data-testid="installer-check-result">{check.status === 'match' ? <CheckCircle2 size={19}/> : <AlertTriangle size={19}/>}<div><strong data-testid="installer-check-status">{check.status === 'match' ? 'Download íntegro' : check.status === 'different' ? 'Arquivo diferente do esperado' : 'Conferência não concluída'}</strong><p data-testid="installer-check-message">{check.message}</p><small data-testid="installer-check-file">{check.name} · {check.size.toLocaleString('pt-BR')} bytes</small>{check.hash && <code data-testid="installer-check-hash">SHA-256: {check.hash}</code>}</div></div>}
    <p className="installer-help-boundary" data-testid="installer-help-boundary">O instalador atual não tem assinatura digital. Se o bloqueio for por política de segurança ou reputação do editor, baixar o mesmo arquivo outra vez não resolve. O motivo precisa ser confirmado no Windows; esta página não desbloqueia o sistema.</p>
  </section>;
};