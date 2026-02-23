import { getFailedListWidget, parseMediaList, clearFailedList, requeueFailedItems } from "./common.js";

export function createFailedPanel(node, mkBtn, redrawCallback) {
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

    const update = () => {
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
        redrawCallback?.();
        update();
    };

    clearFailedBtn.onclick = () => {
        clearFailedList(node);
        update();
    };

    return { element: failedRow, update };
}
