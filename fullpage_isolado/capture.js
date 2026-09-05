const DB_NAME = 'printscreen_temp_db';
const STORE_NAME = 'temp_captures';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function loadFramesFromDB() {
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get('temp_fullpage_frames');
            req.onsuccess = (e) => {
                if (e.target.result) {
                    resolve(e.target.result.frames);
                } else {
                    resolve([]);
                }
            };
            req.onerror = (e) => reject(e.target.error);
        } catch (err) {
            reject(err);
        }
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('status');
    const actionsEl = document.getElementById('actions');
    const canvas = document.getElementById('stitchCanvas');
    const ctx = canvas.getContext('2d');

    try {
        const storage = await chrome.storage.local.get(['page_width', 'viewport_height', 'total_height']);
        const pageWidth = storage.page_width;
        const viewportHeight = storage.viewport_height;
        const totalHeight = storage.total_height;

        if (!pageWidth || !viewportHeight || !totalHeight) {
            statusEl.textContent = 'Erro: Dimensões da página não encontradas no storage.';
            return;
        }

        statusEl.textContent = 'Carregando frames do IndexedDB...';
        const frames = await loadFramesFromDB();
        if (!frames || frames.length === 0) {
            statusEl.textContent = 'Erro: Nenhum frame encontrado no banco de dados.';
            return;
        }

        statusEl.textContent = `Costurando ${frames.length} frames...`;

        // Configura dimensões do canvas
        canvas.width = pageWidth;
        canvas.height = totalHeight;

        // Limpa canvas
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Função auxiliar para carregar uma imagem
        const loadImage = (src) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = (err) => reject(err);
                img.src = src;
            });
        };

        // Renderiza cada frame
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            statusEl.textContent = `Processando frame ${i + 1} de ${frames.length} (Y=${frame.y})...`;
            
            try {
                const img = await loadImage(frame.image);
                ctx.drawImage(img, 0, frame.y, pageWidth, viewportHeight);
            } catch (err) {
                console.error(`Erro ao carregar frame ${i}:`, err);
            }
        }

        statusEl.textContent = `Pronto! Imagem de ${pageWidth}x${totalHeight}px gerada com sucesso.`;
        actionsEl.style.display = 'flex';

        // Configurar downloads
        document.getElementById('downloadPng').addEventListener('click', () => {
            const link = document.createElement('a');
            link.download = `captura_completa_${Date.now()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        });

        document.getElementById('downloadJpg').addEventListener('click', () => {
            const link = document.createElement('a');
            link.download = `captura_completa_${Date.now()}.jpg`;
            link.href = canvas.toDataURL('image/jpeg', 0.9);
            link.click();
        });

        document.getElementById('btnEdit').addEventListener('click', () => {
            statusEl.textContent = 'Carregando editor avançado...';
            chrome.storage.local.set({
                capture_type: 'fullpage'
            }, () => {
                chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });
            });
        });

    } catch (err) {
        console.error('Erro na costura:', err);
        statusEl.textContent = `Erro ao costurar imagem: ${err.message}`;
    }
});
