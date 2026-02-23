export function getWidgetByName(node, name) {
    return node?.widgets?.find((widget) => widget.name === name);
}

export function getMediaListWidget(node) {
    return getWidgetByName(node, "image_list") || getWidgetByName(node, "video_list");
}

export function isVideoListNode(node) {
    return !!getWidgetByName(node, "video_list");
}

export const MEDIA_CONFIG = {
    image: {
        noun: "images",
        extSet: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]),
        mimePrefix: "image/",
        accept: "image/*,.png,.jpg,.jpeg,.webp,.gif",
    },
    video: {
        noun: "videos",
        extSet: new Set([".mp4", ".webm", ".avi", ".mov", ".mkv", ".flv", ".m4v"]),
        mimePrefix: "video/",
        accept: "video/*,.mp4,.webm,.avi,.mov,.mkv,.flv,.m4v",
    },
};

export function getMediaKind(node) {
    return isVideoListNode(node) ? "video" : "image";
}

export function getMediaConfig(node) {
    return MEDIA_CONFIG[getMediaKind(node)];
}

export function isAllowedMediaFile(file, mediaConfig, { allowMime = true } = {}) {
    if (!file) return false;
    const lowerName = (file?.name || "").toLowerCase();
    const hasAllowedExt = Array.from(mediaConfig.extSet).some((ext) => lowerName.endsWith(ext));
    if (hasAllowedExt) return true;
    if (!allowMime) return false;
    return !!file?.type && file.type.startsWith(mediaConfig.mimePrefix);
}

export function parseMediaList(text) {
    return (text || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => !!line);
}

export function setMediaList(node, names) {
    const widget = getMediaListWidget(node);
    if (!widget) return false;
    const nextValue = (names || []).join("\n");
    if (widget.value === nextValue) return false;
    widget.value = nextValue;
    widget.callback?.(widget.value);
    return true;
}

export function getMaxMediaCountValue(node) {
    const widget = getWidgetByName(node, "max_images") || getWidgetByName(node, "max_videos");
    return typeof widget?.value === "number" ? widget.value : 0;
}

export function deepClone(obj) {
    if (typeof structuredClone === "function") return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

export function clampInt(value, min, max) {
    let parsed = Math.floor(Number(value));
    if (Number.isNaN(parsed)) parsed = min;
    if (parsed < min) parsed = min;
    if (parsed > max) parsed = max;
    return parsed;
}

export function getCameraDataWidget(node) {
    return getWidgetByName(node, "camera_data");
}

export function getFailedListWidget(node) {
    return getWidgetByName(node, "_failed_list");
}

export function getOrCreateFailedListWidget(node) {
    let widget = getFailedListWidget(node);
    if (!widget) {
        widget = node.addWidget("text", "_failed_list", "", () => {});
        widget.type = "hidden";
        widget.computeSize = () => [0, -4];
    }
    return widget;
}

export function setFailedList(node, names) {
    const widget = getOrCreateFailedListWidget(node);
    widget.value = (names || []).join("\n");
}

export function appendToFailedList(node, names) {
    const existing = parseMediaList(getFailedListWidget(node)?.value);
    const unique = [...new Set([...existing, ...names])];
    setFailedList(node, unique);
}

export function clearFailedList(node) {
    setFailedList(node, []);
}

export function requeueFailedItems(node) {
    const failed = parseMediaList(getFailedListWidget(node)?.value);
    if (!failed.length) return;
    const current = parseMediaList(getMediaListWidget(node)?.value);
    const merged = [...new Set([...current, ...failed])];
    setMediaList(node, merged);
    clearFailedList(node);
}
