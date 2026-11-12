import {
    GEBIRGS_KAMMHOEHE,
    GEBIRGS_MODELL_GRENZEN,
    GEBIRGS_MODELL_SPALTE,
    GEBIRGS_MODELL_WERTE,
    GEBIRGS_MUSTER,
    GEBIRGS_WERT_GRENZEN,
    GEBIRGS_WERTE,
    GEBIRGSTYPEN,
    type GebirgsModellWert,
    type GebirgsPresetGruppe,
    type GebirgsWert,
    type Gebirgstyp,
} from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import {
    abweichungen,
    begrenzt,
    geltenderModellwert,
    geltenderWert,
    geltendesMuster,
    mitModellwert,
    mitMuster,
    mitTyp,
    mitWert,
    modellPreset,
    presetMuster,
    presetWert,
    type GebirgsEntwurf,
} from "./gebirge-stand";

/**
 * „Werte kopieren“ und „Werte einfügen“ im Reiter „Gebirge“ (Bauvorlage Gebirge-Entwurf V16, Betreiber 2026-10-20: „Werte kopieren -> sehr
 * geil“, „braucht auch Werte einfügen“; aus dem Entwurf `werte-text.ts`, ohne Faltung, die es im Produkt nicht gibt). Ein lesbarer
 * Text, je Zeile „Name: Wert (Preset …)“: Gebirge, Typ, Kammhöhe, Grundmuster, alle Werte, die drei Werte des Rückennetzes, geänderte
 * Gipfelhöhen und das gezeichnete Netz. Derselbe Text lässt sich an einem anderen Gebirge einfügen; Namen in der Sprache der Seite.
 */

const stellen = (schritt: number): number => (schritt >= 1 ? 0 : String(schritt).split(".")[1]!.length);
const zahl = (wert: GebirgsWert, v: number): string => formatNumber(v, stellen(GEBIRGS_WERT_GRENZEN[wert].schritt));
const modellZahl = (wert: GebirgsModellWert, v: number): string =>
    formatNumber(v, stellen(GEBIRGS_MODELL_GRENZEN[wert].schritt));
const typText = (typ: Gebirgstyp | null): string =>
    typ === null ? t("landschaftseditor.gebirge.typ.keins") : t(`landschaftseditor.gebirge.typ.${typ}`);
const wertName = (wert: GebirgsWert): string => t(`landschaftseditor.gebirge.wert.${wert}`);
const modellName = (wert: GebirgsModellWert): string =>
    t(`landschaftseditor.gebirge.wert.${GEBIRGS_MODELL_SPALTE[wert]}`);
const preset = (text: string): string => ` (${t("landschaftseditor.gebirge.wert.preset", { n: text })})`;

export interface WerteLage {
    name: string;
    stand: GebirgsEntwurf;
    presets: GebirgsPresetGruppe;
    kammhoehe: number;
    /** Die Saat, die gilt (gewürfelt oder abgeleitet, Migration 0214); eingefügt wird sie als gewürfelte. */
    saat?: number | undefined;
    /** Der abgeleitete Talboden der Vorschau, solange kein eigener gesetzt ist. */
    talbodenAbgeleitet?: number | undefined;
    peaks: readonly { id: string; name: string; height?: number | undefined }[];
    gipfelHoehen: Readonly<Record<string, number>>;
}

const zahlE = (v: number): string => String(Math.round(v * 1000) / 1000);

export function werteText(a: WerteLage): string {
    const { stand, presets } = a;
    const mitPreset = stand.typ !== null;
    const zeilen: string[] = [];
    zeilen.push(`${t("landschaftseditor.gebirge.text.gebirge")}: ${a.name}`);
    zeilen.push(`${t("landschaftseditor.gebirge.typ.titel")}: ${typText(stand.typ)}`);
    zeilen.push(`${t("landschaftseditor.gebirge.hoehe.kamm")}: ${formatNumber(a.kammhoehe, 0)}`);
    if (a.saat !== undefined) zeilen.push(`${t("landschaftseditor.gebirge.saat.titel")}: ${String(a.saat)}`);
    const n = abweichungen(stand, presets);
    zeilen.push(
        !mitPreset
            ? t("landschaftseditor.gebirge.werte.eigene")
            : n === 0
              ? t("landschaftseditor.gebirge.werte.titel", { typ: typText(stand.typ) })
              : t("landschaftseditor.gebirge.werte.abweichend", { typ: typText(stand.typ), n: formatNumber(n, 0) }),
    );
    const muster = t(`landschaftseditor.gebirge.muster.${geltendesMuster(stand, presets)}`);
    zeilen.push(
        `${t("landschaftseditor.gebirge.muster.titel")}: ${muster}${
            mitPreset ? preset(t(`landschaftseditor.gebirge.muster.${presetMuster(stand, presets)}`)) : ""
        }`,
    );
    for (const wert of GEBIRGS_WERTE) {
        const p = presetWert(stand, presets, wert);
        zeilen.push(
            `${wertName(wert)}: ${zahl(wert, geltenderWert(stand, presets, wert))}${mitPreset && p !== undefined ? preset(zahl(wert, p)) : ""}`,
        );
    }
    const netz = stand.netz;
    if (netz !== undefined && (netz.kaemme.length > 0 || (netz.mulden?.length ?? 0) > 0))
        for (const wert of GEBIRGS_MODELL_WERTE) {
            const gilt =
                wert === "talboden" && stand.modell?.talboden === undefined && a.talbodenAbgeleitet !== undefined
                    ? a.talbodenAbgeleitet
                    : geltenderModellwert(stand, presets, wert);
            zeilen.push(
                `${modellName(wert)}: ${modellZahl(wert, gilt)}${preset(modellZahl(wert, modellPreset(stand, presets, wert)))}`,
            );
        }
    for (const [id, jetzt] of Object.entries(a.gipfelHoehen)) {
        const p = a.peaks.find((q) => q.id === id);
        if (p !== undefined)
            zeilen.push(`${t("landschaftseditor.gebirge.text.gipfel", { name: p.name })}: ${formatNumber(jetzt, 0)}`);
    }
    if (
        netz !== undefined &&
        (netz.kaemme.length > 0 || netz.nebengipfel.length > 0 || (netz.mulden?.length ?? 0) > 0)
    ) {
        zeilen.push(t("landschaftseditor.gebirge.text.kaemme"));
        for (const k of netz.kaemme)
            zeilen.push(
                `${t(`landschaftseditor.kaemme.rang.${k.rang}`)}: ${k.punkte.map(([x, y]) => `${zahlE(x)} ${zahlE(y)}`).join("; ")}`,
            );
        for (const g of netz.nebengipfel)
            zeilen.push(
                `${t("landschaftseditor.kaemme.werkzeug.nebengipfel")}: ${zahlE(g.x)} ${zahlE(g.y)}${g.h === null ? "" : ` ${String(g.h)}`}`,
            );
        for (const g of netz.mulden ?? [])
            zeilen.push(
                `${t("landschaftseditor.kaemme.werkzeug.mulde")}: ${zahlE(g.x)} ${zahlE(g.y)}${g.h === null ? "" : ` ${String(g.h)}`}`,
            );
    }
    return zeilen.join("\n");
}

/** Eine Zahl in deutscher Schreibweise („1.100“, „0,53“) oder mit Punkt als Dezimaltrenner („0.53“). */
export function leseZahl(text: string): number | undefined {
    const roh = (text.trim().match(/^-?[\d.,]+/) ?? [""])[0];
    if (roh === "") return undefined;
    const deutsch = roh.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(roh);
    const n = Number(deutsch ? roh.replace(/\./g, "").replace(",", ".") : roh);
    return Number.isFinite(n) ? n : undefined;
}

export interface Eingefuegt {
    stand: GebirgsEntwurf;
    gipfelHoehen: Record<string, number>;
    gesetzt: number;
    uebersprungen: string[];
}

/**
 * Den Text lesen und am gewählten Gebirge setzen: Der Typ bleibt, außer der Text nennt einen; dann zuerst der Typ, die Werte danach als
 * Abweichungen. Nennt der Text Kämme oder Nebengipfel, ersetzen sie das Netz. Unbekannte Zeilen werden übersprungen, Werte außerhalb der
 * Grenzen begrenzt.
 */
export function werteEinfuegen(text: string, a: WerteLage): Eingefuegt {
    const klein = (s: string): string => s.toLowerCase();
    const namenWert = new Map(GEBIRGS_WERTE.map((w) => [klein(wertName(w)), w]));
    const namenModell = new Map(GEBIRGS_MODELL_WERTE.map((w) => [klein(modellName(w)), w]));
    const namenMuster = new Map(GEBIRGS_MUSTER.map((m) => [klein(t(`landschaftseditor.gebirge.muster.${m}`)), m]));
    const namenTyp = new Map<string, Gebirgstyp | null>([
        [klein(t("landschaftseditor.gebirge.typ.keins")), null],
        ...GEBIRGSTYPEN.map((typ): [string, Gebirgstyp] => [klein(t(`landschaftseditor.gebirge.typ.${typ}`)), typ]),
    ]);
    const titelTyp = klein(t("landschaftseditor.gebirge.typ.titel"));
    const titelKamm = klein(t("landschaftseditor.gebirge.hoehe.kamm"));
    const titelSaat = klein(t("landschaftseditor.gebirge.saat.titel"));
    const titelMuster = klein(t("landschaftseditor.gebirge.muster.titel"));
    const rangVon = new Map([
        [klein(t("landschaftseditor.kaemme.rang.haupt")), "haupt" as const],
        [klein(t("landschaftseditor.kaemme.rang.neben")), "neben" as const],
        [klein(t("landschaftseditor.kaemme.rang.tal")), "tal" as const],
    ]);
    const titelMulde = klein(t("landschaftseditor.kaemme.werkzeug.mulde"));
    const titelNebengipfel = klein(t("landschaftseditor.kaemme.werkzeug.nebengipfel"));
    const gipfelVon = new Map(
        a.peaks.map((p) => [klein(t("landschaftseditor.gebirge.text.gipfel", { name: p.name })), p]),
    );

    const paare = text
        .split(/\r?\n/)
        .map((z) => z.replace(/^[-•*]\s*/, "").trim())
        .filter((z) => z !== "")
        .map((z) => {
            const stelle = z.indexOf(":");
            return stelle < 0
                ? { z, name: "", wert: "" }
                : { z, name: klein(z.slice(0, stelle).trim()), wert: z.slice(stelle + 1).trim() };
        });
    const aus: Eingefuegt = { stand: a.stand, gipfelHoehen: { ...a.gipfelHoehen }, gesetzt: 0, uebersprungen: [] };
    // Zuerst der Typ: Er setzt die Presets, an denen die übrigen Werte gemessen werden.
    const typZeile = paare.find((p) => p.name === titelTyp);
    if (typZeile !== undefined) {
        const genannt = namenTyp.get(klein(typZeile.wert));
        if (genannt === undefined) aus.uebersprungen.push(typZeile.z);
        else {
            if (genannt !== a.stand.typ) aus.stand = mitTyp(aus.stand, a.presets, genannt);
            aus.gesetzt++;
        }
    }
    let netz:
        | {
              kaemme: { punkte: [number, number][]; rang: "haupt" | "neben" | "tal" }[];
              nebengipfel: { x: number; y: number; h: number | null }[];
              mulden?: { x: number; y: number; h: number | null }[];
          }
        | undefined;
    for (const p of paare) {
        if (p.name === titelTyp || p.name === "" || p.name === klein(t("landschaftseditor.gebirge.text.gebirge")))
            continue;
        const rang = rangVon.get(p.name);
        if (rang !== undefined) {
            const punkte = p.wert
                .split(";")
                .map((s) => s.trim().split(/\s+/).map(Number))
                .filter((q) => q.length >= 2 && q.every(Number.isFinite))
                .map((q) => [q[0]!, q[1]!] as [number, number]);
            if (punkte.length < 2) aus.uebersprungen.push(p.z);
            else {
                netz ??= { kaemme: [], nebengipfel: [] };
                netz.kaemme.push({ punkte, rang });
                aus.gesetzt++;
            }
            continue;
        }
        if (p.name === titelNebengipfel || p.name === titelMulde) {
            const q = p.wert.split(/\s+/).map(Number);
            if (q.length < 2 || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) aus.uebersprungen.push(p.z);
            else {
                netz ??= { kaemme: [], nebengipfel: [] };
                const ziel = p.name === titelMulde ? (netz.mulden ??= []) : netz.nebengipfel;
                ziel.push({
                    x: q[0]!,
                    y: q[1]!,
                    h: q.length >= 3 && Number.isFinite(q[2]) && q[2]! >= 0 ? Math.round(q[2]!) : null,
                });
                aus.gesetzt++;
            }
            continue;
        }
        if (p.name === titelSaat) {
            // Ganzzahl ohne Tausenderpunkte, auch negativ; was nicht in INTEGER passt, wird übersprungen.
            const v = /^-?\d+$/.test(p.wert.trim()) ? Number(p.wert.trim()) : Number.NaN;
            if (!Number.isSafeInteger(v) || v < -2147483648 || v > 2147483647) aus.uebersprungen.push(p.z);
            else {
                aus.stand = { ...aus.stand, saat: v };
                aus.gesetzt++;
            }
            continue;
        }
        if (p.name === titelKamm) {
            const v = leseZahl(p.wert);
            if (v === undefined) aus.uebersprungen.push(p.z);
            else {
                aus.stand = {
                    ...aus.stand,
                    kammhoehe: Math.min(GEBIRGS_KAMMHOEHE.max, Math.max(GEBIRGS_KAMMHOEHE.min, Math.round(v))),
                };
                aus.gesetzt++;
            }
            continue;
        }
        if (p.name === titelMuster) {
            const m = namenMuster.get(klein(p.wert.replace(/\s*\(.*$/, "")));
            if (m === undefined) aus.uebersprungen.push(p.z);
            else {
                aus.stand = mitMuster(aus.stand, a.presets, m);
                aus.gesetzt++;
            }
            continue;
        }
        const wert = namenWert.get(p.name);
        if (wert !== undefined) {
            const v = leseZahl(p.wert);
            const neu = v === undefined ? undefined : begrenzt(wert, v);
            if (neu === undefined) aus.uebersprungen.push(p.z);
            else {
                aus.stand = mitWert(aus.stand, a.presets, wert, neu);
                aus.gesetzt++;
            }
            continue;
        }
        const modell = namenModell.get(p.name);
        if (modell !== undefined) {
            const v = leseZahl(p.wert);
            if (v === undefined) aus.uebersprungen.push(p.z);
            else {
                aus.stand = mitModellwert(aus.stand, a.presets, modell, v);
                aus.gesetzt++;
            }
            continue;
        }
        const gipfel = gipfelVon.get(p.name);
        if (gipfel !== undefined) {
            const v = leseZahl(p.wert);
            if (v === undefined) aus.uebersprungen.push(p.z);
            else {
                aus.gipfelHoehen[gipfel.id] = Math.round(v);
                aus.gesetzt++;
            }
            continue;
        }
        aus.uebersprungen.push(p.z);
    }
    if (netz !== undefined) aus.stand = { ...aus.stand, netz };
    return aus;
}
