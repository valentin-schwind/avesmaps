import { describe, expect, it } from "vitest";
import type { EditorPlaceRow, MediaSubjectSlots } from "@avesmaps3d/shared";
import { kopfFolge, ortsTreffer, ortsZeilen } from "../src/medien/medien-galerie-orte-modell";

/**
 * Was die Ortsauswahl einer Galerie rechnet (WI-0068 P6). Die Fälle sind die, an denen eine Ortsauswahl sonst still das Falsche
 * anbietet: Wiki-Zeilen sind keine Orte, und ein Ort hat EIN Titelbild ODER EINE Galerie (WI-0219): Ein Einzelbild wird gelöst,
 * eine zweite Galerie wiese der Server ab.
 */

const ort = (teil: Partial<EditorPlaceRow> = {}): EditorPlaceRow =>
    ({
        key: "80558060-4299-54aa-b520-814b10819885",
        origin: "karte",
        name: "Gareth",
        circle: "voll",
        assignment: "assigned",
        ...teil,
    }) as EditorPlaceRow;

describe("Welche Orte zur Wahl stehen", () => {
    it("🔴 eine Wiki-Zeile ist kein Ort - ihr Schlüssel ist `wiki:…`, daran bindet nichts", () => {
        const rows = [ort(), ort({ key: "wiki:gareth", origin: "wiki", name: "Gareth (Artikel)" })];
        expect(ortsZeilen(rows, "").map((zeile) => zeile.id)).toEqual(["80558060-4299-54aa-b520-814b10819885"]);
        expect(ortsTreffer(rows, "")).toBe(1);
    });

    it("ein Ort OHNE Lage bleibt wählbar - er ist ein echter Ort, nur ohne Kartenpunkt", () => {
        const rows = [ort({ key: "a", origin: "ohne-lage", name: "Verlorene Stätte" })];
        expect(ortsZeilen(rows, "")).toHaveLength(1);
        expect(ortsZeilen(rows, "")[0]?.gesperrt).toBeUndefined();
    });

    it("die Suche trifft Namensteile, ohne Rücksicht auf Groß- und Kleinschreibung", () => {
        const rows = [ort({ key: "a", name: "Gareth" }), ort({ key: "b", name: "Havena" })];
        expect(ortsZeilen(rows, "hav").map((zeile) => zeile.name)).toEqual(["Havena"]);
        expect(ortsZeilen(rows, "GARETH").map((zeile) => zeile.name)).toEqual(["Gareth"]);
        expect(ortsZeilen(rows, "xyz")).toEqual([]);
    });

    it("die Anzeige ist begrenzt, die Trefferzahl nicht", () => {
        const rows = Array.from({ length: 80 }, (_, i) => ort({ key: `k${String(i)}`, name: `Ort ${String(i)}` }));
        expect(ortsZeilen(rows, "", { gebunden: new Set(), grenze: 25 })).toHaveLength(25);
        expect(ortsTreffer(rows, "")).toBe(80);
    });
});

describe("Welcher Ort gesperrt ist", () => {
    it("🔴 ein Ort mit Titelbild ist wählbar und sagt es - ob Bild oder Galerie, entscheiden erst seine Plätze", () => {
        const zeilen = ortsZeilen([ort({ imageCount: 3 })], "");
        expect(zeilen[0]?.gesperrt).toBeUndefined();
        expect(zeilen[0]?.titelbild).toBeDefined();
        expect(ortsZeilen([ort()], "")[0]?.titelbild).toBeUndefined();
    });

    it("🔴 ein Ort, an dem DIESE Galerie schon hängt, sagt genau das", () => {
        const zeilen = ortsZeilen([ort({ key: "a" })], "", { gebunden: new Set(["a"]) });
        expect(zeilen[0]?.gesperrt).toBeDefined();
        // Der Grund „hängt schon“ gilt vor „hat Bilder“: Er ist der genauere.
        const mitBildern = ortsZeilen([ort({ key: "a", imageCount: 2 })], "", { gebunden: new Set(["a"]) });
        expect(mitBildern[0]?.gesperrt).toBe(zeilen[0]?.gesperrt);
    });

    it("ein Ort ohne Bilder ist wählbar", () => {
        expect(ortsZeilen([ort()], "")[0]?.gesperrt).toBeUndefined();
    });
});

describe("Was Binden am gewählten Ort tut (WI-0219)", () => {
    const kopf = (teil: Partial<NonNullable<MediaSubjectSlots["header"]>>): MediaSubjectSlots["header"] => ({
        gallery: null,
        image: null,
        items: [],
        max: 10,
        suppressed: false,
        ...teil,
    });

    it("🔴 hängt dort eine Galerie, ist Binden gesperrt - ersetzen geht im Ortseditor", () => {
        const folge = kopfFolge(
            kopf({ gallery: { id: "80558060-4299-54aa-b520-814b10819885", revision: 3, origin: "legacy" } }),
        );
        expect(folge.gesperrt).toBeDefined();
        expect(folge.hinweis).toBeUndefined();
    });

    it("🔴 hängt dort ein Einzelbild, bleibt Binden offen, und ein Hinweis sagt, dass es gelöst wird", () => {
        const image = { revision: 2, origin: "editor" } as NonNullable<
            NonNullable<MediaSubjectSlots["header"]>["image"]
        >;
        const folge = kopfFolge(kopf({ image }));
        expect(folge.gesperrt).toBeUndefined();
        expect(folge.hinweis).toBeDefined();
    });

    it("ohne Titelbild, „bewusst ohne“ oder ohne Platz: nichts zu sagen", () => {
        expect(kopfFolge(kopf({}))).toEqual({});
        expect(kopfFolge(kopf({ suppressed: true }))).toEqual({});
        expect(kopfFolge(null)).toEqual({});
    });
});

describe("Die Unterzeile", () => {
    it("nennt Art und Lage, soweit bekannt", () => {
        expect(ortsZeilen([ort({ subtype: "Metropole", region: "Garetien" })], "")[0]?.unterzeile).toBe(
            "Metropole · Garetien",
        );
        expect(ortsZeilen([ort({ kind: "Festung", within: "Gareth" })], "")[0]?.unterzeile).toBe("Festung · Gareth");
    });

    it("bleibt leer, wenn nichts bekannt ist - nie ein Trenner ohne Inhalt", () => {
        expect(ortsZeilen([ort()], "")[0]?.unterzeile).toBe("");
        expect(ortsZeilen([ort({ subtype: "  " })], "")[0]?.unterzeile).toBe("");
    });
});
