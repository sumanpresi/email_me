(() => {
  "use strict";

  /* ---------------- helpers ---------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const URL_RE = /\bhttps?:\/\/[^\s]+/i;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- storage / state (v2: contacts + groups) ---------------- */

  const STORE_KEY = "notewire:v2";
  const OLD_STORE_KEY = "notewire:v1";
  const DEFAULT_SENDING_ACCOUNT = "sumanpresi86geology@gmail.com";
  const DEFAULT_COUNTRY_CODE = "91";

  function freshState() {
    return {
      sendingAccount: DEFAULT_SENDING_ACCOUNT,
      whatsappNumber: "",
      countryCode: DEFAULT_COUNTRY_CODE,
      contacts: [
        { id: uid(), name: "Suman Das", email: "sumanpresi.geology@gmail.com", phone: "", favourite: false, groups: [] }
      ],
      groups: [],
      notes: [],
    };
  }

  function migrateFromV1() {
    try {
      const raw = localStorage.getItem(OLD_STORE_KEY);
      if (!raw) return null;
      const old = JSON.parse(raw);
      const s = freshState();
      s.contacts = [];
      s.sendingAccount = old.sendingAccount || DEFAULT_SENDING_ACCOUNT;
      (old.recipients || []).forEach(r => {
        s.contacts.push({ id: r.id || uid(), name: r.name, email: r.email || "", phone: "", favourite: false, groups: [] });
      });
      if (!s.contacts.length) s.contacts = freshState().contacts;
      // Old notes carried a plain "recipient" email string — keep them, adapted to the new shape.
      s.notes = (old.notes || []).map(n => {
        const contact = s.contacts.find(c => c.email === n.recipient);
        return {
          ...n,
          method: "email",
          recipients: contact ? [{ id: contact.id, name: contact.name, email: contact.email, phone: "" }] : (n.recipient ? [{ id: null, name: n.recipient, email: n.recipient, phone: "" }] : []),
          status: n.status === "sent" ? "gmail_opened" : n.status,
        };
      });
      return s;
    } catch (e) { return null; }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (!s.contacts) s.contacts = [];
        if (!s.groups) s.groups = [];
        if (!s.notes) s.notes = [];
        if (!s.countryCode) s.countryCode = DEFAULT_COUNTRY_CODE;
        if (!s.sendingAccount) s.sendingAccount = DEFAULT_SENDING_ACCOUNT;
        return s;
      }
    } catch (e) { /* ignore corrupt state */ }

    const migrated = migrateFromV1();
    if (migrated) return migrated;

    return freshState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Storage is full — try clearing old notes or attachments");
    }
  }

  const state = loadState();

  /* ---------------- misc helpers ---------------- */

  function toast(msg, ms = 2400) {
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

  /* ---------------- phone / WhatsApp helpers ---------------- */

  // Cleans a raw phone number into E.164-ish form (+countrycode + digits),
  // filling in the default country code only when the number has none.
  function normalizePhone(raw) {
    if (!raw) return "";
    let s = String(raw).trim().replace(/[()\-.\s]/g, "");
    if (s.startsWith("00")) s = "+" + s.slice(2);
    if (!s.startsWith("+")) {
      const digits = s.replace(/\D/g, "");
      s = digits.length <= 10 ? "+" + (state.countryCode || DEFAULT_COUNTRY_CODE) + digits : "+" + digits;
    } else {
      s = "+" + s.slice(1).replace(/\D/g, "");
    }
    return s;
  }

  function waLink(rawPhone, message) {
    const e164 = normalizePhone(rawPhone);
    const number = e164.replace(/^\+/, "");
    return `https://wa.me/${number}?text=${encodeURIComponent(message || "")}`;
  }

  function openWhatsApp(rawPhone, message) {
    const win = window.open(waLink(rawPhone, message), "_blank", "noopener");
    // A null return, or a window that is immediately closed, usually means a popup blocker stepped in.
    if (!win) return "blocked";
    return "opened";
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
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  function iconFor(cat) {
    return ICONS[({ images: "image", audio: "audio", links: "link", files: "file", text: "text" })[cat]] || ICONS.file;
  }

  /* ---------------- shell / nav ---------------- */

  let activeTab = "compose";

  function setTab(tab) {
    activeTab = tab;
    $$(".panel").forEach(p => p.classList.toggle("active", p.id === `panel-${tab}`));
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".rail-item").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    if (tab === "history") renderHistory();
    if (tab === "settings") renderSettings();
  }

  /* ================================================================
     CONTACTS + GROUPS
     ================================================================ */

  function contactById(id) { return state.contacts.find(c => c.id === id); }
  function groupById(id) { return state.groups.find(g => g.id === id); }
  function groupMembers(groupId) { return state.contacts.filter(c => (c.groups || []).includes(groupId)); }

  function addContact(name, email, phone) {
    const c = { id: uid(), name, email: email || "", phone: phone ? normalizePhone(phone) : "", favourite: false, groups: [] };
    state.contacts.push(c);
    saveState();
    return c;
  }

  function removeContact(id) {
    state.contacts = state.contacts.filter(c => c.id !== id);
    saveState();
  }

  function addGroup(name) {
    const g = { id: uid(), name };
    state.groups.push(g);
    saveState();
    return g;
  }

  function removeGroup(id) {
    state.groups = state.groups.filter(g => g.id !== id);
    state.contacts.forEach(c => { c.groups = (c.groups || []).filter(gid => gid !== id); });
    saveState();
  }

  /* ---------------- contact management (Settings) ---------------- */

  function renderContactManageList() {
    const list = $("#contact-manage-list");
    list.innerHTML = "";
    if (!state.contacts.length) {
      list.innerHTML = `<div class="settings-item"><div><div class="label">No contacts yet</div><div class="sub">Add one below</div></div></div>`;
      return;
    }
    state.contacts.forEach(c => {
      const item = document.createElement("div");
      item.className = "settings-item contact-manage-item";
      const groupNames = (c.groups || []).map(gid => groupById(gid)?.name).filter(Boolean).join(", ");
      item.innerHTML = `
        <div>
          <div class="label">${escapeHtml(c.name)} ${c.favourite ? "★" : ""}</div>
          <div class="sub">${[c.email, c.phone].filter(Boolean).map(escapeHtml).join(" · ") || "No email or phone"}${groupNames ? " · " + escapeHtml(groupNames) : ""}</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="fav-toggle" aria-label="Favourite">${c.favourite ? "★" : "☆"}</button>
          <button class="remove" aria-label="Remove">${ICONS.x}</button>
        </div>
      `;
      item.querySelector(".fav-toggle").addEventListener("click", () => {
        c.favourite = !c.favourite;
        saveState();
        renderContactManageList();
      });
      item.querySelector(".remove").addEventListener("click", () => {
        removeContact(c.id);
        renderContactManageList();
      });
      list.appendChild(item);
    });
  }

  function renderGroupManageList() {
    const list = $("#group-manage-list");
    list.innerHTML = "";
    if (!state.groups.length) {
      list.innerHTML = `<div class="settings-item"><div><div class="label">No groups yet</div><div class="sub">Create one below, e.g. "GSI Officers"</div></div></div>`;
      return;
    }
    state.groups.forEach(g => {
      const members = groupMembers(g.id);
      const item = document.createElement("div");
      item.className = "settings-item group-manage-item";
      item.innerHTML = `
        <div>
          <div class="label">${escapeHtml(g.name)}</div>
          <div class="sub">${members.length} member${members.length === 1 ? "" : "s"}</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="manage-members-btn">Members</button>
          <button class="remove" aria-label="Delete group">${ICONS.x}</button>
        </div>
      `;
      item.querySelector(".manage-members-btn").addEventListener("click", () => openGroupMembersEditor(g.id));
      item.querySelector(".remove").addEventListener("click", () => {
        if (confirm(`Delete group "${g.name}"? Contacts are kept.`)) {
          removeGroup(g.id);
          renderGroupManageList();
        }
      });
      list.appendChild(item);
    });
  }

  function openGroupMembersEditor(groupId) {
    const g = groupById(groupId);
    if (!g) return;
    if (!state.contacts.length) { toast("Add some contacts first"); return; }
    const lines = state.contacts.map(c => {
      const checked = (c.groups || []).includes(groupId);
      return `${checked ? "[x]" : "[ ]"} ${c.name}`;
    });
    // Simple, dependency-free member editor: toggle each contact via a prompt-free checklist panel.
    const panel = document.createElement("div");
    panel.className = "modal-overlay";
    panel.style.display = "flex";
    panel.innerHTML = `
      <div class="modal-panel">
        <div class="modal-header"><h3>${escapeHtml(g.name)} members</h3><button class="modal-close">✕</button></div>
        <div class="contact-list" style="max-height:50vh"></div>
        <div class="modal-footer"><button class="confirm-select-btn" style="opacity:1">Done</button></div>
      </div>`;
    document.body.appendChild(panel);
    const listEl = panel.querySelector(".contact-list");
    state.contacts.forEach(c => {
      const row = document.createElement("label");
      row.className = "contact-item";
      const checked = (c.groups || []).includes(groupId);
      row.innerHTML = `
        <div class="avatar">${(c.name.trim()[0] || "?").toUpperCase()}</div>
        <div class="info"><div class="name">${escapeHtml(c.name)}</div><div class="sub">${[c.email, c.phone].filter(Boolean).map(escapeHtml).join(" · ")}</div></div>
        <input type="checkbox" class="select-check" ${checked ? "checked" : ""}>
      `;
      row.querySelector("input").addEventListener("change", (e) => {
        c.groups = c.groups || [];
        if (e.target.checked) { if (!c.groups.includes(groupId)) c.groups.push(groupId); }
        else c.groups = c.groups.filter(id => id !== groupId);
        saveState();
      });
      listEl.appendChild(row);
    });
    function close() { panel.remove(); renderGroupManageList(); }
    panel.querySelector(".modal-close").addEventListener("click", close);
    panel.querySelector(".confirm-select-btn").addEventListener("click", close);
    panel.addEventListener("click", (e) => { if (e.target === panel) close(); });
  }

  /* ---------------- contact picker modal (Compose) ---------------- */

  let pickerMulti = false;
  let pickerSelection = []; // array of contact ids
  let pickerTab = "all";

  function openContactPicker() {
    pickerSelection = selectedRecipients.map(c => c.id);
    pickerMulti = selectedRecipients.length > 1;
    pickerTab = "all";
    $("#multi-toggle-check").checked = pickerMulti;
    $("#contact-search").value = "";
    $$(".mtab").forEach(t => t.classList.toggle("active", t.dataset.mtab === "all"));
    renderContactPickerList();
    $("#contact-modal").classList.add("show");
  }

  function closeContactPicker() {
    $("#contact-modal").classList.remove("show");
  }

  function renderContactPickerList() {
    const listEl = $("#contact-list");
    listEl.innerHTML = "";
    const q = $("#contact-search").value.trim().toLowerCase();

    if (pickerTab === "groups") {
      if (!state.groups.length) {
        listEl.innerHTML = `<div class="empty-state small">No groups yet — create one in Settings → Contact groups.</div>`;
      }
      state.groups.forEach(g => {
        const members = groupMembers(g.id);
        if (q && !g.name.toLowerCase().includes(q)) return;
        const row = document.createElement("div");
        row.className = "contact-item group-item";
        row.innerHTML = `
          <div class="avatar">${(g.name.trim()[0] || "G").toUpperCase()}</div>
          <div class="info"><div class="name">${escapeHtml(g.name)}</div><div class="sub">${members.length} member${members.length === 1 ? "" : "s"}</div></div>
          <button class="use-group-btn">Use group</button>
        `;
        row.querySelector(".use-group-btn").addEventListener("click", () => {
          pickerMulti = true;
          $("#multi-toggle-check").checked = true;
          pickerSelection = members.map(m => m.id);
          updateConfirmButton();
          renderContactPickerList();
          pickerTab = "all";
          $$(".mtab").forEach(t => t.classList.toggle("active", t.dataset.mtab === "all"));
        });
        listEl.appendChild(row);
      });
      return;
    }

    let contacts = state.contacts;
    if (pickerTab === "fav") contacts = contacts.filter(c => c.favourite);
    if (q) {
      contacts = contacts.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, ""))
      );
    }
    contacts = [...contacts].sort((a, b) => a.name.localeCompare(b.name));

    if (!contacts.length) {
      listEl.innerHTML = `<div class="empty-state small">No contacts found.</div>`;
      return;
    }

    contacts.forEach(c => {
      const row = document.createElement("label");
      row.className = "contact-item";
      const selected = pickerSelection.includes(c.id);
      row.innerHTML = `
        <div class="avatar">${(c.name.trim()[0] || "?").toUpperCase()}</div>
        <div class="info">
          <div class="name">${escapeHtml(c.name)}</div>
          <div class="sub">${[c.email, c.phone].filter(Boolean).map(escapeHtml).join(" · ") || "No email or phone"}</div>
        </div>
        <div class="badges">
          <span class="badge ${c.email ? "" : "off"}" title="Email">✉</span>
          <span class="badge ${c.phone ? "" : "off"}" title="WhatsApp">WA</span>
        </div>
        <input type="checkbox" class="select-check" ${selected ? "checked" : ""} style="display:${pickerMulti ? "inline-block" : "none"}">
      `;
      row.addEventListener("click", (e) => {
        if (pickerMulti) {
          if (e.target.tagName !== "INPUT") {
            const cb = row.querySelector("input");
            cb.checked = !cb.checked;
          }
          const cb = row.querySelector("input");
          if (cb.checked) { if (!pickerSelection.includes(c.id)) pickerSelection.push(c.id); }
          else pickerSelection = pickerSelection.filter(id => id !== c.id);
          updateConfirmButton();
        } else {
          pickerSelection = [c.id];
          confirmContactSelection();
        }
      });
      listEl.appendChild(row);
    });
  }

  function updateConfirmButton() {
    const btn = $("#confirm-select-btn");
    btn.disabled = pickerSelection.length === 0;
    btn.textContent = pickerSelection.length > 1 ? `Select (${pickerSelection.length})` : "Select";
  }

  function confirmContactSelection() {
    selectedRecipients = pickerSelection.map(contactById).filter(Boolean);
    closeContactPicker();
    onRecipientsChanged();
  }

  /* ================================================================
     COMPOSE
     ================================================================ */

  let pendingAttachments = []; // { name, kind, dataUrl, mime }
  let mediaRecorder = null;
  let recordedChunks = [];
  let selectedRecipients = []; // array of contact objects
  let sendMethod = null; // 'email' | 'whatsapp'
  let waResults = []; // { contactId, name, status } for the current compose

  function renderSelectedRecipients() {
    const wrap = $("#selected-recipients");
    wrap.innerHTML = "";
    selectedRecipients.forEach(c => {
      const chip = document.createElement("span");
      chip.className = "recipient-tag";
      chip.innerHTML = `${escapeHtml(c.name)}<button aria-label="Remove">${ICONS.x}</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        selectedRecipients = selectedRecipients.filter(x => x.id !== c.id);
        onRecipientsChanged();
      });
      wrap.appendChild(chip);
    });
    $("#select-contact-btn").textContent = selectedRecipients.length ? "Change" : "Select contact";
  }

  function onRecipientsChanged() {
    renderSelectedRecipients();
    const methodRow = $("#method-row");
    if (!selectedRecipients.length) {
      methodRow.style.display = "none";
      sendMethod = null;
    } else {
      methodRow.style.display = "flex";
      const anyEmail = selectedRecipients.some(c => c.email);
      const anyPhone = selectedRecipients.some(c => c.phone);
      $("#method-email").disabled = !anyEmail;
      $("#method-whatsapp").disabled = !anyPhone;
      if (sendMethod === "email" && !anyEmail) sendMethod = null;
      if (sendMethod === "whatsapp" && !anyPhone) sendMethod = null;
      if (!sendMethod) sendMethod = anyEmail ? "email" : (anyPhone ? "whatsapp" : null);
    }
    waResults = [];
    renderWaStatusList();
    renderMethodButtons();
    updateSendState();
  }

  function renderMethodButtons() {
    $$(".method-btn").forEach(b => b.classList.toggle("active", b.dataset.method === sendMethod));
    $("#email-fields").style.display = sendMethod === "email" ? "flex" : "none";
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
      chip.innerHTML = `${thumb}<span class="name">${escapeHtml(a.name)}</span><button type="button" aria-label="Remove">${ICONS.x}</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        pendingAttachments.splice(i, 1);
        renderAttachmentTray();
        updateSendState();
      });
      tray.appendChild(chip);
    });
  }

  function renderWaStatusList() {
    const wrap = $("#wa-status-list");
    if (!waResults.length) { wrap.innerHTML = ""; return; }
    wrap.innerHTML = waResults.map(r => `
      <div class="wa-status-row wa-${r.status}">
        <span>${escapeHtml(r.name)}</span>
        <span class="wa-status-badge">${waStatusLabel(r.status)}</span>
      </div>
    `).join("");
  }

  function waStatusLabel(status) {
    return { ready: "Ready", opened: "WhatsApp opened", blocked: "Pop-up blocked", skipped: "Skipped — no phone", failed: "Failed" }[status] || status;
  }

  function updateSendState() {
    const hasText = $("#note-text").value.trim().length > 0;
    const btn = $("#send-btn");
    if (!selectedRecipients.length) {
      btn.disabled = true; btn.textContent = "Select a contact"; return;
    }
    if (!sendMethod) {
      btn.disabled = true; btn.textContent = "No valid sending method for this contact"; return;
    }
    const ready = hasText || pendingAttachments.length;
    btn.disabled = !ready;
    if (sendMethod === "email") {
      btn.textContent = "Send Email";
    } else {
      btn.textContent = selectedRecipients.length > 1
        ? `Open WhatsApp for ${selectedRecipients.filter(c => c.phone).length} contact${selectedRecipients.filter(c => c.phone).length === 1 ? "" : "s"}`
        : "Open WhatsApp";
    }
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

  /* ---------------- sending ---------------- */

  function resetComposeAfterSend() {
    $("#note-text").value = "";
    $("#email-subject").value = "";
    $("#email-cc").value = "";
    $("#email-bcc").value = "";
    pendingAttachments = [];
    renderAttachmentTray();
    updateSendState();
    renderStreak();
  }

  async function sendNote() {
    const text = $("#note-text").value.trim();
    if (!selectedRecipients.length || !sendMethod) return;
    if (!text && !pendingAttachments.length) return;

    if (sendMethod === "email") sendEmail(text);
    else sendWhatsApp(text);
  }

  function sendEmail(text) {
    const toContacts = selectedRecipients.filter(c => c.email);
    if (!toContacts.length) { toast("None of the selected contacts have an email address"); return; }
    const skipped = selectedRecipients.filter(c => !c.email);

    const cc = $("#email-cc").value.trim();
    const bcc = $("#email-bcc").value.trim();
    const subject = $("#email-subject").value.trim() || (text ? text.slice(0, 60) : "Message from Notewire");
    const bodyLines = [text || ""];
    if (pendingAttachments.length) {
      bodyLines.push("", `(${pendingAttachments.length} attachment${pendingAttachments.length > 1 ? "s" : ""} can't travel through a Gmail compose link — attach ${pendingAttachments.length > 1 ? "them" : "it"} manually in Gmail, or add Gmail API sending later for automatic attachments.)`);
    }
    const body = bodyLines.join("\n");

    const note = {
      id: uid(),
      text, attachments: pendingAttachments,
      timestamp: Date.now(),
      status: "pending",
      method: "email",
      recipients: toContacts.map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone })),
    };
    note.category = categoryOf(note);
    state.notes.unshift(note);
    saveState();

    const params = new URLSearchParams();
    params.set("view", "cm"); params.set("fs", "1"); params.set("tf", "1");
    params.set("to", toContacts.map(c => c.email).join(","));
    if (cc) params.set("cc", cc);
    if (bcc) params.set("bcc", bcc);
    params.set("su", subject);
    params.set("body", body);
    if (state.sendingAccount) params.set("authuser", state.sendingAccount);
    const gmailUrl = `https://mail.google.com/mail/?${params.toString()}`;

    const win = window.open(gmailUrl, "_blank", "noopener");
    if (win) {
      note.status = "gmail_opened";
      toast(skipped.length ? `Gmail opened for ${toContacts.length} — skipped ${skipped.length} with no email` : `Gmail opened as ${state.sendingAccount}`);
    } else {
      // Pop-up blocked — mailto always works, though the OS/browser then decides which account handles it.
      window.location.href = `mailto:${toContacts.map(c => c.email).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${cc ? "&cc=" + encodeURIComponent(cc) : ""}${bcc ? "&bcc=" + encodeURIComponent(bcc) : ""}`;
      note.status = "gmail_opened";
      toast("Pop-up blocked — opened your default mail app instead");
    }
    saveState();
    resetComposeAfterSend();
    if (activeTab === "history") renderHistory();
  }

  function sendWhatsApp(text) {
    const targets = selectedRecipients.filter(c => c.phone);
    const skipped = selectedRecipients.filter(c => !c.phone);
    if (!targets.length) { toast("None of the selected contacts have a phone number"); return; }

    const note = {
      id: uid(),
      text, attachments: pendingAttachments,
      timestamp: Date.now(),
      status: "pending",
      method: "whatsapp",
      recipients: selectedRecipients.map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone })),
      waStatuses: [],
    };
    note.category = categoryOf(note);

    if (pendingAttachments.length) {
      toast(`Note: attachments aren't sent through the WhatsApp link — ${pendingAttachments.length > 1 ? "attach them" : "attach it"} manually in WhatsApp after it opens.`);
    }

    waResults = skipped.map(c => ({ contactId: c.id, name: c.name, status: "skipped" }));

    targets.forEach((c, i) => {
      // Stagger window.open calls slightly — opening many tabs in the same tick is what most
      // often triggers a browser's popup blocker.
      setTimeout(() => {
        const result = openWhatsApp(c.phone, text);
        const entry = { contactId: c.id, name: c.name, status: result };
        waResults.push(entry);
        note.waStatuses.push(entry);
        renderWaStatusList();
        if (waResults.length === selectedRecipients.length) finalizeWaNote(note);
      }, i * 500);
    });

    if (!targets.length) finalizeWaNote(note);

    state.notes.unshift(note);
    saveState();
    resetComposeAfterSend();
  }

  function finalizeWaNote(note) {
    const opened = note.waStatuses.filter(s => s.status === "opened").length;
    const blocked = note.waStatuses.filter(s => s.status === "blocked").length;
    if (opened === 0) note.status = "failed";
    else if (blocked > 0 || note.recipients.length > opened) note.status = "partial";
    else note.status = "whatsapp_opened";
    saveState();
    if (blocked) toast(`${blocked} WhatsApp window${blocked > 1 ? "s were" : " was"} blocked — please allow pop-ups and retry`);
    if (activeTab === "history") renderHistory();
  }

  function retrySend(id) {
    const n = state.notes.find(n => n.id === id);
    if (!n) return;
    if (n.method === "whatsapp") {
      const targets = n.recipients.filter(r => r.phone);
      const results = [];
      targets.forEach((r, i) => {
        setTimeout(() => {
          const status = openWhatsApp(r.phone, n.text);
          results.push({ contactId: r.id, name: r.name, status });
          if (results.length === targets.length) {
            n.waStatuses = results;
            finalizeWaNote(n);
          }
        }, i * 500);
      });
    } else {
      const params = new URLSearchParams();
      params.set("view", "cm"); params.set("fs", "1"); params.set("tf", "1");
      params.set("to", n.recipients.map(r => r.email).filter(Boolean).join(","));
      params.set("su", n.text ? n.text.slice(0, 60) : "Message from Notewire");
      params.set("body", n.text || "");
      if (state.sendingAccount) params.set("authuser", state.sendingAccount);
      window.open(`https://mail.google.com/mail/?${params.toString()}`, "_blank", "noopener");
      n.status = "gmail_opened";
      saveState();
      renderHistory();
    }
  }

  /* ---------------- history ---------------- */

  let activeFilter = "all";
  const FILTERS = [
    { id: "all", label: "All" },
    { id: "email", label: "Email" },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "images", label: "Images" },
    { id: "audio", label: "Audio" },
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
    if (note.attachments && note.attachments.length) return note.attachments[0].name;
    return "Note";
  }

  function noteStatusText(note) {
    const names = (note.recipients || []).map(r => r.name).join(", ") || "recipient";
    if (note.status === "pending") return `<span class="status-pending">Sending to ${escapeHtml(names)}…</span>`;
    if (note.status === "gmail_opened") return `Gmail opened for ${escapeHtml(names)} · ${timeAgo(note.timestamp)}`;
    if (note.status === "whatsapp_opened") {
      if (note.recipients.length > 1) return `WhatsApp opened for all ${note.recipients.length} contacts · ${timeAgo(note.timestamp)}`;
      return `WhatsApp opened for ${escapeHtml(names)} · ${timeAgo(note.timestamp)}`;
    }
    if (note.status === "partial") {
      const opened = (note.waStatuses || []).filter(s => s.status === "opened").length;
      return `${opened} of ${note.recipients.length} opened, rest blocked/skipped · ${timeAgo(note.timestamp)}`;
    }
    if (note.status === "failed") return `Failed to open for ${escapeHtml(names)} · ${timeAgo(note.timestamp)}`;
    return `${escapeHtml(names)} · ${timeAgo(note.timestamp)}`;
  }

  function noteRowEl(note) {
    const row = document.createElement("div");
    row.className = "note-row";
    let iconHTML = iconFor(note.category);
    let imgThumb = "";
    if (note.category === "images" && note.attachments && note.attachments[0]) imgThumb = `<img src="${note.attachments[0].dataUrl}" alt="">`;
    const methodTag = note.method === "whatsapp" ? "WhatsApp" : "Email";
    const needsRetry = note.status === "pending" || note.status === "failed" || note.status === "partial";
    row.innerHTML = `
      <div class="icon">${imgThumb || iconHTML}</div>
      <div class="body">
        <div class="title">${escapeHtml(methodTag)} · ${escapeHtml(noteTitle(note))}</div>
        <div class="meta">${noteStatusText(note)}</div>
      </div>
      ${needsRetry ? `<button class="retry">Retry</button>` : ""}
    `;
    if (needsRetry) row.querySelector(".retry").addEventListener("click", () => retrySend(note.id));
    return row;
  }

  function renderHistory() {
    renderFilterRow();
    const scroll = $("#history-scroll");
    scroll.innerHTML = "";
    let notes = state.notes;
    if (activeFilter === "email" || activeFilter === "whatsapp") notes = notes.filter(n => n.method === activeFilter);
    else if (activeFilter !== "all") notes = notes.filter(n => n.category === activeFilter);

    if (!notes.length) {
      scroll.innerHTML = `<div class="empty-state"><div class="glyph">✎</div><p>Nothing here yet — messages you send will show up in this list.</p></div>`;
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
      label.textContent = "Sent";
      scroll.appendChild(label);
      sent.forEach(n => scroll.appendChild(noteRowEl(n)));
    }
  }

  /* ---------------- streak ---------------- */

  function renderStreak() {
    const sentDates = new Set(state.notes.filter(n => n.status && n.status !== "pending" && n.status !== "failed").map(n => localDateKey(n.timestamp)));
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
    $("#sending-account-input").value = state.sendingAccount || "";
    $("#whatsapp-number-input").value = state.whatsappNumber || "";
    $("#country-code-input").value = state.countryCode || DEFAULT_COUNTRY_CODE;
    renderContactManageList();
    renderGroupManageList();
  }

  function saveSendingAccount() {
    const input = $("#sending-account-input");
    const email = input.value.trim();
    if (!EMAIL_RE.test(email)) { toast("Enter a valid email address"); return; }
    state.sendingAccount = email;
    saveState();
    toast("Sending account saved");
  }

  function saveWhatsappNumber() {
    const raw = $("#whatsapp-number-input").value.trim();
    state.whatsappNumber = raw ? normalizePhone(raw) : "";
    saveState();
    toast("WhatsApp number saved");
  }

  function saveCountryCode() {
    const cc = $("#country-code-input").value.trim().replace(/\D/g, "");
    state.countryCode = cc || DEFAULT_COUNTRY_CODE;
    saveState();
  }

  function testWhatsApp() {
    if (!state.whatsappNumber) { toast("Add your WhatsApp number above first"); return; }
    openWhatsApp(state.whatsappNumber, "Test message from Notewire ✅");
  }

  function addContactFromSettings() {
    const name = $("#new-contact-name").value.trim();
    const email = $("#new-contact-email").value.trim();
    const phone = $("#new-contact-phone").value.trim();
    if (!name) { toast("Enter a name"); return; }
    if (email && !EMAIL_RE.test(email)) { toast("Enter a valid email, or leave it blank"); return; }
    if (!email && !phone) { toast("Add an email, a phone number, or both"); return; }
    addContact(name, email, phone);
    $("#new-contact-name").value = ""; $("#new-contact-email").value = ""; $("#new-contact-phone").value = "";
    renderContactManageList();
    toast("Contact added");
  }

  function addGroupFromSettings() {
    const name = $("#new-group-name").value.trim();
    if (!name) { toast("Enter a group name"); return; }
    addGroup(name);
    $("#new-group-name").value = "";
    renderGroupManageList();
    toast("Group created");
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

    // Contact picker
    $("#select-contact-btn").addEventListener("click", openContactPicker);
    $("#modal-close").addEventListener("click", closeContactPicker);
    $("#contact-modal").addEventListener("click", (e) => { if (e.target.id === "contact-modal") closeContactPicker(); });
    $("#contact-search").addEventListener("input", renderContactPickerList);
    $$(".mtab").forEach(t => t.addEventListener("click", () => {
      pickerTab = t.dataset.mtab;
      $$(".mtab").forEach(x => x.classList.toggle("active", x === t));
      renderContactPickerList();
    }));
    $("#multi-toggle-check").addEventListener("change", (e) => {
      pickerMulti = e.target.checked;
      if (!pickerMulti && pickerSelection.length > 1) pickerSelection = pickerSelection.slice(0, 1);
      renderContactPickerList();
      updateConfirmButton();
    });
    $("#confirm-select-btn").addEventListener("click", confirmContactSelection);

    // Method toggle
    $("#method-email").addEventListener("click", () => { if (!$("#method-email").disabled) { sendMethod = "email"; renderMethodButtons(); updateSendState(); } });
    $("#method-whatsapp").addEventListener("click", () => { if (!$("#method-whatsapp").disabled) { sendMethod = "whatsapp"; renderMethodButtons(); updateSendState(); } });

    // Settings
    $("#add-contact-btn").addEventListener("click", addContactFromSettings);
    $("#add-group-btn").addEventListener("click", addGroupFromSettings);
    $("#save-sending-account-btn").addEventListener("click", saveSendingAccount);
    $("#save-whatsapp-number-btn").addEventListener("click", saveWhatsappNumber);
    $("#country-code-input").addEventListener("change", saveCountryCode);
    $("#test-wa-btn").addEventListener("click", testWhatsApp);
    $("#clear-history-btn").addEventListener("click", clearHistory);
    $("#install-go").addEventListener("click", doInstall);
    $("#install-settings-btn").addEventListener("click", doInstall);

    onRecipientsChanged();
    renderAttachmentTray();
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
