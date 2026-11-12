import type { Page, Route } from "@playwright/test";
import type {
    KanalBericht,
    KanalBerichte,
    KanalListe,
    KanalReiter,
    KanalVorgang,
    KanalZeile,
} from "@avesmaps3d/shared";

/**
 * Der Betreiber-Kanal ohne Datenbank (WI-0124, KANAL-0001 K3): ein kleiner Server im Speicher für `/api/kanal/**` mit denselben Regeln wie
 * die Funktionen der Migration 0106, soweit die Oberfläche sie braucht (Revision beim Abnehmen und Wieder öffnen, Löschen nur abgenommen).
 * Die echten Routen prüft `apps/server/test/kanal-routes.test.ts`. Die Vorgänge sind die des Blatts (erfunden).
 */

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;
export const RONDRIKAN = { id: "0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51", name: "Rondrikan" };
export const HESINDIANE = { id: "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e", name: "Hesindiane" };

function vorgang(patch: Partial<KanalVorgang> & Pick<KanalVorgang, "ops" | "titel">): KanalVorgang {
    return {
        art: "meldung",
        kategorie: "bug",
        prioritaet: "normal",
        status: "neu",
        zustaendig: "claudio",
        kurztitel: null,
        gemeldetVon: RONDRIKAN,
        gemeldetAt: ago(40 * MIN),
        abgenommenAt: null,
        // Wie der Vorgang endete, und nur solange er abgenommen ist (WI-0145, `KanalZeile.abschluss`): offen also `null`.
        abschluss: null,
        abgelaufenAt: null,
        nachweise: 0,
        // Nachweise ohne die Abnahme (2026-10-16): nur sie entscheiden über den Weg der Leiste.
        fixNachweise: 0,
        letzteAktivitaet: ago(20 * MIN),
        aufbewahrtBis: null,
        runde: 1,
        revision: 3,
        nachricht: "Beschreibung (erfunden).",
        schritte: null,
        kontext: { umgebung: "staging", release: "20261011T093012Z-b7e2d41" },
        abgenommenVon: null,
        vonHandGeloescht: false,
        folgtAuf: null,
        eintraege: [],
        alleNachweise: [],
        aenderungen: [],
        bilder: [],
        ...patch,
    };
}

export function kanalVorgaenge(): KanalVorgang[] {
    return [
        vorgang({
            ops: "OPS-000134",
            titel: "Stage lädt keine Kacheln",
            kategorie: "stoerung",
            prioritaet: "dringend",
            status: "in_arbeit",
            gemeldetVon: HESINDIANE,
            nachricht: "Seit dem Neuladen bleibt die Karte bei Gareth grau, nur die Beschriftungen kommen.",
            kontext: {
                umgebung: "staging",
                release: "20261011T093012Z-b7e2d41",
                geraet: "Telefon · Chrome 141 · 412 × 915",
            },
            eintraege: [
                {
                    seq: 1,
                    art: "status",
                    von: { art: "claudio" },
                    text: null,
                    statusVon: "neu",
                    statusNach: "in_arbeit",
                    bild: null,
                    at: ago(25 * MIN),
                },
                {
                    seq: 2,
                    art: "rueckfrage",
                    von: { art: "claudio" },
                    text: "Welches Telefon und welcher Browser?",
                    statusVon: null,
                    statusNach: null,
                    bild: null,
                    at: ago(24 * MIN),
                },
            ],
        }),
        vorgang({
            ops: "OPS-000127",
            titel: "See-321 wird sichtbar",
            prioritaet: "hoch",
            status: "zur_abnahme",
            zustaendig: "claudia",
            kurztitel: "Platzhaltername See-321 im Infopanel sichtbar",
            nachweise: 3,
            fixNachweise: 3,
            revision: 9,
            alleNachweise: [
                {
                    runde: 1,
                    station: "fix_committed",
                    commit: "b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621",
                    release: null,
                    notiz: null,
                    von: { art: "claudia" },
                    at: ago(DAY),
                },
                {
                    runde: 1,
                    station: "auf_stage",
                    commit: null,
                    release: "20261011T093012Z-b7e2d41",
                    notiz: null,
                    von: { art: "claudio" },
                    at: ago(5 * 3_600_000),
                },
                {
                    runde: 1,
                    station: "claudia_nachgeprueft",
                    commit: "b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621",
                    release: null,
                    notiz: null,
                    von: { art: "claudia" },
                    at: ago(4 * 3_600_000),
                },
            ],
            aenderungen: [
                {
                    id: 41,
                    runde: 1,
                    agent: "claudia",
                    klasse: "B",
                    art: "code",
                    was: "Platzhalterregel im geteilten Paket",
                    dateien: ["packages/shared/src/x.ts"],
                    commit: "b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621",
                    release: "20261011T093012Z-b7e2d41",
                    tests: "Unit 5, Browser 1",
                    ruecknahme: "Revert b7e2d41",
                    at: ago(DAY),
                    nachpruefung: "ok",
                    nachgeprueftAt: ago(4 * 3_600_000),
                    nachpruefungNotiz: null,
                    beobachtungen: [{ ergebnis: "unauffaellig", text: null, at: ago(3 * 3_600_000) }],
                },
            ],
        }),
        vorgang({
            ops: "OPS-000098",
            titel: null,
            nachricht: null,
            kurztitel: "Infopanel zeigte Platzhalternamen bei Seen",
            status: "abgenommen",
            gemeldetVon: null,
            gemeldetAt: ago(100 * DAY),
            abgenommenAt: ago(92 * DAY),
            abschluss: "abnahme",
            abgelaufenAt: ago(2 * DAY),
            // Der Fall vom 2026-10-16 (echt an OPS-000002): Fix committed, dann abgenommen — „Auf Stage“ und „Claudia
            // nachgeprüft“ hat nie jemand gesetzt. Sie sind entfallen, nicht offen.
            nachweise: 2,
            fixNachweise: 1,
            alleNachweise: [
                {
                    runde: 1,
                    station: "fix_committed",
                    commit: "7f39ab3456fc348d58d2d0abdb4866fba137701b",
                    release: null,
                    notiz: null,
                    von: { art: "claudia" },
                    at: ago(95 * DAY),
                },
                {
                    runde: 1,
                    station: "betreiber_abnahme",
                    commit: null,
                    release: null,
                    notiz: null,
                    von: { art: "person", ...HESINDIANE },
                    at: ago(92 * DAY),
                },
            ],
            kontext: {},
        }),
    ];
}

export interface KanalServer {
    vorgaenge: KanalVorgang[];
    posts: { path: string; body: Record<string, unknown> }[];
    /** Wann die Routine zuletzt abholte, als Abstand zu jetzt in ms (null: nie). Vorgabe vor 10 Minuten: Sie läuft. */
    abgeholtVor: { claudio: number | null; claudia: number | null };
    handle(
        method: string,
        path: string,
        query: URLSearchParams,
        body: Record<string, unknown> | null,
    ): { status: number; body: unknown };
}

const ZEILE: readonly (keyof KanalZeile)[] = [
    "ops",
    "art",
    "kategorie",
    "prioritaet",
    "status",
    "zustaendig",
    "titel",
    "kurztitel",
    "gemeldetVon",
    "gemeldetAt",
    "abgenommenAt",
    "abschluss",
    "abgelaufenAt",
    "nachweise",
    "letzteAktivitaet",
    "aufbewahrtBis",
];
const zeileVon = (v: KanalVorgang): KanalZeile =>
    ({
        ...Object.fromEntries(ZEILE.map((feld) => [feld, v[feld]])),
        // 🪤 Die Zeile trägt die ANZAHL der Fix-Berichte, der Vorgang die Berichte selbst (WI-0162).
        aenderungen: v.aenderungen.length,
        // Nachweise ohne die Abnahme: nur sie entscheiden über den Weg (2026-10-16).
        fixNachweise: v.fixNachweise,
    }) as KanalZeile;

const imReiter = (v: KanalVorgang, reiter: KanalReiter): boolean =>
    reiter === "offen"
        ? !["zur_abnahme", "abgenommen"].includes(v.status)
        : reiter === "abnahme"
          ? v.status === "zur_abnahme"
          : v.status === "abgenommen";

const fehler = (status: number, code: string) => ({ status, body: { error: { code, message: "vom Nachbau" } } });
const quittung = (body: Record<string, unknown>, ops: string, revision?: number) => ({
    status: 200,
    body: {
        operationId: body["operationId"],
        status: "applied",
        environment: "staging",
        affected: [{ kind: "kanal_vorgang", id: ops, ...(revision === undefined ? {} : { revision }) }],
        derivedWork: [],
        warnings: [],
    },
});

export function kanalServer(initial: KanalVorgang[] = kanalVorgaenge()): KanalServer {
    const server: KanalServer = {
        vorgaenge: structuredClone(initial),
        posts: [],
        abgeholtVor: { claudio: 10 * MIN, claudia: null },
        handle(method, path, query, body) {
            const finde = (ops: string) => server.vorgaenge.find((v) => v.ops === ops);
            const abgeholt = () => ({
                claudio: server.abgeholtVor.claudio === null ? null : ago(server.abgeholtVor.claudio),
                claudia: server.abgeholtVor.claudia === null ? null : ago(server.abgeholtVor.claudia),
            });
            if (method === "GET" && path === "/api/kanal/zaehler")
                return {
                    status: 200,
                    body: {
                        abnahme: server.vorgaenge.filter((v) => v.status === "zur_abnahme").length,
                        zuletztAbgeholt: abgeholt(),
                    },
                };
            if (method === "GET" && path === "/api/kanal/aenderungen") {
                // Die Fix-Berichte aller Vorgänge und einer ohne Vorgang, neueste oben (dauerhaft, auch am Rest).
                const berichte: KanalBericht[] = [
                    ...server.vorgaenge.flatMap((v) => v.aenderungen.map((a) => ({ ...a, ops: v.ops, grund: null }))),
                    {
                        id: 40,
                        runde: null,
                        agent: "claudio",
                        klasse: "A",
                        art: "betrieb",
                        was: "Dienst neu gestartet nach Speicherspitze",
                        dateien: [],
                        commit: null,
                        release: null,
                        tests: null,
                        ruecknahme: null,
                        at: ago(2 * DAY),
                        nachpruefung: null,
                        nachgeprueftAt: null,
                        nachpruefungNotiz: null,
                        beobachtungen: [],
                        ops: null,
                        grund: "Routine",
                    },
                ];
                berichte.sort((a, b) => b.id - a.id);
                // Die Suche wie der Server (`routes/kanal.ts`): was, Commit, Release, Grund, OPS-Nummer.
                const q = query.get("q")?.toLocaleLowerCase();
                const antwort: KanalBerichte = {
                    berichte:
                        q === undefined
                            ? berichte
                            : berichte.filter((b) =>
                                  [b.was, b.commit, b.release, b.grund, b.ops].some((feld) =>
                                      (feld ?? "").toLocaleLowerCase().includes(q),
                                  ),
                              ),
                    weiter: null,
                };
                return { status: 200, body: antwort };
            }
            if (method === "GET" && path === "/api/kanal/vorgaenge") {
                const reiter = (query.get("reiter") ?? "offen") as KanalReiter;
                const liste: KanalListe = {
                    now: new Date().toISOString(),
                    reiter,
                    zaehler: {
                        offen: server.vorgaenge.filter((v) => imReiter(v, "offen")).length,
                        abnahme: server.vorgaenge.filter((v) => imReiter(v, "abnahme")).length,
                        archiv: server.vorgaenge.filter((v) => imReiter(v, "archiv")).length,
                    },
                    zuletztAbgeholt: abgeholt(),
                    // Die Suche wie der Server: Nummer, Titel, Kurztitel, Meldung, Schritte und Verlauf.
                    zeilen: server.vorgaenge
                        .filter((v) => imReiter(v, reiter))
                        .filter((v) => {
                            const q = query.get("q")?.toLocaleLowerCase();
                            if (q === undefined) return true;
                            return [
                                v.ops,
                                v.titel,
                                v.kurztitel,
                                v.nachricht,
                                v.schritte,
                                ...v.eintraege.map((e) => e.text),
                            ].some((feld) => (feld ?? "").toLocaleLowerCase().includes(q));
                        })
                        .map(zeileVon),
                };
                return { status: 200, body: liste };
            }
            if (method === "POST" && /^\/api\/kanal\/bilder\/[0-9a-f-]{36}\/entfernen$/u.test(path) && body !== null) {
                server.posts.push({ path, body });
                const id = path.split("/")[4]!;
                for (const v of server.vorgaenge) {
                    const i = v.bilder.findIndex((bild) => bild.id === id);
                    if (i < 0) continue;
                    v.bilder.splice(i, 1);
                    v.eintraege.push({
                        seq: v.eintraege.length + 1,
                        art: "bild_entfernt",
                        von: { art: "person", ...RONDRIKAN },
                        text: null,
                        statusVon: null,
                        statusNach: null,
                        bild: id,
                        at: new Date().toISOString(),
                    });
                    return quittung(body, v.ops);
                }
                return fehler(404, "kanal_not_found");
            }
            const treffer = /^\/api\/kanal\/vorgaenge\/(OPS-\d{6})(?:\/([a-z-]+))?$/u.exec(path);
            if (method === "GET" && treffer !== null && treffer[2] === undefined) {
                const v = finde(treffer[1]!);
                return v === undefined ? fehler(404, "kanal_not_found") : { status: 200, body: v };
            }
            if (method !== "POST" || body === null) return fehler(404, "not_found");
            server.posts.push({ path, body });
            if (path === "/api/kanal/vorgaenge") {
                const ops = `OPS-${String(135 + server.vorgaenge.length).padStart(6, "0")}`;
                server.vorgaenge.unshift(
                    vorgang({
                        ops,
                        titel: String(body["titel"]),
                        nachricht: String(body["nachricht"]),
                        kategorie: String(body["kategorie"]),
                        prioritaet: body["prioritaet"] as KanalVorgang["prioritaet"],
                        zustaendig: ["umbau", "karteninhalt"].includes(String(body["kategorie"]))
                            ? "claudia"
                            : "claudio",
                        gemeldetAt: new Date().toISOString(),
                        kontext: {
                            umgebung: "staging",
                            release: "20261011T093012Z-b7e2d41",
                            ...((body["kontext"] as Record<string, string>) ?? {}),
                        },
                        revision: 1,
                    }),
                );
                return quittung(body, ops);
            }
            if (treffer === null) return fehler(404, "not_found");
            const v = finde(treffer[1]!);
            if (v === undefined) return fehler(404, "kanal_not_found");
            const was = treffer[2];
            if (was === "bilder") {
                const file = body["file"] as { name: string; dataBase64: string };
                const id = `6b616e61-6c00-4000-9000-${String(v.bilder.length + 1).padStart(12, "0")}`;
                const seq = v.eintraege.length + 1;
                v.eintraege.push({
                    seq,
                    art: "bild",
                    von: { art: "person", ...RONDRIKAN },
                    text: null,
                    statusVon: null,
                    statusNach: null,
                    bild: id,
                    at: new Date().toISOString(),
                });
                v.bilder.push({
                    id,
                    zustand: "bereit",
                    format: file.name.endsWith(".png") ? "png" : "webp",
                    breite: 1920,
                    hoehe: 2560,
                    eintragSeq: seq,
                    at: new Date().toISOString(),
                    abgewiesenGrund: null,
                });
                v.revision += 1;
                return quittung(body, v.ops);
            }
            if (was === "nachricht") {
                v.eintraege.push({
                    seq: v.eintraege.length + 1,
                    art: "nachricht",
                    von: { art: "person", ...RONDRIKAN },
                    text: String(body["text"]),
                    statusVon: null,
                    statusNach: null,
                    bild: null,
                    at: new Date().toISOString(),
                });
                v.revision += 1;
                return quittung(body, v.ops);
            }
            if (was === "abnehmen" || was === "wieder-oeffnen") {
                if (body["baseRevision"] !== v.revision) return fehler(409, "kanal_conflict");
                if (v.status !== "zur_abnahme") return fehler(409, "kanal_transition");
                if (was === "abnehmen") {
                    v.status = "abgenommen";
                    v.abschluss = "abnahme";
                    v.abgenommenAt = new Date().toISOString();
                    v.abgenommenVon = RONDRIKAN;
                    v.aufbewahrtBis = new Date(Date.now() + 90 * DAY).toISOString();
                    v.alleNachweise.push({
                        runde: v.runde,
                        station: "betreiber_abnahme",
                        commit: null,
                        release: null,
                        notiz: null,
                        von: { art: "person", ...RONDRIKAN },
                        at: new Date().toISOString(),
                    });
                    v.nachweise = Math.min(4, v.nachweise + 1);
                } else {
                    v.status = "in_arbeit";
                    v.abschluss = null;
                    v.runde += 1;
                    v.nachweise = 0;
                    v.eintraege.push({
                        seq: v.eintraege.length + 1,
                        art: "nachricht",
                        von: { art: "person", ...RONDRIKAN },
                        text: String(body["kommentar"]),
                        statusVon: null,
                        statusNach: null,
                        bild: null,
                        at: new Date().toISOString(),
                    });
                }
                v.revision += 1;
                return quittung(body, v.ops, v.revision);
            }
            if (was === "loeschen") {
                if (v.status !== "abgenommen") return fehler(409, "kanal_transition");
                Object.assign(v, {
                    titel: null,
                    nachricht: null,
                    schritte: null,
                    kontext: {},
                    gemeldetVon: null,
                    abgenommenVon: null,
                    eintraege: [],
                    bilder: [],
                    abgelaufenAt: new Date().toISOString(),
                    vonHandGeloescht: true,
                    aufbewahrtBis: null,
                });
                return quittung(body, v.ops);
            }
            return fehler(404, "not_found");
        },
    };
    return server;
}

/** Ein Pixel PNG für die Auslieferung der Bilder im Nachbau. */
const PIXEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8z/D/PwAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
);

/** Leitet `/api/kanal/**` an den Nachbau. */
export async function stubKanal(page: Page, server: KanalServer = kanalServer()): Promise<KanalServer> {
    await page.route("**/api/kanal/**", async (route: Route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "GET" && /^\/api\/kanal\/bilder\/[0-9a-f-]{36}$/u.test(url.pathname)) {
            await route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
            return;
        }
        const antwort = server.handle(
            request.method(),
            url.pathname,
            url.searchParams,
            request.method() === "POST" ? (request.postDataJSON() as Record<string, unknown>) : null,
        );
        await route.fulfill({
            status: antwort.status,
            contentType: "application/json",
            body: JSON.stringify(antwort.body),
        });
    });
    return server;
}
