import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// --- スタイル定義 ---
if (!document.getElementById("gadget-train-style")) {
    const style = document.createElement('style');
    style.id = "gadget-train-style";
    style.textContent = `
        .train-popup-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); z-index: 10010;
            display: flex; justify-content: center; align-items: center;
            cursor: pointer; visibility: hidden; opacity: 0; transition: opacity 0.2s;
        }
        .train-popup-overlay.show { visibility: visible; opacity: 1; }
        .train-popup-content { position: relative; display: flex; justify-content: center; align-items: center; cursor: default; }
        .train-popup-img { max-width: 90vw; max-height: 90vh; width: auto; height: auto; display: block; user-select: none; cursor: pointer; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
        .train-popup-mask { position: absolute; top: 0; left: 0; pointer-events: none; opacity: 0.6; display: none; }

        .train-list { flex: 1; background: #111; color: #eee; font-size: 11px; outline: none; overflow-y: auto; user-select: none; border: none; }
        .train-tag-item {
            display: flex; align-items: center; padding: 3px 6px; 
            cursor: pointer; border-bottom: 1px solid #222; gap: 6px;
        }
        .train-tag-item:hover { background: #333; }
        .train-tag-item.selected { background: #0055ff; color: #fff; }
        .train-tag-item.dragging { opacity: 0.5; background: #444; border: 1px dashed #888; }
        .drag-handle { color: #666; cursor: grab; font-size: 12px; padding: 0 2px; }
        .drag-handle:hover { color: #fff; }
        .tag-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    `;
    document.head.appendChild(style);
}

app.registerExtension({
    name: "Gadget.TrainTagsEdit",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Edit Train Tags") return;
        // タグ要素を生成するヘルパー（Optionの代わり）
        const createTag = (text, value) => {
            const el = document.createElement("div");
            el.className = "train-tag-item";

            const handle = document.createElement("div");
            handle.className = "drag-handle";
            handle.innerHTML = "⠿";

            const label = document.createElement("span");
            label.className = "tag-label";
            label.textContent = text;

            el.appendChild(handle);
            el.appendChild(label);

            el.text = text;
            el.value = value;
            el.draggable = false;
            return el;
        };
        // --- データ更新用関数 ---
        const updateAll = async (node, canvas, midList, rightList) => {
            const folder = node.widgets.find(w => w.name === "folder").value;
            const imageWidget = node.widgets.find(w => w.name === "image_file_name");

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
                const item = createTag(t, i);
                if (data.blacklist.includes(t)) rightList.add(item);
                else midList.add(item);
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

            const createBox = (title, isKeepList = false) => {
                const box = document.createElement("div");
                box.style.cssText = "width: 180px; min-width: 180px; display: flex; flex-direction: column; border: 1px solid #444;";
                box.innerHTML = `<div style='font-size:11px; text-align:center; padding:2px; background:#333;'>${title}</div>`;

                const list = document.createElement("div");
                list.className = "train-list";

                Object.defineProperty(list, "options", { get: () => Array.from(list.children) });
                Object.defineProperty(list, "selectedOptions", { get: () => list.querySelectorAll(".selected") });
                list.add = (el) => { list.appendChild(el); };

                let isSelecting = false;
                let lastSelectedIndex = -1;
                let dragStartIndex = -1; // ドラッグ開始位置を保持

                list.addEventListener("mousedown", (e) => {
                    const items = Array.from(list.children);
                    const target = e.target.closest(".train-tag-item");
                    if (!target) return;

                    const isHandle = e.target.classList.contains("drag-handle");
                    const currentIndex = items.indexOf(target);

                    if (isHandle && isKeepList) {
                        // 並べ替えモード
                        if (!target.classList.contains("selected")) {
                            items.forEach(c => c.classList.remove("selected"));
                            target.classList.add("selected");
                        }
                        target.draggable = true;
                        node._draggedItems = items.filter(item => item.classList.contains("selected"));
                    } else {
                        // 範囲選択モード
                        isSelecting = true;
                        dragStartIndex = currentIndex; // 開始位置を記録
                        target.draggable = false;

                        if (e.shiftKey && lastSelectedIndex !== -1) {
                            const start = Math.min(lastSelectedIndex, currentIndex);
                            const end = Math.max(lastSelectedIndex, currentIndex);
                            for (let i = start; i <= end; i++) items[i].classList.add("selected");
                        } else if (e.ctrlKey || e.metaKey) {
                            target.classList.toggle("selected");
                        } else {
                            // 通常クリック：一旦すべて解除して開始点を手動選択
                            items.forEach(c => c.classList.remove("selected"));
                            target.classList.add("selected");
                        }
                        lastSelectedIndex = currentIndex;
                        if (!isHandle) e.preventDefault();
                    }
                });

                list.addEventListener("mouseover", (e) => {
                    if (isSelecting && dragStartIndex !== -1) {
                        const items = Array.from(list.children);
                        const target = e.target.closest(".train-tag-item");
                        if (!target) return;

                        const currentIndex = items.indexOf(target);
                        const start = Math.min(dragStartIndex, currentIndex);
                        const end = Math.max(dragStartIndex, currentIndex);

                        // 範囲外の選択を解除し、範囲内を選択する（拡大・縮小に対応）
                        items.forEach((item, index) => {
                            if (index >= start && index <= end) {
                                item.classList.add("selected");
                            } else {
                                // Ctrlキーを押していない場合は範囲外を解除
                                if (!e.ctrlKey && !e.metaKey) {
                                    item.classList.remove("selected");
                                }
                            }
                        });
                    }
                });

                window.addEventListener("mouseup", () => {
                    isSelecting = false;
                    dragStartIndex = -1;
                    Array.from(list.children).forEach(c => c.draggable = false);
                }, { capture: true });

                if (isKeepList) {
                    list.addEventListener("dragstart", (e) => {
                        if (e.target.draggable) {
                            node._draggedItems.forEach(item => item.classList.add("dragging"));
                        } else {
                            e.preventDefault();
                        }
                    });
                    list.addEventListener("dragend", (e) => {
                        if (node._draggedItems) {
                            node._draggedItems.forEach(item => item.classList.remove("dragging"));
                            node._draggedItems = null;
                        }
                        e.target.draggable = false;
                    });
                    list.addEventListener("dragover", (e) => {
                        e.preventDefault();
                        if (!node._draggedItems || node._draggedItems.length === 0) return;

                        const targetItem = e.target.closest(".train-tag-item");
                        // ターゲットがリスト内にない、または選択中のアイテム自体ならスキップ
                        if (!targetItem || node._draggedItems.includes(targetItem)) return;

                        const box = targetItem.getBoundingClientRect();
                        const isAfter = e.clientY > box.top + box.height / 2;

                        // 挿入の基準となる要素を決定
                        const referenceItem = isAfter ? targetItem.nextElementSibling : targetItem;

                        // 選択された塊の「現在のDOM上の並び順」を維持したまま、
                        // 基準要素の前に一つずつ挿入していく
                        node._draggedItems.forEach(item => {
                            // insertBeforeは「既存の要素を移動させる」挙動になるため、
                            // ループで順番に送ることで塊の状態を維持できる
                            list.insertBefore(item, referenceItem);
                        });
                    });
                }

                box.appendChild(list);
                return { box, list };
            };

            const mid = createBox("keep_tags", true);
            const right = createBox("remove_tags", false);

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
            const imageWidget = node.widgets.find(w => w.name === "image_file_name");
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
                        mid.list.add(createTag(txt, Date.now() + Math.random()));
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
                    content.appendChild(maskImg);
                }

                content.appendChild(activeImg);
                overlay.appendChild(content);
                document.body.appendChild(overlay);

                // --- ここから安定化ロジック ---
                activeImg.onload = () => {
                    syncMaskSize();
                    overlay.classList.add("show");
                };

                // キャッシュ対策：すでに読み込み完了していれば即座に表示
                if (activeImg.complete) {
                    syncMaskSize();
                    overlay.classList.add("show");
                }

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
                    window.removeEventListener('resize', onResize); // 正しい参照で解除
                    overlay.classList.remove("show");
                    setTimeout(() => overlay.remove(), 200);
                };
            };

            btnRight.onclick = () => Array.from(mid.list.selectedOptions).forEach(o => { o.classList.remove("selected"); right.list.add(o); });
            btnLeft.onclick = () => Array.from(right.list.selectedOptions).forEach(o => { o.classList.remove("selected"); mid.list.add(o); });

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