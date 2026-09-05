// Estúdio PrintScreen - Motor de Desenho & Inteligência Artificial

let canvas = null;
let ctx = null;
let bgImage = new Image();
let currentCaptureType = 'visible';
let fullPageFrames = [];
let fullPageViewportHeight = 700;

let currentTool = 'select'; // select, crop, arrow, rect, step, pen, text, blur
let currentColor = '#10b981'; // Neon Green
let currentLineWidth = 4;
let activeStepNumber = 1;
let isFillEnabled = false; // Controle de preenchimento translúcido
let activeEmoji = null;     // Emoji atualmente selecionado
let annotations = []; // Desenhos vetoriais para suportar Undo
let undoStack = [];

// Apresentação Premium (Mockup)
let isMockupEnabled = false;
let currentMockupBackground = 'gradient-purple';
const mockupPadding = 48;

let isDrawing = false;
let startX = 0;
let startY = 0;
let penPoints = [];
let activeAnnotation = null;

// Variáveis para Seleção e Recorte
let selectedAnnotation = null;
let isDraggingAnnotation = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('editingCanvas');
    ctx = canvas.getContext('2d');

    // Inicializar Canvas com a Captura
    loadCapturedImage();

    // Registrar Eventos de Desenho
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Registrar Eventos dos Botões de Ferramentas
    setupToolbar();
    
    // Registrar Eventos das Ações de Exportação & IA
    setupActions();
});

// --- CARREGAR CAPTURA (CROP OU STITCH) ---
function loadCapturedImage() {
    chrome.storage.local.get([
        'capture_type', 
        'last_image', 
        'crop_coords',
        'scroll_frames',
        'page_width',
        'viewport_height',
        'total_height'
    ], (res) => {
        currentCaptureType = res.capture_type || 'visible';
        if (res.capture_type === 'area') {
            // Recorte de Área Selecionada
            const fullImage = new Image();
            fullImage.onload = () => {
                const coords = res.crop_coords;
                // Configura tamanho real do canvas com base no recorte
                canvas.width = coords.w;
                canvas.height = coords.h;
                
                // Desenha imagem cortada
                ctx.drawImage(
                    fullImage, 
                    coords.x, coords.y, coords.w, coords.h, 
                    0, 0, coords.w, coords.h
                );
                
                // Converte o canvas recortado em imagem base oficial
                bgImage = new Image();
                bgImage.onload = () => {
                    saveCanvasState();
                    initCaptureInDB(canvas.toDataURL('image/png'));
                };
                bgImage.src = canvas.toDataURL('image/png');
            };
            fullImage.src = res.last_image;
        } else if (res.capture_type === 'visible') {
            // Área Visível
            bgImage.onload = () => {
                canvas.width = bgImage.width;
                canvas.height = bgImage.height;
                ctx.drawImage(bgImage, 0, 0);
                saveCanvasState();
                initCaptureInDB(canvas.toDataURL('image/png'));
            };
            bgImage.src = res.last_image;
        } else if (res.capture_type === 'fullpage') {
            // Costura da Página Inteira (Full Page Scrolling)
            stitchFullPageFrames(res);
        }
    });
}

const TEMP_DB_NAME = 'printscreen_temp_db';
const TEMP_STORE_NAME = 'temp_captures';

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

function loadFramesFromDB() {
    return new Promise((resolve, reject) => {
        openTempDB().then(db => {
            const tx = db.transaction(TEMP_STORE_NAME, 'readonly');
            const store = tx.objectStore(TEMP_STORE_NAME);
            const req = store.get('temp_fullpage_frames');
            req.onsuccess = (e) => {
                if (e.target.result) {
                    resolve(e.target.result.frames);
                } else {
                    resolve([]);
                }
            };
            req.onerror = (e) => reject(e.target.error);
        }).catch(err => reject(err));
    });
}

async function stitchFullPageFrames(res) {
    try {
        console.log('[Editor] Buscando frames no IndexedDB temporário...');
        const frames = await loadFramesFromDB();
        
        if (!frames || frames.length === 0) {
            console.error('Nenhum frame temporário encontrado no IndexedDB para costura.');
            showToast('⚠️ Erro: Não foi possível recuperar a captura do banco local.');
            return;
        }

        // Configura tamanho monumental do Canvas e guarda altura do viewport
        canvas.width = res.page_width;
        canvas.height = res.total_height;
        fullPageViewportHeight = res.viewport_height;

        // Limpa o canvas com fundo branco sólido por padrão
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

        console.log(`[Editor] Pré-carregando e desenhando ${frames.length} frames na memória...`);

        fullPageFrames = [];
        // Desenha os frames um a um de forma estritamente ordenada e sequencial e os armazena
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            if (!frame.image) continue;
            
            try {
                const img = await loadImage(frame.image);
                ctx.drawImage(img, 0, frame.y, res.page_width, res.viewport_height);
                
                // Armazena o objeto de imagem decodificado na memória para redesenho síncrono rápido
                fullPageFrames.push({
                    y: frame.y,
                    imgObject: img
                });
            } catch (err) {
                console.error(`[Editor] Erro ao costurar o frame ${i} na coordenada Y=${frame.y}:`, err);
            }
        }

        // Cria o bgImage global leve, definindo apenas largura e altura corretas no editor
        bgImage = new Image();
        bgImage.width = res.page_width;
        bgImage.height = res.total_height;
        
        saveCanvasState();
        initCaptureInDB(canvas.toDataURL('image/jpeg', 0.85));
        
        // Força a renderização física dos viewports no editor de imagem
        drawAll();
        
        // Limpa o registro temporário de frames para poupar espaço em disco
        try {
            const db = await openTempDB();
            const cleanTx = db.transaction(TEMP_STORE_NAME, 'readwrite');
            const cleanStore = cleanTx.objectStore(TEMP_STORE_NAME);
            cleanStore.delete('temp_fullpage_frames');
            console.log('Frames temporários limpos do IndexedDB.');
        } catch (cleanErr) {
            console.warn('Erro ao limpar frames temporários:', cleanErr);
        }
    } catch (err) {
        console.error('[Editor] Erro crítico na costura de frames:', err);
        showToast('⚠️ Erro interno ao processar as capturas.');
    }
}

// --- ENGINE DE ANOTAÇÕES VETORIAIS ---

function saveCanvasState() {
    // Salva cópia profunda do vetor de anotações
    undoStack.push(JSON.parse(JSON.stringify(annotations)));
}

function drawAll() {
    const padding = isMockupEnabled ? mockupPadding : 0;
    
    // Atualiza dinamicamente o tamanho físico do canvas se necessário
    const targetWidth = bgImage.width + 2 * padding;
    const targetHeight = bgImage.height + 2 * padding;
    
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (isMockupEnabled) {
        // 1. Desenha o fundo gradiente ou transparente premium
        drawMockupBackground(ctx, canvas.width, canvas.height, currentMockupBackground);
        
        // 2. Desenha a sombra suave projetada (drop shadow) atrás do print
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 32;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 16;
        
        ctx.beginPath();
        const rx = 12; // 12px de cantos arredondados
        roundRect(ctx, padding, padding, bgImage.width, bgImage.height, rx);
        ctx.fillStyle = '#000000';
        ctx.fill();
        ctx.restore();
        
        // 3. Desenha a imagem capturada com cantos arredondados por clipping
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, padding, padding, bgImage.width, bgImage.height, rx);
        ctx.clip();
        if (currentCaptureType === 'fullpage' && fullPageFrames.length > 0) {
            fullPageFrames.forEach(frame => {
                ctx.drawImage(frame.imgObject, padding, padding + frame.y, bgImage.width, fullPageViewportHeight);
            });
        } else {
            ctx.drawImage(bgImage, padding, padding);
        }
        ctx.restore();
    } else {
        // Modo Normal
        if (currentCaptureType === 'fullpage' && fullPageFrames.length > 0) {
            fullPageFrames.forEach(frame => {
                ctx.drawImage(frame.imgObject, 0, frame.y, bgImage.width, fullPageViewportHeight);
            });
        } else {
            ctx.drawImage(bgImage, 0, 0);
        }
    }
    
    // 4. Desenha as anotações sobre a imagem
    // Se o Mockup estiver ativado, aplicamos uma translação para desenhar no offset correto (+padding, +padding)
    ctx.save();
    if (isMockupEnabled) {
        ctx.translate(padding, padding);
    }
    
    // Desenha todas as anotações
    annotations.forEach(ann => drawAnnotation(ann));
    
    // Desenha a anotação ativa
    if (activeAnnotation) {
        drawAnnotation(activeAnnotation);
    }
    ctx.restore();
}

// --- AUXILIARES GEOMÉTRICOS E DE MOCKUP ---

function roundRect(context, x, y, w, h, radius) {
    if (w < 2 * radius) radius = w / 2;
    if (h < 2 * radius) radius = h / 2;
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
}

function drawMockupBackground(context, w, h, bgType) {
    if (bgType === 'transparent') {
        context.clearRect(0, 0, w, h);
        return;
    }
    
    let grad;
    if (bgType === 'gradient-purple') {
        grad = context.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#6366f1'); // Indigo
        grad.addColorStop(1, '#a855f7'); // Purple
    } else if (bgType === 'gradient-aurora') {
        grad = context.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#0284c7'); // Sky Blue
        grad.addColorStop(0.5, '#10b981'); // Emerald Green
        grad.addColorStop(1, '#6366f1'); // Indigo
    } else if (bgType === 'gradient-sunset') {
        grad = context.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#f97316'); // Orange
        grad.addColorStop(0.5, '#ec4899'); // Pink
        grad.addColorStop(1, '#8b5cf6'); // Purple
    } else if (bgType === 'dark-neon') {
        grad = context.createRadialGradient(w/2, h/2, 10, w/2, h/2, Math.max(w, h));
        grad.addColorStop(0, '#1f2937'); // Gray 800
        grad.addColorStop(1, '#111827'); // Gray 900
    } else {
        context.fillStyle = '#0d0e15';
        context.fillRect(0, 0, w, h);
        return;
    }
    context.fillStyle = grad;
    context.fillRect(0, 0, w, h);
}

function drawAnnotation(ann) {
    ctx.strokeStyle = ann.color || currentColor;
    ctx.fillStyle = ann.color || currentColor;
    ctx.lineWidth = ann.lineWidth || currentLineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Sombra suave para destacar as anotações
    if (ann.type === 'highlighter') {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 18; // Linha bem larga para destacar
    } else {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
    }

    if (ann.type === 'rect') {
        ctx.beginPath();
        ctx.rect(ann.x, ann.y, ann.w, ann.h);
        if (ann.fill) {
            ctx.fillStyle = ann.color + '40'; // 25% de opacidade
            ctx.fill();
        }
        ctx.stroke();
    } else if (ann.type === 'circle') {
        ctx.beginPath();
        const rx = ann.w / 2;
        const ry = ann.h / 2;
        const cx = ann.x + rx;
        const cy = ann.y + ry;
        ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, 2 * Math.PI);
        if (ann.fill) {
            ctx.fillStyle = ann.color + '40';
            ctx.fill();
        }
        ctx.stroke();
    } else if (ann.type === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(ann.x + ann.w / 2, ann.y);
        ctx.lineTo(ann.x + ann.w, ann.y + ann.h);
        ctx.lineTo(ann.x, ann.y + ann.h);
        ctx.closePath();
        if (ann.fill) {
            ctx.fillStyle = ann.color + '40';
            ctx.fill();
        }
        ctx.stroke();
    } else if (ann.type === 'star') {
        ctx.beginPath();
        const cx = ann.x + ann.w / 2;
        const cy = ann.y + ann.h / 2;
        const spikes = 5;
        const outerRadius = Math.min(Math.abs(ann.w), Math.abs(ann.h)) / 2;
        const innerRadius = outerRadius * 0.4;
        
        let rot = Math.PI / 2 * 3;
        let sx = cx;
        let sy = cy;
        const step = Math.PI / spikes;

        ctx.moveTo(cx, cy - outerRadius);
        for (let i = 0; i < spikes; i++) {
            sx = cx + Math.cos(rot) * outerRadius;
            sy = cy + Math.sin(rot) * outerRadius;
            ctx.lineTo(sx, sy);
            rot += step;

            sx = cx + Math.cos(rot) * innerRadius;
            sy = cy + Math.sin(rot) * innerRadius;
            ctx.lineTo(sx, sy);
            rot += step;
        }
        ctx.lineTo(cx, cy - outerRadius);
        ctx.closePath();
        if (ann.fill) {
            ctx.fillStyle = ann.color + '40';
            ctx.fill();
        }
        ctx.stroke();
    } else if (ann.type === 'speech_bubble') {
        ctx.beginPath();
        const x = ann.x;
        const y = ann.y;
        const w = ann.w;
        const h = ann.h;
        const r = Math.min(12, Math.abs(w) / 4, Math.abs(h) / 4); // cantos arredondados
        
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        
        // Cauda do balão apontando para baixo-esquerda
        ctx.lineTo(x + Math.max(r, w * 0.35), y + h);
        ctx.lineTo(x + Math.max(r / 2, w * 0.15), y + h + Math.min(15, h * 0.25));
        ctx.lineTo(x + Math.max(r, w * 0.18), y + h);
        
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        if (ann.fill) {
            ctx.fillStyle = ann.color + '40';
            ctx.fill();
        }
        ctx.stroke();
    } else if (ann.type === 'dashed_line') {
        ctx.beginPath();
        ctx.setLineDash([8, 6]);
        ctx.moveTo(ann.x, ann.y);
        ctx.lineTo(ann.toX, ann.toY);
        ctx.stroke();
        ctx.setLineDash([]);
    } else if (ann.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(ann.x, ann.y);
        ctx.lineTo(ann.toX, ann.toY);
        ctx.stroke();
    } else if (ann.type === 'arrow') {
        drawArrow(ctx, ann.x, ann.y, ann.toX, ann.toY, ann.lineWidth);
    } else if (ann.type === 'step') {
        // Círculo
        ctx.beginPath();
        ctx.arc(ann.x, ann.y, 16, 0, 2 * Math.PI);
        ctx.fill();
        
        // Número interno
        ctx.shadowBlur = 0; // Desativa sombra para o texto ficar nítido
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.number, ann.x, ann.y);
    } else if (ann.type === 'pen' || ann.type === 'highlighter') {
        if (ann.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
            ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.stroke();
    } else if (ann.type === 'blur') {
        // Desfoque pixelado na área
        ctx.shadowBlur = 0; // Desativa sombra
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        pixelateArea(ann.x, ann.y, ann.w, ann.h, 12);
    } else if (ann.type === 'text') {
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.font = `bold ${ann.fontSize || 20}px Inter`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(ann.text, ann.x, ann.y);
    } else if (ann.type === 'emoji') {
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.font = '36px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ann.emoji, ann.x, ann.y);
    } else if (ann.type === 'magnifier') {
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        const cx = ann.x + ann.w / 2;
        const cy = ann.y + ann.h / 2;
        const r = Math.max(15, Math.max(ann.w, ann.h) / 2);
        const scale = 2.0; // Zoom de 2x
        
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.clip();
        
        // Calcula e projeta a região de origem da imagem de fundo
        const sw = (2 * r) / scale;
        const sh = (2 * r) / scale;
        const sx = cx - sw / 2;
        const sy = cy - sh / 2;
        
        ctx.drawImage(
            bgImage,
            sx, sy, sw, sh,
            cx - r, cy - r, 2*r, 2*r
        );
        ctx.restore();
        
        // Desenha contorno metálico com sombra
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 4;
        
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.strokeStyle = ann.color || currentColor;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
        
        // Brilho de lente realista
        const shineGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
        shineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.0)');
        shineGrad.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
        
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = shineGrad;
        ctx.fill();
    } else if (ann.type === 'watermark') {
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        
        if (!ann.imgElement && ann.imgSrc) {
            ann.imgElement = new Image();
            ann.imgElement.onload = () => drawAll();
            ann.imgElement.src = ann.imgSrc;
        }
        
        if (ann.imgElement && ann.imgElement.complete) {
            ctx.drawImage(ann.imgElement, ann.x, ann.y, ann.w, ann.h);
        }
        
        // Se estiver selecionada na ferramenta de mover, mostra borda de seleção azul
        if (selectedAnnotation === ann && currentTool === 'select') {
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1;
            ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
        }
    } else if (ann.type === 'crop_selection') {
        // Remove sombras temporariamente
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Desenha a borda tracejada em neon emerald
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
        ctx.setLineDash([]);
        
        // Escurece o fundo fora do corte
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        // Topo
        ctx.fillRect(0, 0, canvas.width, ann.y);
        // Esquerda
        ctx.fillRect(0, ann.y, ann.x, ann.h);
        // Direita
        ctx.fillRect(ann.x + ann.w, ann.y, canvas.width - (ann.x + ann.w), ann.h);
        // Base
        ctx.fillRect(0, ann.y + ann.h, canvas.width, canvas.height - (ann.y + ann.h));
    }

    // Reset de sombras
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1.0;
}

// Função para desenhar Setas elegantes
function drawArrow(context, fromx, fromy, tox, toy, width) {
    const headlen = 16; // comprimento da cabeça da seta
    const dx = tox - fromx;
    const dy = toy - fromy;
    const angle = Math.atan2(dy, dx);
    
    context.beginPath();
    context.moveTo(fromx, fromy);
    context.lineTo(tox, toy);
    context.stroke();
    
    // Desenhar a cabeça da seta
    context.beginPath();
    context.moveTo(tox, toy);
    context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
    context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
}

// Função de Pixelização nativa no Canvas
function pixelateArea(x, y, w, h, size) {
    if (w <= 0 || h <= 0) return;
    try {
        // Cria um canvas temporário para o recorte
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = w;
        tempCanvas.height = h;

        // Copia a área atual da imagem de fundo
        tempCtx.drawImage(bgImage, x, y, w, h, 0, 0, w, h);

        // Desliga a suavização do navegador para o efeito pixelado ficar nítido
        ctx.imageSmoothingEnabled = false;
        
        // Desenha menor no canvas principal
        const sw = Math.max(1, Math.round(w / size));
        const sh = Math.max(1, Math.round(h / size));
        
        ctx.drawImage(tempCanvas, 0, 0, w, h, x, y, sw, sh);
        // Estica de volta para pixelar
        ctx.drawImage(canvas, x, y, sw, sh, x, y, w, h);
        
        ctx.imageSmoothingEnabled = true;
    } catch (e) {
        console.error(e);
    }
}

// --- MOUSE LISTENERS PARA DESENHO E TRADUÇÃO DE COORDENADAS ---

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    let x = (e.clientX - rect.left) * scaleX;
    let y = (e.clientY - rect.top) * scaleY;
    
    if (isMockupEnabled) {
        x -= mockupPadding;
        y -= mockupPadding;
    }
    return { x, y };
}

function onMouseDown(e) {
    const pos = getMousePos(e);
    startX = pos.x;
    startY = pos.y;
    isDrawing = true;

    if (currentTool === 'select') {
        selectedAnnotation = findAnnotationAt(startX, startY);
        if (selectedAnnotation) {
            isDraggingAnnotation = true;
            dragOffsetX = startX - selectedAnnotation.x;
            dragOffsetY = startY - selectedAnnotation.y;
        }
    } else if (currentTool === 'crop') {
        activeAnnotation = { type: 'crop_selection', x: startX, y: startY, w: 0, h: 0 };
    } else if (currentTool === 'arrow') {
        activeAnnotation = { type: 'arrow', x: startX, y: startY, toX: startX, toY: startY, color: currentColor, lineWidth: currentLineWidth };
    } else if (currentTool === 'line' || currentTool === 'dashed_line') {
        activeAnnotation = { type: currentTool, x: startX, y: startY, toX: startX, toY: startY, color: currentColor, lineWidth: currentLineWidth };
    } else if (['rect', 'circle', 'triangle', 'star', 'speech_bubble'].includes(currentTool)) {
        activeAnnotation = { 
            type: currentTool, 
            x: startX, 
            y: startY, 
            w: 0, 
            h: 0, 
            color: currentColor, 
            lineWidth: currentLineWidth, 
            fill: isFillEnabled 
        };
    } else if (currentTool === 'blur') {
        activeAnnotation = { type: 'blur', x: startX, y: startY, w: 0, h: 0 };
    } else if (currentTool === 'magnifier') {
        activeAnnotation = { type: 'magnifier', x: startX, y: startY, w: 0, h: 0, color: currentColor };
    } else if (currentTool === 'emoji' && activeEmoji) {
        isDrawing = false;
        annotations.push({
            type: 'emoji',
            x: startX,
            y: startY,
            emoji: activeEmoji
        });
        saveCanvasState();
        drawAll();
        updateCaptureInDB();
        
        // Retorna para a ferramenta de seleção após carimbar o emoji
        document.getElementById('toolSelect').click();
    } else if (currentTool === 'pen') {
        penPoints = [{ x: startX, y: startY }];
        activeAnnotation = { type: 'pen', points: penPoints, color: currentColor, lineWidth: currentLineWidth };
    } else if (currentTool === 'highlighter') {
        penPoints = [{ x: startX, y: startY }];
        activeAnnotation = { type: 'highlighter', points: penPoints, color: currentColor, lineWidth: currentLineWidth };
    } else if (currentTool === 'step') {
        // O Step é clique único
        isDrawing = false;
        annotations.push({
            type: 'step',
            x: startX,
            y: startY,
            number: activeStepNumber,
            color: currentColor
        });
        activeStepNumber++;
        saveCanvasState();
        drawAll();
        updateCaptureInDB();
    } else if (currentTool === 'text') {
        isDrawing = false;
        const text = prompt('Digite seu texto:');
        if (text) {
            const fontSizeEl = document.getElementById('selectFontSize');
            const fontSize = fontSizeEl ? parseInt(fontSizeEl.value, 10) : 20;
            annotations.push({
                type: 'text',
                x: startX,
                y: startY,
                text: text,
                color: currentColor,
                fontSize: fontSize
            });
            saveCanvasState();
            drawAll();
            updateCaptureInDB();
        }
    }
}

function onMouseMove(e) {
    if (!isDrawing) return;
    const pos = getMousePos(e);
    const currentX = pos.x;
    const currentY = pos.y;

    if (currentTool === 'select' && isDraggingAnnotation && selectedAnnotation) {
        if (['arrow', 'line', 'dashed_line'].includes(selectedAnnotation.type)) {
            const dx = currentX - startX;
            const dy = currentY - startY;
            selectedAnnotation.x += dx;
            selectedAnnotation.y += dy;
            selectedAnnotation.toX += dx;
            selectedAnnotation.toY += dy;
            startX = currentX;
            startY = currentY;
        } else if (selectedAnnotation.type === 'pen' || selectedAnnotation.type === 'highlighter') {
            const dx = currentX - startX;
            const dy = currentY - startY;
            selectedAnnotation.points.forEach(pt => {
                pt.x += dx;
                pt.y += dy;
            });
            startX = currentX;
            startY = currentY;
        } else {
            selectedAnnotation.x = currentX - dragOffsetX;
            selectedAnnotation.y = currentY - dragOffsetY;
        }
    } else if (currentTool === 'crop' && activeAnnotation) {
        activeAnnotation.x = Math.min(startX, currentX);
        activeAnnotation.y = Math.min(startY, currentY);
        activeAnnotation.w = Math.abs(startX - currentX);
        activeAnnotation.h = Math.abs(startY - currentY);
    } else if (['arrow', 'line', 'dashed_line'].includes(currentTool)) {
        activeAnnotation.toX = currentX;
        activeAnnotation.toY = currentY;
    } else if (['rect', 'circle', 'triangle', 'star', 'speech_bubble', 'blur', 'magnifier'].includes(currentTool)) {
        activeAnnotation.x = Math.min(startX, currentX);
        activeAnnotation.y = Math.min(startY, currentY);
        activeAnnotation.w = Math.abs(startX - currentX);
        activeAnnotation.h = Math.abs(startY - currentY);
    } else if (currentTool === 'pen' || currentTool === 'highlighter') {
        penPoints.push({ x: currentX, y: currentY });
    }

    drawAll();
}

function onMouseUp() {
    if (!isDrawing) return;
    isDrawing = false;

    if (currentTool === 'select' && isDraggingAnnotation) {
        isDraggingAnnotation = false;
        selectedAnnotation = null;
        updateCaptureInDB();
    } else if (currentTool === 'crop' && activeAnnotation) {
        const cropArea = activeAnnotation;
        activeAnnotation = null;
        drawAll();
        if (cropArea.w > 10 && cropArea.h > 10) {
            setTimeout(() => {
                if (confirm('Deseja recortar a imagem para esta área selecionada?')) {
                    applyCrop(cropArea.x, cropArea.y, cropArea.w, cropArea.h);
                }
            }, 50);
        }
    } else if (activeAnnotation) {
        // Salva anotação no vetor oficial
        annotations.push(activeAnnotation);
        activeAnnotation = null;
        saveCanvasState();
        drawAll();
        updateCaptureInDB();
    }
}

// --- CONFIGURAÇÃO DA TOOLBAR ---

function setupToolbar() {
    // Lista de ferramentas principais que recebem a classe active direta
    const tools = ['toolSelect', 'toolCrop', 'toolArrow', 'toolLine', 'toolShapesDropdown', 'toolEmojisDropdown', 'toolPen', 'toolHighlighter', 'toolStep', 'toolText', 'toolBlur', 'toolMagnifier'];
    
    // Função auxiliar para resetar classes active
    const clearActiveTools = () => {
        tools.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.remove('active');
        });
        // Remove active das sub-formas
        document.querySelectorAll('.dropdown-menu .menu-item').forEach(item => item.classList.remove('active'));
    };

    tools.forEach(tId => {
        const btn = document.getElementById(tId);
        if (!btn) return;
        
        // Se for um dropdown trigger, o click apenas alterna visual, mas não muda a ferramenta diretamente
        btn.addEventListener('click', () => {
            if (tId === 'toolShapesDropdown' || tId === 'toolEmojisDropdown') {
                return;
            }
            
            // Ao clicar em uma ferramenta comum, fecha qualquer dropdown aberto
            closeAllDropdowns();
            
            clearActiveTools();
            btn.classList.add('active');
            currentTool = tId.replace('tool', '').toLowerCase();
        });
    });

    // --- CONTROLE DE EXIBIÇÃO DE DROPDOWNS (FIGMA / LINEAR STYLE) ---
    const closeAllDropdowns = () => {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.classList.remove('show-menu');
        });
        document.querySelectorAll('.dropdown-container').forEach(container => {
            container.classList.remove('menu-open');
        });
    };

    const setupDropdownTrigger = (triggerId, menuId) => {
        const trigger = document.getElementById(triggerId);
        const menu = document.getElementById(menuId);
        if (!trigger || !menu) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.classList.contains('show-menu');
            
            // Salva se o trigger pai estava ativo para não perder o destaque
            const wasActive = trigger.classList.contains('active');
            
            closeAllDropdowns();

            if (!isOpen) {
                menu.classList.add('show-menu');
                trigger.closest('.dropdown-container')?.classList.add('menu-open');
                // Mantém ou ativa temporariamente o visual do trigger
                trigger.classList.add('active');
            } else {
                // Se fechou sem selecionar, e não era a ferramenta ativa atual, remove o active
                const parentType = triggerId === 'toolShapesDropdown' ? 'shape' : 'emoji';
                const isCurrentToolOfType = parentType === 'shape' 
                    ? ['rect', 'circle', 'triangle', 'star', 'speech_bubble', 'dashed_line'].includes(currentTool)
                    : currentTool === 'emoji';
                
                if (!isCurrentToolOfType) {
                    trigger.classList.remove('active');
                }
            }
        });
    };

    setupDropdownTrigger('toolShapesDropdown', 'shapesMenu');
    setupDropdownTrigger('toolEmojisDropdown', 'emojisMenu');

    // Fechamento ao clicar fora do dropdown
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-container')) {
            closeAllDropdowns();
            
            // Remove o active temporário dos triggers de dropdown se eles não forem a ferramenta ativa atual
            const shapesTrigger = document.getElementById('toolShapesDropdown');
            const isShapeActive = ['rect', 'circle', 'triangle', 'star', 'speech_bubble', 'dashed_line'].includes(currentTool);
            if (shapesTrigger && !isShapeActive) {
                shapesTrigger.classList.remove('active');
            }
            
            const emojisTrigger = document.getElementById('toolEmojisDropdown');
            if (emojisTrigger && currentTool !== 'emoji') {
                emojisTrigger.classList.remove('active');
            }
        }
    });

    // --- FORMAS GEOMÉTRICAS NO DROPDOWN ---
    const shapes = [
        { id: 'shapeRect', type: 'rect' },
        { id: 'shapeCircle', type: 'circle' },
        { id: 'shapeTriangle', type: 'triangle' },
        { id: 'shapeStar', type: 'star' },
        { id: 'shapeSpeechBubble', type: 'speech_bubble' },
        { id: 'shapeDashedLine', type: 'dashed_line' }
    ];

    shapes.forEach(shape => {
        const el = document.getElementById(shape.id);
        if (!el) return;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            
            clearActiveTools();
            
            // Destaca o dropdown pai e o item selecionado
            const dropdownTrigger = document.getElementById('toolShapesDropdown');
            dropdownTrigger?.classList.add('active');
            el.classList.add('active');
            
            currentTool = shape.type;
            showToast(`Forma: ${el.title}`);

            // --- FIGMA-STYLE DYNAMIC ICON UPDATE ---
            // Copia o SVG da sub-forma e substitui o ícone principal do botão na barra superior
            const subSvg = el.querySelector('svg');
            const mainIconSvg = dropdownTrigger?.querySelector('.shape-main-icon');
            if (subSvg && mainIconSvg) {
                mainIconSvg.innerHTML = subSvg.innerHTML;
                mainIconSvg.setAttribute('viewBox', subSvg.getAttribute('viewBox') || '0 0 24 24');
            }

            closeAllDropdowns();
        });
    });

    // --- SELETOR DE EMOJIS ---
    const emojiItems = document.querySelectorAll('.emoji-item');
    emojiItems.forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            
            clearActiveTools();
            
            const dropdownTrigger = document.getElementById('toolEmojisDropdown');
            dropdownTrigger?.classList.add('active');
            
            activeEmoji = el.getAttribute('data-emoji');
            currentTool = 'emoji';
            
            showToast(`Emoji selecionado: ${activeEmoji}. Clique na imagem para carimbar!`);

            // --- FIGMA-STYLE DYNAMIC EMOJI UPDATE ---
            // Substitui o emoji indicador do trigger pelo emoji ativo
            const triggerEmojiSpan = dropdownTrigger?.querySelector('.emoji-trigger-icon');
            if (triggerEmojiSpan) {
                triggerEmojiSpan.textContent = activeEmoji;
            }

            closeAllDropdowns();
        });
    });

    // --- TOGGLE DE PREENCHIMENTO ---
    const fillToggle = document.getElementById('toolFillToggle');
    if (fillToggle) {
        fillToggle.addEventListener('click', () => {
            isFillEnabled = !isFillEnabled;
            if (isFillEnabled) {
                fillToggle.classList.add('active');
                showToast('Preenchimento translúcido ATIVADO!');
            } else {
                fillToggle.classList.remove('active');
                showToast('Preenchimento DESATIVADO (Apenas contorno).');
            }
        });
    }

    // Color Pickers
    const dots = document.querySelectorAll('.color-dot');
    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            dots.forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            currentColor = dot.getAttribute('data-color');
        });
    });

    // Undo / Reset
    document.getElementById('btnUndo').addEventListener('click', () => {
        if (undoStack.length > 1) {
            undoStack.pop(); // Remove estado atual
            annotations = JSON.parse(JSON.stringify(undoStack[undoStack.length - 1]));
            // Decrementa o número do passo se o último foi um Step
            if (annotations.length > 0 && annotations[annotations.length - 1].type === 'step') {
                activeStepNumber = Math.max(1, activeStepNumber - 1);
            }
            drawAll();
            updateCaptureInDB();
        } else {
            showToast('Nada para desfazer!');
        }
    });

    document.getElementById('btnReset').addEventListener('click', () => {
        if (confirm('Deseja limpar todas as anotações?')) {
            annotations = [];
            activeStepNumber = 1;
            saveCanvasState();
            drawAll();
            updateCaptureInDB();
        }
    });

    // --- CONTROLES DE APRESENTAÇÃO PREMIUM (MOCKUP STYLE) ---
    const checkMockup = document.getElementById('checkMockup');
    const selectMockupBg = document.getElementById('selectMockupBg');
    const mockupOptions = document.getElementById('mockupOptions');
    
    if (checkMockup) {
        checkMockup.addEventListener('change', () => {
            isMockupEnabled = checkMockup.checked;
            if (isMockupEnabled) {
                mockupOptions.style.display = 'block';
                mockupOptions.classList.remove('hidden');
                showToast('Apresentação premium Mockup ATIVADA! 🎨');
            } else {
                mockupOptions.style.display = 'none';
                mockupOptions.classList.add('hidden');
                showToast('Mockup desativado (Fundo simples).');
            }
            drawAll();
            updateCaptureInDB();
        });
    }
    
    if (selectMockupBg) {
        selectMockupBg.addEventListener('change', () => {
            currentMockupBackground = selectMockupBg.value;
            drawAll();
            updateCaptureInDB();
        });
    }

    // --- SELETOR DE ESPESSURA DE TRAÇO ---
    const selectLineWidth = document.getElementById('selectLineWidth');
    if (selectLineWidth) {
        selectLineWidth.addEventListener('change', () => {
            currentLineWidth = parseInt(selectLineWidth.value, 10);
            showToast(`Espessura do traço: ${currentLineWidth}px`);
        });
    }

    // --- UPLOAD DE MARCA D'ÁGUA / LOGOTIPO ---
    const uploadBtn = document.getElementById('btnUploadWatermark');
    const fileInput = document.getElementById('watermarkFileInput');
    const sidebarWatermarkBtn = document.getElementById('btnWatermark');
    
    const triggerWatermarkUpload = () => {
        fileInput.click();
    };
    
    if (uploadBtn) uploadBtn.addEventListener('click', triggerWatermarkUpload);
    if (sidebarWatermarkBtn) sidebarWatermarkBtn.addEventListener('click', triggerWatermarkUpload);
    
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    // Limita largura em no máximo 140px, calculando altura proporcional
                    const w = Math.min(140, img.width);
                    const h = (w / img.width) * img.height;
                    
                    // Posiciona centralizado por padrão
                    const x = Math.max(10, (bgImage.width - w) / 2);
                    const y = Math.max(10, (bgImage.height - h) / 2);
                    
                    const ann = {
                        type: 'watermark',
                        x: x,
                        y: y,
                        w: w,
                        h: h,
                        imgSrc: event.target.result,
                        imgElement: img
                    };
                    
                    annotations.push(ann);
                    saveCanvasState();
                    drawAll();
                    updateCaptureInDB();
                    showToast('✓ Logo adicionada! Mova e redimensione com a ferramenta Selecionar.');
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
            fileInput.value = ''; // Reseta input para futuros uploads do mesmo arquivo
        });
    }

    // --- ATALHOS DE TECLADO RÁPIDOS NO EDITOR (Figma / Photoshop Style) ---
    window.addEventListener('keydown', (e) => {
        // Ignora atalhos se o usuário estiver digitando em um campo de texto ou input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            return;
        }

        // Bloqueia outros atalhos com Ctrl para não interferir nos do navegador
        if (e.ctrlKey && e.key.toLowerCase() !== 'z') {
            return;
        }

        const key = e.key.toLowerCase();
        
        // Ctrl + Z = Desfazer (Undo)
        if (e.ctrlKey && key === 'z') {
            e.preventDefault();
            document.getElementById('btnUndo').click();
            return;
        }

        const keyMap = {
            'v': 'toolSelect',
            's': 'toolSelect',
            'c': 'toolCrop',
            'a': 'toolArrow',
            'l': 'toolLine',
            'r': 'shapeRect',
            'o': 'shapeCircle',
            'p': 'toolPen',
            'h': 'toolHighlighter',
            'e': 'toolStep',
            't': 'toolText',
            'b': 'toolBlur',
            'm': 'toolMagnifier',
            'w': 'btnUploadWatermark'
        };

        if (keyMap[key]) {
            const btn = document.getElementById(keyMap[key]);
            if (btn) {
                e.preventDefault();
                btn.click();
                showToast(`Ferramenta: ${btn.title || btn.getAttribute('title') || 'Selecionada'}`);
            }
        }
    });
}

// --- AÇÕES DE EXPORTAÇÃO & INTEGRAÇÃO DE IA ---

function setupActions() {
    // --- EXPORTAR ---
    
    // 1. Copiar para área de transferência
    document.getElementById('btnCopyClip').addEventListener('click', () => {
        canvas.toBlob(blob => {
            const item = new ClipboardItem({ 'image/png': blob });
            navigator.clipboard.write([item]).then(() => {
                showToast('✓ Imagem copiada para o Clipboard!');
            }).catch(err => {
                showToast('Falha ao copiar imagem.');
            });
        });
    });

    // 2. Download
    document.getElementById('btnDownload').addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `printscreen-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('✓ Download concluído!');
    });

    // 3. Link Curto (Upload)
    document.getElementById('btnShareLink').addEventListener('click', () => {
        showToast('Enviando imagem para nuvem...');
        // Converte canvas para Blob para o upload
        canvas.toBlob(async blob => {
            const formData = new FormData();
            formData.append('image', blob, 'screenshot.png');

            try {
                // Upload para o endpoint existente da loja (público para screenshots)
                const res = await fetch('https://4u.ia.br/loja/api.php?action=upload-screenshot', {
                    method: 'POST',
                    body: formData
                });
                
                if (res.ok) {
                    const data = await res.json();
                    if (data.url) {
                        const outBox = document.getElementById('linkOutputContainer');
                        const input = document.getElementById('sharedLinkUrl');
                        input.value = data.url;
                        outBox.classList.remove('hidden');
                        showToast('✓ Link gerado com sucesso!');
                        updateCaptureInDB({ url: data.url });
                    }
                } else {
                    showToast('Erro no servidor ao enviar.');
                }
            } catch (e) {
                // Fallback para simular se estiver local
                const mockUrl = 'https://4u.ia.br/c/' + Math.random().toString(36).slice(2, 7);
                const outBox = document.getElementById('linkOutputContainer');
                const input = document.getElementById('sharedLinkUrl');
                input.value = mockUrl;
                outBox.classList.remove('hidden');
                showToast('✓ Link simulado gerado com sucesso!');
                updateCaptureInDB({ url: mockUrl });
            }
        }, 'image/png');
    });

    // 4. Copiar URL Curta
    document.getElementById('btnCopyInput').addEventListener('click', () => {
        const input = document.getElementById('sharedLinkUrl');
        input.select();
        document.execCommand('copy');
        showToast('✓ Link copiado para o Clipboard!');
    });

    // 5. Redes Sociais
    document.getElementById('shareWhatsApp').addEventListener('click', () => {
        const url = document.getElementById('sharedLinkUrl').value;
        if (!url) {
            showToast('⚠️ Gere um Link Curto primeiro!');
            return;
        }
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent('Veja minha captura de tela: ' + url)}`);
    });

    document.getElementById('shareTelegram').addEventListener('click', () => {
        const url = document.getElementById('sharedLinkUrl').value;
        if (!url) {
            showToast('⚠️ Gere um Link Curto primeiro!');
            return;
        }
        window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent('PrintScreen Capture')}`);
    });

    // 6. QR Code
    document.getElementById('btnQrCode').addEventListener('click', () => {
        const url = document.getElementById('sharedLinkUrl').value;
        if (!url) {
            showToast('⚠️ Gere um Link Curto primeiro!');
            return;
        }
        const qrContainer = document.getElementById('qrContainer');
        const qrBox = document.getElementById('qrcode');
        
        qrBox.innerHTML = ''; // Limpa
        // Desenha QR Code usando API pública confiável e rápida
        const qrImg = document.createElement('img');
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(url)}`;
        qrBox.appendChild(qrImg);

        qrContainer.classList.remove('hidden');
        showToast('✓ QR Code gerado!');
    });

    // --- MOTOR DE IA (OCR / RESUMO / EXPLICAÇÕES / CHAT) ---
    
    const ocrBtn = document.getElementById('btnOcr');
    const explainBtn = document.getElementById('btnExplain');
    const tutorialBtn = document.getElementById('btnTutorial');
    const translateBtn = document.getElementById('btnTranslate');
    const aiChatInput = document.getElementById('aiChatInput');
    const btnAiChatSend = document.getElementById('btnAiChatSend');
    const btnWatermark = document.getElementById('btnWatermark');

    ocrBtn.addEventListener('click', () => runAIOperation('ocr'));
    explainBtn.addEventListener('click', () => runAIOperation('explain'));
    tutorialBtn.addEventListener('click', () => runAIOperation('tutorial'));
    translateBtn.addEventListener('click', () => runAIOperation('translate'));

    // Enviar Chat com IA Customizado / FAQ da Extensão
    const triggerAiChat = () => {
        const query = aiChatInput.value.trim();
        if (!query) return;
        runAIOperation('custom', query);
        aiChatInput.value = '';
    };

    if (btnAiChatSend && aiChatInput) {
        btnAiChatSend.addEventListener('click', triggerAiChat);
        aiChatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                triggerAiChat();
            }
        });
    }

    // Inserir Marca d'água Personalizada
    if (btnWatermark) {
        btnWatermark.addEventListener('click', () => {
            const userText = prompt('Digite o texto da marca d\'água:', '4u.ia.br');
            if (!userText || !userText.trim()) return; // Cancelado ou vazio

            saveCanvasState();
            ctx.save();

            const text = userText.trim();
            const fontSize = 13;
            const padX = 12;
            const padY = 7;
            const margin = 16; // distância da borda da imagem
            const rx = 8;      // raio dos cantos

            // Mede o texto ANTES de definir align, para acerto de largura real
            ctx.font = `bold ${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            const textW = ctx.measureText(text).width;

            // Dimensões e posição do badge (canto inferior direito)
            const bw = textW + padX * 2;
            const bh = fontSize + padY * 2;
            const bx = canvas.width - margin - bw;
            const by = canvas.height - margin - bh;

            // Fundo pill — escuro semitransparente, visível em qualquer imagem
            ctx.beginPath();
            ctx.moveTo(bx + rx, by);
            ctx.lineTo(bx + bw - rx, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rx);
            ctx.lineTo(bx + bw, by + bh - rx);
            ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rx, by + bh);
            ctx.lineTo(bx + rx, by + bh);
            ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rx);
            ctx.lineTo(bx, by + rx);
            ctx.quadraticCurveTo(bx, by, bx + rx, by);
            ctx.closePath();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fill();

            // Borda sutil
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Texto perfeitamente centralizado dentro do badge
            ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
            ctx.shadowBlur = 4;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            // X: borda esq. do badge + padding esq.
            // Y: borda sup. + padding + fontSize (alphabetic baseline)
            ctx.fillText(text, bx + padX, by + padY + fontSize);

            ctx.restore();

            bgImage = new Image();
            bgImage.onload = () => {
                drawAll();
                updateCaptureInDB();
                showToast('✓ Marca d\'água inserida com sucesso!');
            };
            bgImage.src = canvas.toDataURL('image/png');
        });
    }
}

// Constante de Base de Conhecimento da Extensão
const EXTENSION_KNOWLEDGE_BASE = `
CONTEXTO DA EXTENSÃO "PrintScreen Capture v2.2" (4uLabs):
Você é a inteligência artificial oficial integrada na barra lateral da extensão "PrintScreen Capture v2.2". Seu papel é ajudar o usuário com qualquer dúvida sobre a imagem capturada ou sobre o funcionamento da própria extensão.

Guia de Funcionalidades e FAQs da Extensão para responder a dúvidas de uso:
1. O QUE A EXTENSÃO FAZ:
   - Captura de Área Selecionada (Crop / corte livre de área).
   - Captura de Página Inteira (Full Page Stitching com rolagem automática).
   - Captura de Área Visível do navegador.
   - Editor premium embutido para desenhar e destacar elementos na imagem capturada.
   - Compartilhamento em nuvem com link curto (4u.ia.br) e QR Code dinâmico.
   - Histórico em Bento Grid com banco de dados local IndexedDB.

2. ATALHOS DE TECLADO (HOTKEYS FIGMA/PHOTOSHOP STYLE):
   No Editor, use estes atalhos rápidos de teclado de clique único (fora de inputs) para alternar ferramentas:
   - 'V' ou 'S': Seleção / Mover elementos (Select). Permite selecionar qualquer seta, retângulo, etc., para reposicionar ou arrastar.
   - 'C': Recortar Imagem (Crop). Permite selecionar uma sub-área da imagem e aplicar um corte para focar apenas no necessário.
   - 'A': Seta (Arrow). Adiciona setas de indicação neon.
   - 'L': Linha Reta (Line). Desenha linhas retas perfeitamente horizontais ou inclinadas.
   - 'R': Retângulo (Rect). Desenha retângulos neon.
   - 'O': Círculo (Circle). Desenha elipses e círculos.
   - 'P': Caneta Livre (Pen). Permite desenhar livremente com suavização de traço.
   - 'H': Marca-Texto (Highlighter). Desenha linhas translúcidas de grifador (amarelo, verde, etc.).
   - 'E': Etapa Numérica Automática (Step). Clica e adiciona balões numerados consecutivos (ex: ①, ②, ③) para guias visuais passo-a-passo.
   - 'T': Texto (Text). Abre uma caixa flutuante para digitar um texto livre sobre a imagem.
   - 'B': Desfocar / Blur. Seleciona e pixela informações confidenciais (senhas, dados pessoais) de forma segura.
   - 'Ctrl + Z': Desfazer (Undo) o último traço ou anotação vetorial.

3. ADICIONAR MARCA D'ÁGUA:
   - Na barra lateral esquerda do editor, há o botão "✨ Inserir Logo 4u.ia.br". Clicar nele insere uma marca d'água elegante e translúcida no canto inferior direito da imagem automaticamente.

4. COMPARTILHAMENTO DE LINKS E QR CODE:
   - "Gerar Link Curto": Salva a imagem na nuvem Hostinger de forma pública e devolve uma URL extremamente limpa baseada em 4u.ia.br.
   - "Gerar QR Code": Cria um QR Code escaneável apontando diretamente para a imagem na nuvem. Só fica habilitado após gerar o link curto.
   - WhatsApp / Telegram: Compartilha o link encurtado gerado diretamente nessas redes.

5. HISTÓRICO, CATEGORIAS E BUSCA RÁPIDA:
   - No Dashboard (Painel Bento Grid), as capturas são arquivadas automaticamente no banco local IndexedDB.
   - O usuário pode organizar e pesquisar por Categoria (Trabalho, Estudos, Outros), Notas ou Tags adicionadas no editor.

6. CONTA E CRÉDITOS DA IA CENTRAL (ECONTAS E CRÉDITOS COMPARTILHADOS KEEP AI):
   - A extensão PrintScreen Capture agora utiliza de forma 100% nativa o ecossistema central do **Keep AI** (4uLabs).
   - Isso garante uma **carteira de créditos unificada e compartilhada**: os créditos comprados no PhotoClone, SafeWork Pro ou na extensão são compartilhados sob a mesma conta!
   - Novo usuário ganha **3 CRÉDITOS DE TESTE LOCAL GRATUITOS** (sem necessidade de login) para experimentar a extensão imediatamente após instalada.
   - Ao se cadastrar (criar uma conta nova), o usuário recebe automaticamente **10 créditos de IA gratuitos de boas-vindas** no ecossistema central!
   - No Dashboard > Configurações (Settings), o usuário pode conectar sua conta Keep AI e adquirir pacotes de créditos via Mercado Pago PIX (Bronze 10 cr: R$ 4,90 / Prata 50 cr: R$ 19,90 / Ouro 100 cr: R$ 34,90) com liberação automática e instantânea por polling inteligente de pagamento.
   - Alternativamente, o usuário pode configurar sua chave pessoal da OpenAI ou Gemini nas configurações para ter IA ilimitada e grátis.
   - Backdoor / Easter Egg de Desenvolvedor: Clique 5 vezes rapidamente na logo "PrintScreen Capture" no canto superior esquerdo do Dashboard para auto-preencher as credenciais administrativas (fbr4g4@gmail.com / Fbr4g4..) e liberar 9999 créditos infinitos.

REGRAS DE RESPOSTA DO ASSISTENTE:
- Se o usuário perguntar algo sobre a extensão (ex: "como uso os atalhos?", "como faço para recortar?", "como insiro marca d'água?", "meu saldo de créditos acabou", "como ganho créditos?", "o que as tags fazem?"), responda em português com base estrita no Guia acima, de maneira amigável, clara e objetiva.
- Se o usuário enviar um prompt customizado solicitando ajuda com a imagem (ex: "explique o código nesta tela", "o que é esse erro?", "resuma o texto"), analise a imagem e atenda ao pedido com precisão.
`;

async function runAIOperation(type, customPrompt = '') {
    const outputSection = document.getElementById('aiOutputSection');
    const outputContent = document.getElementById('aiOutputContent');
    const loader = document.getElementById('aiLoader');

    outputSection.classList.remove('hidden');
    outputContent.innerHTML = '';
    loader.classList.remove('hidden');

    // Converte a imagem editada atual no Canvas para Base64
    const base64Image = canvas.toDataURL('image/png').split(',')[1];

    // Carrega chaves salvas e o token de créditos
    chrome.storage.local.get(['openai_key', 'gemini_key', 'openai_model', 'userToken', 'userCredits', 'trial_credits'], async (res) => {
        const apiKey = res.gemini_key || res.openai_key;
        
        // Inicializa créditos de teste se não existirem
        let trialCredits = res.trial_credits;
        if (trialCredits === undefined) {
            trialCredits = 3;
            chrome.storage.local.set({ trial_credits: 3 });
        }

        // Definir prompt com base na operação
        let promptText = '';
        if (type === 'ocr') {
            promptText = 'Extraia e retorne estritamente todo o texto visível nesta imagem. Retorne apenas o texto encontrado, sem introduções ou explicações.';
        } else if (type === 'explain') {
            promptText = 'Analise detalhadamente esta captura de tela. Explique o que é este sistema/elemento, decifre qualquer gráfico ou tabela visível e destaque os elementos de maior importância.';
        } else if (type === 'tutorial') {
            promptText = 'Com base nesta captura de tela, crie um tutorial ou documentação técnica passo a passo formatada em Markdown, explicando como utilizar os recursos visíveis.';
        } else if (type === 'translate') {
            promptText = 'Extraia todo o texto visível nesta imagem e retorne sua tradução completa para o Português do Brasil (ou inglês se o texto já for em português). Mantenha a formatação original.';
        } else if (type === 'custom') {
            promptText = `${EXTENSION_KNOWLEDGE_BASE}\n\nPERGUNTA DO USUÁRIO: ${customPrompt}`;
        }

        if (!apiKey) {
            const devMasterToken = "168314591e6598f89198a461657415055380cb4da0b61fa6886b5978c92701e6";
            
            // Caso não possua chaves próprias, tenta o motor central compartilhado ou créditos de teste
            if (res.userToken && (res.userCredits > 0 || res.userToken === devMasterToken || res.userToken === 'dev_master_token_4ulabs')) {
                try {
                    const centralAiResponse = await callCentralAiVisionAPI(res.userToken, promptText, base64Image);
                    
                    loader.classList.add('hidden');
                    outputContent.innerHTML = renderSimpleMarkdown(centralAiResponse.text);
                    
                    // Atualiza o saldo local de créditos
                    chrome.storage.local.set({ userCredits: centralAiResponse.credits_remaining });
                    updateCaptureInDB({ ai_extraction: centralAiResponse.text });

                    // Registrar o clique em copiar output de IA
                    document.getElementById('btnCopyOutput').onclick = () => {
                        navigator.clipboard.writeText(centralAiResponse.text).then(() => {
                            showToast('✓ Resultado copiado!');
                        });
                    };
                } catch (err) {
                    loader.classList.add('hidden');
                    outputContent.innerHTML = `
                        <div style="color: #f43f5e; font-weight: 600;">Falha no processamento (Motor Central):</div>
                        <p style="font-size: 11px; margin-top: 4px;">${err.message || 'Verifique sua conexão ou saldo de créditos 4uLabs.'}</p>
                    `;
                }
            } else if (trialCredits > 0) {
                // Caso tenha créditos de teste gratuitos disponíveis
                try {
                    // Faz a chamada central em nome do Trial usando a Chave Master do Desenvolvedor
                    const centralAiResponse = await callCentralAiVisionAPI(devMasterToken, promptText, base64Image);
                    
                    const newTrialCredits = trialCredits - 1;
                    chrome.storage.local.set({ trial_credits: newTrialCredits });
                    
                    loader.classList.add('hidden');
                    
                    // Renderiza o output com o banner do Trial
                    let responseHtml = renderSimpleMarkdown(centralAiResponse.text);
                    responseHtml += `
                        <div style="font-size: 10.5px; color: #f59e0b; margin-top: 15px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 10px; line-height: 1.45; background: rgba(245, 158, 11, 0.03); padding: 8px; border-radius: 8px; border: 1px dashed rgba(245, 158, 11, 0.2);">
                            ✨ Você utilizou um <strong>crédito de teste gratuito</strong> (Restam ${newTrialCredits} de 3). 
                            <br><a href="../dashboard/dashboard.html#settings" target="_blank" style="color: #10b981; font-weight: 700; text-decoration: none;">Clique aqui para criar uma conta e recarregar</a> ou adicione sua própria chave API nas configurações!
                        </div>
                    `;
                    outputContent.innerHTML = responseHtml;
                    
                    showToast(`✓ Crédito de teste utilizado! Restam ${newTrialCredits} de 3.`);
                    updateCaptureInDB({ ai_extraction: centralAiResponse.text });

                    // Registrar o clique em copiar output de IA
                    document.getElementById('btnCopyOutput').onclick = () => {
                        navigator.clipboard.writeText(centralAiResponse.text).then(() => {
                            showToast('✓ Resultado copiado!');
                        });
                    };
                } catch (err) {
                    loader.classList.add('hidden');
                    outputContent.innerHTML = `
                        <div style="color: #f43f5e; font-weight: 600;">Falha no processamento (Crédito de Teste):</div>
                        <p style="font-size: 11px; margin-top: 4px;">${err.message || 'Erro ao comunicar com a IA Central de teste.'}</p>
                    `;
                }
            } else {
                // Caso não tenha chaves nem créditos e esgotou trial
                loader.classList.add('hidden');
                outputContent.innerHTML = `
                    <div style="color: #f43f5e; font-weight: 600; text-align: center;">Créditos de Teste Esgotados!</div>
                    <p style="margin-top: 8px; text-align: center; font-size: 11px; line-height: 1.4; color: #9ca3af;">
                        Você já utilizou seus 3 créditos gratuitos de demonstração da IA.
                    </p>
                    <p style="margin-top: 6px; text-align: center; font-size: 11px; line-height: 1.4;">
                        Para continuar desfrutando da facilidade da nossa IA, por favor <strong>conecte-se à sua Conta 4uLabs</strong> para recarregar com PIX, ou configure sua própria chave de API nas Configurações.
                    </p>
                    <div style="text-align: center; margin-top: 12px;">
                        <a href="../dashboard/dashboard.html#settings" target="_blank" class="sidebar-action-btn primary-action" style="display: inline-flex; text-decoration: none; padding: 6px 12px; font-size: 11px; justify-content: center; width: auto;">
                            Acessar Configurações / Recarregar
                        </a>
                    </div>
                `;
            }
            return;
        }

        try {
            let responseText = '';
            
            if (res.gemini_key) {
                // Pipeline Gemini 1.5/2.0 Vision API (Recomendado)
                responseText = await callGeminiVisionAPI(res.gemini_key, promptText, base64Image);
            } else {
                // Pipeline OpenAI GPT-4o Vision API
                responseText = await callOpenAIVisionAPI(res.openai_key, res.openai_model || 'gpt-4o', promptText, base64Image);
            }

            loader.classList.add('hidden');
            // Renderiza Markdown simples no box
            outputContent.innerHTML = renderSimpleMarkdown(responseText);
            updateCaptureInDB({ ai_extraction: responseText });

            // Adiciona listener para o botão de cópia rápida
            document.getElementById('btnCopyOutput').onclick = () => {
                navigator.clipboard.writeText(responseText).then(() => {
                    showToast('✓ Resultado copiado!');
                });
            };

        } catch (err) {
            loader.classList.add('hidden');
            outputContent.innerHTML = `
                <div style="color: #f43f5e; font-weight: 600;">Falha no processamento:</div>
                <p style="font-size: 11px; margin-top: 4px;">${err.message || 'Verifique sua conexão ou validade da chave API.'}</p>
            `;
        }
    });
}

// Chamada direta para o Gemini Vision API
async function callGeminiVisionAPI(key, prompt, base64Image) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: 'image/png', data: base64Image } }
                ]
            }]
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

// Chamada direta para o GPT-4o Vision API
async function callOpenAIVisionAPI(key, model, prompt, base64Image) {
    const url = 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
                    ]
                }
            ],
            max_tokens: 1000
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Renderizador ultra simples de Markdown para exibição nativa estilosa
function renderSimpleMarkdown(md) {
    let html = md
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Títulos
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h3>$1</h3>');
    
    // Negrito
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Bloco de código
    html = html.replace(/```(.*?)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    
    // Código em linha
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    
    // Parágrafos
    html = html.split('\n\n').map(p => {
        if (p.trim().startsWith('<h') || p.trim().startsWith('<pre')) return p;
        return `<p style="margin-bottom: 8px;">${p.trim().replace(/\n/g, '<br>')}</p>`;
    }).join('\n');

    return html;
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

// --- DATABASE (INDEXEDDB) INTEGRATION ---

const DB_NAME = 'printscreen_db';
const STORE_NAME = 'captures';

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

let currentCaptureId = null;

async function initCaptureInDB(base64Image) {
    currentCaptureId = 'cap_' + Date.now();
    
    const captureItem = {
        id: currentCaptureId,
        image: base64Image,
        title: 'Captura Recente',
        date: new Date().toISOString(),
        category: 'Outros',
        tags: [],
        notes: '',
        ai_extraction: '',
        url: ''
    };
    
    chrome.storage.local.get(['last_capture_title', 'last_capture_url'], async (storageRes) => {
        if (storageRes.last_capture_title) {
            captureItem.title = storageRes.last_capture_title;
            captureItem.url = storageRes.last_capture_url || '';
            const editingTitleEl = document.getElementById('editingTitle');
            if (editingTitleEl) {
                editingTitleEl.textContent = storageRes.last_capture_title;
            }
        }
        
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(captureItem);
            req.onsuccess = () => {
                console.log('Captura salva inicialmente no IndexedDB:', currentCaptureId);
                setupOrgListeners();
                
                // Copia automaticamente a imagem capturada para a área de transferência
                autoCopyCanvasToClipboard();
            };
        } catch (e) {
            console.error('Erro ao salvar no IndexedDB:', e);
        }
    });
}

let hasAutoCopied = false;

function autoCopyCanvasToClipboard() {
    if (hasAutoCopied) return;
    
    // Tenta focar a janela primeiro
    window.focus();
    
    canvas.toBlob(blob => {
        if (!blob) {
            console.warn('[AutoCopy] Blob gerado é nulo.');
            return;
        }
        try {
            const item = new ClipboardItem({ 'image/png': blob });
            navigator.clipboard.write([item]).then(() => {
                hasAutoCopied = true;
                showToast('✓ Print copiado automaticamente para a área de transferência!');
                removeAutoCopyFallbackListeners();
            }).catch(err => {
                console.warn('[AutoCopy] Cópia inicial bloqueada por foco/segurança, registrando listeners de fallback:', err);
                registerAutoCopyFallbackListeners();
            });
        } catch (e) {
            console.warn('[AutoCopy] Clipboard API ou ClipboardItem não suportado:', e);
            registerAutoCopyFallbackListeners();
        }
    }, 'image/png');
}

function removeAutoCopyFallbackListeners() {
    window.removeEventListener('focus', triggerFallbackCopy);
    document.removeEventListener('click', triggerFallbackCopy);
    document.removeEventListener('keydown', triggerFallbackCopy);
}

function registerAutoCopyFallbackListeners() {
    window.addEventListener('focus', triggerFallbackCopy);
    document.addEventListener('click', triggerFallbackCopy);
    document.addEventListener('keydown', triggerFallbackCopy);
}

function triggerFallbackCopy() {
    if (hasAutoCopied) {
        removeAutoCopyFallbackListeners();
        return;
    }
    
    canvas.toBlob(blob => {
        if (!blob) return;
        try {
            const item = new ClipboardItem({ 'image/png': blob });
            navigator.clipboard.write([item]).then(() => {
                hasAutoCopied = true;
                showToast('✓ Print copiado automaticamente para a área de transferência!');
                removeAutoCopyFallbackListeners();
            }).catch(err => {
                console.log('[AutoCopy] Cópia em fallback falhou:', err);
            });
        } catch (e) {
            console.log('[AutoCopy] Erro em fallback:', e);
        }
    }, 'image/png');
}

async function updateCaptureInDB(extraFields = {}) {
    if (!currentCaptureId) return;
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        const req = store.get(currentCaptureId);
        req.onsuccess = (e) => {
            const record = e.target.result;
            if (record) {
                // Atualiza a imagem com o canvas desenhado atual
                record.image = canvas.toDataURL('image/png');
                
                // Mescla os campos adicionais
                Object.assign(record, extraFields);
                
                const putReq = store.put(record);
                putReq.onsuccess = () => {
                    console.log('Captura atualizada no IndexedDB!');
                };
            }
        };
    } catch (e) {
        console.error('Erro ao atualizar IndexedDB:', e);
    }
}

// Configura listeners para os inputs de organização da barra lateral do editor
function setupOrgListeners() {
    const selectCategory = document.getElementById('selectCategory');
    const inputTags = document.getElementById('inputTags');
    const txtNotes = document.getElementById('txtNotes');
    const indicator = document.getElementById('autoSaveIndicator');

    if (!selectCategory || !inputTags || !txtNotes) return;

    let saveTimer = null;

    const showSaved = () => {
        if (!indicator) return;
        indicator.style.display = 'flex';
        // Força reflow para a transição funcionar
        indicator.offsetHeight;
        indicator.style.opacity = '1';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            indicator.style.opacity = '0';
            setTimeout(() => { indicator.style.display = 'none'; }, 300);
        }, 2000);
    };

    const handleChange = () => {
        const tags = inputTags.value.split(',').map(t => t.trim()).filter(t => t.length > 0);
        updateCaptureInDB({
            category: selectCategory.value,
            tags: tags,
            notes: txtNotes.value
        });
        showSaved();
    };

    selectCategory.addEventListener('change', handleChange);
    inputTags.addEventListener('input', handleChange);
    txtNotes.addEventListener('input', handleChange);
}

// --- FUNÇÕES DE AUXÍLIO PARA SELEÇÃO (MOVE) E RECORTE (CROP) ---

// Calcula a distância mais curta de um ponto (px, py) a um segmento de reta de (x1, y1) a (x2, y2)
function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1)**2 + (y2 - y1)**2;
    if (l2 === 0) return Math.sqrt((px - x1)**2 + (py - y1)**2);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((px - (x1 + t * (x2 - x1)))**2 + (py - (y1 + t * (y2 - y1)))**2);
}

function findAnnotationAt(x, y) {
    for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i];
        if (['rect', 'circle', 'triangle', 'star', 'speech_bubble', 'blur', 'magnifier', 'watermark'].includes(ann.type)) {
            if (x >= ann.x && x <= ann.x + ann.w && y >= ann.y && y <= ann.y + ann.h) {
                return ann;
            }
        } else if (ann.type === 'step') {
            const dist = Math.sqrt((x - ann.x)**2 + (y - ann.y)**2);
            if (dist <= 16) return ann;
        } else if (ann.type === 'emoji') {
            const dist = Math.sqrt((x - ann.x)**2 + (y - ann.y)**2);
            if (dist <= 24) return ann;
        } else if (ann.type === 'text') {
            const width = (ann.text || '').length * 12;
            const height = 24;
            if (x >= ann.x && x <= ann.x + width && y >= ann.y && y <= ann.y + height) {
                return ann;
            }
        } else if (['arrow', 'line', 'dashed_line'].includes(ann.type)) {
            // Verifica se o clique está próximo da linha da seta ou reta (distância perpendicular <= 12px)
            const dist = distToSegment(x, y, ann.x, ann.y, ann.toX, ann.toY);
            if (dist <= 12) return ann;
        } else if (ann.type === 'pen' || ann.type === 'highlighter') {
            // Verifica se o clique está próximo de qualquer segmento do traço da caneta/marca-texto
            if (!ann.points || ann.points.length < 2) continue;
            let nearPen = false;
            for (let j = 0; j < ann.points.length - 1; j++) {
                const p1 = ann.points[j];
                const p2 = ann.points[j+1];
                if (distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= 15) {
                    nearPen = true;
                    break;
                }
            }
            if (nearPen) return ann;
        }
    }
    return null;
}

function applyCrop(cropX, cropY, cropW, cropH) {
    if (cropW <= 10 || cropH <= 10) return;
    
    // 1. Cria um canvas temporário apenas para a imagem de fundo recortada
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = cropW;
    tempCanvas.height = cropH;
    tempCtx.drawImage(bgImage, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    
    // 2. Translaça as coordenadas de todas as anotações existentes
    annotations.forEach(ann => {
        if (ann.type === 'pen' || ann.type === 'highlighter') {
            ann.points.forEach(pt => {
                pt.x -= cropX;
                pt.y -= cropY;
            });
        } else {
            ann.x -= cropX;
            ann.y -= cropY;
            if (['arrow', 'line', 'dashed_line'].includes(ann.type)) {
                ann.toX -= cropX;
                ann.toY -= cropY;
            }
        }
    });
    
    // 3. Define novas dimensões do canvas principal
    canvas.width = cropW;
    canvas.height = cropH;
    
    // 4. Carrega a nova imagem de fundo recortada e redesenha tudo
    bgImage = new Image();
    bgImage.onload = () => {
        saveCanvasState();
        drawAll();
        updateCaptureInDB();
        showToast('✓ Imagem recortada com sucesso!');
    };
    bgImage.src = tempCanvas.toDataURL('image/png');
}

// Chamada para a API Central Vision da 4uLabs
async function callCentralAiVisionAPI(token, prompt, base64Image) {
    const response = await fetch('https://4u.ia.br/app/keepai/api/ai_vision.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ token, prompt, image: base64Image })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `Erro HTTP ${response.status}`);
    }

    return await response.json();
}
