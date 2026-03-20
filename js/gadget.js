import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";

app.registerExtension({
    name: "GadgetNodes.CheckpointPresetLoader",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "Load Checkpoint Preset") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

                // --- 値を更新する共通関数 (Primitiveノード対応) ---
                const updateValue = (name, value) => {
                    if (value === undefined) return;

                    // 自身のウィジェットを更新
                    const widget = this.widgets?.find(w => w.name === name);
                    if (widget) {
                        widget.value = value;
                    } 
                    
                    // 外部入力（PrimitiveNode等）に接続されている場合
                    const input = this.inputs?.find(i => i.name === name);
                    if (input && input.link !== null) {
                        const link = app.graph.links[input.link];
                        if (link) {
                            const originNode = app.graph.getNodeById(link.origin_id);
                            if (originNode && originNode.type === "PrimitiveNode") {
                                if (originNode.widgets && originNode.widgets[0]) {
                                    originNode.widgets[0].value = value;
                                }
                            }
                        }
                    }
                };

                // --- ckpt_name変更時のトリガー ---
                const ckptWidget = this.widgets.find((w) => w.name === "ckpt_name");
                if (ckptWidget) {
                    const oldCallback = ckptWidget.callback;
                    ckptWidget.callback = async (value) => {
                        const res = oldCallback ? oldCallback.apply(this, arguments) : undefined;
                        
                        try {
                            const response = await fetch(`/gadget_nodes/get_ckpt_preset?ckpt_name=${encodeURIComponent(value)}`);
                            if (response.ok) {
                                const preset = await response.json();
                                
                                // GUI反映（プリセット名も更新）
                                updateValue("vae_name", preset.vae_name);
                                updateValue("clip_skip", preset.clip_skip);
                                updateValue("steps", preset.steps_total || preset.steps);
                                updateValue("cfg", preset.cfg);
                                updateValue("sampler_name", preset.sampler_name);
                                updateValue("scheduler_name", preset.scheduler_name);
                                updateValue("positive", preset.positive);
                                updateValue("negative", preset.negative);
                                updateValue("preset_name", preset.preset_name);

                                this.setDirtyCanvas(true);
                            } else {
                                // 見つからない場合はクリア
                                updateValue("preset_name", "(none)");
                            }
                        } catch (e) {
                            console.error(e);
                        }
                        return res;
                    };
                    // ノード作成時の初期実行
                    // setTimeout を使うことで、ノードの構築が完全に終わった直後に実行させる
                    setTimeout(() => {
                        if (ckptWidget.value) {
                            ckptWidget.callback(ckptWidget.value);
                        }
                    }, 1);
                }
                return r;
            };
        }
    }
});
app.registerExtension({
    name: "Gadget.LoraInfoEditor",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "Edit SD Lora Information") {

            // 情報更新のコア関数
            const refreshLoraData = async (node, loraName) => {
                const getW = (name) => node.widgets.find(w => w.name === name);
                // --- 共通のリセット処理 ---
                const clearFields = () => {
                    const defaults = {
                        "lora_prompt": "",
                        "description": "",
                        "sd_version": "",
                        "activation_text": "",
                        "preferred_weight": 1.0,
                        "negative_text": "",
                        "notes": ""
                    };
                    for (const [key, val] of Object.entries(defaults)) {
                        const w = getW(key);
                        if (w) w.value = val;
                    }
                    node.lora_thumb = null;
                    node.setDirtyCanvas(true);
                };
                if (!loraName) {
                    clearFields();
                    return;
                }
                try {
                    const response = await fetch(`/gadget_nodes/get_lora_info?lora_name=${encodeURIComponent(loraName)}`);
                    // 200以外（404など）の場合はフィールドをクリア
                    if (!response.ok) {
                        clearFields();
                        return false;
                    }
                    
                    const data = await response.json();
                    // JSONがない、または空の場合
                    if (!data || !data.json || Object.keys(data.json).length === 0) {
                        clearFields();
                        // サムネイルだけはあるかもしれないので、一応チェック
                        if (data.thumb) {
                            const img = new Image();
                            img.src = data.thumb;
                            img.onload = () => { node.lora_thumb = img; node.setDirtyCanvas(true); };
                        }
                        return false;
                    }
                    const info = data.json || {};

                    // ウィジェットへの反映
                    const preferred_weight = info["preferred weight"];
                    const activation_text = info["activation text"];
                    const widgetMap = {
                        "lora_prompt": `<${loraName}:${preferred_weight}>,${activation_text}`,
                        "description": info.description,
                        "sd_version": info["sd version"],
                        "activation_text": activation_text,
                        "preferred_weight": preferred_weight,
                        "negative_text": info["negative text"],
                        "notes": info.notes
                    };

                    for (const [key, val] of Object.entries(widgetMap)) {
                        const w = node.widgets.find(x => x.name === key);
                        if (w && val !== undefined) {
                            w.value = (key === "preferred_weight") ? parseFloat(val) : String(val);
                        }
                    }

                    // 画像データの保持
                    if (data.thumb) {
                        const img = new Image();
                        img.src = data.thumb;
                        img.onload = () => {
                            node.lora_thumb = img;
                            node.setDirtyCanvas(true);
                            app.canvas.draw(true, true);
                        };
                    } else {
                        node.lora_thumb = null;
                        node.setDirtyCanvas(true);
                    }
                    return true;
                } catch (e) {
                    console.error("LoraInfo Error:", e);
                    clearFields(); // 例外発生時もクリア
                    return false;
                }
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                onNodeCreated?.apply(this, arguments);
                const node = this;
                // --- Saveボタンの追加 ---
                node.addWidget("button", "Save", null, () => {
                    const loraName = node.widgets.find(w => w.name === "lora_name")?.value;
                    
                    if (!loraName) return;

                    // 確認ダイアログの表示 (lora_nameのみ表示)
                    if (confirm(`Are you sure to save:\n${loraName.replace(/\.(safetensors|ckpt)$/i, ".json")}`)) {
                        saveLoraInfo(node);
                    }
                });

                // --- 保存処理の実行関数 ---
                const saveLoraInfo = async (node) => {
                    const getVal = (name) => node.widgets.find(w => w.name === name)?.value;

                    const payload = {
                        lora_name: getVal("lora_name"),
                        description: getVal("description"),
                        sd_version: getVal("sd_version"),
                        activation_text: getVal("activation_text"),
                        preferred_weight: parseFloat(getVal("preferred_weight")),
                        negative_text: getVal("negative_text"),
                        notes: getVal("notes")
                    };

                    try {
                        const response = await fetch("/gadget_nodes/save_lora_info", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload)
                        });

                        if (!response.ok) {
                            const err = await response.json();
                            alert(`Save failed: ${err.error}`);
                        }
                    } catch (e) {
                        console.error("Save Error:", e);
                        alert("Error: check console.");
                    }
                };

                // 各ウィジェットの参照を取得
                const getW = (name) => node.widgets.find(w => w.name === name);
                const wLora = getW("lora_name");
                const wWeight = getW("preferred_weight");
                const wTags = getW("activation_text");
                const wPrompt = getW("lora_prompt");
                // --- プロンプトを合成する関数 ---
                const updateFullPrompt = () => {
                    const name = (wLora.value || "").replace(/\.(safetensors|ckpt)$/i, "");
                    const weight = parseFloat(Number(wWeight.value ?? 1.0).toFixed(2));
                    const tags = wTags.value || "";
                    wPrompt.value = `<lora:${name}:${weight}>,${tags}`;
                };
                // --- ユーザーの手入力に反応させる ---
                // 数値スライダーやテキストボックスが変わるたびに実行
                wWeight.callback = updateFullPrompt;
                wTags.callback = updateFullPrompt;

                // 1. 値の変更を監視 (Setterオーバーライドで外部入力にも対応)
                let val = wLora.value;
                Object.defineProperty(wLora, "value", {
                    set: (newVal) => {
                        if (val !== newVal) {
                            val = newVal;
                            refreshLoraData(node, newVal).then(() => updateFullPrompt());
                        }
                    },
                    get: () => val,
                    configurable: true
                });

                // --- 【ここが重要】初期化処理 ---
                const init = async () => {
                    if (wLora.value) {
                        // 1. まずAPIから最新情報を取得
                        await refreshLoraData(node, wLora.value);
                        // 2. 取得した情報（または保存されていた値）を元にプロンプトを合成
                        updateFullPrompt();
                        node.setDirtyCanvas(true);
                    }
                };
                // ノードがグラフに追加され、保存された値が流し込まれた直後を狙う
                setTimeout(init, 100);

                // ノードサイズの初期調整
                node.size = [350, 420];
            };

            // 3. プレビュー画像の描画 (出力端子の左側余白を活用)
            nodeType.prototype.onDrawForeground = function(ctx) {
                if (!this.flags.collapsed && this.lora_thumb) {
                    const img = this.lora_thumb;
                    
                    // 描画エリアの計算
                    const x = 5;
                    const y = 5; // タイトルバーやウィジェットを避けるための上部余白
                    const maxW = this.size[0] - 10; // ノード幅の45%程度を使用
                    const maxH = 154;
                    
                    let drawW = img.width;
                    let drawH = img.height;
                    const scale = Math.min(maxW / drawW, maxH / drawH);
                    drawW *= scale;
                    drawH *= scale;

                    // 背景と枠線（少しリッチに）
                    ctx.save();
                    ctx.fillStyle = "#000000AA";
                    ctx.strokeStyle = "#666666";
                    ctx.lineWidth = 1;
                    
                    ctx.beginPath();
                    ctx.roundRect(x - 2, y - 2, drawW + 4, drawH + 4, 4);
                    ctx.fill();
                    ctx.stroke();

                    // 画像の描画
                    ctx.drawImage(img, x, y, drawW, drawH);
                    ctx.restore();
                }
            };
        }
    }
});
app.registerExtension({
    name: "Gadget.CheckpointInfoEditor",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "Edit SD Checkpoint Information") {

            // 情報更新のコア関数
            const refreshCheckPointData = async (node, ckptName) => {
                const getW = (name) => node.widgets.find(w => w.name === name);
                // --- 共通のリセット処理 ---
                const clearFields = () => {
                    const defaults = {
                        "description": "",
                        "notes": "",
                        "vae": ""
                    };
                    for (const [key, val] of Object.entries(defaults)) {
                        const w = getW(key);
                        if (w) w.value = val;
                    }
                    node.lora_thumb = null;
                    node.setDirtyCanvas(true);
                };
                if (!ckptName) {
                    clearFields();
                    return;
                }
                try {
                    const response = await fetch(`/gadget_nodes/get_ckpt_info?ckpt_name=${encodeURIComponent(ckptName)}`);
                    // 200以外（404など）の場合はフィールドをクリア
                    if (!response.ok) {
                        clearFields();
                        return false;
                    }
                    
                    const data = await response.json();
                    // JSONがない、または空の場合
                    if (!data || !data.json || Object.keys(data.json).length === 0) {
                        clearFields();
                        // サムネイルだけはあるかもしれないので、一応チェック
                        if (data.thumb) {
                            const img = new Image();
                            img.src = data.thumb;
                            img.onload = () => { node.lora_thumb = img; node.setDirtyCanvas(true); };
                        }
                        return false;
                    }
                    const info = data.json || {};

                    // ウィジェットへの反映
                    const widgetMap = {
                        "description": info.description,
                        "notes": info.notes,
                        "vae": info.vae
                    };

                    for (const [key, val] of Object.entries(widgetMap)) {
                        const w = node.widgets.find(x => x.name === key);
                        if (w && val !== undefined) {
                            w.value = (key === "preferred_weight") ? parseFloat(val) : String(val);
                        }
                    }

                    // 画像データの保持
                    if (data.thumb) {
                        const img = new Image();
                        img.src = data.thumb;
                        img.onload = () => {
                            node.lora_thumb = img;
                            node.setDirtyCanvas(true);
                            app.canvas.draw(true, true);
                        };
                    } else {
                        node.lora_thumb = null;
                        node.setDirtyCanvas(true);
                    }
                    return true;
                } catch (e) {
                    console.error("CheckPointInfo Error:", e);
                    clearFields(); // 例外発生時もクリア
                    return false;
                }
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                onNodeCreated?.apply(this, arguments);
                const node = this;

                // --- Saveボタンの追加 ---
                node.addWidget("button", "Save", null, () => {
                    const ckptName = node.widgets.find(w => w.name === "ckpt_name")?.value;
                    
                    if (!ckptName) return;

                    // 確認ダイアログの表示 (lora_nameのみ表示)
                    if (confirm(`Are you sure to save:\n${ckptName.replace(/\.(safetensors|ckpt)$/i, ".json")}`)) {
                        saveCheckPointInfo(node);
                    }
                });

                // --- 保存処理の実行関数 ---
                const saveCheckPointInfo = async (node) => {
                    const getVal = (name) => node.widgets.find(w => w.name === name)?.value;

                    const payload = {
                        ckpt_name: getVal("ckpt_name"),
                        description: getVal("description"),
                        notes: getVal("notes"),
                        vae: getVal("vae")
                    };

                    try {
                        const response = await fetch("/gadget_nodes/save_ckpt_info", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload)
                        });

                        if (!response.ok) {
                            const err = await response.json();
                            alert(`Save failed: ${err.error}`);
                        }
                    } catch (e) {
                        console.error("Save Error:", e);
                        alert("Error: check console.");
                    }
                };

                // 各ウィジェットの参照を取得
                const getW = (name) => node.widgets.find(w => w.name === name);
                const wCheckPoint = getW("ckpt_name");

                // 1. 値の変更を監視 (Setterオーバーライドで外部入力にも対応)
                let val = wCheckPoint.value;
                Object.defineProperty(wCheckPoint, "value", {
                    set: (newVal) => {
                        if (val !== newVal) {
                            val = newVal;
                            refreshCheckPointData(node, newVal);
                        }
                    },
                    get: () => val,
                    configurable: true
                });

                // --- 【ここが重要】初期化処理 ---
                const init = async () => {
                    if (wCheckPoint.value) {
                        // APIから最新情報を取得
                        await refreshCheckPointData(node, wCheckPoint.value);
                        node.setDirtyCanvas(true);
                    }
                };
                // ノードがグラフに追加され、保存された値が流し込まれた直後を狙う
                setTimeout(init, 100);

                // ノードサイズの初期調整
                node.size = [350, 420];
            };

            // 3. プレビュー画像の描画 (出力端子の左側余白を活用)
            nodeType.prototype.onDrawForeground = function(ctx) {
                if (!this.flags.collapsed && this.lora_thumb) {
                    const img = this.lora_thumb;
                    
                    // 描画エリアの計算
                    const x = 5;
                    const y = 5; // タイトルバーやウィジェットを避けるための上部余白
                    const maxW = this.size[0] - 10; // ノード幅の45%程度を使用
                    const maxH = 75;
                    
                    let drawW = img.width;
                    let drawH = img.height;
                    const scale = Math.min(maxW / drawW, maxH / drawH);
                    drawW *= scale;
                    drawH *= scale;

                    // 背景と枠線（少しリッチに）
                    ctx.save();
                    ctx.fillStyle = "#000000AA";
                    ctx.strokeStyle = "#666666";
                    ctx.lineWidth = 1;
                    
                    ctx.beginPath();
                    ctx.roundRect(x - 2, y - 2, drawW + 4, drawH + 4, 4);
                    ctx.fill();
                    ctx.stroke();

                    // 画像の描画
                    ctx.drawImage(img, x, y, drawW, drawH);
                    ctx.restore();
                }
            };
        }
    }
});
app.registerExtension({
    name: "Gadget.PromptPalette",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "Prompt Palette") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            onNodeCreated?.apply(this, arguments);
            const node = this;

            // --- 最小サイズの設定 ---
            node.min_size = [700, 450];
            node.size = [750, 500];

            // --- CSSの注入 (ホバー・インデント・ハイライト用) ---
            if (!document.getElementById("prompt-palette-styles")) {
                const style = $el("style", { id: "prompt-palette-styles" });
                style.textContent = `
                    .pp-tree-item:hover { background-color: #333 !important; }
                    .pp-leaf { color: #ccc; cursor: pointer; transition: background 0.1s; border-radius: 2px; }
                    .pp-branch-summary { color: #fff; font-weight: bold; cursor: pointer; border-radius: 2px; outline: none; }
                    .pp-branch-summary::-webkit-details-marker { color: #666; }
                    .pp-mark { background-color: #660; color: #fff; font-weight: bold; padding: 0 1px; border-radius: 1px; }
                    .pp-search-container { position: relative; width: 100%; display: flex; align-items: center; }
                    .pp-clear-btn { 
                        position: absolute; right: 5px; cursor: pointer; color: #888; 
                        font-weight: bold; font-size: 14px; user-select: none;
                        padding: 2px 5px;
                    }
                    .pp-clear-btn:hover { color: #fff; }
                `;
                document.head.appendChild(style);
            }

            // --- 全体コンテナ (左右分割) ---
            const mainWrapper = $el("div", {
                style: {
                    display: "flex", flexDirection: "row", gap: "12px", width: "100%", height: "100%",
                    padding: "10px", boxSizing: "border-box", overflow: "hidden"
                }
            });

            // --- 左セクション (File, Search, Tree, Edit) - 比率小さめ ---
            const leftSection = $el("div", {
                style: { display: "flex", flexDirection: "column", flex: "4", gap: "8px", minWidth: "220px", overflow: "hidden" }
            });

            // 検索ボックス (×ボタン付き)
            const searchWrapper = $el("div", { className: "pp-search-container" });
            const searchInput = $el("input", {
                placeholder: "Search tags...",
                style: { backgroundColor: "#111", color: "white", border: "1px solid #444", padding: "6px 25px 6px 8px", width: "100%", borderRadius: "3px" }
            });
            const clearBtn = $el("span", { 
                className: "pp-clear-btn", textContent: "×",
                onclick: () => { searchInput.value = ""; triggerSearch(""); }
            });
            searchWrapper.append(searchInput, clearBtn);

            const treeContainer = $el("div", {
                style: {
                    backgroundColor: "#0a0a0a", border: "1px solid #333", flex: "1",
                    overflowY: "auto", fontSize: "12px", padding: "5px", borderRadius: "3px"
                }
            });

            const editBtn = $el("button", {
                textContent: "Edit YAML File",
                style: { cursor: "pointer", padding: "6px", backgroundColor: "#333", color: "#ddd", border: "1px solid #444", borderRadius: "3px" },
                onclick: () => {
                    const wFile = node.widgets.find(w => w.name === "file_name");
                    fetch("/gadget_nodes/open_editor", {
                        method: "POST", body: JSON.stringify({ file: wFile.value })
                    });
                }
            });

            leftSection.append(searchWrapper, treeContainer, editBtn);

            // --- 右セクション (Prompt Area) - 比率大きめ ---
            const rightSection = $el("div", {
                style: { display: "flex", flexDirection: "column", flex: "6", minWidth: "280px", overflow: "hidden" }
            });

            const promptArea = $el("textarea", {
                placeholder: "Selected prompt text...",
                style: {
                    backgroundColor: "#111", color: "#4f4", border: "1px solid #333",
                    flex: "1", padding: "12px", resize: "none", fontFamily: "monospace", fontSize: "12px", lineHeight: "1.5", borderRadius: "3px"
                }
            });

            rightSection.append(promptArea);
            mainWrapper.append(leftSection, rightSection);

            node.addDOMWidget("palette_ui", "ui", mainWrapper);

            // --- ツリー描画ロジック ---
            let rawData = {};
            const wFileName = node.widgets.find(w => w.name === "file_name");

            const renderTree = (data, term = "", forceExpand = false) => {
                treeContainer.innerHTML = "";
                const t = term.toLowerCase().trim();
                const regex = t ? new RegExp(`(${t.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')})`, 'gi') : null;

                const createBranch = (key, value, level = 0, parentHit = false) => {
                    const isLeaf = typeof value === "string";
                    const isSelfHit = t && key.toLowerCase().includes(t);
                    const shouldShowAll = parentHit || isSelfHit;

                    const indent = level * 14; // インデント幅の計算

                    if (isLeaf) {
                        const isValHit = t && value.toLowerCase().includes(t);
                        if (t && !shouldShowAll && !isValHit) return null;

                        const el = $el("div", {
                            className: "pp-tree-item pp-leaf",
                            style: { padding: `3px 5px 3px ${indent + 15}px`, color: (t && (isSelfHit || isValHit)) ? "#ff0" : "#ccc" },
                            onclick: () => { promptArea.value = value; }
                        });
                        
                        if (regex && (isSelfHit || isValHit)) {
                            el.innerHTML = key.replace(regex, '<mark class="pp-mark">$1</mark>');
                        } else {
                            el.textContent = key;
                        }
                        return el;
                    } else {
                        const details = $el("details", { open: !!t || forceExpand, style: { width: "100%" } });
                        const summary = $el("summary", {
                            className: "pp-tree-item pp-branch-summary",
                            style: { padding: `3px 5px 3px ${indent}px`, color: (t && isSelfHit) ? "#ff0" : "#fff" },
                            onclick: (e) => {
                                if (!details.open) {
                                    details.parentElement.querySelectorAll(":scope > details").forEach(d => { if(d !== details) d.open = false; });
                                }
                            }
                        });

                        if (regex && isSelfHit) {
                            summary.innerHTML = key.replace(regex, '<mark class="pp-mark">$1</mark>');
                        } else {
                            summary.textContent = key;
                        }
                        
                        details.appendChild(summary);
                        let hasChild = false;
                        for (const [k, v] of Object.entries(value)) {
                            const child = createBranch(k, v, level + 1, shouldShowAll);
                            if (child) { details.appendChild(child); hasChild = true; }
                        }
                        return (t === "" || shouldShowAll || hasChild) ? details : null;
                    }
                };

                Object.entries(data).forEach(([k, v]) => {
                    const b = createBranch(k, v, 0);
                    if (b) treeContainer.appendChild(b);
                });
            };

            const triggerSearch = (v) => renderTree(rawData, v);

            const loadData = async (isInitial = false) => {
                if (!wFileName.value) return;
                if (!isInitial) { searchInput.value = ""; promptArea.value = ""; }
                const resp = await fetch(`/gadget_nodes/get_prompts?file_name=${encodeURIComponent(wFileName.value)}`);
                rawData = await resp.json();
                renderTree(rawData, searchInput.value);
            };

            wFileName.callback = () => loadData(false);
            searchInput.oninput = (e) => triggerSearch(e.target.value);

            setTimeout(() => loadData(true), 150);
        };
    }
});
