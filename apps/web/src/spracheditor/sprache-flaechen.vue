<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import type { SpracheEditorDetail, SpracheEditorListe, SpracheEditorTeilflaeche } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { formatNumber, t } from "../i18n/i18n";
import type { StillgelegteTeilflaeche } from "./spracheditor-steuerung";
import type { SprachKopierZiel } from "./sprachflaeche-kopieren";
import SprachflaecheKopieren from "./sprachflaeche-kopieren.vue";

/**
 * Der Reiter „Flächen“ einer Sprache (WI-0261 S5d2; Bauvorlage `fenster-sprachen.js` `sfFlaechen`): die Fläche im Ganzen mit ihrer Quelle,
 * darunter die Teilflächen, die größte zuerst. Ein Klick auf eine Teilfläche wählt sie und fliegt hin.
 *
 * - **Handgriffe im Kartenmenü** (WI-0261 Stufe 1; Betreiber 2026-10-31: „die sachen mit den buttons unter den teilfächen zu editieren funktioniert
 *   hinten und vorne nicht und sollten eigentlich im kontextmenü sein“): Bearbeiten, Hinfliegen, Entfernen und „Neue Teilfläche“ stehen am Zeiger
 *   (`editor-menu/handgriffe-sprache.ts`), nicht mehr als Knöpfe unter der Liste.
 * - **Die Wahl hält das Fenster** (`gewaehlt`): Ein Klick auf eine Teilfläche der Karte, ein Handgriff und eine eben gezeichnete Teilfläche setzen
 *   sie von außen. Steht sie hinter den ersten acht, klappt die Liste auf, und sie kommt in Sicht. „Teilfläche entfernen …“ öffnet die
 *   Bestätigung unter der Liste (`fragt`).
 * - Jede Sprache hat ihre eigenen Flächen: Sie rasten an nichts ein und dürfen sich überlappen (E2, E4).
 * - **„Kopieren …“** (Kartenmenü, WI-0261 Stufe 3) öffnet unter der Liste das Blatt „Fläche kopieren“ (`kopiert`, `sprachflaeche-kopieren.vue`).
 * - **„Unterfläche löschen …“** (Kartenmenü, Stufe 3; Betreiber 2026-10-31: „Ja, nachfragen“) fragt unter der Liste nach, bevor geschrieben wird
 *   (`unterFrage`); der Knopf heißt „Löschen“ wie die Wahl im Menü (R6).
 * - Entfernen legt still und löscht nie; eine in dieser Sitzung stillgelegte Teilfläche steht darunter mit „↺ Zurückholen“, ältere holt ↺ im Verlauf.
 * - Zahlen knapp (Betreiber 2026-10-16): Fläche in Karteneinheiten² (E²), ohne Nachkommastellen.
 */
const props = defineProps<{
    detail: SpracheEditorDetail;
    stillgelegte: readonly StillgelegteTeilflaeche[];
    lesend: boolean;
    /** Warum gerade nichts geschrieben wird (ein Modus läuft, ein Schreiben läuft); ohne Satz geht es. */
    modusGrund: string | undefined;
    kennung: string;
    /** Die Zeilen der Liste: die Zielsprachen des Blatts „Fläche kopieren“. */
    zeilen?: SpracheEditorListe["zeilen"] | undefined;
    /** Der Satz des Servers, wenn das Kopieren nicht ging. */
    kopierFehler?: string | undefined;
    /** Die offene Frage „Unterfläche löschen …“ an einer Teilfläche dieser Sprache (die Unterfläche ab 0). */
    unterFrage?: { readonly flaeche: string; readonly teil: number } | undefined;
}>();
const emit = defineEmits<{
    fliege: [bbox: readonly [number, number, number, number]];
    stilllegen: [teil: SpracheEditorTeilflaeche];
    zurueckholen: [teil: StillgelegteTeilflaeche];
    kopieren: [teil: SpracheEditorTeilflaeche, ziel: SprachKopierZiel];
    unterAntwort: [ja: boolean];
}>();
/** Die gewählte Teilfläche; ohne Wahl ist keine markiert. */
const gewaehlt = defineModel<string | undefined>("gewaehlt", { default: undefined });
/** Die Teilfläche, deren Bestätigung „entfernen“ offen ist. */
const fragt = defineModel<string | undefined>("fragt", { default: undefined });
/** Die Teilfläche, deren Blatt „Fläche kopieren“ offen ist (WI-0261 Stufe 3). */
const kopiert = defineModel<string | undefined>("kopiert", { default: undefined });

const SICHT = 8;
const alleZeigen = ref(false);
const wurzel = useTemplateRef<HTMLElement>("wurzel");

const teile = computed(() => props.detail.teilflaechen);
const sichtbar = computed(() => (alleZeigen.value ? teile.value : teile.value.slice(0, SICHT)));
const fragTeil = computed(() => teile.value.find((teil) => teil.id === fragt.value));
const kopierTeil = computed(() => teile.value.find((teil) => teil.id === kopiert.value));
/** Die Frage „Unterfläche löschen …“ mit der Nummer der Teilfläche in der Liste (fehlt sie dort noch, ohne Nummer). */
const unterText = computed(() => {
    const frage = props.unterFrage;
    if (frage === undefined) return undefined;
    const teil = teile.value.find((eintrag) => eintrag.id === frage.flaeche);
    return t("spracheditor.unterflaechen.frage", {
        n: String(frage.teil + 1),
        m: teil === undefined ? "–" : String(nummer(teil)),
        name: props.detail.name,
    });
});
const nummer = (teil: SpracheEditorTeilflaeche): number => teile.value.indexOf(teil) + 1;
/** Was unter der Liste offen ist (Frage „entfernen“, Blatt „Fläche kopieren“, Frage „Unterfläche löschen“); ohne Offenes nichts. */
const offen = computed(
    () =>
        fragt.value ??
        kopiert.value ??
        (props.unterFrage === undefined ? undefined : `${props.unterFrage.flaeche}-${props.unterFrage.teil}`),
);

/**
 * Eine neue Wahl kommt in Sicht, sobald ihre Teilfläche in der Liste steht: Eine eben gezeichnete steht dort erst, wenn die Sprache neu gelesen ist.
 * Danach scrollt ein neuer Stand der Liste nicht mehr. Eine Frage oder ein Blatt unter der Liste (`data-offen`) kommt beim Öffnen in Sicht: Bei
 * aufgeklappter Liste (Garethi hat 140 Teilflächen) stand es sonst weit unterhalb, und die Modusleiste zeigte nur „Speichert …“ (Befund
 * Sichtprüfung WI-0261 Stufe 3, 2026-10-31).
 */
let zuZeigen = true;
watch(
    [gewaehlt, offen, teile] as const,
    async ([wahl, kasten, liste], vorher) => {
        if (vorher !== undefined && (wahl !== vorher[0] || kasten !== vorher[1])) zuZeigen = true;
        const index = liste.findIndex((teil) => teil.id === wahl);
        if (!zuZeigen || (index < 0 && kasten === undefined)) return;
        zuZeigen = false;
        if (index >= SICHT) alleZeigen.value = true;
        await nextTick();
        const zeilen = [...(wurzel.value?.querySelectorAll<HTMLElement>("[data-teil]") ?? [])];
        const ziel =
            kasten === undefined
                ? zeilen.find((zeile) => zeile.dataset.teil === wahl)
                : wurzel.value?.querySelector<HTMLElement>("[data-offen]");
        ziel?.scrollIntoView({ block: "nearest" });
    },
    { immediate: true },
);

const e2 = (wert: number): string => t("spracheditor.flaeche.e2", { n: formatNumber(Math.round(wert), 0) });
const herkunft = (wert: string): string =>
    wert === "sprachenkarte" ? t("spracheditor.herkunft.sprachenkarte") : t("spracheditor.herkunft.redaktion");
const quelle = computed(() => {
    const karte = teile.value.filter((teil) => teil.herkunft === "sprachenkarte").length;
    const redaktion = teile.value.length - karte;
    if (teile.value.length === 0) return t("spracheditor.flaeche.keine");
    if (redaktion === 0) return t("spracheditor.herkunft.sprachenkarte");
    if (karte === 0) return t("spracheditor.herkunft.redaktion");
    return t("spracheditor.flaeche.gemischt", { karte: String(karte), redaktion: String(redaktion) });
});

function waehle(teil: SpracheEditorTeilflaeche): void {
    gewaehlt.value = teil.id;
    emit("fliege", teil.bbox);
}
function entferne(teil: SpracheEditorTeilflaeche): void {
    fragt.value = undefined;
    emit("stilllegen", teil);
}
</script>

<template>
    <div ref="wurzel" class="flaechen" :data-testid="`${kennung}-flaechen`">
        <section class="flaechen__kasten">
            <h4 class="flaechen__titel">{{ t("spracheditor.kasten.flaeche") }}</h4>
            <dl class="flaechen__werte">
                <div>
                    <dt>{{ t("spracheditor.flaeche.teilflaechen") }}</dt>
                    <dd>{{ teile.length === 0 ? t("spracheditor.flaeche.keine") : formatNumber(teile.length, 0) }}</dd>
                </div>
                <div>
                    <dt>{{ t("spracheditor.flaeche.gesamt") }}</dt>
                    <dd>{{ e2(detail.flaeche) }}</dd>
                </div>
                <div>
                    <dt>{{ t("spracheditor.flaeche.quelle") }}</dt>
                    <dd>{{ quelle }}</dd>
                </div>
            </dl>
            <p class="flaechen__hinweis">{{ t("spracheditor.flaeche.hinweis") }}</p>
        </section>

        <section class="flaechen__kasten">
            <h4 class="flaechen__titel">{{ t("spracheditor.kasten.teilflaechen") }}</h4>
            <div
                v-if="teile.length > 0"
                class="flaechen__liste"
                role="listbox"
                :aria-label="t('spracheditor.kasten.teilflaechen')"
            >
                <button
                    v-for="teil in sichtbar"
                    :key="teil.id"
                    type="button"
                    class="flaechen__teil"
                    role="option"
                    :aria-selected="gewaehlt === teil.id"
                    :data-teil="teil.id"
                    :title="
                        t('spracheditor.flaeche.ecken', {
                            n: formatNumber(teil.stuetzpunkte, 0),
                            loecher: formatNumber(teil.loecher, 0),
                        })
                    "
                    :data-testid="`${kennung}-teil`"
                    @click="waehle(teil)"
                >
                    <span class="flaechen__name">{{
                        t("spracheditor.flaeche.teil", { n: String(nummer(teil)) })
                    }}</span>
                    <small class="flaechen__herkunft">{{ herkunft(teil.herkunft) }}</small>
                    <span class="flaechen__zahl">{{ e2(teil.flaeche) }}</span>
                </button>
                <button
                    v-if="teile.length > SICHT"
                    type="button"
                    class="flaechen__mehr"
                    :aria-expanded="alleZeigen"
                    @click="alleZeigen = !alleZeigen"
                >
                    {{
                        alleZeigen
                            ? t("spracheditor.flaeche.weniger")
                            : t("spracheditor.flaeche.mehr", { n: formatNumber(teile.length - SICHT, 0) })
                    }}
                </button>
            </div>
            <p v-else class="flaechen__hinweis">{{ t("spracheditor.flaeche.nochKeine") }}</p>
            <AvmBestaetigung
                v-if="fragTeil && !lesend"
                data-offen
                :frage="t('spracheditor.flaeche.entfernenFrage', { n: String(nummer(fragTeil)), name: detail.name })"
                :folge="t('spracheditor.flaeche.entfernenFolge', { flaeche: e2(fragTeil.flaeche) })"
                :bestaetigen="t('spracheditor.flaeche.entfernen')"
                :gesperrt="modusGrund"
                :testid="`${kennung}-teil-entfernen-frage`"
                @bestaetigen="entferne(fragTeil)"
                @abbrechen="fragt = undefined"
            />
            <AvmBestaetigung
                v-if="unterText !== undefined && !lesend"
                :key="`${unterFrage?.flaeche}-${unterFrage?.teil}`"
                data-offen
                :frage="unterText"
                :bestaetigen="t('spracheditor.unterflaechen.loeschen')"
                :testid="`${kennung}-unterflaeche-loeschen-frage`"
                @bestaetigen="emit('unterAntwort', true)"
                @abbrechen="emit('unterAntwort', false)"
            />
            <SprachflaecheKopieren
                v-if="kopierTeil && !lesend"
                :key="kopierTeil.id"
                data-offen
                :detail="detail"
                :flaeche-id="kopierTeil.id"
                :zeilen="zeilen ?? []"
                :kennung="kennung"
                :gesperrt="modusGrund"
                :fehler="kopierFehler"
                @kopieren="(ziel) => emit('kopieren', kopierTeil!, ziel)"
                @abbrechen="kopiert = undefined"
            />
        </section>

        <section v-if="stillgelegte.length > 0" class="flaechen__kasten" :data-testid="`${kennung}-stillgelegt`">
            <h4 class="flaechen__titel">{{ t("spracheditor.kasten.stillgelegt") }}</h4>
            <ul class="flaechen__still">
                <li v-for="teil in stillgelegte" :key="teil.id">
                    <span>{{ e2(teil.flaeche) }}</span>
                    <AvmKnopf
                        v-if="!lesend"
                        groesse="zeile"
                        :gesperrt="modusGrund"
                        :testid="`${kennung}-teil-zurueck`"
                        @click="emit('zurueckholen', teil)"
                    >
                        {{ t("spracheditor.flaeche.zurueckholen") }}
                    </AvmKnopf>
                </li>
            </ul>
        </section>
    </div>
</template>

<style scoped>
.flaechen {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.flaechen__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.flaechen__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.flaechen__werte {
    display: grid;
    gap: var(--space-2);
    margin: 0;
}

.flaechen__werte > div {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: var(--space-6);
}

.flaechen__werte dt {
    color: var(--color-text-muted);
}

.flaechen__werte dd {
    margin: 0;
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
}

.flaechen__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.flaechen__liste {
    display: grid;
    gap: var(--space-2);
}

/* Die Auswahl zeigt nur der Hintergrund der Zeile, kein Balken (Betreiber 2026-10-16). */
.flaechen__teil {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--space-6);
    padding: var(--space-2) var(--space-6);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.flaechen__teil:hover {
    background: var(--color-hover-wash);
}

.flaechen__teil[aria-selected="true"] {
    background: var(--color-active-wash);
}

.flaechen__teil:focus-visible,
.flaechen__mehr:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.flaechen__herkunft {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.flaechen__zahl {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.flaechen__mehr {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

.flaechen__still {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.flaechen__still li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
    .flaechen__teil {
        transition: none;
    }
}
</style>
