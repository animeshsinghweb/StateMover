"use strict";

// Firefox exposes promise-based `browser`; Chromium exposes `chrome` (promise-based under MV3).
const api = globalThis.browser ?? globalThis.chrome;

const MAGIC_KEY = "__localStorageTransfer__";
const PAYLOAD_VERSION = 2;
const ORIGIN_SELECTIONS_KEY = "stateMoverOriginSelections";
const LEGACY_SYNC_KEYS = ["stateMoverKeys", "stateMoverLocalKeys", "stateMoverSessionKeys"];
const AREAS = ["local", "session"];

// Pages where no extension may inject a script; injection there fails with an opaque error.
const BLOCKED_URL = /^(chrome|edge|brave|opera|about|moz-extension|chrome-extension|view-source|devtools|file):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org|microsoftedge\.microsoft\.com)/;

const el = (id) => document.getElementById(id);
const ui = {
    origin: el("originLabel"),
    error: el("pageError"),
    workspace: el("workspace"),
    tabLocal: el("tabLocal"),
    tabSession: el("tabSession"),
    countLocal: el("localCount"),
    countSession: el("sessionCount"),
    filter: el("filterInput"),
    selectAll: el("selectAllBtn"),
    selectNone: el("selectNoneBtn"),
    list: el("keyList"),
    summary: el("selectionSummary"),
    copy: el("copyBtn"),
    download: el("downloadBtn"),
    importData: el("importData"),
    importBtn: el("importBtn"),
    reload: el("reloadAfterImport"),
    loadFile: el("loadFileBtn"),
    fileInput: el("fileInput"),
    toast: el("toast"),
};

const state = {
    tabId: null,
    origin: "",
    area: "local",
    filter: "",
    keys: { local: [], session: [] },
    selected: { local: new Set(), session: new Set() },
};

// --- Injected page functions (serialised by executeScript, so no closures) ---

function pageCollectKeys() {
    const encoder = new TextEncoder();
    const read = (store) => {
        const out = [];
        for (let i = 0; i < store.length; i++) {
            const name = store.key(i);
            const value = store.getItem(name);
            out.push({ name, size: encoder.encode(value ?? "").length });
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    };
    const safe = (fn) => {
        try {
            return fn();
        } catch {
            return []; // storage access can be blocked by site policy
        }
    };
    return {
        origin: location.origin,
        local: safe(() => read(localStorage)),
        session: safe(() => read(sessionStorage)),
    };
}

function pageReadValues(localKeys, sessionKeys) {
    const grab = (store, names) => {
        const out = {};
        for (const name of names) {
            try {
                const value = store.getItem(name);
                if (value !== null) out[name] = value;
            } catch {
                /* unreadable key - skip */
            }
        }
        return out;
    };
    return {
        local: grab(localStorage, localKeys),
        session: grab(sessionStorage, sessionKeys),
    };
}

function pageWriteValues(localEntries, sessionEntries) {
    const put = (store, entries) => {
        let written = 0;
        for (const [name, value] of entries) {
            store.setItem(name, value);
            written++;
        }
        return written;
    };
    try {
        return { local: put(localStorage, localEntries), session: put(sessionStorage, sessionEntries) };
    } catch (e) {
        return { error: e && e.name === "QuotaExceededError" ? "Storage quota exceeded." : String(e) };
    }
}

// --- Plumbing ---

async function runInPage(func, args = []) {
    const results = await api.scripting.executeScript({ target: { tabId: state.tabId }, func, args });
    return results?.[0]?.result;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let toastTimer;
function toast(message, isError = false) {
    ui.toast.textContent = message;
    ui.toast.classList.toggle("is-error", isError);
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        ui.toast.hidden = true;
    }, isError ? 5000 : 2600);
}

function fatal(message) {
    ui.error.textContent = message;
    ui.error.hidden = false;
    ui.workspace.hidden = true;
}

// --- Selection persistence (per origin, with the pre-1.2 global list as the fallback) ---

async function loadDefaults() {
    let synced = {};
    try {
        // storage.sync is unavailable in some Firefox configurations; the migration is optional.
        synced = await api.storage.sync.get(LEGACY_SYNC_KEYS);
    } catch {
        synced = {};
    }
    return {
        local: synced.stateMoverLocalKeys ?? synced.stateMoverKeys ?? [],
        session: synced.stateMoverSessionKeys ?? [],
    };
}

async function loadSelection() {
    const stored = await api.storage.local.get(ORIGIN_SELECTIONS_KEY);
    const saved = stored[ORIGIN_SELECTIONS_KEY]?.[state.origin] ?? (await loadDefaults());
    for (const area of AREAS) state.selected[area] = new Set(saved[area] ?? []);
}

let saveTimer;
function saveSelection() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        const stored = await api.storage.local.get(ORIGIN_SELECTIONS_KEY);
        const map = stored[ORIGIN_SELECTIONS_KEY] ?? {};
        map[state.origin] = { local: [...state.selected.local], session: [...state.selected.session] };
        await api.storage.local.set({ [ORIGIN_SELECTIONS_KEY]: map });
    }, 250);
}

// --- Rendering ---

function renderList() {
    const needle = state.filter.toLowerCase();
    const rows = state.keys[state.area].filter((k) => !needle || k.name.toLowerCase().includes(needle));

    ui.list.textContent = "";

    if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = state.keys[state.area].length
            ? "No keys match that filter."
            : `No ${state.area}Storage keys on this page.`;
        ui.list.append(empty);
        return;
    }

    const frag = document.createDocumentFragment();
    for (const { name, size } of rows) {
        const row = document.createElement("div");
        row.className = "key-row";

        const head = document.createElement("div");
        head.className = "key-head";

        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = state.selected[state.area].has(name);
        box.id = `key-${state.area}-${name}`;
        box.addEventListener("change", () => {
            const set = state.selected[state.area];
            box.checked ? set.add(name) : set.delete(name);
            saveSelection();
            renderSummary();
        });

        const label = document.createElement("label");
        label.className = "key-name";
        label.htmlFor = box.id;
        label.textContent = name;
        label.title = name;

        const sizeEl = document.createElement("span");
        sizeEl.className = "key-size";
        sizeEl.textContent = formatBytes(size);

        const peek = document.createElement("button");
        peek.type = "button";
        peek.className = "key-peek";
        peek.textContent = "▶";
        peek.setAttribute("aria-expanded", "false");
        peek.setAttribute("aria-label", `Show value of ${name}`);
        peek.addEventListener("click", () => togglePeek(row, peek, name));

        head.append(box, label, sizeEl, peek);
        row.append(head);
        frag.append(row);
    }
    ui.list.append(frag);
}

async function togglePeek(row, peek, name) {
    const existing = row.querySelector(".key-value");
    if (existing) {
        existing.remove();
        peek.setAttribute("aria-expanded", "false");
        return;
    }

    const pre = document.createElement("pre");
    pre.className = "key-value";
    pre.textContent = "Loading…";
    row.append(pre);
    peek.setAttribute("aria-expanded", "true");

    try {
        const args = state.area === "local" ? [[name], []] : [[], [name]];
        const values = await runInPage(pageReadValues, args);
        pre.textContent = prettify(values?.[state.area]?.[name] ?? "(not readable)");
    } catch {
        pre.textContent = "(could not read this key)";
    }
}

function prettify(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return JSON.stringify(parsed, null, 2);
    } catch {
        /* not JSON - show as stored */
    }
    return raw;
}

function selectedBytes() {
    let count = 0;
    let bytes = 0;
    for (const area of AREAS) {
        for (const { name, size } of state.keys[area]) {
            if (state.selected[area].has(name)) {
                count++;
                bytes += size;
            }
        }
    }
    return { count, bytes };
}

function renderSummary() {
    const { count, bytes } = selectedBytes();
    ui.summary.textContent = count
        ? `${count} key${count === 1 ? "" : "s"} selected · ${formatBytes(bytes)}`
        : "No keys selected.";
    ui.copy.disabled = count === 0;
    ui.download.disabled = count === 0;
}

function renderCounts() {
    ui.countLocal.textContent = String(state.keys.local.length);
    ui.countSession.textContent = String(state.keys.session.length);
}

function setArea(area) {
    state.area = area;
    const isLocal = area === "local";
    ui.tabLocal.classList.toggle("is-active", isLocal);
    ui.tabSession.classList.toggle("is-active", !isLocal);
    ui.tabLocal.setAttribute("aria-selected", String(isLocal));
    ui.tabSession.setAttribute("aria-selected", String(!isLocal));
    renderList();
}

// --- Export / import ---

async function buildSnapshot() {
    const values = await runInPage(pageReadValues, [
        [...state.selected.local],
        [...state.selected.session],
    ]);
    return JSON.stringify({
        [MAGIC_KEY]: true,
        version: PAYLOAD_VERSION,
        origin: state.origin,
        exportedAt: new Date().toISOString(),
        local: values?.local ?? {},
        session: values?.session ?? {},
    });
}

async function copySnapshot() {
    try {
        const json = await buildSnapshot();
        await navigator.clipboard.writeText(json);
        toast(`Copied ${formatBytes(new TextEncoder().encode(json).length)} to the clipboard.`);
    } catch (e) {
        toast(`Export failed: ${e.message}`, true);
    }
}

async function downloadSnapshot() {
    try {
        const json = await buildSnapshot();
        const host = state.origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "-");
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `state-mover-${host}-${stamp}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast("Snapshot downloaded.");
    } catch (e) {
        toast(`Download failed: ${e.message}`, true);
    }
}

function parseSnapshot(text) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error("That is not valid JSON.");
    }
    if (!payload || typeof payload !== "object") throw new Error("That snapshot is not an object.");

    const local = {};
    const session = {};
    // v1 snapshots stored localStorage values in a flat `data` field.
    Object.assign(local, pickStrings(payload.data), pickStrings(payload.local));
    Object.assign(session, pickStrings(payload.session));

    if (!payload[MAGIC_KEY] && !Object.keys(local).length && !Object.keys(session).length) {
        throw new Error("No State Mover data found in that snapshot.");
    }
    return { local, session };
}

function pickStrings(obj) {
    if (!obj || typeof obj !== "object") return {};
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === "string"));
}

async function applySnapshot() {
    const text = ui.importData.value.trim();
    if (!text) {
        toast("Paste a snapshot first.", true);
        return;
    }

    ui.importBtn.disabled = true;
    try {
        const { local, session } = parseSnapshot(text);
        const result = await runInPage(pageWriteValues, [Object.entries(local), Object.entries(session)]);
        if (result?.error) throw new Error(result.error);

        const written = (result?.local ?? 0) + (result?.session ?? 0);
        if (ui.reload.checked) {
            await api.tabs.reload(state.tabId);
            toast(`Applied ${written} key${written === 1 ? "" : "s"}. Reloading…`);
            setTimeout(() => window.close(), 700);
        } else {
            toast(`Applied ${written} key${written === 1 ? "" : "s"}. Reload the page to see them.`);
            await refreshKeys();
        }
    } catch (e) {
        toast(e.message, true);
    } finally {
        ui.importBtn.disabled = false;
    }
}

// --- Boot ---

async function refreshKeys() {
    const collected = await runInPage(pageCollectKeys);
    if (!collected) throw new Error("The page did not respond.");
    state.keys.local = collected.local;
    state.keys.session = collected.session;
    renderCounts();
    renderList();
    renderSummary();
}

async function init() {
    ui.copy.disabled = true;
    ui.download.disabled = true;

    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
        fatal("No active tab to read.");
        return;
    }
    state.tabId = tab.id;

    if (!tab.url || BLOCKED_URL.test(tab.url)) {
        ui.origin.textContent = "unavailable";
        fatal("State Mover cannot read browser-internal or extension-store pages. Open a regular http(s) site and try again.");
        return;
    }

    try {
        state.origin = new URL(tab.url).origin;
    } catch {
        state.origin = tab.url;
    }
    ui.origin.textContent = state.origin.replace(/^https?:\/\//, "");
    ui.origin.title = state.origin;

    try {
        await loadSelection();
        await refreshKeys();
    } catch (e) {
        fatal(`Could not read this page's storage. ${e.message}`);
    }
}

ui.tabLocal.addEventListener("click", () => setArea("local"));
ui.tabSession.addEventListener("click", () => setArea("session"));

let filterTimer;
ui.filter.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
        state.filter = ui.filter.value.trim();
        renderList();
    }, 100);
});

ui.selectAll.addEventListener("click", () => {
    const needle = state.filter.toLowerCase();
    for (const { name } of state.keys[state.area]) {
        if (!needle || name.toLowerCase().includes(needle)) state.selected[state.area].add(name);
    }
    saveSelection();
    renderList();
    renderSummary();
});

ui.selectNone.addEventListener("click", () => {
    state.selected[state.area].clear();
    saveSelection();
    renderList();
    renderSummary();
});

ui.copy.addEventListener("click", copySnapshot);
ui.download.addEventListener("click", downloadSnapshot);
ui.importBtn.addEventListener("click", applySnapshot);
ui.loadFile.addEventListener("click", () => ui.fileInput.click());

ui.fileInput.addEventListener("change", async () => {
    const file = ui.fileInput.files?.[0];
    if (!file) return;
    ui.importData.value = await file.text();
    ui.fileInput.value = "";
    toast(`Loaded ${file.name}.`);
});

init();
