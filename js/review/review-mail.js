(function () {
    "use strict";
    const API = "/api/edit/mail/mailbox.php";
    const listEl = () => document.getElementById("mail-inbox-list");
    const detailEl = () => document.getElementById("mail-inbox-detail");
    const sentEl = () => document.getElementById("mail-sent-list");
    let inboxLoaded = false;
    let sentLoaded = false;
    let sentLoadPromise = null;

    function api(action, opts) {
        const url = API + "?action=" + encodeURIComponent(action);
        return fetch(url, Object.assign({ credentials: "same-origin" }, opts || {})).then((r) => r.json());
    }

    function fmtDate(s) { const d = new Date(s); return isNaN(d) ? (s || "") : d.toLocaleString("de-DE"); }

    function renderInbox(messages) {
        const el = listEl(); if (!el) return;
        el.textContent = "";
        if (!messages || !messages.length) { el.textContent = "Keine Nachrichten."; return; }
        messages.forEach((m) => {
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
            item.addEventListener("click", () => openMessage(m));
            el.appendChild(item);
        });
    }

    function openMessage(m) {
        const el = detailEl(); if (!el) return;
        el.hidden = false; el.textContent = "Lade …";
        api("message&uid=" + encodeURIComponent(m.uid)).then((res) => {
            if (!res || !res.ok) { el.textContent = "Konnte Nachricht nicht laden."; return; }
            renderDetail(res.message);
        }).catch(() => { el.textContent = "Fehler beim Laden."; });
    }

    function renderDetail(msg) {
        const el = detailEl(); if (!el) return;
        el.textContent = "";
        const head = document.createElement("div"); head.className = "mail-inbox__meta";
        head.textContent = (msg.fromEmail || "") + " · " + (msg.subject || "(kein Betreff)");
        const body = document.createElement("div"); body.className = "mail-inbox__body"; body.textContent = msg.text || "(kein Textinhalt)";
        el.append(head, body);

        if (!msg.fromEmail) { const n = document.createElement("div"); n.className = "mail-inbox__status"; n.textContent = "Keine Absenderadresse — Antwort nicht möglich."; el.appendChild(n); return; }

        const wrap = document.createElement("div"); wrap.className = "mail-inbox__reply";
        const ta = document.createElement("textarea"); ta.placeholder = "Antwort an " + msg.fromEmail + " …";
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
            const item = document.createElement("div"); item.className = "mail-inbox__item";
            item.dataset.replyId = String(r.id);
            const to = document.createElement("div"); to.className = "mail-inbox__from"; to.textContent = "An: " + (r.to_email || "");
            const subj = document.createElement("div"); subj.className = "mail-inbox__subject"; subj.textContent = r.subject || "";
            const body = document.createElement("div"); body.className = "mail-inbox__body"; body.textContent = r.body || "";
            const meta = document.createElement("div"); meta.className = "mail-inbox__meta"; meta.textContent = fmtDate(r.sent_at) + " · " + (r.editor_user || "") + " · " + (r.delivery_status || "");
            item.append(to, subj, meta, body); el.appendChild(item);
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
        if (target) { target.classList.add("is-highlighted"); target.scrollIntoView({ block: "center", behavior: "smooth" }); }
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
