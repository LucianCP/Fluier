/* =====================================================================
   FLUIER – motorul de căutare a întrebărilor (rulează în browser, fără server)
   • fără diacritice și fără litere mari/mici („pedeapsa” = „pedeapsă”)
   • rădăcini de cuvinte („portarul”, „portarului”, „portari” → „portar”)
   • sinonime din limbajul arbitrilor („penalty” → lovitură de pedeapsă, „galben” → avertisment)
   • toleranță la greșeli de scriere („ofsid”, „avetisment”)
   • potrivire pe început de cuvânt, cât timp scrii („pedea…”)
   • ordonare după relevanță (BM25), cu greutate mai mare pentru enunț
   • scurtături în căutare: „legea 12”, „L12”, „#nou”, „#greu”, „#mediu”
   Rapid și la mii de întrebări: indexul se construiește o singură dată.
   ===================================================================== */
(function(root){
  "use strict";

  const STOP = new Set(("a ai al ale alt ar are as asa au ca cand care cat ce cei cel cele cu cum da dar de deci din dintr dintre doar dupa e ea ei el ele este eu fi fie fara fost i ia ii il in inainte intr intre iar la le li lui mai mi mult nici niciun nu o ori pe pentru prin sa sau se si sub sunt te tot toti un una unei unui unor unde va vor").split(" "));

  // sinonime (cuvânt normalizat → cuvinte echivalente, tot normalizate)
  const SYN = {
    penalty:["lovitura","pedeapsa"], penalti:["lovitura","pedeapsa"], penaltiul:["lovitura","pedeapsa"], "11m":["pedeapsa"], pedeapsa:["penalty"],
    galben:["avertisment"], galbenul:["avertisment"], avertisment:["galben"], avertizat:["avertisment"],
    rosu:["eliminare"], rosul:["eliminare"], eliminare:["rosu"], eliminat:["eliminare"],
    cartonas:["avertisment","eliminare"],
    hent:["mana","brat"], henturi:["mana","brat"], handball:["mana","brat"], mana:["brat","hent"], brat:["mana","hent"],
    offside:["ofsaid"], ofside:["ofsaid"], ofsaid:["offside"],
    out:["aruncare","margine"], tusa:["aruncare","margine"], throw:["aruncare","margine"],
    corner:["colt"], colt:["corner"],
    goalkeeper:["portar"], goalie:["portar"], portar:["goalkeeper"],
    fault:["abatere","faulturi"], faul:["abatere","faulturi"], abatere:["fault"],
    dogso:["ocazie","clara","gol"], ocazie:["dogso"],
    simulare:["simuleaza"], plonjon:["simulare"],
    schimbare:["inlocuire","rezerva"], inlocuire:["rezerva","inlocuit"], rezerva:["inlocuire"],
    reluare:["reia"], fluier:["fluierul"],
    opt:["8"], cinci:["5"], zece:["10"], doua:["2"], doi:["2"], trei:["3"], unu:["1"], noua:["9"], sase:["6"], sapte:["7"], patru:["4"]
  };
  // și invers, cifrele găsesc numerele scrise în litere („8” → „opt”)
  Object.entries({"1":"unu","2":"doua","3":"trei","4":"patru","5":"cinci","6":"sase","7":"sapte","8":"opt","9":"noua","10":"zece"})
    .forEach(([d,w])=>{ SYN[d]=(SYN[d]||[]).concat(w); });
  const SUFFIXES = ["ilor","elor","urilor","ului","ulei","iile","iilor","atia","atie","ului","ul","ele","ile","uri","lor","ii","ia","ie","ea","ei","le","ul","a","e","i","u"]
    .sort((x,y)=>y.length-x.length);

  function normalize(s){
    return String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"")
      .replace(/[şș]/g,"s").replace(/[ţț]/g,"t").replace(/[^a-z0-9#]+/g," ").trim();
  }
  function stem(w){
    if(/^\d+$/.test(w) || w.length<=3) return w;
    for(const suf of SUFFIXES){ if(w.length-suf.length>=3 && w.endsWith(suf)){ w=w.slice(0,-suf.length); break; } }
    return w.length>7 ? w.slice(0,7) : w;
  }
  const words = s => normalize(s).split(" ").filter(w=>w && w!=="#");
  const terms = s => words(s).filter(w=>!STOP.has(w)).map(stem);

  // distanța de editare (cu inversare de litere), oprită devreme peste prag
  function editDistance(a,b,max){
    if(Math.abs(a.length-b.length)>max) return max+1;
    const m=a.length, n=b.length; let prev2=null, prev=new Array(n+1), cur=new Array(n+1);
    for(let j=0;j<=n;j++) prev[j]=j;
    for(let i=1;i<=m;i++){
      cur[0]=i; let best=cur[0];
      for(let j=1;j<=n;j++){
        const c = a[i-1]===b[j-1]?0:1;
        let v = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+c);
        if(prev2 && i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) v=Math.min(v, prev2[j-2]+1);
        cur[j]=v; if(v<best) best=v;
      }
      if(best>max) return max+1;
      prev2=prev.slice(); [prev,cur]=[cur,prev];
    }
    return prev[n];
  }

  const FIELDS = [["q",3],["r",2],["law",2],["o",1.4],["w",0.6]];
  const K1=1.2, B=0.6;

  function build(questions, lawName){
    const docs=[], inv=new Map(); let totalLen=0;
    questions.forEach((q,di)=>{
      const tf=new Map(); let len=0;
      const fieldText = {q:q.q, r:q.r||"", law:(lawName?lawName(q.l):""), o:(q.o||[]).join(" "), w:(q.w||[]).join(" ")};
      for(const [f,wgt] of FIELDS){
        for(const tm of terms(fieldText[f])){ tf.set(tm,(tf.get(tm)||0)+wgt); len+=wgt; }
      }
      docs.push({q, len, normText: " "+normalize(q.q)+" "});
      totalLen+=len;
      tf.forEach((v,tm)=>{ let p=inv.get(tm); if(!p) inv.set(tm,p=[]); p.push([di,v]); });
    });
    const vocab=[...inv.keys()];
    return {docs, inv, vocab, avg: docs.length? totalLen/docs.length : 1, N: docs.length};
  }

  // scurtături: „legea 12”, „L12”, „#nou”, „#greu”, „#mediu”
  function parseQuery(raw){
    let s=" "+normalize(raw)+" "; const f={laws:[], nou:false, diff:null};
    s=s.replace(/\s(?:legea|lege|law|l)\s?(\d{1,2})(?=\s)/g,(m,n)=>{ f.laws.push(+n); return " "; });
    s=s.replace(/\s#(nou|new)(?=\s)/g,()=>{ f.nou=true; return " "; });
    s=s.replace(/\s#(greu|hard)(?=\s)/g,()=>{ f.diff="greu"; return " "; });
    s=s.replace(/\s#(mediu|medium)(?=\s)/g,()=>{ f.diff="mediu"; return " "; });
    return {text:s.trim(), filters:f};
  }

  function search(idx, raw, opt){
    opt = opt||{};
    const {text, filters} = parseQuery(raw);
    const pass = q => (!filters.laws.length || filters.laws.includes(q.l)) && (!filters.nou || q.nou) && (!filters.diff || q.d===filters.diff) && (!opt.filter || opt.filter(q));
    const qWords = words(text).filter(w=>!STOP.has(w));
    if(!qWords.length){
      return {results: idx.docs.filter(d=>pass(d.q)).map(d=>({q:d.q, score:0, matched:new Set()})), filters, empty:true, terms:[]};
    }
    const scores=new Map(), cover=new Map(), matchedTerms=new Map();
    const idf = tm => { const df=(idx.inv.get(tm)||[]).length; return Math.log(1+(idx.N-df+0.5)/(df+0.5)); };
    const allTerms=[];
    qWords.forEach((w,wi)=>{
      const isLast = wi===qWords.length-1;
      const cand = new Map();               // termen → factor de potrivire
      const add=(tm,f)=>{ if(idx.inv.has(tm) && (cand.get(tm)||0)<f) cand.set(tm,f); };
      // forme înrudite ale aceleiași rădăcini („elimin” ~ „elimina”)
      const addRelated=(st,f)=>{ add(st,f); if(st.length<4) return;
        for(const tm of idx.vocab){ if(tm!==st && tm.length>=4 && (tm.startsWith(st) || st.startsWith(tm)) && Math.min(tm.length,st.length)>=Math.min(5,st.length)) add(tm,f*0.9); } };
      const base = stem(w);
      addRelated(base,1);
      (SYN[w]||SYN[base]||[]).forEach(s=>terms(s).forEach(tm=>addRelated(tm,0.8)));
      if(base.length>=3){                   // început de cuvânt (mai ales la ultimul cuvânt, cât scrii)
        const pf = isLast ? 0.75 : 0.6;
        for(const tm of idx.vocab){ if(tm!==base && tm.startsWith(base)) add(tm,pf); }
      }
      if(!cand.size && base.length>=4){     // greșeli de scriere
        const max = base.length>=7 ? 2 : 1;
        for(const tm of idx.vocab){ if(Math.abs(tm.length-base.length)<=max && editDistance(base,tm,max)<=max) add(tm,0.55); }
      }
      cand.forEach((factor,tm)=>{
        allTerms.push(tm);
        const id=idf(tm);
        for(const [di,tf] of idx.inv.get(tm)){
          const d=idx.docs[di];
          const s = id * (tf*(K1+1))/(tf + K1*(1-B+B*d.len/idx.avg)) * factor;
          const key=di+":"+wi;
          if(!(matchedTerms.get(key)>=s)){ // păstrăm cea mai bună potrivire pentru acest cuvânt
            const prevBest = matchedTerms.get(key)||0;
            matchedTerms.set(key,s);
            scores.set(di,(scores.get(di)||0)-prevBest+s);
            if(!prevBest) cover.set(di,(cover.get(di)||0)+1);
          }
        }
      });
    });
    const phrase = " "+qWords.join(" ")+" ";
    const termSet = new Set(allTerms);
    const res=[];
    scores.forEach((s,di)=>{
      const d=idx.docs[di]; if(!pass(d.q)) return;
      let sc=s; if(qWords.length>1 && d.normText.includes(phrase)) sc*=1.5;
      res.push({q:d.q, score:sc, cover:cover.get(di)||0, matched:termSet});
    });
    res.sort((a,b)=> b.cover-a.cover || b.score-a.score);
    return {results:res, filters, empty:false, terms:allTerms, words:qWords.length};
  }

  // evidențiază în text cuvintele potrivite (întoarce HTML sigur)
  function highlight(text, matched, escFn){
    if(!matched || !matched.size) return escFn(text);
    const out=[]; const re=/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu; let m;
    while((m=re.exec(text))){
      const tok=m[0];
      if(/[\p{L}\p{N}]/u.test(tok)){
        const n=normalize(tok), st=stem(n);
        const hit = !STOP.has(n) && [...matched].some(tm=> st===tm || st.startsWith(tm) || (tm.length>=5 && tm.startsWith(st) && st.length>=5));
        out.push(hit?`<mark>${escFn(tok)}</mark>`:escFn(tok));
      } else out.push(escFn(tok));
    }
    return out.join("");
  }

  root.FluierSearch = { build, search, highlight, normalize, stem, parseQuery };
  if(typeof module!=="undefined") module.exports = root.FluierSearch;
})(typeof window!=="undefined" ? window : globalThis);
