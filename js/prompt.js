import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";

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
                    fetch("/gadget_nodes/prompt/open_editor", {
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
                const resp = await fetch(`/gadget_nodes/prompt/get_prompts?file_name=${encodeURIComponent(wFileName.value)}`);
                rawData = await resp.json();
                renderTree(rawData, searchInput.value);
            };

            wFileName.callback = () => loadData(false);
            searchInput.oninput = (e) => triggerSearch(e.target.value);

            setTimeout(() => loadData(true), 150);
        };
    }
});
