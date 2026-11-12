import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { KANAL_IDS, ZAEHLREGELN, mastodonRegel, type KanalId } from "@avesmaps3d/shared";
import { createServer, type ViteDevServer } from "vite";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ANZEIGENAME,
    KUERZUNG,
    aktiverReiter,
    fotoArt,
    kontoVon,
    reiterVon,
    vorschauText,
    zerlege,
    type Absatz,
} from "../src/community/social-vorschau-modell.ts";

/**
 * Die Vorschau je Kanal im Beitragsfenster des Social Hubs (WI-0270, Probierseite V15; Vali 2026-11-01, bestätigt per Antwortknopf „Ja, so einbauen“): das Modell ohne Browser (Reiter, Stücke, Kürzung, Hashtags je Kanal,
 * Bild) und das Bauteil serverseitig gerendert (Reiter, Kopf der Karte, die gestrichelte Fläche von Instagram, kein HTML aus dem Text).
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LEER = "Noch kein Text.";
const hashtags = (...tags: string[]) => tags;
const stuecke = (absaetze: readonly Absatz[]) => absaetze.map((absatz) => absatz.map((s) => s.art));
/** Der sichtbare Text einer Vorschau in einem Stück, Stücke aneinander. */
const lesbar = (absaetze: readonly Absatz[]): string =>
    absaetze.map((absatz) => absatz.map((s) => (s.art === "umbruch" ? "\n" : s.text)).join("")).join("\n\n");

describe("Die Reiter", () => {
    it("🔴 sie stammen aus der Kanalliste des Hubs: jeder Kanal der Liste hat einen, in der Reihenfolge des Entwurfs", () => {
        expect(reiterVon([]).map((r) => r.id)).toEqual(["neuigkeiten", "mastodon", "instagram", "facebook", "discord"]);
        expect(reiterVon([]).map((r) => r.id)).toEqual(
            ["neuigkeiten", "mastodon", "instagram", "facebook", "discord"].filter((id) =>
                (KANAL_IDS as readonly string[]).includes(id),
            ),
        );
    });

    it("🔴 Bluesky steht nicht in der Liste und hat keinen Reiter; ein Kanal, der aus der Liste fällt, verschwindet mit", () => {
        expect(reiterVon(["neuigkeiten"]).map((r) => r.id as string)).not.toContain("bluesky");
        // Ein Aufrufer, der die Liste kürzt (oder ein Beitrag mit einem Kanal von früher), bekommt keinen Reiter für das, was die Liste nicht führt.
        const ohneDiscord = KANAL_IDS.filter((id) => id !== "discord");
        expect(reiterVon(["discord", "mastodon"], ohneDiscord).map((r) => r.id)).toEqual([
            "mastodon",
            "neuigkeiten",
            "instagram",
            "facebook",
        ]);
        // Ein Kanal der Liste, den die Reihenfolge nicht kennt, steht hinten.
        const neu = [...KANAL_IDS, "threads"] as unknown as readonly KanalId[];
        expect(reiterVon([], neu).map((r) => r.id as string)).toEqual([...reiterVon([]).map((r) => r.id), "threads"]);
    });

    it("angehakte Kanäle stehen vorn, die übrigen dahinter zum Vergleich", () => {
        const reiter = reiterVon(["facebook", "neuigkeiten"]);
        expect(reiter.map((r) => [r.id, r.angehakt])).toEqual([
            ["neuigkeiten", true],
            ["facebook", true],
            ["mastodon", false],
            ["instagram", false],
            ["discord", false],
        ]);
    });

    it("der gewählte Reiter gilt, solange es ihn gibt; sonst der erste", () => {
        const reiter = reiterVon(["instagram"]);
        expect(aktiverReiter(reiter, undefined)).toBe("instagram");
        expect(aktiverReiter(reiter, "facebook")).toBe("facebook");
        expect(aktiverReiter(reiterVon(["instagram"], ["neuigkeiten", "mastodon"]), "instagram")).toBe("neuigkeiten");
        expect(aktiverReiter([], undefined)).toBeUndefined();
    });
});

describe("Text in Stücken", () => {
    it("Hashtags und Adressen sind eigene Stücke, der Rest Text; Zeilenumbrüche und Absätze bleiben", () => {
        const absaetze = zerlege("Neu auf der Karte #Aventurien\nSiehe https://avesmaps.de/karte\n\nBis bald!", true);
        expect(stuecke(absaetze)).toEqual([["text", "hashtag", "umbruch", "text", "adresse"], ["text"]]);
        expect(absaetze[0]?.find((s) => s.art === "adresse")).toEqual({ art: "adresse", text: "avesmaps.de/karte" });
    });

    it("eine Adresse erscheint ohne Protokoll und nach 30 Zeichen mit „…“; das Satzzeichen am Ende bleibt Satz", () => {
        const lang = "https://avesmaps.de/karte/ein-sehr-langer-pfad-der-nicht-endet";
        const [absatz] = zerlege(`Hier: ${lang}.`, true);
        const adresse = absatz?.find((s) => s.art === "adresse");
        expect(adresse?.art === "adresse" && adresse.text).toBe(`${"avesmaps.de/karte/ein-sehr-lange".slice(0, 30)}…`);
        expect(absatz?.at(-1)).toEqual({ art: "text", text: "." });
    });

    it("Instagram macht keine Verweise: die Adresse bleibt Text, der Hashtag bleibt farbig", () => {
        const [absatz] = zerlege("#DSA https://avesmaps.de", false);
        expect(absatz?.map((s) => s.art)).toEqual(["hashtag", "text"]);
        expect(lesbar([absatz ?? []])).toBe("#DSA https://avesmaps.de");
    });

    it("🔴 aus dem Text wird nie Markup: spitze Klammern, Anführungszeichen und Entitäten bleiben Text", () => {
        const roh = `<script>alert("x")</script> <img src=x onerror=y> &amp; #tag<b>`;
        const absaetze = zerlege(roh, true);
        // Nichts davon wird zu einem Stück anderer Art als Text oder Hashtag; das Hashtag-Muster nimmt kein „<“ mit.
        expect(absaetze.flat().every((s) => s.art === "text" || s.art === "hashtag")).toBe(true);
        expect(lesbar(absaetze)).toBe(roh);
        expect(absaetze[0]?.find((s) => s.art === "hashtag")).toEqual({ art: "hashtag", text: "#tag" });
    });

    it("ein Hashtag mitten im Wort und ein „#“ allein sind keine Hashtags", () => {
        expect(stuecke(zerlege("a#b # c", true))).toEqual([["text"]]);
        expect(stuecke(zerlege("Umlaute: #Über #Größe", true))).toEqual([["text", "hashtag", "text", "hashtag"]]);
    });

    it("Windows-Zeilenenden werden wie Unix gelesen", () => {
        expect(stuecke(zerlege("a\r\nb\r\n\r\nc", true))).toEqual([["text", "umbruch", "text"], ["text"]]);
    });
});

describe("Text und Hashtags je Kanal", () => {
    const eingabe = (text: string, tags: string[] = []) => ({ text, hashtags: tags });
    const sechs = hashtags("#A", "#B", "#C", "#D", "#E", "#F");

    it("🔴 jeder Kanal bekommt die ersten so vielen Hashtags, wie seine Zählregel nimmt", () => {
        for (const id of KANAL_IDS) {
            const v = vorschauText(id, eingabe("Hallo", sechs), { leer: LEER, voll: true });
            const tags = v.absaetze.flat().filter((s) => s.art === "hashtag");
            expect(tags.length, id).toBe(Math.min(ZAEHLREGELN[id].hashtags, sechs.length));
            expect(
                tags.map((s) => (s.art === "hashtag" ? s.text : "")),
                id,
            ).toEqual(sechs.slice(0, ZAEHLREGELN[id].hashtags));
        }
        // Zahlen der heutigen Regeln, damit eine Änderung auffällt: Neuigkeiten 0, Discord 0, Mastodon 4, Instagram 5, Facebook 2.
        expect(KANAL_IDS.map((id) => ZAEHLREGELN[id].hashtags)).toEqual([0, 0, 4, 5, 2]);
    });

    it("die Regel der Instanz gilt vor der Vorgabe (Mastodon liest sie vom Dienst)", () => {
        const regeln = { mastodon: { ...mastodonRegel({ zeichen: 500, adresse: 23 }, "2026-11-01"), hashtags: 1 } };
        const v = vorschauText("mastodon", eingabe("Hallo", sechs), { leer: LEER, regeln });
        expect(v.absaetze.flat().filter((s) => s.art === "hashtag")).toHaveLength(1);
    });

    it("die Hashtags stehen in einem eigenen Absatz hinter dem Text; ohne Text steht der Ersatzsatz davor", () => {
        const v = vorschauText("mastodon", eingabe("  Hallo  ", hashtags("#A", "#B")), { leer: LEER });
        expect(lesbar(v.absaetze)).toBe("Hallo\n\n#A #B");
        const leer = vorschauText("facebook", eingabe("   ", hashtags("#A")), { leer: LEER });
        expect(lesbar(leer.absaetze)).toBe(`${LEER}\n\n#A`);
    });

    it("Instagram kürzt nach 125 Zeichen am Wortrand mit „mehr“; Facebook nach 300; die anderen nie", () => {
        expect(KUERZUNG).toEqual({ instagram: 125, facebook: 300 });
        const wort = "Aventurien ";
        const lang = wort.repeat(60).trim();
        const ig = vorschauText("instagram", eingabe(lang), { leer: LEER });
        expect(ig.gekuerzt).toBe(true);
        const kurz = lesbar(ig.absaetze);
        expect(kurz.length).toBeLessThanOrEqual(125);
        expect(kurz.endsWith("Aventurien")).toBe(true);
        expect(kurz.length).toBeGreaterThan(125 - wort.length);
        const fb = vorschauText("facebook", eingabe(lang), { leer: LEER });
        expect(fb.gekuerzt).toBe(true);
        expect(lesbar(fb.absaetze).length).toBeLessThanOrEqual(300);
        for (const id of ["neuigkeiten", "mastodon", "discord"] as const) {
            const v = vorschauText(id, eingabe(lang), { leer: LEER });
            expect(v.gekuerzt, id).toBe(false);
            expect(lesbar(v.absaetze), id).toBe(lang);
        }
    });

    it("genau an der Grenze wird nicht gekürzt, ein Zeichen darüber schon; aufgeklappt (voll) nie", () => {
        const genau = `${"a ".repeat(62)}a`.slice(0, 125);
        expect(Array.from(genau)).toHaveLength(125);
        expect(vorschauText("instagram", eingabe(genau), { leer: LEER }).gekuerzt).toBe(false);
        const darueber = `${genau} b`;
        expect(vorschauText("instagram", eingabe(darueber), { leer: LEER }).gekuerzt).toBe(true);
        const voll = vorschauText("instagram", eingabe(darueber), { leer: LEER, voll: true });
        expect(voll.gekuerzt).toBe(false);
        expect(lesbar(voll.absaetze)).toBe(darueber);
    });

    it("die Kürzung spaltet kein Emoji", () => {
        const text = `${"😀".repeat(124)} 👨‍👩‍👧 ${"x".repeat(40)}`;
        const v = vorschauText("instagram", eingabe(text), { leer: LEER });
        expect(v.gekuerzt).toBe(true);
        expect(lesbar(v.absaetze)).not.toMatch(/[\uD800-\uDBFF]$/u);
    });

    it("Instagram setzt Adressen nicht als Verweis, Facebook und Mastodon schon", () => {
        const text = "Karte: https://avesmaps.de/karte";
        expect(
            vorschauText("instagram", eingabe(text), { leer: LEER })
                .absaetze.flat()
                .map((s) => s.art),
        ).not.toContain("adresse");
        for (const id of ["mastodon", "facebook", "discord"] as const) {
            expect(
                vorschauText(id, eingabe(text), { leer: LEER })
                    .absaetze.flat()
                    .map((s) => s.art),
                id,
            ).toContain("adresse");
        }
    });
});

describe("Bild und Konto", () => {
    it("ein gewähltes Bild: mit Adresse das Bild, ohne eine Fläche in seiner Form; kein Bild: nichts, nur wo der Dienst eines verlangt (Instagram) die gestrichelte Fläche", () => {
        expect(fotoArt(true, "/media/x.webp", false)).toBe("bild");
        expect(fotoArt(true, null, false)).toBe("platz");
        expect(fotoArt(false, null, false)).toBe("kein");
        expect(fotoArt(false, null, true)).toBe("ohne");
        // Ein Bild, das gewählt ist, zählt auch bei Instagram als Bild.
        expect(fotoArt(true, null, true)).toBe("platz");
    });

    it("das Konto kommt aus den öffentlichen Konten („Hinweise“): Mastodon mit Instanz, Instagram der Name, sonst Avesmaps", () => {
        expect(kontoVon("mastodon")).toBe("@Avesmaps@rollenspiel.social");
        expect(kontoVon("instagram")).toBe("avesmaps");
        expect(kontoVon("facebook")).toBe(ANZEIGENAME);
        expect(kontoVon("discord")).toBe(ANZEIGENAME);
        expect(kontoVon("neuigkeiten")).toBe(ANZEIGENAME);
    });
});

describe("Das Bauteil, serverseitig gerendert", () => {
    let server: ViteDevServer;
    let Vorschau: Component;

    beforeAll(async () => {
        server = await createServer({
            root: repositoryRoot,
            configFile: false,
            logLevel: "silent",
            appType: "custom",
            cacheDir: join(tmpdir(), "avesmaps-test-vorschau-vite"),
            server: { middlewareMode: true, hmr: false, watch: null },
            optimizeDeps: { noDiscovery: true, include: [] },
            plugins: [vue()],
            resolve: {
                alias: [
                    {
                        find: /^@avesmaps3d\/shared$/,
                        replacement: join(repositoryRoot, "packages/shared/src/index.ts"),
                    },
                ],
            },
        });
        const modul = (await server.ssrLoadModule("/apps/web/src/community/social-vorschau.vue")) as {
            default: Component;
        };
        Vorschau = modul.default;
    }, 60_000);

    afterAll(async () => {
        await server.close();
    });

    const BASIS = {
        kanaele: ["neuigkeiten"] as KanalId[],
        titel: "Neue Orte",
        text: "Hallo Aventurien #DSA",
        hashtags: ["#DSA", "#Karte"],
        rubrik: "community",
        heute: "heute",
        hatBild: false,
        bildUrl: null as string | null,
        bildBeschreibung: "",
    };
    const rendere = (props: Partial<typeof BASIS> = {}): Promise<string> =>
        renderToString(createSSRApp({ render: () => h(Vorschau, { ...BASIS, ...props }) }));
    const reiterNamen = (html: string): string[] =>
        [...html.matchAll(/role="tab"[^>]*>.*?<span[^>]*>([^<]+)<\/span>/gu)].map((treffer) => treffer[1] ?? "");

    it("🔴 echte Reiter: tablist mit Namen, tab mit Auswahl, tabpanel mit Verweis auf den Reiter", async () => {
        const html = await rendere({ kanaele: ["mastodon"] });
        expect(html).toContain('role="tablist"');
        expect(html).toContain('aria-label="Vorschau je Kanal"');
        expect(reiterNamen(html)).toEqual(["Mastodon", "Neuigkeiten", "Instagram", "Facebook", "Discord"]);
        expect(html.match(/role="tab"/g)).toHaveLength(KANAL_IDS.length);
        expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
        expect(html).toContain('id="social-vorschau-reiter-mastodon"');
        expect(html).toContain('role="tabpanel"');
        expect(html).toContain('aria-labelledby="social-vorschau-reiter-mastodon"');
        expect(html).toContain('id="social-vorschau-inhalt-mastodon"');
    });

    it("die angehakten Reiter stehen vorn; die übrigen sind gestrichelt und sagen es im Titel; Bluesky gibt es nicht", async () => {
        const html = await rendere({ kanaele: ["instagram", "discord"] });
        expect(reiterNamen(html)).toEqual(["Instagram", "Discord", "Neuigkeiten", "Mastodon", "Facebook"]);
        expect(html.match(/vs-reiter--aus/g)).toHaveLength(3);
        expect(html).toContain('title="nicht angehakt, nur zum Vergleich"');
        expect(html).toContain('title="angehakt"');
        expect(html.toLowerCase()).not.toContain("bluesky");
    });

    it("Neuigkeiten wie bisher: Rubrik, Titelzeile, Text, der Hinweis zum Bild; keine Karte eines Dienstes", async () => {
        const html = await rendere({ hatBild: true });
        expect(html).toContain('data-testid="social-vorschau-neuigkeiten"');
        expect(html).toContain("Neue Orte");
        expect(html).toContain("Hallo Aventurien #DSA");
        expect(html).toContain("Die Neuigkeiten zeigen noch keine Bilder");
        expect(html).not.toContain("vs-buehne");
        expect(html).not.toContain("Ungefähre Darstellung");
    });

    it("Instagram ohne Bild zeigt die gestrichelte Fläche, mit Bild das Bild mit der Beschreibung als alt", async () => {
        const ohne = await rendere({ kanaele: ["instagram"] });
        expect(ohne).toContain('data-testid="social-vorschau-ohne-bild"');
        expect(ohne).toContain("Ohne Bild geht Instagram nicht.");
        expect(ohne).toContain("vs-foto--quadrat");
        const mit = await rendere({
            kanaele: ["instagram"],
            hatBild: true,
            bildUrl: "/media/a.webp",
            bildBeschreibung: "Eine Karte",
        });
        expect(mit).not.toContain("social-vorschau-ohne-bild");
        expect(mit).toContain('src="/media/a.webp"');
        expect(mit).toContain('alt="Eine Karte"');
    });

    it("ein Bild ohne Adresse (gespeicherter Beitrag) zeigt eine Fläche mit Satz, keine kaputte Grafik", async () => {
        const html = await rendere({
            kanaele: ["facebook"],
            hatBild: true,
            bildUrl: null,
            bildBeschreibung: "Eine Karte",
        });
        expect(html).toContain("Bild gewählt, Ansicht nicht geladen");
        expect(html).toContain('aria-label="Eine Karte"');
        expect(html).not.toContain("<img");
    });

    it("Mastodon: Konto der Instanz, Hashtags als Verweise, Bild breit, Leiste; der Hinweis nennt die Adresslänge", async () => {
        const html = await rendere({ kanaele: ["mastodon"], hatBild: true, bildUrl: "/media/a.webp" });
        expect(html).toContain("@Avesmaps@rollenspiel.social");
        expect(html).toContain("vs-link--hashtag");
        expect(html).toContain("vs-foto--breit");
        expect(html).toContain("↩ 0");
        expect(html).toContain("Ungefähre Darstellung, der Dienst zeichnet selbst.");
        expect(html).toContain("jede Adresse zählt 23 Zeichen");
        expect(html).toContain('aria-label="Vorschau Mastodon"');
    });

    it("Facebook: Zeile „Gerade eben · öffentlich“, die Leiste, das Bild randlos, die Kürzung mit „Mehr anzeigen“", async () => {
        const lang = "Aventurien ".repeat(40).trim();
        const html = await rendere({
            kanaele: ["facebook"],
            text: lang,
            hashtags: [],
            hatBild: true,
            bildUrl: "/media/a.webp",
        });
        expect(html).toContain("Gerade eben · öffentlich");
        expect(html).toContain("Gefällt mir");
        expect(html).toContain("Kommentieren");
        expect(html).toContain("Teilen");
        expect(html).toContain("vs-foto--randlos");
        expect(html).toContain("Mehr anzeigen");
        expect(html).toContain('data-testid="social-vorschau-mehr"');
        const kurz = await rendere({ kanaele: ["facebook"], text: "Kurz", hashtags: [] });
        // Der Hinweis unter der Karte nennt das Wort auch; der Knopf steht nur, wo gekürzt wurde.
        expect(kurz).not.toContain('data-testid="social-vorschau-mehr"');
    });

    it("Discord: Einbettung mit APP-Plakette, Titelzeile und Zeit", async () => {
        const html = await rendere({ kanaele: ["discord"], titel: "Neue Orte" });
        expect(html).toContain("vs-einbettung");
        expect(html).toContain("APP");
        expect(html).toContain("Neue Orte");
        expect(html).toContain("Heute um 12:00 Uhr");
        const ohneTitel = await rendere({ kanaele: ["discord"], titel: "  " });
        expect(ohneTitel).toContain("Ohne Titelzeile");
    });

    it("🔴 kein HTML aus dem Text: ein Skript im Beitrag erscheint als Text, in jedem Kanal", async () => {
        const boese = `<script>alert(1)</script><img src=x onerror=alert(2)> #tag`;
        for (const kanal of ["neuigkeiten", "mastodon", "instagram", "facebook", "discord"] as const) {
            const html = await rendere({ kanaele: [kanal], text: boese, titel: "<b>T</b>" });
            expect(html, kanal).not.toContain("<script");
            expect(html, kanal).not.toMatch(/<img[^>]*onerror/u);
            expect(html, kanal).toContain("&lt;script&gt;");
        }
    });
});

describe("Das Bauteil als Quelle", () => {
    const lies = (pfad: string): string => readFileSync(join(repositoryRoot, "apps/web/src/community", pfad), "utf8");
    const bauteile = ["social-vorschau.vue", "social-vorschau-text.vue", "social-vorschau-foto.vue"];

    it("🔴 nirgends v-html; Verweise und Hashtags kommen aus Stücken", () => {
        for (const datei of bauteile) {
            const quelle = lies(datei).replace(/\/\*[\s\S]*?\*\//g, "");
            expect(quelle, datei).not.toMatch(/v-html|innerHTML/u);
        }
        expect(lies("social-vorschau-text.vue")).toContain("stueck.art");
    });

    it("die Reiterleiste ist die des Hauses (FensterReiter), keine eigene mit role=tab", () => {
        const quelle = lies("social-vorschau.vue");
        expect(quelle).toContain('import FensterReiter from "../fenster/fenster-reiter.vue"');
        expect(quelle).toContain("<FensterReiter");
        expect(quelle).not.toMatch(/role\s*=\s*["']tab(list)?["']/u);
    });

    it("die Farbtafel `--vs-*` gehört diesem Bauteil und steht hell und dunkel da; sonst bleiben die Wächter des Kanons zuständig", () => {
        const quelle = lies("social-vorschau.vue");
        expect(quelle).toMatch(/\.vs \{[^}]*--vs-buehne: #[0-9a-f]{6};/u);
        expect(quelle).toContain(':root[data-theme="dark"] .vs {');
        // Die beiden Kinder lesen nur, sie setzen keine eigene Tafel.
        for (const datei of ["social-vorschau-text.vue", "social-vorschau-foto.vue"]) {
            expect(lies(datei), datei).not.toMatch(/--vs-[a-z-]+:\s*#/u);
        }
        // Außerhalb dieses Bauteils kommt `--vs-` im Quelltext nicht vor.
        const fremd = ["social-fenster.vue", "social-modell.ts", "social-liste.vue"].filter((d) =>
            lies(d).includes("--vs-"),
        );
        expect(fremd).toEqual([]);
    });

    it("das Beitragsfenster nimmt die neue Vorschau und kennt die alte Karte nicht mehr", () => {
        const fenster = lies("social-fenster.vue");
        expect(fenster).toContain("<SocialVorschau");
        expect(fenster).not.toContain("vorschau__titel");
        expect(fenster).not.toContain('data-testid="community-social-vorschau"');
    });
});
