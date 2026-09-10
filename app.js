(() => {
  "use strict";

  /* ---------------- helpers (defined first so storage seeding can use them) ---------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  const URL_RE = /\bhttps?:\/\/[^\s]+/i;

  /* ---------------- storage ---------------- */

  const STORE_KEY = "notewire:v1";

  // Preloaded on first launch only — the person can edit or remove these,
  // and add more, from Settings at any time.
  const DEFAULT_RECIPIENTS = [
    { id: uid(), name: "Primary", email: "sumanpresi86geology@gmail.com" },
    { id: uid(), name: "Suman Das", email: "sumanpresi.geology@gmail.com" },
  ];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt state */ }
    return {
      recipients: DEFAULT_RECIPIENTS,
      activeRecipientId: DEFAULT_RECIPIENTS[0].id,
      notes: [],
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Storage is full — try clearing old notes");
    }
  }

  const state = loadState();

  /* ---------------- more helpers ---------------- */

  function toast(msg, ms = 2200) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), ms);
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return "1 day ago";
    if (d < 7) return `${d} days ago`;
    const w = Math.floor(d / 7);
    if (w === 1) return "1 week ago";
    if (w < 5) return `${w} weeks ago`;
    const mo = Math.floor(d / 30);
    if (mo <= 1) return "1 month ago";
    return `${mo} months ago`;
  }

  function localDateKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function downscaleImage(file, maxDim = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function dataURLtoFile(dataUrl, filename, mime) {
    const arr = dataUrl.split(",");
    const bin = atob(arr[1]);
    let n = bin.length;
    const u8 = new Uint8Array(n);
    while (n--) u8[n] = bin.charCodeAt(n);
    return new File([u8], filename, { type: mime });
  }

  function categoryOf(note) {
    if (note.attachments && note.attachments.length) {
      const kinds = note.attachments.map(a => a.kind);
      if (kinds.includes("image")) return "images";
      if (kinds.includes("audio")) return "audio";
      return "files";
    }
    if (note.text && URL_RE.test(note.text)) return "links";
    return "text";
  }

  function kindFromMime(mime) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    return "file";
  }

  /* ---------------- icons ---------------- */

  const ICONS = {
    compose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 3"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  function iconFor(cat) {
    return ICONS[({ images: "image", audio: "audio", links: "link", files: "file", text: "text" })[cat]] || ICONS.file;
  }

  /* ---------------- render: shell / nav ---------------- */

  let activeTab = "compose";

  function setTab(tab) {
    activeTab = tab;
    $$(".panel").forEach(p => p.classList.toggle("active", p.id === `panel-${tab}`));
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".rail-item").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    if (tab === "history") renderHistory();
    if (tab === "settings") renderSettings();
  }

  /* ---------------- compose ---------------- */

  let pendingAttachments = []; // { name, kind, dataUrl, mime }
  let mediaRecorder = null;
  let recordedChunks = [];

  function activeRecipient() {
    return state.recipients.find(r => r.id === state.activeRecipientId) || state.recipients[0] || null;
  }

  function renderRecipientChip() {
    const chip = $("#recipient-chip");
    const r = activeRecipient();
    if (!r) {
      chip.querySelector(".label").textContent = "Add recipient";
      chip.querySelector(".avatar").textContent = "+";
      return;
    }
    chip.querySelector(".label").textContent = r.name.split(" ")[0];
    chip.querySelector(".avatar").textContent = r.name.trim()[0]?.toUpperCase() || "?";
  }

  function renderAttachmentTray() {
    const tray = $("#attachment-tray");
    tray.innerHTML = "";
    pendingAttachments.forEach((a, i) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      const thumb = a.kind === "image"
        ? `<img src="${a.dataUrl}" alt="">`
        : `<span style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:var(--text-dim)">${a.kind === "audio" ? ICONS.audio : ICONS.file}</span>`;
      chip.innerHTML = `${thumb}<span class="name">${a.name}</span><button type="button" aria-label="Remove">${ICONS.x}</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        pendingAttachments.splice(i, 1);
        renderAttachmentTray();
        updateSendState();
      });
      tray.appendChild(chip);
    });
  }

  function updateSendState() {
    const hasText = $("#note-text").value.trim().length > 0;
    $("#send-btn").disabled = !(hasText || pendingAttachments.length);
  }

  const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB — keeps notes within local storage limits

  async function addFiles(fileList, forcedKind) {
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        toast(`${file.name} is too large (max 8MB)`);
        continue;
      }
      const kind = forcedKind || kindFromMime(file.type);
      try {
        const dataUrl = kind === "image" ? await downscaleImage(file) : await fileToDataURL(file);
        pendingAttachments.push({ name: file.name || `${kind}-${Date.now()}`, kind, dataUrl, mime: file.type || "application/octet-stream" });
      } catch (e) {
        toast("Couldn't read that file");
      }
    }
    renderAttachmentTray();
    updateSendState();
  }

  async function toggleRecording() {
    const btn = $("#tool-mic");
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        btn.classList.remove("recording");
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        const dataUrl = await fileToDataURL(blob);
        pendingAttachments.push({ name: `voice-note-${Date.now()}.webm`, kind: "audio", dataUrl, mime: "audio/webm" });
        renderAttachmentTray();
        updateSendState();
      };
      mediaRecorder.start();
      btn.classList.add("recording");
    } catch (e) {
      toast("Microphone access was denied");
    }
  }

  async function sendNote() {
    const text = $("#note-text").value.trim();
    if (!text && !pendingAttachments.length) return;
    const recipient = activeRecipient();
    const note = {
      id: uid(),
      text,
      attachments: pendingAttachments,
      timestamp: Date.now(),
      status: "pending",
      recipient: recipient ? recipient.email : null,
    };
    note.category = categoryOf(note);
    state.notes.unshift(note);
    saveState();

    $("#note-text").value = "";
    pendingAttachments = [];
    renderAttachmentTray();
    updateSendState();
    renderStreak();

    await attemptDeliver(note);
  }

  async function attemptDeliver(note) {
    const files = (note.attachments || []).map(a => dataURLtoFile(a.dataUrl, a.name, a.mime));
    const shareData = { title: "Notewire", text: note.text || undefined };
    if (files.length) shareData.files = files;

    const canShareFiles = files.length && navigator.canShare && navigator.canShare({ files });
    try {
      if (navigator.share && (canShareFiles || (!files.length && (note.text || "")))) {
        await navigator.share(shareData);
        markSent(note.id);
        toast("Sent");
        return;
      }
      throw new Error("share-unavailable");
    } catch (err) {
      if (err && err.name === "AbortError") {
        toast("Send cancelled — saved to outbox");
        renderHistory();
        return;
      }
      // fallback: mailto (text only)
      const recipient = activeRecipient();
      if (recipient) {
        const subject = encodeURIComponent(note.text ? note.text.slice(0, 60) : "Note from Notewire");
        const bodyParts = [note.text || ""];
        if (note.attachments.length) {
          bodyParts.push("", `(${note.attachments.length} attachment${note.attachments.length > 1 ? "s" : ""} not included — open Notewire to view)`);
        }
        const body = encodeURIComponent(bodyParts.join("\n"));
        window.location.href = `mailto:${encodeURIComponent(recipient.email)}?subject=${subject}&body=${body}`;
        markSent(note.id);
        toast("Opened your mail app");
      } else {
        toast("Add a recipient in Settings to send by email");
        renderHistory();
      }
    }
  }

  function markSent(id) {
    const n = state.notes.find(n => n.id === id);
    if (n) n.status = "sent";
    saveState();
    renderStreak();
    if (activeTab === "history") renderHistory();
  }

  function retrySend(id) {
    const n = state.notes.find(n => n.id === id);
    if (n) attemptDeliver(n);
  }

  /* ---------------- history ---------------- */

  let activeFilter = "all";
  const FILTERS = [
    { id: "all", label: "All" },
    { id: "audio", label: "Audio" },
    { id: "images", label: "Images" },
    { id: "links", label: "Links" },
    { id: "files", label: "Files" },
  ];

  function renderFilterRow() {
    const row = $("#filter-row");
    row.innerHTML = "";
    FILTERS.forEach(f => {
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (activeFilter === f.id ? " active" : "");
      chip.textContent = f.label;
      chip.addEventListener("click", () => { activeFilter = f.id; renderHistory(); });
      row.appendChild(chip);
    });
  }

  function noteTitle(note) {
    if (note.text) return note.text.split("\n")[0].slice(0, 80);
    if (note.attachments.length) return note.attachments[0].name;
    return "Note";
  }

  function noteRowEl(note) {
    const row = document.createElement("div");
    row.className = "note-row";
    let iconHTML = iconFor(note.category);
    let imgThumb = "";
    if (note.category === "images" && note.attachments[0]) imgThumb = `<img src="${note.attachments[0].dataUrl}" alt="">`;
    const recipientName = state.recipients.find(r => r.email === note.recipient)?.name || note.recipient || "";
    const statusText = note.status === "pending"
      ? `<span class="status-pending">Sending to ${recipientName || "recipient"}…</span>`
      : `${recipientName ? `Sent to ${recipientName}` : "Sent"} · ${timeAgo(note.timestamp)}`;
    row.innerHTML = `
      <div class="icon">${imgThumb || iconHTML}</div>
      <div class="body">
        <div class="title">${escapeHtml(noteTitle(note))}</div>
        <div class="meta">${statusText}</div>
      </div>
      ${note.status === "pending" ? `<button class="retry">Retry</button>` : ""}
    `;
    if (note.status === "pending") {
      row.querySelector(".retry").addEventListener("click", () => retrySend(note.id));
    }
    return row;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderHistory() {
    renderFilterRow();
    const scroll = $("#history-scroll");
    scroll.innerHTML = "";
    let notes = state.notes;
    if (activeFilter !== "all") notes = notes.filter(n => n.category === activeFilter);

    if (!notes.length) {
      scroll.innerHTML = `<div class="empty-state"><div class="glyph">✎</div><p>Nothing here yet — notes you send will show up in this list.</p></div>`;
      return;
    }

    const pending = notes.filter(n => n.status === "pending");
    const sent = notes.filter(n => n.status !== "pending");

    if (pending.length) {
      const label = document.createElement("div");
      label.className = "section-label";
      label.textContent = "Outbox";
      scroll.appendChild(label);
      pending.forEach(n => scroll.appendChild(noteRowEl(n)));
    }
    if (sent.length) {
      const label = document.createElement("div");
      label.className = "section-label";
      label.textContent = "Older";
      scroll.appendChild(label);
      sent.forEach(n => scroll.appendChild(noteRowEl(n)));
    }
  }

  /* ---------------- streak ---------------- */

  function renderStreak() {
    const sentDates = new Set(state.notes.filter(n => n.status === "sent").map(n => localDateKey(n.timestamp)));
    let streak = 0;
    const cursor = new Date();
    while (sentDates.has(localDateKey(cursor.getTime()))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    $$(".streak-count-num").forEach(el => el.textContent = streak);

    const strip = $("#streak-days");
    strip.innerHTML = "";
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const dayLetters = ["S", "M", "T", "W", "T", "F", "S"];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const isToday = d.toDateString() === today.toDateString();
      const done = sentDates.has(localDateKey(d.getTime()));
      const el = document.createElement("div");
      el.className = "streak-day" + (isToday ? " today" : "") + (done ? " done" : "");
      el.innerHTML = `<div class="dot">${d.getDate()}</div><span>${dayLetters[i]}</span>`;
      strip.appendChild(el);
    }
  }

  /* ---------------- settings ---------------- */

  function renderSettings() {
    renderStreak();
    const list = $("#recipient-list");
    list.innerHTML = "";
    if (!state.recipients.length) {
      list.innerHTML = `<div class="settings-item"><div><div class="label">No recipients yet</div><div class="sub">Add one below to start sending</div></div></div>`;
    }
    state.recipients.forEach(r => {
      const item = document.createElement("div");
      item.className = "settings-item";
      item.style.cursor = "pointer";
      item.innerHTML = `
        <div>
          <div class="label">${escapeHtml(r.name)} ${r.id === state.activeRecipientId ? "· active" : ""}</div>
          <div class="sub">${escapeHtml(r.email)}</div>
        </div>
        <button class="remove" aria-label="Remove">${ICONS.x}</button>
      `;
      item.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        state.activeRecipientId = r.id;
        saveState();
        renderSettings();
        renderRecipientChip();
      });
      item.querySelector(".remove").addEventListener("click", () => {
        state.recipients = state.recipients.filter(x => x.id !== r.id);
        if (state.activeRecipientId === r.id) state.activeRecipientId = state.recipients[0]?.id || null;
        saveState();
        renderSettings();
        renderRecipientChip();
      });
      list.appendChild(item);
    });
  }

  function addRecipient() {
    const nameEl = $("#new-recipient-name");
    const emailEl = $("#new-recipient-email");
    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("Enter a name and a valid email");
      return;
    }
    const r = { id: uid(), name, email };
    state.recipients.push(r);
    if (!state.activeRecipientId) state.activeRecipientId = r.id;
    saveState();
    nameEl.value = ""; emailEl.value = "";
    renderSettings();
    renderRecipientChip();
    toast("Recipient added");
  }

  function clearHistory() {
    if (!state.notes.length) return;
    if (confirm("Clear all note history? This can't be undone.")) {
      state.notes = [];
      saveState();
      renderHistory();
      renderStreak();
      toast("History cleared");
    }
  }

  /* ---------------- install prompt ---------------- */

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (!isStandalone) $("#install-banner").classList.add("show");
  });
  window.addEventListener("appinstalled", () => {
    $("#install-banner").classList.remove("show");
    toast("Notewire installed");
  });

  async function doInstall() {
    if (!deferredPrompt) { toast("Use your browser's install option in the address bar or menu"); return; }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("#install-banner").classList.remove("show");
  }

  /* ---------------- wire up ---------------- */

  function init() {
    $$(".nav-btn").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $$(".rail-item").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("#topbar-settings").addEventListener("click", () => setTab("settings"));

    $("#note-text").addEventListener("input", updateSendState);
    $("#send-btn").addEventListener("click", sendNote);

    $("#tool-camera").addEventListener("click", () => $("#file-camera").click());
    $("#file-camera").addEventListener("change", (e) => addFiles(e.target.files, "image").then(() => e.target.value = ""));

    $("#tool-gallery").addEventListener("click", () => $("#file-gallery").click());
    $("#file-gallery").addEventListener("change", (e) => addFiles(e.target.files).then(() => e.target.value = ""));

    $("#tool-file").addEventListener("click", () => $("#file-any").click());
    $("#file-any").addEventListener("change", (e) => addFiles(e.target.files).then(() => e.target.value = ""));

    $("#tool-mic").addEventListener("click", toggleRecording);

    $("#recipient-chip").addEventListener("click", () => setTab("settings"));

    $("#add-recipient-btn").addEventListener("click", addRecipient);
    $("#clear-history-btn").addEventListener("click", clearHistory);
    $("#install-go").addEventListener("click", doInstall);
    $("#install-settings-btn").addEventListener("click", doInstall);

    renderRecipientChip();
    renderAttachmentTray();
    updateSendState();
    renderStreak();
    setTab("compose");

    if (new URLSearchParams(location.search).get("compose") === "1") {
      $("#note-text").focus();
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
