(function () {
    "use strict";
    const API = "/api/edit/mail/mailbox.php";
    const listEl = () => document.getElementById("mail-inbox-list");
    const detailEl = () => document.getElementById("mail-inbox-detail");
    const sentEl = () => document.getElementById("mail-sent-list");
    let inboxLoaded = false;
    let sentLoaded = false;
    let sentLoadPromise = null;
    let openUid = null;
    let openItemEl = null;

    function api(action, opts, query) {
        let url = API + "?action=" + encodeURIComponent(action);
        if (query) { Object.keys(query).forEach((k) => { url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(query[k]); }); }
        return fetch(url, Object.assign({ credentials: "same-origin" }, opts || {})).then((r) => r.json());
    }

    function fmtDate(s) { const d = new Date(s); return isNaN(d) ? (s || "") : d.toLocaleString("de-DE"); }

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

    function trashErrorText(res) {
        const code = res && res.error && res.error.code;
        if (code === "no_trash_mailbox") { return "Kein Papierkorb-Ordner im Postfach."; }
        if (code === "not_found") { return "Nicht mehr im Posteingang."; }
        return "Verschieben fehlgeschlagen.";
    }

    // Moves the mail into the mailbox's real trash folder (server-side). The row is only removed
    // once the server confirms; a failure leaves it in place and says why, because a row that
    // silently disappears on a failed move looks exactly like a successful one.
    function trashMessage(m, row, item, btn) {
        if (btn.disabled) { return; }
        const meta = item.querySelector(".mail-inbox__meta");
        const oldError = item.querySelector(".mail-inbox__trash-error");
        if (oldError) { oldError.remove(); }
        btn.disabled = true;
        row.classList.add("is-trashing");
        function fail(text) {
            row.classList.remove("is-trashing");
            btn.disabled = false;
            if (!meta) { return; }
            const note = document.createElement("span");
            note.className = "mail-inbox__trash-error";
            note.textContent = text;
            meta.appendChild(note);
        }
        api("trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: m.uid }) })
            .then((res) => {
                if (!res || !res.ok) { fail(trashErrorText(res)); return; }
                if (openUid === m.uid) { closeDetail(); }
                row.remove();
                const list = listEl();
                if (list && !list.querySelector(".mail-inbox__row")) { list.textContent = "Keine Nachrichten."; }
            })
            .catch(() => fail("Netzwerkfehler."));
    }

    function renderInbox(messages) {
        const el = listEl(); if (!el) return;
        el.textContent = "";
        openUid = null; openItemEl = null;
        if (!messages || !messages.length) { el.textContent = "Keine Nachrichten."; return; }
        messages.forEach((m) => {
            // The entry itself stays a <button>, so the trash CANNOT live inside it — a button
            // inside a button is invalid HTML and the parser tears the row apart. Hence the row
            // wrapper: clickable entry left, row action right.
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
            item.addEventListener("click", () => openMessage(m, item, row));

            const trash = document.createElement("button");
            trash.type = "button";
            trash.className = "mail-inbox__trash";
            trash.textContent = "🗑";
            trash.title = "In den Papierkorb verschieben";
            trash.setAttribute("aria-label", "In den Papierkorb verschieben");
            trash.addEventListener("click", () => trashMessage(m, row, item, trash));

            row.append(item, trash);
            el.appendChild(row);
        });
    }

    function closeDetail() {
        const inline = document.getElementById("mail-inline-detail");
        if (inline) { inline.remove(); }
        if (openItemEl) { openItemEl.classList.remove("is-open"); openItemEl = null; }
        openUid = null;
    }

    // The detail expands INLINE, directly under the clicked list entry (accordion), so it
    // never slides to the bottom of the list. A second click on the open mail collapses it.
    function openMessage(m, itemEl, rowEl) {
        if (openUid === m.uid) { closeDetail(); return; }
        closeDetail();
        openUid = m.uid;
        const detail = document.createElement("div");
        detail.id = "mail-inline-detail";
        detail.className = "mail-inbox__detail";
        detail.textContent = "Lade …";
        // The card goes after the ROW, not after the entry button — inside the row it would land
        // next to the trash button in the same flex line. `is-open` stays on the entry (the look).
        const anchor = rowEl || itemEl;
        if (anchor && typeof anchor.after === "function") {
            anchor.after(detail);
            itemEl.classList.add("is-open");
            openItemEl = itemEl;
        } else {
            const l = listEl(); if (l) { l.appendChild(detail); }
        }
        api("message", null, { uid: m.uid }).then((res) => {
            if (openUid !== m.uid) { return; }
            if (!res || !res.ok) { detail.textContent = "Konnte Nachricht nicht laden."; return; }
            renderDetail(res.message, detail);
        }).catch(() => { if (openUid === m.uid) { detail.textContent = "Fehler beim Laden."; } });
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
                const src = API + "?action=image&uid=" + encodeURIComponent(msg.uid) + "&part=" + encodeURIComponent(im.part);
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

    function renderSent(rows) {
        const el = sentEl(); if (!el) return;
        el.textContent = "";
        if (!rows || !rows.length) { el.textContent = "Noch nichts gesendet."; return; }
        rows.forEach((r) => {
            // <details>/<summary> on purpose, not a hand-built toggle: Strg+F finds text inside a
            // COLLAPSED entry and opens it by itself, while display:none would hide the text from
            // the page search — and a mailbox is exactly the surface people search. Focus,
            // Enter/Space and aria-expanded come from the element too.
            const item = document.createElement("details"); item.className = "mail-inbox__item mail-inbox__sent";
            item.dataset.replyId = String(r.id);
            const head = document.createElement("summary");
            const to = document.createElement("div"); to.className = "mail-inbox__from"; to.textContent = "An: " + (r.to_email || "");
            const subj = document.createElement("div"); subj.className = "mail-inbox__subject"; subj.textContent = r.subject || "";
            const meta = document.createElement("div"); meta.className = "mail-inbox__meta"; meta.textContent = fmtDate(r.sent_at) + " · " + (r.editor_user || "") + " · " + (r.delivery_status || "");
            const preview = document.createElement("div"); preview.className = "mail-inbox__preview"; preview.textContent = firstLine(r.body);
            head.append(to, subj, meta, preview);
            const body = document.createElement("div"); body.className = "mail-inbox__body"; body.textContent = r.body || "";
            item.append(head, body); el.appendChild(item);
        });
    }

    function loadInbox(force) {
        if (inboxLoaded && !force) return;
        inboxLoaded = true;
        const el = listEl(); if (el) el.textContent = "Lade …";
        api("inbox").then((res) => { res && res.ok ? renderInbox(res.messages) : (el && (el.textContent = "Mailbox nicht erreichbar.")); })
            .catch(() => { if (el) el.textContent = "Fehler beim Laden."; });
    }
    function loadSent(force) {
        if (sentLoaded && !force && sentLoadPromise) return sentLoadPromise;
        sentLoaded = true;
        sentLoadPromise = api("sent").then((res) => { if (res && res.ok) renderSent(res.sent); }).catch(() => {});
        return sentLoadPromise;
    }
    function highlightSent(replyId) {
        const el = sentEl(); if (!el || !replyId) return;
        el.querySelectorAll(".mail-inbox__item.is-highlighted").forEach((n) => n.classList.remove("is-highlighted"));
        const target = el.querySelector('[data-reply-id="' + String(replyId) + '"]');
        // Open it: jumping from "✓ beantwortet" onto a COLLAPSED entry would land on a headline
        // and hide the very reply the jump was about.
        if (target) { target.open = true; target.classList.add("is-highlighted"); target.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }
    function jumpToSent(replyId) {
        if (!replyId) return;
        switchMailTab("gesendet");
        loadSent(false).then(() => highlightSent(replyId));
    }

    function switchMailTab(name) {
        document.querySelectorAll("[data-mail-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.mailTab === name));
        document.querySelectorAll("[data-mail-pane]").forEach((p) => p.classList.toggle("is-active", p.dataset.mailPane === name));
        if (name === "empfangen") loadInbox(false); else loadSent(false);
    }

    document.addEventListener("click", (e) => {
        const tab = e.target.closest("[data-mail-tab]");
        if (tab) { switchMailTab(tab.dataset.mailTab); return; }
        if (e.target.closest("#mail-refresh")) {
            const active = document.querySelector("[data-mail-tab].is-active");
            (active && active.dataset.mailTab === "gesendet") ? loadSent(true) : loadInbox(true);
        }
    });

    // Lazy-load when the Mails sub-tab is opened.
    document.addEventListener("click", (e) => {
        const sub = e.target.closest('[data-review-subtab="mails"]');
        if (sub) loadInbox(false);
    });
})();
