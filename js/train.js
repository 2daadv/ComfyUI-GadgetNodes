import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

/** @param {AbortSignal[]} signals */
function mergeAbortSignals(signals) {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
        return AbortSignal.any(signals);
    }
    const c = new AbortController();
    const stop = () => c.abort();
    for (const s of signals) {
        if (s.aborted) {
            stop();
            break;
        }
        s.addEventListener("abort", stop, { once: true });
    }
    return c.signal;
}

const TrainApi = {
    getImages(folder) {
        return api.fetchApi(`/gadget_nodes/train/get_images?folder=${encodeURIComponent(folder)}`).then((r) => r.json());
    },
    getData(folder, filename) {
        return api.fetchApi(
            `/gadget_nodes/train/get_data?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`
        ).then((r) => r.json());
    },
    saveTags(folder, filename, tags) {
        return api.fetchApi("/gadget_nodes/train/save_tags", {
            method: "POST",
            body: JSON.stringify({ folder, filename, tags }),
        });
    },
};

function createTagElement(text) {
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
    el.draggable = false;
    return el;
}

class TagTrainModel {
    constructor() {
        this.keep = [];
        this.remove = [];
        /** @type {HTMLElement | null} 直近でクリックしたタグ列（フォーカスが本体に取られる場合の Ctrl+C 用） */
        this.lastInteractedListEl = null;
        /** @type {HTMLElement[]} keep / remove のリスト要素（どちらにフォーカスがあるか判定用） */
        this.tagListEls = [];
        /** @type {TagListView[]} */
        this.tagListViews = [];
        /** @type {{ sourceView: TagListView, items: HTMLElement[], crossListMoved: boolean } | null} */
        this.dragSession = null;
    }

    /** @param {HTMLElement} el */
    registerTagListEl(el) {
        if (!this.tagListEls.includes(el)) this.tagListEls.push(el);
    }

    /** @param {TagListView} view */
    registerTagListView(view) {
        if (!this.tagListViews.includes(view)) this.tagListViews.push(view);
    }

    /** @param {string[]} tags @param {string[]} blacklist */
    loadFromServer(tags, blacklist) {
        this.keep = [];
        this.remove = [];
        const bl = new Set(blacklist);
        for (const t of tags) {
            if (bl.has(t)) this.remove.push(t);
            else this.keep.push(t);
        }
        this._dedupeAndDisjoint();
    }

    toSaveString() {
        return this.keep.join(",");
    }

    /** @param {"keep"|"remove"} columnKey @param {string[]} tags */
    insertTagsAt(columnKey, tags, index) {
        const target = columnKey === "keep" ? this.keep : this.remove;
        const other = columnKey === "keep" ? this.remove : this.keep;
        const toInsert = [];
        for (const raw of tags) {
            const tag = (raw || "").trim();
            if (!tag) continue;
            const otherIdx = other.indexOf(tag);
            if (otherIdx >= 0) other.splice(otherIdx, 1);
            if (!target.includes(tag)) toInsert.push(tag);
        }
        if (index < 0 || index >= target.length) {
            target.push(...toInsert);
        } else {
            target.splice(index, 0, ...toInsert);
        }
        this._dedupeAndDisjoint();
    }

    /** @param {"keep"|"remove"} columnKey @param {string[]} tags */
    moveTagsTo(columnKey, tags) {
        this.insertTagsAt(columnKey, tags, -1);
    }

    /** @param {"keep"|"remove"} columnKey @param {string[]} orderedTags */
    setColumnFromOrdered(columnKey, orderedTags) {
        const unique = [];
        const seen = new Set();
        for (const raw of orderedTags) {
            const tag = (raw || "").trim();
            if (!tag || seen.has(tag)) continue;
            seen.add(tag);
            unique.push(tag);
        }
        if (columnKey === "keep") {
            this.keep = unique;
            this.remove = this.remove.filter((t) => !seen.has(t));
        } else {
            this.remove = unique;
            this.keep = this.keep.filter((t) => !seen.has(t));
        }
        this._dedupeAndDisjoint();
    }

    _dedupeAndDisjoint() {
        const uniq = (arr) => {
            const out = [];
            const s = new Set();
            for (const raw of arr) {
                const t = (raw || "").trim();
                if (!t || s.has(t)) continue;
                s.add(t);
                out.push(t);
            }
            return out;
        };
        this.keep = uniq(this.keep);
        this.remove = uniq(this.remove).filter((t) => !this.keep.includes(t));
    }
}

class TagListView {
    /**
     * @param {{ title: string, columnKey: "keep"|"remove", enableReorder: boolean, model: TagTrainModel, signal: AbortSignal, allowCrossListMove?: boolean }} opts
     */
    constructor(opts) {
        this.model = opts.model;
        this.columnKey = opts.columnKey;
        this.enableReorder = opts.enableReorder;
        this.allowCrossListMove = opts.allowCrossListMove !== false;
        this.nodeSignal = opts.signal;
        this.onChanged = opts.onChanged; // 変更通知コールバック

        this.draggedItems = null;
        /** @type {Element | null} insertBefore の第2引数（null は末尾） */
        this.dropTargetRef = null;

        this.isSelecting = false;
        this.dragStartIndex = -1;
        this.lastSelectedIndex = -1;

        this.box = document.createElement("div");
        this.box.className = "train-column-box";

        const titleEl = document.createElement("div");
        titleEl.className = "train-column-title";
        titleEl.textContent = opts.title;
        this.box.appendChild(titleEl);

        this.listEl = document.createElement("div");
        this.listEl.className = "train-list train-list-focusable";

        this.indicator = document.createElement("div");
        this.indicator.className = "drop-indicator";
        this.listEl.appendChild(this.indicator);

        this.box.appendChild(this.listEl);

        this.listEl.tabIndex = 0;

        this.model.registerTagListEl(this.listEl);
        this.model.registerTagListView(this);

        this._bindEvents();
    }

    getTagItems() {
        return Array.from(this.listEl.querySelectorAll(":scope > .train-tag-item"));
    }

    getSelectedTagTexts() {
        return this.getTagItems().filter((el) => el.classList.contains("selected")).map((el) => el.text);
    }

    getOrderedTagTexts() {
        return this.getTagItems().map((el) => el.text);
    }

    /** @param {{ preserveSelection?: boolean }} [options] */
    render(options = {}) {
        const preserve = options.preserveSelection !== false;
        const sel = preserve ? new Set(this.getSelectedTagTexts()) : new Set();
        this.getTagItems().forEach((el) => el.remove());
        for (const text of this.model[this.columnKey]) {
            const el = createTagElement(text);
            if (sel.has(text)) el.classList.add("selected");
            this.listEl.appendChild(el);
        }
    }

    syncFromDom() {
        this.model.setColumnFromOrdered(this.columnKey, this.getOrderedTagTexts());
        this.onChanged?.(); // 並び替え等の同期後に通知
    }

    _renderAllViews(preserveCurrentSelection = true) {
        this.model.tagListViews.forEach((view) => {
            view.render(view === this ? preserveCurrentSelection : false);
        });
    }

    async _pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            this._pasteText(text);
        } catch (err) {
            console.error("[Gadget.TrainTagsEdit] paste failed:", err);
        }
    }

    /** @param {string} text */
    _pasteText(text) {
        if (!text) return;
        const tags = text
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t);
        if (tags.length === 0) return;
        const indices = this.getTagItems().map((el, i) => (el.classList.contains("selected") ? i : -1)).filter((i) => i >= 0);
        let index = -1;
        if (indices.length > 0) {
            index = Math.max(...indices) + 1;
        }
        this.model.insertTagsAt(this.columnKey, tags, index);
        this._renderAllViews(true);
        this.onChanged?.();
    }

    _copySelectedText() {
        const selected = this.listEl.querySelectorAll(".train-tag-item.selected");
        if (selected.length === 0) return "";
        return Array.from(selected)
            .map((item) => item.text)
            .join(",");
    }

    applyMoveUpOnDom() {
        const selected = this.getTagItems().filter((el) => el.classList.contains("selected"));
        selected.forEach((o) => {
            if (o.previousElementSibling && o.previousElementSibling.classList.contains("train-tag-item")) {
                this.listEl.insertBefore(o, o.previousElementSibling);
            }
        });
    }

    applyMoveDownOnDom() {
        const selected = this.getTagItems().filter((el) => el.classList.contains("selected")).reverse();
        selected.forEach((o) => {
            const next = o.nextElementSibling;
            if (next && next.classList.contains("train-tag-item")) {
                this.listEl.insertBefore(o, next.nextElementSibling);
            }
        });
    }

    /** @param {KeyboardEvent} e */
    _shouldHandleKeyboardShortcuts(e) {
        const t = e.target;
        if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
            return false;
        }
        if (t && typeof t === "object" && "isContentEditable" in t && /** @type {HTMLElement} */ (t).isContentEditable) {
            return false;
        }
        const { listEl } = this;
        const otherListFocused = this.model.tagListEls.some(
            (el) => el !== listEl && el.matches(":focus-within")
        );
        if (otherListFocused) return false;
        const focusedHere = listEl.matches(":focus-within");
        const lastHere = this.model.lastInteractedListEl === listEl;
        return focusedHere || lastHere;
    }

    /** @param {number} delta -1 or +1 */
    _moveSelectionArrow(delta) {
        const items = this.getTagItems();
        if (items.length === 0) return;

        const selectedIndices = items
            .map((el, i) => (el.classList.contains("selected") ? i : -1))
            .filter((i) => i >= 0);
        const lo = selectedIndices.length ? Math.min(...selectedIndices) : -1;
        const hi = selectedIndices.length ? Math.max(...selectedIndices) : -1;

        let idx;
        if (delta < 0) {
            const base = lo >= 0 ? lo : (this.lastSelectedIndex >= 0 ? this.lastSelectedIndex : 0);
            idx = Math.max(0, base - 1);
        } else {
            const base = hi >= 0 ? hi : (this.lastSelectedIndex >= 0 ? this.lastSelectedIndex : 0);
            idx = Math.min(items.length - 1, base + 1);
        }

        items.forEach((el) => el.classList.remove("selected"));
        items[idx].classList.add("selected");
        this.lastSelectedIndex = idx;
        items[idx].scrollIntoView({ block: "nearest" });
    }

    /**
     * Ctrl+↑: 選択行の上端の上を追加選択
     * Ctrl+↓: 選択行の下端の下を追加選択
     * @param {number} delta -1 (Up) or +1 (Down)
     */
    _adjustRangeCtrlArrow(delta) {
        const items = this.getTagItems();
        const n = items.length;
        if (n === 0) return;

        const indices = items.map((el, i) => (el.classList.contains("selected") ? i : -1)).filter((i) => i >= 0);
        let lo;
        let hi;
        if (indices.length === 0) {
            const seed = Math.max(0, Math.min(this.lastSelectedIndex >= 0 ? this.lastSelectedIndex : 0, n - 1));
            lo = hi = seed;
        } else {
            lo = Math.min(...indices);
            hi = Math.max(...indices);
        }

        if (delta < 0) {
            const idx = lo > 0 ? lo - 1 : 0;
            items[idx].classList.add("selected");
            this.lastSelectedIndex = idx;
            items[idx].scrollIntoView({ block: "nearest" });
            return;
        }
        const idx = hi < n - 1 ? hi + 1 : n - 1;
        items[idx].classList.add("selected");
        this.lastSelectedIndex = idx;
        items[idx].scrollIntoView({ block: "nearest" });
    }

    /** @param {KeyboardEvent} e */
    _onDocumentKeydownCapture(e) {
        if (!this._shouldHandleKeyboardShortcuts(e)) return;

        const items = this.getTagItems();
        if (items.length === 0) return;

        const key = e.key;
        const lower = key.length === 1 ? key.toLowerCase() : key;
        const ctrl = e.ctrlKey || e.metaKey;

        if (ctrl && lower === "c") {
            const textToCopy = this._copySelectedText();
            if (!textToCopy) return;
            void navigator.clipboard.writeText(textToCopy);
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            return;
        }

        if (ctrl && lower === "v") {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            void this._pasteFromClipboard();
            return;
        }

        if (ctrl && lower === "a") {
            items.forEach((el) => el.classList.add("selected"));
            this.lastSelectedIndex = items.length - 1;
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            return;
        }

        if (ctrl && lower === "i") {
            items.forEach((el) => el.classList.toggle("selected"));
            const selIdx = items.map((el, i) => (el.classList.contains("selected") ? i : -1)).filter((i) => i >= 0);
            this.lastSelectedIndex = selIdx.length ? Math.max(...selIdx) : -1;
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            return;
        }

        if (!ctrl && !e.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            this._moveSelectionArrow(key === "ArrowUp" ? -1 : 1);
            return;
        }

        if (ctrl && !e.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            this._adjustRangeCtrlArrow(key === "ArrowUp" ? -1 : 1);
            return;
        }
    }

    _bindEvents() {
        const { listEl, nodeSignal, enableReorder } = this;

        listEl.addEventListener("pointerdown", (e) => this._onPointerDown(e), { signal: nodeSignal });

        document.addEventListener("keydown", (e) => this._onDocumentKeydownCapture(e), { capture: true, signal: nodeSignal });

        listEl.addEventListener(
            "copy",
            (e) => {
                const textToCopy = this._copySelectedText();
                if (!textToCopy) return;
                if (e.clipboardData) e.clipboardData.setData("text/plain", textToCopy);
                e.preventDefault();
                e.stopImmediatePropagation();
                e.stopPropagation();
            },
            { signal: nodeSignal }
        );

        listEl.addEventListener(
            "paste",
            (e) => {
                const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
                if (text) this._pasteText(text);
                else void this._pasteFromClipboard();
                e.preventDefault();
                e.stopImmediatePropagation();
                e.stopPropagation();
            },
            { signal: nodeSignal }
        );

        document.addEventListener(
            "pointerup",
            () => {
                this.isSelecting = false;
                this.dragStartIndex = -1;
                this.getTagItems().forEach((c) => {
                    c.draggable = false;
                });
            },
            { capture: true, signal: nodeSignal }
        );

        if (enableReorder || this.allowCrossListMove) {
            listEl.addEventListener("dragstart", (e) => this._onDragStart(e), { signal: nodeSignal });
            listEl.addEventListener("dragend", (e) => this._onDragEnd(e), { signal: nodeSignal });
        }
        listEl.addEventListener("dragover", (e) => this._onDragOver(e), { signal: nodeSignal });
        listEl.addEventListener("dragleave", (e) => this._onDragLeave(e), { signal: nodeSignal });
        listEl.addEventListener("drop", (e) => this._onDrop(e), { signal: nodeSignal });
    }

    /** @param {PointerEvent} e */
    _onPointerDown(e) {
        if (e.button !== 0) return;
        const target = e.target.closest(".train-tag-item");
        if (!target || !this.listEl.contains(target)) return;

        try {
            this.listEl.focus({ preventScroll: true });
        } catch (_) {
            /* ignore */
        }
        this.model.lastInteractedListEl = this.listEl;

        const items = this.getTagItems();
        const currentIndex = items.indexOf(target);
        if (currentIndex < 0) return;

        const isHandle = e.target.classList.contains("drag-handle");
        if (isHandle && (this.enableReorder || this.allowCrossListMove)) {
            if (!target.classList.contains("selected")) {
                items.forEach((c) => c.classList.remove("selected"));
                target.classList.add("selected");
            }
            target.draggable = true;
            // ハンドルでは preventDefault しない（HTML5 DnD のドラッグ開始が止まるため）
            return;
        }

        if (e.shiftKey && this.lastSelectedIndex !== -1) {
            const start = Math.min(this.lastSelectedIndex, currentIndex);
            const end = Math.max(this.lastSelectedIndex, currentIndex);
            items.forEach((item, index) => {
                if (index >= start && index <= end) item.classList.add("selected");
            });
            this.lastSelectedIndex = currentIndex;
            e.preventDefault();
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            target.classList.toggle("selected");
            this.lastSelectedIndex = currentIndex;
            return;
        }

        items.forEach((c) => c.classList.remove("selected"));
        target.classList.add("selected");
        this.isSelecting = true;
        this.dragStartIndex = currentIndex;
        this.lastSelectedIndex = currentIndex;
        e.preventDefault();

        const moveAbort = new AbortController();
        const moveSignal = mergeAbortSignals([this.nodeSignal, moveAbort.signal]);

        const onMove = (ev) => {
            if (!(ev.buttons & 1)) return;
            if (!this.isSelecting || this.dragStartIndex < 0) return;
            const elAt = document.elementFromPoint(ev.clientX, ev.clientY);
            const t = elAt && elAt.closest && elAt.closest(".train-tag-item");
            if (!t || !this.listEl.contains(t)) return;
            const tagItems = this.getTagItems();
            const cur = tagItems.indexOf(t);
            if (cur < 0) return;
            const start = Math.min(this.dragStartIndex, cur);
            const end = Math.max(this.dragStartIndex, cur);
            tagItems.forEach((item, index) => {
                if (index >= start && index <= end) item.classList.add("selected");
                else if (!ev.ctrlKey && !ev.metaKey) item.classList.remove("selected");
            });
        };

        document.addEventListener("pointermove", onMove, { signal: moveSignal });
        document.addEventListener(
            "pointerup",
            () => {
                moveAbort.abort();
            },
            { once: true, signal: this.nodeSignal }
        );
        document.addEventListener(
            "pointercancel",
            () => {
                moveAbort.abort();
            },
            { once: true, signal: this.nodeSignal }
        );
    }

    /** @param {DragEvent} e */
    _onDragStart(e) {
        const item = e.target.closest(".train-tag-item");
        if (!item || !item.draggable) {
            e.preventDefault();
            return;
        }
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            try {
                e.dataTransfer.setData("text/plain", item.text || "");
            } catch (_) {
                /* ignore */
            }
        }
        this.dropTargetRef = null;
        this.draggedItems = this.getTagItems().filter((i) => i.classList.contains("selected"));
        this.draggedItems.forEach((i) => i.classList.add("dragging"));
        this.model.dragSession = {
            sourceView: this,
            items: this.draggedItems,
            crossListMoved: false,
        };
    }

    /** @param {DragEvent} e */
    _onDragOver(e) {
        e.preventDefault();
        const session = this.model.dragSession;
        if (!session || session.items.length === 0) return;
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

        const targetItem = e.target.closest(".train-tag-item");
        this.indicator.style.display = "block";

        if (targetItem) {
            const rect = targetItem.getBoundingClientRect();
            const isAfter = e.clientY > rect.top + rect.height / 2;
            this.dropTargetRef = isAfter ? targetItem.nextElementSibling : targetItem;
            const lineY = isAfter ? targetItem.offsetTop + targetItem.offsetHeight : targetItem.offsetTop;
            this.indicator.style.top = `${lineY}px`;
        } else {
            const tagItems = this.getTagItems();
            const lastItem = tagItems.length > 0 ? tagItems[tagItems.length - 1] : null;
            if (lastItem) {
                this.dropTargetRef = null;
                this.indicator.style.top = `${lastItem.offsetTop + lastItem.offsetHeight}px`;
            } else {
                this.indicator.style.top = "0px";
            }
        }
    }

    /** @param {DragEvent} e */
    _onDragLeave(e) {
        if (!this.listEl.contains(e.relatedTarget)) {
            this.indicator.style.display = "none";
        }
    }

    /** @param {DragEvent} e */
    _onDrop(e) {
        e.preventDefault();
        const session = this.model.dragSession;
        if (!session || session.items.length === 0) return;

        this.indicator.style.display = "none";

        if (session.sourceView === this) return;

        const itemsToMove = session.items;
        if (itemsToMove.includes(this.dropTargetRef)) return;
        itemsToMove.forEach((item) => {
            this.listEl.insertBefore(item, this.dropTargetRef);
        });

        session.sourceView.syncFromDom();
        this.syncFromDom();
        session.crossListMoved = true;
    }

    /** @param {DragEvent} e */
    _onDragEnd(e) {
        this.indicator.style.display = "none";

        const session = this.model.dragSession;
        if (!session) return;

        if (session.sourceView === this && !session.crossListMoved) {
            const itemsToMove = session.items;
            if (itemsToMove.length > 0 && !itemsToMove.includes(this.dropTargetRef)) {
                itemsToMove.forEach((item) => {
                    this.listEl.insertBefore(item, this.dropTargetRef);
                });
            }
            this.syncFromDom();
        }

        session.items.forEach((item) => {
            item.classList.remove("dragging");
            item.draggable = false;
        });
        this.model.tagListViews.forEach((view) => {
            view.indicator.style.display = "none";
            view.dropTargetRef = null;
            view.draggedItems = null;
        });
        this.model.dragSession = null;
    }
}

/**
 * @param {{ img?: string, mask?: string }} currentData
 * @param {AbortSignal} parentSignal
 */
function openTrainImagePopup(currentData, parentSignal) {
    if (!currentData || !currentData.img) return;

    const local = new AbortController();
    const popupSignal = mergeAbortSignals([parentSignal, local.signal]);

    const overlay = document.createElement("div");
    overlay.className = "train-popup-overlay";

    const content = document.createElement("div");
    content.className = "train-popup-content";

    const activeImg = document.createElement("img");
    activeImg.src = currentData.img;
    activeImg.className = "train-popup-img";

    let maskImg = null;
    const syncMaskSize = () => {
        if (maskImg && activeImg.complete) {
            maskImg.style.width = `${activeImg.clientWidth}px`;
            maskImg.style.height = `${activeImg.clientHeight}px`;
        }
    };

    if (currentData.mask) {
        maskImg = document.createElement("img");
        maskImg.src = currentData.mask;
        maskImg.className = "train-popup-mask";
        content.appendChild(maskImg);
    }

    content.appendChild(activeImg);
    overlay.appendChild(content);
    document.body.appendChild(overlay);

    window.addEventListener("resize", syncMaskSize, { signal: popupSignal });

    const close = () => {
        local.abort();
        overlay.classList.remove("show");
        setTimeout(() => overlay.remove(), 200);
    };

    parentSignal.addEventListener(
        "abort",
        () => {
            if (overlay.parentNode) {
                local.abort();
                overlay.classList.remove("show");
                setTimeout(() => overlay.remove(), 200);
            }
        },
        { once: true }
    );

    activeImg.onload = () => {
        syncMaskSize();
        overlay.classList.add("show");
    };

    if (activeImg.complete) {
        syncMaskSize();
        overlay.classList.add("show");
    }

    activeImg.onclick = (e) => {
        e.stopPropagation();
        if (maskImg) {
            maskImg.style.display = maskImg.style.display === "none" ? "block" : "none";
        }
    };

    overlay.addEventListener("click", close, { signal: popupSignal });
}

// --- スタイル定義 ---
if (!document.getElementById("gadget-train-style")) {
    const style = document.createElement("style");
    style.id = "gadget-train-style";
    style.textContent = `
        .train-main-view {
            display: flex;
            height: 100%;
            color: white;
            padding: 5px;
            gap: 10px;
            font-family: sans-serif;
            background: #222;
        }
        .train-left-pane {
            flex: 1;
            display: flex;
            flex-direction: column;
            border: 1px solid #444;
            overflow: hidden;
        }
        .train-thumb-canvas {
            flex: 1;
            background: #000;
            object-fit: contain;
            width: 100%;
            min-height: 100px;
            cursor: zoom-in;
        }
        .train-input-slot {
            height: 50px;
        }
        .train-btn-transfer {
            background: #335;
            color: #fff;
            border: none;
            padding: 6px;
            cursor: pointer;
            font-size: 11px;
        }
        .train-column-box {
            width: 200px;
            min-width: 180px;
            height: 100%;
            display: flex;
            flex-direction: column;
            border: 1px solid #444;
            background: #222;
        }
        .train-column-title {
            font-size: 11px;
            text-align: center;
            padding: 4px;
            background: #333;
            font-weight: bold;
        }
        .train-controls {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 8px;
        }
        .train-ctrl-btn {
            width: 45px;
            height: 35px;
            cursor: pointer;
            background: #444;
            color: #fff;
            border: 1px solid #666;
        }
        .train-ctrl-btn-save {
            background: #282;
        }
        .train-ctrl-btn-save.dirty {
            background: #b22 !important;
        }
        .train-list-focusable {
            outline: none;
        }
        .train-widget-input-fill {
            width: 100%;
            height: 100%;
        }
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

        .train-list {
            position: relative !important;
            flex: 1;
            overflow-y: auto;
            min-height: 0;
            background: #111;
            border-top: 1px solid #444;
        }
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
        .drop-indicator {
            position: absolute;
            left: 0;
            right: 0;
            height: 3px;
            background: #ffaa00;
            pointer-events: none;
            display: none;
            z-index: 9999;
            box-shadow: 0 0 5px rgba(255, 170, 0, 0.8);
        }
    `;
    document.head.appendChild(style);
}

app.registerExtension({
    name: "Gadget.TrainTagsEdit",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Edit Train Tags") return;

        const prevOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._trainUiAbort?.abort();
            if (typeof prevOnRemoved === "function") return prevOnRemoved.apply(this, arguments);
        };

        const prevOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (typeof prevOnNodeCreated === "function") prevOnNodeCreated.apply(this, arguments);

            const node = this;
            const uiAbort = new AbortController();
            node._trainUiAbort = uiAbort;
            const signal = uiAbort.signal;

            node.setSize([950, 650]);

            const minW = 540,
                minH = 300;
            node.onResize = function (size) {
                if (size[0] < minW) size[0] = minW;
                if (size[1] < minH) size[1] = minH;
                this.size[0] = size[0];
                this.size[1] = size[1];
            };

            const tagModel = new TagTrainModel();

            // Saveボタンの状態管理用ヘルパー
            const setDirty = (dirty) => {
                if (dirty) btnSave.classList.add("dirty");
                else btnSave.classList.remove("dirty");
            };

            const mainView = document.createElement("div");
            mainView.className = "train-main-view";

            const leftPane = document.createElement("div");
            leftPane.className = "train-left-pane";

            const thumbCanvas = document.createElement("canvas");
            thumbCanvas.className = "train-thumb-canvas";

            const keepTagsContainer = document.createElement("div");
            keepTagsContainer.className = "train-input-slot";
            const btnKeep = document.createElement("button");
            btnKeep.innerText = ">> Keep";
            btnKeep.className = "train-btn-transfer";

            const removeTagsContainer = document.createElement("div");
            removeTagsContainer.className = "train-input-slot";
            const btnRemove = document.createElement("button");
            btnRemove.innerText = ">> Remove";
            btnRemove.className = "train-btn-transfer";

            leftPane.append(thumbCanvas, keepTagsContainer, btnKeep, removeTagsContainer, btnRemove);

            const keepView = new TagListView({
                title: "keep_tags",
                columnKey: "keep",
                enableReorder: true,
                model: tagModel,
                signal,
                onChanged: () => setDirty(true)
            });

            const removeView = new TagListView({
                title: "remove_tags",
                columnKey: "remove",
                enableReorder: false,
                model: tagModel,
                signal,
                onChanged: () => setDirty(true)
            });

            const controls = document.createElement("div");
            controls.className = "train-controls";
            const createBtn = (t, extraClass = "") => {
                const b = document.createElement("button");
                b.innerText = t;
                b.className = "train-ctrl-btn" + (extraClass ? ` ${extraClass}` : "");
                return b;
            };
            const btnUp = createBtn("▲"),
                btnRight = createBtn(">>"),
                btnLeft = createBtn("<<"),
                btnDown = createBtn("▼"),
                btnSave = createBtn("Save", "train-ctrl-btn-save");
            controls.append(btnUp, btnRight, btnLeft, btnDown, btnSave);

            mainView.append(leftPane, keepView.box, controls, removeView.box);
            node.addDOMWidget("main_editor_ui", "div", mainView);

            const folderWidget = node.widgets.find((w) => w.name === "folder");
            const imageWidget = node.widgets.find((w) => w.name === "image_file_name");
            const keepTagsWidget = node.widgets.find((w) => w.name === "keep_tags");
            const removeTagsWidget = node.widgets.find((w) => w.name === "remove_tags");

            const updateAll = async () => {
                const folder = folderWidget.value;
                if (!folder) return;

                try {
                    const imgData = await TrainApi.getImages(folder);
                    imageWidget.options.values = imgData.files;

                    if (imgData.files.length > 0 && (!imageWidget.value || !imgData.files.includes(imageWidget.value))) {
                        imageWidget.value = imgData.files[0];
                    }
                    if (!imageWidget.value) return;

                    const data = await TrainApi.getData(folder, imageWidget.value);
                    node._currentData = data;

                    tagModel.loadFromServer(data.tags, data.blacklist);
                    keepView.render(false);
                    removeView.render(false);
                    setDirty(false); // 画像切り替え直後はクリーン

                    const ctx = thumbCanvas.getContext("2d");
                    const img = new Image();
                    img.onload = () => {
                        thumbCanvas.width = img.width;
                        thumbCanvas.height = img.height;
                        ctx.drawImage(img, 0, 0);
                        if (data.mask) {
                            const mask = new Image();
                            mask.onload = () => {
                                ctx.globalAlpha = 0.2;
                                ctx.drawImage(mask, 0, 0);
                                ctx.globalAlpha = 1.0;
                            };
                            mask.src = data.mask;
                        }
                    };
                    img.src = data.img;
                } catch (err) {
                    console.error("[Gadget.TrainTagsEdit] updateAll failed:", err);
                }
            };

            setTimeout(() => {
                if (keepTagsWidget.inputEl) {
                    keepTagsWidget.inputEl.classList.add("train-widget-input-fill");
                    keepTagsWidget.inputEl.placeholder = "Tags to Add";
                    keepTagsContainer.appendChild(keepTagsWidget.inputEl);
                }
                if (removeTagsWidget.inputEl) {
                    removeTagsWidget.inputEl.classList.add("train-widget-input-fill");
                    removeTagsWidget.inputEl.placeholder = "Tags to Remove";
                    removeTagsContainer.appendChild(removeTagsWidget.inputEl);
                }
                keepTagsWidget.type = removeTagsWidget.type = "hidden";
            }, 100);

            folderWidget.callback = imageWidget.callback = () => {
                void updateAll();
            };

            const renderTagViews = (preserveCurrentView = null) => {
                keepView.render(preserveCurrentView === keepView);
                removeView.render(preserveCurrentView === removeView);
            };

            btnKeep.onclick = () => {
                const val = keepTagsWidget.inputEl ? keepTagsWidget.inputEl.value : keepTagsWidget.value;
                if (!val) return;

                tagModel.moveTagsTo("keep", val.split(","));
                renderTagViews(keepView);
                setDirty(true);
            };

            btnRemove.onclick = () => {
                const val = removeTagsWidget.inputEl ? removeTagsWidget.inputEl.value : removeTagsWidget.value;
                if (!val) return;

                tagModel.moveTagsTo("remove", val.split(","));
                renderTagViews(removeView);
                setDirty(true);
            };

            thumbCanvas.addEventListener(
                "click",
                () => {
                    openTrainImagePopup(node._currentData, signal);
                },
                { signal }
            );

            btnRight.onclick = () => {
                const sel = keepView.getSelectedTagTexts();
                if (sel.length === 0) return;
                tagModel.moveTagsTo("remove", sel);
                renderTagViews();
                setDirty(true);
            };

            btnLeft.onclick = () => {
                const sel = removeView.getSelectedTagTexts();
                if (sel.length === 0) return;
                tagModel.moveTagsTo("keep", sel);
                renderTagViews();
                setDirty(true);
            };

            btnUp.onclick = () => {
                keepView.applyMoveUpOnDom();
                keepView.syncFromDom(); // sync内でsetDirty(true)が呼ばれる
            };

            btnDown.onclick = () => {
                keepView.applyMoveDownOnDom();
                keepView.syncFromDom();
            };

            btnSave.onclick = async () => {
                try {
                    await TrainApi.saveTags(folderWidget.value, imageWidget.value, tagModel.toSaveString());
                    setDirty(false); // 保存成功でクリーンに戻る
                } catch (err) {
                    console.error("[Gadget.TrainTagsEdit] save failed:", err);
                }
            };

            setTimeout(() => {
                void updateAll();
            }, 200);
            node.onConfigure = () => {
                setTimeout(() => {
                    void updateAll();
                }, 300);
            };
        };
    },
});
