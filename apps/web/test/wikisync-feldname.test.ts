import { describe, expect, it } from "vitest";
import { locale } from "../src/i18n/i18n";
import {
    bereichName,
    feldName,
    objektArtName,
    ortszeilenWertText,
    rolleName,
    wertText,
} from "../src/wikisync/wikisync-text";

/** Der Name eines Felds im Dump-Bericht (WI-0253): eine Stelle der Ortsliste eines Werks heißt „Ortsliste, Ort n“, von 1 an gezählt; ein Feld bleibt sein Name. */
describe("WikiSync: Feldname im Bericht", () => {
    it("die Stelle der Ortsliste (ort_<Stelle>, von 0 an) heißt „Ortsliste, Ort n“ (von 1 an)", () => {
        locale.value = "de";
        expect(feldName("ort_0")).toBe("Ortsliste, Ort 1");
        expect(feldName("ort_11")).toBe("Ortsliste, Ort 12");
        expect(feldName("title")).toBe("Titel");
        expect(feldName(null)).toBe("Wiki-Zuordnung");
        locale.value = "en";
        expect(feldName("ort_2")).toBe("Place list, place 3");
        locale.value = "de";
    });

    it("die Verwendung einer Quelle an einem Träger heißt „Verwendung“, ein Linkziel ohne Produktseite „Linkziel ohne Produktseite“ (Scheibe Quellen)", () => {
        locale.value = "de";
        const kennung = "0123456789abcdef0123456789abcdef";
        for (const art of ["place", "territory", "area", "peak", "path"])
            expect(feldName(`verwendung_${art}_${kennung}`)).toBe("Verwendung");
        expect(feldName("ohne_produktseite")).toBe("Linkziel ohne Produktseite");
        // Ein Feld, das so aussieht, aber keine Kennung trägt, bleibt, wie es ist.
        expect(feldName("verwendung_place_zzz")).toBe("verwendung_place_zzz");
        locale.value = "en";
        expect(feldName(`verwendung_path_${kennung}`)).toBe("Use");
        locale.value = "de";
    });

    it("🔴 Vorkommen (Scheibe Vorkommen, §23): Felder, Ortszeile nach Beziehung, Rolle und Wert in der Sprache der Seite", () => {
        locale.value = "de";
        expect(feldName("gruppe")).toBe("Gruppe");
        expect(feldName("synonyme")).toBe("Weitere Namen");
        expect(feldName("roh_verbreitung")).toBe("Wiki-Text Verbreitung");
        expect(feldName("ortszeile_verbreitung_0123456789abcdef")).toBe("Ortszeile (Verbreitung)");
        expect(feldName("ortszeile_herkunft_0123456789abcdef")).toBe("Ortszeile (Herkunft)");
        // Ein Feld, das so aussieht, aber keine Kennung trägt, bleibt, wie es ist.
        expect(feldName("ortszeile_verbreitung_zzz")).toBe("ortszeile_verbreitung_zzz");
        expect(rolleName("andere_welt")).toBe("andere Welt");
        expect(rolleName("bezugspunkt")).toBe("Bezugspunkt");
        // Der Wert einer Ortszeile zeigt Titel und Rolle, nie den Schlüssel; ein Punkt im Titel stört nicht.
        expect(ortszeilenWertText("Bornland · (Region) · teil · bornland-region")).toBe("Bornland · (Region) · Teil");
        expect(ortszeilenWertText("Wald · landschaftsart · wald")).toBe("Wald · Landschaftsart");
        expect(ortszeilenWertText("kein Wert")).toBe("kein Wert");
        expect(
            wertText("Riva · bezugspunkt · riva", "text", "neu", "ortszeile_verbreitung_0123456789abcdef").text,
        ).toBe("Riva · Bezugspunkt");
        // In anderen Feldern bleibt der Wert, wie er ist.
        expect(wertText("A · B · c", "text", "neu", "gruppe").text).toBe("A · B · c");
        locale.value = "en";
        expect(feldName("ortszeile_regionen_0123456789abcdef")).toBe("Place line (Regions)");
        expect(ortszeilenWertText("Riva · volk · riva")).toBe("Riva · People");
        locale.value = "de";
    });

    it("🔴 Sprachen (WI-0261 S3): Bereich, Art und jedes Feld des Sprachartikels haben in jeder Tafel einen Namen", () => {
        locale.value = "de";
        expect(bereichName("sprachen")).toBe("Sprachen");
        expect(objektArtName("sprache_artikel")).toBe("Sprachartikel");
        expect(feldName("artikel")).toBe("Artikel");
        expect(feldName("offizielle_sprache")).toBe("Offizielle Sprache");
        expect(feldName("navigation")).toBe("Sprachfamilie (Navigationsleiste)");
        expect(feldName("roh_weitere_verbreitung")).toBe("Wiki-Text Weitere Verbreitung");
        // Die Felder des Plans (`SPRACHEN_PLANFELDER`, apps/server/src/wiki/abgleich/sprachen.ts): keines bleibt als rohes Wort stehen.
        const felder = [
            "artikel",
            "name",
            "sprachfamilie",
            "vorstufen",
            "schrift",
            "sprecheranzahl",
            "offizielle_sprache",
            "weitere_verbreitung",
            "kurzbeschreibung",
            "navigation",
            "roh_vorstufen",
            "roh_schrift",
            "roh_offizielle_sprache",
            "roh_weitere_verbreitung",
        ];
        for (const sprache of ["de", "en", "fr", "it", "nl", "da", "es", "pl", "sv"] as const) {
            locale.value = sprache;
            expect(bereichName("sprachen"), sprache).not.toBe("admin.wikisync.bereich.sprachen");
            expect(objektArtName("sprache_artikel"), sprache).not.toBe("sprache_artikel");
            for (const feld of felder) expect(feldName(feld), `${sprache}: ${feld}`).not.toBe(feld);
        }
        locale.value = "en";
        expect(bereichName("sprachen")).toBe("Languages");
        expect(feldName("roh_vorstufen")).toBe("Wiki text: Predecessors");
        locale.value = "de";
    });
});
