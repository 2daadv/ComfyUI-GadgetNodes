import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

app.registerExtension({
    name: "Gadget.TrainTagsEdit",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Edit Train Tags") return;

        // --- データ更新用関数 ---
        const updateAll = async (node, canvas, midList, rightList) => {
            const folder = node.widgets.find(w => w.name === "folder").value;
            const imageWidget = node.widgets.find(w => w.name === "selected_image");
            
            if (!folder) return;

            // 画像リスト更新
            const imgResp = await api.fetchApi(`/gadget_nodes/train/get_images?folder=${encodeURIComponent(folder)}`);
            const imgData = await imgResp.json();
            imageWidget.options.values = imgData.files;

            // 値が不正なら先頭を選択
            if (imgData.files.length > 0 && (!imageWidget.value || !imgData.files.includes(imageWidget.value))) {
                imageWidget.value = imgData.files[0];
            }
            if (!imageWidget.value) return;

            // 詳細データ取得
            const dataResp = await api.fetchApi(`/gadget_nodes/train/get_data?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(imageWidget.value)}`);
            const data = await dataResp.json();

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

            // タグ分配
            midList.innerHTML = ""; rightList.innerHTML = "";
            data.tags.forEach((t, i) => {
                const opt = new Option(t, i);
                if (data.blacklist.includes(t)) rightList.add(opt);
                else midList.add(opt);
            });
        };

        nodeType.prototype.onNodeCreated = function () {
            const node = this;
            // 初期サイズの設定
            const initialWidth = 950;
            const initialHeight = 650;
            node.setSize([initialWidth, initialHeight]);

            // --- 強制リサイズガード (Custom-Scripts対策) ---
            const minW = 540;
            const minH = 300;

            node.onResize = function(size) {
                let needsFix = false;
                if (size[0] < minW) { size[0] = minW; needsFix = true; }
                if (size[1] < minH) { size[1] = minH; needsFix = true; }
                
                if (needsFix) {
                    // size配列を直接書き換えることで、LiteGraphの描画ループに反映させます
                    this.size[0] = size[0];
                    this.size[1] = size[1];
                }
            };

            // --- UI構築 ---
            const mainView = document.createElement("div");
            mainView.style.cssText = "display: flex; height: 100%; color: white; padding: 5px; gap: 10px; font-family: sans-serif; background: #222;";
            
            // 左ペイン (プレビュー + タグ入力)
            const leftPane = document.createElement("div");
            leftPane.style.cssText = "flex: 1; display: flex; flex-direction: column; border: 1px solid #444; overflow: hidden;";
            
            const thumbCanvas = document.createElement("canvas");
            thumbCanvas.style.cssText = "flex: 1; background: #000; object-fit: contain; width: 100%; min-height: 100px;";
            
            const tagsContainer = document.createElement("div"); 
            tagsContainer.style.height = "100px";
            
            const btnKeep = document.createElement("button");
            btnKeep.innerText = ">>";
            btnKeep.style.cssText = "background: #335; color: #fff; border: none; padding: 6px; cursor: pointer; font-size: 11px;";

            leftPane.append(thumbCanvas, tagsContainer, btnKeep);

            // リスト作成
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
            const btnUp = createBtn("▲");
            const btnRight = createBtn(">>");
            const btnLeft = createBtn("<<");
            const btnDown = createBtn("▼");
            const btnSave = createBtn("Save");
            btnSave.style.background = "#282";
            controls.append(btnUp, btnRight, btnLeft, btnDown, btnSave);

            mainView.append(leftPane, mid.box, controls, right.box);
            node.addDOMWidget("main_editor_ui", "div", mainView);

            // --- ウィジェットの引っ越し (tags_inputのみ) ---
            const folderWidget = node.widgets.find(w => w.name === "folder");
            const imageWidget = node.widgets.find(w => w.name === "selected_image");
            const tagsWidget = node.widgets.find(w => w.name === "tags_input");

            setTimeout(() => {
                if (tagsWidget.inputEl) {
                    tagsWidget.inputEl.style.width = "100%";
                    tagsWidget.inputEl.style.height = "100%";
                    tagsContainer.appendChild(tagsWidget.inputEl);
                }
                // tags_inputは上部に残さない
                tagsWidget.type = "hidden";
            }, 100);

            // コールバック
            folderWidget.callback = () => updateAll(node, thumbCanvas, mid.list, right.list);
            imageWidget.callback = () => updateAll(node, thumbCanvas, mid.list, right.list);

            btnKeep.onclick = () => {
                if (!tagsWidget.value) return;

                // 現在のKeepリストにあるタグをすべて取得してSetに格納（比較用）
                const existingTags = new Set(
                    Array.from(mid.list.options).map(o => o.text.trim())
                );

                // 入力された文字列をカンマで区切り、未登録のものだけを追加
                tagsWidget.value.split(",").forEach(t => {
                    const txt = t.trim();
                    // 空文字でなく、かつ既存リストに含まれていない場合のみ追加
                    if (txt && !existingTags.has(txt)) {
                        mid.list.add(new Option(txt, Date.now() + Math.random()));
                        // 追加した直後のタグも一応Setに入れておく（一度に同じタグを複数入力した場合の対策）
                        existingTags.add(txt);
                    }
                });

                // 複数画像に同じキャプションを追加する用途を考え、入力欄をクリアはしない
                // tagsWidget.value = "";
                // if (tagsWidget.inputEl) tagsWidget.inputEl.value = "";
            };

            // 操作ロジック
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

            // 初期化とリロード対応
            setTimeout(() => updateAll(node, thumbCanvas, mid.list, right.list), 200);
            node.onConfigure = () => setTimeout(() => updateAll(node, thumbCanvas, mid.list, right.list), 300);
        };
    }
});