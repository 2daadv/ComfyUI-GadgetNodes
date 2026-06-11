import { app } from "/scripts/app.js";

const NODE_NAME = "Group Controler";
const HIDDEN_FLAG = "gadget_show_hide_hidden";

// バックアップデータのキー定義
const GROUP_BACKUP_KEY = "gadget_group_controller_backup_data";

let drawPatchesInstalled = false;

function installDrawPatches() {
    if (drawPatchesInstalled) return;
    drawPatchesInstalled = true;

    // グループ自体の描画スキップ (visible=False の場合)
    if (typeof LGraphGroup !== "undefined") {
        const origGroupDraw = LGraphGroup.prototype.draw;
        LGraphGroup.prototype.draw = function (canvas, ctx) {
            if (this.flags?.[HIDDEN_FLAG]) return;
            return origGroupDraw.apply(this, arguments);
        };
    }

    // ノードの描画スキップ (visible=False の場合)
    if (typeof LGraphCanvas !== "undefined") {
        const origDrawNode = LGraphCanvas.prototype.drawNode;
        LGraphCanvas.prototype.drawNode = function (node, ctx) {
            if (node.flags?.[HIDDEN_FLAG]) return;
            return origDrawNode.apply(this, arguments);
        };
    }
}

function wildcardToRegex(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\\]\\\\]/g, "\\\\$&").replace(/\\*/g, ".*");
    return new RegExp(`^${escaped}$`);
}

function isGroupNameSpecified(name) {
    return typeof name === "string" && name.trim() !== "";
}

function getGraphGroups(graph) {
    return graph?._groups ?? graph?.groups ?? [];
}

function getGroupsByName(graph, pattern) {
    const regex = wildcardToRegex(pattern.trim());
    return getGraphGroups(graph).filter((group) => regex.test(group.title));
}

// 物理的な座標からグループ内のノードを100%確実に初期検出する関数
function getNodesInGroupBoundingBox(graph, group, excludeNode) {
    if (!graph?._nodes) return [];
    
    const groupMinX = group._pos[0];
    const groupMinY = group._pos[1];
    const groupMaxX = groupMinX + group._size[0];
    const groupMaxY = groupMinY + group._size[1];

    return graph._nodes.filter(node => {
        if (node === excludeNode) return false;
        
        const nodeX = node.pos[0];
        const nodeY = node.pos[1];
        
        return nodeX >= groupMinX && nodeX <= groupMaxX &&
               nodeY >= groupMinY && nodeY <= groupMaxY;
    });
}

// 対象ノードの可視状態・DOMの制御
function updateNodeDOMVisibility(node, hidden) {
    const selectors = [`[data-node-id="${node.id}"]`, `.comfy-node[id="${node.id}"]`, `#node-${node.id}`];
    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
            el.style.display = hidden ? "none" : "";
            el.style.visibility = hidden ? "hidden" : "";
            el.style.pointerEvents = hidden ? "none" : "";
        }
    }
}

function applyGroupControl(controlNode) {
    const graph = controlNode.graph ?? app.graph;
    if (!graph) return;

    const visibleWidget = controlNode.widgets?.find((w) => w.name === "visible");
    const expandWidget = controlNode.widgets?.find((w) => w.name === "expand");
    const groupNameWidget = controlNode.widgets?.find((w) => w.name === "group_name");

    // UIクリック時の最新の値を直接取得
    const visible = visibleWidget ? visibleWidget.value !== false : true;
    const expand = expandWidget ? expandWidget.value !== false : true;
    const groupName = groupNameWidget ? groupNameWidget.value ?? "" : "";

    if (!isGroupNameSpecified(groupName)) {
        return;
    }

    const targetGroups = getGroupsByName(graph, groupName);
    const hidden = !visible;
    const shouldCollapse = !expand || hidden; 

    for (const group of targetGroups) {
        if (!group.flags) group.flags = {};
        
        // グループ全体の表示・非表示フラグの同期
        group.flags[HIDDEN_FLAG] = hidden;

        if (shouldCollapse) {
            // =========================================================
            // --- collapse 処理 (左上移動・collapse化・外接リサイズ) ---
            // =========================================================
            
            // 初回イベント時（まだ畳まれていない状態）に、所属メンバーとその時の「相対座標」をロックして完全に記憶させる
            if (!group[GROUP_BACKUP_KEY]) {
                const currentMembers = getNodesInGroupBoundingBox(graph, group, controlNode);
                
                const nodeBackups = currentMembers.map(node => {
                    return {
                        id: node.id,
                        relX: node.pos[0] - group._pos[0], // グループの左上からの相対X
                        relY: node.pos[1] - group._pos[1], // グループの左上からの相対Y
                        collapsed: !!node.flags?.collapsed
                    };
                });

                group[GROUP_BACKUP_KEY] = {
                    size: [...group._size], // 元のグループの大きさ
                    nodes: nodeBackups
                };
            }

            // 記憶したバックアップデータを元にグラフ全体から対象ノードを強制スキャン
            const savedNodesData = group[GROUP_BACKUP_KEY].nodes;
            const savedIds = savedNodesData.map(n => n.id);
            const memberNodes = graph._nodes.filter(n => savedIds.includes(n.id));

            let maxMemberWidth = 140;

            for (const node of memberNodes) {
                if (!node.flags) node.flags = {};

                node.flags[HIDDEN_FLAG] = hidden;
                node.mouse_pass_through = hidden;
                node.flags.collapsed = true; // 仕様: 一律collapseにする

                // 仕様: グループ内の左上端に移動（タイトル名が完全に隠れないようにY+85のマージン）
                node.pos[0] = group._pos[0] + 20;
                node.pos[1] = group._pos[1] + 85; 

                // collapse時のサイズを安全に計測
                const w = node.computeSize ? node.computeSize()[0] : (node.size ? Math.min(node.size[0], 140) : 140);
                if (w > maxMemberWidth) maxMemberWidth = w;

                updateNodeDOMVisibility(node, hidden);
            }

            // 仕様: グループのサイズが全ての対象ノードのcollapseサイズに外接するようリサイズ
            group._size[0] = Math.max(maxMemberWidth + 40, 220); 
            group._size[1] = 145; // マージン85px + ノード高さ30px + 余白が綺麗に収まる高さ

        } else {
            // ==========================================
            // --- expand 処理 (元の状態・座標へ復元) ---
            // ==========================================
            
            if (!group[GROUP_BACKUP_KEY]) continue;

            const backupData = group[GROUP_BACKUP_KEY];
            
            // 1. 先にグループのサイズ（枠）を元の大きさに完全復元
            group._size = [...backupData.size];

            // 2. バックアップデータを元にノードの位置と状態を復元
            const savedNodesData = backupData.nodes;
            const savedIds = savedNodesData.map(n => n.id);
            const memberNodes = graph._nodes.filter(n => savedIds.includes(n.id));

            for (const node of memberNodes) {
                if (!node.flags) node.flags = {};

                // 非表示フラグ等の解除
                delete node.flags[HIDDEN_FLAG];
                delete node.mouse_pass_through;

                const nodeBackup = savedNodesData.find(n => n.id === node.id);
                if (nodeBackup) {
                    // 仕様: 現在のグループ位置を基準に、元の相対座標から絶対座標を復元
                    // (これで、expand=False中にグループ自体を動かしても配置が絶対に壊れません)
                    node.pos[0] = group._pos[0] + nodeBackup.relX;
                    node.pos[1] = group._pos[1] + nodeBackup.relY;
                    
                    // 仕様: 元からcollapseだった場合はcollapseのまま位置だけ戻す
                    node.flags.collapsed = nodeBackup.collapsed;
                } else {
                    node.flags.collapsed = false;
                }

                updateNodeDOMVisibility(node, false);
            }

            // 展開が完了したため、グループ側のバックアップを削除（ガード解除）
            delete group[GROUP_BACKUP_KEY];
        }

        // 変更をLiteGraphの親子関係システムに強制同期
        group.recomputeInsideNodes?.();
    }

    if (app.canvas) {
        app.canvas.setDirty(true, true);
        app.canvas.draw(true, true);
    }
}

function scheduleApplyGroupControl(controlNode) {
    // 完全にUIイベントが終了した直後のサイクルで走らせるために50msの安全マージンを適用
    setTimeout(() => applyGroupControl(controlNode), 50);
}

function hookWidgetCallback(widget, controlNode) {
    if (!widget) return;
    const origCallback = widget.callback;
    widget.callback = function (...args) {
        const result = origCallback?.apply(this, args);
        scheduleApplyGroupControl(controlNode);
        return result;
    };
}

function setupGroupControllerNode(node) {
    hookWidgetCallback(node.widgets?.find((w) => w.name === "visible"), node);
    hookWidgetCallback(node.widgets?.find((w) => w.name === "expand"), node);
    hookWidgetCallback(node.widgets?.find((w) => w.name === "group_name"), node);

    const origOnConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = origOnConfigure?.apply(this, args);
        scheduleApplyGroupControl(node);
        return result;
    };

    scheduleApplyGroupControl(node);
}

function applyAllGroupControllerNodes() {
    const graph = app.graph;
    if (!graph?._nodes) return;
    for (const node of graph._nodes) {
        if (node.type === NODE_NAME) {
            scheduleApplyGroupControl(node);
        }
    }
}

app.registerExtension({
    name: "Gadget.GroupController",
    async init() {
        installDrawPatches();
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            setupGroupControllerNode(this);
            return result;
        };
    },
    async afterConfigureGraph() {
        installDrawPatches();
        setTimeout(() => applyAllGroupControllerNodes(), 300);
    },
});