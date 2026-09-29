import React, { useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, LifeBuoy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './Common';

export const BrowserAccessNotice = ({ state }) => {
  const [busy, setBusy] = useState(false);
  if (!['blocked', 'http_error'].includes(state.status)) return null;
  const run = async action => {
    setBusy(true);
    try {
      const result = await window.altaDesktop[action]();
      if (result?.error) toast.error(result.error);
      else if (action === 'copySupportInfo') toast.success('Resumo copiado. Acrescente o ID do incidente mostrado na página, sem senhas ou dados de assinantes.');
    } catch { toast.error('Não foi possível concluir esta ação.'); }
    finally { setBusy(false); }
  };
  return <aside className="browser-access-notice" role="alert" data-testid="privacy-access-notice"><AlertTriangle size={22}/><div><strong data-testid="privacy-access-title">{state.status === 'blocked' ? `Acesso recusado pela Privacy (${state.http_status})` : `A página retornou erro ${state.http_status}`}</strong><p data-testid="privacy-access-explanation">{state.message} O fim do carregamento não significa que o acesso à conta foi liberado.</p><div className="browser-access-actions"><Button variant="outline" data-testid="copy-privacy-support-info" disabled={busy || !window.altaDesktop?.copySupportInfo} onClick={() => run('copySupportInfo')}><Copy size={14}/>Copiar resumo para o suporte</Button><Button variant="outline" data-testid="open-privacy-support" disabled={busy || !window.altaDesktop?.openPrivacySupport} onClick={() => run('openPrivacySupport')}><LifeBuoy size={14}/>Suporte da Privacy</Button>{state.status === 'blocked' && <Button variant="outline" data-testid="open-privacy-external" disabled={busy || !window.altaDesktop?.openExternalPrivacy} onClick={() => run('openExternalPrivacy')}><ExternalLink size={14}/>Abrir fora do aplicativo</Button>}</div><small data-testid="privacy-external-disclaimer">A abertura externa é opcional e exige confirmação. Não usa este perfil isolado, não transfere a sessão e não é acompanhada pelo Alta Pulse. Confira a conta antes de atender. Não corrige o bloqueio integrado.</small></div></aside>;
};