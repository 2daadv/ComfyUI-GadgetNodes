import { app } from "/scripts/app.js";

const NODE_NAME = "Group Controler";
const HIDDEN_FLAG = "gadget_show_hide_hidden";

let drawPatchesInstalled = false;

function installDrawPatches() {
    if (drawPatchesInstalled) return;
    drawPatchesInstalled = true;

    // グループ自体の描画スキップ
    if (typeof LGraphGroup !== "undefined") {
        const origGroupDraw = LGraphGroup.prototype.draw;
        LGraphGroup.prototype.draw = function (canvas, ctx) {
            if (this.flags?.[HIDDEN_FLAG]) return;
            return origGroupDraw.apply(this, arguments);
        };
    }

    // ノードの描画スキップ
    if (typeof LGraphCanvas !== "undefined") {
        const origDrawNode = LGraphCanvas.prototype.drawNode;
        LGraphCanvas.prototype.drawNode = function (node, ctx) {
            if (node.flags?.[HIDDEN_FLAG]) return;
            return origDrawNode.apply(this, arguments);
        };
    }
}

function wildcardToRegex(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
}

function isGroupNameSpecified(name) {
    return typeof name === "string" && name.trim() !== "";
}

function getGraphGroups(graph) {
    return graph?._groups ?? graph?.groups ?? [];
}

function recomputeAllGroups(graph) {
    for (const group of getGraphGroups(graph)) {
        group.recomputeInsideNodes?.();
    }
}

function getGroupsByName(graph, pattern) {
    const regex = wildcardToRegex(pattern.trim());
    return getGraphGroups(graph).filter((group) => regex.test(group.title));
}

function getContainingGroups(graph, node) {
    recomputeAllGroups(graph);
    const containing = getGraphGroups(graph).filter((group) => group._children?.has(node));
    if (containing.length <= 1) return containing;

    return [
        containing.reduce((smallest, current) => {
            const smallestArea = smallest._size[0] * smallest._size[1];
            const currentArea = current._size[0] * current._size[1];
            return currentArea < smallestArea ? current : smallest;
        }),
    ];
}

function getMemberNodes(group, excludeNode) {
    group.recomputeInsideNodes?.();
    const nodes = [];
    for (const child of group._children ?? []) {
        if (typeof LGraphNode !== "undefined" && child instanceof LGraphNode && child !== excludeNode) {
            nodes.push(child);
        } else if (child !== excludeNode && child?.id != null && typeof child.inputs !== "undefined") {
            nodes.push(child);
        }
    }
    return nodes;
}

function updateNodeVisibility(node, hidden) {
    if (!node.flags) node.flags = {};

    if (hidden) {
        if (node.flags[HIDDEN_FLAG]) return;
        node.flags[HIDDEN_FLAG] = true;
        node.mouse_pass_through = true;

        // 【安全なアプローチ】
        // 元の状態をバックアップし、システム的にノードを「完全に沈黙」させるフラグを立てる
        node._orig_collapsed = !!node.flags.collapsed;
        node.flags.collapsed = true; // これによりLiteGraph内部のボタン判定がすべて消滅します
    } else {
        if (!node.flags[HIDDEN_FLAG]) return;
        delete node.flags[HIDDEN_FLAG];
        delete node.mouse_pass_through;

        // 元の状態に安全に復元
        if (typeof node._orig_collapsed !== "undefined") {
            node.flags.collapsed = node._orig_collapsed;
            delete node._orig_collapsed;
        } else {
            delete node.flags.collapsed;
        }
    }

    // HTML(DOM)要素の完全非表示
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

function applyShowHide(controlNode) {
    const graph = controlNode.graph ?? app.graph;
    if (!graph) return;

    const visibleWidget = controlNode.widgets?.find((w) => w.name === "visible");
    const groupNameWidget = controlNode.widgets?.find((w) => w.name === "group_name");
    const visible = visibleWidget?.value !== false;
    const groupName = groupNameWidget?.value ?? "";

    let targetGroups = [];
    if (isGroupNameSpecified(groupName)) {
        targetGroups = getGroupsByName(graph, groupName);
    } else {
        targetGroups = getContainingGroups(graph, controlNode);
    }

    const hidden = !visible;
    
    for (const group of targetGroups) {
        if (!group.flags) group.flags = {};
        group.flags[HIDDEN_FLAG] = hidden;

        for (const member of getMemberNodes(group, controlNode)) {
            updateNodeVisibility(member, hidden);
        }
    }

    if (app.canvas) {
        app.canvas.setDirty(true, true);
        app.canvas.draw(true, true);
    }
}

function scheduleApplyShowHide(controlNode) {
    setTimeout(() => applyShowHide(controlNode), 20);
}

function hookWidgetCallback(widget, controlNode) {
    if (!widget) return;
    const origCallback = widget.callback;
    widget.callback = function (...args) {
        const result = origCallback?.apply(this, args);
        scheduleApplyShowHide(controlNode);
        return result;
    };
}

function setupShowHideGroupNode(node) {
    hookWidgetCallback(node.widgets?.find((w) => w.name === "visible"), node);
    hookWidgetCallback(node.widgets?.find((w) => w.name === "group_name"), node);

    const origOnConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = origOnConfigure?.apply(this, args);
        scheduleApplyShowHide(node);
        return result;
    };

    scheduleApplyShowHide(node);
}

function applyAllShowHideGroupNodes() {
    const graph = app.graph;
    if (!graph?._nodes) return;
    for (const node of graph._nodes) {
        if (node.type === NODE_NAME) {
            scheduleApplyShowHide(node);
        }
    }
}

app.registerExtension({
    name: "Gadget.ShowHideGroup",
    async init() {
        installDrawPatches();
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            setupShowHideGroupNode(this);
            return result;
        };
    },
    async afterConfigureGraph() {
        installDrawPatches();
        setTimeout(() => applyAllShowHideGroupNodes(), 300);
    },
});