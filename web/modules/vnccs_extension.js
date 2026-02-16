import { app } from "../../../../scripts/app.js";
import { clampInt, getCameraDataWidget } from "./common.js";

function buildVNCCSPrompt(data) {
    const azimuth = clampInt(data?.azimuth ?? 0, 0, 360) % 360;
    const elevation = clampInt(data?.elevation ?? 0, -30, 60);
    const distance = data?.distance ?? "medium shot";
    const includeTrigger = data?.include_trigger !== false;

    const azimuthMap = {
        0: "front view",
        45: "front-right quarter view",
        90: "right side view",
        135: "back-right quarter view",
        180: "back view",
        225: "back-left quarter view",
        270: "left side view",
        315: "front-left quarter view",
    };

    const closestAzimuth =
        azimuth > 337.5
            ? 0
            : Object.keys(azimuthMap)
                  .map((key) => Number(key))
                  .reduce((best, candidate) => (Math.abs(candidate - azimuth) < Math.abs(best - azimuth) ? candidate : best), 0);

    const elevationMap = {
        "-30": "low-angle shot",
        "0": "eye-level shot",
        "30": "elevated shot",
        "60": "high-angle shot",
    };

    const closestElevation = Object.keys(elevationMap)
        .map((key) => Number(key))
        .reduce((best, candidate) => (Math.abs(candidate - elevation) < Math.abs(best - elevation) ? candidate : best), 0);

    const parts = [];
    if (includeTrigger) parts.push("<sks>");
    parts.push(azimuthMap[closestAzimuth]);
    parts.push(elevationMap[String(closestElevation)]);
    parts.push(distance);
    return parts.join(" ");
}

function createVNCCSVisualUI(node) {
    const widget = getCameraDataWidget(node);
    if (!widget) return null;

    widget.type = "hidden";
    widget.computeSize = () => [0, -4];

    const container = document.createElement("div");
    container.style.cssText =
        "width:100%;padding:8px;background:var(--comfy-menu-bg);border:1px solid var(--border-color);border-radius:6px;margin:5px 0;pointer-events:auto;";

    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";

    const mkField = (labelText) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";
        const label = document.createElement("div");
        label.textContent = labelText;
        label.style.cssText = "font-size:12px;opacity:0.9;";
        wrap.appendChild(label);
        return { wrap };
    };

    const azimuthField = mkField("Azimuth");
    const elevationField = mkField("Elevation");
    const distanceField = mkField("Distance");
    const triggerField = mkField("Include Trigger");

    const azimuthInput = document.createElement("input");
    azimuthInput.type = "range";
    azimuthInput.min = "0";
    azimuthInput.max = "360";
    azimuthInput.step = "45";

    const elevationInput = document.createElement("input");
    elevationInput.type = "range";
    elevationInput.min = "-30";
    elevationInput.max = "60";
    elevationInput.step = "30";

    const distanceInput = document.createElement("select");
    for (const value of ["close-up", "medium shot", "wide shot"]) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        distanceInput.appendChild(opt);
    }

    const triggerInput = document.createElement("input");
    triggerInput.type = "checkbox";

    const azimuthValue = document.createElement("div");
    azimuthValue.style.cssText = "font-size:12px;opacity:0.8;";
    const elevationValue = document.createElement("div");
    elevationValue.style.cssText = "font-size:12px;opacity:0.8;";

    const promptOutput = document.createElement("input");
    promptOutput.type = "text";
    promptOutput.readOnly = true;
    promptOutput.style.cssText =
        "width:100%;padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;";

    azimuthField.wrap.appendChild(azimuthInput);
    azimuthField.wrap.appendChild(azimuthValue);
    elevationField.wrap.appendChild(elevationInput);
    elevationField.wrap.appendChild(elevationValue);
    distanceField.wrap.appendChild(distanceInput);
    triggerField.wrap.appendChild(triggerInput);

    row.appendChild(azimuthField.wrap);
    row.appendChild(elevationField.wrap);
    row.appendChild(distanceField.wrap);
    row.appendChild(triggerField.wrap);

    const write = () => {
        const data = {
            azimuth: clampInt(azimuthInput.value, 0, 360),
            elevation: clampInt(elevationInput.value, -30, 60),
            distance: distanceInput.value,
            include_trigger: !!triggerInput.checked,
        };
        widget.value = JSON.stringify(data);
        widget.callback?.(widget.value);
        azimuthValue.textContent = String(data.azimuth);
        elevationValue.textContent = String(data.elevation);
        promptOutput.value = buildVNCCSPrompt(data);
    };

    const read = () => {
        let data;
        try {
            data = JSON.parse(widget.value || "{}");
        } catch {
            data = {};
        }

        azimuthInput.value = String(clampInt(data?.azimuth ?? 0, 0, 360));
        elevationInput.value = String(clampInt(data?.elevation ?? 0, -30, 60));
        distanceInput.value = data?.distance ?? "medium shot";
        triggerInput.checked = data?.include_trigger !== false;
        write();
    };

    azimuthInput.addEventListener("input", write);
    elevationInput.addEventListener("input", write);
    distanceInput.addEventListener("change", write);
    triggerInput.addEventListener("change", write);

    container.appendChild(row);
    container.appendChild(promptOutput);

    return { container, read };
}

export function registerVNCCSVisualPositionExtension() {
    app.registerExtension({
        name: "VNCCS.VisualPositionControl.Extension",
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== "VNCCS_VisualPositionControl") return;

            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const created = origOnNodeCreated?.apply(this, arguments);
                const ui = createVNCCSVisualUI(this);
                if (ui) {
                    this.addDOMWidget("vnccs_visual", "customwidget", ui.container);
                    this.setSize([420, 220]);
                    ui.read();
                }
                return created;
            };
        },
    });
}
