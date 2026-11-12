import { beforeAll, describe, expect, it } from "vitest";
import { PHOTOBOX_UNENTSCHIEDEN, type MediaAssetDetail, type MediaUsageResult } from "@avesmaps3d/shared";
import { locale } from "../src/i18n/i18n";
import {
    LOESCH_HINDERNISSE,
    istLoeschHindernis,
    loeschBlatt,
    loeschHindernis,
    loeschHindernisSatz,
} from "../src/medien/medien-loeschen-modell";

/**
 * Wann der Knopf „Endgültig löschen“ gesperrt steht und was das Blatt sagt (WI-0068 R4; Betreiber 2026-10-17, „A, nur eigene Uploads“; PhotoBox-Bilder und Notaus WI-0272,
 * Vali 2026-11-08, Entwurf „Eingänge“ Fassung 2). Entscheiden tut der Server; die Oberfläche sagt den Grund vorher, statt in einen 409 zu laufen.
 */

const ID = "6d656469-0000-4000-8000-000000000001";
const ANDERES = "6d656469-0000-4000-8000-000000000002";

type Photobox = NonNullable<MediaAssetDetail["ausPhotobox"]>;

const detail = (teil: {
    origin?: MediaAssetDetail["asset"]["origin"];
    legacy?: boolean;
    aktiv?: number;
    zurueck?: number;
    notaus?: { an: string | null; aufgehoben?: boolean }[];
    ausVorschlag?: { nurStillgelegt: boolean; vorschauen?: number };
    ausPhotobox?: Partial<Photobox>;
}): MediaAssetDetail =>
    ({
        asset: { id: ID, origin: teil.origin ?? "editor_upload" },
        legacySource: teil.legacy === true ? {} : null,
        usageCount: teil.aktiv ?? 0,
        retiredUsageCount: teil.zurueck ?? 0,
        suspensions: (teil.notaus ?? []).map((eintrag) => ({
            triggeredOn: eintrag.an,
            liftedAt: eintrag.aufgehoben === true ? "2026-11-08T10:00:00.000Z" : null,
        })),
        ...(teil.ausVorschlag === undefined
            ? {}
            : {
                  ausVorschlag: {
                      nurStillgelegt: teil.ausVorschlag.nurStillgelegt,
                      eintraege: ["Porto Paligan Spielerversion Test"],
                      vorschauen: teil.ausVorschlag.vorschauen ?? 0,
                  },
              }),
        ...(teil.ausPhotobox === undefined
            ? {}
            : { ausPhotobox: { zustand: "approved", aktiv: true, anderswo: 0, ort: null, ...teil.ausPhotobox } }),
    }) as unknown as MediaAssetDetail;

const gleich = (...titel: (string | null)[]): MediaUsageResult["sameFile"] =>
    titel.map((title, i) => ({ asset: { id: `${ANDERES.slice(0, -1)}${String(i)}`, title } })) as never;

beforeAll(() => {
    locale.value = "de";
});

describe("Endgültig löschen: wann der Knopf gesperrt steht", () => {
    it("ein eigener Upload ohne jede Verwendung ist löschbar", () => {
        expect(loeschHindernis(detail({}))).toBeUndefined();
    });

    it("🔴 „Importierte Bilder …“ nur bei echten Importen; erzeugte und eingesandte Bilder nennen, was sie sind", () => {
        for (const origin of ["legacy_import", "wiki_import", "wiki_localized", "external_import"] as const) {
            expect(loeschHindernis(detail({ origin })), origin).toBe("legacy");
        }
        expect(loeschHindernis(detail({ legacy: true }))).toBe("legacy");
        expect(loeschHindernis(detail({ origin: "project_generated" }))).toBe("erzeugt");
        expect(loeschHindernis(detail({ origin: "community_upload" }))).toBe("eingesandt");
        expect(loeschHindernisSatz("legacy")).toBe("Importierte Bilder lassen sich nicht löschen.");
        expect(loeschHindernisSatz("erzeugt")).not.toContain("Importierte");
        expect(loeschHindernisSatz("eingesandt")).not.toContain("Importierte");
    });

    it("🔴 eine Verwendung sperrt, auch eine zurückgezogene", () => {
        expect(loeschHindernis(detail({ aktiv: 1 }))).toBe("in_use");
        expect(loeschHindernis(detail({ zurueck: 1 }))).toBe("in_use");
    });

    it("🔴 ein Bild aus einem Kartenvorschlag nur an stillgelegten Einträgen ist löschbar, an einem Eintrag, der gilt, nicht (WI-0287, Vali 2026-11-07)", () => {
        const vorschlag = { origin: "community_upload" as const, aktiv: 1 };
        expect(loeschHindernis(detail({ ...vorschlag, ausVorschlag: { nurStillgelegt: true } }))).toBeUndefined();
        expect(loeschHindernis(detail({ ...vorschlag, ausVorschlag: { nurStillgelegt: false } }))).toBe(
            "vorschlag_aktiv",
        );
        expect(loeschHindernis(detail({ ...vorschlag, legacy: true, ausVorschlag: { nurStillgelegt: true } }))).toBe(
            "legacy",
        );
    });

    it("🔴 ein PhotoBox-Bild ist löschbar, sobald die Einreichung entschieden ist; offen heißt „Erst freigeben oder ablehnen.“ (WI-0272)", () => {
        const reisebild = { origin: "community_upload" as const, aktiv: 1 };
        for (const zustand of ["approved", "offline", "rejected"] as const) {
            expect(loeschHindernis(detail({ ...reisebild, ausPhotobox: { zustand } })), zustand).toBeUndefined();
        }
        for (const zustand of PHOTOBOX_UNENTSCHIEDEN) {
            expect(loeschHindernis(detail({ ...reisebild, ausPhotobox: { zustand } })), zustand).toBe(
                "einreichung_offen",
            );
        }
        expect(loeschHindernisSatz("einreichung_offen")).toBe("Erst freigeben oder ablehnen.");
        // Die eigene Zeile als Reisebild zählt nicht, eine Galerie, ein Typbild oder ein Ort schon.
        expect(loeschHindernis(detail({ ...reisebild, ausPhotobox: { anderswo: 1 } }))).toBe("in_use");
        expect(loeschHindernis(detail({ ...reisebild, legacy: true, ausPhotobox: {} }))).toBe("legacy");
    });

    it("🔴 ein Notaus hindert nicht mehr, weder am Werk noch an einem anderen mit denselben Bytes (Vali 2026-11-08, „B, löschbar“)", () => {
        expect(loeschHindernis(detail({ notaus: [{ an: ID }] }))).toBeUndefined();
        expect(loeschHindernis(detail({ notaus: [{ an: ANDERES }] }))).toBeUndefined();
        expect(
            loeschHindernis(detail({ origin: "community_upload", notaus: [{ an: ID }], ausPhotobox: {} })),
        ).toBeUndefined();
        expect(LOESCH_HINDERNISSE).not.toContain("suspension");
    });

    it("die Gründe des Servers (`details.reason`) kennt die Oberfläche, Unbekanntes nicht", () => {
        for (const grund of LOESCH_HINDERNISSE) {
            expect(istLoeschHindernis(grund)).toBe(true);
            expect(loeschHindernisSatz(grund)).not.toContain("medien.loeschen");
        }
        expect(istLoeschHindernis("suspension")).toBe(false);
        expect(istLoeschHindernis(undefined)).toBe(false);
    });
});

describe("Endgültig löschen: was das Blatt sagt", () => {
    it("ein eigener Upload: nur der Zusatz, keine Folgen, kein Notaus", () => {
        expect(loeschBlatt(detail({}))).toEqual({
            zusatz: "nur eigene Uploads ohne jede Verwendung",
            folgen: [],
            notaus: undefined,
        });
    });

    it("🔴 ein freigegebenes Reisebild an einem Ort: Reisebilder des Orts, Karte, Leiste; die Einsendung bleibt ohne Datei", () => {
        const blatt = loeschBlatt(detail({ origin: "community_upload", ausPhotobox: { ort: "Gareth" } }));
        expect(blatt.zusatz).toBe("Reisebild aus der PhotoBox");
        expect(blatt.folgen).toEqual([
            "Es verschwindet aus den Reisebildern von Gareth, von der Karte und aus der Leiste.",
            "Die Einsendung bleibt ohne Datei im Verlauf.",
        ]);
    });

    it("an freier Stelle, schon zurückgezogen, und abgelehnt (nie öffentlich)", () => {
        expect(loeschBlatt(detail({ origin: "community_upload", ausPhotobox: {} })).folgen[0]).toBe(
            "Es verschwindet von seiner Stelle auf der Karte und aus der Leiste.",
        );
        const zurueck = loeschBlatt(
            detail({ origin: "community_upload", ausPhotobox: { zustand: "offline", aktiv: false, ort: "Gareth" } }),
        );
        expect(zurueck.folgen).toEqual([
            "Das Bild ist schon zurückgezogen.",
            "Die Einsendung bleibt ohne Datei im Verlauf.",
        ]);
        const abgelehnt = loeschBlatt(
            detail({ origin: "community_upload", ausPhotobox: { zustand: "rejected", aktiv: false } }),
        );
        expect(abgelehnt.folgen).toEqual(["Die Einsendung bleibt ohne Datei im Verlauf."]);
    });

    it("🔴 ein bytegleiches anderes Werk behält seine Datei, und das Blatt nennt es (ohne Titel mit dem Ersatznamen)", () => {
        const blatt = loeschBlatt(
            detail({ origin: "community_upload", ausPhotobox: {} }),
            gleich("Typbild Reichsstraße", null),
        );
        expect(blatt.folgen.slice(-2)).toEqual([
            "„Typbild Reichsstraße“ hat dieselbe Datei. Es ist ein eigenes Werk und behält sie.",
            "„Bild ohne Titel“ hat dieselbe Datei. Es ist ein eigenes Werk und behält sie.",
        ]);
        expect(loeschBlatt(detail({}), gleich("Zwilling")).folgen).toEqual([
            "„Zwilling“ hat dieselbe Datei. Es ist ein eigenes Werk und behält sie.",
        ]);
    });

    it("🔴 ein Notaus an diesem Bild: bleibt im Verlauf; „gesperrt“ nur, solange er gilt; einer an einem anderen Werk gehört nicht hierher", () => {
        const gilt = loeschBlatt(detail({ notaus: [{ an: ID }] }));
        expect(gilt.notaus).toBe(
            "An diesem Bild wurde ein Notaus ausgelöst. Der Notaus bleibt mit Grund, Person, Zeit und Prüfsumme im Verlauf, nur ohne Verweis auf das Bild. Dieselbe Datei bleibt an allen anderen Stellen gesperrt.",
        );
        const aufgehoben = loeschBlatt(detail({ notaus: [{ an: ID, aufgehoben: true }] }));
        expect(aufgehoben.notaus).toBe(
            "An diesem Bild wurde ein Notaus ausgelöst. Der Notaus bleibt mit Grund, Person, Zeit und Prüfsumme im Verlauf, nur ohne Verweis auf das Bild.",
        );
        expect(loeschBlatt(detail({ notaus: [{ an: ANDERES }, { an: null }] })).notaus).toBeUndefined();
    });

    it("das Bild aus einem Kartenvorschlag sagt weiter, was es sagte", () => {
        const blatt = loeschBlatt(
            detail({ origin: "community_upload", ausVorschlag: { nurStillgelegt: true, vorschauen: 1 } }),
        );
        expect(blatt.zusatz).toBe("Bild aus einem Kartenvorschlag, nur noch an stillgelegten Einträgen");
        expect(blatt.folgen).toHaveLength(2);
        expect(blatt.folgen[0]).toContain("Porto Paligan Spielerversion Test");
        expect(blatt.folgen[1]).toBe("Was daraus als Vorschau erzeugt wurde, fällt mit.");
    });
});
