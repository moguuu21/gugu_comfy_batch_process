import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import {
    MEDIA_CONFIG,
    deepClone,
    getMaxMediaCountValue,
    getMediaConfig,
    getMediaKind,
    getMediaListWidget,
    getWidgetByName,
    isAllowedMediaFile,
    isVideoListNode,
    parseMediaList,
    setMediaList,
    getFailedListWidget,
    appendToFailedList,
    clearFailedList,
    requeueFailedItems,
} from "./common.js";
import { createVideoThumb, getInputViewUrl } from "./media_preview.js";

const SORT_OPTIONS = {
    MANUAL: { key: "manual", label: "Manual" },
    NAME_ASC: { key: "name", order: "asc", label: "Name (A→Z)" },
    NAME_DESC: { key: "name", order: "desc", label: "Name (Z→A)" },
    DATE_ASC: { key: "mtime", order: "asc", label: "Date (Old→New)" },
    DATE_DESC: { key: "mtime", order: "desc", label: "Date (New→Old)" },
};

function naturalCompare(a, b) {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return collator.compare(a, b);
}

function sortMediaList(names, metadata, sortKey) {
    const opt = SORT_OPTIONS[sortKey];
    if (!opt || opt.key === "manual") return [...names];

    const sorted = [...names];
    sorted.sort((a, b) => {
        let cmp;
        if (opt.key === "name") {
            cmp = naturalCompare(a, b);
        } else if (opt.key === "mtime") {
            const mtimeA = metadata[a]?.mtime || 0;
            const mtimeB = metadata[b]?.mtime || 0;
            cmp = mtimeA - mtimeB;
        } else {
            cmp = 0;
        }
        return opt.order === "desc" ? -cmp : cmp;
    });
    return sorted;
}

async function fetchMediaMetadata(filenames) {
    if (!filenames.length) return {};
    try {
        const response = await api.fetchApi("/mogu_batch_process/get_media_metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filenames }),
        });
        if (!response.ok) return {};
        const payload = await response.json();
        return payload?.metadata || {};
    } catch {
        return {};
    }
}

async function queueCurrent() {
    const prompt = await app.graphToPrompt();
    await api.queuePrompt(-1, prompt);
}

async function queueAllSequential(node) {
    const namesRaw = parseMediaList(getMediaListWidget(node)?.value);
    if (!namesRaw.length) {
        if (isVideoListNode(node)) {
            alert("video_list is empty. Please scan or select videos first.");
        }
        return;
    }

    const maxCount = getMaxMediaCountValue(node);
    const names = maxCount && maxCount > 0 ? namesRaw.slice(0, maxCount) : namesRaw;
    if (!names.length) return;

    const modeWidget = getWidgetByName(node, "mode");
    const indexWidget = getWidgetByName(node, "index");
    if (!modeWidget || !indexWidget) {
        const basePrompt = await app.graphToPrompt();
        const nodeId = String(node.id);
        for (let idx = 0; idx < names.length; idx++) {
            const prompt = deepClone(basePrompt);
            const apiNode = prompt.output?.[nodeId];
            if (!apiNode) continue;
            apiNode.inputs = apiNode.inputs || {};
            apiNode.inputs.mode = "single";
            apiNode.inputs.index = idx;
            await api.queuePrompt(-1, prompt);
        }
        return;
    }

    const prevMode = modeWidget.value;
    const prevIndex = indexWidget.value;
    try {
        modeWidget.value = "single";
        modeWidget.callback?.(modeWidget.value);
        for (let idx = 0; idx < names.length; idx++) {
            indexWidget.value = idx;
            indexWidget.callback?.(indexWidget.value);
            await queueCurrent();
        }
    } finally {
        modeWidget.value = prevMode;
        modeWidget.callback?.(modeWidget.value);
        indexWidget.value = prevIndex;
        indexWidget.callback?.(indexWidget.value);
    }
}

async function scanServerVideoDir(node) {
    if (!isVideoListNode(node)) return { items: [], previews: {}, count: 0, total: 0 };

    const serverVideoDir = String(getWidgetByName(node, "server_video_dir")?.value || "").trim();
    if (!serverVideoDir) {
        throw new Error("server_video_dir is empty");
    }

    const maxVideos = getMaxMediaCountValue(node);
    const response = await api.fetchApi("/mogu_batch_process/scan_video_dir", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            server_video_dir: serverVideoDir,
            max_videos: maxVideos,
        }),
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok || payload?.ok === false) {
        const message = payload?.error || `Scan failed (${response.status})`;
        throw new Error(message);
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const previews = payload?.previews && typeof payload.previews === "object" ? payload.previews : {};
    setMediaList(node, items);
    return {
        items,
        previews,
        count: typeof payload?.count === "number" ? payload.count : items.length,
        total: typeof payload?.total === "number" ? payload.total : items.length,
    };
}

function isFilesDragEvent(event) {
    const transfer = event?.dataTransfer;
    if (!transfer) return false;
    if (transfer.files && transfer.files.length > 0) return true;
    return Array.from(transfer.types || []).includes("Files");
}

async function uploadOneMedia(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("type", "input");

    const response = await api.fetchApi("/upload/image", {
        method: "POST",
        body,
    });
    if (!response.ok) {
        throw new Error(await response.text());
    }

    const json = await response.json();
    return json?.name;
}

async function uploadFilesSequential(node, files, { replace = false } = {}) {
    const listWidget = getMediaListWidget(node);
    if (!listWidget) return [];

    const existing = replace ? [] : parseMediaList(listWidget.value);
    const uploaded = [];
    const mediaConfig = getMediaConfig(node);

    for (const file of files) {
        if (!isAllowedMediaFile(file, mediaConfig, { allowMime: true })) continue;
        const name = await uploadOneMedia(file);
        if (name) uploaded.push(name);
    }

    setMediaList(node, existing.concat(uploaded));
    return uploaded;
}

function openMultiSelect(node, { replace = false } = {}) {
    const mediaConfig = getMediaConfig(node);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = mediaConfig.accept;
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = async (event) => {
        try {
            const files = Array.from(event.target.files || []);
            await uploadFilesSequential(node, files, { replace });
        } finally {
            document.body.removeChild(input);
        }
    };

    input.click();
}

function openFolderSelect(node, { replace = false } = {}) {
    const mediaConfig = getMediaConfig(node);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = mediaConfig.accept;
    input.multiple = true;
    input.webkitdirectory = true;
    input.directory = true;
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = async (event) => {
        try {
            const files = Array.from(event.target.files || [])
                .filter((file) => isAllowedMediaFile(file, mediaConfig, { allowMime: false }))
                .sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name));

            await uploadFilesSequential(node, files, { replace });
        } finally {
            document.body.removeChild(input);
        }
    };

    input.click();
}

const domUIs = new Set();
let globalDragDropInstalled = false;

function isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function getUIUnderPointer(event) {
    const x = event?.clientX;
    const y = event?.clientY;
    if (typeof x !== "number" || typeof y !== "number") return null;

    for (const entry of domUIs) {
        const rect = entry?.container?.getBoundingClientRect?.();
        if (!rect) continue;
        if (isPointInRect(x, y, rect)) return entry;
    }

    return null;
}

function setDraggingUI(activeEntry) {
    for (const entry of domUIs) {
        entry?.setDragging?.(entry === activeEntry);
    }
}

function ensureGlobalDragDropPrevention() {
    if (globalDragDropInstalled) return;
    globalDragDropInstalled = true;

    window.addEventListener(
        "dragover",
        (event) => {
            if (!isFilesDragEvent(event)) return;
            event.preventDefault();
            setDraggingUI(getUIUnderPointer(event));
        },
        { capture: true }
    );

    window.addEventListener(
        "drop",
        async (event) => {
            if (!isFilesDragEvent(event)) return;
            event.preventDefault();

            const hit = getUIUnderPointer(event);
            setDraggingUI(null);
            if (!hit) return;

            const files = Array.from(event.dataTransfer?.files || []);
            if (!files.length) return;
            await uploadFilesSequential(hit.node, files, { replace: false });
            hit.redraw?.();
        },
        { capture: true }
    );

    window.addEventListener(
        "dragleave",
        (event) => {
            if (!isFilesDragEvent(event)) return;
            setDraggingUI(null);
        },
        { capture: true }
    );
}

function createBrowserUI(node) {
    const container = document.createElement("div");
    container.style.cssText =
        "width:100%;padding:8px;background:var(--comfy-menu-bg);border:1px solid var(--border-color);border-radius:6px;margin:5px 0;pointer-events:auto;";

    const mediaKind = getMediaKind(node);
    const isVideo = mediaKind === "video";
    const noun = MEDIA_CONFIG[mediaKind].noun;

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px;";

    const mkBtn = (label) => {
        const button = document.createElement("button");
        button.textContent = label;
        button.style.cssText =
            "flex:1;padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:13px;";
        return button;
    };

    const replaceBtn = mkBtn(`Select ${noun}`);
    const addBtn = mkBtn(`Add ${noun}`);
    const folderBtn = mkBtn("Select Folder");
    const queueBtn = mkBtn("Queue All");
    const queueOneBtn = mkBtn("Queue Current");

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.style.cssText =
        "padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:13px;";

    btnRow.appendChild(replaceBtn);
    btnRow.appendChild(addBtn);
    btnRow.appendChild(folderBtn);
    btnRow.appendChild(queueBtn);
    btnRow.appendChild(queueOneBtn);
    btnRow.appendChild(clearBtn);

    // Sort row
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

    sortRow.appendChild(sortLabel);
    sortRow.appendChild(sortSelect);

    let currentSort = "MANUAL";
    let cachedMetadata = {};
    let cachedPreviews = {};

    const info = document.createElement("div");
    info.style.cssText = "font-size:12px;opacity:0.85;margin-bottom:6px;";

    const grid = document.createElement("div");
    grid.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;max-height:260px;overflow-y:auto;background:var(--comfy-input-bg);padding:6px;border-radius:4px;";

    // Failed panel
    const failedRow = document.createElement("div");
    failedRow.style.cssText =
        "display:none;gap:6px;margin-top:8px;align-items:center;padding:8px;background:rgba(255,100,100,0.15);border-radius:4px;";

    const failedInfo = document.createElement("span");
    failedInfo.style.cssText = "font-size:12px;flex:1;color:#f88;";

    const requeueBtn = mkBtn("Re-queue");
    requeueBtn.style.flex = "0";
    requeueBtn.style.padding = "6px 12px";

    const clearFailedBtn = mkBtn("Clear");
    clearFailedBtn.style.flex = "0";
    clearFailedBtn.style.padding = "6px 12px";

    failedRow.appendChild(failedInfo);
    failedRow.appendChild(requeueBtn);
    failedRow.appendChild(clearFailedBtn);

    const updateFailedPanel = () => {
        const failed = parseMediaList(getFailedListWidget(node)?.value);
        if (failed.length > 0) {
            failedRow.style.display = "flex";
            failedInfo.textContent = `Failed: ${failed.length} item(s)`;
        } else {
            failedRow.style.display = "none";
        }
    };

    requeueBtn.onclick = () => {
        requeueFailedItems(node);
        redraw();
        updateFailedPanel();
    };

    clearFailedBtn.onclick = () => {
        clearFailedList(node);
        updateFailedPanel();
    };

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
                    redraw();
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
                const videoThumb = createVideoThumb(name, previewHint);
                videoThumb.draggable = false;
                thumb.appendChild(videoThumb);
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
                redraw();
            };

            const label = document.createElement("div");
            label.textContent = name;
            label.title = name;
            label.style.cssText = "font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.9;";

            thumb.appendChild(del);
            cell.appendChild(thumb);
            cell.appendChild(label);
            fragment.appendChild(cell);
        });

        grid.appendChild(fragment);
        updateInfo();
        updateFailedPanel();
        app.graph.setDirtyCanvas(true);
    };

    const applySortAndRedraw = async () => {
        const names = parseMediaList(getMediaListWidget(node)?.value);
        if (!names.length) return;

        if (SORT_OPTIONS[currentSort]?.key === "mtime" && Object.keys(cachedMetadata).length === 0) {
            cachedMetadata = await fetchMediaMetadata(names);
        }

        const sorted = sortMediaList(names, cachedMetadata, currentSort);
        setMediaList(node, sorted);
        redraw();
    };

    sortSelect.onchange = async () => {
        currentSort = sortSelect.value;
        await applySortAndRedraw();
    };

    container.addEventListener("dragover", (event) => {
        if (!isFilesDragEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
    });

    container.addEventListener("drop", async (event) => {
        if (!isFilesDragEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return;
        await uploadFilesSequential(node, files, { replace: false });
        redraw();
    });

    const setDragging = (active) => {
        container.style.border = active ? "2px dashed #4a6" : "1px solid var(--border-color)";
    };

    replaceBtn.onclick = async () => {
        openMultiSelect(node, { replace: true });
    };
    addBtn.onclick = async () => {
        openMultiSelect(node, { replace: false });
    };
    folderBtn.onclick = async () => {
        openFolderSelect(node, { replace: true });
    };
    queueBtn.onclick = async () => {
        await queueAllSequential(node);
    };
    queueOneBtn.onclick = async () => {
        if (isVideoListNode(node) && parseMediaList(getMediaListWidget(node)?.value).length === 0) {
            alert("video_list is empty. Please scan or select videos first.");
            return;
        }
        const modeWidget = getWidgetByName(node, "mode");
        if (modeWidget) {
            modeWidget.value = "single";
            modeWidget.callback?.(modeWidget.value);
        }
        await queueCurrent();
    };
    clearBtn.onclick = () => {
        setMediaList(node, []);
        redraw();
    };

    container.appendChild(btnRow);
    container.appendChild(sortRow);
    container.appendChild(info);
    container.appendChild(grid);
    container.appendChild(failedRow);

    const setPreviews = (previews) => {
        cachedPreviews = previews && typeof previews === "object" ? previews : {};
    };

    return { container, redraw, setDragging, updateFailedPanel, setPreviews };
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

            ensureGlobalDragDropPrevention();

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
                        this.addWidget("button", scanWidgetName, null, async () => {
                            try {
                                const result = await scanServerVideoDir(this);
                                ui.setPreviews(result.previews);
                                ui.redraw();
                            } catch (error) {
                                console.error("[BatchLoadVideos] Failed to scan server_video_dir:", error);
                                alert(`Scan failed: ${error?.message || String(error)}`);
                            }
                        });
                    }
                }

                this.addDOMWidget("batch_load_images", "customwidget", ui.container);
                this.setSize(isVideoListNode(this) ? [520, 390] : [420, 320]);

                domUIs.add({ node: this, container: ui.container, redraw: ui.redraw, setDragging: ui.setDragging });

                const prevOnRemoved = this.onRemoved;
                this.onRemoved = function () {
                    for (const entry of domUIs) {
                        if (entry?.node === this) {
                            domUIs.delete(entry);
                            break;
                        }
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

                // Capture failed_filenames from node output
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
                this._batchLoadImagesUI?.updateFailedPanel?.();
            };
        },
    });
}
