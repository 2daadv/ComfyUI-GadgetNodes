import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// --- ポップアップ用のスタイル ---
if (!document.getElementById("gadget-train-style")) {
    const style = document.createElement('style');
    style.id = "gadget-train-style";
    style.textContent = `
        .train-popup-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); z-index: 10010;
            display: flex; justify-content: center; align-items: center;
            cursor: pointer;
            visibility: hidden; opacity: 0; transition: opacity 0.2s; /* フェードイン用 */
        }
        .train-popup-overlay.show {
            visibility: visible; opacity: 1;
        }
        .train-popup-content {
            position: relative; /* マスクの基準点 */
            display: flex; justify-content: center; align-items: center;
            cursor: default;
        }
        .train-popup-img {
            /* 画面内に収める主役。アスペクト比は保持される */
            max-width: 90vw; max-height: 90vh;
            width: auto; height: auto;
            display: block;
            user-select: none;
            cursor: pointer;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
        }
        .train-popup-mask {
            /* JSでサイズを制御するため、初期値は適当 */
            position: absolute; top: 0; left: 0;
            pointer-events: none; opacity: 0.6;
            display: none; /* 初期OFF */
        }
    `;
    document.head.appendChild(style);
}

app.registerExtension({
    name: "Gadget.TrainTagsEdit",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Edit Train Tags") return;

        // --- データ更新用関数 ---
        const updateAll = async (node, canvas, midList, rightList) => {
            const folder = node.widgets.find(w => w.name === "folder").value;
            const imageWidget = node.widgets.find(w => w.name === "selected_image");

            if (!folder) return;

            const imgResp = await api.fetchApi(`/gadget_nodes/train/get_images?folder=${encodeURIComponent(folder)}`);
            const imgData = await imgResp.json();
            imageWidget.options.values = imgData.files;

            if (imgData.files.length > 0 && (!imageWidget.value || !imgData.files.includes(imageWidget.value))) {
                imageWidget.value = imgData.files[0];
            }
            if (!imageWidget.value) return;

            const dataResp = await api.fetchApi(`/gadget_nodes/train/get_data?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(imageWidget.value)}`);
            const data = await dataResp.json();

            // ポップアップ用にデータを保持
            node._currentData = data;

            // プレビュー描画
            const ctx = canvas.getContext("2d");
            const img = new Image();
            img.onload = () => {
                canvas.width = img.width; canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                if (data.mask) {
                    const mask = new Image();
                    mask.onload = () => { ctx.globalAlpha = 0.2; ctx.drawImage(mask, 0, 0); ctx.globalAlpha = 1.0; };
                    mask.src = data.mask;
                }
            };
            img.src = data.img;

            midList.innerHTML = ""; rightList.innerHTML = "";
            data.tags.forEach((t, i) => {
                const opt = new Option(t, i);
                if (data.blacklist.includes(t)) rightList.add(opt);
                else midList.add(opt);
            });
        };

        nodeType.prototype.onNodeCreated = function () {
            const node = this;
            node.setSize([950, 650]);

            const minW = 540, minH = 300;
            node.onResize = function(size) {
                if (size[0] < minW) size[0] = minW;
                if (size[1] < minH) size[1] = minH;
                this.size[0] = size[0]; this.size[1] = size[1];
            };

            // --- UI構築 ---
            const mainView = document.createElement("div");
            mainView.style.cssText = "display: flex; height: 100%; color: white; padding: 5px; gap: 10px; font-family: sans-serif; background: #222;";

            const leftPane = document.createElement("div");
            leftPane.style.cssText = "flex: 1; display: flex; flex-direction: column; border: 1px solid #444; overflow: hidden;";

            const thumbCanvas = document.createElement("canvas");
            // cursorをzoom-inにしてポップアップ可能であることを示す
            thumbCanvas.style.cssText = "flex: 1; background: #000; object-fit: contain; width: 100%; min-height: 100px; cursor: zoom-in;";

            const keepTagsContainer = document.createElement("div"); keepTagsContainer.style.height = "50px";
            const btnKeep = document.createElement("button");
            btnKeep.innerText = ">> Keep";
            btnKeep.style.cssText = "background: #335; color: #fff; border: none; padding: 6px; cursor: pointer; font-size: 11px;";

            const removeTagsContainer = document.createElement("div"); removeTagsContainer.style.height = "50px";
            const btnRemove = document.createElement("button");
            btnRemove.innerText = ">> Remove";
            btnRemove.style.cssText = "background: #335; color: #fff; border: none; padding: 6px; cursor: pointer; font-size: 11px;";

            leftPane.append(thumbCanvas, keepTagsContainer, btnKeep, removeTagsContainer, btnRemove);

            const createBox = (title) => {
                const box = document.createElement("div");
                box.style.cssText = "width: 180px; min-width: 180px; display: flex; flex-direction: column; border: 1px solid #444;";
                box.innerHTML = `<div style='font-size:11px; text-align:center; padding:2px; background:#333;'>${title}</div>`;
                const list = document.createElement("select");
                list.multiple = true;
                list.style.cssText = "flex: 1; background: #111; color: #eee; border: none; font-size: 11px; outline: none;";
                box.appendChild(list);
                return { box, list };
            };
            const mid = createBox("keep_tags");
            const right = createBox("remove_tags");

            const controls = document.createElement("div");
            controls.style.cssText = "display: flex; flex-direction: column; justify-content: center; gap: 8px;";
            const createBtn = (t) => {
                const b = document.createElement("button");
                b.innerText = t; b.style.cssText = "width: 45px; height: 35px; cursor: pointer; background: #444; color: #fff; border: 1px solid #666;";
                return b;
            };
            const btnUp = createBtn("▲"), btnRight = createBtn(">>"), btnLeft = createBtn("<<"), btnDown = createBtn("▼"), btnSave = createBtn("Save");
            btnSave.style.background = "#282";
            controls.append(btnUp, btnRight, btnLeft, btnDown, btnSave);

            mainView.append(leftPane, mid.box, controls, right.box);
            node.addDOMWidget("main_editor_ui", "div", mainView);

            const folderWidget = node.widgets.find(w => w.name === "folder");
            const imageWidget = node.widgets.find(w => w.name === "selected_image");
            const keepTagsWidget = node.widgets.find(w => w.name === "keep_tags");
            const removeTagsWidget = node.widgets.find(w => w.name === "remove_tags");

            setTimeout(() => {
                if (keepTagsWidget.inputEl) {
                    keepTagsWidget.inputEl.style.width = keepTagsWidget.inputEl.style.height = "100%";
                    keepTagsWidget.inputEl.placeholder = "Tags to Add";
                    keepTagsContainer.appendChild(keepTagsWidget.inputEl);
                }
                if (removeTagsWidget.inputEl) {
                    removeTagsWidget.inputEl.style.width = removeTagsWidget.inputEl.style.height = "100%";
                    removeTagsWidget.inputEl.placeholder = "Tags to Remove";
                    removeTagsContainer.appendChild(removeTagsWidget.inputEl);
                }
                keepTagsWidget.type = removeTagsWidget.type = "hidden";
            }, 100);

            folderWidget.callback = imageWidget.callback = () => updateAll(node, thumbCanvas, mid.list, right.list);

            // --- タグ操作ロジック ---
            btnKeep.onclick = () => {
                if (!keepTagsWidget.value) return;
                const existing = new Set(Array.from(mid.list.options).map(o => o.text.trim()));
                keepTagsWidget.value.split(",").forEach(t => {
                    const txt = t.trim();
                    if (txt && !existing.has(txt)) {
                        mid.list.add(new Option(txt, Date.now() + Math.random()));
                        existing.add(txt);
                    }
                });
            };

            // Removeボタンの処理：keep_tags(mid)にあればremove_tags(right)へ移動
            btnRemove.onclick = () => {
                if (!removeTagsWidget.value) return;
                const targets = removeTagsWidget.value.split(",").map(t => t.trim()).filter(t => t);
                targets.forEach(tag => {
                    const foundOption = Array.from(mid.list.options).find(o => o.text === tag);
                    if (foundOption) {
                        right.list.add(foundOption); 
                    }
                });
            };

            // --- 画像ポップアップロジック ---
            thumbCanvas.onclick = () => {
                if (!node._currentData || !node._currentData.img) return;

                const overlay = document.createElement("div");
                overlay.className = "train-popup-overlay";

                const content = document.createElement("div");
                content.className = "train-popup-content";

                const activeImg = document.createElement("img");
                activeImg.src = node._currentData.img;
                activeImg.className = "train-popup-img";

                let maskImg = null;
                const syncMaskSize = () => {
                    if (maskImg && activeImg.complete) {
                        maskImg.style.width = `${activeImg.clientWidth}px`;
                        maskImg.style.height = `${activeImg.clientHeight}px`;
                    }
                };

                if (node._currentData.mask) {
                    maskImg = document.createElement("img");
                    maskImg.src = node._currentData.mask;
                    maskImg.className = "train-popup-mask";
                    // --- 初期値をJavaScript側で明示的にセット ---
                    maskImg.style.display = "none"; 
                    content.appendChild(maskImg);
                }

                content.appendChild(activeImg);
                overlay.appendChild(content);
                document.body.appendChild(overlay);

                activeImg.onload = () => {
                    syncMaskSize();
                    overlay.classList.add("show");
                };

                if(activeImg.complete) { syncMaskSize(); overlay.classList.add("show"); }

                const onResize = () => syncMaskSize();
                window.addEventListener('resize', onResize);

                activeImg.onclick = (e) => {
                    e.stopPropagation();
                    if (maskImg) {
                        // 1回目から確実に "none" と比較されるため、正しく反転
                        maskImg.style.display = (maskImg.style.display === "none") ? "block" : "none";
                    }
                };

                overlay.onclick = () => {
                    window.removeEventListener('resize', onResize);
                    overlay.classList.remove("show");
                    setTimeout(() => overlay.remove(), 200);
                };
            };

            btnRight.onclick = () => Array.from(mid.list.selectedOptions).forEach(o => right.list.add(o));
            btnLeft.onclick = () => {
                Array.from(right.list.selectedOptions).forEach(o => {
                    mid.list.add(o);
                    const opts = Array.from(mid.list.options).sort((a, b) => parseInt(a.value) - parseInt(b.value));
                    mid.list.innerHTML = ""; opts.forEach(opt => mid.list.add(opt));
                });
            };
            btnUp.onclick = () => Array.from(mid.list.selectedOptions).forEach(o => { if (o.previousElementSibling) mid.list.insertBefore(o, o.previousElementSibling); });
            btnDown.onclick = () => Array.from(mid.list.selectedOptions).reverse().forEach(o => { if (o.nextElementSibling) mid.list.insertBefore(o, o.nextElementSibling.nextElementSibling); });

            btnSave.onclick = async () => {
                const tags = Array.from(mid.list.options).map(o => o.text).join(",");
                await api.fetchApi("/gadget_nodes/train/save_tags", {
                    method: "POST",
                    body: JSON.stringify({ folder: folderWidget.value, filename: imageWidget.value, tags })
                });
            };

            setTimeout(() => updateAll(node, thumbCanvas, mid.list, right.list), 200);
            node.onConfigure = () => setTimeout(() => updateAll(node, thumbCanvas, mid.list, right.list), 300);
        };
    }
});