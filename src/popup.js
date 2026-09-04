"use strict";

// Firefox exposes promise-based `browser`; Chromium exposes `chrome` (promise-based under MV3).
const api = globalThis.browser ?? globalThis.chrome;

const MAGIC_KEY = "__localStorageTransfer__";
const PAYLOAD_VERSION = 2;
const ORIGIN_SELECTIONS_KEY = "stateMoverOriginSelections";
const MIGRATED_KEY = "stateMoverLegacyMigrated";
const LEGACY_SYNC_KEYS = ["stateMoverKeys", "stateMoverLocalKeys", "stateMoverSessionKeys"];
const AREAS = ["local", "session"];

// A page whose main thread is busy answers an injected script late or not at
// all. Every call is bounded so the popup reports instead of hanging.
const TIMEOUT = { collect: 4000, values: 8000, write: 8000, storage: 2500 };

// Above this, building a row per key costs more than it returns. Filtering
// still reaches everything.
const MAX_ROWS = 400;

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
    // Bumped on every reload so a slow reply cannot overwrite newer state.
    generation: 0,
};

// --- Injected page functions (serialised by executeScript, so no closures) ---

function pageCollectKeys() {
    const read = (store) => {
        const out = [];
        for (const name of Object.keys(store)) {
            const value = store.getItem(name);
            // UTF-16 code units are what the browser charges against the
            // origin's quota, and reading .length allocates nothing - encoding
            // every value here would copy the whole store to measure it.
            out.push({ name, size: (value ? value.length : 0) * 2 });
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

class TimeoutError extends Error {
    constructor(what) {
        super(`The page did not respond within the time allowed (${what}).`);
        this.name = "TimeoutError";
    }
}

function withTimeout(promise, ms, what) {
    let timer;
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new TimeoutError(what)), ms);
        }),
    ]);
}

async function runInPage(func, args = [], ms = TIMEOUT.values, what = "reading storage") {
    const results = await withTimeout(
        api.scripting.executeScript({ target: { tabId: state.tabId }, func, args }),
        ms,
        what,
    );
    return results?.[0]?.result;
}

// Storage is normally instant, but sync storage can stall on a slow profile.
// Nothing here is worth blocking the popup for.
async function storageGet(area, keys, fallback = {}) {
    try {
        return await withTimeout(api.storage[area].get(keys), TIMEOUT.storage, `${area} storage`);
    } catch {
        return fallback;
    }
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
    }, isError ? 6000 : 2600);
}

// A blocking problem, with a way out of it rather than a dead popup.
function fatal(message, action) {
    ui.error.textContent = "";

    const text = document.createElement("p");
    text.className = "banner-text";
    text.textContent = message;
    ui.error.append(text);

    if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "banner-btn";
        button.textContent = action.label;
        button.addEventListener("click", () => {
            button.disabled = true;
            Promise.resolve(action.run()).catch(() => {
                button.disabled = false;
            });
        });
        ui.error.append(button);
    }

    ui.error.hidden = false;
    ui.workspace.hidden = true;
}

function clearFatal() {
    ui.error.hidden = true;
    ui.error.textContent = "";
    ui.workspace.hidden = false;
}

function setListMessage(message) {
    ui.list.textContent = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = message;
    ui.list.append(p);
}

// --- Selection persistence (per origin, with the pre-1.2 global list as the fallback) ---

// Reads sync storage at most once ever, then records the result locally. Sync
// storage is the slowest thing the popup can touch, and this only ever mattered
// for upgrades from 1.1.
async function legacyDefaults() {
    const local = await storageGet("local", [MIGRATED_KEY]);
    if (local[MIGRATED_KEY]) return local[MIGRATED_KEY];

    const synced = await storageGet("sync", LEGACY_SYNC_KEYS);
    const defaults = {
        local: synced.stateMoverLocalKeys ?? synced.stateMoverKeys ?? [],
        session: synced.stateMoverSessionKeys ?? [],
    };
    api.storage.local.set({ [MIGRATED_KEY]: defaults }).catch(() => {});
    return defaults;
}

async function loadSelection() {
    const stored = await storageGet("local", ORIGIN_SELECTIONS_KEY);
    const saved = stored[ORIGIN_SELECTIONS_KEY]?.[state.origin] ?? (await legacyDefaults());
    for (const area of AREAS) state.selected[area] = new Set(saved[area] ?? []);
}

let saveTimer;
function saveSelection() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        const stored = await storageGet("local", ORIGIN_SELECTIONS_KEY);
        const map = stored[ORIGIN_SELECTIONS_KEY] ?? {};
        map[state.origin] = { local: [...state.selected.local], session: [...state.selected.session] };
        api.storage.local.set({ [ORIGIN_SELECTIONS_KEY]: map }).catch(() => {});
    }, 250);
}

// --- Rendering ---

function visibleKeys() {
    const needle = state.filter.toLowerCase();
    const all = state.keys[state.area];
    return needle ? all.filter((k) => k.name.toLowerCase().includes(needle)) : all;
}

function renderList() {
    const rows = visibleKeys();
    ui.list.textContent = "";

    if (!rows.length) {
        setListMessage(
            state.keys[state.area].length
                ? "No keys match that filter."
                : `No ${state.area}Storage keys on this page.`,
        );
        return;
    }

    const frag = document.createDocumentFragment();
    for (const { name, size } of rows.slice(0, MAX_ROWS)) {
        const row = document.createElement("div");
        row.className = "key-row";
        row.dataset.key = name;

        const head = document.createElement("div");
        head.className = "key-head";

        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = state.selected[state.area].has(name);
        box.id = `key-${state.area}-${name}`;
        box.dataset.role = "select";

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
        peek.dataset.role = "peek";
        peek.textContent = "▶";
        peek.setAttribute("aria-expanded", "false");
        peek.setAttribute("aria-label", `Show value of ${name}`);

        head.append(box, label, sizeEl, peek);
        row.append(head);
        frag.append(row);
    }
    ui.list.append(frag);

    if (rows.length > MAX_ROWS) {
        const note = document.createElement("p");
        note.className = "empty";
        note.textContent = `Showing the first ${MAX_ROWS} of ${rows.length}. Filter to narrow the list.`;
        ui.list.append(note);
    }
}

// One listener for the whole list rather than four per row, so re-rendering on
// every filter keystroke stays cheap.
ui.list.addEventListener("change", (e) => {
    const box = e.target;
    if (box.dataset?.role !== "select") return;
    const name = box.closest(".key-row")?.dataset.key;
    if (!name) return;
    const set = state.selected[state.area];
    if (box.checked) set.add(name);
    else set.delete(name);
    saveSelection();
    renderSummary();
});

ui.list.addEventListener("click", (e) => {
    const peek = e.target.closest?.("[data-role='peek']");
    if (!peek) return;
    const row = peek.closest(".key-row");
    if (row) togglePeek(row, peek, row.dataset.key);
});

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
        const values = await runInPage(pageReadValues, args, TIMEOUT.values, "reading a value");
        pre.textContent = prettify(values?.[state.area]?.[name] ?? "(not readable)");
    } catch (e) {
        pre.textContent = e instanceof TimeoutError ? "(the page did not respond)" : "(could not read this key)";
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
    const values = await runInPage(
        pageReadValues,
        [[...state.selected.local], [...state.selected.session]],
        TIMEOUT.values,
        "reading the selected keys",
    );
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
    ui.copy.disabled = true;
    try {
        const json = await buildSnapshot();
        await navigator.clipboard.writeText(json);
        toast(`Copied ${formatBytes(new TextEncoder().encode(json).length)} to the clipboard.`);
    } catch (e) {
        toast(`Export failed. ${e.message}`, true);
    } finally {
        renderSummary();
    }
}

async function downloadSnapshot() {
    ui.download.disabled = true;
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
        toast(`Download failed. ${e.message}`, true);
    } finally {
        renderSummary();
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
        const result = await runInPage(
            pageWriteValues,
            [Object.entries(local), Object.entries(session)],
            TIMEOUT.write,
            "writing the snapshot",
        );
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
    const generation = ++state.generation;
    const collected = await runInPage(pageCollectKeys, [], TIMEOUT.collect, "listing keys");
    if (generation !== state.generation) return; // superseded by a newer read
    if (!collected) throw new Error("The page returned nothing.");

    state.keys.local = collected.local;
    state.keys.session = collected.session;
    renderCounts();
    renderList();
    renderSummary();
}

// Chromium unloads background tabs when memory is tight, which is exactly when
// a lot of tabs are open. An unloaded tab has no renderer to inject into.
function tabIsUnloaded(tab) {
    return tab.discarded === true || tab.status === "unloaded";
}

function failureMessage(error) {
    if (error instanceof TimeoutError) {
        return "This page is not responding. It may be busy or still loading. Try again in a moment, or reload the tab.";
    }
    const detail = String(error?.message ?? error);
    if (/cannot be scripted|cannot access|Missing host permission|Extension manifest/i.test(detail)) {
        return "This page does not allow extensions to read it.";
    }
    if (/No tab with id|no longer exists|Frame with ID/i.test(detail)) {
        return "That tab is gone. Open the popup again on a live tab.";
    }
    return `Could not read this page's storage. ${detail}`;
}

async function loadPage() {
    clearFatal();
    setListMessage("Reading this page’s storage…");

    // The saved selection and the page read do not depend on each other.
    const [selectionResult, keysResult] = await Promise.allSettled([loadSelection(), refreshKeys()]);

    if (keysResult.status === "rejected") {
        fatal(failureMessage(keysResult.reason), { label: "Try again", run: loadPage });
        return;
    }
    if (selectionResult.status === "rejected") {
        toast("Could not restore your saved selection.", true);
    }
    // refreshKeys rendered before the selection landed, so paint it again.
    renderList();
    renderSummary();
}

async function init() {
    ui.copy.disabled = true;
    ui.download.disabled = true;

    let tab;
    try {
        [tab] = await withTimeout(
            api.tabs.query({ active: true, currentWindow: true }),
            TIMEOUT.storage,
            "finding the active tab",
        );
    } catch {
        fatal("Could not read the active tab.", { label: "Try again", run: init });
        return;
    }

    if (!tab?.id) {
        fatal("No active tab to read.");
        return;
    }
    state.tabId = tab.id;

    if (!tab.url || BLOCKED_URL.test(tab.url)) {
        ui.origin.textContent = "unavailable";
        fatal("State Mover can only read http and https pages. Browser-internal pages, add-on stores and local files are off limits to every extension.");
        return;
    }

    try {
        state.origin = new URL(tab.url).origin;
    } catch {
        state.origin = tab.url;
    }
    ui.origin.textContent = state.origin.replace(/^https?:\/\//, "");
    ui.origin.title = state.origin;

    if (tabIsUnloaded(tab)) {
        fatal("The browser unloaded this tab to free memory, so there is nothing to read yet. Reload it and State Mover will pick it up.", {
            label: "Reload the tab",
            run: async () => {
                await api.tabs.reload(state.tabId);
                // Give the renderer a moment to come back before reading it.
                await new Promise((r) => setTimeout(r, 600));
                await init();
            },
        });
        return;
    }

    await loadPage();
}

ui.tabLocal.addEventListener("click", () => setArea("local"));
ui.tabSession.addEventListener("click", () => setArea("session"));

let filterTimer;
ui.filter.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
        state.filter = ui.filter.value.trim();
        renderList();
    }, 120);
});

ui.selectAll.addEventListener("click", () => {
    for (const { name } of visibleKeys()) state.selected[state.area].add(name);
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
    try {
        ui.importData.value = await file.text();
        toast(`Loaded ${file.name}.`);
    } catch {
        toast("Could not read that file.", true);
    } finally {
        ui.fileInput.value = "";
    }
});

// Nothing below should ever leave the popup blank.
window.addEventListener("unhandledrejection", (e) => {
    console.error("State Mover", e.reason);
    toast(failureMessage(e.reason), true);
});

init().catch((e) => fatal(failureMessage(e), { label: "Try again", run: init }));
