// Demo data for screenshots. Deliberately fictional - never ship a real page's keys.
const LOCAL = [
  ["auth.session", JSON.stringify({ token: "eyJhbGciOiJIUzI1NiJ9.demo", exp: 1789000000 })],
  ["currentUser", JSON.stringify({ id: 4821, name: "Ada Lovelace", email: "ada@acme.test", roles: ["admin", "engineer"] })],
  ["feature-flags", JSON.stringify({ newNav: true, betaSearch: false, darkMode: true, bulkEdit: true })],
  ["onboarding.completed", "true"],
  ["recent-projects", JSON.stringify(["apollo", "borealis", "cygnus"])],
  ["ui.sidebar.width", "280"],
  ["ui.table.density", "compact"],
  ["user.preferences.viewer-settings", JSON.stringify({ theme: "system", fontSize: 14, wrapLines: true })],
  ["workspace.lastOpened", "2026-08-25T09:14:02.881Z"],
];
const SESSION = [
  ["draft.issue-2841", JSON.stringify({ title: "Flaky import test", body: "Repro on CI only" })],
  ["nav.scrollTop", "1240"],
];
const enc = new TextEncoder();
const store = { local: new Map(LOCAL), session: new Map(SESSION) };
const PRESELECTED = ["auth.session", "currentUser", "feature-flags"];

globalThis.chrome = {
  tabs: {
    query: async () => [{ id: 1, url: "https://app.acme.test/dashboard" }],
    reload: async () => {},
  },
  storage: {
    sync: { get: async () => ({}) },
    local: {
      get: async () => ({
        stateMoverOriginSelections: {
          "https://app.acme.test": { local: PRESELECTED, session: [] },
        },
      }),
      set: async () => {},
    },
  },
  scripting: {
    executeScript: async ({ func, args = [] }) => {
      const shape = (m) =>
        [...m].map(([name, v]) => ({ name, size: enc.encode(v).length }))
              .sort((a, b) => a.name.localeCompare(b.name));
      if (func.name === "pageCollectKeys")
        return [{ result: { origin: "https://app.acme.test", local: shape(store.local), session: shape(store.session) } }];
      if (func.name === "pageReadValues") {
        const grab = (m, ks) => Object.fromEntries(ks.filter((k) => m.has(k)).map((k) => [k, m.get(k)]));
        return [{ result: { local: grab(store.local, args[0]), session: grab(store.session, args[1]) } }];
      }
      if (func.name === "pageWriteValues")
        return [{ result: { local: args[0].length, session: args[1].length } }];
      return [{ result: null }];
    },
  },
};
