import React from 'react';
import { AlertTriangle } from 'lucide-react';

export const BrowserAccessNotice = ({ state }) => {
  if (!['blocked', 'http_error'].includes(state.status)) return null;
  return <aside className="browser-access-notice" role="alert" data-testid="privacy-access-notice"><AlertTriangle size={22}/><div><strong data-testid="privacy-access-title">{state.status === 'blocked' ? `Acesso recusado pela Privacy (${state.http_status})` : `A página retornou erro ${state.http_status}`}</strong><p data-testid="privacy-access-explanation">{state.message} O fim do carregamento não significa que o acesso à conta foi liberado.</p><small data-testid="privacy-access-boundary">A compatibilidade deste acesso integrado ainda não foi confirmada. Nenhum relatório, conteúdo da página ou credencial será enviado à Privacy por este aviso. Não há nova tentativa automática.</small></div></aside>;
};