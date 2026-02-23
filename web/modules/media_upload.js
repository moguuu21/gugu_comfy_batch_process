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
        throw new Error(await response.text());
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

export function openMultiSelect(node, { replace = false } = {}) {
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

export function openFolderSelect(node, { replace = false } = {}) {
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
