import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AdminSystemzustand, SYSTEMZUSTAND_NACHSEHEN_MS } from "@avesmaps3d/shared";
import {
    auslastung,
    bytes,
    createSystemzustand,
    dauer,
    komponentenZeile,
    plattenZeile,
    prozessZeile,
    schienenWert,
    verbindungenText,
    verlauf,
} from "../src/auth/systemzustand.ts";

/**
 * Der Eintrag „Systemzustand“ (WI-0127 SYS-8) ohne Browser: Zeilen der Komponenten wie im Blatt A7 („läuft“, „bereit“, „erreichbar“, sonst
 * Zustand mit Grund; „Messwert fehlt“ statt einer Zeit), die Zahl in der Schiene, Bytes, die Auslastung mit „unbekannt“ statt 0, die Warnung
 * „Platte unter 15 % frei“, die Linien des Verlaufs mit Lücken, und das Nachsehen alle 30 s.
 */

const NOW = new Date("2026-10-10T18:00:00Z");
const GB = 1024 ** 3;

function stand(patch: Partial<AdminSystemzustand> = {}): AdminSystemzustand {
    const body: AdminSystemzustand = {
        now: NOW.toISOString(),
        datei: { zustand: "nicht_eingerichtet", stand: null, host: null, neueresFormat: false },
        komponenten: [
            {
                id: "fastify",
                zustand: "gesund",
                seit: "2026-10-09T21:18:00Z",
                version: "Release 028ec13 · Node 24.14.1",
                hinweis: null,
            },
            { id: "routing", zustand: "gesund", seit: "2026-10-09T21:19:00Z", version: null, hinweis: "ready" },
            { id: "jobs", zustand: "gesund", seit: null, version: null, hinweis: "lock_held" },
            {
                id: "postgresql",
                zustand: "gesund",
                seit: "2026-09-16T04:02:00Z",
                version: "18.6 · PostGIS 3.6",
                hinweis: null,
            },
            { id: "martin", zustand: "gesund", seit: null, version: null, hinweis: "probe_ok" },
            { id: "nginx", zustand: "unbekannt", seit: null, version: null, hinweis: "not_set_up" },
            { id: "sicherung", zustand: "unbekannt", seit: null, version: null, hinweis: "backup_not_set_up" },
        ],
        auslastung: {
            last: { eins: 0.18, fuenf: 0.24, fuenfzehn: 0.21 },
            kerne: 4,
            speicher: {
                gesamt: Math.round(7.7 * GB),
                belegt: Math.round(3.4 * GB),
                auslagerung: 0,
                auslagerungGesamt: 2 * GB,
            },
            prozesse: [
                { id: "fastify", rss: 410 * 1024 ** 2 },
                { id: "routing", rss: null, imProzess: "fastify", heap: null, graph: null },
                { id: "jobs", rss: null },
            ],
            laufzeit: { system: 23 * 86_400 + 5, prozess: 77_000 },
            platten: [{ id: "kacheln", quelle: "anwendung", gesamt: 232 * GB, frei: 157 * GB }],
        },
        verlauf: [
            { bucket: "2026-10-10T17:50:00Z", last1: 0.1, belegt: 3 * GB, auslagerung: 0 },
            { bucket: "2026-10-10T17:55:00Z", last1: null, belegt: null, auslagerung: null },
            { bucket: "2026-10-10T18:00:00Z", last1: 0.9, belegt: Math.round(3.4 * GB), auslagerung: 0 },
        ],
        datenbank: {
            groesse: Math.round(1.31 * GB),
            verbindungen: { belegt: 14, erlaubt: 100, reserviert: 3, eigene: { active: 1, idle: 5 } },
            tabellen: [],
        },
        groessen: null,
        tuer: null,
        dienste: [],
        ...patch,
    };
    expect(Value.Check(AdminSystemzustand, body)).toBe(true);
    return body;
}

describe("Komponenten (Blatt A7)", () => {
    it("🔴 gesund je Komponente in eigenen Worten; unbekannt mit „Messwert fehlt“ statt einer Zeit, nie eine Null", () => {
        const [fastify, routing, , postgres, , nginx, sicherung] = stand().komponenten.map((entry) =>
            komponentenZeile(entry, NOW),
        );
        expect(fastify).toMatchObject({
            name: "Fastify",
            aufgabe: "Beantwortet die Anfragen der Seite: Kartendaten, Suche, Reisen, Konten und Editor.",
            zustand: "läuft",
            ton: "erfolg",
            version: "Release 028ec13 · Node 24.14.1",
        });
        expect(fastify!.seit).toMatch(/^seit /u);
        expect(routing).toMatchObject({ name: "Routing-Worker", zustand: "bereit" });
        // Jede Komponente sagt, was sie tut (Betreiber 2026-10-11).
        for (const zeile of stand().komponenten.map((entry) => komponentenZeile(entry, NOW)))
            expect(zeile.aufgabe).not.toMatch(/^admin\.health/u);
        expect(postgres).toMatchObject({ zustand: "erreichbar", version: "18.6 · PostGIS 3.6" });
        expect(nginx).toMatchObject({
            name: "Nginx und Tür",
            zustand: "unbekannt",
            ton: "ruhe",
            seit: "Messwert fehlt",
            version: "–",
        });
        expect(sicherung).toMatchObject({ zustand: "unbekannt", seit: "noch nicht eingerichtet" });
    });

    it("Warnung und Ausfall mit Grund, wenn eine Zeit bekannt ist", () => {
        const laedt = komponentenZeile(
            { id: "routing", zustand: "warnung", seit: "2026-10-10T17:59:00Z", version: null, hinweis: "warming" },
            NOW,
        );
        expect(laedt).toMatchObject({ zustand: "Warnung: lädt das Netz", ton: "warnung" });
        const tot = komponentenZeile(
            { id: "jobs", zustand: "ausgefallen", seit: null, version: null, hinweis: "no_planner" },
            NOW,
        );
        expect(tot).toMatchObject({ zustand: "ausgefallen", ton: "gefahr", seit: "kein Planer aktiv" });
    });

    it("🔴 die Schiene nennt das Schwerste mit Zahl; alles gesund: nichts", () => {
        expect(schienenWert(null)).toBeUndefined();
        expect(schienenWert(stand())).toBe("2 unbekannt");
        const komponenten = stand().komponenten.map((entry) =>
            entry.id === "jobs" ? { ...entry, zustand: "ausgefallen" as const } : entry,
        );
        expect(schienenWert(stand({ komponenten }))).toBe("1 ausgefallen");
        const gesund = stand().komponenten.map((entry) => ({ ...entry, zustand: "gesund" as const }));
        expect(schienenWert(stand({ komponenten: gesund }))).toBeUndefined();
    });
});

describe("Auslastung, Datenbank, Verlauf (§3.7, §6.3)", () => {
    it("🔴 eine Zeile je Prozess: Routing als Thread mit Heap und Graph, Jobs mit den laufenden Jobs (WI-0127 §22)", () => {
        const MB = 1024 ** 2;
        expect(prozessZeile({ id: "routing", rss: null, imProzess: "fastify", heap: 64 * MB, graph: 180 * MB })).toBe(
            "Routing-Worker im Fastify-Prozess: Heap 64 MB, Graph 180 MB",
        );
        expect(prozessZeile({ id: "routing", rss: null, imProzess: "fastify", heap: 64 * MB, graph: null })).toBe(
            "Routing-Worker im Fastify-Prozess: Heap 64 MB, Graph unbekannt",
        );
        expect(prozessZeile({ id: "jobs", rss: 85 * MB, kinder: { anzahl: 0, rss: 0 } })).toBe("Jobs-Worker 85 MB");
        expect(prozessZeile({ id: "jobs", rss: 85 * MB, kinder: { anzahl: 1, rss: 1.2 * 1024 * MB } })).toBe(
            "Jobs-Worker 85 MB, dazu 1 laufender Job mit 1,2 GB",
        );
        expect(prozessZeile({ id: "jobs", rss: 85 * MB, kinder: { anzahl: 3, rss: 2 * 1024 * MB } })).toBe(
            "Jobs-Worker 85 MB, dazu 3 laufende Jobs mit 2 GB",
        );
        // Ein älterer Server ohne die neuen Felder: wie bisher.
        expect(prozessZeile({ id: "jobs", rss: null })).toBe("Jobs-Worker unbekannt");
    });

    it("🔴 Werte wie im Blatt; fehlt einer, heißt er „unbekannt“, nie 0", () => {
        const a = auslastung(stand(), NOW);
        expect(a.prozessor).toEqual({
            haupt: "0,18 · 0,24 · 0,21",
            zusatz: "Last über 1, 5 und 15 min, 4 Kerne",
            // Die Last der letzten Minute je Kern, neben dem Verlauf (Betreiber 2026-10-11).
            prozent: "5 %",
        });
        expect(a.speicher.prozent).toBe("44 %");
        expect(a.speicher.haupt).toBe("3,4 GB von 7,7 GB belegt");
        expect(a.speicher.zusatz).toBe("4,3 GB frei, Auslagerung 0 von 2 GB");
        expect(a.speicher.prozesse).toEqual([
            "Fastify 410 MB",
            "Routing-Worker im Fastify-Prozess: unbekannt",
            "Jobs-Worker unbekannt",
        ]);
        expect(a.laufzeit).toMatch(/^Server seit 23 Tagen · Fastify seit /u);
        const windows = auslastung(
            stand({
                auslastung: {
                    ...stand().auslastung,
                    last: null,
                    speicher: { gesamt: 8 * GB, belegt: 4 * GB, auslagerung: null, auslagerungGesamt: null },
                },
            }),
            NOW,
        );
        expect(windows.prozessor).toEqual({
            haupt: "unbekannt",
            zusatz: "auf diesem Rechner nicht messbar",
            prozent: null,
        });
        expect(windows.speicher.prozent).toBe("50 %");
        expect(windows.speicher.zusatz).toBe("4 GB frei, Auslagerung unbekannt");
        expect(verbindungenText(stand())).toBe("14 von 100 belegt");
        expect(verbindungenText(stand({ datenbank: { groesse: null, verbindungen: null, tabellen: [] } }))).toBe(
            "unbekannt",
        );
    });

    it("Bytes, Dauer und die Warnung „unter 15 % frei“ (nur Anzeige)", () => {
        expect(bytes(null)).toBe("unbekannt");
        expect(bytes(0)).toBe("0");
        expect(bytes(512)).toBe("512 B");
        expect(bytes(1.31 * GB)).toBe("1,3 GB");
        expect(dauer(3600 * 5)).toBe("5 Stunden");
        expect(dauer(86_400)).toBe("1 Tag");
        expect(plattenZeile({ id: "kacheln", quelle: "anwendung", gesamt: 232 * GB, frei: 157 * GB })).toEqual({
            name: "Kacheln",
            text: "157 GB frei von 232 GB (68 %)",
            ton: null,
        });
        expect(plattenZeile({ id: "/", quelle: "datei", gesamt: 232 * GB, frei: 21 * GB }).ton).toBe("warnung");
        expect(plattenZeile({ id: "/", quelle: "datei", gesamt: null, frei: null })).toEqual({
            name: "/",
            text: "unbekannt",
            ton: "ruhe",
        });
    });

    it("🔴 der Verlauf behält Lücken als Lücken; der Satz für Vorleser nennt zuletzt und höchstens", () => {
        const linien = verlauf(stand());
        expect(linien.last).toEqual([0.1, null, 0.9]);
        expect(linien.speicher[1]).toBeNull();
        expect(linien.lastSatz).toBe("Last über 24 Stunden, zuletzt 0,90, höchstens 0,90");
        expect(verlauf(stand({ verlauf: [] })).lastSatz).toBe("noch kein Verlauf");
    });
});

describe("Nachsehen", () => {
    it("alle 30 s, solange der Eintrag offen ist; geschlossen nicht", async () => {
        const pending: { ms: number }[] = [];
        const fetcher = (async () => new Response(JSON.stringify(stand()), { status: 200 })) as typeof fetch;
        const zustand = createSystemzustand({
            fetcher,
            ask: async () => true,
            setTimer: (_callback, ms) => {
                const entry = { ms };
                pending.push(entry);
                return entry;
            },
            clearTimer: (handle) => {
                const index = pending.indexOf(handle as { ms: number });
                if (index >= 0) pending.splice(index, 1);
            },
        });
        zustand.follow(true);
        await zustand.load();
        expect(zustand.stand.value?.komponenten).toHaveLength(7);
        expect(pending.map((entry) => entry.ms)).toEqual([SYSTEMZUSTAND_NACHSEHEN_MS]);
        zustand.follow(false);
        expect(pending).toEqual([]);
    });
});
