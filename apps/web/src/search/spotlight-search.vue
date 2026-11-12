<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from "vue";
import type {
    SearchBeispiel,
    SearchGebietHit,
    SearchLandmarkeHit,
    SearchHit,
    SearchLeuchtenBegriff,
    SearchResponse,
    SearchSpracheHit,
    SearchVorkommenHit,
    SearchZahl,
    SearchZielHit,
} from "@avesmaps3d/shared";
import { VIEWER_CONTEXT_KEY } from "../viewer/bootstrap-viewer";
import VorkommenPlakette from "../controls/vorkommen-plakette.vue";
import SuchZahl from "./search-zahl.vue";
import { fetchBeispiele, fetchSearch, fetchZahlen, hitName, hitTypeLabel, moveActive } from "./search-client";
import { melde } from "../besuch/besuch-melden";
import { distanceAboveBottom, keyboardCover, revealStart } from "./search-tile";
import { isMessageKey, t, tPlural } from "../i18n/i18n";
import {
    baueAnsicht,
    eintragsText,
    KATEGORIE_NAME,
    KATEGORIE_ZEICHEN,
    praepositionsText,
    spracheZeilenText,
    zahlAnzeige,
    zahlenFragen,
    zielZahl,
    type SektionsTitel,
    type SuchZeile,
} from "./vorkommen-ansicht";

/**
 * Die Suchkachel (WI-0013, Search Core) — Legacys Spotlight in seiner engsten Form.
 *
 * ⭐ Ein Treffer ist ein SPRUNGZIEL. Die Komponente sucht und meldet den gewählten Treffer; wohin die
 * Kamera fährt, entscheidet die Karte (`jump`).
 *
 * 🪤 Was hier FEHLT, fehlt mit Absicht und steht im Work Item: Legacys Bewertungsmodell, Innerorts- und Offmap-Treffer.
 *
 * Seit WI-0257 (S3b) kennt sie die Vorkommen: die Sektion „Vorkommen“ (Flora, Fauna, Waren, Spezies mit ihrem Kategoriezeichen und der Zahl der leuchtenden Gegenden), Herrschaftsgebiete als Treffer, die
 * Autovervollständigung einer kurzen Anfrage („Begriff Präposition Ziel“: Präpositionen als Chips, danach die Ziele mit Zahl) und den wechselnden Platzhalter. Was die Liste zeigt, entscheidet
 * `vorkommen-ansicht.ts` (reine Daten); gewählte Vorkommen, Ziele und Gebiete meldet sie nach oben, wie den Sprung zu einem Ort (`jump`). Das Leuchten selbst gehört der Karte (`map/such-leuchten.ts`).
 */
const emit = defineEmits<{
    jump: [hit: SearchHit];
    /** Ein Vorkommen (Flora, Fauna, Ware, Spezies) ist gewählt: Es leuchtet, und sein Panel geht auf (WI-0257 S3b). */
    vorkommen: [hit: SearchVorkommenHit];
    /** Eine fertige Anfrage „Begriff in Ziel“ ist gewählt (`ziel.leuchten` ist gesetzt): Sie leuchtet zugeschnitten. */
    ziel: [begriff: SearchLeuchtenBegriff, ziel: SearchZielHit];
    /** Ein Herrschaftsgebiet ist gewählt. */
    gebiet: [hit: SearchGebietHit];
    /** Eine Landmarke ist gewählt (WI-0271 L6): Ihr Panel geht auf, und die Karte fliegt zu ihr. */
    landmarke: [hit: SearchLandmarkeHit];
    /** Eine Sprache der Karte ist gewählt (WI-0261 S5c): Ihre Infobox geht auf, und ihre Flächen leuchten. */
    sprache: [hit: SearchSpracheHit];
}>();
/**
 * Kann dieser Viewer einen Seeweg über seinen genauen Namen finden (Capability
 * `search_sea_route_names`, WI-0046)? Der ViewerContext kommt per `inject` von `app.vue`
 * (`provide`, M9) statt als Prop - `bootstrapViewer()` ist die einzige Stelle, die das URL-Flag der
 * Besucher-Vorschau liest.
 */
const viewer = inject(VIEWER_CONTEXT_KEY);
const canSearchSeaRouteNames = viewer?.can("search_sea_route_names") ?? false;

const open = ref(false);
const query = ref("");
/** Die letzte Antwort; die Liste, die Sektionen, die Chips und die Hinweise entstehen daraus (`vorkommen-ansicht.ts`). */
const response = shallowRef<SearchResponse | undefined>(undefined);
const truncated = ref(false);
const failed = ref(false);
const searched = ref(false);
/** Die Zahl der leuchtenden Gegenden je sichtbares Vorkommen, nachgeladen (`GET /api/search/zahlen`); die Sektion rechnet nichts. */
const zahlen = shallowRef<ReadonlyMap<string, SearchZahl>>(new Map());
/** Der erste Treffer ist vorausgewählt — Spotlight wird mit Return bestätigt (Guide §14). */
const active = ref(-1);
const input = useTemplateRef<HTMLInputElement>("input");
const tile = useTemplateRef<HTMLButtonElement>("tile");
const card = useTemplateRef<HTMLDivElement>("card");
/** Am Finger: wo das Fenster unten ansetzt (Unterkante der Kachel) und was die Tastatur verdeckt. */
const anchor = ref<string>();
const keyboard = ref<string>();

let pending: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopFollowingKeyboard: (() => void) | undefined;
/** Kurz genug, dass es sich wie Tippen anfühlt; lang genug, dass nicht jeder Buchstabe fragt. */
const DEBOUNCE_MS = 120;
/** Legacys Aufklappen: dieselbe Dauer wie die Panel-Slides des Hauses. */
const REVEAL_MS = 220;
const REVEAL_EASING = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * 🔴 Legacys Verhalten am Finger (WI-0026): das Fenster sitzt UNTEN auf der Höhe der Lupe, und das
 * Feld wächst aus ihr nach links, während die Lupe an ihrem Platz bleibt - das Feld deckt sie zu,
 * wie im laufenden Legacy (Betreiber 2026-09-23: „der button bleibt stabil während sein suchfeld
 * sich nach links vergrößert - vergleiche legacy"). Am Zeiger öffnet dasselbe
 * Fenster oben und ohne Bewegung (Owner Legacy 11.08.2026: „hier brauchen wir nicht die animation").
 * Gefragt wird beim Öffnen, nicht beim Laden - ein Tablet kann eine Maus bekommen.
 */
function atFinger(): boolean {
    return globalThis.matchMedia?.("(pointer: coarse)").matches === true;
}

async function show(): Promise<void> {
    if (open.value) {
        input.value?.focus();
        input.value?.select();
        return;
    }
    const finger = atFinger();
    anchorAtTile(finger);
    open.value = true;
    starteBeispiele();
    await nextTick();
    if (finger) {
        followKeyboard();
        revealFromTile();
    }
    input.value?.focus();
    input.value?.select();
}

function close(): void {
    open.value = false;
    pending?.abort();
    zahlenFrage?.abort();
    clearTimeout(timer);
    stoppeBeispiele();
    stopFollowingKeyboard?.();
}

/** VOR dem Öffnen gemessen: schon das erste Bild steht auf der Höhe der Kachel. */
function anchorAtTile(finger: boolean): void {
    const rect = tile.value?.getBoundingClientRect();
    anchor.value =
        finger && rect && rect.width > 0 ? `${distanceAboveBottom(globalThis.innerHeight, rect.bottom)}px` : undefined;
}

function followKeyboard(): void {
    const visible = globalThis.visualViewport;
    if (!visible) {
        return;
    }
    const sync = (): void => {
        keyboard.value = `${keyboardCover(globalThis.innerHeight, visible)}px`;
    };
    visible.addEventListener("resize", sync);
    visible.addEventListener("scroll", sync);
    sync();
    stopFollowingKeyboard = () => {
        visible.removeEventListener("resize", sync);
        visible.removeEventListener("scroll", sync);
        keyboard.value = undefined;
        stopFollowingKeyboard = undefined;
    };
}

/**
 * Ein REVEAL, keine Skalierung (Legacy): `clip-path` gibt das Fenster von rechts nach links frei und
 * lässt die Schrift unangetastet, eine Skalierung quetschte sie im ersten Bild zusammen. Die Lupe
 * bleibt darunter stehen; das Feld wächst über sie hinweg.
 */
function revealFromTile(): void {
    const fenster = card.value;
    const kachel = tile.value?.getBoundingClientRect();
    if (!fenster || !kachel || typeof fenster.animate !== "function") {
        return;
    }
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        return;
    }
    const breite = fenster.getBoundingClientRect().width;
    if (!kachel.width || !breite) {
        return;
    }
    const radius = getComputedStyle(fenster).borderRadius;
    fenster.animate(
        [
            { clipPath: `inset(0 0 0 ${revealStart(breite, kachel.width)}px round ${radius})` },
            { clipPath: `inset(0 0 0 0 round ${radius})` },
        ],
        { duration: REVEAL_MS, easing: REVEAL_EASING },
    );
}

watch(query, (value) => {
    clearTimeout(timer);
    zieleVersuche = 0;
    timer = setTimeout(() => void run(value), DEBOUNCE_MS);
});

/** Die Ansicht der Antwort: Sektionen, Chips, Hinweise und die flache Liste für die Pfeiltasten. */
const ansicht = computed(() => baueAnsicht(response.value, query.value));
const zeilen = computed(() => ansicht.value.flach);

/** Wie oft die Ziele noch einmal gefragt werden, wenn der Server sie wegen Überlastung nicht gerechnet hat (`zieleFehlen`). */
const ZIELE_VERSUCHE = 3;
const ZIELE_WARTE_MS = 1200;
let zieleVersuche = 0;
let zahlenFrage: AbortController | undefined;

/** Holt die Zahlen der sichtbaren Vorkommen nach; bis sie da sind, steht nur die Art da. */
async function ladeZahlen(): Promise<void> {
    zahlenFrage?.abort();
    const ids = zahlenFragen(ansicht.value).filter((id) => !zahlen.value.has(id));
    if (ids.length === 0) return;
    const eigene = new AbortController();
    zahlenFrage = eigene;
    try {
        const neu = await fetchZahlen(ids, eigene.signal);
        if (eigene.signal.aborted) return;
        zahlen.value = new Map([...zahlen.value, ...neu]);
    } catch (error) {
        if (eigene.signal.aborted) return;
        // Ohne Zahl steht nur die Art da; die Suche selbst bleibt heil.
        console.error("Zahlen der Vorkommen nicht geladen", error);
    }
}

async function run(value: string): Promise<void> {
    // 💣 Die ältere Anfrage wird abgebrochen: sonst überschreibt eine langsame Antwort auf „Ga" die
    // schnelle auf „Gareth", und die Liste zeigt etwas, das niemand mehr gesucht hat.
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    try {
        const antwort = await fetchSearch(value, controller.signal, canSearchSeaRouteNames);
        if (controller.signal.aborted) {
            return;
        }
        response.value = antwort;
        truncated.value = antwort.truncated;
        failed.value = false;
        searched.value = antwort.query.length > 0;
        active.value = ansicht.value.flach.length > 0 ? 0 : -1;
        void ladeZahlen();
        // Die Präposition steht, aber der Server hat die Ziele nicht gerechnet (überlastet): still noch einmal fragen, nie „keine Treffer“ zeigen.
        if (ansicht.value.zieleFehlen && zieleVersuche < ZIELE_VERSUCHE) {
            zieleVersuche += 1;
            clearTimeout(timer);
            timer = setTimeout(() => void run(value), ZIELE_WARTE_MS);
        }
        // Eine Suche ohne Treffer ist die nützlichste Zahl der ganzen Statistik: Sie sagt, was Besucher bei uns
        // vermissen (WI-0138 V11). Gezählt wird nur, DASS es keinen gab — der Begriff steht schon in „search“, und
        // zwar erst, wenn jemand einen Treffer wählt.
        if (searched.value && ansicht.value.flach.length === 0 && antwort.anfrage === undefined) melde("search_empty");
    } catch (error) {
        if (controller.signal.aborted) {
            return;
        }
        // Sichtbar, nicht verschluckt (Kap. 2.16): eine leere Liste sähe aus wie „nichts gefunden".
        console.error("Suche fehlgeschlagen", error);
        response.value = undefined;
        failed.value = true;
    }
}

/** Setzt einen Text ins Feld (Chip, Tab, Vorschlag ohne fertige Anfrage); die Suche läuft danach von selbst, der Fokus bleibt im Feld. */
function setzeText(text: string): void {
    query.value = text;
    void nextTick(() => {
        input.value?.focus();
        // Der Cursor steht hinter dem Text: Das Ziel wird dort weitergetippt.
        input.value?.setSelectionRange(text.length, text.length);
    });
}

function choose(zeile: SuchZeile | undefined): void {
    if (!zeile) {
        return;
    }
    switch (zeile.art) {
        case "hit":
            // 🔴 Gezählt wird der TREFFER, den jemand wählt, nie die Eingabe (WI-0138, BESUCH-0001 §14): Freitext von Besuchern
            // gehört in keine Betriebstabelle. Legacy zählte den Suchbegriff; wir zählen das Ergebnis.
            // 🔴 Der Name des Servers, nicht der der Sprachtafel (WI-0171): Eine Klimazone bleibt in der Auswertung EINE
            // Ausprägung, in jeder Sprache. Angezeigt wird `hitName(hit)`.
            melde("search", zeile.hit.name);
            emit("jump", zeile.hit);
            break;
        case "vorkommen":
            melde("search", zeile.hit.name);
            emit("vorkommen", zeile.hit);
            break;
        case "gebiet":
            melde("search", zeile.hit.name);
            emit("gebiet", zeile.hit);
            break;
        case "landmarke":
            melde("search", zeile.hit.name);
            emit("landmarke", zeile.hit);
            break;
        case "sprache":
            // Gezählt wird die Sprache, nicht der Dialekt, über den jemand sie fand: Eine Sprache bleibt in der Auswertung EINE Ausprägung.
            melde("search", zeile.hit.dialektVon ?? zeile.hit.name);
            emit("sprache", zeile.hit);
            break;
        case "ziel":
            // Ohne Anfrage ergänzt das Ziel nur den Text („zwischen Gareth und …“): Das Fenster bleibt offen.
            if (zeile.hit.leuchten === undefined) {
                setzeText(zeile.hit.text);
                return;
            }
            melde("search", zeile.begriff.name);
            emit("ziel", zeile.begriff, zeile.hit);
            break;
    }
    close();
}

/** Tab übernimmt den markierten Vorschlag ins Feld, statt ihn auszuführen: Eintrag und Name, ein Ziel samt Präposition. */
function vervollstaendige(zeile: SuchZeile | undefined): boolean {
    if (zeile?.art === "vorkommen") {
        setzeText(eintragsText(zeile.hit.name));
        return true;
    }
    if (zeile?.art === "ziel") {
        setzeText(zeile.hit.text);
        return true;
    }
    return false;
}

function waehlePraeposition(begriff: string, praeposition: string): void {
    setzeText(praepositionsText(begriff, praeposition));
}

function onInputKey(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        active.value = moveActive(active.value, zeilen.value.length, event.key === "ArrowDown" ? 1 : -1);
        void nextTick(() =>
            document.getElementById(`spotlight-hit-${String(active.value)}`)?.scrollIntoView?.({ block: "nearest" }),
        );
    } else if (event.key === "Enter") {
        event.preventDefault();
        choose(zeilen.value[active.value]);
    } else if (event.key === "Tab" && !event.shiftKey && vervollstaendige(zeilen.value[active.value])) {
        event.preventDefault();
    } else if (event.key === "Escape") {
        event.preventDefault();
        close();
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Der wechselnde Platzhalter (WI-0257 S3b): leise Hinweise, die Funktion fänden Besucher sonst nicht von selbst
// ---------------------------------------------------------------------------------------------------------------------

/** Wie lange ein Beispiel steht, und wie lange es braucht, ein- oder auszublenden. */
const PLATZHALTER_MS = 4000;
const PLATZHALTER_BLENDE_MS = 450;
/** Die Beispiele, einmal je Seitenaufruf geholt; ohne sie bleibt der feste Platzhalter. */
let beispieleGeholt = false;
const beispiele = shallowRef<readonly SearchBeispiel[]>([]);
const beispielNr = ref(0);
/** Das Beispiel blendet gerade aus, um dem nächsten Platz zu machen. */
const beispielAus = ref(false);
/** Ein Klick ins Feld hält den Wechsel an (WI-0257: „hält an, sobald das Feld den Fokus hat“); der Fokus beim Öffnen zählt nicht, sonst stünde er nie. */
const beispielHaelt = ref(false);
let beispielTimer: ReturnType<typeof setInterval> | undefined;
let beispielBlende: ReturnType<typeof setTimeout> | undefined;

const keineBewegung = (): boolean => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

async function ladeBeispiele(): Promise<void> {
    if (beispieleGeholt) return;
    beispieleGeholt = true;
    try {
        beispiele.value = await fetchBeispiele();
    } catch (error) {
        // Ohne Beispiele bleibt der feste Platzhalter; die Suche braucht sie nicht.
        console.error("Beispiele der Suche nicht geladen", error);
    }
}

function stoppeBeispiele(): void {
    clearInterval(beispielTimer);
    clearTimeout(beispielBlende);
    beispielTimer = undefined;
}

function starteBeispiele(): void {
    stoppeBeispiele();
    beispielNr.value = 0;
    beispielAus.value = false;
    beispielHaelt.value = false;
    void ladeBeispiele();
    if (keineBewegung()) return;
    beispielTimer = setInterval(() => {
        if (beispielHaelt.value || beispiele.value.length < 2) return;
        beispielAus.value = true;
        beispielBlende = setTimeout(() => {
            beispielNr.value = (beispielNr.value + 1) % beispiele.value.length;
            beispielAus.value = false;
        }, PLATZHALTER_BLENDE_MS);
    }, PLATZHALTER_MS);
}

const beispiel = computed(() => beispiele.value[beispielNr.value % Math.max(1, beispiele.value.length)]);
/** Der Platzhalter steht nur im leeren Feld und nur, wo es Beispiele gibt. */
const beispielSichtbar = computed(() => open.value && query.value === "" && beispiel.value !== undefined);

// ---------------------------------------------------------------------------------------------------------------------
// Texte der Zeilen
// ---------------------------------------------------------------------------------------------------------------------

/** Ein Zählfall mit der Zahl als eigenes Stück: „leuchtet in <194> Gegenden“; die Zahl steht hervorgehoben (Kanonfarbe der Auswahl). */
const ZAHL_MARKE = "\u0001";
function zahlTeile(fall: Parameters<typeof tPlural>[0], n: number): { vor: string; nach: string } {
    const [vor = "", nach = ""] = tPlural(fall, n, { n: ZAHL_MARKE }).split(ZAHL_MARKE);
    return { vor, nach };
}

interface ZahlText {
    readonly zahl?: number;
    readonly vor?: string;
    readonly nach?: string;
    readonly text?: string;
}

/** Was hinter der Art eines Vorkommens steht: die Zahl der Gegenden, die der Orte, „überall in Aventurien“ oder „noch kein Ort“. */
function vorkommenZahl(hit: SearchVorkommenHit): ZahlText | undefined {
    const anzeige = zahlAnzeige(hit, zahlen.value.get(hit.id));
    switch (anzeige.art) {
        case "gegenden":
            return { zahl: anzeige.n, ...zahlTeile("search.vorkommen.leuchtet", anzeige.n) };
        case "orte":
            return { zahl: anzeige.n, ...zahlTeile("search.vorkommen.leuchtetOrte", anzeige.n) };
        case "ueberall":
            return { text: t("search.vorkommen.ueberall") };
        case "keinOrt":
            return { text: t("search.vorkommen.keinOrt") };
        case "keine":
            return undefined;
    }
}

/**
 * Der Teil nach der Art, wo er etwas erklärt: Wurde der Eintrag über einen weiteren Namen gefunden, steht dieser da, über die Gruppe („Gras“) diese. Bei einem Treffer über den Namen steht nichts: Die Gruppe
 * vieler Waren („profan“) wäre Rauschen in jeder Zeile.
 */
const vorkommenDetail = (hit: SearchVorkommenHit): string | undefined =>
    hit.gefundenIn === "synonym" ? hit.synonym : hit.gefundenIn === "gruppe" ? hit.gruppe : undefined;

function zielZahlText(hit: SearchZielHit): ZahlText | undefined {
    const zahl = zielZahl(hit);
    if (zahl === undefined) return undefined;
    return {
        zahl: zahl.n,
        ...zahlTeile(zahl.art === "gegenden" ? "search.ziel.gegenden" : "search.ziel.orteZahl", zahl.n),
    };
}

/**
 * Die Marke hinter dem Namen eines Ziels: „im Wiki genannt“; sonst bei einem Herrschaftsgebiet seine Art („Reich“) und bei einem Ort seine Klasse („Metropole“), damit gleiche Namen sich unterscheiden.
 * Eine Landschaft trägt ohne Nennung keine Marke.
 */
function zielMarke(zeile: Extract<SuchZeile, { art: "ziel" }>): string | undefined {
    if (zeile.hit.genannt) return t("search.ziel.genannt");
    const typ = zeile.hit.typ;
    if (typ === undefined || typ === "" || zeile.gruppe === "landschaft") return undefined;
    if (zeile.gruppe === "ort") {
        const key = `place.${typ}`;
        return isMessageKey(key) ? t(key) : undefined;
    }
    return typ;
}

/**
 * Was hinter dem Namen einer Sprache steht (`spracheZeilenText`): ihre Art („Sprache“, „Sprachgruppe“; bei einem Dialekt „Dialekt von …“), der Text, über den sie gefunden wurde, dann die Zahl der
 * Gegenden, in denen sie leuchtet, oder „noch keine Fläche“.
 */
function spracheZahl(gegenden: number): ZahlText {
    return gegenden > 0
        ? { zahl: gegenden, ...zahlTeile("search.vorkommen.leuchtet", gegenden) }
        : { text: t("search.sprache.keineFlaeche") };
}

/** Die Art einer Landmarke in Worten („Höhle“), wie der Untertitel ihres Panels; eine unbekannte Art heißt „Gipfel“. */
function landmarkenArt(art: string): string {
    const key = `peak.${art}`;
    return isMessageKey(key) ? t(key) : t("inhalte.kind.peak");
}

const GRUPPEN_NAME = {
    landschaft: "search.ziel.landschaften",
    gebiet: "search.sektion.gebiete",
    ort: "search.ziel.orte",
} as const;

/** Die Überschrift einer Sektion; über der ersten Zielgruppe steht die ganze Anfrage („Wirselkraut in … · Landschaften“), über den weiteren nur ihr Name. */
function titelText(titel: SektionsTitel, erste: boolean): string {
    if (titel.art === "sektion") return t(titel.key);
    const gruppe = t(GRUPPEN_NAME[titel.gruppe]);
    return erste ? t("search.ziel.kopf", { begriff: titel.begriff, praeposition: titel.praeposition, gruppe }) : gruppe;
}

const ersteZielSektion = computed(() => ansicht.value.sektionen.find((sektion) => sektion.titel?.art === "ziele")?.id);

/** Nichts gefunden: keine Zeile, keine Chips, keine Ziele, und nichts wird noch gerechnet. */
const nichtsGefunden = computed(
    () => searched.value && ansicht.value.flach.length === 0 && response.value?.anfrage === undefined,
);

/** Der Index der Zeile in der flachen Liste (für `aria-activedescendant` und die Pfeiltasten). */
const indexVon = (zeile: SuchZeile): number => zeilen.value.indexOf(zeile);

/**
 * F und Leertaste öffnen die Suche von überall — über die Tastaturtafel der Karte (WI-0016), die
 * dafür `show` aufruft. Die Regeln (nicht beim Tippen, nicht bei offenem Fenster, Leertaste nicht
 * auf Knöpfen) stehen dort, für alle Kürzel an einer Stelle.
 */
defineExpose({ show });

onBeforeUnmount(() => {
    clearTimeout(timer);
    pending?.abort();
    zahlenFrage?.abort();
    stoppeBeispiele();
    clearTimeout(beispielBlende);
    stopFollowingKeyboard?.();
});
</script>

<template>
    <!-- Legacys Lupe (`#map-search-button`, index.html), unverändert übernommen: nur das Zeichen, kein Wort. -->
    <button
        ref="tile"
        type="button"
        class="search-tile"
        data-testid="search-open"
        data-ziel-deckung
        :aria-label="t('search.open')"
        :title="t('search.open.title')"
        @click="show"
    >
        <svg class="search-tile__icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M15.5 15.5 21 21" />
        </svg>
    </button>

    <!--
        💣 In den body teleportiert: die Kachel sitzt im Eckknopf-Bund, und der bildet mit seinem
        z-index einen eigenen Stapelkontext. Darin bliebe der Schleier UNTER dem Infopanel, egal
        welche Stufe er selbst trägt — gesehen: das Panel verdeckte die ersten Buchstaben der Treffer.
    -->
    <Teleport to="body">
        <div
            v-if="open"
            class="spotlight"
            data-testid="search"
            :style="{ '--spotlight-anchor': anchor, '--spotlight-keyboard': keyboard }"
            @mousedown.self="close"
        >
            <div ref="card" class="spotlight__card" role="dialog" aria-modal="true" :aria-label="t('search.dialog')">
                <div class="spotlight__eingabe">
                    <input
                        ref="input"
                        v-model="query"
                        class="spotlight__input"
                        data-testid="search-input"
                        type="text"
                        enterkeyhint="search"
                        :placeholder="beispiele.length > 0 ? '' : t('search.placeholder')"
                        :aria-label="t('search.placeholder')"
                        autocomplete="off"
                        spellcheck="false"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="spotlight-results"
                        :aria-activedescendant="active >= 0 ? `spotlight-hit-${active}` : undefined"
                        @keydown="onInputKey"
                        @pointerdown="beispielHaelt = true"
                    />
                    <!--
                        Der wechselnde Platzhalter (WI-0257 S3b): echte Beispiele, sanft ein- und ausgeblendet, damit die Funktion von selbst auffällt.
                        Er nimmt keinen Klick (der Klick gehört dem Feld) und steht nur im leeren Feld.
                    -->
                    <div
                        v-if="beispielSichtbar && beispiel !== undefined"
                        class="spotlight__ph"
                        :class="{ 'is-aus': beispielAus, 'is-halt': beispielHaelt || beispiele.length < 2 }"
                        data-testid="search-placeholder"
                        aria-hidden="true"
                    >
                        <b>{{ t("search.placeholder.beispiel") }}</b>
                        <span class="einzeilig" data-testid="search-placeholder-text">{{ beispiel.text }}</span>
                        <span class="spotlight__ph-punkte">
                            <i
                                v-for="(_, nr) in beispiele"
                                :key="nr"
                                :class="{ 'is-an': nr === beispielNr % beispiele.length }"
                            ></i>
                        </span>
                    </div>
                </div>
                <ul v-if="zeilen.length > 0" id="spotlight-results" class="spotlight__results" role="listbox">
                    <template v-for="sektion in ansicht.sektionen" :key="sektion.id">
                        <li
                            v-if="sektion.titel !== undefined"
                            class="spotlight__sektion"
                            role="presentation"
                            :data-testid="`search-sektion-${sektion.id}`"
                        >
                            {{ titelText(sektion.titel, sektion.id === ersteZielSektion) }}
                        </li>
                        <li
                            v-for="zeile in sektion.zeilen"
                            :id="`spotlight-hit-${indexVon(zeile)}`"
                            :key="zeile.key"
                            class="spotlight__hit"
                            :class="{ 'spotlight__hit--active': indexVon(zeile) === active }"
                            role="option"
                            :aria-selected="indexVon(zeile) === active"
                            :data-testid="
                                zeile.art === 'hit'
                                    ? 'search-hit'
                                    : zeile.art === 'vorkommen'
                                      ? 'search-vorkommen'
                                      : zeile.art === 'gebiet'
                                        ? 'search-gebiet'
                                        : zeile.art === 'landmarke'
                                          ? 'search-landmarke'
                                          : zeile.art === 'sprache'
                                            ? 'search-sprache'
                                            : 'search-ziel'
                            "
                            :data-kind="zeile.art === 'hit' ? zeile.hit.kind : zeile.art"
                            @mousemove="active = indexVon(zeile)"
                            @click="choose(zeile)"
                        >
                            <template v-if="zeile.art === 'hit'">
                                <span class="spotlight__name einzeilig">{{ hitName(zeile.hit) }}</span>
                                <span class="spotlight__type einzeilig">{{ hitTypeLabel(zeile.hit) }}</span>
                            </template>
                            <template v-else-if="zeile.art === 'vorkommen'">
                                <span class="spotlight__name einzeilig">
                                    <VorkommenPlakette
                                        class="spotlight__zeichen"
                                        groesse="m"
                                        :zeichen="KATEGORIE_ZEICHEN[zeile.hit.kind]"
                                        :data-kind="zeile.hit.kind"
                                    />
                                    {{ zeile.hit.name }}
                                </span>
                                <span class="spotlight__type spotlight__art einzeilig">
                                    {{ t(KATEGORIE_NAME[zeile.hit.kind]) }}
                                    <template v-if="vorkommenDetail(zeile.hit) !== undefined">
                                        · {{ vorkommenDetail(zeile.hit) }}
                                    </template>
                                    <template v-if="vorkommenZahl(zeile.hit) !== undefined">
                                        ·
                                        <SuchZahl :wert="vorkommenZahl(zeile.hit)" testid="search-vorkommen-zahl" />
                                    </template>
                                </span>
                            </template>
                            <template v-else-if="zeile.art === 'gebiet'">
                                <span class="spotlight__name einzeilig">
                                    {{ zeile.hit.name }}
                                    <span v-if="zeile.hit.typ !== undefined" class="spotlight__tag">{{
                                        zeile.hit.typ
                                    }}</span>
                                </span>
                                <span class="spotlight__type spotlight__art einzeilig">{{
                                    t("search.sektion.gebiete")
                                }}</span>
                            </template>
                            <template v-else-if="zeile.art === 'landmarke'">
                                <span class="spotlight__name einzeilig">{{ zeile.hit.name }}</span>
                                <span class="spotlight__type einzeilig">{{ landmarkenArt(zeile.hit.art) }}</span>
                            </template>
                            <template v-else-if="zeile.art === 'sprache'">
                                <span class="spotlight__name einzeilig">
                                    <VorkommenPlakette
                                        class="spotlight__zeichen"
                                        groesse="m"
                                        zeichen="ebene-sprachen"
                                    />
                                    <span
                                        class="spotlight__farbe"
                                        :style="{ background: zeile.hit.farbe }"
                                        data-testid="search-sprache-farbe"
                                        aria-hidden="true"
                                    ></span>
                                    {{ zeile.hit.name }}
                                </span>
                                <span class="spotlight__type spotlight__art einzeilig">
                                    {{
                                        t(spracheZeilenText(zeile.hit).art.key, spracheZeilenText(zeile.hit).art.params)
                                    }}
                                    <template v-if="spracheZeilenText(zeile.hit).detail !== undefined">
                                        · {{ spracheZeilenText(zeile.hit).detail }}
                                    </template>
                                    ·
                                    <SuchZahl
                                        :wert="spracheZahl(spracheZeilenText(zeile.hit).gegenden)"
                                        testid="search-sprache-zahl"
                                    />
                                </span>
                            </template>
                            <template v-else>
                                <span class="spotlight__name einzeilig">
                                    {{ zeile.hit.name }}
                                    <span v-if="zielMarke(zeile) !== undefined" class="spotlight__tag">{{
                                        zielMarke(zeile)
                                    }}</span>
                                </span>
                                <span class="spotlight__type spotlight__art einzeilig">
                                    <SuchZahl :wert="zielZahlText(zeile.hit)" testid="search-ziel-zahl" />
                                </span>
                            </template>
                        </li>
                        <li
                            v-if="sektion.weitere > 0"
                            class="spotlight__weitere"
                            role="presentation"
                            data-testid="search-weitere"
                        >
                            {{ t("search.vorkommen.weitere", { n: sektion.weitere }) }}
                        </li>
                        <li
                            v-if="sektion.ungeprueft > 0"
                            class="spotlight__weitere"
                            role="presentation"
                            data-testid="search-ungeprueft"
                        >
                            {{ t("search.ziel.ungeprueft", { n: sektion.ungeprueft }) }}
                        </li>
                    </template>
                </ul>
                <!-- Nach einem abgeschlossenen Begriff schlägt die Suche die Präpositionen vor (WI-0257 S3b); ein Klick setzt sie ins Feld. -->
                <div v-if="ansicht.chips !== undefined" class="spotlight__chips" data-testid="search-chips">
                    <button
                        v-for="praeposition in ansicht.chips.praepositionen"
                        :key="praeposition"
                        type="button"
                        class="spotlight__chip"
                        data-testid="search-chip"
                        @click="waehlePraeposition(ansicht.chips.begriff, praeposition)"
                    >
                        {{ praeposition }} …
                    </button>
                </div>
                <p v-if="ansicht.hinweis" class="spotlight__hinweis" data-testid="search-hinweis">
                    {{ t("search.hinweis") }}
                </p>
                <p v-if="ansicht.zieleErklaerung" class="spotlight__hinweis" data-testid="search-ziel-hinweis">
                    {{ t("search.ziel.hinweis") }}
                </p>
                <p v-if="failed" class="spotlight__status" data-testid="search-status">
                    {{ t("search.unavailable") }}
                </p>
                <p v-else-if="ansicht.zieleFehlen" class="spotlight__status" data-testid="search-status">
                    {{ t("search.ziel.belegt") }}
                </p>
                <p v-else-if="ansicht.zieleLeer" class="spotlight__status" data-testid="search-status">
                    {{ t("search.ziel.keine") }}
                </p>
                <p v-else-if="nichtsGefunden" class="spotlight__status" data-testid="search-status">
                    {{ t("search.none") }}
                </p>
                <p v-else-if="truncated" class="spotlight__status" data-testid="search-status">
                    {{ t("search.truncated") }}
                </p>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/*
 * 🔴 Farben, Schatten und Radien kommen aus dem Kanon (`--color-spotlight-*`, WI-0014). Die Maße
 * darunter sind die BAUTEILMASSE aus Legacys `css/components/spotlight-search.css`, live vermessen
 * (Guide §14) — sie gehören diesem einen Bauteil und stehen deshalb hier, benannt, an einer Stelle.
 */
.spotlight {
    --spotlight-width: 560px;
    --spotlight-input-h: 50px;
    --spotlight-hit-min-h: 36px;
    --spotlight-type-max-w: 150px;
    --spotlight-blur: 4px;
    --spotlight-results-max-h: 460px;
    /* Die Kachel sitzt im OBEREN Drittel, nicht mittig. */
    --spotlight-offset-top: 116px;

    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: var(--spotlight-offset-top) var(--space-12) var(--space-20);
    background: var(--color-scrim-light);
    backdrop-filter: blur(var(--spotlight-blur));
}

/* 🔴 In BEIDEN Themen dunkel (SPECIAL CASE). Nicht dem Thema folgen lassen. */
.spotlight__card {
    width: min(var(--spotlight-width), 100%);
    overflow: hidden;
    border: 1px solid var(--color-spotlight-border);
    border-radius: var(--radius-md);
    background: var(--color-spotlight-bg);
    box-shadow: var(--shadow-spotlight);
    color: var(--color-spotlight-text);
}

.spotlight__input {
    box-sizing: border-box;
    width: 100%;
    height: var(--spotlight-input-h);
    padding: 0 var(--space-12);
    border: 0;
    border-bottom: 1px solid var(--color-spotlight-divider);
    background: transparent;
    color: var(--color-spotlight-text);
    font-family: var(--font-ui);
    font-size: var(--font-size-title);
    line-height: var(--leading-tight);
    outline: none;
}

.spotlight__input::placeholder {
    color: var(--color-spotlight-text-faint);
}

/* Der Rahmen um Feld und Platzhalter: Der wechselnde Platzhalter liegt über dem leeren Feld und nimmt keinen Klick. */
.spotlight__eingabe {
    position: relative;
}

.spotlight__ph {
    position: absolute;
    inset: 0 var(--space-12) 0 var(--space-12);
    display: flex;
    align-items: center;
    gap: var(--space-6);
    overflow: hidden;
    color: var(--color-spotlight-text-faint);
    font-size: var(--font-size-title);
    line-height: var(--leading-tight);
    opacity: 1;
    pointer-events: none;
    transition: opacity 450ms ease;
}

.spotlight__ph.is-aus {
    opacity: 0;
}

.spotlight__ph b {
    flex: none;
    color: var(--color-spotlight-text-soft);
    font-weight: normal;
}

.spotlight__ph > .einzeilig {
    flex: 0 1 auto;
    min-width: 0;
}

/* Die Punkte zeigen, dass der Platzhalter wechselt; sie verschwinden, sobald er stehen bleibt. */
.spotlight__ph-punkte {
    display: flex;
    flex: none;
    gap: var(--space-4);
    margin-left: auto;
}

.spotlight__ph-punkte i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-spotlight-divider);
}

.spotlight__ph-punkte i.is-an {
    background: var(--color-spotlight-text-soft);
}

.spotlight__ph.is-halt .spotlight__ph-punkte {
    display: none;
}

.spotlight__results {
    max-height: min(54vh, var(--spotlight-results-max-h));
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    list-style: none;
}

.spotlight__hit {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-8);
    min-height: var(--spotlight-hit-min-h);
    padding: var(--space-4) var(--space-8);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-reading);
}

.spotlight__hit--active {
    background: var(--color-spotlight-active);
}

/* Die Überschrift einer Sektion („Vorkommen“, „Wirselkraut in … · Landschaften“): leise, in Versalien wie die Art im Treffer. */
.spotlight__sektion {
    margin: 0;
    padding: var(--space-8) var(--space-8) var(--space-2);
    color: var(--color-spotlight-text-faint);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.spotlight__sektion:not(:first-child) {
    margin-top: var(--space-4);
}

/*
 * Das Zeichen vor dem Namen eines Vorkommens (und einer Sprache, die ebenso leuchtet): die Plakette der Vorkommen (`vorkommen-plakette.vue`), wie im Panel und
 * im Routenplaner. Die Suche ist immer dunkel, deshalb nimmt die Plakette Kante, Fläche und Zeichen aus den Farben der Suche statt aus denen des Themas.
 */
.spotlight__zeichen {
    --plakette-kante: var(--color-spotlight-border);
    --plakette-grund: var(--color-spotlight-divider);
    --plakette-schrift: var(--color-spotlight-text);

    margin-right: var(--space-8);
}

/* Die Farbe einer Sprache auf der Karte (WI-0261 S5c): ein Punkt vor ihrem Namen, mit feiner Kontur, damit auch ein dunkler Ton auf dem dunklen Grund sichtbar bleibt. */
.spotlight__farbe {
    display: inline-block;
    box-sizing: border-box;
    width: 11px;
    height: 11px;
    margin-right: var(--space-6);
    border: 1px solid var(--color-spotlight-text-soft);
    border-radius: 50%;
    vertical-align: middle;
}

/* Eine Marke hinter dem Namen („im Wiki genannt“, „Reich“): eine kleine Pille. */
.spotlight__tag {
    margin-left: var(--space-8);
    padding: 0 var(--space-6);
    border: 1px solid var(--color-spotlight-border);
    border-radius: 999px;
    color: var(--color-spotlight-text-soft);
    font-size: var(--font-size-caption);
    letter-spacing: 0;
    text-transform: none;
    white-space: nowrap;
}

/* Die Art und die Zahl rechts stehen in Schreibweise, nicht in Versalien; sie kürzen nicht (der Name davor kürzt über `.einzeilig`). */
.spotlight__type.spotlight__art {
    max-width: none;
    letter-spacing: 0;
    text-transform: none;
}

/* „… und 12 weitere“ unter einer Sektion. */
.spotlight__weitere {
    margin: 0;
    padding: var(--space-2) var(--space-8) var(--space-4);
    color: var(--color-spotlight-text-faint);
    font-size: var(--font-size-small);
    hyphens: manual;
    list-style: none;
}

/* Die Präpositionen als Chips unter dem Begriff: ein Klick setzt sie ins Feld. */
.spotlight__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-10) var(--space-10) var(--space-12);
}

.spotlight__chip {
    padding: var(--space-4) var(--space-10);
    border: 1px solid var(--color-spotlight-border);
    border-radius: 999px;
    background: transparent;
    color: var(--color-spotlight-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    white-space: nowrap;
    transition: background-color 120ms ease;
}

.spotlight__chip:hover,
.spotlight__chip:focus-visible {
    outline: none;
    background: var(--color-spotlight-active);
}

/* Die leise Zeile unter einem Vorkommen („in …, auf …, südlich von … grenzt ein“): kursiv wie die Auskunft über die Suche. */
.spotlight__hinweis {
    margin: 0;
    padding: var(--space-4) var(--space-12) var(--space-10);
    color: var(--color-spotlight-text-faint);
    font-size: var(--font-size-small);
    font-style: italic;
    /* Die Hinweiszeilen trennen nicht von selbst („Gegen-den“ liest sich wie ein Fehler); der Kanon trennt sonst überall (`hyphens: auto`). */
    hyphens: manual;
    line-height: var(--leading-normal);
}

/* Name und Art kürzen über `.einzeilig` (app.vue). */
.spotlight__type {
    max-width: var(--spotlight-type-max-w);
    color: var(--color-spotlight-text-soft);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Kursiv, weil sie kein Treffer ist, sondern eine Auskunft über die Suche. */
.spotlight__status {
    margin: 0;
    padding: var(--space-10) var(--space-12);
    color: var(--color-spotlight-text-soft);
    font-size: var(--font-size-small);
    font-style: italic;
    line-height: var(--leading-normal);
}

@media (prefers-reduced-motion: reduce) {
    .spotlight__ph,
    .spotlight__chip {
        transition: none;
    }
}

/*
 * Die Suchkachel im Eckknopf-Bund, wie Legacys Lupe (`css/components/legal-dialog.css`): 48 × 48,
 * Fingermaß, am Zeiger wie am Finger (Owner Legacy 11.08.2026: „größer war super"). Das Zeichen
 * misst 22 px. Farbe, Kontur, Radius und Schatten trägt sie wie die übrigen Eckknöpfe - dieselben
 * Tokens wie die Fächerkachel, keine eigenen Werte.
 */
.search-tile {
    --search-tile: 48px;
    --search-tile-icon: 22px;

    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--search-tile);
    height: var(--search-tile);
    padding: 0;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
}

/* 🪤 Die Hoverwäsche ist durchscheinend: sie liegt ÜBER der Fläche, sonst sähe man die Karte durch. */
.search-tile:hover,
.search-tile:focus-visible {
    outline: none;
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

.search-tile:focus-visible {
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-panel);
}

.search-tile__icon {
    display: block;
    width: var(--search-tile-icon);
    height: var(--search-tile-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
}

/*
 * ── Am Finger: das Suchfenster sitzt UNTEN, auf der Höhe der Lupe (Legacy, spotlight-search.css) ──
 * Dort sitzt die Lupe, die es öffnet, und dort ist der Daumen: das Feld wächst AUS ihr nach links,
 * statt quer über den Schirm zu fliegen. Die Unterkante liest das gemessene Rechteck der Kachel
 * (`--spotlight-anchor`), dazu kommt, was die Bildschirmtastatur verdeckt (`--spotlight-keyboard`).
 * Die rechte Kante fällt mit der der Lupe zusammen: beide stehen `--space-10` vom Rand.
 * ⚠️ Über `order`, nicht `column-reverse` (Legacy): die Umkehrung erwischte auch die Statuszeile.
 */
@media (pointer: coarse) {
    .spotlight {
        align-items: flex-end;
        padding: var(--space-16) var(--space-10)
            calc(var(--spotlight-anchor, var(--space-10)) + var(--spotlight-keyboard, 0px));
    }

    .spotlight__card {
        display: flex;
        flex-direction: column;
        width: 100%;
    }

    /* Das Feld unten, die Treffer wachsen darüber nach oben; Chips und Hinweise gehören zu den Treffern. */
    .spotlight__results,
    .spotlight__chips,
    .spotlight__hinweis {
        order: 1;
    }

    .spotlight__eingabe {
        order: 2;
    }

    .spotlight__status {
        order: 3;
    }

    /*
     * 🪤 Die Lupe wird NICHT über den Schleier gehoben. Legacys Code will das (`z-index` an der
     * Kachel), aber sein Bund bildet einen Stapelkontext, aus dem sie nicht herauskommt: im
     * laufenden Legacy liegt das Feld über der Lupe (gemessen 2026-09-23, `elementFromPoint` in
     * der Lupenmitte trifft das Suchfeld). Maßstab ist, was Legacy ZEIGT (Betreiber 2026-09-23).
     */
}
</style>
