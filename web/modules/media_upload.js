import { api } from "../../../../scripts/api.js";
import { getMediaConfig, getMediaListWidget, isAllowedMediaFile, parseMediaList, setMediaList } from "./common.js";

const LIST_REFRESH_INTERVAL = 8;
const FALLBACK_CANCEL_WAIT_MS = 1200;
const FALLBACK_FOLDER_CANCEL_WAIT_MS = 5000;
const FALLBACK_POLL_MS = 120;
const SUPPORTS_FILE_CANCEL_EVENT = (() => "oncancel" in document.createElement("input"))();

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

    const mediaConfig = getMediaConfig(node);
    const candidates = Array.from(files || []).filter((file) =>
        isAllowedMediaFile(file, mediaConfig, { allowMime: true })
    );
    if (!candidates.length) return [];

    const existing = replace ? [] : parseMediaList(listWidget.value);
    const uploaded = [];
    let uploadsSinceRefresh = 0;
    const refreshList = () => {
        setMediaList(node, existing.concat(uploaded));
    };

    for (const file of candidates) {
        try {
            const name = await uploadOneMedia(file);
            if (!name) continue;

            uploaded.push(name);
            uploadsSinceRefresh += 1;

            if (uploadsSinceRefresh >= LIST_REFRESH_INTERVAL) {
                refreshList();
                uploadsSinceRefresh = 0;
            }
        } catch (error) {
            console.error(`[GuguBatchLoadImages] Upload failed for ${file?.name || "<unknown>"}`, error);
        }
    }

    if (!uploaded.length) {
        throw new Error("No media files were uploaded successfully.");
    }

    refreshList();
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
        let fallbackTimer = null;
        const cleanup = () => {
            if (fallbackTimer !== null) {
                window.clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
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
            if (resolved) return;
            if (fallbackTimer !== null) {
                window.clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }

            const startedAt = Date.now();
            const waitMs = directory ? FALLBACK_FOLDER_CANCEL_WAIT_MS : FALLBACK_CANCEL_WAIT_MS;
            const pollSelection = () => {
                if (resolved) return;

                const selectedFiles = Array.from(input.files || []);
                if (selectedFiles.length > 0) {
                    finish(selectedFiles);
                    return;
                }

                if (Date.now() - startedAt >= waitMs) {
                    finish([]);
                    return;
                }

                fallbackTimer = window.setTimeout(pollSelection, FALLBACK_POLL_MS);
            };

            fallbackTimer = window.setTimeout(pollSelection, FALLBACK_POLL_MS);
        };

        input.addEventListener("change", onChange, { once: true });
        if (SUPPORTS_FILE_CANCEL_EVENT) {
            input.addEventListener("cancel", onCancel, { once: true });
        } else {
            window.addEventListener("focus", onWindowFocus, true);
        }
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
    if (!files.length) return [];

    const filteredFiles = files
        .filter((file) => isAllowedMediaFile(file, mediaConfig, { allowMime: false }))
        .sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name));
    if (!filteredFiles.length) return [];

    return uploadFilesSequential(node, filteredFiles, { replace });
}
