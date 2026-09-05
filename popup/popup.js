document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    const btnCaptureArea = document.getElementById('btnCaptureArea');
    const btnCaptureVisible = document.getElementById('btnCaptureVisible');
    const btnCaptureFull = document.getElementById('btnCaptureFull');
    const btnHistory = document.getElementById('btnHistory');
    const openSettingsBtn = document.getElementById('openSettingsBtn');

    // Click Handlers
    btnCaptureArea.addEventListener('click', () => {
        checkTabAndTrigger('trigger-capture-area');
    });

    btnCaptureVisible.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'trigger-capture-visible' });
        window.close();
    });

    btnCaptureFull.addEventListener('click', () => {
        checkTabAndTrigger('trigger-capture-fullpage');
    });

    function checkTabAndTrigger(action) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0]) return;
            const url = tabs[0].url || '';
            
            if (url.startsWith('chrome://') || 
                url.startsWith('chrome-extension://') || 
                url.startsWith('view-source:') || 
                url.startsWith('https://chrome.google.com/webstore')) {
                
                alert('Páginas protegidas do Chrome ou a Web Store não permitem capturas interativas de tela por razões de segurança.');
            } else {
                chrome.runtime.sendMessage({ action: action });
                window.close();
            }
        });
    }

    btnHistory.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'open-dashboard' });
        window.close();
    });

    openSettingsBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'open-dashboard', hash: 'settings' });
        window.close();
    });

    // Check AI Engine availability (Gemini / OpenAI keys)
    chrome.storage.local.get(['openai_key', 'gemini_key'], (res) => {
        const dot = document.querySelector('.ai-dot');
        const text = document.querySelector('.ai-text');
        
        if (res.openai_key || res.gemini_key) {
            dot.classList.add('active');
            text.textContent = 'IA Ativa';
        } else {
            // Keep default style or show setup tip
            dot.classList.remove('active');
            text.textContent = 'IA Pronta';
            dot.style.backgroundColor = '#9ca3af';
            text.style.color = '#9ca3af';
            document.getElementById('aiStatus').title = 'Configure suas chaves API no Dashboard para ativar recursos de IA';
        }
    });
});
