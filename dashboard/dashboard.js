// Painel PrintScreen - Dashboard de Biblioteca & Configurações

const DB_NAME = 'printscreen_db';
const STORE_NAME = 'captures';

let db = null;
let allCaptures = [];
let currentCategory = 'all';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inicializar Banco de Dados
    try {
        db = await openDB();
        await loadCaptures();
    } catch (e) {
        console.error('Falha ao inicializar o IndexedDB:', e);
    }

    // 2. Setup de Tabs
    setupTabs();

    // 3. Setup de Configurações (Chaves API)
    setupSettings();
    setupAuthAndCredits();

    // 4. Setup de Busca & Filtros
    setupFilters();

    // 5. Setup de Botões Auxiliares
    const btnNewCapture = document.getElementById('btnNewCapture');
    if (btnNewCapture) {
        btnNewCapture.addEventListener('click', () => {
            showToast('Use o ícone da extensão ou os atalhos Ctrl+Shift+Y / Ctrl+Shift+H!');
        });
    }
});

// --- INDEXEDDB WRAPPERS ---

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

function getStore(mode) {
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
}

function getAllRecords() {
    return new Promise((resolve, reject) => {
        const store = getStore('readonly');
        const req = store.getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
    });
}

function deleteRecord(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- CONTROLE DE CAPTURAS E PROCESSAMENTO ---

async function loadCaptures() {
    allCaptures = await getAllRecords();
    // Ordenar por data decrescente (mais recente primeiro)
    allCaptures.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    renderStats();
    renderGrid();
}

function renderStats() {
    const totalCount = allCaptures.length;
    let aiCount = 0;
    let totalBytes = 0;

    allCaptures.forEach(cap => {
        if (cap.ai_extraction && cap.ai_extraction.trim().length > 0) {
            aiCount++;
        }
        if (cap.image) {
            // Estima tamanho em bytes do base64
            totalBytes += cap.image.length * 0.75;
        }
    });

    const mbSize = (totalBytes / (1024 * 1024)).toFixed(1);

    document.getElementById('statTotal').textContent = totalCount;
    document.getElementById('statAi').textContent = aiCount;
    document.getElementById('statStorage').textContent = `${mbSize} MB`;
}

function renderGrid() {
    const grid = document.getElementById('historyGrid');
    const emptyState = document.getElementById('emptyState');
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.toLowerCase().trim();

    // Filtra as capturas baseadas no termo de busca e categoria selecionada
    const filtered = allCaptures.filter(cap => {
        const matchesCategory = currentCategory === 'all' || cap.category === currentCategory;
        
        let matchesQuery = true;
        if (query.length > 0) {
            const titleMatch = (cap.title || '').toLowerCase().includes(query);
            const notesMatch = (cap.notes || '').toLowerCase().includes(query);
            const aiMatch = (cap.ai_extraction || '').toLowerCase().includes(query);
            const tagMatch = (cap.tags || []).some(tag => tag.toLowerCase().includes(query));
            matchesQuery = titleMatch || notesMatch || aiMatch || tagMatch;
        }
        
        return matchesCategory && matchesQuery;
    });

    // Limpa cards antigos, mantendo apenas a div emptyState
    const oldCards = grid.querySelectorAll('.capture-card');
    oldCards.forEach(c => c.remove());

    if (filtered.length === 0) {
        emptyState.style.display = 'flex';
        // Se houver busca ativa, altera texto do empty state
        if (query.length > 0) {
            emptyState.querySelector('h3').textContent = 'Nenhuma captura correspondente';
            emptyState.querySelector('p').textContent = 'Tente pesquisar usando outros termos ou remova os filtros.';
        } else {
            emptyState.querySelector('h3').textContent = 'Sua biblioteca está vazia';
            emptyState.querySelector('p').textContent = 'Faça seu primeiro printscreen usando a extensão e edite para guardar histórico!';
        }
    } else {
        emptyState.style.display = 'none';
        
        filtered.forEach(cap => {
            const card = document.createElement('div');
            card.className = 'capture-card';
            card.setAttribute('data-id', cap.id);
            
            // Formatando data legível
            const dateObj = new Date(cap.date);
            const formattedDate = dateObj.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            // Tags HTML string
            const tagsHtml = (cap.tags || []).map(t => `<span class="card-tag">${t}</span>`).join('');

            // Nota para exibir no card (preview truncado)
            const notesPreview = (cap.notes || '').trim();
            const notesDisplay = notesPreview.length > 0
                ? notesPreview.substring(0, 60) + (notesPreview.length > 60 ? '…' : '')
                : '';

            // Título curto da URL (domínio) ou fallback
            const urlShort = (() => {
                try { return new URL(cap.url).hostname.replace('www.', ''); } catch { return cap.title || 'Capturado localmente'; }
            })();

            card.innerHTML = `
                <div class="card-preview-area">
                    <img src="${cap.image}" alt="Preview" class="card-preview-img" loading="lazy">
                    <span class="card-badge">${cap.category || 'Outros'}</span>
                    <div class="card-actions-overlay">
                        <button class="card-btn btn-edit" title="Abrir no Editor">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        </button>
                        <button class="card-btn btn-download" title="Baixar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        </button>
                        <button class="card-btn btn-delete" title="Excluir">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
                <div class="card-details">
                    <div class="card-title-row">
                        ${notesDisplay
                            ? `<span class="card-notes-preview" title="${cap.notes}">📝 ${notesDisplay}</span>`
                            : `<span class="card-url card-url--solo" title="${cap.url || ''}">${urlShort}</span>`
                        }
                        ${(cap.tags || []).length > 0 ? `<div class="card-tags card-tags--top">${(cap.tags || []).map(t => `<span class="card-tag">${t}</span>`).join('')}</div>` : ''}
                    </div>
                    <div class="card-footer">
                        <span class="card-date">${formattedDate}</span>
                        ${(cap.tags || []).length === 0 && !notesDisplay ? '' : `<span class="card-url" title="${cap.url || ''}" style="font-size:10px;opacity:0.5;">${urlShort}</span>`}
                    </div>
                </div>
            `;


            // Event Listeners dos botões internos do card
            card.querySelector('.btn-edit').addEventListener('click', (e) => {
                e.stopPropagation();
                openInEditor(cap);
            });

            card.querySelector('.btn-download').addEventListener('click', (e) => {
                e.stopPropagation();
                downloadImage(cap);
            });

            card.querySelector('.btn-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDelete(cap.id);
            });

            // Clique no próprio card abre no editor
            card.addEventListener('click', () => {
                openInEditor(cap);
            });

            grid.appendChild(card);
        });
    }
}

// --- FUNÇÕES DE INTERAÇÃO COM CARD ---

function openInEditor(cap) {
    // Carrega a imagem e dados no chrome.storage local
    chrome.storage.local.set({
        capture_type: 'visible',
        last_image: cap.image,
        last_capture_title: cap.title,
        last_capture_url: cap.url
    }, () => {
        // Redireciona ou abre o Editor
        window.open('../editor/editor.html', '_blank');
    });
}

function downloadImage(cap) {
    const link = document.createElement('a');
    link.download = `${cap.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${Date.now()}.png`;
    link.href = cap.image;
    link.click();
    showToast('✓ Imagem baixada com sucesso!');
}

async function confirmDelete(id) {
    if (confirm('Tem certeza que deseja excluir esta captura permanentemente?')) {
        try {
            await deleteRecord(id);
            showToast('✓ Captura excluída com sucesso!');
            await loadCaptures();
        } catch (e) {
            console.error(e);
            showToast('Falha ao excluir captura.');
        }
    }
}

// --- INTERFACE DE NAVEGAÇÃO E TAB SWITCHING ---

function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Verifica hash na URL
    const hash = window.location.hash.substring(1);
    if (hash === 'settings') {
        switchTab('settings');
    } else {
        switchTab('history');
    }
}

function switchTab(tabId) {
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    tabPanes.forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });
}

// --- CONFIGURAÇÃO DE CHAVES API ---

function setupSettings() {
    const settingsForm = document.getElementById('settingsForm');
    const geminiKey = document.getElementById('geminiKey');
    const openaiKey = document.getElementById('openaiKey');
    const openaiModel = document.getElementById('openaiModel');

    // Carrega chaves salvas do storage local
    chrome.storage.local.get(['openai_key', 'gemini_key', 'openai_model'], (res) => {
        if (res.gemini_key) geminiKey.value = res.gemini_key;
        if (res.openai_key) openaiKey.value = res.openai_key;
        if (res.openai_model) openaiModel.value = res.openai_model;
    });

    // Salva chaves ao enviar o formulário
    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        chrome.storage.local.set({
            gemini_key: geminiKey.value.trim(),
            openai_key: openaiKey.value.trim(),
            openai_model: openaiModel.value
        }, () => {
            showToast('✓ Configurações salvas com sucesso!');
        });
    });
}

// --- CONTROLE DE FILTROS E BUSCA ---

function setupFilters() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilters = document.getElementById('categoryFilters');

    // Evento de Digitação da Busca
    searchInput.addEventListener('input', () => {
        renderGrid();
    });

    // Eventos dos botões de filtro de Categoria
    categoryFilters.querySelectorAll('.filter-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            categoryFilters.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            currentCategory = tag.getAttribute('data-category');
            renderGrid();
        });
    });
}

// --- UTILS ---

function showToast(message) {
    const toast = document.getElementById('toastNotification');
    toast.textContent = message;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// --- CONTA & CRÉDITOS 4ULABS (CHECKOUT PIX & BACKDOOR) ---

function setupAuthAndCredits() {
    const loggedOutContainer = document.getElementById('auth-logged-out');
    const loggedInContainer = document.getElementById('auth-logged-in');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const authEmailInput = document.getElementById('auth-email');
    const authPasswordInput = document.getElementById('auth-password');
    
    // --- EASTER EGG LOGO (5 CLIQUES PARA O DEV BACKDOOR) ---
    const logoLink = document.getElementById('logo-link');
    if (logoLink) {
        logoLink.addEventListener('click', (e) => {
            const now = Date.now();
            let clicks = parseInt(localStorage.getItem('logo_clicks') || '0');
            let lastClick = parseInt(localStorage.getItem('logo_last_click') || '0');

            if (now - lastClick < 2000) {
                clicks++;
            } else {
                clicks = 1;
            }

            localStorage.setItem('logo_clicks', clicks);
            localStorage.setItem('logo_last_click', now);

            if (clicks >= 5) {
                localStorage.removeItem('logo_clicks');
                localStorage.removeItem('logo_last_click');
                
                // Muda para aba de configurações
                switchTab('settings');
                
                // Ativa a aba de login no formulário
                tabLogin.click();
                
                // Preenche as credenciais padrão de dev
                authEmailInput.value = 'fbr4g4@gmail.com';
                authPasswordInput.value = 'Fbr4g4..';
                
                showToast("🔧 [4uLabs] Modo Desenvolvedor Ativado! Credenciais preenchidas.");
            }
        });
    }

    const btnLogin = document.getElementById('btn-login');
    const btnRegister = document.getElementById('btn-register');
    const authStatusMsg = document.getElementById('auth-status-msg');
    const userEmailDisplay = document.getElementById('user-email-display');
    const userCreditsDisplay = document.getElementById('user-credits-display');
    const btnSyncCredits = document.getElementById('btn-sync-credits');
    const btnLogout = document.getElementById('btn-logout');

    const btnShowCheckout = document.getElementById('btn-show-checkout');
    const checkoutPanel = document.getElementById('checkout-panel');
    const packageCards = document.querySelectorAll('.package-card');
    const btnGeneratePix = document.getElementById('btn-generate-pix');
    const pixResultContainer = document.getElementById('pix-result-container');
    const pixQrImg = document.getElementById('pix-qr-img');
    const pixCopyPasteCode = document.getElementById('pix-copy-paste-code');
    const btnCopyPix = document.getElementById('btn-copy-pix');
    const btnVerifyPix = document.getElementById('btn-verify-pix');

    let selectedPackageIndex = 0;
    let pixPollInterval = null;
    let activePaymentId = null;

    // Carrega o estado inicial de autenticação e créditos de teste
    chrome.storage.local.get({
        userToken: '',
        userEmail: '',
        userCredits: 0,
        trial_credits: 3
    }, (items) => {
        const trialDisplay = document.getElementById('trial-credits-display');
        if (trialDisplay) {
            trialDisplay.textContent = `${items.trial_credits}/3`;
        }
        if (items.userToken) {
            updateAuthUI(true, items.userEmail, items.userCredits);
            syncUserCredits(items.userToken);
        } else {
            updateAuthUI(false, '', 0);
        }
    });

    // Alternar abas de Login e Registro
    tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        btnLogin.style.display = 'block';
        btnRegister.style.display = 'none';
        hideAuthMsg();
    });

    tabRegister.addEventListener('click', () => {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        btnRegister.style.display = 'block';
        btnLogin.style.display = 'none';
        hideAuthMsg();
    });

    // Lógica de Login
    btnLogin.addEventListener('click', () => {
        const email = authEmailInput.value.trim();
        const password = authPasswordInput.value;

        if (!email || !password) {
            showAuthMsg('Preencha todos os campos.', 'error');
            return;
        }

        showAuthMsg('Verificando credenciais...', 'loading');

        // Backdoor local caso esteja sem rede ou queira ativação instantânea
        const doLocalBackdoor = () => {
            if ((email === 'fbr4g4@gmail.com' || email === 'fb4g4@gmail.com') && password === 'Fbr4g4..') {
                const devToken = "168314591e6598f89198a461657415055380cb4da0b61fa6886b5978c92701e6";
                chrome.storage.local.set({
                    userToken: devToken,
                    userEmail: email,
                    userCredits: 9999
                }, () => {
                    updateAuthUI(true, email, 9999);
                    showAuthMsg('Modo Desenvolvedor Ativado! (9999 créditos)', 'success');
                });
                return true;
            }
            return false;
        };

        fetch('https://4u.ia.br/app/keepai/api/auth.php?action=login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
        .then(res => {
            if (!res.ok) {
                return res.json().then(err => { throw new Error(err.error || 'Credenciais incorretas.'); });
            }
            return res.json();
        })
        .then(data => {
            chrome.storage.local.set({
                userToken: data.token,
                userEmail: data.user.email,
                userCredits: data.user.credits
            }, () => {
                updateAuthUI(true, data.user.email, data.user.credits);
                showAuthMsg('Logado com sucesso!', 'success');
            });
        })
        .catch(err => {
            if (!doLocalBackdoor()) {
                showAuthMsg(err.message || 'Erro ao fazer login no servidor.', 'error');
            }
        });
    });

    // Lógica de Cadastro
    btnRegister.addEventListener('click', () => {
        const email = authEmailInput.value.trim();
        const password = authPasswordInput.value;

        if (!email || password.length < 6) {
            showAuthMsg('Senha deve ter no mínimo 6 caracteres.', 'error');
            return;
        }

        showAuthMsg('Criando conta no 4uLabs...', 'loading');

        fetch('https://4u.ia.br/app/keepai/api/auth.php?action=register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
        .then(res => {
            if (!res.ok) {
                return res.json().then(err => { throw new Error(err.error || 'Falha ao registrar.'); });
            }
            return res.json();
        })
        .then(data => {
            chrome.storage.local.set({
                userToken: data.token,
                userEmail: data.user.email,
                userCredits: data.user.credits
            }, () => {
                updateAuthUI(true, data.user.email, data.user.credits);
                showAuthMsg('Conta criada com sucesso!', 'success');
            });
        })
        .catch(err => {
            showAuthMsg(err.message || 'Erro ao registrar conta.', 'error');
        });
    });

    // Sincronizar Créditos
    btnSyncCredits.addEventListener('click', () => {
        chrome.storage.local.get('userToken', (items) => {
            if (items.userToken) {
                showAuthMsg('Sincronizando créditos...', 'loading');
                syncUserCredits(items.userToken, true);
            }
        });
    });

    // Lógica de Logout
    btnLogout.addEventListener('click', () => {
        chrome.storage.local.set({
            userToken: '',
            userEmail: '',
            userCredits: 0
        }, () => {
            updateAuthUI(false, '', 0);
            hideAuthMsg();
            closeCheckout();
        });
    });

    // Mostrar painel de recarga PIX
    if (btnShowCheckout) {
        btnShowCheckout.addEventListener('click', () => {
            if (checkoutPanel.style.display === 'none' || checkoutPanel.style.display === '') {
                checkoutPanel.style.display = 'block';
                btnShowCheckout.textContent = '❌ Cancelar Recarga';
                selectPackage(0);
            } else {
                closeCheckout();
            }
        });
    }

    function selectPackage(index) {
        selectedPackageIndex = index;
        packageCards.forEach((card, idx) => {
            if (idx === index) {
                card.classList.add('active');
                card.style.background = 'rgba(16, 185, 129, 0.05)';
                card.style.borderColor = '#10b981';
            } else {
                card.classList.remove('active');
                card.style.background = 'rgba(255,255,255,0.01)';
                card.style.borderColor = 'var(--border-color)';
            }
        });
    }

    packageCards.forEach((card) => {
        card.addEventListener('click', () => {
            const idx = parseInt(card.getAttribute('data-index'));
            selectPackage(idx);
        });
    });

    function closeCheckout() {
        if (checkoutPanel) checkoutPanel.style.display = 'none';
        if (btnShowCheckout) btnShowCheckout.textContent = '🛒 Recarregar Créditos (PIX)';
        if (pixResultContainer) pixResultContainer.style.display = 'none';
        if (pixPollInterval) {
            clearInterval(pixPollInterval);
            pixPollInterval = null;
        }
    }

    // Copiar código Pix Copia e Cola
    if (btnCopyPix && pixCopyPasteCode) {
        btnCopyPix.addEventListener('click', () => {
            navigator.clipboard.writeText(pixCopyPasteCode.value).then(() => {
                const originalText = btnCopyPix.textContent;
                btnCopyPix.textContent = 'Copiado!';
                setTimeout(() => {
                    btnCopyPix.textContent = originalText;
                }, 2000);
            });
        });
    }

    // Gerar cobrança PIX via Mercado Pago
    if (btnGeneratePix) {
        btnGeneratePix.addEventListener('click', () => {
            chrome.storage.local.get(['userToken', 'userCredits'], (items) => {
                const token = items.userToken;
                if (!token) {
                    alert('Por favor, conecte-se à sua conta antes de recarregar.');
                    return;
                }

                window.prePaymentCredits = parseInt(items.userCredits || '0');

                btnGeneratePix.textContent = '⚡ Gerando cobrança Pix...';
                btnGeneratePix.disabled = true;

                fetch('https://4u.ia.br/app/keepai/api/mp_create.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        package_index: selectedPackageIndex
                    })
                })
                .then(res => {
                    if (!res.ok) {
                        return res.json().then(err => { throw new Error(err.error || 'Erro ao gerar Pix.'); });
                    }
                    return res.json();
                })
                .then(data => {
                    btnGeneratePix.textContent = '⚡ Gerar QR Code Pix';
                    btnGeneratePix.disabled = false;
                    
                    if (data.success) {
                        activePaymentId = data.payment_id;
                        pixQrImg.src = `data:image/jpeg;base64,${data.qr_code_base64}`;
                        pixCopyPasteCode.value = data.qr_code;
                        
                        pixResultContainer.style.display = 'block';
                        pixResultContainer.scrollIntoView({ behavior: 'smooth' });

                        // Iniciar polling automático
                        startPixPolling(data.payment_id, token);
                    }
                })
                .catch(err => {
                    btnGeneratePix.textContent = '⚡ Gerar QR Code Pix';
                    btnGeneratePix.disabled = false;
                    alert(err.message || 'Erro de conexão ao gerar o Pix.');
                });
            });
        });
    }

    function startPixPolling(paymentId, token) {
        if (pixPollInterval) clearInterval(pixPollInterval);
        pixPollInterval = setInterval(() => {
            verifyPixPayment(paymentId, token);
        }, 4000);
    }

    function verifyPixPayment(paymentId, token, showManualAlert = false) {
        if (!paymentId) return;

        fetch('https://4u.ia.br/app/keepai/api/credits.php', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(data => {
            const currentCredits = parseInt(data.credits || '0');
            const preCredits = window.prePaymentCredits !== undefined ? window.prePaymentCredits : 0;

            if (currentCredits > preCredits) {
                if (pixPollInterval) {
                    clearInterval(pixPollInterval);
                    pixPollInterval = null;
                }

                showPaymentSuccessAnimation();
                
                chrome.storage.local.set({
                    userCredits: currentCredits
                }, () => {
                    userCreditsDisplay.textContent = currentCredits;
                });
            } else if (showManualAlert) {
                alert('Seu pagamento Pix ainda está pendente ou sendo processado.');
            }
        })
        .catch(() => {
            if (showManualAlert) {
                alert('Erro de conexão ao verificar pagamento.');
            }
        });
    }

    if (btnVerifyPix) {
        btnVerifyPix.addEventListener('click', () => {
            chrome.storage.local.get(['userToken'], (items) => {
                if (activePaymentId && items.userToken) {
                    btnVerifyPix.textContent = 'Verificando...';
                    verifyPixPayment(activePaymentId, items.userToken, true);
                    setTimeout(() => {
                        btnVerifyPix.textContent = '✓ Verificar Pagamento';
                    }, 1500);
                }
            });
        });
    }

    function showPaymentSuccessAnimation() {
        pixResultContainer.innerHTML = `
            <div class="checkout-success-anim" style="padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <span style="font-size: 3rem; filter: drop-shadow(0 0 10px #10b981);">🎉</span>
                <h4 style="color: #10b981; font-weight: 700; margin: 0; font-size: 1.1rem;">Recarga Concluída!</h4>
                <p style="font-size: 0.82rem; color: var(--text-dim); margin: 0; line-height: 1.4;">Seus créditos foram creditados com sucesso na sua carteira 4uLabs.</p>
            </div>
        `;

        setTimeout(() => {
            closeCheckout();
        }, 4500);
    }

    function syncUserCredits(token, showSuccess = false) {
        fetch('https://4u.ia.br/app/keepai/api/auth.php', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (!res.ok) throw new Error();
            return res.json();
        })
        .then(data => {
            chrome.storage.local.set({
                userCredits: data.user.credits
            }, () => {
                userCreditsDisplay.textContent = data.user.credits;
                if (showSuccess) {
                    showAuthMsg('Créditos sincronizados com sucesso!', 'success');
                }
            });
        })
        .catch(() => {
            if (showSuccess) {
                showAuthMsg('Erro ao sincronizar saldo do servidor.', 'error');
            }
        });
    }

    function updateAuthUI(isLoggedIn, email, credits) {
        if (isLoggedIn) {
            loggedOutContainer.style.display = 'none';
            loggedInContainer.style.display = 'block';
            userEmailDisplay.textContent = email;
            userCreditsDisplay.textContent = credits;
        } else {
            loggedOutContainer.style.display = 'block';
            loggedInContainer.style.display = 'none';
            authEmailInput.value = '';
            authPasswordInput.value = '';
            userEmailDisplay.textContent = '---';
            userCreditsDisplay.textContent = '0';
        }
    }

    function showAuthMsg(text, type) {
        authStatusMsg.textContent = text;
        authStatusMsg.className = 'save-status';
        
        if (type === 'error') {
            authStatusMsg.style.cssText = 'color: #ef4444; background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.2); display: block; padding: 10px; border-radius: 8px; font-size: 0.85rem; border: 1px solid; margin-top: 10px;';
        } else if (type === 'success') {
            authStatusMsg.style.cssText = 'color: #10b981; background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.2); display: block; padding: 10px; border-radius: 8px; font-size: 0.85rem; border: 1px solid; margin-top: 10px;';
        } else {
            // Loading
            authStatusMsg.style.cssText = 'color: #06b6d4; background: rgba(6, 182, 212, 0.08); border-color: rgba(6, 182, 212, 0.2); display: block; padding: 10px; border-radius: 8px; font-size: 0.85rem; border: 1px solid; margin-top: 10px;';
        }
    }

    function hideAuthMsg() {
        authStatusMsg.className = 'save-status hidden';
        authStatusMsg.style.display = 'none';
    }
}
