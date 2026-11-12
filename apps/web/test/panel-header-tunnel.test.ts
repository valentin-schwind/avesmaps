import { describe, expect, it } from "vitest";
import type { SubjectDetail } from "@avesmaps3d/shared";
import { panelRules } from "../src/info-panel/panel-extras";
import { subtitleOf } from "../src/info-panel/panel-header";

/**
 * Tunnel im Infopanel (WI-0177, Migration 0172; wie „unterirdisch“ am Ort). Problemfälle: Das Merkmal fehlt bei einem Weg ohne Namen,
 * weil dessen Untertitel sonst leer bleibt; „mit Tunnel“ und „Tunnel“ verwechselt; ohne Merkmal ändert sich der Untertitel.
 */

const regeln = panelRules("approved");
const texte = (detail: SubjectDetail): string[] =>
    subtitleOf("path", detail, regeln).map((item) =>
        item.parts.map((part) => ("text" in part ? part.text : "")).join(""),
    );

const weg = (zusatz: Partial<SubjectDetail>): SubjectDetail =>
    ({ subject: { kind: "path", anchor: "a" }, revision: "r", ...zusatz }) as SubjectDetail;

describe("Tunnel im Untertitel eines Wegs", () => {
    it("🔴 hinter dem Wegtyp in Klammern; „mit Tunnel“, wenn nur ein Teil der Abschnitte; dahinter „kein Zugang querfeldein“", () => {
        expect(
            texte(weg({ title: "Tunnelweg", subtitle: [{ part: "type", key: "Strasse" }, { part: "tunnel" }] })),
        ).toEqual(["Straße (Tunnel)", "kein Zugang querfeldein"]);
        expect(
            texte(
                weg({
                    title: "Tunnelweg",
                    subtitle: [
                        { part: "type", key: "Strasse" },
                        { part: "tunnel", partial: true },
                    ],
                }),
            ),
        ).toEqual(["Straße (mit Tunnel)", "kein Zugang querfeldein"]);
    });

    it("🔴 ein Weg ohne Namen hat sonst keinen Untertitel: dort steht das Merkmal allein", () => {
        expect(texte(weg({ subtitle: [{ part: "type", key: "Pfad" }] }))).toEqual([]);
        expect(texte(weg({ subtitle: [{ part: "type", key: "Pfad" }, { part: "tunnel" }] }))).toEqual([
            "Tunnel",
            "kein Zugang querfeldein",
        ]);
    });

    it("ohne Merkmal bleibt der Untertitel wie bisher", () => {
        expect(texte(weg({ title: "Weg", subtitle: [{ part: "type", key: "Weg" }] }))).toEqual(["Weg"]);
    });
});
