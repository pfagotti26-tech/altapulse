// Candidatas a foto de perfil da própria criadora na página da plataforma (imagens redondas e quadradas).
// O processo principal escolhe pela posição (cabeçalho/lateral) conforme a plataforma. Só leitura.
module.exports.script = String.raw`(() => {
  const round = (el, w) => { for (let k = 0, p = el; k < 4 && p; k++, p = p.parentElement) { const r = parseFloat(getComputedStyle(p).borderTopLeftRadius) || 0; const b = p.getBoundingClientRect(); if (r >= Math.min(b.width, b.height) * 0.4 && Math.abs(b.width - w) < w * 0.5) return true; } return false; };
  return [...document.querySelectorAll('img')].map((i) => {
    const r = i.getBoundingClientRect();
    return { src: i.currentSrc || i.src, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), nw: i.naturalWidth,
      head: !!i.closest('header, nav, aside, [class*="header"], [class*="Header"], [class*="sidebar"], [class*="Sidebar"]'), round: round(i, r.width) };
  }).filter((c) => c.src && /^https:/.test(c.src) && c.w >= 28 && c.w <= 260 && Math.abs(c.w - c.h) <= 4 && c.round && c.nw >= 40 && !/emoji|flag|logo|icon|badge/i.test(c.src));
})()`;
