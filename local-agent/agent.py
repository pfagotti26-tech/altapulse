"""Alta Core Windows — perfis locais visíveis e ponte somente com o próprio painel."""
import asyncio
import json
import os
import secrets
import sys
import threading
import queue
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
import tkinter as tk
from tkinter import ttk, messagebox

import keyring
import requests
from playwright.async_api import async_playwright
from reader import EMPTY_ADAPTER, load_adapter, observe

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / 'config.json').read_text(encoding='utf-8'))
APP_URL = CONFIG['app_url'].rstrip('/')
PRIVACY_URL = CONFIG['privacy_url']
if urlparse(APP_URL).scheme != 'https' or urlparse(PRIVACY_URL).scheme != 'https':
    raise RuntimeError('As URLs precisam usar HTTPS.')
PRIVACY_HOST = urlparse(PRIVACY_URL).hostname

class Desktop:
    def __init__(self):
        if sys.platform != 'win32': raise RuntimeError('Este componente é destinado ao Windows 10/11.')
        previous_base = Path(os.environ['LOCALAPPDATA']) / 'Vertice'
        self.base = previous_base if previous_base.exists() else Path(os.environ['LOCALAPPDATA']) / 'AltaCore'
        self.base.mkdir(parents=True, exist_ok=True)
        self.app = tk.Tk()
        self.app.title('Alta Core • Estação local')
        self.app.geometry('730x590')
        self.app.minsize(610, 530)
        self.app.configure(bg='#fafafa')
        self.events = queue.Queue()
        self.stop = threading.Event()
        self.pause = threading.Event()
        self.token = keyring.get_password('Vertice', APP_URL)
        saved = keyring.get_password('Vertice-References', APP_URL)
        if not saved:
            saved = secrets.token_hex(32)
            keyring.set_password('Vertice-References', APP_URL, saved)
        self.secret = bytes.fromhex(saved)
        self.contexts = {}; self.locks = {}; self.states = {}; self.creators = []
        self.build_ui()
        self.app.after(150, self.process_events)
        self.app.protocol('WM_DELETE_WINDOW', self.close)
        if self.token: self.start_worker()

    def build_ui(self):
        self.logo = tk.PhotoImage(file=str(ROOT / 'alta-core-black.png')).subsample(6, 6)
        tk.Label(self.app, image=self.logo, bg='#fafafa').pack(anchor='w', padx=28, pady=(18, 3))
        tk.Label(self.app, text='ESTAÇÃO LOCAL  /  WINDOWS', bg='#fafafa', fg='#87878d', font=('Segoe UI', 9)).pack(anchor='w', padx=30)
        self.status = tk.StringVar(value='Conectando…' if self.token else 'Conecte esta estação com o código do gestor.')
        tk.Label(self.app, textvariable=self.status, bg='#fafafa', fg='#67676f', wraplength=660, justify='left').pack(anchor='w', padx=30, pady=17)
        self.pair_frame = ttk.Frame(self.app)
        self.pair_frame.pack(fill='x', padx=30, pady=5)
        self.code = tk.StringVar()
        ttk.Entry(self.pair_frame, textvariable=self.code, width=30).pack(side='left', padx=(0, 10))
        ttk.Button(self.pair_frame, text='Conectar com código', command=self.pair).pack(side='left')
        if self.token: self.pair_frame.pack_forget()
        self.tree = ttk.Treeview(self.app, columns=('name', 'browser', 'reading'), show='headings', height=9)
        for key, title, width in [('name', 'Criadora', 210), ('browser', 'Perfil local', 120), ('reading', 'Acompanhamento', 245)]:
            self.tree.heading(key, text=title); self.tree.column(key, width=width)
        self.tree.pack(fill='both', expand=True, padx=30, pady=12)
        controls = ttk.Frame(self.app); controls.pack(fill='x', padx=30)
        self.pause_label = tk.StringVar(value='Pausar leitura local')
        ttk.Button(controls, textvariable=self.pause_label, command=self.toggle_pause).pack(side='left')
        ttk.Button(controls, text='Mapeamento e validação', command=self.configure_reader).pack(side='left', padx=8)
        ttk.Button(controls, text='Desconectar', command=self.disconnect).pack(side='right')
        tk.Label(self.app, text='Logins e verificações são feitos na Privacy. Não há envio de mensagens pelo componente.\nRevisão manual: pause o turno no painel antes de navegar. Abrir conversas pode marcá-las como lidas.', bg='#fafafa', fg='#87878d', wraplength=660, justify='left', font=('Segoe UI', 9)).pack(anchor='w', padx=30, pady=20)

    def api(self, method, path, body=None, authenticated=True):
        headers = {'Authorization': 'Bearer ' + self.token} if authenticated and self.token else {}
        response = requests.request(method, APP_URL + '/api' + path, json=body, headers=headers, timeout=12)
        if response.status_code == 401 and authenticated:
            self.pause.set()
            self.events.put(('status', 'Conexão revogada. A leitura foi interrompida; reconecte com um novo código.'))
        response.raise_for_status()
        return response.json()

    def pair(self):
        code = self.code.get().strip()
        if len(code) < 16: return messagebox.showerror('Código', 'Informe o código completo gerado no painel.')
        try:
            result = self.api('POST', '/agent/pair', {'code': code, 'name': os.environ.get('COMPUTERNAME', 'Estação Windows')}, False)
            self.token = result['token']
            keyring.set_password('Vertice', APP_URL, self.token)
            self.code.set(''); self.pair_frame.pack_forget(); self.pause.clear()
            if not hasattr(self, 'worker') or not self.worker.is_alive(): self.start_worker()
        except Exception:
            messagebox.showerror('Conexão', 'Código inválido, já utilizado ou conexão indisponível. Gere um novo código no painel.')

    def start_worker(self):
        self.stop.clear()
        self.worker = threading.Thread(target=lambda: asyncio.run(self.run()), daemon=True)
        self.worker.start()

    def toggle_pause(self):
        if self.pause.is_set(): self.pause.clear(); self.pause_label.set('Pausar leitura local')
        else: self.pause.set(); self.pause_label.set('Retomar leitura local')

    def disconnect(self):
        if not messagebox.askyesno('Desconectar', 'Interromper leitura e remover a conexão local? Os perfis persistentes não serão apagados.'): return
        self.pause.set(); self.token = None
        try: keyring.delete_password('Vertice', APP_URL)
        except keyring.errors.PasswordDeleteError: pass
        self.pair_frame.pack(fill='x', padx=30, before=self.tree)
        self.status.set('Desconectado. Gere um novo código no painel para conectar novamente.')

    def configure_reader(self):
        self.pause.set(); self.pause_label.set('Retomar leitura local')
        path = self.base / 'adapter.json'
        if not path.exists(): path.write_text(json.dumps(EMPTY_ADAPTER, indent=2), encoding='utf-8')
        messagebox.showinfo('Validação técnica necessária', 'O mapeamento começa desativado, sem seletores presumidos.\n\nValide cada campo com o responsável autorizado na tela real. Somente atributos de tempo, direção, sequência e vendas identificáveis podem ser mapeados.\n\nA configuração é local. Consulte LEIA-ME.md antes de habilitar; não inclua mensagens, cookies, senhas, HTML ou dados pessoais. A leitura ficará pausada.')
        os.startfile(path)

    def process_events(self):
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == 'status': self.status.set(payload)
                elif kind == 'creators':
                    for child in self.tree.get_children(): self.tree.delete(child)
                    for creator in payload:
                        state = self.states.get(creator['id'], {})
                        browser = {'open': 'Aberto', 'closed': 'Fechado', 'interrupted': 'Interrompido'}.get(state.get('state'), 'Não aberto')
                        reading = {'partial': 'Amostra parcial', 'paused': 'Pausado', 'validation_required': 'Aguardando validação', 'no_data': 'Sem dados suficientes', 'interrupted': 'Interrompido'}.get(state.get('observation_state'), 'Sem dados')
                        self.tree.insert('', 'end', values=(creator['name'], browser, reading))
                elif kind == 'confirm':
                    command, result = payload
                    result['accepted'] = messagebox.askyesno('Abrir perfil dedicado', f"{command['requested_by']} solicitou o perfil de {command['creator_name']}.\n\nAbrir a janela local agora? Faça login somente na página oficial.")
                    result['ready'].set()
        except queue.Empty: pass
        self.app.after(150, self.process_events)

    async def open_profile(self, playwright, command):
        import msvcrt
        creator_id = command['creator_id']
        if not all(c in 'abcdef0123456789' for c in creator_id): return False, 'browser_error'
        if creator_id in self.contexts: return False, 'profile_locked'
        result = {'ready': threading.Event(), 'accepted': False}
        self.events.put(('confirm', (command, result)))
        # A confirmação não bloqueia o processamento da interface Tk.
        ready = await asyncio.to_thread(result['ready'].wait, 45)
        if not ready or datetime.fromisoformat(command['expires_at'].replace('Z', '+00:00')) <= datetime.now(timezone.utc): return False, 'expired'
        if not result['accepted']: return False, 'declined'
        profile = self.base / 'profiles' / creator_id
        profile.mkdir(parents=True, exist_ok=True)
        handle = (profile.parent / (creator_id + '.lock')).open('a+b')
        try:
            handle.seek(0); handle.write(b'0'); handle.flush(); handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            handle.close(); return False, 'profile_locked'
        try:
            context = await playwright.chromium.launch_persistent_context(str(profile), headless=False, no_viewport=True)
            self.contexts[creator_id] = context; self.locks[creator_id] = handle
            self.states[creator_id] = {'creator_id': creator_id, 'state': 'open', 'observation_state': 'validation_required'}
            context.on('close', lambda: self.closed(creator_id))
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto(PRIVACY_URL, wait_until='domcontentloaded', timeout=60000)
            return True, 'opened'
        except Exception:
            if creator_id in self.contexts:
                try: await self.contexts[creator_id].close()
                except Exception: pass
            self.closed(creator_id); handle.close()
            return False, 'browser_error'

    def closed(self, creator_id):
        self.contexts.pop(creator_id, None)
        handle = self.locks.pop(creator_id, None)
        if handle: handle.close()
        self.states[creator_id] = {'creator_id': creator_id, 'state': 'closed', 'observation_state': 'interrupted'}

    async def collect(self, creator):
        creator_id = creator['id']
        context = self.contexts.get(creator_id)
        if not context: return
        state = self.states[creator_id]
        if self.pause.is_set() or creator['paused']:
            state['observation_state'] = 'paused'; return
        config = load_adapter(self.base / 'adapter.json')
        if not config: state['observation_state'] = 'validation_required'; return
        count = 0
        for page in context.pages:
            host = urlparse(page.url).hostname
            if host != PRIVACY_HOST: continue
            events = await observe(page, config, self.secret, creator_id)
            for event in events:
                await asyncio.to_thread(self.api, 'POST', '/agent/observations', event)
                count += 1
        state['observation_state'] = 'partial' if count else 'no_data'

    async def run(self):
        async with async_playwright() as playwright:
            while not self.stop.is_set():
                if not self.token:
                    await asyncio.sleep(2); continue
                try:
                    heartbeat = await asyncio.to_thread(self.api, 'POST', '/agent/heartbeat', {'browsers': list(self.states.values())})
                    self.creators = heartbeat['creators']
                    self.events.put(('creators', self.creators))
                    self.events.put(('status', 'Conectada. Somente a amostra visível pode ser observada.' if heartbeat['storage_allowed'] else 'Conectada. Armazenamento de métricas ainda não autorizado no painel.'))
                    commands = await asyncio.to_thread(self.api, 'GET', '/agent/commands')
                    for command in commands:
                        success, detail = await self.open_profile(playwright, command)
                        await asyncio.to_thread(self.api, 'POST', f"/agent/commands/{command['id']}/ack", {'success': success, 'detail': detail})
                    for creator in self.creators:
                        if heartbeat['storage_allowed']:
                            try: await self.collect(creator)
                            except Exception:
                                if creator['id'] in self.states: self.states[creator['id']]['observation_state'] = 'interrupted'
                        elif creator['id'] in self.states:
                            self.states[creator['id']]['observation_state'] = 'paused'
                except Exception:
                    for state in self.states.values(): state['observation_state'] = 'interrupted'
                    self.events.put(('status', 'Comunicação interrompida. Sem coleta até restabelecer a conexão.'))
                await asyncio.sleep(4)
            for context in list(self.contexts.values()):
                try: await context.close()
                except Exception: pass

    def close(self):
        if messagebox.askyesno('Encerrar estação', 'A leitura será interrompida e as janelas gerenciadas serão fechadas. As sessões permanecerão nos perfis locais enquanto válidas. Continuar?'):
            self.stop.set(); self.pause.set()
            self.status.set('Encerrando as janelas com segurança…')
            self.wait_for_close()

    def wait_for_close(self):
        if hasattr(self, 'worker') and self.worker.is_alive():
            self.app.after(300, self.wait_for_close)
        else: self.app.destroy()

if __name__ == '__main__':
    desktop = Desktop()
    desktop.app.mainloop()