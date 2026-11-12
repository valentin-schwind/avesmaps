import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { de } from "../src/i18n/de.ts";
import { isMessageKey, ladeSpaeteTexte, t, type MessageKey } from "../src/i18n/i18n.ts";
import { istSpaeterText } from "../src/i18n/spaete-texte.ts";

/**
 * Der zweite Teil der deutschen Tafel (2026-11-01, WI-0235, Besucherpaket): Der Bau legt die Wörter der Verwaltung in einen eigenen Chunk (`vite.config.ts`, `deutscheTafelTeilen`). Hier die
 * Regel und das Netz; das echte Nachladen prüft die Rauchprobe gegen den Bau, denn der Entwicklungsserver und die Tests sehen die ganze Tafel.
 */
vi.mock("../src/i18n/de-spaet", () => ({ deSpaet: { "admin.probeSpaet": "Probe, nachgeladen" } }));

describe("Welche Schlüssel später kommen", () => {
    it("die Wörter der Verwaltung, der Medien, des Kanals und der Statistik", () => {
        for (const key of [
            "admin.people.title",
            "kanal.accept",
            "statistik.aktiv",
            "medien.abschnitt.dateien",
            "kartenvorschlag.senden",
            "kartenvorschlag.status.text.pending",
            "community.redaktion.titel",
            "community.mails.neu",
            "community.social.titel",
        ])
            expect(istSpaeterText(key), key).toBe(true);
    });

    it("🔴 was der Code im Start nennt, bleibt im Start: Schalter der Inhalte, Schritte des Release-Tests, Fenstertitel", () => {
        for (const key of [
            "admin.content.hiddenSince",
            "admin.umgebungen.releaseTest.schritt.browser",
            "medien.titel",
            "community.fehler.netz",
            "planner.toggle",
            // Die Einladung im Infopanel und „Fehlt eine?“ der Kartensammlung stehen im Start (WI-0275 Stufe C).
            "kartenvorschlag.leer.text",
            "kartenvorschlag.fehltEine",
        ])
            expect(istSpaeterText(key), key).toBe(false);
    });

    it("🔴 die Wörter der sieben Editoren kommen später: Nur Editoren sehen sie, und sie bekommen den Teil vor dem Einhängen (2026-11-08)", () => {
        for (const key of [
            "ortseditor.handgriff.grund.recht",
            "wegeditor.hierLaufen",
            "landschaftseditor.ecken.gespeichert",
            "gebietseditor.form.titel",
            "kraftlinieneditor.punkt",
            "spracheditor.titel",
            "wettereditor.titel",
            // Auch die Handgriffe am Wetter-Icon: Das Kartenmenü gibt es nur mit `use_editor_menu`.
            "wettereditor.griff.bearbeiten",
            "wettereditor.entfernen",
        ]) {
            expect(Object.hasOwn(de, key), key).toBe(true);
            expect(istSpaeterText(key), key).toBe(true);
        }
    });

    it("🔴 was Besucher lesen, bleibt im Start: Art und Region eines Wetter-Icons, Sperre im Auge, Planer, Infopanel", () => {
        for (const key of [
            "wetterSymbol.art.wind",
            "wetterSymbol.feld.region",
            "display.lock.weatherView",
            "planner.closure.reason.wetter",
            "infoPanel.untitled",
            "nav.editorpanel.wettereditor",
        ]) {
            expect(Object.hasOwn(de, key), key).toBe(true);
            expect(istSpaeterText(key), key).toBe(false);
        }
    });

    it("die Teilung greift wirklich und lässt den Start nicht leer", () => {
        const alle = Object.keys(de);
        const spaet = alle.filter(istSpaeterText);
        expect(spaet.length).toBeGreaterThan(6000);
        expect(alle.length - spaet.length).toBeGreaterThan(4000);
    });
});

describe("Das Netz: ein später Text, der noch nicht da ist", () => {
    it("🔴 `isMessageKey` und `t` holen ihn nach, danach steht er da", async () => {
        const key = "admin.probeSpaet";
        expect(isMessageKey(key)).toBe(false);
        expect(t(key as MessageKey)).toBe(key);
        await ladeSpaeteTexte();
        expect(isMessageKey(key)).toBe(true);
        expect(t(key as MessageKey)).toBe("Probe, nachgeladen");
        // Was schon da war, bleibt.
        expect(t("planner.toggle")).toBe("Routenplaner");
    });
});

describe("🔴 Beim Aufbau der Seite fragt niemand einen späten Text (2026-11-08)", () => {
    const app = readFileSync(new URL("../src/app.vue", import.meta.url), "utf8");

    it("app.vue ruft beim Aufbau kein `t()` mit einem späten Schlüssel: Es lüde den späten Teil für jeden Besucher", () => {
        const skript = /<script setup[^>]*>([\s\S]*?)<\/script>/u.exec(app)![1]!;
        const datei = ts.createSourceFile("app.ts", skript, ts.ScriptTarget.Latest, true);
        const spaet: string[] = [];
        const besuche = (knoten: ts.Node, inFunktion: boolean): void => {
            const funktion = inFunktion || ts.isFunctionLike(knoten);
            if (!funktion && ts.isCallExpression(knoten) && ts.isIdentifier(knoten.expression)) {
                const [schluessel] = knoten.arguments;
                if (knoten.expression.text === "t" && schluessel !== undefined && ts.isStringLiteralLike(schluessel))
                    if (istSpaeterText(schluessel.text)) spaet.push(schluessel.text);
            }
            ts.forEachChild(knoten, (kind) => besuche(kind, funktion));
        };
        besuche(datei, false);
        expect(spaet).toEqual([]);
    });

    it("das Fenster „Weg entfernen“ nennt geschlossen seinen Titel und hängt darum nur für Editoren ein", () => {
        expect(app).toMatch(/<WegEntfernenFenster\s+v-if="editorNav"/u);
    });
});
