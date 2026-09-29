const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const ERROR_MESSAGES = Object.freeze({
  arguments_invalid: 'O componente local recebeu parâmetros inválidos.',
  parent_invalid: 'Não foi possível identificar a janela do piloto.',
  profile_invalid: 'O perfil isolado do piloto não pôde ser validado.',
  profile_unavailable: 'Não foi possível preparar a pasta local do piloto.',
  profile_in_use: 'Este perfil do piloto já está em uso. Feche a outra janela do piloto.',
  chrome_signature_invalid: 'Não foi possível validar a assinatura do Google Chrome instalado. O piloto não executou o arquivo.',
  chrome_start_failed: 'Não foi possível iniciar o Chrome com isolamento de processos. Nenhuma proteção foi desativada.',
  chrome_window_not_found: 'Não encontramos a janela do Chrome iniciada por este piloto. Nenhuma janela pessoal foi anexada.',
  attach_failed: 'O Windows não permitiu encaixar a janela do Chrome. O piloto foi encerrado; isso pode envolver escala de tela ou compatibilidade.',
  embedding_lost: 'O Chrome deixou de estar encaixado. O piloto encerrou apenas sua própria sessão de execução.',
  protocol_invalid: 'O componente local recusou um comando inválido.',
  native_failure: 'O componente local não conseguiu concluir a abertura.',
});
function profileKey(machineId, creatorId) {
  if (!/^[a-f0-9-]{36}$/.test(machineId) || !/^[a-f0-9]{24}$/.test(creatorId)) throw new Error('Perfil inválido.');
  return crypto.createHash('sha256').update(`chrome-pilot:${machineId}:${creatorId}`).digest('hex');
}
function chromeCandidates(environment = process.env) {
  return ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA']
    .map(key => environment[key]).filter(Boolean)
    .map(root => path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
}
function findChrome(environment = process.env) {
  const executable = chromeCandidates(environment).find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  if (!executable) throw new Error('Google Chrome não encontrado neste computador. Instale-o pela fonte oficial; o piloto não baixa nem substitui o Chrome.');
  return executable;
}
function parseHostLine(line) {
  if (typeof line !== 'string' || line.length > 160) throw new Error('Resposta local inválida.');
  const parts = line.replace(/\r$/, '').split('\t');
  if (parts.length === 1 && ['READY', 'CLOSED'].includes(parts[0])) return { event: parts[0] };
  if (parts.length === 2 && parts[0] === 'ERROR' && Object.hasOwn(ERROR_MESSAGES, parts[1])) return { event: 'ERROR', code: parts[1], message: ERROR_MESSAGES[parts[1]] };
  throw new Error('Resposta local não reconhecida.');
}
function boundsCommand(rect) {
  if (!rect) return 'BOUNDS\t0\t0\t0\t0\n';
  const values = ['x', 'y', 'width', 'height'].map(k => rect[k]);
  if (!values.every(v => Number.isInteger(v) && v >= 0 && v <= 20000)) throw new Error('Dimensões inválidas.');
  return `BOUNDS\t${values.join('\t')}\n`;
}
module.exports = { ERROR_MESSAGES, profileKey, chromeCandidates, findChrome, parseHostLine, boundsCommand };