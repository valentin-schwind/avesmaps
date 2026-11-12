<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { MapHistoryEntry, MapHistoryObject, RuecknahmeKonflikt, RuecknahmeReceipt } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { formatNumber, t } from "../i18n/i18n";
import { serienDetail } from "./aenderung-detail-modell";
import { GEBIRGE_PRAEFIX, serienEnden, serienGroesse, sprungGegenstand, type SerienZeile } from "./aenderung-modell";
import { feldBezeichnung, feldWert, bezeichneMit, nurFormGeaendert, type Bezeichnung } from "./aenderung-felder";
import { hatBild, hatKartenFelder, kartenBild } from "./aenderung-karte-modell";
import { besitzerSerie, karteTitel, statusText, vergissStatus, zeigeKarteFuer } from "./aenderung-karte-zeigen";
import { kartenHinweisTexte } from "./aenderung-karte-text";
import { kannLageHaben, lageFrage } from "./aenderung-lage-modell";
import { artName, zeitMitZone } from "./aenderung-text";
import AenderungGriffe from "./aenderung-griffe.vue";
import AenderungKennung from "./aenderung-kennung.vue";
import AenderungRuecknahme from "./aenderung-ruecknahme.vue";
import AenderungTafel from "./aenderung-tafel.vue";
import { sichtbareGegenstaende, type TafelGegenstand } from "./aenderung-tafel";
import type { RuecknahmeAngebot } from "./aenderung-ruecknahme";
import type { RuecknahmeDaten } from "./aenderung-ruecknahme-daten";
import { createAenderungenDaten, type AenderungenDaten } from "./aenderungen-daten";
import { schliesseKarteFuer, warteBis, zeigtKarte } from "./karte-ablage";

/**
 * Das Detail einer Arbeitsserie (WI-0265 §1.4, Probierseite Szene 2): **Vorher vor dem ersten, Nachher nach dem letzten „Fertig“**, je
 * Gegenstand und Feld, nicht acht einzelne Karten. Die einzelnen „Fertig“ stehen darunter in der Liste, jedes mit eigener Uhrzeit und
 * eigenem Detail. Werte, die die Liste weglässt, lädt es für genau die Mitglieder nach, deren Wert eine Zeile braucht (das erste und das letzte,
 * das das Feld änderte), nicht für alle.
 *
 * Eine Serie, von der nur ein Teil zum Filter passt, sagt es: Vorher und Nachher gelten dann für die gelieferten Mitglieder.
 *
 * **Neugestaltung (WI-0265 B10, Vorlage `review/wi-0265/aenderungen-neu.html`):** Dasselbe flache Detail wie bei einer Änderung (getönte Fläche, Schiene links in der Akzentfarbe, ohne Kasten und Radius): oben die Griffleiste mit
 * „↺ Serie zurücknehmen (n)“ und den Zeichen ⊕ ⚙ ⌕, dann die Rückfrage, die Tafel der ganzen Serie, unten die Kennung. Die Mitglieder stehen im Slot, als Zwei-Zeilen-Zeilen an einer Schiene (der Aufrufer zeichnet sie).
 *
 * **Zurücknehmen (B5c, Szene 2):** Mit einem `ruecknahme`-Angebot steht „↺ Serie zurücknehmen (n)“ in der Griffleiste (`aenderung-ruecknahme.vue`): EINE Rücknahme für die ganze Serie,
 * mit Vorprüfung, Rückfrage und, bei einer Fremdänderung am Gegenstand, der Konfliktliste ohne Teilrücknahme.
 *
 * **Auf der Karte (B5b, Szene 2):** „⊕ Auf der Karte zeigen“ legt dasselbe Vorher (vor dem ersten „Fertig“) und Nachher (nach dem letzten) als Überlagerung
 * auf die Karte; die Sätze zu den Lücken im Protokoll stehen darunter. Das Schließen des Details nimmt die eigene Überlagerung wieder weg.
 * **Für jede Serie (B9):** Trägt das Protokoll keine Lage (ein Feld, eine Quelle), fliegt der Knopf dorthin, wo die Gegenstände aller Mitglieder heute liegen (`aenderung-karte-zeigen.ts`, Route `/lage` mit allen Mitgliedern).
 */
const props = defineProps<{
    zeile: SerienZeile;
    kennung: string;
    feldName?: ((feld: string) => string) | undefined;
    wert?: ((feld: string, wert: unknown) => string | undefined) | undefined;
    sprung?: "objekt" | "aenderungen" | undefined;
    nurObjekt?: boolean | undefined;
    daten?: AenderungenDaten | undefined;
    /** Das ↺ der ganzen Serie (B5c); ohne Angebot kennt der Server diese Art noch nicht. */
    ruecknahme?: RuecknahmeAngebot | undefined;
    /** Warum das Fenster gerade nicht zurücknehmen lässt (eine Bearbeitung läuft). */
    fenstergesperrt?: string | undefined;
    ruecknahmeDaten?: RuecknahmeDaten | undefined;
    /** Eine Zahl über Null, die wächst: Das ↺ am Zeilenende bittet, die Rückfrage zu öffnen (`angestossen` quittiert). */
    anstoss?: number | undefined;
}>();
const emit = defineEmits<{
    sprung: [];
    nurObjekt: [gegenstand: MapHistoryObject];
    zurueckgenommen: [quittung: RuecknahmeReceipt];
    neuLesen: [];
    konfliktPruefen: [konflikt: RuecknahmeKonflikt, ziel: RuecknahmeAngebot["ziel"]];
    angestossen: [];
}>();
defineSlots<{ default?(): unknown }>();

/** So viele Mitglieder einer Serie lädt das Detail gleichzeitig nach. */
const NACHLADEN_GLEICHZEITIG = 6;
const daten = props.daten ?? createAenderungenDaten();
/** Die Mitglieder vom ältesten zum neuesten. */
const mitglieder = computed(() => [...props.zeile.mitglieder].reverse());
const enden = computed(() => serienEnden(props.zeile));
const geladen = shallowRef<ReadonlyMap<string, MapHistoryEntry>>(new Map());
const laedt = ref(false);
const ladefehler = ref(false);
let abbruch: AbortController | undefined;

const detail = computed(() => serienDetail(mitglieder.value, geladen.value));

async function ladeFehlende(): Promise<void> {
    const noetig = detail.value.fehlend;
    if (noetig.length === 0) return;
    abbruch?.abort();
    const eigene = new AbortController();
    abbruch = eigene;
    laedt.value = true;
    ladefehler.value = false;
    try {
        // Höchstens ein paar Fragen gleichzeitig: Ein Gebirge braucht jedes Mitglied, und eine Serie hat bis zu hundert.
        const antworten: (MapHistoryEntry | null)[] = [];
        for (let i = 0; i < noetig.length; i += NACHLADEN_GLEICHZEITIG)
            antworten.push(
                ...(await Promise.all(
                    noetig.slice(i, i + NACHLADEN_GLEICHZEITIG).map((id) => daten.detail(id, eigene.signal)),
                )),
            );
        if (eigene.signal.aborted) return;
        const neu = new Map(geladen.value);
        noetig.forEach((id, i) => {
            const antwort = antworten[i];
            const roh = mitglieder.value.find((m) => m.operationId === id);
            if (antwort && roh) neu.set(id, { ...roh, objects: antwort.objects });
            else ladefehler.value = true;
        });
        geladen.value = neu;
    } catch {
        if (!eigene.signal.aborted) ladefehler.value = true;
    } finally {
        if (abbruch === eigene) laedt.value = false;
    }
}
/** Die Frage nach der Lage (B9), eigene Abbruchkennung. */
let lageAbbruch: AbortController | undefined;
/** Wer diese Überlagerung auf der Karte besitzt: dieses Detail, diese Serie. */
const besitzerVon = (serie: string): string => besitzerSerie(props.kennung, serie);
watch(
    () => [props.zeile.id, props.zeile.mitglieder.length] as const,
    ([serie], alt) => {
        if (alt !== undefined && alt[0] !== serie) {
            schliesseKarteFuer(besitzerVon(alt[0]));
            vergissStatus(besitzerVon(alt[0]));
        }
        lageAbbruch?.abort();
        geladen.value = new Map();
        void ladeFehlende();
    },
    { immediate: true },
);
let abgeraeumt = false;
onBeforeUnmount(() => {
    abgeraeumt = true;
    abbruch?.abort();
    lageAbbruch?.abort();
    schliesseKarteFuer(besitzerVon(props.zeile.id));
    vergissStatus(besitzerVon(props.zeile.id));
});

// --- Auf der Karte zeigen -----------------------------------------------------------------------------------------------

/** Jede Serie mit Gegenständen kann einen Ort haben (B9): im Protokoll oder, wenn dort keiner steht, in der Datenbank. */
const kannKarte = computed(() => kannLageHaben(detail.value.gegenstaende));
const karteBild = computed(() => kartenBild(detail.value.gegenstaende));
/** Die Sätze zu den Lücken im Protokoll, sobald es etwas zu zeigen gibt. */
const karteHinweise = computed(() => (hatBild(karteBild.value) ? kartenHinweisTexte(karteBild.value.hinweise) : []));
const aufKarte = computed(() => zeigtKarte(besitzerVon(props.zeile.id)));
const karteGriff = computed(() =>
    kannKarte.value
        ? {
              titel: karteTitel(besitzerVon(props.zeile.id)),
              gedrueckt: aufKarte.value,
              status: statusText(besitzerVon(props.zeile.id)),
          }
        : undefined,
);

async function zeigeKarte(): Promise<void> {
    const serie = props.zeile.id;
    await zeigeKarteFuer(besitzerVon(serie), {
        async gegenstaende() {
            // Nur Lage-Felder brauchen die Geometrie, die die Liste weglässt; das Detail lädt für genau die Mitglieder nach, deren Wert eine Zeile braucht. Auf sie wartet das Zeigen.
            if (!hatKartenFelder(detail.value.gegenstaende)) return detail.value.gegenstaende;
            if (laedt.value) await warteBis(() => !laedt.value);
            else if (detail.value.fehlend.length > 0) await ladeFehlende();
            return ladefehler.value ? undefined : detail.value.gegenstaende;
        },
        async lage() {
            const frage = lageFrage(props.zeile.mitglieder.map((m) => m.operationId));
            if (frage === undefined) return null;
            lageAbbruch?.abort();
            const eigene = new AbortController();
            lageAbbruch = eigene;
            try {
                return await daten.lage(frage.operationId, frage.mit, eigene.signal);
            } catch {
                return undefined;
            }
        },
        gilt: () => !abgeraeumt && props.zeile.id === serie,
    });
}

const groesse = computed(() => serienGroesse(props.zeile));
/** „Nur die Form ist anders“, wo Vorher und Nachher als Text gleich lauten, die Werte aber nicht. */
const hinweisVon = (
    zeile: { feld: string; vorher: unknown; nachher: unknown },
    kind: MapHistoryObject["kind"],
): string | undefined =>
    nurFormGeaendert(
        wertVon(zeile.feld, zeile.vorher, kind),
        wertVon(zeile.feld, zeile.nachher, kind),
        zeile.vorher,
        zeile.nachher,
    )
        ? t("aenderungen.detail.nurForm")
        : undefined;
const bezeichnung = (feld: string, kind: MapHistoryObject["kind"]): Bezeichnung =>
    props.feldName === undefined ? feldBezeichnung(kind, feld) : bezeichneMit(props.feldName, feld);
const wertVon = (feld: string, wert: unknown, kind: MapHistoryObject["kind"]): string | undefined =>
    (feld.startsWith(GEBIRGE_PRAEFIX) ? undefined : props.wert?.(feld, wert)) ?? feldWert(kind, feld, wert);
const vorherNachher = computed(() =>
    t("aenderungen.serie.vorherNachher", {
        von: zeitMitZone(enden.value.erstes.at),
        bis: zeitMitZone(enden.value.letztes.at),
    }),
);
const nurGelieferte = computed(() =>
    props.zeile.mitglieder.length < groesse.value
        ? t("aenderungen.serie.nurGelieferte", {
              n: formatNumber(props.zeile.mitglieder.length, 0),
              gesamt: formatNumber(groesse.value, 0),
          })
        : undefined,
);
const keineFelder = computed(() => detail.value.gegenstaende.every((g) => g.zeilen.length === 0));
/** Wie oft „n weitere“ gedrückt wurde. */
const mehrSchritte = ref(0);
watch(
    () => props.zeile.id,
    () => {
        mehrSchritte.value = 0;
    },
);
/** Die Tafel: nur die Gegenstände, die zu sehen sind, werden zu Worten gemacht. */
const tafel = computed(() => {
    const geschnitten = sichtbareGegenstaende(detail.value.gegenstaende, mehrSchritte.value);
    return {
        weitere: geschnitten.weitere,
        gegenstaende: geschnitten.sichtbar.map((gegenstand): TafelGegenstand => ({
            schluessel: `${gegenstand.kind}:${gegenstand.id}`,
            art: artName(gegenstand.kind),
            name: gegenstand.name ?? "–",
            revision: undefined,
            zeilen: gegenstand.zeilen.map((feld) => {
                const name = bezeichnung(feld.feld, gegenstand.kind);
                return {
                    feld: feld.feld,
                    bezeichnung: name.text,
                    schluessel: name.schluessel,
                    vorher: wertVon(feld.feld, feld.vorher, gegenstand.kind),
                    nachher: wertVon(feld.feld, feld.nachher, gegenstand.kind),
                    formFehlt: feld.formFehlt,
                    laedt: feld.omitted && laedt.value,
                    hinweis: hinweisVon(feld, gegenstand.kind),
                };
            }),
        })),
    };
});
const zeigtSprung = computed(
    () =>
        props.sprung === "aenderungen" ||
        (props.sprung === "objekt" && sprungGegenstand(enden.value.letztes) !== undefined),
);
const nurObjektVon = computed(() => (props.nurObjekt === true ? enden.value.letztes.objects[0] : undefined));
</script>

<template>
    <div class="serien-detail" :data-testid="`${kennung}-serien-detail`">
        <AenderungRuecknahme
            :angebot="ruecknahme"
            :kennung="kennung"
            :fenstergesperrt="fenstergesperrt"
            :daten="ruecknahmeDaten"
            :anstoss="anstoss"
            @zurueckgenommen="emit('zurueckgenommen', $event)"
            @neu-lesen="emit('neuLesen')"
            @konflikt-pruefen="(konflikt, ziel) => emit('konfliktPruefen', konflikt, ziel)"
            @angestossen="emit('angestossen')"
        >
            <template #zeichen>
                <AenderungGriffe
                    :kennung="kennung"
                    :karte="karteGriff"
                    :sprung="zeigtSprung ? sprung : undefined"
                    :nur-objekt="nurObjektVon !== undefined"
                    @karte="zeigeKarte()"
                    @sprung="emit('sprung')"
                    @nur-objekt="nurObjektVon && emit('nurObjekt', nurObjektVon)"
                />
            </template>
        </AenderungRuecknahme>

        <p class="serien-detail__leise" data-testid="aenderung-serie-vorher-nachher">{{ vorherNachher }}</p>
        <p v-if="nurGelieferte" class="serien-detail__leise">{{ nurGelieferte }}</p>
        <p v-if="zeile.meta?.continues" class="serien-detail__leise">{{ t("aenderungen.serie.setztFort") }}</p>

        <p v-if="laedt" class="serien-detail__leise" role="status">{{ t("aenderungen.detail.laedt") }}</p>
        <div v-if="ladefehler" class="serien-detail__hinweis" role="alert">
            {{ t("aenderungen.detail.ladefehler") }}
            <AvmKnopf groesse="zeile" @click="ladeFehlende()">{{ t("aenderungen.detail.nochmal") }}</AvmKnopf>
        </div>

        <p v-if="keineFelder && !laedt" class="serien-detail__leise">{{ t("aenderungen.detail.keineFelder") }}</p>
        <AenderungTafel v-else :gegenstaende="tafel.gegenstaende" :weitere="tafel.weitere" @mehr="mehrSchritte += 1" />
        <p v-for="satz in karteHinweise" :key="satz" class="serien-detail__leise" data-testid="aenderung-karte-hinweis">
            {{ satz }}
        </p>

        <p class="serien-detail__fuss">
            <AenderungKennung :id="zeile.id" :kennung="kennung" testid="aenderung-serie-kennung" />
        </p>

        <slot />
    </div>
</template>

<style scoped>
/* Flach wie das Detail einer Änderung: getönte Fläche in voller Breite, links die Schiene in der Akzentfarbe, kein Kasten, kein Radius. */
.serien-detail {
    display: grid;
    gap: var(--space-8);
    min-width: 0;
    margin: 0;
    padding: var(--space-8) var(--space-10) var(--space-8) var(--space-8);
    border-left: var(--avm-fenster-schiene-kante) solid var(--color-accent);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
    hyphens: manual;
}

.serien-detail p {
    margin: 0;
}

.serien-detail__leise {
    color: var(--color-text-muted);
}

.serien-detail__hinweis {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.serien-detail__fuss {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
