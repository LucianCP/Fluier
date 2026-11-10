/* =====================================================================
   FLUIER – aplicația (conturi, antrenament, asociații, teste, rapoarte)
   Nu trebuie modificat nimic aici pentru a porni. Setările sunt în config.js,
   textele interfeței în lang/ro.json (și lang/en.json pentru viitor).
   ===================================================================== */
(async function(){
"use strict";

const CFG = window.FLUIER_CONFIG || {};
await I18N.init("ro");                         // pornim în română; limba din profil se aplică după autentificare
const t = (k, v) => I18N.t(k, v);
if(t("app.loading")==="app.loading"){   // fișierele de traducere lipsesc
  document.querySelector("#app").innerHTML = '<div class="notice warn"><b>Lipsește folderul <code>lang</code>.</b><br>Urcă pe GitHub și folderul <code>lang</code> (cu <code>ro.json</code> și <code>en.json</code>), lângă <code>index.html</code>.</div>';
  return;
}

// numele legilor: se încarcă din tabelul `laws` (aici e doar rezerva, dacă tabelul lipsește)
const LAWS = {1:"Terenul de joc",2:"Mingea",3:"Jucătorii",4:"Echipamentul jucătorilor",5:"Arbitrul",
  6:"Alți oficiali de meci",7:"Durata meciului",8:"Începerea și reluarea jocului",9:"Mingea în joc și afară din joc",
  10:"Stabilirea rezultatului meciului",11:"Ofsaidul",12:"Faulturi și comportament nesportiv",13:"Loviturile libere",
  14:"Lovitura de pedeapsă",15:"Aruncarea de la margine",16:"Lovitura de poartă",17:"Lovitura de colț"};
const ROLE = {};
const fillRoles = () => ["referee","instructor","admin"].forEach(r=>ROLE[r]=t("roles."+r));
fillRoles();

/* ---------- utilitare ---------- */
const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const shuffle = a => { a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const fmtDate = d => d ? new Date(d).toLocaleString(I18N.locale,{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";
const lawName = l => LAWS[l] ? t("laws.lawNamed",{n:l, name:LAWS[l]}) : t("laws.law",{n:l});
const diffName = d => t("difficulty."+(d==="greu"?"greu":"mediu"));
let toastT;
function toast(msg, err){ const el=$("#toast"); el.textContent=msg; el.className=err?"err":""; el.style.display="block"; clearTimeout(toastT); toastT=setTimeout(()=>el.style.display="none", 4200); }
function errMsg(e){
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if(/Invalid login credentials/i.test(m)) return t("errors.invalidLogin");
  if(/Email not confirmed/i.test(m)) return t("errors.emailNotConfirmed");
  if(/User already registered/i.test(m)) return t("errors.alreadyRegistered");
  if(/Password should be at least/i.test(m)) return t("errors.passwordShort");
  if(/rate limit/i.test(m)) return t("errors.rateLimit");
  return m;
}
async function must(p){ const r = await p; if(r.error) throw r.error; return r.data; }
function on(sel, ev, fn){ const el = typeof sel==="string" ? $(sel) : sel; if(el) el.addEventListener(ev, fn); }
// inițialele: prima literă din primele două cuvinte, în ordinea scrisă („Paunescu Lucian” → PL)
function initials(name){
  const w = String(name||"").trim().split(/\s+/).filter(Boolean);
  if(!w.length) return "?";
  if(w.length===1) return w[0].slice(0,2).toUpperCase();
  return (w[0][0]+w[1][0]).toUpperCase();
}

/* ---------- configurare ---------- */
$("#appName").textContent = CFG.APP_NAME || "Fluier";
$("#season").textContent = t("app.subtitle",{season: CFG.SEASON || ""});
if(!window.supabase || !CFG.SUPABASE_URL || /COMPLETEAZA/.test(CFG.SUPABASE_URL+CFG.SUPABASE_ANON_KEY)){
  app.innerHTML = `<div class="notice warn"><b>${esc(t("errors.notConfiguredTitle"))}</b><br>${esc(t("errors.notConfiguredBody"))}</div>`;
  return;
}
// curăță adresa: fără spații, fără „/rest/v1”, fără „/” la final
const SB_URL = String(CFG.SUPABASE_URL).trim().replace(/\/(rest|auth)\/v1.*$/i,"").replace(/\/+$/,"");
if(/supabase\.com\/dashboard/i.test(SB_URL) || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SB_URL)){
  app.innerHTML = `<div class="notice warn"><b>${esc(t("errors.badUrlTitle"))}</b><br>${esc(t("errors.badUrlBody",{url:SB_URL}))}</div>`;
  return;
}
const sb = window.supabase.createClient(SB_URL, String(CFG.SUPABASE_ANON_KEY).trim());

/* ---------- starea aplicației ---------- */
const S = {
  user:null, profile:null, membership:null, association:null,
  Q:[], QM:{},            // întrebări (listă + după id)
  hist:{},                // id -> {ok,n,last}
  fav:new Set(),          // id-urile întrebărilor favorite
  pending:0,              // teste active, necompletate
  tab:"train", listFilter:null, statsOpen:false
};
let quiz=null, timerId=null, booted=false;

/* ===================== AUTENTIFICARE ===================== */
function authScreen(mode){
  mode = mode || "login";
  $("#tabs").style.display="none"; $("#userBox").innerHTML="";
  const signup = mode==="signup", reset = mode==="reset";
  app.innerHTML = `<div class="center">
    <h1>${esc(t(signup?"auth.signupTitle":reset?"auth.resetTitle":"auth.loginTitle"))}</h1>
    <p class="sub">${esc(t(signup?"auth.signupSub":reset?"auth.resetSub":"auth.loginSub"))}</p>
    <form id="authForm" class="card">
      ${signup?`<div class="grid" style="gap:0 12px">
        <div><label for="ln">${esc(t("auth.lastName"))}</label><input id="ln" autocomplete="family-name" required placeholder="${esc(t("auth.lastNamePh"))}"></div>
        <div><label for="fn">${esc(t("auth.firstName"))}</label><input id="fn" autocomplete="given-name" required placeholder="${esc(t("auth.firstNamePh"))}"></div></div>`:""}
      <label for="em">${esc(t("auth.email"))}</label><input id="em" type="email" autocomplete="email" required>
      ${reset?"":`<label for="pw">${esc(t("auth.password"))}</label><input id="pw" type="password" autocomplete="${signup?"new-password":"current-password"}" minlength="6" required>`}
      <div style="margin-top:16px"><button class="btn" style="width:100%" id="authBtn">${esc(t(signup?"auth.signupBtn":reset?"auth.resetBtn":"auth.loginBtn"))}</button></div>
    </form>
    <div class="row" style="justify-content:center;margin-top:14px;font-size:14px">
      ${signup||reset?`<a id="toLogin">${esc(t("auth.haveAccount"))}</a>`:`<a id="toSignup">${esc(t("auth.noAccount"))}</a> · <a id="toReset">${esc(t("auth.forgot"))}</a>`}
    </div></div>`;
  on("#toLogin","click",()=>authScreen("login"));
  on("#toSignup","click",()=>authScreen("signup"));
  on("#toReset","click",()=>authScreen("reset"));
  on("#authForm","submit", async e=>{
    e.preventDefault(); const b=$("#authBtn"); b.disabled=true;
    const email=$("#em").value.trim();
    try{
      if(signup){
        const last_name=$("#ln").value.trim(), first_name=$("#fn").value.trim();
        if(!last_name || !first_name){ b.disabled=false; return; }
        const r = await must(sb.auth.signUp({email, password:$("#pw").value,
          options:{data:{last_name, first_name, full_name:(last_name+" "+first_name).trim(), preferred_language:I18N.lang},
                   emailRedirectTo: location.origin+location.pathname}}));
        if(!r.session){ app.innerHTML=`<div class="center notice"><b>${esc(t("auth.checkEmail"))}</b><br>${esc(t("auth.checkEmailBody",{email}))}</div>`; return; }
      } else if(reset){
        await must(sb.auth.resetPasswordForEmail(email,{redirectTo: location.origin+location.pathname}));
        app.innerHTML=`<div class="center notice">${esc(t("auth.resetSent",{email}))}</div>`; return;
      } else {
        await must(sb.auth.signInWithPassword({email, password:$("#pw").value}));
      }
    }catch(err){ toast(errMsg(err), true); b.disabled=false; }
  });
}

function newPasswordScreen(){
  $("#tabs").style.display="none";
  app.innerHTML = `<div class="center"><h1>${esc(t("auth.newPassTitle"))}</h1>
    <form id="npForm" class="card"><label for="np">${esc(t("auth.newPassLabel"))}</label><input id="np" type="password" minlength="6" required autocomplete="new-password">
    <div style="margin-top:16px"><button class="btn" style="width:100%">${esc(t("auth.save"))}</button></div></form></div>`;
  on("#npForm","submit", async e=>{
    e.preventDefault();
    try{ await must(sb.auth.updateUser({password:$("#np").value})); S.recovery=false; toast(t("auth.passChanged")); boot(); }
    catch(err){ toast(errMsg(err), true); }
  });
}

/* ===================== ÎNCĂRCARE DATE ===================== */
const QCOLS = "id,law,difficulty,is_new,text,options,correct,explanations,ref,active,association_id,origin_association_id,review_status,created_by,created_at,text_en,options_en,explanations_en,ref_en,season";
const rowToQ = r => ({id:r.id, l:r.law, d:r.difficulty, nou:!!r.is_new,
  q:I18N.pick(r.text, r.text_en), o:I18N.pick(r.options, r.options_en), c:r.correct, w:I18N.pick(r.explanations, r.explanations_en), r:I18N.pick(r.ref, r.ref_en),
  active:r.active!==false, assoc:r.association_id||null, origin:r.origin_association_id||null, status:r.review_status||"none", at:r.created_at, season:r.season});
// citește toate rândurile, în pagini de câte 1000 (limita serverului)
async function fetchAll(make){
  let out=[], from=0; const step=1000;
  while(true){ const rows = await must(make().range(from, from+step-1)); out = out.concat(rows); if(rows.length<step) return out; from+=step; }
}
async function loadLaws(){
  try{ const rows = await must(sb.from("laws").select("id,name_ro,name_en").order("id"));
       rows.forEach(r=>LAWS[r.id]=I18N.pick(r.name_ro, r.name_en)); }
  catch(e){ /* tabelul lipsește (05 nerulat) – rămân numele de rezervă */ }
}
async function loadQuestions(){
  const rows = await fetchAll(()=>sb.from("questions").select(QCOLS).is("association_id", null).order("law").order("id"));
  const all = rows.map(rowToQ);
  S.QALL = {}; all.forEach(q=>S.QALL[q.id]=q);          // inclusiv cele dezactivate (pentru rapoarte vechi)
  S.Q = all.filter(q=>q.active);                          // antrenamentul folosește doar cele active
  S.QM = {}; S.Q.forEach(q=>S.QM[q.id]=q);
}
// întrebare după id: din bancă sau din întrebările proprii ale asociației
const qLookup = id => (S.QALL && S.QALL[id]) || (S.CQM && S.CQM[id]) || null;

// statisticile vin gata calculate de server (un rând pe întrebare)
async function loadHistory(){
  S.hist = {};
  const rows = await must(sb.rpc("my_question_stats"));
  (rows||[]).forEach(r=>{ S.hist[r.question_id] = {n:r.answered, ok:r.correct, last:r.last_correct}; });
}
async function loadFavorites(){
  try{ const rows = await fetchAll(()=>sb.from("favorites").select("question_id").eq("user_id",S.user.id).order("created_at"));
       S.fav = new Set(rows.map(r=>r.question_id)); }
  catch(e){ S.fav = new Set(); }
}
async function loadMembership(){
  S.profile = (await must(sb.from("profiles").select("*").eq("id",S.user.id).maybeSingle())) || {full_name:"",is_superadmin:false};
  S.membership = await must(sb.from("memberships").select("*").eq("user_id",S.user.id).maybeSingle());
  S.association = S.membership ? await must(sb.from("associations").select("*").eq("id",S.membership.association_id).maybeSingle()) : null;
}
// câte teste active, necompletate, are arbitrul în asociația lui
async function loadPending(){
  S.pending = 0;
  const m = S.membership;
  if(!m || m.status!=="approved" || !S.association) return;
  try{
    const [tests, subs] = await Promise.all([
      must(sb.from("tests").select("id,group_name,opens_at,due_at").eq("association_id",S.association.id)),
      must(sb.from("test_submissions").select("test_id").eq("user_id",S.user.id))
    ]);
    const done = new Set(subs.map(s=>s.test_id)), now = Date.now();
    S.pending = tests.filter(x=>(!x.group_name || x.group_name===m.group_name) && !done.has(x.id)
      && new Date(x.opens_at).getTime()<=now && !(x.due_at && new Date(x.due_at).getTime()<now)).length;
  }catch(e){ S.pending = 0; }
}
const isStaff = () => S.membership && S.membership.status==="approved" && ["admin","instructor"].includes(S.membership.role);
const isAdmin = () => S.membership && S.membership.status==="approved" && S.membership.role==="admin";
const displayName = () => (S.profile && S.profile.full_name) || (S.user && S.user.email) || "";

async function boot(){
  try{
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ S.user=null; return authScreen("login"); }
    booted = true;
    if(S.recovery) return newPasswordScreen();
    S.user = session.user;
    app.innerHTML = `<div class="empty">${esc(t("app.loading"))}</div>`;
    await loadMembership();
    // limba din profil (se aplică doar dacă e activată în config.js; acum: doar română)
    if(S.profile.preferred_language && S.profile.preferred_language!==I18N.lang){ await I18N.init(S.profile.preferred_language); fillRoles(); }
    await Promise.all([loadLaws(), loadQuestions(), loadHistory(), loadFavorites(), loadPending()]);
    renderChrome(); go(S.tab);
  }catch(err){
    app.innerHTML = `<div class="notice err"><b>${esc(t("errors.connectTitle"))}</b><br>${esc(errMsg(err))}<br><br>${esc(t("errors.connectHint"))}</div>`;
  }
}

sb.auth.onAuthStateChange((ev, session)=>{
  if(ev==="PASSWORD_RECOVERY"){ S.recovery = true; S.user = session && session.user; return newPasswordScreen(); }
  if(ev==="SIGNED_IN" && (!S.user || !booted)){ booted=true; boot(); }
  if(ev==="SIGNED_OUT"){ S.user=null; booted=false; authScreen("login"); }
});

/* ===================== HEADER + NAVIGARE ===================== */
function renderChrome(){
  const name = displayName();
  $("#userBox").innerHTML = `<div class="acct">
    <button type="button" class="acct-btn" id="acctBtn" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("menu.open"))}">
      <span class="acct-name">${esc(name)}</span><span class="avatar" aria-hidden="true">${esc(initials(name))}</span></button>
    <div class="menu" id="acctMenu" role="menu" hidden>
      <div class="menu-head"><span class="avatar lg" aria-hidden="true">${esc(initials(name))}</span>
        <div><b>${esc(name)}</b><div class="muted" style="font-size:12px">${esc(S.user.email||"")}</div></div></div>
      ${/* Loc pregătit pentru viitor: Profil / Abonament.
           Ca să le afișezi, pune SHOW_PROFILE_MENU: true în config.js și construiește paginile. */ ""}
      ${CFG.SHOW_PROFILE_MENU ? `<button type="button" role="menuitem" class="menu-item" data-menu="profile">${esc(t("menu.profile"))}</button>
        <button type="button" role="menuitem" class="menu-item" data-menu="subscription">${esc(t("menu.subscription"))}</button><div class="menu-sep"></div>` : ""}
      ${I18N.renderSwitcher()}
      <button type="button" role="menuitem" class="menu-item danger" id="logout">${esc(t("menu.logout"))}</button>
    </div></div>`;
  const btn=$("#acctBtn"), menu=$("#acctMenu");
  const close=()=>{ menu.hidden=true; btn.setAttribute("aria-expanded","false"); };
  btn.onclick=e=>{ e.stopPropagation(); menu.hidden=!menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); };
  document.addEventListener("click", e=>{ if(!menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") close(); });
  on("#logout","click", async ()=>{ close(); await sb.auth.signOut(); });
  menu.querySelectorAll("[data-lang]").forEach(b=>b.onclick=async()=>{
    try{ await must(sb.from("profiles").update({preferred_language:b.dataset.lang}).eq("id",S.user.id)); }catch(e){}
    location.reload(); });
  renderTabs();
}
function renderTabs(){
  const tabs = [["train",t("tabs.train")],["assoc", S.association ? t("tabs.myAssoc") : t("tabs.joinAssoc")]];
  if(isStaff()) tabs.push(["panel", t(isAdmin()?"tabs.panelAdmin":"tabs.panelInstructor")]);
  if(S.profile && S.profile.is_superadmin) tabs.push(["super",t("tabs.super")]);
  const nav=$("#tabs"); nav.style.display="flex";
  nav.innerHTML = tabs.map(([k,v])=>`<button data-tab="${k}" class="${S.tab===k?"on":""}">${esc(v)}${k==="assoc"&&S.pending?
    ` <span class="badge" aria-label="${esc(t("tabs.pendingBadge",{n:S.pending}))}">${S.pending}</span>`:""}</button>`).join("");
  nav.querySelectorAll("button").forEach(b=>b.onclick=()=>go(b.dataset.tab));
}
async function refreshPending(){ await loadPending(); renderTabs(); }
function go(tab){
  stopQuiz();
  S.tab = tab;
  document.querySelectorAll("#tabs button").forEach(b=>b.classList.toggle("on", b.dataset.tab===tab));
  window.scrollTo(0,0);
  if(tab==="train") return trainHome();
  if(tab==="assoc") return assocPage();
  if(tab==="panel") return isStaff() ? panelPage("members") : trainHome();
  if(tab==="super") return superPage();
}
on("#brand","click",()=>{ if(S.user) go("train"); });

/* ===================== ANTRENAMENT ===================== */
const doneCount = qs => qs.filter(q=>S.hist[q.id]).length;
const lawsInBank = () => [...new Set(S.Q.map(q=>q.l))].sort((a,b)=>a-b);
const favList = () => S.Q.filter(q=>S.fav.has(q.id));

function trainHome(){
  const wrong = S.Q.filter(q=>S.hist[q.id] && S.hist[q.id].last===false);
  const nNew = S.Q.filter(q=>q.nou).length, favs = favList();
  const season = CFG.SEASON || "";
  app.innerHTML = `
    <h1>${esc(t("train.title"))}</h1>
    <p class="sub">${esc(t("train.sub",{total:S.Q.length, season, done:doneCount(S.Q)}))}</p>
    <div class="grid">
      <button class="card" data-act="quick"><div class="ico">⚡</div><h3>${esc(t("train.quick"))}</h3><p>${esc(t("train.quickSub"))}</p></button>
      <button class="card" data-act="new"><div class="ico">🆕</div><h3>${esc(t("train.new",{season}))}</h3><p>${esc(t("train.newSub",{n:nNew}))}</p></button>
      <button class="card" data-act="exam"><div class="ico">⏱️</div><h3>${esc(t("train.exam"))}</h3><p>${esc(t("train.examSub"))}</p></button>
      <button class="card" data-act="mistakes"><div class="ico">🔁</div><h3>${esc(t("train.mistakes"))}</h3><p>${esc(wrong.length?t("train.mistakesSub",{n:wrong.length}):t("train.mistakesNone"))}</p></button>
      <button class="card" data-act="all"><div class="ico">📋</div><h3>${esc(t("train.all"))}</h3><p>${esc(t("train.allSub"))}</p></button>
      <button class="card" data-act="favs"><div class="ico">⭐</div><h3>${esc(t("train.favs"))}</h3><p>${esc(favs.length?t("train.favsCount",{n:favs.length}):t("train.favsSub"))}</p></button>
    </div>
    <h2>${esc(t("train.byLaw"))}</h2>
    <div class="chips">${lawsInBank().map(l=>{ const qs=S.Q.filter(q=>q.l===l), d=doneCount(qs), p=Math.round(100*d/qs.length);
      return `<button class="chip lawchip" data-law="${l}" aria-label="${esc(lawName(l)+" – "+t("train.lawProgress",{done:d,total:qs.length}))}">${esc(lawName(l))} <span class="prog ${d===qs.length?"full":""}">${d}/${qs.length}</span>
        <span class="lawbar" aria-hidden="true"><i style="width:${p}%"></i></span></button>`;}).join("")}</div>
    <h2>${esc(t("train.stats"))}</h2><div id="stats"></div>`;
  renderStats($("#stats"));
  app.querySelectorAll("[data-act]").forEach(b=>b.onclick=()=>{
    const a=b.dataset.act, back=()=>go("train");
    if(a==="quick") runPractice(shuffle(S.Q).slice(0,10),t("train.quick"),back);
    if(a==="new"){ const n=S.Q.filter(q=>q.nou); if(n.length) runPractice(shuffle(n),t("train.newTitleShort"),back); }
    if(a==="exam") runExam({title:t("train.exam"), questions:shuffle(S.Q).slice(0,20), perQ:60, totalMin:20, official:false,
                            onDone:(res)=>examResults(res, back)});
    if(a==="mistakes"){ if(wrong.length) runPractice(shuffle(wrong),t("train.mistakes"),back); }
    if(a==="all") listPage(null);
    if(a==="favs"){ const f=favList(); if(f.length) runPractice(shuffle(f),t("train.favs"),back); else toast(t("train.favsEmpty")); }
  });
  app.querySelectorAll("[data-law]").forEach(b=>b.onclick=()=>listPage(+b.dataset.law));
}

// Top 3 legi slabe (minimum 3 răspunsuri pe lege, ca o singură greșeală să nu dea 0%) + „Vezi toate”
const MIN_ANSWERS = 3;
function renderStats(el){
  const rows = lawsInBank().map(l=>{ let ok=0,n=0; S.Q.filter(q=>q.l===l).forEach(q=>{const h=S.hist[q.id]; if(h){ok+=h.ok;n+=h.n;}}); return {l,ok,n,p:n?Math.round(100*ok/n):0}; }).filter(r=>r.n);
  if(!rows.length){ el.innerHTML=`<div class="empty">${esc(t("train.statsEmpty"))}</div>`; return; }
  const byWeak = (a,b)=> a.p-b.p || b.n-a.n;
  const enough = rows.filter(r=>r.n>=MIN_ANSWERS).sort(byWeak);
  const top = (enough.length ? enough : rows.slice().sort(byWeak)).slice(0,3);
  const all = rows.slice().sort(byWeak);
  const list = S.statsOpen ? all : top;
  const bar = r => { const col=r.p>=80?"var(--ok)":r.p>=60?"var(--yellow)":"var(--bad)";
    return `<div class="stat"><div class="name">${esc(lawName(r.l))}<small>${esc(t("train.statsAnswers",{n:r.n}))}${r.n<MIN_ANSWERS?" · "+esc(t("train.statsFew")):""}</small></div>
      <div class="bar"><i style="width:${r.p}%;background:${col}"></i></div><div class="pct" style="color:${col}">${r.p}%</div></div>`; };
  el.innerHTML = `${S.statsOpen?"":`<div class="muted" style="font-size:13px;font-weight:700;margin-bottom:2px">${esc(t("train.statsTop"))}</div>`}
    ${list.map(bar).join("")}
    ${all.length>top.length || S.statsOpen ? `<div class="row" style="margin-top:12px"><button type="button" class="btn ghost sm" id="statsToggle" aria-expanded="${S.statsOpen}">${esc(t(S.statsOpen?"train.collapse":"train.seeAll"))}</button></div>`:""}`;
  on("#statsToggle","click",()=>{ S.statsOpen=!S.statsOpen; renderStats(el); });
}

function listPage(law){
  stopQuiz();
  const back=()=>listPage(law);
  let qs, head;
  if(law){
    qs=S.Q.filter(q=>q.l===law); const d=doneCount(qs), left=qs.length-d, pct=Math.round(100*d/qs.length);
    head=`<div class="card" style="margin-bottom:16px"><div class="muted" style="font-weight:700;font-size:13px">${esc(lawName(law))}</div>
      <div style="font-size:28px;font-weight:800">${d}/${qs.length} <span class="muted" style="font-size:15px;font-weight:600">${esc(t("list.solved"))}</span></div>
      <div class="bar" style="margin:10px 0 14px;height:8px"><i style="width:${pct}%"></i></div>
      <div class="row">${left?`<button class="btn" id="cont">${esc(t("list.continue",{n:left}))}</button>`:`<button class="btn" id="redo">${esc(t("list.redo"))}</button>`}
      <button class="btn ghost" id="bk">${esc(t("list.back"))}</button></div></div><h2>${esc(t("list.pick"))}</h2>`;
  } else {
    qs = S.listFilter ? S.Q.filter(q=>q.l===S.listFilter) : S.Q;
    head=`<div class="row"><h1 style="margin:0">${esc(t("list.allTitle"))}</h1><span class="spacer"></span><button class="btn ghost sm" id="bk">${esc(t("list.back"))}</button></div>
      <p class="sub">${esc(t("list.allSub"))}</p>
      <div class="chips" style="margin-bottom:14px"><button class="chip ${!S.listFilter?"on":""}" data-f="">${esc(t("list.filterAll",{n:S.Q.length}))}</button>
      ${lawsInBank().map(l=>{const x=S.Q.filter(q=>q.l===l);return `<button class="chip ${S.listFilter===l?"on":""}" data-f="${l}">${esc(t("laws.law",{n:l}))} (${doneCount(x)}/${x.length})</button>`;}).join("")}</div>`;
  }
  app.innerHTML = head + `<div class="qlist">${qs.map(q=>{ const h=S.hist[q.id], st=!h?"":h.last===false?"bad":"ok";
    return `<button class="qitem" data-id="${q.id}"><span class="st ${st}">${!h?"":st==="ok"?"✓":"✗"}</span><span style="flex:1">${esc(q.q)}<span class="meta">${esc(t("laws.law",{n:q.l}))} · ${esc(diffName(q.d))}${q.nou?" · "+esc(t("list.new")):""}</span></span>${S.fav.has(q.id)?'<span class="favmark" aria-hidden="true">★</span>':""}</button>`;}).join("")}</div>`;
  on("#bk","click",()=>go("train"));
  on("#cont","click",()=>runPractice(shuffle(qs.filter(q=>!S.hist[q.id])), lawName(law), back));
  on("#redo","click",()=>runPractice(shuffle(qs), lawName(law), back));
  app.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{ S.listFilter=b.dataset.f?+b.dataset.f:null; listPage(null); });
  app.querySelectorAll(".qitem").forEach(b=>b.onclick=()=>runPractice([S.QM[+b.dataset.id]], law?lawName(law):t("list.fromList"), back, true));
  window.scrollTo(0,0);
}

/* ---------- favorite ---------- */
async function toggleFav(q, btn){
  const was = S.fav.has(q.id);
  was ? S.fav.delete(q.id) : S.fav.add(q.id);
  paintFav(btn, !was);
  try{
    if(was) await must(sb.from("favorites").delete().eq("user_id",S.user.id).eq("question_id",q.id));
    else await must(sb.from("favorites").insert({user_id:S.user.id, question_id:q.id}));
    toast(t(was?"quiz.favRemoved":"quiz.favAdded"));
  }catch(err){ was ? S.fav.add(q.id) : S.fav.delete(q.id); paintFav(btn, was); toast(errMsg(err), true); }
}
function paintFav(btn, onn){ if(!btn) return; btn.textContent = onn?"★":"☆"; btn.classList.toggle("on", onn);
  btn.setAttribute("aria-pressed", String(onn)); btn.setAttribute("aria-label", t(onn?"quiz.favRemove":"quiz.favAdd")); btn.title = t(onn?"quiz.favRemove":"quiz.favAdd"); }

/* ---------- motorul de antrenament ---------- */
const letter = (order, oi) => "ABCD"[order.indexOf(oi)];
function qHeader(title,q,withFav){
  return `<div class="tags"><span class="tag">${esc(title)}</span><span class="tag">${esc(t("laws.law",{n:q.l}))}</span>
    <span class="tag ${q.d==="greu"?"hard":"mid"}">${esc(diffName(q.d))}</span>${q.nou?`<span class="tag new">${esc(t("quiz.newTag"))}</span>`:""}
    ${withFav?`<span class="spacer"></span><button type="button" class="favbtn" id="favBtn"></button>`:""}</div>`;
}
function runPractice(list, title, back, single){
  if(!list.length) return;
  quiz = {kind:"practice", list:list.map(q=>({q,order:shuffle([0,1,2,3])})), i:0, title, back, single, answers:[]};
  renderPractice();
}
function renderPractice(){
  const {list,i,title}=quiz, it=list[i], q=it.q;
  app.innerHTML = `<div class="qtop"><button class="btn ghost sm" id="quit" aria-label="${esc(t("quiz.close"))}">✕</button><div class="bar"><i style="width:${Math.round(100*i/list.length)}%"></i></div>
    <span class="muted" style="font-size:13px;font-weight:700">${i+1}/${list.length}</span></div>
    ${qHeader(title,q,true)}<p class="question">${esc(q.q)}</p>
    <div class="opts">${it.order.map((oi,k)=>`<button class="opt" data-oi="${oi}"><span class="k">${"ABCD"[k]}</span><span>${esc(q.o[oi])}</span></button>`).join("")}</div>
    <div id="after"></div>`;
  const fb=$("#favBtn"); paintFav(fb, S.fav.has(q.id)); fb.onclick=()=>toggleFav(q, fb);
  on("#quit","click",()=>{ const b=quiz.back; stopQuiz(); b(); });
  app.querySelectorAll(".opt").forEach(b=>b.onclick=()=>practiceAnswer(+b.dataset.oi));
  window.scrollTo(0,0);
}
function practiceAnswer(oi){
  const it=quiz.list[quiz.i], q=it.q, ok=oi===q.c;
  quiz.answers[quiz.i]=oi;
  const h=S.hist[q.id]||{ok:0,n:0}; h.n++; if(ok) h.ok++; h.last=ok; S.hist[q.id]=h;
  sb.from("practice_answers").insert({user_id:S.user.id, question_id:q.id, chosen:oi, is_correct:ok})
    .then(r=>{ if(r.error) toast(t("errors.answerNotSaved",{msg:errMsg(r.error)}), true); });
  app.querySelectorAll(".opt").forEach(b=>{ b.disabled=true; const v=+b.dataset.oi; if(v===q.c) b.classList.add("correct"); else if(v===oi) b.classList.add("wrong"); });
  const others=[0,1,2,3].filter(v=>v!==q.c && v!==oi), L=v=>letter(it.order,v);
  const last = quiz.i===quiz.list.length-1;
  $("#after").innerHTML = `<div class="verdict ${ok?"ok":"bad"}">${esc(ok?t("quiz.correct"):t("quiz.wrong",{letter:L(q.c)}))}</div>
    <div class="expl">${!ok?`<div class="blk"><h4>${esc(t("quiz.whyWrong",{letter:L(oi)}))}</h4>${esc(q.w[oi])}</div>`:""}
      <div class="blk"><h4>${esc(t("quiz.whyRight",{letter:L(q.c)}))}</h4>${esc(q.w[q.c])}</div>
      <div class="blk"><h4>${esc(t("quiz.others"))}</h4><ul>${others.map(v=>`<li><b>${L(v)}.</b> ${esc(q.w[v])}</li>`).join("")}</ul></div>
      ${q.r?`<div class="ref">📖 ${esc(q.r)}</div>`:""}</div>
    <div class="row" style="margin-top:16px"><button class="btn" id="nx" style="flex:1">${esc(quiz.single?t("quiz.backToList"):last?t("quiz.seeResult"):t("quiz.next"))}</button></div>`;
  on("#nx","click",()=>{
    if(quiz.single || last){ if(quiz.single){ const b=quiz.back; stopQuiz(); return b(); } return practiceResults(); }
    quiz.i++; renderPractice();
  });
  $("#after").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function practiceResults(){
  const n=quiz.answers.filter(a=>a!==undefined).length, ok=quiz.list.filter((it,k)=>quiz.answers[k]===it.q.c).length;
  const p=n?Math.round(100*ok/n):0, {back,title,list}=quiz;
  app.innerHTML=`<h1>${esc(title)}</h1><div class="score ${p>=80?"pass":"fail"}">${ok}/${n}</div>
    <p class="sub">${esc(p>=80?t("quiz.great"):t("quiz.wrongSaved"))}</p>
    <div class="row"><button class="btn" id="ag">${esc(t("quiz.again"))}</button><button class="btn ghost" id="bk">${esc(t("quiz.back"))}</button></div>`;
  on("#ag","click",()=>runPractice(shuffle(list.map(x=>x.q)),title,back));
  on("#bk","click",()=>{ stopQuiz(); back(); });
}

/* ---------- motorul de examen (simulare și teste oficiale) ---------- */
function runExam(opts){
  quiz = {kind:"exam", ...opts, list:opts.questions.map(q=>({q,order:shuffle([0,1,2,3])})), i:0, answers:[], leaves:0, timeouts:0,
          end: opts.totalMin ? Date.now()+opts.totalMin*60000 : 0};
  lockExam(true);
  clearInterval(timerId); timerId=setInterval(examTick,1000);
  renderExamQ();
}
function leftText(){ return t("exam.left",{n:quiz.leaves})+(quiz.official?" "+t("exam.leftOfficial"):""); }
function renderExamQ(){
  const {list,i,title,perQ}=quiz, it=list[i], q=it.q;
  app.innerHTML = `<div class="qtop">${quiz.official?"":`<button class="btn ghost sm" id="quit" aria-label="${esc(t("quiz.close"))}">✕</button>`}
      <div class="bar"><i style="width:${Math.round(100*i/list.length)}%"></i></div>
      ${quiz.end?'<span class="timer" id="timer"></span>':""}<span class="muted" style="font-size:13px;font-weight:700">${i+1}/${list.length}</span></div>
    <div class="warnbar" id="examWarn" style="display:${quiz.leaves?"block":"none"}">${esc(leftText())}</div>
    ${qHeader(title,q,false)}<p class="question">${esc(q.q)}</p>
    <div class="opts">${it.order.map((oi,k)=>`<button class="opt" data-oi="${oi}"><span class="k">${"ABCD"[k]}</span><span>${esc(q.o[oi])}</span></button>`).join("")}</div>
    <div class="row" style="margin-top:14px"><span class="qtimer" id="qtimer">⏳ ${perQ}s</span></div>
    <div class="secure-note">${esc(t("exam.secureNote",{s:perQ}))}</div>`;
  quiz.qEnd = Date.now()+perQ*1000; examTick();
  on("#quit","click",()=>{ stopQuiz(); go("train"); });
  app.querySelectorAll(".opt").forEach(b=>b.onclick=()=>{ quiz.answers[quiz.i]=+b.dataset.oi; examNext(); });
  window.scrollTo(0,0);
}
function examTick(){
  if(!quiz || quiz.kind!=="exam"){ clearInterval(timerId); return; }
  if(quiz.end){ const left=Math.max(0,quiz.end-Date.now()); const tm=$("#timer");
    if(tm) tm.textContent=Math.floor(left/60000)+":"+String(Math.floor(left/1000)%60).padStart(2,"0");
    if(left<=0) return examFinish(); }
  const ql=Math.max(0,Math.ceil((quiz.qEnd-Date.now())/1000)), qt=$("#qtimer");
  if(qt){ qt.textContent="⏳ "+ql+"s"; qt.classList.toggle("low", ql<=10); }
  if(ql<=0){ quiz.timeouts++; examNext(); }
}
function examNext(){ if(quiz.i < quiz.list.length-1){ quiz.i++; renderExamQ(); } else examFinish(); }
function examFinish(){
  clearInterval(timerId); lockExam(false);
  const res = {title:quiz.title, list:quiz.list, answers:quiz.list.map((_,k)=>quiz.answers[k]===undefined?null:quiz.answers[k]),
               leaves:quiz.leaves, timeouts:quiz.timeouts, perQ:quiz.perQ};
  const done=quiz.onDone; quiz=null; done(res);
}
function examResults(res, back, serverScore){
  const total=res.list.length, ok = serverScore ? serverScore.score : res.list.filter((it,k)=>res.answers[k]===it.q.c).length;
  const p=Math.round(100*ok/total), pass=p>=80;
  app.innerHTML = `<h1>${esc(res.title)}</h1><div class="score ${pass?"pass":"fail"}">${p}%</div>
    <p class="sub">${esc(t("exam.correctOf",{ok,total}))} ${esc(t(pass?"exam.passed":"exam.failed"))}</p>
    <div class="card" style="font-size:14px;line-height:1.7;margin-bottom:8px"><b>${esc(t("exam.integrity"))}</b><br>
      ${esc(t("exam.leaves"))}: <b class="${res.leaves?"bad":"ok"}">${res.leaves}</b> · ${esc(t("exam.timeouts"))}: <b>${res.timeouts}</b></div>
    <h2>${esc(t("exam.review"))}</h2>
    ${res.list.map((it,k)=>{ const q=it.q,a=res.answers[k],good=a===q.c;
      return `<div class="review"><div class="q">${k+1}. ${esc(q.q)}</div><div class="a">${a===null?`<b class="bad">${esc(t("exam.noAnswer"))}</b>`:good?`<b class="ok">${esc(t("exam.correctLabel"))}</b> `+esc(q.o[q.c]):`<b class="bad">${esc(t("exam.youChose"))}</b> `+esc(q.o[a])+`<br><b class="ok">${esc(t("exam.correctIs"))}</b> `+esc(q.o[q.c])}</div>
      <details><summary>${esc(t("exam.explanation"))}</summary><div class="a" style="margin-top:6px">${a!==null&&!good?esc(q.w[a])+"<br><br>":""}${esc(q.w[q.c])}${q.r?"<br><i>📖 "+esc(q.r)+"</i>":""}</div></details></div>`;}).join("")}
    <div class="row" style="margin-top:12px"><button class="btn" id="bk">${esc(t("quiz.back"))}</button></div>`;
  on("#bk","click",back); window.scrollTo(0,0);
}
function stopQuiz(){ clearInterval(timerId); lockExam(false); quiz=null; }

/* ---------- anti-copiere ---------- */
const inExam = () => quiz && quiz.kind==="exam";
function flagLeave(reasonKey){
  if(!inExam()) return; quiz.leaves++;
  const w=$("#examWarn"); if(w){ w.style.display="block"; w.textContent="⚠️ "+t(reasonKey)+" ("+quiz.leaves+")."+(quiz.official?" "+t("exam.leftOfficial"):""); }
}
["copy","cut","contextmenu","selectstart","dragstart"].forEach(ev=>document.addEventListener(ev,e=>{ if(inExam()) e.preventDefault(); }));
document.addEventListener("keydown",e=>{ if(!inExam()) return; const k=(e.key||"").toLowerCase();
  if((e.ctrlKey||e.metaKey) && ["c","x","a","p","s","u"].includes(k)) e.preventDefault();
  if(k==="printscreen") flagLeave("exam.screenshot"); });
document.addEventListener("visibilitychange",()=>{ if(document.hidden) flagLeave("exam.leftApp"); });
window.addEventListener("blur",()=>{ if(!document.hidden) flagLeave("exam.switchedWindow"); });
function lockExam(onn){
  document.body.classList.toggle("locked", !!onn);
  let wm=$("#wm");
  if(onn && !wm){
    wm=document.createElement("div"); wm.className="wm"; wm.id="wm";
    const stamp=displayName()+" · "+S.user.id.slice(0,8)+" · "+new Date().toLocaleString(I18N.locale);
    let rows=""; for(let i=0;i<14;i++) rows+=`<div style="top:${i*9-10}%">${esc((stamp+" · ").repeat(6))}</div>`;
    wm.innerHTML=rows; document.body.appendChild(wm);
  }
  if(!onn && wm) wm.remove();
}

/* ===================== ASOCIAȚIA MEA (arbitru) ===================== */
async function assocPage(){
  if(!S.membership){
    app.innerHTML = `<h1>${esc(t("assoc.joinTitle"))}</h1>
      <p class="sub">${esc(t("assoc.joinSub"))}</p>
      <form id="joinForm" class="card"><label for="code">${esc(t("assoc.codeLabel"))}</label><input id="code" placeholder="${esc(t("assoc.codePh"))}" autocapitalize="characters" required>
      <div style="margin-top:14px"><button class="btn">${esc(t("assoc.send"))}</button></div></form>`;
    on("#joinForm","submit", async e=>{ e.preventDefault();
      try{ const r=await must(sb.rpc("join_association",{p_code:$("#code").value}));
        toast(r.status==="pending" ? t("assoc.sentTo",{name:r.association}) : t("assoc.joinedAdmin",{name:r.association}));
        await loadMembership(); await loadPending(); renderChrome(); go(r.role==="admin"?"panel":"assoc");
      }catch(err){ toast(errMsg(err), true); } });
    return;
  }
  const a=S.association, m=S.membership;
  if(m.status==="pending"){
    app.innerHTML = `<h1>${esc(a?a.name:"")}</h1><div class="notice warn">${esc(t("assoc.pending"))}</div>
      <div class="row" style="margin-top:14px"><button class="btn ghost" id="rf">${esc(t("assoc.checkAgain"))}</button><button class="btn danger" id="cancel">${esc(t("assoc.cancel"))}</button></div>`;
    on("#rf","click", async ()=>{ await loadMembership(); await loadPending(); renderChrome(); assocPage(); });
    on("#cancel","click", async ()=>{ try{ await must(sb.from("memberships").delete().eq("id",m.id)); await loadMembership(); renderChrome(); assocPage(); }catch(err){ toast(errMsg(err),true);} });
    return;
  }
  app.innerHTML = `<div class="empty">${esc(t("assoc.loadingTests"))}</div>`;
  try{
    const [tests, subs] = await Promise.all([
      must(sb.from("tests").select("*").eq("association_id",a.id).order("created_at",{ascending:false})),
      must(sb.from("test_submissions").select("test_id,score,total,submitted_at").eq("user_id",S.user.id))
    ]);
    const sm={}; subs.forEach(s=>sm[s.test_id]=s);
    const now=Date.now();
    const visible = tests.filter(x=>!x.group_name || x.group_name===m.group_name);
    app.innerHTML = `<h1>${esc(a.name)}</h1>
      <p class="sub">${esc(t("assoc.roleGroup",{role:ROLE[m.role], group: m.group_name ? t("assoc.groupSuffix",{g:m.group_name}) : ""}))}</p>
      <h2>${esc(t("assoc.tests"))}</h2>
      ${visible.length? visible.map(x=>{ const s=sm[x.id], open=new Date(x.opens_at).getTime()<=now, expired=x.due_at && new Date(x.due_at).getTime()<now;
        const status = s ? `<span class="pill g">${s.score}/${s.total}</span>` : expired ? `<span class="pill r">${esc(t("assoc.statusExpired"))}</span>` : !open ? `<span class="pill">${esc(t("assoc.statusOpensAt",{date:fmtDate(x.opens_at)}))}</span>` : `<span class="pill y">${esc(t("assoc.statusTodo"))}</span>`;
        return `<div class="card" style="margin-bottom:10px"><div class="row"><div style="flex:1"><h3>${esc(x.title)}</h3>
          <div class="muted" style="font-size:13px">${esc(t("assoc.testMeta",{n:x.question_ids.length, s:x.per_question_seconds, due:fmtDate(x.due_at)}))}</div></div>${status}</div>
          ${!s && open && !expired ? `<div style="margin-top:12px"><button class="btn" data-start="${x.id}">${esc(t("assoc.start"))}</button></div>`:""}</div>`; }).join("")
        : `<div class="empty">${esc(t("assoc.noTests"))}</div>`}
      <div style="margin-top:20px"><button class="btn danger sm" id="leave">${esc(t("assoc.leave"))}</button></div>`;
    app.querySelectorAll("[data-start]").forEach(b=>b.onclick=()=>startOfficial(tests.find(x=>x.id===b.dataset.start)));
    on("#leave","click", async ()=>{
      if(!window.__leaveConfirm){ window.__leaveConfirm=true; toast(t("assoc.leaveConfirm")); setTimeout(()=>window.__leaveConfirm=false,4000); return; }
      try{ await must(sb.from("memberships").delete().eq("id",m.id)); await loadMembership(); S.pending=0; renderChrome(); go("assoc"); }catch(err){ toast(errMsg(err),true); }
    });
  }catch(err){ app.innerHTML=`<div class="notice err">${esc(errMsg(err))}</div>`; }
}

function startOfficial(x){
  app.innerHTML = `<h1>${esc(x.title)}</h1><div class="notice">
    <b>${esc(t("assoc.beforeTitle"))}</b><ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">
    <li>${esc(t("assoc.rule1",{n:x.question_ids.length, s:x.per_question_seconds}))}</li>
    <li>${esc(t("assoc.rule2"))}</li><li>${esc(t("assoc.rule3"))}</li><li>${esc(t("assoc.rule4"))}</li><li>${esc(t("assoc.rule5"))}</li></ul></div>
    <div class="row" style="margin-top:16px"><button class="btn" id="go">${esc(t("assoc.go"))}</button><button class="btn ghost" id="bk">${esc(t("assoc.notNow"))}</button></div>`;
  on("#bk","click",()=>go("assoc"));
  on("#go","click", async ()=>{
    $("#go").disabled=true;
    let qs;
    try{
      const rows = await must(sb.rpc("get_test_questions",{p_test:x.id}));
      qs = rows.map(r=>({id:r.id, l:r.law, d:r.difficulty, nou:!!r.is_new, q:I18N.pick(r.text,r.text_en), o:I18N.pick(r.options,r.options_en), r:I18N.pick(r.ref,r.ref_en), c:-1, w:["","","",""]}));
    }catch(err){ $("#go").disabled=false; return toast(errMsg(err), true); }
    // fiecare arbitru primește întrebările în altă ordine; răspunsurile se pun la loc înainte de trimitere
    const perm = shuffle(qs.map((_,k)=>k));
    runExam({title:x.title, questions:perm.map(k=>qs[k]), perQ:x.per_question_seconds, totalMin:0, official:true,
      onDone: async shown=>{
        const res = {...shown, list:qs.map((q,k)=>shown.list[perm.indexOf(k)]), answers:qs.map((q,k)=>shown.answers[perm.indexOf(k)])};
        const send = async ()=>{
          const r = await must(sb.rpc("submit_test",{p_test:x.id, p_answers:res.answers, p_leaves:res.leaves, p_timeouts:res.timeouts}));
          (r.questions||[]).forEach((y,k)=>{ const it=res.list[k]; if(it && it.q.id===y.id){ it.q.c=y.correct; it.q.w=y.explanations; } });
          examResults(res, ()=>go("assoc"), r);
          refreshPending();
        };
        app.innerHTML=`<div class="empty">${esc(t("assoc.sending"))}</div>`;
        try{ await send(); }
        catch(err){
          app.innerHTML=`<div class="notice err"><b>${esc(t("assoc.sendFailed"))}</b><br>${esc(errMsg(err))}<br>${esc(t("assoc.sendFailedHint"))}</div><div class="row" style="margin-top:12px"><button class="btn" id="retry">${esc(t("assoc.retry"))}</button></div>`;
          on("#retry","click", async ()=>{ try{ await send(); }catch(e2){ toast(errMsg(e2),true);} });
        }
      }});
  });
}

/* ===================== PANOU ADMINISTRATOR / INSTRUCTOR ===================== */
async function panelPage(sub){
  const a=S.association;
  const subs=[["members","Membri"],["tests","Teste"],["questions","Întrebări proprii"],["reports","Rapoarte"]];
  app.innerHTML = `<h1>${esc(a.name)}</h1>
    <div class="chips" style="margin:10px 0 16px">${subs.map(([k,v])=>`<button class="chip ${sub===k?"on":""}" data-sub="${k}">${v}</button>`).join("")}</div><div id="pbody"><div class="empty">Se încarcă…</div></div>`;
  app.querySelectorAll("[data-sub]").forEach(b=>b.onclick=()=>panelPage(b.dataset.sub));
  try{
    if(sub==="members") await panelMembers();
    if(sub==="tests") await panelTests();
    if(sub==="questions") await panelQuestions();
    if(sub==="reports") await panelReports();
  }catch(err){ $("#pbody").innerHTML=`<div class="notice err">${esc(errMsg(err))}</div>`; }
}
async function fetchMembers(){
  return must(sb.from("memberships").select("id,user_id,role,status,group_name,created_at,profiles(full_name,email)").eq("association_id",S.association.id).order("created_at"));
}
// întrebările proprii ale asociației (inclusiv cele preluate deja în bancă)
async function fetchCustom(){
  const id=S.association.id;
  const rows = await must(sb.from("questions").select(QCOLS).or(`association_id.eq.${id},origin_association_id.eq.${id}`).order("created_at",{ascending:false}));
  S.CQ = rows.map(rowToQ); S.CQM = {}; S.CQ.forEach(q=>S.CQM[q.id]=q);
  return S.CQ;
}
async function panelMembers(){
  const a=S.association, members=await fetchMembers();
  const pending=members.filter(m=>m.status==="pending"), approved=members.filter(m=>m.status==="approved");
  const admin=isAdmin();
  const groups=[...new Set(approved.map(m=>m.group_name).filter(Boolean))];
  $("#pbody").innerHTML = `
    <div class="card"><div class="muted" style="font-size:13px;font-weight:700">Codul pentru arbitri</div>
      <div class="row" style="margin-top:8px"><span class="code">${esc(a.referee_code)}</span>
      <button class="btn ghost sm" id="copyCode">Copiază</button>${admin?'<button class="btn ghost sm" id="regen">Cod nou</button>':""}</div>
      <p class="muted" style="font-size:13px;margin:10px 0 0">Trimite-l în grupul arbitrilor. Cine intră cu el apare mai jos și trebuie aprobat. Dacă a ajuns unde nu trebuie, generează un cod nou.</p></div>
    <h2>Cereri în așteptare (${pending.length})</h2>
    ${pending.length?`<div class="tblwrap"><table><tr><th>Nume</th><th>Email</th><th></th></tr>${pending.map(m=>`<tr><td>${esc(m.profiles&&m.profiles.full_name||"—")}</td><td class="muted">${esc(m.profiles&&m.profiles.email)}</td>
      <td style="white-space:nowrap">${admin?`<button class="btn sm" data-ap="${m.id}">Aprobă</button> <button class="btn danger sm" data-rj="${m.id}">Respinge</button>`:'<span class="muted">doar administratorul aprobă</span>'}</td></tr>`).join("")}</table></div>`:'<div class="empty">Nicio cerere nouă.</div>'}
    <h2>Membri (${approved.length})</h2>
    <datalist id="grpList">${groups.map(g=>`<option value="${esc(g)}">`).join("")}</datalist>
    <div class="tblwrap"><table><tr><th>Nume</th><th>Rol</th><th>Grupă</th><th></th></tr>
    ${approved.map(m=>`<tr><td>${esc(m.profiles&&m.profiles.full_name||"—")}<div class="muted" style="font-size:12px">${esc(m.profiles&&m.profiles.email)}</div></td>
      <td>${admin && m.user_id!==S.user.id?`<select data-role="${m.id}">${Object.keys(ROLE).map(r=>`<option value="${r}" ${m.role===r?"selected":""}>${ROLE[r]}</option>`).join("")}</select>`:esc(ROLE[m.role])}</td>
      <td>${admin?`<input data-grp="${m.id}" value="${esc(m.group_name||"")}" placeholder="ex.: Liga 4" list="grpList" style="min-width:110px">`:esc(m.group_name||"—")}</td>
      <td>${admin && m.user_id!==S.user.id?`<button class="btn danger sm" data-rm="${m.id}">Scoate</button>`:""}</td></tr>`).join("")}</table></div>`;
  on("#copyCode","click", async ()=>{ try{ await navigator.clipboard.writeText(a.referee_code); toast("Cod copiat."); }catch(e){ toast("Copiază manual: "+a.referee_code); } });
  on("#regen","click", async ()=>{ try{ const c=await must(sb.rpc("regenerate_referee_code",{p_assoc:a.id})); S.association.referee_code=c; toast("Cod nou: "+c); panelMembers(); }catch(err){ toast(errMsg(err),true);} });
  const upd = async (id, patch, msg)=>{ try{ await must(sb.from("memberships").update(patch).eq("id",id)); toast(msg); }catch(err){ toast(errMsg(err),true); } };
  document.querySelectorAll("[data-ap]").forEach(b=>b.onclick=async()=>{ await upd(b.dataset.ap,{status:"approved"},"Aprobat."); panelMembers(); });
  document.querySelectorAll("[data-rj]").forEach(b=>b.onclick=async()=>{ try{ await must(sb.from("memberships").delete().eq("id",b.dataset.rj)); toast("Cerere respinsă."); panelMembers(); }catch(err){ toast(errMsg(err),true);} });
  document.querySelectorAll("[data-rm]").forEach(b=>b.onclick=async()=>{
    if(b.dataset.c!=="1"){ b.dataset.c="1"; b.textContent="Sigur?"; return; }
    try{ await must(sb.from("memberships").delete().eq("id",b.dataset.rm)); toast("Membru scos din asociație."); panelMembers(); }catch(err){ toast(errMsg(err),true);} });
  document.querySelectorAll("[data-role]").forEach(s=>s.onchange=()=>upd(s.dataset.role,{role:s.value},"Rol actualizat."));
  document.querySelectorAll("[data-grp]").forEach(i=>i.onchange=()=>upd(i.dataset.grp,{group_name:i.value.trim()||null},"Grupă actualizată."));
}


/* ---------- Întrebări proprii ---------- */
function customStatus(q){
  if(!q.assoc) return '<span class="pill g">Preluată în aplicație</span>';
  if(!q.active) return '<span class="pill">Arhivată</span>';
  if(q.status==="rejected") return '<span class="pill">Doar în testele voastre</span>';
  return '<span class="pill y">Propusă pentru aplicație</span>';
}
async function panelQuestions(){
  const list = await fetchCustom();
  $("#pbody").innerHTML = `
    <div class="notice">Întrebările scrise de voi apar <b>doar în testele asociației</b>, nu și în antrenamentul din aplicație.
      Arbitrii le văd abia când încep testul. Administratorul aplicației le poate prelua în banca generală, dacă sunt bune.</div>
    <div class="row" style="margin:14px 0"><button class="btn" id="newQ">+ Scrie o întrebare nouă</button></div>
    <div id="qedit"></div>
    <h2>Întrebările voastre (${list.length})</h2>
    ${list.length ? list.map(q=>`<div class="review"><div class="row">${customStatus(q)}<span class="muted" style="font-size:12px">Legea ${q.l} · ${q.d==="greu"?"Greu":"Mediu"}</span><span class="spacer"></span>
        ${q.assoc?`<button class="btn ghost sm" data-ed="${q.id}">Editează</button> <button class="btn ghost sm" data-ar="${q.id}">${q.active?"Arhivează":"Reactivează"}</button>`:""}</div>
      <div class="q" style="margin-top:8px">${esc(q.q)}</div><div class="a"><b class="ok">Corect:</b> ${esc(q.o[q.c])}</div></div>`).join("")
      : '<div class="empty">Nu ați scris încă nicio întrebare.</div>'}`;
  on("#newQ","click",()=>questionEditor($("#qedit"), null, ()=>panelQuestions()));
  document.querySelectorAll("[data-ed]").forEach(b=>b.onclick=()=>{ questionEditor($("#qedit"), S.CQM[+b.dataset.ed], ()=>panelQuestions()); $("#qedit").scrollIntoView({behavior:"smooth"}); });
  document.querySelectorAll("[data-ar]").forEach(b=>b.onclick=async()=>{ const q=S.CQM[+b.dataset.ar];
    try{ await must(sb.from("questions").update({active:!q.active}).eq("id",q.id)); toast(q.active?"Întrebare arhivată.":"Întrebare reactivată."); panelQuestions(); }catch(err){ toast(errMsg(err),true); } });
}

// Formular pentru o întrebare proprie (nouă sau editare). onSaved(id) e apelat după salvare.
function questionEditor(box, q, onSaved){
  const v = q || {l:12, d:"mediu", q:"", o:["","","",""], c:0, w:["","","",""], r:""};
  const general = q ? (q.w[q.c]||"") : "";
  box.innerHTML = `<form class="card" id="qform" style="margin-bottom:14px"><h3>${q?"Editează întrebarea":"Întrebare nouă"}</h3>
    <div class="grid"><div><label for="ql">Legea</label><select id="ql">${Object.keys(LAWS).map(l=>`<option value="${l}" ${+l===v.l?"selected":""}>Legea ${l} · ${esc(LAWS[l])}</option>`).join("")}</select></div>
      <div><label for="qd">Dificultate</label><select id="qd"><option value="mediu" ${v.d==="mediu"?"selected":""}>Mediu</option><option value="greu" ${v.d==="greu"?"selected":""}>Greu</option></select></div></div>
    <label for="qt">Enunțul întrebării</label><textarea id="qt" rows="3" required>${esc(v.q)}</textarea>
    <label>Variantele de răspuns (bifează varianta corectă)</label>
    ${[0,1,2,3].map(k=>`<div class="row" style="margin-bottom:8px;flex-wrap:nowrap"><input type="radio" name="qc" value="${k}" ${v.c===k?"checked":""} style="width:auto" aria-label="Varianta ${"ABCD"[k]} e corectă">
      <input class="qo" data-k="${k}" placeholder="Varianta ${"ABCD"[k]}" value="${esc(v.o[k])}" required></div>`).join("")}
    <label for="qg">De ce e corect răspunsul (explicația principală)</label><textarea id="qg" rows="3" required>${esc(general)}</textarea>
    <details ${q?"open":""}><summary>Opțional: de ce e greșită fiecare variantă</summary>
      ${[0,1,2,3].map(k=>`<label>Varianta ${"ABCD"[k]}</label><input class="qw" data-k="${k}" value="${esc(q && k!==q.c ? q.w[k] : "")}" placeholder="Dacă lași gol, se afișează explicația principală">`).join("")}</details>
    <label for="qr">Trimitere la lege (opțional)</label><input id="qr" value="${esc(v.r||"")}" placeholder="ex.: Legea 12.4">
    <div class="row" style="margin-top:16px"><button class="btn">Salvează</button><button type="button" class="btn ghost" id="qcancel">Renunță</button></div></form>`;
  on("#qcancel","click",()=>{ box.innerHTML=""; });
  on("#qform","submit", async e=>{
    e.preventDefault();
    const opts=[...box.querySelectorAll(".qo")].map(i=>i.value.trim());
    const c=+(box.querySelector("input[name=qc]:checked")||{value:0}).value;
    const g=$("#qg").value.trim(), text=$("#qt").value.trim();
    if(!text || opts.some(o=>!o) || !g) return toast("Completează enunțul, toate cele 4 variante și explicația.", true);
    if(new Set(opts.map(o=>o.toLowerCase())).size<4) return toast("Variantele trebuie să fie diferite între ele.", true);
    const per=[...box.querySelectorAll(".qw")].map(i=>i.value.trim());
    const expl=opts.map((o,k)=> k===c ? g : (per[k] || ("Răspunsul corect este „"+opts[c]+"”. "+g)));
    const row={law:+$("#ql").value, difficulty:$("#qd").value, text, options:opts, correct:c, explanations:expl, ref:$("#qr").value.trim()||null};
    try{
      let id;
      if(q){ await must(sb.from("questions").update(row).eq("id",q.id)); id=q.id; }
      else {
        const ins = await must(sb.from("questions").insert({...row, association_id:S.association.id, origin_association_id:S.association.id,
          created_by:S.user.id, review_status:"pending"}).select("id").single());
        id = ins.id;
      }
      toast("Întrebare salvată."); box.innerHTML=""; await fetchCustom(); onSaved && onSaved(id);
    }catch(err){ toast(errMsg(err),true); }
  });
}

/* ---------- Teste: constructorul de test ---------- */
function newDraft(){
  const due=new Date(Date.now()+7*864e5); due.setHours(23,59,0,0);
  return {title:"Test săptămânal "+new Date().toLocaleDateString("ro-RO"), group:"", secs:60,
    due:new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString().slice(0,16),
    ids:[], mode:"random", laws:null, onlyNew:false, onlyHard:false, count:10, lawF:"", search:""};
}
async function panelTests(){
  const a=S.association;
  const [tests, members, subs] = await Promise.all([
    must(sb.from("tests").select("*").eq("association_id",a.id).order("created_at",{ascending:false})),
    fetchMembers(), must(sb.from("test_submissions").select("test_id,user_id")), fetchCustom()
  ]);
  const approved = members.filter(m=>m.status==="approved");
  const groups=[...new Set(approved.map(m=>m.group_name).filter(Boolean))];
  const D = S.draft || (S.draft = newDraft());
  if(!D.laws) D.laws = lawsInBank();
  const inB = id => D.ids.includes(id);
  const custom = S.CQ.filter(q=>q.assoc && q.active);
  const nCustom = D.ids.filter(id=>S.CQM[id] && S.CQM[id].assoc).length;

  let adder="";
  if(D.mode==="random"){
    const pool = S.Q.filter(q=>D.laws.includes(q.l) && (!D.onlyNew||q.nou) && (!D.onlyHard||q.d==="greu") && !inB(q.id));
    adder = `<label>Legi</label><div class="checks">${lawsInBank().map(l=>`<label><input type="checkbox" class="lawck" value="${l}" ${D.laws.includes(l)?"checked":""}> Legea ${l}</label>`).join("")}</div>
      <div class="checks" style="margin-top:8px"><label><input type="checkbox" id="onlyNew" ${D.onlyNew?"checked":""}> Doar întrebări noi în sezon</label><label><input type="checkbox" id="onlyHard" ${D.onlyHard?"checked":""}> Doar „Greu”</label></div>
      <div class="row" style="margin-top:10px;flex-wrap:nowrap"><input id="rc" type="number" min="1" value="${D.count}" style="max-width:110px" aria-label="Câte întrebări aleatorii">
      <button type="button" class="btn ghost" id="addRand">Adaugă aleatoriu</button></div>
      <p class="muted" style="font-size:13px">Disponibile cu aceste filtre: ${pool.length}.</p>`;
  } else if(D.mode==="bank"){
    const s=D.search.trim().toLowerCase();
    const res = S.Q.filter(q=>(!D.lawF||q.l===+D.lawF) && (!s||q.q.toLowerCase().includes(s)));
    adder = `<div class="grid"><select id="lawF"><option value="">Toate legile</option>${lawsInBank().map(l=>`<option value="${l}" ${+D.lawF===l?"selected":""}>Legea ${l}</option>`).join("")}</select>
      <input id="srch" placeholder="Caută în enunț…" value="${esc(D.search)}"></div>
      <div class="qlist" style="margin-top:10px;max-height:420px;overflow:auto">${res.slice(0,60).map(q=>`<button type="button" class="qitem" data-add="${q.id}">
        <span class="st ${inB(q.id)?"ok":""}">${inB(q.id)?"✓":"+"}</span><span>${esc(q.q)}<span class="meta">Legea ${q.l} · ${q.d==="greu"?"Greu":"Mediu"}</span></span></button>`).join("")}
        ${res.length>60?`<div class="muted" style="font-size:13px">…și încă ${res.length-60}. Restrânge căutarea.</div>`:""}${!res.length?'<div class="empty">Nicio întrebare găsită.</div>':""}</div>`;
  } else {
    adder = `<div class="row" style="margin-bottom:10px"><button type="button" class="btn ghost sm" id="writeQ">+ Scrie o întrebare nouă</button></div><div id="qedit"></div>
      <div class="qlist">${custom.map(q=>`<button type="button" class="qitem" data-add="${q.id}"><span class="st ${inB(q.id)?"ok":""}">${inB(q.id)?"✓":"+"}</span>
        <span>${esc(q.q)}<span class="meta">Legea ${q.l} · întrebare proprie</span></span></button>`).join("") || '<div class="empty">Nu aveți încă întrebări proprii. Scrieți una mai sus.</div>'}</div>`;
  }

  $("#pbody").innerHTML = `
    <div class="card"><h3>Test nou</h3>
      <label for="tt">Titlu</label><input id="tt" value="${esc(D.title)}">
      <div class="grid">
        <div><label for="tg">Pentru</label><select id="tg"><option value="">Toți membrii</option>${groups.map(g=>`<option ${D.group===g?"selected":""}>${esc(g)}</option>`).join("")}</select></div>
        <div><label for="ts">Secunde pe întrebare</label><input id="ts" type="number" min="15" max="300" value="${D.secs}"></div>
        <div style="grid-column:1/-1"><label for="td">Termen</label><input id="td" type="datetime-local" value="${D.due}"></div>
      </div>
      <h2 style="margin-top:18px">Întrebările testului (${D.ids.length}${nCustom?`, din care ${nCustom} proprii`:""})</h2>
      ${D.ids.length?`<div class="qlist">${D.ids.map((id,k)=>{ const q=qLookup(id); return `<div class="qitem" style="cursor:default"><span class="st">${k+1}</span>
        <span style="flex:1">${esc(q?q.q:"#"+id)}<span class="meta">Legea ${q?q.l:"?"}${q&&q.assoc?" · proprie":""}</span></span><button type="button" class="btn ghost sm" data-rm="${id}" aria-label="Scoate întrebarea">✕</button></div>`;}).join("")}</div>
        <div class="row" style="margin-top:8px"><button type="button" class="btn ghost sm" id="clr">Golește lista</button></div>`
        :'<div class="empty">Adaugă întrebări mai jos: aleatoriu, alese de tine din bancă sau scrise de voi.</div>'}
      <h2>Adaugă întrebări</h2>
      <div class="chips" style="margin-bottom:12px">
        <button type="button" class="chip ${D.mode==="random"?"on":""}" data-mode="random">🎲 Aleatoriu</button>
        <button type="button" class="chip ${D.mode==="bank"?"on":""}" data-mode="bank">📚 Aleg din bancă</button>
        <button type="button" class="chip ${D.mode==="custom"?"on":""}" data-mode="custom">✍️ Întrebări proprii (${custom.length})</button></div>
      ${adder}
      <div class="row" style="margin-top:18px"><button class="btn" id="mk" ${D.ids.length?"":"disabled"}>Creează testul (${D.ids.length} întrebări)</button></div>
      <p class="muted" style="font-size:13px">Toți arbitrii primesc aceleași întrebări, dar fiecare în altă ordine și cu variantele amestecate.</p></div>
    <h2>Teste trimise</h2>
    ${tests.length?`<div class="tblwrap"><table><tr><th>Test</th><th>Pentru</th><th>Termen</th><th>Completat</th><th></th></tr>
      ${tests.map(t=>{ const target=approved.filter(m=>m.role==="referee" && (!t.group_name||m.group_name===t.group_name)).length;
        const done=subs.filter(s=>s.test_id===t.id).length, own=t.question_ids.filter(id=>S.CQM[id]&&S.CQM[id].assoc).length;
        return `<tr><td><b>${esc(t.title)}</b><div class="muted" style="font-size:12px">${t.question_ids.length} întrebări${own?` (${own} proprii)`:""} · ${t.per_question_seconds}s</div></td>
        <td>${esc(t.group_name||"Toți")}</td><td>${fmtDate(t.due_at)}</td><td>${done}/${target}</td>
        <td style="white-space:nowrap"><button class="btn ghost sm" data-rep="${t.id}">Raport</button> <button class="btn danger sm" data-del="${t.id}">Șterge</button></td></tr>`;}).join("")}</table></div>`
      :'<div class="empty">Niciun test încă.</div>'}`;

  // păstrăm ce s-a completat, între reafișări
  const keep=()=>{ D.title=$("#tt").value; D.group=$("#tg").value; D.secs=+$("#ts").value||60; D.due=$("#td").value; };
  ["#tt","#tg","#ts","#td"].forEach(s=>on(s,"change",keep));
  const rerender=()=>{ keep(); panelTests(); };
  document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{ D.mode=b.dataset.mode; rerender(); });
  document.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{ D.ids=D.ids.filter(x=>x!==+b.dataset.rm); rerender(); });
  on("#clr","click",()=>{ D.ids=[]; rerender(); });
  document.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{ const id=+b.dataset.add; D.ids = inB(id) ? D.ids.filter(x=>x!==id) : D.ids.concat(id); rerender(); });
  document.querySelectorAll(".lawck").forEach(c=>c.onchange=()=>{ D.laws=[...document.querySelectorAll(".lawck:checked")].map(x=>+x.value); rerender(); });
  on("#onlyNew","change",e=>{ D.onlyNew=e.target.checked; rerender(); });
  on("#onlyHard","change",e=>{ D.onlyHard=e.target.checked; rerender(); });
  on("#addRand","click",()=>{
    D.count=Math.max(1,+$("#rc").value||10);
    const pool=S.Q.filter(q=>D.laws.includes(q.l) && (!D.onlyNew||q.nou) && (!D.onlyHard||q.d==="greu") && !inB(q.id));
    if(!pool.length) return toast("Nu mai sunt întrebări disponibile cu aceste filtre.", true);
    D.ids = D.ids.concat(shuffle(pool).slice(0,D.count).map(q=>q.id)); rerender();
  });
  on("#lawF","change",e=>{ D.lawF=e.target.value; rerender(); });
  let st; on("#srch","input",e=>{ clearTimeout(st); st=setTimeout(()=>{ D.search=e.target.value; rerender(); setTimeout(()=>{ const i=$("#srch"); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length);} }); },350); });
  on("#writeQ","click",()=>questionEditor($("#qedit"), null, id=>{ D.ids=D.ids.concat(id); rerender(); }));
  on("#mk","click", async ()=>{
    keep();
    if(!D.ids.length) return;
    const row={association_id:a.id, title:D.title.trim()||"Test", question_ids:D.ids.slice(), group_name:D.group||null,
      per_question_seconds:Math.max(15,Math.min(300,D.secs)), due_at: D.due ? new Date(D.due).toISOString() : null, created_by:S.user.id};
    try{ await must(sb.from("tests").insert(row)); toast("Test creat. Arbitrii îl văd în „Asociația mea”."); S.draft=null; panelTests(); }catch(err){ toast(errMsg(err),true); }
  });
  document.querySelectorAll("[data-rep]").forEach(b=>b.onclick=()=>{ S.reportTest=b.dataset.rep; panelPage("reports"); });
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    if(b.dataset.c!=="1"){ b.dataset.c="1"; b.textContent="Sigur? Se șterg și rezultatele"; return; }
    try{ await must(sb.from("tests").delete().eq("id",b.dataset.del)); toast("Test șters."); panelTests(); }catch(err){ toast(errMsg(err),true);} });
}

/* ---------- Statistici comune (rapoarte AJF și panoul tău) ---------- */
function aggregate(tests, subs){
  const tmap={}; tests.forEach(t=>tmap[t.id]=t);
  const byLaw={}, byQ={};
  subs.forEach(s=>{ const t=tmap[s.test_id]; if(!t) return; t.question_ids.forEach((qid,k)=>{ const q=qLookup(qid); if(!q) return; const ok=s.answers[k]===q.c;
    const L=byLaw[q.l]||{ok:0,n:0}; L.n++; if(ok) L.ok++; byLaw[q.l]=L;
    const X=byQ[qid]||{ok:0,n:0}; X.n++; if(ok) X.ok++; byQ[qid]=X; }); });
  return {byLaw, byQ};
}
const pct=(o,n)=>n?Math.round(100*o/n):0;
const pctCls=p=>p>=80?"ok":p>=60?"":"bad";
function lawBars(byLaw){
  const ks=Object.keys(byLaw).sort((x,y)=>x-y);
  if(!ks.length) return '<div class="empty">—</div>';
  return ks.map(l=>{ const L=byLaw[l], p=pct(L.ok,L.n), c=p>=80?"var(--ok)":p>=60?"var(--yellow)":"var(--bad)";
    return `<div class="stat"><div class="name">${esc(lawName(+l))}<small>${L.n} răspunsuri</small></div><div class="bar"><i style="width:${p}%;background:${c}"></i></div><div class="pct" style="color:${c}">${p}%</div></div>`;}).join("");
}
function worstQuestions(byQ, n){
  const rows=Object.entries(byQ).map(([id,x])=>({q:qLookup(+id),p:pct(x.ok,x.n),n:x.n})).filter(r=>r.q).sort((x,y)=>x.p-y.p).slice(0,n||10);
  if(!rows.length) return '<div class="empty">—</div>';
  return rows.map(r=>`<div class="review"><div class="row"><span class="pill ${r.p<50?"r":r.p<80?"y":"g"}">${r.p}% corect</span><span class="muted" style="font-size:12px">Legea ${r.q.l} · ${r.n} răspunsuri${r.q.assoc?" · întrebare proprie":""}</span></div>
     <div class="q" style="margin-top:8px">${esc(r.q.q)}</div><div class="a"><b class="ok">Corect:</b> ${esc(r.q.o[r.q.c])}</div></div>`).join("");
}
const fmtDur = ms => { if(!(ms>0)) return "—"; const s=Math.round(ms/1000); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); };

async function panelReports(){
  const a=S.association;
  const [tests, members, subs, starts] = await Promise.all([
    must(sb.from("tests").select("*").eq("association_id",a.id).order("created_at",{ascending:false})),
    fetchMembers(), must(sb.from("test_submissions").select("*")), must(sb.from("test_starts").select("*")), fetchCustom()
  ]);
  if(!tests.length){ $("#pbody").innerHTML='<div class="empty">Creează un test ca să vezi rapoarte.</div>'; return; }
  const sel = S.reportTest && tests.find(t=>t.id===S.reportTest) ? S.reportTest : "all";
  const chosen = sel==="all" ? tests : tests.filter(t=>t.id===sel);
  const ids = new Set(chosen.map(t=>t.id));
  const mySubs = subs.filter(s=>ids.has(s.test_id));
  const nameOf = uid => { const m=members.find(x=>x.user_id===uid); return m&&m.profiles ? (m.profiles.full_name||m.profiles.email) : "(fost membru)"; };
  const byUser={};
  mySubs.forEach(s=>{ const u=byUser[s.user_id]||{score:0,total:0,leaves:0,n:0,last:null,dur:null}; u.score+=s.score; u.total+=s.total; u.leaves+=s.leaves; u.n++; u.last=s.submitted_at;
    const st=starts.find(x=>x.test_id===s.test_id && x.user_id===s.user_id); if(sel!=="all" && st) u.dur=new Date(s.submitted_at)-new Date(st.started_at); byUser[s.user_id]=u; });
  const referees = members.filter(m=>m.status==="approved" && m.role==="referee");
  const missing = sel==="all" ? [] : referees.filter(m=>(!chosen[0].group_name||m.group_name===chosen[0].group_name) && !byUser[m.user_id]);
  const {byLaw, byQ} = aggregate(chosen, mySubs);
  const urows=Object.entries(byUser).map(([uid,u])=>({uid,name:nameOf(uid),...u,p:pct(u.score,u.total)})).sort((x,y)=>y.p-x.p);
  const avg = urows.length ? Math.round(urows.reduce((s,u)=>s+u.p,0)/urows.length) : 0;

  $("#pbody").innerHTML = `
    <label for="rsel">Raport pentru</label>
    <select id="rsel"><option value="all">Toate testele (${tests.length})</option>${tests.map(t=>`<option value="${t.id}" ${sel===t.id?"selected":""}>${esc(t.title)}</option>`).join("")}</select>
    <div class="grid" style="margin-top:14px">
      <div class="card"><div class="muted" style="font-size:13px">Teste trimise</div><div style="font-size:28px;font-weight:800">${mySubs.length}</div></div>
      <div class="card"><div class="muted" style="font-size:13px">Media arbitrilor</div><div style="font-size:28px;font-weight:800" class="${pctCls(avg)}">${avg}%</div></div>
    </div>
    <h2>Pe arbitri</h2>
    ${urows.length?`<div class="tblwrap"><table><tr><th>Arbitru</th><th>Scor</th><th>%</th><th>Ieșiri</th>${sel!=="all"?"<th>Durată</th>":""}<th>Ultimul</th></tr>
      ${urows.map(u=>`<tr><td>${esc(u.name)}</td><td>${u.score}/${u.total}</td><td class="${pctCls(u.p)}"><b>${u.p}%</b></td><td class="${u.leaves?"bad":""}">${u.leaves}</td>${sel!=="all"?`<td>${fmtDur(u.dur)}</td>`:""}<td class="muted">${fmtDate(u.last)}</td></tr>`).join("")}</table></div>`:'<div class="empty">Niciun rezultat încă.</div>'}
    ${missing.length?`<h2>N-au dat testul (${missing.length})</h2><div class="notice">${missing.map(m=>esc(m.profiles&&m.profiles.full_name||m.profiles&&m.profiles.email)).join(", ")}</div>`:""}
    <h2>Pe legi</h2>${lawBars(byLaw)}
    <h2>Cele mai greșite întrebări</h2>${worstQuestions(byQ,10)}
    <div class="row" style="margin-top:16px"><button class="btn ghost" id="csv">Copiază tabelul (pentru Excel)</button></div>`;
  on("#rsel","change",e=>{ S.reportTest=e.target.value==="all"?null:e.target.value; panelReports(); });
  on("#csv","click", async ()=>{
    const lines=["Arbitru\tScor\tTotal\tProcent\tIesiri"].concat(urows.map(u=>[u.name,u.score,u.total,u.p+"%",u.leaves].join("\t")));
    try{ await navigator.clipboard.writeText(lines.join("\n")); toast("Copiat. Lipește în Excel."); }catch(e){ toast("Browserul nu permite copierea automată.", true); }
  });
}

/* ===================== ADMIN APLICAȚIE (doar tu) ===================== */
async function superPage(sub){
  if(!(S.profile && S.profile.is_superadmin)) return go("train");
  sub = sub || "assocs";
  app.innerHTML='<div class="empty">Se încarcă…</div>';
  try{
    const [assocs, secrets, members, tests, subs, qs] = await Promise.all([
      must(sb.from("associations").select("*").order("created_at")),
      must(sb.from("association_secrets").select("*")),
      must(sb.from("memberships").select("association_id,status,role")),
      must(sb.from("tests").select("id,association_id,question_ids,created_at")),
      fetchAll(()=>sb.from("test_submissions").select("test_id,score,total,answers,leaves,submitted_at").order("submitted_at")),
      fetchAll(()=>sb.from("questions").select(QCOLS).order("id"))
    ]);
    S.CQM={}; qs.map(rowToQ).forEach(q=>{ if(q.assoc) S.CQM[q.id]=q; });
    const aname={}; assocs.forEach(a=>aname[a.id]=a.name);
    const pending = qs.map(rowToQ).filter(q=>q.assoc && q.status==="pending" && q.active);
    const subsTabs=[["assocs","Asociații"],["stats","Statistici"],["review",`Întrebări propuse (${pending.length})`]];
    let body="";
    if(sub==="assocs"){
      const sec={}; secrets.forEach(s=>sec[s.association_id]=s.admin_code);
      body = `<p class="sub">Fiecare asociație primește un <b>cod de administrator</b> (îl dai doar președintelui CJA/AJF, personal) și un <b>cod pentru arbitri</b>. Codul de administrator e de <b>unică folosință</b>: după ce cineva intră cu el, se schimbă automat. Pentru încă un administrator, dai codul nou din tabel.</p>
      <form id="newA" class="card"><h3>Asociație nouă</h3>
        <div class="grid"><div><label for="an">Nume</label><input id="an" placeholder="ex.: AJF Prahova" required></div>
        <div><label for="ac">Județ</label><input id="ac" placeholder="ex.: Prahova"></div></div>
        <div style="margin-top:14px"><button class="btn">Creează</button></div></form>
      <div id="newCodes"></div>
      <h2>Asociații (${assocs.length})</h2>
      ${assocs.length?`<div class="tblwrap"><table><tr><th>Asociație</th><th>Cod arbitri</th><th>Cod administrator</th><th>Membri</th></tr>
        ${assocs.map(a=>{ const ms=members.filter(m=>m.association_id===a.id); return `<tr><td><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.county||"")}</div></td>
          <td><code>${esc(a.referee_code)}</code></td><td><code>${esc(sec[a.id]||"—")}</code></td>
          <td>${ms.filter(m=>m.status==="approved").length} <span class="muted">(+${ms.filter(m=>m.status==="pending").length} în așteptare)</span></td></tr>`;}).join("")}</table></div>`
        :'<div class="empty">Nicio asociație încă.</div>'}`;
    }
    if(sub==="stats"){
      const tAssoc={}; tests.forEach(t=>tAssoc[t.id]=t.association_id);
      const rows = assocs.map(a=>{
        const ms=members.filter(m=>m.association_id===a.id && m.status==="approved");
        const ref=ms.filter(m=>m.role==="referee").length;
        const ts=tests.filter(t=>t.association_id===a.id);
        const ss=subs.filter(s=>tAssoc[s.test_id]===a.id);
        const avg = ss.length ? Math.round(ss.reduce((x,s)=>x+100*s.score/Math.max(1,s.total),0)/ss.length) : null;
        const part = ts.length && ref ? Math.round(100*ss.length/(ts.length*ref)) : null;
        const last = ss.length ? ss[ss.length-1].submitted_at : (ts.length ? ts.map(t=>t.created_at).sort().pop() : null);
        return {a, ref, staff:ms.length-ref, tests:ts.length, subs:ss.length, avg, part, last};
      });
      const totRef=rows.reduce((x,r)=>x+r.ref,0), allAvg = subs.length ? Math.round(subs.reduce((x,s)=>x+100*s.score/Math.max(1,s.total),0)/subs.length) : 0;
      const {byLaw, byQ} = aggregate(tests, subs);
      body = `<div class="grid">
          <div class="card"><div class="muted" style="font-size:13px">Asociații</div><div style="font-size:28px;font-weight:800">${assocs.length}</div></div>
          <div class="card"><div class="muted" style="font-size:13px">Arbitri aprobați</div><div style="font-size:28px;font-weight:800">${totRef}</div></div>
          <div class="card"><div class="muted" style="font-size:13px">Teste create</div><div style="font-size:28px;font-weight:800">${tests.length}</div></div>
          <div class="card"><div class="muted" style="font-size:13px">Teste rezolvate · media</div><div style="font-size:28px;font-weight:800">${subs.length} · <span class="${pctCls(allAvg)}">${allAvg}%</span></div></div></div>
        <h2>Pe asociații</h2>
        ${rows.length?`<div class="tblwrap"><table><tr><th>Asociație</th><th>Arbitri</th><th>Teste</th><th>Rezolvate</th><th>Participare</th><th>Media</th><th>Ultima activitate</th></tr>
          ${rows.map(r=>`<tr><td><b>${esc(r.a.name)}</b><div class="muted" style="font-size:12px">${r.staff} instructori/admini</div></td><td>${r.ref}</td><td>${r.tests}</td><td>${r.subs}</td>
            <td>${r.part===null?"—":r.part+"%"}</td><td class="${r.avg===null?"":pctCls(r.avg)}"><b>${r.avg===null?"—":r.avg+"%"}</b></td><td class="muted">${fmtDate(r.last)}</td></tr>`).join("")}</table></div>
          <p class="muted" style="font-size:12.5px">Participare = teste rezolvate ÷ (teste create × arbitri). Arată cât de activ e județul.</p>`:'<div class="empty">Nicio asociație încă.</div>'}
        <h2>Pe legi (toate asociațiile)</h2>${lawBars(byLaw)}
        <h2>Cele mai greșite întrebări (toate asociațiile)</h2>${worstQuestions(byQ,10)}`;
    }
    if(sub==="review"){
      body = `<p class="sub">Întrebări scrise de asociații. <b>Adaugă în aplicație</b> le mută în banca generală (le văd toți arbitrii la antrenament). <b>Respinge</b> le lasă doar în testele asociației care le-a scris. Poți corecta textul înainte din Supabase → Table Editor → <code>questions</code>.</p>
        ${pending.length? pending.map(q=>`<div class="review">
          <div class="row"><span class="pill y">${esc(aname[q.assoc]||"Asociație")}</span><span class="muted" style="font-size:12px">#${q.id} · Legea ${q.l} · ${q.d==="greu"?"Greu":"Mediu"} · ${fmtDate(q.at)}</span></div>
          <div class="q" style="margin-top:8px">${esc(q.q)}</div>
          <ol type="A" style="margin:6px 0 0;padding-left:22px;font-size:14px;line-height:1.6">${q.o.map((o,k)=>`<li class="${k===q.c?"ok":""}">${esc(o)}${k===q.c?" ✓":""}</li>`).join("")}</ol>
          <details><summary>Explicații</summary><ol type="A" class="a" style="padding-left:22px">${q.w.map(w=>`<li>${esc(w)}</li>`).join("")}</ol>${q.r?`<div class="a">📖 ${esc(q.r)}</div>`:""}</details>
          <div class="row" style="margin-top:10px"><button class="btn sm" data-appr="${q.id}">Adaugă în aplicație</button><button class="btn danger sm" data-rej="${q.id}">Respinge</button></div></div>`).join("")
          : '<div class="empty">Nicio întrebare nouă de verificat.</div>'}`;
    }
    app.innerHTML = `<h1>Admin aplicație</h1>
      <div class="chips" style="margin:10px 0 16px">${subsTabs.map(([k,v])=>`<button class="chip ${sub===k?"on":""}" data-ss="${k}">${esc(v)}</button>`).join("")}</div>${body}`;
    app.querySelectorAll("[data-ss]").forEach(b=>b.onclick=()=>superPage(b.dataset.ss));
    on("#newA","submit", async e=>{ e.preventDefault();
      try{ const r=await must(sb.rpc("create_association",{p_name:$("#an").value.trim(), p_county:$("#ac").value.trim()||null}));
        await superPage("assocs");
        $("#newCodes").innerHTML=`<div class="notice" style="margin-top:12px"><b>Asociație creată.</b><br>Cod administrator (pentru președinte): <span class="code">${esc(r.admin_code)}</span><br><br>Cod arbitri: <span class="code">${esc(r.referee_code)}</span></div>`;
      }catch(err){ toast(errMsg(err),true); } });
    const review = async (id, action)=>{ try{ await must(sb.rpc("review_custom_question",{p_id:id, p_action:action}));
      toast(action==="approve"?"Întrebarea a fost adăugată în aplicație.":"Întrebarea rămâne doar la asociație.");
      if(action==="approve") await loadQuestions(); superPage("review"); }catch(err){ toast(errMsg(err),true); } };
    document.querySelectorAll("[data-appr]").forEach(b=>b.onclick=()=>review(+b.dataset.appr,"approve"));
    document.querySelectorAll("[data-rej]").forEach(b=>b.onclick=()=>review(+b.dataset.rej,"reject"));
  }catch(err){ app.innerHTML=`<div class="notice err">${esc(errMsg(err))}</div>`; }
}

/* ---------- pornire ---------- */
boot();
})();
