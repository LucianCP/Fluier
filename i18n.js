/* =====================================================================
   FLUIER – sistemul de traducere (i18n)
   - textele stau în lang/ro.json și lang/en.json
   - în cod se folosește t("cheie.subcheie", {variabile})
   - limba implicită: română. Engleza se activează din config.js
     (ENABLED_LANGUAGES: ["ro","en"]) când întrebările sunt traduse.
   ===================================================================== */
window.I18N = (function(){
  "use strict";
  const DEFAULT = "ro";
  let lang = DEFAULT, dict = {}, base = {};

  function get(obj, key){ return key.split(".").reduce((o,k)=> (o && o[k]!==undefined) ? o[k] : undefined, obj); }
  async function load(l){
    try{ const r = await fetch("lang/"+l+".json", {cache:"no-cache"}); if(!r.ok) throw 0; return await r.json(); }
    catch(e){ console.warn("[i18n] nu am putut încărca lang/"+l+".json"); return {}; }
  }
  function enabled(){
    const cfg = (window.FLUIER_CONFIG && window.FLUIER_CONFIG.ENABLED_LANGUAGES) || [DEFAULT];
    return cfg.filter(l=>["ro","en"].includes(l));
  }
  // preferred = limba din profil; se folosește doar dacă e activată în config
  async function init(preferred){
    const ok = enabled();
    lang = ok.includes(preferred) ? preferred : DEFAULT;
    base = await load(DEFAULT);
    dict = lang===DEFAULT ? base : await load(lang);
    document.documentElement.lang = lang;
    return lang;
  }
  function t(key, vars){
    let s = get(dict, key);
    if(typeof s !== "string") s = get(base, key);
    if(typeof s !== "string") return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m,k)=> vars[k]!==undefined ? vars[k] : m) : s;
  }
  // alege textul potrivit dintr-un câmp tradus (ex.: întrebarea în română / engleză)
  function pick(ro, en){ return (lang==="en" && en!=null && en!=="") ? en : ro; }

  /* Selectorul de limbă – PREGĂTIT, dar NEAFIȘAT.
     Apare automat în meniul contului doar când config.js are ENABLED_LANGUAGES cu mai mult de o limbă
     și SHOW_LANGUAGE_SWITCHER: true. */
  function switcherVisible(){
    return !!(window.FLUIER_CONFIG && window.FLUIER_CONFIG.SHOW_LANGUAGE_SWITCHER) && enabled().length > 1;
  }
  function renderSwitcher(){
    if(!switcherVisible()) return "";
    return `<div class="menu-sep"></div><div class="menu-label">${t("menu.language")}</div>
      <div class="lang-switch">${enabled().map(l=>`<button type="button" data-lang="${l}" class="${l===lang?"on":""}">${l.toUpperCase()}</button>`).join("")}</div>`;
  }

  return { init, t, pick, renderSwitcher, get lang(){ return lang; }, get locale(){ return lang==="en" ? "en-GB" : "ro-RO"; } };
})();
