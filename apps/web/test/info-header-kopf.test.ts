import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { createServer, type ViteDevServer } from "vite";
import { createSSRApp, h, type Component, type ShallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PHOTOBOX_EINREICHEN_SCHALTER } from "@avesmaps3d/shared";
import type { HeaderModel } from "../src/info-panel/panel-types.ts";

/**
 * Der Kopf der Infobox eines Ortes (WI-0272 S5), gerendert wie auf der Seite (Vite, SSR): wann „+ Eigenes Bild hinzufügen“ links oben steht, wann das ⚙ daneben, was es beschriftet und wohin die Beschriftung
 * unten rechts sagt, was das Bild ist. Ein Klick wird hier nicht gedrückt; was er tut, steht in `panel-aktionen-reisebild.test.ts`.
 *
 * - „+“: nur an einem Ort, nur in der Standardansicht, nicht bei abgeschaltetem Schalter `photobox.submissions`; auch auf der Grafik der Art, für Besucher wie für Editoren.
 * - ⚙: nur im Editor-Modus mit \`view_media_private\`, in jeder Ansicht; am Reisebild, am Kopfbild und (nur an einem Ort) auf der Grafik der Art.
 * - Der Bildbezug unten rechts: „Reisebild von Alrik“, ohne Namen „anonym“; ein Reisebild ist klickbar wie eine Ortsansicht.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ORT = { id: "80558060-4299-54aa-b520-814b10819885", name: "Gareth", subtype: "metropole", x: 551.6, y: 532.9 };
const bild = (id: string, extra: Partial<HeaderModel["images"][number]> = {}): HeaderModel["images"][number] => ({
    id,
    url: `/media/sha256/aa/bb/${id.padEnd(64, "0")}.webp`,
    width: 1600,
    height: 900,
    ...extra,
});
const reisebild = (id: string, name?: string): HeaderModel["images"][number] =>
    bild(id, {
        relation: "reisebild",
        reisebild: {
            beschreibung: "Der Blick vom Hafen",
            ...(name === undefined ? {} : { name }),
            entstehung: "photo",
        },
    });
/** Ein Kopf; ein ausdrücklich `undefined` gesetztes Feld fehlt (so fehlt `ort` an einem Weg und `graphic`, solange die Antwort fehlt). */
type Wunsch = { [K in keyof HeaderModel]?: HeaderModel[K] | undefined };
const kopf = (extra: Wunsch = {}): HeaderModel =>
    Object.fromEntries(
        Object.entries({ title: "Gareth", subtitle: [], graphic: "metropole", images: [], ort: ORT, ...extra }).filter(
            ([, wert]) => wert !== undefined,
        ),
    ) as unknown as HeaderModel;

describe("Der Kopf eines Ortes: „+“, ⚙ und der Bildbezug", () => {
    let server: ViteDevServer;
    let Kopf: Component;
    let viewer: typeof import("../src/viewer/bootstrap-viewer.ts");
    let stand: typeof import("../src/system/inhaltsstand.ts");

    beforeAll(async () => {
        server = await createServer({
            root: repositoryRoot,
            configFile: false,
            logLevel: "silent",
            appType: "custom",
            cacheDir: join(repositoryRoot, "node_modules", ".vite-info-header-kopf-test"),
            server: { middlewareMode: true, hmr: false, watch: null },
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
        Kopf = ((await server.ssrLoadModule("/apps/web/src/info-panel/info-header.vue")) as { default: Component })
            .default;
        viewer = (await server.ssrLoadModule("/apps/web/src/viewer/bootstrap-viewer.ts")) as typeof viewer;
        stand = (await server.ssrLoadModule("/apps/web/src/system/inhaltsstand.ts")) as typeof stand;
    }, 120_000);

    afterAll(async () => {
        await server.close();
    });

    /** Setzt den Stand der Inhaltsschalter der Seite („`stand`“ ist nur lesbar ausgegeben, die Seite schreibt ihn selbst). */
    const setzeStand = (wert: { revision: number | null; off: ReadonlySet<string> }): void => {
        (stand.inhaltsstand.stand as ShallowRef<typeof wert>).value = wert;
    };

    beforeEach(() => {
        setzeStand({ revision: 1, off: new Set() });
    });

    /** Rendert den Kopf; `rechte` sind die Capabilities der Sitzung (leer: ein Besucher). */
    const rendere = async (
        model: HeaderModel,
        optionen: { standard?: boolean; rechte?: string[] } = {},
    ): Promise<string> => {
        const app = createSSRApp({ render: () => h(Kopf, { model, standard: optionen.standard ?? true }) });
        app.provide(viewer.VIEWER_CONTEXT_KEY, {
            can: (name: string) => (optionen.rechte ?? []).includes(name),
        } as never);
        return renderToString(app);
    };
    const beitrag = (html: string): boolean => html.includes('data-testid="info-beitrag"');
    const zahnrad = (html: string): boolean => html.includes('data-testid="info-medien-kopfbild"');
    const etikett = (html: string, id: string): string | undefined =>
        new RegExp(`data-testid="${id}"[^>]*aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*data-testid="${id}"`)
            .exec(html)
            ?.slice(1)
            .find((treffer) => treffer !== undefined);
    const EDITOR = ["view_media_private"];

    it("🔴 „+“ steht an einem Ort in der Standardansicht, auch auf der Grafik der Art, für Besucher wie für Editoren", async () => {
        const besucher = await rendere(kopf());
        expect(beitrag(besucher)).toBe(true);
        expect(etikett(besucher, "info-beitrag")).toBe("Eigenes Bild hinzufügen");
        // Das Wort, das beim Zeigen aufgeht, ist dasselbe wie der Titel des Fensters.
        expect(besucher).toContain("info-header__beitrag-text");
        expect(besucher).toContain("Eigenes Bild hinzufügen</span>");
        expect(beitrag(await rendere(kopf(), { rechte: EDITOR }))).toBe(true);
        // Mit einem öffentlichen Bild (Ortsansicht, Typbild, Reisebild) ebenso.
        expect(beitrag(await rendere(kopf({ images: [bild("a", { relation: "place_view" })] })))).toBe(true);
        expect(beitrag(await rendere(kopf({ images: [reisebild("b", "Alrik")] })))).toBe(true);
    });

    it("🔴 „+“ steht nicht, wo es nicht hingehört: nicht außerhalb der Standardansicht, nicht an anderen Objekten, nicht bei abgeschalteten Einreichungen", async () => {
        expect(beitrag(await rendere(kopf(), { standard: false }))).toBe(false);
        expect(beitrag(await rendere(kopf({ ort: undefined })))).toBe(false);
        setzeStand({ revision: 2, off: new Set([PHOTOBOX_EINREICHEN_SCHALTER]) });
        expect(beitrag(await rendere(kopf()))).toBe(false);
        expect(beitrag(await rendere(kopf(), { rechte: EDITOR }))).toBe(false);
        // Andere Schalter berühren es nicht.
        setzeStand({ revision: 3, off: new Set(["media.role.photobox"]) });
        expect(beitrag(await rendere(kopf()))).toBe(true);
    });

    it("🔴 ⚙ nur für Editoren mit Recht, in jeder Ansicht; „+“ rückt daneben", async () => {
        const besucher = await rendere(kopf());
        expect(zahnrad(besucher)).toBe(false);
        expect(besucher).not.toContain("has-zahnrad");
        const ohneRecht = await rendere(kopf(), { rechte: ["use_editor_menu"] });
        expect(zahnrad(ohneRecht)).toBe(false);

        const editor = await rendere(kopf(), { rechte: EDITOR });
        expect(zahnrad(editor)).toBe(true);
        expect(editor).toContain("has-zahnrad");
        expect(beitrag(editor)).toBe(true);
        // In jeder Ansicht: außerhalb der Standardansicht fehlt das „+“, das ⚙ bleibt.
        const andere = await rendere(kopf(), { rechte: EDITOR, standard: false });
        expect(zahnrad(andere)).toBe(true);
        expect(beitrag(andere)).toBe(false);
    });

    it("das ⚙ führt, wohin es soll: auf der Grafik der Art zum Typbild, am Reisebild zu dessen Medienobjekt, am Kopfbild wie bisher zu diesem Asset", async () => {
        expect(etikett(await rendere(kopf(), { rechte: EDITOR }), "info-medien-kopfbild")).toBe(
            "Typbild in der Medienverwaltung öffnen",
        );
        expect(
            etikett(
                await rendere(kopf({ images: [reisebild("b", "Alrik")] }), { rechte: EDITOR }),
                "info-medien-kopfbild",
            ),
        ).toBe("Kopfbild in der Medienverwaltung öffnen");
        expect(
            etikett(
                await rendere(kopf({ images: [bild("a", { relation: "place_view" })] }), { rechte: EDITOR }),
                "info-medien-kopfbild",
            ),
        ).toBe("Kopfbild in der Medienverwaltung öffnen");
    });

    it("🔴 das ⚙ auf dem Typbild gilt an jedem Objekt mit Typbild, nicht nur am Ort; das „+“ bleibt am Ort", async () => {
        // Ein Weg, eine Fläche, ein Gebiet: die Grafik der Art, die Kategorie ist ihre Kopfgrafik.
        const grafik = await rendere(kopf({ ort: undefined, graphic: "reichsstrasse" }), { rechte: EDITOR });
        expect(zahnrad(grafik)).toBe(true);
        expect(grafik).toContain("has-zahnrad");
        expect(etikett(grafik, "info-medien-kopfbild")).toBe("Typbild in der Medienverwaltung öffnen");
        expect(beitrag(grafik)).toBe(false);
        // Ein Besucher sieht kein ⚙, auch nicht auf dem Typbild.
        expect(zahnrad(await rendere(kopf({ ort: undefined, graphic: "reichsstrasse" })))).toBe(false);
        const mitBild = await rendere(kopf({ ort: undefined, images: [bild("a", { relation: "type_image" })] }), {
            rechte: EDITOR,
        });
        expect(zahnrad(mitBild)).toBe(true);
        expect(beitrag(mitBild)).toBe(false);
    });

    it("der Korb „PhotoBox-Uploads“ bleibt nur der Rückfall, wo es gar kein Bild gibt: ein Ort ohne Grafik der Art; ohne Ort und ohne Grafik gibt es kein ⚙", async () => {
        const ortOhneGrafik = await rendere(kopf({ graphic: undefined }), { rechte: EDITOR });
        expect(etikett(ortOhneGrafik, "info-medien-kopfbild")).toBe("PhotoBox-Uploads in der Medienverwaltung öffnen");
        expect(zahnrad(await rendere(kopf({ graphic: undefined, ort: undefined }), { rechte: EDITOR }))).toBe(false);
    });

    it("🔴 der Bildbezug eines Reisebildes: „Reisebild von Alrik“, ohne Namen „Reisebild von anonym“, klickbar", async () => {
        const mitName = await rendere(kopf({ images: [reisebild("b", "Alrik")] }));
        expect(mitName).toContain('data-bezug="reisebild"');
        expect(mitName).toContain("Reisebild von Alrik");
        expect(mitName).toContain('data-testid="info-header-gross"');
        expect(mitName).toContain("is-ortsansicht");
        const ohneName = await rendere(kopf({ images: [reisebild("c")] }));
        expect(ohneName).toContain("Reisebild von anonym");
    });

    it("eine Ortsansicht und ein Typbild bleiben, wie sie waren; die Grafik der Art ist Typbild", async () => {
        const ansicht = await rendere(kopf({ images: [bild("a", { relation: "place_view" })] }));
        expect(ansicht).toContain('data-bezug="ortsansicht"');
        expect(ansicht).toContain('data-testid="info-header-gross"');
        const typ = await rendere(kopf({ images: [bild("t", { relation: "type_image" })] }));
        expect(typ).toContain('data-bezug="typbild"');
        expect(typ).not.toContain('data-testid="info-header-gross"');
        const grafik = await rendere(kopf());
        expect(grafik).toContain('data-bezug="typbild"');
        expect(grafik).toContain('data-graphic="metropole"');
    });

    it("eine Folge aus Ortsansicht und zwei Reisebildern hat drei Marken; das erste Bild bleibt die Ortsansicht", async () => {
        const html = await rendere(
            kopf({ images: [bild("a", { relation: "place_view" }), reisebild("b", "Alrik"), reisebild("c")] }),
        );
        expect(html.match(/data-testid="info-header-mark"/g)).toHaveLength(3);
        expect(html).toContain('data-bezug="ortsansicht"');
        expect(html).not.toContain('data-bezug="reisebild"');
    });
});
