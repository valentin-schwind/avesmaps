import { Agent } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { istSpaeterText } from "./src/i18n/spaete-texte";

/**
 * Der Entwicklungsserver liest `@avesmaps3d/shared` aus den Quellen dieses Checkouts statt aus dem gebauten `dist` (WI-0189,
 * Review L7-02): Ein Pull mit Änderungen am Paket brauchte sonst erst einen Neubau, und die Seite wies neue Schlüssel mit
 * „Unexpected property“ ab. Nur für `vite` (serve); der Release-Bau bleibt bei `dist`, wie `vue-tsc --build` es erzeugt.
 */
const sharedAusQuellen: Plugin = {
    name: "avesmaps-shared-aus-quellen",
    apply: "serve",
    config: () => ({
        resolve: {
            alias: [
                {
                    find: /^@avesmaps3d\/shared$/,
                    replacement: fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
                },
            ],
        },
    }),
};

/**
 * Der Entwicklungsserver bindet nachgeladene Fenster statisch ein (WI-0235, `src/nachladen.ts`): Er liefert jedes Modul einzeln aus, und
 * ein nachgeladenes Fenster stand unter Last später da, als die Browserfälle warten. Nur der Bau lädt nach.
 */
const nachladenStatisch: Plugin = {
    name: "avesmaps-nachladen-statisch",
    apply: "serve",
    config: () => ({
        resolve: {
            alias: [
                {
                    find: /^(\.{1,2}\/)+nachladen$/,
                    replacement: fileURLToPath(new URL("./src/nachladen.entwicklung.ts", import.meta.url)),
                },
            ],
        },
    }),
};

/**
 * Die deutsche Tafel in zwei Teilen, nur beim Bau (2026-11-01, WI-0235): `de.ts` bleibt die eine Quelle, aber was `istSpaeterText` nennt (die Wörter der Verwaltung, 79 KB gzip), liegt in
 * einem eigenen Chunk statt im Start jedes Besuchers. Der Entwicklungsserver und die Tests sehen die ganze Tafel und ein leeres `de-spaet.ts`; `i18n.ts` lädt den Teil nach
 * (`ladeSpaeteTexte`). Gelesen wird `de.ts` über Nodes Type-Stripping, wie der Server: Die Datei ist ein reines Objekt.
 */
const deutscheTafelTeilen: Plugin = {
    name: "avesmaps-deutsche-tafel-teilen",
    apply: "build",
    enforce: "pre",
    async load(id) {
        const pfad = id.split("?")[0]?.replace(/\\/g, "/") ?? "";
        const start = pfad.endsWith("/src/i18n/de.ts");
        if (!start && !pfad.endsWith("/src/i18n/de-spaet.ts")) return null;
        const quelle = fileURLToPath(new URL("./src/i18n/de.ts", import.meta.url));
        const { de } = (await import(pathToFileURL(quelle).href)) as { de: Record<string, string> };
        const teil = Object.fromEntries(Object.entries(de).filter(([key]) => istSpaeterText(key) !== start));
        return `export const ${start ? "de" : "deSpaet"} = ${JSON.stringify(teil)};`;
    },
};

const serverPort = Number.parseInt(process.env["PORT"] ?? "3000", 10);
const martinPort = Number.parseInt(process.env["MARTIN_PORT"] ?? "3010", 10);

/**
 * 🔴 Die Proxys reden mit ihrem Ziel über gemeinsame, offen gehaltene Verbindungen (WI-0248 S2). Ohne `agent` setzt `http-proxy`
 * `Connection: close` und öffnet je Anfrage eine neue; der Server schließt zuerst, und sein Ende bleibt zwei Minuten in TIME_WAIT. Eine
 * Seite zieht hunderte Kacheln: In einem Lauf aus Playmode, Relief und Gebietsneigung standen bis zu 7.600 solcher Verbindungen, mit
 * dem Agent unter 300. Wenn unter Windows (mit den Läufen anderer Sitzungen daneben) die Quellports für 127.0.0.1:3010 oder den eigenen
 * Fastify ausgehen, kommt `connect EADDRINUSE` als 502 („Bad Gateway“) im Browser an, mitten in einem sonst grünen Fall (Konsolenfehler
 * in `visual-relief.spec.ts`, 2026-10-23). `/ws` bleibt ohne: Eine Hochstufung braucht ihre eigene Verbindung.
 */
const verbindungen = new Agent({ keepAlive: true });
/** Fastify (Kacheln, Gelände, Medien) über die gemeinsamen Verbindungen; `/api` und `/ws` stehen darunter mit ihren eigenen Angaben. */
const fastify = { target: `http://127.0.0.1:${serverPort}`, agent: verbindungen };

/**
 * 🔴 `/api` reicht den `Host` der Seite durch, wie Nginx (`proxy_set_header Host $host`). Vites
 * Kurzform setzte `changeOrigin: true`: Fastify sah dann 127.0.0.1 statt der Seite, und die
 * Herkunftsprüfung des Kurzlinks (`Origin` gegen `Host`, WI-0034) wies jede Anfrage ab.
 */
const api = { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false, agent: verbindungen };

/**
 * `/ws` (WI-0074): der Grundkanal der Statusseite. Der `Host` bleibt der der Seite wie bei `/api`, denn der Server prüft beim Handshake,
 * ob `Origin` und `Host` derselbe Ort sind; Nginx reicht `Upgrade` für `= /ws` ebenso durch.
 */
const ws = { target: `http://127.0.0.1:${serverPort}`, ws: true, changeOrigin: false };

/** Die Baufunktionen von TypeBox, die `packages/shared` für seine Schemata aufruft (Verwendung: `build.rollupOptions.treeshake`). */
const TYPEBOX_BAUFUNKTIONEN = [
    "Any",
    "Array",
    "Boolean",
    "Composite",
    "Date",
    "Enum",
    "Integer",
    "Intersect",
    "Literal",
    "Never",
    "Null",
    "Number",
    "Object",
    "Omit",
    "Optional",
    "Partial",
    "Pick",
    "Readonly",
    "Record",
    "Ref",
    "Required",
    "String",
    "Tuple",
    "Undefined",
    "Union",
    "Unknown",
    "Unsafe",
] as const;

/** Was die Gruppe `gemeinsam` aufnehmen darf: unser Code, die Verträge und die Konfiguration. */
const GEMEINSAM_QUELLEN = /apps[\\/]web[\\/]src[\\/]|packages[\\/]shared[\\/]|[\\/]config[\\/]/;
/**
 * 🪤 Was `gemeinsam` NICHT aufnimmt (WI-0235, 2026-10-29): die Statusseite. `status-app.vue` hängt statisch an `status/main.ts` und wird von
 * `auth/verwaltung-fenster.vue` nachgeladen; für die Zählung der Einstiege (`minShareCount`) reicht das, und die Gruppe zog die ganze
 * Statusseite (rund 8 KB gzip) in den Start jedes Besuchers. Ausgenommen sind alle Dateien von `status/` bis auf `status-store` und
 * `jobs-socket` (die braucht auch die Karte: Warteschlange, Gelände) und `main` (der Einstieg der Statusseite selbst) sowie der Vertrag
 * `release-test`, den nur Statusseite und Verwaltung teilen. Sie bilden nun eigene Chunks, die nur die Statusseite und die Verwaltung laden.
 */
const GEMEINSAM_NICHT =
    /apps[\\/]web[\\/]src[\\/]status[\\/](?!status-store|jobs-socket|main)|packages[\\/]shared[\\/](dist|src)[\\/]system[\\/]release-test/;

export default defineConfig({
    plugins: [vue(), sharedAusQuellen, nachladenStatisch, deutscheTafelTeilen],
    optimizeDeps: {
        // MapLibre ships its web worker as a separate module. The dependency optimizer drops it
        // ("The file does not exist at .../maplibre-gl-worker.mjs"), and without the worker the
        // style never finishes loading - silently, with no error in the console.
        exclude: ["maplibre-gl"],
    },
    server: {
        port: 5173,
        // 🔴 Kein Hot-Reload, außer ausdrücklich verlangt (Betreiber 2026-09-24: „die Seite darf auf
        // keinen Fall neuladen“). Mehrere Sitzungen arbeiten im selben Checkout; jede gespeicherte
        // Komponente baute die offene Karte samt Routenplaner neu auf, 139-mal an einem Abend.
        // Wer beim Bauen Hot-Reload will, startet mit AVESMAPS_HMR=1.
        hmr: process.env["AVESMAPS_HMR"] === "1",
        // The API is reached through the same origin in development, like Nginx does in production
        // (chapter 4.32). No CORS special case is introduced.
        proxy: {
            "/health": `http://127.0.0.1:${serverPort}`,
            "/api": api,
            "/ws": ws,
            // Vector tiles come from Martin, raster tiles from our own server - the same split
            // Nginx makes in production (ADR-0004), so the app uses one origin in both.
            "/tiles/vector": {
                target: `http://127.0.0.1:${martinPort}`,
                rewrite: (path: string) => path.replace(/^\/tiles\/vector/, ""),
                agent: verbindungen,
            },
            "/tiles/raster": fastify,
            // Alles Gelände kommt über Fastify (WI-0049, WI-0054): Höhenkacheln und künftige Produkte unter
            // einem Präfix, wie Nginx es mit `location ^~ /tiles/terrain/` tut (Koordination 2026-09-28).
            "/tiles/terrain": fastify,
            // Die veröffentlichten Medien (WI-0063 MEDIA-M12): lokal aus Fastify, auf Stage und Production liefert
            // Nginx denselben Pfad direkt aus `shared/media/published/`.
            "/media": fastify,
        },
    },
    // 💣 `vite preview` erbt `server.proxy` NICHT. Ohne diesen Block laeuft der
    // PRODUCTION-BUILD lokal gegen ins Leere zeigende Kachelpfade - und genau deshalb war er hier
    // nie pruefbar, waehrend jeder Browsertest gegen den Dev-Server gruen blieb. Der Unterschied
    // zwischen "lokal gruen" und "auf Stage leer" hatte hier seinen blinden Fleck.
    preview: {
        port: 4179,
        proxy: {
            "/health": `http://127.0.0.1:${serverPort}`,
            "/api": api,
            "/ws": ws,
            "/tiles/vector": {
                target: `http://127.0.0.1:${martinPort}`,
                rewrite: (path: string) => path.replace(/^\/tiles\/vector/, ""),
                agent: verbindungen,
            },
            "/tiles/raster": fastify,
            "/tiles/terrain": fastify,
            "/media": fastify,
        },
    },
    build: {
        outDir: "dist",
        sourcemap: true,
        rollupOptions: {
            // Zwei Seiten: die Karte und die Statusseite (WI-0074, `status.html`, ohne Karte).
            input: {
                main: fileURLToPath(new URL("./index.html", import.meta.url)),
                status: fileURLToPath(new URL("./status.html", import.meta.url)),
            },
            // Die Bibliotheken in eigenen Chunks (WI-0235, Review L4-06): Ihr Hash ändert sich nur mit ihrer Version, nicht
            // mit jedem Release; `/assets/` ist ein Jahr `immutable`, also bleiben sie nach einem Push im Browserspeicher. Zwei
            // Gruppen, damit die Statusseite nur Vue lädt, nie MapLibre. 🪤 typebox bleibt draußen: Es braucht eine Laufzeithilfe
            // des Bündlers (`\0rolldown/runtime.js`), die keiner Gruppe angeboten wird und im App-Chunk liegt; ein Chunk, der von
            // dort importiert, trägt dessen Hash im Text und wechselt ihn mit jedem Release (gemessen 2026-10-19).
            output: {
                codeSplitting: {
                    groups: [
                        // 💣 Ohne `?worker`: Die Adresse des Workers muss im Einstiegsbündel stehen, `ops/deploy/build-release.sh`
                        // sucht sie dort und bricht den Bau sonst ab.
                        { name: "maplibre", test: /node_modules[\\/]maplibre-gl[\\/](?!.*\?worker)/, priority: 2 },
                        {
                            name: "bibliotheken",
                            test: /node_modules[\\/](vue|@vue)[\\/]/,
                            priority: 1,
                        },
                        // Seit die Editorfenster nachladen, teilen sich Start, Statusseite und Fenster viele kleine Module, und der
                        // Bündler machte daraus 20 Chunks unter 12 KB: 24 Startdateien, über HTTP/1.1 mehrere Anfragewellen. Was beim
                        // Start gebraucht wird und mehr als ein Chunk nutzt, liegt darum in EINEM Chunk (gemessen 2026-10-19: 5 Dateien,
                        // gleiches gzip; die Statusseite lädt weiter kein MapLibre).
                        {
                            name: "gemeinsam",
                            tags: ["$initial"],
                            minShareCount: 2,
                            // 🪤 Ohne die Statusseite (WI-0235, 2026-10-29): siehe `GEMEINSAM_NICHT`.
                            test: (id: string) => GEMEINSAM_QUELLEN.test(id) && !GEMEINSAM_NICHT.test(id),
                            priority: 0,
                        },
                    ],
                },
            },
            // 🔴 Die Schemata von TypeBox (`Type.Object(...)` in `packages/shared`) sind für den Bündler Aufrufe mit unbekannter Wirkung. Jedes
            // Modul von `shared`, aus dem das Web auch nur eine Konstante braucht, brachte darum ALLE seine Schemata mit (`"sideEffects": false`
            // hilft nur, wenn gar nichts aus dem Modul gebraucht wird): bei jedem neuen Vertrag wuchs der Start (1.004 auf 1.032 KB gzip in drei
            // Tagen, 2026-10-26 bis 29). Als reine Aufrufe gelten sie, wo ihr Ergebnis unbenutzt bleibt, als totes Gut (Start -20 KB gzip, `shared`
            // 478 auf 378 KB). Benutzte Schemata bleiben, nur Unbenutztes fällt. Die Liste sind alle Baufunktionen von `Type`; wer ein neues
            // `Type.Xyz(...)` im Bündel sieht, ergänzt es hier.
            treeshake: { manualPureFunctions: TYPEBOX_BAUFUNKTIONEN.map((name) => `Type.${name}`) },
        },
    },
});
