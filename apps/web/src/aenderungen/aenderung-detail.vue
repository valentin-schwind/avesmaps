<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { MapHistoryEntry, MapHistoryObject, RuecknahmeKonflikt, RuecknahmeReceipt } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import {
    brauchtDetail,
    detailGegenstaende,
    mitDetail,
    type DetailGegenstand,
    type DetailZeile,
} from "./aenderung-detail-modell";
import { sprungGegenstand } from "./aenderung-modell";
import { feldBezeichnung, feldWert, bezeichneMit, nurFormGeaendert, type Bezeichnung } from "./aenderung-felder";
import { hatBild, hatKartenFelder, kartenBild } from "./aenderung-karte-modell";
import { besitzerEintrag, karteTitel, statusText, vergissStatus, zeigeKarteFuer } from "./aenderung-karte-zeigen";
import { kartenHinweisTexte } from "./aenderung-karte-text";
import { kannLageHaben } from "./aenderung-lage-modell";
import {
    artName,
    kreisName,
    kurzeKennung,
    nichtRuecknehmbarSatz,
    wer,
    zeilenZeit,
    zeitMitZone,
} from "./aenderung-text";
import { herkunftVon, oeffneHerkunft } from "./aenderung-herkunft";
import { redaktion } from "../community/redaktion";
import { GEBIRGE_PRAEFIX } from "./aenderung-modell";
import AenderungGriffe from "./aenderung-griffe.vue";
import AenderungKennung from "./aenderung-kennung.vue";
import AenderungKreis from "./aenderung-kreis.vue";
import AenderungRuecknahme from "./aenderung-ruecknahme.vue";
import AenderungTafel from "./aenderung-tafel.vue";
import { sichtbareGegenstaende, type TafelGegenstand } from "./aenderung-tafel";
import type { RuecknahmeAngebot } from "./aenderung-ruecknahme";
import type { RuecknahmeDaten } from "./aenderung-ruecknahme-daten";
import { vorgangSchluessel, vorgangVon } from "./aenderung-vorgang";
import { createAenderungenDaten, type AenderungenDaten } from "./aenderungen-daten";
import { schliesseKarteFuer, warteBis, zeigtKarte } from "./karte-ablage";

/**
 * Das gemeinsame Detail einer Änderung (WI-0265 B5a; Probierseite Szene 4 und 5): EIN Bauteil für den Reiter „Änderungen“ und für den
 * Objektverlauf, damit dieselbe Operation an beiden Stellen dieselben Angaben trägt (U12).
 *
 * **Neugestaltung (WI-0265 B10, Vorlage `review/wi-0265/aenderungen-neu.html`):** Das Detail ist FLACH: eine leicht getönte Fläche in voller Listenbreite direkt unter der Zeile, links die Schiene in der Akzentfarbe, ohne Kasten
 * und ohne Radius. Von oben nach unten:
 * - **Griffleiste:** EINE Zeile. Vorn der einzige Wortknopf, „↺ Zurücknehmen“ (`aenderung-ruecknahme.vue`), dahinter rechtsbündig die Zeichen ⊕ ⚙ ⌕ mit Namen im Tooltip (`aenderung-griffe.vue`). Bei ⊘ steht der Grund als Satz.
 *   Die Rückfrage folgt darunter, im Aufgeklappten, kein Dialog.
 * - **Bezug:** „Zurückgenommen durch … (Zeit, Person)“; bei einer Rücknahme, was sie zurücknimmt; eine ältere Rücknahme ohne Bezug sagt das.
 * - **Felder:** je Gegenstand vorher → nachher in den zwei Tönen (`aenderung-tafel.vue`, `aenderung-wechsel.vue`): bei vielen Gegenständen die ersten fünf, dann „n weitere ▸“. Werte, die die Liste weglässt (`omitted`:
 *   Geometrie, Netze), lädt es über die Detail-Route nach; wo das Protokoll die frühere Form nicht führt, steht „Frühere Form nicht
 *   gespeichert“ — nie ein Wert aus dem heutigen Stand (WI-0265 §1.4).
 * - **Herkunft (WI-0265 B6g1):** Stammt die Operation aus einem Community-Vorgang (`communityVorgang`), steht unter dem Kopf eine gedämpfte Zeile „aus COM-000123“; mit dem Recht
 *   `moderate_submissions` (Prop `rechte`) öffnet ein Klick den Vorgang in der Redaktion, sonst bleibt es Text (`aenderung-herkunft.ts`).
 * - **Fuß:** unten eine gedämpfte Zeile mit dem Zeitpunkt samt Zeitzone (in der Zeile steht die Uhrzeit ohne), dem Vorgang und der Kennung (⧉ kopiert sie). Wer und Quelle stehen in der Zeile.
 * - **Sprung:** „Im Objektverlauf zeigen“ (⚙ im Reiter) beziehungsweise „In Änderungen zeigen“ (⇄ im Objektverlauf), mit derselben `operationId`.
 * - **Zurücknehmen (B5c):** Mit einem `ruecknahme`-Angebot der Zeile steht „↺ Zurücknehmen“ in der Griffleiste (`aenderung-ruecknahme.vue`: Vorprüfung, Rückfrage,
 *   Konflikte). Dieselbe Rückfrage im Reiter und im Objektverlauf; das Detail gibt nur das Ergebnis weiter (`zurueckgenommen`, `neuLesen`, `konfliktPruefen`). Das ↺ am Zeilenende der Liste stößt sie an (`anstoss`).
 * - **Karte (B5b):** ⊕ legt Vorher und Nachher als Überlagerung auf die Karte (`karte-ablage.ts`, gezeichnet von
 *   `map/aenderungen-overlay.ts`). Wo das Protokoll Lücken hat, steht der Satz dazu gleich darunter (Vorher nur teilweise oder gar nicht gespeichert).
 *   Das Schließen des Details nimmt die eigene Überlagerung wieder weg.
 *   **Für jede Änderung (B9):** Der Knopf steht bei jeder Änderung mit Gegenständen. Trägt das Protokoll keine Lage, fliegt er dorthin, wo die Gegenstände heute liegen (`aenderung-karte-zeigen.ts`:
 *   (a) Protokoll, (b) Datenbank über die Route `/lage`, (c) keine Lage: Der Knopf sagt es kurz). Die Logik steht in der `.ts`, nicht hier.
 *
 * Der Objektverlauf hat seine Felder schon gewählt, geordnet und mit den Namen seiner Art versehen (`zeilen`, `feldName`, `wert`); der Reiter
 * zeigt alle Gegenstände der Operation. Dieselben Töne und dieselbe Form, in beiden. Die Liste der Felder heißt `verlauf__felder` auch hier:
 * Die Browsertests der Editoren lesen sie unter diesem Namen.
 */
const props = defineProps<{
    eintrag: MapHistoryEntry;
    /** Vorsilbe der Test-Kennungen. */
    kennung: string;
    /** Die Felder, wie der Objektverlauf sie gewählt hat; ohne sie zeigt das Detail alle Gegenstände der Operation. */
    zeilen?: readonly DetailZeile[] | undefined;
    feldName?: ((feld: string) => string) | undefined;
    wert?: ((feld: string, wert: unknown) => string | undefined) | undefined;
    /** Der Sprung, den das Detail anbietet. */
    sprung?: "objekt" | "aenderungen" | undefined;
    /** Im Reiter: „Nur dieses Objekt zeigen“. */
    nurObjekt?: boolean | undefined;
    /** Kennt die Liste diese Operation (dann steht „ansehen“ an einem Bezug)? */
    kennt?: ((operationId: string) => boolean) | undefined;
    daten?: AenderungenDaten | undefined;
    /** Das ↺ dieser Zeile (B5c); ohne Angebot kennt der Server diese Art noch nicht. */
    ruecknahme?: RuecknahmeAngebot | undefined;
    /** Warum das Fenster gerade nicht zurücknehmen lässt (eine Bearbeitung läuft). */
    fenstergesperrt?: string | undefined;
    ruecknahmeDaten?: RuecknahmeDaten | undefined;
    /** Die Rechte der Sitzung (nur `moderate_submissions` gilt hier: die Herkunft aus einem Vorgang wird dann zum Link). */
    rechte?: readonly string[] | undefined;
    /** Dieses Detail steht in der Schiene einer Serie oder eines Bündels: auf der Fläche des Panels, nicht getönt. */
    mitglied?: boolean | undefined;
    /** Eine Zahl über Null, die wächst: Das ↺ am Zeilenende bittet, die Rückfrage zu öffnen (`angestossen` quittiert). */
    anstoss?: number | undefined;
}>();
const emit = defineEmits<{
    sprung: [];
    zeige: [operationId: string];
    nurObjekt: [gegenstand: MapHistoryObject];
    zurueckgenommen: [quittung: RuecknahmeReceipt];
    neuLesen: [];
    konfliktPruefen: [konflikt: RuecknahmeKonflikt, ziel: RuecknahmeAngebot["ziel"]];
    angestossen: [];
}>();

// --- Werte nachladen ----------------------------------------------------------------------------------------------------

const daten = props.daten ?? createAenderungenDaten();
const geladen = shallowRef<MapHistoryEntry | undefined>(undefined);
const laedt = ref(false);
const ladefehler = ref(false);
let abbruch: AbortController | undefined;

async function ladeDetail(): Promise<void> {
    abbruch?.abort();
    const eigene = new AbortController();
    abbruch = eigene;
    const kennung = props.eintrag.operationId;
    laedt.value = true;
    ladefehler.value = false;
    try {
        const detail = await daten.detail(kennung, eigene.signal);
        if (eigene.signal.aborted) return;
        if (detail === null) ladefehler.value = true;
        else geladen.value = mitDetail(props.eintrag, detail);
    } catch {
        if (!eigene.signal.aborted) ladefehler.value = true;
    } finally {
        if (abbruch === eigene) laedt.value = false;
    }
}
/** Die Frage nach der Lage (B9), eigene Abbruchkennung: Ein Wechsel der Operation oder das Schließen bricht sie ab. */
let lageAbbruch: AbortController | undefined;

/** Wer diese Überlagerung auf der Karte besitzt: dieses Detail, diese Operation (derselbe Eintrag im Reiter und im Verlauf zählt zweimal). */
const besitzerVon = (operationId: string): string => besitzerEintrag(props.kennung, operationId);
watch(
    () => props.eintrag.operationId,
    (_neu, alt) => {
        if (alt !== undefined) {
            schliesseKarteFuer(besitzerVon(alt));
            vergissStatus(besitzerVon(alt));
        }
        lageAbbruch?.abort();
        geladen.value = undefined;
        ladefehler.value = false;
        laedt.value = false;
        if (props.zeilen === undefined && brauchtDetail(props.eintrag)) void ladeDetail();
    },
    { immediate: true },
);
let abgeraeumt = false;
onBeforeUnmount(() => {
    abgeraeumt = true;
    abbruch?.abort();
    lageAbbruch?.abort();
    schliesseKarteFuer(besitzerVon(props.eintrag.operationId));
    vergissStatus(besitzerVon(props.eintrag.operationId));
});

const aktuell = computed(() => geladen.value ?? props.eintrag);

// --- Auf der Karte zeigen -----------------------------------------------------------------------------------------------

const karteGegenstaende = computed(() =>
    detailGegenstaende(aktuell.value).map(({ gegenstand, zeilen }) => ({ kind: gegenstand.kind, zeilen })),
);
/** Jede Änderung mit Gegenständen kann einen Ort haben (B9): im Protokoll oder, wenn dort keiner steht, in der Datenbank. */
const kannKarte = computed(() => kannLageHaben(karteGegenstaende.value));
const karteBild = computed(() => kartenBild(karteGegenstaende.value));
/** Die Sätze zu den Lücken im Protokoll (Vorher nur teilweise oder gar nicht gespeichert), sobald es etwas zu zeigen gibt. */
const karteHinweise = computed(() => (hatBild(karteBild.value) ? kartenHinweisTexte(karteBild.value.hinweise) : []));
const aufKarte = computed(() => zeigtKarte(besitzerVon(props.eintrag.operationId)));
const karteGriff = computed(() =>
    kannKarte.value
        ? {
              titel: karteTitel(besitzerVon(props.eintrag.operationId)),
              gedrueckt: aufKarte.value,
              status: statusText(besitzerVon(props.eintrag.operationId)),
          }
        : undefined,
);
async function zeigeKarte(): Promise<void> {
    const id = props.eintrag.operationId;
    await zeigeKarteFuer(besitzerVon(id), {
        async gegenstaende() {
            // Nur Lage-Felder brauchen die Geometrie, die die Liste weglässt; sonst gibt es nichts nachzuladen. Im Reiter lädt das Detail sie schon beim Öffnen, im Objektverlauf erst jetzt, beim ersten Bedarf.
            if (!hatKartenFelder(karteGegenstaende.value)) return karteGegenstaende.value;
            if (laedt.value) await warteBis(() => !laedt.value);
            else if (geladen.value === undefined && brauchtDetail(props.eintrag)) await ladeDetail();
            return ladefehler.value ? undefined : karteGegenstaende.value;
        },
        async lage() {
            lageAbbruch?.abort();
            const eigene = new AbortController();
            lageAbbruch = eigene;
            try {
                return await daten.lage(id, [], eigene.signal);
            } catch {
                return undefined;
            }
        },
        gilt: () => !abgeraeumt && props.eintrag.operationId === id,
    });
}

// --- Anzeige ------------------------------------------------------------------------------------------------------------

interface Gruppe {
    readonly gegenstand: MapHistoryObject | undefined;
    readonly zeilen: readonly DetailZeile[];
}
const gruppen = computed<readonly Gruppe[]>(() => {
    if (props.zeilen !== undefined)
        return props.zeilen.length === 0 ? [] : [{ gegenstand: undefined, zeilen: props.zeilen }];
    return detailGegenstaende(aktuell.value).map(({ gegenstand, zeilen }: DetailGegenstand) => ({
        gegenstand,
        zeilen,
    }));
});
const keineFelder = computed(() => gruppen.value.every((gruppe) => gruppe.zeilen.length === 0));
/** Wie oft „n weitere“ gedrückt wurde. */
const mehrSchritte = ref(0);
watch(
    () => props.eintrag.operationId,
    () => {
        mehrSchritte.value = 0;
    },
);
/** Der Name des Felds: der des Editors der Art, wo der Verlauf eines Objekts ihn mitgibt, sonst der der Liste (`aenderung-felder.ts`). */
const bezeichnung = (feld: string, gegenstand: MapHistoryObject | undefined): Bezeichnung =>
    props.feldName === undefined ? feldBezeichnung(gegenstand?.kind, feld) : bezeichneMit(props.feldName, feld);
/** Der Wert in Worten: der des Editors, wo er einen kennt (außer den Spalten des Gebirges, die hier zerlegt sind), sonst der der Art. */
const wertVon = (feld: string, wert: unknown, gegenstand: MapHistoryObject | undefined): string | undefined =>
    (feld.startsWith(GEBIRGE_PRAEFIX) ? undefined : props.wert?.(feld, wert)) ?? feldWert(gegenstand?.kind, feld, wert);
/** „Nur die Form ist anders“, wo Vorher und Nachher als Text gleich lauten, die Werte aber nicht. */
const hinweisVon = (zeile: DetailZeile, gegenstand: MapHistoryObject | undefined): string | undefined =>
    nurFormGeaendert(
        wertVon(zeile.feld, zeile.vorher, gegenstand),
        wertVon(zeile.feld, zeile.nachher, gegenstand),
        zeile.vorher,
        zeile.nachher,
    )
        ? t("aenderungen.detail.nurForm")
        : undefined;

const revision = (gegenstand: MapHistoryObject): string | undefined => {
    if (gegenstand.revisionAfter === null) return undefined;
    return gegenstand.revisionBefore === null
        ? t("verlauf.revisionNeu", { nach: String(gegenstand.revisionAfter) })
        : t("verlauf.revision", { vor: String(gegenstand.revisionBefore), nach: String(gegenstand.revisionAfter) });
};

/** Die Tafel: nur die Gegenstände, die zu sehen sind, werden zu Worten gemacht (ein Lauf des WikiSync nennt tausende). */
const tafel = computed(() => {
    const geschnitten = sichtbareGegenstaende(gruppen.value, mehrSchritte.value);
    return {
        weitere: geschnitten.weitere,
        gegenstaende: geschnitten.sichtbar.map((gruppe, i): TafelGegenstand => ({
            schluessel: `${String(i)}:${gruppe.gegenstand ? `${gruppe.gegenstand.kind}:${gruppe.gegenstand.id}` : ""}`,
            art: gruppe.gegenstand ? artName(gruppe.gegenstand.kind) : undefined,
            name: gruppe.gegenstand ? (gruppe.gegenstand.name ?? "–") : undefined,
            revision: gruppe.gegenstand ? revision(gruppe.gegenstand) : undefined,
            zeilen: gruppe.zeilen.map((zeile) => {
                const feld = bezeichnung(zeile.feld, gruppe.gegenstand);
                return {
                    feld: zeile.feld,
                    bezeichnung: feld.text,
                    schluessel: feld.schluessel,
                    vorher: wertVon(zeile.feld, zeile.vorher, gruppe.gegenstand),
                    nachher: wertVon(zeile.feld, zeile.nachher, gruppe.gegenstand),
                    formFehlt: zeile.formFehlt,
                    laedt: zeile.omitted && laedt.value,
                    hinweis: hinweisVon(zeile, gruppe.gegenstand),
                };
            }),
        })),
    };
});

/** Warum der Server den Eintrag nicht zurücknimmt (Quelle oder Art); fehlt bei jedem anderen Zustand. */
const nichtGrund = computed(() => nichtRuecknehmbarSatz(props.eintrag));
const zurueckDurch = computed(() => {
    const durch = props.eintrag.revertedBy;
    return durch === undefined
        ? undefined
        : t("aenderungen.detail.zurueckDurch", { wer: wer(durch.actor), wann: zeilenZeit(durch.at) });
});
/** Eine Rücknahme (Quelle `restore`) ohne `reverts` ist eine ältere Etikett-Rücknahme ohne Bezug zum Original. */
const ohneBezug = computed(() => props.eintrag.source === "restore" && (props.eintrag.reverts ?? []).length === 0);
const zeigtSprung = computed(
    () =>
        props.sprung === "aenderungen" || (props.sprung === "objekt" && sprungGegenstand(props.eintrag) !== undefined),
);
const nurObjektVon = computed(() => (props.nurObjekt === true ? props.eintrag.objects[0] : undefined));
const herkunft = computed(() => herkunftVon(props.eintrag, props.rechte ?? [], redaktion.verbunden.value));
</script>

<template>
    <div class="aenderung-detail" :class="{ 'is-mitglied': mitglied }" :data-testid="`${kennung}-detail`">
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
            <template #vorn>
                <p
                    v-if="nichtGrund !== undefined"
                    class="aenderung-detail__grundsatz"
                    data-testid="aenderung-detail-grund"
                >
                    <AenderungKreis kreis="gesperrt" :name="kreisName('gesperrt')" />
                    <span>{{ nichtGrund }}</span>
                </p>
            </template>
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

        <p v-if="zurueckDurch" class="aenderung-detail__bezug" data-testid="aenderung-detail-zurueck-durch">
            <span class="aenderung-detail__satz"
                ><AenderungKreis kreis="leer" :name="kreisName('leer')" /> {{ zurueckDurch }}</span
            >
            <span v-if="eintrag.revertedBy?.reason" data-testid="aenderung-detail-grund-original">{{
                t("aenderungen.detail.grund", { grund: eintrag.revertedBy.reason })
            }}</span>
            <AvmKnopf
                v-if="eintrag.revertedBy && kennt?.(eintrag.revertedBy.operationId)"
                groesse="zeile"
                :testid="`${kennung}-ruecknahme-ansehen`"
                @click="emit('zeige', eintrag.revertedBy.operationId)"
            >
                {{ t("aenderungen.detail.ansehen") }}
            </AvmKnopf>
        </p>
        <p
            v-if="(eintrag.reverts ?? []).length > 0"
            class="aenderung-detail__bezug"
            data-testid="aenderung-detail-reverts"
        >
            {{ t("aenderungen.detail.nimmtZurueck") }}
            <template v-for="id in eintrag.reverts" :key="id">
                <AvmKnopf v-if="kennt?.(id)" groesse="zeile" @click="emit('zeige', id)">
                    <span class="aenderung-detail__mono">{{ kurzeKennung(id) }}</span>
                </AvmKnopf>
                <span v-else class="aenderung-detail__mono" :title="id">{{ kurzeKennung(id) }}</span>
            </template>
            <span v-if="eintrag.reason" data-testid="aenderung-detail-grund-ruecknahme">{{
                t("aenderungen.detail.grund", { grund: eintrag.reason })
            }}</span>
        </p>
        <p v-if="ohneBezug" class="aenderung-detail__bezug" data-testid="aenderung-detail-ohne-bezug">
            {{ t("aenderungen.detail.ohneBezug") }}
        </p>

        <p v-if="herkunft" class="aenderung-detail__leise" data-testid="aenderung-detail-herkunft">
            <button
                v-if="herkunft.link"
                type="button"
                class="aenderung-detail__link"
                :title="herkunft.titel"
                @click="oeffneHerkunft(herkunft.nummer)"
            >
                {{ herkunft.text }}
            </button>
            <template v-else>{{ herkunft.text }}</template>
        </p>

        <p v-if="laedt" class="aenderung-detail__leise" role="status">{{ t("aenderungen.detail.laedt") }}</p>
        <div v-if="ladefehler" class="aenderung-detail__bezug" role="alert">
            {{ t("aenderungen.detail.ladefehler") }}
            <AvmKnopf groesse="zeile" :testid="`${kennung}-nochmal`" @click="ladeDetail()">
                {{ t("aenderungen.detail.nochmal") }}
            </AvmKnopf>
        </div>

        <p v-if="keineFelder && !laedt" class="aenderung-detail__leise">{{ t("aenderungen.detail.keineFelder") }}</p>
        <AenderungTafel v-else :gegenstaende="tafel.gegenstaende" :weitere="tafel.weitere" @mehr="mehrSchritte += 1" />
        <p
            v-for="satz in karteHinweise"
            :key="satz"
            class="aenderung-detail__leise"
            data-testid="aenderung-karte-hinweis"
        >
            {{ satz }}
        </p>

        <p class="aenderung-detail__fuss">
            <span data-testid="aenderung-detail-wann">{{ zeitMitZone(eintrag.at) }}</span>
            <span aria-hidden="true">·</span>
            <span
                >{{ t("aenderungen.detail.vorgang") }}
                <span :title="vorgangSchluessel(eintrag.operation)" data-testid="aenderung-detail-vorgang">{{
                    vorgangVon(eintrag)
                }}</span></span
            >
            <span aria-hidden="true">·</span>
            <AenderungKennung :id="eintrag.operationId" :kennung="kennung" testid="aenderung-detail-kennung" />
        </p>
    </div>
</template>

<style scoped>
/* Flach: eine leicht getönte Fläche in voller Breite unter der Zeile, links die Schiene in der Akzentfarbe; kein Kasten, kein Radius (Betreiber 2026-11-01: „der runde rahmen sieht komisch aus“). */
.aenderung-detail {
    display: grid;
    gap: var(--space-8);
    min-width: 0;
    margin: 0;
    padding: var(--space-8) var(--space-10) var(--space-8) var(--space-8);
    border-left: var(--avm-fenster-schiene-kante) solid var(--color-accent);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
    /* Keine Silbentrennung (Vorlage): Ein Satz bricht an Wortgrenzen um. */
    hyphens: manual;
}

/* In der Schiene einer Serie oder eines Bündels: um die Schiene eingerückt, auf der Fläche des Panels. */
.aenderung-detail.is-mitglied {
    margin-left: var(--space-10);
    background: var(--color-panel);
}

.aenderung-detail p {
    margin: 0;
}

.aenderung-detail__grundsatz {
    display: flex;
    flex: 1 1 100%;
    align-items: flex-start;
    gap: var(--space-4);
    color: var(--color-text-muted);
}

.aenderung-detail__grundsatz :deep(.aenderung-kreis),
.aenderung-detail__grundsatz :deep(.avm-kreis) {
    margin-top: 2px;
}

.aenderung-detail__mono {
    font-family: ui-monospace, Consolas, monospace;
    font-size: var(--font-size-caption);
    overflow-wrap: anywhere;
}

/* Grund und Bezug bleiben umrandete Felder (wie in der Vorlage). */
.aenderung-detail__bezug {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.aenderung-detail__leise {
    color: var(--color-text-muted);
}

.aenderung-detail__link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-link);
    font: inherit;
    cursor: pointer;
}

.aenderung-detail__link:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.aenderung-detail__link:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Der Fuß: gedämpft, klein; Zeitpunkt, Vorgang, Kennung. */
.aenderung-detail__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
