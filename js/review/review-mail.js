(function () {
    "use strict";
    const API = "/api/edit/mail/mailbox.php";
    const listEl = () => document.getElementById("mail-inbox-list");
    const detailEl = () => document.getElementById("mail-inbox-detail");
    const sentEl = () => document.getElementById("mail-sent-list");
    const archiveEl = () => document.getElementById("mail-archive-list");
    const archiveSentEl = () => document.getElementById("mail-archive-sent-list");
    let inboxLoaded = false;
    let sentLoaded = false;
    let archiveLoaded = false;
    let sentLoadPromise = null;
    let archiveLoadPromise = null;
    // A uid is per FOLDER: message 123 in the inbox and message 123 in the archive are two
    // different mails. The open detail is therefore keyed by box AND uid, never by uid alone.
    let openKey = null;
    let openItemEl = null;

    function api(action, opts, query) {
        let url = API + "?action=" + encodeURIComponent(action);
        if (query) { Object.keys(query).forEach((k) => { url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(query[k]); }); }
        return fetch(url, Object.assign({ credentials: "same-origin" }, opts || {})).then((r) => r.json());
    }

    function fmtDate(s) { const d = new Date(s); return isNaN(d) ? (s || "") : d.toLocaleString("de-DE"); }

    function messageKey(box, uid) { return String(box || "inbox") + ":" + String(uid); }

    // Full-screen image viewer. Built entirely via createElement (no innerHTML); the src is
    // our own auth-gated, same-origin image endpoint, so the session cookie is sent with it.
    function openLightbox(src, alt) {
        const overlay = document.createElement("div");
        overlay.className = "mail-inbox__lightbox";
        const img = document.createElement("img");
        img.src = src;
        img.alt = alt || "";
        overlay.appendChild(img);
        function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
        function onKey(e) { if (e.key === "Escape") close(); }
        overlay.addEventListener("click", close);
        document.addEventListener("keydown", onKey);
        document.body.appendChild(overlay);
    }

    function firstLine(text) {
        const lines = String(text == null ? "" : text).split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed) { return trimmed; }
        }
        return "";
    }

    function moveErrorText(res) {
        const code = res && res.error && res.error.code;
        if (code === "no_trash_mailbox") { return "Kein Papierkorb-Ordner im Postfach."; }
        if (code === "no_archive_mailbox") { return "Kein Archiv-Ordner im Postfach."; }
        if (code === "archive_open_failed") { return "Archiv-Ordner nicht lesbar."; }
        if (code === "not_found") { return "Nicht mehr an dieser Stelle."; }
        return "Verschieben fehlgeschlagen.";
    }

    // Strich-Icons statt Emoji, in der Form des Hauses (vgl. AVM_FILTER_ICON in js/ui/filter-menu.js):
    // 24er-Raster, `stroke="currentColor"`, keine Füllung. 💣 Ein Emoji ist KEINE Grafik, sondern ein
    // Schriftzeichen — auf Windows fällt 🗄/🗑 in eine Umriss-Ersatzschrift und steht als zwei kahle
    // Kästchen nebeneinander (Owner, 15.08.2026). Und weil ein Emoji seine eigene Farbe mitbringt,
    // kann es den Warnton von .mail-inbox__trash:hover gar nicht annehmen; `currentColor` schon.
    const ICON = (pfade) => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" '
        + 'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" '
        + 'aria-hidden="true" focusable="false">' + pfade + "</svg>";
    const ICON_ARCHIV = ICON('<rect x="3" y="4" width="18" height="4" rx="1"/>'
        + '<path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>');
    const ICON_PAPIERKORB = ICON('<path d="M4 7h16"/><path d="M10 4h4"/>'
        + '<path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>');
    const ICON_ZURUECK = ICON('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>');

    function rowAction(cls, icon, label, run) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mail-inbox__action " + cls;
        // Konstanter Bauteil-String, keine Nutzereingabe — alles Variable geht weiter über textContent.
        btn.innerHTML = icon;
        btn.title = label;
        btn.setAttribute("aria-label", label);
        btn.addEventListener("click", () => run(btn));
        return btn;
    }

    // One mover for every row action (trash, archive, back out of the archive, and the two
    // database-only ones on sent entries). The row is removed only once the server confirms; a
    // failure leaves it in place and says why, because a row that silently disappears on a failed
    // move looks exactly like a successful one.
    function runRowAction(action, payload, row, item, btn) {
        if (btn.disabled) { return; }
        const meta = item.querySelector(".mail-inbox__meta");
        const oldError = row.querySelector(".mail-inbox__row-error");
        if (oldError) { oldError.remove(); }
        btn.disabled = true;
        row.classList.add("is-busy");
        function fail(text) {
            row.classList.remove("is-busy");
            btn.disabled = false;
            if (!meta) { return; }
            const note = document.createElement("span");
            note.className = "mail-inbox__row-error";
            note.textContent = text;
            meta.appendChild(note);
        }
        api(action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
            .then((res) => {
                if (!res || !res.ok) { fail(moveErrorText(res)); return; }
                if (openItemEl === item) { closeDetail(); }
                const list = row.parentNode;
                row.remove();
                if (list && !list.querySelector(".mail-inbox__row")) {
                    list.textContent = list.dataset.emptyText || "Keine Nachrichten.";
                }
                // The mail left this list for another one; every cached list is stale now. They
                // reload on the next visit rather than being patched from here — patching two
                // lists from one place is how they drift apart.
                inboxLoaded = false; sentLoaded = false; archiveLoaded = false;
            })
            .catch(() => fail("Netzwerkfehler."));
    }

    function buildMessageRow(m, box) {
        // The entry itself stays a <button>, so the row actions CANNOT live inside it — a button
        // inside a button is invalid HTML and the parser tears the row apart. Hence the row
        // wrapper: clickable entry left, row actions right.
        const row = document.createElement("div");
        row.className = "mail-inbox__row";
        const item = document.createElement("button");
        item.type = "button";
        item.className = "mail-inbox__item" + (m.seen ? "" : " is-unread");
        const from = document.createElement("div"); from.className = "mail-inbox__from"; from.textContent = m.from || m.fromEmail || "(unbekannt)";
        const subj = document.createElement("div"); subj.className = "mail-inbox__subject"; subj.textContent = m.subject || "(kein Betreff)";
        const meta = document.createElement("div"); meta.className = "mail-inbox__meta"; meta.textContent = fmtDate(m.date);
        if (m.answered) {
            const b = document.createElement("span");
            b.className = "mail-inbox__badge";
            b.textContent = "✓ beantwortet";
            b.title = "Zur gesendeten Antwort springen";
            if (m.replyId) { b.addEventListener("click", (ev) => { ev.stopPropagation(); jumpToSent(m.replyId); }); }
            meta.appendChild(b);
        }
        item.append(from, subj, meta);
        item.addEventListener("click", () => openMessage(m, item, row, box));
        row.appendChild(item);

        if (box === "archive") {
            row.appendChild(rowAction("mail-inbox__archive", ICON_ZURUECK, "Zurück in den Posteingang", (btn) => runRowAction("unarchive", { uid: m.uid }, row, item, btn)));
        } else {
            // Archive left, trash right: the destructive action sits on the outside, never between
            // the two other click targets.
            row.appendChild(rowAction("mail-inbox__archive", ICON_ARCHIV, "Ins Archiv verschieben", (btn) => runRowAction("archive", { uid: m.uid }, row, item, btn)));
            row.appendChild(rowAction("mail-inbox__trash", ICON_PAPIERKORB, "In den Papierkorb verschieben", (btn) => runRowAction("trash", { uid: m.uid }, row, item, btn)));
        }
        return row;
    }

    function renderMessages(messages, el, box, emptyText) {
        if (!el) return;
        el.textContent = "";
        el.dataset.emptyText = emptyText;
        if (openItemEl && !document.contains(openItemEl)) { closeDetail(); }
        if (!messages || !messages.length) { el.textContent = emptyText; return; }
        messages.forEach((m) => { el.appendChild(buildMessageRow(m, box)); });
    }

    function closeDetail() {
        const inline = document.getElementById("mail-inline-detail");
        if (inline) { inline.remove(); }
        if (openItemEl) { openItemEl.classList.remove("is-open"); openItemEl = null; }
        openKey = null;
    }

    // The detail expands INLINE, directly under the clicked list entry (accordion), so it
    // never slides to the bottom of the list. A second click on the open mail collapses it.
    function openMessage(m, itemEl, rowEl, box) {
        const key = messageKey(box, m.uid);
        if (openKey === key) { closeDetail(); return; }
        closeDetail();
        openKey = key;
        const detail = document.createElement("div");
        detail.id = "mail-inline-detail";
        detail.className = "mail-inbox__detail";
        detail.textContent = "Lade …";
        // The card goes after the ROW, not after the entry button — inside the row it would land
        // next to the row actions in the same flex line. `is-open` stays on the entry (the look).
        const anchor = rowEl || itemEl;
        if (anchor && typeof anchor.after === "function") {
            anchor.after(detail);
            itemEl.classList.add("is-open");
            openItemEl = itemEl;
        } else {
            const l = listEl(); if (l) { l.appendChild(detail); }
        }
        // The box travels with the uid — without it the server would read the same-numbered
        // message of the inbox and answer with a different mail entirely.
        api("message", null, { uid: m.uid, box: box || "inbox" }).then((res) => {
            if (openKey !== key) { return; }
            if (!res || !res.ok) { detail.textContent = "Konnte Nachricht nicht laden."; return; }
            renderDetail(res.message, detail);
        }).catch(() => { if (openKey === key) { detail.textContent = "Fehler beim Laden."; } });
    }

    function renderDetail(msg, el) {
        if (!el) { el = detailEl(); }
        if (!el) return;
        el.textContent = "";
        const head = document.createElement("div"); head.className = "mail-inbox__meta";
        head.textContent = ((msg.replyTo || msg.fromEmail) || "") + " · " + (msg.subject || "(kein Betreff)");
        const body = document.createElement("div"); body.className = "mail-inbox__body"; body.textContent = msg.text || "(kein Textinhalt)";
        el.append(head, body);

        if (msg.images && msg.images.length) {
            const gallery = document.createElement("div"); gallery.className = "mail-inbox__images";
            msg.images.forEach((im) => {
                const src = API + "?action=image&uid=" + encodeURIComponent(msg.uid) + "&part=" + encodeURIComponent(im.part)
                    + (msg.box === "archive" ? "&box=archive" : "");
                const thumb = document.createElement("img");
                thumb.className = "mail-inbox__thumb";
                thumb.src = src;
                thumb.alt = im.filename || "Bild";
                thumb.title = "Zum Vergrößern klicken";
                thumb.loading = "lazy";
                thumb.addEventListener("click", () => openLightbox(src, im.filename || ""));
                gallery.appendChild(thumb);
            });
            el.appendChild(gallery);
        }

        // No replying out of the archive (design 2026-08-15, §2): the reply path derives its
        // recipient server-side from the referenced mail, and it is not being widened to a second
        // folder for convenience. Fetch the mail back into the inbox and answer it there.
        if (msg.box === "archive") {
            const n = document.createElement("div"); n.className = "mail-inbox__status";
            n.textContent = "Archiviert — zum Antworten erst mit ↩ zurückholen.";
            el.appendChild(n);
            return;
        }

        const replyTarget = msg.replyTo || msg.fromEmail;
        if (!replyTarget) { const n = document.createElement("div"); n.className = "mail-inbox__status"; n.textContent = "Keine Absenderadresse — Antwort nicht möglich."; el.appendChild(n); return; }

        const wrap = document.createElement("div"); wrap.className = "mail-inbox__reply";
        const ta = document.createElement("textarea"); ta.placeholder = "Antwort an " + replyTarget + " …";
        const actions = document.createElement("div"); actions.className = "mail-inbox__reply-actions";
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "wiki-sync-panel__start"; btn.textContent = "Mail beantworten";
        const status = document.createElement("span"); status.className = "mail-inbox__status";
        if (msg.answered && msg.replyId) {
            const link = document.createElement("span");
            link.className = "mail-inbox__badge";
            link.textContent = "✓ Bereits beantwortet — zur gesendeten Mail";
            link.title = "Zur gesendeten Antwort springen";
            link.addEventListener("click", () => jumpToSent(msg.replyId));
            status.appendChild(link);
        } else if (msg.answered) {
            status.textContent = "Bereits beantwortet.";
        }
        actions.append(btn, status); wrap.append(ta, actions); el.appendChild(wrap);

        btn.addEventListener("click", () => {
            const text = ta.value.trim();
            if (!text) { status.textContent = "Bitte Text eingeben."; return; }
            btn.disabled = true; status.textContent = "Sende …";
            api("reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: msg.uid, message: text }) })
                .then((res) => {
                    if (res && res.ok) { status.textContent = "Gesendet ✓"; ta.value = ""; sentLoaded = false; inboxLoaded = false; }
                    else { status.textContent = "Fehler: " + ((res && res.deliveryStatus) || "unbekannt"); btn.disabled = false; }
                })
                .catch(() => { status.textContent = "Netzwerkfehler."; btn.disabled = false; });
        });
    }

    function buildSentRow(r, archived) {
        const row = document.createElement("div");
        row.className = "mail-inbox__row";
        // <details>/<summary> on purpose, not a hand-built toggle: Strg+F finds text inside a
        // COLLAPSED entry and opens it by itself, while display:none would hide the text from
        // the page search — and a mailbox is exactly the surface people search. Focus,
        // Enter/Space and aria-expanded come from the element too. The row action sits OUTSIDE
        // the <details>, so clicking it never toggles the entry.
        const item = document.createElement("details"); item.className = "mail-inbox__item mail-inbox__sent";
        item.dataset.replyId = String(r.id);
        const head = document.createElement("summary");
        const to = document.createElement("div"); to.className = "mail-inbox__from"; to.textContent = "An: " + (r.to_email || "");
        const subj = document.createElement("div"); subj.className = "mail-inbox__subject"; subj.textContent = r.subject || "";
        const meta = document.createElement("div"); meta.className = "mail-inbox__meta"; meta.textContent = fmtDate(r.sent_at) + " · " + (r.editor_user || "") + " · " + (r.delivery_status || "");
        const preview = document.createElement("div"); preview.className = "mail-inbox__preview"; preview.textContent = firstLine(r.body);
        head.append(to, subj, meta, preview);
        const body = document.createElement("div"); body.className = "mail-inbox__body"; body.textContent = r.body || "";
        item.append(head, body);
        row.appendChild(item);
        // Archiving a sent entry marks the LOG ROW and nothing else — the message itself stays
        // where it is in the mailbox's own sent folder.
        row.appendChild(archived
            ? rowAction("mail-inbox__archive", ICON_ZURUECK, "Zurück in die Gesendet-Liste", (btn) => runRowAction("sent-unarchive", { id: r.id }, row, item, btn))
            : rowAction("mail-inbox__archive", ICON_ARCHIV, "Ins Archiv verschieben", (btn) => runRowAction("sent-archive", { id: r.id }, row, item, btn)));
        return row;
    }

    function renderSent(rows, el, archived, emptyText) {
        if (!el) return;
        el.textContent = "";
        el.dataset.emptyText = emptyText;
        if (!rows || !rows.length) { el.textContent = emptyText; return; }
        rows.forEach((r) => { el.appendChild(buildSentRow(r, archived)); });
    }

    function loadInbox(force) {
        if (inboxLoaded && !force) return;
        inboxLoaded = true;
        const el = listEl(); if (el) el.textContent = "Lade …";
        api("inbox").then((res) => { res && res.ok ? renderMessages(res.messages, el, "inbox", "Keine Nachrichten.") : (el && (el.textContent = "Mailbox nicht erreichbar.")); })
            .catch(() => { if (el) el.textContent = "Fehler beim Laden."; });
    }
    function loadSent(force) {
        if (sentLoaded && !force && sentLoadPromise) return sentLoadPromise;
        sentLoaded = true;
        sentLoadPromise = api("sent").then((res) => { if (res && res.ok) renderSent(res.sent, sentEl(), false, "Noch nichts gesendet."); }).catch(() => {});
        return sentLoadPromise;
    }
    function loadArchive(force) {
        if (archiveLoaded && !force && archiveLoadPromise) return archiveLoadPromise;
        archiveLoaded = true;
        const el = archiveEl(); if (el) el.textContent = "Lade …";
        const received = api("archived").then((res) => {
            if (!el) return;
            if (!res || !res.ok) { el.textContent = "Mailbox nicht erreichbar."; return; }
            // An empty `mailbox` means the mailbox HAS no archive folder — a different thing from
            // an empty archive, and the only one of the two that is a job for the owner.
            if (!res.mailbox) { el.textContent = "Im Postfach gibt es keinen Ordner „Archiv“."; return; }
            renderMessages(res.messages, el, "archive", "Nichts archiviert.");
        }).catch(() => { if (el) el.textContent = "Fehler beim Laden."; });
        const sent = api("sent-archived").then((res) => {
            const se = archiveSentEl(); if (!se) return;
            if (res && res.ok) { renderSent(res.sent, se, true, "Nichts archiviert."); }
            else { se.textContent = "Fehler beim Laden."; }
        }).catch(() => {});
        archiveLoadPromise = Promise.all([received, sent]);
        return archiveLoadPromise;
    }

    function highlightSent(replyId, el) {
        if (!el || !replyId) return false;
        const target = el.querySelector('[data-reply-id="' + String(replyId) + '"]');
        if (!target) return false;
        document.querySelectorAll(".mail-inbox__item.is-highlighted").forEach((n) => n.classList.remove("is-highlighted"));
        // Open it: jumping from "✓ beantwortet" onto a COLLAPSED entry would land on a headline
        // and hide the very reply the jump was about.
        target.open = true;
        target.classList.add("is-highlighted");
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
    }
    function jumpToSent(replyId) {
        if (!replyId) return;
        switchMailTab("gesendet");
        loadSent(false).then(() => {
            if (highlightSent(replyId, sentEl())) { return; }
            // The reply may have been archived in the meantime. A badge that clicks into nothing is
            // worse than a second hop, so follow it into the archive instead of failing silently.
            switchMailTab("archiv");
            loadArchive(false).then(() => highlightSent(replyId, archiveSentEl()));
        });
    }

    function switchMailTab(name) {
        document.querySelectorAll("[data-mail-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.mailTab === name));
        document.querySelectorAll("[data-mail-pane]").forEach((p) => p.classList.toggle("is-active", p.dataset.mailPane === name));
        if (name === "empfangen") loadInbox(false);
        else if (name === "archiv") loadArchive(false);
        else loadSent(false);
    }

    document.addEventListener("click", (e) => {
        const tab = e.target.closest("[data-mail-tab]");
        if (tab) { switchMailTab(tab.dataset.mailTab); return; }
        if (e.target.closest("#mail-refresh")) {
            const active = document.querySelector("[data-mail-tab].is-active");
            const name = active ? active.dataset.mailTab : "empfangen";
            if (name === "gesendet") loadSent(true);
            else if (name === "archiv") loadArchive(true);
            else loadInbox(true);
        }
    });

    // Lazy-load when the Mails sub-tab is opened.
    document.addEventListener("click", (e) => {
        const sub = e.target.closest('[data-review-subtab="mails"]');
        if (sub) loadInbox(false);
    });
})();
