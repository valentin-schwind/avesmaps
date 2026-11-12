import { describe, expect, it } from "vitest";
import {
    KANAL_IDS,
    KANAL_VERBUNDEN,
    ZAEHLREGELN,
    engsterKanal,
    ersterUeberlauf,
    fassungFuer,
    istKanalId,
    mastodonRegel,
    pruefeLaenge,
    regelFuer,
    zaehleAlle,
    zaehleBytes,
    zaehleKanal,
    type KanalId,
    type KanalRegeln,
} from "../src/index.ts";

/**
 * Die Zählung der Beiträge (WI-0270 C11, Fachkonzept §15.6). Die Prüffälle sind die Tafel der Recherche
 * `project-control/discovery/social-zeichengrenzen-2026-10-31.md` §4; sie gelten im Browser und auf dem Server gleich, weil beide dieses Modul rufen.
 */
const text = (t: string, hashtags: string[] = []) => ({ text: t, hashtags });
const n = (kanal: KanalId, t: string) => zaehleKanal(kanal, text(t)).n;
const b = (t: string) => zaehleBytes(t);

/** Eine zweite Grenze in Bytes ist als Regel möglich, aber keine heutige Regel setzt sie (Bluesky ist aus dem Hub entfernt, Vali 2026-11-01): Die Fälle dazu rechnen mit einer erfundenen Regel. */
const MIT_BYTES: KanalRegeln = { mastodon: { ...ZAEHLREGELN.mastodon, grenze: 300, bytes: 3000 } };

const LANGE_ADRESSE = `https://avesmaps.de/karte/${"a".repeat(80 - "https://avesmaps.de/karte/".length)}`;

describe("Prüffälle der Recherche §4", () => {
    it.each([
        ["Umlaute", "Größe", 5, 7, 5],
        ["Emoji mit Hautton", "👍🏽", 1, 8, 4],
        ["Familie (ZWJ)", "👨‍👩‍👧", 1, 18, 8],
        ["Flagge", "🇩🇪", 1, 8, 4],
        ["Zeilenumbruch Windows", "a\r\nb", 3, 4, 4],
        ["Lange Adresse", LANGE_ADRESSE, 23, 80, 80],
        ["Adresse ohne Protokoll", "avesmaps.de/karte", 17, 17, 17],
        ["Erwähnung fremder Instanz", "@vali@rollenspiel.social", 5, 24, 24],
        ["Hashtag mit Umlaut", "#Über", 5, 6, 5],
    ])("%s", (_name, t, mastodon, bytes, discord) => {
        expect(n("mastodon", t)).toBe(mastodon);
        expect(b(t)).toBe(bytes);
        expect(n("discord", t)).toBe(discord);
    });

    it("die Adresse hat 80 Zeichen, die Prüfzeile der Recherche meint genau das", () => {
        expect(Array.from(LANGE_ADRESSE)).toHaveLength(80);
    });
});

describe("Mastodon", () => {
    it("jede Adresse mit Protokoll zählt 23, auch mehrere im Satz", () => {
        expect(n("mastodon", `Karte: ${LANGE_ADRESSE} und http://a.de dazu`)).toBe(
            "Karte: ".length + 23 + " und ".length + 23 + " dazu".length,
        );
    });

    it("Satzzeichen am Ende gehören dem Satz, nicht der Adresse (zählt eher zu viel)", () => {
        expect(n("mastodon", "Hier: https://avesmaps.de/karte.")).toBe("Hier: ".length + 23 + 1);
    });

    it("ein Wort, das an einer Adresse klebt, ist keine Adresse", () => {
        const langes = `x${LANGE_ADRESSE}`;
        expect(n("mastodon", langes)).toBe(Array.from(langes).length);
    });

    it("Erwähnungen: die eigene bleibt, die fremde zählt nur als @name", () => {
        expect(n("mastodon", "@vali")).toBe(5);
        expect(n("mastodon", "Danke @vali@rollenspiel.social und @alrike@mastodon.example!")).toBe(
            "Danke @vali und @alrike!".length,
        );
    });

    it("die Inhaltswarnung zählt mit dem Text zusammen", () => {
        const stand = zaehleKanal("mastodon", { text: "Hallo", hashtags: [], warnung: "Spoiler" });
        expect(stand.n).toBe("Spoiler".length + "Hallo".length);
    });

    it("500 ist die Grenze: 500 geht, 501 läuft über und sagt um wie viel", () => {
        expect(zaehleKanal("mastodon", text("a".repeat(500))).ueber).toBe(false);
        const ueber = zaehleKanal("mastodon", text("a".repeat(573)));
        expect(ueber.ueber).toBe(true);
        expect(ueber.zuviel).toBe(73);
    });

    it("Emoji mit Hautton zählen als eines: 500 Daumen gehen durch, obwohl sie 4000 UTF-16-Einheiten sind", () => {
        expect(zaehleKanal("mastodon", text("👍🏽".repeat(500))).ueber).toBe(false);
    });
});

describe("Eine zweite Grenze in Bytes (Regel als Daten)", () => {
    it("300 Grapheme UND 3000 Bytes: wer die Bytes sprengt, läuft über, auch mit wenigen Graphemen", () => {
        // 300 Hiragana: 300 Grapheme und 900 Bytes; 200 Familien: 200 Grapheme, aber 3600 Bytes.
        expect(zaehleKanal("mastodon", text("あ".repeat(300)), MIT_BYTES).ueber).toBe(false);
        const bytes = zaehleKanal("mastodon", text("👨‍👩‍👧".repeat(200)), MIT_BYTES);
        expect(bytes.n).toBe(200);
        expect(bytes.bytes).toBe(3600);
        expect(bytes.zuvielBytes).toBe(600);
        expect(bytes.zuviel).toBe(0);
        expect(bytes.ueber).toBe(true);
    });

    it("ohne die Bytegrenze in der Regel zählt der Kanal nur seine Zeichen", () => {
        const stand = zaehleKanal("mastodon", text("👨‍👩‍👧".repeat(200)));
        expect(stand.bytes).toBeNull();
        expect(stand.zuvielBytes).toBe(0);
        expect(stand.ueber).toBe(false);
    });
});

describe("Discord, Instagram, Neuigkeiten", () => {
    it("Discord zählt in UTF-16: 1000 Daumen mit Hautton sind 4000 Einheiten und laufen über 2000", () => {
        const stand = zaehleKanal("discord", text("👍🏽".repeat(1000)));
        expect(stand.n).toBe(4000);
        expect(stand.zuviel).toBe(2000);
    });

    it("Instagram: 2200, vorsichtig in UTF-16 gezählt", () => {
        expect(zaehleKanal("instagram", text("a".repeat(2200))).ueber).toBe(false);
        expect(zaehleKanal("instagram", text("a".repeat(2201))).zuviel).toBe(1);
    });

    it("Neuigkeiten: Titel 200 und Text 4000 in Codepoints, getrennt gemeldet", () => {
        const ok = zaehleKanal("neuigkeiten", { titel: "T".repeat(200), text: "a".repeat(4000), hashtags: [] });
        expect(ok.ueber).toBe(false);
        expect(ok.titel).toEqual({ n: 200, grenze: 200, zuviel: 0 });
        const titel = zaehleKanal("neuigkeiten", { titel: "T".repeat(201), text: "a", hashtags: [] });
        expect(titel.ueber).toBe(true);
        expect(titel.titel?.zuviel).toBe(1);
        expect(titel.zuviel).toBe(0);
        const lang = zaehleKanal("neuigkeiten", { titel: "T", text: "a".repeat(4001), hashtags: [] });
        expect(lang.zuviel).toBe(1);
    });

    it("Neuigkeiten zählen den Titel ohne Leerraum an den Rändern, wie die Seite (`btrim`)", () => {
        expect(zaehleKanal("neuigkeiten", { titel: `  ${"T".repeat(200)}  `, text: "a", hashtags: [] }).ueber).toBe(
            false,
        );
    });

    it("die anderen Kanäle haben keinen Titel", () => {
        expect(zaehleKanal("mastodon", { titel: "T".repeat(500), text: "a", hashtags: [] }).titel).toBeNull();
    });
});

describe("Hashtags", () => {
    const tags = ["#Aventurien", "#DSA", "#Avesmaps", "#Karte", "#Rollenspiel"];

    it("jeder Kanal bekommt die ersten so vielen, wie seine Regel sagt, und sie zählen mit", () => {
        const f = fassungFuer(ZAEHLREGELN.mastodon, text("Hallo", tags));
        expect(f.hashtags).toEqual(["#Aventurien", "#DSA", "#Avesmaps", "#Karte"]);
        expect(f.weg).toBe(1);
        expect(f.text).toBe("Hallo\n\n#Aventurien #DSA #Avesmaps #Karte");
        expect(zaehleKanal("mastodon", text("Hallo", tags)).n).toBe(f.text.length);
        expect(zaehleKanal("mastodon", text("Hallo", tags)).hashtagsWeg).toBe(1);
    });

    it("die Neuigkeiten bekommen keine: alle fallen weg, der Text bleibt, wie er ist", () => {
        const stand = zaehleKanal("neuigkeiten", text("Hallo", tags));
        expect(stand.n).toBe(5);
        expect(stand.hashtagsWeg).toBe(5);
    });

    it("Instagram nimmt fünf, Facebook zwei", () => {
        expect(zaehleKanal("instagram", text("x", tags)).hashtagsWeg).toBe(0);
        expect(zaehleKanal("facebook", text("x", tags)).hashtagsWeg).toBe(3);
    });
});

describe("der engste Kanal", () => {
    const kanaele: KanalId[] = ["neuigkeiten", "discord", "mastodon"];

    it("nennt den, dem am wenigsten Platz bleibt: bei 250 Zeichen Mastodon (250 frei) vor Discord (1750) und den Neuigkeiten (3750)", () => {
        const engster = engsterKanal(zaehleAlle(kanaele, text("a".repeat(250))));
        expect(engster?.kanal).toBe("mastodon");
        expect(engster?.frei).toBe(250);
    });

    it("läuft einer über, steht er vorn, der stärkere Überlauf vor dem schwächeren", () => {
        const engster = engsterKanal(zaehleAlle(kanaele, text("a".repeat(573))));
        expect(engster?.kanal).toBe("mastodon");
        expect(engster?.zuviel).toBe(73);
        const beide = engsterKanal(zaehleAlle(["mastodon", "discord"], text("a".repeat(2573))));
        expect(beide?.kanal).toBe("mastodon");
        expect(beide?.zuviel).toBe(2073);
    });

    it("ein Überlauf in Bytes schlägt einen Kanal mit Platz", () => {
        const engster = engsterKanal(zaehleAlle(["neuigkeiten", "mastodon"], text("👨‍👩‍👧".repeat(200)), MIT_BYTES));
        expect(engster?.kanal).toBe("mastodon");
        expect(engster?.zuvielBytes).toBe(600);
    });

    it("ohne Kanal gibt es keinen", () => {
        expect(engsterKanal([])).toBeNull();
    });
});

describe("die Prüfung vor dem Vorlegen und Freigeben", () => {
    it("meldet den ersten Überlauf der gewählten Kanäle, mit Art und Größe", () => {
        expect(pruefeLaenge(["neuigkeiten"], { titel: "T", text: "a".repeat(4001), hashtags: [] })).toEqual({
            art: "text",
            kanal: "neuigkeiten",
            zuviel: 1,
            einheit: "zeichen",
        });
        expect(pruefeLaenge(["neuigkeiten"], { titel: "T".repeat(202), text: "a", hashtags: [] })).toEqual({
            art: "titel",
            kanal: "neuigkeiten",
            zuviel: 2,
        });
        expect(pruefeLaenge(["mastodon"], text("👨‍👩‍👧".repeat(200)), MIT_BYTES)).toEqual({
            art: "bytes",
            kanal: "mastodon",
            zuviel: 600,
        });
    });

    it("ein Kanal, den niemand gewählt hat, zählt nicht mit", () => {
        expect(pruefeLaenge(["neuigkeiten"], text("a".repeat(1000)))).toBeNull();
        expect(ersterUeberlauf(zaehleAlle(["mastodon"], text("a".repeat(1000))))?.kanal).toBe("mastodon");
    });
});

describe("die Regeln als Daten", () => {
    it("jeder Kanal hat genau eine Zeile mit Quelle und Prüfdatum", () => {
        for (const id of KANAL_IDS) {
            const regel = ZAEHLREGELN[id];
            expect(regel.id).toBe(id);
            expect(regel.quelle.length).toBeGreaterThan(0);
            expect(regel.geprueft).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
            expect(regel.grenze).toBeGreaterThan(0);
        }
    });

    it("🔴 Bluesky ist nicht vorgesehen (Vali 2026-11-01): kein Kanal, keine Regel", () => {
        expect(KANAL_IDS as readonly string[]).not.toContain("bluesky");
        expect(Object.keys(ZAEHLREGELN)).not.toContain("bluesky");
        expect(istKanalId("bluesky")).toBe(false);
    });

    it("im ersten Schnitt sendet nur der Kanal Neuigkeiten", () => {
        expect(KANAL_VERBUNDEN).toEqual(["neuigkeiten"]);
    });

    it("Bytes zählt UTF-8 auch ohne TextEncoder gleich wie mit", () => {
        expect(zaehleBytes("aß€😀")).toBe(1 + 2 + 3 + 4);
    });
});

describe("Mastodon liest seine Grenzen von der Instanz (WI-0268 C12a)", () => {
    const instanz = mastodonRegel({ zeichen: 800, adresse: 30 }, "2026-11-01");
    const regeln = { mastodon: instanz };

    it("die Regel der Instanz ersetzt Grenze und Länge einer Adresse, alles andere bleibt die Vorgabe", () => {
        expect(instanz).toMatchObject({ id: "mastodon", grenze: 800, adresse: 30, geprueft: "2026-11-01" });
        expect(instanz.einheit).toBe(ZAEHLREGELN.mastodon.einheit);
        expect(instanz.hashtags).toBe(ZAEHLREGELN.mastodon.hashtags);
        expect(instanz.erwaehnungLokal).toBe(true);
        expect(regelFuer("mastodon", regeln)).toBe(instanz);
        expect(regelFuer("mastodon")).toBe(ZAEHLREGELN.mastodon);
        expect(regelFuer("discord", regeln)).toBe(ZAEHLREGELN.discord);
        // Die Vorgaben bleiben unberührt.
        expect(ZAEHLREGELN.mastodon.grenze).toBe(500);
        expect(ZAEHLREGELN.mastodon.adresse).toBe(23);
    });

    it("🔴 eine Adresse zählt die Zahl der Instanz, nicht 23; eine geänderte Instanzgrenze gilt beim nächsten Zählen", () => {
        expect(zaehleKanal("mastodon", text(LANGE_ADRESSE), regeln).n).toBe(30);
        expect(zaehleKanal("mastodon", text(LANGE_ADRESSE)).n).toBe(23);
        expect(zaehleKanal("mastodon", text("a".repeat(600)), regeln).ueber).toBe(false);
        expect(zaehleKanal("mastodon", text("a".repeat(600))).ueber).toBe(true);
        expect(zaehleKanal("mastodon", text("a".repeat(801)), regeln)).toMatchObject({
            grenze: 800,
            zuviel: 1,
            ueber: true,
        });
        // Eine zweite Instanz mit kleinerer Grenze: dieselbe Funktion, andere Zahl.
        const eng = { mastodon: mastodonRegel({ zeichen: 300, adresse: 23 }, "2026-11-02") };
        expect(zaehleKanal("mastodon", text("a".repeat(301)), eng).zuviel).toBe(1);
    });

    it("🔴 die Prüffälle gelten mit den Grenzen der Instanz gleich: Grapheme, Erwähnung nur @name, Hashtag mit Umlaut, Hashtag-Höchstzahl", () => {
        const z = (t: string, tags: string[] = []) => zaehleKanal("mastodon", text(t, tags), regeln).n;
        expect(z("👍🏽")).toBe(1);
        expect(z("👨‍👩‍👧")).toBe(1);
        expect(z("🇩🇪")).toBe(1);
        expect(z("a\r\nb")).toBe(3);
        expect(z("@vali@rollenspiel.social")).toBe(5);
        expect(z("#Über")).toBe(5);
        expect(z("avesmaps.de/karte")).toBe(17);
        // Höchstens vier Hashtags: die ersten vier zählen mit, der fünfte fällt weg.
        const fuenf = zaehleKanal("mastodon", text("Hallo", ["#A", "#B", "#C", "#D", "#E"]), regeln);
        expect(fuenf.hashtagsWeg).toBe(1);
        expect(fuenf.n).toBe("Hallo\n\n#A #B #C #D".length);
    });

    it("pruefeLaenge und zaehleAlle reichen die Regeln durch", () => {
        const lang = text("a".repeat(600));
        expect(pruefeLaenge(["mastodon"], lang)?.kanal).toBe("mastodon");
        expect(pruefeLaenge(["mastodon"], lang, regeln)).toBeNull();
        expect(zaehleAlle(["mastodon"], lang, regeln)[0]?.grenze).toBe(800);
    });
});
