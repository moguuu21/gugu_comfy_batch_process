import { app } from "../../../../scripts/app.js";
import {
    MEDIA_CONFIG,
    getMediaKind,
    getMediaListWidget,
    getWidgetByName,
    isVideoListNode,
    parseMediaList,
    setMediaList,
    appendToFailedList,
} from "./common.js";
import { getInputViewUrl } from "./media_view_url.js";
import { SORT_OPTIONS, sortMediaList, fetchMediaMetadata } from "./media_sort.js";
import { isFilesDragEvent, uploadFilesSequential, openMultiSelect, openFolderSelect } from "./media_upload.js";
import { queueAllSequential, queueCurrentSingle, scanServerVideoDir } from "./media_queue.js";
import { createFailedPanel } from "./media_failed.js";

function isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function formatErrorMessage(error) {
    return error?.message || String(error);
}

function runWithUiError(label, action, { logPrefix = "BatchLoadImages" } = {}) {
    void Promise.resolve()
        .then(action)
        .catch((error) => {
            console.error(`[${logPrefix}] ${label}:`, error);
            alert(`${label}: ${formatErrorMessage(error)}`);
        });
}

function createDragDropCoordinator({ node, container, redraw, setDragging }) {
    let isUnregistered = false;
    let isDragging = false;

    const setDraggingActive = (active) => {
        if (isDragging === active) return;
        isDragging = active;
        setDragging?.(active);
    };

    const unregister = () => {
        if (isUnregistered) return;
        isUnregistered = true;
        setDraggingActive(false);
        window.removeEventListener("dragover", onWindowDragOver, true);
        window.removeEventListener("drop", onWindowDrop, true);
        window.removeEventListener("dragleave", onWindowDragLeave, true);
    };

    const ensureConnected = () => {
        if (isUnregistered) return false;
        if (container?.isConnected) return true;
        unregister();
        return false;
    };

    const isHit = (event) => {
        const x = event?.clientX;
        const y = event?.clientY;
        if (typeof x !== "number" || typeof y !== "number") return false;
        const rect = container?.getBoundingClientRect?.();
        if (!rect) return false;
        return isPointInRect(x, y, rect);
    };

    const onWindowDragOver = (event) => {
        if (!isFilesDragEvent(event) || !ensureConnected()) return;
        event.preventDefault();
        const hit = isHit(event);
        setDraggingActive(hit);
    };

    const onWindowDrop = async (event) => {
        if (!isFilesDragEvent(event) || !ensureConnected()) return;
        event.preventDefault();
        const hit = isHit(event);
        setDraggingActive(false);
        if (!hit) return;
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return;
        try {
            await uploadFilesSequential(node, files, { replace: false });
        } catch (error) {
            console.error("[BatchLoadImages] Drag-and-drop upload failed:", error);
            alert(`Upload failed: ${formatErrorMessage(error)}`);
            redraw?.();
        }
    };

    const onWindowDragLeave = (event) => {
        if (!isFilesDragEvent(event) || !ensureConnected()) return;
        if (isHit(event)) return;
        setDraggingActive(false);
    };

    window.addEventListener("dragover", onWindowDragOver, true);
    window.addEventListener("drop", onWindowDrop, true);
    window.addEventListener("dragleave", onWindowDragLeave, true);

    return { unregister };
}

function mkBtn(label) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText =
        "flex:1;padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:13px;";
    return button;
}

function createBrowserUI(node) {
    const container = document.createElement("div");
    container.style.cssText =
        "width:100%;padding:8px;background:var(--comfy-menu-bg);border:1px solid var(--border-color);border-radius:6px;margin:5px 0;pointer-events:auto;";

    const mediaKind = getMediaKind(node);
    const isVideo = mediaKind === "video";
    const noun = MEDIA_CONFIG[mediaKind].noun;

    let currentSort = "MANUAL";
    let cachedMetadata = {};
    let metadataCacheSignature = "";
    let cachedPreviews = {};

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px;";

    const replaceBtn = mkBtn(`Select ${noun}`);
    const addBtn = mkBtn(`Add ${noun}`);
    const folderBtn = mkBtn("Select Folder");
    const queueBtn = mkBtn("Queue All");
    const queueOneBtn = mkBtn("Queue Current");

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.style.cssText =
        "padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:13px;";

    btnRow.append(replaceBtn, addBtn, folderBtn, queueBtn, queueOneBtn, clearBtn);

    const sortRow = document.createElement("div");
    sortRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px;align-items:center;";

    const sortLabel = document.createElement("span");
    sortLabel.textContent = "Sort:";
    sortLabel.style.cssText = "font-size:12px;opacity:0.85;";

    const sortSelect = document.createElement("select");
    sortSelect.style.cssText =
        "padding:4px 8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;font-size:12px;";

    Object.entries(SORT_OPTIONS).forEach(([key, opt]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = opt.label;
        sortSelect.appendChild(option);
    });

    sortRow.append(sortLabel, sortSelect);

    const info = document.createElement("div");
    info.style.cssText = "font-size:12px;opacity:0.85;margin-bottom:6px;";

    const grid = document.createElement("div");
    grid.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;max-height:260px;overflow-y:auto;background:var(--comfy-input-bg);padding:6px;border-radius:4px;";

    const updateInfo = () => {
        const names = parseMediaList(getMediaListWidget(node)?.value);
        info.textContent = `Selected ${names.length} ${noun}. Drag to reorder.`;
    };

    let dragFromIdx = null;

    const redraw = () => {
        const names = parseMediaList(getMediaListWidget(node)?.value);
        grid.innerHTML = "";

        const fragment = document.createDocumentFragment();
        names.forEach((name, idx) => {
            const cell = document.createElement("div");
            cell.style.cssText = "display:flex;flex-direction:column;gap:3px;";
            cell.draggable = true;
            cell.dataset.index = idx;

            cell.ondragstart = (e) => {
                dragFromIdx = idx;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(idx));
                cell.style.opacity = "0.5";
            };

            cell.ondragend = () => {
                cell.style.opacity = "1";
                dragFromIdx = null;
            };

            cell.ondragover = (e) => {
                if (dragFromIdx === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
            };

            cell.ondrop = (e) => {
                if (dragFromIdx === null) return;
                e.preventDefault();
                e.stopPropagation();
                const fromIdx = dragFromIdx;
                const toIdx = idx;
                if (fromIdx !== toIdx) {
                    const currentNames = parseMediaList(getMediaListWidget(node)?.value);
                    const [moved] = currentNames.splice(fromIdx, 1);
                    currentNames.splice(toIdx, 0, moved);
                    setMediaList(node, currentNames);
                    currentSort = "MANUAL";
                    sortSelect.value = "MANUAL";
                }
                dragFromIdx = null;
            };

            const thumb = document.createElement("div");
            thumb.style.cssText =
                "position:relative;aspect-ratio:1;border-radius:4px;overflow:hidden;border:1px solid var(--border-color);background:#111;display:flex;align-items:center;justify-content:center;";

            if (!isVideo) {
                const img = document.createElement("img");
                img.src = getInputViewUrl(name);
                img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
                img.draggable = false;
                thumb.appendChild(img);
            } else {
                const previewHint = name in cachedPreviews ? cachedPreviews[name] : undefined;
                import("./media_preview.js").then(({ createVideoThumb }) => {
                    const videoThumb = createVideoThumb(name, previewHint);
                    videoThumb.draggable = false;
                    thumb.appendChild(videoThumb);
                });
            }

            const del = document.createElement("button");
            del.textContent = "x";
            del.title = "Remove";
            del.style.cssText =
                "position:absolute;top:2px;right:2px;width:20px;height:20px;background:rgba(255,0,0,0.75);color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:16px;line-height:1;";
            del.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                setMediaList(node, names.slice(0, idx).concat(names.slice(idx + 1)));
            };

            const label = document.createElement("div");
            label.textContent = name;
            label.title = name;
            label.style.cssText = "font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.9;";

            thumb.appendChild(del);
            cell.append(thumb, label);
            fragment.appendChild(cell);
        });

        grid.appendChild(fragment);
        updateInfo();
        failedPanel.update();
        app.graph.setDirtyCanvas(true);
    };

    const failedPanel = createFailedPanel(node, mkBtn, redraw);

    const applySortAndRedraw = async () => {
        const names = parseMediaList(getMediaListWidget(node)?.value);
        if (!names.length) return;

        if (SORT_OPTIONS[currentSort]?.key === "mtime") {
            const signature = [...new Set(names)].sort().join("\n");
            if (signature !== metadataCacheSignature) {
                cachedMetadata = {};
                metadataCacheSignature = signature;
            }
            const missingNames = names.filter((name) => !(name in cachedMetadata));
            if (missingNames.length > 0) {
                const fetchedMetadata = await fetchMediaMetadata(missingNames);
                cachedMetadata = { ...cachedMetadata, ...fetchedMetadata };
            }
        }

        const sorted = sortMediaList(names, cachedMetadata, currentSort);
        setMediaList(node, sorted);
    };

    sortSelect.onchange = () => {
        runWithUiError("Sort failed", async () => {
            currentSort = sortSelect.value;
            await applySortAndRedraw();
        });
    };

    container.addEventListener("dragover", (event) => {
        if (!isFilesDragEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
    });

    container.addEventListener("drop", (event) => {
        if (!isFilesDragEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
    });

    const setDragging = (active) => {
        container.style.border = active ? "2px dashed #4a6" : "1px solid var(--border-color)";
    };

    replaceBtn.onclick = () => runWithUiError("Select failed", () => openMultiSelect(node, { replace: true }));
    addBtn.onclick = () => runWithUiError("Add failed", () => openMultiSelect(node, { replace: false }));
    folderBtn.onclick = () => runWithUiError("Folder select failed", () => openFolderSelect(node, { replace: true }));
    queueBtn.onclick = () => runWithUiError("Queue all failed", () => queueAllSequential(node));
    queueOneBtn.onclick = () => runWithUiError("Queue current failed", () => queueCurrentSingle(node));
    clearBtn.onclick = () => {
        setMediaList(node, []);
    };

    container.append(btnRow, sortRow, info, grid, failedPanel.element);

    const setPreviews = (previews) => {
        cachedPreviews = previews && typeof previews === "object" ? previews : {};
    };

    return { container, redraw, setDragging, setPreviews };
}

export function registerBatchLoadMediaExtension() {
    app.registerExtension({
        name: "BatchLoadImages.Extension",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            const compatibleNodeNames = new Set([
                "BatchLoadImages",
                "gugu_BatchLoadImages",
                "ComfyUI-IAI666-BatchLoadImages",
                "gugu_BatchLoadVideos",
            ]);
            if (!compatibleNodeNames.has(nodeData.name)) return;

            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const created = origOnNodeCreated?.apply(this, arguments);

                const mediaListWidget = getMediaListWidget(this);
                if (mediaListWidget) {
                    mediaListWidget.type = "hidden";
                    mediaListWidget.computeSize = () => [0, -4];
                }

                const ui = createBrowserUI(this);
                this._batchLoadImagesUI = ui;

                if (isVideoListNode(this)) {
                    const scanWidgetName = "Scan";
                    if (!getWidgetByName(this, scanWidgetName)) {
                        this.addWidget("button", scanWidgetName, null, () => {
                            runWithUiError("Scan failed", async () => {
                                const result = await scanServerVideoDir(this);
                                ui.setPreviews(result.previews);
                                const changed = setMediaList(this, result.items);
                                if (!changed) ui.redraw();
                            });
                        });
                    }
                }

                this.addDOMWidget("batch_load_images", "customwidget", ui.container);
                this.setSize(isVideoListNode(this) ? [520, 390] : [420, 320]);

                this._batchLoadImagesDragDropCoordinator?.unregister?.();
                const dragDropCoordinator = createDragDropCoordinator({
                    node: this,
                    container: ui.container,
                    redraw: ui.redraw,
                    setDragging: ui.setDragging,
                });
                this._batchLoadImagesDragDropCoordinator = dragDropCoordinator;

                const prevOnRemoved = this.onRemoved;
                this.onRemoved = function () {
                    dragDropCoordinator.unregister();
                    if (this._batchLoadImagesDragDropCoordinator === dragDropCoordinator) {
                        this._batchLoadImagesDragDropCoordinator = null;
                    }
                    return prevOnRemoved?.apply(this, arguments);
                };

                if (mediaListWidget) {
                    const origCallback = mediaListWidget.callback;
                    mediaListWidget.callback = function (value) {
                        origCallback?.call(this, value);
                        ui.redraw();
                    };
                }

                ui.redraw();
                return created;
            };

            const origOnExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (output) {
                origOnExecuted?.apply(this, arguments);

                const failedOutput = output?.failed_filenames;
                if (failedOutput) {
                    const failedNames = parseMediaList(
                        Array.isArray(failedOutput) ? failedOutput[0] : failedOutput
                    );
                    if (failedNames.length > 0) {
                        appendToFailedList(this, failedNames);
                    }
                }

                this._batchLoadImagesUI?.redraw?.();
            };
        },
    });
}
