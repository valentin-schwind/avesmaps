import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { createServer, type ViteDevServer } from "vite";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HeaderGraphic } from "@avesmaps3d/shared";
import type { HeaderModel } from "../src/info-panel/panel-types.ts";

/**
 * Der Kopf der Infobox mit Typbildpaaren (WI-0281, Betreiber 2026-11-05), gerendert wie auf der Seite (Vite, SSR): was an der Stelle der Grafik der Art steht, im
 * Normalmodus und im Modus „Ohne KI“, für jede Lage des Paars, zusammen mit Reisebildern und Typbildern eines Ortes, die Nennung an der Stelle von „Typbild“ und das ⚙
 * des Editors auf der grauen Fläche (Vali 2026-11-05: „wenn z.b. kein no-ki typbild existiert, no-ki aber an ist, dann is grau“).
 *
 * Abnahme des Betreibers: „Kleinstadt“ mit beiden Varianten zeigt im Normalmodus das KI-Typbild und mit „Ohne KI“ das Nicht-KI-Typbild. Dass ein schon offener Kopf
 * dem Umschalten folgt, prüft hier der zweite Lauf über DENSELBEN Zustand (`reisebilder.ohneKi`, ein Ref, den Kopf und Karte reaktiv lesen); den Klick prüft die
 * Sichtprüfung auf der Stage.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const KI = { url: "/media/sha256/aa/bb/kleinstadt-ki.webp", width: 1600, height: 900 };
const OHNE = { url: "/media/sha256/cc/dd/kleinstadt-ohne.webp", width: 1200, height: 675 };
const ORT = { id: "80558060-4299-54aa-b520-814b10819885", name: "Kleinbrück", subtype: "kleinstadt", x: 500, y: 500 };

const bild = (id: string, extra: Partial<HeaderModel["images"][number]> = {}): HeaderModel["images"][number] => ({
    id,
    url: `/media/sha256/ee/ff/${id.padEnd(64, "0")}.webp`,
    width: 800,
    height: 450,
    ...extra,
});
const kopf = (extra: Partial<HeaderModel> = {}): HeaderModel =>
    ({ title: "Kleinbrück", subtitle: [], graphic: "kleinstadt", images: [], ort: ORT, ...extra }) as HeaderModel;

describe("Der Kopf mit Typbildpaaren: Normalmodus und „Ohne KI“ (WI-0281)", () => {
    let server: ViteDevServer;
    let Kopf: Component;
    let viewer: typeof import("../src/viewer/bootstrap-viewer.ts");
    let quelle: typeof import("../src/info-panel/typbilder-quelle.ts");
    let zustand: typeof import("../src/photobox/reisebilder-zustand.ts");

    beforeAll(async () => {
        server = await createServer({
            root: repositoryRoot,
            configFile: false,
            logLevel: "silent",
            appType: "custom",
            cacheDir: join(repositoryRoot, "node_modules", ".vite-info-header-typbild-test"),
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
        quelle = (await server.ssrLoadModule("/apps/web/src/info-panel/typbilder-quelle.ts")) as typeof quelle;
        zustand = (await server.ssrLoadModule("/apps/web/src/photobox/reisebilder-zustand.ts")) as typeof zustand;
    }, 120_000);

    afterAll(async () => {
        await server.close();
    });

    afterEach(() => {
        zustand.reisebilder.ohneKi.value = false;
        quelle.setzeTypbilderFuerTest(undefined);
    });

    /** Die geladene Karte: `normal` wie `images` des Servers, `ohneKi` wie sein Feld `ohneKi`. */
    const karte = (
        normal: Partial<Record<HeaderGraphic, typeof KI>>,
        ohneKi: Partial<Record<HeaderGraphic, typeof KI>> | undefined,
    ): void => {
        quelle.setzeTypbilderFuerTest(
            new Map(Object.entries(normal) as [HeaderGraphic, typeof KI][]),
            ohneKi === undefined ? undefined : new Map(Object.entries(ohneKi) as [HeaderGraphic, typeof KI][]),
        );
    };
    const rendere = async (model: HeaderModel, rechte: string[] = []): Promise<string> => {
        const app = createSSRApp({ render: () => h(Kopf, { model, standard: true }) });
        app.provide(viewer.VIEWER_CONTEXT_KEY, { can: (name: string) => rechte.includes(name) } as never);
        return renderToString(app);
    };
    const quelleDesBildes = (html: string): string | undefined =>
        /<img[^>]*class="info-header__img"[^>]*src="([^"]*)"|<img[^>]*src="([^"]*)"[^>]*class="info-header__img"/
            .exec(html)
            ?.slice(1)
            .find((wert) => wert !== undefined);
    const platzhalter = (html: string): boolean => html.includes('data-testid="info-header-platzhalter"');
    const plakette = (html: string): boolean => html.includes('data-testid="info-header-bildbezug"');

    it("🔴 Kleinstadt mit beiden Varianten: KI im Normalmodus, das Nicht-KI-Typbild mit „Ohne KI“, und zurück", async () => {
        karte({ kleinstadt: KI }, { kleinstadt: OHNE });
        const normal = await rendere(kopf());
        expect(quelleDesBildes(normal)).toBe(KI.url);
        expect(plakette(normal)).toBe(true);
        zustand.reisebilder.ohneKi.value = true;
        const ohne = await rendere(kopf());
        expect(quelleDesBildes(ohne)).toBe(OHNE.url);
        expect(ohne).not.toContain(KI.url);
        // Die Beschriftung bleibt „Typbild“: Es wechselt nur die Datei.
        expect(ohne).toContain('data-bezug="typbild"');
        zustand.reisebilder.ohneKi.value = false;
        expect(quelleDesBildes(await rendere(kopf()))).toBe(KI.url);
    });

    it("🔴 nur KI: mit „Ohne KI“ bleibt die Fläche grau: kein Bild, kein Zeichen, keine Beschriftung", async () => {
        karte({ kleinstadt: KI }, {});
        zustand.reisebilder.ohneKi.value = true;
        const html = await rendere(kopf());
        expect(platzhalter(html)).toBe(true);
        // Die graue Fläche ist leer: kein Zeichen, kein Satz.
        expect(html).toMatch(/data-testid="info-header-platzhalter"[^>]*><\/div>/);
        expect(quelleDesBildes(html)).toBeUndefined();
        expect(html).not.toContain(KI.url);
        expect(html).not.toContain("/icons/header/");
        expect(plakette(html)).toBe(false);
    });

    it("🔴 keine Variante: im Normalmodus die eingebaute Grafik, mit „Ohne KI“ der Platzhalter, nie die eingebaute Grafik", async () => {
        karte({}, {});
        expect(quelleDesBildes(await rendere(kopf()))).toBe("/icons/header/kleinstadt.webp");
        zustand.reisebilder.ohneKi.value = true;
        const html = await rendere(kopf());
        expect(platzhalter(html)).toBe(true);
        expect(html).not.toContain("/icons/header/kleinstadt.webp");
    });

    it("nur ohne KI: beide Modi zeigen sie", async () => {
        karte({ kleinstadt: OHNE }, { kleinstadt: OHNE });
        expect(quelleDesBildes(await rendere(kopf()))).toBe(OHNE.url);
        zustand.reisebilder.ohneKi.value = true;
        expect(quelleDesBildes(await rendere(kopf()))).toBe(OHNE.url);
    });

    it("🔴 solange die Karte für „Ohne KI“ lädt, steht nur der Grund: weder ein KI-Bild noch schon der Platzhalter", async () => {
        zustand.reisebilder.ohneKi.value = true;
        const html = await rendere(kopf());
        expect(quelleDesBildes(html)).toBeUndefined();
        expect(platzhalter(html)).toBe(false);
        expect(html).not.toContain("/icons/header/");
    });

    it("🔴 Reisebilder und Typbilder zusammen: ein Reisebild ohne KI geht vor; KI-Reisebild und KI-Typbild des Ortes fallen, dann die Ohne-KI-Variante", async () => {
        karte({ kleinstadt: KI }, { kleinstadt: OHNE });
        zustand.reisebilder.ohneKi.value = true;
        const foto = bild("reise-foto", {
            relation: "reisebild",
            reisebild: { beschreibung: "Marktplatz", entstehung: "photo" },
        });
        const kiReise = bild("reise-ki", {
            relation: "reisebild",
            reisebild: { beschreibung: "Erträumt", entstehung: "ai_generated" },
        });
        const kiTypbild = bild("ort-typ-ki", { relation: "type_image", ki: true });
        // Das Reisebild ohne KI steht vorn, wie im Normalmodus die Vorrangregel sagt.
        expect(quelleDesBildes(await rendere(kopf({ images: [foto], typbilder: [kiTypbild] })))).toBe(foto.url);
        // Bleibt nur KI, fällt alles bis zur Ohne-KI-Variante der Kategorie.
        const html = await rendere(kopf({ images: [kiReise], typbilder: [kiTypbild] }));
        expect(quelleDesBildes(html)).toBe(OHNE.url);
        expect(html).not.toContain(kiReise.url);
        expect(html).not.toContain(kiTypbild.url);
        // Im Normalmodus bleibt alles beim Alten: das Reisebild vorn.
        zustand.reisebilder.ohneKi.value = false;
        expect(quelleDesBildes(await rendere(kopf({ images: [kiReise], typbilder: [kiTypbild] })))).toBe(kiReise.url);
    });

    it("🔴 ein Typbild des Ortes fällt mit „Ohne KI“ nur, wenn es als KI gekennzeichnet ist (Vali: „nur allergisch gegen die KI-generierten“)", async () => {
        karte({}, {});
        zustand.reisebilder.ohneKi.value = true;
        const unbekannt = bild("ort-typ-unbekannt", { relation: "type_image" });
        const ki = bild("ort-typ-ki", { relation: "type_image", ki: true });
        expect(quelleDesBildes(await rendere(kopf({ images: [unbekannt] })))).toBe(unbekannt.url);
        expect(platzhalter(await rendere(kopf({ images: [ki] })))).toBe(true);
    });

    it("🔴 die Nennung eines Typbilds steht, wo „Typbild“ steht, nicht darunter (Vali: „da nennen wo gerade Typbild steht“)", async () => {
        karte({}, { kleinstadt: { ...OHNE, credit: "Foto: Rahja, CC BY 4.0" } as typeof OHNE });
        zustand.reisebilder.ohneKi.value = true;
        const html = await rendere(kopf());
        expect(html).toContain("Typbild · Foto: Rahja, CC BY 4.0");
        expect(html).not.toContain('data-testid="info-header-credit"');
        // Ebenso ein Typbild des Ortes; eine Ortsansicht trägt ihre Nennung weiter unter dem Bild.
        zustand.reisebilder.ohneKi.value = false;
        const typ = bild("ort-typ", { relation: "type_image", credit: "Bild: Alrike, CC BY-SA 4.0" });
        expect(await rendere(kopf({ images: [typ] }))).toContain("Typbild · Bild: Alrike, CC BY-SA 4.0");
        const ansicht = bild("ort-ansicht", { relation: "place_view", credit: "Bild: Alrike, CC BY-SA 4.0" });
        const mitAnsicht = await rendere(kopf({ images: [ansicht] }));
        expect(mitAnsicht).toContain('data-testid="info-header-credit"');
        expect(mitAnsicht).not.toContain("Typbild · ");
    });

    it("🔴 das ⚙ des Editors steht auch auf der grauen Fläche und führt zum Typbild der Kategorie", async () => {
        karte({ kleinstadt: KI }, {});
        zustand.reisebilder.ohneKi.value = true;
        const html = await rendere(kopf(), ["view_media_private"]);
        expect(platzhalter(html)).toBe(true);
        expect(html).toContain('data-testid="info-medien-kopfbild"');
        expect(html).toContain("Typbild in der Medienverwaltung öffnen");
        expect(platzhalter(await rendere(kopf()))).toBe(true);
        expect(await rendere(kopf())).not.toContain('data-testid="info-medien-kopfbild"');
    });
});
