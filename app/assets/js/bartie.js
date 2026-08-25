/* ============================================================
   Traffic Gastropub — Bar Tie-Up & Liquor Control (modern UI)
   Engine logic reused VERBATIM from the proven v3-3 workbook app.
   Data: seed.js (INIT_TALLY/ALIAS/COCKTAILS) · realdata.js (REAL_SALES)
   ============================================================ */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let CHARTS = [];
const APP_VERSION = '2.25.1';  // keep in sync with version.json when releasing an update

/* ---------------- multi-company namespace ----------------
   Every bls/bsv key is prefixed per ACTIVE company → each company keeps fully
   separate data (items, aliases, cocktails, POS, inventory, raw data, settings…)
   while sharing the SAME engine & calculations. Switching = reload with new prefix. */
function coList(){ try{ const l=JSON.parse(localStorage.getItem('tg2_companies')||'null'); return Array.isArray(l)&&l.length?l:[{id:'main',name:'Traffic Gastropub'}]; }catch(e){ return [{id:'main',name:'Traffic Gastropub'}]; } }
function coSave(l){ try{ localStorage.setItem('tg2_companies', JSON.stringify(l)); }catch(e){} }
const ACTIVE_CO = (function(){ const a=localStorage.getItem('tg2_activeCo')||'main'; return coList().some(c=>c.id===a)?a:'main'; })();
const CO_PREFIX = ACTIVE_CO==='main' ? 'tg2_' : 'tg2_'+ACTIVE_CO+'_';
// CANTEEN company gets its own extracted seed data (canteenseed.js); engine identical.
const CO_IS_CANTEEN = /canteen/i.test((coList().find(c=>c.id===ACTIVE_CO)||{}).name||'');
function openCompanies(){
  const rows=coList().map(c=>`<div class="flex between items-center" style="padding:9px 0;border-bottom:1px solid var(--border-soft);gap:10px">
      <strong style="cursor:pointer;${c.id===ACTIVE_CO?'color:var(--gold)':''}" onclick="switchCompany('${c.id}')">${c.id===ACTIVE_CO?'✔ ':''}🏢 ${esc(c.name)}</strong>
      ${(c.id==='main'||c.id===ACTIVE_CO)?'':`<button class="btn btn-danger btn-sm" onclick="delCompany('${c.id}')">🗑️ Delete</button>`}
    </div>`).join('');
  modal('🏢 Companies', `<div style="max-height:300px;overflow:auto">${rows}</div>
    <input class="input" id="coName" placeholder="New company name" style="width:100%;margin-top:12px;box-sizing:border-box">`,
    `<button class="btn" onclick="closeModal()">Close</button><button class="btn btn-gold" onclick="addCompany()">➕ Add Company</button>`);
}
function addCompany(){
  const nm=($('#coName')&&$('#coName').value.trim()); if(!nm){ toast('Name required','Enter the new company name','err'); return; }
  const id='c'+Date.now(); const l=coList(); l.push({id,name:nm}); coSave(l);
  try{ localStorage.setItem('tg2_'+id+'_cfg', JSON.stringify({...cfg, company:nm, logo:null, photo:null})); }catch(e){}
  switchCompany(id);
}
function switchCompany(id){ if(id===ACTIVE_CO){ closeModal(); return; } try{ localStorage.setItem('tg2_activeCo', id); }catch(e){} location.reload(); }
function delCompany(id){
  const c=coList().find(x=>x.id===id); if(!c||id==='main'||id===ACTIVE_CO) return;
  confirmAsk(`Delete company "<strong>${esc(c.name)}</strong>" and ALL of its data?`, ()=>{
    coSave(coList().filter(x=>x.id!==id));
    try{ const pre='tg2_'+id+'_'; Object.keys(localStorage).filter(k=>k.indexOf(pre)===0).forEach(k=>localStorage.removeItem(k)); }catch(e){}
    closeModal(); openCompanies(); toast('Deleted',c.name,'err');
  });
}

/* ---------------- persistence ---------------- */
function bls(k, d) {
  try { const v = localStorage.getItem(CO_PREFIX + k); if (v === null) return d;
    const p = JSON.parse(v); if (Array.isArray(d) && (!Array.isArray(p) || !p.length)) return d; return p;
  } catch { return d; }
}
function bsv(k, v) {
  try { localStorage.setItem(CO_PREFIX + k, JSON.stringify(v)); } catch (e) {}
  if (k==='tally'||k==='alias'||k==='namemap') rebuildIndexes();
  if (k==='cocktailAlias') rebuildCocktailAliasIndex();
  try { auditPush(k); } catch (e) {}
  try { cloudMark(k); } catch (e) {}
  invalidateCalcCache();
}
/* ---------------- audit log (who changed what, when) ---------------- */
var _lastAudit = {};
function auditUser(){ try{ const u=JSON.parse(sessionStorage.getItem('tg2_user')||'null'); if(u&&u.u) return u.u; }catch(e){} return (typeof cfg!=='undefined'&&cfg.admin)?cfg.admin:'admin'; }
function auditPush(k){
  const KEYS=['tally','alias','cocktails','cocktailAlias','pos','inv','mr','recv','rawdata2','namemap'];
  if(KEYS.indexOf(k)<0) return;
  const now=Date.now(); if(_lastAudit[k] && now-_lastAudit[k]<60000) return; _lastAudit[k]=now;
  let log=[]; try{ log=JSON.parse(localStorage.getItem(CO_PREFIX+'audit')||'[]'); }catch(e){}
  log.unshift({t:new Date().toLocaleString(), u:auditUser(), k:k});
  if(log.length>300) log.length=300;
  try{ localStorage.setItem(CO_PREFIX+'audit', JSON.stringify(log)); }catch(e){}
}
/* ---------------- backup / restore (one file = everything) ---------------- */
function _dlText(name,text){ const b=new Blob([text],{type:'application/json'}); const u=URL.createObjectURL(b);
  const a=document.createElement('a'); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1500); }
function _coSubKeys(){ // this company's storage sub-keys (main prefix shares tg2_ with globals — exclude those)
  const out=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
    if(!k||k.indexOf(CO_PREFIX)!==0) continue; const sub=k.slice(CO_PREFIX.length);
    // `cloud` (url+key) and `cloudsess` (the signed-in ACCESS TOKEN) are global, not
    // per-company — and pushing cloudsess would publish a usable write token into a row
    // that anyone holding the anon key can read. Never include them in a backup or push.
    if(CO_PREFIX==='tg2_' && /^(c\d+_|companies$|activeCo$|logo$|sysname$|sysaddr$|loginDesign$|smsgw$|cloud$|cloudsess$|ai$|lastUser$)/.test(sub)) continue;
    out.push(sub); }
  return out;
}
function backupCompany(){
  const co=(coList().find(c=>c.id===ACTIVE_CO)||{}).name||ACTIVE_CO;
  const out={app:'BLIS', v:APP_VERSION, type:'company', co:co, ts:new Date().toISOString(), keys:{}};
  _coSubKeys().forEach(sub=>{ out.keys[sub]=localStorage.getItem(CO_PREFIX+sub); });
  _dlText('BLIS_backup_'+co.replace(/\W+/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.json', JSON.stringify(out));
  try{ localStorage.setItem(CO_PREFIX+'lastbackup', JSON.stringify(new Date().toISOString())); }catch(e){}
  try{ sbFill(); }catch(e){}
  toast('Backup ready','Company data exported to one file','ok');
}
function backupAll(){
  const out={app:'BLIS', v:APP_VERSION, type:'all', ts:new Date().toISOString(), keys:{}};
  for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.indexOf('tg2_')===0) out.keys[k]=localStorage.getItem(k); }
  _dlText('BLIS_backup_ALL_'+new Date().toISOString().slice(0,10)+'.json', JSON.stringify(out));
  try{ localStorage.setItem(CO_PREFIX+'lastbackup', JSON.stringify(new Date().toISOString())); }catch(e){}
  try{ sbFill(); }catch(e){}
  toast('Backup ready','Full system exported (all companies)','ok');
}
function importBackup(inp){
  const f=inp.files&&inp.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=function(){
    let j=null; try{ j=JSON.parse(rd.result); }catch(e){}
    if(!j||j.app!=='BLIS'||!j.keys){ toast('Invalid file','This is not a BLIS backup file','err'); return; }
    confirmAsk('Restore this backup? Current '+(j.type==='all'?'ALL companies\' data':'company data')+' will be REPLACED.', ()=>{
      try{
        if(j.type==='all'){ Object.keys(j.keys).forEach(k=>{ if(k.indexOf('tg2_')===0) localStorage.setItem(k, j.keys[k]); }); }
        else { _coSubKeys().forEach(sub=>localStorage.removeItem(CO_PREFIX+sub));
               Object.keys(j.keys).forEach(sub=>localStorage.setItem(CO_PREFIX+sub, j.keys[sub])); }
      }catch(e){ toast('Restore failed','Storage error','err'); return; }
      location.reload();
    });
  };
  rd.readAsText(f); inp.value='';
}
/* ---------------- Cloud Sync (optional, Supabase REST — plain fetch, no library) ----------------
   Global setup (tg2_cloud = {url,key,auto}) shared by all companies; each company syncs its own
   row (id = company id) in table `blis_sync`. Push = backupCompany payload upserted; Pull = restore
   like importBackup. Auto-push piggybacks on bsv via cloudMark (debounced 60s, silent). */
function cloudCfg(){ try{ return JSON.parse(localStorage.getItem('tg2_cloud')||'null')||{}; }catch(e){ return {}; } }
/* Strip every whitespace character (a pasted key often carries newlines/nbsp) — a key
   never contains spaces, so this is always safe. */
function cloudClean(s){
  return String(s==null?'':s)
    .replace(/[‐-―−]/g,'-')   // ‑ – — − → plain hyphen (word processors / copy helpers swap these)
    .replace(/[‘’“”]/g,'')// curly quotes
    .replace(/[…]/g,'')                  // … from a truncated display
    .replace(/[​-‍﻿]/g,'')     // zero-width / BOM
    .replace(/\s+/g,'');                      // spaces, tabs, newlines — a key never has any
}
/* HTTP header values must be ISO-8859-1. A key copied from a UI that shows it
   truncated can pick up a “…” or a smart quote, and then fetch() throws
   "String contains non ISO-8859-1 code point" BEFORE any request is sent.
   Returns a human-readable complaint, or '' when the key is usable. */
function cloudKeyProblem(k){
  k=String(k==null?'':k);
  if(!k) return 'no key saved yet';
  for(let i=0;i<k.length;i++){
    const c=k.charCodeAt(i);
    if(c>255) return 'character “'+k[i]+'” (U+'+c.toString(16).toUpperCase().padStart(4,'0')+') at position '+(i+1)+' is not allowed in a key';
  }
  if(!/^eyJ/.test(k) && !/^sb_publishable_/i.test(k)) return 'this does not look like an anon key (it should start with “eyJ”)';
  if(/^eyJ/.test(k)){
    if(k.split('.').length!==3) return 'an anon key has 3 parts separated by dots — this one has '+k.split('.').length;
    if(k.length<150) return 'it is only '+k.length+' characters — a full key is about 210';
    const badAt=k.search(/[^A-Za-z0-9._-]/);
    if(badAt>=0) return 'character “'+k[badAt]+'” at position '+(badAt+1)+' cannot appear in a key';
  }
  return '';
}
function cloudSave(c){ try{
    c=c||{}; if(c.key!=null) c.key=cloudClean(c.key); if(c.url!=null) c.url=cloudClean(c.url);
    localStorage.setItem('tg2_cloud', JSON.stringify(c));
  }catch(e){} }
function cloudOn(){ const c=cloudCfg(); return !!(c.url&&c.key); }
/* Supabase now issues two key styles: the legacy `anon` JWT (eyJ…) and the newer
   `sb_publishable_…`. A JWT is valid in BOTH headers; a publishable key is not a JWT,
   so sending it as `Authorization: Bearer` makes the gateway fail to parse it.
   apikey alone is enough to pick the anon role, so only add Bearer for a real JWT. */
/* Reading head. Once the page is hosted publicly the read policy is tightened to
   `to authenticated`, so prefer the signed-in token whenever we have one and fall
   back to the anon key — that way the same code works before and after tightening. */
function _cloudHead(){ const c=cloudCfg(); const h={'apikey':c.key,'Content-Type':'application/json'};
  if(cloudSignedIn()) h['Authorization']='Bearer '+cloudSess().token;
  else if(/^eyJ/.test(c.key||'')) h['Authorization']='Bearer '+c.key;
  return h; }
/* ---- signed-in writes ----------------------------------------------------
   Reading is open to the anon key, but the RLS policy only lets an AUTHENTICATED
   user write (`for all to authenticated`). So Push must send the signed-in user's
   access token as Bearer — with the anon key it comes back
   401 "new row violates row-level security". Session is global (all companies). */
/* Write into the Cloud-Sync status line. MUST re-query the element every time:
   these functions await a network call, and a re-render during that await swaps
   #cldStat for a fresh node — a reference captured beforehand ends up detached and
   the message is silently lost (that is exactly how a stale error stayed on screen
   while the request had actually succeeded). */
function _cldSay(text, isHtml){ const s=$('#cldStat'); if(!s) return;
  if(isHtml) s.innerHTML=text; else s.textContent=text; }
function cloudSess(){ try{ return JSON.parse(localStorage.getItem('tg2_cloudsess')||'null')||{}; }catch(e){ return {}; } }
function cloudSessSave(s){ try{ localStorage.setItem('tg2_cloudsess', JSON.stringify(s)); }catch(e){} }
/* "Signed in" means: we hold a token, OR we hold a refresh token that can silently get
   a new one. Supabase access tokens last ~1 hour; the refresh token renews the session
   indefinitely, so nobody has to log in again every hour. */
function cloudSignedIn(){ const s=cloudSess(); return !!(s.token && s.exp && Date.now()<s.exp) || !!(s.refresh); }
function cloudTokenFresh(){ const s=cloudSess(); return !!(s.token && s.exp && Date.now()<s.exp-60000); }
var _cloudRefreshing=null;
/* Renew the access token when it is close to expiry. Safe to call before every request;
   it is a no-op while the current token is still good, and concurrent callers share one
   in-flight refresh. Returns true when a usable token is available. */
async function cloudEnsureSession(){
  if(cloudTokenFresh()) return true;
  const s=cloudSess();
  if(!s.refresh || !cloudOn()) return false;
  if(_cloudRefreshing) return _cloudRefreshing;
  _cloudRefreshing=(async()=>{
    try{
      const r=await fetch(cloudCfg().url.replace(/\/+$/,'')+'/auth/v1/token?grant_type=refresh_token',
        {method:'POST',headers:{'apikey':cloudCfg().key,'Content-Type':'application/json'},
         body:JSON.stringify({refresh_token:s.refresh})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok || !j.access_token) throw new Error(j.error_description||j.message||('HTTP '+r.status));
      cloudSessSave({token:j.access_token, refresh:j.refresh_token||s.refresh,
                     email:(j.user&&j.user.email)||s.email,
                     exp:Date.now()+((j.expires_in||3600)-60)*1000});
      return true;
    }catch(e){
      /* refresh token rejected (revoked / user deleted) — force a real sign-in */
      try{ localStorage.removeItem('tg2_cloudsess'); }catch(_){}
      return false;
    }finally{ _cloudRefreshing=null; }
  })();
  return _cloudRefreshing;
}
function _cloudWriteHead(){ const c=cloudCfg();
  return {'apikey':c.key,'Content-Type':'application/json','Authorization':'Bearer '+cloudSess().token}; }
async function cloudLogin(){
  const e=$('#cldEmail'), p=$('#cldPass');
  if(!cloudOn()){ _cldSay('Enter the URL + key first.'); return; }
  const kp=cloudKeyProblem(cloudCfg().key);
  if(kp){ _cldSay('❌ The saved key is not usable — '+kp+'.'); return; }
  const email=cloudClean(e&&e.value), pass=(p&&p.value)||'';
  if(!email||!pass){ _cldSay('Type the email and password you created in Supabase.'); return; }
  _cldSay('Signing in…');
  try{
    const r=await fetch(cloudCfg().url.replace(/\/+$/,'')+'/auth/v1/token?grant_type=password',
      {method:'POST',headers:{'apikey':cloudCfg().key,'Content-Type':'application/json'},
       body:JSON.stringify({email:email,password:pass})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error_description||j.msg||j.message||('HTTP '+r.status));
    cloudSessSave({token:j.access_token, refresh:j.refresh_token||'', email:(j.user&&j.user.email)||email,
                   exp:Date.now()+((j.expires_in||3600)-60)*1000});
    if(p) p.value='';
    toast('Signed in', email, 'ok'); route();
  }catch(err){
    _cldSay('❌ Sign-in failed — '+(/Invalid login/i.test(err.message)?'wrong email or password.'
      :(/confirm/i.test(err.message)?'that user is not confirmed — tick “Auto Confirm User” in Supabase.':err.message)));
  }
}
function cloudSignOut(){ try{ localStorage.removeItem('tg2_cloudsess'); }catch(e){} toast('Signed out','Cloud writing is now locked','ok'); route(); }
function _cloudBase(){ return cloudCfg().url.replace(/\/+$/,'')+'/rest/v1/blis_sync'; }
function _cloudMeta(){ try{ return JSON.parse(localStorage.getItem(CO_PREFIX+'cloudmeta')||'{}'); }catch(e){ return {}; } }
async function cloudPush(silent){
  if(!cloudOn()){ if(!silent) toast('Not set up','Enter the cloud URL and key first','err'); return false; }
  const _kp=cloudKeyProblem(cloudCfg().key);
  if(_kp){ if(!silent){ _cldSay('❌ The saved key is not usable — '+_kp+'.'); toast('Bad key',_kp,'err'); } return false; }
  if(!cloudSignedIn() || !(await cloudEnsureSession())){
    if(!silent) toast('Sign in first','Writing to the cloud needs your email + password (below)','err'); return false; }
  const co=(coList().find(c=>c.id===ACTIVE_CO)||{}).name||ACTIVE_CO;
  const keys={}; _coSubKeys().forEach(sub=>{ keys[sub]=localStorage.getItem(CO_PREFIX+sub); });
  /* A key that was never edited is still sitting on its seed defaults — it exists in
     memory but not in storage, so it used to be left out of the push and the console
     showed it as empty. Fill any missing key from what the app is actually using. */
  const _live={ tally:()=>tallyItems, alias:()=>aliasTable, cocktails:()=>cocktails,
                cocktailAlias:()=>cocktailAlias, pos:()=>posData, namemap:()=>nameMapList,
                rawdata2:()=>rawData, inv:()=>invData, recv:()=>receivedStock, mr:()=>mrDetail,
                period:()=>period, cfg:()=>cfg };
  Object.keys(_live).forEach(k=>{
    if(keys[k]!=null) return;                       // already saved — leave it alone
    try{ const v=_live[k](); if(v!=null) keys[k]=JSON.stringify(v); }catch(e){}
  });
  try{
    /* A push replaces the whole company copy, so it must not silently bury work that
       someone else saved after we last synced. Look at what is in the cloud now: if it
       moved on since our last Pull/Push, stop and tell the user to Pull first. */
    const seen=(_cloudMeta().cloudAt||null);
    const cur=await fetch(_cloudBase()+'?id=eq.'+encodeURIComponent(ACTIVE_CO)+'&select=updated_at',{headers:_cloudHead()});
    if(cur.ok){
      const rows=await cur.json().catch(()=>[]);
      const theirs=(rows[0]||{}).updated_at||null;
      if(theirs && seen && theirs!==seen){
        const when=new Date(theirs).toLocaleString();
        if(!silent){
          _cldSay('⚠️ Someone else saved to the cloud at '+esc(when)+'. Press ⬇ Pull from cloud first, then Push — otherwise their work would be replaced.');
          toast('Cloud is newer','Pull first, then Push','err');
        }
        return false;
      }
    }
    const stamp=new Date().toISOString();
    const r=await fetch(_cloudBase(),{method:'POST',headers:{..._cloudWriteHead(),'Prefer':'resolution=merge-duplicates'},
      body:JSON.stringify([{id:ACTIVE_CO, co:co, data:keys, updated_at:stamp}])});
    if(!r.ok){ const t=await r.text().catch(()=>''); throw new Error('HTTP '+r.status+(t?' · '+t.slice(0,120):'')); }
    try{ localStorage.setItem(CO_PREFIX+'cloudmeta', JSON.stringify({push:stamp, cloudAt:stamp})); }catch(e){}
    if(!silent){ toast('Cloud saved','Company data pushed to the cloud','ok'); if(location.hash==='#settings') route(); }
    return true;
  }catch(e){
    if(!silent){
      _cldSay('❌ Push failed — '+e.message);
      toast('Push failed', /401|403|row-level/.test(e.message)?'Sign in again — the session may have expired':e.message, 'err');
    }
    return false; }
}
async function cloudPull(){
  if(!cloudOn()){ toast('Not set up','Enter the cloud URL and key first','err'); return; }
  try{
    await cloudEnsureSession();
    const r=await fetch(_cloudBase()+'?id=eq.'+encodeURIComponent(ACTIVE_CO)+'&select=co,data,updated_at',{headers:_cloudHead()});
    if(r.status===401||r.status===403){ toast('Sign in first','Reading the cloud needs your email + password (Settings → Cloud Sync)','err'); return; }
    if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    if(!Array.isArray(j)||!j.length||!j[0].data){ toast('Nothing in cloud','No cloud copy for this company yet — Push first','err'); return; }
    const row=j[0];
    confirmAsk('Load the cloud copy of <strong>'+esc(row.co||ACTIVE_CO)+'</strong> (saved '+esc(new Date(row.updated_at).toLocaleString())+')?<br>Current data on THIS device will be REPLACED.', ()=>{
      try{
        _coSubKeys().forEach(sub=>localStorage.removeItem(CO_PREFIX+sub));
        Object.keys(row.data).forEach(sub=>localStorage.setItem(CO_PREFIX+sub, row.data[sub]));
        /* remember WHICH cloud version we now hold, so a later Push can tell whether
           anyone else has saved in the meantime */
        localStorage.setItem(CO_PREFIX+'cloudmeta', JSON.stringify({push:row.updated_at, cloudAt:row.updated_at}));
      }catch(e){ toast('Restore failed','Storage error','err'); return; }
      location.reload();
    });
  }catch(e){ toast('Pull failed','Could not reach the cloud — check URL / key','err'); }
}
async function cloudTest(){
  if(!cloudOn()){ _cldSay('Enter the URL + key first.'); return; }
  const kp=cloudKeyProblem(cloudCfg().key);
  if(kp){ _cldSay('❌ The saved key is not usable — '+kp+'. Clear the API-key box and paste the whole key again (or just run cloud-setup.html).'); return; }
  _cldSay('Checking…');
  try{
    await cloudEnsureSession();
    const r=await fetch(_cloudBase()+'?select=id,updated_at&limit=50',{headers:_cloudHead()});
    if(!r.ok){
      const t=await r.text().catch(()=>'');
      let why='HTTP '+r.status;
      if(r.status===401) why='the key was refused (401) — copy the anon key again';
      else if(r.status===404) why='the blis_sync table was not found (404) — run the setup SQL';
      else if(r.status===403||/permission denied/i.test(t)) why='no permission on the table (403) — run the GRANT statements';
      _cldSay('❌ '+why+(t?' · '+t.slice(0,110):''));
      return;
    }
    const j=await r.json(); const arr=Array.isArray(j)?j:[];
    const mine=arr.find(x=>x.id===ACTIVE_CO);
    _cldSay('✅ Connected · '+arr.length+(arr.length===1?' company':' companies')+' in cloud'
      +(mine?' · this one saved '+esc(new Date(mine.updated_at).toLocaleString()):' · this company not pushed yet')
      +(cloudSignedIn()?' · signed in as '+esc(cloudSess().email):' · <strong>not signed in</strong> — sign in below to allow Push'), true);
  }catch(e){ _cldSay('❌ The request did not go through — '+(e&&e.message||'network error')
      +'. Check the internet connection on this computer.'); }
}
var _cloudTimer=null;   // var (not let): bsv → cloudMark can fire during file load
function cloudMark(k){
  if(!(k==='tally'||k==='alias'||k==='cocktails'||k==='cocktailAlias'||k==='pos'||k==='namemap'
     ||k==='inv'||k==='mr'||k==='recv'||k==='rawdata2'||k==='period'||k==='cfg'||k==='users'
     ||k==='months'||k==='invoices'||k==='bevmap'||k==='bevpages'||k.indexOf('inv2_')===0)) return;
  const c=cloudCfg(); if(!c.url||!c.key||!c.auto) return;
  if(_cloudTimer) clearTimeout(_cloudTimer);
  _cloudTimer=setTimeout(()=>{ _cloudTimer=null; cloudPush(true); }, 60000);
}
/* ---------------- Cloud watch ----------------
   The client asked to be ASKED, never to have the screen replaced under them, so this only
   ever raises a bar with a button — it never pulls on its own. Runs on a timer and again
   whenever the tab is brought back to the front. */
var _cloudSeenAt=null, _cloudWatchT=null;
function _agoTxt(iso){
  const s=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/1000));
  if(s<90) return 'just now';
  const m=Math.round(s/60); if(m<60) return m+' minute'+(m>1?'s':'')+' ago';
  const h=Math.round(m/60); if(h<24) return h+' hour'+(h>1?'s':'')+' ago';
  return Math.round(h/24)+' day(s) ago';
}
function cloudBanner(stamp){
  let b=document.getElementById('cloudNew');
  if(!b){ b=document.createElement('div'); b.id='cloudNew'; b.className='cloudnew noprint'; document.body.appendChild(b); }
  b.innerHTML='<span class="cn-i">☁️</span>'
    +'<div class="cn-t"><b>Newer data is in the cloud</b>'
    +'<span>Saved '+esc(_agoTxt(stamp))+' — from the backend or another device</span></div>'
    +'<button class="btn btn-gold btn-sm" onclick="cloudPullNow()">⬇ Bring it in</button>'
    +'<button class="cn-x" title="Not now" onclick="cloudBannerHide()">✕</button>';
  b.classList.add('on');
}
function cloudBannerHide(){ const b=document.getElementById('cloudNew'); if(b) b.classList.remove('on'); }
async function cloudPullNow(){ cloudBannerHide(); try{ await cloudPull(); }catch(e){} }
async function cloudCheck(){
  if(!cloudOn()) return;
  try{
    const r=await fetch(_cloudBase()+'?id=eq.'+encodeURIComponent(ACTIVE_CO)+'&select=updated_at',{headers:_cloudHead()});
    if(!r.ok) return;
    const j=await r.json(); if(!Array.isArray(j)||!j.length) return;
    const stamp=j[0].updated_at, cloudT=new Date(stamp).getTime();
    const m=_cloudMeta(), localT=m.push?new Date(m.push).getTime():0;
    // 2 minutes of slack so this device's own push never trips its own alarm
    if(cloudT>localT+120000 && stamp!==_cloudSeenAt){ _cloudSeenAt=stamp; cloudBanner(stamp); }
  }catch(e){}
}
function cloudWatch(){ if(_cloudWatchT) clearInterval(_cloudWatchT); _cloudWatchT=setInterval(cloudCheck,90000); }
document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(()=>{ cloudCheck(); cloudWatch(); },2500); });
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) cloudCheck(); });

/* ---------------- Smart Assistant · AI answers ----------------
   Optional. With no key the assistant stays exactly as it was: offline keyword matching,
   no network, no cost. With a key it sends a SMALL SUMMARY of the figures (never the whole
   database) plus the offline engine's own computed answer, and asks the model to phrase a
   reply using only those numbers — so it explains, it does not invent.

   The key lives in the global `tg2_ai`, is excluded from `_coSubKeys()`, and therefore never
   reaches a backup or the cloud row (the v2.19.3 lesson: a secret in the pushed blob is
   readable by anyone holding the anon key).
   Written as plain fetch because this project has no build step and no npm — the same reason
   every other library here is vendored. */
function aiCfg(){ try{ return JSON.parse(localStorage.getItem('tg2_ai')||'null')||{}; }catch(e){ return {}; } }
function aiSave(c){ try{ localStorage.setItem('tg2_ai', JSON.stringify(c)); }catch(e){} }
function aiOn(){ const c=aiCfg(); return !!(c.prov && c.prov!=='off' && c.key); }
const AI_DEF={openai:'gpt-4o-mini', anthropic:'claude-opus-5'};
function aiModel(c){ return (c.model||'').trim() || AI_DEF[c.prov] || ''; }
function aiSaveForm(){
  const prov=$('#aiProv').value, key=cloudClean($('#aiKey').value), model=$('#aiModel').value.trim();
  aiSave({prov:prov, key:key, model:model});
  if(prov!=='off' && key){ const p=aiKeyProblem(key); if(p){ toast('Check the key',p,'err'); return; } }
  toast('Saved', prov==='off'?'AI is off — the assistant stays offline':'AI is on for the Smart Assistant','ok');
  route();
}
/* keys are pasted, and pasting is where invisible characters get in (see v2.19.1/2) */
function aiKeyProblem(k){
  for(let i=0;i<k.length;i++){ const c=k.charCodeAt(i);
    if(c>255) return 'The key contains the character “'+k[i]+'” (U+'+c.toString(16).toUpperCase().padStart(4,'0')
      +') at position '+(i+1)+'. Copy it again from the provider’s page.'; }
  if(k.length<20) return 'That key looks too short — copy the whole thing.';
  return '';
}
async function aiAsk(question, facts){
  const c=aiCfg(), model=aiModel(c);
  const sys='You are the assistant inside a bar liquor inventory system. Answer ONLY from the figures given below. '
    +'Never invent a number: if a figure is not in the data, say it is not in the data. Amounts are Indian rupees; '
    +'write them Indian style (1,04,250). Be brief — under 120 words, plain sentences, no markdown headings. '
    +'If the question is in Bengali, answer in Bengali.\n\nDATA:\n'+facts;
  if(c.prov==='anthropic'){
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':c.key,'anthropic-version':'2023-06-01',
               'anthropic-beta':'server-side-fallback-2026-07-01',
               'anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:model, max_tokens:2000, system:sys, fallbacks:'default',
        output_config:{effort:'low'}, messages:[{role:'user',content:question}]})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((j.error&&j.error.message)||('HTTP '+r.status));
    if(j.stop_reason==='refusal') throw new Error('The model declined to answer that one.');
    const t=(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
    if(!t) throw new Error('Empty answer.');
    return t;
  }
  const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+c.key},
    body:JSON.stringify({model:model, max_tokens:2000,
      messages:[{role:'system',content:sys},{role:'user',content:question}]})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error((j.error&&j.error.message)||('HTTP '+r.status));
  const t=(((j.choices||[])[0]||{}).message||{}).content||'';
  if(!t.trim()) throw new Error('Empty answer.');
  return t.trim();
}
async function aiTest(){
  const s=$('#aiStat'); if(s) s.innerHTML='Checking…';
  if(!aiOn()){ if(s) s.innerHTML='Pick a provider and paste a key first.'; return; }
  try{
    const t=await aiAsk('Reply with the two words: connection ok','(no figures — this is a connection test)');
    const el=$('#aiStat'); if(el) el.innerHTML='✅ Working — '+esc(String(t).slice(0,60));
  }catch(e){
    const el=$('#aiStat'); if(el) el.innerHTML='❌ '+esc(e&&e.message||'failed')
      +'<br><span class="muted">The assistant keeps working offline whatever this says.</span>';
  }
}
/* ---------------- WhatsApp report ---------------- */
function waReport(){
  const {totalC,totalS}=calcGrandTotals();
  let D=null; try{ D=biRoyalData(); }catch(e){}
  let low=[]; try{ low=lowStockList(); }catch(e){}
  const top=(D?D.rows.slice().sort((a,b)=>b.A.sale-a.A.sale).slice(0,5):[]);
  const L=[];
  L.push('*'+(cfg.company||'Bar')+' — Daily Report*');
  L.push('Period: '+period.from+' → '+period.to);
  L.push('');
  L.push('🍸 Cocktail: '+fmt(totalC)+' ml');
  L.push('🥃 Straight: '+fmt(totalS)+' ml');
  L.push('Σ Total Sale: '+fmt(totalC+totalS)+' ml');
  if(D){ L.push('💰 Sale Value: ₹'+fmt(Math.round(D.tot.sale)));
         L.push('⚖️ Variance Value: ₹'+fmt(Math.round(D.tot.varv))); }
  if(top.length){ L.push(''); L.push('*Top 5 (₹):*');
    top.forEach((r,i)=>L.push((i+1)+'. '+r.name+' — ₹'+fmt(Math.round(r.A.sale)))); }
  if(low.length){ L.push(''); L.push('🚨 Low/Out stock: '+low.length+' items');
    low.slice(0,5).forEach(x=>L.push('· '+x.name+' ('+x.status+')')); }
  const num=(cfg.waNumber||'').replace(/\D/g,'');
  const url='https://wa.me/'+(num?num:'')+'?text='+encodeURIComponent(L.join('\n'));
  window.open(url,'_blank');
}

/* ---------------- state (seeded with real data; CANTEEN company uses its own seed) ---------------- */
const SEED_TALLY = (CO_IS_CANTEEN && typeof CANTEEN_TALLY!=='undefined') ? CANTEEN_TALLY : INIT_TALLY;
const SEED_ALIAS = (CO_IS_CANTEEN && typeof CANTEEN_ALIAS!=='undefined') ? CANTEEN_ALIAS : INIT_ALIAS;
const SEED_CKS   = (CO_IS_CANTEEN && typeof CANTEEN_COCKTAILS!=='undefined') ? CANTEEN_COCKTAILS : INIT_COCKTAILS;
const SEED_CKAL  = CO_IS_CANTEEN ? ((typeof CANTEEN_CKALIAS!=='undefined')?CANTEEN_CKALIAS:[]) : INIT_COCKTAIL_ALIAS;
const DEFAULT_POS = (CO_IS_CANTEEN && typeof CANTEEN_POS!=='undefined') ? CANTEEN_POS.map(r=>({ name:r.n, qty:r.q }))
  : ((typeof REAL_SALES !== 'undefined') ? REAL_SALES.map(r => ({ name: r.n, qty: r.q })) : []);
let tallyItems    = bls('tally',  SEED_TALLY.map(t => ({...t})));
let aliasTable    = bls('alias',  SEED_ALIAS.map(a => ({...a})));
let cocktails     = bls('cocktails', SEED_CKS.map(c => ({...c, recipe:(c.recipe||[]).map(x=>({...x}))})));
let cocktailAlias = bls('cocktailAlias', SEED_CKAL.map(c => ({...c})));
// Excel-faithful multipliers, read from the client's cocktails-sheet formulas: VLOOKUP("Liit 1:1 (500ml)")*2.
// Applied once when the alias has no manual × yet — the user can still change it in the editor.
const CKX_PATCH = { 'LIIT 1:1 (500ML)': 2 };
(function(){ let ch=false; cocktailAlias.forEach(a=>{ const k=norm(a.alias);
  if(CKX_PATCH[k]!=null && !(+a.x>0)){ a.x=CKX_PATCH[k]; ch=true; } });
  if(ch){ try{ localStorage.setItem(CO_PREFIX+'cocktailAlias',JSON.stringify(cocktailAlias)); }catch(e){} } })();
// Auto-heal: a company whose STORED cocktail aliases all point at cocktails that don't
// exist in its cocktail list (e.g. Traffic aliases saved into the Canteen namespace
// before the Canteen seed existed) is carrying stale data — replace with this
// company's seed so POS cocktail names resolve again.
(function(){
  if(!cocktailAlias.length || !SEED_CKAL.length) return;
  const have=new Set(cocktails.map(c=>norm(c.name)));
  if(cocktailAlias.some(a=>have.has(norm(a.canonical)))) return;   // at least one valid → keep user data
  cocktailAlias=SEED_CKAL.map(c=>({...c}));
  try{ localStorage.setItem(CO_PREFIX+'cocktailAlias',JSON.stringify(cocktailAlias)); }catch(e){}
})();
let posData       = bls('pos', DEFAULT_POS);
let nameMapList   = bls('namemap', []);
// Seed-version migration: when a NEWER canteen seed ships (CANTEEN_SEED_V bumped),
// refresh the mapping data once — tally/alias/cocktails/cocktailAlias/pos are replaced
// with the new seed; the user's inventory figures (inv/mr/recv/rawdata2) are untouched.
// NOTE: writes localStorage DIRECTLY (no bsv) — bsv's rebuild hooks touch `let` state
// that is not initialised yet at this point in the load.
(function(){
  if(!CO_IS_CANTEEN || typeof CANTEEN_SEED_V==='undefined') return;
  let v=0; try{ v=+JSON.parse(localStorage.getItem(CO_PREFIX+'canteenSeedV'))||0; }catch(e){}
  if(v===CANTEEN_SEED_V) return;
  tallyItems=SEED_TALLY.map(t=>({...t}));
  aliasTable=SEED_ALIAS.map(a=>({...a}));
  cocktails=SEED_CKS.map(c=>({...c, recipe:(c.recipe||[]).map(x=>({...x}))}));
  cocktailAlias=SEED_CKAL.map(c=>({...c}));
  posData=DEFAULT_POS.map(p=>({...p}));
  try{
    localStorage.setItem(CO_PREFIX+'tally',JSON.stringify(tallyItems));
    localStorage.setItem(CO_PREFIX+'alias',JSON.stringify(aliasTable));
    localStorage.setItem(CO_PREFIX+'cocktails',JSON.stringify(cocktails));
    localStorage.setItem(CO_PREFIX+'cocktailAlias',JSON.stringify(cocktailAlias));
    localStorage.setItem(CO_PREFIX+'pos',JSON.stringify(posData));
    localStorage.setItem(CO_PREFIX+'canteenSeedV',JSON.stringify(CANTEEN_SEED_V));
  }catch(e){}
})();
let period        = bls('period', (CO_IS_CANTEEN && typeof CANTEEN_PERIOD!=='undefined') ? {...CANTEEN_PERIOD} : { from: '2026-05-01', to: '2026-05-31' });
let pref          = bls('pref', { edition:'', theme:'t-emlux', font:'Inter', fsize:14, clk12:true });
let cfg           = bls('cfg',  { company:'Traffic Gastropub', subtitle:'Bar Control System', admin:'Totai Ghosh', mobile:'7001468453', logo:null, photo:null });
let users         = bls('users', []);   // per-company login users [{u,p,role:'admin'|'manager'|'staff'}] — admin creds on the login card still work
const initials = s => (s||'').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase() || 'TG';

/* ---------------- appearance (theme / font / clock) ---------------- */
// COLOUR themes (body class t-*) — 1 dark default + 1 + 5 light
const THEMES = [
  {id:'t-emlux',  name:'Emerald Lux',  bg:'#06120d', ac:'#d4af37'},
  {id:'t-black',  name:'Obsidian',     bg:'#000000', ac:'#c9ced8'},
  {id:'t-bgold',  name:'Royal Black-Gold', bg:'#050505', ac:'#f5c518'},
  {id:'t-aurora', name:'Aurora',       bg:'#e8eaf0', ac:'#16a34a'},
  {id:'t-snow',   name:'Snow',         bg:'#eef1f6', ac:'#3b82f6'},
  {id:'t-cream',  name:'Cream',        bg:'#f1e8da', ac:'#b5832e'},
  {id:'t-mint',   name:'Mint',         bg:'#e6f3ec', ac:'#10b981'},
  {id:'t-sky',    name:'Sky',          bg:'#e6eefb', ac:'#2563eb'},
  {id:'t-lav',    name:'Lavender',     bg:'#efe8f9', ac:'#8b5cf6'},
];
const FONTS = ['Inter','Poppins','Montserrat','Roboto'];
// 5 toggleable animations (body class a-<id>); all on by default
const ANIMS = [
  {id:'fade',  name:'Page fade-in',     desc:'views fade up on open'},
  {id:'rows',  name:'Row slide-in',     desc:'table rows slide in'},
  {id:'hover', name:'Hover lift / glow', desc:'cards & rows lift on hover'},
  {id:'toast', name:'Toast pop',        desc:'notifications bounce in'},
  {id:'theme', name:'Theme transition', desc:'smooth colour change on switch'},
];
// PREMIUM EDITIONS (body class ed-*) — complete luxury looks (layout+font+icon treatment baked in)
const EDITIONS = [
  {id:'ed-onyx',    name:'Royal Onyx',      desc:'Matte black · champagne gold · serif · gold-line icons', bg:'#0b0b0d', ac:'#d8bd7f'},
  {id:'ed-velvet',  name:'Velvet Deco',     desc:'Burgundy · brass · uppercase deco · top nav',            bg:'#1c0d12', ac:'#d8a35c'},
  {id:'ed-glow',    name:'Glow Banner',     desc:'Light · gradient hero banner · floating cards',          bg:'#f2f3f8', ac:'#6d5df6'},
  {id:'ed-rail',    name:'Icon Rail',       desc:'Light sage · slim icon-only rail · emerald',             bg:'#eef2ee', ac:'#17a86b'},
  {id:'ed-pastel',  name:'Pastel Bento',    desc:'White · pastel colour stat tiles',                       bg:'#ffffff', ac:'#5b47c2'},
  {id:'ed-neochart',name:'Neo Chart Board', desc:'Charcoal analytics · green + indigo',                    bg:'#16181d', ac:'#4ade80'},
  {id:'ed-ledger',  name:'Magazine Ledger', desc:'Paper · serif editorial ledger',                         bg:'#faf9f6', ac:'#23211c'},
];
const LIGHT_THEMES = ['t-aurora','t-snow','t-cream','t-mint','t-sky','t-lav'];
function applyAppearance(){
  if(pref.edition===undefined) pref.edition='';                      // default = the user's own style (Emerald Lux theme)
  const edOK = EDITIONS.some(e=>e.id===pref.edition);
  const thOK = THEMES.some(t=>t.id===pref.theme);
  let look;
  if(pref.edition && edOK) look=pref.edition;                        // an edition wins
  else if(pref.theme && thOK) look=pref.theme;                       // else a colour theme
  else { look='t-emlux'; pref.theme='t-emlux'; pref.edition=''; }    // migrate anything stale (removed editions → default)
  if(!Array.isArray(pref.anims)) pref.anims = ANIMS.map(a=>a.id);    // default: all on
  const ac = pref.anims.map(a=>'a-'+a).join(' ');
  document.body.className = ('app-body ' + look + ' ' + ac).trim();
  document.body.style.fontFamily = `'${pref.font}', sans-serif`;
  document.body.style.fontSize = pref.fsize + 'px';
  const b=$('#themeToggle'); if(b) b.textContent = LIGHT_THEMES.includes(pref.theme)?'🌙':'☀️';
}
function _afterLook(){ bsv('pref',pref); applyAppearance(); if((location.hash||'').slice(1)==='settings') route(); }
function setEdition(id){ pref.edition=id; pref.theme=''; _afterLook(); }
function setTheme(id){ pref.theme=id; pref.edition=''; _afterLook(); }
// quick dark ⇄ light (topbar toggle): Emerald Lux ⇄ Snow light
function toggleTheme(){ if(LIGHT_THEMES.includes(pref.theme)){ setTheme('t-emlux'); toast('Theme','Emerald Lux','ok'); } else { setTheme('t-snow'); toast('Theme','Snow (light)','ok'); } }
function toggleAnim(id){ if(!Array.isArray(pref.anims)) pref.anims=ANIMS.map(a=>a.id);
  pref.anims = pref.anims.includes(id) ? pref.anims.filter(a=>a!==id) : pref.anims.concat(id);
  bsv('pref',pref); applyAppearance(); if((location.hash||'').slice(1)==='settings') route(); }
function setFontFam(f){ pref.font=f; bsv('pref',pref); applyAppearance(); if((location.hash||'').slice(1)==='settings') route(); }
function setFontSize(n){ pref.fsize=+n; bsv('pref',pref); applyAppearance(); }
function setClk(is12){ pref.clk12=is12; bsv('pref',pref); }
let _clkTimer=null;
function startClock(){
  if(_clkTimer) clearInterval(_clkTimer);
  const upd=()=>{ const el=$('#clkT'), ed=$('#clkD');
    const d=new Date(); let h=d.getHours(); const m=String(d.getMinutes()).padStart(2,'0'); const s=String(d.getSeconds()).padStart(2,'0');
    let sfx=''; if(pref.clk12){ sfx=h>=12?' PM':' AM'; h=h%12||12; }
    const tTxt=String(h).padStart(2,'0')+':'+m+':'+s+sfx;
    const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dTxt=String(d.getDate()).padStart(2,'0')+' '+MON[d.getMonth()].toUpperCase()+' '+d.getFullYear();
    if(el) el.textContent=tTxt;
    if(ed) ed.textContent=String(d.getDate()).padStart(2,'0')+' '+MON[d.getMonth()]+' '+d.getFullYear();
    // the Beverage-Control page header carries its own clock box (same tick)
    const pt=$('#bcClkT'), pd=$('#bcClkD');
    if(pt) pt.textContent=tTxt;
    if(pd) pd.textContent=dTxt;
  };
  upd(); _clkTimer=setInterval(upd,1000);
}

/* ============================================================
   CALCULATION ENGINE — verbatim from the workbook app
   ============================================================ */
function norm(s){ return String(s==null?'':s).toUpperCase().replace(/["'.,]/g,'').replace(/\s+/g,' ').trim(); }

let _tallyIdx=null, _nameMapIdx=null, _aliasIdx=null;
function rebuildIndexes(){
  _tallyIdx = new Map(); tallyItems.forEach((t,i)=>_tallyIdx.set(norm(t.name), i));
  _nameMapIdx = new Map(); nameMapList.forEach(m=>_nameMapIdx.set(norm(m.pos), m.tally));
  _aliasIdx = new Map(); aliasTable.forEach(a=>_aliasIdx.set(norm(a.posName), {tallyItem:a.tallyItem, mlPerUnit:a.mlPerUnit, x:(+a.x>0)?+a.x:1}));
}
rebuildIndexes();
function getTallyItem(name){ if(!_tallyIdx) rebuildIndexes(); const i=_tallyIdx.get(norm(name)); return i!==undefined?tallyItems[i]:undefined; }
function resolvePosToTally(posName){
  if(!_tallyIdx) rebuildIndexes();
  const pn = norm(posName);
  if(_nameMapIdx.has(pn)) return {tallyName:_nameMapIdx.get(pn), mlPerUnit:null, x:1};
  if(_aliasIdx.has(pn)){ const a=_aliasIdx.get(pn); return {tallyName:a.tallyItem, mlPerUnit:a.mlPerUnit, x:(a.x>0?a.x:1)}; }
  if(_tallyIdx.has(pn)) return {tallyName:tallyItems[_tallyIdx.get(pn)].name, mlPerUnit:null, x:1};
  return null;
}
let _cocktailIdx=null, _cocktailAliasIdx=null;
function rebuildCocktailAliasIndex(){
  _cocktailIdx = new Set(cocktails.map(c=>norm(c.name)));
  _cocktailAliasIdx = new Map();
  cocktailAlias.forEach(a=>_cocktailAliasIdx.set(norm(a.alias), norm(a.canonical)));
}
rebuildCocktailAliasIndex();
function resolveCocktailName(posName){
  if(!_cocktailIdx) rebuildCocktailAliasIndex();
  const pn = norm(posName);
  if(_nameMapIdx && _nameMapIdx.has(pn)){ const mapped=norm(_nameMapIdx.get(pn)); if(_cocktailIdx.has(mapped)) return mapped; }
  if(_cocktailAliasIdx.has(pn)) return _cocktailAliasIdx.get(pn);
  if(_cocktailIdx.has(pn)) return pn;
  return null;
}
function isKnownPosName(posName){ return resolvePosToTally(posName)!==null || resolveCocktailName(posName)!==null; }
function buildCocktailQtyMap(){
  if(!_cocktailAliasIdx) rebuildCocktailAliasIndex();
  const map={}; posData.forEach(p=>{ const pn=norm(p.name);
    if(_cocktailAliasIdx.has(pn)){
      const canon=_cocktailAliasIdx.get(pn);
      // Excel-style manual multiplier: VLOOKUP("Liit 1:1")*2 → qty × x (x set by hand, default 1)
      let mult=1; const a=cocktailAlias.find(x=>norm(x.alias)===pn);
      if(a){ if(+a.x>0) mult=+a.x;
        else if(+a.ml>0){ const ck=cocktails.find(c=>norm(c.name)===canon);
          const rml=ck?ck.recipe.reduce((s,r)=>s+(+r.ml||0),0):0; if(rml>0) mult=(+a.ml)/rml; } }   // legacy entries
      map[canon]=(map[canon]||0)+p.qty*mult;
    } else map[pn]=(map[pn]||0)+p.qty; });
  return map;
}
function resolveCocktailQty(cocktailName, qtyMap){ const cn=norm(cocktailName); if(qtyMap) return qtyMap[cn]||0; return buildCocktailQtyMap()[cn]||0; }
function computeStraightMlMap(){
  const map={}, posQtyMap={};
  posData.forEach(p=>{
    const res=resolvePosToTally(p.name); if(!res) return;
    const item=getTallyItem(res.tallyName); if(!item) return;
    // Beer / Alcopops / Beverage & Cigarette are counted as PIECES — matches the Excel bar-tie
    // and the inventory sheet; a stray alias mlPerUnit (e.g. 30) must never inflate a pcs item.
    // A deliberate ×N multiplier (offers like 1+1) still applies to both ml and pcs items.
    const xm=(res.x>0)?res.x:1;
    const isPcs = item.unit && item.unit!=='ml';
    const mlPerUnit = isPcs ? xm : (((res.mlPerUnit!=null)?res.mlPerUnit:(item.pegMl||30))*xm);
    const key=norm(item.name);
    map[key]=(map[key]||0)+(p.qty*mlPerUnit);
    posQtyMap[key]=(posQtyMap[key]||0)+p.qty;
  });
  return {smlMap:map, posQtyMap};
}
function computeCocktailMlMap(){
  const map={}; const qtyMap=buildCocktailQtyMap();
  cocktails.forEach(c=>{
    const qty=resolveCocktailQty(c.name, qtyMap); if(qty<=0) return;
    c.recipe.forEach(r=>{
      let item=getTallyItem(r.spirit);
      if(!item){ const sn=norm(r.spirit); item=tallyItems.find(t=>{const tn=norm(t.name); return tn.includes(sn)||sn.includes(tn);}); }
      const key=item?norm(item.name):norm(r.spirit);
      map[key]=(map[key]||0)+(qty*r.ml);
    });
  });
  return map;
}
function getEffectiveCocktailMl(item, cmlMap){ const a=cmlMap[norm(item.name)]||0; return item.cocktailMl>0?item.cocktailMl:Math.round(a); }
function getEffectiveStraightMl(item, smlMap){ const a=smlMap[norm(item.name)]||0; return item.straightMl>0?item.straightMl:Math.round(a); }
function getEffectivePosQty(item, posQtyMap){ return posQtyMap[norm(item.name)]||0; }
let _gtCache=null, _gtKey=null;
function invalidateCalcCache(){ _gtCache=null; _gtKey=null; }
function calcGrandTotals(){
  const key=posData.length+':'+tallyItems.length+':'+cocktails.length+':'+aliasTable.length;
  if(_gtCache && _gtKey===key) return _gtCache;
  const cmlMap=computeCocktailMlMap();
  const {smlMap, posQtyMap}=computeStraightMlMap();
  let totalC=0, totalS=0;
  tallyItems.forEach(t=>{ totalC+=getEffectiveCocktailMl(t,cmlMap); totalS+=getEffectiveStraightMl(t,smlMap); });
  const result={totalC:Math.round(totalC), totalS:Math.round(totalS), cmlMap, smlMap, posQtyMap};
  _gtCache=result; _gtKey=key; return result;
}

/* ---------- derived helpers ---------- */
const fmt = n => Number(Math.round(n)).toLocaleString('en-IN');
const esc = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function errorRows(){ return posData.filter(p => !isKnownPosName(p.name)); }
function aliasesForBrand(brandName){ const bn=norm(brandName); return aliasTable.filter(a=>norm(a.tallyItem)===bn); }
// qty sold under one exact POS button name (for per-alias qty pills)
function posQtyOfName(n){ const k=norm(n); return posData.reduce((s,p)=>s+(norm(p.name)===k?(+p.qty||0):0),0); }

/* ---------- generic per-page layout engine: def / twopane / accordion / cards / dense ---------- */
let _lySel={}, _lyOpen={};
function jatt(s){ return JSON.stringify(String(s)).replace(/'/g,'&#39;'); }   // safe for onclick='…'
function pageLay(p){ return pref['lay_'+p]||'def'; }
function setPageLayout(p,v){ pref['lay_'+p]=v; bsv('pref',pref); route(); }
function lyPick(p,id){ _lySel[p]=id; route(); }
function lyToggle(p,id){ _lyOpen[p]=(_lyOpen[p]===id?'':id); route(); }
function layDrop(p){ const cur=pageLay(p);
  return `<select class="input" style="width:auto;padding:6px 9px;font-size:12px" title="Layout" onchange="setPageLayout('${p}',this.value)">${[['def','① Default'],['twopane','② Two-Pane'],['accordion','③ Accordion'],['cards','④ Cards'],['dense','⑤ Dense']].map(o=>`<option value="${o[0]}" ${cur===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select>`; }
// groups: [{id, title, sub, right, detail, manage}] — used by twopane / accordion / cards
function renderLay(p, lay, groups, o){
  o=o||{};
  if(lay==='twopane'){
    if(!_lySel[p] || !groups.some(g=>g.id===_lySel[p])) _lySel[p]=groups.length?groups[0].id:'';
    const sel=groups.find(g=>g.id===_lySel[p]);
    const list=groups.map(g=>`<div style="padding:7px 11px;cursor:pointer;border-left:3px solid ${g.id===_lySel[p]?'var(--gold)':'transparent'};background:${g.id===_lySel[p]?'var(--gold-dim)':'transparent'}" onclick='lyPick("${p}",${jatt(g.id)})'>
      <div style="font-size:12.5px;font-weight:600">${g.title}</div><div class="muted" style="font-size:10px">${g.sub||''}</div></div>`).join('');
    return `<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div class="card" style="width:270px;flex:none"><div class="card-head"><h3>${o.listTitle||'List'} · ${groups.length}</h3></div><div style="max-height:560px;overflow-y:auto">${list||'<p class="muted center" style="padding:20px">Empty</p>'}</div></div>
      <div class="card" style="flex:1;min-width:300px">${sel?`<div class="card-head"><div><h3>${sel.title}</h3><p>${sel.sub||''}</p></div><div class="nowrap">${sel.manage||''}</div></div><div class="card-body">${sel.detail||''}</div>`:'<div class="card-body muted center" style="padding:30px">Select an item</div>'}</div></div>`;
  }
  if(lay==='accordion'){
    return `<div class="card">${groups.map(g=>{ const open=_lyOpen[p]===g.id;
      return `<div style="border-bottom:1px solid var(--border-soft)">
        <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer" onclick='lyToggle("${p}",${jatt(g.id)})'>
          <span class="muted">${open?'▾':'▸'}</span><strong style="flex:1">${g.title}</strong><span class="muted" style="font-size:11px">${g.sub||''}</span>${g.right||''}</div>
        ${open?`<div style="padding:0 14px 10px 34px">${g.detail||''}${g.manage?`<div class="mt-8">${g.manage}</div>`:''}</div>`:''}</div>`; }).join('')||'<p class="muted center" style="padding:24px">Empty</p>'}${o.footer||''}</div>`;
  }
  return `<div class="grid-3">${groups.map(g=>`<div class="card"><div class="card-head"><div><h3 style="font-size:12.5px">${g.title}</h3><p>${g.sub||''}</p></div>${g.right||''}</div><div class="card-body">${g.detail||''}${g.manage?`<div class="mt-8">${g.manage}</div>`:''}</div></div>`).join('')||'<p class="muted center" style="padding:24px">Empty</p>'}</div>${o.footer||''}`;
}

/* clean, de-duplicated, sorted brand list from the Tally Sheet (used by ALL liquor pickers) */
function tallyNamesSorted(){ return [...new Set(tallyItems.map(t=>t.name))].sort((a,b)=>a.localeCompare(b)); }
function brandOptions(selected){ return tallyNamesSorted().map(n=>`<option ${selected&&norm(selected)===norm(n)?'selected':''}>${esc(n)}</option>`).join(''); }
function spiritDatalist(){ return `<datalist id="spiritList">${tallyNamesSorted().map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`; }

/* search that survives re-render — keeps the box focused & cursor at end */
/* Quiet re-render for live search typing: same route(), but entry animations are
   suppressed for a beat so the page never flickers while you type. */
var _quietT=null;
function routeQuiet(){
  document.body.classList.add('a-off');
  route();
  if(_quietT) clearTimeout(_quietT);
  _quietT=setTimeout(()=>document.body.classList.remove('a-off'), 300);
}
function searchType(kind,val){
  if(kind==='order')oQuery=val; else if(kind==='tally')tQuery=val; else if(kind==='cocktail')cQuery=val; else if(kind==='alias')aQuery=val; else if(kind==='link')lQuery=val; else if(kind==='ckalias')ckaQuery=val;
  routeQuiet();
  const i=document.getElementById('searchBox'); if(i){ i.focus(); try{ i.setSelectionRange(val.length,val.length); }catch(e){} }
}
function categorySummary(){
  const { cmlMap, smlMap } = calcGrandTotals();
  const cats = {};
  tallyItems.forEach(t=>{
    const c=getEffectiveCocktailMl(t,cmlMap), s=getEffectiveStraightMl(t,smlMap);
    if(c+s<=0) return;
    cats[t.category]=cats[t.category]||{cat:t.category, c:0, s:0, n:0};
    cats[t.category].c+=c; cats[t.category].s+=s; cats[t.category].n++;
  });
  return Object.values(cats).sort((a,b)=>(b.c+b.s)-(a.c+a.s));
}

/* ============================================================
   SHELL + ROUTER
   ============================================================ */
/* ---- royal line icons (SVG, stroke = currentColor so they take the nav/theme colour) ---- */
const _ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICO = {
  dashboard: _ic('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  upload:    _ic('<path d="M12 15.5V4m0 0 3.5 3.5M12 4 8.5 7.5"/><path d="M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3"/>'),
  sales:     _ic('<path d="M3 20.5h18"/><path d="M5.5 20.5V11M10.5 20.5V4.5M15.5 20.5v-6M20.5 20.5V8"/>'),
  map:       _ic('<circle cx="12" cy="12" r="2.4"/><circle cx="5" cy="5" r="1.9"/><circle cx="19" cy="5" r="1.9"/><circle cx="5" cy="19" r="1.9"/><circle cx="19" cy="19" r="1.9"/><path d="M6.4 6.4 10 10m7.6-3.6L14 10m-7.6 7.6L10 14m7.6 3.6L14 14"/>'),
  tally:     _ic('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  cocktail:  _ic('<path d="M4 4.5h16L12 13z"/><path d="M12 13v6.5"/><path d="M8.5 19.5h7"/>'),
  item:      _ic('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'),
  purchase:  _ic('<circle cx="9.5" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2.5 4h2.2l2.2 11.1a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.2L21 7.2H6"/>'),
  room:      _ic('<path d="M3 21V9.2L12 4l9 5.2V21"/><path d="M2.5 21h19"/><rect x="9" y="13.5" width="6" height="7.5"/>'),
  issue:     _ic('<rect x="2.5" y="5" width="8.5" height="14" rx="1.5"/><path d="M13.5 12h8m0 0-3-3m3 3-3 3"/>'),
  bev:       _ic('<path d="M10 3h4v3.2l1.5 2.2c.3.5.5 1 .5 1.6V19a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-9c0-.6.2-1.1.5-1.6L10 6.2z"/><path d="M8 13.5h8"/>'),
  reports:   _ic('<path d="M6 3h8l4 4v13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V3.5A.5.5 0 0 1 6 3z"/><path d="M14 3v4h4"/><path d="M8.5 13h7M8.5 17h4"/>'),
  settings:  _ic('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2M12 19.5v2M4.4 4.4l1.5 1.5M18.1 18.1l1.5 1.5M2.5 12h2M19.5 12h2M4.4 19.6l1.5-1.5M18.1 5.9l1.5-1.5"/>'),
  clone:     _ic('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M4.5 15.5V6a2 2 0 0 1 2-2H16"/>'),
};
const NAV = [
  { group:'Overview', items:[ {id:'dashboard', label:'Dashboard', ico:ICO.dashboard} ]},
  { group:'Sales', items:[
    {id:'upload',   label:'POS Upload', ico:ICO.upload},
    {id:'order',    label:'Sales Analysis', ico:ICO.sales},
    {id:'smartmap', label:'Smart Mapping Center', ico:ICO.map, badgeFn:()=>errorRows().length},
    {id:'tally',    label:'Tally Sheet', ico:ICO.tally},
  ]},
  { group:'Cocktail Center', items:[
    {id:'cocktails', label:'Cocktail Master', ico:ICO.cocktail},
  ]},
  { group:'Inventory Center', items:[
    {id:'rawdata',    label:'Item Master', ico:ICO.item},
    {id:'received',   label:'Purchase', ico:ICO.purchase},
    {id:'liquorroom', label:'Liquor Room', ico:ICO.room},
    {id:'mrdetail',   label:'Bar Stock Issue', ico:ICO.issue},
    {id:'barinv',     label:'Beverage Control', ico:ICO.bev},
  ]},
  { group:'Reports', items:[
    {id:'reports', label:'All Reports', ico:ICO.reports},
  ]},
  { group:'System', items:[
    {id:'settings', label:'Settings', ico:ICO.settings},
  ]},
];
const TITLES = {
  dashboard:['Dashboard','Bar control overview'],
  upload:['POS Upload','Import / paste the Petpooja sales export'],
  order:['Sales Analysis','POS export vs Tally name match'],
  smartmap:['Smart Mapping Center','Liquor Alias · Cocktail Alias · Error Queue · Linking'],
  tally:['Tally Sheet','Brand master — peg, cocktail & straight ml'],
  cocktails:['Cocktail Master','Recipes that drive cocktail consumption'],
  linking:['Linking Sheet','Cocktail ml + Straight ml = brand-wise DSR'],
  errors:['Error Queue','Unmatched POS items — resolve to brand or cocktail'],
  alias:['Liquor Alias','POS button → brand mappings (VLOOKUP chain)'],
  ckalias:['Cocktail Alias','POS button → cocktail mappings (which name counts as which cocktail)'],
  rawdata:['Item Master','Item master — group, brand & bottle size'],
  received:['Purchase','Purchases into the Liquor Room (Excel / BEVCO invoice)'],
  mrdetail:['Bar Stock Issue','Material requisition — Liquor Room → Bar'],
  liquorroom:['Liquor Room','Opening + Received − Issued = Closing'],
  barinv:['Beverage Control',''],
  reports:['All Reports','Sales, variance & stock reports — export Excel / CSV / PDF'],
  settings:['Settings','Company, admin & data'],
};

function boot(){ if(!location.hash) location.hash='#dashboard'; applyAppearance();
  try{ const su=JSON.parse(sessionStorage.getItem('tg2_user')||'null');
    if(su&&su.role==='manager') document.body.classList.add('r-mgr');
    if(su&&su.role==='staff')   document.body.classList.add('r-staff'); }catch(e){}
  renderShell(); startClock(); route(); window.addEventListener('hashchange', route);
  try{ showSplash(); }catch(e){} }

function renderShell(){
  const nav = NAV.map(g=>`
    <div class="nav-group-label">${g.group}</div>
    ${g.items.map(it=>`<div class="nav-item" data-nav="${it.id}"><span class="ico">${it.ico}</span><span>${it.label}</span>${it.badgeFn?`<span class="badge" data-badge="${it.id}"></span>`:''}</div>`).join('')}
  `).join('');
  $('#app').innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="logo">${cfg.logo?`<img src="${cfg.logo}">`:'🍾'}</div><div class="name">${esc(cfg.company)}<span>${esc(cfg.subtitle||'')}</span></div></div>
      <nav class="nav">${nav}</nav>
      <div class="sidebar-foot">
        <div class="user-chip" data-nav="settings"><div class="avatar">${cfg.photo?`<img src="${cfg.photo}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`:initials(cfg.admin)}</div><div class="meta">${esc(cfg.admin)}<span>Administrator</span></div></div>
        <button class="btn btn-ghost btn-block btn-sm mt-8" onclick="location.href='index.html'">⏻ &nbsp;Logout</button>
      </div>
    </aside>
    <div class="scrim hidden" id="scrim" onclick="toggleSidebar(false)"></div>
    <main class="main">
      <header class="topbar">
        <button class="hamburger" onclick="toggleSidebar(true)">☰</button>
        <div><h2 id="pgTitle">Dashboard</h2><div class="crumb" id="pgCrumb"></div></div>
        <div class="topbar-actions">
          <div class="clk"><span class="t" id="clkT">--:--:--</span><span class="d" id="clkD"></span></div>
          <button class="icon-btn" title="Companies — switch / add" onclick="openCompanies()">🏢</button>
          <button class="icon-btn" id="themeToggle" title="Switch theme · Aurora ⇄ Emerald" onclick="toggleTheme()">${pref.theme==='t-aurora'?'🌙':'☀️'}</button>
          <button class="icon-btn" title="Theme settings" onclick="go('settings')">🎨</button>
          <button class="icon-btn" title="Notifications — errors · low stock · variance" onclick="openNotifs()" style="position:relative">🔔<span class="nbadge" id="notifBadge" style="display:none"></span></button>
        </div>
      </header>
      <div class="content" id="view"></div>
      <footer class="statusbar">
        <span id="sbOnline" class="sb-on">● Online</span>
        <span>💾 Last Backup&nbsp;: <b id="sbBackup">—</b></span>
        <span>👤 <b>${esc((function(){ try{ const u=JSON.parse(sessionStorage.getItem('tg2_user')||'null'); if(u&&u.u) return u.u; }catch(e){} return cfg.admin||'Admin'; })())}</b> · ${esc((function(){ try{ const u=JSON.parse(sessionStorage.getItem('tg2_user')||'null'); if(u&&u.role) return u.role; }catch(e){} return 'admin'; })())}</span>
        <span class="sb-r">${(typeof cloudOn==='function'&&cloudOn())?'☁️ Cloud ready · ':''}v${APP_VERSION}</span>
      </footer>
    </main>`;
  $$('[data-nav]').forEach(n=>n.onclick=()=>go(n.dataset.nav));
  refreshBadges(); sbFill();
}
/* ---- status bar helpers ---- */
function sbFill(){
  const el=$('#sbBackup');
  if(el){ let t='';
    try{ t=JSON.parse(localStorage.getItem(CO_PREFIX+'lastbackup')||'null')||''; }catch(e){}
    try{ const m=JSON.parse(localStorage.getItem(CO_PREFIX+'cloudmeta')||'{}'); if(m.push&&(!t||m.push>t)) t=m.push; }catch(e){}
    el.textContent=t?new Date(t).toLocaleString():'—'; }
  const on=$('#sbOnline');
  if(on){ const o=navigator.onLine!==false; on.textContent=o?'● Online':'● Offline'; on.className=o?'sb-on':'sb-off'; }
}
window.addEventListener('online', ()=>sbFill());
window.addEventListener('offline', ()=>sbFill());
/* ---- 🔔 notification centre: unmatched POS + low stock + big variance in one place ---- */
function openNotifs(){
  const errs=errorRows();
  let low=[]; try{ if(typeof lowStockList==='function') low=lowStockList(); }catch(e){}
  let vars=[]; try{ if(typeof barRow==='function'&&typeof biAmt==='function'){
    tallyItems.forEach(t=>{ const R=barRow(t);
      if(!(R.sale>0||R.recBtl>0||R.iv.openBL!=null||R.iv.closeBL!=null)) return;
      const A=biAmt(t,R); if(Math.abs(A.varv)>=300) vars.push({name:t.name, amt:A.varv}); });
    vars.sort((a,b)=>Math.abs(b.amt)-Math.abs(a.amt)); } }catch(e){}
  const sec=(ico,title,count,rows,btnLabel,page)=>`
    <div style="margin-bottom:14px">
      <div class="flex between items-center" style="margin-bottom:6px;gap:8px">
        <strong style="font-size:12.5px">${ico} ${title} <span class="pill ${count?'red':'green'}" style="font-size:10px">${count}</span></strong>
        ${count?`<button class="btn btn-sm" onclick="closeModal();go('${page}')">${btnLabel} →</button>`:''}
      </div>
      <div style="font-size:11.5px;line-height:1.9;color:var(--text-muted)">${rows||'<span style="color:var(--green)">All clear ✔</span>'}</div>
    </div>`;
  const more=(n)=>n>8?`<div class="muted" style="font-size:10.5px">… +${n-8} more</div>`:'';
  const errRows=errs.slice(0,8).map(r=>`<div class="flex between" style="gap:10px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</span><span class="muted">× ${fmt(+r.qty||0)}</span></div>`).join('')+more(errs.length);
  const lowRows=low.slice(0,8).map(x=>`<div class="flex between" style="gap:10px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(x.name)}</span><span class="pill ${x.status==='OUT'?'red':'amber'}" style="font-size:9.5px">${x.status}</span></div>`).join('')+more(low.length);
  const varRows=vars.slice(0,8).map(x=>`<div class="flex between" style="gap:10px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(x.name)}</span><strong style="color:${x.amt>=0?'var(--green)':'var(--red)'}">₹ ${fmt(Math.round(x.amt))}</strong></div>`).join('')+more(vars.length);
  modal('🔔 Notifications',
    sec('⚠️','Unmatched POS names',errs.length,errs.length?errRows:'','Error Queue','smartmap')
    +sec('🚨','Low / Out of stock',low.length,low.length?lowRows:'','Liquor Room','liquorroom')
    +sec('⚖️','Variance ≥ ₹300',vars.length,vars.length?varRows:'','Beverage Control','barinv'),
    `<button class="btn" onclick="closeModal()">Close</button>`);
}
/* ---- 🖨️ letterhead: logo + company + address + mobile on every printed page ----
   `letterhead(title)` = the in-app print block (shown only by @media print);
   `letterheadHTML(title)` = the same, with inline styles, for the separate _printWin. */
function coAddress(){
  if(cfg.address) return cfg.address;
  try{ const c=coList().find(x=>x.id===ACTIVE_CO); if(c&&c.addr) return c.addr; }catch(e){}
  try{ let a=localStorage.getItem('tg2_sysaddr'); if(a){ try{ a=JSON.parse(a); }catch(e){} if(a) return String(a); } }catch(e){}
  return '';
}
function _lhParts(title){
  const addr=coAddress(), mob=cfg.mobile||'';
  const meta=[addr, mob?('Mob: '+mob):''].filter(Boolean).join('  ·  ');
  return { logo:cfg.logo||'', co:(cfg.company||'Bar'), sub:(cfg.subtitle||''), meta,
           who:(cfg.admin||''), desig:(cfg.designation!=null?cfg.designation:'F&B Controller'),
           title:title||'', per:period.from+'  to  '+period.to };
}
function letterhead(title){
  const p=_lhParts(title);
  return `<div class="print-only lhead">
    <div class="lh">${p.logo?`<img class="lhlogo" src="${p.logo}">`:''}
      <div class="lhmid"><div class="lhco">${esc(p.co)}</div>
        ${p.sub?`<div class="lhsub">${esc(p.sub)}</div>`:''}
        ${p.meta?`<div class="lhmeta">${esc(p.meta)}</div>`:''}</div>
      ${p.who?`<div class="lhwho">${p.desig?`<span class="d">${esc(p.desig)}</span>`:''}<span class="n">${esc(p.who)}</span></div>`:''}
    </div>
    <div class="lhbar"><span>${esc(p.title)}</span><span>Period: ${esc(p.per)}</span></div>
  </div>`;
}
function letterheadHTML(title){
  const p=_lhParts(title);
  const e2=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  return `<div style="display:flex;align-items:center;gap:14px;border-bottom:2.5px double #b5832e;padding-bottom:7px;margin-bottom:3px">
    ${p.logo?`<img src="${p.logo}" style="width:46px;height:46px;object-fit:contain;flex:none">`:''}
    <div style="flex:1;min-width:0">
      <div style="font-size:16px;font-weight:700;letter-spacing:.6px;text-transform:uppercase">${e2(p.co)}</div>
      ${p.sub?`<div style="font-size:10px;color:#6b5c46;letter-spacing:.5px">${e2(p.sub)}</div>`:''}
      ${p.meta?`<div style="font-size:9.5px;color:#777">${e2(p.meta)}</div>`:''}
    </div>
    ${p.who?`<div style="flex:none;text-align:right;white-space:nowrap;padding-left:13px;border-left:1px solid #ddd6c4">
      ${p.desig?`<div style="font-size:8px;letter-spacing:1.4px;text-transform:uppercase;color:#8a6d3b;font-weight:700">${e2(p.desig)}</div>`:''}
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:12px;font-weight:700;color:#111;margin-top:2px">${e2(p.who)}</div>
    </div>`:''}
    <div style="font-size:11px;color:#8a6d3b;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap;text-align:right;padding-left:13px">${e2(p.title)}</div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:9px;color:#777;margin-bottom:10px">
    <span>Period: ${e2(p.per)}</span><span>Generated ${e2(new Date().toLocaleString())}</span></div>`;
}
/* ---- ✨ splash: one short royal intro when the app opens ---- */
function showSplash(){
  try{
    if(sessionStorage.getItem('tg2_splashed')==='1') return;   // once per session, not on every reload of a page
    sessionStorage.setItem('tg2_splashed','1');
  }catch(e){}
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el=document.createElement('div');
  el.className='splash'+(reduce?' noanim':'');
  el.innerHTML=`<div class="sp-in">
      <div class="sp-ring"><div class="sp-logo">${cfg.logo?`<img src="${esc(cfg.logo)}">`:'🍾'}</div></div>
      <div class="sp-co">${esc(cfg.company||'Bar')}</div>
      <div class="sp-sub">${esc(cfg.subtitle||'Beverage Control')}</div>
      <div class="sp-line"></div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 420); }, reduce?400:1100);
}
function go(id){ location.hash='#'+id; toggleSidebar(false); }
function toggleSidebar(open){ const sb=$('#sidebar'), sc=$('#scrim'); if(!sb) return; if(open){sb.classList.add('open');sc.classList.remove('hidden');} else {sb.classList.remove('open');sc.classList.add('hidden');} }
function refreshBadges(){
  const e = errorRows().length;
  NAV.forEach(g=>(g.items||[]).forEach(it=>{ if(!it.badgeFn) return;
    const b=$('[data-badge="'+it.id+'"]'); if(!b) return;
    let v=0; try{ v=it.badgeFn()||0; }catch(err){}
    b.textContent=v; b.style.display=v?'inline-block':'none'; }));
  let low=0; try{ if(typeof lowStockList==='function') low=lowStockList().length; }catch(err){}
  const tot=e+low;
  const nb=$('#notifBadge'); if(nb){ nb.textContent=tot>99?'99+':tot; nb.style.display=tot?'inline-flex':'none'; }
}
/* Typing in a sheet cell fires onchange → route() → the page used to re-render from the
   top and replay its fade, so it "jumped". Any .cell-input edit now marks the next
   render as quiet, and route() puts the scroll positions back exactly where they were. */
var _quietNext=false;
document.addEventListener('change', function(e){
  const t=e.target; if(!(t && t.classList && t.classList.contains('cell-input'))) return;
  _quietNext=true;
  // the edited cell is about to be destroyed by the re-render; remember where it was so
  // focus lands back on it (otherwise the next Tab jumps to the top of the page)
  const tbl=t.closest('table'); if(!tbl) return;
  const ti=$$('#view table').indexOf(tbl);
  const ii=Array.prototype.indexOf.call(tbl.querySelectorAll('input.cell-input'), t);
  if(ti<0||ii<0) return;
  setTimeout(function(){
    const a=document.activeElement;
    if(a && a.classList && a.classList.contains('cell-input')) return;   // arrow/Enter nav already moved on
    const tb=$$('#view table')[ti]; if(!tb) return;
    const nx=tb.querySelectorAll('input.cell-input')[ii];
    if(nx){ nx.focus(); if(nx.select) nx.select(); }
  },0);
}, true);
function route(){
  const id=(location.hash||'#dashboard').slice(1);
  CHARTS.forEach(c=>c.destroy()); CHARTS=[];
  // remember where the page (and any scrolled sheet) was, so an edit never jumps the view
  const _pgEl=document.scrollingElement||document.documentElement;
  const _pgTop=_pgEl?_pgEl.scrollTop:0;
  const _wrapTops=$$('#view .table-wrap').map(w=>w.scrollTop);
  if(_quietNext){ _quietNext=false; document.body.classList.add('a-off');
    if(_quietT) clearTimeout(_quietT);
    _quietT=setTimeout(()=>document.body.classList.remove('a-off'), 300); }
  $$('[data-nav]').forEach(n=>n.classList.toggle('active', n.dataset.nav===id));
  const [t,c]=TITLES[id]||['',''];
  $('#pgTitle').textContent=t; $('#pgCrumb').textContent=c;
  $('#view').innerHTML=(VIEWS[id]||VIEWS.dashboard)();
  refreshBadges();
  if(AFTER[id]) AFTER[id]();
  const _w2=$$('#view .table-wrap');
  _wrapTops.forEach((v,i)=>{ if(_w2[i] && v) _w2[i].scrollTop=v; });
  if(_pgEl && _pgTop) _pgEl.scrollTop=_pgTop;
}
const VIEWS={}, AFTER={};

/* ============================================================
   DASHBOARD
   ============================================================ */
function brandRowsData(){
  const { cmlMap, smlMap } = calcGrandTotals();
  return tallyItems.map(t=>{ const c=getEffectiveCocktailMl(t,cmlMap), s=getEffectiveStraightMl(t,smlMap); return {t,c,s,tot:c+s}; })
    .filter(r=>r.tot>0).sort((a,b)=>b.tot-a.tot);
}
function cocktailSales(){
  const qm=buildCocktailQtyMap();
  return cocktails.map(c=>{ const qty=resolveCocktailQty(c.name,qm); const ml=c.recipe.reduce((a,r)=>a+(+r.ml||0),0)*qty; return {c,qty,ml}; }).filter(x=>x.qty>0);
}
let dbCat='ALL', dbSort='high', dbCkSort='high';
VIEWS.dashboard = () => {
  const { totalC, totalS } = calcGrandTotals();
  const total = totalC + totalS, grand = total||1;
  const cPct = (totalC/grand*100), sPct = (totalS/grand*100);
  const brands = brandRowsData();
  const cocks = cocktailSales();
  const errs = errorRows().length;
  const kpi=(ico,bg,label,val,unit,sub)=>`<div class="kpi"><div class="ico ${bg}">${ico}</div><div class="label">${label}</div><div class="value">${val} <span class="unit">${unit||''}</span></div>${sub||''}</div>`;

  // Category breakdown — modern % bars
  const catBars = categorySummary().map(c=>{ const t=c.c+c.s, pct=t/grand*100;
    return `<div style="margin-bottom:13px">
      <div class="flex between" style="font-size:12px;margin-bottom:5px"><span><strong>${c.cat}</strong> <span class="muted">· ${c.n} items</span></span><span class="muted">${fmt(t)} ml · <strong class="gold">${pct.toFixed(1)}%</strong></span></div>
      <div style="height:9px;background:var(--bg-2);border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct.toFixed(1)}%;background:linear-gradient(90deg,var(--gold-soft),var(--gold));border-radius:6px"></div></div>
    </div>`; }).join('') || '<p class="muted center" style="padding:20px">No sales yet</p>';

  // Top 15 selling liquor brands (category filter + high/low)
  let lb = brands.filter(b=> dbCat==='ALL'||b.t.category===dbCat);
  lb = lb.slice().sort((a,b)=> dbSort==='high'? b.tot-a.tot : a.tot-b.tot).slice(0,15);
  const lbRows = lb.map((b,i)=>`<tr>
    <td class="muted">${dbSort==='high'?i+1:'▾'}</td><td><strong>${b.t.name}</strong></td><td><span class="pill gray">${b.t.category}</span></td>
    <td class="num">${fmt(b.c)}</td><td class="num">${fmt(b.s)}</td><td class="num"><strong class="gold">${fmt(b.tot)}</strong></td>
    <td class="num muted">${(b.tot/grand*100).toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="7" class="center muted" style="padding:20px">No brands</td></tr>';
  const catFilterOpts = ['ALL',...CATEGORIES].map(c=>`<option ${dbCat===c?'selected':''}>${c}</option>`).join('');

  // Top 15 selling cocktails (high/low)
  let ck = cocks.slice().sort((a,b)=> dbCkSort==='high'? b.qty-a.qty : a.qty-b.qty).slice(0,15);
  const ckRows = ck.map((x,i)=>`<tr><td class="muted">${dbCkSort==='high'?i+1:'▾'}</td><td><strong>${x.c.name}</strong></td><td class="num">${x.qty}</td><td class="num gold">${fmt(x.ml)}</td><td class="num muted">${(x.ml/grand*100).toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="5" class="center muted" style="padding:20px">No cocktail sales</td></tr>';

  // High movement Top 10
  const topCk = cocks.slice().sort((a,b)=>b.qty-a.qty).slice(0,10);
  const topSt = brands.filter(b=>b.s>0).sort((a,b)=>b.s-a.s).slice(0,10);
  const moveList = (rows,unit,col) => rows.map((r,i)=>`<div class="flex between" style="padding:8px 0;border-bottom:1px solid var(--border-soft)">
    <span><span class="muted" style="display:inline-block;width:22px">${i+1}.</span> <strong>${r.name}</strong></span><span class="${col}">${r.val} <span class="muted" style="font-size:10px">${unit}</span></span></div>`).join('');

  return `
    <div class="page-head">
      <div><h1>Dashboard</h1><p>Period · <span class="gold">${period.from} → ${period.to}</span> · ${fmt(posData.length)} POS rows</p></div>
      <div class="page-actions"><button class="btn btn-sm" onclick="go('upload')">📥 Upload POS</button><button class="btn btn-gold btn-sm" onclick="goMap('linking')">Linking</button></div>
    </div>
    <div class="kpi-grid">
      ${kpi('💧','bg-gold','Total Sales',fmt(total),'ml','<div class="trend up">Cocktail + Straight</div>')}
      ${kpi('🍹','bg-blue','Cocktail',fmt(totalC),'ml',`<div class="trend up">${cPct.toFixed(1)}% of sales</div>`)}
      ${kpi('🥃','bg-green','Straight',fmt(totalS),'ml',`<div class="trend up">${sPct.toFixed(1)}% of sales</div>`)}
      ${kpi('⚠️','bg-red','Error Queue',errs,'pending',errs?'<div class="trend down">Needs resolving</div>':'<div class="trend up">All matched</div>')}
    </div>
    <div class="kpi-grid mt-16">
      ${kpi('🥃','bg-gold','Total Liquor Brands',fmt(brands.length),'sold','<div class="trend up">with sales</div>')}
      ${kpi('🍸','bg-blue','Total Cocktail Brands',fmt(cocks.length),'sold','<div class="trend up">with sales</div>')}
      ${kpi('🏆','bg-green','Top Liquor Brand',brands[0]?`<span style="font-size:15px">${brands[0].t.name}</span>`:'—','',brands[0]?`<div class="trend up">${fmt(brands[0].tot)} ml</div>`:'')}
      ${kpi('🥇','bg-amber','Top Cocktail',topCk[0]?`<span style="font-size:15px">${topCk[0].c.name}</span>`:'—','',topCk[0]?`<div class="trend up">${topCk[0].qty} sold</div>`:'')}
    </div>

    <div class="grid-2 mt-16">
      <div class="card"><div class="card-head"><div><h3>Category Breakdown</h3><p>Share of total sales (%)</p></div></div>
        <div class="card-body">${catBars}</div></div>
      <div class="card"><div class="card-head"><h3>Cocktail vs Straight</h3></div>
        <div class="card-body"><div class="chart-box sm"><canvas id="cSplit"></canvas></div>
          <div class="legend center mt-16">
            <div class="li"><span class="sw" style="background:#4f8cff"></span> Cocktail ${cPct.toFixed(1)}%</div>
            <div class="li"><span class="sw" style="background:#d4af37"></span> Straight ${sPct.toFixed(1)}%</div></div>
        </div></div>
    </div>

    <div class="card mt-16"><div class="card-head">
        <div><h3>🏆 Top 15 Selling Liquor Brands</h3><p>Which items sold, by category</p></div>
        <div class="flex gap-8 items-center">
          <select class="input" style="width:auto;padding:7px 10px;font-size:12px" onchange="dbCat=this.value;route()">${catFilterOpts}</select>
          <div class="tabs" style="margin:0;border:none"><div class="tab ${dbSort==='high'?'active':''}" onclick="dbSort='high';route()">High ↑</div><div class="tab ${dbSort==='low'?'active':''}" onclick="dbSort='low';route()">Low ↓</div></div>
        </div></div>
      <div class="table-wrap" style="max-height:460px;overflow-y:auto"><table class="tbl">
        <thead><tr><th>#</th><th>Liquor Brand</th><th>Category</th><th class="right">Cocktail ml</th><th class="right">Straight ml</th><th class="right">Total ml</th><th class="right">%</th></tr></thead>
        <tbody>${lbRows}</tbody></table></div></div>

    <div class="grid-2e mt-16">
      <div class="card"><div class="card-head">
          <h3>🍹 Top 15 Selling Cocktails</h3>
          <div class="tabs" style="margin:0;border:none"><div class="tab ${dbCkSort==='high'?'active':''}" onclick="dbCkSort='high';route()">High ↑</div><div class="tab ${dbCkSort==='low'?'active':''}" onclick="dbCkSort='low';route()">Low ↓</div></div></div>
        <div class="table-wrap" style="max-height:420px;overflow-y:auto"><table class="tbl">
          <thead><tr><th>#</th><th>Cocktail</th><th class="right">Qty</th><th class="right">ml</th><th class="right">%</th></tr></thead>
          <tbody>${ckRows}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>⚡ High Movement — Top 10</h3></div>
        <div class="card-body"><div class="grid-2e" style="gap:18px">
          <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;color:#4f8cff">🍹 Cocktails (qty)</div>
            ${moveList(topCk.map(x=>({name:x.c.name,val:x.qty})),'sold','gold')||'<p class="muted">—</p>'}</div>
          <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;color:#d4af37">🥃 Straight (ml)</div>
            ${moveList(topSt.map(x=>({name:x.t.name,val:fmt(x.s)})),'ml','gold')||'<p class="muted">—</p>'}</div>
        </div></div></div>
    </div>`;
};
AFTER.dashboard = () => {
  const { totalC, totalS }=calcGrandTotals();
  if($('#cSplit')) CHARTS.push(new Chart($('#cSplit'), { type:'doughnut',
    data:{ labels:['Cocktail','Straight'], datasets:[{ data:[totalC,totalS], backgroundColor:['#4f8cff','#d4af37'], borderColor:'#161a23', borderWidth:3 }]},
    options:{ cutout:'68%', plugins:{legend:{display:false}}, maintainAspectRatio:false } }));
};

/* ============================================================
   POS UPLOAD
   ============================================================ */
/* ---------------- Corridor POS → this app (v2.25.0) ----------------
   The billing app (Desktop\corridor) keeps every bill in localStorage under `cb_bills` as
   {no, ts, items:[{n,p,g,qty,note}], …}. Two file:// pages share one localStorage in the same
   browser (checked), so when both are opened on the same computer this app can simply read
   the bills — no export, no upload. Away from that computer, the POS's own
   "Export for Inventory" button writes the same array to a file and posBillFile() takes it.

   What comes out is exactly what a Petpooja sheet gives: [{name, qty}] handed to setPos().
   Nothing else in the engine is involved — names still travel through the alias table, and a
   name that matches nothing still lands in the Error Queue, as it always has. */
var _posBills=null;
function posBillsRead(){
  let raw=null;
  try{ raw=localStorage.getItem('cb_bills'); }catch(e){}
  if(!raw) return null;
  try{ const a=JSON.parse(raw); return Array.isArray(a)&&a.length?a:null; }catch(e){ return null; }
}
function posBillsAll(){ return _posBills || posBillsRead(); }
function _bday(ts){ const d=new Date(ts); return isNaN(d)?'':
  d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function posBillSpan(bills){
  let lo='', hi='';
  (bills||[]).forEach(b=>{ const d=_bday(b.ts); if(!d) return; if(!lo||d<lo) lo=d; if(!hi||d>hi) hi=d; });
  return {from:lo, to:hi};
}
/* one row per item name, quantities added up — the same shape the Excel upload produces */
function posFromBills(bills, from, to){
  const map={}, out={rows:[], bills:0, qty:0, lines:0};
  (bills||[]).forEach(b=>{
    const d=_bday(b.ts);
    if(from && d && d<from) return;
    if(to && d && d>to) return;
    out.bills++;
    (b.items||[]).forEach(l=>{
      const n=String(l.n||'').trim(); const q=+l.qty||0;
      if(!n || !q) return;
      map[n]=(map[n]||0)+q; out.qty+=q; out.lines++;
    });
  });
  out.rows=Object.keys(map).sort().map(n=>({name:n, qty:map[n]}));
  return out;
}
function posBillPreview(){
  const bills=posBillsAll();
  if(!bills){ posBillHelp(); return; }
  const from=($('#pbFrom')&&$('#pbFrom').value)||'', to=($('#pbTo')&&$('#pbTo').value)||'';
  const r=posFromBills(bills, from, to);
  if(!r.rows.length){ toast('Nothing in that range','No bills between those two dates','err'); return; }
  let ok=0, ck=0, bad=[];
  r.rows.forEach(x=>{ if(resolveCocktailName(x.name)) ck++;
    else if(resolvePosToTally(x.name)) ok++;
    else bad.push(x); });
  modal(`🍽️ POS sales — ${fmt(r.bills)} bills`, `
    <div class="stat-strip" style="margin-bottom:12px">
      <div class="s"><div class="l">Bills</div><div class="v">${fmt(r.bills)}</div></div>
      <div class="s"><div class="l">Item rows</div><div class="v">${fmt(r.rows.length)}</div></div>
      <div class="s"><div class="l">Total qty</div><div class="v">${fmt(r.qty)}</div></div>
      <div class="s"><div class="l">Matched</div><div class="v" style="color:var(--green)">${fmt(ok+ck)}</div></div>
      <div class="s"><div class="l">Unmatched</div><div class="v" style="color:var(--red)">${fmt(bad.length)}</div></div>
    </div>
    ${bad.length?`<p class="muted" style="font-size:11.5px;margin:0 0 8px">${fmt(bad.length)} name(s) match no brand or cocktail yet.
      They will load anyway and wait for you in the <b>Error Queue</b> (Smart Mapping Center), same as an Excel upload:
      <span class="gold">${bad.slice(0,8).map(x=>esc(x.name)).join(' · ')}${bad.length>8?' …':''}</span></p>`:''}
    <div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>#</th><th>POS item</th><th class="right">Qty</th><th>Match</th></tr></thead>
      <tbody>${r.rows.map((x,i)=>{ const c=resolveCocktailName(x.name); const t=c?null:resolvePosToTally(x.name);
        return `<tr><td class="muted">${i+1}</td><td>${esc(x.name)}</td><td class="num">${fmt(x.qty)}</td>
          <td>${c?'<span class="pill blue">cocktail</span>':(t?'<span class="pill gold">brand</span>':'<span class="pill red">none</span>')}</td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="muted" style="font-size:11.5px;margin:10px 0 0">Loading replaces the POS rows currently in the app
      (${fmt(posData.length)} rows) — the same as uploading a fresh sheet. Your bills are not changed.</p>`,
    `<button class="btn" onclick="closeModal()">Cancel</button>
     <button class="btn btn-gold" onclick="posBillLoad()">⬇ Load these ${fmt(r.rows.length)} rows</button>`);
}
function posBillLoad(){
  const bills=posBillsAll(); if(!bills){ posBillHelp(); return; }
  const from=($('#pbFrom')&&$('#pbFrom').value)||'', to=($('#pbTo')&&$('#pbTo').value)||'';
  const r=posFromBills(bills, from, to);
  if(!r.rows.length){ toast('Nothing to load','No bills in that range','err'); return; }
  closeModal();
  setPos(r.rows);   // the ordinary POS loader — cache invalidation, re-render and all
  toast('POS sales loaded', `${fmt(r.bills)} bills · ${fmt(r.rows.length)} items · qty ${fmt(r.qty)}`, 'ok');
}
function posBillHelp(){
  modal('🍽️ No POS bills found yet', `
    <p style="font-size:12.5px;line-height:1.8;margin:0 0 10px">This app looks for the Corridor billing app's own saved bills.
      Nothing was found in this browser, which normally means one of these:</p>
    <ol style="font-size:12.5px;line-height:1.9;margin:0 0 12px;padding-left:20px">
      <li><b>The billing app has not been opened in this browser.</b> Open <span class="gold">Corridor Billing</span> once
        in the same browser on this computer, then come back and press the button again.</li>
      <li><b>You are on the website version.</b> A website cannot read a program's files on your computer.
        Use the billing app's <span class="gold">Export for Inventory</span> button and load the file below.</li>
      <li><b>No bills have been saved yet</b> in the billing app.</li>
    </ol>
    <label class="btn btn-gold" style="cursor:pointer">📂 Load a POS export file
      <input type="file" accept=".json" style="display:none" onchange="posBillFile(this)"></label>`,
    `<button class="btn" onclick="closeModal()">Close</button>`);
}
function posBillFile(inp){
  const f=inp.files&&inp.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=e=>{
    let a=null;
    try{ const j=JSON.parse(e.target.result); a=Array.isArray(j)?j:(j.bills||null); }catch(err){}
    if(!Array.isArray(a)||!a.length){ toast('Could not read that file','It should be the billing app\'s own export file','err'); return; }
    _posBills=a; closeModal(); route();
    toast('POS file read', fmt(a.length)+' bills — check the range, then Preview', 'ok');
  };
  rd.readAsText(f);
}
VIEWS.upload = () => {
  const lay=pageLay('upload');
  const cls=p=>{ if(resolveCocktailName(p.name)) return 'ck'; return resolvePosToTally(p.name)?'ok':'err'; };
  const defList=`<div class="card mt-16"><div class="card-head"><h3>Loaded POS Data — preview</h3><span class="muted" style="font-size:12px">first 50 rows</span></div>
    <div class="table-wrap" style="max-height:420px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>#</th><th>POS Item</th><th class="right">Qty</th></tr></thead>
      <tbody>${posData.slice(0,50).map((p,i)=>`<tr><td class="muted">${i+1}</td><td>${p.name}</td><td class="num">${p.qty}</td></tr>`).join('')||'<tr><td colspan="3" class="center muted" style="padding:24px">No POS data — upload or paste.</td></tr>'}</tbody></table></div></div>`;
  let listHtml;
  if(lay==='def') listHtml=defList;
  else if(lay==='dense') listHtml=`<div class="laydense">${defList}</div>`;
  else {
    const B=[['ok','🥃 Straight matched','gold'],['ck','🍹 Cocktails','blue'],['err','⚠️ Unmatched','red']];
    const groups=B.map(b=>{ const rows=posData.map((p,i)=>({p,i})).filter(x=>cls(x.p)===b[0]);
      const tq=rows.reduce((s,x)=>s+(+x.p.qty||0),0);
      return { id:b[0], title:b[1], sub:`${rows.length} rows · qty ${fmt(tq)}`, right:`<span class="pill ${b[2]}">${rows.length}</span>`,
        detail: rows.slice(0,100).map(x=>`<div class="flex between items-center" style="padding:4px 0;border-bottom:1px solid var(--border-soft);font-size:12px;gap:8px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(String(x.p.name))}</span><span class="nowrap"><strong>${fmt(x.p.qty)}</strong> <button class="btn btn-ghost btn-sm" onclick="editPos(${x.i})">✎</button><button class="btn btn-danger btn-sm" onclick="delPos(${x.i})">✕</button></span></div>`).join('')||'<span class="muted" style="font-size:12px">none</span>' };
    });
    listHtml=`<div class="mt-16">${renderLay('upload',lay,groups,{listTitle:'Buckets'})}</div>`;
  }
  return `
  <div class="page-head"><div><h1>POS Upload</h1><p>Drop a Petpooja .xlsx/.csv, or paste rows. Currently <span class="gold">${fmt(posData.length)}</span> rows loaded.</p></div>
    <div class="page-actions">${layDrop('upload')}<button class="btn btn-sm" onclick="downloadTemplate()">⬇️ Template</button>
      <button class="btn btn-sm" onclick="openPaste()">📋 Manual Paste</button>
      <button class="btn btn-danger btn-sm" onclick="clearPos()">🗑️ Clear</button></div></div>
  <div class="grid-2">
    <div class="dropzone" id="dz"><div class="dz-ico">📄</div><h4>Drop Petpooja export here</h4>
      <p>or <span class="gold" style="text-decoration:underline">click to browse</span> — .xlsx / .xls / .csv</p>
      <input type="file" id="posFile" accept=".xlsx,.xls,.csv" style="display:none"></div>
    <div class="stat-strip" style="flex-direction:column">
      <div class="s"><div class="l">POS rows loaded</div><div class="v">${fmt(posData.length)}</div></div>
      <div class="s"><div class="l">Matched</div><div class="v" style="color:var(--green)">${fmt(posData.length-errorRows().length)}</div></div>
      <div class="s"><div class="l">Errors (unmatched)</div><div class="v" style="color:var(--red)">${fmt(errorRows().length)}</div></div>
    </div></div>
  ${(()=>{ const bl=posBillsAll(), sp=bl?posBillSpan(bl):null;
    return `<div class="card mt-16"><div class="card-head"><h3>🍽️ Corridor POS — bring the billing straight in</h3>
      <span class="muted" style="font-size:12px">${bl?(fmt(bl.length)+' bills found'+(sp&&sp.from?(' · '+sp.from+' → '+sp.to):'')):'no bills found in this browser'}</span></div>
      <div class="card-body">
        <p class="muted" style="font-size:11.5px;margin:0 0 10px">Every bill saved in the billing app is added up per item and loaded here — no Excel in between.
          Names go through the alias table exactly as an uploaded sheet does, so anything unknown still waits in the Error Queue.</p>
        <div class="flex gap-8 items-end" style="flex-wrap:wrap">
          <div class="field" style="margin:0"><label>From</label><input class="input" type="date" id="pbFrom" value="${esc(period.from)}"></div>
          <div class="field" style="margin:0"><label>To</label><input class="input" type="date" id="pbTo" value="${esc(period.to)}"></div>
          <button class="btn btn-gold btn-sm" onclick="posBillPreview()">👁 Preview &amp; load</button>
          <label class="btn btn-sm" style="cursor:pointer">📂 From an export file<input type="file" accept=".json" style="display:none" onchange="posBillFile(this)"></label>
        </div>
      </div></div>`; })()}
  ${listHtml}`;
};
AFTER.upload = () => {
  const dz=$('#dz'), input=$('#posFile'); if(!dz||!input) return;
  dz.addEventListener('click', ()=>input.click());
  input.addEventListener('change', e=>{ if(e.target.files[0]) parsePosFile(e.target.files[0]); });
  ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor='var(--gold)';}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor='';}));
  dz.addEventListener('drop', e=>{ const f=e.dataTransfer.files[0]; if(f) parsePosFile(f); });
};
function setPos(list){ posData = list.filter(r=>r.name).map(r=>({name:String(r.name).trim(), qty:+r.qty||0})); bsv('pos',posData); route(); toast('POS loaded', `${posData.length} rows · ${errorRows().length} unmatched`, 'ok'); }
function clearPos(){ posData=[]; bsv('pos',posData); route(); toast('Cleared','POS data cleared','ok'); }
function parsePosFile(file){
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page (xlsx.full.min.js)','err'); return; }
  const reader=new FileReader();
  reader.onload=e=>{ try{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
    const grid=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,blankrows:false});
    const list=extractItemQty(grid);
    if(!list.length){ toast('Nothing found','Could not detect Item/Qty columns','err'); return; }
    setPos(list);
  }catch(err){ toast('Parse failed', String(err.message||err),'err'); } };
  reader.readAsArrayBuffer(file);
}
function extractItemQty(grid){
  let hdr=-1, ci=0, cq=1;
  for(let r=0;r<Math.min(grid.length,15);r++){ const row=(grid[r]||[]).map(x=>norm(x));
    const iI=row.findIndex(x=>/(ITEM|NAME|PRODUCT|PARTICULAR)/.test(x));
    const iQ=row.findIndex(x=>/(QTY|QUANT|NOS|COUNT|SALE)/.test(x));
    if(iI>-1&&iQ>-1){ hdr=r; ci=iI; cq=iQ; break; } }
  const out=[]; const start=hdr>-1?hdr+1:0;
  for(let r=start;r<grid.length;r++){ const row=grid[r]||[]; const name=(row[ci]??'').toString().trim();
    const qty=parseFloat((row[cq]??'').toString().replace(/[^\d.\-]/g,''));
    if(name&&!isNaN(qty)&&qty!==0) out.push({name,qty}); }
  return out;
}
function openPaste(){
  modal('Paste POS Rows', `
    <p class="muted" style="font-size:12.5px;margin-bottom:10px">One item per line — <strong>Item Name &lt;tab/comma&gt; Qty</strong>.</p>
    <textarea id="pasteBox" class="input" style="height:220px;font-family:monospace;resize:vertical" placeholder="Blenders Pride Reserve	325
Absolut	93
Mojito	61"></textarea>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="doPaste()">Import</button>`);
}
function doPaste(){
  const txt=$('#pasteBox')?.value||'';
  const list=txt.split(/\r?\n/).map(l=>{ const m=l.split(/\t|,|;|\s{2,}/).map(s=>s.trim()).filter(Boolean); if(m.length<2) return null;
    const qty=parseFloat(m[m.length-1].replace(/[^\d.\-]/g,'')); const name=m.slice(0,-1).join(' '); return (name&&!isNaN(qty))?{name,qty}:null; }).filter(Boolean);
  closeModal(); if(!list.length){ toast('Nothing parsed','Use: Item <tab/comma> Qty','err'); return; }
  setPos(list);
}
function downloadTemplate(){
  const csv='Item,Qty\nBlenders Pride Reserve,325\nAbsolut,93\nMojito,61\n';
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='petpooja_template.csv'; a.click();
  toast('Template','Sample CSV downloaded','ok');
}

/* ============================================================
   ORDER ANALYSIS
   ============================================================ */
let oFilter='all', oQuery='';
VIEWS.order = () => {
  const rows = posData.map(p=>{
    const ck=resolveCocktailName(p.name); const st=resolvePosToTally(p.name);
    let matchTo='', type='', ok=false;
    if(ck){ matchTo=ck; type='cocktail'; ok=true; }
    else if(st){ matchTo=st.tallyName; type='straight'; ok=true; }
    return {p, matchTo, type, ok};
  }).filter(r=> oFilter==='all' || (oFilter==='ok'&&r.ok) || (oFilter==='err'&&!r.ok))
    .filter(r=> !oQuery || norm(r.p.name).includes(norm(oQuery)) || norm(r.matchTo).includes(norm(oQuery)));
  const body = rows.map((r,i)=>`<tr class="${r.ok?'':'row-alert'}">
    <td class="muted">${i+1}</td><td><strong>${r.p.name}</strong></td><td class="num">${r.p.qty}</td>
    <td>${r.ok?`<span class="muted">${r.matchTo}</span>`:'<span class="pill red">no match</span>'}</td>
    <td>${r.ok?`<span class="pill ${r.type==='cocktail'?'blue':'gold'}">${r.type}</span>`:'—'}</td>
    <td>${r.ok?'<span class="pill green">✓ Matched</span>':'<span class="pill red"><span class="dotpulse"></span> Error</span>'}</td>
  </tr>`).join('');
  const ok=posData.length-errorRows().length;
  const lay=pageLay('order');
  const defCard=`<div class="card"><div class="table-wrap" style="max-height:620px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>#</th><th>POS Item</th><th class="right">Qty</th><th>Matched To</th><th>Type</th><th>Status</th></tr></thead>
      <tbody>${body||'<tr><td colspan="6" class="center muted" style="padding:24px">No rows.</td></tr>'}</tbody></table></div></div>`;
  let listHtml;
  if(lay==='def') listHtml=defCard;
  else if(lay==='dense') listHtml=`<div class="laydense">${defCard}</div>`;
  else {
    const B=[['straight','🥃 Straight','gold'],['cocktail','🍹 Cocktails','blue'],['err','⚠️ Errors','red']];
    const groups=B.map(b=>{ const rs=rows.filter(r=> b[0]==='err' ? !r.ok : (r.ok&&r.type===b[0]));
      return { id:b[0], title:b[1], sub:`${rs.length} rows`, right:`<span class="pill ${b[2]}">${rs.length}</span>`,
        detail: rs.slice(0,120).map(r=>`<div class="flex between items-center" style="padding:4px 0;border-bottom:1px solid var(--border-soft);font-size:12px;gap:8px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><strong>${esc(String(r.p.name))}</strong>${r.ok?` <span class="muted">→ ${esc(r.matchTo)}</span>`:''}</span><strong>${fmt(r.p.qty)}</strong></div>`).join('')||'<span class="muted" style="font-size:12px">none</span>' };
    });
    listHtml=renderLay('order',lay,groups,{listTitle:'Match type'});
  }
  return `
    <div class="page-head"><div><h1>Sales Analysis</h1><p>POS export checked against Tally brands & cocktail names.</p></div>
      <div class="page-actions">${layDrop('order')}<div class="search" style="width:220px">🔎<input id="searchBox" placeholder="Search POS item / brand…" value="${esc(oQuery)}" oninput="searchType('order',this.value)"></div></div></div>
    <div class="tabs">
      <div class="tab ${oFilter==='all'?'active':''}" onclick="oFilter='all';route()">All (${posData.length})</div>
      <div class="tab ${oFilter==='ok'?'active':''}" onclick="oFilter='ok';route()">✅ Matched (${ok})</div>
      <div class="tab ${oFilter==='err'?'active':''}" onclick="oFilter='err';route()">⚠️ Errors (${errorRows().length})</div>
    </div>
    ${listHtml}`;
};

/* ============================================================
   TALLY SHEET
   ============================================================ */
let talCat='ALL', tQuery='';
function tallyPeriodSet(){ const f=$('#tpFrom').value, t=$('#tpTo').value; period={from:f||period.from, to:t||period.to}; bsv('period',period); route(); toast('Period set',`${period.from} → ${period.to}`,'ok'); }
VIEWS.tally = () => {
  const { cmlMap, smlMap, posQtyMap } = calcGrandTotals();
  const inScope = t => (talCat==='ALL'||t.category===talCat) && (!tQuery || norm(t.name).includes(norm(tQuery)) || norm(t.category).includes(norm(tQuery)));
  // Brand block — grouped by category (Excel order), with a GRAND TOTAL row
  let gC=0,gS=0,gT=0, sl=0, rows=''; const catData=[];
  CATEGORIES.forEach(cat=>{
    const items = tallyItems.filter(t=>t.category===cat && inScope(t));
    if(!items.length) return;
    const arr=[];
    const bodyRows = items.map(t=>{
      const c=getEffectiveCocktailMl(t,cmlMap), s=getEffectiveStraightMl(t,smlMap), tot=c+s;   // Total = Cocktail + Straight (Excel-faithful)
      gC+=c; gS+=s; gT+=tot; sl++; arr.push({name:t.name, c, s, tot});
      return `<tr>
        <td class="muted">${sl}</td>
        <td><strong>${t.name}</strong></td>
        <td class="num ${c?'':'muted'}">${fmt(c)}</td>
        <td class="num ${s?'':'muted'}">${fmt(s)}</td>
        <td class="num"><strong class="gold">${fmt(tot)}</strong></td>
        <td class="right nowrap"><button class="btn btn-ghost btn-sm" title="Edit brand" onclick='editBrand(${JSON.stringify(t.name)})'>✎</button><button class="btn btn-danger btn-sm" title="Remove brand (also from Bar Inventory)" onclick='removeBrand(${JSON.stringify(t.name)})'>✕</button></td>
      </tr>`; }).join('');
    catData.push({cat, items:arr, sum:arr.reduce((a,x)=>a+x.tot,0)});
    rows += `<tr class="grp-row"><td colspan="6">${cat} <span class="muted">· ${items.length}</span></td></tr>${bodyRows}`;
  });
  if(!rows) rows = `<tr><td colspan="6" class="center muted" style="padding:24px">No brands match.</td></tr>`;
  const grand = `<tr class="grp-row" style="background:var(--gold-dim)"><td></td><td><strong>GRAND TOTAL</strong></td><td class="num"><strong>${fmt(gC)}</strong></td><td class="num"><strong>${fmt(gS)}</strong></td><td class="num"><strong class="gold">${fmt(gT)}</strong></td><td></td></tr>`;

  // COCKTAILS & STRAIGHT LIQUOR QTY — every system name (all cocktails + all tally brands), qty from linking.
  // New brands / new cocktails appear here automatically; unmatched POS junk never shows (that lives in Error Queue).
  const qm2=buildCocktailQtyMap();
  let allQ=[];
  cocktails.forEach(c=>{ const idx=cocktails.indexOf(c); allQ.push({name:c.name, qty:resolveCocktailQty(c.name,qm2), ck:idx}); });
  tallyItems.forEach(t=>allQ.push({name:t.name, qty:getEffectivePosQty(t,posQtyMap), ck:null, cat:t.category}));
  const grandQty = allQ.reduce((a,x)=>a+(+x.qty||0),0);
  // Tally-sheet style: grouped rows — COCKTAILS first (recipes auto-appear here with qty),
  // then brands under their tally categories, each group with its own subtotal.
  const byName=(a,b)=>String(a.name).localeCompare(String(b.name));
  const qFilter=x=>!tQuery||norm(x.name).includes(norm(tQuery));
  const qGroups=[];
  const ckRows=allQ.filter(x=>x.ck!=null&&qFilter(x)).sort(byName);
  if(ckRows.length) qGroups.push({label:'🍸 COCKTAILS', rows:ckRows});
  const brandQ=allQ.filter(x=>x.ck==null&&qFilter(x));
  const catOrder=[...CATEGORIES]; brandQ.forEach(x=>{ if(catOrder.indexOf(x.cat)<0) catOrder.push(x.cat); });
  catOrder.forEach(cat=>{ const rows=brandQ.filter(x=>x.cat===cat).sort(byName);
    if(rows.length) qGroups.push({label:esc(String(cat)), rows}); });
  let totQty=0, qsl=0, qtyBody='';
  qGroups.forEach(g=>{ const sum=g.rows.reduce((a,x)=>a+(+x.qty||0),0); totQty+=sum;
    qtyBody+=`<tr class="grp-row"><td colspan="4">${g.label} <span class="muted">· ${g.rows.length} item${g.rows.length===1?'':'s'} · qty ${fmt(sum)}</span></td></tr>`;
    g.rows.forEach(x=>{ qsl++; const qv=+x.qty||0;
      const act = x.ck!=null
        ? `<button class="btn btn-ghost btn-sm" title="Edit recipe" onclick="openCocktailEditor(${x.ck})">✎</button><button class="btn btn-danger btn-sm" title="Delete cocktail" onclick="delCocktail(${x.ck})">✕</button>`
        : `<button class="btn btn-ghost btn-sm" title="Edit brand" onclick='editBrand(${JSON.stringify(x.name)})'>✎</button><button class="btn btn-danger btn-sm" title="Remove brand" onclick='removeBrand(${JSON.stringify(x.name)})'>✕</button>`;
      qtyBody+=`<tr>
        <td class="muted">${qsl}</td>
        <td><strong>${esc(String(x.name))}</strong></td>
        <td class="num ${qv?'':'muted'}">${fmt(qv)}</td>
        <td class="right nowrap">${act}</td>
      </tr>`; });
  });
  if(!qtyBody) qtyBody=`<tr><td colspan="4" class="center muted" style="padding:20px">No names yet — add brands/cocktails.</td></tr>`;

  const chips = ['ALL',...CATEGORIES].map(c=>`<div class="tab ${talCat===c?'active':''}" onclick="talCat='${c}';route()">${c}</div>`).join('');
  return `
    ${letterhead('Daily Bar Sale Tie-Up · Tally Sheet')}
    <div class="page-head"><div><h1>Tally Sheet</h1><p style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">DAILY BAR SALE TIE UP · FROM
      <input class="input" type="date" id="tpFrom" value="${period.from}" style="width:auto;padding:3px 7px;font-size:12px" onchange="tallyPeriodSet()"> TO
      <input class="input" type="date" id="tpTo" value="${period.to}" style="width:auto;padding:3px 7px;font-size:12px" onchange="tallyPeriodSet()">
      · ${tallyItems.length} brands · Total = Cocktail + Straight.</p></div>
      <div class="page-actions">${layDrop('tally')}</div></div>
    <div class="stat-strip barinv-strip" style="margin-bottom:12px">
      <div class="s"><div class="l">Cocktail ml</div><div class="v">${fmt(gC)}</div></div>
      <div class="s"><div class="l">Straight ml</div><div class="v gold">${fmt(gS)}</div></div>
      <div class="s"><div class="l">Grand Total</div><div class="v">${fmt(gT)} <span class="muted" style="font-size:12px">ml</span></div></div>
      <div class="s"><div class="l">Total Qty Sold</div><div class="v">${fmt(grandQty)}</div></div>
    </div>
    <div class="tabs" style="overflow-x:auto">${chips}</div>
    ${(()=>{ const lay=pageLay('tally');
      const brandCard=`<div class="card barinv"><div class="card-head" style="flex-wrap:wrap;gap:8px"><div><h3>Bar Sale Tie-Up (brand-wise)</h3></div>
      <div class="search" style="width:210px">🔎<input id="searchBox" placeholder="Search brand / item…" value="${esc(tQuery)}" oninput="searchType('tally',this.value)"></div></div>
      <div class="table-wrap" style="max-height:500px;overflow-y:auto"><table class="tbl">
        <thead><tr><th>SL</th><th>Brand / Liquor</th><th class="right">COCKTAIL</th><th class="right">STRAIGHT</th><th class="right">TOTAL</th><th></th></tr></thead>
        <tbody>${rows}${grand}</tbody></table></div></div>`;
      if(lay==='def') return brandCard;
      if(lay==='dense') return `<div class="laydense">${brandCard}</div>`;
      const groups=catData.map(cd=>({ id:cd.cat, title:cd.cat, sub:`${cd.items.length} brands`,
        right:`<span class="num gold" style="font-weight:700">${fmt(cd.sum)}</span>`,
        detail: cd.items.map(x=>`<div class="flex between items-center" style="padding:4px 0;border-bottom:1px solid var(--border-soft);font-size:12px;gap:8px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><strong>${x.name}</strong> <span class="muted">c ${fmt(x.c)} · s ${fmt(x.s)}</span></span><span class="nowrap"><strong class="gold">${fmt(x.tot)}</strong> <button class="btn btn-ghost btn-sm" onclick='editBrand(${jatt(x.name)})'>✎</button><button class="btn btn-danger btn-sm" onclick='removeBrand(${jatt(x.name)})'>✕</button></span></div>`).join('') }));
      return renderLay('tally',lay,groups,{listTitle:'Categories', footer:`<div style="display:flex;justify-content:flex-end;padding:9px 14px"><span class="muted" style="margin-right:8px">GRAND TOTAL</span><strong class="gold">${fmt(gT)} ml</strong></div>`});
    })()}
    <div class="card barinv mt-16"><div class="card-head"><div><h3>🍸 Cocktails & Straight Liquor — Qty Sold</h3></div>
      <div><span class="pill gold">TOTAL QTY · ${fmt(totQty)}</span></div></div>
      <div class="table-wrap" style="max-height:440px;overflow-y:auto"><table class="tbl">
        <thead><tr><th>SL</th><th>Item (POS name)</th><th class="right">Qty Sold</th><th></th></tr></thead>
        <tbody>${qtyBody}<tr class="grp-row" style="background:var(--gold-dim)"><td></td><td><strong>TOTAL QTY</strong></td><td class="num"><strong class="gold">${fmt(totQty)}</strong></td><td></td></tr></tbody></table></div></div>`;
};

/* ============================================================
   COCKTAIL MASTER
   ============================================================ */
let cQuery='';
VIEWS.cocktails = () => {
  const qtyMap=buildCocktailQtyMap();
  const list=cocktails.filter(c=>!cQuery||norm(c.name).includes(norm(cQuery)));
  const cards=list.map(c=>{
    const idx=cocktails.indexOf(c);
    const ml=c.recipe.reduce((a,b)=>a+(+b.ml||0),0); const qty=resolveCocktailQty(c.name,qtyMap);
    const ing=c.recipe.map(r=>{ const it=getTallyItem(r.spirit)||tallyItems.find(t=>{const tn=norm(t.name),sn=norm(r.spirit);return tn.includes(sn)||sn.includes(tn);});
      return `<div class="flex between" style="padding:5px 0;border-bottom:1px solid var(--border-soft)"><span class="muted" title="${it?'→ '+it.name:'unmapped spirit'}">${it?'🔗':'⚠️'} ${r.spirit}</span><span class="tag-code">${r.ml} ml</span></div>`; }).join('');
    return `<div class="card"><div class="card-head"><div><h3>🍹 ${c.name}</h3><p>${c.recipe.length} spirits · ${ml} ml · sold ${qty}</p></div>
      <button class="btn btn-ghost btn-sm" onclick="openCocktailEditor(${idx})">✎</button></div>
      <div class="card-body">${ing}
        <div class="flex gap-8 mt-16"><button class="btn btn-sm btn-block" onclick="openCocktailEditor(${idx})">Edit Recipe</button>
          <button class="btn btn-sm btn-danger" onclick="delCocktail(${idx})">Delete</button></div></div></div>`;
  }).join('');
  const lay=pageLay('cocktails');
  let bodyHtml;
  if(lay==='def'||lay==='cards') bodyHtml=`<div class="grid-3">${cards}</div>`;
  else if(lay==='dense'){
    const rows=list.map(c=>{ const idx=cocktails.indexOf(c); const ml=c.recipe.reduce((a,b)=>a+(+b.ml||0),0); const q=resolveCocktailQty(c.name,qtyMap);
      return `<tr><td><strong>${c.name}</strong> <span class="muted" style="font-size:11px">${c.recipe.map(r=>`${r.spirit}·${r.ml}`).join(' · ')}</span></td><td class="num">${fmt(q)}</td><td class="num muted">${ml}</td><td class="num gold">${fmt(ml*q)}</td><td class="right nowrap"><button class="btn btn-ghost btn-sm" onclick="openCocktailEditor(${idx})">✎</button><button class="btn btn-danger btn-sm" onclick="delCocktail(${idx})">✕</button></td></tr>`; }).join('');
    bodyHtml=`<div class="card barinv laydense"><div class="table-wrap" style="max-height:620px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>Cocktail → recipe</th><th class="right">Sold</th><th class="right">ml/serve</th><th class="right">Total ml</th><th class="right">Manage</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="center muted" style="padding:20px">No cocktails</td></tr>'}</tbody></table></div></div>`;
  } else {
    const groups=list.map(c=>{ const idx=cocktails.indexOf(c); const ml=c.recipe.reduce((a,b)=>a+(+b.ml||0),0); const q=resolveCocktailQty(c.name,qtyMap);
      return { id:c.name, title:`🍹 ${c.name}`, sub:`${c.recipe.length} spirits · ${ml} ml · sold ${fmt(q)}`,
        right:`<span class="num gold" style="font-weight:700">${fmt(ml*q)}</span>`,
        detail: c.recipe.map(r=>`<div class="flex between" style="padding:3px 0;border-bottom:1px solid var(--border-soft);font-size:11.5px"><span class="muted">${esc(r.spirit)}</span><span>${r.ml} ml</span></div>`).join(''),
        manage:`<button class="btn btn-sm" onclick="openCocktailEditor(${idx})">✎ Edit</button> <button class="btn btn-danger btn-sm" onclick="delCocktail(${idx})">Delete</button>` };
    });
    bodyHtml=renderLay('cocktails',lay,groups,{listTitle:'Cocktails'});
  }
  return `
    <div class="page-head"><div><h1>Cocktail Master</h1><p>${cocktails.length} recipes · showing ${list.length}${cQuery?' (filtered)':''} · 🔗 = spirit mapped to a brand.</p></div>
      <div class="page-actions">${layDrop('cocktails')}<div class="search" style="width:200px">🔎<input id="searchBox" placeholder="Search cocktail…" value="${esc(cQuery)}" oninput="searchType('cocktail',this.value)"></div>
      <button class="btn btn-gold btn-sm" onclick="openCocktailEditor(null)">＋ New Cocktail</button>
      <button class="btn btn-danger btn-sm" onclick="clearAllCocktails()">🗑 Clear All</button></div></div>
    ${bodyHtml}`;
};
let _ckEdit=null, _ckLines=[];
function openCocktailEditor(idx){
  _ckEdit = idx;
  const c = (idx!=null) ? cocktails[idx] : null;
  _ckLines = c ? c.recipe.map(r=>({spirit:r.spirit, ml:r.ml})) : [{spirit:'',ml:''}];
  modal((c?'Edit':'New')+' Cocktail', `
    ${spiritDatalist()}
    <div class="field"><label>Cocktail Name</label><input class="input" id="ckName" value="${c?c.name:''}" placeholder="e.g. COSMOPOLITAN"></div>
    <label class="muted" style="font-size:12px">Recipe — spirit + ml per serve</label>
    <div id="ckLines" class="mt-8"></div>
    <button class="btn btn-sm mt-8" onclick="ckAddLine()">＋ Add spirit</button>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="saveCocktail()">${c?'Save':'Create'}</button>`);
  ckRenderLines();
}
function ckRenderLines(){
  const box=$('#ckLines'); if(!box) return;
  box.innerHTML=_ckLines.map((l,i)=>`<div class="rline">
    <input class="input" list="spiritList" value="${esc(l.spirit)}" onchange="_ckLines[${i}].spirit=this.value" placeholder="Spirit / brand" style="flex:1">
    <input class="input" type="number" value="${l.ml}" onchange="_ckLines[${i}].ml=this.value" placeholder="ml" style="width:80px">
    <button class="del" onclick="ckDelLine(${i})">🗑</button></div>`).join('');
}
function ckAddLine(){ ckSyncFromDom(); _ckLines.push({spirit:'',ml:''}); ckRenderLines(); }
function ckDelLine(i){ ckSyncFromDom(); _ckLines.splice(i,1); if(!_ckLines.length)_ckLines.push({spirit:'',ml:''}); ckRenderLines(); }
function ckSyncFromDom(){ const box=$('#ckLines'); if(!box) return; $$('.rline',box).forEach((row,i)=>{ const ins=$$('input',row); if(_ckLines[i]){_ckLines[i].spirit=ins[0].value; _ckLines[i].ml=ins[1].value;} }); }
function saveCocktail(){
  ckSyncFromDom();
  const name=$('#ckName').value.trim(); if(!name){ toast('Name?','Enter cocktail name','err'); return; }
  const recipe=_ckLines.filter(l=>l.spirit&&(+l.ml>0)).map(l=>({spirit:l.spirit.trim(), ml:+l.ml}));
  if(!recipe.length){ toast('Recipe?','Add at least one spirit + ml','err'); return; }
  if(_ckEdit!=null){ const old=cocktails[_ckEdit].name;
    cocktails[_ckEdit]={...cocktails[_ckEdit], name, recipe};
    if(norm(old)!==norm(name)){                                   // rename cascades to its POS aliases automatically
      let n=0; cocktailAlias.forEach(a=>{ if(norm(a.canonical)===norm(old)){ a.canonical=name; n++; } });
      if(n) bsv('cocktailAlias',cocktailAlias);
    }
    toast('Saved',`${name} updated`,'ok'); }
  else { cocktails.push({name, qty:0, recipe}); toast('Created',`${name} · ${recipe.length} spirits`,'ok'); }
  bsv('cocktails',cocktails); rebuildCocktailAliasIndex(); invalidateCalcCache(); closeModal(); route();
}
function delCocktail(idx){ const c=cocktails[idx]; if(!c) return;
  confirmAsk(`Delete cocktail <strong>${esc(c.name)}</strong>? Its POS aliases are removed too. This cannot be undone.`, ()=>{
    cocktails.splice(idx,1); bsv('cocktails',cocktails);
    const k=norm(c.name); for(let i=cocktailAlias.length-1;i>=0;i--){ if(norm(cocktailAlias[i].canonical)===k) cocktailAlias.splice(i,1); }
    bsv('cocktailAlias',cocktailAlias);            // cascades: row disappears from the Cocktail Alias table too
    rebuildCocktailAliasIndex(); invalidateCalcCache(); route(); toast('Deleted',`${c.name} & its aliases removed`,'err'); }); }
function clearAllCocktails(){ if(!cocktails.length){ toast('Empty','No cocktails to clear','err'); return; }
  confirmAsk(`Delete <strong>ALL ${cocktails.length} cocktails</strong>? Their POS aliases are cleared too. This cannot be undone.`, ()=>{
    cocktails.length=0; bsv('cocktails',cocktails); cocktailAlias.length=0; bsv('cocktailAlias',cocktailAlias);
    rebuildCocktailAliasIndex(); invalidateCalcCache(); route(); toast('Cleared','All cocktails & their aliases removed','err'); }); }

/* ============================================================
   LINKING SHEET
   ============================================================ */
let lQuery='', lkCat='ALL', lQck='', lQst='', lkTab='grand';
const LKC=['#d4af37','#5fe3b4','#4f8cff','#c084fc','#f97316','#ef4f57','#22d3ee','#a3e635'];
function setLinkLayout(v){ pref.linkLayout=v; bsv('pref',pref); route(); }
function setLkCat(c){ lkCat=c; route(); }
function setLkTab(t){ lkTab=t; route(); }
function lckType(v){ lQck=v; route(); const i=$('#lckBox'); if(i){ i.focus(); try{i.setSelectionRange(v.length,v.length);}catch(e){} } }
function lstType(v){ lQst=v; route(); const i=$('#lstBox'); if(i){ i.focus(); try{i.setSelectionRange(v.length,v.length);}catch(e){} } }
/* ============================================================
   SMART MAPPING CENTER — one home for the mapping tools:
   Liquor Alias · Cocktail Alias · Error Queue · Linking Sheet.
   Each tab simply renders the existing view (no logic duplicated).
   ============================================================ */
let smTab = 'alias';
function setSmTab(t){ smTab=t; route(); }
function goMap(tab){ if(tab) smTab=tab; go('smartmap'); }
VIEWS.smartmap = () => {
  const errN=errorRows().length;
  const tabs=[
    ['alias',   ICO.map,      'Liquor Alias',   aliasTable.length+' maps'],
    ['ckalias', ICO.cocktail, 'Cocktail Alias', cocktailAlias.length+' maps'],
    ['errors',  ICO.sales,    'Error Queue',    errN+' unmatched'],
    ['linking', ICO.tally,    'Linking Sheet',  'brand-wise DSR'],
  ];
  const cards=tabs.map(t=>`<button class="smtab ${smTab===t[0]?'on':''}" onclick="setSmTab('${t[0]}')">
      <span class="i">${t[1]}</span><span class="l"><b>${t[2]}</b><i>${esc(t[3])}</i></span>
      ${t[0]==='errors'&&errN?`<span class="cnt">${errN}</span>`:''}</button>`).join('');
  return `<div class="page-head"><div><h1>Smart Mapping Center</h1>
      <p style="font-size:11.5px">Every POS name → brand or cocktail. Resolve once here — the whole system remembers it.</p></div></div>
    <div class="smtabs noprint">${cards}</div>
    <div class="smbody">${(VIEWS[smTab]||VIEWS.alias)()}</div>`;
};
AFTER.smartmap = () => { const a=AFTER[smTab]; if(a) a(); };
VIEWS.linking = () => {
  const { totalC, totalS, cmlMap, smlMap, posQtyMap } = calcGrandTotals();
  const qtyMap=buildCocktailQtyMap();
  const lay=pref.linkLayout||'overview';
  const cats=categorySummary();
  const catBody=cats.map(c=>`<tr><td><strong>${c.cat}</strong></td><td class="num">${fmt(c.c)}</td><td class="num">${fmt(c.s)}</td><td class="num gold">${fmt(c.c+c.s)}</td><td class="num muted">${c.n}</td></tr>`).join('');
  const catCard=`<div class="card mt-16"><div class="card-head"><h3>📊 Category Summary</h3></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Category</th><th class="right">Cocktail ml</th><th class="right">Straight ml</th><th class="right">Total ml</th><th class="right">Items</th></tr></thead><tbody>${catBody}</tbody></table></div></div>`;
  // cocktail rows (Spirits column hidden on print via .spcol)
  const ckAll=cocktails.map(c=>({c, q:resolveCocktailQty(c.name,qtyMap)})).filter(x=>x.q>0).sort((a,b)=>b.q-a.q);
  const ckBodyOf=list=>list.map(x=>{ const tot=x.c.recipe.reduce((a,r)=>a+r.ml*x.q,0);
    const sp=x.c.recipe.map(r=>`${r.spirit} <span class="muted">${r.ml}×${fmt(x.q)}</span>`).join(' · ');
    return `<tr><td><strong>${x.c.name}</strong></td><td class="num">${fmt(x.q)}</td><td class="spcol" style="font-size:11px">${sp}</td><td class="num gold">${fmt(tot)}</td></tr>`; }).join('');
  const ckTable=body=>`<table class="tbl"><thead><tr><th>Cocktail</th><th class="right">Qty</th><th class="spcol">Spirits</th><th class="right">ml</th></tr></thead><tbody>${body||'<tr><td colspan="4" class="muted center" style="padding:18px">No cocktail sales</td></tr>'}</tbody></table>`;
  // straight rows
  const stAll=brandRowsData().filter(r=>getEffectiveStraightMl(r.t,smlMap)>0);
  const stBodyOf=list=>list.map(r=>{ const q=getEffectivePosQty(r.t,posQtyMap);
    return `<tr><td><strong>${r.t.name}</strong></td><td><span class="pill gray">${r.t.category}</span></td><td class="num">${q}</td><td class="num gold">${fmt(getEffectiveStraightMl(r.t,smlMap))}</td></tr>`; }).join('');
  const stTable=body=>`<table class="tbl"><thead><tr><th>Brand</th><th>Cat</th><th class="right">Qty</th><th class="right">ml</th></tr></thead><tbody>${body||'<tr><td colspan="4" class="muted center" style="padding:18px">No straight sales</td></tr>'}</tbody></table>`;
  // grand total (category chips + item search)
  const presentCats=['ALL',...new Set(brandRowsData().map(r=>r.t.category))];
  const chipsHtml=presentCats.map(c=>`<button class="btn btn-sm ${lkCat===c?'btn-gold':''}" style="margin:2px;padding:3px 9px;font-size:11px" onclick="setLkCat('${c}')">${c}</button>`).join('');
  const gtRows=brandRowsData().filter(r=>(lkCat==='ALL'||r.t.category===lkCat)&&(!lQuery||norm(r.t.name).includes(norm(lQuery))||norm(r.t.category).includes(norm(lQuery))));
  const gtBody=gtRows.map(r=>`<tr><td><strong>${r.t.name}</strong></td><td><span class="pill gray">${r.t.category}</span></td><td class="num">${fmt(r.c)}</td><td class="num">${fmt(r.s)}</td><td class="num"><strong class="gold">${fmt(r.tot)}</strong></td></tr>`).join('');
  const gtTable=`<table class="tbl"><thead><tr><th>Brand / Spirit</th><th>Category</th><th class="right">Cocktail ml</th><th class="right">Straight ml</th><th class="right">Total ml</th></tr></thead><tbody>${gtBody||'<tr><td colspan="5" class="muted center" style="padding:18px">No match.</td></tr>'}</tbody></table>`;
  const grandCard=(mt)=>`<div class="card ${mt?'mt-16':''}"><div class="card-head" style="flex-wrap:wrap;gap:8px"><h3>📈 Brand-wise Grand Total</h3>
      <div class="search" style="width:200px">🔎<input id="searchBox" placeholder="Search item / brand…" value="${esc(lQuery)}" oninput="searchType('link',this.value)"></div></div>
    <div class="card-body" style="padding:6px 12px;border-bottom:1px solid var(--border)"><div style="display:flex;flex-wrap:wrap;gap:2px;align-items:center"><span class="muted" style="font-size:11px;margin-right:4px">Category:</span>${chipsHtml}</div></div>
    <div class="table-wrap" style="max-height:430px;overflow-y:auto">${gtTable}</div></div>`;
  const pieCard=(id,title,legend,w)=>`<div class="card" style="flex:1;min-width:${w||230}px"><div class="card-head"><h3>${title}</h3></div>
    <div class="card-body" style="display:flex;gap:12px;align-items:center"><div style="width:120px;height:120px;flex:none;position:relative"><canvas id="${id}"></canvas></div>
    <div style="font-size:11px;color:var(--text-muted);line-height:1.9">${legend}</div></div></div>`;
  const dot=c=>`<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${c};margin-right:4px"></span>`;
  const splitLegend=`${dot('#4f8cff')}Cocktail <strong style="color:var(--text)">${fmt(totalC)}</strong><br>${dot('#d4af37')}Straight <strong style="color:var(--text)">${fmt(totalS)}</strong><br>${dot('var(--border)')}Total <strong class="gold">${fmt(totalC+totalS)}</strong>`;
  const catLegend=cats.slice(0,5).map((c,i)=>`${dot(LKC[i%LKC.length])}${c.cat} <strong style="color:var(--text)">${fmt(c.c+c.s)}</strong>`).join('<br>');
  const br0=brandRowsData();
  const topLegend=br0.length?`${dot('#5fe3b4')}${br0[0].t.name} <strong style="color:var(--text)">${fmt(br0[0].tot)}</strong><br>${dot('var(--border)')}Others <strong style="color:var(--text)">${fmt(br0.slice(1).reduce((a,r)=>a+r.tot,0))}</strong>`:'';
  // layouts
  let bodyHtml='';
  if(lay==='overview'){
    bodyHtml=`<div style="display:flex;gap:14px;flex-wrap:wrap">${pieCard('lkP1','🥧 Cocktail vs Straight',splitLegend)}${pieCard('lkP2','🥧 Category Share',catLegend)}</div>${grandCard(true)}`;
  } else if(lay==='category'){
    bodyHtml=`<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <div class="card" style="width:260px;flex:none"><div class="card-head"><h3>🥧 Category Share</h3></div>
        <div class="card-body" style="text-align:center"><div style="width:170px;height:170px;margin:0 auto;position:relative"><canvas id="lkP2"></canvas></div>
        <div style="font-size:11px;color:var(--text-muted);line-height:2;text-align:left;margin-top:10px">${catLegend}</div></div></div>
      <div style="flex:1;min-width:300px">${grandCard(false)}</div></div>`;
  } else if(lay==='twin'){
    const ckF=ckAll.filter(x=>!lQck||norm(x.c.name).includes(norm(lQck)));
    const stF=stAll.filter(r=>!lQst||norm(r.t.name).includes(norm(lQst))||norm(r.t.category).includes(norm(lQst)));
    bodyHtml=`<div class="grid-2e">
      <div class="card"><div class="card-head" style="flex-wrap:wrap;gap:8px"><h3 style="color:#4f8cff">🍹 Cocktail</h3>
          <div class="search" style="width:150px">🔎<input id="lckBox" placeholder="Search…" value="${esc(lQck)}" oninput="lckType(this.value)"></div></div>
        <div class="card-body" style="display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--border)"><div style="width:86px;height:86px;flex:none;position:relative"><canvas id="lkP3"></canvas></div><div style="font-size:11px;color:var(--text-muted)">Total <strong style="color:#4f8cff">${fmt(totalC)}</strong> ml</div></div>
        <div class="table-wrap" style="max-height:320px;overflow-y:auto">${ckTable(ckBodyOf(ckF))}</div></div>
      <div class="card"><div class="card-head" style="flex-wrap:wrap;gap:8px"><h3 style="color:#d4af37">🥃 Straight</h3>
          <div class="search" style="width:150px">🔎<input id="lstBox" placeholder="Search…" value="${esc(lQst)}" oninput="lstType(this.value)"></div></div>
        <div class="card-body" style="display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--border)"><div style="width:86px;height:86px;flex:none;position:relative"><canvas id="lkP4"></canvas></div><div style="font-size:11px;color:var(--text-muted)">Total <strong class="gold">${fmt(totalS)}</strong> ml</div></div>
        <div class="table-wrap" style="max-height:320px;overflow-y:auto">${stTable(stBodyOf(stF))}</div></div>
    </div>
    <div class="card mt-16"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <span class="muted" style="font-size:12px">GRAND TOTAL</span><span style="font-size:18px;font-weight:800" class="gold">${fmt(totalC+totalS)} ml</span>
      <span class="muted" style="font-size:12px">Cocktail ${fmt(totalC)} · Straight ${fmt(totalS)}</span></div></div>`;
  } else if(lay==='tripie'){
    bodyHtml=`<div style="display:flex;gap:14px;flex-wrap:wrap">${pieCard('lkP1','Cocktail share',splitLegend,200)}${pieCard('lkP2','Category',catLegend,200)}${pieCard('lkP5','Top brand',topLegend,200)}</div>${grandCard(true)}`;
  } else { // tabs
    const tabs=[['cat','📊 Category'],['ck','🍹 Cocktail'],['st','🥃 Straight'],['grand','📈 Grand Total']];
    const tabBar=tabs.map(t=>`<div class="tab ${lkTab===t[0]?'active':''}" onclick="setLkTab('${t[0]}')">${t[1]}</div>`).join('');
    let inner='';
    if(lkTab==='cat') inner=`<div class="table-wrap"><table class="tbl"><thead><tr><th>Category</th><th class="right">Cocktail ml</th><th class="right">Straight ml</th><th class="right">Total ml</th><th class="right">Items</th></tr></thead><tbody>${catBody}</tbody></table></div>`;
    else if(lkTab==='ck') inner=`<div class="table-wrap" style="max-height:420px;overflow-y:auto">${ckTable(ckBodyOf(ckAll.filter(x=>!lQuery||norm(x.c.name).includes(norm(lQuery)))))}</div>`;
    else if(lkTab==='st') inner=`<div class="table-wrap" style="max-height:420px;overflow-y:auto">${stTable(stBodyOf(stAll.filter(r=>!lQuery||norm(r.t.name).includes(norm(lQuery)))))}</div>`;
    else inner=`<div class="card-body" style="padding:6px 12px;border-bottom:1px solid var(--border)"><div style="display:flex;flex-wrap:wrap;gap:2px;align-items:center">${chipsHtml}</div></div><div class="table-wrap" style="max-height:420px;overflow-y:auto">${gtTable}</div>`;
    bodyHtml=`<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
      ${pieCard('lkP1','🥧 Split',splitLegend,220)}
      <div class="card" style="flex:2.4;min-width:320px"><div class="card-head" style="flex-wrap:wrap;gap:8px"><div class="tabs" style="margin:0;border:none">${tabBar}</div>
        <div class="search" style="width:170px">🔎<input id="searchBox" placeholder="Search item…" value="${esc(lQuery)}" oninput="searchType('link',this.value)"></div></div>${inner}</div></div>`;
  }
  return `
    ${letterhead('Linking Sheet · DSR Report')}
    <div class="page-head"><div><h1>Linking Sheet</h1><p>Cocktail ml (recipe×qty) + Straight ml (qty×peg) = brand & category DSR.</p></div>
      <div class="page-actions">
        <select class="input" style="width:auto;padding:6px 9px;font-size:12px" onchange="setLinkLayout(this.value)" title="Layout">
          ${[['overview','① Overview Split'],['category','② Category Explorer'],['twin','③ Twin Panels'],['tripie','④ Tri-Pie Report'],['tabs','⑤ Tab Explorer']].map(o=>`<option value="${o[0]}" ${lay===o[0]?'selected':''}>${o[1]}</option>`).join('')}
        </select>
        <button class="btn btn-sm" onclick="downloadLinking()">⬇️ Download CSV</button>
        <button class="btn btn-gold btn-sm" onclick="window.print()">🖨️ Print Report</button></div></div>
    <div class="stat-strip barinv-strip" style="margin-bottom:14px">
      <div class="s"><div class="l">Cocktail ML</div><div class="v" style="color:var(--blue)">${fmt(totalC)}</div></div>
      <div class="s"><div class="l">Straight ML</div><div class="v gold">${fmt(totalS)}</div></div>
      <div class="s"><div class="l">Total ML</div><div class="v">${fmt(totalC+totalS)}</div></div>
      <div class="s"><div class="l">Active Brands</div><div class="v">${brandRowsData().length}</div></div>
    </div>
    ${bodyHtml}`;
};
AFTER.linking = () => {
  if(typeof Chart==='undefined') return;
  const {totalC,totalS}=calcGrandTotals();
  const mk=(id,labels,data,colors)=>{ const el=$('#'+id); if(!el) return;
    CHARTS.push(new Chart(el,{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderColor:'#161a23',borderWidth:2}]},
      options:{plugins:{legend:{display:false}},cutout:'62%',responsive:true,maintainAspectRatio:false}})); };
  mk('lkP1',['Cocktail','Straight'],[totalC,totalS],['#4f8cff','#d4af37']);
  const cats=categorySummary().slice(0,7);
  mk('lkP2',cats.map(c=>c.cat),cats.map(c=>Math.round(c.c+c.s)),LKC);
  const qm=buildCocktailQtyMap();
  const cks=cocktails.map(c=>({n:c.name,v:c.recipe.reduce((a,r)=>a+(+r.ml||0),0)*resolveCocktailQty(c.name,qm)})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  if(cks.length) mk('lkP3',cks.slice(0,5).map(x=>x.n).concat(cks.length>5?['Others']:[]),
    cks.slice(0,5).map(x=>Math.round(x.v)).concat(cks.length>5?[Math.round(cks.slice(5).reduce((a,x)=>a+x.v,0))]:[]),
    ['#4f8cff','#818cf8','#c084fc','#22d3ee','#5fe3b4','#2c3444']);
  const sts=brandRowsData().map(r=>({n:r.t.name,v:r.s})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  if(sts.length) mk('lkP4',sts.slice(0,5).map(x=>x.n).concat(sts.length>5?['Others']:[]),
    sts.slice(0,5).map(x=>Math.round(x.v)).concat(sts.length>5?[Math.round(sts.slice(5).reduce((a,x)=>a+x.v,0))]:[]),
    ['#d4af37','#e7c860','#b8860b','#8a6d3b','#f0dcac','#2c3444']);
  const br=brandRowsData();
  if(br.length) mk('lkP5',[br[0].t.name,'Others'],[Math.round(br[0].tot),Math.round(br.slice(1).reduce((a,r)=>a+r.tot,0))],['#5fe3b4','#2c3444']);
};

function downloadLinking(){
  const rows=brandRowsData();
  let csv='Traffic Gastropub — Linking Sheet / DSR Report\nPeriod,'+period.from+' to '+period.to+'\n\nBrand,Category,Cocktail ml,Straight ml,Total ml\n';
  rows.forEach(r=>{ csv+=`"${r.t.name}","${r.t.category}",${Math.round(r.c)},${Math.round(r.s)},${Math.round(r.tot)}\n`; });
  const {totalC,totalS}=calcGrandTotals();
  csv+=`\nTOTAL,,${totalC},${totalS},${totalC+totalS}\n`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='linking_dsr_'+period.from+'_'+period.to+'.csv'; a.click();
  toast('Downloaded','Linking / DSR report (CSV)','ok');
}

/* ============================================================
   ERROR QUEUE  (the "error solve" workflow)
   ============================================================ */
VIEWS.errors = () => {
  const errs=errorRows(); window._errList=errs;
  const body=errs.map((p,i)=>`<tr class="row-alert">
    <td class="muted">${i+1}</td><td><strong>${p.name}</strong></td><td class="num">${p.qty}</td>
    <td><span class="pill red"><span class="dotpulse"></span> Not found</span></td>
    <td class="right"><button class="btn btn-gold btn-sm" onclick="openResolve(${i})">Resolve</button></td>
  </tr>`).join('');
  const lay=pageLay('errors');
  const defCard=`<div class="card"><div class="table-wrap" style="max-height:620px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>#</th><th>POS Item</th><th class="right">Qty</th><th>Status</th><th></th></tr></thead>
      <tbody>${body||'<tr><td colspan="5" class="center" style="padding:30px"><span class="pill green">✓ No errors — every POS item is matched</span></td></tr>'}</tbody></table></div></div>`;
  let bodyHtml;
  if(lay==='def') bodyHtml=defCard;
  else if(lay==='dense') bodyHtml=`<div class="laydense">${defCard}</div>`;
  else {
    const groups=errs.map((p,i)=>({ id:String(p.name), title:`⚠️ ${esc(String(p.name))}`, sub:`qty ${fmt(p.qty)}`,
      right:`<span class="pill red">unmatched</span>`,
      detail:`<p class="muted" style="font-size:12px">This POS name has not been resolved to any brand or cocktail — press Resolve to teach it.</p>`,
      manage:`<button class="btn btn-gold btn-sm" onclick="openResolve(${i})">Resolve</button>` }));
    bodyHtml=renderLay('errors',lay,groups,{listTitle:'Errors'});
  }
  return `
    <div class="page-head"><div><h1>Error Queue</h1><p>POS items matching neither a brand nor a cocktail. Resolve each to teach the system.</p></div>
      <div class="page-actions">${layDrop('errors')}<span class="pill ${errs.length?'red':'green'}"><span class="dotpulse"></span> ${errs.length} unresolved</span></div></div>
    ${bodyHtml}`;
};
let _resolveName=null;
function openResolve(i){
  const item=(window._errList||[])[i]; if(!item) return;
  const name=item.name, qty=item.qty;
  _resolveName=name; _rvMode='existing';
  const brandOpts=tallyItems.map(t=>`<option>${t.name}</option>`).join('');
  modal('Resolve: '+name, `
    <div class="tabs" id="rvTabs">
      <div class="tab active" data-rv="existing" onclick="rvTab('existing')">🔗 Map to brand</div>
      <div class="tab" data-rv="new" onclick="rvTab('new')">✨ New brand</div>
      <div class="tab" data-rv="cocktail" onclick="rvTab('cocktail')">🍹 New cocktail</div>
    </div>
    ${spiritDatalist()}
    <div id="rv-existing">
      <div class="field"><label>Map "${esc(name)}" to existing brand</label><select class="input" id="rvBrand">${brandOptions()}</select></div>
      <div class="field"><label>ML per unit (30 peg · 750 bottle · 1 beer/pcs)</label><input class="input" id="rvMl" type="number" value="30"></div>
    </div>
    <div id="rv-new" style="display:none">
      <div class="form-grid">
        <div class="field"><label>Brand Name</label><input class="input" id="rvNewName" value="${esc(name.toUpperCase())}"></div>
        <div class="field"><label>Category</label><select class="input" id="rvNewCat" onchange="rvCatDefault()">${CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div class="field"><label>ML / unit</label><input class="input" id="rvNewMl" type="number" value="30"></div>
        <div class="field"><label>POS name (alias)</label><input class="input" id="rvNewAlias" value="${esc(name)}"></div>
      </div>
    </div>
    <div id="rv-cocktail" style="display:none">
      <div class="field"><label>Cocktail name</label><input class="input" id="rvCkName" value="${esc(name.toUpperCase())}"></div>
      <label class="muted" style="font-size:12px">Recipe — pick spirit from Tally list + ml</label>
      <div id="ckLines" class="mt-8"></div>
      <button class="btn btn-sm mt-8" onclick="ckAddLine()">＋ Add spirit</button>
    </div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="doResolve()">Resolve</button>`);
  _ckLines=[{spirit:'',ml:''}];
}
let _rvMode='existing';
function rvTab(m){ _rvMode=m; ['existing','new','cocktail'].forEach(x=>{ $('#rv-'+x).style.display = x===m?'block':'none'; }); $$('[data-rv]').forEach(t=>t.classList.toggle('active', t.dataset.rv===m)); if(m==='cocktail') ckRenderLines(); }
function rvCatDefault(){ const c=$('#rvNewCat').value; const d=CAT_DEFAULTS[c]; if(d) $('#rvNewMl').value=d.peg; }
function doResolve(){
  if(_rvMode==='existing'){
    const brand=$('#rvBrand').value, ml=+$('#rvMl').value||30;
    aliasTable.push({posName:_resolveName, tallyItem:brand, mlPerUnit:ml}); bsv('alias',aliasTable);
    toast('Mapped',`"${_resolveName}" → ${brand}`,'ok');
  } else if(_rvMode==='new'){
    const nm=$('#rvNewName').value.trim(), cat=$('#rvNewCat').value, ml=+$('#rvNewMl').value||30, al=$('#rvNewAlias').value.trim();
    const d=CAT_DEFAULTS[cat]||{unit:'ml',peg:30};
    tallyItems.push({name:nm, category:cat, posQty:0, unit:d.unit, pegMl:ml, cocktailMl:0, straightMl:0, bogo:0}); bsv('tally',tallyItems);
    aliasTable.push({posName:al, tallyItem:nm, mlPerUnit:ml}); bsv('alias',aliasTable);
    toast('Brand created',`${nm} (${cat})`,'ok');
  } else {
    ckSyncFromDom();
    const nm=$('#rvCkName').value.trim();
    const recipe=_ckLines.filter(l=>l.spirit&&(+l.ml>0)).map(l=>({spirit:l.spirit.trim(), ml:+l.ml}));
    if(!nm||!recipe.length){ toast('Need recipe','Add cocktail name + at least one spirit ml','err'); return; }
    cocktails.push({name:nm, qty:0, recipe}); bsv('cocktails',cocktails);
    cocktailAlias.push({alias:_resolveName, canonical:nm}); bsv('cocktailAlias',cocktailAlias);
    toast('Cocktail added',`${nm} · ${recipe.length} spirits — now in Cocktail Master`,'ok');
  }
  closeModal(); route();
}

/* ============================================================
   ALIAS TABLE
   ============================================================ */
let aQuery='';
// group aliases by brand → one row per brand showing all its POS aliases
function aliasGroups(){
  const { smlMap, posQtyMap } = calcGrandTotals();
  const map = {};
  aliasTable.forEach(a=>{ const k=norm(a.tallyItem); (map[k]=map[k]||{brand:a.tallyItem, aliases:[]}).aliases.push(a); });
  return Object.values(map).map(g=>{ const it=getTallyItem(g.brand);
    return { brand:g.brand, category:it?it.category:'—', aliases:g.aliases,
      qty: it?getEffectivePosQty(it,posQtyMap):0, ml: it?getEffectiveStraightMl(it,smlMap):0 };
  }).sort((a,b)=>b.ml-a.ml);
}
let _alSel='', _alOpen='', _aCat='ALL';
function setAliasLayout(v){ pref.aliasLayout=v; bsv('pref',pref); route(); }
function alSelBrand(b){ _alSel=b; route(); }
function alToggle(b){ _alOpen=(_alOpen===b?'':b); route(); }
function setACat(c){ _aCat=c; route(); }
VIEWS.alias = () => {
  const lay=pref.aliasLayout||'ledger';
  let groups = aliasGroups().filter(g=>!aQuery||norm(g.brand).includes(norm(aQuery))||g.aliases.some(a=>norm(a.posName).includes(norm(aQuery))));
  if(lay==='dense' && _aCat!=='ALL') groups=groups.filter(g=>g.category===_aCat);
  const totMl = groups.reduce((a,g)=>a+g.ml,0);
  const chipsOf=g=>{
    const dq=posQtyOfName(g.brand);
    const direct = dq>0 ? `<span class="chip" style="border-color:var(--gold)">${esc(g.brand)} <span class="pill gold" style="font-size:9px;padding:1px 6px">qty ${fmt(dq)}</span> <span class="muted">·direct</span></span>` : '';
    return direct + g.aliases.map(a=>{ const ax=(+a.x>0)?+a.x:1;
      const calc = ax!==1 ? `·${a.mlPerUnit}×${ax}=${fmt(Math.round((+a.mlPerUnit||0)*ax))}` : `·${a.mlPerUnit}`;
      return `<span class="chip">${a.posName} <span class="pill blue" style="font-size:9px;padding:1px 6px">qty ${fmt(posQtyOfName(a.posName))}</span> <span class="muted">${calc}</span> <span class="xx" onclick='removeAliasAsk(${JSON.stringify(a.posName)})'>✕</span></span>`; }).join('');
  };
  const manage=g=>`<button class="btn btn-ghost btn-sm" onclick='openAliasEditor(${JSON.stringify(g.brand)})'>✎</button><button class="btn btn-gold btn-sm" onclick='openAddAlias(${JSON.stringify(g.brand)})'>＋</button><button class="btn btn-danger btn-sm" title="Remove brand & aliases" onclick='removeBrand(${JSON.stringify(g.brand)})'>🗑</button>`;
  let bodyHtml='';
  if(lay==='ledger'){
    const body=groups.map(g=>`<tr>
      <td><strong>${g.brand}</strong></td><td><span class="pill gray">${g.category}</span></td>
      <td><div class="chips">${chipsOf(g)}</div></td>
      <td class="num">${fmt(g.qty)}</td><td class="num gold">${fmt(g.ml)}</td>
      <td class="right nowrap">${manage(g)}</td></tr>`).join('');
    bodyHtml=`<div class="card barinv"><div class="table-wrap" style="max-height:620px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>Brand</th><th>Category</th><th>POS Aliases (all summed)</th><th class="right">Qty</th><th class="right">Straight ml</th><th class="right">Manage</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr style="position:sticky;bottom:0;background:var(--bg-2)"><td colspan="4" class="right"><strong>Total Straight Liquor ml</strong></td><td class="num gold"><strong>${fmt(totMl)}</strong></td><td></td></tr></tfoot>
      </table></div></div>`;
  } else if(lay==='twopane'){
    if(!_alSel || !groups.some(g=>g.brand===_alSel)) _alSel=groups.length?groups[0].brand:'';
    const sel=groups.find(g=>g.brand===_alSel);
    const list=groups.map(g=>`<div style="padding:7px 11px;cursor:pointer;border-left:3px solid ${g.brand===_alSel?'var(--gold)':'transparent'};background:${g.brand===_alSel?'var(--gold-dim)':'transparent'}" onclick='alSelBrand(${JSON.stringify(g.brand)})'>
      <div style="font-size:12.5px;font-weight:600">${g.brand}</div><div class="muted" style="font-size:10px">${g.category} · ${g.aliases.length} links · <span class="gold">${fmt(g.ml)} ml</span></div></div>`).join('');
    bodyHtml=`<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div class="card" style="width:270px;flex:none"><div class="card-head"><h3>Brands · ${groups.length}</h3></div>
        <div style="max-height:560px;overflow-y:auto">${list||'<p class="muted center" style="padding:20px">No brands</p>'}</div></div>
      <div class="card" style="flex:1;min-width:300px">${sel?`<div class="card-head"><div><h3>${sel.brand}</h3><p>${sel.category} · Qty ${fmt(sel.qty)} · <span class="gold">${fmt(sel.ml)} ml</span></p></div><div class="nowrap">${manage(sel)}</div></div>
        <div class="card-body"><div class="chips">${chipsOf(sel)||'<span class="muted">No aliases yet — press ＋</span>'}</div></div>`:'<div class="card-body muted center" style="padding:30px">Select a brand</div>'}</div></div>`;
  } else if(lay==='accordion'){
    bodyHtml=`<div class="card">${groups.map(g=>{ const open=_alOpen===g.brand;
      return `<div style="border-bottom:1px solid var(--border-soft)">
        <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer" onclick='alToggle(${JSON.stringify(g.brand)})'>
          <span class="muted">${open?'▾':'▸'}</span><strong style="flex:1">${g.brand}</strong>
          <span class="pill gray">${g.category}</span><span class="muted" style="font-size:11px">${g.aliases.length} links</span>
          <span class="num gold" style="font-weight:700">${fmt(g.ml)}</span></div>
        ${open?`<div style="padding:0 14px 10px 34px"><div class="chips">${chipsOf(g)||'<span class="muted">No aliases</span>'}</div><div class="mt-8">${manage(g)}</div></div>`:''}</div>`; }).join('')||'<p class="muted center" style="padding:24px">No brands</p>'}
      <div style="display:flex;justify-content:flex-end;padding:9px 14px"><span class="muted" style="margin-right:8px">Total Straight ml</span><strong class="gold">${fmt(totMl)}</strong></div></div>`;
  } else if(lay==='cards'){
    bodyHtml=`<div class="grid-3">${groups.map(g=>`<div class="card"><div class="card-head"><div><h3 style="font-size:12.5px">${g.brand}</h3><p>${g.category}</p></div></div>
      <div class="card-body"><div class="chips">${chipsOf(g)||'<span class="muted" style="font-size:11px">No aliases</span>'}</div>
        <div class="flex between items-center mt-8"><span class="muted" style="font-size:11px">Qty ${fmt(g.qty)}</span><strong class="gold">${fmt(g.ml)} ml</strong></div>
        <div class="mt-8">${manage(g)}</div></div></div>`).join('')||'<p class="muted center" style="padding:24px">No brands</p>'}</div>
      <div class="card mt-16"><div class="card-body" style="display:flex;justify-content:space-between"><span class="muted">Total Straight Liquor ml</span><strong class="gold">${fmt(totMl)}</strong></div></div>`;
  } else { // dense
    const cats=['ALL',...new Set(aliasGroups().map(g=>g.category))];
    const catChips=cats.map(c=>`<button class="btn btn-sm ${_aCat===c?'btn-gold':''}" style="margin:2px;padding:3px 9px;font-size:11px" onclick='setACat(${JSON.stringify(c)})'>${c}</button>`).join('');
    const rows=groups.map(g=>`<tr>
      <td><strong>${g.brand}</strong> <span class="muted" style="font-size:11px">${g.aliases.map(a=>{ const ax=(+a.x>0)?+a.x:1; return `${a.posName}·qty ${fmt(posQtyOfName(a.posName))}·${a.mlPerUnit}${ax!==1?'×'+ax:''}`; }).join(' · ')}</span></td>
      <td class="num">${fmt(g.qty)}</td><td class="num gold">${fmt(g.ml)}</td>
      <td class="right nowrap">${manage(g)}</td></tr>`).join('');
    bodyHtml=`<div class="card barinv"><div class="card-body" style="padding:6px 12px;border-bottom:1px solid var(--border)"><div style="display:flex;flex-wrap:wrap;gap:2px;align-items:center"><span class="muted" style="font-size:11px;margin-right:4px">Category:</span>${catChips}</div></div>
      <div class="table-wrap" style="max-height:580px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>Brand → aliases (·ml inline)</th><th class="right">Qty</th><th class="right">ml</th><th class="right">Manage</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="4" class="center muted" style="padding:20px">No brands</td></tr>'}</tbody>
      <tfoot><tr style="position:sticky;bottom:0;background:var(--bg-2)"><td colspan="2" class="right"><strong>Total Straight ml</strong></td><td class="num gold"><strong>${fmt(totMl)}</strong></td><td></td></tr></tfoot>
      </table></div></div>`;
  }
  return `
    <div class="page-head"><div><h1>Liquor Alias Table</h1><p>${aliasTable.length} POS links across ${aliasGroups().length} brands · showing ${groups.length}. One brand → all its POS button names.</p></div>
      <div class="page-actions">
        <select class="input" style="width:auto;padding:6px 9px;font-size:12px" onchange="setAliasLayout(this.value)" title="Layout">
          ${[['ledger','① Chip Ledger'],['twopane','② Two-Pane'],['accordion','③ Accordion'],['cards','④ Brand Cards'],['dense','⑤ Dense Inline']].map(o=>`<option value="${o[0]}" ${lay===o[0]?'selected':''}>${o[1]}</option>`).join('')}
        </select>
        <div class="search" style="width:210px">🔎<input id="searchBox" placeholder="Search brand / alias…" value="${esc(aQuery)}" oninput="searchType('alias',this.value)"></div>
        <button class="btn btn-gold btn-sm" onclick="openNewAlias()">＋ New Alias</button></div></div>
    ${bodyHtml}`;
};
function removeAlias(posName){
  const i=aliasTable.findIndex(a=>norm(a.posName)===norm(posName));
  if(i<0) return; const a=aliasTable[i]; aliasTable.splice(i,1); bsv('alias',aliasTable); invalidateCalcCache();
  const nowErr = !isKnownPosName(posName) && posData.some(p=>norm(p.name)===norm(posName));
  route(); toast('Link deleted', `"${a.posName}" removed`+(nowErr?' → moved to Error Queue':''), nowErr?'err':'ok');
}
function removeAliasAsk(posName){ confirmAsk(`Delete POS link <strong>${esc(posName)}</strong>?`, ()=>removeAlias(posName)); }
function removeAliasEditorDel(posName, brand){ confirmAsk(`Delete POS link <strong>${esc(posName)}</strong>?`, ()=>{ removeAlias(posName); closeModal(); openAliasEditor(brand); }); }
function removeBrand(brand){
  confirmAsk(`Remove brand <strong>${esc(brand)}</strong> and all its POS aliases? It disappears from the Tally Sheet & Bar Inventory too.`, ()=>{
    const bn=norm(brand);
    const ti=tallyItems.findIndex(t=>norm(t.name)===bn); if(ti>=0) tallyItems.splice(ti,1);
    for(let i=aliasTable.length-1;i>=0;i--){ if(norm(aliasTable[i].tallyItem)===bn) aliasTable.splice(i,1); }
    if(typeof invData!=='undefined' && invData[bn]){ delete invData[bn]; bsv('inv',invData); }
    bsv('tally',tallyItems); bsv('alias',aliasTable); rebuildIndexes(); invalidateCalcCache();
    route(); toast('Removed',`${brand} & its aliases deleted`,'err');
  });
}
// ---- Tally: edit a brand (cascades rename to aliases + Bar Inventory) ----
function editBrand(oldName){
  const t=tallyItems.find(x=>norm(x.name)===norm(oldName)); if(!t) return;
  const catOpts=CATEGORIES.map(c=>`<option ${t.category===c?'selected':''}>${esc(c)}</option>`).join('');
  modal('Edit Brand', `
    <div class="field"><label>Brand name</label><input class="input" id="ebName" value="${esc(t.name)}"></div>
    <div class="field"><label>Category</label><select class="input" id="ebCat">${catOpts}</select></div>
    <div class="field"><label>ML / unit (peg)</label><input class="input" id="ebMl" type="number" value="${t.pegMl}"></div>
    <p class="muted" style="font-size:11.5px">Renaming cascades to its POS aliases & Bar Inventory.</p>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick='saveBrandEdit(${JSON.stringify(oldName)})'>Save</button>`);
}
function saveBrandEdit(oldName){
  const t=tallyItems.find(x=>norm(x.name)===norm(oldName)); if(!t) return;
  const nm=$('#ebName').value.trim()||t.name, cat=$('#ebCat').value, ml=+$('#ebMl').value||t.pegMl;
  const changed = norm(nm)!==norm(oldName);
  t.category=cat; t.pegMl=ml;
  if(changed){
    const oldKey=norm(oldName), newKey=norm(nm);
    aliasTable.forEach(a=>{ if(norm(a.tallyItem)===oldKey) a.tallyItem=nm; });
    if(typeof invData!=='undefined' && invData[oldKey]){ invData[newKey]={...invData[oldKey], ...(invData[newKey]||{})}; delete invData[oldKey]; bsv('inv',invData); }
    t.name=nm; bsv('alias',aliasTable);
  }
  bsv('tally',tallyItems); rebuildIndexes(); invalidateCalcCache(); closeModal(); route(); toast('Saved',`${nm} updated`,'ok');
}
// ---- Qty list (POS sale rows): edit / remove; remove also drops the alias ----
function editPos(idx){
  const p=posData[idx]; if(!p) return;
  modal('Edit POS item', `
    ${spiritDatalist()}
    <div class="field"><label>POS button name</label><input class="input" id="epName" list="spiritList" value="${esc(String(p.name))}"></div>
    <div class="field"><label>Qty sold</label><input class="input" id="epQty" type="number" value="${p.qty}"></div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="savePosEdit(${idx})">Save</button>`);
}
function savePosEdit(idx){
  const p=posData[idx]; if(!p) return; const nm=$('#epName').value.trim();
  if(!nm){ toast('Name?','Enter a POS name','err'); return; }
  p.name=nm; p.qty=+$('#epQty').value||0; bsv('pos',posData); invalidateCalcCache(); closeModal(); route(); toast('Saved','POS item updated','ok');
}
function delPos(idx){
  const p=posData[idx]; if(!p) return; const nm=p.name;
  confirmAsk(`Remove POS item <strong>${esc(String(nm))}</strong> from the sale list? Its alias link is removed too.`, ()=>{
    posData.splice(idx,1); const k=norm(nm);
    for(let i=aliasTable.length-1;i>=0;i--){ if(norm(aliasTable[i].posName)===k) aliasTable.splice(i,1); }
    if(typeof nameMapList!=='undefined'){ for(let i=nameMapList.length-1;i>=0;i--){ if(norm(nameMapList[i].pos)===k) nameMapList.splice(i,1); } bsv('namemap',nameMapList); }
    bsv('pos',posData); bsv('alias',aliasTable); rebuildIndexes(); invalidateCalcCache();
    route(); toast('Removed',`${nm} removed`,'err');
  });
}
function openAliasEditor(brand){
  const rows=aliasTable.map((a,idx)=>({a,idx})).filter(x=>norm(x.a.tallyItem)===norm(brand));
  const dqb=posQtyOfName(brand);
  const directB = dqb>0 ? `<div class="rline" style="opacity:.85"><input class="inp input" value="${esc(brand)} — direct" disabled style="flex:1;border-color:var(--gold-dim)"><span class="pill gold" style="font-size:10px;white-space:nowrap">qty ${fmt(dqb)}</span></div>` : '';
  const lines=directB+rows.map(x=>{ const ax=(+x.a.x>0)?+x.a.x:1; const ml=+x.a.mlPerUnit||0;
    return `<div class="rline" data-i="${x.idx}" style="gap:6px;align-items:center">
    <input class="inp input" value="${x.a.posName}" disabled style="flex:1;font-size:12px;padding:6px 9px">
    <span class="pill blue" style="font-size:10px;white-space:nowrap">qty ${fmt(posQtyOfName(x.a.posName))}</span>
    <input class="input" type="number" value="${ml}" title="ml / unit" onchange='updateAliasMl(${x.idx}, this.value, ${JSON.stringify(brand)})' style="width:66px;padding:6px 6px;font-size:12px;text-align:center">
    <span class="muted" style="font-size:11px">×</span>
    <input class="input" type="number" step="0.5" min="0" value="${ax}" title="multiplier — 1+1 offer = 2" onchange='updateAliasX(${x.idx}, this.value, ${JSON.stringify(brand)})' style="width:52px;padding:6px 6px;font-size:12px;text-align:center">
    <span class="pill gold" style="font-size:10px;white-space:nowrap">${ml} × ${ax} = ${fmt(Math.round(ml*ax))} ml</span>
    <button class="del" onclick='removeAliasEditorDel(${JSON.stringify(x.a.posName)}, ${JSON.stringify(brand)})'>🗑</button></div>`; }).join('');
  modal('Aliases for '+brand, `
    ${spiritDatalist()}
    <p class="muted" style="font-size:12px;margin-bottom:12px">Edit ml/unit, delete a link, or add a new POS button name for this brand.</p>
    ${lines||'<p class="muted">No aliases yet.</p>'}
    <div class="divider"></div>
    <div class="rline" style="gap:6px;align-items:center"><input class="input" id="newAliasName" list="spiritList" placeholder="New POS button name (all Tally alcohols listed)" style="flex:1;font-size:12px;padding:6px 9px">
      <input class="input" id="newAliasMl" type="number" value="30" title="ml / unit" style="width:66px;padding:6px 6px;font-size:12px;text-align:center">
      <span class="muted" style="font-size:11px">×</span>
      <input class="input" id="newAliasX" type="number" step="0.5" min="0" value="1" title="multiplier" style="width:52px;padding:6px 6px;font-size:12px;text-align:center"></div>`,
    `<button class="btn" onclick="closeModal()">Close</button>
     <button class="btn btn-gold" onclick='addAliasFromEditor(${JSON.stringify(brand)})'>＋ Add Link</button>`);
}
function updateAliasMl(idx,val,brand){ if(!aliasTable[idx]) return;
  aliasTable[idx].mlPerUnit=+val||0; bsv('alias',aliasTable); rebuildIndexes(); invalidateCalcCache();
  if(brand){ closeModal(); openAliasEditor(brand); } toast('Updated','ml/unit changed','ok'); }
function updateAliasX(idx,val,brand){ if(!aliasTable[idx]) return;
  const x=+val; if(x>0 && Math.abs(x-1)>0.001) aliasTable[idx].x=x; else delete aliasTable[idx].x;
  bsv('alias',aliasTable); rebuildIndexes(); invalidateCalcCache();
  if(brand){ closeModal(); openAliasEditor(brand); } toast('Updated',`"${aliasTable[idx].posName}" = ×${x>0?x:1}`,'ok'); }
function addAliasFromEditor(brand){
  const nm=$('#newAliasName').value.trim(), ml=+$('#newAliasMl').value||30;
  const x=+($('#newAliasX')?$('#newAliasX').value:1);
  if(!nm){ toast('Enter name','Type a POS button name','err'); return; }
  const e={posName:nm, tallyItem:brand, mlPerUnit:ml}; if(x>0 && Math.abs(x-1)>0.001) e.x=x;
  aliasTable.push(e); bsv('alias',aliasTable); rebuildIndexes(); invalidateCalcCache();
  closeModal(); openAliasEditor(brand); route(); toast('Link added',`"${nm}" → ${brand} (×${x>0?x:1})`,'ok');
}
function openAddAlias(brand){ openAliasEditor(brand); }
function openNewAlias(){
  modal('New Alias — manual link', `
    ${spiritDatalist()}
    <div class="field"><label>Brand name / POS button (all Tally alcohols listed · pick or type)</label><input class="input" id="naPos" list="spiritList" placeholder="e.g. Teachers Highland"></div>
    <div class="field"><label>Map to brand (from Tally Sheet)</label><select class="input" id="naBrand" onchange="naSyncCat()">${brandOptions()}</select></div>
    <div class="field"><label>Category (auto from brand · editable)</label><select class="input" id="naCat">${CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>
    <div class="field"><label>ML / unit (30 peg · 750 bottle · 1 beer/pcs)</label><input class="input" id="naMl" type="number" value="30"></div>
    <div class="field"><label>× multiplier (1+1 offer / double serve = 2 · usually 1)</label><input class="input" id="naX" type="number" step="0.5" min="0" value="1"></div>
    <p class="muted" style="font-size:11.5px">Brand list & POS suggestions come straight from the Tally Sheet. Editing the category updates that brand in Tally (and Bar Inventory).</p>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="saveNewAlias()">Add Link</button>`);
  naSyncCat();
}
function naSyncCat(){ const b=$('#naBrand'); if(!b) return; const it=getTallyItem(b.value);
  if(it){ const cat=$('#naCat'); if(cat) cat.value=it.category; if($('#naMl')) $('#naMl').value=it.pegMl||(CAT_DEFAULTS[it.category]?CAT_DEFAULTS[it.category].peg:30); } }
function saveNewAlias(){
  const pos=$('#naPos').value.trim(), brand=$('#naBrand').value, ml=+$('#naMl').value||30, cat=$('#naCat')?$('#naCat').value:'';
  if(!pos){ toast('POS name?','Enter the POS button name','err'); return; }
  if(!brand){ toast('Brand?','Add a brand in Tally Sheet first','err'); return; }
  const it=getTallyItem(brand); if(it && cat && it.category!==cat){ it.category=cat; bsv('tally',tallyItems); rebuildIndexes(); }
  const nx=+($('#naX')?$('#naX').value:1);
  const e={posName:pos, tallyItem:brand, mlPerUnit:ml}; if(nx>0 && Math.abs(nx-1)>0.001) e.x=nx;
  aliasTable.push(e); bsv('alias',aliasTable); rebuildIndexes(); invalidateCalcCache();
  closeModal(); route(); toast('Link added',`"${pos}" → ${brand} (×${nx>0?nx:1})`,'ok');
}
/* ============================================================
   COCKTAIL ALIAS TABLE — POS button name → cocktail (mirrors the Excel cocktails-sheet VLOOKUP chain)
   ============================================================ */
let ckaQuery='';
function ckaGroups(){
  const qm=buildCocktailQtyMap();
  const byCanon={};
  cocktailAlias.forEach(a=>{ const k=norm(a.canonical); (byCanon[k]=byCanon[k]||[]).push(a); });
  // EVERY cocktail from the Cocktail Master (with or without aliases) — total then matches the 90,100 grand total
  const seen=new Set();
  const out=cocktails.map(c=>{ const k=norm(c.name); seen.add(k);
    const mlServe=c.recipe.reduce((a,r)=>a+(+r.ml||0),0);
    const qty=resolveCocktailQty(c.name,qm);
    return { canonical:c.name, aliases:byCanon[k]||[], exists:true, recipe:c.recipe, mlServe, qty, ml:mlServe*qty }; });
  // plus alias groups whose canonical has no recipe yet (needs fixing → red badge)
  Object.keys(byCanon).forEach(k=>{ if(seen.has(k)) return;
    const list=byCanon[k]; const qty=resolveCocktailQty(list[0].canonical,qm);
    out.push({ canonical:list[0].canonical, aliases:list, exists:false, recipe:[], mlServe:0, qty, ml:0 }); });
  return out.sort((a,b)=>b.ml-a.ml||b.qty-a.qty||a.canonical.localeCompare(b.canonical));
}
function posNamesDatalist(){ return `<datalist id="posNames">${[...new Set(posData.map(p=>String(p.name)))].sort().map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`; }
function cocktailOptions(sel){ return [...new Set(cocktails.map(c=>c.name))].sort((a,b)=>a.localeCompare(b)).map(n=>`<option ${sel&&norm(sel)===norm(n)?'selected':''}>${esc(n)}</option>`).join(''); }
let _ckaSel='', _ckaOpen='';
function setCkaLayout(v){ pref.ckaLayout=v; bsv('pref',pref); route(); }
function ckaSelPick(b){ _ckaSel=b; route(); }
function ckaToggle(b){ _ckaOpen=(_ckaOpen===b?'':b); route(); }
VIEWS.ckalias = () => {
  const lay=pref.ckaLayout||'recipe';
  const groups=ckaGroups().filter(g=>!ckaQuery||norm(g.canonical).includes(norm(ckaQuery))||g.aliases.some(a=>norm(a.alias).includes(norm(ckaQuery))));
  const totMl=groups.reduce((a,g)=>a+g.ml,0);
  const aliasQty=a=>posQtyOfName(a.alias);
  const chipsOf=g=>{
    const dq=posQtyOfName(g.canonical);
    const direct = dq>0 ? `<span class="chip" style="border-color:var(--gold)">${esc(g.canonical)} <span class="pill gold" style="font-size:9px;padding:1px 6px">qty ${fmt(dq)}</span> <span class="muted">·direct</span></span>` : '';
    const ali = g.aliases.map(a=>{ let x=(+a.x>0)?+a.x:(((+a.ml>0)&&g.mlServe>0)?(+a.ml)/g.mlServe:1); x=Math.round(x*100)/100;
      const calc = x!==1 ? `·${g.mlServe}×${x}=${fmt(Math.round(g.mlServe*x))}` : `·${fmt(g.mlServe)}ml`;
      return `<span class="chip">${esc(a.alias)} <span class="pill blue" style="font-size:9px;padding:1px 6px">qty ${fmt(aliasQty(a))}</span> <span class="muted">${calc}</span> <span class="xx" onclick='removeCkAliasAsk(${JSON.stringify(a.alias)})'>✕</span></span>`; }).join('');
    return (direct+ali) || `<span class="muted" style="font-size:11px">— direct POS name${g.qty>0?'':' · no sale'}</span>`;
  };
  const manage=g=>`<button class="btn btn-ghost btn-sm" onclick='openCkAliasEditor(${JSON.stringify(g.canonical)})'>✎</button><button class="btn btn-gold btn-sm" onclick='openCkAliasEditor(${JSON.stringify(g.canonical)})'>＋</button>`;
  const badge=g=>g.exists?'':' <span class="pill red" style="font-size:9px">✕ no recipe</span>';
  const recLines=g=>g.recipe.map(r=>`<div class="flex between" style="padding:3px 0;border-bottom:1px solid var(--border-soft);font-size:11.5px"><span class="muted">${esc(r.spirit)}</span><span>${fmt(r.ml)} × ${fmt(g.qty)} = <strong class="gold">${fmt(g.qty*(+r.ml||0))}</strong></span></div>`).join('');
  let bodyHtml='';
  if(lay==='recipe'){
    const body=groups.map(g=>{ const rec=g.recipe.length?g.recipe:[null]; const n=rec.length;
      return rec.map((r,ri)=>`<tr${ri===0?' style="border-top:2px solid var(--border)"':''}>
        ${ri===0?`<td rowspan="${n}" style="vertical-align:top"><strong>${esc(g.canonical)}</strong>${badge(g)}<div class="chips" style="margin-top:4px">${chipsOf(g)}</div></td>
        <td class="num" rowspan="${n}" style="vertical-align:top"><strong>${fmt(g.qty)}</strong></td>`:''}
        <td>${r?esc(r.spirit):'<span class="muted">—</span>'}</td>
        <td class="num muted">${r?fmt(r.ml):''}</td>
        <td class="num gold">${r?fmt(g.qty*(+r.ml||0)):''}</td>
        ${ri===0?`<td class="right nowrap" rowspan="${n}" style="vertical-align:top">${manage(g)}</td>`:''}</tr>`).join('');
    }).join('') || `<tr><td colspan="6" class="center muted" style="padding:24px">No cocktails${ckaQuery?' match':''}.</td></tr>`;
    bodyHtml=`<div class="card barinv"><div class="table-wrap" style="max-height:620px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>Cocktail · POS aliases</th><th class="right">Qty Sold</th><th>Liquor / Spirit</th><th class="right">ml</th><th class="right">Total ml</th><th class="right">Manage</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr style="position:sticky;bottom:0;background:var(--bg-2)"><td colspan="4" class="right"><strong>Total Cocktail ml</strong></td><td class="num gold"><strong>${fmt(totMl)}</strong></td><td></td></tr></tfoot>
      </table></div></div>`;
  } else if(lay==='twopane'){
    if(!_ckaSel || !groups.some(g=>g.canonical===_ckaSel)) _ckaSel=groups.length?groups[0].canonical:'';
    const sel=groups.find(g=>g.canonical===_ckaSel);
    const list=groups.map(g=>`<div style="padding:7px 11px;cursor:pointer;border-left:3px solid ${g.canonical===_ckaSel?'var(--gold)':'transparent'};background:${g.canonical===_ckaSel?'var(--gold-dim)':'transparent'}" onclick='ckaSelPick(${JSON.stringify(g.canonical)})'>
      <div style="font-size:12.5px;font-weight:600">${esc(g.canonical)}</div><div class="muted" style="font-size:10px">qty ${fmt(g.qty)} · <span class="gold">${fmt(g.ml)} ml</span></div></div>`).join('');
    bodyHtml=`<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div class="card" style="width:270px;flex:none"><div class="card-head"><h3>Cocktails · ${groups.length}</h3></div>
        <div style="max-height:560px;overflow-y:auto">${list||'<p class="muted center" style="padding:20px">No cocktails</p>'}</div></div>
      <div class="card" style="flex:1;min-width:300px">${sel?`<div class="card-head"><div><h3>${esc(sel.canonical)}${badge(sel)}</h3><p>Qty ${fmt(sel.qty)} · recipe ${fmt(sel.mlServe)} ml · total <span class="gold">${fmt(sel.ml)} ml</span></p></div><div class="nowrap">${manage(sel)}</div></div>
        <div class="card-body">${recLines(sel)||'<p class="muted" style="font-size:11px">No recipe</p>'}<div class="chips mt-8">${chipsOf(sel)}</div></div>`:'<div class="card-body muted center" style="padding:30px">Select a cocktail</div>'}</div></div>`;
  } else if(lay==='accordion'){
    bodyHtml=`<div class="card">${groups.map(g=>{ const open=_ckaOpen===g.canonical;
      return `<div style="border-bottom:1px solid var(--border-soft)">
        <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer" onclick='ckaToggle(${JSON.stringify(g.canonical)})'>
          <span class="muted">${open?'▾':'▸'}</span><strong style="flex:1">${esc(g.canonical)}</strong>${badge(g)}
          <span class="muted" style="font-size:11px">${g.aliases.length} links</span>
          <span class="num" style="font-weight:700">${fmt(g.qty)}</span>
          <span class="num gold" style="font-weight:700">${fmt(g.ml)}</span></div>
        ${open?`<div style="padding:0 14px 10px 34px">${recLines(g)||''}<div class="chips mt-8">${chipsOf(g)}</div><div class="mt-8">${manage(g)}</div></div>`:''}</div>`; }).join('')||'<p class="muted center" style="padding:24px">No cocktails</p>'}
      <div style="display:flex;justify-content:flex-end;padding:9px 14px"><span class="muted" style="margin-right:8px">Total Cocktail ml</span><strong class="gold">${fmt(totMl)}</strong></div></div>`;
  } else if(lay==='cards'){
    bodyHtml=`<div class="grid-3">${groups.map(g=>`<div class="card"><div class="card-head"><div><h3 style="font-size:12.5px">${esc(g.canonical)}</h3><p>qty ${fmt(g.qty)} · ${fmt(g.mlServe)} ml/serve</p></div></div>
      <div class="card-body">${recLines(g)||'<p class="muted" style="font-size:11px">No recipe</p>'}
        <div class="chips mt-8">${chipsOf(g)}</div>
        <div class="flex between items-center mt-8"><span class="muted" style="font-size:11px">Total</span><strong class="gold">${fmt(g.ml)} ml</strong></div>
        <div class="mt-8">${manage(g)}</div></div></div>`).join('')||'<p class="muted center" style="padding:24px">No cocktails</p>'}</div>
      <div class="card mt-16"><div class="card-body" style="display:flex;justify-content:space-between"><span class="muted">Total Cocktail ml</span><strong class="gold">${fmt(totMl)}</strong></div></div>`;
  } else { // dense
    const rows=groups.map(g=>`<tr>
      <td><strong>${esc(g.canonical)}</strong>${badge(g)} <span class="muted" style="font-size:11px">${g.aliases.map(a=>{ let x=(+a.x>0)?+a.x:1; return `${esc(a.alias)}·qty ${fmt(aliasQty(a))}${x!==1?'·×'+x:''}`; }).join(' · ')}</span></td>
      <td class="num">${fmt(g.qty)}</td><td class="num muted">${fmt(g.mlServe)}</td><td class="num gold">${fmt(g.ml)}</td>
      <td class="right nowrap">${manage(g)}</td></tr>`).join('');
    bodyHtml=`<div class="card barinv"><div class="table-wrap" style="max-height:600px;overflow-y:auto"><table class="tbl">
      <thead><tr><th>Cocktail → aliases (qty inline)</th><th class="right">Qty</th><th class="right">ml/serve</th><th class="right">Total ml</th><th class="right">Manage</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" class="center muted" style="padding:20px">No cocktails</td></tr>'}</tbody>
      <tfoot><tr style="position:sticky;bottom:0;background:var(--bg-2)"><td colspan="3" class="right"><strong>Total Cocktail ml</strong></td><td class="num gold"><strong>${fmt(totMl)}</strong></td><td></td></tr></tfoot>
      </table></div></div>`;
  }
  return `
    <div class="page-head"><div><h1>Cocktail Alias Table</h1><p>${cocktails.length} cocktails · ${cocktailAlias.length} POS links · showing ${groups.length}. Each chip shows that POS name's own qty — easy to verify totals.</p></div>
      <div class="page-actions">
        <select class="input" style="width:auto;padding:6px 9px;font-size:12px" onchange="setCkaLayout(this.value)" title="Layout">
          ${[['recipe','① Recipe Ledger'],['twopane','② Two-Pane'],['accordion','③ Accordion'],['cards','④ Cocktail Cards'],['dense','⑤ Dense Inline']].map(o=>`<option value="${o[0]}" ${lay===o[0]?'selected':''}>${o[1]}</option>`).join('')}
        </select>
        <div class="search" style="width:210px">🔎<input id="searchBox" placeholder="Search cocktail / alias…" value="${esc(ckaQuery)}" oninput="searchType('ckalias',this.value)"></div>
        <button class="btn btn-gold btn-sm" onclick="openNewCkAlias()">＋ New Cocktail Alias</button></div></div>
    ${bodyHtml}`;
};
function removeCkAlias(alias){
  const i=cocktailAlias.findIndex(a=>norm(a.alias)===norm(alias)); if(i<0) return;
  const a=cocktailAlias[i]; cocktailAlias.splice(i,1); bsv('cocktailAlias',cocktailAlias); invalidateCalcCache();
  const nowErr=!isKnownPosName(alias) && posData.some(p=>norm(p.name)===norm(alias));
  route(); toast('Link deleted', `"${a.alias}" removed`+(nowErr?' → moved to Error Queue':''), nowErr?'err':'ok');
}
function removeCkAliasAsk(alias){ confirmAsk(`Delete cocktail POS link <strong>${esc(alias)}</strong>?`, ()=>removeCkAlias(alias)); }
function removeCkAliasEditorDel(alias, canonical){ confirmAsk(`Delete cocktail POS link <strong>${esc(alias)}</strong>?`, ()=>{ removeCkAlias(alias); closeModal(); openCkAliasEditor(canonical); }); }
function openCkAliasEditor(canonical){
  const ck=cocktails.find(c=>norm(c.name)===norm(canonical));
  const rml=ck?ck.recipe.reduce((s,r)=>s+(+r.ml||0),0):0;
  const rows=cocktailAlias.filter(a=>norm(a.canonical)===norm(canonical));
  const xs=v=>String(Math.round(v*100)/100);
  const xOf=a=>(+a.x>0)?+a.x:(((+a.ml>0)&&rml>0)?(+a.ml)/rml:1);
  const dq=posQtyOfName(canonical);
  const directLine=`<div class="rline" style="gap:6px;margin-bottom:6px;align-items:center;opacity:.85">
    <input class="inp input" value="${esc(canonical)} — direct" disabled style="flex:1;font-size:12px;padding:6px 9px;border-color:var(--gold-dim)">
    <span class="pill gold" style="font-size:10px;white-space:nowrap">qty ${fmt(dq)}</span>
    <span class="pill gold" style="font-size:10px;white-space:nowrap">${rml} × 1 = ${fmt(rml)} ml</span></div>`;
  const lines=rows.map(a=>{ const x=xOf(a);
    return `<div class="rline" style="gap:6px;margin-bottom:6px;align-items:center">
    <input class="inp input" value="${esc(a.alias)}" disabled style="flex:1;font-size:12px;padding:6px 9px">
    <span class="pill blue" style="font-size:10px;white-space:nowrap">qty ${fmt(posQtyOfName(a.alias))}</span>
    <span class="muted" style="font-size:11px">×</span>
    <input class="input" type="number" step="0.5" min="0" value="${xs(x)}" style="width:56px;padding:6px 6px;font-size:12px;text-align:center" onchange='updateCkAliasX(${JSON.stringify(a.alias)}, this.value, ${JSON.stringify(canonical)})'>
    <span class="pill gold" style="font-size:10px;white-space:nowrap">${rml} × ${xs(x)} = ${fmt(Math.round(rml*x))} ml</span>
    <button class="del" onclick='removeCkAliasEditorDel(${JSON.stringify(a.alias)}, ${JSON.stringify(canonical)})'>🗑</button></div>`; }).join('');
  modal('Cocktail aliases — '+esc(canonical), `
    ${posNamesDatalist()}
    <p class="muted" style="font-size:11.5px;margin-bottom:10px">Recipe = <strong>${rml} ml</strong> · qty pill = that POS name's own sales</p>
    ${directLine}${lines||'<p class="muted">No aliases yet.</p>'}
    <div class="divider" style="margin:10px 0"></div>
    <div class="rline" style="gap:6px;align-items:center"><input class="input" id="newCkAliasName" list="posNames" placeholder="New POS button name (from Sales Analysis)" style="flex:1;font-size:12px;padding:6px 9px">
      <span class="muted" style="font-size:11px">×</span>
      <input class="input" id="newCkAliasX" type="number" step="0.5" min="0" value="1" style="width:56px;padding:6px 6px;font-size:12px;text-align:center" title="serves multiplier"></div>`,
    `<button class="btn" onclick="closeModal()">Close</button>
     <button class="btn btn-gold" onclick='addCkAliasFromEditor(${JSON.stringify(canonical)})'>＋ Add Link</button>`);
}
function updateCkAliasX(alias, val, canonical){
  const a=cocktailAlias.find(x=>norm(x.alias)===norm(alias)); if(!a) return;
  const x=+val;
  if(x>0 && Math.abs(x-1)>0.001) a.x=x; else delete a.x;
  delete a.ml;                                            // legacy field superseded by the manual ×
  bsv('cocktailAlias',cocktailAlias); invalidateCalcCache();
  closeModal(); openCkAliasEditor(canonical);             // refresh the 150 × 2 = 300 pill
  toast('Updated',`"${a.alias}" = ×${x>0?x:1}`,'ok');
}
function addCkAliasFromEditor(canonical){
  const nm=$('#newCkAliasName').value.trim();
  if(!nm){ toast('Enter name','Type a POS button name','err'); return; }
  const x=+($('#newCkAliasX')?$('#newCkAliasX').value:1);
  const e={alias:nm, canonical:canonical}; if(x>0 && Math.abs(x-1)>0.001) e.x=x;
  cocktailAlias.push(e); bsv('cocktailAlias',cocktailAlias); invalidateCalcCache();
  closeModal(); openCkAliasEditor(canonical); route(); toast('Link added',`"${nm}" → ${canonical} (×${x>0?x:1})`,'ok');
}
function openNewCkAlias(){
  modal('New Cocktail Alias — manual link', `
    ${posNamesDatalist()}
    <div class="field"><label>POS button name (exactly as in Petpooja · list from Sales Analysis)</label><input class="input" id="ncaPos" list="posNames" placeholder="e.g. Liit 1:1 (500ml)"></div>
    <div class="field"><label>Counts as cocktail (from Cocktail Master)</label><select class="input" id="ncaCk">${cocktailOptions()}</select></div>
    <p class="muted" style="font-size:11.5px">That POS name's qty will be summed into this cocktail — its recipe then drives brand-wise cocktail ml (Linking, Tally & Bar Inventory update instantly).</p>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="saveNewCkAlias()">Add Link</button>`);
}
function saveNewCkAlias(){
  const pos=$('#ncaPos').value.trim(), ck=$('#ncaCk').value;
  if(!pos){ toast('POS name?','Enter the POS button name','err'); return; }
  if(!ck){ toast('Cocktail?','Create a cocktail in Cocktail Master first','err'); return; }
  cocktailAlias.push({alias:pos, canonical:ck}); bsv('cocktailAlias',cocktailAlias); invalidateCalcCache();
  closeModal(); route(); toast('Link added',`"${pos}" → ${ck}`,'ok');
}
function openNewBrand(){
  modal('New Brand', `
    <div class="form-grid">
      <div class="field"><label>Brand Name</label><input class="input" id="nbName" placeholder="e.g. JAMESON"></div>
      <div class="field"><label>Category</label><select class="input" id="nbCat" onchange="nbDefault()">${CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>ML / unit (peg)</label><input class="input" id="nbMl" type="number" value="30"></div>
      <div class="field"><label>POS alias (optional)</label><input class="input" id="nbAlias" placeholder="POS button name"></div>
    </div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="saveNewBrand()">Create</button>`);
}
function nbDefault(){ const d=CAT_DEFAULTS[$('#nbCat').value]; if(d) $('#nbMl').value=d.peg; }
function saveNewBrand(){
  const nm=$('#nbName').value.trim().toUpperCase(); if(!nm){ toast('Name?','Enter a brand name','err'); return; }
  const cat=$('#nbCat').value, ml=+$('#nbMl').value||30, al=$('#nbAlias').value.trim();
  const d=CAT_DEFAULTS[cat]||{unit:'ml',peg:30};
  tallyItems.push({name:nm, category:cat, posQty:0, unit:d.unit, pegMl:ml, cocktailMl:0, straightMl:0, bogo:0}); bsv('tally',tallyItems);
  if(al){ aliasTable.push({posName:al, tallyItem:nm, mlPerUnit:ml}); bsv('alias',aliasTable); }
  closeModal(); route(); toast('Brand created',`${nm} (${cat})`,'ok');
}

/* ============================================================
   SETTINGS
   ============================================================ */
let setTab = 'company';
function setSetTab(k){ setTab=k; route(); }
VIEWS.settings = () => {
  const editionCards = EDITIONS.map(e=>{ const on=pref.edition===e.id;
    return `<button class="ed-card ${on?'on':''}" onclick="setEdition('${e.id}')" title="${e.desc}">
      <span class="sw" style="background:linear-gradient(135deg,${e.bg} 40%,${e.ac})"></span>
      <span class="lbl"><b>${e.name}</b><i>${e.desc}</i></span></button>`; }).join('');
  const swatches = THEMES.map(t=>`<div class="tsw ${pref.theme===t.id?'on':''}" data-t="${t.id}" title="${t.name}" style="background:linear-gradient(135deg,${t.bg},${t.ac})" onclick="setTheme('${t.id}')"></div>`).join('');
  const fontOpts = FONTS.map(f=>`<option ${pref.font===f?'selected':''}>${f}</option>`).join('');
  const appearName = (EDITIONS.find(e=>e.id===pref.edition)||{}).name || (THEMES.find(t=>t.id===pref.theme)||{}).name || 'Default';
  const auditLog = (function(){ try{ return JSON.parse(localStorage.getItem(CO_PREFIX+'audit')||'[]'); }catch(e){ return []; } })();
  const monthsN = (bls('months',[])).length;

  const SECTIONS = [
    {k:'company', ico:'🏢', t:'Company &amp; Admin', s:esc(coAddress())||'Address not set', body:`
      <div class="flex gap-12 items-center" style="margin-bottom:12px;flex-wrap:wrap">
        <div class="avatar" style="width:52px;height:52px;font-size:17px;border-radius:12px">${cfg.logo?`<img src="${cfg.logo}">`:'🍾'}</div>
        <label class="btn btn-sm" style="cursor:pointer">🏞️ Logo<input type="file" accept="image/*" style="display:none" onchange="uploadLogo(this)"></label>
        <div class="avatar" style="width:52px;height:52px;font-size:17px;margin-left:10px">${cfg.photo?`<img src="${cfg.photo}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`:initials(cfg.admin)}</div>
        <label class="btn btn-sm" style="cursor:pointer">📷 Admin Photo<input type="file" accept="image/*" style="display:none" onchange="uploadPhoto(this)"></label>
      </div>
      <div class="form-grid">
        <div class="field"><label>Company Name</label><input class="input" id="cfgCo" value="${esc(cfg.company)}"></div>
        <div class="field"><label>Subtitle (Bar Control name)</label><input class="input" id="cfgSub" value="${esc(cfg.subtitle||'')}"></div>
        <div class="field full"><label>Address (printed on every report letterhead)</label><input class="input" id="cfgAddr" value="${esc(coAddress())}" placeholder="e.g. 12 Russel Street, Kolkata 700071"></div>
        <div class="field"><label>Admin Name</label><input class="input" id="cfgAdmin" value="${esc(cfg.admin)}"></div>
        <div class="field"><label>Designation (printed on every report)</label><input class="input" id="cfgDesig" value="${esc(cfg.designation!=null?cfg.designation:'F&B Controller')}" placeholder="e.g. F&amp;B Controller"></div>
        <div class="field"><label>Admin Mobile</label><input class="input" id="cfgMobile" value="${esc(cfg.mobile||'')}"></div>
      </div>
      <button class="btn btn-gold btn-sm" onclick="saveCfg()">💾 Save Company &amp; Admin</button>`},

    {k:'appear', ico:'🎨', t:'Appearance', s:esc(appearName), body:`
      <label class="muted" style="font-size:12px">💎 Premium Editions <span style="color:var(--text-dim)">· complete luxury looks</span></label>
      <div class="ed-grid mt-8" style="margin-bottom:18px">${editionCards}</div>
      <label class="muted" style="font-size:12px">Colour Themes <span style="color:var(--text-dim)">· simple palettes</span></label>
      <div class="theme-grid mt-8" style="margin-bottom:16px">${swatches}</div>
      <div class="form-grid">
        <div class="field"><label>Font</label><select class="input" onchange="setFontFam(this.value)">${fontOpts}</select></div>
        <div class="field"><label>Font size — ${pref.fsize}px</label><input class="input" type="range" min="12" max="18" value="${pref.fsize}" oninput="setFontSize(this.value)"></div>
      </div>
      <label class="muted" style="font-size:12px">Clock format</label>
      <div class="tabs mt-8" style="margin-bottom:16px"><div class="tab ${pref.clk12?'active':''}" onclick="setClk(true);route()">12 Hour</div><div class="tab ${!pref.clk12?'active':''}" onclick="setClk(false);route()">24 Hour</div></div>
      <label class="muted" style="font-size:12px">Animations</label>
      <div class="anim-grid mt-8">${ANIMS.map(a=>{ const on=(pref.anims||[]).includes(a.id);
        return `<button class="anim-tog ${on?'on':''}" onclick="toggleAnim('${a.id}')" title="${a.desc}"><span class="dot"></span><span><b>${a.name}</b><i>${a.desc}</i></span></button>`; }).join('')}</div>`},

    {k:'data', ico:'🗺️', t:'System Setup', s:`${tallyItems.length} brands · ${aliasTable.length} aliases · ${cocktails.length} cocktails`, body:`
      <div class="flex between items-center" style="margin-bottom:12px"><p class="muted" style="font-size:11.5px;margin:0">Add once — it flows to every sheet automatically</p>
        <button class="btn btn-gold btn-sm" onclick="sysMapModal()">🗺 System Map</button></div>
      <div class="stat-strip" style="margin-bottom:12px">
        <div class="s"><div class="l">Brands</div><div class="v">${tallyItems.length}</div></div>
        <div class="s"><div class="l">Aliases</div><div class="v">${aliasTable.length}</div></div>
        <div class="s"><div class="l">Cocktails</div><div class="v">${cocktails.length}</div></div>
        <div class="s"><div class="l">POS rows</div><div class="v">${posData.length}</div></div>
      </div>
      <div class="flex gap-8" style="flex-wrap:wrap">
        <button class="btn btn-sm" onclick="mapAddModal()">🏷️ Tally Sheet Data</button>
        <button class="btn btn-sm" onclick="mapRawModal()">🗂 Item Master Data</button>
      </div>
      <div class="divider"></div>
      <div class="flex gap-8" style="flex-wrap:wrap">
        <button class="btn btn-danger btn-sm" onclick="confirmBlank()">🧹 Blank Reset</button>
        <button class="btn btn-sm" onclick="confirmReset()">♻️ Restore demo data</button>
      </div>
      <p class="muted" style="font-size:10.5px;margin-top:8px">Blank = empty system, <strong>formulas stay</strong> · Restore = original demo data · 🗺 System Map shows how every sheet links.</p>`},

    {k:'update', ico:'🔄', t:'System Update', s:`v${APP_VERSION}`, body:`
      <div class="flex between items-center" style="margin-bottom:10px"><p class="muted" style="font-size:11.5px;margin:0">Current version <strong class="gold">v${APP_VERSION}</strong></p>
        <button class="btn btn-gold btn-sm" onclick="checkUpdate()">🔄 Check for Update</button></div>
      <div class="muted" id="updStat" style="font-size:12px;min-height:16px"></div>
      <div class="field mt-8"><label>Update server URL (folder that holds version.json)</label>
        <input class="input" id="updUrl" value="${esc(cfg.updateUrl||'')}" placeholder="https://yourname.github.io/barliquor" onchange="cfg.updateUrl=this.value.trim();bsv('cfg',cfg)"></div>
      <p class="muted" style="font-size:11px;margin-top:6px">Online / Store install: the newest files load automatically — this button confirms it and force-refreshes. Offline zip install: it tells you when a newer version exists so you can get the new files.</p>`},

    {k:'backup', ico:'💾', t:'Backup &amp; Restore', s:'Export, restore, WhatsApp report', body:`
      <p class="muted" style="font-size:11.5px;margin:0 0 10px">One file = everything. Keep a copy outside this computer.</p>
      <div class="flex gap-8" style="flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="backupCompany()">⬇ Backup this company</button>
        <button class="btn btn-sm" onclick="backupAll()">⬇ Backup ALL companies</button>
        <label class="btn btn-sm" style="cursor:pointer">⬆ Restore from file<input type="file" accept=".json" style="display:none" onchange="importBackup(this)"></label>
      </div>
      <div class="field mt-8"><label>WhatsApp number for reports (with country code, e.g. 917001468453)</label>
        <input class="input" value="${esc(cfg.waNumber||'')}" placeholder="91XXXXXXXXXX" onchange="cfg.waNumber=this.value.trim();bsv('cfg',cfg)"></div>`},

    {k:'ai', ico:'🤖', t:'Smart Assistant', s:(()=>{ const c=aiCfg();
        return aiOn()?((c.prov==='anthropic'?'Claude':'ChatGPT')+' · '+esc(aiModel(c))):'Offline answers only'; })(), body:`
      <p class="muted" style="font-size:11.5px;margin:0 0 10px">The assistant already answers offline, free, with no internet.
        A provider key is <strong>optional</strong> — it lets it answer in sentences and understand questions worded freely.</p>
      <div class="field"><label>Answer engine</label>
        <select class="input" id="aiProv">
          <option value="off"${aiCfg().prov&&aiCfg().prov!=='off'?'':' selected'}>Offline only — free, no internet, no key</option>
          <option value="openai"${aiCfg().prov==='openai'?' selected':''}>ChatGPT (OpenAI) — needs your paid key</option>
          <option value="anthropic"${aiCfg().prov==='anthropic'?' selected':''}>Claude (Anthropic) — needs your paid key</option>
        </select></div>
      <div class="field mt-8"><label>API key (stays on this computer)</label>
        <input class="input" id="aiKey" type="password" autocomplete="new-password" placeholder="paste the key here"
          value="${esc(aiCfg().key||'')}" onchange="this.value=cloudClean(this.value)"></div>
      <div class="field mt-8"><label>Model (leave blank for the default)</label>
        <input class="input" id="aiModel" value="${esc(aiCfg().model||'')}"
          placeholder="${esc(AI_DEF[aiCfg().prov]||'gpt-4o-mini / claude-opus-5')}"></div>
      <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="aiSaveForm()">💾 Save</button>
        <button class="btn btn-sm" onclick="aiTest()">🔌 Test the key</button></div>
      <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
        <a class="btn btn-sm" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener"
           title="Claude keys — sign in, then Create Key">🔑 Get a Claude key</a>
        <a class="btn btn-sm" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener"
           title="ChatGPT keys — sign in, then Create new secret key">🔑 Get a ChatGPT key</a></div>
      <details style="margin-top:10px">
        <summary class="gold" style="cursor:pointer;font-size:12px">Where do I get the key? — step by step</summary>
        <div class="muted" style="font-size:11.5px;line-height:1.9;margin-top:8px">
          <strong class="gold">Claude (Anthropic)</strong><br>
          1. Open <b>console.anthropic.com</b> and sign in (or create the account there).<br>
          2. Left menu → <b>API keys</b> → <b>Create Key</b>. Give it any name.<br>
          3. Copy the key — it starts with <b>sk-ant-</b>. It is shown once only.<br>
          4. Billing → add a card and put a small amount of credit in, or the key answers nothing.<br>
          5. Paste it above, pick <b>Claude (Anthropic)</b>, press Save, then Test.<br><br>
          <strong class="gold">ChatGPT (OpenAI)</strong><br>
          1. Open <b>platform.openai.com/api-keys</b> and sign in.<br>
          2. <b>Create new secret key</b> → copy it — it starts with <b>sk-</b>.<br>
          3. Billing → add credit, same as above.<br>
          4. Paste it, pick <b>ChatGPT (OpenAI)</b>, Save, Test.<br><br>
          <strong class="gold">This is not the cloud key.</strong> The Supabase key that syncs your data lives in
          Settings → <b>Cloud Sync</b> and is a different thing — one key does not work in the other's box.
        </div></details>
      <div class="muted" id="aiStat" style="font-size:12px;min-height:16px;margin-top:8px"></div>
      <div class="field mt-8"><label>Voice</label>
        <label class="muted" style="font-size:12px;display:flex;gap:8px;align-items:center;cursor:pointer">
          <input type="checkbox" ${pref.asstSpeak?'checked':''} onchange="pref.asstSpeak=this.checked;bsv('pref',pref)">
          Read the answer out loud (works without internet)</label>
        <select class="input mt-8" onchange="pref.asstLang=this.value;bsv('pref',pref)">
          <option value="en-US"${pref.asstLang==='bn-IN'?'':' selected'}>Speak &amp; listen in English</option>
          <option value="bn-IN"${pref.asstLang==='bn-IN'?' selected':''}>বাংলা — Bengali</option>
        </select></div>
      <p class="muted" style="font-size:11px;margin-top:10px;line-height:1.75">
        <strong class="gold">Read this before turning it on.</strong><br>
        • The key is <strong>yours and paid</strong> — the provider bills you for every question.<br>
        • With AI on, a <strong>short summary of your figures</strong> (totals, top brands, low stock, the item you asked about)
          is sent to ${'OpenAI or Anthropic'}. Your full database is never sent. Offline mode sends nothing at all.<br>
        • The key is stored only on this computer. It is left out of backups and never pushed to the cloud.<br>
        • Anyone who can open this computer's browser tools can read the key — do not use it on a shared machine.<br>
        • No internet, key refused, or provider down → the assistant quietly answers offline instead.</p>`},

    {k:'cloud', ico:'☁️', t:'Cloud Sync', s:cloudOn()?'Connected':'Not connected', body:`
      <div class="flex between items-center" style="margin-bottom:10px"><p class="muted" style="font-size:11.5px;margin:0">${cloudOn()?'Cloud connected — this company syncs its own copy':'Optional — a free Supabase account keeps a live cloud copy'}</p>
        <div class="flex gap-8">
          <a class="btn btn-sm" href="cloud-setup.html" target="_blank" rel="noopener" title="Opens the one-click setup page — it fills in the URL and key for you">🩹 Fix / Set up</a>
          <a class="btn btn-sm" target="_blank" rel="noopener" title="Opens your own Supabase project's API-keys page"
             href="${(function(){ const u=(cloudCfg().url||'').trim();
               const m=u.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
               return m ? ('https://supabase.com/dashboard/project/'+m[1]+'/settings/api-keys')
                        : 'https://supabase.com/dashboard/projects'; })()}">🔑 Where is my cloud key</a>
          <button class="btn btn-sm" onclick="cloudTest()">🔍 Test</button></div></div>
      <div class="muted" id="cldStat" style="font-size:12px;min-height:16px">${(function(){
        const kp=cloudOn()?cloudKeyProblem(cloudCfg().key):'';
        if(kp) return '❌ The saved key is not usable — '+esc(kp)+'. Clear the API-key box below and paste the whole key again.';
        const m=_cloudMeta(); return m.push?('Last push from this device: '+esc(new Date(m.push).toLocaleString())):'Never pushed from this device.'; })()}</div>
      <div class="form-grid mt-8">
        <div class="field"><label>Cloud project URL (Supabase)</label>
          <input class="input" value="${esc(cloudCfg().url||'')}" placeholder="https://xxxx.supabase.co" onchange="var c=cloudCfg();c.url=cloudClean(this.value);cloudSave(c);this.value=c.url;route()"></div>
        <div class="field"><label>API key (anon public)</label>
          <input class="input" type="password" value="${esc(cloudCfg().key||'')}" placeholder="eyJhbGciOi..." onchange="var c=cloudCfg();c.key=cloudClean(this.value);cloudSave(c);this.value=c.key;route()"></div>
      </div>
      ${cloudSignedIn()
        ? `<div class="flex gap-8 mt-8" style="flex-wrap:wrap;align-items:center;padding:8px 10px;border:1px solid var(--green);border-radius:9px;background:rgba(63,178,127,.07)">
             <span style="font-size:12px">🔓 Signed in as <strong>${esc(cloudSess().email)}</strong> — Push is allowed</span>
             <span style="flex:1"></span>
             <button class="btn btn-sm" onclick="cloudSignOut()">Sign out</button>
           </div>`
        : `<div class="mt-8" style="padding:9px 11px;border:1px solid var(--gold-dim);border-radius:9px">
             <p class="muted" style="font-size:11.5px;margin:0 0 7px">🔒 <strong>Sign in to allow Push.</strong> Reading is open, but saving to the cloud needs the email &amp; password you created in Supabase → Authentication → Users.</p>
             <div class="flex gap-8" style="flex-wrap:wrap;align-items:center">
               <input class="input" id="cldEmail" type="email" placeholder="email" style="flex:1;min-width:140px" autocomplete="username">
               <input class="input" id="cldPass" type="password" placeholder="password" style="flex:1;min-width:120px" autocomplete="current-password"
                 onkeydown="if(event.key==='Enter')cloudLogin()">
               <button class="btn btn-gold btn-sm" onclick="cloudLogin()">🔑 Sign in</button>
             </div>
           </div>`}
      <div class="flex gap-8 mt-8" style="flex-wrap:wrap;align-items:center">
        <button class="btn btn-gold btn-sm" onclick="cloudPush()">⬆ Push now</button>
        <button class="btn btn-sm" onclick="cloudPull()">⬇ Pull from cloud</button>
        <a class="btn btn-sm" href="backend.html" target="_blank" rel="noopener" title="Data entry console — sign in with your Supabase email &amp; password">⚙ Backend Console</a>
        <label style="font-size:12px;display:flex;gap:6px;align-items:center;cursor:pointer">
          <input type="checkbox" ${cloudCfg().auto?'checked':''} onchange="var c=cloudCfg();c.auto=this.checked;cloudSave(c)"> Auto-push (1 min after any change)</label>
      </div>
      <details style="margin-top:10px"><summary class="muted" style="font-size:11.5px;cursor:pointer">One-time setup (free) — how to get the URL &amp; key</summary>
        <div class="muted" style="font-size:11.5px;line-height:1.8;margin-top:6px">
          1 · Create a free project at <strong>supabase.com</strong> → Project Settings → API → copy the <strong>Project URL</strong> and the <strong>anon public</strong> key.<br>
          2 · In Supabase → SQL Editor, run this once:<br>
          <code style="display:block;white-space:pre;overflow-x:auto;background:rgba(0,0,0,.25);padding:8px;border-radius:8px;font-size:10.5px;margin:6px 0">create table if not exists blis_sync (
  id text primary key, co text,
  data jsonb, updated_at timestamptz);
alter table blis_sync enable row level security;
create policy "blis anon" on blis_sync
  for all using (true) with check (true);</code>
          3 · Paste the URL + key above → <strong>🔍 Test</strong> → <strong>⬆ Push now</strong>.<br>
          🖥️ New device: install the app, paste the same URL + key, press <strong>⬇ Pull</strong> — everything comes back. Each company syncs separately (switch company, then Push/Pull).<br>
          ⚠️ Anyone holding this key can read the data — share it only inside your team.
        </div>
      </details>`},

    {k:'month', ico:'📅', t:'Month Close', s:`${monthsN} closed month${monthsN===1?'':'s'}`, body:`
      <div class="flex between items-center" style="margin-bottom:10px"><p class="muted" style="font-size:11.5px;margin:0">${monthsN} closed month${monthsN===1?'':'s'} archived</p>
        <div class="flex gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" onclick="closingReports()">📊 Closing Reports</button><button class="btn btn-sm" onclick="openMonths()">🗂 History</button><button class="btn btn-gold btn-sm" onclick="monthClose()">📅 Close this month</button></div></div>
      <p class="muted" style="font-size:11.5px">Close = snapshot this period into history, carry Closing → Opening, clear the month — and the <strong>closing report bundle</strong> (Beverage Control · Liquor Room · Purchase · Bar Stock Issue) downloads as Excel / CSV / PDF, now or later from 🗂 History.</p>`},

    {k:'users', ico:'👥', t:'Users &amp; Roles', s:`${users.length} user${users.length===1?'':'s'}`, body:`
      <p class="muted" style="font-size:11.5px;margin:0 0 10px">${users.length} user${users.length===1?'':'s'} · login from the login page</p>
      ${users.map((u,i)=>`<div class="flex between items-center" style="padding:6px 0;border-bottom:1px solid var(--border-soft);gap:8px">
        <span style="font-size:12.5px"><strong>${esc(u.u)}</strong> <span class="pill ${u.role==='admin'?'green':(u.role==='manager'?'amber':'gray')}" style="font-size:10px">${esc(u.role)}</span></span>
        <button class="btn btn-danger btn-sm" onclick="userDel(${i})">✕</button></div>`).join('')||'<p class="muted" style="font-size:12px">No extra users — only the main admin login works.</p>'}
      <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
        <input class="input" id="usrU" placeholder="Username" style="flex:1;min-width:110px">
        <input class="input" id="usrP" placeholder="Password" style="flex:1;min-width:110px">
        <select class="input" id="usrR" style="width:auto"><option value="staff">staff</option><option value="manager">manager</option><option value="admin">admin</option></select>
        <button class="btn btn-gold btn-sm" onclick="userAdd()">＋ Add</button>
      </div>
      <p class="muted" style="font-size:10.5px;margin-top:6px">staff = no Settings, no delete buttons · manager = no Settings · admin = everything</p>`},

    {k:'audit', ico:'📝', t:'Audit Log', s:auditLog.length?(esc(auditLog[0].t)):'No changes yet', body:`
      <div class="flex between items-center" style="margin-bottom:8px"><p class="muted" style="font-size:11.5px;margin:0">who changed what, when (last 300)</p>
        <button class="btn btn-danger btn-sm" onclick="confirmAsk('Clear the audit log?',()=>{ localStorage.removeItem(CO_PREFIX+'audit'); route(); })">🗑 Clear</button></div>
      <div style="max-height:340px;overflow:auto;font-size:11.5px;line-height:1.9">
        ${auditLog.slice(0,100).map(e=>`<div style="border-bottom:1px solid var(--border-soft)"><span class="muted">${esc(e.t)}</span> · <strong>${esc(e.u)}</strong> changed <span class="gold">${esc(e.k)}</span></div>`).join('')||'<span class="muted">No changes recorded yet.</span>'}
      </div>`},
  ];

  const active = SECTIONS.find(s=>s.k===setTab) || SECTIONS[0];
  const rail = SECTIONS.map(s=>`<button class="sl-item ${s.k===active.k?'on':''}" onclick="setSetTab('${s.k}')">
      <span class="sl-ic">${s.ico}</span><span class="sl-txt"><b>${s.t}</b><span>${s.s}</span></span></button>`).join('');

  return `
  <div class="setcompact setroyal">
  <div class="page-head royalhead"><div><h1>⚜️ Settings</h1><p>Royal control room — profile · appearance · data &amp; operations</p></div></div>
  <div class="setledger">
    <div class="sl-rail">${rail}</div>
    <div class="sl-pane">
      <div class="sl-pane-head"><span class="sl-pane-ic">${active.ico}</span><div><h3>${active.t}</h3><p>${active.s}</p></div></div>
      <div class="sl-pane-body">${active.body}</div>
    </div>
  </div>
  </div>`;
};
/* ---------- System Mapping modals (Settings 🗺️ — the old Data-In card, now on demand) ---------- */
function mapAddModal(){
  const catOpts=CATEGORIES.map(c=>`<option>${c}</option>`).join('');
  modal('🏷️ Tally Sheet Data — flows to every sheet', `
    <label class="muted" style="font-size:11.5px">① Manual — one name per line (peg auto: liquor 30ml · beer 1pcs · wine 150ml)</label>
    <div class="form-grid mt-8">
      <div class="field"><label>Category</label><select class="input" id="caCat" onchange="caDefault()">${catOpts}</select></div>
      <div class="field"><label>ML / unit</label><input class="input" id="caMl" type="number" value="30"></div>
    </div>
    <div class="field"><label>Brand name(s)</label><textarea class="input" id="caNames" style="height:88px;font-family:monospace" placeholder="JAMESON&#10;MONKEY SHOULDER"></textarea></div>
    <div class="divider"></div>
    <label class="muted" style="font-size:11.5px">② Excel / CSV — columns: <strong>Name</strong> (required) · <strong>Category</strong> · <strong>ML</strong></label><br>
    <label class="btn btn-sm mt-8" style="cursor:pointer">📂 Choose Excel / CSV<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="uploadSystemNames(this)"></label>`,
    `<button class="btn" onclick="closeModal()">Close</button><button class="btn btn-gold" onclick="caAdd()">＋ Add to Tally</button>`);
}
function mapRawModal(){
  modal('🗂 Item Master Data — Inventory master', `
    <p class="muted" style="font-size:11.5px">Two columns: <code>GROUP</code> + <code>ITEM DESCRIPTION</code> (Tab / comma separated). Added items auto-match in <strong>Liquor Room · Bar Stock Issue · Purchase</strong>.</p>
    <textarea class="input" id="rdPaste" style="height:92px;font-family:monospace;font-size:11px;margin-top:8px" placeholder="BREEEZER 275 ML&#9;BACARDI BREEZER CRANBERRY&#10;DRAUGHT BEER 50&#9;KINGFISHER DRAUGHT BEER - 50000 ML"></textarea>
    <label class="btn btn-sm mt-8" style="cursor:pointer">📂 Excel / CSV (GROUP · ITEM)<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="uploadRawItems(this)"></label>`,
    `<button class="btn" onclick="closeModal()">Close</button><button class="btn btn-gold" onclick="rawPasteAdd()">＋ Add to Item Master</button>`);
}
function sysMapModal(){
  const step=(ico,title,desc)=>`<div class="smstep"><div class="ic">${ico}</div><div><b>${title}</b><span>${desc}</span></div></div>`;
  modal('🗺 System Map — how data flows', `
   <div class="sysmap">
    ${step('📥','1 · POS Upload','Upload / paste the POS (Petpooja) sales export — every calculation in the system starts from these rows.')}
    <div class="smarrow">▼</div>
    ${step('🔍','2 · Sales Analysis','Each POS row finds its brand (Liquor Alias ×N) or cocktail (Cocktail Alias). No match → ⚠️ Error Queue — resolve once, remembered forever.')}
    <div class="smarrow">▼</div>
    ${step('🏷️','3 · Tally Sheet','Brand-wise Cocktail + Straight ml. Cocktail recipes auto-appear in the Qty-Sold list with name &amp; qty. Add a brand once — it flows to Beverage Control · Linking · everywhere.')}
    <div class="smarrow">▼</div>
    ${step('🍾','4 · Inventory','Item Master feeds Liquor Room · Bar Stock Issue · Purchase (🧾 BEVCO invoice sets Landing ₹). Beverage Control: Opening + Receipt − Closing = Consumption; − Sale = Variance.')}
    <div class="smarrow">▼</div>
    ${step('📊','5 · All Reports & Month Close','All Reports page = Excel / CSV / Print-PDF. Month Close = snapshot → history, Closing → Opening carry, closing report bundle.')}
   </div>
   <div class="muted" style="font-size:11px;margin-top:10px;line-height:1.7">✍️ Names always normalise to <strong>UPPERCASE</strong> — <code>Blender's Pride.</code> → <code>BLENDERS PRIDE</code>. Alias mapping is the ONLY manual step, and only when a brand-new POS name appears.</div>`,
    `<button class="btn btn-gold" onclick="closeModal()">Got it</button>`);
}
function userAdd(){
  const u=$('#usrU').value.trim(), p=$('#usrP').value, r=$('#usrR').value;
  if(!u||!p){ toast('Missing','Enter username and password','err'); return; }
  if(users.some(x=>x.u.toLowerCase()===u.toLowerCase())){ toast('Exists','That username is taken','err'); return; }
  users.push({u:u,p:p,role:r}); bsv('users',users); route(); toast('User added',u+' · '+r,'ok');
}
function userDel(i){ const u=users[i]; if(!u) return;
  confirmAsk('Remove user "<strong>'+esc(u.u)+'</strong>"?', ()=>{ users.splice(i,1); bsv('users',users); route(); toast('Removed',u.u,'err'); }); }
/* ---------- System Update: compare version.json on the update server ---------- */
async function checkUpdate(){
  const s=$('#updStat'); const base=(cfg.updateUrl||'').replace(/\/+$/,'');
  if(!base){ if(s) s.textContent='Set the update server URL below first (your hosted app folder).'; return; }
  if(s) s.textContent='Checking…';
  try{
    const r=await fetch(base+'/version.json?t='+Date.now(),{cache:'no-store'});
    const j=await r.json();
    if(j && j.version && j.version!==APP_VERSION){
      if(s) s.innerHTML='New version <strong class="gold">v'+esc(j.version)+'</strong> available!';
      modal('🔄 Update available',
        `<p>Version <strong>v${esc(j.version)}</strong> is available — you have v${APP_VERSION}.</p>
         <p class="muted" style="font-size:12px;margin-top:6px">${esc(j.notes||'')}</p>`,
        `<button class="btn" onclick="closeModal()">Later</button><button class="btn btn-gold" onclick="applyUpdate()">⬇ Update now</button>`);
    } else if(j && j.version){ if(s) s.textContent='You are on the latest version (v'+APP_VERSION+').'; }
    else { if(s) s.textContent='version.json not readable on that URL.'; }
  }catch(e){ if(s) s.textContent='Could not reach the update server — check the URL / internet.'; }
}
async function applyUpdate(){
  closeModal();
  try{ if('caches' in window){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); } }catch(e){}
  try{ if(navigator.serviceWorker){ const rs=await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r=>r.update())); } }catch(e){}
  toast('Updating','Reloading with the newest files…','ok');
  setTimeout(()=>location.reload(true),400);
}
/* ---------- Help content (English + Bangla) ---------- */
let helpLang = bls('helplang','en');
function setHelpLang(l){ helpLang=l; bsv('helplang',l); route(); }
const HELP_EN=[
 ['📊 Dashboard','Beer & draught totals, %-wise pie charts, straight liquor category-wise, cocktail sales with amounts, Top-15 High/Low, liquor-room closing stock value and item-wise variance.'],
 ['📥 POS Upload','Upload or paste the POS (Petpooja) sales export — Excel/CSV. Every calculation in the system starts from these rows.'],
 ['🔍 Sales Analysis','Each POS row is matched to a brand or a cocktail. Unmatched rows go to the Error Queue.'],
 ['🧾 Tally Sheet','Excel-faithful brand sheet: Cocktail ml + Straight ml = Total per brand, plus the full Qty-Sold list.'],
 ['🍹 Cocktail Master','Recipes (spirit + ml per serve). Recipe × qty sold = cocktail consumption per spirit.'],
 ['🔗 Linking Sheet (Smart Mapping Center)','Brand-wise DSR — cocktail ml + straight ml linked exactly like the Excel VLOOKUP chain.'],
 ['⚠️ Error Queue (Smart Mapping Center)','POS names that match nothing yet. Resolve each one to a brand or cocktail once — it is remembered.'],
 ['🔀 Liquor / Cocktail Alias (Smart Mapping Center)','POS button name → brand/cocktail mappings, with ×N multipliers for offers (1+1, double serve).'],
 ['🗂️ Item Master','Inventory item master (GROUP + ITEM + MRP). Receipts everywhere match THESE names; MRP set here flows to every page.'],
 ['📦 Purchase','Purchases into the liquor room. Excel upload auto-reads Date · Item · Qty; 🧾 BEVCO invoice sets Landing ₹ automatically.'],
 ['🔁 Bar Stock Issue','Dated issues from liquor room → bar. Search an item, type the qty, press Enter — or import from Excel / paste / photo. Receipt in Beverage Control = these issues within the period.'],
 ['🏬 Liquor Room','Opening + Received − Issued = Closing, with ₹ value and group totals.'],
 ['🍾 Beverage Control','The main bar sheet: Opening + Receipt − Closing = Consumption; Consumption − Sale = Variance — in qty and ₹. Search & Add any item; full-page clones from 📑 Page Clone.'],
 ['📑 All Reports','9 professional reports with %-wise pies. Print gives the complete clean report — every row, no browser junk.'],
 ['🏢 Companies','🏢 in the top bar (or the login page) — switch or add companies. Each company keeps fully separate data; formulas are shared.'],
 ['☁️ Cloud Sync','Optional free cloud copy (Supabase). Settings → Cloud Sync: Push saves this company to the cloud, Pull loads it on any device, Auto-push saves 1 min after every change.'],
 ['⌨️ Keyboard','Arrow keys ↑↓←→ move cell-to-cell like Excel. Numeric cells accept sums like 12+12. bottle.loose: 2.35 = 2 bottles + 350 ml.'],
];
const HELP_BN=[
 ['📊 Dashboard','বিয়ার ও ড্রট মোট, %-ওয়াইজ পাই চার্ট, স্ট্রেট liquor category-ওয়াইজ, cocktail বিক্রি (টাকা সহ), Top-15 High/Low, liquor room-এর closing stock মূল্য আর item-ওয়াইজ variance।'],
 ['📥 POS Upload','POS (Petpooja)-র sales export আপলোড/পেস্ট করুন — Excel/CSV। সিস্টেমের সব হিসাব এই সারিগুলো থেকেই শুরু।'],
 ['🔍 Sales Analysis','প্রতিটা POS সারি কোনো brand বা cocktail-এর সাথে মেলানো হয়। না মিললে Error Queue-তে যায়।'],
 ['🧾 Tally Sheet','Excel-এর মতো brand শীট: Cocktail ml + Straight ml = প্রতি brand-এর Total, সাথে পুরো Qty-Sold তালিকা।'],
 ['🍹 Cocktail Master','রেসিপি (spirit + প্রতি serve-এর ml)। রেসিপি × বিক্রির qty = প্রতি spirit-এর cocktail consumption।'],
 ['🔗 Linking Sheet (Smart Mapping Center)','Brand-ওয়াইজ DSR — Excel-এর VLOOKUP চেইনের মতোই cocktail ml + straight ml যুক্ত।'],
 ['⚠️ Error Queue (Smart Mapping Center)','যে POS নাম কিছুর সাথে মেলেনি। একবার brand বা cocktail-এ resolve করুন — চিরকাল মনে থাকবে।'],
 ['🔀 Liquor / Cocktail Alias (Smart Mapping Center)','POS বোতামের নাম → brand/cocktail ম্যাপিং, offer-এর জন্য ×N multiplier (1+1, ডবল serve)।'],
 ['🗂️ Item Master','Inventory item master (GROUP + ITEM + MRP)। সব জায়গার receipt এই নামের সাথেই মেলে; এখানে MRP বসালে সব পেজে যায়।'],
 ['📦 Purchase','Liquor room-এ কেনা মাল। Excel আপলোডে Date · Item · Qty নিজে থেকে পড়ে; 🧾 BEVCO invoice দিলে Landing ₹ নিজে থেকেই বসে যায়।'],
 ['🔁 Bar Stock Issue','Liquor room → bar-এ তারিখসহ issue। item সার্চ করে qty লিখে Enter — অথবা Excel / পেস্ট / ফটো থেকে import। Beverage Control-এর Receipt = period-এর মধ্যের এই issue-গুলো।'],
 ['🏬 Liquor Room','Opening + Received − Issued = Closing, ₹ মূল্য আর group-ওয়াইজ মোট সহ।'],
 ['🍾 Beverage Control','মূল বার শীট: Opening + Receipt − Closing = Consumption; Consumption − Sale = Variance — qty আর ₹ দুটোতেই। Search & Add দিয়ে যেকোনো item; 📑 Page Clone দিয়ে পুরো পেজের কপি।'],
 ['📑 All Reports','%-ওয়াইজ পাই সহ ৯টা professional report। Print করলে সম্পূর্ণ পরিষ্কার report — সব সারি, browser-এর আবর্জনা ছাড়া।'],
 ['🏢 Companies','উপরের বারে 🏢 (বা login পেজে) — company বদল/যোগ। প্রতিটা company-র ডেটা সম্পূর্ণ আলাদা; formula সবার এক।'],
 ['☁️ Cloud Sync','ঐচ্ছিক ফ্রি ক্লাউড কপি (Supabase)। Settings → Cloud Sync: Push = এই company ক্লাউডে সেভ, Pull = যেকোনো device-এ ফিরিয়ে আনা, Auto-push = প্রতিটা বদলের ১ মিনিট পরে নিজে থেকেই সেভ।'],
 ['⌨️ Keyboard','Excel-এর মতো ↑↓←→ দিয়ে ঘরে ঘরে চলাফেরা। সংখ্যার ঘরে 12+12 লেখা যায়। bottle.loose: 2.35 = 2 বোতল + 350 ml।'],
];
function savePeriod(){ period={from:$('#setFrom').value, to:$('#setTo').value}; bsv('period',period); route(); toast('Saved','Period updated','ok'); }
function caDefault(){ const d=CAT_DEFAULTS[$('#caCat').value]; if(d) $('#caMl').value=d.peg; }
function caAdd(){
  const cat=$('#caCat').value, ml=+$('#caMl').value||30; const d=CAT_DEFAULTS[cat]||{unit:'ml',peg:30};
  const names=$('#caNames').value.split(/\r?\n/).map(s=>s.trim().toUpperCase()).filter(Boolean);
  if(!names.length){ toast('Names?','Enter at least one brand','err'); return; }
  let added=0; names.forEach(nm=>{ if(getTallyItem(nm)) return; tallyItems.push({name:nm, category:cat, posQty:0, unit:d.unit, pegMl:ml, cocktailMl:0, straightMl:0, bogo:0}); added++; });
  bsv('tally',tallyItems); route(); toast('Added',`${added} brand(s) added to Tally Sheet (${cat})`,'ok');
}
function confirmReset(){
  modal('Restore demo data?', `<p>This wipes current data and restores the <strong>original demo</strong> brands, aliases, cocktails & POS rows. This cannot be undone.</p>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" style="background:var(--red);color:#fff" onclick="resetData()">Yes, restore demo</button>`);
}
function confirmBlank(){
  confirmAsk(`Wipe <strong>ALL data</strong> — brands, aliases, cocktails, POS rows, Item Master, Purchase, Bar Stock Issue & inventory figures? The system becomes empty; <strong>formulas & calculations stay exactly the same</strong>. You then add new names and map aliases manually.`, resetBlank);
}
function resetBlank(){
  ['tally','alias','cocktails','cocktailAlias','pos','namemap','rawdata2','recv','mr','inv'].forEach(k=>localStorage.removeItem(CO_PREFIX+k));
  tallyItems=[]; aliasTable=[]; cocktails=[]; cocktailAlias=[]; posData=[]; nameMapList=[];
  if(typeof rawData!=='undefined') rawData.length=0;
  if(typeof receivedStock!=='undefined') receivedStock.length=0;
  if(typeof mrDetail!=='undefined') mrDetail.length=0;
  if(typeof invData!=='undefined') Object.keys(invData).forEach(k=>delete invData[k]);
  rebuildIndexes(); rebuildCocktailAliasIndex(); invalidateCalcCache(); route();
  toast('Blank system','All data cleared — formulas intact. Add names, then map aliases.','ok');
}
function resetData(){
  ['tally','alias','cocktails','cocktailAlias','pos','namemap'].forEach(k=>localStorage.removeItem(CO_PREFIX+k));
  tallyItems=SEED_TALLY.map(t=>({...t})); aliasTable=SEED_ALIAS.map(a=>({...a})); cocktails=SEED_CKS.map(c=>({...c, recipe:(c.recipe||[]).map(x=>({...x}))}));
  cocktailAlias=SEED_CKAL.map(c=>({...c})); posData=DEFAULT_POS.map(p=>({...p})); nameMapList=[];
  rebuildIndexes(); rebuildCocktailAliasIndex(); invalidateCalcCache(); closeModal(); route(); toast('Reset','All data restored to original','ok');
}
function readImg(inp, cb){ const f=inp.files[0]; if(!f) return; if(f.size>3*1024*1024){ toast('Too big','Max 3 MB image','err'); return; }
  const r=new FileReader(); r.onload=e=>cb(e.target.result); r.readAsDataURL(f); }
function uploadPhoto(inp){ readImg(inp, d=>{ cfg.photo=d; bsv('cfg',cfg); renderShell(); startClock(); route(); toast('Photo updated','Admin photo saved','ok'); }); }
function uploadLogo(inp){ readImg(inp, d=>{ cfg.logo=d; bsv('cfg',cfg); renderShell(); startClock(); route(); toast('Logo updated','Company logo saved','ok'); }); }
function saveCfg(){ cfg.company=$('#cfgCo').value.trim()||cfg.company; cfg.subtitle=$('#cfgSub')?$('#cfgSub').value.trim():cfg.subtitle;
  if($('#cfgAddr')) cfg.address=$('#cfgAddr').value.trim(); cfg.admin=$('#cfgAdmin').value.trim()||cfg.admin; cfg.mobile=$('#cfgMobile').value.trim()||cfg.mobile;
  if($('#cfgDesig')) cfg.designation=$('#cfgDesig').value.trim();   // '' allowed = hide the line
  bsv('cfg',cfg); renderShell(); startClock(); route(); toast('Saved','Company & admin updated','ok'); }
/* Raw Data intake (GROUP + ITEM DESCRIPTION — the inventory master's own style) */
function rawPasteAdd(){
  if(typeof rawData==='undefined'){ toast('Not ready','Reload the page','err'); return; }
  const txt=$('#rdPaste').value; if(!txt.trim()){ toast('Empty','Paste GROUP + ITEM lines first','err'); return; }
  let added=0, skip=0;
  txt.split(/\r?\n/).forEach(line=>{
    const s=line.trim(); if(!s||/^GROUP\b/i.test(s)) return;
    let parts=s.split('\t'); if(parts.length<2) parts=s.split(/\s{2,}/);
    if(parts.length<2){ const i=s.indexOf(','); if(i>0) parts=[s.slice(0,i), s.slice(i+1)]; }
    if(parts.length<2){ skip++; return; }
    const group=parts[0].trim().toUpperCase(), item=parts.slice(1).join(' ').trim().toUpperCase();
    if(!item||inRaw(item)){ skip++; return; }
    rawData.push({item, group}); added++;
  });
  saveRaw(); if($('#rdPaste')) $('#rdPaste').value=''; route();
  toast('Item Master', `${added} item(s) added${skip?' · '+skip+' skipped (dup/format)':''}`, added?'ok':'err');
}
function uploadRawItems(inp){
  const f=inp.files[0]; if(!f) return;
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page','err'); return; }
  if(typeof rawData==='undefined'){ toast('Not ready','Reload the page','err'); return; }
  const reader=new FileReader();
  reader.onload=e=>{ try{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
    const grid=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,blankrows:false});
    let hr=-1, cg=0, ci=1;
    for(let r=0;r<Math.min(grid.length,15);r++){ const row=(grid[r]||[]).map(x=>norm(x));
      const g=row.findIndex(x=>/GROUP/.test(x)); const it=row.findIndex(x=>/(ITEM|DESCRIPTION|NAME)/.test(x));
      if(g>=0&&it>=0){ hr=r; cg=g; ci=it; break; } }
    let added=0, skip=0;
    for(let r=hr+1;r<grid.length;r++){ const row=grid[r]||[];
      const group=String(row[cg]==null?'':row[cg]).trim().toUpperCase();
      const item=String(row[ci]==null?'':row[ci]).trim().toUpperCase();
      if(!item) continue;
      if(inRaw(item)){ skip++; continue; }
      rawData.push({item, group}); added++; }
    saveRaw(); route(); toast('Item Master', `${added} item(s) added${skip?' · '+skip+' duplicate':''}`, added?'ok':'err');
  }catch(err){ toast('Failed','Could not read the file','err'); } };
  reader.readAsArrayBuffer(f); inp.value='';
}
function uploadSystemNames(inp){
  const f=inp.files[0]; if(!f) return;
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page (xlsx.full.min.js)','err'); return; }
  const reader=new FileReader();
  reader.onload=e=>{ try{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
    const grid=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,blankrows:false});
    let hdr=-1, ci=0, cc=-1, cm=-1;
    for(let r=0;r<Math.min(grid.length,15);r++){ const row=(grid[r]||[]).map(x=>norm(x));
      const iN=row.findIndex(x=>/(NAME|BRAND|ITEM|DESCRIPTION)/.test(x));
      if(iN>-1){ hdr=r; ci=iN; cc=row.findIndex(x=>/(CATEGORY|GROUP)/.test(x)); cm=row.findIndex(x=>/(ML|PEG|UNIT)/.test(x)); break; } }
    let added=0; const start=hdr>-1?hdr+1:0;
    for(let r=start;r<grid.length;r++){ const row=grid[r]||[]; const nm=(row[ci]??'').toString().trim().toUpperCase(); if(!nm) continue;
      if(getTallyItem(nm)) continue;
      let cat = cc>-1?(row[cc]??'').toString().trim().toUpperCase():''; if(!CATEGORIES.includes(cat)) cat='WHISKY';
      const d=CAT_DEFAULTS[cat]||{unit:'ml',peg:30};
      let ml = cm>-1?parseFloat((row[cm]??'').toString().replace(/[^\d.]/g,'')):0; if(!ml||isNaN(ml)) ml=d.peg;
      tallyItems.push({name:nm, category:cat, posQty:0, unit:d.unit, pegMl:ml, cocktailMl:0, straightMl:0, bogo:0}); added++; }
    bsv('tally',tallyItems); inp.value=''; route(); toast('Imported',`${added} system name(s) added to Tally Sheet`,'ok');
  }catch(err){ toast('Failed', String(err.message||err),'err'); } };
  reader.readAsArrayBuffer(f);
}

/* ============================================================
   MODAL + TOAST
   ============================================================ */
function modal(title, body, foot){
  const back=document.createElement('div'); back.className='modal-back'; back.id='modalBack';
  back.innerHTML=`<div class="modal ${body.length>900?'wide':''}"><div class="modal-head"><h3>${title}</h3><button class="x" onclick="closeModal()">×</button></div><div class="modal-body">${body}</div><div class="modal-foot">${foot}</div></div>`;
  back.onclick=e=>{ if(e.target===back) closeModal(); };
  document.body.appendChild(back);
}
function closeModal(){ const ms=$$('.modal-back'); if(ms.length) ms[ms.length-1].remove(); }   // close the topmost (supports stacked confirm)
// reusable "Are you sure?" confirm popup — used by every delete across the app
let _confirmCb=null;
function confirmAsk(msg, cb){ _confirmCb=cb;
  modal('⚠️ Are you sure?', `<p style="font-size:13.5px;line-height:1.6">${msg}</p>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" style="background:var(--red);color:#fff" onclick="confirmYes()">Yes, delete</button>`); }
function confirmYes(){ const cb=_confirmCb; _confirmCb=null; closeModal(); if(typeof cb==='function') cb(); }
function toast(title, desc, kind){
  let wrap=$('#toastWrap'); if(!wrap){ wrap=document.createElement('div'); wrap.id='toastWrap'; wrap.className='toast-wrap'; document.body.appendChild(wrap); }
  const ico=kind==='ok'?'✅':kind==='err'?'⛔':'ℹ️';
  const t=document.createElement('div'); t.className=`toast ${kind||''}`;
  t.innerHTML=`<div class="ti">${ico}</div><div><div class="tt">${title}</div><div class="td">${desc||''}</div></div>`;
  wrap.appendChild(t); setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(20px)'; setTimeout(()=>t.remove(),200); }, 2600);
}

document.addEventListener('DOMContentLoaded', boot);
