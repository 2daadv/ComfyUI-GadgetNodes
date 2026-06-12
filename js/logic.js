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
            const canvas = this.graph.canvas;
            if (!this._processedIds) this._processedIds = new Set();

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
                let baseNode = targets.reduce((prev, curr) => (curr.pos[1] < prev.pos[1] || (curr.pos[1] === prev.pos[1] && curr.pos[0] < prev.pos[0])) ? curr : prev);
                this.properties.vg_baseId = baseNode.id;
                this.properties.vg_states = {};

                targets.forEach((node, idx) => {
                    this._processedIds.add(node.id);
                    this.properties.vg_states[node.id] = {
                        relX: node.pos[0] - baseNode.pos[0],
                        relY: node.pos[1] - baseNode.pos[1],
                        size: [...node.size],
                        wasCollapsed: !!node.flags?.collapsed
                    };
                    
                    node.flags.collapsed = true;
                    node.size = [200, 30];
                    node.pos[0] = baseNode.pos[0] + (idx * 15);
                    node.pos[1] = baseNode.pos[1] + (idx * 15);
                });
            } else {
                let baseNode = this.graph.getNodeById(this.properties.vg_baseId);
                
                // 🌟 修正：基準ノード不在時の自己修復ロジック
                if (!baseNode) {
                    const existingStates = Object.entries(this.properties.vg_states).filter(([id]) => this.graph.getNodeById(Number(id)));
                    if (existingStates.length > 0) {
                        // 生き残っているノードの中で、記録されていた相対座標の合計値が最も小さい（左上）ものを特定
                        const nextBase = existingStates.reduce((prev, curr) => {
                            const [prevId, pState] = prev;
                            const [currId, cState] = curr;
                            return (cState.relY < pState.relY || (cState.relY === pState.relY && cState.relX < pState.relX)) ? curr : prev;
                        });
                        baseNode = this.graph.getNodeById(Number(nextBase[0]));
                    }
                }

                Object.entries(this.properties.vg_states).forEach(([id, state]) => {
                    const node = this.graph.getNodeById(Number(id));
                    if (!node) return;
                    
                    if (baseNode) {
                        // 基準ノードがある場合、オフセットを調整して再配置
                        const currentRelX = state.relX;
                        const currentRelY = state.relY;
                        
                        // 基準ノードが代わった場合、基準ノード自身の相対オフセットを0に補正する処理
                        const baseOffset = baseNode.id === Number(id) ? 0 : 0; 
                        
                        node.pos[0] = baseNode.pos[0] + (state.relX - (baseNode.id === Number(id) ? state.relX : 0));
                        node.pos[1] = baseNode.pos[1] + (state.relY - (baseNode.id === Number(id) ? state.relY : 0));
                    }
                    node.size = state.size;
                    node.flags.collapsed = state.wasCollapsed;
                });
                
                this.properties.vg_states = {};
                this._processedIds.clear();
            }
            this.graph.setDirtyCanvas(true, true);
        };
    }
});