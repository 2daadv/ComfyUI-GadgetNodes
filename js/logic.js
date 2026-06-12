import { app } from "/scripts/app.js";

// ID文字列(1-3, 6, 9-13)を数値配列に変換
function parseIdRange(str) {
    const ids = new Set();
    str.split(",").forEach(part => {
        if (part.includes("-")) {
            const [start, end] = part.split("-").map(Number);
            for (let i = start; i <= end; i++) ids.add(i);
        } else {
            ids.add(Number(part));
        }
    });
    return Array.from(ids);
}

app.registerExtension({
    name: "Gadget.VirtualGroup",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Virtual Group") return;

        nodeType.prototype.onWidgetChanged = function (name, value) {
            if (name !== "expand") return;
            this._applyVirtualGroupLogic(value);
        };

        nodeType.prototype._applyVirtualGroupLogic = function (isExpanded) {
            if (!this.graph) return;

            const nodeIds = parseIdRange(this.widgets?.find(w => w.name === "node_ids")?.value || "");
            const nodeNames = this.widgets?.find(w => w.name === "node_names")?.value.split(",").map(s => s.trim()) || [];

            const targets = Array.from(new Set(this.graph._nodes.filter(n => {
                if (n.id === this.id || n.type === "Virtual Group") return false;
                const matchId = nodeIds.includes(n.id);
                const matchName = nodeNames.some(p => new RegExp("^" + p.replace(/\*/g, ".*") + "$").test(n.title));
                return matchId || matchName;
            })));

            if (targets.length === 0) return;

            if (!isExpanded) {
                // 保存：X座標（左側）を優先して基準ノードを決定
                let baseNode = targets.reduce((prev, curr) =>
                    (curr.pos[0] < prev.pos[0] || (curr.pos[0] === prev.pos[0] && curr.pos[1] < prev.pos[1]))
                    ? curr : prev
                );
                this.properties.vg_baseId = baseNode.id;
                this.properties.vg_states = {};

                targets.forEach((node) => {
                    this.properties.vg_states[node.id] = {
                        absX: node.pos[0],
                        absY: node.pos[1],
                        width: node.size[0],
                        height: node.size[1],
                        wasCollapsed: !!node.flags?.collapsed
                    };

                    node.flags.collapsed = true;
                    node.size = [200, 30];
                    node.pos[0] = baseNode.pos[0];
                    node.pos[1] = baseNode.pos[1];
                });
            } else {
                // 復元：基準ノードの移動量を反映
                let baseNode = this.graph.getNodeById(this.properties.vg_baseId);
                const oldBase = this.properties.vg_states[this.properties.vg_baseId];

                // 基準が見つからない場合、X優先の左上流ノードを再選出
                if (!baseNode) {
                    const candidates = Object.entries(this.properties.vg_states).filter(([id]) => this.graph.getNodeById(Number(id)));
                    if (candidates.length > 0) {
                        baseNode = candidates.map(c => this.graph.getNodeById(Number(c[0])))
                            .reduce((prev, curr) => (curr.pos[0] < prev.pos[0] || (curr.pos[0] === prev.pos[0] && curr.pos[1] < prev.pos[1])) ? curr : prev);
                    }
                }

                const deltaX = baseNode && oldBase ? baseNode.pos[0] - oldBase.absX : 0;
                const deltaY = baseNode && oldBase ? baseNode.pos[1] - oldBase.absY : 0;

                Object.entries(this.properties.vg_states).forEach(([id, state]) => {
                    const node = this.graph.getNodeById(Number(id));
                    if (!node) return;

                    node.pos[0] = state.absX + deltaX;
                    node.pos[1] = state.absY + deltaY;
                    node.size = [state.width, state.height];
                    node.flags.collapsed = state.wasCollapsed;
                });

                this.properties.vg_states = {};
            }
            this.graph.setDirtyCanvas(true, true);
        };
    }
});
