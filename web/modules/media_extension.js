import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
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
import { buildInputViewUrl, getInputViewUrl, parseInputPath } from "./media_view_url.js";
import { SORT_OPTIONS, sortMediaList, fetchMediaMetadata } from "./media_sort.js";
import { isFilesDragEvent, uploadFilesSequential, openMultiSelect, openFolderSelect } from "./media_upload.js";
import { queueAllSequential, queueCurrentSingle, scanServerMediaDir } from "./media_queue.js";
import { createFailedPanel } from "./media_failed.js";

const SCROLLABLE_GRID_SELECTOR = ".mogu-batch-media-grid";
const scrollableWheelElements = new Set();

const PIXELS_PER_LINE = 16;
const wheelCtor = typeof WheelEvent === "function" ? WheelEvent : null;
const DOM_DELTA_LINE = wheelCtor ? wheelCtor.DOM_DELTA_LINE : 1;
const DOM_DELTA_PAGE = wheelCtor ? wheelCtor.DOM_DELTA_PAGE : 2;
const THUMB_MEDIA_LAYER = 1;
const THUMB_ACTION_LAYER = 3;

let isGlobalWheelCaptureBound = false;

function isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function formatErrorMessage(error) {
    return error?.message || String(error);
}

function buildProxyViewUrl(previewId) {
    return api.apiURL(`/mogu_batch_process/view_proxy?id=${encodeURIComponent(previewId)}`);
}

function parsePreviewFilePath(previewHint) {
    const filename = String(previewHint?.filename || "").trim();
    if (!filename) return null;
    const subfolder = typeof previewHint?.subfolder === "string" ? previewHint.subfolder.trim() : "";
    return parseInputPath(subfolder ? `${subfolder}/${filename}` : filename);
}

function resolvePreviewUrl(path, previewHint, { withPreview = true } = {}) {
    if (previewHint === false) return "";
    if (previewHint && typeof previewHint === "object" && typeof previewHint.proxy_id === "string" && previewHint.proxy_id.trim()) {
        return buildProxyViewUrl(previewHint.proxy_id.trim());
    }
    if (previewHint && typeof previewHint === "object" && typeof previewHint.filename === "string" && previewHint.filename.trim()) {
        const parsedHint = parsePreviewFilePath(previewHint);
        if (parsedHint) {
            return buildInputViewUrl(parsedHint, { withPreview });
        }
    }
    return getInputViewUrl(path, { withPreview });
}

function runWithUiError(label, action, { logPrefix = "GuguBatchLoadImages" } = {}) {
    void Promise.resolve()
        .then(action)
        .catch((error) => {
            console.error(`[${logPrefix}] ${label}:`, error);
            alert(`${label}: ${formatErrorMessage(error)}`);
        });
}

function normalizeWheelDeltaY(event, element) {
    if (!Number.isFinite(event?.deltaY)) return 0;
    if (event.deltaMode === DOM_DELTA_LINE) return event.deltaY * PIXELS_PER_LINE;
    if (event.deltaMode === DOM_DELTA_PAGE) return event.deltaY * element.clientHeight;
    return event.deltaY;
}

function resolveScrollableGridFromEvent(event) {
    const target = event?.target;
    const baseElement =
        target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (!baseElement?.closest) return null;

    const matched = baseElement.closest(SCROLLABLE_GRID_SELECTOR);
    if (!(matched instanceof HTMLElement)) return null;
    if (!scrollableWheelElements.has(matched)) return null;
    return matched;
}

function unbindGlobalWheelCaptureIfIdle() {
    if (!isGlobalWheelCaptureBound || scrollableWheelElements.size > 0) return;
    window.removeEventListener("wheel", onGlobalWheelCapture, { capture: true });
    isGlobalWheelCaptureBound = false;
}

function onGlobalWheelCapture(event) {
    const element = resolveScrollableGridFromEvent(event);
    if (!element) return;
    if (!element.isConnected) {
        scrollableWheelElements.delete(element);
        unbindGlobalWheelCaptureIfIdle();
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
    }

    const deltaY = normalizeWheelDeltaY(event, element);
    if (!deltaY) return;

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    if (maxScrollTop <= 0) return;

    const nextTop = Math.max(0, Math.min(maxScrollTop, element.scrollTop + deltaY));
    element.scrollTop = nextTop;
}

function bindGlobalWheelCapture() {
    if (isGlobalWheelCaptureBound) return;
    window.addEventListener("wheel", onGlobalWheelCapture, { passive: false, capture: true });
    isGlobalWheelCaptureBound = true;
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

    const resolveClientPoint = (event) => {
        const x = event?.clientX;
        const y = event?.clientY;
        if (typeof x !== "number" || typeof y !== "number") return null;
        return { x, y };
    };

    const isHit = (event) => {
        const point = resolveClientPoint(event);
        if (!point) return false;
        const rect = container?.getBoundingClientRect?.();
        if (!rect) return false;
        return isPointInRect(point.x, point.y, rect);
    };

    const isTopLayerHit = (event) => {
        const point = resolveClientPoint(event);
        if (!point) return false;
        if (!isHit(event)) return false;
        const topElement = document.elementFromPoint(point.x, point.y);
        if (!(topElement instanceof Element)) return true;
        return container?.contains(topElement) ?? false;
    };

    const onWindowDragOver = (event) => {
        if (!isFilesDragEvent(event) || !ensureConnected()) return;
        const hit = isTopLayerHit(event);
        if (hit) {
            event.preventDefault();
            event.stopPropagation();
        }
        setDraggingActive(hit);
    };

    const onWindowDrop = async (event) => {
        if (!isFilesDragEvent(event) || !ensureConnected()) return;
        const hit = isTopLayerHit(event);
        setDraggingActive(false);
        if (!hit) return;
        event.preventDefault();
        event.stopPropagation();
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return;
        try {
            await uploadFilesSequential(node, files, { replace: false });
        } catch (error) {
            console.error("[GuguBatchLoadImages] Drag-and-drop upload failed:", error);
            alert(`Upload failed: ${formatErrorMessage(error)}`);
            redraw?.();
        }
    };

    const onWindowDragLeave = (event) => {
        if (!isFilesDragEvent(event) || !ensureConnected()) return;
        if (isTopLayerHit(event)) return;
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

function ensureGridScrollbarStyles() {
    const styleId = "mogu-batch-media-grid-scrollbar-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.mogu-batch-media-grid {
    scrollbar-width: auto !important;
    scrollbar-color: rgba(140, 190, 220, 0.95) rgba(0, 0, 0, 0.25) !important;
}
.mogu-batch-media-grid::-webkit-scrollbar {
    width: 12px !important;
}
.mogu-batch-media-grid::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.25) !important;
    border-radius: 8px !important;
}
.mogu-batch-media-grid::-webkit-scrollbar-thumb {
    background: rgba(140, 190, 220, 0.95) !important;
    border-radius: 8px !important;
    border: 2px solid rgba(0, 0, 0, 0.2) !important;
}
.mogu-batch-media-grid::-webkit-scrollbar-thumb:hover {
    background: rgba(170, 220, 245, 1) !important;
}
`;

    (document.head || document.documentElement).appendChild(style);
}

function bindScrollableWheel(element) {
    if (!element) return () => {};
    scrollableWheelElements.add(element);
    bindGlobalWheelCapture();

    return () => {
        scrollableWheelElements.delete(element);
        unbindGlobalWheelCaptureIfIdle();
    };
}

function createBrowserUI(node) {
    ensureGridScrollbarStyles();

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
    grid.className = "mogu-batch-media-grid";
    grid.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;height:260px;overflow-y:scroll;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;touch-action:pan-y;background:var(--comfy-input-bg);padding:6px;border-radius:4px;";
    const unbindGridWheel = bindScrollableWheel(grid);
    grid.tabIndex = 0;

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
            cell.addEventListener("pointerdown", (event) => {
                const target = event.target;
                const isNoDragZone =
                    target instanceof Element && !!target.closest("[data-no-drag='true']");
                cell.draggable = !isNoDragZone;
            });
            cell.addEventListener("pointerup", () => {
                cell.draggable = true;
            });
            cell.addEventListener("pointercancel", () => {
                cell.draggable = true;
            });

            cell.ondragstart = (e) => {
                if (!cell.draggable) {
                    e.preventDefault();
                    dragFromIdx = null;
                    return;
                }
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
                "position:relative;isolation:isolate;aspect-ratio:1;border-radius:4px;overflow:hidden;border:1px solid var(--border-color);background:#111;display:flex;align-items:center;justify-content:center;";

            const previewHint = name in cachedPreviews ? cachedPreviews[name] : undefined;
            if (!isVideo) {
                const img = document.createElement("img");
                img.src = resolvePreviewUrl(name, previewHint);
                img.style.cssText = `position:relative;z-index:${THUMB_MEDIA_LAYER};width:100%;height:100%;object-fit:cover;display:block;`;
                img.draggable = false;
                thumb.appendChild(img);
            } else {
                import("./media_preview.js").then(({ createVideoThumb }) => {
                    const videoThumb = createVideoThumb(name, previewHint);
                    videoThumb.draggable = false;
                    videoThumb.style.position = "relative";
                    videoThumb.style.zIndex = String(THUMB_MEDIA_LAYER);
                    thumb.appendChild(videoThumb);
                });
            }

            const del = document.createElement("button");
            del.textContent = "x";
            del.title = "Remove";
            del.dataset.noDrag = "true";
            del.draggable = false;
            del.style.cssText =
                `position:absolute;z-index:${THUMB_ACTION_LAYER};top:2px;right:2px;width:20px;height:20px;background:rgba(255,0,0,0.75);color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:16px;line-height:1;pointer-events:auto;touch-action:manipulation;`;
            del.onpointerdown = (event) => {
                event.stopPropagation();
            };
            del.ondragstart = (event) => {
                event.preventDefault();
                event.stopPropagation();
            };
            del.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                cell.draggable = true;
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

    return {
        container,
        redraw,
        setDragging,
        setPreviews,
        dispose: () => {
            unbindGridWheel?.();
        },
    };
}

export function registerBatchLoadMediaExtension() {
    app.registerExtension({
        name: "GuguBatchLoadImages.Extension",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            const compatibleNodeNames = new Set([
                "GuguBatchLoadImages",
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

                const serverDirWidgetName = isVideoListNode(this) ? "server_video_dir" : "server_image_dir";
                if (getWidgetByName(this, serverDirWidgetName)) {
                    const scanWidgetName = "Scan";
                    if (!getWidgetByName(this, scanWidgetName)) {
                        this.addWidget("button", scanWidgetName, null, () => {
                            runWithUiError("Scan failed", async () => {
                                const result = await scanServerMediaDir(this);
                                ui.setPreviews(result.previews);
                                const changed = setMediaList(this, result.items);
                                if (!changed) ui.redraw();
                            });
                        });
                    }
                }

                this.addDOMWidget("batch_load_images", "customwidget", ui.container);
                this.setSize(getWidgetByName(this, serverDirWidgetName) ? [520, 390] : [420, 320]);

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
                    ui.dispose?.();
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
