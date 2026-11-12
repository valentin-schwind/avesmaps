import { describe, expect, it } from "vitest";
import type { MediaLicenseInfo, MediaSubjectSlots } from "@avesmaps3d/shared";
import {
    befundeJeFeld,
    belegEingabe,
    freigabeSatzVorher,
    leererStand,
    pruefeFormular,
    zuFormular,
    type HochladeStand,
} from "../src/medien/medien-formular-modell.ts";
import { bindungAusPlaetzen } from "../src/medien/medien-operationen.ts";
import { wappenSatz, wappenUrteil } from "../src/medien/medien-wappen-pruefung.ts";

/**
 * Das gemeinsame Formular der Medienverwaltung (WI-0068 P4b, WI-0126 §11j): vom Stand zum Vertrag, die Prüfung vor dem Senden mit
 * derselben Funktion wie der Server, der Satz der Policy und die Bindung aus den Plätzen.
 */

const LIZENZEN: MediaLicenseInfo[] = [
    {
        key: "cc-by-4.0",
        displayName: "CC BY 4.0",
        uri: "https://creativecommons.org/licenses/by/4.0/",
        family: "cc",
        requiresAttribution: true,
    },
    {
        key: "cc0-1.0",
        displayName: "CC0 1.0",
        uri: "https://creativecommons.org/publicdomain/zero/1.0/",
        family: "cc",
        requiresAttribution: false,
    },
];
const BILD = { sizeBytes: 120_000, type: "image/png" };
const ORT = "0b7d7c43-6d7e-4f55-9a35-2a3f0d1e9b11";

function stand(aenderung: (s: HochladeStand) => void): HochladeStand {
    const s = leererStand("Wappen von Gareth");
    aenderung(s);
    return s;
}

describe("vom Stand zum Vertrag", () => {
    it("7b: der unveränderte Name nach der Regel geht als „aus der Bindung“ hinaus, ein geänderter als Name", () => {
        const fertig = (titel: string) =>
            stand((s) => {
                s.titel = titel;
                s.rechte.grundlage = "own_work";
            });
        const unveraendert = zuFormular(
            fertig("Wappen von Gareth, Stadt"),
            "coat",
            undefined,
            "Wappen von Gareth, Stadt",
        );
        expect(unveraendert).toMatchObject({ title: "", titleFromBinding: true });
        const geaendert = zuFormular(fertig("Gareths Löwe"), "coat", undefined, "Wappen von Gareth, Stadt");
        expect(geaendert?.title).toBe("Gareths Löwe");
        expect(geaendert?.titleFromBinding).toBeUndefined();
        // Ohne Vorschlag (Hochladen im Medienfenster ohne Bindung) bleibt alles, wie es war.
        expect(zuFormular(fertig("Wappen von Gareth, Stadt"), "coat")?.titleFromBinding).toBeUndefined();
    });

    it("sendet nicht, was nicht zu sehen ist: Prompt nur bei KI, Lizenz nur bei „Lizenz“, Beleg nur mit den Feldern seiner Art", () => {
        const form = zuFormular(
            stand((s) => {
                s.entstehung.art = "drawing";
                s.entstehung.prompt = "ein Löwe";
                s.rechte.grundlage = "own_work";
                s.rechte.lizenz = "cc-by-4.0";
                s.rechte.urheber = "  Hesindiane ";
                s.beleg = { art: "source_page", text: "", adresse: "https://example.org/x", datei: undefined };
            }),
            "coat",
        );
        expect(form?.creation).toBeUndefined();
        expect(form?.rights).toEqual({
            basis: "own_work",
            licenseKey: null,
            creator: "Hesindiane",
            rightsHolder: null,
            attribution: null,
            rightsNote: null,
        });
        expect(form?.evidence).toEqual({ kind: "source_page", url: "https://example.org/x" });
        expect(form?.creationMethod).toBe("drawing");
    });

    it("hängt die Belegdatei nur bei Mail, PDF und Dokument an, nie bei einer Notiz", () => {
        const datei = new File(["x"], "mail.txt", { type: "text/plain" });
        expect(belegEingabe({ art: "email", text: "", adresse: "", datei })?.file).toBeDefined();
        expect(belegEingabe({ art: "operator_note", text: "Erlaubt", adresse: "https://x", datei })).toEqual({
            kind: "operator_note",
            text: "Erlaubt",
        });
    });

    it("hat ohne Grundlage keinen Vertrag", () => {
        expect(zuFormular(leererStand("x"), "coat")).toBeUndefined();
    });

    it("🔴 der Haken „Rechte geprüft“ geht mit (WI-0282), nur nicht bei unbekannter Grundlage", () => {
        const mit = (grundlage: "public_domain" | "unknown", freigeben: boolean) => {
            const stand = leererStand("Küste", freigeben);
            stand.rechte.grundlage = grundlage;
            return zuFormular(stand, "header");
        };
        expect(mit("public_domain", true)?.rightsReviewed).toBe(true);
        expect(mit("public_domain", false)?.rightsReviewed).toBeUndefined();
        expect(mit("unknown", true)?.rightsReviewed).toBeUndefined();
    });
});

describe("Prüfung vor dem Senden (dieselbe wie auf dem Server)", () => {
    it("🔴 ein Typbild ohne KI verlangt eine Entstehung ohne KI (WI-0281): die Vorgabe „unbekannt“ ist ein Befund, Foto, Zeichnung, Scan nicht", () => {
        const ohneKi = ["photo", "drawing", "scan"] as const;
        const mit = (art: HochladeStand["entstehung"]["art"]) =>
            pruefeFormular(
                stand((s) => {
                    s.rechte.grundlage = "own_work";
                    s.entstehung.art = art;
                }),
                "header",
                { lizenzen: LIZENZEN, datei: BILD, entstehungen: ohneKi },
            );
        expect(mit("unknown")).toEqual([{ path: "creationMethod", rule: "not_allowed" }]);
        expect(mit("ai_generated")).toEqual([{ path: "creationMethod", rule: "not_allowed" }]);
        expect(mit("drawing")).toEqual([]);
        // Ohne Vorgabe der Entstehungen bleibt alles, wie es war.
        expect(
            pruefeFormular(
                stand((s) => {
                    s.rechte.grundlage = "own_work";
                }),
                "header",
                { lizenzen: LIZENZEN, datei: BILD },
            ),
        ).toEqual([]);
    });

    it("verlangt Datei, Grundlage und Namen", () => {
        const befunde = pruefeFormular(leererStand(""), "coat", { lizenzen: LIZENZEN, datei: undefined });
        expect(befunde.map((b) => b.path).sort()).toEqual(["file", "rights.basis", "title"]);
    });

    it("verlangt bei CC BY die Namensnennung und bei der Lizenz einen Schlüssel aus dem Katalog", () => {
        const ohneNennung = pruefeFormular(
            stand((s) => {
                s.rechte.grundlage = "license";
                s.rechte.lizenz = "cc-by-4.0";
            }),
            "header",
            { lizenzen: LIZENZEN, datei: BILD },
        );
        expect(ohneNennung).toEqual([{ path: "rights.attribution", rule: "required_by_license" }]);
        const ohneLizenz = pruefeFormular(
            stand((s) => {
                s.rechte.grundlage = "license";
            }),
            "header",
            { lizenzen: LIZENZEN, datei: BILD },
        );
        expect(ohneLizenz).toEqual([{ path: "rights.licenseKey", rule: "required" }]);
    });

    it("weist Typ und Größe vorab ab: SVG über 512 KB, ein fremder Typ, eine zu große Belegdatei", () => {
        const s = stand((x) => {
            x.rechte.grundlage = "unknown";
            x.beleg = {
                art: "pdf",
                text: "",
                adresse: "",
                datei: new File([new Uint8Array(7 * 1024 * 1024)], "brief.exe", { type: "application/x-msdownload" }),
            };
        });
        const befunde = pruefeFormular(s, "coat", {
            lizenzen: LIZENZEN,
            datei: { sizeBytes: 600 * 1024, type: "image/svg+xml" },
        });
        expect(befunde).toContainEqual({ path: "file", rule: "too_large" });
        expect(befunde).toContainEqual({ path: "evidence.file", rule: "unsupported_type" });
        expect(befunde).toContainEqual({ path: "evidence.file", rule: "too_large" });
        expect(
            pruefeFormular(s, "coat", { lizenzen: LIZENZEN, datei: { sizeBytes: 10, type: "image/bmp" } }),
        ).toContainEqual({
            path: "file",
            rule: "unsupported_type",
        });
    });

    it("ist leer, wenn alles passt: Grundlage „unbekannt“ ist erlaubt (wird nie öffentlich)", () => {
        expect(
            pruefeFormular(
                stand((s) => {
                    s.rechte.grundlage = "unknown";
                }),
                "coat",
                { lizenzen: LIZENZEN, datei: BILD },
            ),
        ).toEqual([]);
    });

    it("sagt je Feld genau einen Satz, nie den eingegebenen Wert", () => {
        const je = befundeJeFeld([
            { path: "rights.licenseKey", rule: "required" },
            { path: "rights.licenseKey", rule: "unknown_license" },
            { path: "file", rule: "too_large" },
        ]);
        expect(je.get("rights.licenseKey")).toBe("Fehlt noch.");
        expect(je.get("file")).toContain("6 MB");
        expect(je.size).toBe(2);
    });
});

describe("der Satz unter dem Formular kommt aus der Policy", () => {
    it("fragt erst nach der Grundlage, dann nach der Antwort des Servers", () => {
        expect(freigabeSatzVorher("", undefined, "Wappen", "Gareth").text).toContain("Rechtsgrundlage");
        expect(freigabeSatzVorher("own_work", undefined, "Wappen", "Gareth").ton).toBe("neutral");
    });

    it("nennt öffentlich mit Rolle und Ort, privat mit dem Grund der Policy", () => {
        expect(freigabeSatzVorher("own_work", { public: true, reason: "rule" }, "Wappen", "Gareth").text).toBe(
            "Nach dem Hochladen öffentlich als Wappen von Gareth.",
        );
        const privat = freigabeSatzVorher(
            "own_work",
            { public: false, reason: "clearance_pending" },
            "Wappen",
            "Gareth",
        );
        expect(privat.ton).toBe("warnung");
        expect(privat.text).toContain("die Rechteprüfung ist offen");
        expect(
            freigabeSatzVorher("unknown", { public: false, reason: "rights_unknown" }, "Titelbild", undefined).text,
        ).toContain("Nur Editoren");
    });
});

describe("Bindung aus den Plätzen (die EINE Stelle für baseRevision und baseState)", () => {
    function plaetze(coat: MediaSubjectSlots["coat"], galerie?: number): MediaSubjectSlots {
        return {
            subject: { kind: "place", id: ORT, name: "Gareth", active: true },
            coat,
            header: {
                gallery: galerie === undefined ? null : { id: ORT, revision: galerie, origin: "editor" },
                items: [],
                max: 10,
                suppressed: false,
            },
        };
    }

    it("ersetzt ein gesetztes Wappen mit der Revision der Bindung, sonst mit dem gesehenen Zustand", () => {
        expect(
            bindungAusPlaetzen(plaetze({ state: "set", origin: "legacy", revision: 4, asset: null }), "coat"),
        ).toEqual({
            rolle: "coat",
            subject: { kind: "place", id: ORT },
            baseRevision: 4,
        });
        expect(
            bindungAusPlaetzen(plaetze({ state: "none", origin: "editor", revision: null, asset: null }), "coat"),
        ).toEqual({
            rolle: "coat",
            subject: { kind: "place", id: ORT },
            baseState: "none",
        });
    });

    it("das Titelbild (WI-0219): ohne eins der gesehene Zustand, mit einer Galerie deren Revision", () => {
        const ohne = plaetze({ state: "undecided", origin: null, revision: null, asset: null });
        expect(bindungAusPlaetzen(ohne, "header")).toEqual({ rolle: "header", placeId: ORT, baseState: "undecided" });
        expect(bindungAusPlaetzen(plaetze(ohne.coat, 3), "header")).toEqual({
            rolle: "header",
            placeId: ORT,
            galleryRevision: 3,
        });
    });
});

describe("Vorprüfung eines Wappens (Betreiber 2026-10-10)", () => {
    const masse = (breite: number, hoehe: number, ecken: number[] | null = [0, 0, 0, 0], svg = false) => ({
        breite,
        hoehe,
        svg,
        ecken,
    });

    it("🔴 misst die LANGE Seite: 90 × 128 geht und wird auf 128 × 128 aufgefüllt, 127 × 100 ist zu klein", () => {
        expect(wappenUrteil(masse(90, 128))).toEqual({ auffuellenAuf: 128 });
        expect(wappenUrteil(masse(127, 100))).toEqual({ ablehnung: "coat_too_small" });
        expect(wappenSatz(wappenUrteil(masse(127, 100)), masse(127, 100))).toContain("127");
    });

    it("undurchsichtige Ecken weisen ab, ein quadratisches durchsichtiges Wappen braucht keinen Satz, ein SVG ist von der Größe ausgenommen", () => {
        expect(wappenUrteil(masse(200, 200, [0, 0, 255, 0]))).toEqual({ ablehnung: "coat_not_transparent" });
        expect(wappenUrteil(masse(200, 200))).toEqual({});
        expect(wappenSatz({}, masse(200, 200))).toBeUndefined();
        expect(wappenUrteil(masse(0, 0, null, true))).toEqual({});
        expect(wappenSatz({ auffuellenAuf: 160 }, masse(120, 160))).toContain("160 × 160");
    });
});
