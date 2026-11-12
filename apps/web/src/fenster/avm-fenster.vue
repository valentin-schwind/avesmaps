<script setup lang="ts">
import { computed, inject, nextTick, ref, useId, useTemplateRef, watch } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import { FENSTER_ESC_VORHER } from "./fenster-esc";
import { t } from "../i18n/i18n";
import {
    begrenzeBox,
    boxIn,
    loestSich,
    MINDEST,
    stabileHoehe,
    vorgabeEckeKlasse,
    type FensterBox,
    type FensterHuellenLage,
    type FensterVorgabeEcke,
} from "./fenster-lage";
import { useFensterZiehen } from "./fenster-ziehen";
import InfoZeichen from "./info-zeichen.vue";

/**
 * DIE Fensterhülle (Design Guide §12, Rezept „Ein Fenster bauen“ in §12.6; WI-0045).
 *
 * 🔴 Jedes Fenster der Oberfläche ist diese Hülle mit eigenem Inhalt. Wer ein Fenster baut, schreibt
 * eine Datei `<name>-fenster.vue`, deren Vorlage `<AvmFenster>` ist, und hängt seinen Inhalt in den
 * Rumpf. Eine eigene Hülle, ein eigenes `<dialog>`, ein eigener Schleier oder Schatten ist ein roter
 * Test (`test/fenster-huelle.test.ts`). Fehlt der Hülle etwas, wird es HIER ergänzt, nie im Fenster.
 *
 * - **Zwei Bauarten (§12.1):** Blatt (Radius 10, Kante `border`, Schließknopf nackt) und Werkzeug
 *   (Radius 5, Kante `border-strong`, Schließknopf gefasst). Sonst ist alles gleich.
 * - **Sieben Teile (§12.2):** Kopf mit Griff, Titel, Zusatz, Kopffeld; Rumpf; Fuß. Kopf und Fuß
 *   stehen, nur der Rumpf rollt. Die Hülle polstert nicht, jede Zone polstert sich selbst. Dazu kamen
 *   Reiter und Leiste (WI-0120, WI-0118) und die Schiene links neben dem Rumpf (§13.12, WI-0127).
 * - **Modal, in der obersten Ebene:** ein natives `<dialog>` mit `showModal()`, nach `body` verlegt.
 *   Damit halten Plattform und Hülle Escape, den Fokus im Fenster und den Schleier (§12.4); die
 *   Stapelleiter (§12.5) braucht es für ein modales Fenster nicht.
 * - **Fokus:** beim Öffnen auf ✕ (Legacy), beim Schließen zurück zum Auslöser.
 * - **Schließen:** ✕, Escape und ein Klick auf den Schleier - nur wenn Druck UND Loslassen dort lagen
 *   (Legacy `dialog-hintergrund-schliessen.js`, Owner 02.09.2026: sonst schließt, wer Text markiert
 *   und dabei über den Rand zieht).
 * - **Verschieben am Kopf** mit Maus und Stift (`fenster-ziehen.ts`); am Finger kein Griff.
 * - **Keine Bewegung beim Erscheinen** (§30.8): ein Fenster öffnet der Betrachter selbst.
 *
 * **Werkzeugfenster in drei Lagen** (WI-0128 E6, EDIT-0001 §4.1, D14, D15; Koordination 2026-10-10): `lage` lässt ein Fenster nicht
 * modal neben der Karte stehen. 🔴 `modal` (Vorgabe) bleibt genau wie oben, für alle bisherigen Fenster.
 * - `angedockt`: am rechten Rand über dem Editorpanel, volle Kartenhöhe, meldet sich als Rand (`data-map-overlay="right"`).
 * - `geloest`: ein eigenes Fenster über der Karte, am Kopf verschiebbar, an der Ecke in der Größe (`box`, mindestens 520 × 240);
 *   deckend auch beim Verschieben. Es meldet sich nicht als Rand.
 * - `versenkt`: nicht gezeichnet, aber eingehängt - Entwurf und Auswahl im Inhalt bleiben. Die Zeile steht unter „Offene
 *   Bearbeitungen“ im Editorpanel.
 * - Im Kopf ⧉ lösen bzw. ▥ andocken und − ablegen; ziehen am Kopf löst ein angedocktes Fenster ab 6 px. Ein gelöstes Fenster, das
 *   über einem Ablageziel (`data-fenster-ablage`, „Offene Bearbeitungen“) losgelassen wird, wird abgelegt; eines, das man mit dem
 *   Zeiger an den rechten Rand zieht (`ANDOCKEN_RAND`), dockt an (Betreiber 2026-10-11: „ich kann ihn abdocken, aber rechts mit drag
 *   n drop wieder andocken“). Während des Zugs zeigt eine Vorschau, wo es angedockt stünde, und das Ablageziel unter dem Zeiger
 *   leuchtet (`data-fenster-ziel`). Escape mit dem Fokus im Fenster schließt es (der
 *   Aufrufer legt ein Fenster mit Entwurf ab, statt es zu verwerfen).
 * - Ein Lagenwechsel fliegt als Platzhalter 240 ms von der alten an die neue Stelle (§29), bei reduzierter Bewegung sofort.
 * - Nicht modal heißt: kein Schleier, kein Fokusfang, kein Fokussprung beim Öffnen, kein Verlegen nach `body`; es steht, wo der
 *   Aufrufer es einhängt (im rechten Slot der Karte).
 * - `ohneAblage` und `hoehe="inhalt"` (WI-0268 C2, Bedienkonzept §1.3): Die Fenster der Besucher haben keine Ablage (kein −, kein Ablegen per Zug) und sind nur so hoch wie ihr
 *   Inhalt, höchstens bis zum Kartenrand (Betreiber 2026-10-31); dann rollt der Rumpf, Kopf und Fuß stehen. Beides ist ein Angebot, kein Zwang: Ohne die Props bleibt jedes
 *   Fenster der Editoren, wie es war (angedockt in voller Höhe, mit −).
 * - `stabil` mit `ansicht` (WI-0272, Entwurf 8): Das Fenster misst seine Höhe je Ansicht einmal und hält sie; Bild, Bezüge und Hinweise ändern sie nicht, der Rumpf rollt, der Fuß bleibt. Die neue Ansicht
 *   gleitet in 240 ms in ihre Höhe und ist mit `ansichtNieHoeher` nie höher als die vorige.
 * - `eingeklappt` (WI-0128 E12, EDIT-0001 §4.4): Während eines Modus auf der Karte schrumpft ein Werkzeugfenster auf seinen Kopf und
 *   die Leiste `eingeklappt`, die den Modus erklärt. Rumpf, Reiter, Leiste und Fuß bleiben eingehängt (der Entwurf bleibt), ein
 *   angedocktes Fenster meldet sich nicht mehr als Rand: Die freie Fläche der Kamera wächst mit.
 */
const props = defineProps<{
    /** §12.1: Ein Blatt liest man, ein Werkzeug bedient man. */
    bauart: "blatt" | "werkzeug";
    /** Der Titel (§12.2 `__titel`). Er benennt das Fenster auch für Vorleser. */
    titel: string;
    /**
     * Eine der benannten Breiten aus dem Kanon (`fenster.breite`), nie eine eigene Zahl; `verwaltung` seit WI-0120 A8, `anmelden` seit A9,
     * `medien` seit WI-0068 P3, `entscheiden` seit WI-0128 E22, `wege` seit WI-0177 (Betreiber 2026-10-19: Eigenschaften breiter).
     */
    breite: "anmelden" | "entscheiden" | "lesen" | "tafel" | "verwaltung" | "medien" | "werkzeug" | "wege";
    /**
     * Wie der Rumpf seinen Inhalt trägt (WI-0068 P3, Guide §12.6 „Ein Rumpf aus Spalten“): `rollt` (Vorgabe) stapelt die Blöcke im Takt
     * 14 und rollt als Ganzes; `spalten` stellt seine Kinder nebeneinander, polstert nicht und rollt nicht selbst - jede Spalte
     * (`FensterSpalte`) rollt für sich, getrennt durch eine Haarlinie. Ein Fenster aus Spalten hat die feste Höhe eines Blattes wie eines
     * mit Reitern, sonst wüchse es mit der längsten Spalte.
     */
    rumpf?: "rollt" | "spalten" | undefined;
    /**
     * Der Rumpf polstert oben nicht (das Fenster „Hinweise“): Ein Kopf im Inhalt, der beim Rollen klebt (`position: sticky`), hält sonst den Abstand des Polsters zum Rand, und durch die Lücke
     * scheint der Text, der darunter wegrollt. Den Abstand zum Kopf des Fensters trägt dann das erste Kind selbst.
     */
    rumpfBuendig?: boolean | undefined;
    /** Das Zeichen vor dem Titel: `info` für die Erklärfenster hinter einem ⓘ (Legacy `.tsi-i`). */
    zeichen?: "info" | undefined;
    /**
     * Die kleinste Höhe, auf die sich dieses Fenster ziehen lässt, wenn sein Inhalt niedriger ist als die Vorgabe für
     * Werkzeugfenster (`MINDEST.height`, 240). Die Messwerte brauchen keine 240 px; was darüber steht, ist leere Fläche.
     */
    mindestHoehe?: number | undefined;
    /** Kennung, Zählung oder Reichweite neben dem Titel (§12.2 `__zusatz`), gedämpft. */
    zusatz?: string | undefined;
    /**
     * Eine Zeile unter dem Titel (WI-0272, Entwurf 8: „Aventurien, wie es aussieht …“): Der Kopf wird dann großzügiger (Titel 20 px, Polster 14, Griff und ✕ oben), für ein Fenster, das
     * einladen soll statt zu bedienen. Ohne Angabe bleibt jeder Kopf, wie er war.
     */
    unterzeile?: string | undefined;
    testid?: string | undefined;
    /** Die Lage eines Werkzeugfensters (WI-0128 E6); ohne Angabe `modal` wie jedes bisherige Fenster. */
    lage?: FensterHuellenLage | undefined;
    /** Lage und Größe des gelösten Fensters, in Pixeln seines Elternteils. */
    box?: FensterBox | undefined;
    /**
     * Wo ein gelöstes Fenster zuerst erscheint, solange keine `box` gemerkt ist (WI-0150). Ohne Angabe steht es wie bisher;
     * eine gemerkte Box schlägt die Ecke immer.
     */
    vorgabeEcke?: FensterVorgabeEcke | undefined;
    /** Wohin der Platzhalter beim Ablegen fliegt (die Zeile unter „Offene Bearbeitungen“). */
    ablageZiel?: (() => DOMRect | undefined) | undefined;
    /** Ein Fenster ohne Ablage (Besucher, WI-0268 C2): kein − im Kopf, und ein Zug über „Offene Bearbeitungen“ legt es nicht ab. */
    ohneAblage?: boolean | undefined;
    /**
     * `inhalt`: ein angedocktes oder gelöstes Fenster ist nur so hoch wie sein Inhalt, höchstens bis zum Rand der Karte; der Rumpf rollt darüber hinaus (WI-0268 C2).
     * Ohne Angabe bleibt ein angedocktes Fenster in voller Kartenhöhe wie bisher.
     */
    hoehe?: "inhalt" | undefined;
    /**
     * Das feste Blattformat um eine Zeile der Schiene höher, höchstens bis zum Bildschirmrand: nur für ein Fenster, dessen Schiene sonst rollte (die Systemsteuerung, Betreiber 2026-11-03).
     * Ohne Angabe bleibt es bei √2 : 1.
     */
    hoeher?: boolean | undefined;
    /**
     * Mit `hoehe="inhalt"` und gelöst: Das Fenster misst seine Höhe je Ansicht EINMAL, wenn die Ansicht erscheint, und hält sie; was danach dazukommt (ein gewähltes Bild, Bezüge, Hinweise im Fuß),
     * rollt im Rumpf, Kopf und Fuß bleiben stehen (WI-0272, Entwurf 8; Betreiber 2026-11-01: „die abmessungen des dialogs müssen stabil bleiben sonst verschwindet der upload button unten“). Die Hausregel
     * „so hoch wie nötig“ gilt dann für die Ansicht, nicht für jeden Augenblick. Ein Angebot, kein Zwang: Ohne die Angabe wächst das Fenster mit seinem Inhalt, wie es war.
     */
    stabil?: boolean | undefined;
    /** Die Ansicht, deren Höhe das Fenster hält (nur mit `stabil`): Wechselt sie (Formular → Bestätigung), misst das Fenster neu und gleitet in die neue Höhe. */
    ansicht?: string | undefined;
    /** Mit `stabil`: Die neue Ansicht ist nie höher als die vorige (eine Bestätigung ist nicht höher als das Formular davor). */
    ansichtNieHoeher?: boolean | undefined;
    /** Nur Kopf und die Leiste `eingeklappt` (ein Modus auf der Karte läuft, WI-0128 E12). */
    eingeklappt?: boolean | undefined;
    /**
     * Am Telefon steht ein ANGEDOCKTES Fenster als Blatt unten, so hoch wie sein Inhalt (höchstens bis 48 px unter den Rand), statt von oben bis unten (WI-0272 S2b, Reisebilder:
     * Die Karte über dem Blatt bleibt frei, die Kamera fliegt die Stelle dorthin). Es meldet sich dann als unterer Rand (`data-map-overlay="bottom"`). Ein Angebot, kein
     * Zwang: Ohne die Angabe bleibt jedes Fenster, wie es war.
     */
    telefonBlatt?: boolean | undefined;
    /**
     * Am Telefon steht ein MODALES Fenster als Blatt am unteren Rand, über die volle Breite und oben gerundet, statt mittig (WI-0306, „Reise als
     * PDF“, Entwurf Fassung 6: „am Telefon Blatt von unten“). Ein Angebot, kein Zwang: Ohne die Angabe steht jedes modale Fenster wie bisher.
     */
    telefonUnten?: boolean | undefined;
    /**
     * Wie weit die LINKE Fensterkante eingezogen ist, in Pixeln (WI-0128 P1, Betreiber 2026-10-13). 🔴 Die rechte Kante steht still,
     * nur die linke wandert nach rechts; was rechts der eingezogenen Spalte steht, behält Breite und Platz auf dem Schirm. Ohne
     * Angabe zieht nichts ein, und die Hülle rechnet wie bisher.
     */
    einzug?: number | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    /** Das Fenster wurde berührt und kommt nach vorn. */
    vorn: [];
}>();
const slots = defineSlots<{
    /** Der Rumpf: der Inhalt des Fensters. Nur er rollt. */
    default(): unknown;
    /** Ein Feld in der Kopfleiste (§12.2 `__kopffeld`), etwa eine Suche. Es hält die Bedienhöhe. */
    kopffeld?(): unknown;
    /**
     * Die Reiter unter dem Kopf (§12.2 `__reiter`, WI-0120 A10): Sie stehen wie Kopf und Fuß, nur der Rumpf rollt. Für ein Fenster,
     * dessen Reiter lange Listen tragen (Verwaltung); ein kurzes Erklärfenster lässt seine Reiter im Rumpf. Darin steht `FensterReiter`.
     */
    reiter?(): unknown;
    /**
     * Die Leiste zwischen Kopf und Rumpf (§12.2 `__leiste`, WI-0118): Filter und Sortierung einer Liste. Sie steht wie Kopf und Fuß,
     * nur der Rumpf darunter rollt - eine Liste, deren Filter mit ihr wegrollen, ist nach dem ersten Bildschirm nicht mehr zu bedienen.
     */
    leiste?(): unknown;
    /**
     * Die Schiene links neben dem Rumpf (Guide §13.12, WI-0127 SYS-1; SYS-0001 §6.1): die Bereiche eines Fensters mit vielen
     * Ansichten (Verwaltung). Sie steht wie Kopf und Fuß, Leiste und Rumpf rücken rechts neben sie, nur der Rumpf rollt. 🔴 Am
     * Telefon legt die Hülle sie an den Anfang der Leiste (`telefon` ist dann wahr), und darin steht sie als Auswahl; darin steht
     * `FensterSchiene`, die beides kann.
     */
    schiene?(props: { telefon: boolean }): unknown;
    /** Die Leiste unter dem Kopf, solange das Fenster eingeklappt ist: Sie erklärt den laufenden Modus (WI-0128 E12). */
    eingeklappt?(): unknown;
    /** Die Nebenbemerkung links im Fuß (§12.2 `__fuss-hinweis`). */
    "fuss-hinweis"?(): unknown;
    /** Die Hauptaussage rechts im Fuß (§12.2 `__fuss-haupt`). */
    "fuss-haupt"?(): unknown;
    /**
     * Der Fuß als Ganzes (WI-0272, Entwurf 8): Die Hülle liefert Linie und Platz, der Aufrufer die Zeilen darin und ihr Polster (ein Hinweis über der Zeile mit Knöpfen, ein großer Hauptknopf). Er
     * ersetzt `fuss-hinweis` und `fuss-haupt`, die dann nicht mehr gezeichnet werden. Wie jeder Fuß steht er, nur der Rumpf rollt.
     */
    fuss?(): unknown;
}>();

const titelId = useId();
const spalten = computed(() => props.rumpf === "spalten");
/** Die Schiene steht links neben dem Rumpf, am Telefon in der Leiste (Guide §13.12). */
const schieneSeitlich = computed(() => Boolean(slots.schiene) && !phoneViewport.value);
const schieneInLeiste = computed(() => Boolean(slots.schiene) && phoneViewport.value);
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const kopf = useTemplateRef<HTMLElement>("kopf");
const schliessKnopf = useTemplateRef<HTMLButtonElement>("schliessKnopf");
const ziehen = useFensterZiehen(dialog, kopf);

/** Die Lage (WI-0128 E6); ohne Angabe ein modales Fenster wie jedes bisherige. */
const lage = computed<FensterHuellenLage>(() => props.lage ?? "modal");
const modal = computed(() => lage.value === "modal");
/** Die Box während eines Zugs am Kopf oder an der Ecke; sonst die des Aufrufers. */
const zugBox = ref<FensterBox | undefined>(undefined);
/** Wohin ein Zug am Kopf gerade führt: an den rechten Rand (andocken) oder auf ein Ablageziel (ablegen). */
const zugZiel = ref<"andocken" | "ablegen" | undefined>(undefined);
/**
 * Der Einzug der linken Kante (WI-0128 P1). `einziehbar` schaltet die Rechnung überhaupt erst ein: Ein Fenster ohne diese Angabe
 * steht genau wie vorher. 🔴 Jede Box, die hier umläuft, ist die AUSGEKLAPPTE - der Einzug sitzt allein im Stil. Sonst verlöre ein
 * eingeklappt verschobenes Fenster beim Ausklappen seine Breite.
 */
const einziehbar = computed(() => props.einzug !== undefined);
const einzug = computed(() => Math.max(0, props.einzug ?? 0));
const ausgeklappt = (box: FensterBox): FensterBox =>
    einzug.value > 0 ? { ...box, left: box.left - einzug.value, width: box.width + einzug.value } : box;
const sichtBox = computed(() => zugBox.value ?? props.box);
/** Die Ecke, in der ein noch nie verschobenes gelöstes Fenster steht (WI-0150); mit Box bleibt sie leer. */
const vorgabeEcke = computed(() => vorgabeEckeKlasse(lage.value, sichtBox.value, props.vorgabeEcke));
/** Das Blatt am Telefon (`telefonBlatt`): nur angedockt, nur am Telefon. */
const blatt = computed(() => props.telefonBlatt === true && phoneViewport.value && lage.value === "angedockt");
/** Ein modales Fenster unten am Telefon (`telefonUnten`). */
const unten = computed(() => props.telefonUnten === true && phoneViewport.value && modal.value);

/**
 * Die Höhe, die das Fenster mit `stabil` hält (WI-0272, Entwurf 8): gemessen, wenn eine Ansicht erscheint, danach unverändert. 🔴 Nur gelöst und nur ohne gezogene Box: Angedockt steht jedes
 * Fenster von oben bis unten, und wer die Größe zieht, bestimmt sie selbst.
 */
const festeHoehe = ref<number | undefined>(undefined);
const haeltHoehe = computed(() => props.stabil === true && props.hoehe === "inhalt" && lage.value === "geloest");
/** Wie viele Takte (`--space-24`) Luft über dem Gemessenen bleiben, für das, was später dazukommt (ein Bezug, ein Hinweis): Ohne sie rollte der Rumpf schon bei der ersten Zeile mehr. */
const LUFT_TAKTE = 2;

/**
 * Die Höhe der Ansicht messen und halten. Gemessen wird die natürliche Höhe des Inhalts (ohne gehaltene Höhe, höchstens bis zum Rand der Karte); bei einem Wechsel der Ansicht mit
 * `ansichtNieHoeher` gilt die Höhe davor als Deckel. Beides geschieht vor dem nächsten Bild: Es gibt keinen Zwischenstand zu sehen.
 */
async function messeHoehe(neueAnsicht: boolean): Promise<void> {
    await nextTick();
    const element = dialog.value;
    if (!haeltHoehe.value || !element?.open || props.eingeklappt === true || props.box !== undefined) return;
    const vorher = element.getBoundingClientRect().height;
    festeHoehe.value = undefined;
    await nextTick();
    const natuerlich = element.getBoundingClientRect().height;
    const takt = Number.parseFloat(getComputedStyle(element).getPropertyValue("--space-24")) || 0;
    festeHoehe.value = stabileHoehe(
        natuerlich,
        LUFT_TAKTE * takt,
        neueAnsicht && props.ansichtNieHoeher === true ? vorher : undefined,
    );
    if (!neueAnsicht) return;
    await nextTick();
    gleiteInHoehe(vorher, element.getBoundingClientRect().height);
}

/** Ein Wechsel der Ansicht gleitet in 240 ms in die neue Höhe, statt zu springen (§29); bei reduzierter Bewegung gar nicht. */
function gleiteInHoehe(von: number, nach: number): void {
    const element = dialog.value;
    if (!element || Math.abs(von - nach) < 1) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    element.animate([{ height: `${String(von)}px` }, { height: `${String(nach)}px` }], {
        duration: 240,
        easing: "ease",
    });
}
watch(
    () => props.ansicht,
    () => {
        // Eine neue Ansicht beginnt oben: Der Rumpf ist derselbe wie in der vorigen und behielte sonst deren Rollstand (die Bestätigung stünde unten, wo das Formular zuletzt stand).
        dialog.value?.querySelector(".avm-fenster__rumpf")?.scrollTo({ top: 0 });
        void messeHoehe(true);
    },
    { flush: "post" },
);

/** Wohin der Fokus nach dem Schließen zurückkehrt: was ihn beim Öffnen hatte. */
let ausloeser: HTMLElement | null = null;

/*
 * 🔴 DER ZUSTAND FÜHRT, NICHT DAS `close`-EREIGNIS. ✕, Escape und der Schleier setzen `offen`, und erst
 * der Zustand schließt das `<dialog>` und gibt den Fokus zurück.
 * 💣 Gemessen am 2026-09-26 in der Browseransicht der Desktop-App: `close` feuerte dort NIE, auch an
 * einem nackten Testdialog nicht. Hinge der Zustand daran, bliebe er nach Escape auf „offen“, und das
 * ⓘ öffnete kein zweites Mal - ohne Fehler, das Fenster war ja zu. `close` bleibt nur der Rückfall
 * für ein Schließen von außen.
 */
watch(
    [offen, lage],
    async ([jetzt, jetztLage]) => {
        // Die Hülle hängt per Teleport an `body`; beim ersten Lauf steht sie erst nach dem Einhängen.
        await nextTick();
        const element = dialog.value;
        if (!element) return;
        if (jetztLage !== "modal") {
            // Nicht modal (WI-0128 E6): kein Fokusfang und kein Fokussprung. Versenkt bleibt das Fenster eingehängt, nur nicht
            // gezeichnet - Entwurf und Auswahl im Inhalt bleiben.
            const zeigen = jetzt && jetztLage !== "versenkt";
            if (element.open && element.matches(":modal")) element.close();
            if (zeigen && !element.open) element.show();
            else if (!zeigen && element.open) element.close();
            if (zeigen) void messeHoehe(false);
            return;
        }
        if (jetzt && element.open && !element.matches(":modal")) {
            // Aus einer Werkzeuglage zurück ins Modale: neu öffnen, damit Schleier und Fokusfang gelten.
            element.close();
            element.showModal();
        } else if (jetzt && !element.open) {
            ausloeser = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            element.showModal();
            schliessKnopf.value?.focus();
        } else if (!jetzt) {
            if (element.open) element.close();
            const ziel = ausloeser;
            ausloeser = null;
            if (ziel?.isConnected) ziel.focus();
        }
    },
    { immediate: true },
);

/*
 * Eingeklappt (WI-0128 E12) gibt das Fenster den Fokus frei: Er stand meist auf dem Knopf, der den Modus startete, und der ist jetzt
 * verborgen. 🪤 Chrome lässt den Fokus auf einem Element, das `display: none` wird; ein Escape ginge dann ins Fenster statt an den Modus.
 */
watch(
    () => props.eingeklappt === true,
    (ein) => {
        const aktiv = document.activeElement;
        if (ein && aktiv instanceof HTMLElement && dialog.value?.contains(aktiv)) aktiv.blur();
    },
    { flush: "post" },
);

/**
 * Escape: die Plattform will schließen - geschlossen wird über den Zustand, damit er stimmt.
 * 🪤 `cancel` steigt auch aus einem Dateifeld auf, dessen Auswahl abgebrochen wurde (OPS-000011): Das gilt nur dem Feld.
 */
function abbrechen(event: Event): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    offen.value = false;
}

/**
 * Von außen geschlossen (`dialog.close()`): der Zustand zieht nach.
 * 💣 Nur wenn das Fenster JETZT zu ist: `close` kommt als eigene Aufgabe nach. Wer mit Escape schließt
 * und sofort Enter drückt, hat es schon wieder geöffnet, wenn das alte `close` eintrifft - ohne diese
 * Prüfung schlösse es das neue Fenster gleich wieder (gemessen im Browsertest).
 */
function geschlossen(): void {
    // Ein Werkzeugfenster schließt die Hülle selbst, auch beim Ablegen; nur ein modales kann von außen geschlossen werden.
    if (modal.value && offen.value && !dialog.value?.open) offen.value = false;
}

/** Escape in einem Werkzeugfenster (das modale bekommt `cancel` von der Plattform): schließen über den Zustand. */
function taste(event: KeyboardEvent): void {
    if (modal.value || event.key !== "Escape" || event.defaultPrevented) return;
    // Eingeklappt läuft ein Modus auf der Karte: Escape bricht ihn ab (Kaskade, Stufe `action`), das Fenster bleibt.
    if (props.eingeklappt) return;
    // Die Leiste eines Modus kann unten im angedockten Fenster stehen (T45 (3)): Escape aus ihr (etwa nach einem Klick auf ↶) gilt dem
    // Modus, nicht dem Fenster. Sonst legte es das Fenster ab, und der Modus endete ohne seine Frage (Prüfbank 19.10., „Ecken bearbeiten“).
    if ((event.target as Element | null)?.closest?.("[data-modusleiste-ziel]")) return;
    event.preventDefault();
    // Eine Mehrfachauswahl geht vor dem Fenster (WI-0252, `fenster-esc.ts`): erst sie aufheben, dann erst schließen.
    if (escVorher?.() === true) return;
    offen.value = false;
}
const escVorher = inject(FENSTER_ESC_VORHER, undefined);

// --- Werkzeugfenster: lösen, verschieben, Größe ändern, ablegen (WI-0128 E6) ---

/** Bedienelemente im Kopf bleiben Bedienelemente (wie `fenster-ziehen.ts`). */
const NICHT_ZIEHEN = "button, a, input, select, textarea, summary, [role='button'], [contenteditable='true']";

/** Das Rechteck des Elternteils, in dem ein Werkzeugfenster steht (der rechte Slot der Karte). */
function eltern(): DOMRect {
    const element = dialog.value?.offsetParent ?? document.body;
    return element.getBoundingClientRect();
}

/**
 * Die Box, wie das Fenster gerade steht, in den Koordinaten des Elternteils - und zwar die AUSGEKLAPPTE: Ein eingezogenes Fenster
 * misst sich schmaler, als es gemerkt gehört (WI-0128 P1).
 */
function jetzigeBox(): FensterBox | undefined {
    const element = dialog.value;
    return element ? ausgeklappt(boxIn(element.getBoundingClientRect(), eltern())) : undefined;
}

/** Die Mindestgröße dieses Fensters: die des Hauses, sofern der Inhalt nicht kleiner ist (`mindestHoehe`). */
const mindest = (): { width: number; height: number } => ({
    width: MINDEST.width,
    height: props.mindestHoehe ?? MINDEST.height,
});

/** So nah am rechten Rand seines Elternteils (in Pixeln) dockt ein gezogenes Fenster an; die Laschen dort sind 30 px breit. */
const ANDOCKEN_RAND = 40;

/** Das Ablageziel, über dem der Zeiger liegt („Offene Bearbeitungen“), sonst `undefined`. */
function ablageUnter(event: PointerEvent): Element | undefined {
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
        if (dialog.value?.contains(element)) continue;
        const ziel = element.closest("[data-fenster-ablage]");
        if (ziel !== null) return ziel;
    }
    return undefined;
}

/**
 * Das Ablageziel ins Bild, sobald ein Zug am Kopf läuft: Seit den Kacheln in „Karteninhalte“ (WI-0212) steht „Offene Bearbeitungen“ bei
 * 1280 × 720 unter dem sichtbaren Teil des Editorpanels, und kein Zeiger erreichte es (`ortseditor.spec.ts` T6.2, gemessen y 701–785 bei
 * 708 px Panelende). Nur wo es nicht schon ganz zu sehen ist (`nearest`).
 */
function ablageInsBild(): void {
    for (const ziel of document.querySelectorAll<HTMLElement>("[data-fenster-ablage]"))
        ziel.scrollIntoView?.({ block: "nearest" });
}

/** Das Ablageziel, das gerade leuchtet. */
let leuchtet: Element | undefined;
function leuchte(ziel: Element | undefined): void {
    if (leuchtet === ziel) return;
    leuchtet?.removeAttribute("data-fenster-ziel");
    leuchtet = ziel;
    leuchtet?.setAttribute("data-fenster-ziel", "");
}

/** Wohin der Zug am Kopf gerade führt: Ein Ablageziel geht vor, sonst der rechte Rand. */
function zielUnter(event: PointerEvent): "andocken" | "ablegen" | undefined {
    const ablage = props.ohneAblage ? undefined : ablageUnter(event);
    leuchte(ablage);
    if (ablage !== undefined) return "ablegen";
    return event.clientX >= eltern().right - ANDOCKEN_RAND ? "andocken" : undefined;
}

let zug: {
    zeiger: number;
    x: number;
    y: number;
    start: FensterBox;
    art: "kopf" | "ecke";
    geloest: boolean;
    /** Ist das Ablageziel in diesem Zug schon ins Bild geholt? */
    ablage?: boolean;
} | null = null;

function zugBeginn(event: PointerEvent, art: "kopf" | "ecke"): void {
    const start = jetzigeBox();
    if (!start || event.button !== 0) return;
    zug = {
        zeiger: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start,
        art,
        geloest: lage.value === "geloest",
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    // 🪤 Ohne das beginnt der Browser eine Textauswahl und bricht den Zeiger ab (`pointercancel`, gemessen 2026-10-10), wie in
    // `fenster-ziehen.ts`: „Ohne das markiert das Ziehen den Titel.“
    event.preventDefault();
}

function kopfDruck(event: PointerEvent): void {
    if (modal.value) {
        ziehen.onPointerDown(event);
        return;
    }
    emit("vorn");
    if ((event.target as Element).closest(NICHT_ZIEHEN)) return;
    zugBeginn(event, "kopf");
}

function eckeDruck(event: PointerEvent): void {
    event.stopPropagation();
    emit("vorn");
    zugBeginn(event, "ecke");
}

function zugBewegung(event: PointerEvent): void {
    if (!zug || event.pointerId !== zug.zeiger) return;
    const dx = event.clientX - zug.x;
    const dy = event.clientY - zug.y;
    if (!zug.geloest) {
        // 🔴 Ein angedocktes Fenster löst sich erst ab 6 px Zug (EDIT-0001 §7.1 T6.1).
        if (!loestSich(dx, dy)) return;
        zug.geloest = true;
        emit("update:lage", "geloest", zug.start);
    }
    if (zug.art === "kopf" && zug.ablage !== true) {
        zug.ablage = true;
        if (!props.ohneAblage) ablageInsBild();
    }
    const bild = eltern();
    zugZiel.value = zug.art === "kopf" ? zielUnter(event) : undefined;
    zugBox.value =
        zug.art === "kopf"
            ? begrenzeBox({ ...zug.start, left: zug.start.left + dx, top: zug.start.top + dy }, bild, mindest())
            : begrenzeBox(
                  { ...zug.start, width: zug.start.width + dx, height: zug.start.height + dy },
                  bild,
                  mindest(),
              );
}

function zugEnde(event: PointerEvent): void {
    if (!zug || event.pointerId !== zug.zeiger) return;
    const box = zugBox.value;
    const art = zug.art;
    zug = null;
    const ziel = art === "kopf" && box !== undefined ? zielUnter(event) : undefined;
    leuchte(undefined);
    zugZiel.value = undefined;
    if (box === undefined) return;
    // Losgelassen über „Offene Bearbeitungen“: abgelegt (EDIT-0001 §7.1 T6.2). Die Box gilt, wenn es wieder hervorkommt.
    if (ziel === "ablegen") emit("update:lage", "versenkt", box);
    // Am rechten Rand: angedockt; die Box vor dem Zug bleibt die des gelösten Fensters.
    else if (ziel === "andocken") emit("update:lage", "angedockt");
    else emit("update:box", box);
    zugBox.value = undefined;
}

/** ⧉: Ein angedocktes Fenster löst sich an Ort und Stelle, ein wenig nach links versetzt, damit man es sieht. */
function loesen(): void {
    const box = jetzigeBox();
    emit(
        "update:lage",
        "geloest",
        box
            ? begrenzeBox(
                  { ...box, left: box.left - box.width / 8, top: box.top + box.height / 16 },
                  eltern(),
                  mindest(),
              )
            : undefined,
    );
}

/**
 * Ein Lagenwechsel fliegt als Platzhalter von der alten an die neue Stelle (240 ms, §29; EDIT-0001 §7.1 T6.6), bei reduzierter
 * Bewegung gar nicht. Gemessen wird vor dem Wechsel (`flush: "pre"`) und ein Bild danach.
 */
watch(
    lage,
    (neu, alt) => {
        if (neu === "modal" || alt === "modal" || alt === undefined) return;
        const element = dialog.value;
        const von =
            alt === "versenkt" ? props.ablageZiel?.() : element?.open ? element.getBoundingClientRect() : undefined;
        void nextTick(() =>
            requestAnimationFrame(() => {
                const nach = neu === "versenkt" ? props.ablageZiel?.() : dialog.value?.getBoundingClientRect();
                if (von && nach) fliege(von, nach);
            }),
        );
    },
    { flush: "pre" },
);

function fliege(von: DOMRect, nach: DOMRect): void {
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rahmen = (r: DOMRect): Keyframe => ({
        left: `${String(r.left)}px`,
        top: `${String(r.top)}px`,
        width: `${String(r.width)}px`,
        height: `${String(r.height)}px`,
    });
    const platz = document.createElement("div");
    platz.dataset["testid"] = "fenster-platzhalter";
    Object.assign(platz.style, {
        position: "fixed",
        zIndex: "var(--z-map-menu)",
        boxSizing: "border-box",
        border: "1px dashed var(--color-accent)",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-hover-wash)",
        pointerEvents: "none",
        ...rahmen(nach),
    });
    document.body.append(platz);
    const flug = platz.animate([rahmen(von), rahmen(nach)], { duration: 240, easing: "ease" });
    const weg = (): void => platz.remove();
    flug.addEventListener("finish", weg);
    flug.addEventListener("cancel", weg);
}

// --- Klick auf den Schleier: Druck UND Loslassen außerhalb des Fensters ---

let druckDraussen = false;
let losDraussen = false;

/** Der Schleier gehört zum `<dialog>` selbst: getroffen ist er, wenn der Zeiger außerhalb der Box liegt. */
function aufSchleier(event: MouseEvent): boolean {
    const element = dialog.value;
    if (!element || event.target !== element || event.button !== 0) return false;
    const box = element.getBoundingClientRect();
    return (
        event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
    );
}

function druck(event: PointerEvent): void {
    if (!modal.value) {
        // Ein Werkzeugfenster hat keinen Schleier; wer es berührt, holt es nach vorn.
        emit("vorn");
        return;
    }
    druckDraussen = aufSchleier(event);
    losDraussen = false;
}

function los(event: PointerEvent): void {
    losDraussen = aufSchleier(event);
}

/**
 * Der Hinweis im Fuß kürzt mit „…“, wenn es eng wird (WI-0183); den vollen Text zeigt dann der title beim Überfahren. Gekürzt ist nur das
 * Bild: Vorleser lesen den ganzen Text, er steht unverändert im DOM.
 */
function ganzerHinweis(event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement;
    if (el.scrollWidth > el.clientWidth) el.title = el.textContent?.trim() ?? "";
    else el.removeAttribute("title");
}

function klick(event: MouseEvent): void {
    if (druckDraussen && losDraussen && aufSchleier(event)) offen.value = false;
    druckDraussen = false;
    losDraussen = false;
}
</script>

<template>
    <Teleport to="body" :disabled="!modal">
        <dialog
            ref="dialog"
            class="avm-fenster"
            :class="[
                `avm-fenster--${props.bauart}`,
                {
                    'avm-fenster--reiter': slots.reiter || slots.schiene || spalten,
                    'avm-fenster--schiene': schieneSeitlich,
                    [`avm-fenster--${lage}`]: !modal,
                    'avm-fenster--eingeklappt': props.eingeklappt === true && !modal,
                    'avm-fenster--inhalt': props.hoehe === 'inhalt' && !modal,
                    'avm-fenster--hoeher': props.hoeher === true,
                    'avm-fenster--einzug': einziehbar && !modal,
                    'avm-fenster--blatt': blatt,
                    'avm-fenster--unten': unten,
                },
                vorgabeEcke,
            ]"
            :aria-labelledby="titelId"
            :style="{
                '--fenster-breite': `var(--avm-fenster-${props.breite})`,
                ...(einziehbar && !modal ? { '--avm-fenster-einzug': `${String(einzug)}px` } : {}),
                ...(haeltHoehe && festeHoehe !== undefined && !sichtBox && !props.eingeklappt
                    ? { height: `${String(festeHoehe)}px` }
                    : {}),
                ...(lage === 'geloest' && sichtBox
                    ? {
                          // Eingezogen hängt das Fenster an seiner RECHTEN Kante: Nur so steht sie auch während der Bewegung
                          // pixelgenau still, statt aus zwei Übergängen (links und Breite) neu gerechnet zu werden.
                          ...(einziehbar
                              ? { left: 'auto', right: `calc(100% - ${String(sichtBox.left + sichtBox.width)}px)` }
                              : { left: `${String(sichtBox.left)}px` }),
                          top: `${String(sichtBox.top)}px`,
                          width: einziehbar
                              ? `calc(${String(sichtBox.width)}px - var(--avm-fenster-einzug))`
                              : `${String(sichtBox.width)}px`,
                          ...(props.eingeklappt ? {} : { height: `${String(sichtBox.height)}px` }),
                      }
                    : {}),
            }"
            :data-map-overlay="lage === 'angedockt' && !props.eingeklappt ? (blatt ? 'bottom' : 'right') : undefined"
            :data-lage="modal ? undefined : lage"
            :data-testid="props.testid"
            @cancel="abbrechen"
            @close="geschlossen"
            @keydown="taste"
            @pointerdown="druck"
            @pointerup="los"
            @click="klick"
        >
            <header
                ref="kopf"
                class="avm-fenster__kopf"
                :class="{ 'avm-fenster__kopf--gross': props.unterzeile !== undefined }"
                @pointerdown="kopfDruck"
                @pointermove="zugBewegung"
                @pointerup="zugEnde"
                @pointercancel="zugEnde"
                @dblclick="modal ? ziehen.onDoubleClick($event) : undefined"
            >
                <span class="avm-fenster__griff" aria-hidden="true">⁝⁝</span>
                <span v-if="props.zeichen === 'info'" class="avm-fenster__zeichen"><InfoZeichen /></span>
                <div v-if="props.unterzeile !== undefined" class="avm-fenster__kopftext">
                    <h2 :id="titelId" class="avm-fenster__titel einzeilig">{{ props.titel }}</h2>
                    <p class="avm-fenster__unterzeile" data-testid="fenster-unterzeile">{{ props.unterzeile }}</p>
                </div>
                <h2 v-else :id="titelId" class="avm-fenster__titel einzeilig">{{ props.titel }}</h2>
                <span v-if="props.zusatz" class="avm-fenster__zusatz einzeilig">{{ props.zusatz }}</span>
                <div v-if="slots.kopffeld" class="avm-fenster__kopffeld"><slot name="kopffeld" /></div>
                <template v-if="!modal">
                    <!-- Das Blatt am Telefon (`telefonBlatt`) lässt sich nicht lösen: Es gibt dort nur diese Lage, ein ⧉ täte nichts. -->
                    <button
                        v-if="lage === 'angedockt' && !blatt"
                        type="button"
                        class="avm-fenster__knopf avm-fenster__knopf--gefasst"
                        :aria-label="t('fenster.loesen')"
                        :title="t('fenster.loesen')"
                        data-testid="fenster-loesen"
                        @click="loesen"
                    >
                        ⧉
                    </button>
                    <button
                        v-else-if="lage === 'geloest'"
                        type="button"
                        class="avm-fenster__knopf avm-fenster__knopf--gefasst"
                        :aria-label="t('fenster.andocken')"
                        :title="t('fenster.andocken')"
                        data-testid="fenster-andocken"
                        @click="emit('update:lage', 'angedockt')"
                    >
                        ▥
                    </button>
                    <button
                        v-if="!props.ohneAblage"
                        type="button"
                        class="avm-fenster__knopf avm-fenster__knopf--gefasst"
                        :aria-label="t('fenster.ablegen')"
                        :title="t('fenster.ablegen')"
                        data-testid="fenster-ablegen"
                        @click="emit('update:lage', 'versenkt')"
                    >
                        −
                    </button>
                </template>
                <button
                    ref="schliessKnopf"
                    type="button"
                    class="avm-fenster__knopf"
                    :class="props.bauart === 'blatt' ? 'avm-fenster__knopf--nackt' : 'avm-fenster__knopf--gefasst'"
                    :aria-label="t('fenster.close')"
                    data-testid="fenster-schliessen"
                    @click="offen = false"
                >
                    ✕
                </button>
            </header>
            <div
                v-if="props.eingeklappt && slots.eingeklappt"
                class="avm-fenster__eingeklappt"
                role="status"
                data-testid="fenster-eingeklappt"
            >
                <slot name="eingeklappt" />
            </div>
            <div v-if="slots.reiter" v-show="!props.eingeklappt" class="avm-fenster__reiter">
                <slot name="reiter" />
            </div>
            <div v-if="schieneSeitlich" v-show="!props.eingeklappt" class="avm-fenster__mitte">
                <div class="avm-fenster__schiene" data-testid="fenster-schiene">
                    <slot name="schiene" :telefon="false" />
                </div>
                <div class="avm-fenster__spalte">
                    <div v-if="slots.leiste" class="avm-fenster__leiste" data-testid="fenster-leiste">
                        <slot name="leiste" />
                    </div>
                    <div
                        class="avm-fenster__rumpf"
                        :class="{
                            'avm-fenster__rumpf--spalten': spalten,
                            'avm-fenster__rumpf--buendig': props.rumpfBuendig,
                        }"
                        data-testid="fenster-rumpf"
                    >
                        <slot />
                    </div>
                </div>
            </div>
            <template v-else>
                <div
                    v-if="slots.leiste || schieneInLeiste"
                    v-show="!props.eingeklappt"
                    class="avm-fenster__leiste"
                    :class="{ 'avm-fenster__leiste--schiene': schieneInLeiste }"
                    data-testid="fenster-leiste"
                >
                    <slot v-if="schieneInLeiste" name="schiene" :telefon="true" />
                    <slot name="leiste" />
                </div>
                <div
                    v-show="!props.eingeklappt"
                    class="avm-fenster__rumpf"
                    :class="{
                        'avm-fenster__rumpf--spalten': spalten,
                        'avm-fenster__rumpf--buendig': props.rumpfBuendig,
                    }"
                    data-testid="fenster-rumpf"
                >
                    <slot />
                </div>
            </template>
            <!-- Die Leiste eines Modus, wenn neben Planer und angedocktem Fenster keine Lücke bleibt (EDIT-0003 T45 (3)): dieselbe Leiste,
                 hierher geholt (`fenster-modusleiste.vue`); ohne Inhalt nimmt der Platz nichts ein. -->
            <div v-show="!props.eingeklappt" class="avm-fenster__modus" data-modusleiste-ziel></div>
            <footer
                v-if="slots.fuss || slots['fuss-hinweis'] || slots['fuss-haupt']"
                v-show="!props.eingeklappt"
                class="avm-fenster__fuss"
                :class="{ 'avm-fenster__fuss--telefon': phoneViewport, 'avm-fenster__fuss--frei': Boolean(slots.fuss) }"
            >
                <slot v-if="slots.fuss" name="fuss" />
                <span
                    v-else-if="slots['fuss-hinweis']"
                    class="avm-fenster__fuss-hinweis"
                    :class="{ einzeilig: !phoneViewport }"
                    data-testid="fenster-fuss-hinweis"
                    @pointerenter="ganzerHinweis"
                    ><slot name="fuss-hinweis"
                /></span>
                <span v-if="!slots.fuss && slots['fuss-haupt']" class="avm-fenster__fuss-haupt"
                    ><slot name="fuss-haupt"
                /></span>
            </footer>
            <span
                v-if="lage === 'geloest' && !props.eingeklappt"
                class="avm-fenster__ecke"
                aria-hidden="true"
                data-testid="fenster-ecke"
                @pointerdown="eckeDruck"
                @pointermove="zugBewegung"
                @pointerup="zugEnde"
                @pointercancel="zugEnde"
            ></span>
        </dialog>
        <!-- Wo das Fenster angedockt stünde, solange der Zug am Kopf am rechten Rand ist (Betreiber 2026-10-11). -->
        <div
            v-if="zugZiel === 'andocken' && !modal"
            class="avm-fenster__andockziel"
            :style="{ '--fenster-breite': `var(--avm-fenster-${props.breite})` }"
            aria-hidden="true"
            data-testid="fenster-andockziel"
        ></div>
    </Teleport>
</template>

<style>
/*
 * 🔴 Eine REGISTRIERTE Eigenschaft, damit der Einzug der linken Fensterkante als Länge überblendet (WI-0128 P1): Eine gewöhnliche
 * Variable springt, und die Trennlinie zwischen Liste und Eigenschaften wanderte während der Bewegung. Sie steht hier und nicht in
 * `styles/canon.css`, weil das Blatt erzeugt wird (Quelle `config/design-canon/avesmaps.json`) und keine Regeln trägt; und sie
 * steht ungescoped, weil `@property` eine Anmeldung am Dokument ist, keine Auswahl.
 */
@property --avm-fenster-einzug {
    syntax: "<length>";
    inherits: true;
    initial-value: 0px;
}
</style>

<style scoped>
/*
 * Jeder Wert kommt aus dem Designkanon. Die Maße sind Legacys `css/components/fenster.css`
 * (Vertrag vom 04.09.2026) - mit einer Entscheidung aus Guide §12.6: der Rumpf trägt 8 / 14.
 */

/* §12.1: die Hülle. Sie polstert nicht; nur ihre Zonen tun es. */
.avm-fenster {
    box-sizing: border-box;
    width: min(var(--fenster-breite), 100% - 2 * var(--space-12));
    max-width: none;
    max-height: calc(100dvh - 2 * var(--space-24));
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-dialog);
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

/*
 * Ein Fenster mit stehenden Reitern oder einer Schiene hat eine feste Höhe, das Format eines Blattes (Breite : Höhe = √2 : 1;
 * Mockup der Verwaltung 1040 × 740): Sonst wüchse und schrumpfte es mit jedem Reiter, und die Mitte des Bildschirms rückte es
 * jedes Mal woandershin.
 */
.avm-fenster--reiter {
    height: min(calc(100dvh - 2 * var(--space-24)), calc(var(--fenster-breite) / 1.4142));
}

/*
 * Mehr Zeilen der Schiene (`hoeher`): gemessen fehlten der Systemsteuerung 28 px (Betreiber 2026-11-03), mit dem Eintrag
 * „Wettermodell“ (WI-0288) beim Betreiber weitere 31 px (Betreiber 2026-11-08: „fenster höher“); 5 px Luft. Steht vor den Lagen,
 * angedockt bleibt das Fenster voll hoch.
 */
.avm-fenster--reiter.avm-fenster--hoeher {
    height: min(
        calc(100dvh - 2 * var(--space-24)),
        calc(var(--fenster-breite) / 1.4142 + 2 * var(--space-24) + var(--space-12))
    );
}

/*
 * 🔴 Die Schiene kommt ZUR benannten Breite dazu, sie nimmt sie nicht dem Rumpf (WI-0127, gemessen 2026-10-10): Die Personentafel der
 * Verwaltung braucht 954 px, der Grund für `verwaltung` 1040 („sechs Spalten nebeneinander“, Kanon); aus dem Rumpf genommen blieben
 * ihr 781, und die Handlungen jeder Person lägen hinter einer waagerechten Rolle. Die Höhe bleibt die der benannten Breite.
 */
.avm-fenster--schiene {
    width: min(var(--fenster-breite) + var(--avm-fenster-schiene), 100% - 2 * var(--space-12));
}

/* 🪤 `display` nur im offenen Zustand: sonst hebt die Regel das `display: none` des geschlossenen Dialogs auf. */
.avm-fenster[open] {
    display: flex;
    flex-direction: column;
}

.avm-fenster--werkzeug {
    border-color: var(--color-border-strong);
    border-radius: var(--radius-sm);
}

/*
 * Werkzeugfenster (WI-0128 E6, EDIT-0001 §4.1): nicht modal, im rechten Slot der Karte statt in der obersten Ebene. Sie stehen über
 * dem Editorpanel und unter den Menüs der Karte (`--z-map-menu`), damit ein Menü oder ein Filterblatt nicht unter ihnen aufgeht.
 * Der Schatten ist der eines Panels, nicht der eines Fensters über dem Schleier.
 */
.avm-fenster.avm-fenster--angedockt,
.avm-fenster.avm-fenster--geloest {
    position: absolute;
    z-index: var(--z-map-panel);
    margin: 0;
    max-height: none;
    box-shadow: var(--shadow-panel);
}

/* Angedockt: am rechten Rand wie das Infopanel, bündig von oben bis unten ohne Rundung (Betreiber 2026-10-31), volle Höhe. */
.avm-fenster.avm-fenster--angedockt {
    top: 0;
    right: 0;
    /* Endet über der Leiste der Reisebilder, wenn sie offen ist (WI-0272 S4); das Blatt am Telefon setzt `bottom` unten selbst. */
    bottom: var(--avm-reisebilder-leiste, 0px);
    left: auto;
    width: min(var(--fenster-breite), 100% - var(--avesmaps-tab-w));
    height: auto;
    border-radius: 0;
}

/*
 * Das Blatt am Telefon (`telefonBlatt`, WI-0272 S2b): angedockt, aber unten, über die volle Breite und nur so hoch wie der Inhalt, höchstens 58 % der Karte (die Probierseite nimmt den
 * Rand bis 48 px unter dem oberen). 🔴 Darüber bliebe weniger als `MIN_VISIBLE_SHARE` (40 %) frei, und die Kamera zielte auf die ganze Karte, also unter das Blatt
 * (`visible-area.ts`); mit 58 % hat sie ein Ziel, und der Rumpf rollt. Die Rundung oben, keine Kante an den Seiten und unten. Eingeklappt (Modus auf der Karte) bleibt es unten stehen und schrumpft auf Kopf und Moduszeile.
 */
.avm-fenster.avm-fenster--angedockt.avm-fenster--blatt {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    height: auto;
    max-height: 58%;
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

/*
 * Ein modales Fenster unten am Telefon (`telefonUnten`, WI-0306): über die volle Breite am unteren Rand, oben gerundet, keine Kante an den
 * Seiten und unten. Die Höhe bleibt die der Bauart (mit Reitern oder Spalten höchstens bis 2 Takte unter den oberen Rand).
 */
.avm-fenster.avm-fenster--unten {
    width: 100%;
    margin: auto 0 0;
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

/*
 * Die linke Kante einzieht (WI-0128 P1, Betreiber 2026-10-13): Angedockt hängt das Fenster ohnehin an `right: 0`, eine kleinere
 * Breite bewegt also NUR die linke Kante. Gelöst hängt es dafür am `right` seiner Box (siehe `style`). Überblendet wird allein
 * `--avm-fenster-einzug`; Fensterbreite und Listenbreite lesen dieselbe Zahl, darum steht die Trennlinie auch WÄHREND der
 * Bewegung still (zwei getrennte Übergänge liefen um Bruchteile auseinander).
 */
.avm-fenster--einzug {
    transition: --avm-fenster-einzug 220ms ease;
}

.avm-fenster.avm-fenster--angedockt.avm-fenster--einzug {
    width: min(calc(var(--fenster-breite) - var(--avm-fenster-einzug)), 100% - var(--avesmaps-tab-w));
}

/*
 * Eingeklappt (WI-0128 E12): so hoch wie Kopf und Modusleiste, angedockt oben am Rand. Die Höhe eines Fensters mit Reitern oder
 * Spalten gilt dann nicht.
 */
.avm-fenster.avm-fenster--eingeklappt {
    bottom: auto;
    height: auto;
}

/*
 * Nur so hoch wie der Inhalt (WI-0268 C2, `hoehe="inhalt"`; Betreiber 2026-10-31: „die fenster / popups nur die höhe haben, die sie benötigen - nicht die volle höhe des
 * editors, es sei denn du entfernst den spalt ganz“) gilt nur GELÖST: Der Rumpf rollt, Kopf und Fuß stehen (`min-height: 0` am Rumpf), die Grenze hält es im Bild.
 * 🔴 Angedockt steht jedes Fenster von oben bis unten und ohne Spalt am Panel (Betreiber 2026-10-31: „kannst du die ganzen popups / nachrichtenfenster etc. vollständig
 * von oben nach unten gehen lassen und ohne spalt an den das editor-panel andocken“); darum gibt es keine Regel für `--angedockt.--inhalt`.
 */
.avm-fenster.avm-fenster--geloest.avm-fenster--inhalt {
    max-height: calc(100% - 2 * var(--space-10));
}

.avm-fenster__eingeklappt {
    flex: none;
    padding: var(--avm-kopf-pad);
}

/* Gelöst: Lage und Größe trägt die Box (`style`); deckend auch beim Verschieben (T6.7). */
.avm-fenster.avm-fenster--geloest {
    right: auto;
    bottom: auto;
}

/*
 * Die Vorgabe-Ecke (WI-0150, Kanal OPS-000002): Ein gelöstes Fenster ohne gemerkte Box steht links unten über der Karte,
 * im Abstand der Kartenränder (wie das angedockte Fenster unten). 🔴 Nur ohne Box - `vorgabeEckeKlasse` setzt die Klasse
 * gar nicht, sobald eine Box dasteht, und die trägt dann `left`/`top` im `style`.
 */
.avm-fenster.avm-fenster--geloest.avm-fenster--links-unten {
    top: auto;
    bottom: var(--space-10);
    left: var(--space-10);
}

/*
 * Die Vorgabe „mitte“ (die Fenster der Besucher, Betreiber 2026-10-31): mittig über der Karte, solange keine Box gemerkt ist. Wer zieht, bekommt eine Box
 * aus der Lage auf dem Bildschirm, und die Klasse fällt weg. `translate` statt `transform`, damit keine Bewegung der Hülle überschrieben wird.
 */
.avm-fenster.avm-fenster--geloest.avm-fenster--mitte {
    top: 50%;
    left: 50%;
    translate: -50% -50%;
}

/*
 * Die Vorgabe `oben-mitte` (Reisebilder, WI-0272 Entwurf 8): oben in der Mitte, im Abstand der Kartenränder, solange ein Modus auf der Karte läuft („Stelle ändern“) und das Fenster auf seinen
 * schmalen Balken eingeklappt ist; so bleibt die Mitte der Karte zum Tippen frei. Wie die anderen Vorgaben nur ohne Box; wer zieht, bekommt eine.
 */
.avm-fenster.avm-fenster--geloest.avm-fenster--oben-mitte {
    top: var(--space-10);
    left: 50%;
    translate: -50% 0;
}

/*
 * Die Vorschau „hier dockt es an“: dieselbe Fläche wie `--angedockt`, unter dem gezogenen Fenster, als gestrichelte Kante auf einem
 * Hauch Akzent - sie zeigt, sie deckt nicht.
 */
.avm-fenster__andockziel {
    position: absolute;
    z-index: var(--z-map-panel);
    top: 0;
    right: 0;
    bottom: 0;
    width: min(var(--fenster-breite), 100% - var(--avesmaps-tab-w));
    box-sizing: border-box;
    border: 2px dashed var(--color-accent);
    border-right: 0;
    border-radius: 0;
    background: var(--color-hover-wash);
    pointer-events: none;
}

/* Die Ecke zum Ziehen der Größe, unten rechts. */
.avm-fenster__ecke {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--space-12);
    height: var(--space-12);
    border-right: 2px solid var(--color-border-strong);
    border-bottom: 2px solid var(--color-border-strong);
    border-radius: 0 0 var(--radius-sm) 0;
    cursor: nwse-resize;
    touch-action: none;
}

/* §12.4: der Schleier hinter einem mittigen Fenster, in beiden Themen gleich. */
.avm-fenster::backdrop {
    background: var(--color-scrim-dialog);
}

/* §12.2: der Kopf. Polster 6 / 14, Trennlinie durchgehend - der Titel bekommt keine eigene. */
.avm-fenster__kopf {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    padding: var(--avm-kopf-pad);
    border-bottom: 1px solid var(--color-divider);
    cursor: grab;
    user-select: none;
}

/*
 * Der großzügige Kopf (`unterzeile`, WI-0272 Entwurf 8): Titel 20 px mit einer Zeile darunter, Griff und ✕ oben, mehr Luft ringsum. Dieselbe Hülle, nur mit dem Ton einer Einladung.
 */
.avm-fenster__kopf--gross {
    align-items: flex-start;
    gap: var(--space-8);
    padding: var(--space-12);
}

.avm-fenster__kopf--gross .avm-fenster__griff {
    margin-top: var(--space-2);
}

.avm-fenster__kopftext {
    display: grid;
    flex: 1 1 auto;
    gap: var(--space-2);
    min-width: 0;
}

.avm-fenster__kopftext .avm-fenster__titel {
    font-size: var(--font-size-title);
}

.avm-fenster__unterzeile {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

/* 💣 Kein negatives `letter-spacing`: bei ⁝⁝ fräße es den Zwischenraum, und der Griff läse sich als Doppelpunkt. */
.avm-fenster__griff {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-subhead);
    line-height: 1;
}

.avm-fenster__zeichen {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    color: var(--color-accent-strong);
}

/* EINE Titelgröße für beide Bauarten (Legacy C2); das Gewicht wirkt nur in der Rückfallschrift (§3). */
.avm-fenster__titel {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-weight: var(--font-weight-bold);
    line-height: var(--leading-tight);
}

/*
 * Der Zusatz steht NEBEN dem Titel („Kartensammlung von Gareth (12)“), nicht am anderen Ende der Leiste: Wo einer da ist, gibt der Titel das
 * Füllen auf, und der Zusatz nimmt es auf sich (WI-0118; vorher nutzte ihn kein Fenster).
 */
.avm-fenster__titel:has(+ .avm-fenster__zusatz) {
    flex: 0 1 auto;
}

.avm-fenster__zusatz {
    flex: 0 1 auto;
    min-width: 0;
    margin-right: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

/* Das Kopffeld hält die Bedienhöhe und zieht die Leiste damit nicht auf (Legacy). */
.avm-fenster__kopffeld {
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
}

.avm-fenster__kopffeld :slotted(input),
.avm-fenster__kopffeld :slotted(select) {
    box-sizing: border-box;
    min-width: 0;
    min-height: var(--avm-control-h);
    padding: 0 var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-small);
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.avm-fenster__kopffeld :slotted(input:hover),
.avm-fenster__kopffeld :slotted(select:hover) {
    border-color: var(--color-border-strong);
}

.avm-fenster__kopffeld :slotted(input:focus-visible),
.avm-fenster__kopffeld :slotted(select:focus-visible) {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* §12.3: der Schließknopf, 32 × 32 in beiden Bauarten, Radius 8 auch nackt - für Hover und Fokus. */
.avm-fenster__knopf {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    padding: 0;
    border-radius: var(--radius-md);
    cursor: pointer;
    font: inherit;
    line-height: 1;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.avm-fenster__knopf--nackt {
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
    font-size: var(--font-size-subhead);
}

.avm-fenster__knopf--nackt:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.avm-fenster__knopf--nackt:active {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.avm-fenster__knopf--gefasst {
    border: 1px solid var(--color-button-soft-border);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    font-size: var(--font-size-body);
}

.avm-fenster__knopf--gefasst:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.avm-fenster__knopf--gefasst:active {
    background: var(--color-button-soft-active);
}

/* §30.3: der Fokusring, komponiert - der Knopf hat keinen eigenen Schatten, den er verlöre. */
.avm-fenster__knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * §12.2: die Reiter - seitlich das Polster des Kopfes, die Linie unten über die ganze Breite. Die Leiste trägt die Linie selbst, in
 * der Farbe der Trennlinien des Fensters: Sonst lägen zwei Linien übereinander, und die goldene Kante des gewählten Reiters stünde
 * nicht auf der Linie des Fensters. Das Polster steht in der Leiste, damit sie über die ganze Breite rollt (Guide §9, WI-0256).
 */
.avm-fenster__reiter {
    flex: none;
}

.avm-fenster__reiter :slotted(.fenster-reiter) {
    --fenster-reiter-linie: var(--color-divider);
    padding-inline: var(--space-12);
}

/*
 * §12.2: die Leiste - dasselbe Polster und dieselbe Linie wie der Kopf, die Linie unten. Sie steht, nur der Rumpf rollt. 💣 Auf einem
 * schmalen Schirm bricht eine Filterleiste in viele Zeilen um und fräße das Fenster: Sie rollt dann in sich, statt die Liste zu verdrängen.
 */
.avm-fenster__leiste {
    flex: none;
    max-height: 40dvh;
    overflow: auto;
    padding: var(--avm-kopf-pad);
    border-bottom: 1px solid var(--color-divider);
    scrollbar-width: thin;
}

/*
 * Die Schiene (Guide §13.12, WI-0127): links neben Leiste und Rumpf, auf der weichen Fläche, eine Haarlinie zum Rumpf. Sie steht
 * und rollt in sich, wenn ihre Einträge länger sind als das Fenster; ihren Inhalt polstert `FensterSchiene` selbst.
 */
.avm-fenster__mitte {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
}

.avm-fenster__schiene {
    flex: none;
    width: var(--avm-fenster-schiene);
    overflow: auto;
    overscroll-behavior: contain;
    border-right: 1px solid var(--color-divider);
    background: var(--color-panel-soft);
    scrollbar-width: thin;
}

.avm-fenster__spalte {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}

/* Am Telefon steht die Schiene als Auswahl über dem Filter der Ansicht, im Takt der Leiste. */
.avm-fenster__leiste--schiene {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

/*
 * §12.2: der Rumpf - er allein rollt. Polster 8 / 14 (Guide §12.6: die eine senkrechte Kante bei 14,
 * Legacys Owner-Regel vom 05.09.2026), ein Takt zwischen den Blöcken: `--divider-gap`, derselbe wie
 * über und unter einer Trennlinie.
 */
.avm-fenster__rumpf {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--divider-gap);
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: var(--space-6) var(--space-12);
    scrollbar-width: thin;
}

.avm-fenster__rumpf--buendig {
    padding-top: 0;
}

/* 💣 `min-height: 0` oben ist tragend: ohne ihn wüchse der Rumpf über das Fenster und die Hülle rollte. */
.avm-fenster__rumpf:not(.avm-fenster__rumpf--spalten) > :slotted(*) {
    flex: none;
    margin-block: 0;
}

/*
 * Der Rumpf aus Spalten (WI-0068 P3): Er polstert nicht und rollt nicht; die Spalten stehen nebeneinander und rollen jede für sich
 * (`FensterSpalte`, dort auch die Breiten und die Haarlinie). Am Telefon steht nur eine Spalte da, die das Fenster wählt (Drill-down).
 */
.avm-fenster__rumpf--spalten {
    flex-direction: row;
    gap: 0;
    overflow: hidden;
    padding: 0;
}

/*
 * §12.2: der Fuß - dasselbe Polster und dieselbe Linie wie der Kopf, nur auf der anderen Seite.
 *
 * 🔴 Die Knöpfe bleiben in ihrer Zeile (WI-0183; Betreiber 2026-10-15: „die statusleiste lässt beim zusammenklappen die buttons rechts
 * nach unten rutschen“, abgenommen am Blatt, EDIT-0003 §2a, „passt auch für die andern“). Wird das Fenster schmaler, kürzt der Hinweis
 * links mit „…“, statt die Hauptaussage in eine zweite Zeile zu schieben; der Fuß behält seine Höhe. Am Telefon wird nichts eingeklappt,
 * dort darf der Hinweis eine eigene Zeile über den Knöpfen nehmen.
 */
.avm-fenster__modus {
    flex: none;
    border-top: 1px solid var(--color-divider);
}

.avm-fenster__modus:empty {
    display: none;
}

.avm-fenster__fuss {
    display: flex;
    flex: none;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-4);
    padding: var(--avm-kopf-pad);
    border-top: 1px solid var(--color-divider);
}

/* Gekürzt wird über die Hausklasse `.einzeilig` (app.vue, am Rechner); hier nur, dass der Hinweis schrumpfen darf. */
.avm-fenster__fuss-hinweis {
    flex: 1 1 0;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Der freie Fuß (Slot `fuss`): Linie oben bleibt, das Polster setzt der Aufrufer. */
.avm-fenster__fuss--frei {
    display: block;
    padding: 0;
}

.avm-fenster__fuss--telefon {
    flex-wrap: wrap;
}

.avm-fenster__fuss--telefon .avm-fenster__fuss-hinweis {
    flex-basis: 100%;
}

/*
 * §12.3 im Fuß (WI-0118): Ein Knopf, den ein Fenster in die Hauptaussage setzt, ist ein GEFASSTER - dieselbe Fläche, derselbe Rahmen und
 * dieselbe Schrift wie der Schließknopf des Werkzeugfensters, mit der Mindestliste aus §30.5. Gesperrt heißt `disabled`: gedämpft,
 * kein Schatten, nicht greifbar („geht gerade nicht“, §30.2), nie über die Deckkraft.
 */
.avm-fenster__fuss-haupt :slotted(button) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--avm-control-h);
    padding: 0 var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.avm-fenster__fuss-haupt :slotted(button:hover) {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.avm-fenster__fuss-haupt :slotted(button:active) {
    background: var(--color-button-soft-active);
}

.avm-fenster__fuss-haupt :slotted(button:focus-visible) {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.avm-fenster__fuss-haupt :slotted(button:disabled) {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

/* Rechtsbündig aus `margin-left: auto`: steht links nichts, rutscht die Gruppe von selbst nach rechts. */
.avm-fenster__fuss-haupt {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    margin-left: auto;
}

/* Am Finger zieht niemand: kein Griff, keine Hand (dieselbe Bedingung wie `fenster-ziehen.ts`). */
@media (hover: none) and (pointer: coarse) {
    .avm-fenster__kopf {
        cursor: default;
    }

    .avm-fenster__griff {
        display: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .avm-fenster--einzug,
    .avm-fenster__knopf,
    .avm-fenster__fuss-haupt :slotted(button),
    .avm-fenster__kopffeld :slotted(input),
    .avm-fenster__kopffeld :slotted(select) {
        transition: none;
    }
}
</style>
