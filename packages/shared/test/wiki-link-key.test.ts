import { describe, expect, it } from "vitest";
import { wikiLinkKey, wikiPageNameKey } from "../src/wiki-link-key.ts";

/**
 * Die Objektlinks von Legacy müssen dasselbe öffnen wie heute (AGENTS.md, „Links von Legacy bleiben gültig“). Der
 * Schlüssel ist deshalb Legacys eigene Rechnung: Unten stehen `normalizeWikiDeeplinkKey` und `wikiUrlToDeeplinkKey`
 * aus `js/app/wiki-deeplink.js` (Discovery-Mirror `avesmaps@b9657635a`; die Datei ist bis `8fb75eff9` unverändert) Wort für Wort als Referenz. Jeder Fall muss
 * dasselbe ergeben wie die Referenz, und einige Fälle halten ihren Wert zusätzlich fest, damit eine gleichzeitig
 * veränderte Referenz nicht unbemerkt bleibt.
 */

/* eslint-disable -- Wort für Wort aus Legacy, bewusst unverändert. */
function legacyNormalizeWikiDeeplinkKey(value: unknown): string {
    let decoded = String(value || "");
    try {
        decoded = decodeURIComponent(decoded.replace(/\+/g, " "));
    } catch (error) {
        decoded = String(value || "");
    }
    return decoded
        .replace(/_/g, " ")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/ß/g, "ss")
        .replace(/æ/g, "ae")
        .replace(/œ/g, "oe")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}

function legacyWikiUrlToDeeplinkKey(wikiUrl: unknown): string {
    const raw = String(wikiUrl || "").trim();
    if (!raw) {
        return "";
    }
    let pageSegment = raw;
    const wikiMatch = /\/wiki\/([^?#]+)/i.exec(raw);
    if (wikiMatch) {
        pageSegment = wikiMatch[1] as string;
    } else if (/^https?:\/\//i.test(raw)) {
        const tail = (raw.split(/[?#]/)[0] as string).split("/").filter(Boolean).pop();
        pageSegment = tail || raw;
    }
    return legacyNormalizeWikiDeeplinkKey(pageSegment);
}
/* eslint-enable */

const WIKI = "https://de.wiki-aventurica.de/wiki/";

/** Fälle mit festem Wert: [Eingabe, Beschreibung, erwarteter Schlüssel]. */
const FIXED_CASES: readonly [string, string, string][] = [
    [`${WIKI}Barbr%C3%BCck`, "Umlaut, prozentkodiert", "barbruck"],
    [`${WIKI}Barbrück`, "Umlaut, unkodiert", "barbruck"],
    [`${WIKI}Reichsstra%C3%9Fe_2`, "ß, prozentkodiert, Zahl bleibt", "reichsstrasse2"],
    [`${WIKI}Reichsstraße_1`, "ß, Zahl bleibt (Reichsstraße 1 ist nicht Reichsstraße 2)", "reichsstrasse1"],
    [`${WIKI}Sultanat_Fasar_(Kalifat)`, "Klammerzusatz bleibt als Text", "sultanatfasarkalifat"],
    [`${WIKI}Sultanat+Fasar`, "+ ist ein Leerzeichen", "sultanatfasar"],
    [`${WIKI}Alt%ZZGareth`, "kaputte Prozentkodierung: der Rohwert bleibt", "altzzgareth"],
    [`${WIKI}Inoffiziell:Torfendorf`, "Namensraum Inoffiziell", "inoffizielltorfendorf"],
    [
        "https://www.herzogtum-weiden.net/orte/hollerheide",
        "fremder Host ohne /wiki/: letztes Pfadsegment",
        "hollerheide",
    ],
    [`${WIKI}Gareth?action=edit#Geschichte`, "Anfrage und Anker fallen weg", "gareth"],
    ["https://de.wiki-aventurica.de/WIKI/Gareth", "/wiki/ ohne Rücksicht auf die Schreibweise", "gareth"],
    ["Fürstentum_Kosch", "bloßer Seitenname", "furstentumkosch"],
    [
        "F%C3%BCrstentum_Kosch",
        "bloßer Seitenname, prozentkodiert (so schreibt ihn die Wiki-Vorlage)",
        "furstentumkosch",
    ],
    [`${WIKI}%C3%86sir`, "æ (Großbuchstabe) zu ae", "aesir"],
    [`${WIKI}C%C5%93ur`, "œ zu oe", "coeur"],
    [`${WIKI}Garen%CC%80`, "kombinierendes Zeichen, bereits zerlegt", "garen"],
    ["https://example.org/", "Adresse ohne Pfad: der Host als letztes Segment", "exampleorg"],
    ["   ", "nur Leerraum", ""],
    ["", "leer", ""],
];

describe("wikiLinkKey: feste Fälle", () => {
    it.each(FIXED_CASES)("%s (%s) -> %s", (input, _name, expected) => {
        expect(wikiLinkKey(input)).toBe(expected);
    });

    it("kennt null und undefined als leer", () => {
        expect(wikiLinkKey(null)).toBe("");
        expect(wikiLinkKey(undefined)).toBe("");
        expect(wikiPageNameKey(null)).toBe("");
    });
});

describe("wikiLinkKey gegen Legacys Referenz", () => {
    const extra: string[] = [
        `${WIKI}Gareth`,
        `${WIKI}Das_Erbe_von_Blaustein`,
        `${WIKI}Gr%C3%BCnau_(Almada)`,
        `${WIKI}Rathila`,
        `${WIKI}Sultanat_Fasar`,
        `${WIKI}Fasar`,
        `${WIKI}Punin`,
        `${WIKI}Tosch_Mur`,
        `${WIKI}%C3%84ra_der_Magier`,
        `${WIKI}Ma%C3%9Fnahme+%26+Wirkung`,
        `${WIKI}100%25_Aventurien`,
        `${WIKI}Seite%`,
        `${WIKI}A/B`,
        `${WIKI}A/B?x=y`,
        "https://www.herzogtum-weiden.net/politik/liste-bn/baronien/hzgl-weiden",
        "http://de.wiki-aventurica.de/wiki/Gareth",
        "wiki/Gareth",
        "/wiki/Gareth_(Stadt)",
        "Gareth (Stadt)",
        "ftp://example.org/wiki/Foo_Bar",
        "İstanbul",
        "ǅ",
        "ﬁsh",
    ];
    it.each([...FIXED_CASES.map(([input]) => input), ...extra])("%s", (input) => {
        expect(wikiLinkKey(input)).toBe(legacyWikiUrlToDeeplinkKey(input));
        expect(wikiPageNameKey(input)).toBe(legacyNormalizeWikiDeeplinkKey(input));
    });

    it("Legacys Referenz hält ihre festen Werte (die Referenz selbst ist nicht verändert)", () => {
        for (const [input, , expected] of FIXED_CASES) {
            expect(legacyWikiUrlToDeeplinkKey(input)).toBe(expected);
        }
    });
});

describe("wikiLinkKey: Legacys eigene Beispiele", () => {
    // Die Seitennamen stammen aus Legacys eigenen Tests und Kommentaren (Mirror `8fb75eff9`): `js/app/__tests__/deeplink-weitere.test.js`
    // (`Bärenpfad`, `Reichsstraße_2`, `Geronsgang`), der Kopfkommentar von `js/app/wiki-deeplink.js` (`Havena`) und der Namensfallback des
    // Vertrags (`Sultanat Fasar (Kalifat)`). Die Tests selbst prüfen das Verhalten, nicht den Wert: Jeder Fall muss dasselbe ergeben wie die Referenz.
    const pages = ["Bärenpfad", "Reichsstraße_2", "Geronsgang", "Havena", "Sultanat Fasar (Kalifat)"];

    it.each(pages)(
        "%s: dieselbe Rechnung wie Legacy, als Adresse, als prozentkodierte Adresse und als Seitenname",
        (page) => {
            const spellings = [`${WIKI}${page}`, `${WIKI}${encodeURIComponent(page)}`, page];
            for (const spelling of spellings) {
                expect(wikiLinkKey(spelling), spelling).toBe(legacyWikiUrlToDeeplinkKey(spelling));
            }
            expect(new Set(spellings.map((spelling) => wikiLinkKey(spelling))).size).toBe(1);
        },
    );

    it("die Schlüssel der drei Seiten aus dem Test der weiteren Zuweisungen bleiben verschieden, `Bärenpfad` fällt zu `barenpfad`", () => {
        const keys = ["Bärenpfad", "Reichsstraße_2", "Geronsgang"].map((page) => wikiLinkKey(`${WIKI}${page}`));
        expect(keys).toEqual(["barenpfad", "reichsstrasse2", "geronsgang"]);
        // Legacys Test vermerkt: Der `wiki_key` des Servers faltet den Umlaut zu „-“ (`b-renpfad`). Das ist ein anderer Schlüssel als der des Objektlinks.
        expect(wikiPageNameKey("b-renpfad")).not.toBe(keys[0]);
    });
});

describe("wikiLinkKey: der Namensraum gehört zum Key", () => {
    // Claudia/Betreiber 2026-10-05: „Inoffiziell:Dju'imen“ und „Dju'imen“ sind verschiedene Artikel. Legacy behält das Präfix im Key
    // (`inoffiziell…`, die PHP-Keys heißen `wiki:inoffiziell-…`); es wird nie abgeschnitten.
    it("🔴 offizieller und inoffizieller Artikel gleichen Titels ergeben zwei verschiedene Keys", () => {
        const official = wikiLinkKey(`${WIKI}Dju'imen`);
        const unofficial = wikiLinkKey(`${WIKI}Inoffiziell:Dju'imen`);
        expect(official).toBe("djuimen");
        expect(unofficial).toBe("inoffizielldjuimen");
        expect(unofficial).not.toBe(official);
        // Dieselbe Rechnung wie Legacy.
        expect(official).toBe(legacyWikiUrlToDeeplinkKey(`${WIKI}Dju'imen`));
        expect(unofficial).toBe(legacyWikiUrlToDeeplinkKey(`${WIKI}Inoffiziell:Dju'imen`));
    });

    it("die Schreibweisen des inoffiziellen Artikels (Seitenname, Adresse, prozentkodiert, Unterstrich) sind EIN Key mit dem Präfix", () => {
        const spellings = [
            "Inoffiziell:Dju'imen",
            "Inoffiziell: Dju'imen",
            "inoffiziell:dju'imen",
            `${WIKI}Inoffiziell:Dju'imen`,
            `${WIKI}Inoffiziell%3ADju%27imen`,
            `${WIKI}Inoffiziell:Dju%27imen`,
        ];
        expect([...new Set(spellings.map((spelling) => wikiLinkKey(spelling)))]).toEqual(["inoffizielldjuimen"]);
    });

    it("das Präfix bleibt auch bei anderen Namensräumen und bei Titeln mit Klammer", () => {
        expect(wikiLinkKey(`${WIKI}Inoffiziell:Kloster_Al-Areal`)).toBe("inoffiziellklosteralareal");
        expect(wikiLinkKey(`${WIKI}Kloster_Al-Areal`)).toBe("klosteralareal");
        expect(wikiPageNameKey("Kategorie:Orte")).toBe("kategorieorte");
        expect(wikiLinkKey(`${WIKI}Inoffiziell:Gareth_(Stadt)`)).not.toBe(wikiLinkKey(`${WIKI}Gareth_(Stadt)`));
    });
});

describe("wikiLinkKey: Eigenschaften", () => {
    it("Schreibweise und Kodierung ändern den Schlüssel nicht", () => {
        const spellings = [
            `${WIKI}Schwarze_Lande`,
            `${WIKI}schwarze_lande`,
            `${WIKI}Schwarze+Lande`,
            `${WIKI}Schwarze%20Lande`,
            "Schwarze Lande",
        ];
        const keys = new Set(spellings.map((spelling) => wikiLinkKey(spelling)));
        expect([...keys]).toEqual(["schwarzelande"]);
    });

    it("verschiedene Seiten behalten verschiedene Schlüssel (Zahl und Namensraum bleiben)", () => {
        const keys = [
            `${WIKI}Reichsstra%C3%9Fe_1`,
            `${WIKI}Reichsstra%C3%9Fe_2`,
            `${WIKI}Torfendorf`,
            `${WIKI}Inoffiziell:Torfendorf`,
        ].map((address) => wikiLinkKey(address));
        expect(new Set(keys).size).toBe(keys.length);
    });
});
