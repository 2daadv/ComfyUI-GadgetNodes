import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const GLOBAL_CROP_STATES = {};

if (!document.getElementById("gadget-crop-style")) {
    const style = document.createElement('style');
    style.id = "gadget-crop-style";
    style.textContent = `
        .crop-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); z-index: 10001; 
            display: flex; justify-content: center; align-items: center;
        }
        .crop-dialog-box {
            width: 80vw; height: 80vh; min-width: 400px; min-height: 300px;
            background: #1a1a1a; border: 2px solid #555; border-radius: 8px; 
            display: flex; flex-direction: column; overflow: hidden; 
            box-shadow: 0 0 40px rgba(0,0,0,0.8);
            resize: both; /* ダイアログ自体をリサイズ可能に */
        }
        .crop-modal-content {
            flex: 1; overflow-y: auto; display: grid; 
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); 
            gap: 15px; padding: 20px; background: #111;
        }
        .crop-thumb-container { position: relative; border: 1px solid #444; background: #000; height: 200px; cursor: pointer; }
        .crop-thumb-img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
        .crop-thumb-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
        
        .crop-editor-popup {
            position: fixed; top: 5%; left: 5%; width: 90%; height: 90%;
            background: #000; border: 1px solid #999; z-index: 10005;
            display: none; flex-direction: column; box-shadow: 0 0 50px #000;
        }
        .crop-canvas-wrapper { flex: 1; position: relative; display: flex; justify-content: center; align-items: center; overflow: hidden; }
        .crop-footer { padding: 12px; background: #222; text-align: right; border-top: 1px solid #444; }
        .crop-btn { margin-left: 10px; padding: 8px 20px; cursor: pointer; border: 1px solid #555; background: #333; color: white; }
        .crop-btn-primary { background: #2a2; border-color: #3b3; }
    `;
    document.head.appendChild(style);
}

app.registerExtension({
    name: "Gadget.ManualCrop",
    async setup() {
        api.addEventListener("gadget.show_crop_dialog", (e) => new CropDialog(e.detail));
        api.addEventListener("gadget.close_crop_dialog", () => {
            const elements = document.querySelectorAll('.crop-modal-overlay, .crop-editor-popup');
            elements.forEach(el => el.remove());
        });
    }
});

class CropDialog {
    constructor(data) {
        this.node_id = data.node_id;
        this.aspect_ratio = data.aspect_ratio;
        this.images = data.preview_images;
        this.image_hash = data.image_hash;

        const prev = GLOBAL_CROP_STATES[this.node_id];
        if (prev && prev.hash === this.image_hash && prev.ratio === this.aspect_ratio) {
            this.results = JSON.parse(JSON.stringify(prev.results));
        } else {
            this.results = this.images.map(() => ({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })); // 仮初期化
        }
        this.initUI();
    }

    // 正確な初期アスペクト比を計算（画像サイズ確定後に実行）
    calculateInitialCrop(imgW, imgH) {
        if (this.aspect_ratio === "Any") return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        const [rw, rh] = this.aspect_ratio.split(':').map(Number);
        const targetR = rw / rh;
        const imgR = imgW / imgH;
        
        let w, h;
        if (targetR > imgR) { // 横長ターゲット
            w = 0.8; h = (w / targetR) * imgR;
        } else { // 縦長ターゲット
            h = 0.8; w = (h * targetR) / imgR;
        }
        return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    }

    initUI() {
        const old = document.querySelector('.crop-modal-overlay');
        if (old) old.remove();

        this.overlay = document.createElement('div');
        this.overlay.className = 'crop-modal-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'crop-dialog-box';
        const content = document.createElement('div');
        content.className = 'crop-modal-content';
        
        this.images.forEach((src, i) => {
            const div = document.createElement('div');
            div.className = 'crop-thumb-container';
            div.onclick = () => this.openEditor(i);
            const img = document.createElement('img');
            img.src = src; img.className = 'crop-thumb-img';
            const canv = document.createElement('canvas');
            canv.className = 'crop-thumb-overlay';
            div.append(img, canv);
            content.appendChild(div);

            img.onload = () => {
                // 初回のみ比率を計算
                if (!GLOBAL_CROP_STATES[this.node_id] || GLOBAL_CROP_STATES[this.node_id].ratio !== this.aspect_ratio) {
                    this.results[i] = this.calculateInitialCrop(img.naturalWidth, img.naturalHeight);
                }
                this.drawThumbOverlay(canv, i);
            };
        });

        const footer = document.createElement('div');
        footer.className = 'crop-footer';
        const ok = document.createElement('button'); ok.className="crop-btn crop-btn-primary"; ok.innerText = "OK"; ok.onclick = () => this.finish(true);
        const cl = document.createElement('button'); cl.className="crop-btn"; cl.innerText = "Cancel"; cl.onclick = () => this.finish(false);
        footer.append(ok, cl);
        dialog.append(content, footer);
        this.overlay.append(dialog);
        document.body.appendChild(this.overlay);
        this.initEditor();
    }

    drawThumbOverlay(canvas, index) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const container = canvas.parentElement;
        const img = container.querySelector('img');
        const containerRatio = container.clientWidth / container.clientHeight;
        const imgRatio = img.naturalWidth / img.naturalHeight;
        
        let dW, dH, oX, oY;
        if (imgRatio > containerRatio) { dW = container.clientWidth; dH = dW / imgRatio; oX = 0; oY = (container.clientHeight - dH) / 2; }
        else { dH = container.clientHeight; dW = dH * imgRatio; oX = (container.clientWidth - dW) / 2; oY = 0; }

        canvas.width = container.clientWidth; canvas.height = container.clientHeight;
        const c = this.results[index];
        ctx.strokeStyle = '#0f0'; ctx.lineWidth = 2;
        ctx.strokeRect(oX + c.x * dW, oY + c.y * dH, c.w * dW, c.h * dH);
    }

    initEditor() {
        this.popup = document.createElement('div');
        this.popup.className = 'crop-editor-popup';
        const wrapper = document.createElement('div');
        wrapper.className = 'crop-canvas-wrapper';
        this.canvas = document.createElement('canvas');
        wrapper.appendChild(this.canvas);
        const foot = document.createElement('div');
        foot.className = 'crop-footer';
        const ok = document.createElement('button'); ok.className="crop-btn crop-btn-primary"; ok.innerText = "OK";
        ok.onclick = () => { this.popup.style.display = 'none'; this.refreshGrid(); };
        const cl = document.createElement('button'); cl.className="crop-btn"; cl.innerText = "Cancel";
        cl.onclick = () => { this.results[this.currentIndex] = JSON.parse(this.backup); this.popup.style.display = 'none'; };
        foot.append(ok, cl);
        this.popup.append(wrapper, foot);
        document.body.appendChild(this.popup);
        this.initEvents();
    }

    openEditor(i) {
        this.currentIndex = i;
        this.backup = JSON.stringify(this.results[i]); // キャンセル用にバックアップ
        this.popup.style.display = 'flex';
        this.activeImg = new Image();
        this.activeImg.src = this.images[i];
        this.activeImg.onload = () => this.render();
    }

    render() {
        const ctx = this.canvas.getContext('2d');
        const wrap = this.canvas.parentElement;
        const scale = Math.min((wrap.clientWidth-20)/this.activeImg.width, (wrap.clientHeight-20)/this.activeImg.height);
        this.canvas.width = this.activeImg.width * scale;
        this.canvas.height = this.activeImg.height * scale;
        ctx.drawImage(this.activeImg, 0, 0, this.canvas.width, this.canvas.height);
        const c = this.results[this.currentIndex];
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0,0,this.canvas.width, c.y*this.canvas.height);
        ctx.fillRect(0,(c.y+c.h)*this.canvas.height,this.canvas.width,this.canvas.height);
        ctx.fillRect(0,c.y*this.canvas.height,c.x*this.canvas.width,c.h*this.canvas.height);
        ctx.fillRect((c.x+c.w)*this.canvas.width,c.y*this.canvas.height,this.canvas.width,c.h*this.canvas.height);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.strokeRect(c.x*this.canvas.width, c.y*this.canvas.height, c.w*this.canvas.width, c.h*this.canvas.height);
    }

    initEvents() {
        let handle = ""; 
        const getM = (e) => {
            const r = this.canvas.getBoundingClientRect();
            return { x: (e.clientX - r.left) / this.canvas.width, y: (e.clientY - r.top) / this.canvas.height };
        };

        this.canvas.onmousemove = (e) => {
            if (handle) return;
            const m = getM(e); const c = this.results[this.currentIndex]; const b = 0.05;
            const n = Math.abs(m.y - c.y) < b, s = Math.abs(m.y - (c.y + c.h)) < b;
            const w = Math.abs(m.x - c.x) < b, o = Math.abs(m.x - (c.x + c.w)) < b;
            const isAny = this.aspect_ratio === "Any";
            if (n && w) this.canvas.style.cursor = "nw-resize";
            else if (n && o) this.canvas.style.cursor = "ne-resize";
            else if (s && w) this.canvas.style.cursor = "sw-resize";
            else if (s && o) this.canvas.style.cursor = "se-resize";
            else if (isAny && (n || s)) this.canvas.style.cursor = "ns-resize";
            else if (isAny && (w || o)) this.canvas.style.cursor = "ew-resize";
            else if (m.x > c.x && m.x < c.x + c.w && m.y > c.y && m.y < c.y + c.h) this.canvas.style.cursor = "move";
            else this.canvas.style.cursor = "default";
        };

        this.canvas.onmousedown = (e) => {
            const m = getM(e); const c = this.results[this.currentIndex]; const b = 0.05;
            const n = Math.abs(m.y - c.y) < b, s = Math.abs(m.y - (c.y+c.h)) < b;
            const w = Math.abs(m.x - c.x) < b, o = Math.abs(m.x - (c.x+c.w)) < b;
            const isAny = this.aspect_ratio === "Any";
            if (n && w) handle = "nw"; else if (n && o) handle = "ne";
            else if (s && w) handle = "sw"; else if (s && o) handle = "se";
            else if (isAny && n) handle = "n"; else if (isAny && s) handle = "s";
            else if (isAny && w) handle = "w"; else if (isAny && o) handle = "e";
            else if (m.x > c.x && m.x < c.x + c.w && m.y > c.y && m.y < c.y + c.h) handle = "move";
            
            this.startX = m.x; this.startY = m.y; this.orig = {...c};
            // 対角点の固定座標を保持
            this.anchorX = (handle.includes("w")) ? c.x + c.w : c.x;
            this.anchorY = (handle.includes("n")) ? c.y + c.h : c.y;
        };

        window.onmousemove = (e) => {
            if (!handle) return;
            const m = getM(e); const c = this.results[this.currentIndex];
            const dx = m.x - this.startX; const dy = m.y - this.startY;

            if (handle === "move") {
                c.x = Math.max(0, Math.min(1 - c.w, this.orig.x + dx));
                c.y = Math.max(0, Math.min(1 - c.h, this.orig.y + dy));
            } else if (this.aspect_ratio === "Any") {
                if (handle.includes("n")) { c.y = Math.max(0, Math.min(this.anchorY-0.05, this.orig.y + dy)); c.h = this.anchorY - c.y; }
                if (handle.includes("s")) { c.h = Math.max(0.05, Math.min(1 - this.anchorY, this.orig.h + dy)); }
                if (handle.includes("w")) { c.x = Math.max(0, Math.min(this.anchorX-0.05, this.orig.x + dx)); c.w = this.anchorX - c.x; }
                if (handle.includes("e")) { c.w = Math.max(0.05, Math.min(1 - this.anchorX, this.orig.w + dx)); }
            } else {
                const [rw, rh] = this.aspect_ratio.split(':').map(Number);
                const ratio = (rw / rh) * (this.activeImg.height / this.activeImg.width);
                
                // 固定比率リサイズ：anchorX/Yを支点に計算
                if (handle.includes("e")) c.w = Math.max(0.05, Math.min(1 - this.anchorX, this.orig.w + dx));
                else if (handle.includes("w")) { c.w = Math.max(0.05, Math.min(this.anchorX, this.orig.w - dx)); c.x = this.anchorX - c.w; }
                
                c.h = c.w / ratio;
                if (handle.includes("n")) c.y = this.anchorY - c.h;
                
                // 境界チェックと再計算
                if (c.y < 0) { c.y = 0; c.h = this.anchorY; c.w = c.h * ratio; if (handle.includes("w")) c.x = this.anchorX - c.w; }
                if (c.y + c.h > 1) { c.h = 1 - c.y; c.w = c.h * ratio; if (handle.includes("w")) c.x = this.anchorX - c.w; }
            }
            this.render();
        };
        window.onmouseup = () => handle = "";
    }

    refreshGrid() {
        const overlays = this.overlay.querySelectorAll('.crop-thumb-overlay');
        overlays.forEach((canv, i) => this.drawThumbOverlay(canv, i));
    }

    async finish(ok) {
        if (ok) GLOBAL_CROP_STATES[this.node_id] = { hash: this.image_hash, results: this.results, ratio: this.aspect_ratio };
        await api.fetchApi("/gadget_nodes/image/crop_callback", {
            method: "POST", body: JSON.stringify({ node_id: this.node_id, results: ok ? this.results : "CANCEL" })
        });
        this.overlay.remove(); this.popup.remove();
    }
}