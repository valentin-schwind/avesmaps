import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MamAssetSummary, MediaSlotAsset, MediaSubjectSlots } from "@avesmaps3d/shared";
import {
    auswahlEintrag,
    auswahlHandlung,
    gebundeneAssets,
    hochgeladenSatz,
    typbildHandlung,
    wartetAufPruefung,
} from "../src/medien/medien-auswahl-modell.ts";

/**
 * Die Auswahl eines Wappens oder Titelbilds (WI-0068 P4b, WI-0126 §11j, Gesamtmockup Version 7): „gebunden“, „hochgeladen von … ·
 * Datum“ (nie leer), „wartet auf Rechteprüfung“ und was der Hauptknopf tut.
 */

const ORT = "a1b2c3d4-0000-4000-9000-000000000001";
const WAPPEN = "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69";
const ANDERES = "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a70";
const datum = (iso: string): string => iso.slice(0, 10);

function treffer(ueber: Partial<MamAssetSummary> = {}): MamAssetSummary {
    return {
        id: WAPPEN,
        revision: 1,
        title: "Wappen von Gareth",
        kind: "image",
        assetType: "coat",
        origin: "legacy_import",
        creationMethod: "ai_generated",
        technicalState: "ok",
        rightsBasis: "own_work",
        clearance: "legacy_asserted",
        usageCount: 1,
        sharedFileCount: 0,
        fileGroup: null,
        primaryUsage: null,
        preview: null,
        published: true,
        suspended: false,
        updatedAt: "2026-10-05T10:00:00.000Z",
        uploadedBy: null,
        uploadedByLabel: null,
        uploadedAt: "2025-03-14T10:00:00.000Z",
        ...ueber,
    };
}

const slotAsset = (id: string): MediaSlotAsset =>
    ({
        id,
        revision: 1,
        title: null,
        technicalState: "ok",
        clearance: null,
        preview: null,
    }) as unknown as MediaSlotAsset;

/** Die Plätze von Gareth: ein Wappen; als Titelbild ein Einzelbild (`bild`) oder eine Galerie mit `titel` (WI-0219). */
function plaetze(
    ueber: { wappen?: string | null; titel?: string[]; max?: number; bild?: string; galerie?: boolean } = {},
): MediaSubjectSlots {
    const wappen = ueber.wappen === undefined ? WAPPEN : ueber.wappen;
    return {
        subject: { kind: "place", id: ORT, name: "Gareth", active: true },
        coat: {
            state: wappen === null ? "undecided" : "set",
            origin: wappen === null ? null : "legacy",
            revision: wappen === null ? null : 4,
            asset: wappen === null ? null : slotAsset(wappen),
        },
        header: {
            gallery:
                ueber.galerie === false || ueber.bild !== undefined
                    ? null
                    : { id: "b1b2c3d4-0000-4000-9000-000000000002", revision: 7, origin: "legacy" },
            image: ueber.bild === undefined ? null : { asset: slotAsset(ueber.bild), revision: 3, origin: "editor" },
            items: (ueber.titel ?? []).map((id, position) => ({ asset: slotAsset(id), position, revision: 1 })),
            max: ueber.max ?? 10,
            suppressed: false,
        },
    } as MediaSubjectSlots;
}

describe("Auswahl: die Zeile", () => {
    it("„hochgeladen von …“ nie leer: Person, Legacy mit Namen, Legacy, unbekannt; ohne Datum „Datum unbekannt“", () => {
        expect(
            hochgeladenSatz(
                treffer({ origin: "editor_upload", uploadedBy: { id: ORT, displayName: "Hesindiane" } }),
                datum,
            ),
        ).toBe("hochgeladen von Hesindiane · 2025-03-14");
        expect(hochgeladenSatz(treffer({ uploadedByLabel: "Gwendolin" }), datum)).toBe(
            "hochgeladen von Legacy-Import (Gwendolin) · 2025-03-14",
        );
        expect(hochgeladenSatz(treffer({ uploadedAt: null }), datum)).toBe(
            "hochgeladen von Legacy-Import · Datum unbekannt",
        );
        expect(hochgeladenSatz(treffer({ origin: "editor_upload", uploadedBy: null }), datum)).toContain("unbekannt");
        // Kam es anders herein, steht die Herkunft statt „unbekannt“.
        expect(hochgeladenSatz(treffer({ origin: "wiki_localized" }), datum)).toBe(
            "aus dem Wiki übernommen · 2025-03-14",
        );
    });

    it("„wartet auf Rechteprüfung“ nur ohne öffentliche Datei und mit ungeprüften Rechten", () => {
        expect(wartetAufPruefung(treffer())).toBe(false);
        expect(wartetAufPruefung(treffer({ published: false, clearance: "unreviewed" }))).toBe(true);
        expect(wartetAufPruefung(treffer({ published: false, clearance: "rejected" }))).toBe(false);
    });

    it("„gebunden“ am Wappen bzw. am Titelbild des Orts; Rechte und Verwendungen als Text", () => {
        const eintrag = auswahlEintrag(treffer({ usageCount: 3 }), gebundeneAssets(plaetze(), "coat"), datum);
        expect(eintrag).toMatchObject({
            name: "Wappen von Gareth",
            gebunden: true,
            rechte: "Eigenes Werk",
            verwendungen: "3 Verwendungen",
        });
        // WI-0219: Gebunden ist das Einzelbild; die Bilder einer Galerie sind kein Titelbild für sich.
        expect(gebundeneAssets(plaetze({ bild: ANDERES }), "header").has(ANDERES)).toBe(true);
        expect(gebundeneAssets(plaetze({ titel: [ANDERES] }), "header").has(ANDERES)).toBe(false);
        expect(gebundeneAssets(undefined, "coat").size).toBe(0);
    });
});

describe("Auswahl: der Hauptknopf", () => {
    it("Wappen: „Ersetzen“, wenn eines gebunden ist, sonst „Hinzufügen“; das gebundene noch einmal geht nicht", () => {
        expect(auswahlHandlung(plaetze(), "coat", ANDERES, "Gareth")).toMatchObject({
            text: "Ersetzen",
            gesperrt: undefined,
        });
        expect(auswahlHandlung(plaetze(), "coat", WAPPEN, "Gareth").gesperrt).toBe("dieses Wappen ist schon gebunden");
        expect(auswahlHandlung(plaetze({ wappen: null }), "coat", ANDERES, "Gareth")).toMatchObject({
            text: "Hinzufügen",
            gesperrt: undefined,
        });
        expect(auswahlHandlung(plaetze(), "coat", undefined, "Gareth").gesperrt).toBe("noch nichts gewählt");
        expect(auswahlHandlung(undefined, "coat", ANDERES, "Gareth").gesperrt).toBeDefined();
    });

    it("🔴 Titelbild (WI-0219): „Als Titelbild setzen“ ohne, „Titelbild ersetzen“ mit Bild oder Galerie; das Bisherige bleibt", () => {
        // Betreiber 2026-10-17: „er kann nicht mehr wie ein bild haben, EIN titelbild oder EINE Galerie“.
        expect(auswahlHandlung(plaetze({ galerie: false }), "header", ANDERES, "Gareth")).toMatchObject({
            text: "Als Titelbild setzen",
            gesperrt: undefined,
        });
        const stattBild = auswahlHandlung(plaetze({ bild: WAPPEN }), "header", ANDERES, "Gareth");
        expect(stattBild.text).toBe("Titelbild ersetzen");
        expect(stattBild.satz).toContain("Titelbild von Gareth");
        expect(stattBild.satz).toContain("bleibt in der Medienverwaltung");
        const stattGalerie = auswahlHandlung(plaetze({ titel: [WAPPEN] }), "header", ANDERES, "Gareth");
        expect(stattGalerie).toMatchObject({ text: "Titelbild ersetzen", gesperrt: undefined });
        // Ein Bild der Galerie darf das Einzelbild werden: Es ersetzt die Galerie.
        expect(auswahlHandlung(plaetze({ titel: [ANDERES] }), "header", ANDERES, "Gareth").gesperrt).toBeUndefined();
    });

    it("dasselbe Bild noch einmal geht nicht; keine Grenze von zehn mehr", () => {
        expect(auswahlHandlung(plaetze({ bild: ANDERES }), "header", ANDERES, "Gareth").gesperrt).toBe(
            "dieses Bild ist hier schon das Titelbild",
        );
        expect(
            auswahlHandlung(plaetze({ titel: [WAPPEN], max: 1 }), "header", ANDERES, "Gareth").gesperrt,
        ).toBeUndefined();
        expect(auswahlHandlung(plaetze(), "header", undefined, "Gareth").gesperrt).toBe("noch nichts gewählt");
    });
});

describe("Auswahl eines Typbilds je Variante (WI-0281)", () => {
    it("🔴 der Knopf sperrt, wenn die Entstehung des gewählten Bildes nicht zur Variante passt, wie der Server", () => {
        expect(typbildHandlung(null, "a", "Kleinstadt", "ohne_ki", "drawing").gesperrt).toBeUndefined();
        expect(typbildHandlung(null, "a", "Kleinstadt", "ohne_ki", "ai_generated").gesperrt).toBe(
            "Als Typbild ohne KI geht nur ein Bild, dessen Entstehung als Foto, Zeichnung oder Scan eingetragen ist.",
        );
        expect(typbildHandlung(null, "a", "Kleinstadt", "ohne_ki", "unknown").gesperrt).toBeDefined();
        expect(typbildHandlung(null, "a", "Kleinstadt", "ki", "photo").gesperrt).toBe(
            "Dieses Bild ist ohne KI entstanden: Es gehört in die Variante „Ohne KI“.",
        );
        expect(typbildHandlung(null, "a", "Kleinstadt", "ki", "unknown").gesperrt).toBeUndefined();
        // Ohne Variante und Entstehung (Vorversion) wie bisher.
        expect(typbildHandlung({ assetId: "a" }, "a", "Kleinstadt").gesperrt).toBe(
            "Dieses Bild ist schon das Typbild dieser Kategorie.",
        );
    });
});

describe("Das Auswahlfenster trägt sein Hochladen (WI-0281, ein Editor 2026-11-05: „Hochladen macht da gar nichts“)", () => {
    const wurzel = fileURLToPath(new URL("../src", import.meta.url));
    const aufrufe = [
        "medien/medien-fenster.vue",
        "medien/medien-inspektor.vue",
        "medien/medien-wappen-kasten.vue",
        "ortseditor/ortseditor-bilder.vue",
    ].map((pfad) => ({
        pfad,
        block: /<MedienAuswahlFenster\b[\s\S]*?\/>/u.exec(readFileSync(join(wurzel, pfad), "utf8"))?.[0] ?? "",
    }));

    it.each(aufrufe)("🔴 $pfad hängt es nicht an sein eigenes `offen`", ({ block }) => {
        // „Neues … hochladen“ schließt die Auswahl über `offen`, und das Formular steht IN diesem Fenster: Bedingt der Aufrufer es mit demselben
        // Wert, verschwindet mit der Auswahl auch das Formular, und der Klick tut scheinbar nichts (Typbilder, 13.10. bis 05.11.).
        const offen = /v-model:offen="(\w+)"/u.exec(block)?.[1];
        const bedingung = /v-if="([^"]*)"/u.exec(block)?.[1];
        expect(offen).toBeDefined();
        expect(bedingung).toBeDefined();
        expect(bedingung).not.toMatch(new RegExp(`\\b${offen}\\b`, "u"));
    });
});
