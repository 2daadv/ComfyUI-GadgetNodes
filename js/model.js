import { app } from "/scripts/app.js";

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
                            const response = await fetch(`/gadget_nodes/model/get_ckpt_preset?ckpt_name=${encodeURIComponent(value)}`);
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
                        "sd_version": "SDXL",
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
                    const response = await fetch(`/gadget_nodes/model/get_lora_info?lora_name=${encodeURIComponent(loraName)}`);
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
                        const response = await fetch("/gadget_nodes/model/save_lora_info", {
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
                        "vae": "None"
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
                    const response = await fetch(`/gadget_nodes/model/get_ckpt_info?ckpt_name=${encodeURIComponent(ckptName)}`);
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
                        const response = await fetch("/gadget_nodes/model/save_ckpt_info", {
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