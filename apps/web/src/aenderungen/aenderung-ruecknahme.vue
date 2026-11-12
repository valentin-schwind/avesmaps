<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { RuecknahmeKonflikt, RuecknahmeReceipt } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { showToast } from "../feedback/toast";
import { folgeArbeit, folgeSatz } from "../fenster/folge-arbeit";
import { meldeTraegerQuellen } from "../fenster/traeger-quellen-melde";
import { meldeGebiete } from "../gebietseditor/gebiet-melde";
import { formatNumber, t } from "../i18n/i18n";
import { meldeKraftlinien } from "../kraftlinieneditor/kraftlinie-melde";
import {
    betroffenZeilen,
    folgenZeilen,
    fremdeNamen,
    konfliktZeilen,
    type RuecknahmeAngebot,
    type Sperrgrund,
} from "./aenderung-ruecknahme";
import { createRuecknahmeDaten, type RuecknahmeDaten } from "./aenderung-ruecknahme-daten";
import { createRuecknahme } from "./aenderung-ruecknahme-steuerung";
import { konfliktFeldName } from "./aenderung-felder";
import { wer, zeilenZeit } from "./aenderung-text";

/**
 * Das ↺ „Zurücknehmen“ einer Änderung oder einer Arbeitsserie (WI-0265 B5c; Probierseite `review/wi-0265/aenderungen.html`, Szenen 2, 3, 6, 7): EIN Bauteil für den Reiter
 * „Änderungen“ und für die Objektverläufe von Gebirge und Ort, damit dieselbe Rücknahme an beiden Stellen dieselbe Rückfrage stellt.
 *
 * - **Die Griffleiste (WI-0265 B10, Vorlage `review/wi-0265/aenderungen-neu.html`):** EINE Zeile oben im Detail. Vorn der einzige Wortknopf, „↺ Zurücknehmen“ beziehungsweise „↺ Serie zurücknehmen (n)“ beziehungsweise
 *   „↺ Rücknahme zurücknehmen“; dahinter der Slot `vorn` (ein Satz, wo es keinen Knopf gibt: der Grund bei ⊘) und rechtsbündig der Slot `zeichen` (⊕ ⚙ ⌕ mit Namen im Tooltip). Ohne `angebot` steht nur die Leiste da.
 * - **Der Knopf:** Was die Liste schon weiß, sagt er gesperrt mit Grund („Überholt durch Schritt 6“, kein Recht, eine Bearbeitung läuft); sonst fragt der Klick den Server (`restore-series/preview`).
 *   Das ↺ am Zeilenende der Liste stößt denselben Ablauf an (`anstoss`): Es öffnet die Zeile und diese Rückfrage und schreibt nie selbst.
 * - **Die Rückfrage** (`AvmBestaetigung`, kein eigenes Fenster) steht unter dem Knopf: genau die Mitglieder, die Folgen („Gelände wird neu berechnet“) und bei einer fremden
 *   Person das Pflichtfeld „Grund“ (Gate 2). Erst „Zurücknehmen“ schreibt, mit einer neuen Kennung je Bestätigung.
 * - **Konflikt, Sperre, Recht:** Der Server hat „nein“ gesagt, es wurde nichts zurückgenommen; die Liste der Konflikte nennt Gegenstand, Person und Zeit, und „Konflikt prüfen“
 *   führt zum betroffenen Gegenstand (`konfliktPruefen`). Keine Teilrücknahme.
 * - **Ergebnis:** ein kurzer Hinweis, die abgeleitete Arbeit über den Weg der Warteschlange (`fenster/folge-arbeit.ts`), und der Aufrufer liest Liste und Verlauf neu.
 */
const props = defineProps<{
    /** Was das ↺ tut; ohne Angebot kennt der Server diese Art nicht, und die Griffleiste trägt nur ihre Zeichen. */
    angebot?: RuecknahmeAngebot | undefined;
    /** Vorsilbe der Test-Kennungen. */
    kennung: string;
    /** Eine Zahl über Null, die wächst: Das ↺ am Zeilenende bittet, die Rückfrage zu öffnen (`angestossen` quittiert). */
    anstoss?: number | undefined;
    /** Warum das Fenster gerade nicht zurücknehmen lässt (eine Bearbeitung läuft, ein ↺ wird geschrieben); gesetzt heißt gesperrt. */
    fenstergesperrt?: string | undefined;
    daten?: RuecknahmeDaten | undefined;
}>();
const emit = defineEmits<{
    /** Die Rücknahme ist geschrieben: Liste, Verlauf, Karte ziehen nach. */
    zurueckgenommen: [quittung: RuecknahmeReceipt];
    /** Die Liste ist nicht mehr, was die Rückfrage meinte: neu lesen. */
    neuLesen: [];
    /** „Konflikt prüfen“: den betroffenen Gegenstand zeigen. */
    konfliktPruefen: [konflikt: RuecknahmeKonflikt, ziel: RuecknahmeAngebot["ziel"]];
    /** Der Anstoß ist aufgenommen. */
    angestossen: [];
}>();
defineSlots<{
    /** Statt des Knopfs: ein Satz (der Grund bei ⊘). */
    vorn?(): unknown;
    /** Rechtsbündig in der Griffleiste: ⊕ ⚙ ⌕. */
    zeichen?(): unknown;
}>();

const steuerung = createRuecknahme({
    daten: props.daten ?? createRuecknahmeDaten(),
    zurueckgenommen(quittung) {
        showToast(
            props.angebot?.modus === "serie"
                ? t("aenderungen.ruecknahme.erfolg.serie")
                : t("aenderungen.ruecknahme.erfolg.einzeln"),
            "success",
        );
        // Die Quellen eines Orts, Gebiets, einer Landschaft oder eines Wegs (WI-0265 B6g3): Eine offene Klappbox dieses Objekts liest sie neu, gleich ob das ↺ in „Änderungen“ oder im Verlauf des Objekts stand.
        meldeTraegerQuellen(quittung.affected);
        // Gebiete und Kraftlinien (WI-0265 B6h): Offene Fenster dazu lesen ihr Objekt samt Verlauf neu, gleich ob das ↺ in „Änderungen“ oder im Verlauf eines Objekts stand (eine Rücknahme kann mehrere Gebiete oder Linien berühren); ein Entwurf bleibt.
        meldeGebiete(quittung.affected, quittung.mapRevision);
        meldeKraftlinien(quittung.affected, quittung.mapRevision);
        emit("zurueckgenommen", quittung);
    },
    neuLesen: () => emit("neuLesen"),
});
const stand = steuerung.stand;
const grund = ref("");

// Ein anderes ↺ (eine andere Zeile, eine andere Serie) beginnt ohne die Rückfrage des vorigen.
watch(
    () => props.angebot?.schluessel,
    () => {
        steuerung.schliesse();
        grund.value = "";
    },
);

/** Das ↺ am Zeilenende bittet um die Rückfrage: dieselbe Vorprüfung wie der Knopf, nie ein Schreiben. */
function nimmAnstossAuf(): void {
    emit("angestossen");
    const angebot = props.angebot;
    if (angebot !== undefined && angebot.sperre === undefined && stand.value.art === "ruhe")
        void steuerung.starte(angebot);
}
onMounted(() => {
    if ((props.anstoss ?? 0) > 0) nimmAnstossAuf();
});
watch(
    () => props.anstoss,
    (neu) => {
        if ((neu ?? 0) > 0) nimmAnstossAuf();
    },
);
onBeforeUnmount(() => steuerung.destroy());

const SPERRE_SCHLUESSEL = {
    zurueck: "aenderungen.ruecknahme.gesperrt.zurueck",
    quelle: "aenderungen.status.grund.quelle",
    nichtArt: "aenderungen.status.grund.art",
    art: "aenderungen.ruecknahme.gesperrt.art",
} as const;

function sperrText(sperre: Sperrgrund): string {
    if (sperre.art === "ueberholt") return t("aenderungen.ruecknahme.gesperrt.ueberholt", { nr: sperre.position });
    return t(SPERRE_SCHLUESSEL[sperre.art]);
}

/** Schon zurückgenommen und nicht rücknehmbar sagt das Detail selbst (Zustand, „Zurückgenommen durch …“); dafür braucht es keinen gesperrten Knopf. */
const zeigtKnopf = computed(
    () =>
        props.angebot !== undefined &&
        props.angebot.sperre?.art !== "zurueck" &&
        props.angebot.sperre?.art !== "quelle" &&
        props.angebot.sperre?.art !== "nichtArt",
);

const knopfGrund = computed((): string | undefined => {
    if (props.fenstergesperrt !== undefined) return props.fenstergesperrt;
    if (steuerung.verboten.value) return t("aenderungen.ruecknahme.gesperrt.verboten");
    if (props.angebot?.sperre !== undefined) return sperrText(props.angebot.sperre);
    if (stand.value.art === "prueft") return t("aenderungen.ruecknahme.prueft");
    return undefined;
});
/** Eine Serie nimmt die offenen Mitglieder zurück, eine Rücknahme (Quelle `restore`) sich selbst („Rücknahme zurücknehmen“: das Original gilt danach wieder), sonst steht „Zurücknehmen“. */
const aufschrift = computed(() => {
    const angebot = props.angebot;
    if (angebot === undefined) return "";
    if (angebot.modus === "serie") return t("aenderungen.ruecknahme.serie", { n: formatNumber(angebot.offen, 0) });
    return angebot.eintraege.every((eintrag) => eintrag.source === "restore")
        ? t("aenderungen.ruecknahme.ruecknahme")
        : t("aenderungen.ruecknahme.einzeln");
});

// --- Die Rückfrage ---------------------------------------------------------------------------------------------------------

const pruefung = computed(() =>
    stand.value.art === "fragt" || stand.value.art === "sendet" ? stand.value.pruefung : undefined,
);
const hinweisGewachsen = computed(() => stand.value.art === "fragt" && stand.value.hinweis === "serieGewachsen");
const betroffene = computed(() => (pruefung.value === undefined ? [] : betroffenZeilen(pruefung.value)));
const folgen = computed(() => (pruefung.value === undefined ? [] : folgenZeilen(pruefung.value)));
const fremde = computed(() => (pruefung.value === undefined ? "" : fremdeNamen(pruefung.value)));
const grundNoetig = computed(() => pruefung.value?.reasonRequired === true);
const frageSerie = computed(() => (pruefung.value?.mitglieder.length ?? 0) > 1 || props.angebot?.modus === "serie");
const bestaetigenText = computed(() =>
    frageSerie.value
        ? t("aenderungen.ruecknahme.bestaetigen.serie", { n: formatNumber(betroffene.value.length, 0) })
        : t("aenderungen.ruecknahme.bestaetigen.einzeln"),
);
const bestaetigenGrund = computed((): string | undefined => {
    if (stand.value.art === "sendet") return t("aenderungen.ruecknahme.sendet");
    if (grundNoetig.value && grund.value.trim() === "") return t("aenderungen.ruecknahme.grund.pflicht");
    return undefined;
});

// --- Blockaden --------------------------------------------------------------------------------------------------------------

const blockade = computed(() => (stand.value.art === "blockiert" ? stand.value.blockade : undefined));
const konflikte = computed(() =>
    blockade.value?.art === "konflikt" ? konfliktZeilen(blockade.value.konflikte, konfliktFeldName) : [],
);
const sperrenSaetze = computed(() =>
    blockade.value?.art === "gesperrt"
        ? blockade.value.sperren.map((s) =>
              t("aenderungen.ruecknahme.sperre", {
                  wer: s.name,
                  wann: s.seit === undefined ? "–" : zeilenZeit(s.seit),
              }),
          )
        : [],
);
const nichtSatz = computed(() => {
    const b = blockade.value;
    if (b?.art !== "nicht") return "";
    return b.grund === "quelle"
        ? t("aenderungen.status.grund.quelle")
        : t(b.grund === "bereich" ? "aenderungen.ruecknahme.gesperrt.bereich" : "aenderungen.ruecknahme.gesperrt.art");
});
const schonSatz = computed(() => {
    const b = blockade.value;
    if (b?.art !== "schon") return "";
    const bekannt = props.angebot?.eintraege.find((e) => e.revertedBy !== undefined)?.revertedBy;
    const durch = b.durch?.actor ?? bekannt?.actor;
    const at = b.durch?.at ?? bekannt?.at;
    return durch !== undefined && at !== undefined
        ? t("aenderungen.ruecknahme.schonDurch", { wer: wer(durch), wann: zeilenZeit(at) })
        : t("aenderungen.ruecknahme.schon");
});

// --- Ergebnis ---------------------------------------------------------------------------------------------------------------

const ergebnis = computed(() => (stand.value.art === "fertig" ? stand.value : undefined));
const ergebnisSatz = computed(() => {
    const e = ergebnis.value;
    if (e === undefined) return "";
    if (e.wiederholt) return t("aenderungen.ruecknahme.erfolg.wiederholt");
    return e.serie ? t("aenderungen.ruecknahme.erfolg.serie") : t("aenderungen.ruecknahme.erfolg.einzeln");
});
/** Die Folgearbeit der Quittung, wie sie jetzt steht (das Gelände rechnet, ist fertig oder fehlgeschlagen). */
const folgeText = computed(() => {
    const e = ergebnis.value;
    if (e?.folge === undefined) return undefined;
    return folgeSatz(e.folge.art, folgeArbeit.stand(e.folge) ?? { stand: "wartet" });
});

function pruefeKonflikt(): void {
    const erster = konflikte.value[0]?.konflikt;
    if (erster !== undefined && props.angebot !== undefined) emit("konfliktPruefen", erster, props.angebot.ziel);
}
</script>

<template>
    <div class="ruecknahme" :data-testid="`${kennung}-ruecknahme-huelle`">
        <div v-if="$slots['vorn'] || $slots['zeichen'] || zeigtKnopf" class="ruecknahme__griffe">
            <AvmKnopf
                v-if="angebot && (stand.art === 'ruhe' || stand.art === 'prueft') && zeigtKnopf"
                art="gefuellt"
                groesse="zeile"
                :gesperrt="knopfGrund"
                :testid="`${kennung}-ruecknahme`"
                @click="steuerung.starte(angebot)"
            >
                {{ aufschrift }}
            </AvmKnopf>
            <slot name="vorn" />
            <slot name="zeichen" />
        </div>

        <AvmBestaetigung
            v-if="stand.art === 'fragt' || stand.art === 'sendet'"
            :frage="frageSerie ? t('aenderungen.ruecknahme.frage.serie') : t('aenderungen.ruecknahme.frage.einzeln')"
            :folge="frageSerie ? t('aenderungen.ruecknahme.folge.serie') : t('aenderungen.ruecknahme.folge.einzeln')"
            :bestaetigen="bestaetigenText"
            :gesperrt="bestaetigenGrund"
            :testid="`${kennung}-ruecknahme-frage`"
            @bestaetigen="steuerung.bestaetige(grund)"
            @abbrechen="steuerung.schliesse()"
        >
            <p v-if="hinweisGewachsen" class="ruecknahme__hinweis" :data-testid="`${kennung}-ruecknahme-gewachsen`">
                {{ t("aenderungen.ruecknahme.serieGewachsen", { n: formatNumber(betroffene.length, 0) }) }}
            </p>
            <div>
                <p class="ruecknahme__titel">{{ t("aenderungen.ruecknahme.betroffen") }}</p>
                <ul class="ruecknahme__liste" :data-testid="`${kennung}-ruecknahme-betroffen`">
                    <li v-for="zeile in betroffene" :key="zeile.operationId" data-testid="ruecknahme-betroffen-zeile">
                        <b>{{ zeile.titel }}</b> · {{ zeile.zeit }}
                        <span v-if="zeile.gegenstaende" class="ruecknahme__leise"> · {{ zeile.gegenstaende }}</span>
                    </li>
                </ul>
            </div>
            <div v-if="folgen.length > 0">
                <p class="ruecknahme__titel">{{ t("aenderungen.ruecknahme.folgen") }}</p>
                <ul class="ruecknahme__liste" :data-testid="`${kennung}-ruecknahme-folgen`">
                    <li v-for="satz in folgen" :key="satz">{{ satz }}</li>
                </ul>
            </div>
            <p v-if="grundNoetig && fremde" class="ruecknahme__hinweis">
                {{ t("aenderungen.ruecknahme.grund.fremd", { wer: fremde }) }}
            </p>
            <label v-if="grundNoetig" class="ruecknahme__grund">
                <span class="ruecknahme__titel">{{ t("aenderungen.ruecknahme.grund.beschriftung") }}</span>
                <AvmTextbereich
                    v-model="grund"
                    :zeilen="3"
                    :placeholder="t('aenderungen.ruecknahme.grund.platzhalter', { wer: fremde || '–' })"
                    :disabled="stand.art === 'sendet'"
                    :testid="`${kennung}-ruecknahme-grund`"
                />
            </label>
        </AvmBestaetigung>

        <div v-if="blockade" class="ruecknahme__block" role="alert" :data-testid="`${kennung}-ruecknahme-blockiert`">
            <template v-if="blockade.art === 'verboten'">
                <p>{{ t("aenderungen.ruecknahme.verboten") }}</p>
            </template>
            <template v-else-if="blockade.art === 'gesperrt'">
                <p v-for="satz in sperrenSaetze" :key="satz" :data-testid="`${kennung}-ruecknahme-sperre`">
                    {{ satz }}
                </p>
            </template>
            <template v-else-if="blockade.art === 'konflikt'">
                <p>{{ t("aenderungen.ruecknahme.konflikt.titel") }}</p>
                <ul class="ruecknahme__liste" :data-testid="`${kennung}-ruecknahme-konflikte`">
                    <li
                        v-for="(zeile, i) in konflikte"
                        :key="i"
                        :data-testid="`${kennung}-ruecknahme-konflikt`"
                        :title="zeile.hinweis ?? zeile.konflikt.operationId"
                    >
                        <b>{{ zeile.objekt }}</b> · {{ zeile.art }}
                        <span v-if="zeile.satz" :data-testid="`${kennung}-ruecknahme-konflikt-satz`">
                            · {{ zeile.satz }}</span
                        >
                        <span v-if="zeile.von" class="ruecknahme__leise"> · {{ zeile.von }}</span>
                        <span v-if="zeile.felder" class="ruecknahme__leise"> · {{ zeile.felder }}</span>
                    </li>
                </ul>
            </template>
            <template v-else-if="blockade.art === 'nicht'">
                <p>{{ nichtSatz }}</p>
            </template>
            <template v-else-if="blockade.art === 'schon'">
                <p :data-testid="`${kennung}-ruecknahme-schon`">{{ schonSatz }}</p>
            </template>
            <template v-else>
                <p>{{ t("aenderungen.ruecknahme.ungueltig") }}</p>
            </template>
            <div class="ruecknahme__knoepfe">
                <AvmKnopf
                    v-if="blockade.art === 'konflikt' && konflikte.length > 0"
                    groesse="zeile"
                    :testid="`${kennung}-ruecknahme-konflikt-pruefen`"
                    @click="pruefeKonflikt()"
                >
                    {{ t("aenderungen.ruecknahme.konflikt.pruefen") }}
                </AvmKnopf>
                <AvmKnopf groesse="zeile" :testid="`${kennung}-ruecknahme-schliessen`" @click="steuerung.schliesse()">
                    {{ t("aenderungen.ruecknahme.schliessen") }}
                </AvmKnopf>
            </div>
        </div>

        <div
            v-if="stand.art === 'fehler'"
            class="ruecknahme__block"
            role="alert"
            :data-testid="`${kennung}-ruecknahme-fehler`"
        >
            <p>{{ stand.satz }}</p>
            <div class="ruecknahme__knoepfe">
                <AvmKnopf
                    v-if="stand.wiederholbar"
                    groesse="zeile"
                    :testid="`${kennung}-ruecknahme-nochmal`"
                    @click="steuerung.nochmal()"
                >
                    {{ t("aenderungen.ruecknahme.nochmal") }}
                </AvmKnopf>
                <AvmKnopf groesse="zeile" @click="steuerung.schliesse()">
                    {{ t("aenderungen.ruecknahme.schliessen") }}
                </AvmKnopf>
            </div>
        </div>

        <div v-if="ergebnis" class="ruecknahme__ok" role="status" :data-testid="`${kennung}-ruecknahme-ergebnis`">
            <p>{{ ergebnisSatz }}</p>
            <p v-if="folgeText" class="ruecknahme__leise" :data-testid="`${kennung}-ruecknahme-folge`">
                {{ folgeText }}
            </p>
            <p v-for="befund in ergebnis.befunde" :key="befund" class="ruecknahme__leise">{{ befund }}</p>
            <div class="ruecknahme__knoepfe">
                <AvmKnopf groesse="zeile" :testid="`${kennung}-ruecknahme-fertig`" @click="steuerung.schliesse()">
                    {{ t("aenderungen.ruecknahme.schliessen") }}
                </AvmKnopf>
            </div>
        </div>
    </div>
</template>

<style scoped>
.ruecknahme {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
}

.ruecknahme p {
    margin: 0;
}

/* Die Griffleiste: EINE Zeile, auch bei 400 px; vorn das Wort, die Zeichen rechtsbündig. */
.ruecknahme__griffe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.ruecknahme__titel {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.ruecknahme__leise {
    color: var(--color-text-muted);
}

.ruecknahme__hinweis {
    color: var(--color-text-muted);
}

.ruecknahme__liste {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-12);
}

.ruecknahme__grund {
    display: grid;
    gap: var(--space-2);
}

.ruecknahme__block,
.ruecknahme__ok {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-10);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
    font-size: var(--font-size-small);
}

.ruecknahme__block {
    border-color: var(--color-danger-soft-border);
}

.ruecknahme__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}
</style>
