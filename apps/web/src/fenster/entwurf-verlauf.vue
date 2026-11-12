<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { MapHistoryEntry, MapHistorySeries, RuecknahmeKonflikt, RuecknahmeReceipt } from "@avesmaps3d/shared";
import { zeilenAusFeldern } from "../aenderungen/aenderung-detail-modell";
import AenderungDetail from "../aenderungen/aenderung-detail.vue";
import { eintragsKreis, gruppiere, sprungGegenstand, type SerienZeile } from "../aenderungen/aenderung-modell";
import AenderungSerienDetail from "../aenderungen/aenderung-serien-detail.vue";
import AenderungZeile from "../aenderungen/aenderung-zeile.vue";
import AenderungZeilenkopf from "../aenderungen/aenderung-zeilenkopf.vue";
import { bezeichneMit } from "../aenderungen/aenderung-felder";
import { personKurz, quelleEtikett, serienAngaben, type ZeilenAngaben } from "../aenderungen/aenderung-zeile-modell";
import {
    angebotEinzeln,
    angebotSerie,
    konfliktGegenstand,
    type RuecknahmeAngebot,
} from "../aenderungen/aenderung-ruecknahme";
import { artName, kreisTitel } from "../aenderungen/aenderung-text";
import { vorgangVon } from "../aenderungen/aenderung-vorgang";
import { SPRUNG_SEITEN } from "../aenderungen/aenderungen-liste";
import { gilt, nimmZumObjektverlauf, springeZuAenderungen, sprungZumObjektverlauf } from "../aenderungen/sprung";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { locale, t } from "../i18n/i18n";
import type { Verlauf } from "./entwurf-verlauf";
import { istQuellenEintrag, protokollKennungen } from "./quellen-verlauf-modell";
import QuellenVerlaufEintrag from "./quellen-verlauf-eintrag.vue";
import { createQuellenVerlauf } from "./quellen-verlauf-steuerung";
import { kopfText } from "./quellen-verlauf-texte";
import type { TraegerZiel } from "./traeger-quellen-steuerung";

/**
 * Der Verlauf eines Objekts im Fenster (gemeinsamer Fensterrumpf; Rechnung `entwurf-verlauf.ts`, gehoben aus dem Verlauf des Ortseditors, der seit WI-0265 B6d
 * selbst darauf steht, `ortseditor/ort-verlauf.ts`): jede Operation, neueste zuerst, mit wann, wer, Quelle und Revision; aufgeklappt jedes Feld
 * alt → neu. ↺ nimmt eine Operation zurück, als neue Operation; geht es nicht, sagt der Eintrag warum. Ältere Einträge kommen seitenweise.
 * Die Namen der Felder und, wo nötig, ihre Werte gibt die Art (`feldName`, `wert`); ja/nein und leer stehen für alle gleich.
 * Nennt die Art Folgen eines ↺ (`folgen`, EDIT-0003 T54 und R13: etwa das Zurückholen eines gelöschten Gebiets samt Untergebieten), steht
 * vorher eine Rückfrage mit ihnen; ohne Angabe nimmt ↺ sofort zurück.
 *
 * **Zustand, Serien, Detail und Sprung** (WI-0265 B5a): Jeder Eintrag zeigt seinen Zustand (Kreis und Wort), eine Arbeitsserie steht als aufklappbare Gruppe da
 * ("Blutzinnen — 8 Änderungen"), und aufgeklappt zeigt der Eintrag das gemeinsame Detail (`aenderungen/aenderung-detail.vue`) mit den Tönen für Vorher und
 * Nachher. "⇄ In Änderungen zeigen" springt mit derselben `operationId` in den Reiter "Änderungen"; umgekehrt wählt der Sprung "Im Objektverlauf zeigen" hier
 * dieselbe Operation (`aenderungen/sprung.ts`). Das ↺ der Art bleibt, wie es war.
 *
 * **Zurücknehmen über den Server** (WI-0265 B5c): Nennt die Art für einen Eintrag eine Adresse (`verlauf.ruecknahmeZiel`: Derographie, Gipfel, Ort, Weg, Gebiet, Kraftlinie), steht im Detail des Eintrags
 * „↺ Diese Änderung zurücknehmen“ und im Detail der Serie „↺ Gesamte Serie zurücknehmen (n)“ (`aenderungen/aenderung-ruecknahme.vue`, dasselbe Bauteil wie im Reiter „Änderungen“).
 * Eine Bearbeitung im Fenster sperrt es mit Grund (T44). Nach der Rücknahme liest der Verlauf neu; „Konflikt prüfen“ springt in die „Änderungen“ zur späteren Änderung.
 *
 * **Neugestaltung** (WI-0265 B10, Vorlage `review/wi-0265/aenderungen-neu.html`): Jede Operation und jede Serie steht in DERSELBEN Zeile wie im Reiter „Änderungen“ (`aenderung-zeilenkopf.vue`: Kreis, Titel, Zeit / Person, Quelle, Felder, Revision;
 * der Zustand allein als Kreis, sein Wort im Tooltip), aufgeklappt im selben flachen Detail. Die Eintragszeile bleibt ein `<details>` mit `<summary>` (die Logik und die Kennungen bleiben); eine Serie öffnet mit EINEM Druck ihr Detail und ihre
 * Mitglieder.
 *
 * **Quellen** (WI-0254 §12): Mit `quellen` (das Objekt, das Recht `manage_sources`, das Schreibrecht des Editors) stehen die Änderungen an den Quellen des Objekts als lesbare Zeilen da („Quelle „Titel“ angehängt“) und haben
 * ein eigenes ↺ (`quellen-verlauf-eintrag.vue`). Ohne `quellen` (Weg, Kraftlinie) gibt es keine solchen Einträge oder kein ↺.
 */
const props = defineProps<{
    verlauf: Verlauf<unknown>;
    kennung: string;
    feldName: (feld: string) => string;
    wert?: ((feld: string, wert: unknown) => string | undefined) | undefined;
    /** Die Folgen eines ↺ als Titel und Satz; leer oder ohne Angabe: keine Rückfrage. */
    folgen?: ((eintrag: MapHistoryEntry) => readonly (readonly [string, string])[]) | undefined;
    /** Das Objekt, dessen Quellen der Verlauf zurücknehmen darf: Art und Kennung, das Recht `manage_sources`, das Schreibrecht des Editors. */
    quellen?: { readonly ziel: TraegerZiel; readonly recht: boolean; readonly schreibt: boolean } | undefined;
}>();
const quellenVerlauf = createQuellenVerlauf(() => props.quellen?.ziel, {
    eintraege: () => props.verlauf.eintraege.value,
    recht: () => props.quellen?.recht === true,
    schreibt: () => props.quellen?.schreibt === true,
    nach: () => void props.verlauf.lade(),
});
// Nach jedem Lesen des Verlaufs steht der Stand der Quellen neu da, gegen den ↺ misst.
watch(
    () => props.verlauf.eintraege.value,
    () => void quellenVerlauf.lese(),
);
const kopf = (eintrag: MapHistoryEntry): string =>
    kopfText(eintrag, protokollKennungen(props.quellen?.ziel)) ?? eintrag.summary ?? vorgangVon(eintrag);
/** Der Eintrag, dessen ↺ gerade nachgefragt wird. */
const frage = ref<string | undefined>(undefined);
function zuruecknehmen(eintrag: MapHistoryEntry): void {
    if ((props.folgen?.(eintrag).length ?? 0) > 0 && frage.value !== eintrag.operationId) {
        frage.value = eintrag.operationId;
        return;
    }
    frage.value = undefined;
    void props.verlauf.zuruecknehmen(eintrag);
}

onMounted(() => void props.verlauf.lade().then(pruefeSprung));

// --- Serien, Detail und Sprung (WI-0265 B5a) -----------------------------------------------------------------------------

const wurzel = ref<HTMLElement | null>(null);
const serienKarte = computed(
    () => new Map<string, MapHistorySeries>(props.verlauf.serien.value.map((serie) => [serie.id, serie])),
);
const zeilen = computed(() => gruppiere(props.verlauf.eintraege.value, serienKarte.value));
const offeneSerien = ref<ReadonlySet<string>>(new Set());
const gewaehlteSerie = ref<string | undefined>(undefined);
const offeneEintraege = ref<ReadonlySet<string>>(new Set());

type Flach =
    | { readonly art: "serie"; readonly zeile: SerienZeile }
    | { readonly art: "eintrag"; readonly eintrag: MapHistoryEntry; readonly mitglied: boolean };
/** Die Liste flach: eine Kopfzeile je Serie, aufgeklappt gefolgt von ihren Mitgliedern; alle anderen Einträge einzeln. */
const flach = computed<Flach[]>(() =>
    zeilen.value.flatMap((zeile): Flach[] =>
        zeile.art === "eintrag"
            ? [{ art: "eintrag", eintrag: zeile.eintrag, mitglied: false }]
            : [
                  { art: "serie", zeile },
                  ...(offeneSerien.value.has(zeile.id)
                      ? zeile.mitglieder.map((eintrag): Flach => ({ art: "eintrag", eintrag, mitglied: true }))
                      : []),
              ],
    ),
);

function umgeschaltet(menge: ReadonlySet<string>, id: string): Set<string> {
    const neu = new Set(menge);
    if (!neu.delete(id)) neu.add(id);
    return neu;
}
const schalteSerie = (id: string): void => {
    offeneSerien.value = umgeschaltet(offeneSerien.value, id);
};
function setzeOffen(eintrag: MapHistoryEntry, offen: boolean): void {
    if (offeneEintraege.value.has(eintrag.operationId) === offen) return;
    offeneEintraege.value = umgeschaltet(offeneEintraege.value, eintrag.operationId);
}
const detailZeilen = (eintrag: MapHistoryEntry) =>
    zeilenAusFeldern(props.verlauf.felder(eintrag), props.verlauf.gegenstaende(eintrag));
const titelOhneGegenstand = (eintrag: MapHistoryEntry): string =>
    eintrag.series === undefined
        ? kopf(eintrag)
        : `${t("aenderungen.serie.schritt", { nr: eintrag.series.position, gesamt: eintrag.series.size })}: ${kopf(eintrag).replace(/^[^:]+:\s*/, "")}`;

/** "⇄ In Änderungen zeigen": derselbe Eintrag (oder dieselbe Serie), das Objekt als Filter. */
function zuAenderungen(operationId: string, eintrag: MapHistoryEntry): void {
    const gegenstand = props.verlauf.gegenstaende(eintrag)[0] ?? sprungGegenstand(eintrag);
    springeZuAenderungen({
        operationId,
        ...(gegenstand === undefined
            ? {}
            : {
                  objekt: {
                      kind: gegenstand.kind,
                      id: gegenstand.id,
                      name: gegenstand.name ?? artName(gegenstand.kind),
                  },
              }),
    });
}
/** Die Zeile eines Eintrags im Verlauf: dieselben Angaben wie im Reiter, mit den Feldnamen der Art, dem Datum und der Revision. */
function eintragsAngaben(eintrag: MapHistoryEntry, mitglied: boolean, quellenEintrag: boolean): ZeilenAngaben {
    const kreis = eintragsKreis(eintrag.status);
    const felder = [
        ...new Set(props.verlauf.felder(eintrag).map((feld) => bezeichneMit(props.feldName, feld.feld).text)),
    ].join(", ");
    return {
        kreis,
        kreisName: kreis === undefined ? "" : kreisTitel(kreis),
        titel: quellenEintrag
            ? kopf(eintrag)
            : mitglied
              ? titelOhneGegenstand(eintrag)
              : (eintrag.summary ?? vorgangVon(eintrag)),
        zeit: zeit(eintrag.at),
        person: personKurz(eintrag.actor),
        bereich: undefined,
        etikett: quelleEtikett(eintrag),
        felder,
        objekte: undefined,
        hinweis: revisionText(eintrag) || undefined,
    };
}
/** Die Zeile einer Serie im Verlauf: wie im Reiter, mit den Feldnamen der Art. */
const serienZeile = (zeile: SerienZeile): ZeilenAngaben => ({
    ...serienAngaben(zeile, { meine: false }),
    felder: serienFelder(zeile),
});
/** Ein Druck auf die Serie öffnet ihr Detail UND ihre Mitglieder (im Reiter ist es dieselbe Zeile). */
function klappeSerie(id: string): void {
    const auf = gewaehlteSerie.value !== id;
    gewaehlteSerie.value = auf ? id : undefined;
    if (offeneSerien.value.has(id) !== auf) schalteSerie(id);
}
const serienFelder = (zeile: SerienZeile): string =>
    [
        ...new Set(
            zeile.mitglieder.flatMap((mitglied) =>
                props.verlauf.felder(mitglied).map((feld) => bezeichneMit(props.feldName, feld.feld).text),
            ),
        ),
    ].join(", ");

/**
 * Ob diese Liste eine Kennung kennt (die Serie oder die Operation). Nur lesend: Das Detail fragt beim Zeichnen, ob es den Knopf zu einer Rücknahme
 * („Nimmt zurück:“, „Rücknahme ansehen“) zeigt. 🔴 Hier stand `zeigeKennung`, das beim Zeichnen aufklappt und damit neu zeichnen lässt: Jeder Eintrag
 * mit Rücknahmebezug fror den Browser ein (im Produktionsbau ohne Vues Rekursionsgrenze), direkt nach jedem ↺ im Fenster.
 */
const kenntKennung = (operationId: string): boolean =>
    zeilen.value.some((zeile) => zeile.art === "serie" && zeile.id === operationId) ||
    props.verlauf.eintraege.value.some((eintrag) => eintrag.operationId === operationId);

/** Wählt, was zu einer Kennung gehört (die Serie oder die Operation); `false`, wenn diese Liste sie nicht kennt. Nur auf einen Klick, nie beim Zeichnen. */
function zeigeKennung(operationId: string): boolean {
    const serie = zeilen.value.find((zeile): zeile is SerienZeile => zeile.art === "serie" && zeile.id === operationId);
    const eintrag = props.verlauf.eintraege.value.find((kandidat) => kandidat.operationId === operationId);
    if (serie === undefined && eintrag === undefined) return false;
    if (serie !== undefined) {
        gewaehlteSerie.value = serie.id;
        offeneSerien.value = new Set(offeneSerien.value).add(serie.id);
    } else if (eintrag !== undefined) {
        if (eintrag.series !== undefined) offeneSerien.value = new Set(offeneSerien.value).add(eintrag.series.id);
        offeneEintraege.value = new Set(offeneEintraege.value).add(eintrag.operationId);
    }
    void nextTick(() =>
        wurzel.value
            ?.querySelector(`[data-aenderung-id="${CSS.escape(operationId)}"]`)
            ?.scrollIntoView({ block: "nearest", behavior: "auto" }),
    );
    return true;
}

/** Ein wartender Sprung "Im Objektverlauf zeigen": gehört die Operation zu diesem Objekt, wird sie gewählt; sonst bleibt der Sprung für den richtigen Verlauf liegen. */
async function pruefeSprung(): Promise<void> {
    const sprung = sprungZumObjektverlauf.value;
    if (sprung === undefined || !gilt(sprung.seit)) return;
    for (let seiten = 0; seiten < SPRUNG_SEITEN; seiten += 1) {
        if (zeigeKennung(sprung.operationId)) {
            nimmZumObjektverlauf();
            return;
        }
        if (!props.verlauf.mehrDa.value) return;
        await props.verlauf.lade(true);
    }
}
watch(sprungZumObjektverlauf, (sprung) => {
    if (sprung !== undefined) void pruefeSprung();
});

// --- Zurücknehmen über den Server (B5c) ----------------------------------------------------------------------------------

/** Die Serie, zu der ein Eintrag gehört, soweit dieser Verlauf sie kennt. */
const serieDesEintrags = (eintrag: MapHistoryEntry): SerienZeile | undefined =>
    eintrag.series === undefined
        ? undefined
        : zeilen.value.find((zeile): zeile is SerienZeile => zeile.art === "serie" && zeile.id === eintrag.series?.id);
/** Das ↺ des Servers an einem Eintrag; ohne Adresse der Art gilt das ↺ der Art. */
const angebotFuer = (eintrag: MapHistoryEntry): RuecknahmeAngebot | undefined =>
    angebotEinzeln(eintrag, props.verlauf.ruecknahmeZiel(eintrag), serieDesEintrags(eintrag)?.mitglieder ?? []);
const angebotFuerSerie = (zeile: SerienZeile): RuecknahmeAngebot | undefined =>
    angebotSerie(zeile, props.verlauf.ruecknahmeZiel(zeile.mitglieder[0]!));
/** Der Server hat zurückgenommen: Bearbeitung und Verlauf lesen neu, die Karte zieht nach. */
const nachRuecknahme = (quittung: RuecknahmeReceipt): void => void props.verlauf.nachRuecknahme(quittung);
/** „Konflikt prüfen“: die spätere Änderung in den „Änderungen“, mit dem Gegenstand als Filter. */
function pruefeKonflikt(konflikt: RuecknahmeKonflikt, ziel: RuecknahmeAngebot["ziel"]): void {
    const gegenstand = konfliktGegenstand(konflikt, ziel);
    // Ohne eigene Operation des Konflikts (Revision, Wert) zeigt der Sprung den neuesten Eintrag dieses Verlaufs.
    const operationId = konflikt.operationId ?? props.verlauf.eintraege.value[0]?.operationId;
    if (operationId === undefined) return;
    springeZuAenderungen({
        operationId,
        objekt: { ...gegenstand, name: gegenstand.name ?? artName(gegenstand.kind) },
    });
}

const zeit = (at: string): string =>
    new Date(at).toLocaleString(locale.value, { dateStyle: "medium", timeStyle: "short" });
function revisionText(eintrag: MapHistoryEntry): string {
    const r = props.verlauf.revision(eintrag);
    if (r === undefined) return "";
    return r.vor === null
        ? t("verlauf.revisionNeu", { nach: String(r.nach) })
        : t("verlauf.revision", { vor: String(r.vor), nach: String(r.nach) });
}
function konfliktText(eintrag: MapHistoryEntry): string | undefined {
    const plan = props.verlauf.ruecknahme(eintrag);
    if (plan?.art !== "konflikt") return undefined;
    return t("verlauf.konflikt", { felder: plan.felder.map(props.feldName).join(", ") });
}
const gesperrt = (): string | undefined =>
    props.verlauf.gesperrt.value === "sendet"
        ? t("verlauf.gesperrtSendet")
        : props.verlauf.gesperrt.value === "bearbeitung"
          ? t("verlauf.gesperrtBearbeitung")
          : undefined;
</script>

<template>
    <div ref="wurzel" class="verlauf" :data-testid="`${kennung}-verlauf`">
        <p v-if="verlauf.fehler.value" class="verlauf__leise">{{ t("verlauf.fehler") }}</p>
        <p v-else-if="!verlauf.laedt.value && verlauf.eintraege.value.length === 0" class="verlauf__leise">
            {{ t("verlauf.leer") }}
        </p>
        <ol class="verlauf__liste">
            <template
                v-for="zeile in flach"
                :key="zeile.art === 'serie' ? `serie:${zeile.zeile.id}` : zeile.eintrag.operationId"
            >
                <li
                    v-if="zeile.art === 'serie'"
                    class="verlauf__eintrag verlauf__serie"
                    :data-aenderung-id="zeile.zeile.id"
                    :data-testid="`${kennung}-verlauf-serie`"
                >
                    <AenderungZeile
                        :angaben="serienZeile(zeile.zeile)"
                        :offen="gewaehlteSerie === zeile.zeile.id"
                        :testid="`${kennung}-verlauf-serie-zeile`"
                        @waehle="klappeSerie(zeile.zeile.id)"
                    />
                    <div v-if="gewaehlteSerie === zeile.zeile.id" class="verlauf__detail">
                        <AenderungSerienDetail
                            :zeile="zeile.zeile"
                            :kennung="kennung"
                            :feld-name="feldName"
                            :wert="wert"
                            sprung="aenderungen"
                            :ruecknahme="angebotFuerSerie(zeile.zeile)"
                            :fenstergesperrt="gesperrt()"
                            @zurueckgenommen="nachRuecknahme"
                            @neu-lesen="verlauf.lade()"
                            @konflikt-pruefen="pruefeKonflikt"
                            @sprung="zuAenderungen(zeile.zeile.id, zeile.zeile.mitglieder[0]!)"
                        />
                    </div>
                </li>
                <li
                    v-else
                    class="verlauf__eintrag"
                    :class="{ 'verlauf__eintrag--mitglied': zeile.mitglied }"
                    :data-aenderung-id="zeile.eintrag.operationId"
                    :data-testid="`${kennung}-verlauf-eintrag`"
                >
                    <div v-if="istQuellenEintrag(zeile.eintrag)" class="verlauf__kopf verlauf__kopf--quelle">
                        <AenderungZeilenkopf
                            :angaben="eintragsAngaben(zeile.eintrag, zeile.mitglied, true)"
                            :offen="false"
                        />
                    </div>
                    <details
                        v-else
                        :open="offeneEintraege.has(zeile.eintrag.operationId)"
                        @toggle="setzeOffen(zeile.eintrag, ($event.target as HTMLDetailsElement).open)"
                    >
                        <summary class="verlauf__kopf">
                            <AenderungZeilenkopf
                                :angaben="eintragsAngaben(zeile.eintrag, zeile.mitglied, false)"
                                :offen="offeneEintraege.has(zeile.eintrag.operationId)"
                            />
                        </summary>
                        <div v-if="offeneEintraege.has(zeile.eintrag.operationId)" class="verlauf__detail">
                            <AenderungDetail
                                :eintrag="zeile.eintrag"
                                :kennung="kennung"
                                :zeilen="detailZeilen(zeile.eintrag)"
                                :feld-name="feldName"
                                :wert="wert"
                                sprung="aenderungen"
                                :kennt="kenntKennung"
                                :ruecknahme="angebotFuer(zeile.eintrag)"
                                :fenstergesperrt="gesperrt()"
                                @zurueckgenommen="nachRuecknahme"
                                @neu-lesen="verlauf.lade()"
                                @konflikt-pruefen="pruefeKonflikt"
                                @sprung="zuAenderungen(zeile.eintrag.operationId, zeile.eintrag)"
                                @zeige="zeigeKennung"
                            />
                        </div>
                    </details>
                    <QuellenVerlaufEintrag
                        v-if="quellen && istQuellenEintrag(zeile.eintrag)"
                        :eintrag="zeile.eintrag"
                        :traeger-id="protokollKennungen(quellen.ziel) ?? quellen.ziel.id"
                        :verlauf="quellenVerlauf"
                        :kennung="kennung"
                    />
                    <AvmBestaetigung
                        v-if="frage === zeile.eintrag.operationId && verlauf.ruecknahme(zeile.eintrag)?.art === 'geht'"
                        :frage="t('verlauf.frage')"
                        :bestaetigen="t('verlauf.zurueck')"
                        :gesperrt="gesperrt()"
                        :testid="`${kennung}-verlauf-frage`"
                        @bestaetigen="zuruecknehmen(zeile.eintrag)"
                        @abbrechen="frage = undefined"
                    >
                        <ul class="verlauf__folgen">
                            <li v-for="([titel, satz], i) in folgen?.(zeile.eintrag) ?? []" :key="i">
                                <b>{{ titel }}:</b> {{ satz }}
                            </li>
                        </ul>
                    </AvmBestaetigung>
                    <div v-else-if="verlauf.ruecknahme(zeile.eintrag)?.art === 'geht'" class="verlauf__knoepfe">
                        <AvmKnopf
                            groesse="zeile"
                            :gesperrt="gesperrt()"
                            :testid="`${kennung}-verlauf-zurueck`"
                            @click="zuruecknehmen(zeile.eintrag)"
                        >
                            {{ t("verlauf.zurueck") }}
                        </AvmKnopf>
                    </div>
                    <p
                        v-else-if="konfliktText(zeile.eintrag)"
                        class="verlauf__leise"
                        :data-testid="`${kennung}-verlauf-konflikt`"
                    >
                        {{ konfliktText(zeile.eintrag) }}
                    </p>
                    <p
                        v-if="verlauf.meldung.value?.operationId === zeile.eintrag.operationId"
                        class="verlauf__meldung"
                        role="alert"
                        :data-testid="`${kennung}-verlauf-meldung`"
                    >
                        {{ verlauf.meldung.value.satz }}
                    </p>
                </li>
            </template>
        </ol>
        <AvmKnopf
            v-if="verlauf.mehrDa.value"
            groesse="zeile"
            :gesperrt="verlauf.laedt.value ? t('verlauf.laedt') : undefined"
            :testid="`${kennung}-verlauf-mehr`"
            @click="verlauf.lade(true)"
        >
            {{ t("verlauf.mehr") }}
        </AvmKnopf>
    </div>
</template>

<style scoped>
.verlauf {
    display: grid;
    gap: var(--space-8);
}

.verlauf__liste {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
}

.verlauf__eintrag {
    display: grid;
    border-bottom: 1px solid var(--color-border);
}

/* Die Zeile: wie im Reiter „Änderungen“ (höchstens zwei Zeilen); das `summary` trägt sie, ohne das Dreieck des Browsers. */
.verlauf__kopf {
    display: block;
    padding: var(--space-4) 0;
    cursor: pointer;
    list-style: none;
}

.verlauf__kopf--quelle {
    cursor: default;
}

.verlauf__kopf::-webkit-details-marker {
    display: none;
}

.verlauf__kopf:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.verlauf__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.verlauf__detail {
    margin-bottom: var(--space-4);
}

/* Ein Mitglied einer aufgeklappten Serie: eingerückt unter der Kopfzeile. */
.verlauf__eintrag--mitglied {
    margin-left: var(--space-16);
}

.verlauf__serie :deep(.z__kopf) {
    padding-inline: 0;
}

.verlauf__knoepfe {
    display: flex;
    gap: var(--space-8);
    padding-bottom: var(--space-4);
}

.verlauf__meldung {
    margin: 0;
    color: var(--color-danger);
}

.verlauf__folgen {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-12);
}
</style>
