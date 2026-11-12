<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import InhalteRegelnTextFeld from "./inhalte-regeln-text-feld.vue";
import { TEXT_PLATZHALTER, zeilenMarken } from "./inhalte-regeln-text-modell";
import InhalteRegelnTextSchreibweise from "./inhalte-regeln-text-schreibweise.vue";
import type { RegelTextSteuerung } from "./inhalte-regeln-text-steuerung";
import InhalteRegelnTextVorschau from "./inhalte-regeln-text-vorschau.vue";

/**
 * Die Ansicht „Regeln als Text“ im Reiter „Vorkommen“ (WI-0254 §13 und §14; Entwurf `j-text-ansicht.js`): Sie steht an der Stelle von Stammdaten und Orten, die Liste links bleibt. Links der TEXT (Feld mit
 * Zeilennummern, Prüfen, Leeren, Beispiel, die Klappe „Schreibweise“), rechts die VORSCHAU des letzten Prüfens. Wo die Spalte zu schmal für zwei Spalten ist (am Telefon), stehen beide untereinander.
 *
 * - 🔴 **Der Text ist die einzige Quelle** (Zustand in `inhalte-regeln-text-steuerung.ts`): Eine Antwort in der Vorschau schreibt den Text um und prüft neu; angelegt wird erst mit „Übernehmen“, einer EIGENEN
 *   Operation über alle Einträge, nicht dem Entwurf des Fensters und nicht „Speichern“ im Fuß.
 * - **Telefon:** die Ansicht ist eine eigene Ebene; „‹ Vorkommen“ führt zurück in die Liste (das Fenster führt die Ebene). Sonst steht „Schließen“ im Kopf.
 * - Das Feld ist nach „Übernehmen“ gesperrt, solange die Anfrage läuft, damit der Text, den der Server liest, der bleibt, den er zurückgibt (`rest`).
 */
const props = defineProps<{
    steuerung: RegelTextSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ schliesse: [] }>();

const s = props.steuerung;
const feld = useTemplateRef<InstanceType<typeof InhalteRegelnTextFeld>>("feld");
/** Die Marken am Rand gehören zur Vorschau: Sie gelten nur, solange der Text der geprüfte ist. */
const marken = computed(() => (s.aktuell.value ? zeilenMarken(s.ergebnis.value) : zeilenMarken(undefined)));

function schliesse(): void {
    s.schliesse();
    emit("schliesse");
}
function leere(): void {
    s.leere();
    feld.value?.fokus();
}
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="t('inhalte.vorkommen.text.titel')"
        :unterzeile="t('inhalte.vorkommen.text.unter')"
        testid="inhalte-spalte-regeltext"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-text-zurueck" @click="schliesse">{{
                t("inhalte.vorkommen.zurueck.liste")
            }}</AvmKnopf>
        </template>
        <template v-else #kopf>
            <AvmKnopf groesse="zeile" testid="inhalte-text-schliessen" @click="schliesse">{{
                t("fenster.close")
            }}</AvmKnopf>
        </template>

        <div class="tx">
            <div class="tx__raster">
                <div class="tx__links">
                    <h4 class="tx__kopf avm-versalmitte">{{ t("inhalte.vorkommen.text.kopfText") }}</h4>
                    <InhalteRegelnTextFeld
                        ref="feld"
                        :model-value="s.text.value"
                        :marken="marken"
                        :markierung="s.markierung.value"
                        :gesperrt="s.beschaeftigt.value"
                        :bezeichnung="t('inhalte.vorkommen.text.feld')"
                        :platzhalter="TEXT_PLATZHALTER"
                        @update:model-value="s.tippe"
                        @pruefen="void s.pruefe()"
                    />
                    <p class="tx__hinweis">{{ t("inhalte.vorkommen.text.hinweisFeld") }}</p>
                    <div class="tx__knoepfe">
                        <AvmKnopf
                            art="gefuellt"
                            :gesperrt="s.beschaeftigt.value ? '' : undefined"
                            testid="inhalte-text-pruefen"
                            @click="void s.pruefe()"
                            >{{ t("inhalte.vorkommen.text.pruefen") }}</AvmKnopf
                        >
                        <AvmKnopf
                            :gesperrt="s.beschaeftigt.value ? '' : undefined"
                            testid="inhalte-text-leeren"
                            @click="leere"
                            >{{ t("inhalte.vorkommen.text.leeren") }}</AvmKnopf
                        >
                        <AvmKnopf
                            :gesperrt="s.beschaeftigt.value ? '' : undefined"
                            testid="inhalte-text-beispiel"
                            @click="s.beispiel()"
                            >{{ t("inhalte.vorkommen.text.beispiel") }}</AvmKnopf
                        >
                    </div>
                    <InhalteRegelnTextSchreibweise @einfuegen="(text, art) => feld?.fuegeEin(text, art)" />
                </div>
                <div class="tx__rechts">
                    <h4 class="tx__kopf avm-versalmitte">{{ t("inhalte.vorkommen.text.kopfVorschau") }}</h4>
                    <InhalteRegelnTextVorschau :steuerung="steuerung" :darf-schreiben="darfSchreiben" />
                </div>
            </div>
        </div>
    </FensterSpalte>
</template>

<style scoped>
/* Textfeld und Vorschau nebeneinander, wo die Spalte breit genug ist, sonst untereinander (Containerabfrage auf die Spalte). */
.tx {
    container: tx / inline-size;
}

.tx__raster {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-12);
    align-items: start;
}

.tx__links,
.tx__rechts {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

/* Eine Regel steht in der Kurzschrift in EINER Zeile (die Zeile der Wiki-Infobox): Das Textfeld bekommt etwas mehr Breite als die Vorschau. */
@container tx (min-width: 760px) {
    .tx__raster {
        grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    }
}

.tx__kopf {
    margin: 0;
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    hyphens: none;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.tx__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.tx__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}
</style>
