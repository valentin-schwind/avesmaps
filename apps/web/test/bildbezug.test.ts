import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaPublicView, SubjectDetail } from "@avesmaps3d/shared";
import { setLocale, t } from "../src/i18n/i18n.ts";
import { istOrtsansicht, ortsansichten, plaketteFuer } from "../src/info-panel/bildbezug.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import type { HeaderImage, PanelModel } from "../src/info-panel/panel-types.ts";
import {
    env,
    gareth,
    gebiet,
    gipfel,
    huegel,
    kraftlinie,
    reichsstrasse,
    see,
    shown,
    waldwildnis,
} from "./panel-fixtures.ts";

/**
 * Der Bildbezug auf dem Kopfbild (Betreiber 2026-10-11, wörtlich „1A … 2 B … 3 A ja das gilt für alle“; Arbeitsanweisung
 * `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`). Wie es aussieht, wo es sitzt und was ein Klick tut, prüft
 * `e2e/info-panel-bildbezug.spec.ts` am Rechner und `.touch.spec.ts` am Telefon.
 *
 * Problemfälle: aus der Zahl der Bilder auf Ortsansicht schließen; ein fehlendes Feld als Ortsansicht nehmen; „Ortsansichten“ bei einer
 * Ortsansicht und einem Typbild; die Grafik der Art ohne Beschriftung oder als klickbar; ein Typbild klickbar.
 */

const bild = (id: string, relation?: "place_view" | "type_image"): HeaderImage => ({
    id,
    url: `/media/sha256/aa/bb/${id.padEnd(64, "0")}.webp`,
    width: 800,
    height: 450,
    ...(relation === undefined ? {} : { relation }),
});

afterEach(() => setLocale("de"));

describe("Die Beschriftung des sichtbaren Bildes", () => {
    it("🔴 eine Ortsansicht allein: „Ortsansicht“, klickbar", () => {
        const eins = bild("a", "place_view");
        expect(plaketteFuer(eins, [eins])).toEqual({
            bezug: "ortsansicht",
            text: "infoPanel.header.bildbezug.ortsansicht",
            klickbar: true,
        });
    });

    it("🔴 mehrere Ortsansichten (Gareth, Fasar): „Ortsansichten“ - die Zahl der ORTSANSICHTEN entscheidet", () => {
        const folge = ["a", "b", "c", "d", "e", "f", "g"].map((id) => bild(id, "place_view"));
        expect(plaketteFuer(folge[3], folge).text).toBe("infoPanel.header.bildbezug.ortsansichten");
        // Eine Ortsansicht neben einem Typbild ist Einzahl (falls der Server je eine gemischte Folge lieferte).
        const gemischt = [bild("a", "place_view"), bild("b", "type_image")];
        expect(plaketteFuer(gemischt[0], gemischt).text).toBe("infoPanel.header.bildbezug.ortsansicht");
        expect(plaketteFuer(gemischt[1], gemischt)).toMatchObject({ bezug: "typbild", klickbar: false });
    });

    it("🔴 ein Typbild und ein Bild OHNE Feld: „Typbild“, nicht klickbar - auch wenn es das einzige ist", () => {
        const geteilt = bild("a", "type_image");
        expect(plaketteFuer(geteilt, [geteilt])).toEqual({
            bezug: "typbild",
            text: "infoPanel.header.bildbezug.typbild",
            klickbar: false,
        });
        const ohne = bild("b");
        expect(plaketteFuer(ohne, [ohne, ohne])).toMatchObject({ bezug: "typbild", klickbar: false });
        expect(istOrtsansicht(ohne)).toBe(false);
    });

    it("🔴 die Grafik der Art (kein eigenes Bild) ist immer Typbild", () => {
        expect(plaketteFuer(undefined, [])).toMatchObject({ bezug: "typbild", klickbar: false });
    });

    it("die Bildansicht zeigt nur die Ortsansichten, in ihrer Reihenfolge", () => {
        const folge = [bild("a", "type_image"), bild("b", "place_view"), bild("c"), bild("d", "place_view")];
        expect(ortsansichten(folge).map((entry) => entry.id)).toEqual(["b", "d"]);
    });

    it("Wortlaut deutsch und englisch, ohne Anrede", () => {
        expect(
            [
                "infoPanel.header.bildbezug.ortsansicht",
                "infoPanel.header.bildbezug.ortsansichten",
                "infoPanel.header.bildbezug.typbild",
            ].map((key) => t(key as Parameters<typeof t>[0])),
        ).toEqual(["Ortsansicht", "Ortsansichten", "Typbild"]);
        setLocale("en");
        expect(
            [
                "infoPanel.header.bildbezug.ortsansicht",
                "infoPanel.header.bildbezug.ortsansichten",
                "infoPanel.header.bildbezug.typbild",
            ].map((key) => t(key as Parameters<typeof t>[0])),
        ).toEqual(["Place view", "Place views", "Type image"]);
    });
});

describe("Das Modell des Kopfes liest den Bildbezug des Servers", () => {
    const view = (id: string, role: "coat" | "header", relation?: "place_view" | "type_image"): MediaPublicView => ({
        id: `${id}0000000-0000-4000-8000-000000000000`.slice(0, 36),
        role,
        url: `/media/sha256/aa/bb/${"a".repeat(64)}.webp`,
        width: 800,
        height: 450,
        mimeType: "image/webp",
        ...(relation === undefined ? {} : { relation }),
    });
    const model = (detail: SubjectDetail): PanelModel => {
        const result = panelModelOf(shown(detail), null, env());
        if (result === undefined) throw new Error("kein Modell");
        return result;
    };

    it("🔴 das Feld des Servers wird übernommen, ein fehlendes wird Typbild, das Wappen trägt keins", () => {
        const m = model({
            ...gareth,
            media: {
                coat: view("c", "coat"),
                header: [view("1", "header", "place_view"), view("2", "header", "type_image"), view("3", "header")],
            },
        });
        expect(m.header.images.map((image) => image.relation)).toEqual(["place_view", "type_image", "type_image"]);
        expect(m.header.coat).not.toHaveProperty("relation");
    });

    it("🔴 3: jede Objektart ohne eigene Bilder zeigt ihre Grafik - und die ist Typbild", () => {
        for (const detail of [gareth, huegel, see, waldwildnis, gipfel, reichsstrasse, kraftlinie, gebiet]) {
            const m = model(detail);
            expect(m.header.images, detail.title ?? "").toEqual([]);
            expect(m.header.graphic, detail.title ?? "").toBeDefined();
            expect(plaketteFuer(m.header.images[0], m.header.images), detail.title ?? "").toMatchObject({
                bezug: "typbild",
                klickbar: false,
            });
        }
    });
});

describe("Das Bauteil hält sich an die Hausregeln", () => {
    const source = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "src", "info-panel", "info-header.vue"),
        "utf8",
    );

    it("🔴 unten rechts, nie oben; nur die Schrift des Typbilds ist durchsichtig, nie das Bild", () => {
        const rule = (selector: string): string => {
            const start = source.indexOf(`${selector} {`);
            expect(start, selector).toBeGreaterThanOrEqual(0);
            return source.slice(start, source.indexOf("}", start));
        };
        expect(rule(".info-header__bildbezug")).toMatch(/right:/);
        expect(rule(".info-header__bildbezug")).toMatch(/bottom:/);
        expect(rule(".info-header__bildbezug")).not.toMatch(/\btop:/);
        expect(rule(".info-header__bildbezug.is-typbild")).toMatch(/color: var\(--color-media-mark-muted\)/);
        expect(rule(".info-header__bildbezug.is-typbild")).toMatch(/text-shadow: var\(--shadow-media-label\)/);
        // Keine Deckkraft am Bild: `opacity` heißt im Haus „gesperrt“ (Guide §30.2), und das Bild bleibt unverändert.
        expect(rule(".info-header__img")).not.toMatch(/opacity/);
        expect(source).not.toMatch(/\.is-typbild[^{]*\.info-header__img/);
    });

    it("🔴 die Beschriftung nimmt keinen Klick, und ihr Text sitzt über `.avm-versalmitte` mittig (Guide §3.2)", () => {
        expect(source).toMatch(/\.info-header__bildbezug \{[^}]*pointer-events: none/);
        expect(source).toMatch(/info-header__bildbezug-text avm-versalmitte/);
        expect(source).not.toMatch(/text-box/);
    });

    it("🔴 der Zoom gilt nur der Ortsansicht, nur mit echtem Zeiger, und nie bei reduzierter Bewegung", () => {
        expect(source).toMatch(
            /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.info-header__media\.is-ortsansicht:hover \.info-header__img \{\s*transform: scale\(1\.025\);/,
        );
        expect(source).toMatch(
            /prefers-reduced-motion: reduce[\s\S]*\.info-header__media\.is-ortsansicht:hover \.info-header__img \{\s*transform: none;/,
        );
    });
});
