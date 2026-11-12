<script setup lang="ts">
import { computed, ref } from "vue";
import type { Benachrichtigung, PhotoboxStapel } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { hatUngespeichert } from "../system/ungespeichert";
import { useNeueVersion } from "../system/neue-version";
import AvmAvatar from "../controls/avm-avatar.vue";
import KanalSiegel from "./kanal-siegel.vue";
import {
    absender,
    absenderRolle,
    kreisVon,
    satzTeile,
    standSatz,
    wartetAufAntwort,
    type Benachrichtigungen,
} from "./benachrichtigungen";

/**
 * Ein Eintrag der Glocke (WI-0136 N2/N3, Blatt `review/wi-0136/blatt.png` (a), (b)): Kreis, Marke (Siegel für Claudia und Claudio,
 * Avatar für Personen, ⚙ für das System), Name, Rolle, Zeit, ein Satz mit der OPS-Nummer als Link, darunter Knöpfe oder der Stand.
 *
 * „Fix ist live“ an die meldende Person: erst „↺ Neu laden“, solange die Seite eine neue Version kennt, danach „Gelöst“ / „Noch nicht
 * gelöst“ (mit Kommentar, an der Stelle). Hat jemand im Kanal geantwortet, steht der Stand statt der Knöpfe.
 */
/** `leise`: der Eintrag steht im Archiv der Glocke (gelesen, beim letzten Öffnen schon da). */
const props = defineProps<{
    eintrag: Benachrichtigung;
    glocke: Benachrichtigungen;
    kanal: boolean;
    /** Die Redaktion der Meldungen ist da (Editor › Community): Dann ist die COM-Nummer ein Link. */
    meldungen?: boolean;
    /** Die Medienverwaltung ist für diese Person offen (`view_media_private`): Dann ist der Satz der neuen Reisebilder ein Link. */
    medien?: boolean;
    /** Die Reisebilder, die jetzt auf Prüfung warten: nur am jüngsten Eintrag der Reisebilder und nur mit dem Recht der Medienverwaltung. */
    bilder?: PhotoboxStapel["vorschau"];
    leise?: boolean;
}>();
/** `meldung`: die COM-Nummer (oder `null`: die Liste) und die Art des Eintrags; eine neue Anfrage (`community_nachricht`, WI-0268 C4) führt in die Mails statt in die Meldungen. */
const emit = defineEmits<{
    vorgang: [ops: string];
    meldung: [nummer: string | null, art: string];
    medien: [];
    reisebild: [asset: string];
    neuLaden: [];
}>();

const version = useNeueVersion();
const frage = ref(false);
const kommentar = ref("");

const zeit = (iso: string): string => relativeTime(new Date(iso), new Date(), locale.value, "zeitpunkt");
const kreis = computed(() => kreisVon(props.eintrag));
const teile = computed(() => satzTeile(props.eintrag));
const stand = computed(() => standSatz(props.eintrag, zeit));
const rolle = computed(() => absenderRolle(props.eintrag));
const fragtGeloest = computed(() => props.kanal && wartetAufAntwort(props.eintrag));
const fehler = computed(() =>
    props.glocke.antwortFehler.value?.id === props.eintrag.id ? props.glocke.antwortFehler.value.problems : [],
);
/** Die Marke: Siegel der Agenten (WI-0124 A), Avatar einer Person, ⚙ für das System. */
const agent = computed(() =>
    props.eintrag.von.art === "claudia" || props.eintrag.von.art === "claudio" ? props.eintrag.von.art : null,
);
const personId = computed(() => (props.eintrag.von.art === "person" ? props.eintrag.von.id : null));

async function nichtGeloest(): Promise<void> {
    if (kommentar.value.trim() === "") return;
    if (await props.glocke.antworten(props.eintrag.id, "nicht_geloest", kommentar.value)) {
        frage.value = false;
        kommentar.value = "";
    }
}

function neuLaden(): void {
    if (hatUngespeichert()) emit("neuLaden");
    else version.neuLaden();
}
</script>

<template>
    <li
        class="eintrag"
        :class="[`eintrag--${kreis}`, { 'eintrag--leise': props.leise }]"
        :data-testid="`benachrichtigung-${props.eintrag.id}`"
    >
        <AvmKreis :fuellung="kreis" :name="t(`notify.legend.${kreis}`)" />
        <KanalSiegel v-if="agent !== null" class="eintrag__marke" :agent="agent" />
        <AvmAvatar
            v-else-if="personId !== null"
            class="eintrag__marke"
            :kennung="personId"
            :name="absender(props.eintrag)"
        />
        <span v-else class="eintrag__system" aria-hidden="true">
            <svg viewBox="0 0 16 16">
                <circle
                    cx="8"
                    cy="8"
                    r="5.2"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-dasharray="2 2.084"
                />
                <circle cx="8" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.3" />
            </svg>
        </span>
        <span class="eintrag__rumpf">
            <span class="eintrag__zeile1">
                <span class="eintrag__wer" :class="`eintrag__wer--${props.eintrag.von.art}`">{{
                    absender(props.eintrag)
                }}</span>
                <span v-if="rolle !== null" class="eintrag__leise">{{ rolle }}</span>
                <span class="eintrag__zeit">{{ zeit(props.eintrag.erstelltAt) }}</span>
            </span>
            <span class="eintrag__text"
                >{{ teile.vor
                }}<button
                    v-if="teile.ops !== null && props.kanal"
                    type="button"
                    class="eintrag__link"
                    :data-testid="`benachrichtigung-ops-${teile.ops}`"
                    @click="emit('vorgang', teile.ops)"
                >
                    {{ teile.ops }}</button
                ><template v-else-if="teile.ops !== null">{{ teile.ops }}</template
                ><button
                    v-if="teile.com !== undefined && props.meldungen"
                    type="button"
                    class="eintrag__link"
                    :data-testid="`benachrichtigung-com-${teile.com.nummer ?? 'liste'}`"
                    @click="emit('meldung', teile.com.nummer, props.eintrag.art)"
                >
                    {{ teile.com.text }}</button
                ><template v-else-if="teile.com !== undefined">{{ teile.com.text }}</template
                ><button
                    v-if="teile.medien !== undefined && props.medien"
                    type="button"
                    class="eintrag__link"
                    data-testid="benachrichtigung-medien"
                    @click="emit('medien')"
                >
                    {{ teile.medien.text }}</button
                ><template v-else-if="teile.medien !== undefined">{{ teile.medien.text }}</template
                >{{ teile.nach }}</span
            >
            <span v-if="(props.bilder?.length ?? 0) > 0" class="eintrag__bilder" data-testid="benachrichtigung-bilder">
                <button
                    v-for="bild in props.bilder"
                    :key="bild.publicId"
                    type="button"
                    class="eintrag__bild"
                    :title="t('photobox.stapel.pruefen')"
                    :aria-label="t('photobox.stapel.pruefen')"
                    :data-testid="`benachrichtigung-bild-${bild.publicId}`"
                    @click="emit('reisebild', bild.publicId)"
                >
                    <img :src="bild.url" alt="" loading="lazy" decoding="async" draggable="false" />
                </button>
            </span>
            <span v-if="stand !== null" class="eintrag__stand" data-testid="benachrichtigung-stand">{{ stand }}</span>
            <span v-else-if="fragtGeloest && version.neu.value" class="eintrag__handlung">
                <AvmKnopf groesse="zeile" testid="benachrichtigung-neu-laden" @click="neuLaden"
                    ><span aria-hidden="true">↺ </span>{{ t("notify.reload") }}</AvmKnopf
                >
            </span>
            <span v-else-if="fragtGeloest && !frage" class="eintrag__handlung">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="props.glocke.busy.value !== null ? '' : undefined"
                    testid="benachrichtigung-geloest"
                    @click="props.glocke.antworten(props.eintrag.id, 'geloest')"
                    ><span aria-hidden="true">● </span>{{ t("notify.solved") }}</AvmKnopf
                >
                <AvmKnopf groesse="zeile" testid="benachrichtigung-nicht-geloest" @click="frage = true"
                    ><span aria-hidden="true">○ </span>{{ t("notify.notSolved") }}</AvmKnopf
                >
            </span>
            <span v-else-if="fragtGeloest" class="eintrag__kommentar">
                <AvmTextbereich
                    v-model="kommentar"
                    :zeilen="2"
                    maxlength="8000"
                    :aria-label="t('notify.comment')"
                    :placeholder="t('notify.comment')"
                    testid="benachrichtigung-kommentar"
                />
                <span class="eintrag__handlung">
                    <AvmKnopf groesse="zeile" testid="benachrichtigung-abbrechen" @click="frage = false">{{
                        t("notify.cancel")
                    }}</AvmKnopf>
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="kommentar.trim() === '' ? t('notify.needsComment') : undefined"
                        testid="benachrichtigung-wieder"
                        @click="nichtGeloest"
                        >{{ t("notify.reopen") }}</AvmKnopf
                    >
                </span>
            </span>
            <span
                v-else-if="props.eintrag.art === 'kanal_fix_live' && !props.eintrag.frageGeloest && props.kanal"
                class="eintrag__stand"
                >{{ t("notify.info.confirms") }}</span
            >
            <span v-for="(problem, i) in fehler" :key="i" class="eintrag__problem" role="alert">{{
                t(problem.key, problem.params)
            }}</span>
        </span>
    </li>
</template>

<style scoped>
.eintrag {
    display: grid;
    grid-template-columns: var(--avm-kreis) var(--icon-lg) minmax(0, 1fr);
    column-gap: var(--space-6);
    align-items: start;
    padding: var(--space-6) var(--space-4);
    border-top: 1px solid var(--color-divider);
}

.eintrag > :first-child {
    margin-top: calc((var(--icon-lg) - var(--avm-kreis)) / 2);
}

.eintrag__marke {
    width: var(--icon-lg);
    height: var(--icon-lg);
}

.eintrag__system {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--icon-lg);
    height: var(--icon-lg);
    border-radius: 50%;
    background: var(--color-panel-muted);
    box-shadow: inset 0 0 0 1px var(--color-divider);
    color: var(--color-text-muted);
}

.eintrag__system svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.eintrag__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.eintrag__zeile1 {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--icon-lg);
}

.eintrag__wer {
    color: var(--color-text-strong);
}

.eintrag__wer--claudia {
    color: var(--color-agent-claudia);
}

.eintrag__wer--claudio {
    color: var(--color-agent-claudio);
}

.eintrag__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.eintrag__zeit {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.eintrag__text {
    color: var(--color-text);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.eintrag--voll .eintrag__text {
    color: var(--color-text-muted);
}

/*
 * Das Archiv (Betreiber 2026-10-13: „soll es ausgegraut oder in archiv“). 🔴 Leise, nicht grau: `--color-disabled-text` heißt im Haus
 * „nicht verfügbar“ (gesperrte Knöpfe, künftige Einträge). Gelesene Meldungen sind verfügbar, man hat sie nur schon gesehen — sie
 * bekommen deshalb die leise Schrift jeder Nebenangabe. Links und Knöpfe darin behalten ihre Farbe, sonst wären sie nicht mehr als
 * Bedienelement zu erkennen (Design Guide §30.5).
 */
.eintrag--leise .eintrag__text,
.eintrag--leise .eintrag__wer,
.eintrag--leise .eintrag__zeit,
.eintrag--leise .eintrag__leise,
.eintrag--leise .eintrag__stand {
    color: var(--color-text-muted);
}

.eintrag__link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    font: inherit;
    cursor: pointer;
}

.eintrag__link:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.eintrag__link:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Die offenen Reisebilder: feste Größe, damit die Zeile beim Laden der Bilder nicht springt. */
.eintrag__bilder {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-top: var(--space-2);
}

.eintrag__bild {
    flex: none;
    box-sizing: border-box;
    width: 4rem;
    height: 3rem;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    cursor: pointer;
    transition:
        border-color 120ms ease,
        opacity 120ms ease;
}

.eintrag__bild:hover {
    border-color: var(--color-link-hover);
}

.eintrag__bild:active {
    border-color: var(--color-link);
    opacity: 0.8;
}

.eintrag__bild:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.eintrag__bild img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.eintrag__handlung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-2);
}

.eintrag__kommentar {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-2);
}

.eintrag__kommentar .eintrag__handlung {
    justify-content: flex-end;
    margin-top: 0;
}

.eintrag__stand {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.eintrag__problem {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}
</style>
