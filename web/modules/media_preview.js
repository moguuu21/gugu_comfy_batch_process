import { api } from "../../../../scripts/api.js";
import { buildInputViewUrl, parseInputPath } from "./media_view_url.js";

function createVideoFallbackIcon() {
    const icon = document.createElement("div");
    icon.textContent = "VIDEO";
    icon.style.cssText = "font-size:11px;opacity:0.9;letter-spacing:0.8px;";
    return icon;
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

function parsePreviewHint(path, previewHint) {
    if (previewHint === false) return { url: "" };
    if (previewHint && typeof previewHint === "object" && typeof previewHint.proxy_id === "string" && previewHint.proxy_id.trim()) {
        return { url: buildProxyViewUrl(previewHint.proxy_id.trim()) };
    }
    if (previewHint && typeof previewHint === "object" && typeof previewHint.filename === "string" && previewHint.filename.trim()) {
        const parsedHint = parsePreviewFilePath(previewHint);
        if (!parsedHint) return { url: "" };
        return { url: buildInputViewUrl(parsedHint, { withPreview: false }) };
    }
    const parsed = parseInputPath(path);
    if (!parsed) return { url: "" };
    return { url: buildInputViewUrl(parsed, { withPreview: false }) };
}

export function getInputViewUrl(path, options = {}) {
    const parsed = parseInputPath(path);
    if (!parsed) return "";
    return buildInputViewUrl(parsed, options);
}

export function createVideoThumb(path, previewHint) {
    const resolved = parsePreviewHint(path, previewHint);
    if (!resolved?.url) return createVideoFallbackIcon();

    const video = document.createElement("video");
    video.src = resolved.url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.disablePictureInPicture = true;
    video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";

    video.addEventListener("mouseenter", () => video.play().catch(() => {}));
    video.addEventListener("mouseleave", () => {
        video.pause();
        video.currentTime = 0;
    });
    video.addEventListener(
        "error",
        () => {
            video.replaceWith(createVideoFallbackIcon());
        },
        { once: true }
    );

    return video;
}
