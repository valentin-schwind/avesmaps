<script setup lang="ts">
import { computed, ref } from "vue";
import { INHALTE_VORKOMMEN_ARTEN, type InhalteVorkommenArt, type InhalteVorkommenSortierung } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import type { MenueOption } from "../controls/avm-menueknopf";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InhalteKatalogListe from "./inhalte-katalog-liste.vue";
import type { AnlegenZustand } from "./inhalte-katalog-steuerung";
import type { RegelTextSteuerung } from "./inhalte-regeln-text-steuerung";
import { kreisDesEintrags, UNTERREITER, zeichenDerArt, type Unterreiter } from "./inhalte-vorkommen-modell";
import type { VorkommenSteuerung } from "./inhalte-vorkommen-steuerung";
import { artName } from "./inhalte-vorkommen-texte";
import { wikiKlartext } from "./wiki-klartext";

/**
 * Spalte 1 des Reiters „Vorkommen“ (WI-0254, Runde 3; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`): der Katalog der Einträge in
 * der Form der Reiter (`inhalte-katalog-liste.vue`) mit den Worten der Vorkommen, den Unterreitern Alle · Fauna · Flora · Waren · Spezies und
 * der Unterzeile „Art · Gruppe · Verknüpfungen“. Das Zeichen links ist das der Kategorie (Blume, Pfote, Korb, Person; `zeichenDerArt`), im `title` mit ihrem Namen.
 *
 * - **✚ Neu** öffnet eine Zeile mit Name und Art. Vali wählte B am Betreiber-Gate „Vorkommen ohne Wiki-Artikel“ (WI-0254): Ein neuer Eintrag hat keinen
 *   Wiki-Schlüssel, eine eigene Avesmaps-Kennung und die Pille INOFFIZIELL | Avesmaps. Ein gleichlautender Name ist kein Beweis für denselben Eintrag:
 *   Es wird nie etwas zusammengelegt oder abgelehnt.
 * - **Sortierung** nur nach Titel (A–Z, Z–A).
 * - **„Regeln als Text“** (WI-0254 §13): ein Zeichen in der Leiste, rechts neben Trichter und Sortierung, schaltet die Ansicht „Regeln als Text“ an die Stelle von Stammdaten und Orten (`regelText.offen`);
 *   an steht das Zeichen markiert wie ein gedrückter Knopf.
 */
const props = defineProps<{
    steuerung: VorkommenSteuerung;
    regelText: RegelTextSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();

const emit = defineEmits<{ gewaehlt: [id: string] }>();

const s = props.steuerung;

/** Die Gruppe einer Zeile kommt roh aus dem Wiki („[[Pilz]]“); die Liste zeigt den Text. */
const gruppeText = (gruppe: string | undefined): string | undefined =>
    gruppe === undefined ? undefined : wikiKlartext(gruppe);

const gesamt = computed(() => s.liste.value?.zahlen.aktiv ?? 0);
const zahlen = computed(() => {
    const z = s.liste.value?.zahlen;
    return {
        voll: Math.max(0, (z?.aktiv ?? 0) - (z?.editor ?? 0)),
        halb: z?.editor ?? 0,
        "halb-rechts": 0,
        leer: z?.stillgelegt ?? 0,
    };
});
const unterzeile = computed(() => {
    const liste = s.liste.value;
    if (liste === undefined) return s.listeLaedt.value ? t("inhalte.laedt") : "";
    return liste.total === gesamt.value
        ? t("inhalte.vorkommen.unterzeile", { n: formatNumber(liste.total, 0) })
        : t("inhalte.vorkommen.unterzeileGefiltert", {
              treffer: formatNumber(liste.total, 0),
              gesamt: formatNumber(gesamt.value, 0),
          });
});

const SORT_NAMEN: Readonly<Record<InhalteVorkommenSortierung, MessageKey>> = {
    title: "inhalte.sortierung.title",
    title_desc: "inhalte.sortierung.title_desc",
};
const sortierungen = computed<readonly MenueOption[]>(() =>
    (Object.keys(SORT_NAMEN) as InhalteVorkommenSortierung[]).map((wert) => ({ wert, text: t(SORT_NAMEN[wert]) })),
);
const sortierName = computed(() => t(SORT_NAMEN[s.sortierung.value]));
const sortierZeichen = (wert: string): { art: "name" | "menge"; umgekehrt: boolean } => ({
    art: "name",
    umgekehrt: wert === "title_desc",
});

const UNTER_NAMEN: Readonly<Record<Unterreiter, MessageKey>> = {
    alle: "inhalte.vorkommen.unter.alle",
    fauna: "infoPanel.lore.fauna",
    flora: "infoPanel.lore.flora",
    ware: "infoPanel.lore.ware",
    spezies: "infoPanel.lore.spezies",
};
const unterOptionen = computed(() => UNTERREITER.map((wert) => ({ value: wert, label: t(UNTER_NAMEN[wert]) })));
const alsUnter = (wert: string): Unterreiter => UNTERREITER.find((eins) => eins === wert) ?? "alle";

// --- Neu ---
const neuerName = ref("");
const neueArt = ref<InhalteVorkommenArt>("fauna");
const artOptionen = computed(() => INHALTE_VORKOMMEN_ARTEN.map((wert) => ({ wert, text: artName(wert) })));
const alsArt = (wert: string): InhalteVorkommenArt =>
    (INHALTE_VORKOMMEN_ARTEN as readonly string[]).includes(wert) ? (wert as InhalteVorkommenArt) : "fauna";
const anlegenSatz = computed(() => {
    const z: AnlegenZustand = s.anlegen.value;
    return z.art === "abgelehnt" ? z.satz : undefined;
});
const neuOk = computed(() => neuerName.value.trim() !== "" && s.anlegen.value.art !== "laeuft");
async function anlegen(): Promise<void> {
    if (!neuOk.value) return;
    await s.legeAn(neuerName.value, neueArt.value);
    if (s.anlegen.value.art === "aus") neuerName.value = "";
}

const wechselFrage = computed(() => {
    const ziel = s.zeilen.value.find((zeile) => zeile.id === s.wechselWunsch.value);
    return t("inhalte.wechsel.frage", { name: ziel?.title ?? "" });
});
</script>

<template>
    <InhalteKatalogListe
        :steuerung="s"
        kennung="vorkommen"
        zeichen="vorkommen"
        :zeichen-von="(zeile) => zeichenDerArt(zeile.art)"
        :zeichen-titel="(zeile) => artName(zeile.art)"
        :titel="t('inhalte.vorkommen.titel')"
        :unterzeile="unterzeile"
        :suche-platzhalter="t('inhalte.vorkommen.suche.platzhalter')"
        :suche-beschriftung="t('inhalte.vorkommen.suche.beschriftung')"
        :leer-text="t('inhalte.vorkommen.leer')"
        :fehler-text="t('inhalte.vorkommen.liste.fehler')"
        :legende-beschriftung="t('inhalte.vorkommen.kreis.legende')"
        :mit-legende="s.liste.value !== undefined"
        :zahlen="zahlen"
        :sortierungen="sortierungen"
        :sortier-name="sortierName"
        :sortier-zeichen="sortierZeichen"
        :zeile-unter="
            (zeile) =>
                t('inhalte.vorkommen.zeile.unter', {
                    meta: [artName(zeile.art), gruppeText(zeile.gruppe)]
                        .filter((teil) => teil !== undefined && teil !== '')
                        .join(' · '),
                    n: formatNumber(zeile.verknuepfungen, 0),
                })
        "
        :kreis="kreisDesEintrags"
        :kreis-name="
            (zeile) =>
                zeile.stillgelegt
                    ? t('inhalte.kreis.leer')
                    : zeile.herkunft === 'editor'
                      ? t('inhalte.kreis.halb')
                      : t('inhalte.kreis.voll')
        "
        :wechsel-frage="wechselFrage"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @gewaehlt="(id: string) => emit('gewaehlt', id)"
    >
        <template #zeichen>
            <button
                type="button"
                class="liste__text"
                :aria-pressed="regelText.offen.value"
                :aria-label="t('inhalte.vorkommen.text.titel')"
                :title="t('inhalte.vorkommen.text.titel')"
                data-testid="inhalte-vorkommen-text"
                @click="regelText.umschalten()"
            >
                <!-- Zeilen mit Pfeil: der Text wird zu Regeln. -->
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M2 3.5h8M2 8h5.5M2 12.5h8" />
                    <path d="M9.5 8h4.5M12 6.2l2 1.8-2 1.8" />
                </svg>
            </button>
        </template>
        <template #unter>
            <AvmSegmente
                :model-value="s.unter.value"
                :options="unterOptionen"
                :label="t('inhalte.vorkommen.unter.beschriftung')"
                testid="inhalte-vorkommen-unter"
                @update:model-value="(wert: string) => (s.unter.value = alsUnter(wert))"
            />
        </template>
        <template #neu>
            <form
                v-if="s.anlegen.value.art !== 'aus'"
                class="liste__neu"
                data-testid="inhalte-vorkommen-neu-form"
                @submit.prevent="anlegen"
            >
                <label class="liste__neu-label">
                    <span>{{ t("inhalte.vorkommen.neu.name") }}</span>
                    <AvmEingabe
                        v-model="neuerName"
                        :placeholder="t('inhalte.vorkommen.neu.platzhalter')"
                        testid="inhalte-neu-name"
                    />
                </label>
                <label class="liste__neu-label">
                    <span>{{ t("inhalte.vorkommen.feld.kategorie") }}</span>
                    <AvmAuswahl
                        :model-value="neueArt"
                        :optionen="artOptionen"
                        testid="inhalte-neu-art"
                        @update:model-value="(wert: string) => (neueArt = alsArt(wert))"
                    />
                </label>
                <div class="liste__neu-knoepfe">
                    <AvmKnopf
                        typ="submit"
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="neuOk ? undefined : t('inhalte.vorkommen.neu.unvollstaendig')"
                        testid="inhalte-neu-anlegen"
                    >
                        {{ t("inhalte.neu.anlegen") }}
                    </AvmKnopf>
                    <AvmKnopf
                        groesse="zeile"
                        :aria-label="t('inhalte.neu.abbrechen')"
                        testid="inhalte-neu-abbrechen"
                        @click="s.schliesseAnlegen()"
                        >✕</AvmKnopf
                    >
                </div>
                <AvmHinweis v-if="anlegenSatz" ton="warnung" rolle="alert" testid="inhalte-neu-satz">{{
                    anlegenSatz
                }}</AvmHinweis>
                <p class="liste__leise">{{ t("inhalte.vorkommen.neu.hinweis") }}</p>
            </form>
        </template>
    </InhalteKatalogListe>
</template>

<style scoped>
.liste__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Das Zeichen „Regeln als Text“ in der Fassung der Zeichen neben Trichter und Sortierung (Kante, Fläche, Bedienhöhe, quadratisch); an steht es wie ein gedrückter Knopf. */
.liste__text {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: var(--avm-control-h);
    min-height: var(--avm-control-h);
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.liste__text svg {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentcolor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
}

/* Geschichtet, nicht gesetzt (Guide §30.1): Die Lasur liegt über der Fassung. */
.liste__text:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.liste__text:active,
.liste__text[aria-pressed="true"] {
    border-color: var(--color-accent-strong);
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
    color: var(--color-text-strong);
}

.liste__text:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

@media (pointer: coarse) {
    .liste__text {
        min-width: 44px;
        min-height: 44px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .liste__text {
        transition: none;
    }
}

.liste__neu {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.liste__neu-label {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.liste__neu-knoepfe {
    display: flex;
    gap: var(--space-6);
}
</style>
