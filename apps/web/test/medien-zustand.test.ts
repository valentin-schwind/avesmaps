import { describe, expect, it } from "vitest";
import { MAM_BASKETS, MAM_PAGE_LIMIT } from "@avesmaps3d/shared";
import {
    adresseMitZustand,
    auswahlAusKennung,
    auswahlKennung,
    filterAnzahl,
    gleicheAuswahl,
    hochladbareRollen,
    istEinreichungsKorb,
    listenSchluessel,
    MEDIEN_START,
    mitFilter,
    naechsterEintrag,
    ohneFilter,
    startEbene,
    suchAdresse,
    suchanfrage,
    vonLesen,
    waehle,
    zustandAusAdresse,
    type MedienZustand,
} from "../src/medien/medien-zustand.ts";

/**
 * Das Zustands- und Adressmodell der Medienverwaltung (WI-0068 P3, §18 „URL-/State-Modell so, dass direkter Context Entry
 * reproduzierbar ist“) und die Abbildung auf die Suche des Servers. Das Fenster liest und schreibt nur hierüber.
 */

const ASSET = "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69";
const GARETH = "80558060-4299-54aa-b520-814b10819885";

const zustand = (teil: Partial<MedienZustand> = {}): MedienZustand => ({ ...MEDIEN_START, ...teil });

describe("Adresse: ein tiefer Link öffnet genau dieses Asset", () => {
    it("ohne `medien` in der Adresse ist das Fenster nicht gemeint", () => {
        expect(zustandAusAdresse("")).toBeUndefined();
        expect(zustandAusAdresse("?route=Gareth~Perricum&edit=1")).toBeUndefined();
    });

    it("🔴 `?medien=<asset>` allein: genau dieses Asset, sonst die Vorgabe", () => {
        expect(zustandAusAdresse(`?edit=1&medien=${ASSET}`)).toEqual(zustand({ asset: ASSET }));
    });

    it("`?medien` ohne Wert öffnet das Fenster ohne Asset", () => {
        expect(zustandAusAdresse("?medien")).toEqual(zustand());
        expect(zustandAusAdresse("?medien=")).toEqual(zustand());
    });

    it("🔴 der Kontext-Einstieg ist reproduzierbar: Asset und „verwendet von“ in einer Adresse, hin und zurück gleich", () => {
        const einstieg = zustand({ asset: ASSET, von: `place:${GARETH}` });
        const adresse = adresseMitZustand("?edit=1", einstieg);
        expect(adresse).toBe(`?edit=1&medien=${ASSET}&medien-von=place%3A${GARETH}`);
        expect(zustandAusAdresse(adresse)).toEqual(einstieg);
    });

    it("jeder Teil des Zustands übersteht den Weg durch die Adresse", () => {
        const voll = zustand({
            auswahl: { korb: "rights_open" },
            q: "Gareth Wappen",
            filter: {
                role: "coat",
                rightsBasis: "own_work",
                clearance: "legacy_assumed",
                origin: "legacy_import",
                creation: "ai_generated",
                technical: "ok",
            },
            von: `territory:${GARETH}`,
            sort: "rights",
            order: "desc",
            ansicht: "liste",
            asset: ASSET,
        });
        expect(zustandAusAdresse(adresseMitZustand("", voll))).toEqual(voll);
        const modelle = zustand({ auswahl: { typ: "model_3d" } });
        expect(zustandAusAdresse(adresseMitZustand("", modelle))).toEqual(modelle);
        const wappen = zustand({ auswahl: { typ: "coat" } });
        expect(adresseMitZustand("", wappen)).toBe("?medien&medien-typ=coat");
        expect(zustandAusAdresse(adresseMitZustand("", wappen))).toEqual(wappen);
        // Kachel füllen ist die Vorgabe und steht nicht in der Adresse; „Bild ganz anzeigen“ schon (Betreiber 2026-10-10).
        const ganz = zustand({ auswahl: { typ: "coat" }, bild: "ganz" });
        expect(adresseMitZustand("", ganz)).toBe("?medien&medien-typ=coat&medien-bild=ganz");
        expect(zustandAusAdresse(adresseMitZustand("", ganz))).toEqual(ganz);
        expect(zustandAusAdresse("?medien&medien-bild=schief")?.bild).toBe("fuellen");
    });

    it("nur Abweichungen von der Vorgabe stehen darin, und `medien` ohne Asset bleibt ohne `=`", () => {
        expect(adresseMitZustand("", zustand())).toBe("?medien");
        expect(adresseMitZustand("?edit=1", zustand({ sort: "name", ansicht: "raster" }))).toBe("?edit=1&medien");
    });

    it("🔴 andere Parameter bleiben bytegleich und in ihrer Reihenfolge (Legacys lesbare Reise); geschlossen nimmt alle Parameter des Fensters heraus", () => {
        const offen = adresseMitZustand("?route=Gareth~Perricum&edit=1", zustand({ asset: ASSET, sort: "usage" }));
        expect(offen).toBe(`?route=Gareth~Perricum&edit=1&medien=${ASSET}&medien-sort=usage`);
        expect(adresseMitZustand(offen, undefined)).toBe("?route=Gareth~Perricum&edit=1");
        expect(adresseMitZustand(`?medien=${ASSET}&medien-korb=unused`, undefined)).toBe("");
        expect(adresseMitZustand("?a=%E0&medien", undefined)).toBe("?a=%E0");
    });

    it("die Suche steht kodiert in der Adresse und kommt unverändert zurück", () => {
        const adresse = adresseMitZustand("", zustand({ q: "Wappen & Söhne" }));
        expect(adresse).toBe("?medien&medien-q=Wappen%20%26%20S%C3%B6hne");
        expect(zustandAusAdresse(adresse)?.q).toBe("Wappen & Söhne");
    });

    it("🔴 unbekannte Werte fallen weg - eine Adresse öffnet nie still etwas anderes", () => {
        const aus = zustandAusAdresse(
            "?medien=kein-uuid&medien-korb=alles&medien-typ=video&medien-art=video&medien-rolle=banner&medien-von=ort:123&medien-sort=zufall&medien-folge=quer&medien-ansicht=karte",
        );
        expect(aus).toEqual(zustand());
    });

    it("ein Korb geht vor einem Typ; ein alter Link `medien-art` gilt weiter; die Suche wird gekürzt und gestutzt", () => {
        expect(zustandAusAdresse("?medien&medien-korb=unused&medien-typ=coat")?.auswahl).toEqual({
            korb: "unused",
        });
        expect(zustandAusAdresse("?medien&medien-art=model_3d")?.auswahl).toEqual({ typ: "model_3d" });
        expect(zustandAusAdresse("?medien&medien-art=image")?.auswahl).toEqual({ typ: null });
        expect(zustandAusAdresse(`?medien&medien-q=${"x".repeat(300)}`)?.q).toHaveLength(200);
        expect(zustandAusAdresse("?medien&medien-q=%20Gareth%20")?.q).toBe("Gareth");
    });

    it("jeder Korb des Vertrags ist in der Adresse lesbar", () => {
        for (const korb of MAM_BASKETS) {
            expect(zustandAusAdresse(adresseMitZustand("", zustand({ auswahl: { korb } })))?.auswahl).toEqual({ korb });
        }
    });
});

describe("Die Suche: EINE Abbildung auf `GET /api/editor/media`", () => {
    it("Typ oder Korb, nie beides; die Vorgabe sucht alle Medien nach Name", () => {
        expect(suchanfrage(zustand())).toEqual({ sort: "name", limit: 100, offset: 0 });
        expect(suchanfrage(zustand({ auswahl: { typ: "coat" } }))).toEqual({
            type: "coat",
            sort: "name",
            limit: 100,
            offset: 0,
        });
        expect(suchanfrage(zustand({ auswahl: { korb: "unused" } }))).toEqual({
            basket: "unused",
            sort: "name",
            limit: 100,
            offset: 0,
        });
    });

    it("Suche, „verwendet von“, Filter, Folge und Seite gehen mit; leere Suche nicht", () => {
        const anfrage = suchanfrage(
            zustand({
                q: "  Gareth ",
                von: `place:${GARETH}`,
                filter: { role: "coat", clearance: "legacy_assumed" },
                sort: "changed",
                order: "asc",
            }),
            100,
        );
        expect(anfrage).toEqual({
            q: "Gareth",
            subject: `place:${GARETH}`,
            role: "coat",
            clearance: "legacy_assumed",
            sort: "changed",
            order: "asc",
            limit: 100,
            offset: 100,
        });
        expect(suchanfrage(zustand({ q: "   " })).q).toBeUndefined();
    });

    it("die Seite bleibt unter der Obergrenze des Vertrags", () => {
        expect(suchanfrage(zustand(), 0, 10_000).limit).toBe(MAM_PAGE_LIMIT.max);
    });

    it("die Adresse der Suche hat feste Schlüssel in fester Reihenfolge", () => {
        expect(suchAdresse({ sort: "name", kind: "image", limit: 100, offset: 0, q: "Wappen Gareth" })).toBe(
            "/api/editor/media?kind=image&limit=100&offset=0&q=Wappen+Gareth&sort=name",
        );
    });

    it("🔴 der Listenschlüssel kennt keine Seite und kein Asset: Blättern und Wählen laden die Liste nicht neu", () => {
        const a = zustand({ q: "Gareth" });
        expect(listenSchluessel({ ...a, asset: ASSET })).toBe(listenSchluessel(a));
        expect(listenSchluessel({ ...a, ansicht: "liste" })).toBe(listenSchluessel(a));
        expect(listenSchluessel({ ...a, sort: "usage" })).not.toBe(listenSchluessel(a));
    });
});

describe("Filter und Facetten", () => {
    it("eine Facette ersetzt die vorige; Suche, Filter, „verwendet von“ und Asset bleiben", () => {
        const vorher = zustand({ q: "Gareth", filter: { role: "coat" }, von: `place:${GARETH}`, asset: ASSET });
        const nachher = waehle(vorher, { korb: "rights_open" });
        expect(nachher).toEqual({ ...vorher, auswahl: { korb: "rights_open" } });
        expect(gleicheAuswahl(nachher.auswahl, { korb: "rights_open" })).toBe(true);
        expect(gleicheAuswahl(nachher.auswahl, { typ: null })).toBe(false);
        expect(gleicheAuswahl({ typ: "coat" }, { typ: "coat" })).toBe(true);
        expect(gleicheAuswahl({ typ: "coat" }, { typ: "picture" })).toBe(false);
    });

    it("jede Wahl hat eine Kennung in der Schiene „Medienarten“ und kommt aus ihr zurück", () => {
        const wahlen = [
            { typ: null },
            { typ: "coat" },
            { typ: "model_3d" },
            ...MAM_BASKETS.map((korb) => ({ korb })),
        ] as const;
        for (const wahl of wahlen) expect(auswahlAusKennung(auswahlKennung(wahl))).toEqual(wahl);
        expect(auswahlKennung({ typ: null })).toBe("typ-alle");
        expect(auswahlKennung({ korb: "rights_open" })).toBe("korb-rights_open");
        // Ein späterer Eintrag (gestrichelt) ist keine Wahl.
        expect(auswahlAusKennung("galerien")).toBeUndefined();
        expect(auswahlAusKennung("typ-image")).toBeUndefined();
    });

    it("ein Filter wird gesetzt und gelöst, ohne die anderen anzufassen", () => {
        const a = mitFilter(zustand(), "role", "header");
        const b = mitFilter(a, "rightsBasis", "fan_policy");
        expect(b.filter).toEqual({ role: "header", rightsBasis: "fan_policy" });
        expect(mitFilter(b, "role", undefined).filter).toEqual({ rightsBasis: "fan_policy" });
    });

    it("die Zählung der Filter nimmt „verwendet von“ mit; „Filter lösen“ lässt Facette, Sortierung und Auswahl stehen", () => {
        const eng = zustand({
            q: "x",
            filter: { role: "coat", origin: "legacy_import" },
            von: `place:${GARETH}`,
            auswahl: { korb: "unused" },
            sort: "usage",
            asset: ASSET,
        });
        expect(filterAnzahl(eng)).toBe(3);
        expect(ohneFilter(eng)).toEqual({ ...eng, q: "", filter: {}, von: undefined });
        expect(filterAnzahl(ohneFilter(eng))).toBe(0);
    });

    it("„verwendet von“ nimmt nur die Fachobjekte des Vertrags mit einer Kennung", () => {
        expect(vonLesen(`citymap:${GARETH}`)).toEqual({ kind: "citymap", id: GARETH });
        expect(vonLesen(`path:${GARETH}`)).toBeUndefined();
        expect(vonLesen("place:Gareth")).toBeUndefined();
        expect(vonLesen(undefined)).toBeUndefined();
    });
});

describe("Telefon: Drill-down in drei Ebenen (§3.4)", () => {
    it("🔴 mit Asset beginnt es im Inspector - der Kontext-Einstieg landet auf Ebene 3", () => {
        expect(startEbene(zustand({ asset: ASSET, von: `place:${GARETH}` }))).toBe(3);
    });

    it("mit Einschränkung in den Treffern, sonst bei den Arten", () => {
        expect(startEbene(zustand({ auswahl: { korb: "unused" } }))).toBe(2);
        expect(startEbene(zustand({ q: "Gareth" }))).toBe(2);
        expect(startEbene(zustand({ von: `place:${GARETH}` }))).toBe(2);
        expect(startEbene(zustand())).toBe(1);
    });
});

describe("Pfeiltasten in der Liste", () => {
    it("weiter und zurück, an den Enden bleibt er stehen; ohne Auswahl der erste", () => {
        const ids = ["a", "b", "c"];
        expect(naechsterEintrag(ids, undefined, 1)).toBe("a");
        expect(naechsterEintrag(ids, "a", 1)).toBe("b");
        expect(naechsterEintrag(ids, "c", 1)).toBe("c");
        expect(naechsterEintrag(ids, "a", -1)).toBe("a");
        expect(naechsterEintrag(ids, "fremd", -1)).toBe("a");
        expect(naechsterEintrag([], "a", 1)).toBeUndefined();
    });
});

describe("Medienobjekt „Typbilder“ (WI-0068, Betreiber 2026-10-11)", () => {
    it("steht als eigene Facette in der Adresse, samt gewählter Kategorie", () => {
        const adresse = adresseMitZustand("", zustand({ auswahl: { objekt: "typbilder" }, kategorie: "dorf" }));
        expect(adresse).toBe("?medien&medien-objekt=typbilder&medien-kategorie=dorf");
        const zurueck = zustandAusAdresse(adresse);
        expect(zurueck?.auswahl).toEqual({ objekt: "typbilder" });
        expect(zurueck?.kategorie).toBe("dorf");
    });

    it("🔴 eine Kategorie ohne die Facette fällt weg - sie öffnet nie still etwas anderes", () => {
        expect(zustandAusAdresse("?medien&medien-kategorie=dorf")?.kategorie).toBeUndefined();
        // Und eine unbekannte Kategorie ebenso (nur Werte des Vertrags).
        expect(
            zustandAusAdresse("?medien&medien-objekt=typbilder&medien-kategorie=erfunden")?.kategorie,
        ).toBeUndefined();
        expect(zustandAusAdresse("?medien&medien-objekt=erfunden")?.auswahl).toEqual({ typ: null });
    });

    it("🔴 die Variante (WI-0281) steht nur bei den Typbildern und nur, wenn sie von der Vorgabe KI abweicht", () => {
        const ohneKi = zustand({ auswahl: { objekt: "typbilder" }, kategorie: "kleinstadt", variante: "ohne_ki" });
        const adresse = adresseMitZustand("", ohneKi);
        expect(adresse).toBe("?medien&medien-objekt=typbilder&medien-kategorie=kleinstadt&medien-variante=ohne_ki");
        expect(zustandAusAdresse(adresse)?.variante).toBe("ohne_ki");
        // Die Vorgabe steht nicht in der Adresse, und ohne Angabe gilt sie.
        expect(adresseMitZustand("", { ...ohneKi, variante: "ki" })).not.toContain("medien-variante");
        expect(zustandAusAdresse("?medien&medien-objekt=typbilder")?.variante).toBe("ki");
        // Nur Werte des Vertrags, nur bei den Typbildern.
        expect(zustandAusAdresse("?medien&medien-objekt=typbilder&medien-variante=halb")?.variante).toBe("ki");
        expect(zustandAusAdresse("?medien&medien-variante=ohne_ki")?.variante).toBe("ki");
        expect(adresseMitZustand("", { ...ohneKi, auswahl: { typ: null } })).not.toContain("medien-variante");
    });

    it("die Kategorie fällt beim Wechsel der Facette weg, bleibt aber innerhalb der Typbilder", () => {
        const offen = zustand({ auswahl: { objekt: "typbilder" }, kategorie: "dorf" });
        expect(waehle(offen, { typ: "coat" }).kategorie).toBeUndefined();
        expect(waehle(offen, { objekt: "typbilder" }).kategorie).toBe("dorf");
    });

    it("Kennung hin und zurück, wie bei Typen und Körben", () => {
        expect(auswahlKennung({ objekt: "typbilder" })).toBe("objekt-typbilder");
        expect(auswahlAusKennung("objekt-typbilder")).toEqual({ objekt: "typbilder" });
        expect(auswahlAusKennung("objekt-erfunden")).toBeUndefined();
    });

    it("gleicheAuswahl unterscheidet Objekt, Typ und Korb", () => {
        expect(gleicheAuswahl({ objekt: "typbilder" }, { objekt: "typbilder" })).toBe(true);
        expect(gleicheAuswahl({ objekt: "typbilder" }, { typ: null })).toBe(false);
        expect(gleicheAuswahl({ typ: null }, { objekt: "typbilder" })).toBe(false);
        expect(gleicheAuswahl({ korb: "unused" }, { objekt: "typbilder" })).toBe(false);
    });

    it("🔴 die Assetsuche bekommt keinen Typ und keinen Korb - ein Medienobjekt ist keine Assetliste", () => {
        const anfrage = suchanfrage(zustand({ auswahl: { objekt: "typbilder" } }));
        expect(anfrage.type).toBeUndefined();
        expect(anfrage.basket).toBeUndefined();
    });

    it("am Telefon beginnt es in der Liste der Kategorien, nicht bei den Arten", () => {
        expect(startEbene(zustand({ auswahl: { objekt: "typbilder" } }))).toBe(2);
    });

    it("bietet in der Trefferspalte nichts zum Hochladen an - das tut die Auswahl der Kategorie", () => {
        expect(hochladbareRollen({ objekt: "typbilder" })).toEqual([]);
    });
});

describe("Der Korb „PhotoBox-Uploads“ und seine drei Teile (WI-0272 S3, Aufgabe 18)", () => {
    const korb = zustand({ auswahl: { korb: "photobox_uploads" } });

    it("🔴 die Vorgabe ist Offen: dort wartet die Arbeit; nur im Korb gilt die Unterteilung", () => {
        expect(MEDIEN_START.einreichung).toBe("offen");
        expect(istEinreichungsKorb({ korb: "photobox_uploads" })).toBe(true);
        for (const andere of [{ korb: "unused" }, { typ: null }, { typ: "coat" }, { objekt: "typbilder" }] as const) {
            expect(istEinreichungsKorb(andere), JSON.stringify(andere)).toBe(false);
        }
    });

    it("die Suche trägt die Unterteilung nur im Korb; in jeder anderen Facette bleibt sie weg, auch mit einer Wahl", () => {
        expect(suchanfrage(korb)).toEqual({
            basket: "photobox_uploads",
            einreichung: "offen",
            sort: "name",
            limit: 100,
            offset: 0,
        });
        expect(suchanfrage({ ...korb, einreichung: "rueckfrage" }).einreichung).toBe("rueckfrage");
        expect(suchanfrage(zustand({ einreichung: "erledigt" })).einreichung).toBeUndefined();
        expect(
            suchanfrage(zustand({ auswahl: { korb: "unused" }, einreichung: "erledigt" })).einreichung,
        ).toBeUndefined();
    });

    it("ein anderer Teil ist eine andere Liste: Der Schlüssel ändert sich, sie beginnt von vorn", () => {
        const schluessel = (teil: "offen" | "rueckfrage" | "erledigt") =>
            listenSchluessel({ ...korb, einreichung: teil });
        expect(new Set([schluessel("offen"), schluessel("rueckfrage"), schluessel("erledigt")]).size).toBe(3);
        expect(suchAdresse(suchanfrage({ ...korb, einreichung: "erledigt" }))).toContain("einreichung=erledigt");
        // Außerhalb des Korbs ändert die Wahl nichts an der Liste.
        const a = zustand({ auswahl: { korb: "unused" }, einreichung: "offen" });
        const b = zustand({ auswahl: { korb: "unused" }, einreichung: "erledigt" });
        expect(listenSchluessel(a)).toBe(listenSchluessel(b));
    });

    it("in der Adresse steht die Unterteilung nur, wenn sie von der Vorgabe abweicht, und nur im Korb", () => {
        expect(adresseMitZustand("", korb)).toBe("?medien&medien-korb=photobox_uploads");
        expect(adresseMitZustand("", { ...korb, einreichung: "rueckfrage" })).toBe(
            "?medien&medien-korb=photobox_uploads&medien-einreichung=rueckfrage",
        );
        expect(adresseMitZustand("", zustand({ einreichung: "erledigt" }))).toBe("?medien");
    });

    it("🔴 hin und zurück: jede Unterteilung übersteht den Weg durch die Adresse; ein unbekannter Wert fällt auf die Vorgabe", () => {
        for (const teil of ["offen", "rueckfrage", "erledigt"] as const) {
            const voll = { ...korb, einreichung: teil };
            expect(zustandAusAdresse(adresseMitZustand("", voll))).toEqual(voll);
        }
        expect(zustandAusAdresse("?medien&medien-korb=photobox_uploads&medien-einreichung=alle")?.einreichung).toBe(
            "offen",
        );
        expect(zustandAusAdresse("?medien&medien-einreichung=erledigt")?.einreichung).toBe("erledigt");
    });

    it("der Korb hat seine Kennung in der Schiene und kommt aus ihr zurück; ein Wechsel der Facette lässt die Wahl der Unterteilung stehen", () => {
        expect(auswahlKennung({ korb: "photobox_uploads" })).toBe("korb-photobox_uploads");
        expect(auswahlAusKennung("korb-photobox_uploads")).toEqual({ korb: "photobox_uploads" });
        const dort = waehle({ ...korb, einreichung: "rueckfrage" }, { korb: "unused" });
        expect(dort.einreichung).toBe("rueckfrage");
        expect(waehle(dort, { korb: "photobox_uploads" }).einreichung).toBe("rueckfrage");
    });

    it("am Telefon beginnt der Korb in der Liste, nicht bei den Arten", () => {
        expect(startEbene(korb)).toBe(2);
    });
});

describe("die PhotoBox-Galerien in der Adresse", () => {
    const ort = "80558060-4299-54aa-b520-814b10819885";
    const gewaehlt = (photoboxGalerie: string): MedienZustand => ({
        ...MEDIEN_START,
        auswahl: { objekt: "photobox" },
        photoboxGalerie,
    });

    it.each([ort, "ohne-ort"])("%s übersteht den Weg über die Adresse", (kennung) => {
        const adresse = adresseMitZustand("", gewaehlt(kennung));
        expect(zustandAusAdresse(adresse)).toMatchObject({ auswahl: { objekt: "photobox" }, photoboxGalerie: kennung });
    });

    it("eine fremde Kennung und eine andere Facette gelten nicht", () => {
        expect(
            zustandAusAdresse("?medien&medien-objekt=photobox&medien-photobox-galerie=x")?.photoboxGalerie,
        ).toBeUndefined();
        expect(
            zustandAusAdresse(`?medien&medien-objekt=galerien&medien-photobox-galerie=${ort}`)?.photoboxGalerie,
        ).toBeUndefined();
    });

    it("die Wahl gehört zur Facette: Ein Korb nimmt sie mit", () => {
        expect(waehle(gewaehlt(ort), { korb: "photobox_uploads" }).photoboxGalerie).toBeUndefined();
    });
});
