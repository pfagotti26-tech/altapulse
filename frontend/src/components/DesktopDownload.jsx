import React, { useState, useEffect } from 'react';
import { Download, Loader2, MonitorDown } from 'lucide-react';
import { api } from '../lib/api';

export const useDesktopRelease = () => {
  const [release, setRelease] = useState(null), [error, setError] = useState(false);
  useEffect(() => { api.get('/desktop/release').then(r => setRelease(r.data)).catch(() => setError(true)); }, []);
  return { release, error };
};

export const DesktopDownload = ({ id = 'download-desktop', compact = false }) => {
  const { release, error } = useDesktopRelease();
  return <div className={`desktop-download ${compact ? 'compact' : ''}`}>
    {release?.available ? <a data-testid={id} className="desktop-download-button" href={`${process.env.REACT_APP_BACKEND_URL}/api/desktop/download/windows`} download><Download size={16}/>{compact ? 'Instalar no Windows' : 'Baixar Alta Core para Windows'}</a> : <button className="desktop-download-button" data-testid={id} disabled>{!release && !error ? <Loader2 size={16} className="spin"/> : <MonitorDown size={16}/>} {error ? 'Download indisponível' : 'Preparando instalador'}</button>}
    {!compact && <small data-testid={`${id}-requirements`}>{release?.available ? `v${release.version} · Windows 10/11 · 64 bits · ${(release.size_bytes / 1048576).toFixed(0)} MB` : 'Instalador Windows · sem Python'}</small>}
  </div>;
};