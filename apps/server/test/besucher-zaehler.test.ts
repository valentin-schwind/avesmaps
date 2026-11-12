import { describe, expect, it } from "vitest";
import {
    BESUCH_METRIKEN,
    BESUCH_METRIKEN_MIT_STUNDE,
    CLIENT_FEHLER_ARTEN,
    WETTER_METRIKEN,
    besuchOrtsName,
    routenPaar,
    type BesuchMeldung,
} from "@avesmaps3d/shared";
import { tagesKennung, utcTag } from "../src/besucher/kennung.ts";
import {
    browserArt,
    dimensionErlaubt,
    dauerKorb,
    einstiegAus,
    geraeteArt,
    istBot,
    KEINE_STUNDE,
    METRIK_GLEICHZEITIG,
    spracheAus,
    stundeOder24,
    systemArt,
    zeilenAus,
    zeilenJePerson,
} from "../src/besucher/zaehler.ts";
import { zeilenAusAbzug } from "../src/besucher/legacy-import.ts";

/**
 * Die Regeln der Zählung ohne Datenbank (WI-0138, BESUCH-0001 §4 und §6). Jede davon hält einen Fall fest, der in Legacy schon
 * einmal schiefgegangen ist.
 */

describe("Tageskennung", () => {
    const ip = "198.51.100.17";
    const ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130";

    it("ohne Schlüssel gibt es keine Kennung - lieber keine Zahl als eine zurückrechenbare (Legacys Befund A23)", () => {
        expect(tagesKennung(undefined, ip, ua)).toBeUndefined();
        expect(tagesKennung("   ", ip, ua)).toBeUndefined();
    });

    it("ist 16 Byte lang und für dasselbe Gerät am selben Tag gleich", () => {
        const heute = new Date("2026-10-13T08:00:00Z");
        const a = tagesKennung("geheim", ip, ua, heute);
        const b = tagesKennung("geheim", ip, ua, new Date("2026-10-13T22:30:00Z"));
        expect(a).toHaveLength(16);
        expect(a?.equals(b!)).toBe(true);
    });

    it("ist am nächsten Tag eine andere - nach Mitternacht ist nichts mehr zuzuordnen", () => {
        const heute = tagesKennung("geheim", ip, ua, new Date("2026-10-13T23:59:00Z"));
        const morgen = tagesKennung("geheim", ip, ua, new Date("2026-10-14T00:01:00Z"));
        expect(heute?.equals(morgen!)).toBe(false);
    });

    it("unterscheidet Geräte und hängt am Schlüssel", () => {
        const a = tagesKennung("geheim", ip, ua);
        expect(a?.equals(tagesKennung("geheim", "203.0.113.9", ua)!)).toBe(false);
        expect(a?.equals(tagesKennung("geheim", ip, "anderer Browser")!)).toBe(false);
        expect(a?.equals(tagesKennung("anderer Schlüssel", ip, ua)!)).toBe(false);
    });

    it("rechnet in UTC, wie die Datenbank", () => {
        expect(utcTag(new Date("2026-10-13T23:30:00Z"))).toBe("2026-10-13");
    });
});

describe("Stunde", () => {
    it("alles außerhalb von 0..23 wird zum Platzhalter 24, nie zu 0 (sonst stünde es als Mitternacht in der Tafel)", () => {
        expect(stundeOder24(undefined)).toBe(KEINE_STUNDE);
        expect(stundeOder24(-1)).toBe(KEINE_STUNDE);
        expect(stundeOder24(24)).toBe(KEINE_STUNDE);
        expect(stundeOder24(0)).toBe(0);
        expect(stundeOder24(23)).toBe(23);
    });
});

describe("Einstieg", () => {
    it("nennt die Quelle, nie den Pfad", () => {
        expect(einstiegAus("https://www.google.com/search?q=aventurien+karte", undefined)).toBe("Google");
        expect(einstiegAus("https://de.wiki-aventurica.de/wiki/Gareth", undefined)).toBe("Wiki-Aventurica");
        expect(einstiegAus("https://beispiel.example/pfad/tief", undefined)).toBe("beispiel.example");
        expect(einstiegAus("https://www.google.de/search", undefined)).toBe("Google");
    });

    it("ohne Herkunft ist es „direkt“, die eigene Seite ist „intern“", () => {
        expect(einstiegAus(undefined, "avesmaps.de")).toBe("direkt");
        expect(einstiegAus("kein brauchbarer Wert", undefined)).toBe("direkt");
        expect(einstiegAus("https://avesmaps.de/karte", "avesmaps.de")).toBe("intern");
    });

    it("zählt einen Host, der nur so AUSSIEHT wie eine Suchmaschine, nicht als sie", () => {
        expect(einstiegAus("https://boese-google.example/", undefined)).toBe("boese-google.example");
        expect(einstiegAus("https://google.com.angreifer.example/", undefined)).toBe("google.com.angreifer.example");
        expect(einstiegAus("https://news.google.com/", undefined)).toBe("Google");
    });
});

describe("Ausprägungen", () => {
    it("nimmt nur, was zur Metrik passt - verworfen wird, nicht gekürzt", () => {
        expect(dimensionErlaubt("pageview", "")).toBe(true);
        expect(dimensionErlaubt("pageview", "etwas")).toBe(false);
        expect(dimensionErlaubt("map_mode", "political")).toBe(true);
        expect(dimensionErlaubt("map_mode", "<script>alert(1)</script>")).toBe(false);
        expect(dimensionErlaubt("route", "Gareth → Punin")).toBe(true);
        expect(dimensionErlaubt("route", "a".repeat(80))).toBe(false);
        expect(dimensionErlaubt("gibtesnicht", "x")).toBe(false);
    });

    it("lässt die Tagesspitze der Anwesenden nicht von einem Browser melden (WI-0213)", () => {
        // Sie ist ein Höchstwert, den nur das Lebenszeichen nachführt; gemeldet würde sie hochgezählt und wäre eine Lüge.
        expect(dimensionErlaubt(METRIK_GLEICHZEITIG, "")).toBe(false);
        expect((BESUCH_METRIKEN as readonly string[]).includes(METRIK_GLEICHZEITIG)).toBe(false);
    });

    it("lässt eine verbotene Ausprägung gar nicht erst in die Zeilen", () => {
        const zeilen = zeilenAus({
            ereignisse: [
                { metrik: "map_mode", dimension: "a\u0000b" },
                { metrik: "route", dimension: "Gareth → Punin" },
            ],
        });
        expect(zeilen.some((zeile) => zeile.metrik === "map_mode")).toBe(false);
        expect(zeilen.some((zeile) => zeile.metrik === "route")).toBe(true);
    });

    /**
     * 🔴 Der Regressionsfall zu WI-0157. `route` stand als Art **name**, der Planer meldet `melde("route")` aber ohne
     * Ausprägung - `dimensionErlaubt` gab `false`, und `zeilenAus` verwarf die Zeile still. Vom 13.10.2026 an zählte in
     * `visitor_metric` nur noch Legacys Import (letzter Tag 2026-10-12), während `route_option` und `transport`
     * desselben Routenlaufs weiterliefen. Die Kennzahl „Routen geplant" darf nie an einem Namen hängen.
     */
    it("zählt eine Route auch ohne Ausprägung - sonst zählt die Kennzahl gar nichts (WI-0157)", () => {
        expect(dimensionErlaubt("route", "")).toBe(true);
        const zeilen = zeilenAus({ ereignisse: [{ metrik: "route" }] });
        expect(zeilen.filter((zeile) => zeile.metrik === "route")).toEqual([
            { metrik: "route", dimension: "", stunde: KEINE_STUNDE },
        ]);
    });

    it("lässt die leere Ausprägung nur bei route durch, nicht bei jedem Namen", () => {
        expect(dimensionErlaubt("search", "")).toBe(false);
        expect(dimensionErlaubt("place_open", "")).toBe(false);
        expect(dimensionErlaubt("route_waypoint", "")).toBe(false);
        // Ein Name bleibt ein Name: Müll zählt bei `route` so wenig wie überall sonst.
        expect(dimensionErlaubt("route", "<script>alert(1)</script>")).toBe(false);
    });
});

/**
 * 🔴 **Die Art muss beschreiben, was der Sender wirklich schickt** (WI-0159). Sieben Metriken standen in der Positivliste, ohne
 * dass irgendwo in `apps/web/src` jemand sie meldete: In der lokalen Entwicklungsdatenbank hatte keine von ihnen eine einzige
 * Zeile. Sechs haben seither einen Sender, und je Metrik steht hier der Wert, den dieser Sender wirklich schickt - genau an
 * dieser Naht ging WI-0157 verloren. `map_load` ist ganz entfallen: kein Leser, kein Sender, Legacys vier Zeilen in 109 Tagen.
 *
 * Die Werte sind keine erfundenen Beispiele. Sie sind Legacys eigene Ausprägungen aus dem Abzug vom 2026-10-12
 * (`project-control/discovery/legacy-nutzung-2026-10-12/visitor-metrics-besucher.json`), denn Legacys importierte Zeilen und
 * unsere eigenen müssen auf DEMSELBEN Schlüssel summieren - sonst stünde jeder Balken zweimal halb hoch da.
 */
describe("Die Sender der sieben stillen Metriken (WI-0159)", () => {
    /** Was der jeweilige Sender in `apps/web/src` wirklich schickt, Metrik für Metrik. */
    const SENDER: readonly (readonly [string, string])[] = [
        // `display-menu.vue`: Legacys acht Ausprägungen, beide Formen - Schalter und Ortsklasse.
        ["display_toggle", "toggleRivers:on"],
        ["display_toggle", "toggleRivers:off"],
        ["display_toggle", "togglePaths:on"],
        ["display_toggle", "toggleTerritoryBorders:on"],
        ["display_toggle", "toggleMapLabels:off"],
        ["display_toggle", "gebaeude:on"],
        ["display_toggle", "metropole:on"],
        ["display_toggle", "toggleLocations:off"],
        // `map-fan.vue`: die fünf Ebenen, Legacys fünf Werte.
        ["eco_kind", "alle"],
        ["eco_kind", "derographisch"],
        ["eco_kind", "vegetation"],
        ["eco_kind", "topographie"],
        ["eco_kind", "klima"],
        // `route-client.ts`: ein Kartenname je Wegpunkt der eigenen Antwort.
        ["route_waypoint", "Gareth"],
        ["route_waypoint", "Bar Al'Gnuf"],
        // Die drei des Blocks „3D": ohne Ausprägung, einmal je Besuch (`meldeEinmal`).
        ["flight", ""],
        ["profile", ""],
        ["play", ""],
        // WI-0161: die Kartenwahl im Fächer und das Zoomband an der Kartenruhe. Die Ansichten und Serien sind unsere
        // heutigen Schlüssel - Legacys `deregraphic`, `ecosystem` und `stylized` schreibt erst der Leseweg um
        // (`LEGACY_DIMENSIONEN`), damit importierte und eigene Zeilen in EINER Zeile summieren.
        ["map_mode", "standard"],
        ["map_mode", "political"],
        ["map_mode", "landscapes"],
        ["map_mode", "powerlines"],
        ["map_mode", "none"],
        ["map_style", "original"],
        ["map_style", "old"],
        ["map_style", "modern"],
        // Ein über das Release offener Tab schickt noch das alte Band; es zählt weiter (WI-0286).
        ["zoom_band", "nah"],
        ["zoom_band", "mittel"],
        ["zoom_band", "weit"],
        // WI-0286: die Stufe an der Kartenruhe, das Design und die Sprache der Oberfläche.
        ["zoom_stufe", "0"],
        ["zoom_stufe", "8"],
        ["theme", "dark"],
        ["theme", "light"],
        ["sprache_eingestellt", "de"],
        ["sprache_eingestellt", "sv"],
    ];

    it.each(SENDER)("%s nimmt an, was der Sender schickt: „%s“", (metrik, dimension) => {
        expect(dimensionErlaubt(metrik, dimension)).toBe(true);
        // Die Tabelle trägt Zeichenketten, damit sie lesbar bleibt; `zeilenAus` nimmt eine Meldung, wie sie hereinkommt.
        const ereignis = (dimension === "" ? { metrik } : { metrik, dimension }) as BesuchMeldung["ereignisse"][number];
        const zeilen = zeilenAus({ ereignisse: [ereignis] });
        expect(zeilen.filter((zeile) => zeile.metrik === metrik)).toEqual([
            { metrik, dimension, stunde: KEINE_STUNDE },
        ]);
    });

    it("verwirft weiter, was kein Sender von uns schickt", () => {
        expect(dimensionErlaubt("display_toggle", "<script>alert(1)</script>")).toBe(false);
        expect(dimensionErlaubt("eco_kind", "etwas Eigenes")).toBe(true);
        // 🪤 „etwas Eigenes" trifft die Schlüsselform; die Liste schützt die FORM, nicht den Wortschatz. Was hineinkommt,
        // entscheidet der Sender, und der schickt nur `LANDSCAPE_SELECTIONS`.
        expect(dimensionErlaubt("eco_kind", "1 Ebene")).toBe(false);
        expect(dimensionErlaubt("flight", "irgendwas")).toBe(false);
        expect(dimensionErlaubt("profile", "irgendwas")).toBe(false);
        expect(dimensionErlaubt("play", "irgendwas")).toBe(false);
        expect(dimensionErlaubt("route_waypoint", "")).toBe(false);
    });

    /**
     * 🔴 `place_open` trug Art **name**, der Sender schickt aber `ref.kind` - einen Schlüssel aus neun Kennungen
     * (`subject-selection.ts`). Es zählte, weil jede davon beide Formen trifft; die Art log nur über den Inhalt. Dieser Fall
     * hält beides fest: die neun Kennungen zählen, und der Wechsel der Art hat keine bestehende Zeile ungültig gemacht.
     */
    it.each(["place", "path", "area", "territory", "peak", "powerline", "routeStage", "mapPoint", "climate"])(
        "place_open nimmt die Objektart „%s“",
        (art) => {
            expect(dimensionErlaubt("place_open", art)).toBe(true);
        },
    );

    it("kennt map_load nicht mehr - kein Leser, kein Sender, in Legacy vier Zeilen in 109 Tagen", () => {
        expect(BESUCH_METRIKEN).not.toContain("map_load");
        expect(BESUCH_METRIKEN_MIT_STUNDE).toEqual(["pageview"]);
        expect(dimensionErlaubt("map_load", "")).toBe(false);
        // Ein alter Client, der sie noch meldet, legt keine Zeile an - und stört auch nichts. 🪤 Der Cast ist der Beweis
        // selbst: `map_load` ist keine `BesuchMetrik` mehr, der Typ ließe sie gar nicht erst in eine Meldung.
        const alteMeldung = { metrik: "map_load" } as unknown as BesuchMeldung["ereignisse"][number];
        const zeilen = zeilenAus({ ereignisse: [alteMeldung, { metrik: "pageview" }] });
        expect(zeilen.some((zeile) => zeile.metrik === "map_load")).toBe(false);
        expect(zeilen.some((zeile) => zeile.metrik === "pageview")).toBe(true);
    });

    /**
     * Jede Metrik der Positivliste braucht einen Sender UND einen Leser. Dieser Fall ist die Zusage daraus: Die Liste bleibt
     * die Liste der wirklich gezählten Dinge, und der nächste Eintrag ohne Sender fällt hier auf, nicht erst in einem leeren
     * Panelblock nach dem Release.
     */
    it("führt keine Metrik mehr, die niemand sendet", () => {
        expect([...BESUCH_METRIKEN].sort()).toEqual(
            [
                "client_fehler",
                "display_toggle",
                "eco_kind",
                "flight",
                "map_mode",
                "map_style",
                "pageview",
                "place_open",
                "play",
                "profile",
                "route",
                "route_fail",
                "route_option",
                "route_waypoint",
                "search",
                "search_empty",
                "share_create",
                "tilt",
                "transport",
                "theme",
                "sprache_eingestellt",
                "zoom_band",
                "zoom_stufe",
                // Das experimentelle Wetter (WI-0288): Sender `wetter-messung.ts` und `wetter-schalter.ts`, Leser `BesuchZahlen.wetter`.
                "wetter_aufloesung",
                "wetter_bildrate",
                "wetter_fehler",
                "wetter_gpu",
                "wetter_lauf",
                "wetter_spitze",
                "wetter_start",
            ].sort(),
        );
    });
});

/**
 * Fehler im Browser (WI-0202): Die Art kommt aus der festen Liste der Fänger, sonst zählt nichts. Der Sender ist
 * `sendeFehler` in `apps/web/src/besuch/besuch-melden.ts`; er schickt genau diese Arten.
 */
describe("zoom_stufe", () => {
    it.each(["", "9", "10", "-1", "1.5", "a", "z3"])("verwirft die Stufe „%s“", (stufe) => {
        expect(dimensionErlaubt("zoom_stufe", stufe)).toBe(false);
    });
});

describe("client_fehler", () => {
    it.each(CLIENT_FEHLER_ARTEN)("nimmt die Art „%s“", (art) => {
        expect(dimensionErlaubt("client_fehler", art)).toBe(true);
        const zeilen = zeilenAus({ ereignisse: [{ metrik: "client_fehler", dimension: art }] });
        expect(zeilen.filter((zeile) => zeile.metrik === "client_fehler")).toEqual([
            { metrik: "client_fehler", dimension: art, stunde: KEINE_STUNDE },
        ]);
    });

    it("verwirft alles außerhalb der Liste, auch Schlüssel in gültiger Form", () => {
        expect(dimensionErlaubt("client_fehler", "")).toBe(false);
        expect(dimensionErlaubt("client_fehler", "irgendwas")).toBe(false);
        expect(dimensionErlaubt("client_fehler", "TypeError: x")).toBe(false);
    });
});

/**
 * Ein angesteuerter Ort als Ausprägung. Ein Wegpunkt kann ein Kartenpunkt ohne Ortsnamen sein; dann bleibt die Meldung aus,
 * statt am Riegel still zu verschwinden.
 */
describe("Ortsname einer Meldung", () => {
    it("nimmt Kartennamen, auch mit Apostroph und Bindestrich", () => {
        expect(besuchOrtsName("Gareth")).toBe("Gareth");
        expect(besuchOrtsName("  Punin  ")).toBe("Punin");
        expect(besuchOrtsName("Bar Al'Gnuf")).toBe("Bar Al'Gnuf");
        expect(besuchOrtsName("Zwergenschmiede-Nord")).toBe("Zwergenschmiede-Nord");
    });

    it("gibt nichts zurück, was der Server verwerfen müsste", () => {
        expect(besuchOrtsName("")).toBeUndefined();
        expect(besuchOrtsName("   ")).toBeUndefined();
        // Ein Kartenpunkt ist kein Ort: `p:1234.5:678.9` beginnt mit einem Buchstaben, trägt aber einen Doppelpunkt.
        expect(besuchOrtsName("p:1234.5:678.9")).toBeUndefined();
        expect(besuchOrtsName("<script>alert(1)</script>")).toBeUndefined();
        expect(besuchOrtsName("a".repeat(80))).toBeUndefined();
    });

    it("liefert nur, was auch durch den Riegel kommt", () => {
        for (const name of ["Gareth", "Bar Al'Gnuf", "Zwergenschmiede-Nord", "Khunchom"]) {
            const wert = besuchOrtsName(name);
            expect(wert).toBeDefined();
            expect(dimensionErlaubt("route_waypoint", wert as string)).toBe(true);
        }
    });
});

/**
 * „Start → Ziel" aus unserer eigenen Antwort (BESUCH-0001 §E). Die Fälle halten fest, dass die Ausprägung dieselbe Form trifft,
 * die der Server verlangt - und dass sie lieber ausbleibt, als dass eine Route ungezählt bliebe.
 */
describe("Routenpaar", () => {
    it("nennt Start und Ziel, nie die Zwischenpunkte", () => {
        expect(routenPaar(["Gareth", "Perricum", "Punin"])).toBe("Gareth → Punin");
        expect(dimensionErlaubt("route", routenPaar(["Gareth", "Punin"])!)).toBe(true);
    });

    it("bleibt ohne Paar, wo keines zu bilden ist - die Kennzahl zählt die Route trotzdem", () => {
        expect(routenPaar([])).toBeUndefined();
        expect(routenPaar(["Gareth"])).toBeUndefined();
        expect(routenPaar(["", "Punin"])).toBeUndefined();
        expect(routenPaar(["   ", "Punin"])).toBeUndefined();
    });

    it("gibt nichts zurück, was der Server verwerfen müsste", () => {
        // 💣 Zu lang für die Namensform: lieber keine Ausprägung als eine Zeile, die still wegfällt.
        const paar = routenPaar(["A".repeat(40), "B".repeat(40)]);
        expect(paar).toBeUndefined();
        for (const namen of [
            ["<script>", "Punin"],
            ["Gareth", "Pu|nin"],
        ]) {
            const gebaut = routenPaar(namen);
            if (gebaut !== undefined) expect(dimensionErlaubt("route", gebaut)).toBe(true);
        }
    });
});

describe("Geräte", () => {
    const telefon = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17.0 Mobile/15E148 Safari/604.1";
    const rechner = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/130.0.0.0 Safari/537.36";

    it("kennt drei Arten", () => {
        expect(geraeteArt(telefon)).toBe("telefon");
        expect(geraeteArt(rechner)).toBe("rechner");
        expect(geraeteArt("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBe("tablet");
    });

    it("liest System und Browser je für sich", () => {
        expect(systemArt(telefon)).toBe("iOS");
        expect(browserArt(telefon)).toBe("Safari");
        expect(systemArt(rechner)).toBe("Windows");
        expect(browserArt(rechner)).toBe("Chrome");
        expect(browserArt("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Edg/130")).toBe("Edge");
    });
});

describe("Bots", () => {
    it("erkennt Automaten und den leeren User-Agent", () => {
        expect(istBot("")).toBe(true);
        expect(istBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
        expect(istBot("python-requests/2.31")).toBe(true);
        expect(istBot("Mozilla/5.0 (Windows NT 10.0) Chrome/130")).toBe(false);
    });
});

describe("Verweildauer", () => {
    it("legt Körbe mit führenden Nullen an - sonst sortierte „1200“ vor „300“", () => {
        expect(dauerKorb(7)).toBe("00000");
        expect(dauerKorb(42)).toBe("00040");
        expect(dauerKorb(301)).toBe("00300");
        expect(dauerKorb(3601)).toBe("03600");
        expect(dauerKorb(99999)).toBe("43200");
        expect(dauerKorb(-5)).toBe("00000");
    });
});

describe("Zeilen einer Meldung", () => {
    const umgebung = { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130", eigenerHost: "avesmaps.de" };

    it("zählt jedes Merkmal für sich, nie zwei in einer Zeile (sonst wäre es ein Fingerabdruck)", () => {
        const zeilen = zeilenAus({
            ereignisse: [{ metrik: "pageview" }],
            stunde: 19,
            geraet: { breite: 390, dreid: true, grob: true },
        });
        const person = zeilenJePerson(
            { ereignisse: [], herkunft: "https://www.google.de/search" },
            { ...umgebung, sprache: "nl-BE,nl;q=0.9" },
        );
        const paare = [...zeilen, ...person].map((zeile) => `${zeile.metrik}=${zeile.dimension}`);
        expect(paare).toContain("geraet=rechner");
        expect(paare).toContain("system=Windows");
        expect(paare).toContain("browser=Chrome");
        expect(paare).toContain("einstieg=Google");
        expect(paare).toContain("sprache=nl");
        expect(paare).toContain("fenster=bis480");
        expect(paare).toContain("faehig=3d");
        expect(paare).toContain("faehig=finger");
        expect(paare.every((paar) => paar.split("=")[1]?.includes("|") !== true)).toBe(true);
    });

    /** WI-0286: Was zur Person gehört, trägt keine Meldung mehr von selbst; die Route gibt es nur der ersten des Tages mit. */
    it("trennt, was je Meldung zählt, von dem, was je Person zählt", () => {
        const metriken = zeilenAus({ ereignisse: [{ metrik: "pageview" }] }).map((zeile) => zeile.metrik);
        expect(metriken).toEqual(["pageview"]);
    });

    it("gibt nur pageview eine Stunde, dem Rest den Platzhalter", () => {
        const zeilen = zeilenAus({
            ereignisse: [{ metrik: "pageview" }, { metrik: "route", dimension: "Gareth → Punin" }],
            stunde: 19,
        });
        expect(zeilen.find((zeile) => zeile.metrik === "pageview")?.stunde).toBe(19);
        expect(zeilen.find((zeile) => zeile.metrik === "route")?.stunde).toBe(KEINE_STUNDE);
    });
});

describe("Sprache", () => {
    it("nimmt die erste Marke, zwei Buchstaben", () => {
        expect(spracheAus("de-DE,de;q=0.9,en;q=0.8")).toBe("de");
        expect(spracheAus("en-US")).toBe("en");
        expect(spracheAus(undefined)).toBe("ohne");
        expect(spracheAus("*")).toBe("ohne");
    });
});

describe("Legacys Abzug", () => {
    const abzug = {
        actor: "visitor",
        metrics: {
            daily: [
                { day: "2026-10-05", views: "1401", uniques: "1034", routes: "450", editors: 13 },
                { day: "nicht-ein-datum", views: "9", uniques: "9", routes: "9", editors: 9 },
            ],
        },
    };

    it("übernimmt je Tag Aufrufe, Eindeutige, Routen und die Editorenköpfe als eigene Sorte", () => {
        const zeilen = zeilenAusAbzug(abzug);
        expect(zeilen).toHaveLength(4);
        expect(zeilen.every((zeile) => zeile.day === "2026-10-05" && zeile.hour === 24)).toBe(true);
        expect(zeilen.find((zeile) => zeile.metric === "pageview")?.count).toBe(1401);
        expect(zeilen.find((zeile) => zeile.actor_type === "editor")?.count).toBe(13);
        expect(zeilen.filter((zeile) => zeile.actor_type === "visitor")).toHaveLength(3);
    });

    it("zählt die Editorenköpfe aus dem Editorabzug nicht doppelt", () => {
        const zeilen = zeilenAusAbzug({ ...abzug, actor: "editor" });
        expect(zeilen.filter((zeile) => zeile.metric === "unique" && zeile.actor_type === "editor")).toHaveLength(1);
    });
});

/**
 * Das experimentelle Wetter (WI-0288). 🔴 Jeder Fall nimmt den ECHTEN Sendewert, den `wetter-messung.ts` und `wetter-schalter.ts` bauen:
 * Eine Art, die nicht zum Sender passt, verwirft `zeilenAus` still (Falle 3 der Besucherstatistik).
 */
describe("Zählpfad: experimentelles Wetter", () => {
    const meldung = (ereignisse: { metrik: string; dimension?: string }[]): BesuchMeldung =>
        ({ ereignisse }) as BesuchMeldung;

    it.each([
        ["wetter_lauf", "rechner"],
        ["wetter_lauf", "telefon"],
        ["wetter_start", "rechner:2-3s"],
        ["wetter_start", "telefon:ab30s"],
        ["wetter_bildrate", "telefon:u10"],
        ["wetter_bildrate", "rechner:ab120"],
        ["wetter_spitze", "rechner:30-40"],
        ["wetter_aufloesung", "telefon:25"],
        ["wetter_gpu", "rechner:nvidia"],
        ["wetter_gpu", "telefon:adreno"],
        ["wetter_fehler", "telefon:gleitkomma"],
        ["wetter_fehler", "rechner:laden"],
        ["display_toggle", "wetter_wolken:on"],
        ["display_toggle", "wetter_regenUndSchnee:off"],
        ["display_toggle", "wetter_schneefallgrenze:on"],
    ])("nimmt %s = %s an", (metrik, dimension) => {
        expect(zeilenAus(meldung([{ metrik, dimension }])).map((zeile) => [zeile.metrik, zeile.dimension])).toEqual([
            [metrik, dimension],
        ]);
    });

    it("🔴 verwirft Fremdes, statt es zu kürzen: andere Geräte, Namen der Grafikkarte, Freitext", () => {
        const roh = [
            "tablet",
            "rechner:NVIDIA GeForce RTX 3070",
            "rechner:<15",
            "rechner:Fehler: etwas",
            "",
            "rechner:30-45:x",
        ];
        for (const dimension of roh) {
            expect(zeilenAus(meldung([{ metrik: "wetter_gpu", dimension }])), dimension).toEqual([]);
        }
    });

    it("jede Wettermetrik steht in der Positivliste", () => {
        for (const metrik of WETTER_METRIKEN) expect(BESUCH_METRIKEN).toContain(metrik);
    });
});
