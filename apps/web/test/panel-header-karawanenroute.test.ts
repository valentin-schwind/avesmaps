import { describe, expect, it } from "vitest";
import type { SubjectDetail } from "@avesmaps3d/shared";
import { panelRules } from "../src/info-panel/panel-extras";
import { subtitleOf } from "../src/info-panel/panel-header";

/**
 * Die Karawanenroute im Infopanel (WI-0177 §30, Migration 0174): ein Kennzeichen über dem Wegtyp, ohne eigene Reisewerte. Problemfälle:
 * Das Kennzeichen fehlt bei einer Route ohne echten Namen; die Wegtypen des Untergrunds stehen als eigene Teile statt „auf …“;
 * „teils“ und ganz verwechselt; Tunnel und Kennzeichen zusammen verlieren eines von beiden.
 */

const regeln = panelRules("approved");
const texte = (detail: SubjectDetail): string[] =>
    subtitleOf("path", detail, regeln).map((item) =>
        item.parts.map((part) => ("text" in part ? part.text : "")).join(""),
    );

const weg = (zusatz: Partial<SubjectDetail>): SubjectDetail =>
    ({ subject: { kind: "path", anchor: "a" }, revision: "r", ...zusatz }) as SubjectDetail;

describe("Karawanenroute im Untertitel eines Wegs", () => {
    it("🔴 das Kennzeichen vorn, der Untergrund dahinter als „auf …“, auch über mehrere Wegtypen", () => {
        expect(
            texte(
                weg({
                    title: "Keft–Rashdul",
                    subtitle: [
                        { part: "mark", key: "karawanenroute" },
                        { part: "type", key: "Pfad" },
                        { part: "type", key: "Wuestenpfad" },
                    ],
                }),
            ),
        ).toEqual(["Karawanenroute", "auf Pfad, Wüstenpfad"]);
    });

    it("🔴 „teils“, wenn nur ein Teil der Abschnitte; auch ohne echten Namen steht das Kennzeichen", () => {
        expect(
            texte(
                weg({
                    subtitle: [
                        { part: "mark", key: "karawanenroute", partial: true },
                        { part: "type", key: "Pfad" },
                    ],
                }),
            ),
        ).toEqual(["teils Karawanenroute", "auf Pfad"]);
    });

    it("🔴 mit Tunnel: der Tunnel am Wegtyp, der Satz dahinter", () => {
        expect(
            texte(
                weg({
                    title: "Durch den Berg",
                    subtitle: [
                        { part: "mark", key: "karawanenroute" },
                        { part: "type", key: "Gebirgspass" },
                        { part: "tunnel", partial: true },
                    ],
                }),
            ),
        ).toEqual(["Karawanenroute", "auf Gebirgspass (mit Tunnel)", "kein Zugang querfeldein"]);
    });
});
