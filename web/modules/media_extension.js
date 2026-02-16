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
} from "./common.js";

async function queueCurrent() {
    const prompt = await app.graphToPrompt();
    await api.queuePrompt(-1, prompt);
}

async function queueAllSequential(node) {
    const namesRaw = parseMediaList(getMediaListWidget(node)?.value);
    if (!namesRaw.length) {
        const serverVideoDir = String(getWidgetByName(node, "server_video_dir")?.value || "").trim();
        if (isVideoListNode(node) && serverVideoDir) {
            const modeWidget = getWidgetByName(node, "mode");
            if (!modeWidget) {
                await queueCurrent();
                return;
            }

            const prevMode = modeWidget.value;
            try {
                modeWidget.value = "batch";
                modeWidget.callback?.(modeWidget.value);
                await queueCurrent();
            } finally {
                modeWidget.value = prevMode;
                modeWidget.callback?.(modeWidget.value);
            }
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

function getViewUrl(filename, { withPreview = true } = {}) {
    const previewParam = withPreview ? app.getPreviewFormatParam?.() || "" : "";
    const randParam = app.getRandParam?.() || "";
    return api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input${previewParam}${randParam}`);
}

function createVideoFallbackIcon() {
    const icon = document.createElement("div");
    icon.textContent = "VIDEO";
    icon.style.cssText = "font-size:11px;opacity:0.9;letter-spacing:0.8px;";
    return icon;
}

function createVideoThumb(name) {
    const video = document.createElement("video");
    video.src = getViewUrl(name, { withPreview: false });
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.disablePictureInPicture = true;
    video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;";

    video.addEventListener(
        "error",
        () => {
            video.replaceWith(createVideoFallbackIcon());
        },
        { once: true }
    );

    return video;
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

    const info = document.createElement("div");
    info.style.cssText = "font-size:12px;opacity:0.85;margin-bottom:6px;";

    const grid = document.createElement("div");
    grid.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;max-height:260px;overflow-y:auto;background:var(--comfy-input-bg);padding:6px;border-radius:4px;";

    const updateInfo = () => {
        const names = parseMediaList(getMediaListWidget(node)?.value);
        info.textContent = `Selected ${names.length} ${noun}. Drag-and-drop is supported.`;
    };

    const redraw = () => {
        const names = parseMediaList(getMediaListWidget(node)?.value);
        grid.innerHTML = "";

        const fragment = document.createDocumentFragment();
        names.forEach((name, idx) => {
            const cell = document.createElement("div");
            cell.style.cssText = "display:flex;flex-direction:column;gap:3px;";

            const thumb = document.createElement("div");
            thumb.style.cssText =
                "position:relative;aspect-ratio:1;border-radius:4px;overflow:hidden;border:1px solid var(--border-color);background:#111;display:flex;align-items:center;justify-content:center;";

            if (!isVideo) {
                const img = document.createElement("img");
                img.src = getViewUrl(name);
                img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
                thumb.appendChild(img);
            } else {
                thumb.appendChild(createVideoThumb(name));
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
        app.graph.setDirtyCanvas(true);
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
    container.appendChild(info);
    container.appendChild(grid);

    return { container, redraw, setDragging };
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
                this.addDOMWidget("batch_load_images", "customwidget", ui.container);
                this.setSize(isVideoListNode(this) ? [520, 360] : [420, 320]);

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
                this._batchLoadImagesUI?.redraw?.();
            };
        },
    });
}
