import React from 'react';
import { Inbox, ArrowUpRight, Info, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
export { Button, Input };
const ini = (name) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
// foto de perfil (data URL) ou iniciais, no mesmo círculo
export const Avatar = ({ user, name, src, className = '', size }) => { const img = src ?? user?.avatar; const n = name ?? user?.name; return <div className={`avatar ${className}`} style={size ? { width: size, height: size } : undefined}>{img ? <img src={img} alt="" className="avatar-img"/> : ini(n)}</div>; };
// reduz a imagem escolhida para 256x256 (recorte central) e devolve data URL JPEG
export const shrinkImage = (file) => new Promise((resolve, reject) => {
  if (!file || !/^image\//.test(file.type)) return reject(new Error('Escolha uma imagem (JPG, PNG ou WebP).'));
  const reader = new FileReader(); reader.onerror = () => reject(new Error('Não consegui ler a imagem.'));
  reader.onload = () => { const img = new Image(); img.onerror = () => reject(new Error('Imagem inválida.')); img.onload = () => {
    const side = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
    let q = 0.85, out = c.toDataURL('image/jpeg', q); while (out.length > 110000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
    resolve(out); }; img.src = reader.result; };
  reader.readAsDataURL(file);
});
export const PageHeading = ({ eyebrow = 'SEU CENTRO DE GESTÃO', title, description, children }) => <div className="page-heading"><div><span className="eyebrow" data-testid="page-eyebrow">{eyebrow}</span><h1 data-testid="page-title">{title}</h1><p data-testid="page-description">{description}</p></div><div className="heading-actions">{children}</div></div>;
export const Badge = ({ children, tone = 'neutral', testId }) => <span data-testid={testId} className={`status-badge ${tone}`}><i/>{children}</span>;
export const Field = ({ label, id, children, ...props }) => <label className="field" htmlFor={id}><span data-testid={`${id}-label`}>{label}</span>{children || <Input id={id} data-testid={id} {...props}/>}</label>;
export const Select = ({ id, children, ...props }) => <select id={id} data-testid={id} {...props}>{children}</select>;
export const Modal = ({ title, description, open, onClose, children, id = 'form-modal', wide = false }) => <Dialog open={open} onOpenChange={v => !v && onClose()}><DialogContent data-testid={id} className={wide ? 'app-modal app-modal-wide' : 'app-modal'}><DialogHeader><DialogTitle data-testid={`${id}-title`}>{title}</DialogTitle><DialogDescription data-testid={`${id}-description`} className={description ? '' : 'sr-only'}>{description || 'Informações e ações para este registro.'}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
export const Empty = ({ title, description, icon: Icon = Inbox, children, id = 'empty-state' }) => <div className="empty-state" data-testid={id}><div className="empty-icon"><Icon size={28} strokeWidth={1.4}/></div><h3 data-testid={`${id}-title`}>{title}</h3><p data-testid={`${id}-description`}>{description}</p>{children}</div>;
export const Notice = ({ children, tone = '', id = 'notice' }) => <div className={`notice ${tone}`} data-testid={id}><Info size={17}/><span>{children}</span></div>;
export const Stat = ({ label, value, caption, icon: Icon, tone = '', id }) => <div className={`stat ${tone}`} data-testid={`${id}-card`}><div className="stat-top"><span data-testid={`${id}-label`}>{label}</span><Icon size={18}/></div><strong data-testid={`${id}-value`}>{value}</strong><span className="stat-caption" data-testid={`${id}-caption`}>{caption}</span></div>;
export const Submit = ({ busy, children = 'Salvar', id = 'submit-form', variant }) => <Button data-testid={id} type="submit" disabled={busy} variant={variant}>{busy ? <Loader2 className="spin"/> : null}{children}</Button>;
export const FormError = ({ error }) => error ? <p role="alert" className="form-error" data-testid="form-error">{error}</p> : null;
export const SectionHeading = ({ title, caption, children }) => <div className="section-heading"><div><h2 data-testid="section-title">{title}</h2>{caption && <p data-testid="section-caption">{caption}</p>}</div>{children}</div>;