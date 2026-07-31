// Lovfy - by @mumitacho - popup.js
// Cliente de chat não-oficial para projetos Lovable.dev.

(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------
  const state = {
    currentProjectId: null,
    currentTabUrl: null,
    authToken: null,
    cookieString: '',
    browserSessionId: null,
    attachments: [], // { id, file, status: pending|uploading|done|error, progress, fileId, dirName, fileName, downloadUrl, error }
    isSending: false,
    // Janela flutuante: id da janela real do Chrome + última posição
    // conhecida (mantida em memória para não depender de chamadas
    // assíncronas no meio de um gesto de arraste).
    windowId: null,
    windowLeft: 0,
    windowTop: 0,
    // Estado global do drag: enquanto true, nada pode minimizar/ocultar a
    // janela (checado na própria origem, dentro de minimizePanel()).
    isDragging: false,
    // Estado persistido do painel (posição/tamanho expandido + minimizado)
    panel: {
      left: null,
      top: null,
      width: null,
      height: null,
      minimized: false
    }
  };

  // ---------------------------------------------------------------------
  // Elementos DOM
  // ---------------------------------------------------------------------
  const el = {
    app: document.querySelector('.app'),
    projectId: document.getElementById('projectId'),
    projectIdText: document.getElementById('projectIdText'),
    messages: document.getElementById('messages'),
    emptyState: document.getElementById('emptyState'),
    filePreview: document.getElementById('filePreview'),
    attachBtn: document.getElementById('attachBtn'),
    fileInput: document.getElementById('fileInput'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    sendBtnLabel: document.getElementById('sendBtnLabel'),
    statusBar: document.getElementById('statusBar'),
    creatorBtn: document.getElementById('creatorBtn'),
    supportBtn: document.getElementById('supportBtn'),
    header: document.querySelector('.header'),
    minimizeBtn: document.getElementById('minimizeBtn'),
    minimizedFab: document.getElementById('minimizedFab')
  };

  // Mesma chave usada pelo background.js para lembrar o estado do painel
  // (posição, tamanho e se está minimizado).
  const PANEL_STATE_KEY = 'lovfyPanelState';
  const DEFAULT_WIDTH = 400;
  const DEFAULT_HEIGHT = 640;
  const MINI_SIZE = 64;

  // ---------------------------------------------------------------------
  // Utilidades de geração de IDs (fiel ao formato usado pelo Lovable)
  // ---------------------------------------------------------------------
  function generateRandomId(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  function generateRandomHex(bytes) {
    const array = new Uint8Array(bytes);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function timeSortableId() {
    return generateRandomHex(3); // 3 bytes = 6 caracteres hex
  }

  function randomFourId() {
    return generateRandomHex(2); // 2 bytes = 4 caracteres hex
  }

  function generateMessageId() {
    const r = timeSortableId();
    const r2 = randomFourId();
    return {
      userMessageId: `umsg_01ktevtptd${r2}s0d2${r}x8cq70a${generateRandomId(4)}`,
      aiMessageId: `aimsg_01ktevtpvh${r}7n2rj62vz7`
    };
  }

  function uuid() {
    return crypto.randomUUID();
  }

  // ---------------------------------------------------------------------
  // Status bar
  // ---------------------------------------------------------------------
  let statusTimeout = null;
  function showStatus(message, type = 'error', duration = 4000) {
    el.statusBar.textContent = message;
    el.statusBar.className = `status-bar visible ${type}`;
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      el.statusBar.classList.remove('visible');
    }, duration);
  }

  // ---------------------------------------------------------------------
  // Extração do Project ID a partir da URL da aba ativa
  // ---------------------------------------------------------------------
  function extractProjectId(urlStr) {
    if (!urlStr) return null;
    try {
      const url = new URL(urlStr);

      // Padrão principal: https://lovable.dev/projects/<projectId>
      const pathMatch = url.pathname.match(/\/projects\/([a-zA-Z0-9-]+)/);
      if (pathMatch) return pathMatch[1];

      // Padrão de preview: https://id-preview--<projectId>.lovable.app
      const hostname = url.hostname;
      const previewMatch = hostname.match(/^id-preview--([a-zA-Z0-9-]{8,})\./);
      if (previewMatch) return previewMatch[1];

      // Padrão de subdomínio genérico: <projectId>.lovableproject.com / .lovable.app
      if (/\.(lovableproject\.com|lovable\.app)$/.test(hostname)) {
        const sub = hostname.split('.')[0];
        const cleaned = sub.replace(/^id-preview--/, '');
        if (/^[a-zA-Z0-9-]{8,}$/.test(cleaned)) return cleaned;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  // Agora que a extensão roda numa janela flutuante independente (e não mais
  // presa à aba ativa), localizamos a aba do Lovable.dev pesquisando entre
  // todas as janelas do navegador, em vez de depender da "janela atual".
  async function findLovableTab() {
    const tabs = await chrome.tabs.query({
      url: ['https://lovable.dev/*', 'https://*.lovable.dev/*']
    });

    if (!tabs.length) return null;

    const activeOnes = tabs.filter((t) => t.active);
    const pool = activeOnes.length ? activeOnes : tabs;
    pool.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return pool[0];
  }

  // ---------------------------------------------------------------------
  // Cookies e autenticação
  // ---------------------------------------------------------------------
  async function loadAuth() {
    const cookies = await chrome.cookies.getAll({ domain: 'lovable.dev' });

    state.cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const sbToken = cookies.find((c) => c.name === 'sb-access-token');
    const sessionToken = cookies.find((c) => c.name === 'lovable-session-id-v2');

    state.authToken = (sbToken && sbToken.value) || (sessionToken && sessionToken.value) || null;

    if (!state.authToken) {
      throw new Error('Não foi possível localizar os cookies de sessão do Lovable. Faça login em lovable.dev.');
    }
  }

  async function loadBrowserSessionId() {
    const stored = await chrome.storage.local.get('browserSessionId');
    if (stored.browserSessionId) {
      state.browserSessionId = stored.browserSessionId;
      return;
    }
    const newId = uuid();
    await chrome.storage.local.set({ browserSessionId: newId });
    state.browserSessionId = newId;
  }

  // ---------------------------------------------------------------------
  // Inicialização
  // ---------------------------------------------------------------------
  async function init() {
    await loadPanelState();
    applyMinimizedClass(state.panel.minimized);

    try {
      const win = await chrome.windows.getCurrent();
      state.windowId = win.id;
      state.windowLeft = win.left || 0;
      state.windowTop = win.top || 0;
    } catch (err) {
      state.windowId = null;
    }

    bindEvents();
    setComposerDisabled(true);

    // Microinteração de entrada (fade + scale). Puramente visual — não afeta
    // nenhum estado/dado, só dispara a transição CSS de ".app".
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.app.classList.add('mounted'));
    });

    try {
      const tab = await findLovableTab();
      state.currentTabUrl = tab ? tab.url : null;
      state.currentProjectId = extractProjectId(state.currentTabUrl);

      if (!tab) {
        el.projectIdText.textContent = 'Nenhuma aba do Lovable.dev encontrada';
        el.projectId.classList.add('error');
        showStatus('Abra um projeto em lovable.dev em alguma janela para conversar com a IA.', 'error', 6000);
        return;
      }

      if (!state.currentProjectId) {
        el.projectIdText.textContent = 'Nenhum projeto Lovable detectado nesta aba';
        el.projectId.classList.add('error');
        showStatus('Abra um projeto em lovable.dev para conversar com a IA.', 'error', 6000);
        return;
      }

      el.projectIdText.textContent = `Projeto: ${state.currentProjectId}`;

      await Promise.all([loadAuth(), loadBrowserSessionId()]);

      setComposerDisabled(false);
    } catch (error) {
      console.error(error);
      el.projectId.classList.add('error');
      showStatus(error.message || 'Falha ao inicializar a extensão.', 'error', 8000);
    }
  }

  function setComposerDisabled(disabled) {
    el.messageInput.disabled = disabled;
    el.sendBtn.disabled = disabled;
    el.attachBtn.disabled = disabled;
  }

  // ---------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------
  function bindEvents() {
    el.attachBtn.addEventListener('click', () => el.fileInput.click());

    el.fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      files.forEach(handleNewFile);
      el.fileInput.value = '';
    });

    el.sendBtn.addEventListener('click', sendMessage);

    el.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    el.messageInput.addEventListener('input', () => {
      el.messageInput.style.height = 'auto';
      el.messageInput.style.height = `${Math.min(el.messageInput.scrollHeight, 90)}px`;
    });

    if (el.creatorBtn) {
      el.creatorBtn.addEventListener('click', () => {
        window.open('https://www.instagram.com/mumitacho/', '_blank');
      });
    }

    if (el.supportBtn) {
      el.supportBtn.addEventListener('click', () => {
        window.open('https://imgur.com/a/p036IJj', '_blank', 'noopener,noreferrer');
      });
    }

    if (el.minimizeBtn) {
      el.minimizeBtn.addEventListener('click', () => {
        minimizePanel().catch((err) => console.error('Falha ao minimizar:', err));
      });
    }

    if (el.minimizedFab) {
      el.minimizedFab.addEventListener('click', () => {
        restorePanel().catch((err) => console.error('Falha ao restaurar:', err));
      });
    }

    // Debounce proposital: um clique/foco na própria janela pode disparar um
    // "flicker" momentâneo de visibilidade (document.hidden = true por um
    // instante) sem que o usuário realmente tenha saído da aba. Sem esse
    // atraso, esse flicker minimizava a janela bem no início do arraste do
    // header. Reavaliamos as condições só depois do delay, e a guarda
    // definitiva (state.isDragging) mora dentro de minimizePanel(), não aqui.
    let visibilityMinimizeTimer = null;
    document.addEventListener('visibilitychange', () => {
      if (visibilityMinimizeTimer !== null) {
        clearTimeout(visibilityMinimizeTimer);
        visibilityMinimizeTimer = null;
      }

      if (!document.hidden) return;

      visibilityMinimizeTimer = setTimeout(() => {
        visibilityMinimizeTimer = null;
        if (document.hidden && !state.panel.minimized && !state.isDragging) {
          minimizePanel().catch((err) => console.error('[Lovfy] Falha ao minimizar automaticamente:', err));
        }
      }, 220);
    });

    setupWindowDrag();
  }

  // ---------------------------------------------------------------------
  // Arrastar a janela flutuante segurando o header (Pointer Events)
  // ---------------------------------------------------------------------
  // CONTEXTO IMPORTANTE: esta extensão NÃO é um content script injetado na
  // página do Lovable.dev — não existe Shadow DOM nem sobreposição sobre
  // nenhum site (confira manifest.json: não há chave "content_scripts"). O
  // popup.html roda dentro de uma janela de verdade do Chrome, criada via
  // chrome.windows.create({ type: 'popup' }) em background.js.
  //
  // Isso muda a física do problema: uma janela do sistema operacional NUNCA
  // pode ser movida por CSS (position: fixed/left/top de um elemento só
  // move esse elemento *dentro* da própria janela, não a janela em si). A
  // única API capaz de mover a janela de verdade é chrome.windows.update().
  //
  // O clamp abaixo respeita a validação real do Chrome para bounds de janela
  // ("Bounds must be at least 50% within visible screen space"): a margem
  // não é mais um valor fixo em pixels, e sim metade da largura/altura da
  // própria janela — isso garante que pelo menos 50% dela permaneça visível,
  // que é exatamente a regra que o chrome.windows.update exige. Usar uma
  // margem fixa pequena (ex: 40px) deixava o clamp permitir posições que o
  // Chrome rejeitava, fazendo o update falhar em silêncio durante o arraste.
  function setupWindowDrag() {
    if (!chrome.windows) {
      console.error('[Lovfy] Drag não iniciado: API chrome.windows indisponível neste contexto.');
      return;
    }

    // O header (painel expandido) e o botão minimizado compartilham a mesma
    // posição (left/top da janela), então os dois usam exatamente a mesma
    // lógica de arraste — só o "cabo" (elemento que escuta o pointerdown)
    // muda. CSS já garante que só um dos dois fica clicável por vez
    // (pointer-events depende de body.minimized).
    attachDragHandle(el.header);
    attachDragHandle(el.minimizedFab);
  }

  function attachDragHandle(handle) {
    if (!handle) return;

    const DRAG_Z_INDEX = 2147483647;

    const isInteractiveTarget = (target) => {
      if (!target || typeof target.closest !== 'function') return false;
      return !!target.closest('button, a, input, textarea, select, svg, path, [data-no-drag]');
    };

    let dragging = false;
    let pointerId = null;
    let offsetX = 0;
    let offsetY = 0;
    let rafId = null;
    let pendingLeft = null;
    let pendingTop = null;
    let reportedError = false;

    function applyDragVisualState(active) {
      handle.classList.toggle('dragging', active);
      document.documentElement.classList.toggle('wm-dragging', active);
      document.body.style.userSelect = active ? 'none' : '';
      document.body.style.cursor = active ? 'grabbing' : '';
      handle.style.cursor = active ? 'grabbing' : '';
      handle.style.zIndex = active ? String(DRAG_Z_INDEX) : '';
      if (el.app) el.app.style.transform = active ? 'none' : '';
    }

    function onPointerMove(e) {
      if (!dragging || e.pointerId !== pointerId) return;

      const screenW = window.screen.availWidth || window.screen.width || 1920;
      const screenH = window.screen.availHeight || window.screen.height || 1080;
      const winW = window.outerWidth || DEFAULT_WIDTH;
      const winH = window.outerHeight || DEFAULT_HEIGHT;

      let newLeft = e.screenX - offsetX;
      let newTop = e.screenY - offsetY;

      // Pelo menos 50% da janela precisa permanecer dentro da área visível
      // da tela (regra real do Chrome) — a margem é metade da dimensão da
      // própria janela (funciona tanto para o painel 400x640 quanto para o
      // botão minimizado 64x64, já que winW/winH refletem o tamanho atual).
      const marginX = winW / 2;
      const marginY = winH / 2;
      newLeft = Math.min(Math.max(newLeft, marginX - winW), screenW - marginX);
      newTop = Math.min(Math.max(newTop, marginY - winH), screenH - marginY);

      pendingLeft = Math.round(newLeft);
      pendingTop = Math.round(newTop);
      state.windowLeft = pendingLeft;
      state.windowTop = pendingTop;

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (pendingLeft === null || pendingTop === null || !state.windowId) return;
          chrome.windows.update(state.windowId, { left: pendingLeft, top: pendingTop }).catch((err) => {
            if (reportedError) return;
            reportedError = true;
            console.error('[Lovfy] chrome.windows.update falhou durante o arraste:', err);
            showStatus(`Não foi possível mover a janela (${err && err.message ? err.message : err}).`, 'error', 6000);
          });
        });
      }
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      state.isDragging = false;

      applyDragVisualState(false);

      if (pointerId !== null) {
        try {
          handle.releasePointerCapture(pointerId);
        } catch (err) {
          // captura já pode ter sido liberada pelo navegador; ignora
        }
      }

      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', endDrag);
      handle.removeEventListener('pointercancel', endDrag);

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      // left/top são compartilhados pelo painel e pelo botão minimizado:
      // salvar aqui é suficiente para que, ao restaurar, a janela reabra
      // exatamente onde o botão foi arrastado (ou onde o header foi solto).
      if (pendingLeft !== null && pendingTop !== null) {
        savePanelState({ left: pendingLeft, top: pendingTop }).catch((err) =>
          console.error('[Lovfy] Falha ao salvar a posição da janela:', err)
        );
      }

      pendingLeft = null;
      pendingTop = null;
      pointerId = null;
      reportedError = false;
    }

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // só o botão esquerdo do mouse inicia o drag
      if (isInteractiveTarget(e.target)) return;

      if (!state.windowId) {
        // Sem o id da janela não há como movê-la de verdade. Tenta recuperar
        // para a próxima tentativa e avisa no console em vez de falhar em
        // silêncio.
        console.warn('[Lovfy] windowId ainda não disponível ao iniciar o drag — tentando recuperar.');
        chrome.windows
          .getCurrent()
          .then((win) => {
            state.windowId = win.id;
            state.windowLeft = win.left || 0;
            state.windowTop = win.top || 0;
          })
          .catch((err) => console.error('[Lovfy] Não foi possível obter a janela atual:', err));
        return;
      }

      // ---- POINTERDOWN ----
      // 1) posição inicial do mouse (screen space) + 2) posição atual da
      // janela (mantida em memória) → 3) offset entre os dois.
      offsetX = e.screenX - state.windowLeft;
      offsetY = e.screenY - state.windowTop;

      dragging = true;
      state.isDragging = true; // a partir daqui, minimizePanel() se recusa a rodar
      pointerId = e.pointerId;
      reportedError = false;

      // Marca o clique como "interno" e dá prioridade ao drag.
      e.stopPropagation();
      e.preventDefault(); // evita seleção de texto / drag nativo de imagem

      try {
        handle.setPointerCapture(pointerId);
      } catch (err) {
        console.error('[Lovfy] setPointerCapture falhou:', err);
      }

      applyDragVisualState(true);

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    });
  }

  // ---------------------------------------------------------------------
  // Minimizar / restaurar (painel flutuante)
  // ---------------------------------------------------------------------
  function applyMinimizedClass(minimized) {
    document.body.classList.toggle('minimized', !!minimized);
  }

  async function minimizePanel() {
    // Guarda na ORIGEM: nenhum chamador (botão minimizar, fab, visibilitychange
    // automático, ou qualquer código futuro) pode minimizar/ocultar a janela
    // enquanto um arraste do header estiver em andamento.
    if (state.isDragging) return;
    if (state.panel.minimized) return;
    if (!state.windowId) return;

    let current;
    try {
      current = await chrome.windows.get(state.windowId);
    } catch (err) {
      return;
    }

    applyMinimizedClass(true);

    try {
      // Só o tamanho encolhe — left/top não são tocados, então o botão
      // minimizado nasce exatamente na mesma posição em que a janela estava
      // (nunca reposicionamos para um canto da tela).
      await chrome.windows.update(state.windowId, {
        width: MINI_SIZE,
        height: MINI_SIZE
      });
    } catch (err) {
      // mantém o estado visual minimizado mesmo se o resize falhar
    }

    await savePanelState({
      left: current.left,
      top: current.top,
      width: current.width,
      height: current.height,
      minimized: true
    });
  }

  async function restorePanel() {
    if (!state.panel.minimized) return;
    if (!state.windowId) return;

    const width = state.panel.width || DEFAULT_WIDTH;
    const height = state.panel.height || DEFAULT_HEIGHT;
    const hasSavedPosition = typeof state.panel.left === 'number' && typeof state.panel.top === 'number';

    const updateOptions = { width, height };
    if (hasSavedPosition) {
      updateOptions.left = state.panel.left;
      updateOptions.top = state.panel.top;
    }

    try {
      await chrome.windows.update(state.windowId, updateOptions);
      if (hasSavedPosition) {
        state.windowLeft = state.panel.left;
        state.windowTop = state.panel.top;
      }
    } catch (err) {
      // segue para revelar a UI mesmo se o resize falhar
    }

    applyMinimizedClass(false);
    await savePanelState({ minimized: false });
  }

  // ---------------------------------------------------------------------
  // Persistência do estado do painel (chrome.storage.local, com fallback
  // para localStorage caso a API não esteja disponível)
  // ---------------------------------------------------------------------
  async function loadPanelState() {
    let stored = null;

    try {
      if (chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(PANEL_STATE_KEY);
        if (result[PANEL_STATE_KEY]) stored = result[PANEL_STATE_KEY];
      }
    } catch (err) {
      // tenta localStorage abaixo
    }

    if (!stored) {
      try {
        const raw = localStorage.getItem(PANEL_STATE_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch (err) {
        stored = null;
      }
    }

    if (stored) {
      state.panel = { ...state.panel, ...stored };
    }
  }

  async function savePanelState(partial) {
    state.panel = { ...state.panel, ...partial };
    const payload = { ...state.panel };

    try {
      if (!chrome.storage || !chrome.storage.local) throw new Error('chrome.storage.local indisponível');
      await chrome.storage.local.set({ [PANEL_STATE_KEY]: payload });
    } catch (err) {
      try {
        localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(payload));
      } catch (lsErr) {
        console.error('Não foi possível salvar o estado do painel:', lsErr);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Mensagens na UI
  // ---------------------------------------------------------------------
  function scrollMessagesToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function renderMessage({ role, text, files = [], pending = false }) {
    if (el.emptyState) {
      el.emptyState.remove();
    }

    const bubble = document.createElement('div');
    bubble.className = `message ${role}${pending ? ' pending' : ''}`;
    bubble.textContent = text || '';

    if (files.length) {
      const filesWrap = document.createElement('div');
      filesWrap.className = 'msg-files';
      files.forEach((f) => {
        const link = document.createElement('a');
        link.className = 'msg-file-link';
        link.href = f.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `📎 ${f.name}`;
        filesWrap.appendChild(link);
      });
      bubble.appendChild(filesWrap);
    }

    el.messages.appendChild(bubble);
    scrollMessagesToBottom();
    return bubble;
  }

  // ---------------------------------------------------------------------
  // Preview / upload de arquivos
  // ---------------------------------------------------------------------
  function handleNewFile(file) {
    const attachment = {
      id: uuid(),
      file,
      status: 'pending',
      progress: 0,
      fileId: null,
      dirName: null,
      fileName: null,
      downloadUrl: null,
      error: null
    };
    state.attachments.push(attachment);
    renderFilePreview();
    uploadAttachment(attachment).catch((err) => {
      console.error('Falha no upload:', err);
    });
  }

  function removeAttachment(id) {
    state.attachments = state.attachments.filter((a) => a.id !== id);
    renderFilePreview();
  }

  function renderFilePreview() {
    el.filePreview.innerHTML = '';

    state.attachments.forEach((att) => {
      const chip = document.createElement('div');
      chip.className = `file-chip ${att.status}`;

      const icon = document.createElement('div');
      icon.className = 'file-chip-icon';
      icon.textContent = '📄';

      if (att.status === 'uploading') {
        const spinner = document.createElement('div');
        spinner.className = 'file-chip-spinner';
        chip.appendChild(spinner);
      } else {
        chip.appendChild(icon);
      }

      const info = document.createElement('div');
      info.className = 'file-chip-info';

      const name = document.createElement('div');
      name.className = 'file-chip-name';
      name.textContent = att.file.name;
      info.appendChild(name);

      const track = document.createElement('div');
      track.className = 'file-chip-progress-track';
      const fill = document.createElement('div');
      fill.className = 'file-chip-progress-fill';
      fill.style.width = `${att.progress}%`;
      track.appendChild(fill);
      info.appendChild(track);

      const statusText = document.createElement('div');
      statusText.className = 'file-chip-status';
      statusText.textContent = describeAttachmentStatus(att);
      info.appendChild(statusText);

      chip.appendChild(info);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-chip-remove';
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => removeAttachment(att.id));
      chip.appendChild(removeBtn);

      el.filePreview.appendChild(chip);
    });
  }

  function describeAttachmentStatus(att) {
    switch (att.status) {
      case 'pending':
        return 'Aguardando...';
      case 'uploading':
        return `Enviando... ${att.progress}%`;
      case 'done':
        return 'Pronto';
      case 'error':
        return att.error || 'Falha no upload';
      default:
        return '';
    }
  }

  function updateAttachmentUI(att) {
    renderFilePreview();
  }

  // ---------------------------------------------------------------------
  // Upload de arquivos - fluxo de 3 etapas
  // ---------------------------------------------------------------------
  async function uploadAttachment(att) {
    att.status = 'uploading';
    att.progress = 0;
    updateAttachmentUI(att);

    try {
      // Etapa 1: Gerar URL de upload
      const uploadData = await generateUploadUrl(att.file);
      att.progress = 25;
      updateAttachmentUI(att);

      // Etapa 2: Upload do arquivo para o Google Cloud Storage
      const fileBuffer = await att.file.arrayBuffer();
      await uploadFileToStorage(att, uploadData, fileBuffer);
      att.progress = 80;
      updateAttachmentUI(att);

      // Etapa 3: Obter a URL final de download
      const downloadUrl = await generateDownloadUrl(uploadData.file_id);

      att.fileId = uploadData.file_id;
      const [dirName, fileName] = String(uploadData.file_id).split('/');
      att.dirName = dirName;
      att.fileName = fileName;
      att.downloadUrl = downloadUrl;
      att.status = 'done';
      att.progress = 100;
      updateAttachmentUI(att);
    } catch (error) {
      console.error(error);
      att.status = 'error';
      att.error = error.message || 'Falha no upload';
      updateAttachmentUI(att);
      showStatus(`Erro ao enviar ${att.file.name}: ${att.error}`, 'error', 6000);
    }
  }

  function buildCommonHeaders(extra = {}) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.authToken}`,
      'Origin': 'https://lovable.dev',
      'Referer': 'https://lovable.dev/',
      'Cookie': state.cookieString,
      ...extra
    };
  }

  async function generateUploadUrl(file) {
    const response = await fetch(
      `https://api.lovable.dev/projects/${state.currentProjectId}/files/generate-upload-url`,
      {
        method: 'POST',
        headers: buildCommonHeaders({
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
          'x-client-git-sha': '04b3668677038d15039de65e27688c38ab80e9ab',
          'x-browser-session-id': state.browserSessionId,
          'x-lov-platform': '{"platform":"web","version":"96d78a825f60be3df0ab1bd832c8f511eb4b5775"}'
        }),
        body: JSON.stringify({
          original_file_name: file.name,
          content_type: file.type || 'application/octet-stream',
          file_size_bytes: file.size,
          original_file_size_bytes: file.size
        })
      }
    );

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(`generate-upload-url falhou (${response.status}): ${text}`);
    }

    const data = await response.json();
    if (!data || !data.url || !data.file_id) {
      throw new Error('Resposta inesperada de generate-upload-url.');
    }
    return data;
  }

  async function uploadFileToStorage(att, uploadData, fileBuffer) {
    const putHeaders = {
      'Content-Type': att.file.type || 'application/octet-stream',
      'x-goog-content-length-range': uploadData.headers && uploadData.headers['x-goog-content-length-range'],
      'x-goog-meta-user_id': uploadData.headers && uploadData.headers['x-goog-meta-user_id']
    };

    let uploadSuccess = false;

    // Método 1: fetch nativo
    try {
      const uploadResponse = await fetch(uploadData.url, {
        method: 'PUT',
        mode: 'cors',
        headers: putHeaders,
        body: fileBuffer
      });
      uploadSuccess = uploadResponse.ok;
      if (!uploadSuccess) {
        throw new Error(`Upload fetch respondeu status ${uploadResponse.status}`);
      }
    } catch (fetchError) {
      console.log('Fetch falhou, tentando método alternativo (XHR):', fetchError);

      // Método 2: XMLHttpRequest, com progresso real de upload
      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', uploadData.url);
          xhr.setRequestHeader('Content-Type', putHeaders['Content-Type']);
          if (putHeaders['x-goog-content-length-range']) {
            xhr.setRequestHeader('x-goog-content-length-range', putHeaders['x-goog-content-length-range']);
          }
          if (putHeaders['x-goog-meta-user_id']) {
            xhr.setRequestHeader('x-goog-meta-user_id', putHeaders['x-goog-meta-user_id']);
          }

          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              const pct = 25 + Math.round((evt.loaded / evt.total) * 50);
              att.progress = Math.min(pct, 79);
              updateAttachmentUI(att);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              uploadSuccess = true;
              resolve();
            } else {
              reject(new Error(`XHR upload falhou: ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error('Erro de rede no XHR'));
          xhr.send(fileBuffer);
        });
      } catch (xhrError) {
        console.log('XHR falhou, tentando via background script:', xhrError);

        // Método 3: delegar para o background script (contorna CORS do popup)
        try {
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              {
                action: 'uploadToStorage',
                data: {
                  url: uploadData.url,
                  headers: putHeaders,
                  body: Array.from(new Uint8Array(fileBuffer)),
                  fileId: att.id
                }
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.success) {
                  uploadSuccess = true;
                  resolve(response);
                } else {
                  reject(new Error((response && response.error) || 'Falha desconhecida no background'));
                }
              }
            );
          });
        } catch (bgError) {
          throw new Error(`Todos os métodos de upload falharam: ${bgError.message}`);
        }
      }
    }

    if (!uploadSuccess) {
      throw new Error('Não foi possível enviar o arquivo para o storage.');
    }
  }

  async function generateDownloadUrl(fileId) {
    const [dirName, fileName] = String(fileId).split('/');

    const response = await fetch('https://api.lovable.dev/files/generate-download-url', {
      method: 'POST',
      headers: buildCommonHeaders(),
      body: JSON.stringify({
        dir_name: dirName,
        file_name: fileName
      })
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(`generate-download-url falhou (${response.status}): ${text}`);
    }

    const data = await response.json();
    const url = data.url || data.download_url || data.downloadUrl;
    if (!url) {
      throw new Error('Resposta inesperada de generate-download-url.');
    }
    return url;
  }

  async function safeReadText(response) {
    try {
      return await response.text();
    } catch (e) {
      return '';
    }
  }

  // ---------------------------------------------------------------------
  // Envio de mensagem para o chat
  // ---------------------------------------------------------------------
  async function sendMessage() {
    if (state.isSending) return;

    if (!state.currentProjectId || !state.authToken) {
      showStatus('Extensão não inicializada corretamente. Recarregue a aba do Lovable.', 'error');
      return;
    }

    const text = el.messageInput.value.trim();

    if (state.attachments.some((a) => a.status === 'uploading' || a.status === 'pending')) {
      showStatus('Aguarde o upload dos arquivos terminar antes de enviar.', 'error');
      return;
    }

    const failedAttachments = state.attachments.filter((a) => a.status === 'error');
    if (failedAttachments.length) {
      showStatus('Remova os arquivos com falha no upload antes de enviar.', 'error');
      return;
    }

    const readyAttachments = state.attachments.filter((a) => a.status === 'done');

    if (!text && !readyAttachments.length) {
      showStatus('Escreva uma mensagem ou anexe um arquivo.', 'error');
      return;
    }

    state.isSending = true;
    setSendingUI(true);

    const ids = generateMessageId();
    const filesPayload = readyAttachments.map((a) => ({
      id: a.fileId,
      url: a.downloadUrl,
      name: a.file.name,
      content_type: a.file.type || 'application/octet-stream',
      size: a.file.size
    }));

    renderMessage({ role: 'user', text, files: filesPayload });
    el.messageInput.value = '';
    el.messageInput.style.height = 'auto';

    let currentPage = '/';
    try {
      currentPage = new URL(state.currentTabUrl).pathname || '/';
    } catch (e) {
      // mantém o valor padrão
    }

    const messageBody = {
      id: ids.userMessageId,
      message: text,
      files: filesPayload,
      selected_elements: [],
      chat_only: false,
      optimisticImageUrls: [],
      intent: 'fix_error',
      message_intent_metadata: {
        fix_error_metadata: {
          errors: [
            {
              error_type: 'build',
              error_message: '',
              build_event_id: 'main:agent#00000000000123#bld:ZDP4ZE3D'
            }
          ]
        }
      },
      contains_error: true,
      error_ids: ['main:agent#00000000000123#bld:ZDP4ZE3D'],
      ai_message_id: ids.aiMessageId,
      thread_id: 'main',
      current_page: currentPage,
      current_viewport_width: window.innerWidth,
      current_viewport_height: window.innerHeight,
      current_viewport_dpr: window.devicePixelRatio,
      view: 'preview',
      view_description: 'The user is currently viewing the preview.',
      model: null,
      network_requests: [],
      runtime_errors: [],
      integration_metadata: {
        browser: {
          preview_viewport_width: window.innerWidth,
          preview_viewport_height: window.innerHeight,
          is_logged_out: true
        }
      }
    };

    state.attachments = [];
    renderFilePreview();

    const pendingAiBubble = renderMessage({ role: 'ai', text: 'Pensando...', pending: true });

    try {
      const response = await fetch(`https://api.lovable.dev/projects/${state.currentProjectId}/chat`, {
        method: 'POST',
        headers: buildCommonHeaders({
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
        }),
        body: JSON.stringify(messageBody)
      });

      if (!response.ok) {
        const errText = await safeReadText(response);
        throw new Error(`Falha ao enviar mensagem (${response.status}): ${errText}`);
      }

      let aiText = 'Mensagem enviada.';
      try {
        const data = await response.json();
        aiText = data.message || data.text || data.content || aiText;
      } catch (e) {
        // resposta pode não ser JSON (ex: stream); mantém texto padrão
      }

      pendingAiBubble.textContent = aiText;
      pendingAiBubble.classList.remove('pending');
      scrollMessagesToBottom();

      showStatus('Mensagem enviada com sucesso.', 'success');
    } catch (error) {
      console.error(error);
      pendingAiBubble.textContent = `Erro: ${error.message}`;
      pendingAiBubble.classList.remove('pending');
      pendingAiBubble.classList.add('system');
      showStatus(error.message || 'Falha ao enviar mensagem.', 'error', 6000);
    } finally {
      state.isSending = false;
      setSendingUI(false);
    }
  }

  // Mesmo ícone (seta) usado estaticamente em popup.html dentro de
  // #sendBtnLabel — mantido idêntico aqui para não trocar o visual do botão
  // depois do primeiro envio.
  const SEND_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="12" y1="19" x2="12" y2="5"></line>' +
    '<polyline points="6 11 12 5 18 11"></polyline>' +
    '</svg>';

  function setSendingUI(sending) {
    el.messageInput.disabled = sending;
    el.attachBtn.disabled = sending;
    el.sendBtn.disabled = sending;
    el.sendBtnLabel.innerHTML = sending ? '' : SEND_ICON_SVG;
    if (sending) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      el.sendBtnLabel.appendChild(spinner);
    }
  }

  // ---------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', init);
})();
