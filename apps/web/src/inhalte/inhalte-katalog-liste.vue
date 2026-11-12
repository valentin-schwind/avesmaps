<script setup lang="ts" generic="Z extends KatalogZeile, S extends string">
import { computed, useTemplateRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import type { MenueOption } from "../controls/avm-menueknopf";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import type { Kreis } from "../editor-liste/liste-modell";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import type { AnlegenZustand, HerkunftFilter, KatalogFilter } from "./inhalte-katalog-steuerung";

/**
 * Spalte 1 der Reiter des Fensters „Inhalte bearbeiten“ (WI-0254; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`): der Katalog
 * mit EINER Leiste (Suche, Trichter, Sortierzeichen, ✚ Neu), den Zeilen mit Statuskreis und Unterzeile und der Legende mit Zählung
 * darunter. Die Reiter Quellen und Literatur nehmen dieses Bauteil und liefern Texte, Zeilenform und das Formular zum Anlegen (Slot `neu`).
 *
 * - **Zeichen:** links trägt jede Zeile das Zeichen des Reiters (`zeichen`); ein Reiter mit Kategorien (Vorkommen) bestimmt es je Zeile (`zeichenVon`,
 *   Vorrang) und nennt die Kategorie im `title` (`zeichenTitel`); das Zeichen bleibt `aria-hidden`, die Kategorie steht in der Unterzeile.
 * - **Kreis:** ● aus Legacy oder Wiki, ◐ von der Redaktion angelegt oder geändert, ○ unterdrückt (Design Guide, Statuskreis).
 * - **Weitere Zeichen** des Reiters stehen im Slot `zeichen`, rechts neben Trichter und Sortierung und vor ✚ Neu (die Vorkommen: „Regeln als Text“).
 * - **Filter und Sortierung** stehen nur als Zeichen (`AvmFilterknopf`, `AvmMenueknopf`), nie als Zeilen (Betreiber 2026-10-11).
 * - **Tastatur:** ↑ ↓ Pos1 Ende wählen in der Liste; das Auswählen holt das Dokument, ohne zu fliegen (es gibt nichts auf der Karte).
 * - **Wechsel mit Änderungen:** Trägt der Entwurf Änderungen und wird ein anderes Dokument gewählt, fragt eine Bestätigung oben.
 */
export interface KatalogZeile {
    id: string;
    title: string;
    /** Ein Reiter ohne Stilllegen (die Korpora) lässt es weg. */
    stillgelegt?: boolean;
    herkunft: "legacy" | "editor";
}

/** Was die Liste vom Zustand des Reiters braucht (`createKatalog`, strukturell). */
export interface KatalogListeSteuerung<Z, S extends string> {
    readonly suche: Ref<string>;
    readonly herkunft: Ref<HerkunftFilter>;
    readonly zeigeStillgelegte: Ref<boolean>;
    readonly sortierung: Ref<S>;
    readonly zeilen: ComputedRef<readonly Z[]>;
    readonly listeLaedt: Ref<boolean>;
    readonly listeFehler: ShallowRef<unknown>;
    readonly mehrDa: ComputedRef<boolean>;
    ladeMehr(): void;
    ladeListeNeu(): void;
    readonly gewaehlt: Ref<string | undefined>;
    readonly wechselWunsch: Ref<string | undefined>;
    waehle(id: string): void;
    bestaetigeWechsel(): void;
    bleibe(): void;
    readonly anlegen: ShallowRef<AnlegenZustand>;
    oeffneAnlegen(): void;
}

const props = defineProps<{
    steuerung: KatalogListeSteuerung<Z, S>;
    /** Die Kennung des Reiters für die Testkennungen (`inhalte-<kennung>-leiste` …). */
    kennung: string;
    zeichen: EditorZeichenName;
    /** Das Zeichen je Zeile (Vorkommen: das der Kategorie); hat Vorrang vor `zeichen`. */
    zeichenVon?: ((zeile: Z) => EditorZeichenName) | undefined;
    /** Der `title` des Zeichens je Zeile (die Kategorie); ohne Angabe keiner. */
    zeichenTitel?: ((zeile: Z) => string | undefined) | undefined;
    titel: string;
    unterzeile: string;
    suchePlatzhalter: string;
    sucheBeschriftung: string;
    leerText: string;
    fehlerText: string;
    legendeBeschriftung: string;
    /** Ein eigener Filter statt Herkunft und Stillgelegte; ohne ihn gelten die beiden. */
    filter?: KatalogFilter | undefined;
    /** Die Zustände der Legende, wenn der Reiter nicht alle kennt (die Korpora haben keine stillgelegten); ohne Angabe alle drei. */
    legendeNamen?: Partial<Record<Kreis, string>> | undefined;
    /** Die Liste ist da: Erst dann stehen die Legende und der Satz „keine Treffer“. */
    mitLegende: boolean;
    zahlen: Readonly<Record<Kreis, number>>;
    sortierungen: readonly MenueOption[];
    sortierName: string;
    /** Das Zeichen einer Sortierung (Name oder Menge, auf- oder absteigend). */
    sortierZeichen: (wert: string) => { art: "name" | "menge"; umgekehrt: boolean };
    zeileUnter: (zeile: Z) => string;
    kreis: (zeile: Z) => Kreis;
    kreisName: (zeile: Z) => string;
    wechselFrage: string;
    darfSchreiben: boolean;
    telefon: boolean;
}>();

const emit = defineEmits<{
    /** Eine Zeile wurde angeklickt oder mit der Tastatur gewählt (auch die schon gewählte): Auf dem Telefon geht es dann eine Ebene weiter. */ gewaehlt: [
        id: string,
    ];
}>();

const s = props.steuerung;

const standardAbschnitte = computed<readonly FilterAbschnitt[]>(() => [
    {
        id: "herkunft",
        titel: t("inhalte.filter.herkunft"),
        art: "eins",
        werte: [
            { wert: "legacy", text: t("inhalte.filter.legacy") },
            { wert: "editor", text: t("inhalte.filter.editor") },
        ],
    },
    {
        id: "anzeigen",
        titel: t("inhalte.filter.anzeigen"),
        art: "mehrere",
        werte: [{ wert: "stillgelegt", text: t("inhalte.filter.stillgelegte") }],
    },
]);
const standardWahl = computed<FilterWahl>(() => ({
    herkunft: s.herkunft.value === "alle" ? [] : [s.herkunft.value],
    anzeigen: s.zeigeStillgelegte.value ? ["stillgelegt"] : [],
}));
const filterAbschnitte = computed<readonly FilterAbschnitt[]>(
    () => props.filter?.abschnitte ?? standardAbschnitte.value,
);
const filterWahl = computed<FilterWahl>(() => props.filter?.wahl ?? standardWahl.value);
function setzeFilter(abschnitt: string, werte: string[]): void {
    if (props.filter !== undefined) {
        props.filter.setze(abschnitt, werte);
        return;
    }
    if (abschnitt === "herkunft") s.herkunft.value = werte[0] === "legacy" || werte[0] === "editor" ? werte[0] : "alle";
    else s.zeigeStillgelegte.value = werte.includes("stillgelegt");
}
function loeseFilter(): void {
    if (props.filter !== undefined) {
        props.filter.loese();
        return;
    }
    s.herkunft.value = "alle";
    s.zeigeStillgelegte.value = false;
}

// --- Tastatur ---
const liste = useTemplateRef<HTMLUListElement>("liste");
function taste(event: KeyboardEvent): void {
    const zeilen = s.zeilen.value;
    if (zeilen.length === 0) return;
    const aktuell = zeilen.findIndex((zeile) => zeile.id === s.gewaehlt.value);
    const ziel =
        event.key === "ArrowDown"
            ? Math.min(zeilen.length - 1, aktuell + 1)
            : event.key === "ArrowUp"
              ? Math.max(0, aktuell < 0 ? 0 : aktuell - 1)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? zeilen.length - 1
                  : -1;
    if (ziel < 0) return;
    event.preventDefault();
    const zeile = zeilen[ziel];
    if (zeile === undefined) return;
    s.waehle(zeile.id);
    emit("gewaehlt", zeile.id);
    liste.value?.querySelector<HTMLElement>(`[data-zeile="${zeile.id}"]`)?.focus();
}
</script>

<template>
    <FensterSpalte
        breite="inspektor"
        :telefon="telefon"
        :titel="titel"
        :unterzeile="unterzeile"
        testid="inhalte-spalte-liste"
    >
        <template #leiste>
            <AvmListenleiste
                v-model="s.suche.value"
                :platzhalter="suchePlatzhalter"
                :beschriftung="sucheBeschriftung"
                :testid="`inhalte-${kennung}-leiste`"
            >
                <AvmFilterknopf
                    :abschnitte="filterAbschnitte"
                    :wahl="filterWahl"
                    :testid="`inhalte-${kennung}-filter`"
                    @setze="setzeFilter"
                    @loesen="loeseFilter"
                />
                <AvmMenueknopf
                    v-model="s.sortierung.value"
                    :optionen="sortierungen"
                    :bezeichnung="t('inhalte.sortierung.knopf', { wahl: sortierName })"
                    :menue-bezeichnung="t('inhalte.sortierung')"
                    im-fenster
                    :testid="`inhalte-${kennung}-sortierung`"
                >
                    <template #zeichen="{ wert }">
                        <AvmSortierzeichen
                            :art="sortierZeichen(wert).art"
                            :umgekehrt="sortierZeichen(wert).umgekehrt"
                        />
                    </template>
                </AvmMenueknopf>
                <!-- Weitere Zeichen des Reiters nach Trichter und Sortierung, etwa „Regeln als Text“ bei den Vorkommen. -->
                <slot name="zeichen" />
                <AvmKnopf
                    groesse="zeile"
                    art="gefuellt"
                    :gesperrt="darfSchreiben ? undefined : ''"
                    :title="darfSchreiben ? undefined : t('inhalte.nurLesen')"
                    :aria-expanded="s.anlegen.value.art !== 'aus'"
                    :testid="`inhalte-${kennung}-neu`"
                    @click="s.oeffneAnlegen()"
                >
                    ✚ {{ t("inhalte.neu") }}
                </AvmKnopf>
            </AvmListenleiste>
        </template>

        <AvmBestaetigung
            v-if="s.wechselWunsch.value !== undefined"
            :frage="wechselFrage"
            :folge="t('inhalte.wechsel.folge')"
            :bestaetigen="t('inhalte.wechsel.bestaetigen')"
            :abbrechen="t('inhalte.wechsel.bleiben')"
            testid="inhalte-wechsel-frage"
            @bestaetigen="s.bestaetigeWechsel()"
            @abbrechen="s.bleibe()"
        />

        <slot name="unter" />

        <slot name="neu" />

        <AvmHinweis v-if="s.listeFehler.value" ton="warnung" rolle="alert" testid="inhalte-liste-fehler">
            {{ fehlerText }}
        </AvmHinweis>
        <AvmKnopf v-if="s.listeFehler.value" groesse="zeile" testid="inhalte-liste-erneut" @click="s.ladeListeNeu()">{{
            t("notify.retry")
        }}</AvmKnopf>

        <p
            v-if="!s.listeFehler.value && !s.listeLaedt.value && s.zeilen.value.length === 0 && mitLegende"
            class="liste__leise"
            data-testid="inhalte-liste-leer"
        >
            {{ leerText }}
        </p>

        <ul
            v-if="s.zeilen.value.length > 0"
            ref="liste"
            class="liste__zeilen"
            :aria-label="titel"
            :data-testid="`inhalte-${kennung}-liste`"
            @keydown="taste"
        >
            <li v-for="zeile in s.zeilen.value" :key="zeile.id">
                <button
                    type="button"
                    class="zeile"
                    :class="{ 'is-gewaehlt': zeile.id === s.gewaehlt.value, 'is-still': zeile.stillgelegt === true }"
                    :aria-current="zeile.id === s.gewaehlt.value ? 'true' : undefined"
                    :data-zeile="zeile.id"
                    data-testid="inhalte-zeile"
                    @click="
                        s.waehle(zeile.id);
                        emit('gewaehlt', zeile.id);
                    "
                >
                    <span class="zeile__mini" aria-hidden="true" :title="zeichenTitel?.(zeile)"
                        ><EditorZeichen :name="zeichenVon?.(zeile) ?? zeichen"
                    /></span>
                    <span class="zeile__text">
                        <span class="zeile__l1">
                            <span class="zeile__name einzeilig">{{
                                zeile.title === "" ? t("inhalte.ohneTitel") : zeile.title
                            }}</span>
                            <AvmKreis :fuellung="kreis(zeile)" :name="kreisName(zeile)" />
                        </span>
                        <span class="zeile__l2 einzeilig">{{ zeileUnter(zeile) }}</span>
                    </span>
                </button>
            </li>
        </ul>
        <AvmKnopf
            v-if="s.mehrDa.value"
            groesse="zeile"
            :gesperrt="s.listeLaedt.value ? t('inhalte.laedt') : undefined"
            testid="inhalte-liste-mehr"
            @click="s.ladeMehr()"
        >
            {{ t("inhalte.mehr") }}
        </AvmKnopf>
        <p v-if="s.listeLaedt.value && s.zeilen.value.length === 0" class="liste__leise">{{ t("inhalte.laedt") }}</p>

        <AvmKreisLegende
            v-if="mitLegende"
            class="liste__legende"
            :namen="
                legendeNamen ?? {
                    voll: t('inhalte.kreis.voll'),
                    halb: t('inhalte.kreis.halb'),
                    leer: t('inhalte.kreis.leer'),
                }
            "
            :zahlen="zahlen"
            :beschriftung="legendeBeschriftung"
            :testid="`inhalte-${kennung}-legende`"
        />
    </FensterSpalte>
</template>

<style scoped>
.liste__zeilen {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.liste__legende {
    margin-top: var(--space-6);
}

.liste__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Eine Zeile wie jede Zeile des Hauses: durchsichtige Kante immer da, Zustände nach Guide §30.5. */
.zeile {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
    width: 100%;
    margin: 0;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.zeile:hover {
    background: var(--color-hover-wash);
}

.zeile:active {
    background: var(--color-active-wash);
}

.zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.zeile.is-gewaehlt,
.zeile.is-gewaehlt:hover {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

.zeile.is-still .zeile__text {
    opacity: 0.64;
}

.zeile__mini {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--space-24);
    height: var(--space-24);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    color: var(--color-accent-strong);
}

.zeile__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.zeile__l1 {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.zeile__name {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.zeile__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .zeile {
        transition: none;
    }
}
</style>
