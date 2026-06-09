import { useState, useEffect, useCallback } from "react";

// ── Storage keys ──────────────────────────────────────────────
const K = {
  ROSTER: "ws-roster",
  SENT: "ws-sent",
  LOG: "ws-log",
  AVAIL: "ws-avail",
  TRIALS: "ws-trials",
};

// ── Helpers ───────────────────────────────────────────────────
const fp = (raw = "") => {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`;
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
};
const fdate = s => new Date(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const ftime = s => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmonth = (y, m) => new Date(y, m).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const durLabel = m => m === 30 ? "30 min" : m === 45 ? "45 min" : "1 hr";
const msToDur = (start, end) => {
  const mins = Math.round((new Date(end) - new Date(start)) / 60000);
  if (mins <= 35) return 30;
  if (mins <= 50) return 45;
  return 60;
};
const rateForStudent = (s, dur) => {
  if (s.inHome) return Math.round(80 * (dur / 60));
  if (s.customRate) return Math.round(s.customRate * (dur / 60));
  return dur; // $1/min default
};

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DEFAULT_AVAIL = {
  1: { on: true,  start: "14:00", end: "19:00" },
  2: { on: true,  start: "14:00", end: "19:00" },
  3: { on: true,  start: "14:00", end: "19:00" },
  4: { on: true,  start: "14:00", end: "19:00" },
  5: { on: true,  start: "14:00", end: "19:00" },
  6: { on: false, start: "09:00", end: "17:00" },
  0: { on: false, start: "09:00", end: "17:00" },
};

// ── SMS Templates ─────────────────────────────────────────────
const TEMPLATES = {
  confirm: (n, sn, date, time, dur, isParent) =>
    isParent
      ? `[Automated] Hi ${n}! This is a confirmation from Will's studio — ${sn}'s ${durLabel(dur)} violin lesson is scheduled for ${date} at ${time}. See you then! 🎻`
      : `[Automated] Hi ${n}! This is a confirmation from Will's studio — your ${durLabel(dur)} violin lesson is scheduled for ${date} at ${time}. See you then! 🎻`,
  monthly: (n, sn, month, dates, day, time, isParent) =>
    isParent
      ? `[Automated] Hi ${n}! Here is ${sn}'s lesson schedule for ${month} with Will: ${dates.join(", ")} — every ${day} at ${time}. 🎻`
      : `[Automated] Hi ${n}! Here is your lesson schedule for ${month} with Will: ${dates.join(", ")} — every ${day} at ${time}. 🎻`,
  reschedule: (n, sn, newDate, newTime, isParent) =>
    isParent
      ? `[Automated] Hi ${n}! This is Will's studio — ${sn}'s lesson has been rescheduled to ${newDate} at ${newTime}. Please reply if this doesn't work. 🎻`
      : `[Automated] Hi ${n}! This is Will's studio — your lesson has been rescheduled to ${newDate} at ${newTime}. Please reply if this doesn't work. 🎻`,
  extra: (n, sn, date, time, dur, isParent) =>
    isParent
      ? `[Automated] Hi ${n}! This confirms an additional ${durLabel(dur)} lesson for ${sn} with Will on ${date} at ${time}. 🎻`
      : `[Automated] Hi ${n}! This confirms an extra ${durLabel(dur)} lesson with Will on ${date} at ${time}. 🎻`,
  cancel24: (n, sn, date, isParent) =>
    isParent
      ? `[Automated] Hi ${n}! This is Will's studio — ${sn}'s lesson on ${date} has been cancelled. Since we received 24+ hours notice, a makeup lesson will be scheduled. We'll be in touch! 🎻`
      : `[Automated] Hi ${n}! Your lesson on ${date} has been cancelled. Since we received 24+ hours notice, a makeup lesson will be arranged. We'll be in touch! 🎻`,
  cancelLate: (n, sn, date, isParent) =>
    isParent
      ? `[Automated] Hi ${n}! This is Will's studio — ${sn}'s lesson on ${date} has been cancelled. As this was within 24 hours of the scheduled time, a makeup lesson is not guaranteed. Please reach out to discuss. 🎻`
      : `[Automated] Hi ${n}! Your lesson on ${date} has been cancelled with less than 24 hours notice. A makeup lesson is not guaranteed. Please reach out to Will to discuss. 🎻`,
  trialConfirm: (n, date, time) =>
    `[Automated] Hi ${n}! Will has confirmed your free 30-minute trial lesson on ${date} at ${time}. Looking forward to meeting you! 🎻`,
};

// ── PDF Invoice Generator ─────────────────────────────────────
function generateInvoiceHTML(student, lessons, month) {
  const total = lessons.reduce((sum, l) => sum + l.charge, 0);
  const rows = lessons.map(l => `
    <tr>
      <td>${fdate(l.start)}</td>
      <td>${ftime(l.start)}</td>
      <td>${durLabel(l.duration)}</td>
      <td>$${l.charge.toFixed(2)}</td>
    </tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; max-width: 680px; margin: 40px auto; color: #1a1a1a; }
    h1 { font-size: 28px; font-weight: 400; letter-spacing: -0.5px; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; }
    .meta { display: flex; justify-content: space-between; margin: 24px 0; font-size: 13px; color: #555; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th { text-align: left; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid #ccc; padding: 8px 0; }
    td { padding: 10px 0; font-size: 14px; border-bottom: 1px solid #eee; }
    .total { text-align: right; margin-top: 24px; font-size: 20px; }
    .total span { font-size: 28px; }
    .footer { margin-top: 48px; font-size: 12px; color: #999; }
  </style></head><body>
  <h1>Will's Violin Studio</h1>
  <div class="meta">
    <div><strong>Invoice for:</strong><br>${student.parentFirstName || student.firstName} ${student.parentLastName || student.lastName}<br>${student.parentPhone ? fp(student.parentPhone) : fp(student.phone)}</div>
    <div style="text-align:right"><strong>Student:</strong><br>${student.firstName} ${student.lastName}<br><strong>Period:</strong><br>${month}</div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Time</th><th>Duration</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">Total Due: <span>$${total.toFixed(2)}</span></div>
  <div class="footer">Thank you! Please remit payment at the beginning of the month.<br>Questions? Contact Will directly.</div>
  </body></html>`;
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("lessons");
  const [roster, setRoster] = useState([]);
  const [events, setEvents] = useState([]);
  const [sentIds, setSentIds] = useState({});
  const [log, setLog] = useState([]);
  const [avail, setAvail] = useState(DEFAULT_AVAIL);
  const [trials, setTrials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [calError, setCalError] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [msgOverrides, setMsgOverrides] = useState({});
  const [recipientMode, setRecipientMode] = useState({});
  const [templateType, setTemplateType] = useState({});
  const [billingMonth, setBillingMonth] = useState(() => {
    const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() };
  });

  // Roster form
  const EMPTY_FORM = { firstName:"", lastName:"", phone:"", parentFirstName:"", parentLastName:"", parentPhone:"", customRate:"", inHome: false };
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [editRosterId, setEditRosterId] = useState(null);

  // Cancel modal
  const [cancelModal, setCancelModal] = useState(null); // { ev }

  // Load storage
  useEffect(() => {
    (async () => {
      for (const [key, setter, def] of [
        [K.ROSTER, setRoster, []],
        [K.SENT, setSentIds, {}],
        [K.LOG, setLog, []],
        [K.AVAIL, setAvail, DEFAULT_AVAIL],
        [K.TRIALS, setTrials, []],
      ]) {
        try { const r = await window.storage.get(key); if (r) setter(JSON.parse(r.value)); }
        catch { setter(def); }
      }
    })();
  }, []);

  const persist = async (key, val) => { try { await window.storage.set(key, JSON.stringify(val)); } catch {} };
  const saveRoster = v => { setRoster(v); persist(K.ROSTER, v); };
  const saveSent   = v => { setSentIds(v); persist(K.SENT, v); };
  const saveLog    = v => { setLog(v); persist(K.LOG, v); };
  const saveAvail  = v => { setAvail(v); persist(K.AVAIL, v); };
  const saveTrials = v => { setTrials(v); persist(K.TRIALS, v); };

  // Fetch calendar
  const fetchLessons = useCallback(async () => {
    setLoading(true); setCalError(null);
    try {
      const now = new Date().toISOString();
      const future = new Date(Date.now() + 30*24*60*60*1000).toISOString();
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `Find upcoming violin lesson calendar events from ${now} to ${future}. Return ONLY raw JSON array with fields: id, title, start, end. No markdown.`,
          messages: [{ role: "user", content: "Find all my upcoming lesson events in the next 30 days." }],
          mcp_servers: [{ type: "url", url: "https://calendarmcp.googleapis.com/mcp/v1", name: "google-calendar" }]
        })
      });
      const data = await res.json();
      const txt = data.content?.filter(b => b.type === "text").map(b => b.text).join("");
      const parsed = JSON.parse(txt.replace(/```json|```/g,"").trim());
      setEvents(Array.isArray(parsed) ? parsed : []);
    } catch { setCalError("Couldn't load calendar. Make sure Google Calendar is connected."); setEvents([]); }
    setLoading(false);
  }, []);

  useEffect(() => { if (tab === "lessons") fetchLessons(); }, [tab]);

  // Match student
  const matchStudent = useCallback((title) => {
    const t = title.toLowerCase();
    let best = null, bestScore = 0;
    for (const s of roster) {
      const f = s.firstName.toLowerCase(), l = (s.lastName||"").toLowerCase();
      let score = (l && t.includes(f) && t.includes(l)) ? 2 : (t.includes(f) ? 1 : 0);
      if (score > bestScore) { best = s; bestScore = score; }
    }
    return bestScore > 0 ? best : null;
  }, [roster]);

  const getMode = (evId, student) => recipientMode[evId] || (student.parentPhone ? "parent" : "student");
  const getTType = (evId) => templateType[evId] || "confirm";

  // Build message
  const buildMessage = (ev, student, mode, ttype, override) => {
    if (override) return override;
    const dur = msToDur(ev.start, ev.end);
    const isParent = mode === "parent";
    const rn = isParent ? (student.parentFirstName || "there") : student.firstName;
    const sn = student.firstName;
    const d = fdate(ev.start), t = ftime(ev.start);
    switch (ttype) {
      case "confirm":    return TEMPLATES.confirm(rn, sn, d, t, dur, isParent);
      case "reschedule": return TEMPLATES.reschedule(rn, sn, d, t, isParent);
      case "extra":      return TEMPLATES.extra(rn, sn, d, t, dur, isParent);
      case "monthly":    return TEMPLATES.confirm(rn, sn, d, t, dur, isParent); // simplified
      default:           return TEMPLATES.confirm(rn, sn, d, t, dur, isParent);
    }
  };

  const openSMS = (phone, msg) => window.open(`sms:${phone}&body=${encodeURIComponent(msg)}`, "_blank");

  const markSent = (evId, student, ev) => {
    const updated = { ...sentIds, [evId]: new Date().toISOString() };
    saveSent(updated);
    // log it
    const dur = msToDur(ev.start, ev.end);
    const charge = rateForStudent(student, dur);
    const entry = { id: `${evId}-${Date.now()}`, studentId: student.id, studentName: `${student.firstName} ${student.lastName}`, start: ev.start, end: ev.end, duration: dur, charge, title: ev.title };
    saveLog([...log, entry]);
  };

  // Roster
  const addOrUpdateStudent = () => {
    if (!form.firstName.trim()) { setFormError("First name required"); return; }
    if (!form.phone && !form.parentPhone) { setFormError("At least one phone required"); return; }
    const rate = form.customRate ? parseFloat(form.customRate) : null;
    const entry = {
      id: editRosterId || Date.now(),
      firstName: form.firstName.trim(), lastName: form.lastName.trim(),
      phone: form.phone.replace(/\D/g,""),
      parentFirstName: form.parentFirstName.trim(), parentLastName: form.parentLastName.trim(),
      parentPhone: form.parentPhone.replace(/\D/g,""),
      customRate: rate, inHome: form.inHome,
    };
    saveRoster(editRosterId ? roster.map(s => s.id === editRosterId ? entry : s) : [...roster, entry]);
    setEditRosterId(null); setForm(EMPTY_FORM); setFormError("");
  };
  const startEditRoster = s => {
    setEditRosterId(s.id);
    setForm({ firstName: s.firstName, lastName: s.lastName, phone: s.phone||"", parentFirstName: s.parentFirstName||"", parentLastName: s.parentLastName||"", parentPhone: s.parentPhone||"", customRate: s.customRate||"", inHome: s.inHome||false });
    setTab("roster"); window.scrollTo({top:0,behavior:"smooth"});
  };

  // Billing
  const billableLessons = log.filter(l => {
    const d = new Date(l.start);
    return d.getFullYear() === billingMonth.y && d.getMonth() === billingMonth.m;
  });
  const byStudent = roster.map(s => ({
    student: s,
    lessons: billableLessons.filter(l => l.studentId === s.id),
  })).filter(x => x.lessons.length > 0);

  const downloadInvoice = (student, lessons) => {
    const html = generateInvoiceHTML(student, lessons, fmonth(billingMonth.y, billingMonth.m));
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `invoice-${student.lastName}-${billingMonth.y}-${billingMonth.m+1}.html`;
    a.click();
  };

  // Computed
  const matched = events.map(ev => ({ ...ev, student: matchStudent(ev.title) }));
  const confirmable = matched.filter(e => e.student);
  const unmatched = matched.filter(e => !e.student);

  // ── Styles ──
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=JetBrains+Mono:wght@300;400;500&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#111}::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
    .tab{background:none;border:none;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;padding:10px 18px;transition:all .2s;border-bottom:1px solid transparent}
    .tab.on{color:#d4a84b;border-bottom-color:#d4a84b}.tab.off{color:#444}.tab:hover{color:#9a8060}
    .card{background:#141414;border:1px solid #242420;border-radius:4px;padding:18px;margin-bottom:10px;transition:border-color .2s}
    .card:hover{border-color:#333}
    .card.green{border-color:#1e3a22}
    .btn{border:none;border-radius:3px;cursor:pointer;font-family:'JetBrains Mono',monospace;letter-spacing:0.08em;text-transform:uppercase;transition:all .15s}
    .btn-amber{background:#d4a84b;color:#0a0a0a;font-size:11px;padding:8px 16px;font-weight:500}.btn-amber:hover{background:#e8c070}
    .btn-outline{background:none;border:1px solid #333;color:#666;font-size:10px;padding:7px 14px}.btn-outline:hover{border-color:#d4a84b;color:#d4a84b}
    .btn-red{background:none;border:1px solid #3a1818;color:#7a3030;font-size:10px;padding:6px 11px}.btn-red:hover{border-color:#c04040;color:#c04040}
    .btn-blue{background:none;border:1px solid #1a2a3a;color:#3a6080;font-size:10px;padding:6px 11px}.btn-blue:hover{border-color:#4090c0;color:#4090c0}
    .btn-green{background:none;border:1px solid #1a3a22;color:#3a8050;font-size:10px;padding:7px 14px}.btn-green:hover{border-color:#40c070;color:#40c070}
    input,textarea,select{background:#1a1a1a;border:1px solid #2a2a28;border-radius:3px;color:#e8e4dc;font-family:'JetBrains Mono',monospace;font-size:12px;padding:9px 11px;outline:none;transition:border-color .2s;width:100%}
    input:focus,textarea:focus,select:focus{border-color:#d4a84b}
    input::placeholder,textarea::placeholder{color:#3a3a38}
    label{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#555;display:block;margin-bottom:5px}
    .badge{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.08em;border-radius:2px;padding:2px 7px}
    .badge-green{color:#4a9a5a;background:#142018;border:1px solid #1e3a22}
    .badge-amber{color:#d4a84b;background:#1e1808;border:1px solid #3a2e10}
    .badge-blue{color:#4a80a0;background:#101820;border:1px solid #1a3050}
    .badge-red{color:#9a4040;background:#1e1010;border:1px solid #3a1818}
    .toggle-row{display:flex;border:1px solid #242420;border-radius:3px;overflow:hidden}
    .tgl{flex:1;background:none;border:none;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;padding:6px 10px;transition:all .15s;color:#444}
    .tgl.on{background:#242420;color:#d4a84b}.tgl:hover:not(.on){color:#777}
    .divider{border:none;border-top:1px solid #1e1e1c;margin:16px 0}
    .pulse{animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .fade{animation:fade .35s ease}
    @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    textarea{resize:vertical;min-height:75px;line-height:1.55}
    .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:100;display:flex;align-items:center;justify-content:center}
    .modal{background:#141414;border:1px solid #2a2825;border-radius:6px;padding:28px;max-width:480px;width:90%}
    select option{background:#1a1a1a}
    .sec-label{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#3a3a38;margin-bottom:8px;margin-top:2px}
  `;

  const TABS = ["lessons","roster","billing","log","availability","trials"];
  const TLABELS = { lessons:"Lessons", roster:"Roster", billing:"Billing", log:"Log", availability:"Availability", trials:"Trials" };

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c0c", fontFamily:"'Cormorant Garamond',Georgia,serif", color:"#e8e4dc" }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ borderBottom:"1px solid #1a1a18", padding:"24px 28px 0" }}>
        <div style={{ maxWidth:800, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:2 }}>
            <span style={{ fontSize:20, color:"#d4a84b" }}>𝄞</span>
            <h1 style={{ fontSize:26, fontWeight:300, letterSpacing:"0.02em", fontStyle:"italic" }}>Will's Violin Studio</h1>
          </div>
          <p style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#333", letterSpacing:"0.16em", marginBottom:18 }}>STUDIO MANAGEMENT DASHBOARD</p>
          <div style={{ display:"flex", gap:0, overflowX:"auto" }}>
            {TABS.map(t => (
              <button key={t} className={`tab ${tab===t?"on":"off"}`} onClick={() => setTab(t)}>
                {TLABELS[t]}
                {t === "trials" && trials.filter(x=>x.status==="pending").length > 0 &&
                  <span style={{ marginLeft:6, background:"#d4a84b", color:"#0a0a0a", borderRadius:"50%", fontSize:8, padding:"1px 5px", fontWeight:600 }}>
                    {trials.filter(x=>x.status==="pending").length}
                  </span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:800, margin:"0 auto", padding:"24px 28px" }}>

        {/* ══ LESSONS TAB ══ */}
        {tab === "lessons" && (
          <div className="fade">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#444", letterSpacing:"0.1em" }}>
                NEXT 30 DAYS · {confirmable.length} MATCHED
              </span>
              <button className="btn btn-outline" onClick={fetchLessons} disabled={loading}>
                {loading ? <span className="pulse">syncing…</span> : "↻ refresh"}
              </button>
            </div>

            {calError && <div style={{ background:"#1a1008", border:"1px solid #3a2808", borderRadius:4, padding:14, marginBottom:16, fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#9a7030" }}>{calError}</div>}
            {loading && <div style={{ textAlign:"center", padding:60, fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#2a2a28" }}><div className="pulse">fetching calendar events…</div></div>}
            {!loading && events.length===0 && !calError && (
              <div style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:28, marginBottom:10 }}>📅</div>
                <p style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#2a2a28" }}>No upcoming lesson events found</p>
              </div>
            )}

            {!loading && confirmable.map(ev => {
              const s = ev.student;
              const isSent = !!sentIds[ev.id];
              const mode = getMode(ev.id, s);
              const ttype = getTType(ev.id);
              const overrideKey = `${ev.id}-${mode}-${ttype}`;
              const message = buildMessage(ev, s, mode, ttype, msgOverrides[overrideKey]);
              const isEditing = editingMsg === overrideKey;
              const dur = msToDur(ev.start, ev.end);
              const charge = rateForStudent(s, dur);
              const phone = mode === "parent" ? s.parentPhone : s.phone;
              const hasParent = !!s.parentPhone, hasStudent = !!s.phone;

              return (
                <div key={ev.id} className={`card fade ${isSent?"green":""}`}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                    <div>
                      <div style={{ fontSize:19, fontWeight:300, marginBottom:2 }}>{s.firstName} {s.lastName}</div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#666", letterSpacing:"0.06em" }}>
                        {fdate(ev.start)} · {ftime(ev.start)} · {durLabel(dur)}
                      </div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#3a3a38", marginTop:2 }}>{ev.title}</div>
                    </div>
                    <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#8a7040" }}>${charge}</span>
                      {isSent && <span className="badge badge-green">✓ sent</span>}
                    </div>
                  </div>

                  {/* Template type */}
                  <div style={{ marginBottom:12 }}>
                    <label style={{ marginBottom:5 }}>Message type</label>
                    <div className="toggle-row" style={{ maxWidth:380 }}>
                      {["confirm","reschedule","extra","monthly"].map(tt => (
                        <button key={tt} className={`tgl ${ttype===tt?"on":""}`} onClick={() => setTemplateType(x=>({...x,[ev.id]:tt}))}>{tt}</button>
                      ))}
                    </div>
                  </div>

                  {/* Recipient */}
                  {hasParent && hasStudent && (
                    <div style={{ marginBottom:12 }}>
                      <label style={{ marginBottom:5 }}>Send to</label>
                      <div className="toggle-row" style={{ maxWidth:260 }}>
                        <button className={`tgl ${mode==="student"?"on":""}`} onClick={() => setRecipientMode(r=>({...r,[ev.id]:"student"}))}>Student · {s.firstName}</button>
                        <button className={`tgl ${mode==="parent"?"on":""}`} onClick={() => setRecipientMode(r=>({...r,[ev.id]:"parent"}))}>Parent · {s.parentFirstName}</button>
                      </div>
                    </div>
                  )}

                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#555", marginBottom:12 }}>
                    → {mode==="parent" ? `${s.parentFirstName} ${s.parentLastName} · ${fp(s.parentPhone)}` : `${s.firstName} ${s.lastName} · ${fp(s.phone)}`}
                    {mode==="parent" && <span className="badge badge-blue" style={{ marginLeft:8 }}>parent</span>}
                  </div>

                  {/* Message */}
                  <div style={{ marginBottom:12 }}>
                    {isEditing ? (
                      <div>
                        <label>Edit message</label>
                        <textarea value={message} onChange={e => setMsgOverrides(o=>({...o,[overrideKey]:e.target.value}))} />
                        <div style={{ display:"flex", gap:8, marginTop:8 }}>
                          <button className="btn btn-outline" style={{ fontSize:9 }} onClick={() => setEditingMsg(null)}>done</button>
                          <button className="btn btn-outline" style={{ fontSize:9 }} onClick={() => { setMsgOverrides(o=>{const n={...o};delete n[overrideKey];return n;}); }}>reset</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ background:"#161614", border:"1px solid #1e1e1c", borderRadius:3, padding:"10px 12px", fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#b0a890", lineHeight:1.6, cursor:"pointer" }}
                        onClick={() => setEditingMsg(overrideKey)}>
                        {message}
                        <span style={{ display:"block", marginTop:5, fontSize:9, color:"#2a2a28" }}>tap to edit</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <button className="btn btn-amber" onClick={() => { openSMS(phone, message); markSent(ev.id, s, ev); }}>Send via iMessage →</button>
                    <button className="btn btn-red" onClick={() => setCancelModal({ ev, student: s })}>Cancel lesson</button>
                    {isSent && <button className="btn btn-outline" style={{ fontSize:9 }} onClick={() => { const u={...sentIds}; delete u[ev.id]; saveSent(u); }}>unsend</button>}
                  </div>
                </div>
              );
            })}

            {!loading && unmatched.length > 0 && (
              <div style={{ marginTop:20 }}>
                <p style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#333", letterSpacing:"0.12em", marginBottom:10 }}>UNMATCHED — ADD TO ROSTER</p>
                {unmatched.map(ev => (
                  <div key={ev.id} className="card" style={{ borderColor:"#2a1e08", opacity:.7 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:15 }}>{ev.title}</div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#555" }}>{fdate(ev.start)} · {ftime(ev.start)}</div>
                      </div>
                      <span className="badge badge-amber">no match</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ ROSTER TAB ══ */}
        {tab === "roster" && (
          <div className="fade">
            <div className="card" style={{ marginBottom:24, borderColor: editRosterId ? "#1e3a22" : "#242420" }}>
              <p style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color: editRosterId?"#4a7a50":"#444", letterSpacing:"0.16em", marginBottom:16 }}>
                {editRosterId ? "EDITING STUDENT" : "ADD STUDENT"}
              </p>

              <p className="sec-label">Student</p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div><label>First Name *</label><input value={form.firstName} onChange={e=>setForm(f=>({...f,firstName:e.target.value}))} /></div>
                <div><label>Last Name</label><input value={form.lastName} onChange={e=>setForm(f=>({...f,lastName:e.target.value}))} /></div>
              </div>
              <div style={{ marginBottom:16 }}><label>Student Phone</label><input value={fp(form.phone)} onChange={e=>setForm(f=>({...f,phone:e.target.value.replace(/\D/g,"")}))} /></div>

              <hr className="divider" />
              <p className="sec-label" style={{ marginTop:14 }}>Parent / Guardian <span style={{ color:"#2a2a28" }}>(optional)</span></p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div><label>First Name</label><input value={form.parentFirstName} onChange={e=>setForm(f=>({...f,parentFirstName:e.target.value}))} /></div>
                <div><label>Last Name</label><input value={form.parentLastName} onChange={e=>setForm(f=>({...f,parentLastName:e.target.value}))} /></div>
              </div>
              <div style={{ marginBottom:16 }}><label>Parent Phone</label><input value={fp(form.parentPhone)} onChange={e=>setForm(f=>({...f,parentPhone:e.target.value.replace(/\D/g,"")}))} /></div>

              <hr className="divider" />
              <p className="sec-label" style={{ marginTop:14 }}>Billing</p>
              <div style={{ marginBottom:14 }}>
                <label>Rate ($/hr)</label>
                <input type="number" value={form.customRate} onChange={e=>setForm(f=>({...f,customRate:e.target.value}))} />
              </div>

              {formError && <p style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#c04040", marginBottom:10 }}>{formError}</p>}
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn btn-amber" onClick={addOrUpdateStudent}>{editRosterId ? "Save Changes" : "+ Add Student"}</button>
                {editRosterId && <button className="btn btn-outline" onClick={() => { setEditRosterId(null); setForm(EMPTY_FORM); setFormError(""); }}>Cancel</button>}
              </div>
            </div>

            {roster.length === 0
              ? <div style={{ textAlign:"center", padding:48, fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#2a2a28" }}>No students yet</div>
              : <>
                <p style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#333", letterSpacing:"0.12em", marginBottom:12 }}>{roster.length} STUDENT{roster.length!==1?"S":""}</p>
                {roster.map(s => (
                  <div key={s.id} className="card fade">
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
                          <span style={{ fontSize:18, fontWeight:300 }}>{s.firstName} {s.lastName}</span>
                        </div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#555", marginBottom: s.parentFirstName?8:0 }}>
                          {s.phone ? fp(s.phone) : <span style={{ color:"#2a2a28" }}>no student phone</span>}
                          {s.customRate && <span style={{ color:"#666" }}>{" · "}${s.customRate}/hr</span>}
                        </div>
                        {s.parentFirstName && (
                          <div style={{ borderTop:"1px solid #1a1a18", paddingTop:8, marginTop:4 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#c0b8a0" }}>{s.parentFirstName} {s.parentLastName}</span>
                              <span className="badge badge-blue">parent</span>
                            </div>
                            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#555" }}>{s.parentPhone ? fp(s.parentPhone) : <span style={{ color:"#2a2a28" }}>no parent phone</span>}</div>
                          </div>
                        )}
                      </div>
                      <div style={{ display:"flex", gap:8, marginLeft:16, flexShrink:0 }}>
                        <button className="btn btn-blue" onClick={() => startEditRoster(s)}>Edit</button>
                        <button className="btn btn-red" onClick={() => saveRoster(roster.filter(x=>x.id!==s.id))}>Remove</button>
                      </div>
                    </div>
                  </div>
                ))}
              </>}
          </div>
        )}

        {/* ══ BILLING TAB ══ */}
        {tab === "billing" && (
          <div className="fade">
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
              <button className="btn btn-outline" onClick={() => setBillingMonth(b => { const d=new Date(b.y,b.m-1); return {y:d.getFullYear(),m:d.getMonth()}; })}>← prev</button>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, color:"#d4a84b", minWidth:160, textAlign:"center" }}>{fmonth(billingMonth.y, billingMonth.m)}</span>
              <button className="btn btn-outline" onClick={() => setBillingMonth(b => { const d=new Date(b.y,b.m+1); return {y:d.getFullYear(),m:d.getMonth()}; })}>next →</button>
            </div>

            {byStudent.length === 0
              ? <div style={{ textAlign:"center", padding:48, fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#2a2a28" }}>No logged lessons for this month.<br/><span style={{ fontSize:9, marginTop:6, display:"block" }}>Lessons are logged when you click "Send via iMessage"</span></div>
              : byStudent.map(({ student: s, lessons }) => {
                const total = lessons.reduce((sum,l)=>sum+l.charge,0);
                const mins = lessons.reduce((sum,l)=>sum+l.duration,0);
                return (
                  <div key={s.id} className="card fade">
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                      <div>
                        <div style={{ fontSize:19, fontWeight:300 }}>{s.firstName} {s.lastName}</div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#555" }}>
                          {lessons.length} lesson{lessons.length!==1?"s":""} · {mins} min total
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, color:"#d4a84b" }}>${total}</div>
                        <button className="btn btn-green" style={{ marginTop:8 }} onClick={() => downloadInvoice(s, lessons)}>↓ Invoice PDF</button>
                      </div>
                    </div>
                    <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <thead>
                        <tr>{["Date","Time","Duration","Charge"].map(h => <th key={h} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, letterSpacing:"0.12em", textTransform:"uppercase", color:"#444", textAlign:"left", borderBottom:"1px solid #1e1e1c", paddingBottom:6 }}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {lessons.map(l => (
                          <tr key={l.id}>
                            {[fdate(l.start), ftime(l.start), durLabel(l.duration), `$${l.charge}`].map((v,i) => (
                              <td key={i} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#888", padding:"7px 0", borderBottom:"1px solid #141412" }}>{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}

            {byStudent.length > 0 && (
              <div style={{ textAlign:"right", marginTop:8, fontFamily:"'JetBrains Mono',monospace", fontSize:13, color:"#888" }}>
                Month total: <span style={{ color:"#d4a84b", fontSize:18 }}>${byStudent.reduce((s,{lessons:l})=>s+l.reduce((a,x)=>a+x.charge,0),0)}</span>
              </div>
            )}
          </div>
        )}

        {/* ══ LOG TAB ══ */}
        {tab === "log" && (
          <div className="fade">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#444" }}>{log.length} TOTAL LESSONS LOGGED</span>
              {log.length > 0 && <button className="btn btn-red" style={{ fontSize:9 }} onClick={() => { if(window.confirm("Clear entire log?")) saveLog([]); }}>clear log</button>}
            </div>
            {log.length === 0
              ? <div style={{ textAlign:"center", padding:48, fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#2a2a28" }}>No lessons logged yet</div>
              : [...log].reverse().map(l => (
                <div key={l.id} className="card fade" style={{ padding:"12px 16px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <span style={{ fontSize:16, fontWeight:300 }}>{l.studentName}</span>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#555", marginTop:2 }}>{fdate(l.start)} · {ftime(l.start)} · {durLabel(l.duration)}</div>
                    </div>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, color:"#8a7040" }}>${l.charge}</span>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* ══ AVAILABILITY TAB ══ */}
        {tab === "availability" && (
          <div className="fade">
            <p style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#444", letterSpacing:"0.14em", marginBottom:18 }}>WEEKLY AVAILABILITY · shown on public booking page</p>
            {[1,2,3,4,5,6,0].map(d => {
              const day = avail[d] || { on:false, start:"14:00", end:"19:00" };
              return (
                <div key={d} className="card" style={{ padding:"14px 18px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                  <div style={{ width:38, fontFamily:"'JetBrains Mono',monospace", fontSize:12, color: day.on?"#d4a84b":"#333" }}>{DAYS[d]}</div>
                  <button className={`btn ${day.on?"btn-amber":"btn-outline"}`} style={{ fontSize:9, padding:"5px 12px" }}
                    onClick={() => { const u={...avail,[d]:{...day,on:!day.on}}; saveAvail(u); }}>
                    {day.on ? "Open" : "Closed"}
                  </button>
                  {day.on && <>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <input type="time" style={{ width:110 }} value={day.start} onChange={e => saveAvail({...avail,[d]:{...day,start:e.target.value}})} />
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#444" }}>to</span>
                      <input type="time" style={{ width:110 }} value={day.end} onChange={e => saveAvail({...avail,[d]:{...day,end:e.target.value}})} />
                    </div>
                    {(d===6||d===0) && <span className="badge badge-blue">makeup day</span>}
                  </>}
                </div>
              );
            })}
            <div style={{ marginTop:16, fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#2a2a28", lineHeight:1.7 }}>
              Changes sync to the public booking page automatically.<br/>
              Weekends marked as makeup days are shown as limited availability.
            </div>
          </div>
        )}

        {/* ══ TRIALS TAB ══ */}
        {tab === "trials" && (
          <div className="fade">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#444" }}>
                {trials.filter(t=>t.status==="pending").length} PENDING · {trials.filter(t=>t.status==="confirmed").length} CONFIRMED
              </span>
              <button className="btn btn-outline" style={{ fontSize:9 }} onClick={() => {
                const t = { id: Date.now(), name:"Alex Johnson", phone:"5595550199", email:"alex@example.com", requestedDate:"2026-06-10T16:00:00", message:"Interested in lessons for my 10-year-old.", status:"pending", createdAt:new Date().toISOString() };
                saveTrials([...trials, t]);
              }}>+ demo trial request</button>
            </div>

            {trials.length === 0
              ? <div style={{ textAlign:"center", padding:48, fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#2a2a28" }}>No trial requests yet.<br/><span style={{ fontSize:9, display:"block", marginTop:6 }}>New requests from the booking page will appear here.</span></div>
              : [...trials].reverse().map(t => (
                <div key={t.id} className="card fade">
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                    <div>
                      <div style={{ fontSize:18, fontWeight:300, marginBottom:3 }}>{t.name}</div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#555" }}>
                        {fp(t.phone)} · {t.email}
                      </div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#666", marginTop:4 }}>
                        Requested: {fdate(t.requestedDate)} · {ftime(t.requestedDate)}
                      </div>
                      {t.message && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#555", marginTop:6, fontStyle:"italic" }}>"{t.message}"</div>}
                    </div>
                    <span className={`badge ${t.status==="pending"?"badge-amber":t.status==="confirmed"?"badge-green":"badge-red"}`}>{t.status}</span>
                  </div>
                  {t.status === "pending" && (
                    <div style={{ display:"flex", gap:8 }}>
                      <button className="btn btn-amber" onClick={() => {
                        const msg = TEMPLATES.trialConfirm(t.name.split(" ")[0], fdate(t.requestedDate), ftime(t.requestedDate));
                        openSMS(t.phone, msg);
                        saveTrials(trials.map(x => x.id===t.id ? {...x,status:"confirmed"} : x));
                      }}>Confirm + Send SMS →</button>
                      <button className="btn btn-red" onClick={() => saveTrials(trials.map(x => x.id===t.id ? {...x,status:"declined"} : x))}>Decline</button>
                    </div>
                  )}
                  {t.status === "confirmed" && (
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#3a6040" }}>✓ Confirmation sent · Add to roster after trial</div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ══ CANCEL MODAL ══ */}
      {cancelModal && (() => {
        const { ev, student: s } = cancelModal;
        const lessonDate = new Date(ev.start);
        const hoursUntil = (lessonDate - Date.now()) / 36e5;
        const is24 = hoursUntil >= 24;
        const parentName = s.parentFirstName || s.firstName;
        const msgFn = is24 ? TEMPLATES.cancel24 : TEMPLATES.cancelLate;
        const msg = msgFn(parentName, s.firstName, fdate(ev.start), true);
        const phone = s.parentPhone || s.phone;
        return (
          <div className="modal-bg" onClick={() => setCancelModal(null)}>
            <div className="modal fade" onClick={e => e.stopPropagation()}>
              <div style={{ fontSize:20, fontWeight:300, marginBottom:4 }}>Cancel Lesson</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#666", marginBottom:18 }}>
                {s.firstName} {s.lastName} · {fdate(ev.start)} · {ftime(ev.start)}
              </div>
              <div style={{ marginBottom:16 }}>
                <span className={`badge ${is24?"badge-green":"badge-red"}`}>
                  {is24 ? `${Math.floor(hoursUntil)}h notice — makeup granted` : `< 24h notice — makeup at your discretion`}
                </span>
              </div>
              <div style={{ background:"#161614", border:"1px solid #1e1e1c", borderRadius:3, padding:"10px 12px", fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#b0a890", lineHeight:1.6, marginBottom:18 }}>
                {msg}
              </div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#555", marginBottom:18 }}>
                → Sending to parent: {parentName} · {fp(phone)}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn btn-red" onClick={() => { openSMS(phone, msg); setCancelModal(null); }}>Send Cancellation SMS →</button>
                <button className="btn btn-outline" onClick={() => setCancelModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
