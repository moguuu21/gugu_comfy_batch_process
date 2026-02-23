import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import {
    deepClone,
    getMaxMediaCountValue,
    getMediaListWidget,
    getWidgetByName,
    isVideoListNode,
    parseMediaList,
    setMediaList,
} from "./common.js";

async function queueCurrent() {
    const prompt = await app.graphToPrompt();
    await api.queuePrompt(-1, prompt);
}

export async function queueAllSequential(node) {
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

export async function queueCurrentSingle(node) {
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
}

export async function scanServerVideoDir(node) {
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
