import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    API_ERROR_CODE_PATTERN,
    API_ERROR_STATUS,
    MEDIA_ERROR_STATUS,
    MEDIA_OPERATION_ERROR_STATUS,
    MEDIA_UPLOAD_BODY_LIMIT,
    MEDIA_UPLOAD_LIMITS,
    MediaCoatBindBody,
    MediaUploadForm,
    validateMediaEvidence,
    validateMediaForm,
    type MediaFormContext,
    type MediaLicenseInfo,
} from "../src/index.ts";

/**
 * Der Vertrag des gemeinsamen Upload-Formulars (WI-0068 P4a, WI-0126 §11j): Die Prüfung ist eine reine Funktion, die das Formular
 * (P4b) und der Server gleich rufen. Pfad und Regel, nie der Wert.
 */

const LICENSES: MediaLicenseInfo[] = [
    { key: "cc-by-4.0", displayName: "CC BY 4.0", uri: "https://x", family: "cc-by", requiresAttribution: true },
    { key: "cc0-1.0", displayName: "CC0 1.0", uri: "https://x", family: "cc0", requiresAttribution: false },
];

const UPLOAD: MediaFormContext = { mode: "upload", licenses: LICENSES, mayReview: true };

const form = (overrides: Partial<MediaUploadForm> = {}): MediaUploadForm => ({
    title: "Wappen",
    role: "coat",
    creationMethod: "drawing",
    rights: { basis: "own_work" },
    ...overrides,
});

describe("Prüfung des Upload-Formulars", () => {
    it("ein vollständiges Formular hat keine Befunde und passt zum Schema", () => {
        expect(validateMediaForm(form(), UPLOAD)).toEqual([]);
        expect(Value.Check(MediaUploadForm, form())).toBe(true);
    });

    it("7b: der Name darf leer sein, wenn er aus der Bindung kommt; dann darf kein Name mitkommen", () => {
        expect(validateMediaForm(form({ title: "" }), UPLOAD)).toEqual([{ path: "title", rule: "required" }]);
        expect(validateMediaForm(form({ title: "", titleFromBinding: true }), UPLOAD)).toEqual([]);
        expect(Value.Check(MediaUploadForm, form({ title: "", titleFromBinding: true }))).toBe(true);
        expect(validateMediaForm(form({ title: "Wappen", titleFromBinding: true }), UPLOAD)).toEqual([
            { path: "title", rule: "not_allowed" },
        ]);
    });

    it("Pflichtfelder je Rechtsgrundlage: Lizenz bei license, Namensnennung bei CC BY, Schlüssel nur bei license", () => {
        expect(validateMediaForm(form({ rights: { basis: "license" } }), UPLOAD)).toEqual([
            { path: "rights.licenseKey", rule: "required" },
        ]);
        expect(validateMediaForm(form({ rights: { basis: "license", licenseKey: "cc-by-4.0" } }), UPLOAD)).toEqual([
            { path: "rights.attribution", rule: "required_by_license" },
        ]);
        expect(
            validateMediaForm(
                form({ rights: { basis: "license", licenseKey: "cc-by-4.0", attribution: "Foto: A" } }),
                UPLOAD,
            ),
        ).toEqual([]);
        expect(validateMediaForm(form({ rights: { basis: "license", licenseKey: "cc0-1.0" } }), UPLOAD)).toEqual([]);
        expect(validateMediaForm(form({ rights: { basis: "license", licenseKey: "gibt-es-nicht" } }), UPLOAD)).toEqual([
            { path: "rights.licenseKey", rule: "unknown_license" },
        ]);
        expect(validateMediaForm(form({ rights: { basis: "fan_policy", licenseKey: "cc0-1.0" } }), UPLOAD)).toEqual([
            { path: "rights.licenseKey", rule: "only_with_license" },
        ]);
        // `unknown` ist erlaubt (nie öffentlich, aber speicherbar).
        expect(validateMediaForm(form({ rights: { basis: "unknown" } }), UPLOAD)).toEqual([]);
    });

    it("Prompt nur bei KI-Erzeugung; Werkzeug und Modell bei jeder Art", () => {
        expect(validateMediaForm(form({ creation: { tool: "Stift", prompt: "Löwe" } }), UPLOAD)).toEqual([
            { path: "creation.prompt", rule: "needs_ai_generated" },
        ]);
        expect(
            validateMediaForm(
                form({ creationMethod: "ai_generated", creation: { tool: "X", prompt: "Löwe" } }),
                UPLOAD,
            ),
        ).toEqual([]);
    });

    it("🔴 „Rechte geprüft“ geht beim Hochladen und am eigenen Bild (WI-0282), nur mit dem Recht und nie bei unbekannter Grundlage", () => {
        expect(validateMediaForm(form({ rightsReviewed: true }), UPLOAD)).toEqual([]);
        expect(validateMediaForm(form({ rightsReviewed: true }), { ...UPLOAD, mode: "edit" })).toEqual([]);
        expect(validateMediaForm(form({ rightsReviewed: true }), { ...UPLOAD, mayReview: false })).toEqual([
            { path: "rightsReviewed", rule: "not_allowed" },
        ]);
        expect(validateMediaForm(form({ rightsReviewed: true, rights: { basis: "unknown" } }), UPLOAD)).toEqual([
            { path: "rightsReviewed", rule: "not_allowed" },
        ]);
    });

    it("Beleg je Art: Seite mit Adresse, Dokument mit Datei, Notiz mit Text", () => {
        expect(validateMediaEvidence({ kind: "license_page" })).toEqual([{ path: "evidence.url", rule: "required" }]);
        expect(validateMediaEvidence({ kind: "source_page", url: "javascript:alert(1)" })).toEqual([
            { path: "evidence.url", rule: "not_http" },
        ]);
        expect(validateMediaEvidence({ kind: "pdf", url: "https://x" })).toEqual([
            { path: "evidence.file", rule: "required" },
            { path: "evidence.url", rule: "not_allowed" },
        ]);
        expect(validateMediaEvidence({ kind: "operator_note" })).toEqual([{ path: "evidence.text", rule: "required" }]);
        expect(validateMediaEvidence({ kind: "operator_note", text: "Betreiber: ja" })).toEqual([]);
    });

    it("Vorprüfung der Datei: Typ und Größe nach den Grenzen des Betreibers (D2), SVG mit eigener Grenze", () => {
        const withFile = (type: string, sizeBytes: number) =>
            validateMediaForm(form(), { ...UPLOAD, file: { type, sizeBytes } });
        expect(withFile("image/png", 1000)).toEqual([]);
        expect(withFile("application/x-msdownload", 1000)).toEqual([{ path: "file", rule: "unsupported_type" }]);
        expect(withFile("image/png", MEDIA_UPLOAD_LIMITS.maxRasterBytes + 1)).toEqual([
            { path: "file", rule: "too_large" },
        ]);
        expect(withFile("image/svg+xml", MEDIA_UPLOAD_LIMITS.maxSvgBytes + 1)).toEqual([
            { path: "file", rule: "too_large" },
        ]);
        expect(withFile("", 1)).toEqual([{ path: "file", rule: "unsupported_type" }]);
        // Die Grenze der Anfrage trägt Bild und Beleg je über der Bytegrenze (dann antwortet die genaue Prüfung).
        expect(MEDIA_UPLOAD_BODY_LIMIT).toBeGreaterThan(2 * Math.ceil(MEDIA_UPLOAD_LIMITS.maxRasterBytes / 3) * 4);
    });
});

describe("Operationen", () => {
    it("Fachcodes folgen ADR-0018 und überschreiben weder gemeinsame noch die Codes aus P2", () => {
        for (const code of Object.keys(MEDIA_OPERATION_ERROR_STATUS)) {
            expect(code).toMatch(new RegExp(API_ERROR_CODE_PATTERN));
            expect(Object.keys(API_ERROR_STATUS)).not.toContain(code);
            expect(Object.keys(MEDIA_ERROR_STATUS)).not.toContain(code);
        }
    });

    it("ein Wappen bindet über die Kennung des Fachobjekts, nie über einen Namen", () => {
        const operationId = "6d656469-0000-4000-8000-000000000001";
        const body = {
            operationId,
            subject: { kind: "place", id: operationId },
            assetId: operationId,
            baseState: "undecided",
        };
        expect(Value.Check(MediaCoatBindBody, body)).toBe(true);
        expect(Value.Check(MediaCoatBindBody, { ...body, subject: { kind: "place", id: "Gareth" } })).toBe(false);
        expect(Value.Check(MediaCoatBindBody, { ...body, subject: { kind: "region", id: operationId } })).toBe(false);
        expect(Value.Check(MediaCoatBindBody, { ...body, baseState: "set" })).toBe(false);
    });
});
