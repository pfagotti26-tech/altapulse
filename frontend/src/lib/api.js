import axios from 'axios';
export const api = axios.create({ baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`, withCredentials: true });
export const errorText = e => typeof e.response?.data?.detail === 'string' ? e.response.data.detail : (e.response?.status === 422 ? 'Confira os campos e tente novamente.' : 'Não foi possível concluir. Verifique sua conexão.');
export const money = cents => cents == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const dateTime = date => date ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : '—';
export const duration = seconds => seconds == null ? '—' : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
export const initials = name => name?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
export async function download(path, filename) {
  const r = await api.get(path, { responseType: 'blob' }); const url = URL.createObjectURL(r.data);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}