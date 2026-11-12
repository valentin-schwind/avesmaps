import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaPhotoboxOrtEingaengeUrl, type MamTypeImage, type MamTypeImageList } from "@avesmaps3d/shared";
import { ladeOrtEingaenge } from "../src/info-panel/ort-eingaenge.ts";
import { createPanelActions, type MediaEntry, type PanelActionDeps } from "../src/info-panel/panel-actions.ts";
import type { HeaderOrt } from "../src/info-panel/panel-types.ts";
import { medienOffen, medienZustand, oeffneMedien, schliesseMedien } from "../src/medien/medien-oeffnen.ts";
import { sternAsset } from "../src/medien/medien-typbilder-modell.ts";
import { MEDIEN_START, adresseMitZustand, suchAdresse, zustandAusAdresse } from "../src/medien/medien-zustand.ts";

/**
 * Was „+ Eigenes Bild hinzufügen“ und das ⚙ im Kopf eines Ortes auslösen, wie die offenen Eingänge dafür geholt werden und dass die Bildwahl der Medienverwaltung Reisebilder weglässt (WI-0272 S5).
 *
 * Problemfälle: „+“ öffnet das Fenster ohne den Ort als Bezug oder an einer anderen Stelle als der Lage des Ortes; das ⚙ am Reisebild beschränkt die Treffer auf den Ort (ein Reisebild hängt an keinem Fachobjekt,
 * die Liste bliebe leer); ein Fehler der Eingänge macht den Kopf kaputt statt leer; die Bildwahl bietet ein Reisebild an, das sich nirgends einbinden lässt.
 */

const ORT: HeaderOrt = {
    id: "80558060-4299-54aa-b520-814b10819885",
    name: "Gareth",
    subtype: "metropole",
    x: 551.6,
    y: 532.9,
};
const ASSET = "11111111-1111-4111-8111-111111111111";
const GEZEIGT = {
    ref: { kind: "place" as const, id: ORT.id },
    key: "k",
    title: "Gareth",
    status: "ready" as const,
    answer: undefined,
};

function aktionen(openMedia?: (ziel: MediaEntry) => void, openReisebild?: (ort: HeaderOrt) => void) {
    const deps = {
        planner: {},
        selection: {},
        ...(openMedia === undefined ? {} : { openMedia }),
        ...(openReisebild === undefined ? {} : { openReisebild }),
    } as unknown as PanelActionDeps;
    return createPanelActions(deps);
}

describe("Die Handlungen im Kopf eines Ortes", () => {
    it("🔴 „+“ öffnet das Einreichungsfenster mit dem ganzen Ort als Bezug (Kennung, Name, Art, Lage)", () => {
        const geoeffnet: HeaderOrt[] = [];
        aktionen(undefined, (ort) => geoeffnet.push(ort)).run({ type: "reisebildHinzufuegen", ort: ORT }, GEZEIGT);
        expect(geoeffnet).toEqual([ORT]);
    });

    it("🔴 das ⚙ am Reisebild öffnet den Korb PhotoBox-Uploads mit dem Medium, OHNE „verwendet von“ (die Liste bliebe sonst leer)", () => {
        const ziele: MediaEntry[] = [];
        const lauf = aktionen((ziel) => ziele.push(ziel));
        lauf.run({ type: "openReisebilder", asset: ASSET, einreichung: "erledigt" }, GEZEIGT);
        lauf.run({ type: "openReisebilder", asset: ASSET, einreichung: "offen" }, GEZEIGT);
        expect(ziele).toEqual([
            { korb: "photobox_uploads", einreichung: "erledigt", asset: ASSET },
            { korb: "photobox_uploads", einreichung: "offen", asset: ASSET },
        ]);
        expect(ziele.every((ziel) => ziel.von === undefined)).toBe(true);
    });

    it("das ⚙ ohne Reisebild öffnet den Korb allein, Unterteilung „offen“", () => {
        const ziele: MediaEntry[] = [];
        aktionen((ziel) => ziele.push(ziel)).run({ type: "openReisebilder" }, GEZEIGT);
        expect(ziele).toEqual([{ korb: "photobox_uploads", einreichung: "offen" }]);
    });

    it("das ⚙ am Kopfbild einer anderen Herkunft bleibt, wie es war: das Asset, die Treffer auf den Ort beschränkt", () => {
        const ziele: MediaEntry[] = [];
        aktionen((ziel) => ziele.push(ziel)).run({ type: "openMedia", asset: ASSET, name: "Gareth" }, GEZEIGT);
        expect(ziele).toEqual([{ asset: ASSET, von: { kind: "place", id: ORT.id, name: "Gareth" } }]);
    });

    it("🔴 das ⚙ auf dem Typbild öffnet das Medienobjekt „Typbilder“ an dieser Kategorie, an jedem Objekt, ohne „verwendet von“", () => {
        const ziele: MediaEntry[] = [];
        const lauf = aktionen((ziel) => ziele.push(ziel));
        lauf.run({ type: "openTypbild", kategorie: "metropole" }, GEZEIGT);
        lauf.run(
            { type: "openTypbild", kategorie: "reichsstrasse" },
            {
                ref: { kind: "path", chain: "Reichsstraße 2:Reichsstrasse" },
                key: "p",
                answer: undefined,
                title: "Reichsstraße 2",
                status: "ready",
            },
        );
        expect(ziele).toEqual([{ typbild: "metropole" }, { typbild: "reichsstrasse" }]);
    });

    it("ohne die Nähte (Besucher: keine Medienverwaltung) tut keine der Handlungen etwas und wirft nicht", () => {
        const lauf = aktionen();
        expect(() => lauf.run({ type: "reisebildHinzufuegen", ort: ORT }, GEZEIGT)).not.toThrow();
        expect(() => lauf.run({ type: "openReisebilder", asset: ASSET }, GEZEIGT)).not.toThrow();
        expect(() => lauf.run({ type: "openTypbild", kategorie: "metropole" }, GEZEIGT)).not.toThrow();
    });
});

describe("Der Einstieg in die Typbilder der Medienverwaltung", () => {
    afterEach(() => {
        schliesseMedien();
        medienZustand.value = { ...MEDIEN_START };
    });

    const eintrag = (kategorie: MamTypeImage["category"], stern: string | null): MamTypeImage =>
        ({
            category: kategorie,
            label: kategorie,
            objects: "place",
            count: 3,
            current:
                stern === null
                    ? null
                    : { assetId: stern, title: null, preview: null, revision: 1, since: "2026-10-12", public: true },
            former: 0,
            formerItems: [],
        }) as MamTypeImage;
    const liste = (...items: MamTypeImage[]): MamTypeImageList => ({ items }) as MamTypeImageList;

    it("🔴 ein Ziel mit Typbild stellt die Liste an die Kategorie: Medienobjekt „Typbilder“, ohne Asset, ohne „verwendet von“, Medienverwaltung offen", () => {
        // Der Stand von vorhin gilt nicht: Suche, Filter und ein gewähltes Asset blieben sonst stehen.
        medienZustand.value = {
            ...MEDIEN_START,
            q: "alt",
            asset: ASSET,
            von: `place:${ORT.id}`,
            filter: { origin: "legacy_import" },
        };
        oeffneMedien({ typbild: "metropole" });
        expect(medienOffen.value).toBe(true);
        expect(medienZustand.value).toEqual({
            ...MEDIEN_START,
            auswahl: { objekt: "typbilder" },
            kategorie: "metropole",
        });
    });

    it("die Kategorie steht in der Adresse und kommt aus ihr wieder (ein tiefer Link öffnet dieselbe Stelle)", () => {
        oeffneMedien({ typbild: "reichsstrasse" });
        const adresse = adresseMitZustand("", medienZustand.value);
        expect(adresse).toContain("medien-kategorie=reichsstrasse");
        expect(zustandAusAdresse(adresse)).toMatchObject({
            auswahl: { objekt: "typbilder" },
            kategorie: "reichsstrasse",
        });
    });

    it("🔴 das ★ der Kategorie wird das gewählte Asset; ohne ★, ohne Liste und ohne Kategorie bleibt es ungewählt", () => {
        const stern = "22222222-2222-4222-8222-222222222222";
        const alle = liste(eintrag("metropole", stern), eintrag("dorf", null));
        expect(sternAsset(alle, "metropole")).toBe(stern);
        // Eine Kategorie ohne ★: der Inspector zeigt „noch kein Typbild“, kein Asset wird erfunden.
        expect(sternAsset(alle, "dorf")).toBeUndefined();
        expect(sternAsset(alle, "reichsstrasse")).toBeUndefined();
        expect(sternAsset(undefined, "metropole")).toBeUndefined();
        expect(sternAsset(alle, undefined)).toBeUndefined();
    });
});

describe("Die offenen Eingänge eines Ortes holen", () => {
    const antwort = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    it("🔴 die geschützte Route des Ortes, nie die öffentliche Antwort; jeder Eingang wird ein gestricheltes Bild", async () => {
        const fetcher = vi.fn(async () =>
            antwort({
                eingaenge: [
                    {
                        publicId: ASSET,
                        url: `/api/editor/media/${ASSET}/preview/intern_photobox_2048`,
                        breite: 640,
                        hoehe: 360,
                    },
                ],
            }),
        );
        const bilder = await ladeOrtEingaenge(ORT.id, fetcher as unknown as typeof fetch);
        expect(bilder).toEqual([
            {
                id: ASSET,
                url: `/api/editor/media/${ASSET}/preview/intern_photobox_2048`,
                width: 640,
                height: 360,
                eingang: true,
            },
        ]);
        const [url] = fetcher.mock.calls[0] as unknown as [string];
        expect(url).toBe(mediaPhotoboxOrtEingaengeUrl(ORT.id));
        expect(url).toContain("/api/editor/media/photobox/ort/");
        expect(url).not.toContain("/api/subjects");
    });

    it("kein Recht (403), keine Verbindung und ein kaputter Rumpf heißen: keine Eingänge, kein Fehler im Kopf", async () => {
        const verboten = vi.fn(async () => antwort({ error: { code: "forbidden", message: "nein" } }, 403));
        expect(await ladeOrtEingaenge(ORT.id, verboten as unknown as typeof fetch)).toEqual([]);
        const weg = vi.fn(async () => {
            throw new TypeError("Failed to fetch");
        });
        expect(await ladeOrtEingaenge(ORT.id, weg as unknown as typeof fetch)).toEqual([]);
        const kaputt = vi.fn(async () => antwort({ unsinn: true }));
        expect(await ladeOrtEingaenge(ORT.id, kaputt as unknown as typeof fetch)).toEqual([]);
    });

    it("ein abgebrochener Wunsch antwortet leer (ein jüngerer Ort hat ihn abgelöst)", async () => {
        const lauf = new AbortController();
        const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
            if (init?.signal?.aborted === true) throw new DOMException("abgebrochen", "AbortError");
            return antwort({ eingaenge: [] });
        });
        lauf.abort();
        expect(await ladeOrtEingaenge(ORT.id, fetcher as unknown as typeof fetch, lauf.signal)).toEqual([]);
    });
});

describe("Die Bildwahl der Medienverwaltung", () => {
    const quelle = (datei: string): string =>
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "medien", datei), "utf8");

    it("🔴 Wappen, Titelbild, Typbild und Galerie fragen mit ohneReisebilder, die Verwaltung selbst nicht", () => {
        // Wappen, Titelbild und Typbild teilen sich ein Fenster, die Galerie hat ihres.
        for (const datei of ["medien-auswahl-fenster.vue", "medien-galerie-bilder-fenster.vue"]) {
            expect(quelle(datei), datei).toMatch(/client\.suche\(\s*\{[^}]*ohneReisebilder: true/u);
        }
        // Die Liste der Verwaltung (Spalte 2) zeigt weiter alles, auch den Korb „PhotoBox-Uploads“.
        expect(quelle("medien-zustand.ts")).not.toContain("ohneReisebilder");
    });

    it("der Filter reist als Schlüssel der Anfrage zum Server", () => {
        expect(suchAdresse({ type: "picture", ohneReisebilder: true })).toContain("ohneReisebilder=true");
    });
});
