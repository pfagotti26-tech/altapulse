import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Search, ChevronDown, Monitor } from 'lucide-react';
import { initials } from '../lib/api';

export const CreatorSidebar = ({ creators, onNavigate }) => {
  const [search, setSearch] = useState(''), [expanded, setExpanded] = useState(true);
  const filtered = creators.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  return <section className="creator-sidebar"><button className="creator-sidebar-heading" data-testid="toggle-sidebar-creators" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}><span>PERFIS DA EQUIPE</span><span className="sidebar-profile-count" data-testid="sidebar-profile-count">{creators.length}</span><ChevronDown size={14} className={expanded ? '' : 'collapsed'}/></button>
    {expanded && <><div className="sidebar-profile-search"><Search size={13}/><input data-testid="sidebar-creator-search" placeholder="Encontrar criadora" aria-label="Buscar criadora na barra lateral" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="sidebar-profile-list">{filtered.map(c => <NavLink key={c.id} to="/" data-testid={`sidebar-creator-${c.id}`} className="sidebar-profile" onClick={onNavigate}><span className={`avatar ${c.color}`}>{initials(c.name)}</span><span><strong data-testid={`sidebar-creator-name-${c.id}`}>{c.name}</strong><small data-testid={`sidebar-creator-shift-${c.id}`}>{c.shift ? c.shift.paused ? 'Turno pausado' : c.shift.operator_name : 'Sem turno'}</small></span><Monitor size={13}/></NavLink>)}{!filtered.length && <p className="sidebar-profiles-empty" data-testid="sidebar-profiles-empty">{creators.length ? 'Nenhum perfil encontrado.' : 'Nenhuma criadora autorizada.'}</p>}</div></>}
  </section>;
};