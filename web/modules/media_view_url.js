import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";

export function parseInputPath(path) {
    const normalized = String(path || "").replace(/\\/g, "/").trim();
    if (!normalized) return null;
    if (normalized.startsWith("/") || (normalized.length >= 2 && normalized[1] === ":")) {
        return null;
    }
    if (normalized.startsWith("..") || normalized.includes("/..")) {
        return null;
    }

    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash < 0) {
        return { filename: normalized, subfolder: "" };
    }
    return {
        filename: normalized.substring(lastSlash + 1),
        subfolder: normalized.substring(0, lastSlash),
    };
}

export function buildInputViewUrl({ filename, subfolder = "" }, { withPreview = true } = {}) {
    const previewParam = withPreview ? app.getPreviewFormatParam?.() || "" : "";
    const randParam = app.getRandParam?.() || "";
    const subfolderParam = subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : "";
    return api.apiURL(
        `/view?filename=${encodeURIComponent(filename)}&type=input${subfolderParam}${previewParam}${randParam}`
    );
}

export function getInputViewUrl(path, options = {}) {
    const parsed = parseInputPath(path);
    if (!parsed) return "";
    return buildInputViewUrl(parsed, options);
}
