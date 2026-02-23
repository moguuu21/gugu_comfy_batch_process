import { api } from "../../../../scripts/api.js";
import { getMediaConfig, getMediaListWidget, isAllowedMediaFile, parseMediaList, setMediaList } from "./common.js";

export function isFilesDragEvent(event) {
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
        const detail = (await response.text()).trim();
        throw new Error(detail || `Upload failed (${response.status})`);
    }

    const json = await response.json();
    return json?.name;
}

export async function uploadFilesSequential(node, files, { replace = false } = {}) {
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

function openFilePicker({ accept, directory = false } = {}) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept || "";
    input.multiple = true;
    if (directory) {
        input.webkitdirectory = true;
        input.directory = true;
    }
    input.style.display = "none";
    document.body.appendChild(input);

    return new Promise((resolve) => {
        let resolved = false;
        const cleanup = () => {
            if (input.parentNode) input.parentNode.removeChild(input);
            input.removeEventListener("change", onChange);
            input.removeEventListener("cancel", onCancel);
            window.removeEventListener("focus", onWindowFocus, true);
        };
        const finish = (files) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(files);
        };
        const onChange = (event) => {
            finish(Array.from(event.target.files || []));
        };
        const onCancel = () => {
            finish([]);
        };
        const onWindowFocus = () => {
            // Some browsers do not emit a cancel event for file pickers.
            setTimeout(() => {
                if (!resolved && !(input.files && input.files.length > 0)) {
                    finish([]);
                }
            }, 200);
        };

        input.addEventListener("change", onChange, { once: true });
        input.addEventListener("cancel", onCancel, { once: true });
        window.addEventListener("focus", onWindowFocus, true);
        input.click();
    });
}

export async function openMultiSelect(node, { replace = false } = {}) {
    const mediaConfig = getMediaConfig(node);
    const files = await openFilePicker({ accept: mediaConfig.accept });
    if (!files.length) return [];
    return uploadFilesSequential(node, files, { replace });
}

export async function openFolderSelect(node, { replace = false } = {}) {
    const mediaConfig = getMediaConfig(node);
    const files = await openFilePicker({ accept: mediaConfig.accept, directory: true });
    const filteredFiles = files
        .filter((file) => isAllowedMediaFile(file, mediaConfig, { allowMime: false }))
        .sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name));
    if (!filteredFiles.length && !replace) return [];
    return uploadFilesSequential(node, filteredFiles, { replace });
}
