// Content Script de Captura (Injetado nas páginas)

if (!window.printscreenCaptureInjected) {
    window.printscreenCaptureInjected = true;

    let selectionBox = null;
    let overlayContainer = null;
    let dimensionBadge = null;
    let magnifier = null;

    let isSelecting = false;
    let startX = 0;
    let startY = 0;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'init-selection') {
            initAreaSelection();
        }
        sendResponse({ success: true });
        return false;
    });

// --- CAPTURA DE ÁREA SELECIONADA ---
function initAreaSelection() {
    // Remove se já existir um overlay antigo
    removeSelectionOverlay();

    // Container geral da overlay
    overlayContainer = document.createElement('div');
    overlayContainer.id = 'printscreen-overlay-container';
    
    // Caixa de seleção
    selectionBox = document.createElement('div');
    selectionBox.id = 'printscreen-selection-box';
    
    // Badge de Dimensões
    dimensionBadge = document.createElement('div');
    dimensionBadge.id = 'printscreen-dimension-badge';
    dimensionBadge.textContent = '0 x 0 px';
    selectionBox.appendChild(dimensionBadge);

    // Alças de canto (handles)
    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(h => {
        const div = document.createElement('div');
        div.className = 'printscreen-selection-handle';
        div.id = `printscreen-handle-${h}`;
        selectionBox.appendChild(div);
    });

    overlayContainer.appendChild(selectionBox);
    document.documentElement.appendChild(overlayContainer);

    // Mouse Listeners
    overlayContainer.addEventListener('mousedown', startSelection);
    overlayContainer.addEventListener('mousemove', drawSelection);
    window.addEventListener('mouseup', finishSelection);
    
    // Atalho Escape para cancelar
    window.addEventListener('keydown', handleEscapeKey);
}

function startSelection(e) {
    if (e.button !== 0) return; // Só botão esquerdo
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    
    selectionBox.style.left = `${startX}px`;
    selectionBox.style.top = `${startY}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
}

function drawSelection(e) {
    if (!isSelecting) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(startX - currentX);
    const h = Math.abs(startY - currentY);
    
    selectionBox.style.left = `${x}px`;
    selectionBox.style.top = `${y}px`;
    selectionBox.style.width = `${w}px`;
    selectionBox.style.height = `${h}px`;
    
    dimensionBadge.textContent = `${w} x ${h} px`;
}

function finishSelection(e) {
    if (!isSelecting) return;
    isSelecting = false;
    
    const left = parseInt(selectionBox.style.left);
    const top = parseInt(selectionBox.style.top);
    const width = parseInt(selectionBox.style.width);
    const height = parseInt(selectionBox.style.height);

    // Remove listeners e overlay
    removeSelectionOverlay();
    window.removeEventListener('mouseup', finishSelection);
    window.removeEventListener('keydown', handleEscapeKey);

    // Evita disparos acidentais com cliques vazios ou toques simples
    if (isNaN(width) || isNaN(height) || width < 8 || height < 8) return;

    // Enviar coordenadas ajustadas para o DPR (Device Pixel Ratio)
    const dpr = window.devicePixelRatio || 1;
    const coords = {
        x: Math.round(left * dpr),
        y: Math.round(top * dpr),
        w: Math.round(width * dpr),
        h: Math.round(height * dpr),
        dpr: dpr
    };
    
    // Atraso de 100ms para permitir que o navegador redesenhe a tela sem a overlay antes do print
    setTimeout(() => {
        chrome.runtime.sendMessage({
            action: 'area-selected',
            coords: coords
        });
    }, 100);
}

function handleEscapeKey(e) {
    if (e.key === 'Escape') {
        removeSelectionOverlay();
        window.removeEventListener('mouseup', finishSelection);
        window.removeEventListener('keydown', handleEscapeKey);
    }
}

function removeSelectionOverlay() {
    const el = document.getElementById('printscreen-overlay-container');
    if (el) el.remove();
}

}
