import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const GLOBAL_CROP_STATES = {};

if (!document.getElementById("gadget-image-style")) {
    const style = document.createElement('style');
    style.id = "gadget-image-style";
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
            resize: both;
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
        .crop-controls { padding: 10px 20px; background: #222; border-bottom: 1px solid #444; display: flex; align-items: center; gap: 20px; }
        .crop-control-item { display: flex; align-items: center; gap: 8px; color: #ccc; font-size: 14px; }
        .crop-footer {
            padding: 12px 20px;
            background: #222;
            border-top: 1px solid #444;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .crop-footer-left { display: flex; align-items: center; gap: 20px; }
        .crop-footer-right {
            display: flex;
            align-items: center;
            gap: 10px; /* ボタン間の隙間 */
            margin-left: auto; /* 左側に要素がない場合も右寄せにする */
        }
       .crop-btn {
            background: #333;
            color: #fff;
            border: 1px solid #555;
            padding: 0 12px;           /* 左右のパディング */
            height: 28px;              /* 高さを明示的に指定 */
            line-height: 26px;         /* テキストを垂直中央に */
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            box-sizing: border-box;    /* ボーダーを含めた高さ計算にする */
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .crop-btn:hover { background: #444; }
        select.crop-btn { padding-right: 20px; }
        .crop-btn-primary { background: #2a2; border-color: #3b3; }
        .crop-btn-secondary { background: #444; border-color: #666; }

        /* Image Indices Selector */
        .sel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 10005; display: flex; justify-content: center; align-items: center; font-family: sans-serif; }
        .sel-dialog { width: 95vw; height: 92vh; background: #1c1c1c; border: 1px solid #444; display: flex; flex-direction: column; color: white; border-radius: 8px; overflow: hidden; }
        .sel-header { padding: 12px 20px; background: #2a2a2a; border-bottom: 1px solid #444; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
        .sel-content { 
            flex: 1; overflow-y: auto; padding: 20px; display: grid; 
            grid-template-columns: repeat(var(--column-count, 4), 1fr); 
            gap: 10px; align-content: start; 
        }
        .sel-item { 
            background: #000; border: 3px solid transparent; cursor: pointer; 
            position: relative; width: 100%; aspect-ratio: 1 / 1; 
            display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        .sel-item.selected { 
            border-color: #00aaff; 
            box-shadow: inset 0 0 0 2px #00aaff, 0 0 15px rgba(0, 170, 255, 0.5); 
        }
        .sel-item img { 
            max-width: 100%; max-height: 100%; display: block; object-fit: contain; 
            pointer-events: none; user-select: none;
        }
        .sel-item::after { 
            content: attr(data-index); position: absolute; top: 5px; left: 5px; 
            background: rgba(0,0,0,0.7); padding: 2px 6px; font-size: 10px; border-radius: 4px; z-index: 5;
        }
        .sel-footer { padding: 15px 25px; background: #2a2a2a; border-top: 1px solid #444; display: flex; align-items: center; gap: 20px; }
        .sel-footer-btns { display: flex; gap: 8px; }
        .sel-slider-container { flex: 1; display: flex; align-items: center; gap: 10px; justify-content: center; }
        .sel-btn { padding: 8px 16px; cursor: pointer; background: #444; border: 1px solid #555; color: white; border-radius: 4px; font-size: 13px; min-width: 80px; }
        .sel-btn-primary { background: #007bff; border-color: #008cff; }
        .sel-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sel-popup { position: absolute; z-index: 10010; background: #000; border: 2px solid #00aaff; cursor: move; max-width: 85vw; max-height: 85vh; box-shadow: 0 0 30px #000; }
        .sel-popup img { display: block; max-width: 100%; max-height: 85vh; pointer-events: none; }`;
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
        this.images = data.preview_images;
        this.image_hash = data.image_hash;
        this.aspect_ratio_options = data.aspect_ratio_options;

        const prev = GLOBAL_CROP_STATES[this.node_id];
        if (prev && prev.hash === this.image_hash) {
            this.results = JSON.parse(JSON.stringify(prev.results));
        } else {
            this.results = this.images.map(() => ({
                x: 0.1, y: 0.1, w: 0.8, h: 0.8,
                ratio: data.default_aspect_ratio
            }));
        }
        this.initUI();
    }

    calculateInitialCrop(imgW, imgH, aspect_ratio, current = null) {
        if (aspect_ratio === "Any") {
            return current ? { x: current.x, y: current.y, w: current.w, h: current.h } : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        }
        const [rw, rh] = aspect_ratio.split(':').map(Number);
        const targetR = rw / rh;
        const imgR = imgW / imgH;

        let w, h;
        if (targetR > imgR) {
            w = 0.8; h = (w / targetR) * imgR;
        } else {
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
                if (!GLOBAL_CROP_STATES[this.node_id]) {
                    const initial = this.calculateInitialCrop(img.naturalWidth, img.naturalHeight, this.results[i].ratio);
                    Object.assign(this.results[i], initial);
                }
                this.drawThumbOverlay(canv, i);
            };
        });

        const footer = document.createElement('div');
        footer.className = 'crop-footer';
        const footRight = document.createElement('div');
        footRight.className = 'crop-footer-right';
        const ok = document.createElement('button');
        ok.className="crop-btn crop-btn-primary"; ok.innerText = "OK";
        ok.onclick = () => this.finish(true);
        const cancel = document.createElement('button');
        cancel.className="crop-btn"; cancel.innerText = "Cancel";
        cancel.onclick = () => this.finish(false);
        footRight.append(ok, cancel);
        footer.append(footRight);
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
        if (!img.naturalWidth) return;

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

        const footLeft = document.createElement('div');
        footLeft.className = 'crop-footer-left';

        const selectAllBtn = document.createElement('button');
        selectAllBtn.className = 'crop-btn crop-btn-secondary';
        selectAllBtn.innerText = 'Select ALL';
        selectAllBtn.onclick = () => {
            this.results[this.currentIndex].ratio = "Any";
            Object.assign(this.results[this.currentIndex], { x: 0, y: 0, w: 1, h: 1 });
            this.editorSelect.value = "Any";
            this.render();
        };
        this.editorSelect = document.createElement('select');
        this.editorSelect.className = 'crop-btn';
        this.aspect_ratio_options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt; o.text = opt;
            this.editorSelect.appendChild(o);
        });
        this.editorSelect.onchange = (e) => {
            const newRatio = e.target.value;
            const newCrop = this.calculateInitialCrop(this.activeImg.width, this.activeImg.height, newRatio, this.results[this.currentIndex]);
            this.results[this.currentIndex] = { ...newCrop, ratio: newRatio };
            this.render();
        };
        footLeft.append(selectAllBtn, this.editorSelect);

        const footRight = document.createElement('div');
        footRight.className = 'crop-footer-right';
        const ok = document.createElement('button');
        ok.className="crop-btn crop-btn-primary"; ok.innerText = "OK";
        ok.onclick = () => { this.popup.style.display = 'none'; this.refreshGrid(); };
        const cl = document.createElement('button');
        cl.className="crop-btn"; cl.innerText = "Cancel";
        cl.onclick = () => {
            this.results[this.currentIndex] = JSON.parse(this.backup);
            this.popup.style.display = 'none'; 
        };
        footRight.append(ok, cl);

        foot.append(footLeft, footRight);
        this.popup.append(wrapper, foot);
        document.body.appendChild(this.popup);
        this.initEvents();
    }

    openEditor(i) {
        this.currentIndex = i;
        this.backup = JSON.stringify(this.results[i]);
        this.popup.style.display = 'flex';
        this.editorSelect.value = this.results[i].ratio;

        this.activeImg = new Image();
        this.activeImg.src = this.images[i];
        this.activeImg.onload = () => this.render();
    }

    render() {
        if (!this.activeImg) return;
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

            // チェックボックスの状態を判定に使用
            const isFree = c.ratio === "Any";

            if (n && w) this.canvas.style.cursor = "nw-resize";
            else if (n && o) this.canvas.style.cursor = "ne-resize";
            else if (s && w) this.canvas.style.cursor = "sw-resize";
            else if (s && o) this.canvas.style.cursor = "se-resize";
            else if (isFree && (n || s)) this.canvas.style.cursor = "ns-resize";
            else if (isFree && (w || o)) this.canvas.style.cursor = "ew-resize";
            else if (m.x > c.x && m.x < c.x + c.w && m.y > c.y && m.y < c.y + c.h) this.canvas.style.cursor = "move";
            else this.canvas.style.cursor = "default";
        };

        this.canvas.onmousedown = (e) => {
            const m = getM(e); const c = this.results[this.currentIndex]; const b = 0.05;
            const n = Math.abs(m.y - c.y) < b, s = Math.abs(m.y - (c.y+c.h)) < b;
            const w = Math.abs(m.x - c.x) < b, o = Math.abs(m.x - (c.x+c.w)) < b;

            const isFree = c.ratio === "Any";

            if (n && w) handle = "nw"; else if (n && o) handle = "ne";
            else if (s && w) handle = "sw"; else if (s && o) handle = "se";
            else if (isFree && n) handle = "n"; else if (isFree && s) handle = "s";
            else if (isFree && w) handle = "w"; else if (isFree && o) handle = "e";
            else if (m.x > c.x && m.x < c.x + c.w && m.y > c.y && m.y < c.y + c.h) handle = "move";

            this.startX = m.x; this.startY = m.y; this.orig = {...c};
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
            } else if (c.ratio === "Any") {
                // 自由リサイズ
                if (handle.includes("n")) { c.y = Math.max(0, Math.min(this.anchorY-0.05, this.orig.y + dy)); c.h = this.anchorY - c.y; }
                if (handle.includes("s")) { c.h = Math.max(0.05, Math.min(1 - this.anchorY, this.orig.h + dy)); }
                if (handle.includes("w")) { c.x = Math.max(0, Math.min(this.anchorX-0.05, this.orig.x + dx)); c.w = this.anchorX - c.x; }
                if (handle.includes("e")) { c.w = Math.max(0.05, Math.min(1 - this.anchorX, this.orig.w + dx)); }
            } else {
                // 固定比率リサイズ
                const [rw, rh] = c.ratio.split(':').map(Number);
                const ratio = (rw / rh) * (this.activeImg.height / this.activeImg.width);

                if (handle.includes("e")) c.w = Math.max(0.05, Math.min(1 - this.anchorX, this.orig.w + dx));
                else if (handle.includes("w")) { c.w = Math.max(0.05, Math.min(this.anchorX, this.orig.w - dx)); c.x = this.anchorX - c.w; }

                c.h = c.w / ratio;
                if (handle.includes("n")) c.y = this.anchorY - c.h;

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
        if (ok) GLOBAL_CROP_STATES[this.node_id] = { hash: this.image_hash, results: this.results };
        await api.fetchApi("/gadget_nodes/image/crop_callback", {
            method: "POST", body: JSON.stringify({ node_id: this.node_id, results: ok ? this.results : "CANCEL" })
        });
        this.overlay.remove(); if (this.popup) this.popup.remove();
    }
}
//---------------------------
let GLOBAL_SELECTION_CACHE = { hash: "", indices: new Set() };
app.registerExtension({
    name: "Gadget.ImageIndicesSelector",
    init() {
        api.addEventListener("gadget.show_selector", (e) => {
            const { node_id, images, input_hash } = e.detail;
            this.showSelector(node_id, images, input_hash);
        });
    },

    showSelector(node_id, images, input_hash) {
        const overlay = document.createElement("div");
        overlay.className = "sel-overlay";
        const dialog = document.createElement("div");
        dialog.className = "sel-dialog";
        dialog.innerHTML = `<div class="sel-header"><span>Select Image Indices</span><span id="sel-count-badge">0 selected</span></div>`;
        
        const content = document.createElement("div");
        content.className = "sel-content";
        content.style.setProperty("--column-count", 4);

        let selected = new Set();
        if (GLOBAL_SELECTION_CACHE.hash === input_hash) {
            selected = new Set(GLOBAL_SELECTION_CACHE.indices);
        }
        
        let lastClicked = 0;
        let popup = null;

        const render = () => {
            content.querySelectorAll(".sel-item").forEach((item, i) => {
                item.classList.toggle("selected", selected.has(i));
            });
            const countBadge = dialog.querySelector("#sel-count-badge");
            countBadge.innerText = `${selected.size} selected`;
            okBtn.disabled = selected.size === 0;
        };

        const createItem = (data, idx) => {
            const item = document.createElement("div");
            item.className = "sel-item";
            item.dataset.index = idx;
            const img = document.createElement("img");
            img.src = data.src;
            item.appendChild(img);

            item.onclick = (e) => {
                if (e.ctrlKey || e.metaKey) {
                    selected.has(idx) ? selected.delete(idx) : selected.add(idx);
                } else if (e.shiftKey) {
                    const start = Math.min(lastClicked, idx);
                    const end = Math.max(lastClicked, idx);
                    for (let i = start; i <= end; i++) selected.add(i);
                } else {
                    selected.clear();
                    selected.add(idx);
                }
                lastClicked = idx;
                render();
            };
            item.ondblclick = () => showPopup(data.src);
            return item;
        };

        const showPopup = (src) => {
            if (popup) { popup.querySelector("img").src = src; return; }
            popup = document.createElement("div");
            popup.className = "sel-popup";
            popup.style.left = "50px"; popup.style.top = "50px";
            popup.innerHTML = `<img src="${src}">`;
            let isDragging = false, offset = [0, 0], moved = false;
            popup.onmousedown = (e) => { isDragging = true; moved = false; offset = [popup.offsetLeft - e.clientX, popup.offsetTop - e.clientY]; };
            const onMouseMove = (e) => { if (!isDragging) return; moved = true; popup.style.left = (e.clientX + offset[0]) + "px"; popup.style.top = (e.clientY + offset[1]) + "px"; };
            const onMouseUp = () => isDragging = false;
            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
            popup.onclick = () => { if (!moved) { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); popup.remove(); popup = null; } };
            document.body.appendChild(popup);
        };

        images.forEach((img, i) => content.appendChild(createItem(img, i)));
        dialog.appendChild(content);

        // フッター
        const footer = document.createElement("div");
        footer.className = "sel-footer";
        
        const leftBtns = document.createElement("div");
        leftBtns.className = "sel-footer-btns";
        const btnAll = document.createElement("button"); btnAll.className="sel-btn"; btnAll.innerText="全選択";
        btnAll.onclick = () => { images.forEach((_,i)=>selected.add(i)); render(); };
        const btnNone = document.createElement("button"); btnNone.className="sel-btn"; btnNone.innerText="全解除";
        btnNone.onclick = () => { selected.clear(); render(); };
        const btnInv = document.createElement("button"); btnInv.className="sel-btn"; btnInv.innerText="選択反転";
        btnInv.onclick = () => {
            const next = new Set();
            images.forEach((_,i) => { if(!selected.has(i)) next.add(i); });
            selected = next; render();
        };
        leftBtns.append(btnAll, btnNone, btnInv);

        const sliderCont = document.createElement("div");
        sliderCont.className = "sel-slider-container";
        const slider = document.createElement("input");
        slider.type = "range"; slider.min = "1"; slider.max = "10"; slider.value = "4";
        const colLab = document.createElement("span"); colLab.innerText = "4 Columns";
        slider.oninput = () => {
            content.style.setProperty("--column-count", slider.value);
            colLab.innerText = slider.value + (slider.value=="1"?" Column":" Columns");
        };
        sliderCont.append(document.createTextNode("Grid:"), slider, colLab);

        const rightBtns = document.createElement("div");
        rightBtns.className = "sel-footer-btns";
        const okBtn = document.createElement("button"); okBtn.className="sel-btn sel-btn-primary"; okBtn.innerText="OK";
        const clBtn = document.createElement("button"); clBtn.className="sel-btn"; clBtn.innerText="Cancel";

        const close = async (cancelled) => {
            if (popup) popup.remove();
            overlay.remove();
            window.removeEventListener("keydown", onKeyDown);
            GLOBAL_SELECTION_CACHE = { hash: input_hash, indices: selected };
            
            await api.fetchApi("/gadget_nodes/image/select_callback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    node_id: node_id,
                    cancelled: cancelled,
                    indices: Array.from(selected).sort((a,b)=>a-b).join(",")
                })
            });
        };

        okBtn.onclick = () => close(false);
        clBtn.onclick = () => close(true);
        rightBtns.append(okBtn, clBtn);

        footer.append(leftBtns, sliderCont, rightBtns);
        dialog.appendChild(footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const onKeyDown = (e) => {
            if (e.key === "Escape") { if (popup) { popup.remove(); popup = null; } else close(true); }
            if (e.key === "Enter" && !okBtn.disabled) close(false);
            if (e.ctrlKey || e.metaKey) {
                if (e.key === "a") { e.preventDefault(); btnAll.click(); }
                if (e.key === "i") { e.preventDefault(); btnInv.click(); }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        render();
    }
});