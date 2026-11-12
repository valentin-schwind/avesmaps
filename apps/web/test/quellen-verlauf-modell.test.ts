import { describe, expect, it } from "vitest";
import type { InhalteTraegerQuelle, MapHistoryEntry } from "@avesmaps3d/shared";
import {
    feldWechsel,
    istQuellenEintrag,
    juengsteJeQuelle,
    protokollKennungen,
    quellenZeilen,
    standVon,
    umkehrung,
    wechselVon,
    type QuellenStand,
} from "../src/fenster/quellen-verlauf-modell.ts";
import { aenderungenText, kopfText, zeilenText } from "../src/fenster/quellen-verlauf-texte.ts";
import { baueAenderung } from "../src/fenster/traeger-quellen-modell.ts";

/**
 * Die Änderungen an den Quellen eines Kartenobjekts im Verlauf (WI-0254 §12), ohne Vue: aus dem Protokolleintrag `<art>.sources_changed` die lesbaren Zeilen („Quelle „Titel“ angehängt“, „… geändert: Seiten 12 → 14“)
 * und die Umkehrung, die ↺ über denselben Schreibweg schickt, nur solange die Verknüpfung so dasteht wie nach der Änderung.
 *
 * Problemfälle: ein Eintrag, der als rohe Liste im Verlauf steht und niemandem etwas sagt; ein ↺, das überschreibt, was jemand danach getan hat; ein ↺ „gelöst“, das die Angaben verliert; ein Eintrag mit zwei
 * Quellen, der nur eine zurücknimmt.
 */

const ORT = "00000000-0000-4000-8000-0000000000a1";
const sid = (nr: number): string => `00000000-0000-4000-8000-00000000060${String(nr)}`;

const stand = (teil: Partial<QuellenStand> = {}): QuellenStand => ({
    state: "active",
    referenceKind: "ausfuehrlich",
    pages: "12",
    note: null,
    ...teil,
});
const protokoll = (nr: number, titel: string, s: QuellenStand) => ({
    sourceId: sid(nr),
    title: titel,
    state: s.state,
    referenceKind: s.referenceKind,
    pages: s.pages,
    note: s.note,
});
const NICHTS = stand({ state: "none", referenceKind: null, pages: null, note: null });

/** Ein Eintrag mit den Änderungen `[Nr, Titel, vorher, nachher]` an den Quellen des Orts. */
function eintrag(
    aenderungen: readonly (readonly [number, string, QuellenStand, QuellenStand])[],
    teil: Partial<MapHistoryEntry> = {},
): MapHistoryEntry {
    return {
        operationId: "00000000-0000-4000-8000-0000000000e1",
        seq: 7,
        at: "2026-10-28T10:00:00.000Z",
        operation: "traeger.sources",
        source: "editor",
        summary: "Quellen von „Gareth“ geändert",
        actor: { kind: "person", name: "Hesindiane" },
        objects: [
            {
                kind: "place",
                id: ORT,
                name: "Gareth",
                action: "place.sources_changed",
                revisionBefore: null,
                revisionAfter: null,
                changes: {
                    quellen: {
                        before: aenderungen.map(([nr, titel, vorher]) => protokoll(nr, titel, vorher)),
                        after: aenderungen.map(([nr, titel, , nachher]) => protokoll(nr, titel, nachher)),
                    },
                },
            },
        ],
        ...teil,
    };
}

const quelle = (teil: Partial<InhalteTraegerQuelle> = {}): InhalteTraegerQuelle => ({
    sourceId: sid(1),
    title: "Herz des Reiches",
    sourceType: "regionalspielhilfe",
    offiziell: true,
    url: null,
    referenceKind: "ausfuehrlich",
    pages: "12",
    note: null,
    state: "active",
    updatedAt: "2026-10-28T10:00:00.000Z",
    wiki: null,
    ...teil,
});

describe("Was aus vorher und nachher einer Verknüpfung wurde", () => {
    it("🔴 angehängt, gelöst, zurückgeholt, geändert", () => {
        expect(wechselVon(NICHTS, stand())).toBe("angehaengt");
        expect(wechselVon(stand(), stand({ state: "retired" }))).toBe("geloest");
        expect(wechselVon(stand(), stand({ state: "suppressed" }))).toBe("geloest");
        expect(wechselVon(stand({ state: "retired" }), stand())).toBe("zurueckgeholt");
        expect(wechselVon(stand({ state: "suppressed" }), stand())).toBe("zurueckgeholt");
        expect(wechselVon(stand(), stand({ pages: "14" }))).toBe("geaendert");
    });
});

describe("Die Zeilen eines Eintrags", () => {
    it("🔴 je geänderter Verknüpfung eine Zeile, mit Titel, Art des Wechsels, vorher und nachher", () => {
        const e = eintrag([
            [1, "Herz des Reiches", NICHTS, stand()],
            [2, "Wege der Helden", stand(), stand({ pages: "14" })],
        ]);
        const zeilen = quellenZeilen(e, ORT);
        expect(zeilen.map((z) => [z.sourceId, z.titel, z.wechsel])).toEqual([
            [sid(1), "Herz des Reiches", "angehaengt"],
            [sid(2), "Wege der Helden", "geaendert"],
        ]);
        expect(zeilen[1]?.vorher.pages).toBe("12");
        expect(zeilen[1]?.nachher.pages).toBe("14");
        // Eindeutig im Verlauf: Operation und Quelle.
        expect(new Set(zeilen.map((z) => z.schluessel)).size).toBe(2);
    });

    it("nur die des Objekts, dessen Verlauf gezeigt wird; ein fremder Eintrag oder ein Eintrag ohne Quellen gibt keine", () => {
        const e = eintrag([[1, "A", NICHTS, stand()]]);
        expect(quellenZeilen(e, "00000000-0000-4000-8000-0000000000ff")).toEqual([]);
        const feld = eintrag([], {
            objects: [
                {
                    kind: "place",
                    id: ORT,
                    action: "place.updated",
                    revisionBefore: 1,
                    revisionAfter: 2,
                    changes: { name: { before: "Gareth", after: "Garethia" } },
                },
            ],
        });
        expect(quellenZeilen(feld, ORT)).toEqual([]);
        expect(istQuellenEintrag(feld)).toBe(false);
        expect(istQuellenEintrag(e)).toBe(true);
    });

    it("🔴 eine Änderung vom Reiter „Quellen“ her (`source.update`) trägt neben `path.sources_changed` den Eintrag der Quelle selbst: Im Verlauf der Straße ist das ein Quellen-Eintrag mit lesbaren Zeilen, nicht ein Feld des Wegs", () => {
        const anker = "00000000-0000-4000-8000-0000000000b1";
        const e = eintrag([[1, "Reichsstraße", stand({ pages: "5" }), stand({ pages: "9" })]], {
            operation: "source.update",
            summary: "Quelle „Reichsstraße“ geändert",
        });
        e.objects[0]!.kind = "path";
        e.objects[0]!.id = anker;
        e.objects[0]!.action = "path.sources_changed";
        e.objects.push({
            kind: "source",
            id: sid(1),
            name: "Reichsstraße",
            action: "source.updated",
            revisionBefore: 2,
            revisionAfter: 3,
            changes: { links: { before: [], after: [] } },
        });
        expect(istQuellenEintrag(e)).toBe(true);
        expect(quellenZeilen(e, [anker]).map((z) => [z.sourceId, z.wechsel])).toEqual([[sid(1), "geaendert"]]);
        expect(kopfText(e, [anker])).toBe("Quelle „Reichsstraße“ geändert: Seiten 5 → 9");
        // Ein Eintrag, der nur die Quelle nennt, ist keiner für ein Kartenobjekt.
        expect(istQuellenEintrag({ objects: [e.objects[1]!] })).toBe(false);
    });

    it("🔴 beim Weg hängt der Eintrag an EINEM Abschnitt der Straße (`path.sources_changed` am Anker): Es zählt jede Kennung der Straße, nicht nur die, unter der gerade gelesen wird", () => {
        const anker = "00000000-0000-4000-8000-0000000000b1";
        const zweiter = "00000000-0000-4000-8000-0000000000b2";
        const dritter = "00000000-0000-4000-8000-0000000000b3";
        const e = eintrag([[1, "Reichsstraße", NICHTS, stand()]]);
        e.objects[0]!.kind = "path";
        e.objects[0]!.id = anker;
        e.objects[0]!.action = "path.sources_changed";
        const strasse = [anker, zweiter, dritter];
        expect(istQuellenEintrag(e)).toBe(true);
        expect(quellenZeilen(e, strasse).map((z) => z.sourceId)).toEqual([sid(1)]);
        // Der Anker kann inzwischen ein anderer sein (Teilen, Verbinden): Der Eintrag gehört der Straße, solange einer ihrer Abschnitte ihn trägt.
        expect(quellenZeilen(e, [zweiter, dritter, anker]).map((z) => z.sourceId)).toEqual([sid(1)]);
        // Eine andere Straße sieht ihn nicht.
        expect(quellenZeilen(e, [zweiter, dritter])).toEqual([]);
        expect(kopfText(e, strasse)).toBe("Quelle „Reichsstraße“ angehängt");
        expect(juengsteJeQuelle([e], strasse).get(sid(1))).toBe(quellenZeilen(e, strasse)[0]?.schluessel);
        expect(juengsteJeQuelle([e], [zweiter, dritter]).size).toBe(0);
        // Ohne Angabe zählt alles; eine Kennung als Text ist wie eine Liste mit einer.
        expect(quellenZeilen(e)).toHaveLength(1);
        expect(quellenZeilen(e, anker)).toHaveLength(1);
        expect(protokollKennungen({ id: zweiter, ids: strasse })).toEqual(strasse);
        expect(protokollKennungen({ id: ORT })).toBe(ORT);
        expect(protokollKennungen(undefined)).toBeUndefined();
    });

    it("ein Gegenstand mit zerrüttetem Protokoll (kein Zustand, keine Kennung) bricht nichts, die Zeile fehlt", () => {
        const e = eintrag([[1, "A", NICHTS, stand()]]);
        e.objects[0]!.changes["quellen"] = {
            before: [{ foo: 1 }],
            after: [{ sourceId: sid(1), title: "A", state: "kaputt" }],
        };
        expect(quellenZeilen(e, ORT)).toEqual([]);
    });
});

describe("Die Zeilen als Text", () => {
    it("🔴 angehängt, gelöst, zurückgeholt: der Titel in Anführungszeichen", () => {
        const [an, weg, zurueck] = [
            eintrag([[1, "Herz des Reiches", NICHTS, stand()]]),
            eintrag([[1, "Herz des Reiches", stand(), stand({ state: "retired" })]]),
            eintrag([[1, "Herz des Reiches", stand({ state: "retired" }), stand()]]),
        ].map((e) => zeilenText(quellenZeilen(e, ORT)[0]!));
        expect(an).toBe("Quelle „Herz des Reiches“ angehängt");
        expect(weg).toBe("Quelle „Herz des Reiches“ gelöst");
        expect(zurueck).toBe("Quelle „Herz des Reiches“ zurückgeholt");
    });

    it("🔴 geändert nennt, was sich änderte: Seiten 12 → 14", () => {
        const z = quellenZeilen(eintrag([[1, "Herz des Reiches", stand(), stand({ pages: "14" })]]), ORT)[0]!;
        expect(zeilenText(z)).toBe("Quelle „Herz des Reiches“ geändert: Seiten 12 → 14");
    });

    it("Art, Seiten und Notiz zusammen in der Folge Seiten, Art, Notiz; leer ist „–“, die Notiz steht als Text und gekürzt", () => {
        const vorher = stand({ referenceKind: "ausfuehrlich", pages: null, note: "{{R5}} Hof" });
        const nachher = stand({ referenceKind: "ergaenzend", pages: "9", note: "x".repeat(80) });
        const z = quellenZeilen(eintrag([[1, "A", vorher, nachher]]), ORT)[0]!;
        const text = aenderungenText(z);
        expect(text.startsWith("Seiten – → 9; Art Ausführlich → Ergänzend; Notiz DSA5-Regeln Hof → ")).toBe(true);
        expect(text.endsWith("…")).toBe(true);
    });

    it("Leerraum an den Rändern ist keine Änderung", () => {
        expect(feldWechsel(stand({ pages: "12" }), stand({ pages: " 12 " }))).toEqual([]);
    });

    it("🔴 die Überschrift nennt die Zeile nur bei GENAU EINER Änderung; bei mehreren gilt die Zusammenfassung", () => {
        const eine = eintrag([[1, "A", NICHTS, stand()]]);
        const zwei = eintrag([
            [1, "A", NICHTS, stand()],
            [2, "B", NICHTS, stand()],
        ]);
        expect(kopfText(eine, ORT)).toBe("Quelle „A“ angehängt");
        expect(kopfText(zwei, ORT)).toBeUndefined();
    });

    it("eine Quelle ohne Titel heißt „(ohne Namen)“", () => {
        const z = quellenZeilen(eintrag([[1, "", NICHTS, stand()]]), ORT)[0]!;
        expect(zeilenText(z)).toBe("Quelle „(ohne Namen)“ angehängt");
    });
});

describe("Die Umkehrung (↺)", () => {
    const zeile = (vorher: QuellenStand, nachher: QuellenStand) =>
        quellenZeilen(eintrag([[1, "A", vorher, nachher]]), ORT)[0]!;

    it("🔴 angehängt wird gelöst, solange sie so dasteht wie nach dem Anhängen", () => {
        const z = zeile(NICHTS, stand());
        expect(umkehrung(z, quelle())).toEqual({ art: "geht", handlung: { art: "loesen" } });
    });

    it("🔴 gelöst wird zurückgeholt, mit den Angaben, die sie hatte", () => {
        const z = zeile(stand(), stand({ state: "retired" }));
        const heute = quelle({ state: "retired" });
        expect(umkehrung(z, heute)).toEqual({ art: "geht", handlung: { art: "holen" } });
        expect(baueAenderung(sid(1), { art: "holen" }, heute)).toMatchObject({
            op: "restore",
            vorher: { state: "retired", pages: "12" },
        });
    });

    it("🔴 zurückgeholt wird wieder gelöst", () => {
        const z = zeile(stand({ state: "suppressed" }), stand());
        expect(umkehrung(z, quelle())).toEqual({ art: "geht", handlung: { art: "loesen" } });
    });

    it("🔴 geändert geht auf die Angaben von vorher zurück, alle drei, und leer leert; vorher der Anfrage ist der heutige Stand", () => {
        const z = zeile(
            stand({ pages: "12", note: "alt" }),
            stand({ pages: "14", note: null, referenceKind: "ergaenzend" }),
        );
        const heute = quelle({ pages: "14", note: null, referenceKind: "ergaenzend" });
        const u = umkehrung(z, heute);
        expect(u).toEqual({
            art: "geht",
            handlung: { art: "angaben", referenceKind: "ausfuehrlich", seiten: "12", notiz: "alt" },
        });
        if (u.art !== "geht") throw new Error("geht");
        expect(baueAenderung(sid(1), u.handlung, heute)).toEqual({
            op: "update",
            sourceId: sid(1),
            vorher: { state: "active", referenceKind: "ergaenzend", pages: "14", note: null },
            referenceKind: "ausfuehrlich",
            pages: "12",
            note: "alt",
        });
        // Vorher leer: ↺ leert.
        const leer = zeile(stand({ pages: null }), stand({ pages: "14" }));
        const l = umkehrung(leer, quelle({ pages: "14" }));
        if (l.art !== "geht") throw new Error("geht");
        expect(baueAenderung(sid(1), l.handlung, quelle({ pages: "14" }))).toMatchObject({ pages: null });
    });

    it("💣 steht die Verknüpfung seitdem anders da, geht ↺ nicht: Es überschriebe, was jemand danach tat", () => {
        const z = zeile(NICHTS, stand());
        // Jemand hat die Seiten geändert.
        expect(umkehrung(z, quelle({ pages: "99" })).art).toBe("anders");
        // Jemand hat sie gelöst.
        expect(umkehrung(z, quelle({ state: "retired" })).art).toBe("anders");
        // Sie gibt es nicht mehr (stillgelegt im Katalog).
        expect(umkehrung(z, undefined).art).toBe("anders");
    });

    it("beim Vergleich mit dem heutigen Stand zählt wie beim Wiki: gekürzt, leer ist nichts", () => {
        const z = zeile(NICHTS, stand({ pages: "12", note: null }));
        expect(umkehrung(z, quelle({ pages: " 12 ", note: "  " })).art).toBe("geht");
    });

    it("eine Verknüpfung, die es nicht gibt, hat den Stand ‚none‘", () => {
        expect(standVon(undefined)).toEqual(NICHTS);
    });
});

describe("Die jüngste Zeile je Quelle", () => {
    const ein = (seq: number, nr: number): MapHistoryEntry =>
        eintrag([[nr, `Quelle ${String(nr)}`, stand({ pages: "1" }), stand({ pages: String(seq) })]], {
            operationId: `00000000-0000-4000-8000-0000000000${String(seq).padStart(2, "0")}`,
            seq,
        });

    it("🔴 je Quelle die Operation mit der höchsten seq, gleich in welcher Folge die Einträge kommen", () => {
        const eintraege = [ein(5, 1), ein(9, 2), ein(2, 1), ein(7, 2)];
        const jungste = juengsteJeQuelle(eintraege, ORT);
        expect(jungste.get(sid(1))).toBe(quellenZeilen(ein(5, 1), ORT)[0]?.schluessel);
        expect(jungste.get(sid(2))).toBe(quellenZeilen(ein(9, 2), ORT)[0]?.schluessel);
        expect(juengsteJeQuelle([...eintraege].reverse(), ORT).get(sid(1))).toBe(jungste.get(sid(1)));
    });

    it("ohne Einträge oder fremde Einträge gibt es keine", () => {
        expect(juengsteJeQuelle([]).size).toBe(0);
        expect(juengsteJeQuelle([ein(5, 1)], "00000000-0000-4000-8000-0000000000ff").size).toBe(0);
    });
});
