// Lovfy - by @mumitacho - background service worker
// Responsável por contornar restrições de CORS que o popup pode sofrer,
// principalmente no PUT de upload de arquivos para o Google Cloud Storage.

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('browserSessionId', (result) => {
    if (!result.browserSessionId) {
      chrome.storage.local.set({ browserSessionId: crypto.randomUUID() });
    }
  });
});

// -------------------------------------------------------------------------
// Painel flutuante: em vez do popup padrão (que fica preso ao ícone da
// extensão e não pode ser movido), abrimos uma janela real do Chrome. A
// posição é controlada inteiramente pelo popup.js (arraste pelo header e
// minimizar/restaurar); aqui só decidimos onde/como a janela nasce.
// -------------------------------------------------------------------------
const PANEL_STATE_KEY = 'lovfyPanelState';
const WINDOW_ID_KEY = 'popupWindowId';

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 640;
const MINI_SIZE = 64;
const SCREEN_MARGIN = 24;

async function getStoredWindowId() {
  const result = await chrome.storage.session.get(WINDOW_ID_KEY);
  return typeof result[WINDOW_ID_KEY] === 'number' ? result[WINDOW_ID_KEY] : null;
}

async function setStoredWindowId(id) {
  if (id === null) {
    await chrome.storage.session.remove(WINDOW_ID_KEY);
  } else {
    await chrome.storage.session.set({ [WINDOW_ID_KEY]: id });
  }
}

// Área de trabalho (excluindo a barra de tarefas) da tela onde deve nascer a
// janela. Usa a exibição primária como aproximação segura.
async function getWorkArea() {
  try {
    const displays = await chrome.system.display.getInfo();
    const primary = displays.find((d) => d.isPrimary) || displays[0];
    if (primary && primary.workArea) return primary.workArea;
  } catch (e) {
    // chrome.system.display indisponível; cai no fallback abaixo
  }
  return { left: 0, top: 0, width: 1366, height: 768 };
}

async function computeExpandedDefaultPosition(width, height) {
  const area = await getWorkArea();
  const left = area.left + area.width - width - SCREEN_MARGIN;
  const top = area.top + Math.max(Math.round((area.height - height) / 2), SCREEN_MARGIN);
  return { left, top };
}

chrome.action.onClicked.addListener(async () => {
  const existingId = await getStoredWindowId();

  if (existingId !== null) {
    try {
      await chrome.windows.get(existingId);
      await chrome.windows.update(existingId, { focused: true });
      return;
    } catch (e) {
      // a janela não existe mais; segue para criar uma nova
      await setStoredWindowId(null);
    }
  }

  const stored = await chrome.storage.local.get(PANEL_STATE_KEY);
  const panel = stored[PANEL_STATE_KEY] || {};

  // left/top são compartilhados pelo painel expandido e pelo botão
  // minimizado (a mesma janela, só muda de tamanho) — por isso usamos a
  // posição salva independentemente do estado minimizado, em vez de
  // recalcular um canto da tela.
  const width = panel.minimized ? MINI_SIZE : panel.width || DEFAULT_WIDTH;
  const height = panel.minimized ? MINI_SIZE : panel.height || DEFAULT_HEIGHT;
  const hasSavedPosition = typeof panel.left === 'number' && typeof panel.top === 'number';
  const pos = hasSavedPosition
    ? { left: panel.left, top: panel.top }
    : await computeExpandedDefaultPosition(panel.width || DEFAULT_WIDTH, panel.height || DEFAULT_HEIGHT);

  const createOptions = {
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width,
    height,
    left: pos.left,
    top: pos.top,
    focused: true
  };

  const win = await chrome.windows.create(createOptions);
  await setStoredWindowId(win.id);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const existingId = await getStoredWindowId();
  if (windowId === existingId) {
    await setStoredWindowId(null);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.action === 'uploadToStorage') {
    handleUploadToStorage(message.data)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }));
    return true; // mantém o canal aberto para resposta assíncrona
  }

  if (message.action === 'getBrowserSessionId') {
    chrome.storage.local.get('browserSessionId', (result) => {
      if (result.browserSessionId) {
        sendResponse({ success: true, browserSessionId: result.browserSessionId });
      } else {
        const newId = crypto.randomUUID();
        chrome.storage.local.set({ browserSessionId: newId }, () => {
          sendResponse({ success: true, browserSessionId: newId });
        });
      }
    });
    return true;
  }

  return false;
});

async function handleUploadToStorage(data) {
  const { url, headers, body, fileId } = data || {};
  if (!url || !body) {
    throw new Error('Dados de upload inválidos recebidos pelo background.');
  }

  const buffer = new Uint8Array(body).buffer;

  const response = await fetch(url, {
    method: 'PUT',
    headers: headers || {},
    body: buffer
  });

  if (!response.ok) {
    throw new Error(`Upload para o storage falhou com status ${response.status}`);
  }

  return { fileId, status: response.status };
}
