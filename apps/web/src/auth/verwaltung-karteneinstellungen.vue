<script setup lang="ts">
/**
 * Der Eintrag „Karteneinstellungen“ der Systemsteuerung (WI-0166): die Voreinstellungen, mit denen Avesmaps jeden Besuch
 * beginnt. Was die Oberfläche rechnet, steht in `karteneinstellungen.ts`; hier steht nur, wie es aussieht.
 *
 * Die Form ist die abgenommene der Wegfindung (Design Guide §8 „Seiten mit vielen Einstellungen“, `verwaltung-wegfindung.vue`):
 * Panele nach Wirkort mit EINER ruhigen Zeile darunter, zwei Säulen, das Feld im Goldenen Schnitt der Säule, der Satz unter dem
 * Namen, an jeder Zeile die Folge einer Änderung, das Rücksetzzeichen ↺ rechtsbündig (wach nur bei Abweichung), kein Kreis.
 *
 * - **Ein Punkt sind zwei Felder** in der Spalte von Feld und Einheit: x (Osten) und y (Norden). Übernommen wird, wenn der Fokus
 *   den Punkt verlässt — nicht beim Wechsel von x nach y, sonst stünden zwei Änderungen im Protokoll, wo eine gemeint war.
 * - **Auswahl und Kästchen gehen sofort hinaus**, ohne Tippen; die Auswahl nimmt Feld und Einheit zusammen, damit ein Name
 *   wie „Reisegruppe zu Fuß“ Platz hat. Der Reisebeginn ist wie der Punkt EIN Wert aus zwei Teilen (Monat, Tag).
 * - **Zwischenüberschriften** über beide Säulen, im Panel „Routenplaner“ dieselben wie die Klappboxen des Planers.
 * - **Ein Auslöser, oben:** „Aktuelle Ansicht übernehmen“ nimmt Mitte und Zoom der Karte hinter dem Fenster (aus der Adresse).
 *   Links daneben steht, was die Karte gerade zeigt; stimmt es schon mit der Startansicht überein, ruht der Knopf mit dem Satz.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { isMessageKey, t } from "../i18n/i18n";
import {
    feldId,
    kartenansichtAusAdresse,
    panele,
    wertText,
    type Karteneinstellungen,
    type KarteneinstellungZeile,
} from "./karteneinstellungen";
import { authState } from "./session-state";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import GebietFarbfeld from "../gebietseditor/gebiet-farbfeld.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";
import { label } from "./verwaltung-text";
import VerwaltungZoomkurve from "./verwaltung-zoomkurve.vue";
import type { KurvenPunkt } from "@avesmaps3d/shared";

const props = defineProps<{
    karteneinstellungen: Karteneinstellungen;
    telefon: boolean;
}>();

const darf = authState.value.capabilities.includes("manage_system_settings");
const h = props.karteneinstellungen;
const jetzt = ref(new Date());
/** Die Adresse der Karte: Sie ändert sich mit jeder Bewegung, ohne Ereignis (`replaceState`). Darum ein ruhiger Takt. */
const adresse = ref(globalThis.location?.hash ?? "");
let takt: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    jetzt.value = new Date();
    void h.load();
    takt = setInterval(() => (adresse.value = globalThis.location?.hash ?? ""), 1_000);
});
onBeforeUnmount(() => clearInterval(takt));

const stand = computed(() => h.stand.value);
const sicht = computed(() => panele(stand.value, jetzt.value));
const zeilen = computed(() => sicht.value.flatMap((panel) => panel.zeilen));
const zeile = (id: string): KarteneinstellungZeile | undefined =>
    zeilen.value.find((eintrag) => eintrag.einstellung.id === id);
/** Gesperrt ohne eigenen Satz (der steht einmal oben), während ein Schreibweg läuft oder solange die Tafel fehlt. */
const gesperrt = computed(() =>
    !darf || h.busy.value !== null || stand.value?.source !== "database" ? "" : undefined,
);

/** Was die Karte gerade zeigt, und ob die Startansicht schon so steht. */
const karte = computed(() => kartenansichtAusAdresse(adresse.value));
const kartenSatz = computed(() => {
    const ansicht = karte.value;
    const position = zeile("startPosition");
    const zoom = zeile("startZoom");
    if (ansicht === null || position === undefined || zoom === undefined)
        return t("admin.karteneinstellungen.bar.none");
    return t("admin.karteneinstellungen.bar.current", {
        position: wertText(position.einstellung, ansicht.startPosition),
        zoom: wertText(zoom.einstellung, ansicht.startZoom),
    });
});
const gleichDerKarte = computed(() => {
    const ansicht = karte.value;
    const position = zeile("startPosition")?.eingestellt;
    const zoom = zeile("startZoom")?.eingestellt;
    if (ansicht === null || typeof position !== "object" || !("x" in position) || typeof zoom !== "number")
        return false;
    return (
        position.x === ansicht.startPosition.x && position.y === ansicht.startPosition.y && zoom === ansicht.startZoom
    );
});
const knopfGrund = computed(() => {
    if (!darf) return t("admin.karteneinstellungen.readOnly", { recht: t("auth.capability.manage_system_settings") });
    if (karte.value === null) return t("admin.karteneinstellungen.bar.none");
    if (gleichDerKarte.value) return t("admin.karteneinstellungen.bar.same");
    return gesperrt.value;
});
function uebernimmAnsicht(): void {
    if (karte.value !== null) void h.uebernimmAnsicht(karte.value);
}

const feld = (eintrag: KarteneinstellungZeile, teil?: "x" | "y" | "monat" | "tag"): string => {
    const id = feldId(eintrag.einstellung.id, teil);
    return h.felder.value[id] ?? eintrag.texte[id] ?? "";
};
const problem = (eintrag: KarteneinstellungZeile) => h.probleme.value[eintrag.einstellung.id];
/** Die Zwischenüberschrift eines Abschnitts: dieselben Wörter wie die Klappboxen des Planers. */
const abschnittName = (schluessel: string): string => label("admin.karteneinstellungen.abschnitt", schluessel);
/** Was hinter einem Zahlenfeld steht („Stunden“); ohne eigenen Eintrag in der Sprachtafel nichts. */
const einheit = (eintrag: KarteneinstellungZeile): string => {
    const key = `admin.karteneinstellungen.wert.${eintrag.einstellung.id}.einheit`;
    return isMessageKey(key) ? t(key) : "";
};
/** Was in einem leeren Textfeld leise steht („Reise von {von} nach {bis}“); ohne eigenen Eintrag in der Sprachtafel nichts. */
const platzhalter = (eintrag: KarteneinstellungZeile): string | undefined => {
    const key = `admin.karteneinstellungen.wert.${eintrag.einstellung.id}.platzhalter`;
    return isMessageKey(key) ? t(key) : undefined;
};
/** Die Punkte einer Kurve: der geltende Wert, sonst die Vorgabe. */
const kurvenPunkte = (eintrag: KarteneinstellungZeile): readonly KurvenPunkt[] => {
    if (Array.isArray(eintrag.eingestellt)) return eintrag.eingestellt as readonly KurvenPunkt[];
    return eintrag.einstellung.art === "kurve" ? eintrag.einstellung.vorgabe : [];
};
const ACHSEN = ["x", "y"] as const;
/** Der vorgelesene Name eines Achsenfelds: „Startposition, x (Osten)“. */
const achsenName = (achse: (typeof ACHSEN)[number], name: string): string =>
    achse === "x" ? t("admin.karteneinstellungen.axis.x", { name }) : t("admin.karteneinstellungen.axis.y", { name });
/** Den Punkt erst übernehmen, wenn der Fokus ihn verlässt; der Wechsel zwischen x und y ist keine Änderung. */
function verlassen(eintrag: KarteneinstellungZeile, event: FocusEvent): void {
    const ziel = event.relatedTarget instanceof HTMLElement ? event.relatedTarget.dataset["feldVon"] : undefined;
    if (ziel === eintrag.einstellung.id) return;
    void h.uebernimm(eintrag.einstellung.id);
}
const meldung = (eintraege: readonly KarteneinstellungZeile[]) => {
    const letzte = h.ergebnis.value;
    return letzte !== null && eintraege.some((eintrag) => eintrag.einstellung.id === letzte.id)
        ? letzte.result
        : undefined;
};
</script>

<template>
    <div
        class="karteneinstellungen"
        :class="{ 'karteneinstellungen--telefon': props.telefon }"
        data-testid="karteneinstellungen"
    >
        <VerwaltungLadeproblem
            :problems="h.loadProblems.value"
            :fehlt="h.unconfirmed.value"
            testid="karteneinstellungen-ladefehler"
            @bestaetigen="h.confirmAgain()"
            ><span>{{ t("admin.karteneinstellungen.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && h.loading.value" class="karteneinstellungen__leise">{{ t("admin.loading") }}</p>
        <template v-if="stand !== null">
            <AvmHinweis>
                <strong class="karteneinstellungen__erst">{{ t("admin.karteneinstellungen.leadFirst") }}</strong>
                {{ " " }}{{ t("admin.karteneinstellungen.lead") }}
            </AvmHinweis>
            <p
                v-if="stand.source !== 'database'"
                class="karteneinstellungen__warnung"
                data-testid="karteneinstellungen-quelle"
            >
                {{ t("admin.karteneinstellungen.source.unprovisioned") }}
            </p>
            <p v-if="!darf" class="karteneinstellungen__leise" data-testid="karteneinstellungen-nur-lesen">
                {{ t("admin.karteneinstellungen.readOnly", { recht: t("auth.capability.manage_system_settings") }) }}
            </p>
            <p
                v-if="stand.unknownKeys.length > 0"
                class="karteneinstellungen__warnung"
                data-testid="karteneinstellungen-unbekannt"
            >
                {{ t("admin.karteneinstellungen.unknownKeys", { keys: stand.unknownKeys.join(", ") }) }}
            </p>

            <!-- Die Leiste ganz oben: links, was die Karte gerade zeigt, rechts der EINE Auslöser. -->
            <div class="karteneinstellungen__leiste" data-testid="karteneinstellungen-leiste">
                <span class="karteneinstellungen__karte" data-testid="karteneinstellungen-karte">{{ kartenSatz }}</span>
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="knopfGrund"
                    testid="karteneinstellungen-uebernehmen"
                    @click="uebernimmAnsicht()"
                >
                    <span aria-hidden="true">⊕ </span>{{ t("admin.karteneinstellungen.bar.action") }}
                </AvmKnopf>
            </div>

            <FensterKarte
                v-for="panel in sicht"
                :key="panel.id"
                :titel="panel.titel"
                :data-testid="`karteneinstellungen-panel-${panel.id}`"
            >
                <p class="karteneinstellungen__wirkung">{{ panel.wirkung }}</p>
                <div class="karteneinstellungen__werte">
                    <template v-for="eintrag in panel.zeilen" :key="eintrag.einstellung.id">
                        <h4 v-if="eintrag.einstellung.abschnitt" class="karteneinstellungen__abschnitt avm-versalmitte">
                            {{ abschnittName(eintrag.einstellung.abschnitt) }}
                        </h4>
                        <div
                            class="karteneinstellungen__wert"
                            :class="{ 'karteneinstellungen__wert--breit': eintrag.einstellung.art === 'kurve' }"
                            :style="
                                eintrag.einstellung.rasterZeilen === undefined
                                    ? undefined
                                    : { gridRow: `span ${eintrag.einstellung.rasterZeilen}` }
                            "
                            :data-testid="`karteneinstellungen-${eintrag.einstellung.id}`"
                        >
                            <span class="karteneinstellungen__name">{{ eintrag.name }}</span>
                            <template v-if="eintrag.einstellung.art === 'punkt'">
                                <span
                                    v-for="achse in ACHSEN"
                                    :key="achse"
                                    class="karteneinstellungen__feld karteneinstellungen__feld--achse"
                                >
                                    <span class="karteneinstellungen__achse" aria-hidden="true">{{ achse }}</span>
                                    <AvmEingabe
                                        :model-value="feld(eintrag, achse)"
                                        :gesperrt="gesperrt"
                                        :ungueltig="problem(eintrag) !== undefined"
                                        :aria-label="achsenName(achse, eintrag.name)"
                                        :data-feld-von="eintrag.einstellung.id"
                                        inputmode="decimal"
                                        :testid="`karteneinstellungen-feld-${feldId(eintrag.einstellung.id, achse)}`"
                                        @update:model-value="h.tippe(feldId(eintrag.einstellung.id, achse), $event)"
                                        @blur="verlassen(eintrag, $event)"
                                        @keyup.enter="void h.uebernimm(eintrag.einstellung.id)"
                                    />
                                </span>
                            </template>
                            <!-- Eine Auswahl nimmt Feld und Einheit zusammen: „Reisegruppe zu Fuß“ braucht den Platz. -->
                            <span
                                v-else-if="eintrag.einstellung.art === 'auswahl'"
                                class="karteneinstellungen__feld karteneinstellungen__feld--breit"
                            >
                                <AvmAuswahl
                                    :model-value="feld(eintrag)"
                                    :optionen="eintrag.optionen"
                                    :gesperrt="gesperrt"
                                    :aria-label="eintrag.name"
                                    :testid="`karteneinstellungen-feld-${eintrag.einstellung.id}`"
                                    @update:model-value="void h.waehle(eintrag.einstellung.id, $event)"
                                />
                            </span>
                            <template v-else-if="eintrag.einstellung.art === 'schalter'">
                                <span class="karteneinstellungen__feld">
                                    <AvmKaestchen
                                        art="checkbox"
                                        :checked="feld(eintrag) === 'true'"
                                        :gesperrt="gesperrt"
                                        :hinweis="eintrag.name"
                                        :testid="`karteneinstellungen-feld-${eintrag.einstellung.id}`"
                                        @change="void h.waehle(eintrag.einstellung.id, String($event))"
                                        >{{
                                            feld(eintrag) === "true"
                                                ? t("admin.karteneinstellungen.on")
                                                : t("admin.karteneinstellungen.off")
                                        }}</AvmKaestchen
                                    >
                                </span>
                                <span class="karteneinstellungen__einheit"></span>
                            </template>
                            <!-- Eine Farbe: das Farbfeld mit dem Farbwähler des Browsers, daneben #rrggbb zum Tippen. -->
                            <span
                                v-else-if="eintrag.einstellung.art === 'farbe'"
                                class="karteneinstellungen__feld karteneinstellungen__feld--breit"
                            >
                                <GebietFarbfeld
                                    :farbe="eintrag.texte[eintrag.einstellung.id] ?? ''"
                                    :wahl="gesperrt === undefined ? eintrag.name : undefined"
                                    :testid="`karteneinstellungen-wahl-${eintrag.einstellung.id}`"
                                    @farbe="void h.waehle(eintrag.einstellung.id, $event)"
                                />
                                <AvmEingabe
                                    :model-value="feld(eintrag)"
                                    :gesperrt="gesperrt"
                                    :ungueltig="problem(eintrag) !== undefined"
                                    :aria-label="eintrag.name"
                                    :testid="`karteneinstellungen-feld-${eintrag.einstellung.id}`"
                                    @update:model-value="h.tippe(eintrag.einstellung.id, $event)"
                                    @blur="void h.uebernimm(eintrag.einstellung.id)"
                                    @keyup.enter="void h.uebernimm(eintrag.einstellung.id)"
                                />
                            </span>
                            <!-- Der Reisebeginn: Monat (mit „Unbestimmt“) und Tag, EIN Wert wie der Punkt. -->
                            <span
                                v-else-if="eintrag.einstellung.art === 'reisebeginn'"
                                class="karteneinstellungen__feld karteneinstellungen__feld--breit"
                            >
                                <AvmAuswahl
                                    :model-value="feld(eintrag, 'monat')"
                                    :optionen="eintrag.optionen"
                                    :gesperrt="gesperrt"
                                    :aria-label="t('admin.karteneinstellungen.month', { name: eintrag.name })"
                                    :testid="`karteneinstellungen-feld-${feldId(eintrag.einstellung.id, 'monat')}`"
                                    @update:model-value="void h.waehle(feldId(eintrag.einstellung.id, 'monat'), $event)"
                                />
                                <AvmEingabe
                                    class="karteneinstellungen__tag"
                                    :model-value="feld(eintrag, 'tag')"
                                    :gesperrt="gesperrt ?? (feld(eintrag, 'monat') === 'unbestimmt' ? '' : undefined)"
                                    :ungueltig="problem(eintrag) !== undefined"
                                    :aria-label="t('admin.karteneinstellungen.day', { name: eintrag.name })"
                                    inputmode="numeric"
                                    :testid="`karteneinstellungen-feld-${feldId(eintrag.einstellung.id, 'tag')}`"
                                    @update:model-value="h.tippe(feldId(eintrag.einstellung.id, 'tag'), $event)"
                                    @blur="void h.uebernimm(eintrag.einstellung.id)"
                                    @keyup.enter="void h.uebernimm(eintrag.einstellung.id)"
                                />
                            </span>
                            <!-- Ein Text (die Vorlage des Dateinamens): Feld und Einheit zusammen wie bei einer Auswahl. -->
                            <span
                                v-else-if="eintrag.einstellung.art === 'text'"
                                class="karteneinstellungen__feld karteneinstellungen__feld--breit"
                            >
                                <AvmEingabe
                                    :model-value="feld(eintrag)"
                                    :gesperrt="gesperrt"
                                    :ungueltig="problem(eintrag) !== undefined"
                                    :aria-label="eintrag.name"
                                    :placeholder="platzhalter(eintrag)"
                                    :maxlength="eintrag.einstellung.maxLaenge"
                                    :testid="`karteneinstellungen-feld-${eintrag.einstellung.id}`"
                                    @update:model-value="h.tippe(eintrag.einstellung.id, $event)"
                                    @blur="void h.uebernimm(eintrag.einstellung.id)"
                                    @keyup.enter="void h.uebernimm(eintrag.einstellung.id)"
                                />
                            </span>
                            <!-- Eine Kurve: der Editor steht über die volle Breite unter dem Namen. -->
                            <span
                                v-else-if="eintrag.einstellung.art === 'kurve'"
                                class="karteneinstellungen__feld karteneinstellungen__feld--breit"
                            ></span>
                            <template v-else>
                                <span class="karteneinstellungen__feld">
                                    <AvmEingabe
                                        :model-value="feld(eintrag)"
                                        :gesperrt="gesperrt"
                                        :ungueltig="problem(eintrag) !== undefined"
                                        :aria-label="eintrag.name"
                                        inputmode="decimal"
                                        :testid="`karteneinstellungen-feld-${eintrag.einstellung.id}`"
                                        @update:model-value="h.tippe(eintrag.einstellung.id, $event)"
                                        @blur="void h.uebernimm(eintrag.einstellung.id)"
                                        @keyup.enter="void h.uebernimm(eintrag.einstellung.id)"
                                    />
                                </span>
                                <span class="karteneinstellungen__einheit">{{ einheit(eintrag) }}</span>
                            </template>
                            <AvmKnopf
                                art="weich"
                                groesse="zeile"
                                class="karteneinstellungen__zurueck"
                                :gesperrt="!eintrag.abweichend || gesperrt === '' ? '' : undefined"
                                :title="
                                    eintrag.abweichend
                                        ? t('admin.karteneinstellungen.reset.to', { wert: eintrag.vorgabeText })
                                        : t('admin.karteneinstellungen.reset.resting')
                                "
                                :aria-label="t('admin.karteneinstellungen.reset.label', { name: eintrag.name })"
                                :testid="`karteneinstellungen-zurueck-${eintrag.einstellung.id}`"
                                @click="void h.zuruecksetzen(eintrag.einstellung.id)"
                            >
                                <span aria-hidden="true">↺</span>
                            </AvmKnopf>
                            <VerwaltungZoomkurve
                                v-if="eintrag.einstellung.art === 'kurve'"
                                class="karteneinstellungen__kurve"
                                :einstellung="eintrag.einstellung"
                                :punkte="kurvenPunkte(eintrag)"
                                :gesperrt="gesperrt"
                                :name="eintrag.name"
                                :testid="`karteneinstellungen-feld-${eintrag.einstellung.id}`"
                                @aendern="void h.waehle(eintrag.einstellung.id, JSON.stringify($event))"
                            />
                            <p class="karteneinstellungen__satz">
                                {{ eintrag.satz }}
                                <span class="karteneinstellungen__wirkt">{{ eintrag.folgeSatz }}</span>
                            </p>
                            <p
                                v-if="eintrag.statt !== null || problem(eintrag) !== undefined"
                                class="karteneinstellungen__unten"
                            >
                                <span v-if="problem(eintrag) !== undefined" class="karteneinstellungen__problem">{{
                                    t(problem(eintrag)!.key, problem(eintrag)!.params)
                                }}</span>
                                <span v-if="eintrag.statt !== null">{{ eintrag.statt }}</span>
                                <span v-if="eintrag.stand !== null">{{ eintrag.stand }}</span>
                            </p>
                        </div>
                    </template>
                </div>
                <VerwaltungMeldung
                    :ergebnis="meldung(panel.zeilen)"
                    :testid="`karteneinstellungen-meldung-${panel.id}`"
                />
            </FensterKarte>
        </template>
    </div>
</template>

<style scoped>
.karteneinstellungen {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    min-width: 0;
}

.karteneinstellungen__erst {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-regular);
}

.karteneinstellungen__leise,
.karteneinstellungen__wirkung {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.karteneinstellungen__wirkung {
    margin-bottom: var(--space-6);
}

.karteneinstellungen__warnung {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

/* Die Leiste ganz oben: was die Karte gerade zeigt, und der EINE Auslöser. */
.karteneinstellungen__leiste {
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

.karteneinstellungen__karte {
    min-width: 0;
    color: var(--color-text);
    font-size: var(--font-size-small);
}

.karteneinstellungen__werte {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8) var(--space-24);
    margin: 0;
    align-items: start;
}

/* Das Feld beginnt in JEDER Zeile an derselben Stelle: im Goldenen Schnitt der Säule (wie in der Wegfindung). */
.karteneinstellungen__wert {
    display: grid;
    grid-template-columns: minmax(0, 61.8%) 96px minmax(92px, 1fr) var(--space-24);
    gap: var(--space-2) var(--space-6);
    align-items: center;
    min-width: 0;
}

.karteneinstellungen__name {
    min-width: 0;
}

/* Eine Kurve steht über beide Säulen, der Editor über die volle Breite der Zeile. */
.karteneinstellungen__wert--breit {
    grid-column: 1 / -1;
}

.karteneinstellungen__kurve {
    grid-column: 1 / -1;
    max-width: 720px;
}

.karteneinstellungen__feld {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.karteneinstellungen__feld :deep(.eingabe-huelle),
.karteneinstellungen__feld :deep(.eingabe) {
    width: 100%;
    min-width: 0;
}

/* Die Achse vor dem Feld eines Punkts: klein und leise, damit beide Felder an ihrer Stelle beginnen. */
/* Eine Auswahl und der Reisebeginn nehmen Feld und Einheit zusammen; das Feld beginnt trotzdem an derselben Stelle. */
.karteneinstellungen__feld--breit {
    grid-column: 2 / 4;
}

.karteneinstellungen__feld--breit :deep(.auswahl-huelle),
.karteneinstellungen__feld--breit :deep(.auswahl) {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
}

/* Der Tag des Reisebeginns: zwei Ziffern, rechts neben dem Monat. */
.karteneinstellungen__feld--breit :deep(.karteneinstellungen__tag),
.karteneinstellungen__feld--breit :deep(.karteneinstellungen__tag .eingabe) {
    flex: none;
    width: calc(var(--space-24) * 2);
}

.karteneinstellungen__einheit {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

/* Die Zwischenüberschriften stehen über beide Säulen, wie in der Wegfindung. */
.karteneinstellungen__abschnitt {
    grid-column: 1 / -1;
    margin: var(--space-6) 0 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

.karteneinstellungen__abschnitt:first-child {
    margin-top: 0;
}

.karteneinstellungen__achse {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.karteneinstellungen__satz {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.karteneinstellungen__unten {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.karteneinstellungen__problem {
    color: var(--color-danger-soft-text);
}

/* Rücksetzen: quadratisch und so hoch wie das Feld; still, solange der Wert auf seiner Vorgabe steht. */
.karteneinstellungen__zurueck :deep(.knopf) {
    width: var(--space-24);
    min-width: var(--space-24);
    padding-inline: 0;
}

.karteneinstellungen__zurueck :deep(.knopf:disabled) {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-muted);
    opacity: 0.7;
    cursor: default;
}

@media (max-width: 900px) {
    .karteneinstellungen__werte {
        grid-template-columns: minmax(0, 1fr);
    }
}

.karteneinstellungen--telefon .karteneinstellungen__werte {
    grid-template-columns: minmax(0, 1fr);
}
</style>
