import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    CONTENT_SWITCHES,
    MAM_BASKETS,
    MAM_EINREICHUNGEN,
    MEDIA_PRIVATE_FIELDS,
    MamAssetSummary,
    MamNavigation,
    MamSearchQuery,
    MediaAssetDetail,
    MEDIA_ASSET_TYPE_ROLES,
    MEDIA_BINDABLE_ROLES,
    MEDIA_CREATION_METHODS,
    MEDIA_ROLES,
    MEDIA_ROLE_SWITCH,
    MEDIA_UPLOAD_ROLES,
    MediaUploadForm,
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_CREATION_METHOD,
    PHOTOBOX_EINREICHEN_SCHALTER,
    PHOTOBOX_GRENZEN,
    MEDIA_EDITOR_URL,
    PHOTOBOX_LIMITS,
    PHOTOBOX_NACHRICHT_MAX,
    PHOTOBOX_REDAKTION_AKTIONEN,
    PHOTOBOX_REFERENCE_KINDS,
    PHOTOBOX_RIGHTS,
    PHOTOBOX_SUBMISSION_STATES,
    PHOTOBOX_TERMS_VERSION,
    PHOTOBOX_URL,
    PHOTOBOX_USAGE_GRANTS,
    PhotoboxBeschreibung,
    PhotoboxBildErsetzen,
    PhotoboxEingegangen,
    PhotoboxEinreichung,
    PhotoboxNutzung,
    PhotoboxOffline,
    PhotoboxRedaktionAblehnen,
    PhotoboxRedaktionFreigeben,
    PhotoboxRedaktionKorrigieren,
    PhotoboxRedaktionOffline,
    PhotoboxRedaktionRueckfrage,
    PhotoboxStand,
    PhotoboxStatus,
    PhotoboxStatusBody,
    PhotoboxSubmissionView,
    PhotoboxZurueckziehen,
    REISEBILD_STATUS_PFAD,
    STATUS_SCHLUESSEL_MUSTER,
    assetTypeForRole,
    mediaPhotoboxUrl,
    photoboxAktionErlaubt,
    photoboxGrantAllowed,
    photoboxUnterteilung,
    type PhotoboxAktion,
    type PhotoboxSubmissionState,
} from "../src/index.ts";

describe("Reisebild-Einreichung: Verträge (WI-0272 §12, S1)", () => {
    it("🔴 Avesmaps-Aufnahmen gibt es nur für Avesmaps", () => {
        expect(photoboxGrantAllowed("avesmaps_capture", "cc-by-4.0")).toBe(false);
        expect(photoboxGrantAllowed("avesmaps_capture", "avesmaps_only")).toBe(true);
        for (const kind of ["drawing", "photo", "ai_generated"] as const) {
            expect(photoboxGrantAllowed(kind, "cc-by-4.0")).toBe(true);
            expect(photoboxGrantAllowed(kind, "avesmaps_only")).toBe(true);
        }
    });

    it("jede Entstehung hat eine Entstehung des Medienkerns", () => {
        for (const kind of PHOTOBOX_CREATION_KINDS)
            expect(MEDIA_CREATION_METHODS).toContain(PHOTOBOX_CREATION_METHOD[kind]);
        expect(PHOTOBOX_CREATION_METHOD.avesmaps_capture).toBe("derived");
        expect(PHOTOBOX_CREATION_METHOD.drawing).toBe("drawing");
        expect(PHOTOBOX_CREATION_METHOD.photo).toBe("photo");
        expect(PHOTOBOX_CREATION_METHOD.ai_generated).toBe("ai_generated");
    });

    it("die Lizenzwahl führt auf Rechtsgrundlage und Katalogschlüssel", () => {
        expect(PHOTOBOX_RIGHTS["avesmaps_only"]).toEqual({ basis: "permission", licenseKey: null });
        expect(PHOTOBOX_RIGHTS["cc-by-4.0"]).toEqual({ basis: "license", licenseKey: "cc-by-4.0" });
        expect([...PHOTOBOX_USAGE_GRANTS]).toEqual(["avesmaps_only", "cc-by-4.0"]);
    });

    it("Bezugsarten sind die Arten der Suche", () => {
        expect([...PHOTOBOX_REFERENCE_KINDS].sort()).toEqual(["klima", "landschaft", "ort", "weg"]);
    });

    it("die Zustände und Grenzen stehen wörtlich wie im Arbeitspaket", () => {
        expect([...PHOTOBOX_SUBMISSION_STATES]).toEqual([
            "incoming",
            "technical_failed",
            "pending",
            "changes_requested",
            "approved",
            "rejected",
            "withdrawn",
            "offline",
            "expired",
            "purged",
        ]);
        expect([...PHOTOBOX_CREATION_KINDS]).toEqual(["drawing", "photo", "ai_generated", "avesmaps_capture"]);
        expect(PHOTOBOX_LIMITS).toEqual({ descriptionMax: 300, attributionMax: 80, viewDirections: 8 });
    });
});

describe("Medienrolle photobox (WI-0272, S1)", () => {
    it("🔴 photobox ist eine Rolle, aber weder bindbar noch über den Asset-Typ wählbar", () => {
        expect(MEDIA_ROLES).toContain("photobox");
        expect(MEDIA_BINDABLE_ROLES).not.toContain("photobox");
        for (const roles of Object.values(MEDIA_ASSET_TYPE_ROLES)) expect(roles).not.toContain("photobox");
    });
});

describe("Hochladbare Rollen (WI-0272, S1)", () => {
    it("🔴 MEDIA_UPLOAD_ROLES sind genau die Rollen mit Asset-Typ: jede hat einen, photobox gehört nicht dazu", () => {
        const typed = MEDIA_ROLES.filter((role) =>
            Object.values(MEDIA_ASSET_TYPE_ROLES).some((roles) => roles.includes(role)),
        );
        expect([...MEDIA_UPLOAD_ROLES]).toEqual(typed);
        expect(MEDIA_UPLOAD_ROLES).not.toContain("photobox");
        for (const role of MEDIA_UPLOAD_ROLES) expect(() => assetTypeForRole(role), role).not.toThrow();
        // Die Rolle ohne Typ hat keinen Weg in einen Asset-Typ; `assetTypeForRole` wirft statt zu raten.
        expect(() => assetTypeForRole("photobox")).toThrow(/photobox/u);
        // Nichts, was binden darf, fehlt im Upload.
        for (const role of MEDIA_BINDABLE_ROLES) expect(MEDIA_UPLOAD_ROLES).toContain(role);
    });

    it("🔴 das Formular des Hochladens nimmt photobox nicht an (Schemaprüfung), die Rollen mit Typ schon", () => {
        const role = MediaUploadForm.properties.role;
        expect(Value.Check(role, "photobox")).toBe(false);
        for (const upload of MEDIA_UPLOAD_ROLES) expect(Value.Check(role, upload), upload).toBe(true);
        const form = { title: "Reisebild", creationMethod: "photo", rights: { basis: "own_work", creator: "Alrik" } };
        expect(Value.Check(MediaUploadForm, { ...form, role: "photobox" })).toBe(false);
        expect(Value.Check(MediaUploadForm, { ...form, role: "header" })).toBe(true);
    });
});

describe("Inhaltsschalter Reisebilder (WI-0272, S1)", () => {
    it("🔴 jede Rolle hat einen Rollenschalter, und der steht im Katalog mit Fehlerrichtung closed", () => {
        for (const role of MEDIA_ROLES) {
            const key = MEDIA_ROLE_SWITCH[role];
            expect(key, role).toBeDefined();
            expect(
                CONTENT_SWITCHES.find((entry) => entry.key === key),
                role,
            ).toMatchObject({
                group: "media_role",
                failure: "closed",
            });
        }
        expect(MEDIA_ROLE_SWITCH["photobox"]).toBe("media.role.photobox");
    });
});

describe("Reisebild-Einreichung: Verträge der öffentlichen Routen (WI-0272 S2)", () => {
    const schluessel = "k".repeat(43);
    const operationId = "6d656469-0000-4000-8000-000000000001";
    const bild = { name: "hafen.jpg", dataBase64: "QUJDRA==" };
    const einreichung = {
        operationId,
        schluessel,
        bild,
        lage: { x: 300, y: 300 },
        entstehung: "photo",
        nutzung: "avesmaps_only",
        beschreibung: "Der Blick vom Hafen auf die Prem-Brücke",
        bedingungen: PHOTOBOX_TERMS_VERSION,
        falle: { feld: "", dauerMs: 4200 },
    };

    it("die Adressen, die Fassung der Bedingungen und die Grenzen stehen wörtlich wie im Feinplan", () => {
        expect(PHOTOBOX_URL).toBe("/api/photobox");
        expect(REISEBILD_STATUS_PFAD).toBe("/reisebild");
        expect(PHOTOBOX_TERMS_VERSION).toBe("reisebilder-2026-11-04");
        expect(PHOTOBOX_GRENZEN).toEqual({
            mindestDauerMs: 3000,
            jeAdresseJeStunde: 6,
            jeTag: 200,
            statusJeStunde: 20,
            statusLesenJeStunde: 120,
            rumpfBytes: 9 * 1024 * 1024,
            ersetzungenJeEinreichung: 5,
        });
    });

    it("eine gültige Einreichung, mit und ohne die freiwilligen Angaben, wird angenommen", () => {
        expect(Value.Check(PhotoboxEinreichung, einreichung)).toBe(true);
        expect(
            Value.Check(PhotoboxEinreichung, {
                ...einreichung,
                placeId: "6d656469-0000-4000-8000-000000000002",
                bezug: { art: "weg", id: "name:Reichsstraße" },
                blickrichtung: 7,
                name: "Rondrikan",
                entstehung: "avesmaps_capture",
            }),
        ).toBe(true);
    });

    it("🔴 die Fassung der Bedingungen muss die heutige sein; eine andere weist das Schema ab", () => {
        for (const bedingungen of [
            "reisebilder-2026-10-30",
            "",
            `${PHOTOBOX_TERMS_VERSION} `,
            PHOTOBOX_TERMS_VERSION.toUpperCase(),
        ]) {
            expect(Value.Check(PhotoboxEinreichung, { ...einreichung, bedingungen }), bedingungen).toBe(false);
        }
        const ohne = Object.fromEntries(Object.entries(einreichung).filter(([feld]) => feld !== "bedingungen"));
        expect(Value.Check(PhotoboxEinreichung, ohne)).toBe(false);
    });

    it("Blickrichtung: nur ganze Zahlen von 0 bis 7 (acht Himmelsrichtungen)", () => {
        for (const blickrichtung of [0, 1, 7]) {
            expect(Value.Check(PhotoboxEinreichung, { ...einreichung, blickrichtung }), String(blickrichtung)).toBe(
                true,
            );
        }
        for (const blickrichtung of [8, -1, 1.5, "3"]) {
            expect(Value.Check(PhotoboxEinreichung, { ...einreichung, blickrichtung }), String(blickrichtung)).toBe(
                false,
            );
        }
        expect(PHOTOBOX_LIMITS.viewDirections).toBe(8);
    });

    it("Entstehung, Lizenzwahl, Bezug, Stelle und Schlüssel: nur gültige Werte; unbekannte Felder nicht", () => {
        for (const entstehung of PHOTOBOX_CREATION_KINDS) {
            expect(Value.Check(PhotoboxEinreichung, { ...einreichung, entstehung }), entstehung).toBe(true);
        }
        for (const nutzung of PHOTOBOX_USAGE_GRANTS) {
            expect(Value.Check(PhotoboxEinreichung, { ...einreichung, nutzung }), nutzung).toBe(true);
        }
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, entstehung: "scan" })).toBe(false);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, nutzung: "cc0" })).toBe(false);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, bezug: { art: "stadt", id: "x" } })).toBe(false);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, placeId: "kein-uuid" })).toBe(false);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, lage: { x: 1e9, y: 0 } })).toBe(false);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, schluessel: "kurz" })).toBe(false);
        expect(new RegExp(STATUS_SCHLUESSEL_MUSTER, "u").test(schluessel)).toBe(true);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, zusatz: 1 })).toBe(false);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, falle: { feld: "x" } })).toBe(false);
    });

    it("Beschreibung 1 bis 300 Zeichen und nicht leer, Name höchstens 80; die Bildangabe hat Namen und Bytes", () => {
        const { descriptionMax, attributionMax } = PHOTOBOX_LIMITS;
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, beschreibung: "ä".repeat(descriptionMax) })).toBe(
            true,
        );
        for (const beschreibung of ["ä".repeat(descriptionMax + 1), "", "   "]) {
            expect(
                Value.Check(PhotoboxEinreichung, { ...einreichung, beschreibung }),
                `${String(beschreibung.length)} Zeichen`,
            ).toBe(false);
        }
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, name: "n".repeat(attributionMax) })).toBe(true);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, name: "n".repeat(attributionMax + 1) })).toBe(false);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, name: "  " })).toBe(false);
        expect(Value.Check(PhotoboxEinreichung, { ...einreichung, bild: { name: "a.jpg" } })).toBe(false);
        expect(
            Value.Check(PhotoboxEinreichung, { ...einreichung, bild: { name: "a/b.jpg", dataBase64: "QUJDRA==" } }),
        ).toBe(false);
        expect(
            Value.Check(PhotoboxEinreichung, { ...einreichung, bild: { ...bild, dataBase64: "kein base64!" } }),
        ).toBe(false);
    });

    it("Status und Aktionen tragen den Schlüssel im Rumpf; jede Aktion ihre Operation", () => {
        expect(Value.Check(PhotoboxStatusBody, { schluessel })).toBe(true);
        expect(Value.Check(PhotoboxStatusBody, { schluessel: "kurz" })).toBe(false);
        expect(Value.Check(PhotoboxStatusBody, { schluessel, zusatz: 1 })).toBe(false);
        const basis = { schluessel, operationId };
        expect(Value.Check(PhotoboxBeschreibung, { ...basis, beschreibung: "Neu gesehen" })).toBe(true);
        expect(Value.Check(PhotoboxBeschreibung, { ...basis, beschreibung: "  " })).toBe(false);
        expect(Value.Check(PhotoboxBeschreibung, { ...basis, beschreibung: "x".repeat(301) })).toBe(false);
        expect(Value.Check(PhotoboxBildErsetzen, { ...basis, bild })).toBe(true);
        expect(Value.Check(PhotoboxBildErsetzen, basis)).toBe(false);
        expect(Value.Check(PhotoboxNutzung, { ...basis, nutzung: "cc-by-4.0" })).toBe(true);
        expect(Value.Check(PhotoboxNutzung, { ...basis, nutzung: "alles" })).toBe(false);
        expect(Value.Check(PhotoboxZurueckziehen, basis)).toBe(true);
        expect(Value.Check(PhotoboxOffline, basis)).toBe(true);
        for (const schema of [PhotoboxZurueckziehen, PhotoboxOffline]) {
            expect(Value.Check(schema, { schluessel })).toBe(false);
            expect(Value.Check(schema, { ...basis, zusatz: 1 })).toBe(false);
        }
    });

    it("die Antwort der Statusseite: Pflichtfelder, freiwillige Felder, kein fremdes Feld", () => {
        const status = {
            zustand: "approved",
            eingereichtAm: "2026-10-31T12:00:00.000Z",
            beschreibung: "Der Blick vom Hafen",
            entstehung: "photo",
            nutzung: "avesmaps_only",
            lage: { x: 300, y: 300 },
            vorschauBereit: true,
            angepasst: false,
        };
        expect(Value.Check(PhotoboxStatus, status)).toBe(true);
        expect(
            Value.Check(PhotoboxStatus, {
                ...status,
                wartendeBeschreibung: "Neu",
                nachricht: "Bitte kürzen",
                blickrichtung: 3,
                name: "Rondrikan",
                ortName: "Havena",
            }),
        ).toBe(true);
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            expect(Value.Check(PhotoboxStatus, { ...status, zustand }), zustand).toBe(true);
        }
        // `vorschauGesperrt` (Quarantäne) wird nur als wahr gesendet.
        expect(Value.Check(PhotoboxStatus, { ...status, vorschauBereit: false, vorschauGesperrt: true })).toBe(true);
        expect(Value.Check(PhotoboxStatus, { ...status, vorschauGesperrt: false })).toBe(false);
        expect(Value.Check(PhotoboxStatus, { ...status, zustand: "entschieden" })).toBe(false);
        expect(Value.Check(PhotoboxStatus, { ...status, statusKeyHash: "x" })).toBe(false);
        const ohne = Object.fromEntries(Object.entries(status).filter(([feld]) => feld !== "angepasst"));
        expect(Value.Check(PhotoboxStatus, ohne)).toBe(false);
    });

    /** Die Tafel der erlaubten Aktionen je Zustand; als `Record` über die Zustände: ein neuer Zustand ohne Zeile bricht schon den Typcheck. */
    const ERLAUBT: Readonly<Record<PhotoboxSubmissionState, readonly PhotoboxAktion[]>> = {
        incoming: ["beschreibung", "bild", "zurueckziehen", "nutzung"],
        // Eine kaputte Einreichung hängt sonst 60 Tage bis zum Verfall: Der Einreicher darf sie zurückziehen oder ein anderes Bild schicken (S3).
        technical_failed: ["bild", "zurueckziehen"],
        pending: ["beschreibung", "bild", "zurueckziehen", "nutzung"],
        changes_requested: ["beschreibung", "bild", "zurueckziehen", "nutzung"],
        approved: ["beschreibung", "offline", "nutzung"],
        rejected: [],
        withdrawn: [],
        offline: [],
        expired: [],
        purged: [],
    };
    const AKTIONEN: readonly PhotoboxAktion[] = ["beschreibung", "bild", "zurueckziehen", "offline", "nutzung"];

    it("🔴 die Erlaubnistafel: je Zustand genau diese Aktionen, über ALLE Zustände", () => {
        expect(Object.keys(ERLAUBT).sort()).toEqual([...PHOTOBOX_SUBMISSION_STATES].sort());
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            for (const aktion of AKTIONEN) {
                expect(photoboxAktionErlaubt(zustand, aktion), `${zustand} / ${aktion}`).toBe(
                    ERLAUBT[zustand].includes(aktion),
                );
            }
        }
    });

    it("🔴 nach der Freigabe geht die Lizenzwahl nur noch zu cc-by-4.0, davor in beide Richtungen", () => {
        expect(photoboxAktionErlaubt("approved", "nutzung", "cc-by-4.0")).toBe(true);
        expect(photoboxAktionErlaubt("approved", "nutzung", "avesmaps_only")).toBe(false);
        // Ohne Ziel fragt die Oberfläche nur, ob die Wahl noch offen ist.
        expect(photoboxAktionErlaubt("approved", "nutzung")).toBe(true);
        for (const zustand of ["incoming", "pending", "changes_requested"] as const) {
            for (const ziel of PHOTOBOX_USAGE_GRANTS) {
                expect(photoboxAktionErlaubt(zustand, "nutzung", ziel), `${zustand} -> ${ziel}`).toBe(true);
            }
        }
        // Das Ziel öffnet keine Aktion, die der Zustand nicht erlaubt.
        expect(photoboxAktionErlaubt("rejected", "nutzung", "cc-by-4.0")).toBe(false);
        expect(photoboxAktionErlaubt("offline", "nutzung", "cc-by-4.0")).toBe(false);
    });

    it("der Schalter „Einreichungen annehmen“ steht im Katalog der Inhaltsschalter, Gruppe Betrieb, letzter bekannter Stand", () => {
        expect(PHOTOBOX_EINREICHEN_SCHALTER).toBe("photobox.submissions");
        expect(CONTENT_SWITCHES.find((entry) => entry.key === PHOTOBOX_EINREICHEN_SCHALTER)).toEqual({
            key: "photobox.submissions",
            group: "betrieb",
            failure: "last_known",
        });
    });

    it("die Antwortformen der öffentlichen Routen: Stand (nimmt der Server Einreichungen an?) und Eingegangen (201)", () => {
        expect(Value.Check(PhotoboxStand, { einreichen: true })).toBe(true);
        expect(Value.Check(PhotoboxStand, { einreichen: false })).toBe(true);
        expect(Value.Check(PhotoboxStand, { einreichen: "ja" })).toBe(false);
        expect(Value.Check(PhotoboxStand, { einreichen: true, mehr: 1 })).toBe(false);
        expect(Value.Check(PhotoboxEingegangen, { ok: true })).toBe(true);
        expect(Value.Check(PhotoboxEingegangen, { ok: false })).toBe(false);
        expect(Value.Check(PhotoboxEingegangen, { ok: true, nummer: "COM-1" })).toBe(false);
    });
});

describe("Reisebilder prüfen und freigeben: Verträge der Redaktion (WI-0272 S3)", () => {
    const operationId = "6d656469-0000-4000-8000-0000000000a1";

    it("die fünf Operationen haben je eine Adresse unter der Medienverwaltung, mit der Kennung der Einreichung im Pfad", () => {
        expect([...PHOTOBOX_REDAKTION_AKTIONEN]).toEqual(["approve", "ask", "reject", "correct", "offline", "reopen"]);
        const id = "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11";
        for (const aktion of PHOTOBOX_REDAKTION_AKTIONEN) {
            expect(mediaPhotoboxUrl(id, aktion)).toBe(`${MEDIA_EDITOR_URL}/photobox/${id}/${aktion}`);
        }
    });

    it("🔴 jede Operation trägt operationId und baseRevision (Revision der Einreichung, ab 1) und kein fremdes Feld", () => {
        const basis = { operationId, baseRevision: 3 };
        for (const schema of [PhotoboxRedaktionFreigeben, PhotoboxRedaktionOffline]) {
            expect(Value.Check(schema, basis)).toBe(true);
            expect(Value.Check(schema, { operationId })).toBe(false);
            expect(Value.Check(schema, { ...basis, baseRevision: 0 })).toBe(false);
            expect(Value.Check(schema, { ...basis, operationId: "x" })).toBe(false);
            expect(Value.Check(schema, { ...basis, grund: "nein" })).toBe(false);
        }
        expect(Value.Check(PhotoboxRedaktionRueckfrage, { ...basis, nachricht: "Bitte kürzen" })).toBe(true);
        expect(Value.Check(PhotoboxRedaktionAblehnen, { ...basis, grund: "Passt nicht zu Aventurien" })).toBe(true);
    });

    it("Nachricht und Grund: 1 bis 1000 Zeichen, nicht nur Leerraum (die Datenbank zählt nach btrim)", () => {
        expect(PHOTOBOX_NACHRICHT_MAX).toBe(1000);
        for (const [schema, feld] of [
            [PhotoboxRedaktionRueckfrage, "nachricht"],
            [PhotoboxRedaktionAblehnen, "grund"],
        ] as const) {
            const body = (text: string) => ({ operationId, baseRevision: 1, [feld]: text });
            expect(Value.Check(schema, body("x")), feld).toBe(true);
            expect(Value.Check(schema, body("ä".repeat(PHOTOBOX_NACHRICHT_MAX))), feld).toBe(true);
            expect(Value.Check(schema, body("ä".repeat(PHOTOBOX_NACHRICHT_MAX + 1))), feld).toBe(false);
            expect(Value.Check(schema, body("")), feld).toBe(false);
            expect(Value.Check(schema, body("   ")), feld).toBe(false);
            expect(Value.Check(schema, { operationId, baseRevision: 1 }), feld).toBe(false);
        }
    });

    it("korrigieren: Lage, Ort, Bezug und Beschreibung sind alle freiwillig; Ort und Bezug lassen sich mit null entfernen", () => {
        const basis = { operationId, baseRevision: 2 };
        expect(Value.Check(PhotoboxRedaktionKorrigieren, basis)).toBe(true);
        expect(
            Value.Check(PhotoboxRedaktionKorrigieren, {
                ...basis,
                lage: { x: 300, y: 310 },
                placeId: "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11",
                bezug: { art: "landschaft", id: "name:Svellt" },
                beschreibung: "Der Blick vom Hafen",
            }),
        ).toBe(true);
        expect(Value.Check(PhotoboxRedaktionKorrigieren, { ...basis, placeId: null, bezug: null })).toBe(true);
        // Die Lage liegt in der Welt, die Beschreibung hat die Länge der Tafel, der Bezug eine bekannte Art.
        expect(Value.Check(PhotoboxRedaktionKorrigieren, { ...basis, lage: { x: -5, y: 10 } })).toBe(false);
        expect(Value.Check(PhotoboxRedaktionKorrigieren, { ...basis, lage: { x: 10 } })).toBe(false);
        expect(
            Value.Check(PhotoboxRedaktionKorrigieren, {
                ...basis,
                beschreibung: "x".repeat(PHOTOBOX_LIMITS.descriptionMax + 1),
            }),
        ).toBe(false);
        expect(Value.Check(PhotoboxRedaktionKorrigieren, { ...basis, beschreibung: "   " })).toBe(false);
        expect(Value.Check(PhotoboxRedaktionKorrigieren, { ...basis, bezug: { art: "fluss", id: "x" } })).toBe(false);
        expect(Value.Check(PhotoboxRedaktionKorrigieren, { ...basis, placeId: "kein-uuid" })).toBe(false);
        expect(Value.Check(PhotoboxRedaktionKorrigieren, { ...basis, blickrichtung: 3 })).toBe(false);
    });
});

describe("Reisebilder in der Medienverwaltung: Korb, Unterteilung und Sicht der Redaktion (WI-0272 S3, Aufgabe 18)", () => {
    it("🔴 die Unterteilung: offen = eingegangen, geprüft, und freigegeben mit wartender Beschreibung; Rückfrage; der Rest ist erledigt, auch ein technisch gescheitertes Bild", () => {
        expect(MAM_EINREICHUNGEN).toEqual(["offen", "rueckfrage", "erledigt"]);
        for (const zustand of ["incoming", "pending"] as const) {
            expect(photoboxUnterteilung(zustand, false), zustand).toBe("offen");
        }
        // Die Redaktion kann bei einem technisch gescheiterten Bild nichts entscheiden (Review M11): nur der Einsender kann ersetzen oder zurückziehen.
        expect(photoboxUnterteilung("technical_failed", false)).toBe("erledigt");
        expect(photoboxUnterteilung("changes_requested", false)).toBe("rueckfrage");
        expect(photoboxUnterteilung("approved", true)).toBe("offen");
        expect(photoboxUnterteilung("approved", false)).toBe("erledigt");
        for (const zustand of ["rejected", "withdrawn", "offline", "expired", "purged"] as const) {
            expect(photoboxUnterteilung(zustand, false), zustand).toBe("erledigt");
        }
        // Jeder Zustand der Einreichung hat eine Unterteilung: ein neuer Zustand ohne Platz fiele hier auf.
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            expect(MAM_EINREICHUNGEN, zustand).toContain(photoboxUnterteilung(zustand, false));
        }
    });

    it("der Korb steht in der Liste der Körbe; die Suche nimmt die Unterteilung, nur bekannte Werte", () => {
        expect(MAM_BASKETS).toContain("photobox_uploads");
        expect(Value.Check(MamSearchQuery, { basket: "photobox_uploads", einreichung: "rueckfrage" })).toBe(true);
        expect(Value.Check(MamSearchQuery, { einreichung: "offen" })).toBe(true);
        expect(Value.Check(MamSearchQuery, { einreichung: "alle" })).toBe(false);
    });

    it("die Navigation trägt je Unterteilung ihre Zahl (optional: ein Server der Vorversion schickt sie nicht)", () => {
        const baskets = Object.fromEntries(MAM_BASKETS.map((korb) => [korb, 0]));
        const basis = {
            total: 0,
            kinds: { image: 0, model_3d: 0 },
            galleries: 0,
            citymaps: 0,
            photoboxGalerien: 0,
            typeImages: 0,
            baskets,
        };
        const types = Object.fromEntries(Object.keys(MamNavigation.properties.types.properties).map((typ) => [typ, 0]));
        expect(Value.Check(MamNavigation, { ...basis, types })).toBe(true);
        expect(
            Value.Check(MamNavigation, { ...basis, types, einreichungen: { offen: 3, rueckfrage: 1, erledigt: 7 } }),
        ).toBe(true);
        expect(Value.Check(MamNavigation, { ...basis, types, einreichungen: { offen: 3, rueckfrage: 1 } })).toBe(false);
    });

    const einreichung = {
        publicId: "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11",
        revision: 3,
        zustand: "pending",
        eingereichtAm: "2026-11-01T10:00:00.000Z",
        beschreibung: "Der Blick vom Hafen",
        entstehung: "photo",
        nutzung: "avesmaps_only",
        lage: { x: 300, y: 310 },
        bedingungen: PHOTOBOX_TERMS_VERSION,
        angepasst: false,
    };

    it("die Sicht der Redaktion auf eine Einreichung: Pflichtfelder und freiwillige Angaben", () => {
        expect(Value.Check(PhotoboxSubmissionView, einreichung)).toBe(true);
        expect(
            Value.Check(PhotoboxSubmissionView, {
                ...einreichung,
                wartendeBeschreibung: "Neu gefasst",
                nachricht: "Welcher Hafen?",
                blickrichtung: 2,
                name: "Alrik",
                ort: { publicId: "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b12", name: "Gareth", typ: "Metropole" },
                bezug: { art: "landschaft", id: "name:Svellt" },
                ortHatOrtsansicht: true,
            }),
        ).toBe(true);
        // Geschlossen: ein unbekanntes Feld fiele durch; der Zustand ist einer der Tafel.
        expect(Value.Check(PhotoboxSubmissionView, { ...einreichung, statusKey: "geheim" })).toBe(false);
        expect(Value.Check(PhotoboxSubmissionView, { ...einreichung, zustand: "gesperrt" })).toBe(false);
        expect(Value.Check(PhotoboxSubmissionView, { ...einreichung, lage: { x: 10 } })).toBe(false);
    });

    it("🔴 die Einreichung ist ein privates Feld: am Asset der Redaktion und an der Zeile der Liste", () => {
        expect(MEDIA_PRIVATE_FIELDS.MediaAssetDetail).toContain("submission");
        expect(MEDIA_PRIVATE_FIELDS.MamAssetSummary).toContain("submission");
        expect(Object.keys(MediaAssetDetail.properties)).toContain("submission");
        expect(Object.keys(MamAssetSummary.properties)).toContain("submission");
        // Optional: Ein Asset ohne Einreichung trägt das Feld nicht.
        expect(MediaAssetDetail.required).not.toContain("submission");
    });
});
