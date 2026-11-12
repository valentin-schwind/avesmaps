<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import { t } from "../i18n/i18n";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import { useNeueVersion } from "../system/neue-version";
import { hatUngespeichert } from "../system/ungespeichert";
import { openAuthWindow } from "./auth-windows";
import BenachrichtigungEintrag from "./benachrichtigung-eintrag.vue";
import {
    gesehenBis,
    merkeGesehenBis,
    neuUndArchiv,
    schnittAusGelesen,
    useBenachrichtigungen,
} from "./benachrichtigungen";
import KurzinfoAnsicht from "./kurzinfo-ansicht.vue";
import { useKurzinfo } from "./kurzinfo";
import { redaktion } from "../community/redaktion";
import { oeffneReisebilder } from "../medien/medien-oeffnen";
import { ladeStapelNeu, stapelEintrag, stapelSignatur, stapelZustand } from "../photobox/photobox-stapel-modell";
import { authState } from "./session-state";

/**
 * Die Glocke in der Leiste (WI-0136 N2, Blatt `review/wi-0136/blatt.png`; Betreiber 2026-10-11 „1B“: die Glocke ist die bewusste Ausnahme
 * von den abstrakten Zeichen). Symbolknopf in Bedienhöhe vor Person und ☰, mit der Zahl der ungelesenen Einträge; die Klappe hat die
 * Gestalt des Hauptmenüs und öffnet rechtsbündig, am Telefon über die ganze Breite.
 *
 * - Oben steht, solange sie nicht geladen ist, „Neue Version verfügbar“ (aus N1, nicht gespeichert), mit der Kurzinfo „Was ist neu?“,
 *   „↺ Neu laden“ und „Alle Änderungen“ (WI-0137 §3b, Betreiber „A“).
 * - 🔴 Seit WI-0146 ist das die EINZIGE Fläche dafür (Betreiber 2026-10-15 „A, A, ja“): Der eigene Kasten `neue-version-kasten.vue`
 *   daneben ist entfallen. Bei einer neuen Version wächst der Knopf am Rechner zur Pille „✦ Neue Version“ mit Glocke und Zahl darin;
 *   am Telefon wird er wie bisher zu ↺. So gibt es einen Auslöser, eine Klappe und eine Rückfrage statt zweier.
 * - Öffnen markiert alles als gelesen; der Kreis zeigt danach, was noch auf die eigene Antwort wartet (◐).
 * - Die OPS-Nummer und „Alle Vorgänge“ führen in den Kanal (nur Betreiber).
 */
const glocke = useBenachrichtigungen();
const version = useNeueVersion();
const kanal = authState.value.capabilities.includes("use_operator_channel");
const kurzinfo = useKurzinfo();
const betrieb = authState.value.capabilities.includes("view_operations");
/** Die neuen Reisebilder führen in die Medienverwaltung, wenn die Person sie öffnen darf (WI-0272 S3, Aufgabe 19). */
const medienErlaubt = authState.value.capabilities.includes("view_media_private");
const mitKurzinfo = computed(() => (kurzinfo.kurzinfo.value?.abschnitte.length ?? 0) > 0);
watch(version.neu, (neu) => void (neu && kurzinfo.laden()), { immediate: true });
const offen = ref(false);
const frageNeuLaden = ref(false);
const huelle = useTemplateRef<HTMLElement>("huelle");
const ausloeser = useTemplateRef<InstanceType<typeof AvmKnopf>>("ausloeser");

// Seit WI-0146 hängt auch die Versionsprüfung hier: Vorher startete sie der Kasten, den es nicht mehr gibt.
onMounted(() => {
    glocke.start();
    version.start();
    // Der Stand dieser Seite, damit „Neue Version“ später die Neuerungen seitdem zeigt (WI-0137, Betreiber 2026-10-17).
    void kurzinfo.merkeStand();
});
onBeforeUnmount(() => {
    glocke.stop();
    version.stop();
});

const eintraege = computed(() => glocke.liste.value?.eintraege ?? []);
/**
 * Der Schnitt zwischen „Neu“ und „Archiv“ (Betreiber 2026-10-13). Er steht fest, solange die Klappe offen ist: Wer gerade liest, soll
 * nicht zusehen, wie ihm die Zeilen unter den Augen ins Archiv rutschen. Gesetzt wird er beim Öffnen, aus dem Wert des vorigen Öffnens.
 */
const schnitt = ref<number | null>(gesehenBis());
const teile = computed(() => neuUndArchiv(eintraege.value, schnitt.value));
const archivOffen = ref(false);
/** Die Abfrage scheiterte, und es gibt noch keine Liste; „Neue Version“ steht trotzdem da. */
const ohneListe = computed(() => glocke.fehler.value && glocke.liste.value === null);
const zahl = computed(() => glocke.ungelesen.value);
/**
 * Was auf Prüfung wartet, steht als Vorschau am jüngsten Eintrag der Reisebilder (Betreiber 2026-11-04: „das bild oder den link ins MAM“). Es ist der Stapel aus Community › Meldungen: Erledigtes fällt
 * heraus, auch wenn die Meldung älter ist. Geladen wird beim Öffnen und schon vorher, wenn ein ungelesener Eintrag dazukommt, damit die Zeile beim Öffnen nicht springt.
 */
const stapelId = computed(() => (medienErlaubt ? stapelEintrag(eintraege.value) : undefined));
const offeneBilder = computed(() => stapelZustand.stapel.value?.vorschau ?? []);
watch(
    () => (medienErlaubt ? stapelSignatur(eintraege.value.filter((eintrag) => eintrag.gelesenAt === null)) : ""),
    (signatur) => {
        if (signatur !== "") void ladeStapelNeu();
    },
    { immediate: true },
);
const name = computed(() =>
    [
        t("notify.title"),
        zahl.value > 0 ? t("notify.newCount", { n: zahl.value }) : null,
        version.neu.value ? t("notify.newVersion") : null,
    ]
        .filter((teil) => teil !== null)
        .join(", "),
);

function schliessen(fokusZurueck = true): void {
    if (!offen.value) return;
    offen.value = false;
    frageNeuLaden.value = false;
    if (fokusZurueck) ausloeser.value?.focus();
}

function umschalten(): void {
    if (offen.value) {
        schliessen();
        return;
    }
    offen.value = true;
    schnitt.value = gesehenBis() ?? schnittAusGelesen(eintraege.value);
    archivOffen.value = false;
    merkeGesehenBis(eintraege.value[0]?.id);
    if (stapelId.value !== undefined) void ladeStapelNeu();
    void glocke.gelesen();
}

function aussen(event: PointerEvent): void {
    if (huelle.value !== null && !huelle.value.contains(event.target as Node)) schliessen(false);
}
watch(offen, (jetzt) => {
    if (jetzt) document.addEventListener("pointerdown", aussen, true);
    else document.removeEventListener("pointerdown", aussen, true);
});
const abmelden = inject(ESCAPE_CASCADE_KEY, undefined)?.register("menus", () => {
    if (!offen.value) return false;
    schliessen();
    return true;
});
onBeforeUnmount(() => {
    abmelden?.();
    document.removeEventListener("pointerdown", aussen, true);
});

/** Die OPS-Nummer öffnet den Vorgang im Kanal der Systemsteuerung. */
function zumVorgang(ops?: string): void {
    schliessen(false);
    openAuthWindow({ name: "systemsteuerung", eintrag: "claudio", ...(ops === undefined ? {} : { ops }) });
}

/**
 * Die COM-Nummer (oder „3 neue Meldungen“) öffnet Editor › Community › Meldungen, mit dem Vorgang, wenn die Nummer einen nennt (WI-0268 C5); die SOC-Nummer eines Beitrags öffnet
 * Editor › Community › Social Hub mit diesem Beitrag (WI-0270 C11).
 */
function zurMeldung(nummer: string | null, art: string): void {
    schliessen(false);
    // Eine neue Bewertung (Vali 2026-11-04): Community › Bewertungen, mit dieser Bewertung, wenn der Eintrag eine nennt. Den Titel setzt ihr Fenster, sobald es sie geladen hat.
    if (art === "bewertung_neu") {
        redaktion.oeffneMeldung(null, "bewertungen");
        if (nummer !== null) redaktion.oeffneBewertung(nummer, t("bewertungen.redaktion.kasten.bewertung"));
    } else if (art === "kartenvorschlag_neu") {
        // Ein neuer Kartenvorschlag (WI-0275): Community › Meldungen, wo er seit WI-0305 steht, mit diesem Vorschlag, wenn der Eintrag einen nennt.
        redaktion.oeffneMeldung(null);
        if (nummer !== null) redaktion.oeffneKartenvorschlag(nummer, t("kartenvorschlag.redaktion.fenster"));
    } else if (nummer?.startsWith("SOC-") === true) redaktion.oeffneSocial(nummer);
    // Eine neue Anfrage (WI-0268 C4) und eine Mail, die nicht zugestellt wurde (C6a), liegen im Reiter Mails, nicht bei den Meldungen.
    else
        redaktion.oeffneMeldung(
            nummer,
            art === "community_nachricht" || art === "community_mail_fehler" ? "mails" : undefined,
        );
}

/** Ein neues Reisebild (oder „3 neue Reisebilder“) öffnet die Medienverwaltung im Korb „PhotoBox-Uploads“, Unterteilung Offen (WI-0272 S3, Aufgabe 19). */
function zuMedien(): void {
    schliessen(false);
    oeffneReisebilder();
}

/** Die Vorschau eines Reisebilds öffnet dasselbe Fenster, mit genau diesem Bild im Inspector; ein gemeldetes ist schon freigegeben und liegt unter „erledigt“. */
function zuReisebild(asset: string, gemeldet: boolean): void {
    schliessen(false);
    oeffneReisebilder(asset, gemeldet ? "erledigt" : "offen");
}

/** „Alle Änderungen“ öffnet Systemsteuerung › Versionen. */
function zuVersionen(): void {
    schliessen(false);
    openAuthWindow({ name: "systemsteuerung", eintrag: "versionen" });
}

function neuLaden(): void {
    if (hatUngespeichert()) frageNeuLaden.value = true;
    else version.neuLaden();
}
</script>

<template>
    <span ref="huelle" class="glocke" data-testid="glocke">
        <AvmKnopf
            ref="ausloeser"
            class="glocke__knopf"
            :class="{ 'glocke__knopf--offen': offen, 'glocke__knopf--version': version.neu.value }"
            :aria-label="name"
            :aria-expanded="offen"
            aria-controls="glocke-klappe"
            testid="glocke-knopf"
            @click="umschalten"
        >
            <span v-if="version.neu.value" class="glocke__zeichen glocke__nur-telefon" aria-hidden="true">↺</span>
            <!-- Am Rechner wächst der Knopf bei einer neuen Version zur Pille „✦ Neue Version“ (WI-0146, Betreiber „1A“). -->
            <span v-if="version.neu.value" class="glocke__neu glocke__nur-rechner">
                <svg class="glocke__funkeln" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                        fill="currentColor"
                        d="M6.5 1.5c.45 2.75 2.25 4.55 5 5-2.75.45-4.55 2.25-5 5-.45-2.75-2.25-4.55-5-5 2.75-.45 4.55-2.25 5-5Z"
                    />
                    <path
                        fill="currentColor"
                        d="M12.5 9.5c.22 1.35 1.1 2.23 2.45 2.45-1.35.22-2.23 1.1-2.45 2.45-.22-1.35-1.1-2.23-2.45-2.45 1.35-.22 2.23-1.1 2.45-2.45Z"
                    />
                </svg>
                <span class="glocke__neu-wort avm-versalmitte">{{ t("version.new") }}</span>
            </span>
            <svg
                class="glocke__bild"
                :class="{ 'glocke__nur-rechner': version.neu.value }"
                viewBox="0 0 16 16"
                aria-hidden="true"
            >
                <path
                    d="M8 2.1c-2.2 0-3.8 1.8-3.8 4.1v2.7l-1.4 2.4h10.4l-1.4-2.4V6.2C11.8 3.9 10.2 2.1 8 2.1ZM6.5 12.9a1.5 1.5 0 0 0 3 0"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
            <span v-if="zahl > 0" class="glocke__plakette" data-testid="glocke-zahl"
                ><span class="avm-versalmitte">{{ zahl }}</span></span
            >
        </AvmKnopf>
        <div
            v-if="offen"
            id="glocke-klappe"
            class="glocke__klappe"
            role="group"
            :aria-label="t('notify.title')"
            data-testid="glocke-klappe"
        >
            <div class="glocke__kopf">
                <span class="glocke__titel">{{ t("notify.title") }}</span>
                <span v-if="zahl > 0" class="glocke__leise">{{ t("notify.new", { n: zahl }) }}</span>
            </div>
            <div v-if="frageNeuLaden" class="glocke__frage" role="group" :aria-label="t('version.askTitle')">
                <span class="glocke__frage-titel">{{ t("version.askTitle") }}</span>
                <span class="glocke__leise">{{ t("version.askText") }}</span>
                <span class="glocke__knoepfe">
                    <AvmKnopf groesse="zeile" testid="glocke-abbrechen" @click="frageNeuLaden = false">{{
                        t("version.cancel")
                    }}</AvmKnopf>
                    <AvmKnopf groesse="zeile" art="gefahr" testid="glocke-trotzdem" @click="version.neuLaden()"
                        ><span aria-hidden="true">↺ </span>{{ t("version.reloadAnyway") }}</AvmKnopf
                    >
                </span>
            </div>
            <div v-if="ohneListe" class="glocke__fehler" role="alert">
                <span class="glocke__fehler-satz">{{ t("notify.failed") }}</span>
                <AvmKnopf groesse="zeile" testid="glocke-erneut" @click="glocke.lies()"
                    ><span aria-hidden="true">↺ </span>{{ t("notify.retry") }}</AvmKnopf
                >
            </div>
            <ol v-if="version.neu.value || eintraege.length > 0" class="glocke__liste" data-testid="glocke-liste">
                <li v-if="version.neu.value" class="glocke__system" data-testid="benachrichtigung-version">
                    <AvmKreis fuellung="leer" :name="t('notify.legend.leer')" />
                    <span class="glocke__system-marke" aria-hidden="true">
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
                    <span class="glocke__system-rumpf">
                        <span class="glocke__system-wer">{{ t("notify.system") }}</span>
                        <span>{{ t("notify.text.version") }}</span>
                        <KurzinfoAnsicht
                            v-if="mitKurzinfo"
                            class="glocke__kurzinfo"
                            eingebettet
                            :kurzinfo="kurzinfo.kurzinfo.value"
                        />
                        <span class="glocke__knoepfe glocke__knoepfe--links">
                            <AvmKnopf groesse="zeile" testid="glocke-neu-laden" @click="neuLaden"
                                ><span aria-hidden="true">↺ </span>{{ t("notify.reload") }}</AvmKnopf
                            >
                            <button
                                v-if="betrieb"
                                type="button"
                                class="glocke__kanal glocke__alle"
                                data-testid="kurzinfo-alle"
                                @click="zuVersionen"
                            >
                                {{ t("version.allChanges") }}
                            </button>
                        </span>
                    </span>
                </li>
                <BenachrichtigungEintrag
                    v-for="eintrag in teile.neu"
                    :key="eintrag.id"
                    :eintrag="eintrag"
                    :glocke="glocke"
                    :kanal="kanal"
                    :meldungen="redaktion.verbunden.value"
                    :medien="medienErlaubt"
                    :bilder="eintrag.bilder ?? (eintrag.id === stapelId ? offeneBilder : [])"
                    @vorgang="zumVorgang"
                    @meldung="zurMeldung"
                    @medien="zuMedien"
                    @reisebild="(asset) => zuReisebild(asset, eintrag.bilder !== undefined)"
                    @neu-laden="frageNeuLaden = true"
                />
                <li v-if="teile.archiv.length > 0" class="glocke__archiv">
                    <button
                        type="button"
                        class="glocke__archiv-kopf"
                        :aria-expanded="archivOffen"
                        data-testid="glocke-archiv"
                        @click="archivOffen = !archivOffen"
                    >
                        <span class="glocke__archiv-winkel" aria-hidden="true">{{ archivOffen ? "⌄" : "›" }}</span>
                        {{ t("notify.archive", { n: teile.archiv.length }) }}
                    </button>
                </li>
                <BenachrichtigungEintrag
                    v-for="eintrag in archivOffen ? teile.archiv : []"
                    :key="eintrag.id"
                    :eintrag="eintrag"
                    :glocke="glocke"
                    :kanal="kanal"
                    :meldungen="redaktion.verbunden.value"
                    :medien="medienErlaubt"
                    :bilder="eintrag.bilder ?? (eintrag.id === stapelId ? offeneBilder : [])"
                    leise
                    @vorgang="zumVorgang"
                    @meldung="zurMeldung"
                    @medien="zuMedien"
                    @reisebild="(asset) => zuReisebild(asset, eintrag.bilder !== undefined)"
                    @neu-laden="frageNeuLaden = true"
                />
            </ol>
            <p v-else-if="!ohneListe" class="glocke__leer" data-testid="glocke-leer">{{ t("notify.empty") }}</p>
            <div v-if="eintraege.length > 0 || version.neu.value" class="glocke__fuss">
                <span v-for="stufe in ['leer', 'halb', 'voll'] as const" :key="stufe" class="glocke__legende"
                    ><AvmKreis :fuellung="stufe" :name="t(`notify.legend.${stufe}`)" />{{
                        t(`notify.legend.${stufe}`)
                    }}</span
                >
                <button
                    v-if="kanal"
                    type="button"
                    class="glocke__kanal"
                    data-testid="glocke-kanal"
                    @click="zumVorgang()"
                >
                    {{ t("notify.allCases") }}
                </button>
            </div>
        </div>
    </span>
</template>

<style scoped>
.glocke {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
}

.glocke__knopf :deep(.knopf) {
    position: relative;
    width: var(--avm-control-h);
    padding: 0;
}

.glocke__knopf--offen :deep(.knopf),
.glocke__knopf--offen :deep(.knopf):hover {
    background: var(--color-button-soft-active);
    box-shadow: none;
    transform: none;
}

.glocke__bild {
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.glocke__zeichen {
    font-size: var(--font-size-reading);
    line-height: 1;
}

.glocke__nur-telefon {
    display: none;
}

.glocke__plakette {
    position: absolute;
    top: calc(-1 * var(--space-4));
    right: calc(-1 * var(--space-4));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: var(--icon-sm);
    height: var(--icon-sm);
    padding: 0 var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-accent-strong);
    color: var(--color-panel);
    font-size: var(--font-size-caption);
    line-height: 1;
}

/*
 * Eine neue Version macht aus dem Knopf am Rechner die Pille „✦ Neue Version“ mit der Glocke und der Zahl darin (WI-0146, Betreiber
 * 2026-10-15 „A, A, ja“). Vorher stand dafür ein eigener Kasten daneben; die Pillenpalette ist seine, damit der Hinweis gleich laut
 * bleibt. Am Telefon bleibt alles wie bisher: Der Knopf wird zu ↺, für Worte ist dort kein Platz.
 */
@media (min-width: 601px) {
    .glocke__knopf--version,
    .glocke__knopf--version :deep(.knopf) {
        width: auto;
    }

    .glocke__knopf--version :deep(.knopf) {
        padding: 0 var(--space-6);
        border-color: var(--color-pill-border);
        background: var(--color-pill);
        color: var(--color-pill-text);
    }

    .glocke__knopf--version :deep(.knopf__text) {
        display: inline-flex;
        align-items: center;
        gap: var(--space-6);
    }

    /* Die Zahl steht dann in der Pille hinter der Glocke, nicht an der Ecke (Betreiber „2A“). */
    .glocke__knopf--version .glocke__plakette {
        position: static;
    }
}

.glocke__neu {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-accent-strong);
}

.glocke__funkeln {
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.glocke__neu-wort {
    color: var(--color-pill-text);
    font-size: var(--font-size-small);
}

.glocke__klappe {
    position: absolute;
    top: calc(100% + var(--space-6));
    right: 0;
    z-index: 1;
    box-sizing: border-box;
    width: calc(var(--avesmaps-infopanel-width) * 1.1);
    max-width: calc(100vw - 2 * var(--space-10));
    padding: var(--space-4) var(--space-6) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
    text-align: left;
}

.glocke__kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-4) var(--space-6);
}

.glocke__titel {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.glocke__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.glocke__liste {
    max-height: calc(100vh - 12 * var(--space-10));
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
}

.glocke__system {
    display: grid;
    grid-template-columns: var(--avm-kreis) var(--icon-lg) minmax(0, 1fr);
    column-gap: var(--space-6);
    align-items: start;
    padding: var(--space-6) var(--space-4);
    border-top: 1px solid var(--color-divider);
}

.glocke__system > :first-child {
    margin-top: calc((var(--icon-lg) - var(--avm-kreis)) / 2);
}

.glocke__system-marke {
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

.glocke__system-marke svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.glocke__system-rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    line-height: var(--leading-snug);
}

/* Die Kurzinfo steht im Eintrag — seit WI-0146 überall, nicht mehr nur am Telefon. Zwei Klassen, damit sie `.kurz` sicher übersteuert. */
.glocke__system .glocke__kurzinfo {
    display: flex;
    margin: var(--space-4) 0;
}

.glocke__system-wer {
    display: flex;
    align-items: center;
    min-height: var(--icon-lg);
    color: var(--color-text-strong);
}

.glocke__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}

.glocke__knoepfe--links {
    justify-content: flex-start;
    margin-top: var(--space-2);
}

.glocke__frage {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0 var(--space-4) var(--space-6);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.glocke__frage-titel {
    color: var(--color-text-strong);
}

.glocke__fehler {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    margin: 0 0 var(--space-2);
    padding: var(--space-4) var(--space-8);
    border-left: 3px solid var(--color-danger);
    border-radius: var(--radius-sm);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}

.glocke__fehler-satz {
    flex: 1 1 auto;
    min-width: 0;
}

.glocke__leer {
    margin: 0;
    padding: var(--space-16) var(--space-4);
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    text-align: center;
}

/*
 * Die Trennzeile zum Archiv (Betreiber 2026-10-13). Sie ist ein Textknopf wie „Alle Vorgänge“ im Fuß, nur über die ganze Breite und mit
 * dem Winkel voran. Zustände nach Design Guide §30.5: Ruhe leise, Hover und Fokus wie jeder Textknopf der Glocke.
 */
.glocke__archiv {
    padding: var(--space-6) 0 var(--space-2);
}

.glocke__archiv-kopf {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-top: 1px solid var(--color-divider);
    border-radius: 0;
    background: none;
    color: var(--color-text-muted);
    font: inherit;
    font-size: var(--font-size-caption);
    text-align: left;
    cursor: pointer;
}

.glocke__archiv-kopf:hover {
    color: var(--color-text);
}

.glocke__archiv-kopf:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.glocke__archiv-winkel {
    display: inline-block;
    width: var(--space-8);
    text-align: center;
}

.glocke__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    padding: var(--space-6) var(--space-4) 0;
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.glocke__legende {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.glocke__kanal {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    font: inherit;
    cursor: pointer;
}

.glocke__kanal:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.glocke__alle {
    align-self: center;
    font-size: var(--font-size-small);
}

.glocke__kanal:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Am Telefon: Die Glocke wird bei neuer Version zu ↺ (Pillenpalette), die Klappe geht über die ganze Breite. */
@media (max-width: 600px) {
    .glocke__nur-telefon {
        display: inline;
    }

    .glocke__nur-rechner {
        display: none;
    }

    .glocke__knopf--version :deep(.knopf),
    .glocke__knopf--version :deep(.knopf):hover {
        border-color: var(--color-accent);
        background: var(--color-pill);
        color: var(--color-accent-strong);
    }

    .glocke__klappe {
        position: fixed;
        top: calc(var(--avm-control-h) + 2 * var(--space-4) + 2px + var(--space-6));
        right: var(--space-10);
        left: var(--space-10);
        width: auto;
        max-width: none;
    }
}
</style>
