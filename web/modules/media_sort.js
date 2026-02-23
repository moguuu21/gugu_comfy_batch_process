import { api } from "../../../../scripts/api.js";

export const SORT_OPTIONS = {
    MANUAL: { key: "manual", label: "Manual" },
    NAME_ASC: { key: "name", order: "asc", label: "Name (A→Z)" },
    NAME_DESC: { key: "name", order: "desc", label: "Name (Z→A)" },
    DATE_ASC: { key: "mtime", order: "asc", label: "Date (Old→New)" },
    DATE_DESC: { key: "mtime", order: "desc", label: "Date (New→Old)" },
};

function naturalCompare(a, b) {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return collator.compare(a, b);
}

export function sortMediaList(names, metadata, sortKey) {
    const opt = SORT_OPTIONS[sortKey];
    if (!opt || opt.key === "manual") return [...names];

    const sorted = [...names];
    sorted.sort((a, b) => {
        let cmp;
        if (opt.key === "name") {
            cmp = naturalCompare(a, b);
        } else if (opt.key === "mtime") {
            const mtimeA = metadata[a]?.mtime || 0;
            const mtimeB = metadata[b]?.mtime || 0;
            cmp = mtimeA - mtimeB;
        } else {
            cmp = 0;
        }
        return opt.order === "desc" ? -cmp : cmp;
    });
    return sorted;
}

export async function fetchMediaMetadata(filenames) {
    if (!filenames.length) return {};
    try {
        const response = await api.fetchApi("/mogu_batch_process/get_media_metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filenames }),
        });
        if (!response.ok) return {};
        const payload = await response.json();
        return payload?.metadata || {};
    } catch {
        return {};
    }
}
