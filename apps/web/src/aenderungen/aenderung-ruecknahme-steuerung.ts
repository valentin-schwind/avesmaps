import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { MapHistoryActor, RuecknahmeKonflikt, RuecknahmePruefung, RuecknahmeReceipt } from "@avesmaps3d/shared";
import { folgeArbeit, type FolgeArbeit, type FolgeAuftrag } from "../fenster/folge-arbeit";
import { isMessageKey, t } from "../i18n/i18n";
import type { RuecknahmeAngebot } from "./aenderung-ruecknahme";
import type { ApiFehler, RuecknahmeDaten } from "./aenderung-ruecknahme-daten";

/**
 * Der Ablauf eines ↺ (WI-0265 B5c; Probierseite Szenen 2, 3, 6, 7), ohne Bauteil: Klick, Vorprüfung, Rückfrage, Rücknahme. Der Server entscheidet jedes Mal; die
 * Oberfläche zeigt, was er sagt, und schreibt nie eine halbe Rücknahme.
 *
 * 1. **Klick:** `starte` fragt `…/restore-series/preview` mit den Mitgliedern des Angebots (bei einer Serie mit der Prüfsumme aus der Liste).
 * 2. **Antwort der Vorprüfung** (`ergebnis`): `ok` → die Rückfrage (`fragt`) mit den Mitgliedern, den Folgen und, bei fremden Personen, dem Pflichtfeld Grund (Gate 2).
 *    `edit_conflict` → die Konfliktliste mit Gegenstand, Person und Zeit, **keine** Teilrücknahme; `object_locked`, `forbidden`, `not_revertable`, `already_reverted` und
 *    `invalid_members` sagen es ebenso, ohne zu schreiben. `series_changed` → die neue Liste wird gefragt (`hinweis: "serieGewachsen"`), die Rückfrage beginnt von vorn.
 * 3. **Bestätigen:** `bestaetige` schreibt mit EINER neuen Kennung je Bestätigung. Nach einem Netzfehler oder einem 5xx sendet `nochmal` dieselbe Kennung noch einmal
 *    (der Server antwortet `replayed`, nichts wird doppelt geschrieben); nach jeder anderen Antwort beginnt die nächste Bestätigung mit einer neuen.
 * 4. **Ergebnis:** die Quittung; abgeleitete Arbeit (`derivedWork`) geht über den vorhandenen Weg der Warteschlange (`fenster/folge-arbeit.ts`), nichts Simuliertes.
 *    `neuLesen` ruft der Aufrufer, wo die Liste oder der Verlauf sich ändern muss (nach Erfolg, `series_changed`, `already_reverted`, `invalid_members`, Konflikt).
 */

export type Blockade =
    | { readonly art: "verboten" }
    | {
          readonly art: "gesperrt";
          readonly sperren: readonly { readonly name: string; readonly seit: string | undefined }[];
      }
    | { readonly art: "konflikt"; readonly konflikte: readonly RuecknahmeKonflikt[] }
    | { readonly art: "nicht"; readonly grund: "quelle" | "art" | "bereich" }
    | {
          readonly art: "schon";
          readonly durch: { readonly actor: MapHistoryActor | undefined; readonly at: string | undefined } | undefined;
      }
    | { readonly art: "ungueltig" };

export type RuecknahmeStand =
    | { readonly art: "ruhe" }
    | { readonly art: "prueft" }
    | { readonly art: "fragt"; readonly pruefung: RuecknahmePruefung; readonly hinweis: "serieGewachsen" | undefined }
    | { readonly art: "sendet"; readonly pruefung: RuecknahmePruefung }
    | { readonly art: "blockiert"; readonly blockade: Blockade }
    | { readonly art: "fehler"; readonly satz: string; readonly wiederholbar: boolean }
    | {
          readonly art: "fertig";
          readonly serie: boolean;
          readonly wiederholt: boolean;
          readonly quittung: RuecknahmeReceipt;
          readonly folge: FolgeAuftrag | undefined;
          readonly befunde: readonly string[];
      };

export interface RuecknahmeOptionen {
    readonly daten: RuecknahmeDaten;
    /** Die Kennung je Bestätigung; ein Test setzt sie fest. */
    readonly neueKennung?: () => string;
    /** Die Folgearbeit nach der Rücknahme; ohne Angabe die eine der Seite. */
    readonly folge?: Pick<FolgeArbeit, "vormerke"> | undefined;
    /** Die Rücknahme ist geschrieben (auch eine wiederholte): Liste, Verlauf und Karte ziehen nach. */
    zurueckgenommen?(quittung: RuecknahmeReceipt): void;
    /** Die Liste ist nicht mehr, was die Rückfrage meinte (Serie gewachsen, schon zurückgenommen, Konflikt): neu lesen. */
    neuLesen?(): void;
}

export interface Ruecknahme {
    readonly stand: Readonly<ShallowRef<RuecknahmeStand>>;
    /** Der Server hat „kein Recht“ gesagt: Der Knopf bleibt gesperrt, mit Grund. */
    readonly verboten: Readonly<Ref<boolean>>;
    starte(angebot: RuecknahmeAngebot): Promise<void>;
    bestaetige(grund?: string): Promise<void>;
    /** Dieselbe Anfrage mit derselben Kennung noch einmal (nach einem Netzfehler). */
    nochmal(): Promise<void>;
    /** Die Rückfrage, die Konfliktliste oder das Ergebnis weg. */
    schliesse(): void;
    destroy(): void;
}

/** Ab diesem Status ist unklar, ob der Server geschrieben hat: Die Wiederholung trägt dieselbe Kennung. */
const AB_STATUS_UNKLAR = 500;

/** Die Konflikte einer Antwort `409 edit_conflict` (`details.objects`) in der Form der Vorprüfung. */
function konflikteAus(fehler: ApiFehler): RuecknahmeKonflikt[] {
    const objekte = (fehler.details?.["objects"] ?? []) as Record<string, unknown>[];
    return objekte.map((o) => {
        const von = o["changedBy"] as MapHistoryActor | null | undefined;
        const nach = o["changedAt"] as string | null | undefined;
        return {
            art: o["art"] as RuecknahmeKonflikt["art"],
            kind: o["kind"] as RuecknahmeKonflikt["kind"],
            id: String(o["id"] ?? ""),
            ...(typeof o["name"] === "string" ? { name: o["name"] } : {}),
            ...(typeof o["currentRevision"] === "number" ? { currentRevision: o["currentRevision"] } : {}),
            ...(von ? { changedBy: von } : {}),
            ...(nach ? { changedAt: nach } : {}),
            ...(typeof o["operationId"] === "string" ? { operationId: o["operationId"] } : {}),
            ...(typeof o["seq"] === "number" ? { seq: o["seq"] } : {}),
            ...(Array.isArray(o["felder"]) ? { felder: o["felder"] as string[] } : {}),
            ...(typeof o["abweichung"] === "object" && o["abweichung"] !== null
                ? { abweichung: o["abweichung"] as NonNullable<RuecknahmeKonflikt["abweichung"]> }
                : {}),
            ...(typeof o["detail"] === "string" ? { detail: o["detail"] } : {}),
        };
    });
}

/** Die fremden Sperren einer Antwort (`details.locks` oder `details.lock`) mit Name und Beginn. */
function sperrenAus(fehler: ApiFehler): { name: string; seit: string | undefined }[] {
    const einzeln = fehler.details?.["lock"];
    const liste = (fehler.details?.["locks"] ?? (einzeln === undefined ? [] : [einzeln])) as {
        person?: { name?: string };
        since?: string;
    }[];
    return liste.map((sperre) => ({ name: sperre.person?.name ?? t("verlauf.jemand"), seit: sperre.since }));
}

const sperrenAusPruefung = (pruefung: RuecknahmePruefung): { name: string; seit: string | undefined }[] =>
    pruefung.sperren.map((sperre) => ({ name: sperre.person.name, seit: sperre.since }));

export function createRuecknahme(optionen: RuecknahmeOptionen): Ruecknahme {
    const neueKennung = optionen.neueKennung ?? (() => crypto.randomUUID());
    const folgeArt = optionen.folge ?? folgeArbeit;
    const stand = shallowRef<RuecknahmeStand>({ art: "ruhe" });
    const verboten = ref(false);
    let abbruch: AbortController | undefined;
    let angebot: RuecknahmeAngebot | undefined;
    /** Die Kennung der laufenden Bestätigung und ihr Inhalt, solange eine Wiederholung noch dieselbe sein darf. */
    let offenerVersuch: { operationId: string; pruefung: RuecknahmePruefung; grund: string | undefined } | undefined;

    /** Der Stand jetzt: nach einem `await` hat die Kette der Fragen ihn geändert, was die Verengung durch die Zuweisung davor nicht weiß. */
    const lies = (): RuecknahmeStand => stand.value;

    function blockiere(blockade: Blockade): void {
        stand.value = { art: "blockiert", blockade };
    }

    function ausPruefung(pruefung: RuecknahmePruefung): Blockade | undefined {
        switch (pruefung.ergebnis) {
            case "ok":
                return undefined;
            case "forbidden":
                verboten.value = true;
                return { art: "verboten" };
            case "object_locked":
                return { art: "gesperrt", sperren: sperrenAusPruefung(pruefung) };
            case "edit_conflict":
                optionen.neuLesen?.();
                return { art: "konflikt", konflikte: pruefung.konflikte };
            case "not_revertable": {
                const grund = pruefung.mitglieder.find((m) => m.ausschluss !== undefined)?.ausschluss?.grund;
                return { art: "nicht", grund: grund ?? "art" };
            }
            case "already_reverted": {
                optionen.neuLesen?.();
                return { art: "schon", durch: undefined };
            }
            case "invalid_members":
                optionen.neuLesen?.();
                return { art: "ungueltig" };
            case "series_changed":
                // Behandelt der Aufrufer von `frage`: mit der neuen Liste noch einmal fragen.
                return undefined;
        }
    }

    async function frage(
        aktuell: RuecknahmeAngebot,
        mitglieder: readonly string[],
        hash: string | undefined,
        nachgefragt: boolean,
    ): Promise<void> {
        abbruch?.abort();
        const eigene = new AbortController();
        abbruch = eigene;
        stand.value = { art: "prueft" };
        const antwort = await optionen.daten
            .vorschau(
                aktuell.ziel,
                { members: [...mitglieder], ...(hash === undefined ? {} : { membersHash: hash }) },
                eigene.signal,
            )
            .catch((fehler: unknown) => {
                if (eigene.signal.aborted) return undefined;
                throw fehler;
            });
        if (antwort === undefined || eigene.signal.aborted) return;
        if (!antwort.ok) {
            if (antwort.status === 403) {
                verboten.value = true;
                blockiere({ art: "verboten" });
            } else stand.value = { art: "fehler", satz: antwort.fehler.message, wiederholbar: false };
            return;
        }
        const pruefung = antwort.wert;
        if (pruefung.ergebnis === "series_changed") {
            optionen.neuLesen?.();
            if (!nachgefragt && pruefung.neueMitglieder !== undefined && pruefung.neuerHash !== undefined) {
                await frage(aktuell, pruefung.neueMitglieder, pruefung.neuerHash, true);
                const jetzt = lies();
                if (jetzt.art === "fragt") stand.value = { ...jetzt, hinweis: "serieGewachsen" };
                return;
            }
            blockiere({ art: "ungueltig" });
            return;
        }
        const blockade = ausPruefung(pruefung);
        if (blockade !== undefined) {
            blockiere(blockade);
            return;
        }
        stand.value = { art: "fragt", pruefung, hinweis: undefined };
    }

    async function schreibe(): Promise<void> {
        const aktuell = angebot;
        const versuch = offenerVersuch;
        if (aktuell === undefined || versuch === undefined) return;
        stand.value = { art: "sendet", pruefung: versuch.pruefung };
        const antwort = await optionen.daten.ruecknehmen(aktuell.ziel, {
            operationId: versuch.operationId,
            members: [...versuch.pruefung.mitglieder.map((m) => m.operationId)],
            membersHash: versuch.pruefung.membersHash,
            ...(versuch.grund === undefined ? {} : { reason: versuch.grund }),
        });
        if (antwort.ok) {
            offenerVersuch = undefined;
            const quittung = antwort.wert;
            const folge = folgeArt.vormerke(quittung);
            stand.value = {
                art: "fertig",
                serie: aktuell.modus === "serie",
                wiederholt: quittung.status === "replayed",
                quittung,
                folge,
                befunde: quittung.warnings
                    .filter((befund) => folge?.art !== "gelaende" || befund.code !== "terrain_stale")
                    .map((befund) => {
                        const key = `entwurf.befund.${befund.code}`;
                        return isMessageKey(key) ? t(key) : befund.message;
                    }),
            };
            optionen.zurueckgenommen?.(quittung);
            return;
        }
        const { status, fehler } = antwort;
        // Nichts geschrieben und nichts unklar: Die nächste Bestätigung bekommt eine neue Kennung. Unklar (Netz, 5xx): dieselbe darf wiederholt werden.
        const unklar = status === 0 || status >= AB_STATUS_UNKLAR;
        if (!unklar) offenerVersuch = undefined;
        if (status === 0) {
            stand.value = { art: "fehler", satz: t("aenderungen.ruecknahme.fehler.netz"), wiederholbar: true };
            return;
        }
        switch (fehler.code) {
            case "reason_required":
                stand.value = {
                    art: "fragt",
                    pruefung: { ...versuch.pruefung, reasonRequired: true },
                    hinweis: undefined,
                };
                return;
            case "forbidden":
                verboten.value = true;
                blockiere({ art: "verboten" });
                return;
            case "object_locked":
                blockiere({ art: "gesperrt", sperren: sperrenAus(fehler) });
                return;
            case "edit_conflict":
                optionen.neuLesen?.();
                blockiere({ art: "konflikt", konflikte: konflikteAus(fehler) });
                return;
            case "series_changed": {
                optionen.neuLesen?.();
                const neu = fehler.details?.["members"] as string[] | undefined;
                const hash = fehler.details?.["membersHash"] as string | undefined;
                if (neu !== undefined && neu.length > 0 && hash !== undefined) {
                    await frage(aktuell, neu, hash, true);
                    const jetzt = lies();
                    if (jetzt.art === "fragt") stand.value = { ...jetzt, hinweis: "serieGewachsen" };
                } else blockiere({ art: "ungueltig" });
                return;
            }
            case "already_reverted": {
                optionen.neuLesen?.();
                const durch = (
                    fehler.details?.["revertedBy"] as { operationId: string; at: string }[] | undefined
                )?.[0];
                blockiere({
                    art: "schon",
                    durch: durch === undefined ? undefined : { actor: undefined, at: durch.at },
                });
                return;
            }
            case "invalid_members":
                optionen.neuLesen?.();
                blockiere({ art: "ungueltig" });
                return;
            case "not_revertable": {
                const grund = (fehler.details?.["reason"] as "quelle" | "art" | "bereich" | undefined) ?? "art";
                blockiere({ art: "nicht", grund });
                return;
            }
            // WI-0265 B8d: die Antworten der Rücknahme des WikiSync, in der Sprache der Person.
            case "uebernahme_laeuft":
                stand.value = {
                    art: "fehler",
                    satz: t("aenderungen.ruecknahme.fehler.wikisyncLaeuft"),
                    wiederholbar: false,
                };
                return;
            // WI-0265 B8e: die Gegenrichtung der Regelvorschläge und die Zuweisung einer Fläche sagen, warum nichts zurückkam.
            case "nichts_wiederherzustellen":
                stand.value = {
                    art: "fehler",
                    satz: t("aenderungen.ruecknahme.fehler.wikisyncRegeln"),
                    wiederholbar: false,
                };
                return;
            case "nicht_zurueckgenommen":
                stand.value = {
                    art: "fehler",
                    satz: t("aenderungen.ruecknahme.fehler.wikisyncGilt"),
                    wiederholbar: false,
                };
                return;
            case "nicht_wiederherstellbar":
                stand.value = {
                    art: "fehler",
                    satz: t("aenderungen.ruecknahme.fehler.flaecheWiederherstellen"),
                    wiederholbar: false,
                };
                return;
            case "nicht_zuruecknehmbar":
                stand.value = {
                    art: "fehler",
                    satz: t("aenderungen.ruecknahme.fehler.flaecheGeaendert"),
                    wiederholbar: false,
                };
                return;
            case "reauth_required":
            case "assurance_required":
                stand.value = {
                    art: "fehler",
                    satz: t("aenderungen.ruecknahme.fehler.bestaetigung"),
                    wiederholbar: false,
                };
                return;
            default:
                stand.value = { art: "fehler", satz: fehler.message, wiederholbar: unklar };
        }
    }

    return {
        stand,
        verboten,
        async starte(neu) {
            angebot = neu;
            offenerVersuch = undefined;
            await frage(neu, neu.mitglieder, neu.membersHash, false);
        },
        async bestaetige(grund) {
            const jetzt = stand.value;
            if (jetzt.art !== "fragt" || angebot === undefined) return;
            const text = grund?.trim();
            if (jetzt.pruefung.reasonRequired && (text === undefined || text === "")) return;
            offenerVersuch = {
                operationId: neueKennung(),
                pruefung: jetzt.pruefung,
                grund: text === undefined || text === "" ? undefined : text,
            };
            await schreibe();
        },
        async nochmal() {
            const jetzt = stand.value;
            if (jetzt.art !== "fehler" || !jetzt.wiederholbar || offenerVersuch === undefined) return;
            await schreibe();
        },
        schliesse() {
            abbruch?.abort();
            offenerVersuch = undefined;
            stand.value = { art: "ruhe" };
        },
        destroy() {
            abbruch?.abort();
        },
    };
}
