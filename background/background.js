// Service Worker de Segundo Plano (Manifest V3)

// Ouvir atalhos globais de teclado
chrome.commands.onCommand.addListener((command) => {
    if (command === 'capture-area') {
        startAreaCapture();
    } else if (command === 'capture-visible') {
        captureVisibleViewport();
    }
});

// Ouvir mensagens do Popup e Content Scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'trigger-capture-area') {
        startAreaCapture();
        sendResponse({ success: true });
        return false;
    } else if (message.action === 'trigger-capture-visible') {
        captureVisibleViewport();
        sendResponse({ success: true });
        return false;
    } else if (message.action === 'trigger-capture-fullpage') {
        startFullPageCapture();
        sendResponse({ success: true });
        return false;
    } else if (message.action === 'open-dashboard') {
        const hash = message.hash ? `#${message.hash}` : '';
        chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard/dashboard.html${hash}`) });
        sendResponse({ success: true });
        return false;
    } else if (message.action === 'area-selected') {
        // Recebe coordenadas de área selecionada do content script
        handleAreaCapture(message.coords);
        sendResponse({ success: true });
        return false;
    }
    sendResponse({ success: false, error: 'Ação desconhecida' });
    return false;
});

// --- CAPTURA DE ÁREA SELECIONADA ---
function startAreaCapture() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        const activeTab = tabs[0];
        
        if (!isSupportedUrl(activeTab.url)) {
            notifyUnsupported();
            return;
        }
        
        // Envia mensagem se o content script já estiver carregado
        chrome.tabs.sendMessage(activeTab.id, { action: 'init-selection' }, (response) => {
            if (chrome.runtime.lastError) {
                // Injeta CSS de seleção caso não estivesse carregado
                chrome.scripting.insertCSS({
                    target: { tabId: activeTab.id },
                    files: ['content/selection.css']
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('Falha ao injetar CSS de seleção:', chrome.runtime.lastError.message);
                        return;
                    }
                    // Injeta Content Script de desenho de área
                    chrome.scripting.executeScript({
                        target: { tabId: activeTab.id },
                        files: ['content/content.js']
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.warn('Falha ao injetar JS de seleção:', chrome.runtime.lastError.message);
                            return;
                        }
                        // Inicia o desenho da seleção na página
                        chrome.tabs.sendMessage(activeTab.id, { action: 'init-selection' }, () => {
                            if (chrome.runtime.lastError) {
                                console.error('Erro de envio após injeção:', chrome.runtime.lastError.message);
                            }
                        });
                    });
                });
            }
        });
    });
}

function handleAreaCapture(coords) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        const title = tab ? tab.title : 'Captura Recente';
        const url = tab ? tab.url : '';

        // 1. Tira print da tela cheia visível
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
            // 2. Salva a imagem e as coordenadas no storage local
            chrome.storage.local.set({
                capture_type: 'area',
                last_image: dataUrl,
                crop_coords: coords,
                last_capture_title: title,
                last_capture_url: url
            }, () => {
                // 3. Abre o Editor que fará o crop e permitirá anotações
                chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });
            });
        });
    });
}

// --- CAPTURA DE ÁREA VISÍVEL ---
function captureVisibleViewport() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        const title = tab ? tab.title : 'Captura Recente';
        const url = tab ? tab.url : '';

        chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
            chrome.storage.local.set({
                capture_type: 'visible',
                last_image: dataUrl,
                last_capture_title: title,
                last_capture_url: url
            }, () => {
                chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });
            });
        });
    });
}

// --- CAPTURA DE PÁGINA INTEIRA (SCROLLING) ---
// Arquitetura: background controla o loop. Para cada frame:
//   1. executeScript(scroll síncrono) → sem retorno, sem Promise, sem rAF
//   2. sleep(300ms) — tempo suficiente para o browser renderizar
//   3. captureVisibleTab — captura o que está na tela AGORA
// Simples, confiável em todas as versões do Chrome, idêntico ao que funcionou no teste.

async function startFullPageCapture() {
    console.log('[FullPage] Iniciando captura de página cheia com espera ativa no integrado...');
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0]) {
        console.error('[FullPage] Nenhuma aba ativa encontrada.');
        return;
    }
    const tab = tabs[0];
    const tabId = tab.id;
    const frames = [];

    try {
        // 1. Configura a página, desativa smooth scroll e força ativamente a rolagem ao topo absoluto (Y=0)
        console.log('[FullPage] Solicitando rolagem ativa até o topo...');
        const initResults = await chrome.scripting.executeScript({
            target: { tabId },
            func: async () => {
                // Desativa smooth scroll temporariamente
                let s = document.getElementById('__ps_no_smooth');
                if (!s) {
                    s = document.createElement('style');
                    s.id = '__ps_no_smooth';
                    s.textContent = 'html,body,*{scroll-behavior:auto!important;}';
                    (document.head || document.documentElement).appendChild(s);
                }

                // Rola ao topo
                window.scrollTo(0, 0);
                document.documentElement.scrollTop = 0;
                if (document.body) document.body.scrollTop = 0;

                // Aguarda ativamente o scroll atingir Y=0 (timeout de 1.2s com tentativas rápidas)
                const waitForTop = () => {
                    return new Promise((resolve) => {
                        let attempts = 0;
                        const check = () => {
                            const currentY = Math.max(
                                window.scrollY || 0,
                                document.documentElement.scrollTop || 0,
                                document.body ? (document.body.scrollTop || 0) : 0
                            );
                            if (currentY === 0 || attempts > 24) {
                                resolve(currentY);
                            } else {
                                attempts++;
                                window.scrollTo(0, 0);
                                document.documentElement.scrollTop = 0;
                                if (document.body) document.body.scrollTop = 0;
                                setTimeout(check, 50); // Checa a cada 50ms
                            }
                        };
                        check();
                    });
                };

                const finalTopY = await waitForTop();

                return {
                    viewportHeight: window.innerHeight,
                    viewportWidth: window.innerWidth,
                    totalHeight: Math.max(
                        document.documentElement.scrollHeight,
                        document.body ? document.body.scrollHeight : 0
                    ),
                    totalWidth: Math.max(
                        document.documentElement.scrollWidth,
                        document.body ? document.body.scrollWidth : 0
                    ),
                    finalTopY: finalTopY
                };
            }
        });

        const pageInfo = initResults && initResults[0] && initResults[0].result;
        if (!pageInfo || !pageInfo.viewportHeight) {
            console.error('[FullPage] Erro ao ler dimensões iniciais da página.');
            return;
        }

        const { viewportHeight, totalWidth, finalTopY } = pageInfo;
        let totalHeight = pageInfo.totalHeight;
        const scrollStep = viewportHeight - 150; 

        console.log(`[FullPage] Topo alcançado: Y=${finalTopY}. Dimensões: Largura=${totalWidth}px, Altura=${totalHeight}px, Viewport=${viewportHeight}px`);

        // Pequeno sleep final pós-scroll ativo para garantir pintura do browser
        await sleep(200);

        let currentY = 0;
        let frameIndex = 0;
        let fixedHidden = false;
        let lastActualY = -999;

        // Loop de capturas
        while (true) {
            console.log(`[FullPage] Rolando ativamente para Y=${currentY}`);
            
            // Rola e monitora ativamente até atingir a coordenada desejada
            const scrollResults = await chrome.scripting.executeScript({
                target: { tabId },
                func: async (targetY) => {
                    window.scrollTo(0, targetY);
                    document.documentElement.scrollTop = targetY;
                    if (document.body) document.body.scrollTop = targetY;

                    // Aguarda ativamente o scroll estabilizar próximo ao alvo (timeout de 450ms)
                    return new Promise((resolve) => {
                        let attempts = 0;
                        let lastY = -1;
                        const check = () => {
                            const currentY = Math.max(
                                window.scrollY || 0,
                                document.documentElement.scrollTop || 0,
                                document.body ? (document.body.scrollTop || 0) : 0
                            );
                            
                            // Se chegou perto (diferença de 3px), travou fisicamente ou estourou o tempo
                            if (Math.abs(currentY - targetY) <= 3 || currentY === lastY || attempts > 9) {
                                resolve(currentY);
                            } else {
                                lastY = currentY;
                                attempts++;
                                window.scrollTo(0, targetY);
                                document.documentElement.scrollTop = targetY;
                                if (document.body) document.body.scrollTop = targetY;
                                setTimeout(check, 45); // Checa a cada 45ms
                            }
                        };
                        check();
                    });
                },
                args: [currentY]
            });

            const actualY = (scrollResults && scrollResults[0] && scrollResults[0].result != null)
                ? scrollResults[0].result
                : currentY;

            console.log(`[FullPage] Posição de captura garantida: Y=${actualY}`);

            // Oculta elementos fixos
            if (frameIndex === 1 && !fixedHidden) {
                fixedHidden = true;
                console.log('[FullPage] Ocultando elementos fixos e pegajosos...');
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        const all = document.querySelectorAll('*');
                        for (let i = 0; i < all.length; i++) {
                            const el = all[i];
                            if (el.id && el.id.startsWith('__ps')) continue;
                            try {
                                const pos = window.getComputedStyle(el).position;
                                if (pos === 'fixed' || pos === 'sticky') {
                                    el.setAttribute('data-ps-orig-vis', el.style.visibility);
                                    el.style.setProperty('visibility', 'hidden', 'important');
                                }
                            } catch(e) {}
                        }
                    }
                });
            }

            // Captura tab
            console.log(`[FullPage] Capturando frame ${frameIndex}...`);
            const dataUrl = await captureVisibleTabAsync();
            if (dataUrl) {
                frames.push({ y: actualY, image: dataUrl });
                console.log(`[FullPage] Frame ${frameIndex} salvo (Y=${actualY}).`);
            } else {
                console.warn(`[FullPage] Falha ao capturar frame ${frameIndex}.`);
            }

            frameIndex++;

            // Recalcula altura total
            const hRes = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => Math.max(
                    document.documentElement.scrollHeight,
                    document.body ? document.body.scrollHeight : 0
                )
            });
            if (hRes && hRes[0] && hRes[0].result) {
                if (hRes[0].result !== totalHeight) {
                    console.log(`[FullPage] Altura total mudou de ${totalHeight}px para ${hRes[0].result}px`);
                    totalHeight = hRes[0].result;
                }
            }

            // Condições de término
            const atBottom = (actualY + viewportHeight) >= (totalHeight - 5);
            const nextY = actualY + scrollStep;
            
            if (atBottom || nextY >= totalHeight) {
                console.log(`[FullPage] Fim do scroll alcançado. Fim=${atBottom}, PróximoY=${nextY}, AlturaTotal=${totalHeight}`);
                break;
            }

            // Travou scroll?
            if (frameIndex > 1 && actualY <= lastActualY + 5) {
                console.log(`[FullPage] Scroll travou em Y=${actualY}. Finalizando loop de captura.`);
                break;
            }

            lastActualY = actualY;
            currentY = nextY;

            // Intervalo mínimo entre capturas
            await sleep(100);
        }

        // Restaura elementos originais
        console.log('[FullPage] Restaurando layout original da página...');
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                document.querySelectorAll('*').forEach(el => {
                    const v = el.getAttribute('data-ps-orig-vis');
                    if (v !== null) {
                        el.style.visibility = v;
                        el.removeAttribute('data-ps-orig-vis');
                    }
                });
                const s = document.getElementById('__ps_no_smooth');
                if (s) s.remove();
            }
        });

        if (frames.length === 0) {
            console.error('[FullPage] Nenhum frame foi capturado com sucesso.');
            return;
        }

        // Determina a altura final costurada
        const lastFrame = frames[frames.length - 1];
        const realTotalHeight = lastFrame.y + viewportHeight;

        // Salva e abre o editor principal
        const title = tab.title || 'Captura Recente';
        const url = tab.url || '';

        console.log(`[FullPage] Salvando no banco de dados e abrindo editor... Total frames: ${frames.length}, Altura final: ${realTotalHeight}px`);
        
        await saveTempFramesInDB(frames);
        await chrome.storage.local.set({
            capture_type: 'fullpage',
            page_width: totalWidth,
            viewport_height: viewportHeight,
            total_height: realTotalHeight,
            last_capture_title: title,
            last_capture_url: url
        });

        chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });

    } catch (err) {
        console.error('[FullPage] Erro crítico no processo de captura:', err);
    }
}

function captureVisibleTabAsync(retries = 5) {
    return new Promise((resolve) => {
        const attempt = (n) => {
            chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError || !dataUrl) {
                    const msg = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'retorno vazio';
                    console.warn(`[FullPage] Erro captureVisibleTab (tentativas restantes: ${n}): ${msg}`);
                    const isQuota = msg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');
                    if (n > 0) {
                        setTimeout(() => attempt(n - 1), isQuota ? 1000 : 250);
                    } else {
                        resolve(null);
                    }
                } else {
                    resolve(dataUrl);
                }
            });
        };
        attempt(retries);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- BASE DE DADOS (INDEXEDDB) PARA SALVAR FRAMES GIGANTES ---
const DB_NAME = 'printscreen_db';
const STORE_NAME = 'captures';

// Banco dedicado temporário para evitar conflitos de transações do Dashboard
const TEMP_DB_NAME = 'printscreen_temp_db';
const TEMP_STORE_NAME = 'temp_captures';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('date', 'date', { unique: false });
                store.createIndex('category', 'category', { unique: false });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function openTempDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(TEMP_DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(TEMP_STORE_NAME)) {
                db.createObjectStore(TEMP_STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveTempFramesInDB(frames) {
    try {
        const db = await openTempDB();
        const tx = db.transaction(TEMP_STORE_NAME, 'readwrite');
        const store = tx.objectStore(TEMP_STORE_NAME);
        const record = {
            id: 'temp_fullpage_frames',
            frames: frames,
            date: new Date().toISOString()
        };
        return new Promise((resolve, reject) => {
            const req = store.put(record);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error('Erro no IndexedDB temporário a partir do Background:', e);
        throw e;
    }
}

// Criar menu de contexto do botão direito do mouse
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'printscreen-capture-visible',
        title: 'Capturar Tela Inteira Visível',
        contexts: ['all']
    });
    chrome.contextMenus.create({
        id: 'printscreen-capture-area',
        title: 'Capturar Área Selecionada',
        contexts: ['all']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'printscreen-capture-visible') {
        captureVisibleViewport();
    } else if (info.menuItemId === 'printscreen-capture-area') {
        startAreaCapture();
    }
});

// --- HELPER FUNCTIONS FOR SUPPORTED URLS & GRACEFUL NOTIFICATIONS ---
function isSupportedUrl(url) {
    if (!url) return false;
    return !url.startsWith('chrome://') && 
           !url.startsWith('chrome-extension://') && 
           !url.startsWith('view-source:') && 
           !url.startsWith('about:') &&
           !url.includes('chrome.google.com/webstore') &&
           !url.includes('chromewebstore.google.com');
}

function notifyUnsupported() {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: '/assets/icon128.png',
        title: 'PrintScreen Capture',
        message: 'A captura interativa não é suportada em páginas internas do Chrome (chrome://) ou na Web Store por segurança.'
    });
}
