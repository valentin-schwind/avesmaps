<script setup lang="ts">
/**
 * Der Reiter „Zoombänder“ der Systemsteuerung (WI-0221; Vorlage Fassung 4, Betreiber 2026-10-18: „passt … das mockup ist das
 * interaktive blatt“). Was die Oberfläche rechnet, steht in `zoombaender.ts`; hier steht nur, wie es aussieht.
 *
 * - Panele nach Wirkort (Orte, Wege und Gewässer, Landschaften, Herrschaftsgebiete, Kraftlinien, Gelände), je Panel zwei Säulen, über jeder
 *   Säule die Bandzahlen 0 bis 8 (`zoomspanne-kopf.vue`) im Raster der Zellen darunter (Design Guide §8, „Seiten mit vielen
 *   Einstellungen“).
 * - Je Zeile ihre Spuren (Zeichen, Name, Linie …) mit dem gemeinsamen Schieber (`fenster/zoomspanne.vue`), rechts „3 bis 8“, am Zeilenende
 *   ↺ (wach nur bei Abweichung). Unter einer abweichenden Spur steht, was sie braucht.
 * - **Ein Auslöser oben:** „Übernehmen“ schickt alle geänderten Spannen auf einmal (Passkey, ein Eintrag im Protokoll).
 * - Vorschau: Eine Bandzahl im Kopf rahmt dieses Band in jeder Spanne; Zeilen, von denen dort nichts zu sehen ist, treten zurück.
 * - Herrschaftsgebiete nur zur Ansicht (F1): Ihre Spannen bearbeitet der Gebietseditor, je Gebiet und Fläche. Der Verweis „Im
 *   Gebietseditor bearbeiten“ (Vorlage Fassung 4) ist der Tiefe Link `?tab=gebietseditor` im Editor-Modus, dieselbe Stelle wie jedes
 *   Werkzeug (`editor-panel/editor-panel-nav.ts`); die Karte lädt dafür neu.
 */
import { computed, onMounted, ref } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import ZoomSpanne from "../fenster/zoomspanne.vue";
import ZoomSpanneKopf from "../fenster/zoomspanne-kopf.vue";
import { t } from "../i18n/i18n";
import { authState } from "../auth/session-state";
import VerwaltungLadeproblem from "../auth/verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import { panele, vonBisText, vorschau, type PanelSicht, type SpurSicht, type Zoombaender } from "./zoombaender";

/** Der Tiefe Link auf den Gebietseditor im Editor-Modus (WI-0218, EDIT-0001 §3.2): öffnet sein Fenster wie das Verb im Editorpanel. */
const GEBIETSEDITOR_LINK = "/edit?tab=gebietseditor";

const props = defineProps<{
    zoombaender: Zoombaender;
    telefon: boolean;
}>();

const darf = authState.value.capabilities.includes("manage_display_settings");
const h = props.zoombaender;
const jetzt = ref(new Date());
onMounted(() => {
    jetzt.value = new Date();
    void h.load();
});

/** Das Band der Vorschau; ohne Wahl die Mitte. */
const blick = ref(4);
const stand = computed(() => h.stand.value);
const sicht = computed(() => panele(stand.value, h.entwurf.value, blick.value, jetzt.value));
const zuSehen = computed(() => vorschau(sicht.value));
const geaendert = computed(() =>
    sicht.value.flatMap((panel) => panel.zeilen.flatMap((z) => z.spuren)).filter((s) => s.geaendert),
);
const abweichend = computed(() => stand.value?.zeilen.length ?? 0);
/** Gesperrt ohne eigenen Satz (der steht einmal oben), während übernommen wird oder solange die Tafel fehlt. */
const gesperrt = computed(() => (!darf || h.busy.value || stand.value?.source !== "database" ? "" : undefined));

const zustandSatz = computed(() =>
    geaendert.value.length > 0
        ? t("admin.zoombaender.state.pending", { n: geaendert.value.length })
        : abweichend.value > 0
          ? t("admin.zoombaender.state.applied", { n: abweichend.value })
          : t("admin.zoombaender.state.default"),
);
const knopfGrund = computed(() => {
    if (!darf) return t("admin.zoombaender.readOnly", { recht: t("auth.capability.manage_display_settings") });
    if (geaendert.value.length === 0) return t("admin.zoombaender.bar.nothing");
    return gesperrt.value;
});
const blickSatz = computed(() => {
    const rand =
        blick.value === 0
            ? t("admin.zoombaender.preview.far")
            : blick.value === 8
              ? t("admin.zoombaender.preview.near")
              : "";
    return t("admin.zoombaender.preview.visible", { n: zuSehen.value.sichtbar, alle: zuSehen.value.alle }) + rand;
});

/** Die Säulen eines Panels: die erste Hälfte der Zeilen links, die zweite rechts (am Telefon eine Säule). */
function saeulen(panel: PanelSicht) {
    if (props.telefon) return [panel.zeilen];
    const halb = Math.ceil(panel.zeilen.length / 2);
    return [panel.zeilen.slice(0, halb), panel.zeilen.slice(halb)].filter((teil) => teil.length > 0);
}
const griffName = (spur: SpurSicht, zeile: string) => (seite: "von" | "bis") =>
    t(seite === "von" ? "admin.zoombaender.handle.from" : "admin.zoombaender.handle.to", {
        name: `${zeile} · ${spur.name}`,
    });
const zellTitel = (band: number): string => t("admin.zoombaender.cell", { band });
</script>

<template>
    <div class="zoombaender" :class="{ 'zoombaender--telefon': props.telefon }" data-testid="zoombaender">
        <VerwaltungLadeproblem
            :problems="h.loadProblems.value"
            :fehlt="h.unconfirmed.value"
            testid="zoombaender-ladefehler"
            @bestaetigen="h.confirmAgain()"
            ><span>{{ t("admin.zoombaender.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && h.loading.value" class="zoombaender__leise">{{ t("admin.loading") }}</p>
        <template v-if="stand !== null">
            <AvmHinweis>
                <strong class="zoombaender__erst">{{ t("admin.zoombaender.leadFirst") }}</strong>
                {{ " " }}{{ t("admin.zoombaender.lead") }}
            </AvmHinweis>
            <p class="zoombaender__leise">{{ t("admin.zoombaender.intro") }}</p>
            <p v-if="stand.source !== 'database'" class="zoombaender__warnung" data-testid="zoombaender-quelle">
                {{ t("admin.zoombaender.source.unprovisioned") }}
            </p>
            <p v-if="!darf" class="zoombaender__leise" data-testid="zoombaender-nur-lesen">
                {{ t("admin.zoombaender.readOnly", { recht: t("auth.capability.manage_display_settings") }) }}
            </p>
            <p v-if="stand.unknownKeys.length > 0" class="zoombaender__warnung" data-testid="zoombaender-unbekannt">
                {{ t("admin.zoombaender.unknownKeys", { keys: stand.unknownKeys.join(", ") }) }}
            </p>

            <!-- Die Leiste ganz oben: links der Stand, rechts der EINE Auslöser. -->
            <div class="zoombaender__leiste" data-testid="zoombaender-leiste">
                <span class="zoombaender__zustand" data-testid="zoombaender-zustand">{{ zustandSatz }}</span>
                <span class="zoombaender__knoepfe">
                    <AvmKnopf
                        v-if="geaendert.length > 0"
                        art="weich"
                        :gesperrt="h.busy.value ? '' : undefined"
                        testid="zoombaender-verwerfen"
                        @click="h.verwerfen()"
                        >{{ t("admin.zoombaender.bar.discard") }}</AvmKnopf
                    >
                    <AvmKnopf
                        art="gefuellt"
                        :gesperrt="knopfGrund"
                        testid="zoombaender-uebernehmen"
                        @click="void h.uebernehmen()"
                        >{{ t("admin.zoombaender.bar.apply") }}</AvmKnopf
                    >
                </span>
            </div>
            <VerwaltungMeldung :ergebnis="h.ergebnis.value ?? undefined" testid="zoombaender-meldung" />

            <p class="zoombaender__vorschau" data-testid="zoombaender-vorschau">
                <span>{{ t("admin.zoombaender.preview.label") }}</span>
                <strong class="zoombaender__blick">{{ blick }}</strong>
                <span class="zoombaender__leise">{{ blickSatz }}</span>
            </p>

            <FensterKarte
                v-for="panel in sicht"
                :key="panel.id"
                :titel="panel.titel"
                :data-testid="`zoombaender-panel-${panel.id}`"
            >
                <p class="zoombaender__wirkung">{{ panel.wirkung }}</p>
                <p v-if="panel.hinweis !== null" class="zoombaender__hinweis">{{ panel.hinweis }}</p>
                <a
                    v-if="panel.id === 'gebiete'"
                    class="zoombaender__editor"
                    :href="GEBIETSEDITOR_LINK"
                    data-testid="zoombaender-zum-gebietseditor"
                    >{{ t("admin.zoombaender.zumGebietseditor") }}</a
                >
                <div class="zoombaender__saeulen">
                    <div v-for="(teil, ti) in saeulen(panel)" :key="ti" class="zoombaender__saeule">
                        <div class="zoombaender__kopf">
                            <ZoomSpanneKopf
                                class="zoombaender__kopfzahlen"
                                :markiert="blick"
                                :titel="(b: number) => t('admin.zoombaender.preview.title', { band: b })"
                                :beschriftung="t('admin.zoombaender.preview.group')"
                                :testid="`zoombaender-kopf-${panel.id}-${ti}`"
                                @band="blick = $event"
                            />
                        </div>
                        <div
                            v-for="zeile in teil"
                            :key="zeile.key"
                            class="zoombaender__zeile"
                            :class="{ 'zoombaender__zeile--blass': zeile.blass }"
                            :data-testid="`zoombaender-zeile-${zeile.key}`"
                        >
                            <span class="zoombaender__name" :style="{ gridRow: `span ${zeile.spuren.length}` }">
                                <b>{{ zeile.name }}</b>
                                <span v-if="zeile.notiz !== null" class="zoombaender__leise">{{ zeile.notiz }}</span>
                                <span v-if="zeile.stand !== null" class="zoombaender__leise">{{ zeile.stand }}</span>
                            </span>
                            <div v-for="spur in zeile.spuren" :key="spur.spur.id" class="zoombaender__spur">
                                <span class="zoombaender__was">{{ spur.name }}</span>
                                <span v-if="spur.spur.nurAnsicht === 'abgeschaltet'" class="zoombaender__fest">{{
                                    spur.gesperrt
                                }}</span>
                                <ZoomSpanne
                                    v-else
                                    class="zoombaender__schieber"
                                    :von="spur.spanne.von"
                                    :bis="spur.spanne.bis"
                                    :vorgabe="spur.spur.vorgabe"
                                    :markiert="blick"
                                    :gesperrt="spur.gesperrt ?? gesperrt"
                                    :zell-titel="zellTitel"
                                    :name="`${zeile.name} · ${spur.name}`"
                                    :griff-name="griffName(spur, zeile.name)"
                                    tippen
                                    paar
                                    :testid="`zoombaender-spur-${spur.spur.id}`"
                                    @aendere="h.setze(spur.spur.id, { von: $event.von ?? 0, bis: $event.bis ?? 8 })"
                                />
                                <span
                                    class="zoombaender__vonbis"
                                    :class="{ 'zoombaender__vonbis--geaendert': spur.abweichend }"
                                    :data-testid="`zoombaender-vonbis-${spur.spur.id}`"
                                    >{{ spur.spur.nurAnsicht === "abgeschaltet" ? "" : vonBisText(spur.spanne) }}</span
                                >
                                <span class="zoombaender__folge" :data-testid="`zoombaender-folge-${spur.spur.id}`">{{
                                    spur.folge ?? ""
                                }}</span>
                            </div>
                            <AvmKnopf
                                v-if="!panel.ansicht"
                                art="weich"
                                groesse="zeile"
                                class="zoombaender__zurueck"
                                :style="{ gridRow: `1 / span ${zeile.spuren.length}` }"
                                :gesperrt="!zeile.zuruecksetzbar || gesperrt === '' ? '' : undefined"
                                :title="
                                    zeile.zuruecksetzbar
                                        ? t('admin.zoombaender.reset.to')
                                        : t('admin.zoombaender.reset.resting')
                                "
                                :aria-label="t('admin.zoombaender.reset.label', { name: zeile.name })"
                                :testid="`zoombaender-zurueck-${zeile.key}`"
                                @click="h.zuruecksetzen(zeile.key)"
                            >
                                <span aria-hidden="true">↺</span>
                            </AvmKnopf>
                        </div>
                    </div>
                </div>
            </FensterKarte>
        </template>
    </div>
</template>

<style scoped>
.zoombaender {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    min-width: 0;
}

.zoombaender__erst {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-regular);
}

.zoombaender__leise,
.zoombaender__wirkung {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zoombaender__wirkung {
    margin-bottom: var(--space-4);
}

.zoombaender__hinweis {
    margin: 0 0 var(--space-6);
    color: var(--color-text);
    font-size: var(--font-size-small);
}

.zoombaender__editor {
    justify-self: start;
    margin: 0 0 var(--space-6);
    font-size: var(--font-size-small);
}

.zoombaender__warnung {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

/* Die Leiste ganz oben: der Stand und der EINE Auslöser. */
.zoombaender__leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6) var(--space-10);
    padding: var(--space-8) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.zoombaender__zustand {
    min-width: 0;
    font-size: var(--font-size-small);
}

.zoombaender__knoepfe {
    display: flex;
    gap: var(--space-6);
}

.zoombaender__vorschau {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    margin: 0;
    font-size: var(--font-size-small);
}

.zoombaender__blick {
    color: var(--color-accent-strong);
    font-size: var(--font-size-body);
}

.zoombaender__saeulen {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8) var(--space-24);
    align-items: start;
}

/*
 * Kopf und Zeilen teilen EIN Spaltenraster: Name, Spur, Schieber, „3 bis 8“, ↺. So steht jede Bandzahl über ihrer Zelle (Betreiber am
 * Entwurf: „die zahlen passen irgendwie nicht“).
 */
.zoombaender__saeule {
    --zb-spalten: minmax(0, 1fr) 4.5em minmax(0, 1.7fr) 4.5em var(--space-24);
    display: grid;
    gap: var(--space-6);
    min-width: 0;
}

.zoombaender__kopf,
.zoombaender__zeile {
    display: grid;
    grid-template-columns: var(--zb-spalten);
    column-gap: var(--space-6);
    align-items: center;
    min-width: 0;
}

.zoombaender__kopfzahlen {
    grid-column: 3;
}

.zoombaender__zeile {
    row-gap: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
}

.zoombaender__zeile--blass {
    opacity: 0.55;
}

.zoombaender__name {
    grid-column: 1;
    display: flex;
    flex-direction: column;
    align-self: start;
    min-width: 0;
}

.zoombaender__name b {
    font-weight: var(--font-weight-regular);
}

/* Eine Spur: Name der Spur, Schieber, „3 bis 8“ und darunter, was eine Abweichung braucht; im Raster der Zeile (subgrid). */
.zoombaender__spur {
    grid-column: 2 / 5;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
    row-gap: var(--space-2);
    min-width: 0;
}

.zoombaender__was {
    grid-column: 1;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zoombaender__fest {
    grid-column: 2;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-style: italic;
}

.zoombaender__schieber {
    grid-column: 2;
    min-width: 0;
}

.zoombaender__vonbis {
    grid-column: 3;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.zoombaender__vonbis--geaendert {
    color: var(--color-accent-strong);
}

/* Was eine Abweichung braucht: unter ihrer Spur, über Schieber und „3 bis 8“. Leer nimmt sie keinen Platz. */
.zoombaender__folge {
    grid-column: 1 / -1;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zoombaender__folge:empty {
    display: none;
}

.zoombaender__zurueck {
    grid-column: 5;
    align-self: start;
}

.zoombaender__zurueck :deep(.knopf) {
    width: var(--space-24);
    min-width: var(--space-24);
    padding-inline: 0;
}

.zoombaender__zurueck :deep(.knopf:disabled) {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-muted);
    opacity: 0.7;
    cursor: default;
}

@media (max-width: 900px) {
    .zoombaender__saeulen {
        grid-template-columns: minmax(0, 1fr);
    }
}

.zoombaender--telefon .zoombaender__saeulen {
    grid-template-columns: minmax(0, 1fr);
}

.zoombaender--telefon .zoombaender__saeule {
    --zb-spalten: minmax(0, 1fr) 3.5em minmax(0, 2fr) 3.5em var(--space-24);
}
</style>
