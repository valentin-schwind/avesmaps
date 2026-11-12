import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    buildReportStamp,
    buildSetName,
    catalogFetchFailureFinding,
    catalogNotFetchedFinding,
    isDataChanging,
    landlessPortsFinding,
    landlessPortsSection,
    legacyGetSelfHealsFinding,
    PUBLIC_CITYMAPS_ENDPOINT,
    PUBLIC_GAME_LITERATURE_ENDPOINT,
    PUBLIC_LOCATION_REVIEWS_ENDPOINT,
    PUBLIC_WIKI_LINKZIELE_ENDPOINT,
    PUBLIC_WIKI_ZUORDNUNG_ENDPOINT,
    PUBLIC_LORE_EXPORT_ENDPOINT,
    pathRunsChanged,
    powerlineProbeFinding,
    revisionMismatchFinding,
    REGIONS_FILE_STALE_AFTER_MINUTES,
    regionsFileStatus,
    reliefChanged,
    requestTerritories,
    retryAfterMs,
    revisionsMatch,
    sha256Hex,
    summarizePhase,
    terrainDeriveChanged,
    terrainDeriveOk,
} from "../src/migration/legacy-update.ts";

describe("revisionsMatch (drei Legacy-Antworten auf einem Stand)", () => {
    it("passt, wenn der Regions-Export beide Revisionen der anderen zwei nennt", () => {
        expect(revisionsMatch(156137, 87971, { map_revision: 156137, ecosystem_revision: 87971 })).toBe(true);
    });
    it("passt nicht, wenn zwischen den Abrufen gespeichert wurde", () => {
        expect(revisionsMatch(156138, 87971, { map_revision: 156137, ecosystem_revision: 87971 })).toBe(false);
        expect(revisionsMatch(156137, 87972, { map_revision: 156137, ecosystem_revision: 87971 })).toBe(false);
    });
    it("passt nicht, wenn eine Revision fehlt - dann ist nichts belegt", () => {
        expect(revisionsMatch(undefined, 87971, { map_revision: 156137, ecosystem_revision: 87971 })).toBe(false);
        expect(revisionsMatch(156137, 87971, {})).toBe(false);
    });
});

describe("revisionsMatch mit den Herrschaftsgebieten (vierte Quelle, WI-0062)", () => {
    const regions = { map_revision: 157006, ecosystem_revision: 88125 };
    it("verlangt, dass der Export der Gebiete die map_revision von map-features.php traegt", () => {
        expect(revisionsMatch(157006, 88125, regions, { map_revision: 157006 })).toBe(true);
        expect(revisionsMatch(157006, 88125, regions, { map_revision: 157007 })).toBe(false);
        expect(revisionsMatch(157006, 88125, regions, {})).toBe(false);
    });
    it("bleibt ohne Gebiete wie vorher (aeltere Aufrufer)", () => {
        expect(revisionsMatch(157006, 88125, regions)).toBe(true);
    });
});

describe("503 data_changing des Exports der Gebiete", () => {
    it("wiederholt nur ein 503 mit data_changing, nichts anderes", () => {
        expect(isDataChanging(503, JSON.stringify({ ok: false, error: "data_changing" }))).toBe(true);
        expect(isDataChanging(503, JSON.stringify({ error: "maintenance" }))).toBe(false);
        expect(isDataChanging(500, JSON.stringify({ error: "data_changing" }))).toBe(false);
        expect(isDataChanging(503, "kein JSON")).toBe(false);
    });
    it("Retry-After in Sekunden, sonst zehn, nie laenger als eine Minute", () => {
        expect(retryAfterMs("10")).toBe(10_000);
        expect(retryAfterMs("3")).toBe(3000);
        expect(retryAfterMs(null)).toBe(10_000);
        expect(retryAfterMs("bald")).toBe(10_000);
        expect(retryAfterMs("900")).toBe(60_000);
    });
});

describe("buildSetName", () => {
    it("folgt dem Muster map<rev>-eco<rev>-list<datum>", () => {
        expect(buildSetName(155099, 77518, new Date(2026, 8, 28))).toBe("map155099-eco77518-list20260928");
    });

    it("polstert Monat und Tag zweistellig", () => {
        expect(buildSetName(1, 2, new Date(2026, 0, 5))).toBe("map1-eco2-list20260105");
    });

    it("lehnt eine nicht-positive Revision ab", () => {
        expect(() => buildSetName(0, 1)).toThrow(/map_revision/);
        expect(() => buildSetName(1, Number.NaN)).toThrow(/ecosystem_revision/);
    });
});

describe("buildReportStamp", () => {
    it("gibt Stunde und Minute zweistellig ohne Trenner", () => {
        expect(buildReportStamp(new Date(2026, 8, 28, 9, 5))).toBe("0905");
        expect(buildReportStamp(new Date(2026, 8, 28, 23, 59))).toBe("2359");
    });
});

describe("sha256Hex", () => {
    it("stimmt mit einem bekannten Vektor ueberein", () => {
        // sha256("") - der Standardvektor, den jede Implementierung kennt.
        expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    it("ist fuer Buffer und String gleich", () => {
        expect(sha256Hex("abc")).toBe(sha256Hex(Buffer.from("abc", "utf8")));
    });
});

describe("regionsFileStatus / REGIONS_FILE_STALE_AFTER_MINUTES", () => {
    let dir = "";
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "legacy-update-test-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("meldet fehlend, wenn die Datei nicht da ist", () => {
        const status = regionsFileStatus(join(dir, "legacy-list-regions.json"));
        expect(status.present).toBe(false);
        expect(status.ageMinutes).toBeUndefined();
    });

    it("meldet das Alter in Minuten, wenn die Datei da ist", () => {
        const path = join(dir, "legacy-list-regions.json");
        writeFileSync(path, "{}");
        const inTenMinutes = new Date(Date.now() + 10 * 60_000);
        const status = regionsFileStatus(path, inTenMinutes);
        expect(status.present).toBe(true);
        expect(status.ageMinutes).toBeGreaterThanOrEqual(9);
        expect(status.ageMinutes).toBeLessThanOrEqual(11);
    });

    it("die Schwelle ist grosszuegig, aber nicht endlos", () => {
        expect(REGIONS_FILE_STALE_AFTER_MINUTES).toBeGreaterThan(60);
        expect(REGIONS_FILE_STALE_AFTER_MINUTES).toBeLessThan(24 * 60);
    });
});

describe("summarizePhase", () => {
    it("nennt nur die Felder, die der Bericht mitgibt", () => {
        expect(summarizePhase("Orte", { created: 9, updated: 16, unchanged: 4868, retired: 0 })).toBe(
            "Orte: 9 neu, 16 geaendert, 4868 unveraendert, 0 stillgelegt",
        );
    });

    it("laesst fehlende Felder weg, statt 'undefined' zu drucken", () => {
        expect(summarizePhase("Kraftlinienpunkte", { created: 0, unchanged: 45 })).toBe(
            "Kraftlinienpunkte: 0 neu, 45 unveraendert",
        );
    });
});

// M5a (Hardening Review 2026-09-28): vier der fuenf CLI-Fehler in legacy-update-cli.ts steckten in
// Vergleichslogik, die dort inline in `runPipeline` lag und deshalb nie unit-getestet war (die CLI
// fuehrt `main()` beim Import sofort aus, kein Entry-Point-Guard, und braucht eine echte Datenbank
// sowie live Legacy-Endpunkte). Die vier reinen Vergleiche stehen deshalb hier, im bereits testbaren
// Baustein, und werden von der CLI importiert. Die restlichen Fixe (Nachhol-Payload im zweiten Lauf,
// der Kraftlinien-Probelauf) sind Ablaufsteuerung in `main()`/`runPipeline` selbst und bleiben ohne
// Testdoppel fuer Datenbank und `fetch` ungetestet - das wird hier nicht vorgetaeuscht.

describe("pathRunsChanged (I7)", () => {
    it("meldet 'geaendert', wenn sich die Zahlen gegenueber dem letzten Lauf unterscheiden", () => {
        expect(pathRunsChanged("Ketten 5, Teilstuecke 9, Laeufe 40", "Ketten 5, Teilstuecke 9, Laeufe 39")).toBe(true);
    });

    it("meldet 'unveraendert', wenn die Zahlen gleich sind - der eigentliche Fund (bisher immer true)", () => {
        expect(pathRunsChanged("Ketten 5, Teilstuecke 9, Laeufe 40", "Ketten 5, Teilstuecke 9, Laeufe 40")).toBe(false);
    });

    it("meldet 'geaendert' ohne vorherigen Lauf (erster Lauf, es gibt nichts zum Vergleichen)", () => {
        expect(pathRunsChanged("Ketten 5, Teilstuecke 9, Laeufe 40", undefined)).toBe(true);
    });
});

describe("terrainDeriveChanged (I11, Kriterium des zweiten Laufs wie Stage)", () => {
    it("meldet eine neu gerechnete Domain auch bei unveränderten Seeds und Kachelbytes", () => {
        expect(
            terrainDeriveChanged({
                computed: 0,
                revisionChanged: false,
                profiles: { computed: 0 },
                domain: { computed: true },
            }),
        ).toBe(true);
    });

    it("unveraendert, wenn nichts gerechnet wurde und keine neue Revision entstand", () => {
        expect(terrainDeriveChanged({ computed: 0, revisionChanged: false, profiles: { computed: 0 } })).toBe(false);
    });

    it("geaendert bei gerechneten Rastern, auch ohne neue Revision", () => {
        expect(terrainDeriveChanged({ computed: 2, revisionChanged: false, profiles: { computed: 0 } })).toBe(true);
    });

    it("geaendert bei gerechneten Wegprofilen allein - der eigentliche Fund (vorher nur revisionChanged gezaehlt)", () => {
        expect(terrainDeriveChanged({ computed: 0, revisionChanged: false, profiles: { computed: 3 } })).toBe(true);
    });

    it("geaendert bei neuer Revision allein", () => {
        expect(terrainDeriveChanged({ computed: 0, revisionChanged: true, profiles: { computed: 0 } })).toBe(true);
    });
});

describe("terrainDeriveOk (I11, report.failed)", () => {
    it("ok, wenn kein Gebirge fehlschlug und der Verifier bestand", () => {
        expect(terrainDeriveOk(0, true)).toBe(true);
    });

    it("nicht ok, wenn ein Gebirge im Worker fehlschlug - der eigentliche Fund (bisher ungeprueft)", () => {
        expect(terrainDeriveOk(1, true)).toBe(false);
    });

    it("nicht ok, wenn der Verifier scheitert, auch ohne fehlgeschlagene Gebirge", () => {
        expect(terrainDeriveOk(0, false)).toBe(false);
    });
});

describe("reliefChanged (I12, Kriterium des zweiten Laufs wie Stage)", () => {
    it("unveraendert, wenn nicht gerechnet wurde und keine neue Revision entstand", () => {
        expect(reliefChanged({ computed: false, revisionChanged: false })).toBe(false);
    });

    it("geaendert, wenn gerechnet wurde", () => {
        expect(reliefChanged({ computed: true, revisionChanged: false })).toBe(true);
    });

    it("geaendert bei neuer Revision allein", () => {
        expect(reliefChanged({ computed: false, revisionChanged: true })).toBe(true);
    });
});

describe("requestTerritories (bedingter Abruf, WI-0062)", () => {
    const URL = "https://example.invalid/political-territories-export.php";
    const antwort = (status: number, body: string, headers: Record<string, string> = {}): Response =>
        new Response(status === 304 ? null : body, { status, headers });

    /** Ein Abruf mit vorbereiteten Antworten; merkt sich, was gesendet wurde und wie lange gewartet wurde. */
    function scripted(...antworten: Response[]) {
        const gesendet: (string | undefined)[] = [];
        const gewartet: number[] = [];
        let index = 0;
        const fetcher = ((_url: string, init?: RequestInit) => {
            gesendet.push((init?.headers as Record<string, string> | undefined)?.["If-None-Match"]);
            const next = antworten[index];
            index += 1;
            if (!next) throw new Error("mehr Abrufe als vorbereitet: der Abruf darf nicht in einer Schleife laufen");
            return Promise.resolve(next);
        }) as unknown as typeof fetch;
        const sleep = (ms: number): Promise<void> => {
            gewartet.push(ms);
            return Promise.resolve();
        };
        return { fetcher, sleep, gesendet, gewartet, abrufe: () => index };
    }

    it("sendet ohne gespeicherten ETag unbedingt und liefert Rumpf und ETag aus X-Avesmaps-ETag", async () => {
        const abruf = scripted(antwort(200, '{"ok":true}', { "x-avesmaps-etag": 'W/"pol-territories-abc"' }));
        const result = await requestTerritories({
            url: URL,
            storedEtag: "",
            fetcher: abruf.fetcher,
            sleep: abruf.sleep,
        });
        expect(result).toEqual({ kind: "fresh", text: '{"ok":true}', etag: 'W/"pol-territories-abc"' });
        expect(abruf.gesendet).toEqual([undefined]);
    });

    it("🔴 sendet den gespeicherten ETag als If-None-Match; bei 304 nimmt der Zug die gespeicherte Datei", async () => {
        const abruf = scripted(antwort(304, ""));
        const result = await requestTerritories({
            url: URL,
            storedEtag: 'W/"pol-territories-abc"',
            fetcher: abruf.fetcher,
            sleep: abruf.sleep,
        });
        expect(result).toEqual({ kind: "not_modified", etag: 'W/"pol-territories-abc"' });
        expect(abruf.gesendet).toEqual(['W/"pol-territories-abc"']);
    });

    it("🔴 wiederholt ein 503 data_changing nach Retry-After, höchstens zweimal", async () => {
        const changing = () =>
            antwort(503, JSON.stringify({ ok: false, error: "data_changing" }), { "retry-after": "10" });
        const abruf = scripted(changing(), changing(), antwort(200, "{}"));
        const result = await requestTerritories({
            url: URL,
            storedEtag: "",
            fetcher: abruf.fetcher,
            sleep: abruf.sleep,
        });
        expect(result.kind).toBe("fresh");
        expect(abruf.gewartet).toEqual([10_000, 10_000]);
        expect(abruf.abrufe()).toBe(3);

        // Das dritte 503 ist kein Wiederholungsgrund mehr: Der Abruf scheitert, statt zu schleifen.
        const dauer = scripted(changing(), changing(), changing());
        await expect(
            requestTerritories({ url: URL, storedEtag: "", fetcher: dauer.fetcher, sleep: dauer.sleep }),
        ).rejects.toThrow(/HTTP 503/);
        expect(dauer.abrufe()).toBe(3);
    });

    it("💣 jede andere Antwort ausser 200 und 304 scheitert laut, ein 503 ohne data_changing wird nicht wiederholt", async () => {
        for (const status of [403, 405, 500]) {
            const abruf = scripted(antwort(status, ""));
            await expect(
                requestTerritories({ url: URL, storedEtag: "", fetcher: abruf.fetcher, sleep: abruf.sleep }),
            ).rejects.toThrow(new RegExp(`HTTP ${String(status)}`));
            expect(abruf.abrufe()).toBe(1);
        }
        const wartung = scripted(antwort(503, JSON.stringify({ error: "maintenance" })));
        await expect(
            requestTerritories({ url: URL, storedEtag: "", fetcher: wartung.fetcher, sleep: wartung.sleep }),
        ).rejects.toThrow(/HTTP 503/);
        expect(wartung.abrufe()).toBe(1);
        // Ein 304 ohne gesendeten ETag gibt es nicht: er ist kein Erfolg.
        const ohne = scripted(antwort(304, ""));
        await expect(
            requestTerritories({ url: URL, storedEtag: "", fetcher: ohne.fetcher, sleep: ohne.sleep }),
        ).rejects.toThrow();
    });

    it("ein 200 ohne X-Avesmaps-ETag liefert etag null: der nächste Abruf ist unbedingt", async () => {
        const abruf = scripted(antwort(200, "{}"));
        const result = await requestTerritories({
            url: URL,
            storedEtag: "",
            fetcher: abruf.fetcher,
            sleep: abruf.sleep,
        });
        expect(result).toEqual({ kind: "fresh", text: "{}", etag: null });
    });
});

describe("powerlineProbeFinding (I8: das frühere Tor „stillgelegt 0“ meldet nur, Betreiber 2026-10-03)", () => {
    it("meldet Zahlen und Namen, wenn der Probelauf Kraftlinien oder Kraftlinienpunkte stilllegen würde", () => {
        const finding = powerlineProbeFinding({
            retired: 2,
            nodices: { retired: 1 },
            retiredObjects: [
                { table: "powerline", publicId: "44444444-0000-4000-8000-000000000102", name: "Gebogene Linie" },
                { table: "powerline", publicId: "44444444-0000-4000-8000-000000000103", name: "Verwaiste Linie" },
                { table: "nodix", publicId: "44444444-0000-4000-8000-00000000000c", name: "Kreuzung" },
            ],
        });
        expect(finding?.code).toBe("kraftlinien_probelauf");
        expect(finding?.numbers).toEqual({ powerlines: 2, nodix: 1 });
        expect(finding?.objectCount).toBe(3);
        expect(finding?.message).toContain("2 Kraftlinien und 1 Kraftlinienpunkte");
        expect(finding?.objects.map((object) => object.name)).toEqual([
            "Gebogene Linie",
            "Verwaiste Linie",
            "Kreuzung",
        ]);
    });

    it("meldet nichts, wenn nichts stillgelegt wird", () => {
        expect(powerlineProbeFinding({ retired: 0, nodices: { retired: 0 }, retiredObjects: [] })).toBeUndefined();
    });
});

describe("revisionMismatchFinding (Quellen: abweichende Revisionen melden nur, Betreiber 2026-10-03)", () => {
    it("nennt alle Revisionen der Antworten und dass der Zug weitergeht", () => {
        const finding = revisionMismatchFinding("Orte 1/2/3, Oekosystem 4/5", {
            features: 1,
            areas: 4,
            regionsMap: 2,
            regionsEcosystem: undefined,
            territoriesMap: 3,
        });
        expect(finding.code).toBe("quellen_stand");
        expect(finding.numbers).toEqual({
            features: 1,
            areas: 4,
            regionsMap: 2,
            regionsEcosystem: "fehlt",
            territoriesMap: 3,
        });
        expect(finding.message).toContain("Orte 1/2/3, Oekosystem 4/5");
        expect(finding.message).toContain("geht mit den zuletzt geholten weiter");
    });
});

describe("Kataloge von Spielliteratur und Kartensammlung (I20, I21): ein optionaler Abruf, kein Tor", () => {
    it("die Endpunkte sind die oeffentlichen GET-Adressen von Legacy", () => {
        expect(PUBLIC_GAME_LITERATURE_ENDPOINT).toBe("https://avesmaps.de/api/app/game-literature.php");
        expect(PUBLIC_CITYMAPS_ENDPOINT).toBe("https://avesmaps.de/api/app/citymaps.php");
    });

    it("der Bewertungs-Export E3 (I22) ist eine oeffentliche GET-Adresse, und ein Ausfall laesst nur den Schritt entfallen", () => {
        expect(PUBLIC_LOCATION_REVIEWS_ENDPOINT).toBe("https://avesmaps.de/api/app/location-reviews-export.php");
        const finding = catalogFetchFailureFinding("location-reviews.json", "HTTP 503");
        expect(finding.code).toBe("source_block_missing");
        expect(finding.message).toContain("nichts wird geschrieben oder stillgelegt");
        expect(catalogNotFetchedFinding("location-reviews.json").message).toContain("Zuruf des Betreibers");
    });

    it("ein gescheiterter Abruf laesst nur den Schritt entfallen: source_block_missing, der Zug geht weiter", () => {
        const finding = catalogFetchFailureFinding("citymaps.json", "HTTP 500");
        expect(finding.code).toBe("source_block_missing");
        expect(finding.numbers).toEqual({ datei: "citymaps.json", grund: "HTTP 500" });
        expect(finding.message).toContain("der Schritt entfaellt");
        expect(finding.message).toContain("nichts wird geschrieben oder stillgelegt");
    });

    it("ohne den Zuruf des Betreibers wird nichts abgerufen und das gemeldet", () => {
        const finding = catalogNotFetchedFinding("game-literature.json");
        expect(finding.code).toBe("source_block_missing");
        expect(finding.message).toContain("Zuruf des Betreibers");
        expect(finding.numbers).toEqual({ datei: "game-literature.json", grund: "kein Abruf" });
    });

    it("der Abruf loest in Legacy Selbstheilung aus; bei der Kartensammlung auch die Rueckfuellung (Information)", () => {
        expect(legacyGetSelfHealsFinding("game-literature.json").message).not.toContain("color_mode");
        const maps = legacyGetSelfHealsFinding("citymaps.json");
        expect(maps.code).toBe("legacy_get_self_heals");
        expect(maps.message).toContain("color_mode");
    });
});

describe("Wiki-Linkziele (X1) und Wiki-Zuordnung (X2) (I24): zwei lesende Exporte, kein Tor, kein Selbstheilen", () => {
    it("die Endpunkte sind die oeffentlichen GET-Adressen von Legacy", () => {
        expect(PUBLIC_WIKI_LINKZIELE_ENDPOINT).toBe("https://avesmaps.de/api/app/wiki-linkziele-export.php");
        expect(PUBLIC_WIKI_ZUORDNUNG_ENDPOINT).toBe("https://avesmaps.de/api/app/wiki-zuordnung-export.php");
    });

    it("🔴 der Abruf wiederholt nur ein 503 data_changing nach Retry-After, hoechstens zweimal, und holt unbedingt (kein If-None-Match)", async () => {
        const urls: string[] = [];
        const headers: unknown[] = [];
        const answers = [
            new Response(JSON.stringify({ ok: false, error: "data_changing" }), {
                status: 503,
                headers: { "Retry-After": "7" },
            }),
            new Response(JSON.stringify({ ok: true, objekte: [] }), {
                status: 200,
                headers: { "X-Avesmaps-ETag": 'W/"wiki-zuordnung-1"' },
            }),
        ];
        const waits: number[] = [];
        const answer = await requestTerritories({
            url: PUBLIC_WIKI_ZUORDNUNG_ENDPOINT,
            storedEtag: "",
            fetcher: (url, init) => {
                urls.push(String(url));
                headers.push(init?.headers);
                return Promise.resolve(answers.shift() as Response);
            },
            sleep: (ms) => {
                waits.push(ms);
                return Promise.resolve();
            },
        });
        expect(answer.kind).toBe("fresh");
        expect(urls).toEqual([PUBLIC_WIKI_ZUORDNUNG_ENDPOINT, PUBLIC_WIKI_ZUORDNUNG_ENDPOINT]);
        expect(waits).toEqual([7000]);
        expect(headers).toEqual([{}, {}]);
    });

    it("ein Abruf, der ausfaellt, laesst nur den Teil entfallen: dieselbe source_block_missing-Meldung wie bei den Katalogen", () => {
        const finding = catalogFetchFailureFinding("legacy-wiki-linkziele.json", "HTTP 500");
        expect(finding.code).toBe("source_block_missing");
        expect(finding.message).toContain("nichts wird geschrieben oder stillgelegt");
    });
});

describe("Lore-Export (I25): ein einziger Abruf, rein lesend, nur auf Zuruf", () => {
    it("der Endpunkt ist die oeffentliche GET-Adresse des Exports E2 von Legacy", () => {
        expect(PUBLIC_LORE_EXPORT_ENDPOINT).toBe("https://avesmaps.de/api/app/lore-export.php");
    });

    it("ein gescheiterter oder unterbliebener Abruf laesst nur den Schritt entfallen (dieselben Befunde wie bei I20 und I21)", () => {
        expect(catalogFetchFailureFinding("lore-export.json", "HTTP 503").code).toBe("source_block_missing");
        expect(catalogNotFetchedFinding("lore-export.json").numbers).toEqual({
            datei: "lore-export.json",
            grund: "kein Abruf",
        });
    });

    it("die Quelle verspricht keinen Abruf ohne Zuruf: der Abruf steht nur im Zweig mit --operator-said, genau einmal, ohne Wiederholung", () => {
        const source = readFileSync(
            join(import.meta.dirname, "..", "src", "migration", "legacy-update-cli.ts"),
            "utf8",
        );
        // fetchCatalog wird mit dem Lore-Endpunkt genau einmal aufgerufen, und zwar in main nach der Pruefung auf den Zuruf.
        const calls = [...source.matchAll(/fetchCatalog\(\s*"lore-export\.json"/g)];
        expect(calls).toHaveLength(1);
        const applyGate = source.indexOf("if (!apply) {");
        expect(applyGate).toBeGreaterThan(0);
        expect(calls[0]?.index ?? 0).toBeGreaterThan(applyGate);
        // Rein lesend: der Abruf meldet keine Selbstheilung (selfHeals: false), und es gibt keine Wiederholungsschleife um ihn.
        expect(source).toMatch(/fetchCatalog\(\s*"lore-export\.json",[^)]*selfHeals:\s*false/s);
        expect(source).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*lore-export/s);
    });
});

describe("Häfen ohne Wasser-Zugang (I9, WI-0060): Befund und eigener Abschnitt im Bericht", () => {
    const settings = { cell: 0.5, minArea: 10 };
    const ports = [
        {
            id: "ec477f34-a34a-578e-9887-05b751f091e4",
            name: "Selem",
            reason: "gewaesser_zu_klein" as const,
            distance: 1.9,
        },
        {
            id: "59b1e567-6b83-5ce4-805f-9d66de3172ef",
            name: "Trallestedt",
            reason: "wasser_fern" as const,
            distance: null,
        },
        {
            id: "d0fd7b81-48a0-5dc1-9022-e43da90c3a79",
            name: "Eskilsheim|Nord",
            reason: "wasser_zu_schmal" as const,
            distance: 0.3,
        },
    ];

    it("meldet Zahl, Hafen mit Tabelle, Kennung und Namen und je Hafen den Grund, nach Namen geordnet", () => {
        const finding = landlessPortsFinding(ports, settings);
        expect(finding?.code).toBe("hafen_ohne_wasser");
        expect(finding?.numbers).toEqual({ haefen: 3 });
        expect(finding?.objectCount).toBe(3);
        expect(finding?.objects.map((object) => object.name)).toEqual(["Eskilsheim|Nord", "Selem", "Trallestedt"]);
        expect(finding?.objects[1]).toEqual({ table: "place", publicId: ports[0]?.id, name: "Selem" });
        expect(finding?.notes[1]).toBe(
            "Selem: Gewässer zu klein: befahrbares Wasser 1,9 E entfernt, aber nur ein abgetrenntes Stück unter 10 E²",
        );
        expect(finding?.message).toContain("der Lauf geht weiter");
    });

    it("meldet nichts, wenn jeder Hafen eine Anlegestelle hat", () => {
        expect(landlessPortsFinding([], settings)).toBeUndefined();
    });

    it("der Abschnitt nennt die Zahl und je Hafen Name, Kennung und Grund als Tabelle", () => {
        const lines = landlessPortsSection(ports, 331, settings);
        expect(lines[0]).toBe("## Häfen ohne Wasser-Zugang (Befund, der Zug lief weiter)");
        expect(lines.join("\n")).toContain("**3** von 334 Häfen haben keine Anlegestelle");
        expect(lines).toContain("| Hafen | Kennung | Grund |");
        expect(lines).toContain(
            "| Trallestedt | 59b1e567-6b83-5ce4-805f-9d66de3172ef | kein Meer und kein See in 50 E |",
        );
        // Ein senkrechter Strich im Namen bricht die Tabelle nicht.
        expect(lines.find((line) => line.startsWith("| Eskilsheim"))).toMatch(/^\| Eskilsheim\\\|Nord \| d0fd7b81/);
        expect(lines.at(-1)).toBe("");
    });

    it("der Abschnitt sagt es auch, wenn es keinen solchen Hafen gibt", () => {
        expect(landlessPortsSection([], 337, settings)).toEqual([
            "## Häfen ohne Wasser-Zugang (Befund, der Zug lief weiter)",
            "",
            "Keiner: alle 337 Häfen haben eine Anlegestelle.",
            "",
        ]);
    });

    it("die Quelle hängt Befund und Abschnitt an I9 und stellt die Abschnitte nur aus dem ersten Lauf in den Bericht", () => {
        const source = readFileSync(
            join(import.meta.dirname, "..", "src", "migration", "legacy-update-cli.ts"),
            "utf8",
        );
        // Die Sätze nennen die Werte, mit denen der Seegraph gerechnet wurde (WI-0153 Schnitt 7a), nicht die Konstanten.
        expect(source).toMatch(/landlessPortsFinding\(seaReport\.withoutLanding, landlessSettings\(seaReport\)\)/);
        expect(source).toMatch(
            /landlessPortsSection\(seaReport\.withoutLanding, seaReport\.ports, landlessSettings\(seaReport\)\)/,
        );
        expect(source).toMatch(
            /for \(const outcome of input\.firstRun\) \{\s*if \(outcome\.section\) lines\.push\(\.\.\.outcome\.section\);/,
        );
    });
});
