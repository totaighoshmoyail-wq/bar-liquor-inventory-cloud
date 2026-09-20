/* ============================================================
   Traffic Gastropub — Module 2: Liquor Inventory (File 2)
   Own master = RAW DATA (group + full item name, from REAL_ITEMS).
   Liquor Room / MR Detail / Received Stock all match Raw Data by name;
   a name missing from Raw Data shows the SAME red signal in all three.
   Reuses bartie globals: norm, tallyItems, calcGrandTotals,
   getEffectiveCocktailMl/StraightMl, modal, toast, route, fmt, esc,
   bls, bsv, $, $$, XLSX, period, VIEWS.
   ============================================================ */

/* ---------------- master + state ---------------- */
const _seedRaw = ((typeof CO_IS_CANTEEN!=='undefined' && CO_IS_CANTEEN && typeof CANTEEN_RAW!=='undefined') ? CANTEEN_RAW
  : (typeof REAL_ITEMS!=='undefined' ? REAL_ITEMS : [])).map(i=>({item:i.f, group:i.g}));
const _seedRawKeys = new Set(_seedRaw.map(r=>norm(r.item)));   // the seed names as loaded — rawData IS _seedRaw on a pure-seed company, so read this, never the array later (v2.47.0)
let rawData       = bls('rawdata2', _seedRaw);      // [{item, group}]  ← Raw Data master
let receivedStock = bls('recv', []);                // [{date, item, qty, group}]
let mrDetail      = bls('mr',   []);                // [{date, group, item, qty}]
// Traffic's opening seed (v2.42.0) = the September-2026 workbook: main-sheet OPENING BAL per brand (openBL, the TRAFFIC_BAR
// rows that carry `o`) + the Liquor Room sheet's OPENING QTY per item (lrOpen), both from invseed.js. Same shape as CANTEEN_INV.
function _trafficInv(){ const o={};
  if(typeof TRAFFIC_BAR!=='undefined') TRAFFIC_BAR.forEach(x=>{ if(x.o==null) return; const k=norm(x.b); (o[k]=o[k]||{}).openBL=x.o; });
  if(typeof TRAFFIC_LR_OPEN!=='undefined')  TRAFFIC_LR_OPEN.forEach(x=>{ const k=norm(x.f); (o[k]=o[k]||{}).lrOpen=x.o; });
  return o; }
const _seedInv = (typeof CO_IS_CANTEEN!=='undefined' && CO_IS_CANTEEN) ? (typeof CANTEEN_INV!=='undefined' ? CANTEEN_INV : {})
  : ((typeof CO_IS_TRAFFIC!=='undefined' && CO_IS_TRAFFIC) ? _trafficInv() : {});
let invData       = bls('inv',  JSON.parse(JSON.stringify(_seedInv)));   // { norm(item): {sizeL, openBL, closeBL, lrOpen, saleOverride} }
// heal: an existing-but-empty store must not mask the company's opening-balance seed
// ...unless the company was deliberately started fresh (Settings -> Start Fresh sets the flag)
if(Object.keys(_seedInv).length && !Object.keys(invData).length && !localStorage.getItem(CO_PREFIX+'fresh')){ invData=JSON.parse(JSON.stringify(_seedInv)); bsv('inv',invData); }
let bevPages      = bls('bevpages', []);            // Beverage Control clone PAGES [{id,name}] — each its own sheet in the nav
const bevStores   = {};                             // lazy-loaded per-clone data stores (storage key inv2_<id>)
// A clone page (#bev_<id>) reads/writes its OWN store; every other page uses the main one.
function bevPageId(){ const h=location.hash.slice(1); return h.indexOf('bev_')===0 ? h.slice(4) : null; }
function activeInv(){ const id=bevPageId(); if(!id) return invData;
  if(!bevStores[id]) bevStores[id]=bls('inv2_'+id, {}); return bevStores[id]; }
function activeInvSave(){ const id=bevPageId(); bsv(id?('inv2_'+id):'inv', activeInv()); }

/* ---------------- master matching ---------------- */
let _rawIdx=null, _rawIdxVer=0;
function rebuildRawIdx(){ _rawIdx=new Map(); rawData.forEach(r=>_rawIdx.set(norm(r.item), r)); _rawIdxVer++; }
rebuildRawIdx();
// EXACT Item Master lookup (norm-equal only) — findRaw() below also has a contains-fallback, which is
// right for matching receipts but wrong when deciding whether a BEVCO name is a NEW item (v2.33.0)
function findRawExact(name){ if(!_rawIdx) rebuildRawIdx(); return _rawIdx.get(norm(name))||null; }
function findRaw(name){ if(!_rawIdx) rebuildRawIdx(); const n=norm(name); if(_rawIdx.has(n)) return _rawIdx.get(n);
  // fallback: contains match (handles minor naming differences)
  return rawData.find(r=>{ const rn=norm(r.item); return rn.includes(n)||(n.length>5&&n.includes(rn)); }) || null; }
function inRaw(name){ return !!findRaw(name); }
function redBadge(){ return '<span class="pill red" title="This name is not in Item Master — add it to Item Master to match"><span class="dotpulse"></span> not in Item Master</span>'; }
function rawGroups(){ return [...new Set(rawData.map(r=>r.group))].sort((a,b)=>a.localeCompare(b)); }
function rawNamesDatalist(){ return `<datalist id="rawItems">${rawData.map(r=>`<option value="${esc(r.item)}">`).join('')}</datalist>`; }
function groupRaw(filterFn){
  const g={}; rawData.forEach(r=>{ if(filterFn&&!filterFn(r)) return; (g[r.group]=g[r.group]||[]).push(r); });
  return Object.keys(g).sort().map(k=>({group:k, items:g[k]}));
}
function saveRaw(){ bsv('rawdata2',rawData); rebuildRawIdx(); }

/* Column B — short brand code (matches the Bar Tie file). Seeded from File 2 main sheet, editable. */
const _brandMap={}; ((typeof CO_IS_CANTEEN!=='undefined' && CO_IS_CANTEEN && typeof CANTEEN_BRAND!=='undefined') ? CANTEEN_BRAND
  : (typeof REAL_BRAND!=='undefined'?REAL_BRAND:[])).forEach(p=>{ _brandMap[norm(p.f)]=p.b; });
function brandOf(itemName){ const iv=invGet(itemName); if(iv.brand!=null&&iv.brand!=='') return iv.brand; return _brandMap[norm(itemName)]||''; }

/* ---- File-2 inventory map: Tally brand (col B) -> Raw Data full receive name (col A) + bottle size (L).
   This is what makes Bar Inventory's RECEIPT match MR Detail / Received Stock / Liquor Room,
   which all carry the A full name (e.g. "BLENDERS PRIDE WHISKY 750 ML"). Mirrors the Excel:
   RECEIPT = SUMIFS('MR DETAIL'!Qty, 'MR DETAIL'!Item, <A name>, within period).  */
const _invMapIdx=new Map();
((typeof CO_IS_CANTEEN!=='undefined' && CO_IS_CANTEEN && typeof CANTEEN_INVMAP!=='undefined') ? CANTEEN_INVMAP
  : (typeof INV_MAP!=='undefined'?INV_MAP:[])).forEach(m=>{ const k=norm(m.b);
  if(k && !_invMapIdx.has(k)) _invMapIdx.set(k,m);
  if(m.raw){ const rk=norm(m.raw); if(!_invMapIdx.has(rk)) _invMapIdx.set(rk,m); } });
function invMapFor(name){ return _invMapIdx.get(norm(name))||null; }
// Raw Data full name (Excel col A) used to track receipts for a Bar Inventory item.
// Priority: per-item manual override → seeded INV_MAP → '' (caller falls back to a contains-match).
function rawNameFor(name){ const o=invGet(name).rawName; if(o!=null&&o!=='') return o; const m=invMapFor(name); return m&&m.raw?m.raw:''; }

/* ---------------- helpers ---------------- */
function invGet(name){ return activeInv()[norm(name)] || {}; }
function invSet(name,key,val){ const k=norm(name); const st=activeInv(); (st[k]=st[k]||{})[key]=val; activeInvSave(); }
function invSetRaw(idx,key,val){ const r=rawData[idx]; if(r) invSet(r.item,key,val); }
// evaluate a sum expression like "12+12" -> 24 (safe: digits + . + - * / ( ) only); plain numbers pass through
function evalNum(str){ const s=String(str==null?'':str).trim(); if(s==='') return ''; if(/^[\d.]+$/.test(s)) return s;
  if(/^[\d.+\-*/() ]+$/.test(s)){ try{ const v=Function('"use strict";return ('+s+')')(); return (typeof v==='number'&&isFinite(v))?v:s; }catch(e){ return s; } } return s; }
function invSetNum(idx,key,raw){ const r=rawData[idx]; if(r) invSet(r.item,key,evalNum(raw)); }
// Tally-master versions (Bar Inventory uses tallyItems so names/categories match Tally)
function invSetT(idx,key,val){ const t=tallyItems[idx]; if(t) invSet(t.name,key,val); }
function invSetTNum(idx,key,raw){ const t=tallyItems[idx]; if(t) invSet(t.name,key,evalNum(raw)); }
// Bar Inventory size is shown/edited in ml but stored in litres (sizeL) so the bottle.loose math stays intact.
function invSetSizeMl(idx,raw){ const t=tallyItems[idx]; if(!t) return; const v=evalNum(raw); invSet(t.name,'sizeL', v===''?'':(fnum(v)/1000)); }
const INV_PCS_CATS=['BEER','ALCOPOPS','BEVERAGE & CIGARETTE'];
function invUnit(cat){ return INV_PCS_CATS.includes(cat)?'pcs':'ml'; }
function fnum(v){ return (v===''||v==null||isNaN(+v))?0:+v; }
function deriveSizeL(name){ const m=(name||'').match(/(\d{2,5})\s*ML/i); if(m) return (+m[1])/1000; if(/\bL\b|LITRE/i.test(name||'')) return 1; return 0.75; }
function sizeOf(name){ const v=invGet(name).sizeL; if(v!=null&&v!=='') return +v;
  const m=invMapFor(name); if(m&&m.sizeL) return +m.sizeL;   // seeded bottle size from File-2 sheet (col C)
  return deriveSizeL(name); }
// bottle.loose → litres. KEGS (size ≥ 5 L, i.e. Draught Beer) are the Excel's exception: its draught rows read
// `G = D + E×50000 − F` — opening/closing typed in ML, only the receipt in kegs — so a keg value is ml, not
// bottle.loose (the bottle formula would turn "13000" into 13000 kegs). Matched here since v2.42.0.
function toLitres(x,sizeL){ x=+x||0; if(sizeL>=5) return x/1000; const b=Math.trunc(x); return b*sizeL+(x-b); }
function excelDate(v){
  if(v==null||v==='') return '';
  if(typeof v==='number'&&v>20000){ const d=new Date(Math.round((v-25569)*86400000)); return d.toISOString().slice(0,10); }
  if(v instanceof Date) return v.toISOString().slice(0,10);
  const s=String(v).trim(); const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if(m){ let y=m[3]; if(y.length===2) y='20'+y; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  return s;
}
// aggregation by item name (Excel "*name*" contains-match)
function receivedForItem(name){ const n=norm(name); return receivedStock.reduce((a,r)=> a+((norm(r.item).includes(n)||n.includes(norm(r.item)))?fnum(r.qty):0),0); }
function issuedForItem(name){ const n=norm(name); return mrDetail.reduce((a,r)=> a+((norm(r.item).includes(n)||n.includes(norm(r.item)))?fnum(r.qty):0),0); }
/* Liquor-Room totals in one place — bottles, ml and ₹ for Opening / Received / Issued / Closing.
   Same per-item formula the Liquor Room page uses (Opening + Received − Issued = Closing);
   ml = bottles × bottle size, ₹ = bottles × landing rate. Display only — no calculation changed. */
function lrTotals(){
  const t={n:0, op:0,rv:0,is:0,cl:0, opV:0,rvV:0,isV:0,clV:0, opMl:0,rvMl:0,isMl:0,clMl:0};
  rawData.forEach(r=>{
    const op=fnum(invGet(r.item).lrOpen), rv=receivedForItem(r.item), is=issuedForItem(r.item), cl=op+rv-is;
    if(!op && !rv && !is && !cl) return;
    const m=landOf(r.item), ml=(sizeOf(r.item)||0)*1000;
    t.n++; t.op+=op; t.rv+=rv; t.is+=is; t.cl+=cl;
    t.opV+=op*m; t.rvV+=rv*m; t.isV+=is*m; t.clV+=cl*m;
    t.opMl+=op*ml; t.rvMl+=rv*ml; t.isMl+=is*ml; t.clMl+=cl*ml;
  });
  return t;
}
function receiptInPeriod(name){ const n=norm(name), f=period.from, t=period.to;
  return mrDetail.reduce((a,r)=>{ const m=(norm(r.item).includes(n)||n.includes(norm(r.item))); const d=r.date||''; return a+((m&&(!f||d>=f)&&(!t||d<=t))?fnum(r.qty):0); },0); }
// Excel-faithful receipt: EXACT name match on the Raw Data full name within the period (SUMIFS on col A).
function receiptExact(rawName){ if(!rawName) return 0; const n=norm(rawName), f=period.from, t=period.to;
  return mrDetail.reduce((a,r)=>{ const d=r.date||''; return a+((norm(r.item)===n && (!f||d>=f)&&(!t||d<=t))?fnum(r.qty):0); },0); }
// best-effort SALE link to a bar-tie brand (from the Linking engine)
function brandSaleList(){ const {cmlMap,smlMap}=calcGrandTotals();
  return tallyItems.map(t=>({n:norm(t.name), ml:getEffectiveCocktailMl(t,cmlMap)+getEffectiveStraightMl(t,smlMap)})).filter(x=>x.ml>0); }
// match by column-B brand code against the Bar Tie brands
function saleForItem(brandName, bsl){ if(!brandName) return 0; const n=norm(brandName); let best=null;
  bsl.forEach(b=>{ if(b.n.length>=4 && (n.includes(b.n)||b.n.includes(n))){ if(!best||b.n.length>best.n.length) best=b; } });
  return best?best.ml:0; }
// names used in received/MR that are NOT in Raw Data (the red items)
function unmatchedNames(){ const set=new Map();
  receivedStock.concat(mrDetail).forEach(r=>{ if(r.item && !inRaw(r.item)) set.set(norm(r.item), r.item); });
  return [...set.values()]; }

let iq={ rd:'', bi:'', lr:'', rv:'' };
function isearch(kind,val){ iq[kind]=val; routeQuiet(); const i=$('#searchBox'); if(i){ i.focus(); try{ i.setSelectionRange(val.length,val.length); }catch(e){} } }
// Bar Inventory filters (UI state only, not persisted)
let biCat='', biConsF='all', biVarF='all', biSaleF='all', biFind='';
function setBiCat(c){ biCat=(biCat===c?'':c); route(); }
function setBiConsF(v){ biConsF=v; route(); }
function setBiVarF(v){ biVarF=v; route(); }
function setBiSaleF(v){ biSaleF=v; route(); }
function biClearFilters(){ biConsF='all'; biVarF='all'; biSaleF='all'; biCat=''; route(); toast('Filters cleared','Showing every active item','ok'); }
function passSign(val,f){ return f==='plus'?val>0 : f==='minus'?val<0 : true; }

/* ============================================================
   1) RAW DATA — master (group-wise) · item + group + size (no peg)
   ============================================================ */
let rdPriceF='all';   // Item Master price filter: all · blank · set (v2.36.0)
VIEWS.rawdata = () => {
  const q=iq.rd;
  // "blank" = the box shows NOTHING — no rate of its own, no invoice rate, no MRP (client, 2026-09-18 19:50: an item whose box shows a grey 4470 is not blank)
  const hasPrice=r=> landOf(r.item)>0;
  const nBlankP=rawData.filter(r=>!hasPrice(r)).length;
  const groups=groupRaw(r=> (!q || norm(r.item).includes(norm(q)) || norm(r.group).includes(norm(q))) && (rdPriceF==='all' || (rdPriceF==='blank'?!hasPrice(r):hasPrice(r))));
  let sl=0, shownN=0, shownSel=0;
  const body=groups.map(g=>`
    <tr class="grp-row"><td colspan="8"><input type="checkbox" class="rdselg selcb" data-g="${esc(g.group)}" ${g.items.every(r=>_rdSel.has(norm(r.item)))?'checked':''} title="Select this group" onchange="rdSelGroup(this)"> ${g.group} <span class="muted">· ${g.items.length}</span></td></tr>
    ${g.items.map(r=>{ const i=rawData.indexOf(r); sl++; shownN++; if(_rdSel.has(norm(r.item))) shownSel++;
      return `<tr>
        <td style="width:34px"><input type="checkbox" class="rdsel selcb" data-n="${esc(norm(r.item))}" data-g="${esc(g.group)}" ${_rdSel.has(norm(r.item))?'checked':''} title="Select" onchange="rdSelToggle(this)"></td>
        <td class="muted num" style="width:44px">${sl}</td>
        <td><strong>${r.item}</strong></td>
        <td><span class="pill gray">${r.group}</span></td>
        <td class="num"><input class="cell-input" style="width:70px" value="${sizeOf(r.item).toFixed(2)}" onchange="invSetRaw(${i},'sizeL',this.value);route()" title="bottle size (litres)"></td>
        <td class="num"><input class="cell-input" style="width:70px" value="${invGet(r.item).mrp!=null?invGet(r.item).mrp:''}" placeholder="₹" onchange="invSetRaw(${i},'mrp',this.value)" title="MRP (₹) — printed price"></td>
        <td class="num"><input class="cell-input" style="width:74px;color:var(--gold)" value="${invGet(r.item).land!=null?invGet(r.item).land:''}" placeholder="${landOf(r.item)?Math.round(landOf(r.item)*100)/100:'₹'}" onchange="invSetRaw(${i},'land',this.value)" title="${landSetOf(r.item)!=null?'Your rate — values this item on every stock page':'Automatic (grey): the latest BEVCO invoice rate, or MRP — type a rate to make it yours'}"></td>
        <td class="right" style="width:52px"><button class="btn btn-danger btn-sm" onclick="delRaw(${i})">✕</button></td>
      </tr>`; }).join('')}`).join('');
  const lay=pageLay('rawdata');
  const defCard=`<div class="card"><div class="table-wrap" style="max-height:640px;overflow-y:auto"><table class="tbl rawhead">
      <thead><tr><th style="width:34px"><input type="checkbox" id="rdSelAll" class="selcb" ${shownN&&shownSel===shownN?'checked':''} title="Select all shown" onchange="rdSelAll(this.checked)"></th><th style="width:44px" class="right">SL</th><th>Item</th><th style="width:200px">Group</th><th class="right" style="width:90px">Bottle (L)</th><th class="right" style="width:86px">MRP ₹</th><th class="right" style="width:96px">Landing ₹/bot</th><th style="width:52px"></th></tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
  let bodyHtml;
  if(lay==='def') bodyHtml=defCard;
  else if(lay==='dense') bodyHtml=`<div class="laydense">${defCard}</div>`;
  else {
    const grp=groups.map(g=>({ id:g.group, title:g.group, sub:`${g.items.length} items`,
      right:`<span class="pill gray">${g.items.length}</span>`,
      detail: g.items.map(r=>{ const i=rawData.indexOf(r);
        return `<div class="flex between items-center" style="padding:4px 0;border-bottom:1px solid var(--border-soft);font-size:12px;gap:8px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${r.item}</span><span class="nowrap"><input class="cell-input" style="width:56px" value="${sizeOf(r.item).toFixed(2)}" title="bottle (L)" onchange="invSetRaw(${i},'sizeL',this.value)"> <input class="cell-input" style="width:60px" value="${invGet(r.item).mrp!=null?invGet(r.item).mrp:''}" placeholder="₹" title="MRP (₹)" onchange="invSetRaw(${i},'mrp',this.value)"> <button class="btn btn-danger btn-sm" onclick="delRaw(${i})">✕</button></span></div>`; }).join('') }));
    bodyHtml=renderLay('rawdata',lay,grp,{listTitle:'Groups'});
  }
  return `
    <div class="page-head"><div><h1>Item Master</h1><p>${rawData.length} items in ${rawGroups().length} groups. Liquor Room, Bar Stock Issue & Purchase all match against these names. <strong>Landing ₹/bot set here is the rate every page values with.</strong></p></div>
      <div class="page-actions">${layDrop('rawdata')}<div class="search" style="width:210px">🔎<input id="searchBox" placeholder="Search item / group…" value="${esc(q)}" oninput="isearch('rd',this.value)"></div>
      <label class="btn btn-sm btn-gold" style="cursor:pointer" title="Your Liquor Inventory workbook (RAW DATA sheet: GROUP · ITEM DESCRIPTION) — the Item Master becomes exactly that list; names with data are renamed, not lost">📄 Sync from sheet<input type="file" accept=".xlsx,.xlsm,.xls,.csv" style="display:none" onchange="rawSheetUpload(this)"></label>
      <label class="btn btn-sm" style="cursor:pointer" title="Excel/CSV — item name + MRP columns; names auto-match">₹ MRP Import<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="uploadMrp(this)"></label>
      <button class="btn btn-gold btn-sm" onclick="openRawAdd()">＋ New Item</button></div></div>
    ${bevDupNotice()}
    <div class="tabs noprint">${[['all','All ('+rawData.length+')'],['blank','⚠ Landing ₹ blank ('+nBlankP+')'],['set','✅ Landing ₹ set ('+(rawData.length-nBlankP)+')']].map(o=>`<div class="tab ${rdPriceF===o[0]?'active':''}" onclick="rdPriceTab('${o[0]}')">${o[1]}</div>`).join('')}${rdSelBarHtml()}</div>
    ${bodyHtml}`;
};
// the price tabs: ⚠ blank selects every item without a rate of its own (client, 2026-09-18 19:30: "landing blank-e click korle blank all item
// jeno select hoy, jei gulo already ache sei gulo jeno na hoy" — and 19:50: a grey automatic rate counts as "already ache"); the other two tabs clear the selection so nothing hidden stays ticked
function rdPriceTab(k){
  rdPriceF=k; _rdSel.clear();
  if(k==='blank') rawData.forEach(r=>{ if(!(landOf(r.item)>0)) _rdSel.add(norm(r.item)); });   // same test as the tab's own list: nothing shown in the box at all
  route();
}
function openRawAdd(){
  const opts=rawGroups().map(g=>`<option>${esc(g)}</option>`).join('');
  modal('New Item Master Entry', `
    <div class="field"><label>Item (full name with size)</label><input class="input" id="raItem" placeholder="e.g. BLENDERS PRIDE WHISKY 750 ML"></div>
    <div class="field"><label>Group</label><input class="input" list="raGroups" id="raGroup" placeholder="e.g. IMFL WHISKY 750 ML"><datalist id="raGroups">${opts}</datalist></div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="saveRawAdd()">Add</button>`);
}
function saveRawAdd(){ const item=$('#raItem').value.trim(); const group=$('#raGroup').value.trim()||'(ungrouped)';
  if(!item){ toast('Item?','Enter item name','err'); return; }
  if(inRaw(item)){ toast('Exists','Already in Item Master','err'); return; }
  rawData.push({item, group}); saveRaw(); closeModal(); route(); toast('Added',`${item} added to Item Master`,'ok'); }
/* ---- removing names (v2.38.0, reshaped v2.38.1) ----
   Item Master and Liquor Room share `rawData`, so a name removed on either page is gone on both.
   Beverage Control is the Tally-brand list and is NOT touched by an Item Master removal — the client's
   rule (2026-09-18 14:50: "item master name remove korle liquor room name delete hoy & beverage control-e
   jeno kichu na hoy"); it has its own ✕ and its own mark-and-delete. On both pages a row can be ticked
   (or a whole group / every row shown) and the ticked ones deleted together after one confirm. */
function brandActive(t){ try{ const R=barRow(t); return !!(R.sale>0||R.recBtl>0||R.iv.openBL!=null||R.iv.closeBL!=null); }catch(e){ return true; } }
function brandAliasCount(name){ const bn=norm(name); return aliasTable.filter(a=>norm(a.tallyItem)===bn).length; }
// the removeBrand cascade without the question: brand + its POS aliases + its bar record; caller saves
function brandDrop(name){
  const bn=norm(name); const ti=tallyItems.findIndex(t=>norm(t.name)===bn); if(ti<0) return 0;
  tallyItems.splice(ti,1);
  for(let i=aliasTable.length-1;i>=0;i--){ if(norm(aliasTable[i].tallyItem)===bn) aliasTable.splice(i,1); }
  if(invData[bn]) delete invData[bn];
  return 1;
}
// Item Master names → gone from Item Master + Liquor Room (purchase / issue lines keep the name); returns the count
function rawRemoveNames(names){
  const set=new Set(names.map(norm)); let raw=0;
  for(let i=rawData.length-1;i>=0;i--){ if(set.has(norm(rawData[i].item))){ rawData.splice(i,1); raw++; } }
  saveRaw(); invalidateCalcCache(); _bevIdx=null; _bevDupCache={ver:-1,list:null};
  return raw;
}
function _rawHoldsNote(names){
  const withData=names.filter(n=>_rawRefs(n).any); if(!withData.length) return '';
  return `<br><span style="color:var(--amber)">⚠ ${names.length>1?withData.length+' of them hold':'It holds '+esc(_rawRefs(names[0]).txt)}${names.length>1?' purchases / issues / stock / a rate':''} — those lines keep the name and show as “not in Item Master”.</span>`;
}
function rawRemoveAsk(i){
  const r=rawData[i]; if(!r) return; const name=r.item;
  confirmAsk(`Remove <strong>${esc(name)}</strong> from the Item Master? It disappears from the Liquor Room too; Beverage Control is not touched.`+_rawHoldsNote([name]), ()=>{
    rawRemoveNames([name]); _rdSel.delete(norm(name)); route(); toast('Removed', name+' — gone from Item Master & Liquor Room', 'err'); });
}
function delRaw(i){ rawRemoveAsk(i); }
/* Item Master: tick rows → Delete selected. Ticking never re-renders the page (the bar updates in place). */
var _rdSel=new Set();
function _selMany(set, list, on){ list.forEach(cb=>{ cb.checked=on; const k=cb.getAttribute('data-n'); if(on) set.add(k); else set.delete(k); }); }
function rdSelToggle(cb){ _selMany(_rdSel,[cb],cb.checked); rdSelSync(); }
function rdSelAll(on){ _selMany(_rdSel,[...document.querySelectorAll('#view .rdsel')],on); document.querySelectorAll('#view .rdselg').forEach(x=>{ x.checked=on; }); rdSelSync(); }
function rdSelGroup(cb){ const g=cb.getAttribute('data-g'); _selMany(_rdSel,[...document.querySelectorAll('#view .rdsel')].filter(x=>x.getAttribute('data-g')===g),cb.checked); rdSelSync(); }
function rdSelClear(){ _rdSel.clear(); document.querySelectorAll('#view .rdsel, #view .rdselg, #rdSelAll').forEach(x=>{ x.checked=false; }); rdSelSync(); }
function rdSelBarHtml(){ const n=_rdSel.size; return `<span class="selbar" id="rdSelBar" style="${n?'':'display:none'}"><strong id="rdSelN">${n}</strong> selected<button class="btn btn-sm seldel" onclick="rdSelDelete()">🗑 Delete selected</button><button class="btn btn-sm" onclick="rdSelClear()">Clear</button></span>`; }
function rdSelSync(){ const b=$('#rdSelBar'); if(!b) return; b.style.display=_rdSel.size?'':'none'; const n=$('#rdSelN'); if(n) n.textContent=_rdSel.size; }
function rdSelDelete(){
  const names=rawData.filter(r=>_rdSel.has(norm(r.item))).map(r=>r.item);
  if(!names.length){ toast('Nothing selected','Tick the items to remove first','err'); return; }
  confirmAsk(`Remove <strong>${names.length}</strong> item${names.length>1?'s':''} from the Item Master? They disappear from the Liquor Room too; Beverage Control is not touched.`+_rawHoldsNote(names)
    +`<span class="muted" style="display:block;font-size:11px;max-height:120px;overflow:auto;margin-top:6px">${names.map(esc).join('<br>')}</span>`, ()=>{
    const n=rawRemoveNames(names); _rdSel.clear(); route(); toast('Removed', n+' item'+(n===1?'':'s')+' removed from Item Master & Liquor Room', 'err'); });
}
/* Beverage Control: ✕ per row, or tick rows (a category / all shown) → Delete marked. Brands only —
   the Item Master / Liquor Room are not touched. */
function biRemove(i){
  const t=tallyItems[i]; if(!t) return; const active=brandActive(t), n=brandAliasCount(t.name);
  confirmAsk(`Remove brand <strong>${esc(t.name)}</strong> from Beverage Control & the Tally Sheet${n?' with its '+n+' POS alias'+(n>1?'es':''):''}? The Item Master / Liquor Room are not touched.`
    +(active?`<br><span style="color:var(--amber)">⚠ It has figures this period (sales, receipts or typed stock) — they go with it.</span>`:''), ()=>{
    brandDrop(t.name); _biSel.delete(norm(t.name)); bsv('tally',tallyItems); bsv('alias',aliasTable); bsv('inv',invData); rebuildIndexes(); invalidateCalcCache(); route();
    toast('Removed', t.name+' removed from Beverage Control & Tally Sheet', 'err'); });
}
var _biSel=new Set();
function biSelToggle(cb){ _selMany(_biSel,[cb],cb.checked); biSelSync(); }
function biSelAll(on){ _selMany(_biSel,[...document.querySelectorAll('#view .bisel')],on); document.querySelectorAll('#view .biselc').forEach(x=>{ x.checked=on; }); biSelSync(); }
function biSelCat(cb){ const c=cb.getAttribute('data-c'); _selMany(_biSel,[...document.querySelectorAll('#view .bisel')].filter(x=>x.getAttribute('data-c')===c),cb.checked); biSelSync(); }
function biSelClear(){ _biSel.clear(); document.querySelectorAll('#view .bisel, #view .biselc, #biSelAll').forEach(x=>{ x.checked=false; }); biSelSync(); }
function biSelBarHtml(){ const n=_biSel.size; return `<span class="selbar" id="biSelBar" style="${n?'':'display:none'}"><strong id="biSelN">${n}</strong> marked<button class="btn btn-sm seldel" onclick="biSelDelete()">🗑 Delete marked</button><button class="btn btn-sm" onclick="biSelClear()">Clear</button></span>`; }
function biSelSync(){ const b=$('#biSelBar'); if(!b) return; b.style.display=_biSel.size?'':'none'; const n=$('#biSelN'); if(n) n.textContent=_biSel.size; }
function biSelDelete(){
  const brands=tallyItems.filter(t=>_biSel.has(norm(t.name)));
  if(!brands.length){ toast('Nothing marked','Tick the brands to remove first','err'); return; }
  const active=brands.filter(brandActive).length, aliases=brands.reduce((a,t)=>a+brandAliasCount(t.name),0);
  confirmAsk(`Remove <strong>${brands.length}</strong> brand${brands.length>1?'s':''} from Beverage Control & the Tally Sheet${aliases?' with '+aliases+' POS alias'+(aliases>1?'es':''):''}? The Item Master / Liquor Room are not touched.`
    +(active?`<br><span style="color:var(--amber)">⚠ ${active} of them ha${active>1?'ve':'s'} figures this period (sales, receipts or typed stock) — they go with them.</span>`:'')
    +`<span class="muted" style="display:block;font-size:11px;max-height:120px;overflow:auto;margin-top:6px">${brands.map(t=>esc(t.name)).join('<br>')}</span>`, ()=>{
    let n=0; brands.forEach(t=>{ n+=brandDrop(t.name); }); _biSel.clear();
    bsv('tally',tallyItems); bsv('alias',aliasTable); bsv('inv',invData); rebuildIndexes(); invalidateCalcCache(); route();
    toast('Removed', n+' brand'+(n===1?'':'s')+' removed from Beverage Control & Tally Sheet', 'err'); });
}
/* ---- Item Master ⇄ the client's Liquor Inventory workbook (v2.35.0) ----
   The client keeps the master list of liquor-room items in the RAW DATA sheet of their monthly
   "Liquor Inventory Sheet" workbook (GROUP · ITEM DESCRIPTION). "Sync from sheet" makes the app's
   Item Master equal to that sheet: names in the sheet stay/are added, names no longer in the sheet
   are removed — unless they carry data (purchases, stock issues, opening stock, prices, a learned
   BEVCO mapping), in which case they are RENAMED to the sheet's spelling (best match suggested,
   any sheet name selectable) and every reference follows, or kept if the person says so.
   Nothing is deleted silently: the plan is shown first. */
var _rsPlan=null;
function rawSheetUpload(inp){
  const f=inp.files[0]; inp.value=''; if(!f) return;
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page','err'); return; }
  const reader=new FileReader();
  reader.onload=e=>{ try{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
    /* the sheet with GROUP + ITEM headers — "RAW DATA" first, else the first one that has both */
    const cands=wb.SheetNames.slice().sort((a,b)=>(/RAW/i.test(b)?1:0)-(/RAW/i.test(a)?1:0));
    let found=null;
    for(const sn of cands){ const grid=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,blankrows:false});
      for(let r=0;r<Math.min(grid.length,15);r++){ const row=(grid[r]||[]).map(x=>norm(x));
        const g=row.findIndex(x=>/^GROUP/.test(x)); const it=row.findIndex(x=>/(ITEM|DESCRIPTION)/.test(x));
        if(g>=0&&it>=0){ found={sn,grid,hr:r,cg:g,ci:it}; break; } }
      if(found) break; }
    if(!found){ toast('No GROUP / ITEM sheet','Could not find a sheet with GROUP and ITEM DESCRIPTION columns','err'); return; }
    const list=[], seen={};
    for(let r=found.hr+1;r<found.grid.length;r++){ const row=found.grid[r]||[];
      const item=String(row[found.ci]==null?'':row[found.ci]).replace(/\s+/g,' ').trim().toUpperCase();
      const group=String(row[found.cg]==null?'':row[found.cg]).replace(/\s+/g,' ').trim().toUpperCase();
      if(!item||/^(TOTAL|GRAND TOTAL)$/.test(item)) continue; const k=norm(item); if(seen[k]) continue; seen[k]=1;
      list.push({item, group:group||'(ungrouped)'}); }
    if(!list.length){ toast('Empty sheet','No item rows under the header','err'); return; }
    rawSheetPlan(list, f.name, found.sn);
  }catch(err){ toast('Failed','Could not read the file','err'); } };
  reader.readAsArrayBuffer(f);
}
/* what each current Item Master name is holding */
function _rawRefs(name){
  const k=norm(name); const iv=invData[k]||{};
  const recv=receivedStock.filter(r=>norm(r.item)===k).length, mr=mrDetail.filter(r=>norm(r.item)===k).length;
  const stock=(iv.lrOpen!=null&&iv.lrOpen!=='')||(iv.openBL!=null&&iv.openBL!=='')||(iv.closeBL!=null&&iv.closeBL!=='');
  const price=(iv.land!=null&&iv.land!=='')||(iv.mrp!=null&&iv.mrp!=='');
  const bev=Object.keys(bevMap).filter(b=>norm(bevMap[b])===k).length;
  const parts=[]; if(recv) parts.push(recv+' purchase'+(recv>1?'s':'')); if(mr) parts.push(mr+' issue'+(mr>1?'s':'')); if(stock) parts.push('stock'); if(price) parts.push('price'); if(bev) parts.push('BEVCO map');
  return {recv,mr,stock,price,bev, any:!!(recv||mr||stock||price||bev), txt:parts.join(' · ')};
}
function rawSheetPlan(list, fname, sname){
  const sheetIdx=new Map(list.map(x=>[norm(x.item),x]));
  const keep=[], gone=[];
  rawData.forEach(r=>{ if(sheetIdx.has(norm(r.item))) keep.push(r); else gone.push(r); });
  const add=list.filter(x=>!findRawExact(x.item));
  const rows=gone.map(r=>{ const refs=_rawRefs(r.item); const m=bevcoMatch(r.item,{list:list, ignoreSize:false});
    const sug=m.name||''; return {old:r.item, group:r.group||'', refs, sug, sure:m.sure, act: refs.any ? (sug?'rename':'keep') : 'remove', to:sug}; });
  _rsPlan={list, fname, sname, keep:keep.length, add, rows};
  const dl=`<datalist id="rsNames">${list.map(x=>`<option value="${esc(x.item)}">`).join('')}</datalist>`;
  const tr=rows.map((x,i)=>`<tr><td style="font-size:11.5px"><strong>${esc(x.old)}</strong><div class="muted" style="font-size:10px">${esc(x.group)}${x.refs.txt?' · <span style="color:var(--amber)">'+esc(x.refs.txt)+'</span>':' · no data'}</div></td>
      <td><select class="input" id="rsAct${i}" style="width:auto;padding:3px 6px;font-size:11.5px" onchange="rawSheetAct(${i})">
        <option value="rename" ${x.act==='rename'?'selected':''}>Rename to →</option><option value="keep" ${x.act==='keep'?'selected':''}>Keep as is</option><option value="remove" ${x.act==='remove'?'selected':''}>Remove</option></select></td>
      <td><input class="cell-input" id="rsTo${i}" list="rsNames" style="width:100%;text-align:left;${x.act==='rename'?'':'display:none'};${x.sure?'':'border-color:var(--amber)'}" value="${esc(x.to)}" placeholder="sheet name…" title="${x.sure?'Sure match':'Best guess — check'}"></td></tr>`).join('');
  const nRen=rows.filter(x=>x.act==='rename').length, nKeep=rows.filter(x=>x.act==='keep').length, nRem=rows.filter(x=>x.act==='remove').length;
  modal('📄 Item Master from your sheet — '+esc(sname),
    `<div class="muted" style="font-size:11.5px;margin-bottom:8px"><strong>${esc(fname)}</strong> · ${list.length} items in the sheet ·
      <span style="color:var(--green)">${keep.length} already here</span> · <span style="color:var(--green)">＋${add.length} new</span> ·
      <span style="color:var(--amber)">${nRen} renamed</span> · ${nKeep} kept · <span style="color:var(--red)">${nRem} removed</span><br>
      After this the Item Master, the Liquor Room and BEVCO matching all use the sheet's names. Names below are in the app but not in the sheet — say what happens to each.</div>
     ${rows.length?`<div class="table-wrap" style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr><th>In the app, not in the sheet</th><th style="width:130px">Action</th><th style="width:260px">Sheet name</th></tr></thead><tbody>${tr}</tbody></table></div>${dl}`:'<div class="muted" style="font-size:12px">Every app name is in the sheet — nothing to rename or remove.</div>'}
     ${add.length?`<details style="margin-top:8px"><summary class="muted" style="font-size:11.5px;cursor:pointer">＋ ${add.length} new from the sheet</summary><div class="muted" style="font-size:11px;line-height:1.7;max-height:120px;overflow:auto">${add.map(x=>esc(x.item)+' <span style="opacity:.6">· '+esc(x.group)+'</span>').join('<br>')}</div></details>`:''}`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="rawSheetApply()">✅ Make the Item Master match the sheet</button>`);
}
function rawSheetAct(i){ const s=$('#rsAct'+i), t=$('#rsTo'+i); if(!s||!t) return; t.style.display=s.value==='rename'?'':'none'; }
/* move every reference of one Item Master name onto another: purchase + issue lines, learned BEVCO mappings,
   stock/prices (the target's own values win, blanks are filled from the source), receive-name overrides */
function rawMoveRefs(oldName, newName){
  const ko=norm(oldName), kn=norm(newName); if(!ko||ko===kn) return; _recvRateDrop();
  receivedStock.forEach(r=>{ if(norm(r.item)===ko) r.item=newName; });
  mrDetail.forEach(r=>{ if(norm(r.item)===ko) r.item=newName; });
  Object.keys(bevMap).forEach(b=>{ if(norm(bevMap[b])===ko) bevMap[b]=newName; });
  if(invData[ko]){ const src=invData[ko], dst=invData[kn]||{}; Object.keys(src).forEach(f=>{ if(dst[f]==null||dst[f]==='') dst[f]=src[f]; }); invData[kn]=dst; delete invData[ko]; }
  Object.keys(invData).forEach(k=>{ const iv=invData[k]; if(iv&&iv.rawName&&norm(iv.rawName)===ko) iv.rawName=newName; });
}
/* ---- BEVCO-worded Item Master entries (v2.35.3, widened v2.37.0) ----
   Before the smart matcher, a blank mapping made the invoice's own wording an Item Master entry under
   "BEVCO IMPORT" ("CORONA EXTRA PREMIUM LAGER BEER, 330 ML.") and the learned map kept pointing at it —
   so every later invoice fed THAT name, and the client's real item ("CORONA 330 ML") never got its
   received bottles or its landing rate. Every such entry is listed here — with the client's own item it
   surely/probably belongs to when the matcher finds one, WITHOUT one otherwise (v2.35.3 hid those, so a
   page full of BEVCO names offered no button at all). Per row the person merges it into their item, or
   gives it their own name + group, or keeps it. Purchases, issues, prices and mappings follow either way. */
var _bevDupCache={ver:-1, list:null};
function _bevWorded(r){ return r.group==='BEVCO IMPORT' || /,\s*\d{2,5}\s*ML\.?$/i.test(r.item||''); }
var _bevCleanSet=null, _bevCleanKey='';
function _importedNames(){   // names an invoice import CREATED (the clean BEVCO wording, not in the seed list) — v2.47.0
  const key=invoices.length+':'+((invoices[0]&&invoices[0].no)||''); if(_bevCleanSet && _bevCleanKey===key) return _bevCleanSet;
  const st=new Set();
  invoices.forEach(v=>(v.items||[]).forEach(x=>{ const c=norm(bevcoCleanName(x.name)); if(c && !_seedRawKeys.has(c)) st.add(c); }));
  _bevCleanSet=st; _bevCleanKey=key; return st; }
function _looksBevco(r){ return _bevWorded(r) || _importedNames().has(norm(r.item)); }
function bevDupCandidates(){
  if(_bevDupCache.ver===_rawIdxVer && _bevDupCache.list) return _bevDupCache.list;
  const own=rawData.filter(r=>!_looksBevco(r));
  const out=[];
  rawData.forEach(r=>{ if(!_looksBevco(r)) return;
    const m=bevcoMatch(r.item,{list:own}); const to=(m.name && norm(m.name)!==norm(r.item)) ? m.name : '';
    if(!_bevWorded(r) && !to) return;                                                          // an import-created name that matches none of your items is simply a new product — nothing to fix (v2.47.0)
    const top=(m.top && m.top.name && norm(m.top.name)!==norm(r.item) && m.top.score>=0.45) ? m.top.name : '';
    let grp=(top && m.top.group && m.top.group!=='BEVCO IMPORT') ? m.top.group : '';           // the closest own item's shelf is the best guess for its group
    if(!grp){ try{ grp=bevcoGuessGroup(r.item); }catch(e){} } if(grp==='BEVCO IMPORT') grp='';
    out.push({dup:r.item, group:r.group||'', to, sure:!!(to&&m.sure), top, clean:bevcoCleanName(r.item), grp, refs:_rawRefs(r.item)}); });
  _bevDupCache={ver:_rawIdxVer, list:out}; return out;
}
function bevDupNotice(){
  const c=bevDupCandidates(); if(!c.length) return '';
  try{ if(sessionStorage.getItem('tg2_bevDupHide')===String(c.length)) return ''; }catch(e){}
  const ex=c.find(x=>x.to)||c[0]; const nTo=c.filter(x=>x.to).length;
  const eg=ex.to ? `e.g. <strong style="color:var(--text)">${esc(ex.dup)}</strong> → <strong style="color:var(--text)">${esc(ex.to)}</strong>`
                 : `e.g. <strong style="color:var(--text)">${esc(ex.dup)}</strong> — none of your items matches it; give it your own name & group`;
  return `<div class="card noprint" style="margin-bottom:10px;border-color:var(--amber)"><div class="card-body" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 14px;font-size:12px">
    <span style="color:var(--amber);font-weight:700">⚠ ${c.length} item${c.length>1?'s':''} came in with BEVCO's wording</span><span class="muted">${nTo?nTo+' look'+(nTo>1?'':'s')+' like your own item'+(nTo>1?'s':'')+' · ':''}${eg}. Merging moves the received bottles, landing rate and BEVCO mapping onto your item; renaming keeps it as a separate item under your name and group.</span>
    <button class="btn btn-gold btn-sm" onclick="bevDupPlan()">🧹 Fix BEVCO names</button><button class="btn btn-sm" title="Hide this notice for now" onclick="try{sessionStorage.setItem('tg2_bevDupHide','${c.length}')}catch(e){};route()">✕</button></div></div>`;
}
var _bdPlan=null;
function bevDupPlan(){
  const rows=bevDupCandidates(); if(!rows.length){ toast('Nothing to fix','No BEVCO-worded names in the Item Master','ok'); return; }
  _bdPlan=rows;
  const own=rawData.filter(r=>!_looksBevco(r));
  const dl=`<datalist id="bdNames">${own.map(x=>`<option value="${esc(x.item)}">`).join('')}</datalist>`
          +`<datalist id="bdGroups">${rawGroups().filter(g=>g!=='BEVCO IMPORT').map(g=>`<option value="${esc(g)}">`).join('')}</datalist>`;
  const tr=rows.map((x,i)=>{ const act=x.to?'merge':'rename';
    return `<tr><td style="font-size:11.5px"><strong>${esc(x.dup)}</strong><div class="muted" style="font-size:10px">${esc(x.group)}${x.refs.txt?' · <span style="color:var(--amber)">'+esc(x.refs.txt)+'</span>':' · no data'}${(!x.to&&x.top)?'<br>closest of yours: <span style="color:var(--text)">'+esc(x.top)+'</span> — choose Merge if it is the same product':''}</div></td>
      <td><select class="input" id="bdAct${i}" style="width:auto;padding:3px 6px;font-size:11.5px" onchange="bevDupAct(${i})">
        <option value="merge" ${act==='merge'?'selected':''}>Merge into →</option><option value="rename" ${act==='rename'?'selected':''}>Rename to →</option><option value="keep">Keep as is</option></select></td>
      <td><input class="cell-input" id="bdTo${i}" list="bdNames" style="width:100%;text-align:left;${act==='merge'?'':'display:none;'}${x.sure?'':'border-color:var(--amber)'}" value="${esc(x.to||x.top)}" placeholder="your item…" title="${x.sure?'Sure match':'Best guess — check'}">
          <div id="bdRn${i}" style="${act==='rename'?'':'display:none'}"><input class="cell-input" id="bdNm${i}" style="width:100%;text-align:left" value="${esc(x.clean)}" placeholder="your name for it…" title="Your own name for this item">
          <input class="cell-input" id="bdGr${i}" list="bdGroups" style="width:100%;text-align:left;margin-top:3px;border-color:var(--amber)" value="${esc(x.grp)}" placeholder="group / category…" title="Best guess — check"></div></td></tr>`; }).join('');
  modal('🧹 BEVCO-worded names → your names', `<div class="muted" style="font-size:11.5px;margin-bottom:8px">These entries were created from BEVCO's own wording. <strong>Merge</strong> moves their purchases, issues, landing rate, MRP, stock and the learned BEVCO mapping onto <strong>your</strong> item and removes the duplicate. <strong>Rename</strong> keeps it as its own item under your name and group (the next invoice then lands on that name). Amber = best guess, please check.</div>
    <div class="table-wrap" style="max-height:340px;overflow:auto"><table class="tbl"><thead><tr><th>BEVCO-worded entry</th><th style="width:120px">Action</th><th style="width:260px">Your item / name · group</th></tr></thead><tbody>${tr}</tbody></table></div>${dl}`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="bevDupApply()">✅ Apply</button>`);
}
function bevDupAct(i){ const s=$('#bdAct'+i), t=$('#bdTo'+i), r=$('#bdRn'+i); if(!s) return;
  if(t) t.style.display=s.value==='merge'?'':'none'; if(r) r.style.display=s.value==='rename'?'':'none'; }
// a rename that keeps the same norm() key ("APEROL, 750 ML." → "APEROL 750 ML") moves nothing, so rewrite the stored spelling too
function _bevRespell(oldName, newName){ const k=norm(newName); if(!k) return; _recvRateDrop();
  receivedStock.forEach(r=>{ if(norm(r.item)===k) r.item=newName; }); mrDetail.forEach(r=>{ if(norm(r.item)===k) r.item=newName; });
  Object.keys(bevMap).forEach(b=>{ if(norm(bevMap[b])===k) bevMap[b]=newName; }); }
function bevDupApply(){
  const rows=_bdPlan||[]; let merged=0, renamed=0;
  rows.forEach((x,i)=>{ const act=($('#bdAct'+i)||{}).value||(x.to?'merge':'rename'); if(act==='keep') return;
    const ix=rawData.findIndex(r=>norm(r.item)===norm(x.dup)); if(ix<0) return;
    if(act==='merge'){
      const to=(($('#bdTo'+i)||{}).value||'').trim(); const tgt=findRawExact(to); if(!tgt||norm(tgt.item)===norm(x.dup)) return;
      rawMoveRefs(x.dup, tgt.item); rawData.splice(ix,1); rebuildRawIdx(); merged++; return; }
    const nm=(($('#bdNm'+i)||{}).value||'').replace(/\s+/g,' ').trim().toUpperCase(); if(!nm) return;
    const grp=(($('#bdGr'+i)||{}).value||'').replace(/\s+/g,' ').trim().toUpperCase()||x.group||'(ungrouped)';
    const ex=findRawExact(nm);
    if(ex && norm(ex.item)!==norm(x.dup)){ rawMoveRefs(x.dup, ex.item); rawData.splice(ix,1); rebuildRawIdx(); merged++; return; }   // typed an existing name → that IS a merge
    rawMoveRefs(x.dup, nm); rawData[ix].item=nm; rawData[ix].group=grp; _bevRespell(x.dup, nm); rebuildRawIdx(); renamed++; });
  saveRaw(); bsv('recv',receivedStock); bsv('mr',mrDetail); bsv('inv',invData); bsv('bevmap',bevMap); _bevIdx=null; _bevDupCache={ver:-1,list:null};
  closeModal(); _bdPlan=null; route();
  toast('Done', (merged?merged+' merged into your items':'')+(merged&&renamed?' · ':'')+(renamed?renamed+' renamed under your name & group':'')+((merged||renamed)?' — purchases, landing ₹ and BEVCO mapping moved across':'nothing changed'), (merged||renamed)?'ok':'err');
}
function rawSheetApply(){
  const P=_rsPlan; if(!P) return;
  const renames=[], keeps=[]; let removed=0, orphan=0;
  P.rows.forEach((x,i)=>{ const act=($('#rsAct'+i)||{}).value||x.act; const to=(($('#rsTo'+i)||{}).value||'').trim().toUpperCase();
    if(act==='rename'){ const tgt=P.list.find(y=>norm(y.item)===norm(to)); if(!tgt){ keeps.push(x); return; } renames.push({old:x.old, to:tgt.item}); }
    else if(act==='keep') keeps.push(x);
    else { removed++; if(x.refs.recv||x.refs.mr) orphan++; } });
  /* every reference follows a rename */
  renames.forEach(rn=>rawMoveRefs(rn.old, rn.to));
  const newRaw=P.list.map(x=>({item:x.item, group:x.group}));
  keeps.forEach(x=>newRaw.push({item:x.old, group:x.group||'(ungrouped)'}));
  rawData.length=0; newRaw.forEach(r=>rawData.push(r));
  saveRaw(); bsv('recv',receivedStock); bsv('mr',mrDetail); bsv('inv',invData); bsv('bevmap',bevMap); _bevIdx=null;
  closeModal(); _rsPlan=null; route();
  toast('Item Master synced', rawData.length+' items · '+P.add.length+' new · '+renames.length+' renamed · '+keeps.length+' kept · '+removed+' removed'+(orphan?' ⚠ '+orphan+' removed name(s) still have entries — they show red until renamed':''), orphan?'err':'ok');
}
// MRP import: Excel/CSV with item-name + MRP columns (auto-detected) → matches Raw Data names, sets invData.mrp
function uploadMrp(inp){
  const f=inp.files[0]; if(!f) return;
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page','err'); return; }
  const reader=new FileReader();
  reader.onload=e=>{ try{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
    const grid=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,blankrows:false});
    // pick columns: name = most-texty column, mrp = most-numeric column (headers like MRP/PRICE/RATE win)
    const cc=Math.max(...grid.map(r=>(r||[]).length),0); if(!cc){ toast('Empty','No data found','err'); return; }
    let nameC=-1, mrpC=-1;
    for(let r=0;r<Math.min(grid.length,15);r++){ const row=(grid[r]||[]).map(x=>norm(x));
      const iN=row.findIndex(x=>/(ITEM|ITMS|NAME|BRAND|DESCRIPTION)/.test(x));
      const iM=row.findIndex(x=>/(MRP|PRICE|RATE|COST|AMOUNT)/.test(x));
      if(iN>=0&&iM>=0){ nameC=iN; mrpC=iM; break; } }
    if(nameC<0){ const txt=new Array(cc).fill(0), num=new Array(cc).fill(0);
      grid.forEach(row=>{ (row||[]).forEach((v,c)=>{ if(v==null||v==='') return; if(typeof v==='number'||/^\s*[\d,.]+\s*$/.test(String(v))) num[c]++; else txt[c]++; }); });
      nameC=txt.indexOf(Math.max(...txt)); mrpC=num.indexOf(Math.max(...num));
      if(mrpC===nameC||Math.max(...num)===0) mrpC=-1;
    }
    if(mrpC<0){ toast('No MRP column','No price numbers in the file — fill MRP next to the names and upload again','err'); return; }
    const idx={}; rawData.forEach(r=>{ idx[norm(r.item)]=r.item; });
    let set=0, nf=0;
    grid.forEach(row=>{ if(!row) return;
      const name=String(row[nameC]==null?'':row[nameC]).trim(); if(!name||/^ITMS|^ITEM|^NAME/i.test(name)) return;
      const v=parseFloat(String(row[mrpC]==null?'':row[mrpC]).replace(/[^\d.]/g,'')); if(!(v>0)) return;
      const hit=idx[norm(name)];
      if(hit){ invSet(hit,'mrp',v); set++; } else nf++;
    });
    route(); toast('MRP import', `MRP set on ${set} item${set===1?'':'s'}${nf?' · '+nf+' names not in Item Master':''}`, set?'ok':'err');
  }catch(err){ toast('Failed','Could not read the file','err'); } };
  reader.readAsArrayBuffer(f); inp.value='';
}

/* ============================================================
   2) RECEIVED STOCK — Excel upload (auto Date/Item/Qty) + manual
   ============================================================ */
let recvFilter='all', rvGrpOpen='';
function rvGrpToggle(g){ rvGrpOpen=(rvGrpOpen===g?'':g); route(); }
// Landing rate per bottle (what you actually PAY — from the BEVCO invoice).
// Falls back to MRP when no landing rate is known yet, so older entries keep showing values.
/* The rate a stock page values an item at (v2.36.2):
     1. the Item Master rate the client set (`invData.land`) — theirs, an invoice never changes it;
     2. else the LATEST BEVCO invoice rate for that item (the newest purchase entry carrying its own `land`) —
        so Liquor Room / Beverage Control agree with the Purchase page until the client sets a rate;
     3. else MRP.
   The per-item "latest invoice rate" map is cached against the purchase array (identity + length) and dropped
   explicitly where an entry's rate or name changes in place. */
var _recvRateWM=new WeakMap();
function _recvRateMap(){
  const c=_recvRateWM.get(receivedStock); if(c && c.n===receivedStock.length) return c.m;
  const m={}; receivedStock.forEach((r,i)=>{ if(!r||r.land==null||r.land==='') return; const k=norm(r.item); const d=String(r.date||'');
    const cur=m[k]; if(!cur || d>cur.d || (d===cur.d && i>cur.i)) m[k]={d, i, land:+r.land||0}; });
  _recvRateWM.set(receivedStock,{n:receivedStock.length, m}); return m;
}
function _recvRateDrop(){ try{ _recvRateWM.delete(receivedStock); }catch(e){} }
function landSetOf(name){ const v=invGet(name).land; return (v!=null&&v!=='')?(+v||0):null; }           // the client's own rate, or null
function landAutoOf(name){ const e=_recvRateMap()[norm(name)]; return e?e.land:0; }                      // latest invoice rate, or 0
function landOf(name){ const v=landSetOf(name); if(v!=null) return v; const a=landAutoOf(name); if(a>0) return a; return +invGet(name).mrp||0; }
/* A purchase entry carries ITS OWN landing rate (`land`, set by the BEVCO import from that invoice's own
   fee share) — the item-level `land` is only the CURRENT rate used to value stock. Before v2.34.1 every
   entry was valued at the item's latest rate, so an item bought in several invoices at slightly different
   landed rates (SPF / round-off differ per invoice) made the Purchase total drift from the invoices'
   own totals (+₹11,240 on the client's 18 September invoices). Entries without their own rate
   (manual / Excel) still fall back to the item rate. */
/* v2.36.1 — two rates, two jobs (the client's rule, stated twice):
   · the PURCHASE page values every entry at ITS OWN invoice rate (`r.land`, fee share included) — so its total is
     the BEVCO ledger figure; an entry without one (manual / Excel) falls back to the item rate;
   · the ITEM MASTER rate (`invData.land`, set by the client) values the stock pages — Liquor Room, Bar Stock
     Issue, Beverage Control, dashboard, stock reports — and a BEVCO invoice never changes it (v2.36.0). */
/* where a purchase came from (v2.39.0): 'cash' only when the entry says so — everything else (BEVCO PDF imports, older
   manual / Excel rows) is BEVCO, the normal source; a manual row without an invoice number can be flipped by clicking its chip */
function recvSrc(r){ return (r&&r.src==='cash')?'cash':'bevco'; }
function recvSrcChip(r,i){ const cash=recvSrc(r)==='cash'; const manual=!r.inv;
  return `<span class="lrinv ${cash?'cash':'bev'}${manual?' tog':''}" title="${cash?'Cash purchase':'BEVCO purchase'}${manual?' — click to switch':''}" ${manual?`onclick="recvToggleSrc(${i})"`:''}>${cash?'💵 CASH':'🧾 BEVCO'}</span>`; }
function recvToggleSrc(i){ const r=receivedStock[i]; if(!r||r.inv) return; if(recvSrc(r)==='cash') delete r.src; else r.src='cash'; bsv('recv',receivedStock); route(); }
let recvSrcF='all';
// a line that came out of a BEVCO PDF (its invoice is in the 📜 register) keeps its date / no / qty as printed; everything else is editable
function recvImported(r){ return !!(r && r.inv && typeof invoices!=='undefined' && invoices.some(v=>String(v.no)===String(r.inv))); }
function recvSetField(i,f,v){ const r=receivedStock[i]; if(!r) return;
  if(f==='qty'){ const n=evalNum(v); r.qty=(n===''||isNaN(+n))?0:+n; }
  else if(f==='date'){ r.date=String(v||'').trim(); }
  else if(f==='inv'){ const s=String(v||'').trim(); if(s) r.inv=s; else delete r.inv; }
  else if(f==='item'){ const nm=String(v||'').replace(/\s+/g,' ').trim().toUpperCase(); if(!nm){ route(); return; } const ex=findRawExact(nm)||findRaw(nm); r.item=ex?ex.item:nm; r.group=ex?(ex.group||''):(r.group||''); }
  _recvRateDrop(); bsv('recv',receivedStock); route(); }
function recvLand(r){ return (r&&r.land!=null&&r.land!=='')?(+r.land||0):landOf(r?r.item:''); }
function recvInvLand(r){ return (r&&r.land!=null&&r.land!=='')?(+r.land||0):0; }
function recvVal(r){ return fnum(r&&r.qty)*recvLand(r); }
function recvSetLand(i,v){ const r=receivedStock[i]; if(!r) return;   // edits THIS entry's rate only — the Item Master rate stays the client's
  if(v===''||v==null){ delete r.land; } else r.land=fnum(v);
  _recvRateDrop(); bsv('recv',receivedStock); route(); }
VIEWS.received = () => {
  const total=receivedStock.reduce((a,r)=>a+fnum(r.qty),0);
  const totalVal=receivedStock.reduce((a,r)=>a+recvVal(r),0);   // LANDING value = the main amount (each entry at its own invoice rate)
  const unmatched=receivedStock.filter(r=>!inRaw(r.item)).length;
  const DUP=recvDupInfo();
  const rows=receivedStock.map((r,i)=>({r,i})).filter(x=>{ const ok=inRaw(x.r.item);
    if(iq.rv){ const q=norm(iq.rv); if(!(norm(x.r.item)+' '+norm(x.r.inv||'')+' '+norm(x.r.shop||'')).includes(q)) return false; }   // item, invoice / bill no, or shop
    if(recvSrcF!=='all' && recvSrc(x.r)!==recvSrcF) return false;
    return recvFilter==='all'||(recvFilter==='ok'&&ok)||(recvFilter==='un'&&!ok)||(recvFilter==='dup'&&!!DUP.info[x.i]); });
  const bevVal=receivedStock.filter(r=>recvSrc(r)==='bevco').reduce((a,r)=>a+recvVal(r),0), cashVal=totalVal-bevVal;
  const nCash=receivedStock.filter(r=>recvSrc(r)==='cash').length, nBev=receivedStock.length-nCash;
  // one sheet row — same figures as before (qty, MRP, landing ₹/bot, qty × landing), royal styling only
  const rowHtml=({r,i})=>{ const ok=inRaw(r.item); const mrp=invGet(r.item).mrp; const land=invGet(r.item).land;
    const q=fnum(r.qty), val=recvVal(r), qd=Number.isInteger(q)?fmt(q):String(r.qty); const eland=Math.round(recvLand(r)*100)/100;
    const imp=recvImported(r);
    const dk=DUP.info[i]; const dupPill=dk==='dup'?' <span class="lrinv dupx" title="Same bill / invoice no + same item appears more than once — a double entry; ✕ the extra one">⚠ duplicate</span>':dk==='coll'?' <span class="lrinv dupc" title="Same invoice, same name, different landed rates — two different BEVCO products were mapped onto one Item Master name; 🔧 Fix names gives each its own">⚠ 2 products · 1 name</span>':dk==='maybe'?' <span class="lrinv dupm" title="Same date, item, quantity and source as another entry, with no bill no — check whether it was entered twice">? same day·item·qty</span>':'';
    return `<tr class="${ok?'':'row-alert'}${recvSrc(r)==='cash'?' rvcash':''}${dk==='coll'?' rvcoll':dk?' rvdup':''}">
      <td class="nowrap">${imp?(r.date||'—'):`<input class="cell-input rvdate" type="date" value="${esc(r.date||'')}" title="Purchase date — editable" onchange="recvSetField(${i},'date',this.value)">`}</td>
      <td title="${esc(r.inv||'')}">${recvSrcChip(r,i)}${dupPill}${imp?(r.inv?` <span class="lrinv">${esc(String(r.inv).split('/').slice(-3).join('/'))}</span>`:''):`<input class="cell-input rvinv" value="${esc(r.inv||'')}" placeholder="${recvSrc(r)==='cash'?'bill no':'invoice no'}" title="${recvSrc(r)==='cash'?'Shop bill / memo no':'Invoice no'} — editable" onchange="recvSetField(${i},'inv',this.value)">`}</td>
      <td class="lrname"><input class="cell-input rvitem" list="rawItems" value="${esc(r.item)}" title="Item — editable: pick your Item Master item or type; the group follows" onchange="recvSetField(${i},'item',this.value)"></td>
      <td>${ok?`<span class="pill gray">${findRaw(r.item).group}</span>`:redBadge()}</td>
      <td class="num">${imp?`<span class="lrsg ${q>0?'plus':'zero'}">${q>0?'+':''}${qd}</span>`:`<input class="cell-input rvqty" value="${esc(String(r.qty==null?'':r.qty))}" placeholder="0" title="Bottles — editable (12+12 works)" onchange="recvSetField(${i},'qty',this.value)">`}</td>
      <td class="num"><input class="cell-input" style="width:60px" value="${mrp!=null?mrp:''}" placeholder="₹" title="MRP (₹) — printed on the bottle / invoice" onchange='invSet(${JSON.stringify(r.item)},"mrp",this.value);route()'></td>
      <td class="num"><input class="cell-input lrland" value="${eland||''}" placeholder="${mrp!=null?mrp:'₹'}" title="Landing ₹ per bottle for THIS entry (its BEVCO invoice, fees included) — the Item Master rate is separate and values the stock pages" onchange="recvSetLand(${i},this.value)"></td>
      <td class="num"><span class="lrval">${val?('₹ '+fmt(Math.round(val))):'<span class="muted">—</span>'}</span></td>
      <td class="right nowrap">${ok?'':`<button class="btn btn-gold btn-sm" onclick='openAddToRaw(${JSON.stringify(r.item)})'>＋ Item Master</button> `}<button class="btn btn-danger btn-sm" onclick="delRecv(${i})">✕</button></td></tr>`; };
  // the sheet reads like a purchase register: entries grouped under their invoice (first-seen order = import order),
  // each invoice with a gold header (no · date · items) and a subtotal (bottles · landing ₹). Entries without an
  // invoice number (manual / Excel) sit under one "Manual · Excel" group; a sheet with ONLY such entries stays flat.
  const rvGroups=[]; const rvIx={};
  rows.forEach(x=>{ const k=recvSrc(x.r)==='cash'?'💵':(x.r.inv?String(x.r.inv):''); if(rvIx[k]==null){ rvIx[k]=rvGroups.length; rvGroups.push({k,items:[]}); } rvGroups[rvIx[k]].items.push(x); });
  const flat = rvGroups.length===1 && rvGroups[0].k==='';
  const gLabel=k=> k==='💵' ? '💵 Cash purchases' : (k ? '🧾 Invoice '+esc(k) : '🧾 BEVCO · manual entries');
  const gShort=k=> k==='💵' ? 'Cash' : (k ? esc(String(k).split('/').slice(-3).join('/')) : 'BEVCO manual');
  const body=rvGroups.map(g=>{
    const its=g.items, gQ=its.reduce((a,x)=>a+fnum(x.r.qty),0), gV=its.reduce((a,x)=>a+recvVal(x.r),0);
    const d0=its[0].r.date||'';
    const head=flat?'':`<tr class="grp-row lrgrp"><td colspan="9"><span class="g">${gLabel(g.k)}</span><span class="n">${d0?esc(d0)+' · ':''}${its.length} item${its.length===1?'':'s'}</span></td></tr>`;
    const sub=flat?'':`<tr class="lrsub"><td colspan="4" class="right"><strong>${gShort(g.k)} — TOTAL</strong></td>
      <td class="num"><strong class="lrsg ${gQ>0?'plus':'zero'}">${gQ>0?'+':''}${fmt(gQ)}</strong></td><td colspan="2" class="right muted" style="font-size:10.5px">landing amount</td>
      <td class="num"><strong class="lrval">₹ ${fmt(Math.round(gV))}</strong></td><td></td></tr>`;
    return head+its.map(rowHtml).join('')+sub;
  }).join('')
    || '<tr><td colspan="9" class="center muted" style="padding:24px">Nothing here yet — upload a 🧾 BEVCO invoice, the liquor-receive Excel, or ＋ Add an entry.</td></tr>';
  const shownVal=rows.reduce((a,x)=>a+recvVal(x.r),0);
  const ft=(id,l)=>`<div class="tab ${recvFilter===id?'active':''}" onclick="recvFilter='${id}';route()">${l}</div>`;
  const fs=(id,l)=>`<div class="tab ${recvSrcF===id?'active':''}" onclick="recvSrcF='${id}';route()">${l}</div>`;
  // ---- Royal looks (charts driven by the same real data) ----
  const look=pref.recvLook||'def';
  const SER="font-family:Georgia,'Times New Roman',serif";
  const byGroup={}, byDay={}; let mVal=0;
  receivedStock.forEach(r=>{ const ok=inRaw(r.item); const v=recvVal(r);
    const g=ok?findRaw(r.item).group:'⚠ unmatched'; byGroup[g]=(byGroup[g]||0)+v;
    const d=r.date||'—'; byDay[d]=(byDay[d]||0)+v; if(ok) mVal+=v; });
  const gTop=Object.entries(byGroup).sort((a,b)=>b[1]-a[1]);
  const GOLDS=['#d8bd7f','#b89a5c','#8a6d3b','#6b5836','#5c4a28','#3a2f1c','#2a2620'];
  const dotc=c=>`<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${c};margin-right:4px"></span>`;
  const legend=gTop.slice(0,4).map((g,i)=>`${dotc(GOLDS[i])}${esc(g[0])} <strong style="color:var(--text)">₹ ${fmt(g[1])}</strong>`).join('<br>');
  const pieCard=(id,title,lg,h)=>`<div class="card" style="flex:1;min-width:220px"><div class="card-head"><h3 style="${SER};color:var(--gold)">${title}</h3></div>
    <div class="card-body" style="display:flex;gap:12px;align-items:center"><div style="width:${h||120}px;height:${h||120}px;flex:none;position:relative"><canvas id="${id}"></canvas></div>
    <div style="font-size:11px;color:var(--text-muted);line-height:1.9">${lg||''}</div></div></div>`;
  // group-wise value ledger — click a group to open its items
  const grpItems={}; receivedStock.forEach(r=>{ const ok=inRaw(r.item); const g=ok?findRaw(r.item).group:'⚠ unmatched'; (grpItems[g]=grpItems[g]||[]).push(r); });
  const topLedger=gTop.map(([g,val])=>{ const its=grpItems[g]||[]; const open=rvGrpOpen===g;
    return `<div style="border-bottom:1px solid var(--border-soft)">
      <div class="flex between items-center" style="padding:5px 0;cursor:pointer;gap:8px" onclick='rvGrpToggle(${jatt(g)})'>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12px"><span class="muted">${open?'▾':'▸'}</span> <strong>${esc(g)}</strong> <span class="muted" style="font-size:10.5px">· ${its.length} entr${its.length===1?'y':'ies'}</span></span>
        <strong class="gold" style="font-size:12px">₹ ${fmt(val)}</strong></div>
      ${open?its.map(r=>`<div class="flex between" style="padding:3px 0 3px 18px;font-size:11.5px;color:var(--text-muted);gap:8px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${r.item} <span style="font-size:10px">· ${r.date||'—'}</span></span><span class="nowrap">${fmt(r.qty)} × ₹${fmt(recvLand(r))} = <strong class="gold">₹ ${fmt(Math.round(recvVal(r)))}</strong></span></div>`).join(''):''}
    </div>`; }).join('')||'<span class="muted" style="font-size:12px">no entries</span>';
  let royalHtml='';
  if(look==='donut'){
    royalHtml=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">${pieCard('rvC1','🥇 Group-wise value',legend)}
      <div class="card" style="flex:1.3;min-width:260px"><div class="card-head"><h3 style="${SER};color:var(--gold)">Group-wise value — click a group</h3></div><div class="card-body">${topLedger}</div></div></div>`;
  } else if(look==='trend'){
    royalHtml=`<div class="card" style="margin-bottom:14px"><div class="card-head"><h3 style="${SER};color:var(--gold)">🥂 Receive value — trend (₹/day)</h3></div>
      <div class="card-body"><div style="height:150px;position:relative"><canvas id="rvC2"></canvas></div></div></div>`;
  } else if(look==='tri'){
    royalHtml=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      ${pieCard('rvC3','Matched vs Unmatched (qty)','' ,100)}
      ${pieCard('rvC4','Top group share (₹)','',100)}
      <div class="card" style="flex:1.3;min-width:240px"><div class="card-head"><h3 style="${SER};color:var(--gold)">By day (₹)</h3></div>
        <div class="card-body"><div style="height:110px;position:relative"><canvas id="rvC7"></canvas></div></div></div></div>`;
  } else if(look==='gauge'){
    const pct=totalVal? Math.round(mVal/totalVal*100):0;
    royalHtml=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      <div class="card" style="width:250px;flex:none"><div class="card-head"><h3 style="${SER};color:var(--gold)">👑 Matched value</h3></div>
        <div class="card-body" style="text-align:center"><div style="height:110px;position:relative"><canvas id="rvC5"></canvas></div>
        <div style="${SER};font-size:22px;color:var(--gold);margin-top:-34px">${pct}%</div><div class="muted" style="font-size:11px">of ₹ ${fmt(totalVal)}</div></div></div>
      <div class="card" style="flex:1;min-width:280px"><div class="card-head"><h3 style="${SER};color:var(--gold)">Royal Receive Book</h3></div><div class="card-body">${topLedger}</div>
        <div class="card-body" style="border-top:1px solid var(--gold-dim);display:flex;justify-content:space-between"><span class="muted" style="${SER}">GRAND TOTAL</span><strong class="gold" style="${SER};font-size:16px">₹ ${fmt(totalVal)}</strong></div></div></div>`;
  } else if(look==='register'){
    royalHtml=`<div class="card" style="margin-bottom:14px"><div class="card-body" style="text-align:center;border-bottom:1px solid var(--gold)">
        <div style="${SER};font-size:10px;letter-spacing:3px;color:var(--text-dim);text-transform:uppercase">— ${esc(cfg.company||'Traffic Gastropub')} · Receive Register —</div>
        <div style="${SER};font-size:26px;color:var(--text);margin-top:4px">₹ ${fmt(totalVal)}</div>
        <div class="muted" style="font-size:11px"><strong class="gold">${fmt(total)} bot.</strong> · total landing amount · ${period.from} → ${period.to}</div></div>
      <div class="card-body" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
        <div style="flex:1.4;min-width:240px">${topLedger}</div>
        <div style="width:150px;flex:none;text-align:center"><div style="width:110px;height:110px;margin:0 auto;position:relative"><canvas id="rvC1"></canvas></div>
          <div style="height:40px;position:relative;margin-top:8px"><canvas id="rvC6"></canvas></div></div></div></div>`;
  }
  return `
    <div class="page-head"><div><h1>Purchase</h1><p>Upload the liquor-receive Excel (auto-reads <strong>Date · Item · Qty</strong>); group matched from Item Master. Unmatched names turn red — add them to Item Master.</p></div>
      <div class="page-actions">
        <select class="input" style="width:auto;padding:6px 9px;font-size:12px" title="Royal look" onchange="setRecvLook(this.value)">
          ${[['def','① Default'],['donut','② Royal Donut'],['trend','③ Champagne Trend'],['tri','④ Imperial Tri-Chart'],['gauge','⑤ Crown Gauge'],['register','⑥ Monogram Register']].map(o=>`<option value="${o[0]}" ${look===o[0]?'selected':''}>${o[1]}</option>`).join('')}
        </select>
        <label class="btn btn-sm btn-gold" style="cursor:pointer" title="Upload the WBSBCL BEVCO invoice PDF — items, MRP & fees auto-read">🧾 BEVCO Invoice<input type="file" accept=".pdf" multiple style="display:none" onchange="bevcoUpload(this)"></label>
        <button class="btn btn-sm" onclick="bevcoList()">📜 Invoices${invoices.length?' ('+invoices.length+')':''}</button>
        <label class="btn btn-sm" style="cursor:pointer">📂 Upload Excel/CSV<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="uploadReceived(this)"></label>
        <button class="btn btn-sm" onclick="openRecvAdd()">＋ Add</button>
        <button class="btn btn-sm" onclick="openCashInv()" title="Photograph a shop bill — number, date, items, rates and quantities are read and shown for checking">📷 Cash Invoice</button>
        <button class="btn btn-sm" onclick="expReport('recv','xlsx')" title="Download this sheet as Excel">📊 Excel</button>
        <button class="btn btn-sm" onclick="printSheet('recv')" title="Clean print of this sheet — Save as PDF from the dialog">🖨 Print</button>
        ${nCash?`<button class="btn btn-danger btn-sm" onclick="clearCashRecv()" title="Delete every cash purchase entry — BEVCO entries stay">🗑️ Clear cash (${nCash})</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="clearAllRecv()">🗑️ Clear All</button></div></div>
    ${periodBar()}
    ${(()=>{ // royal head (v2.32.0) — same figures the old stat strip showed, plus honest sub-lines; nothing recomputed differently
      const nInv=new Set(receivedStock.map(r=>r.inv).filter(Boolean)).size;
      const nGrp=new Set(receivedStock.filter(r=>inRaw(r.item)).map(r=>findRaw(r.item).group)).size;
      const ds=receivedStock.map(r=>r.date).filter(Boolean).sort(); const span=ds.length?`${ds[0]} → ${ds[ds.length-1]}`:'';
      const pct=totalVal>0?Math.round(mVal/totalVal*100):100;   // share of the landing value that is matched to Item Master
      const avg=total>0?totalVal/total:0;
      return `<div class="card lrflow rvflow">
      <div class="lrf-head"><div class="t">Purchase</div><div class="f">Landing Amount <b>=</b> Bottles <b>×</b> Landing ₹/bottle <span class="p">· invoice fees included${span?' · '+esc(span):''}</span></div></div>
      <div class="lrf-body">
        <div class="lrf-steps">
          <div class="st"><div class="ic">🧾</div><div class="l">Invoices</div><div class="v">${fmt(nInv)}<small>nos</small></div><div class="m sub">${invoices.length?fmt(invoices.length)+' in register':'BEVCO PDF → auto'}</div></div>
          <div class="arr">›</div>
          <div class="st"><div class="ic">📋</div><div class="l">Entries</div><div class="v">${fmt(receivedStock.length)}<small>rows</small></div><div class="m sub">${fmt(nGrp)} group${nGrp===1?'':'s'}</div></div>
          <div class="arr">›</div>
          <div class="st rv"><div class="ic">🍾</div><div class="l">Bottles Received</div><div class="v">+${fmt(total)}<small>btl</small></div><div class="m ${unmatched?'bad':'ok'}">${unmatched?fmt(unmatched)+' unmatched — fix in red':'all matched to Item Master'}</div></div>
          <div class="arr">=</div>
          <div class="st cl"><div class="ic">♛</div><div class="l">Total Purchase</div><div class="v amt">₹ ${fmt(Math.round(totalVal))}</div><div class="m">🧾 BEVCO ₹ ${fmt(Math.round(bevVal))} <b style="color:var(--gold)">+</b> 💵 Cash ₹ ${fmt(Math.round(cashVal))}</div></div>
        </div>
        <div class="lrf-ring"><div class="ring" style="--pct:${pct}"><div class="in"><div class="k">Purchase value</div><div class="amt">₹ ${fmt(Math.round(totalVal))}</div><div class="k2">${fmt(total)} bottles · avg ₹ ${fmt(Math.round(avg))}</div><div class="k3 ${pct>=100?'ok':'bad'}">${pct}% matched</div></div></div></div>
      </div>
    </div>`; })()}
    ${royalHtml}
    ${DUP.n?`<div class="card noprint" style="margin-bottom:10px;border-color:var(--${DUP.nDup||DUP.n>DUP.nColl?'red':'amber'})"><div class="card-body" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 14px;font-size:12px"><span style="color:var(--${DUP.nDup?'red':'amber'});font-weight:700">⚠ ${DUP.n} entr${DUP.n===1?'y needs':'ies need'} a look</span><span class="muted">${DUP.nDup?DUP.nDup+' entered twice (same bill / invoice no + item + rate) — ✕ the extra one':''}${DUP.nDup&&DUP.nColl?' · ':''}${DUP.nColl?DUP.nColl+' on one invoice share ONE Item Master name at different landed rates — two different BEVCO products mapped onto the same name (e.g. Old No. 7 and Gentleman Jack); give each its own':''}${(DUP.nDup||DUP.nColl)&&DUP.n>DUP.nDup+DUP.nColl?' · ':''}${DUP.n>DUP.nDup+DUP.nColl?(DUP.n-DUP.nDup-DUP.nColl)+' with the same day · item · qty and no bill no':''}.</span>${DUP.nColl?`<button class="btn btn-gold btn-sm" onclick="recvCollFix()">🔧 Fix names</button>`:''}<button class="btn btn-sm" style="background:var(--${DUP.nDup?'red':'amber'});color:#fff;border-color:transparent" onclick="recvFilter='dup';route()">Show them</button></div></div>`:''}
    <div class="tabs">${ft('all','All ('+receivedStock.length+')')}${ft('ok','✅ Matched')}${ft('un','🔴 Unmatched ('+unmatched+')')}${DUP.n?ft('dup','⚠ Duplicates ('+DUP.n+')'):''}<span class="tabsep"></span>${fs('all','Both')}${fs('bevco','🧾 BEVCO ('+nBev+' · ₹ '+fmt(Math.round(bevVal))+')')}${fs('cash','💵 Cash ('+nCash+' · ₹ '+fmt(Math.round(cashVal))+')')}</div>
    <div class="card barinv recvtbl"><div class="card-head" style="flex-wrap:wrap;gap:8px"><div><h3>Purchase Register</h3><p>${rows.length} shown${iq.rv?' (filtered)':''}${flat?'':' · grouped by invoice'}</p></div>
      <div class="search" style="width:280px">🔎<input id="searchBox" placeholder="Search item / invoice / bill no…" value="${esc(iq.rv||'')}" oninput="isearch('rv',this.value)" title="Matches the item name, the invoice / bill number (or its last part) and the shop"></div></div>
      <div class="table-wrap" style="max-height:540px;overflow-y:auto"><table class="tbl rawhead">
      <thead><tr><th style="width:124px">Date</th><th style="width:150px">Source · Invoice / Bill No</th><th>Item</th><th style="width:150px">Group / Match</th><th class="right" style="width:76px">Bottles</th><th class="right" style="width:66px">MRP ₹</th><th class="right nowrap" style="width:96px">Landing ₹/bot</th><th class="right nowrap" style="width:118px">Landing Amount ₹</th><th style="width:110px"></th></tr></thead>
      <tbody>${body}</tbody>${rawNamesDatalist()}
      <tfoot>${(()=>{ const sb=rows.filter(x=>recvSrc(x.r)==='bevco'), sc=rows.filter(x=>recvSrc(x.r)==='cash'); if(!sb.length||!sc.length) return '';
        const line=(lbl,arr)=>`<tr class="lrsub rvsplit"><td colspan="4" class="right">${lbl}</td><td class="num">+${fmt(arr.reduce((a,x)=>a+fnum(x.r.qty),0))}</td><td colspan="2"></td><td class="num">₹ ${fmt(Math.round(arr.reduce((a,x)=>a+recvVal(x.r),0)))}</td><td></td></tr>`;
        return line('🧾 BEVCO',sb)+line('💵 Cash',sc); })()}<tr class="lrsub" style="position:sticky;bottom:0"><td colspan="4" class="right"><strong>${rows.some(x=>recvSrc(x.r)==='cash')&&rows.some(x=>recvSrc(x.r)==='bevco')?'GRAND TOTAL (BEVCO + Cash)':'TOTAL'}${rows.length!==receivedStock.length?' (shown)':''}</strong></td><td class="num"><strong class="lrsg ${rows.length?'plus':'zero'}">${rows.length?'+':''}${fmt(rows.reduce((a,x)=>a+fnum(x.r.qty),0))}</strong></td><td colspan="2" class="right muted" style="font-size:10.5px">landing amount</td><td class="num"><strong class="lrval">₹ ${fmt(Math.round(shownVal))}</strong></td><td></td></tr></tfoot>
      </table></div></div>`;
};
function setRecvLook(v){ pref.recvLook=v; bsv('pref',pref); route(); }
AFTER.received = () => {
  if(typeof Chart==='undefined') return;
  const byGroup={}, byDay={}; let mVal=0, tVal=0, mQty=0, uQty=0;
  receivedStock.forEach(r=>{ const ok=inRaw(r.item); const v=recvVal(r);
    const g=ok?findRaw(r.item).group:'⚠ unmatched'; byGroup[g]=(byGroup[g]||0)+v;
    const d=r.date||'—'; byDay[d]=(byDay[d]||0)+v; tVal+=v;
    if(ok){ mVal+=v; mQty+=fnum(r.qty); } else uQty+=fnum(r.qty); });
  const gTop=Object.entries(byGroup).sort((a,b)=>b[1]-a[1]);
  const days=Object.keys(byDay).sort();
  const GOLDS=['#d8bd7f','#b89a5c','#8a6d3b','#6b5836','#5c4a28','#3a2f1c','#2a2620'];
  const mk=(id,cfg)=>{ const el=$('#'+id); if(el) CHARTS.push(new Chart(el,cfg)); };
  const noleg={plugins:{legend:{display:false}},responsive:true,maintainAspectRatio:false};
  mk('rvC1',{type:'doughnut',data:{labels:gTop.slice(0,6).map(g=>g[0]).concat(gTop.length>6?['Others']:[]),
    datasets:[{data:gTop.slice(0,6).map(g=>Math.round(g[1])).concat(gTop.length>6?[Math.round(gTop.slice(6).reduce((a,g)=>a+g[1],0))]:[]),
    backgroundColor:GOLDS,borderColor:'#161a23',borderWidth:2}]},options:{...noleg,cutout:'62%'}});
  mk('rvC2',{type:'line',data:{labels:days,datasets:[{data:days.map(d=>Math.round(byDay[d])),borderColor:'#d8bd7f',
    backgroundColor:'rgba(216,189,127,.15)',fill:true,tension:.35,pointRadius:2,pointBackgroundColor:'#d8bd7f'}]},
    options:{...noleg,scales:{x:{ticks:{color:'#8a8272',font:{size:9}},grid:{display:false}},y:{ticks:{color:'#8a8272',font:{size:9}},grid:{color:'rgba(138,130,114,.12)'}}}}});
  mk('rvC3',{type:'doughnut',data:{labels:['Matched','Unmatched'],datasets:[{data:[mQty,uQty],
    backgroundColor:['#4ecf9d','#d96a5c'],borderColor:'#161a23',borderWidth:2}]},options:{...noleg,cutout:'62%'}});
  mk('rvC4',{type:'doughnut',data:{labels:[gTop.length?gTop[0][0]:'—','Others'],
    datasets:[{data:[gTop.length?Math.round(gTop[0][1]):0, Math.round(gTop.slice(1).reduce((a,g)=>a+g[1],0))],
    backgroundColor:['#d8bd7f','#3a2f1c'],borderColor:'#161a23',borderWidth:2}]},options:{...noleg,cutout:'62%'}});
  mk('rvC5',{type:'doughnut',data:{labels:['Matched','Rest'],datasets:[{data:[Math.round(mVal),Math.max(0,Math.round(tVal-mVal))],
    backgroundColor:['#d8bd7f','#2a2620'],borderColor:'#161a23',borderWidth:2}]},
    options:{...noleg,cutout:'72%',rotation:270,circumference:180}});
  mk('rvC6',{type:'line',data:{labels:days,datasets:[{data:days.map(d=>Math.round(byDay[d])),borderColor:'#d8bd7f',
    backgroundColor:'rgba(216,189,127,.12)',fill:true,tension:.35,pointRadius:0}]},
    options:{...noleg,scales:{x:{display:false},y:{display:false}}}});
  mk('rvC7',{type:'bar',data:{labels:days,datasets:[{data:days.map(d=>Math.round(byDay[d])),
    backgroundColor:days.map((d,i)=>i===days.length-1?'#d8bd7f':'#3a2f1c'),borderRadius:3}]},
    options:{...noleg,scales:{x:{ticks:{color:'#8a8272',font:{size:9}},grid:{display:false}},y:{ticks:{color:'#8a8272',font:{size:9}},grid:{color:'rgba(138,130,114,.12)'}}}}});
};
function clearAllRecv(){ modal('Clear All Purchases', `<p>Delete <strong>all ${receivedStock.length}</strong> purchase entries${(typeof invoices!=='undefined'&&invoices.length)?' and the <strong>'+invoices.length+'</strong> invoices in the BEVCO register':''}? This cannot be undone.</p><p class="muted" style="font-size:11.5px">The register goes with the entries, so the same PDFs can be imported again afterwards (they would otherwise be skipped as “already in the register”).</p>`,
  `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" style="background:var(--red);color:#fff" onclick="receivedStock=[];bsv('recv',receivedStock);if(typeof invoices!=='undefined'){invoices=[];bsv('invoices',invoices);}closeModal();route();toast('Cleared','All purchases and the invoice register removed','err')">Clear All</button>`); }
/* ---- MR by Photo — upload a handwritten MR/issue slip → read/confirm → add MR issues ---- */
let photoRecv=null;
function openPhotoRecv(){ if(!photoRecv) photoRecv={img:'', date:period.from, rows:[{item:'',qty:''}]};
  modal('📷 MR by Photo', photoRecvBody(), photoRecvFoot()); }
function photoRecvBody(){
  if(!photoRecv.img){
    return `<label class="btn btn-gold" style="cursor:pointer">📁 Choose / Capture photo<input type="file" accept="image/*" capture="environment" style="display:none" onchange="photoRecvLoad(this)"></label>
      <p class="muted" style="font-size:11.5px;margin-top:12px;line-height:1.6">Snap the handwritten MR slip, then read it and enter the items — names auto-match to Item Master; confirm to issue (Liquor Room → Bar).<br>⚠️ True auto-reading of handwriting (AI vision) needs the online app; for now you confirm/type from the photo.</p>`;
  }
  return `${rawNamesDatalist()}
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:210px"><img src="${photoRecv.img}" style="max-width:100%;border-radius:10px;border:1px solid var(--border)">
        <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
          <label class="btn btn-sm" style="cursor:pointer">🔄 Change<input type="file" accept="image/*" capture="environment" style="display:none" onchange="photoRecvLoad(this)"></label>
          <button class="btn btn-sm" onclick="photoRecvOpenTab()" title="Opens the photo in a new tab — right-click there → Search with Google Lens">🔍 Open in Lens</button></div></div>
      <div style="flex:1.2;min-width:260px">
        <div class="field"><label>Date</label><input class="input" type="date" value="${photoRecv.date||period.from}" onchange="photoRecvSet('date',this.value)"></div>
        <div class="field"><label>🎯 Most accurate: <strong>🔍 Open in Lens</strong> → right-click the photo in the new tab → “Search with Google Lens” → Select text → Copy → paste below (auto-parses)</label>
          <textarea class="input" id="prPaste" style="height:56px;font-size:11.5px" placeholder="Paste the Lens-copied text here…" onpaste="setTimeout(photoRecvParse,80)"></textarea></div>
        <button class="btn btn-sm btn-block" id="prAutoBtn" onclick="photoRecvAuto()" style="margin-bottom:10px" title="Free OCR — less accurate on handwriting">🤖 Auto-read (free OCR)</button>
        <label class="muted" style="font-size:12px">Items (check & correct)</label>
        <div id="prRows" class="mt-8">${photoRecvRows()}</div>
        <button class="btn btn-sm mt-8" onclick="photoRecvAddRow()">＋ Add row</button>
      </div></div>`;
}
function photoRecvRowHtml(i,r){
  const rr=r.item?findRaw(r.item):null;
  const lr=rr?(fnum(invGet(rr.item).lrOpen)+receivedForItem(rr.item)-issuedForItem(rr.item)):null;
  const hint=r.item?(rr?`<span class="muted" style="font-size:10px;width:56px;text-align:right;flex:none" title="Liquor Room stock now">LR ${fmt(lr)}</span>`
                       :`<span style="font-size:10px;width:56px;text-align:right;flex:none;color:var(--red)" title="Not in Item Master — fix the name">✕ fix</span>`):'<span style="width:56px;flex:none"></span>';
  const sug=(r.item&&!rr)?mrVoiceClosest(r.item).slice(0,2):[];
  const chips=sug.length?`<div style="margin:-3px 0 7px 2px">${sug.map(n=>`<button class="btn btn-sm" style="font-size:10px;padding:2px 8px;margin-right:4px" onclick='photoRecvPickSug(${i},${JSON.stringify(n)})'>→ ${esc(n)}</button>`).join('')}</div>`:'';
  return `<div><div class="rline" style="gap:6px;margin-bottom:6px;align-items:center">
    <input class="input" style="flex:1;${r.item&&!rr?'border-color:var(--red);color:var(--red)':''}" list="rawItems" value="${esc(r.item||'')}" placeholder="item name…" onchange="photoRecvRowSet(${i},'item',this.value)">
    ${hint}
    <input class="input" style="width:60px" type="number" value="${r.qty||''}" placeholder="qty" onchange="photoRecvRowSet(${i},'qty',this.value)">
    ${photoRecv.rows.length>1?`<button class="btn btn-danger btn-sm" onclick="photoRecvDelRow(${i})">✕</button>`:''}
  </div>${chips}</div>`;
}
function photoRecvPickSug(i,name){ if(!photoRecv.rows[i]) return; photoRecv.rows[i].item=name; const el=$('#prRows'); if(el) el.innerHTML=photoRecvRows(); }
function photoRecvRows(){ return photoRecv.rows.map((r,i)=>photoRecvRowHtml(i,r)).join(''); }
// parse pasted OCR text (Google Lens etc): each line = [srno] NAME [UOM 750/330] [req] [issue] → item + qty(last small number)
function photoRecvParse(){
  const ta=$('#prPaste'); const txt=ta?String(ta.value):''; if(!txt.trim()){ toast('Empty','Paste the slip text first','err'); return; }
  const skip=/INDENT|SLIP|TRAFFIC|GASTROPUB|CITY CENTRE|DEPARTMENT|PARTICULAR|REQUISITION|RECEIVE|AUTHORIZE|ISSUE|FOR DATE|^DATE\b|KOL|UOM|SIGN/i;
  const out=[];
  txt.split(/\r?\n+/).forEach(line=>{
    let s=line.replace(/\t/g,'  ').trim(); if(!s||skip.test(s)) return;
    s=s.replace(/\b[oO](\d)/g,'0$1').replace(/(\d)[oO]\b/g,'$10');   // OCR O↔0 mixups (e.g. "O3" → "03")
    let sr=null; const mSr=s.match(/^\s*(\d{1,2})[).\s]+/);          // capture Sr-No → keeps the slip's serial order
    if(mSr){ sr=+mSr[1]; s=s.slice(mSr[0].length); }
    const nums=(s.match(/\d+/g)||[]).map(Number);
    let name=s.replace(/\d+/g,' ').replace(/[^A-Za-z&' ]/g,' ').replace(/\s+/g,' ').trim();
    if(name.replace(/[^A-Za-z]/g,'').length<4) return;               // too little text = junk line
    // Issue qty: never above 50 on a slip; also drop 750 broken into "7 50" by OCR
    const cand=[]; for(let k=0;k<nums.length;k++){ const n=nums[k];
      if(n<=0||n>50) continue;
      if(n===50&&k>0&&nums[k-1]===7) continue;                       // "7 50" = 750 UOM
      cand.push(n); }
    // a single number that is a bottle/keg size (30/60/90…) is the UOM column, not the issue qty
    const UOMS=[30,60,90,180,275,300,330,375,500,650,700,750,1000];
    const qty=(cand.length===1 && nums.length===1 && UOMS.includes(cand[0])) ? '' :
              (cand.length?cand[cand.length-1]:'');                  // Issue = last sensible number
    // match against Raw Data (Liquor Room names): exact/contains first, then smart OCR-fuzzy
    let it='';
    const f=mrVoiceFind(name);
    if(f) it=f;
    else { const bm=bestRawMatch(name); it = bm.score>=0.5 ? bm.name : name.toUpperCase(); }
    out.push({item:it, qty, _sr:(sr!=null?sr:900+out.length)});
  });
  if(!out.length){ toast('No items','Could not read any item line','err'); return; }
  out.sort((a,b)=>a._sr-b._sr);                                      // slip serial-wise
  photoRecv.rows=out.map(r=>({item:r.item, qty:r.qty})).concat([{item:'',qty:''}]);
  const el=$('#prRows'); if(el) el.innerHTML=photoRecvRows();
  const un=photoRecv.rows.filter(r=>r.item&&!findRaw(r.item)).length;
  toast('Read',out.length+' item(s) filled'+(un?' · '+un+' red = fix the name':''), un?'err':'ok');
}
function photoRecvSet(f,v){ photoRecv[f]=v; }
function photoRecvRowSet(i,f,v){ if(!photoRecv.rows[i]) return; photoRecv.rows[i][f]=v;
  if(f==='item'){ if(v.trim() && i===photoRecv.rows.length-1) photoRecv.rows.push({item:'',qty:''});
    const el=$('#prRows'); if(el) el.innerHTML=photoRecvRows(); } }   // re-render → red/LR hint updates instantly
function photoRecvAddRow(){ photoRecv.rows.push({item:'',qty:''}); const el=$('#prRows'); if(el) el.insertAdjacentHTML('beforeend', photoRecvRowHtml(photoRecv.rows.length-1, photoRecv.rows[photoRecv.rows.length-1])); }
function photoRecvDelRow(i){ photoRecv.rows.splice(i,1); if(!photoRecv.rows.length) photoRecv.rows=[{item:'',qty:''}]; const el=$('#prRows'); if(el) el.innerHTML=photoRecvRows(); }
function photoRecvLoad(inp){ const f=inp.files&&inp.files[0]; if(!f) return; if(f.size>10*1024*1024){ toast('Too big','Max 10 MB image','err'); return; }
  const rd=new FileReader(); rd.onload=()=>{ photoRecv.img=rd.result; closeModal(); openPhotoRecv(); }; rd.readAsDataURL(f); }
// open the photo in a new tab — there the browser's right-click "Search with Google Lens" menu is available
function photoRecvOpenTab(){ if(!photoRecv||!photoRecv.img) return;
  fetch(photoRecv.img).then(r=>r.blob()).then(b=>{ const u=URL.createObjectURL(b); window.open(u,'_blank'); }).catch(()=>toast('Failed','Could not open image','err')); }
// TRUE auto-read: downscale on canvas → free online OCR (OCR.space, handwriting engine) → same parser
function photoRecvAuto(){
  if(!photoRecv||!photoRecv.img){ toast('No photo','Choose a photo first','err'); return; }
  const btn=$('#prAutoBtn'); if(btn){ btn.disabled=true; btn.textContent='⏳ Reading… (online)'; }
  const img=new Image();
  img.onload=()=>{
    const sc=Math.min(1, 1400/Math.max(img.width,img.height));
    const c=document.createElement('canvas'); c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    const fd=new FormData();
    fd.append('base64Image', c.toDataURL('image/jpeg',0.85));
    fd.append('OCREngine','2'); fd.append('scale','true'); fd.append('language','eng'); fd.append('isTable','true');
    fetch('https://api.ocr.space/parse/image',{method:'POST',headers:{apikey:(cfg&&cfg.ocrKey)||'helloworld'},body:fd})
      .then(r=>r.json())
      .then(j=>{
        const t=j&&j.ParsedResults&&j.ParsedResults[0]&&j.ParsedResults[0].ParsedText;
        if(btn){ btn.disabled=false; btn.textContent='🤖 Auto-read from photo (online)'; }
        if(!t){ toast('Could not read', ((j&&j.ErrorMessage&&String(j.ErrorMessage))||'Free OCR struggles with handwriting')+' — use Lens paste, or 📂 Excel / Paste on the MR page','err'); return; }
        const ta=$('#prPaste'); if(ta) ta.value=t;
        photoRecvParse();
      })
      .catch(()=>{ if(btn){ btn.disabled=false; btn.textContent='🤖 Auto-read from photo (online)'; }
        toast('Offline?','Auto-read needs internet — use Lens paste, or 📂 Excel / Paste (works offline)','err'); });
  };
  img.onerror=()=>{ if(btn){ btn.disabled=false; btn.textContent='🤖 Auto-read from photo (online)'; } toast('Bad image','Could not load the photo','err'); };
  img.src=photoRecv.img;
}
function photoRecvFoot(){ return `<button class="btn" onclick="closeModal()">Cancel</button>${photoRecv&&photoRecv.img?`<button class="btn btn-gold" onclick="photoRecvConfirm()">✅ Confirm & Add</button>`:''}`; }
function photoRecvConfirm(){
  const valid=photoRecv.rows.filter(r=>(r.item||'').trim() && (+r.qty>0));
  if(!valid.length){ toast('Nothing','Add at least one item + qty','err'); return; }
  let n=0, un=0;
  valid.forEach(r=>{ let it=r.item.trim().toUpperCase(); if(!findRaw(it)){ const c=mrVoiceClosest(it); if(c.length) it=c[0]; } const rr=findRaw(it); if(!rr) un++;
    mrDetail.push({date:photoRecv.date||period.from, group:rr?rr.group:'', item:it, qty:+r.qty}); n++; });
  bsv('mr',mrDetail); photoRecv=null; closeModal(); route();
  toast('Issued',`${n} MR issue(s) added${un?' · '+un+' unmatched (red)':''}`, un?'err':'ok');
}
// Add an unmatched received item into Raw Data (and thus Liquor Room) via a popup
function openAddToRaw(item){
  const sizeM=(item.match(/(\d{2,5})\s*ML/i)||[])[1]; const sz=sizeM?sizeM+' ML':'750 ML';
  const cats=['IMFL WHISKY','OS WHISKY','OSBI WHISKY','IMFL VODKA','OS VODKA','IMFL RUM','OS RUM','IMFL GIN','IMFL GIN &LIQ','OS GIN &LIQ','IMFL BRANDY','OS BRANDY','IMFL BEER','BEER','DRAUGHT BEER','WINE','BREEEZER'];
  modal('Add to Item Master', `
    <div class="field"><label>Item</label><input class="input" id="arItem" value="${esc(item)}"></div>
    <div class="form-grid">
      <div class="field"><label>Category</label><select class="input" id="arCat" onchange="arGroupSuggest()">${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Unit</label><select class="input" id="arUnit"><option>ML</option><option>PCS</option></select></div>
    </div>
    <div class="field"><label>Group (auto from category — editable, can be new)</label><input class="input" id="arGroup" value=""></div>
    <p class="muted" style="font-size:11.5px">Example group: <code>OS WHISKY 750 ML</code>, <code>IMFL GIN 350 ML</code>. Adds to Item Master → shows in Liquor Room & matches automatically.</p>
    <input type="hidden" id="arSize" value="${sz}">`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="saveAddToRaw()">Add to Item Master</button>`);
  arGroupSuggest();
}
function arGroupSuggest(){ const cat=$('#arCat').value, sz=$('#arSize').value; $('#arGroup').value=(cat+' '+sz).replace(/\s+/g,' ').trim(); }
function saveAddToRaw(){ const item=$('#arItem').value.trim().toUpperCase(), group=$('#arGroup').value.trim().toUpperCase()||'(UNGROUPED)';
  if(!item){ toast('Item?','Enter item','err'); return; }
  if(!inRaw(item)) rawData.push({item, group}); saveRaw();
  closeModal(); route(); toast('Added to Item Master',`${item} · ${group} — now matches everywhere`,'ok'); }
function uploadReceived(inp){
  const f=inp.files[0]; if(!f) return;
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page (xlsx.full.min.js)','err'); inp.value=''; return; }
  const reader=new FileReader();
  reader.onload=e=>{ try{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
    const grid=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,blankrows:false});
    let hdr=-1, ci={};
    for(let r=0;r<Math.min(grid.length,20);r++){ const row=(grid[r]||[]).map(x=>norm(x));
      let it=row.findIndex(x=>/(^ITEM|PRODUCT|DESCRIPTION|BRAND)/.test(x)&&!/SUPPLIER/.test(x));
      if(it<0) it=row.findIndex(x=>/NAME/.test(x)&&!/SUPPLIER/.test(x));
      const q=row.findIndex(x=>/(^QTY|QUANTITY|^NOS)/.test(x));
      const d=row.findIndex(x=>/DATE/.test(x));
      const g=row.findIndex(x=>/(GROUP|CATEGORY)/.test(x));
      if(it>-1&&q>-1){ hdr=r; ci={d,it,q,g}; break; } }
    const C = hdr>-1 ? ci : {d:1,it:3,q:6,g:-1};   // positional fallback for the BEVCO report layout
    let added=0; const start=hdr>-1?hdr+1:0;
    for(let r=start;r<grid.length;r++){ const row=grid[r]||[];
      const item=(row[C.it]??'').toString().trim().toUpperCase(); if(!item||/^ITEM$/i.test(item)) continue;
      const qty=parseFloat((row[C.q]??'').toString().replace(/[^\d.\-]/g,'')); if(isNaN(qty)||qty===0) continue;
      const grp = (C.g>-1 ? (row[C.g]??'').toString().trim().toUpperCase() : '') || (findRaw(item)?findRaw(item).group:'');
      receivedStock.push({ date:excelDate(row[C.d]), item, qty, group:grp }); added++; }
    bsv('recv',receivedStock); inp.value=''; route();
    const um=receivedStock.filter(r=>!inRaw(r.item)).length;
    if(added) toast('Imported',`${added} rows · ${um?um+' unmatched (red)':'all matched Item Master'}`,'ok');
    else toast('Nothing added','Could not detect Item/Qty columns','err');
  }catch(err){ inp.value=''; toast('Upload failed', String(err.message||err),'err'); } };
  reader.readAsArrayBuffer(f);
}
/* ---- manual purchase entry: one bill, several item lines (v2.41.0) ----
   Date · Purchased from · Invoice/Bill no are the bill's; under them one row per item (item · qty · MRP · landing),
   ＋ Add item for the next line, one Add saves every row as its own entry sharing date/source/bill no. A row whose
   bill no + item already exists in the register is a double entry: the save asks first (see recvDupInfo). */
var _rcSrc='bevco', _rcRows=null, _rcHead=null;
function _rcNewRow(){ return {item:'', qty:1, mrp:'', land:''}; }
function openRecvAdd(){ _rcSrc='cash'; _rcRows=[_rcNewRow()]; _rcHead={date:period.from, inv:''}; recvAddRender(); }   // a hand-typed bill is a cash buy by default (client, 2026-09-19); BEVCO is the switch
function recvAddBody(){
  const H=_rcHead, rows=_rcRows.map((r,i)=>`<tr>
      <td class="muted num" style="width:26px">${i+1}</td>
      <td><input class="cell-input" id="rcIt${i}" list="rawItems" style="width:100%;text-align:left${r.item&&!findRawExact(r.item)?';border-color:var(--red)':''}" value="${esc(r.item)}" placeholder="item name (Item Master)" title="${r.item&&!findRawExact(r.item)?'Not in the Item Master — it will be added':'Item Master name'}" onchange="rcRowSet(${i},'item',this.value)"></td>
      <td class="num"><input class="cell-input" id="rcQ${i}" style="width:56px" value="${esc(String(r.qty))}" placeholder="1" title="Bottles — 12+12 works" onchange="rcRowSet(${i},'qty',this.value)"></td>
      <td class="num"><input class="cell-input" id="rcM${i}" style="width:72px" value="${esc(String(r.mrp))}" placeholder="MRP" title="MRP ₹ per bottle — saved on the item" onchange="rcRowSet(${i},'mrp',this.value)"></td>
      <td class="num"><input class="cell-input" id="rcL${i}" style="width:80px" value="${esc(String(r.land))}" placeholder="landing" title="Landing ₹ per bottle — this entry's own rate" onchange="rcRowSet(${i},'land',this.value)"></td>
      <td class="num muted" id="rcAmt${i}" style="font-size:11px;white-space:nowrap">${(+r.qty>0&&+r.land>0)?'₹ '+fmt(Math.round(+r.qty*+r.land)):'—'}</td>
      <td style="width:34px">${_rcRows.length>1?`<button class="btn btn-danger btn-sm rmx" onclick="rcDelRow(${i})">✕</button>`:''}</td></tr>`).join('');
  return `<div class="form-grid" style="margin-bottom:10px">
      <div class="field"><label>Date</label><input class="input" type="date" id="rcDate" value="${esc(H.date||'')}" onchange="_rcHead.date=this.value"></div>
      <div class="field"><label>Purchased from</label><div class="seg" id="rcSrc"><button type="button" class="${_rcSrc==='bevco'?'on':''}" data-v="bevco" onclick="rcSrcSet('bevco')">🧾 BEVCO</button><button type="button" class="${_rcSrc==='cash'?'on':''}" data-v="cash" onclick="rcSrcSet('cash')">💵 Cash</button></div><div class="muted" style="font-size:11px;margin-top:4px"><a href="#" style="color:var(--gold)" onclick="closeModal();openCashInv();return false">📷 or read a cash bill from a photo</a></div></div>
      <div class="field full"><label id="rcInvL">${_rcSrc==='cash'?'Bill no (optional)':'Invoice no (optional)'}</label><input class="input" id="rcInv" value="${esc(H.inv||'')}" placeholder="${_rcSrc==='cash'?'shop bill / memo no':'BEVCO invoice no'}" onchange="_rcHead.inv=this.value.trim()"></div>
    </div>
    <div class="table-wrap" style="max-height:300px;overflow:auto"><table class="tbl" style="min-width:640px"><thead><tr><th>#</th><th>Item (matches Item Master)</th><th class="right">Qty</th><th class="right">MRP ₹</th><th class="right">Landing ₹/bot</th><th class="right">Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><button class="btn btn-sm" onclick="rcAddRow()">＋ Add item</button><span class="muted" id="rcSum" style="font-size:11px">${rcSumText()}</span></div>
    <div class="muted" style="font-size:11px;margin-top:8px">Landing ₹ is each line's own rate (Bottles × Landing = its amount). MRP typed here is saved on the item. The Item Master's own landing rate is not changed by a purchase.</div>
    ${rawNamesDatalist()}`;
}
function rcSumText(){ return `${_rcRows.length} line${_rcRows.length===1?'':'s'} on this bill · ₹ ${fmt(Math.round(_rcRows.reduce((a,r)=>a+((+r.qty>0&&+r.land>0)?+r.qty*+r.land:0),0)))}`; }
function rcAddLabel(){ const n=_rcRows.filter(r=>r.item&&+evalNum(r.qty)>0).length; return 'Add'+(n>1?' '+n+' items':''); }
function recvAddFoot(){ return `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" id="rcAddBtn" onclick="saveRecvAdd()">${rcAddLabel()}</button>`; }
function recvAddRender(focusRow){ const had=!!document.querySelector('.modal-back'); if(had) closeModal(); modal('Add Purchase Entry', recvAddBody(), recvAddFoot());
  const ms=document.querySelectorAll('.modal-back'); const m=ms.length&&ms[ms.length-1].querySelector('.modal'); if(m) m.classList.add('xwide');
  if(focusRow!=null){ const inp=document.querySelectorAll('#modalBack tbody tr')[focusRow]; const f=inp&&inp.querySelector('input'); if(f) f.focus(); } }
function rcSrcSet(v){ _rcSrc=v==='cash'?'cash':'bevco'; recvAddRender(); }
function rcAddRow(){ _rcRows.push(_rcNewRow()); recvAddRender(_rcRows.length-1); }
function rcDelRow(i){ _rcRows.splice(i,1); if(!_rcRows.length) _rcRows.push(_rcNewRow()); recvAddRender(); }
// picking an item prefills MRP + landing from what the system already knows (only into boxes still empty)
function rcRowSet(i,f,v){ const r=_rcRows[i]; if(!r) return;
  if(f==='item'){ r.item=String(v||'').trim().toUpperCase(); const ex=findRawExact(r.item)||findRaw(r.item);
    if(ex){ const iv=invGet(ex.item); if(r.mrp==='' && iv.mrp!=null && iv.mrp!=='') r.mrp=iv.mrp; if(r.land==='' && landOf(ex.item)>0) r.land=Math.round(landOf(ex.item)*100)/100;
      const m=$('#rcM'+i), l=$('#rcL'+i); if(m&&m.value==='') m.value=r.mrp; if(l&&l.value==='') l.value=r.land; }
    const it=$('#rcIt'+i); if(it) it.style.borderColor=(r.item&&!findRawExact(r.item))?'var(--red)':''; }
  else if(f==='qty'){ const n=evalNum(v); r.qty=(n===''||isNaN(+n))?'':+n; const q=$('#rcQ'+i); if(q&&r.qty!=='') q.value=r.qty; }
  else r[f]=String(v||'').trim();
  // patch in place — a re-render here would steal the focus from the field the person is tabbing to
  const a=$('#rcAmt'+i); if(a) a.textContent=(+r.qty>0&&+r.land>0)?'₹ '+fmt(Math.round(+r.qty*+r.land)):'—';
  const sm=$('#rcSum'); if(sm) sm.textContent=rcSumText(); const b=$('#rcAddBtn'); if(b) b.textContent=rcAddLabel(); }
function rcItemPick(){}   // kept for old onclick strings
function saveRecvAdd(force){
  const H=_rcHead||{}; const inv=String(($('#rcInv')||{}).value||H.inv||'').trim(); const date=String(($('#rcDate')||{}).value||H.date||'').trim();
  const rows=_rcRows.map(r=>({...r, item:String(r.item||'').trim().toUpperCase(), qty:+evalNum(r.qty)||0})).filter(r=>r.item&&r.qty>0);
  if(!rows.length){ toast('Item?','Type at least one item with a quantity','err'); return; }
  if(!force && inv){ const d=recvDupCheck(inv, rows.map(r=>r.item)); if(d.length){ confirmAsk(`This ${_rcSrc==='cash'?'bill':'invoice'} <strong>${esc(inv)}</strong> already has <strong>${d.map(esc).join(', ')}</strong> in the register — adding again would be a <span style="color:var(--red)">double entry</span>. Add anyway?`, ()=>saveRecvAdd(true)); return; } }
  let added=0, total=0;
  rows.forEach(r=>{ const g=findRaw(r.item)?findRaw(r.item).group:'';
    const e={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6), date, item:r.item, qty:r.qty, group:g};
    if(_rcSrc==='cash') e.src='cash'; if(inv) e.inv=inv;
    if(r.land!=='' && !isNaN(+r.land)) e.land=Math.round(+r.land*10000)/10000;
    if(r.mrp!=='' && !isNaN(+r.mrp)){ e.mrp=+r.mrp; invSet(r.item,'mrp',+r.mrp); }       // MRP is the bottle's printed price → the item's
    receivedStock.push(e); added++; total+=r.qty*(e.land!=null?e.land:landOf(r.item)); });
  _recvRateDrop(); bsv('recv',receivedStock); closeModal(); _rcRows=null; route();
  toast('Added', added+' '+(_rcSrc==='cash'?'💵 cash':'🧾 BEVCO')+' purchase line'+(added===1?'':'s')+(inv?' on '+inv:'')+' · ₹ '+fmt(Math.round(total)), rows.every(r=>inRaw(r.item))?'ok':'err'); }
/* ---- double entries (v2.41.0) ----
   Same bill / invoice number + same item twice = a double entry (red). Without a bill number the app can only
   suspect: same date, item, quantity and source as another entry (amber). Shown on the rows, counted in a red card
   above the register with a Duplicates filter, and asked about before a manual or photo save. */
function recvDupCheck(inv, items){ const k=String(inv||'').trim(); if(!k) return []; const want=new Set(items.map(norm));
  return receivedStock.filter(r=>r.inv&&String(r.inv).trim()===k&&want.has(norm(r.item))).map(r=>r.item).filter((x,i,a)=>a.indexOf(x)===i); }
function recvDupInfo(){
  const byInv={}, byDay={}; const info={};
  receivedStock.forEach((r,i)=>{ const it=norm(r.item); if(r.inv){ const k=String(r.inv).trim()+''+it; (byInv[k]=byInv[k]||[]).push(i); }
    const d=(r.date||'')+''+it+''+fnum(r.qty)+''+recvSrc(r); (byDay[d]=byDay[d]||[]).push(i); });
  // same bill + same item twice: identical landed rates = the same line entered twice (dup, red); different rates = two
  // different BEVCO products mapped onto ONE Item Master name (coll, amber → 🔧 Fix names) (v2.47.0)
  const groups=[];
  Object.values(byInv).forEach(ix=>{ if(ix.length>1){ const rates=new Set(ix.map(i=>Math.round(fnum(receivedStock[i].land)*100))); const kind=rates.size>1?'coll':'dup';
    ix.forEach(i=>{ info[i]=kind; }); groups.push({ix, kind, inv:String(receivedStock[ix[0]].inv).trim(), item:receivedStock[ix[0]].item}); } });
  Object.values(byDay).forEach(ix=>{ if(ix.length>1 && ix.some(i=>!receivedStock[i].inv)) ix.forEach(i=>{ if(!info[i]) info[i]='maybe'; }); });
  const vals=Object.values(info);
  return {info, groups, n:vals.length, nDup:vals.filter(v=>v==='dup').length, nColl:vals.filter(v=>v==='coll').length};
}
/* ---- two BEVCO products on one Item Master name (v2.47.0) ----
   BEVCO lists a product once per invoice, so the same name twice on one invoice at different landed rates means two
   different products were mapped onto one name (JACK DANIEL'S OLD NO. 7 and GENTLEMAN JACK → JACK DANIELS WHISKY 750ML).
   The invoice register still holds each line's BEVCO name; an entry is matched to its line by landed rate. The modal
   shows both, suggests a house name for each (the matcher — the weaker line takes the alternative when both would land
   on one name), and on save moves the entry to that name, remembers the mapping (bevmap) and creates the item when new. */
var _rcColl=null;
function _recvInvLines(inv){ const reg=invoices.find(v=>String(v.no||'').trim()===String(inv||'').trim()); if(!reg||!reg.items) return [];
  const grand=(reg.fees&&reg.fees.total)||(reg.calc&&reg.calc.total)||0, base=(reg.calc&&reg.calc.base)||0; const factor=(base>0&&grand>0)?grand/base:1;
  return reg.items.map(x=>({name:x.name, bots:x.bots, mrp:x.mrp, amount:x.amount, rate:Math.round(x.amount*factor/(x.bots||1)*100)/100})); }
function recvCollFix(){
  const D=recvDupInfo(); const groups=D.groups.filter(g=>g.kind==='coll'); if(!groups.length){ toast('Nothing to fix','No invoice carries two products on one name','ok'); return; }
  const rows=[]; groups.forEach(g=>{ const lines=_recvInvLines(g.inv); const used=new Set();
    g.ix.forEach(i=>{ const r=receivedStock[i]; const rate=Math.round(fnum(r.land)*100);
      const ln=lines.find(l=>!used.has(l) && Math.round(l.rate*100)===rate) || null; if(ln) used.add(ln);
      rows.push({i, inv:g.inv, item:r.item, qty:r.qty, land:r.land, line:ln?ln.name:'', mrp:ln?ln.mrp:'', sug:r.item, m:null}); }); });
  rows.forEach(r=>{ if(!r.line) return; const m=bevcoMatch(r.line); r.m=m; r.sug=m.name||bevcoCleanName(r.line); });
  groups.forEach(g=>{ const gr=rows.filter(r=>g.ix.indexOf(r.i)>=0); const byName={}; gr.forEach(r=>{ (byName[norm(r.sug)]=byName[norm(r.sug)]||[]).push(r); });
    Object.values(byName).forEach(list=>{ if(list.length<2) return; list.sort((a,b)=>((b.m&&b.m.score)||0)-((a.m&&a.m.score)||0));
      list.slice(1).forEach(r=>{ r.sug=(r.m&&r.m.alt&&norm(r.m.alt)!==norm(list[0].sug))?r.m.alt:(r.line?bevcoCleanName(r.line):r.item); }); }); });
  _rcColl=rows;
  const body=`<p class="muted" style="font-size:12px;margin:0 0 8px">BEVCO lists a product once per invoice — the same name twice at different landed rates means two <strong>different</strong> products were mapped onto one Item Master name. Give each its own name (type or pick; a name not in the Item Master is created there and in the Liquor Room). The mapping is remembered for every future invoice.</p>
    <div class="table-wrap" style="max-height:380px;overflow:auto"><table class="tbl"><thead><tr><th>Invoice · BEVCO line</th><th>Now under</th><th>Item Master name</th><th class="right">Qty</th><th class="right">Landed ₹</th></tr></thead><tbody>
    ${rows.map((r,k)=>`<tr><td style="font-size:11.5px"><span class="muted">${esc(String(r.inv).slice(-13))}</span><br>${r.line?esc(r.line):'<span style="color:var(--amber)">line not found in the invoice register</span>'}</td><td style="font-size:11.5px">${esc(r.item)}</td>
      <td><input class="cell-input bmap ${norm(r.sug)!==norm(r.item)?'bmap-guess':''}" list="rawItems" id="rcCol${k}" style="text-align:left;width:260px" value="${esc(r.sug)}" oninput="recvCollEdit(${k})"><div id="rcColSt${k}" class="muted" style="font-size:10.5px;margin-top:2px">${findRawExact(r.sug)?'✔ in the Item Master':'＋ new item · '+esc(bevcoGuessGroup(r.line||r.sug))}</div></td>
      <td class="num">${fmt(r.qty)}</td><td class="num gold">₹ ${fmt(Math.round(fnum(r.land)*100)/100)}</td></tr>`).join('')}</tbody></table></div>${rawNamesDatalist()}`;
  modal('🔧 Two products on one name', body, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="recvCollApply()">💾 Save names</button>`);
  { const ms=document.querySelectorAll('.modal-back'); const m=ms.length&&ms[ms.length-1].querySelector('.modal'); if(m) m.classList.add('xwide'); }
}
function recvCollEdit(k){ const inp=$('#rcCol'+k), st=$('#rcColSt'+k), r=(_rcColl||[])[k]; if(!inp||!st||!r) return; const v=inp.value.trim(); const ex=v&&findRawExact(v);
  st.textContent=ex?'✔ in the Item Master':(v?'＋ new item · '+bevcoGuessGroup(r.line||v):'type a name'); inp.classList.toggle('bmap-guess', !!v && (!ex || norm(v)!==norm(r.item))); }
function recvCollApply(){
  const rows=_rcColl||[]; let moved=0, created=0; const newNames=[];
  rows.forEach((r,k)=>{ const inp=$('#rcCol'+k); const v=inp?inp.value.trim():''; if(!v) return; const e=receivedStock[r.i]; if(!e) return;
    let ex=findRawExact(v); const name=ex?ex.item:v.toUpperCase();
    if(!ex){ const group=bevcoGuessGroup(r.line||name)||'BEVCO IMPORT'; rawData.push({item:name, group}); rebuildRawIdx(); ex=findRawExact(name); created++; newNames.push(name); }
    if(norm(name)!==norm(e.item)){ e.item=name; e.group=ex?ex.group:''; moved++; }
    if(r.line) bevMap[norm(r.line)]=name;                                                                    // remembered for every future invoice
    if(r.mrp && (invGet(name).mrp==null||invGet(name).mrp==='')) invSet(name,'mrp',r.mrp);
    if(invGet(name).land==null||invGet(name).land===''){ const l=fnum(e.land); if(l>0) invSet(name,'land',Math.round(l*100)/100); }   // the Item Master rate only where blank
  });
  _recvRateDrop(); bsv('recv',receivedStock); bsv('bevmap',bevMap); if(created) saveRaw(); _bevDupCache={ver:-1,list:null};
  closeModal(); _rcColl=null; route();
  toast('Names fixed', moved+' entr'+(moved===1?'y':'ies')+' moved'+(created?' · '+created+' new in Item Master + Liquor Room: '+newNames.join(', '):'')+' · mapping remembered', 'ok');
}
function clearCashRecv(){ const cash=receivedStock.filter(r=>recvSrc(r)==='cash'); if(!cash.length){ toast('No cash purchases','Nothing to clear','ok'); return; }
  const amt=cash.reduce((a,r)=>a+recvVal(r),0);
  confirmAsk(`Delete <strong>all ${cash.length}</strong> 💵 cash purchase entr${cash.length===1?'y':'ies'} (₹ ${fmt(Math.round(amt))})? BEVCO entries and the invoice register stay.`, ()=>{
    receivedStock=receivedStock.filter(r=>recvSrc(r)!=='cash'); _recvRateDrop(); bsv('recv',receivedStock); recvSrcF='all'; route(); toast('Cleared', cash.length+' cash purchase'+(cash.length===1?'':'s')+' removed','err'); }); }
/* ---- 📷 Cash invoice from a photo (v2.40.0) ----
   A shop bill (thermal print: shop · Inv_No · Inv_Date · Sl Items Rate Qty Amt · Tot · Paid By Cash) is photographed,
   read by the same free online OCR the MR-by-Photo tool uses (OCR.space, or a Google-Lens paste when offline /
   rate-limited), parsed by cashInvParse() and shown for checking: bill no, date, shop, total, one row per line with
   the Item Master item it matches (the BEVCO matcher, on a copy of the list with glued spellings like GIN750ML
   split so "Blue riband 750" finds it). Confirm → one cash purchase entry per row, rate = that bottle's landed
   cost. Every value is editable before it is saved; nothing is guessed silently — a misread rate is corrected from
   amount ÷ qty and unmatched names stay red until picked. */
let cashInv=null;
function openCashInv(){ if(!cashInv) cashInv={img:'', text:'', meta:null, rows:[], queue:[], total:0, done:0, sumN:0, sumAmt:0}; modal('📷 Cash Invoice — read from a photo', cashInvBody(), cashInvFoot()); }
function cashInvBody(){
  const c=cashInv; const parsed=!!c.meta;
  const pick=`<label class="btn btn-gold btn-sm" style="cursor:pointer">📷 ${c.img?'More photos':'Take / choose photos'}<input type="file" accept="image/*" multiple style="display:none" onchange="cashInvLoad(this)"></label>${c.total>1?` <span class="muted" style="font-size:11.5px">photo ${c.done+1} of ${c.total}${c.queue.length?' · '+c.queue.length+' waiting':''}</span>`:''}`;
  const top=c.img
    ? `<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:8px"><img src="${c.img}" style="max-height:150px;max-width:220px;border-radius:8px;border:1px solid var(--border)">
        <div style="display:flex;flex-direction:column;gap:6px"><button class="btn btn-gold btn-sm" id="ciAutoBtn" onclick="cashInvAuto()">🤖 Auto-read (online)</button><button class="btn btn-sm" onclick="cashInvOpenTab()" title="Opens the photo in a tab — right-click → Search with Google Lens → copy the text → paste below">🔍 Open for Google Lens</button>${pick}</div></div>`
    : `<div style="margin-bottom:8px">${pick} <span class="muted" style="font-size:11.5px">or paste the bill's text below (Google Lens / any OCR)</span></div>`;
  const paste=`<details ${(parsed&&c.rows.length)?'':'open'} style="margin-bottom:8px"><summary class="muted" style="font-size:11.5px;cursor:pointer">Bill text${c.text?' (read)':''}</summary>
      <textarea class="input" id="ciPaste" rows="6" placeholder="INVOICE … Inv_No … Inv_Date … 1 WHITE MISCHIEF 750  680  3  2040 … Tot … Paid By Cash" style="font-family:monospace;font-size:11.5px">${esc(c.text||'')}</textarea>
      <button class="btn btn-sm" style="margin-top:6px" onclick="cashInvParseBtn()">🔎 Read this text</button></details>`;
  if(!parsed) return top+paste+rawNamesDatalist();
  const m=c.meta; const sum=c.rows.reduce((a,r)=>a+(+r.amt||0),0); const okSum=!m.total||Math.abs(sum-m.total)<=1;
  const rows=c.rows.map((r,i)=>`<tr>
      <td class="muted num" style="width:26px">${i+1}</td>
      <td style="font-size:11px;color:var(--text-dim);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.raw)}">${esc(r.raw)}</td>
      <td><input class="cell-input" list="rawItems" style="width:100%;text-align:left;${r.item?(findRawExact(r.item)?(r.sure?'':'border-color:var(--amber)'):'border-color:var(--red)'):'border-color:var(--red)'}" value="${esc(r.item||'')}" placeholder="pick your item… or type a new name" title="${r.item?(findRawExact(r.item)?(r.sure?'Matched to your Item Master':'Best guess — check'):'Not in your Item Master — will be ADDED under the category on the right'):'No match — pick from the Item Master, or type a new name'}" onchange="cashInvRowSet(${i},'item',this.value)">${(r.item&&!findRawExact(r.item))?'<div style="font-size:10px;color:var(--red);margin-top:2px">＋ new item — set its category →</div>':''}</td>
      <td>${cashInvCatCell(r,i)}</td>
      <td class="num"><input class="cell-input" style="width:64px" value="${r.rate}" onchange="cashInvRowSet(${i},'rate',this.value)"></td>
      <td class="num"><input class="cell-input" style="width:52px" value="${r.qty}" onchange="cashInvRowSet(${i},'qty',this.value)"></td>
      <td class="num"><input class="cell-input" style="width:74px" value="${r.amt}" onchange="cashInvRowSet(${i},'amt',this.value)"></td>
      <td><button class="btn btn-danger btn-sm" onclick="cashInvDelRow(${i})">✕</button></td></tr>`).join('');
  return top+paste+`
    <div class="form-grid" style="margin-bottom:8px">
      <div class="field"><label>Shop</label><input class="input" value="${esc(m.shop||'')}" onchange="cashInvSet('shop',this.value)"></div>
      <div class="field"><label>Bill / Invoice no</label><input class="input" value="${esc(m.no||'')}" onchange="cashInvSet('no',this.value)"></div>
      <div class="field"><label>Date</label><input class="input" type="date" value="${esc(m.date||'')}" onchange="cashInvSet('date',this.value)"></div>
      <div class="field"><label>Bill total ₹ (as printed)</label><input class="input" type="number" step="0.01" value="${m.total||''}" onchange="cashInvSet('total',this.value)"></div>
    </div>
    <div class="table-wrap" style="max-height:300px;overflow:auto"><table class="tbl" style="min-width:820px"><thead><tr><th style="width:26px">#</th><th style="width:120px">As printed</th><th style="width:250px">Your item (Item Master)</th><th style="width:170px">Category</th><th class="right">Rate ₹</th><th class="right">Qty</th><th class="right">Amount ₹</th><th style="width:40px"></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:12px"><button class="btn btn-sm" onclick="cashInvAddRow()">＋ Row</button>
      <span id="ciSum" style="color:${okSum?'var(--green)':'var(--amber)'}">Rows ₹ ${fmt(Math.round(sum))}${m.total?' · bill says ₹ '+fmt(Math.round(m.total))+(okSum?' ✔':' ⚠ check the rows'):''} · paid by <strong>${esc(m.paid||'cash')}</strong> → saved as 💵 Cash</span></div>
    <div class="muted" style="font-size:11px;margin-top:6px">Each row becomes one cash purchase entry: Rate = its landing ₹ per bottle (the amount is Qty × Rate). A typed name that is not in the Item Master is added to it.</div>
    ${rawNamesDatalist()}`;
}
function cashInvFoot(){ const c=cashInv||{}; const n=c.meta?c.rows.filter(r=>r.item&&+r.qty>0).length:0; const q=(c.queue||[]).length;
  return `<button class="btn" onclick="cashInvCancelAll()">${q?'Cancel all':'Cancel'}</button>${q?`<button class="btn" onclick="cashInvSkip()" title="Leave this photo out and go to the next">Skip →</button>`:''}${n?`<button class="btn btn-gold" onclick="cashInvConfirm()">✅ Add ${n} cash purchase${n===1?'':'s'}${q?' · next ('+q+' more)':''}</button>`:''}`; }
function cashInvRefresh(){ closeModal(); modal('📷 Cash Invoice — read from a photo', cashInvBody(), cashInvFoot());   // modal() stacks — replace, don't pile up
  const ms=document.querySelectorAll('.modal-back'); const m=ms.length&&ms[ms.length-1].querySelector('.modal'); if(m) m.classList.add('xwide'); }
function cashInvLoad(inp){ const files=[...(inp.files||[])].filter(f=>f.size<=12*1024*1024); if(!files.length){ toast('No photo','Choose an image up to 12 MB','err'); return; }
  if(files.length<(inp.files||[]).length) toast('Skipped','Images over 12 MB were left out','err');
  if(!cashInv) cashInv={img:'', text:'', meta:null, rows:[], queue:[], total:0, done:0, sumN:0, sumAmt:0};
  cashInv.queue=files.slice(1); cashInv.total=(cashInv.done||0)+files.length;
  cashInvShow(files[0]); }
// one photo onto the screen (fresh state for it) → auto-read
function cashInvShow(f){ const rd=new FileReader(); rd.onload=()=>{ cashInv.img=rd.result; cashInv.text=''; cashInv.meta=null; cashInv.rows=[]; cashInvRefresh(); setTimeout(cashInvAuto,150); }; rd.readAsDataURL(f); }
function cashInvNext(){ const c=cashInv; if(!c) return;
  if(c.queue.length){ const f=c.queue.shift(); cashInvShow(f); return; }
  const n=c.sumN, amt=c.sumAmt, ph=c.total; cashInv=null; closeModal(); route();
  if(ph>1) toast('All photos done', ph+' photos · '+n+' cash entr'+(n===1?'y':'ies')+' · ₹ '+fmt(Math.round(amt)), 'ok'); }
function cashInvSkip(){ if(!cashInv) return; cashInv.done++; cashInvNext(); }
function cashInvCancelAll(){ cashInv=null; closeModal(); }
function cashInvOpenTab(){ if(!cashInv||!cashInv.img) return;
  fetch(cashInv.img).then(r=>r.blob()).then(b=>{ window.open(URL.createObjectURL(b),'_blank'); }).catch(()=>toast('Failed','Could not open the image','err')); }
// same free OCR the MR-by-Photo tool uses; a printed bill reads far better than handwriting
function cashInvAuto(){
  if(!cashInv||!cashInv.img){ toast('No photo','Choose a photo first','err'); return; }
  const btn=$('#ciAutoBtn'); if(btn){ btn.disabled=true; btn.textContent='⏳ Reading… (online)'; }
  const img=new Image();
  img.onload=()=>{
    const sc=Math.min(1, 1600/Math.max(img.width,img.height));
    const c=document.createElement('canvas'); c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    const fd=new FormData(); fd.append('base64Image', c.toDataURL('image/jpeg',0.88));
    fd.append('OCREngine','2'); fd.append('scale','true'); fd.append('language','eng'); fd.append('isTable','true');
    fetch('https://api.ocr.space/parse/image',{method:'POST',headers:{apikey:(cfg&&cfg.ocrKey)||'helloworld'},body:fd})
      .then(r=>r.json()).then(j=>{
        const t=j&&j.ParsedResults&&j.ParsedResults[0]&&j.ParsedResults[0].ParsedText;
        if(btn){ btn.disabled=false; btn.textContent='🤖 Auto-read (online)'; }
        if(!t){ const err=String((j&&(j.ErrorMessage||j.error))||''); const busy=/throttl|overload|E551|limit/i.test(err);
          toast(busy?'Free OCR is busy right now':'Could not read', busy?'The shared demo key is throttled — add your own free key in Settings → Company & Admin → Photo-reading key, or use 🔍 Google Lens and paste the text':(err||'The free OCR returned nothing')+' — try 🔍 Google Lens and paste the text','err'); return; }
        cashInv.text=t; cashInvApply(t);
      })
      .catch(()=>{ if(btn){ btn.disabled=false; btn.textContent='🤖 Auto-read (online)'; } toast('Offline?','Auto-read needs internet — use 🔍 Google Lens and paste the text','err'); });
  };
  img.onerror=()=>{ if(btn){ btn.disabled=false; btn.textContent='🤖 Auto-read (online)'; } toast('Bad image','Could not load the photo','err'); };
  img.src=cashInv.img;
}
function cashInvParseBtn(){ const t=($('#ciPaste')||{}).value||''; if(!t.trim()){ toast('No text','Paste the bill text first','err'); return; } cashInv.text=t; cashInvApply(t); }
function cashInvApply(text){
  const P=cashInvParse(text);
  P.rows.forEach(r=>{ const m=cashInvMatch(r.name); r.item=m.item; r.sure=m.sure; r.grp='';
    if(!r.item){ try{ const g=bevcoGuessGroup(r.name); if(g&&g!=='BEVCO IMPORT'&&rawGroups().indexOf(g)>=0) r.grp=g; }catch(e){} } });
  cashInv.meta=P.meta; cashInv.rows=P.rows; cashInvRefresh();
  if(!P.rows.length) toast('No item lines found','Check the text — each line needs name, rate, qty, amount (or add rows by hand)','err');
}
/* the bill text → {meta:{no,date,shop,paid,total}, rows:[{raw,name,rate,qty,amt}]} — pure, testable */
function cashInvParse(text){
  const lines=String(text||'').replace(/\r/g,'').split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
  const T=lines.join('\n'); const meta={no:'',date:'',shop:'',paid:'cash',total:0}; let m;
  // bill number: "Inv_No :- 2627-834341", "Bill No: 45", "lnv No:- …" (OCR l for I), "Receipt / Voucher / Memo / Ref No", or the keyword + ":" alone
  if((m=T.match(/(?:[Il1]nv(?:oice)?|Bill|Memo|Receipt|Rcpt|Voucher|Ref(?:erence)?|Txn|Order|Slip)[\s_.]*(?:No|Num|Number|#|ID)[\s_.]*[:\-.]*\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i)) ||
     (m=T.match(/(?:[Il1]nv(?:oice)?|Bill|Memo|Receipt|Voucher)\s*[:#\-]+\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i))) meta.no=m[1];
  const dm=T.match(/(?:Inv(?:oice)?[\s_.]*Date|Bill[\s_.]*Date|Date)\s*[:\-.]*\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i) || T.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})/);
  if(dm){ const y=dm[3].length===2?'20'+dm[3]:dm[3]; meta.date=`${y}-${String(dm[2]).padStart(2,'0')}-${String(dm[1]).padStart(2,'0')}`; }
  if((m=T.match(/Paid\s*(?:By|Mode|Through)?\s*[:\-]?\s*(Cash|Card|UPI|Credit|Online)/i))) meta.paid=m[1].toLowerCase();
  const hi=lines.findIndex(l=>/^(?:[^A-Za-z0-9]?\w\s+)?(tax\s*)?(invoice|bill|receipt|cash\s*memo|estimate)\s*$/i.test(l));
  meta.shop=(hi>=0&&lines[hi+1])?lines[hi+1]:(lines.find(l=>/[A-Za-z]{4,}/.test(l)&&!/\d{3,}/.test(l)&&!/^(sl|items?|desc)/i.test(l))||'');
  const hIx=lines.findIndex(l=>/(item|desc|particular|product)/i.test(l) && /(rate|qty|quantity|amt|amount|price)/i.test(l));
  let tIx=lines.findIndex((l,i)=>i>hIx && /^(tot\b|tot\.|total|grand|net|sub\s*total|g\.?\s*total)/i.test(l)); if(tIx<0) tIx=lines.length;
  // OCR sometimes breaks a line: "1 OLD MONK 750" then "680 1 680" — a lettered line with fewer than 2 trailing numbers takes the next numbers-only line
  const body=[]; const raw=lines.slice(hIx+1, tIx);
  for(let i=0;i<raw.length;i++){ const l=raw[i], nx=raw[i+1]||'';
    if(/[A-Za-z]/.test(l) && !/(\d[\d.,]*\s+){2,}\d[\d.,]*$/.test(l) && /^(\d[\d.,]*\s*){2,3}$/.test(nx)){ body.push(l+' '+nx); i++; } else body.push(l); }
  const rows=[];
  body.forEach(l=>{ if(/^(rupees|rs\.?\s+[a-z]|goods|it is|paid|thank|licen|time|gst|cgst|sgst|round)/i.test(l)) return;
    if(/\b(tot\.?|total|ltr|litre|liter|time)\b|\bqty\s*[:\-]/i.test(l)) return;                        // a totals / litres line is never an item row
    const mm=l.match(/^(?:\d{1,3}[.)]?\s+)?(.*?[A-Za-z].*?)\s+((?:\d+(?:[.,]\d+)?\s*){2,3})$/); if(!mm) return;
    const name=mm[1].replace(/[|:]+$/,'').replace(/^[^A-Za-z0-9]*[A-Za-z|)\]]\s+(?=\S)/,'').trim(); const cols=mm[2].trim().split(/\s+/).map(x=>+x.replace(/,/g,'')); if(cols.some(isNaN)) return;
    let rate=0,qty=0,amt=0;
    if(cols.length>=3){ rate=cols[cols.length-3]; qty=cols[cols.length-2]; amt=cols[cols.length-1];
      if(Math.abs(rate*qty-amt)>1 && Math.abs(rate*amt-qty)<=1){ const q=amt; amt=qty; qty=q; }      // "rate amt qty" layouts
      if(qty>0 && Math.abs(rate*qty-amt)>1) rate=Math.round(amt/qty*100)/100; }                          // a misread rate digit: amount ÷ qty wins
    else { qty=cols[0]; amt=cols[1]; if(qty>amt){ const t=qty; qty=amt; amt=t; } rate=qty?Math.round(amt/qty*100)/100:0; }
    if(!(qty>0)||!(amt>0)||qty>500||!Number.isInteger(qty)) return;                                    // bottles are whole numbers — 0.750 is a litre figure, not a qty
    const nm2=name.replace(new RegExp('^'+(rows.length+1)+'\\s+(?=[A-Za-z])'),'');
    rows.push({raw:nm2, name:nm2.toUpperCase(), rate, qty, amt}); });
  const sum=rows.reduce((a,r)=>a+r.amt,0);
  if(tIx<lines.length){ const cand=[]; for(let i=Math.max(0,tIx-1);i<=Math.min(lines.length-1,tIx+1);i++){ [...lines[i].matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)/g)].forEach(x=>{ const n=+x[1].replace(/,/g,''); if(!isNaN(n)&&n>0) cand.push(n); }); }
    if(cand.length){ if(sum){ cand.sort((a,b)=>Math.abs(a-sum)-Math.abs(b-sum)); meta.total=cand[0]; } else meta.total=Math.max.apply(null,cand); } }
  if(!meta.total || (sum && (meta.total<sum*0.5 || meta.total>sum*2))) meta.total=sum;   // nothing believable printed → Σ rows
  return {meta, rows};
}
/* "WHITE MISCHIEF 750" → the Item Master item. Runs the BEVCO matcher over a copy of the list whose glued spellings
   ("GIN750ML", "750ML") are split, and maps the answer back to the stored name. */
function cashInvMatch(name){
  const list=[], back={};
  rawData.forEach(r=>{ const n=String(r.item).replace(/([A-Z])(\d)/g,'$1 $2').replace(/(\d)(ML)\b/g,'$1 $2').replace(/\s+/g,' ').trim(); list.push({item:n, group:r.group}); back[norm(n)]=r.item; });
  const q=String(name||'').replace(/(\d{2,4})\s*ML\b/i,'$1 ML');
  let m=bevcoMatch(q,{list}); if(!m.name && !/ML\b/i.test(q) && /\d{2,4}$/.test(q)) m=bevcoMatch(q+' ML',{list});
  const item=m.name?(back[norm(m.name)]||m.name):''; return {item, sure:!!(item&&m.sure), top:m.top?(back[norm(m.top.name)]||m.top.name):''};
}
// matched → the item's own group (read-only); new name → the client's groups to pick from, or a new one
function cashInvCatCell(r,i){
  const ex=r.item?findRawExact(r.item):null;
  if(ex) return `<span class="pill gray" title="Your Item Master category for this item">${esc(ex.group||'(ungrouped)')}</span>`;
  if(!r.item) return '<span class="muted" style="font-size:11px">—</span>';
  const groups=rawGroups().filter(g=>g&&g!=='BEVCO IMPORT'); const cur=r.grp||'';
  if(r.grpNew) return `<input class="cell-input" style="width:100%;text-align:left;border-color:var(--amber)" value="${esc(cur)}" placeholder="new category name…" title="Type the new category" onchange="cashInvRowSet(${i},'grp',this.value)"> <a href="#" class="muted" style="font-size:10px" onclick="cashInvRowSet(${i},'grpNew',false);return false">pick existing</a>`;
  return `<select class="input" style="width:100%;padding:4px 6px;font-size:11.5px;${cur?'':'border-color:var(--amber)'}" title="Category for the new item" onchange="cashInvRowSet(${i},'grp',this.value)"><option value="">— choose category —</option>${groups.map(g=>`<option value="${esc(g)}" ${g===cur?'selected':''}>${esc(g)}</option>`).join('')}<option value="__new">＋ New category…</option></select>`;
}
function cashInvSet(f,v){ if(!cashInv||!cashInv.meta) return; cashInv.meta[f]=(f==='total')?(+v||0):v; const s=$('#ciSum'); if(s&&f==='total') cashInvRefresh(); }
function cashInvRowSet(i,f,v){ const r=cashInv&&cashInv.rows[i]; if(!r) return;
  if(f==='item'){ r.item=String(v||'').trim().toUpperCase(); r.sure=!!findRawExact(r.item); if(r.item&&!findRawExact(r.item)&&!r.grp){ try{ const g=bevcoGuessGroup(r.item); if(g&&g!=='BEVCO IMPORT'&&rawGroups().indexOf(g)>=0) r.grp=g; }catch(e){} } }
  else if(f==='grp'){ if(v==='__new'){ r.grpNew=true; r.grp=''; } else r.grp=String(v||'').replace(/\s+/g,' ').trim().toUpperCase(); }
  else if(f==='grpNew'){ r.grpNew=!!v; if(!r.grpNew) r.grp=''; }
  else { const n=+String(v).replace(/,/g,''); r[f]=isNaN(n)?0:n; if(f==='amt'&&r.qty>0) r.rate=Math.round(r.amt/r.qty*100)/100; else r.amt=Math.round(r.rate*r.qty*100)/100; }
  cashInvRefresh(); }
function cashInvAddRow(){ if(!cashInv||!cashInv.meta) return; cashInv.rows.push({raw:'(typed)', name:'', item:'', sure:false, rate:0, qty:1, amt:0}); cashInvRefresh(); }
function cashInvDelRow(i){ if(!cashInv||!cashInv.meta) return; cashInv.rows.splice(i,1); cashInvRefresh(); }
function cashInvConfirm(force){
  const c=cashInv; if(!c||!c.meta) return; const m=c.meta;
  const use=c.rows.filter(r=>r.item&&+r.qty>0); if(!use.length){ toast('Nothing to add','Pick an Item Master item on at least one row','err'); return; }
  if(!force && m.no){ const d=recvDupCheck(m.no, use.map(r=>r.item)); if(d.length){ confirmAsk(`Bill <strong>${esc(m.no)}</strong> already has <strong>${d.map(esc).join(', ')}</strong> in the register — adding again would be a <span style="color:var(--red)">double entry</span> (was this photo read before?). Add anyway?`, ()=>cashInvConfirm(true)); return; } }
  const date=m.date||new Date().toISOString().slice(0,10); let added=0, created=0, total=0;
  const missingCat=use.filter(r=>!findRawExact(r.item)&&!(r.grp||'').trim()); if(missingCat.length){ toast('Category?','Choose a category for the new item'+(missingCat.length>1?'s':'')+': '+missingCat.map(r=>r.item).join(', '),'err'); return; }
  use.forEach(r=>{ let it=findRawExact(r.item); if(!it){ const nm=String(r.item).replace(/\s(\d{2,4})$/,' $1 ML').toUpperCase(); rawData.push({item:nm, group:(r.grp||'').trim()||'(ungrouped)'}); rebuildRawIdx(); it=findRawExact(nm); created++; }
    const rate=+r.rate||(r.qty?Math.round(r.amt/r.qty*100)/100:0);
    const e={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6), date, item:it.item, qty:+r.qty, group:it.group||'', src:'cash', land:rate, mrp:rate};
    if(m.no) e.inv=String(m.no).trim(); if(m.shop) e.shop=String(m.shop).trim();
    const iv=invGet(it.item); if(iv.mrp==null||iv.mrp==='') invSet(it.item,'mrp',rate);
    receivedStock.push(e); added++; total+=(+r.qty)*rate; });
  _recvRateDrop(); if(created) saveRaw(); bsv('recv',receivedStock); recvSrcF='all';
  toast('Cash invoice added', added+' entr'+(added===1?'y':'ies')+' · ₹ '+fmt(Math.round(total))+(m.no?' · bill '+m.no:'')+(created?' · '+created+' new item'+(created===1?'':'s')+' in Item Master':''), 'ok');
  c.sumN+=added; c.sumAmt+=total; c.done++;
  if(c.queue.length){ cashInvNext(); } else { cashInv=null; closeModal(); route(); if(c.total>1) toast('All photos done', c.total+' photos · '+c.sumN+' cash entr'+(c.sumN===1?'y':'ies')+' · ₹ '+fmt(Math.round(c.sumAmt)), 'ok'); }
}
function delRecv(i){ confirmAsk('Delete this received-stock entry?', ()=>{ receivedStock.splice(i,1); bsv('recv',receivedStock); route(); toast('Deleted','Entry removed','err'); }); }

/* ============================================================
   3) MR DETAIL — easy manual issue (date · item search · qty · auto group)
   + AUTO entry (2026-07-17): ⚡ mirror Received Stock → issues (idempotent
   per-item deficit), 📂 Excel/CSV/paste bulk import with check-&-confirm.
   ============================================================ */
function mrAutoFromRecv(){
  const seen={}; receivedStock.forEach(r=>{ const k=norm(r.item);
    (seen[k]=seen[k]||{item:r.item, qty:0, date:r.date||period.from}).qty+=fnum(r.qty);
    if(String(r.date||'')>String(seen[k].date||'')) seen[k].date=r.date; });
  const issued={}; mrDetail.forEach(r=>{ const k=norm(r.item); issued[k]=(issued[k]||0)+fnum(r.qty); });
  const plan=Object.keys(seen).map(k=>({item:seen[k].item, date:seen[k].date, qty:seen[k].qty-(issued[k]||0)})).filter(p=>p.qty>0);
  if(!plan.length){ toast('Nothing to issue','Every received qty is already issued to the bar','ok'); return; }
  const tot=plan.reduce((a,p)=>a+p.qty,0);
  confirmAsk(`Auto-issue <strong>${plan.length} items · ${fmt(tot)} qty</strong> from Purchase → Bar?
    <div style="max-height:200px;overflow:auto;margin:8px 0;font-size:11.5px;line-height:1.8;border:1px solid var(--border-soft);border-radius:8px;padding:6px 10px">${plan.map(p=>`${esc(p.item)} — <strong>${fmt(p.qty)}</strong>`).join('<br>')}</div>
    <span class="muted" style="font-size:10.5px">Already-issued quantities are skipped, so pressing this again never doubles anything.</span>`, ()=>{
    plan.forEach(p=>{ const rr=findRaw(p.item);
      mrDetail.push({date:p.date||period.from, group:rr?rr.group:'', item:String(p.item).toUpperCase(), qty:p.qty}); });
    bsv('mr',mrDetail); closeModal(); route();
    toast('Auto MR done', plan.length+' issues created from Purchase','ok');
  });
}
var _mrImp=[];
function mrImportModal(){
  modal('📂 MR Import — Excel / CSV / Paste', `
    <p class="muted" style="font-size:11.5px">Excel/CSV columns: <strong>Item</strong> · <strong>Qty</strong> · <strong>Date</strong> (optional — else period start). Or copy-paste lines from Excel / WhatsApp: <code>ITEM NAME&nbsp;&nbsp;QTY</code> — one per line, qty at the end.</p>
    <textarea class="input" id="mrPaste" style="height:110px;font-family:monospace;font-size:11px;margin-top:8px" placeholder="OLD MONK XXX RUM 750 ML&#9;4&#10;KINGFISHER PREMIUM 650 ML&#9;12"></textarea>
    <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
      <button class="btn btn-gold btn-sm" onclick="mrPasteParse()">＋ Read pasted lines</button>
      <label class="btn btn-sm" style="cursor:pointer">📂 Excel / CSV file<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="uploadMrExcel(this)"></label>
    </div>`,
    `<button class="btn" onclick="closeModal()">Close</button>`);
}
function mrPasteParse(){
  const txt=($('#mrPaste')&&$('#mrPaste').value)||''; if(!txt.trim()){ toast('Empty','Paste ITEM + QTY lines first','err'); return; }
  const rows=[];
  txt.split(/\r?\n/).forEach(line=>{ const s=line.trim(); if(!s) return;
    let parts=s.split('\t'); if(parts.length<2) parts=s.split(/\s{2,}/);
    if(parts.length>=2 && parts[parts.length-1].trim().match(/^\d+(\.\d+)?$/)){
      rows.push({item:parts.slice(0,-1).join(' ').trim(), qty:parseFloat(parts[parts.length-1])}); return; }
    const m=s.match(/^(.*?)[\s,·—-]+(\d+(?:\.\d+)?)$/);          // fallback: trailing number = qty
    if(m && m[1].trim() && !/^\d/.test(m[1].trim())) rows.push({item:m[1].trim(), qty:parseFloat(m[2])}); });
  mrImpPreview(rows);
}
function uploadMrExcel(inp){
  const f=inp.files[0]; if(!f) return;
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page (xlsx.full.min.js)','err'); inp.value=''; return; }
  const reader=new FileReader();
  reader.onload=e=>{ try{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
    const grid=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,blankrows:false});
    let hdr=-1, ci={};
    for(let r=0;r<Math.min(grid.length,20);r++){ const row=(grid[r]||[]).map(x=>norm(x));
      let it=row.findIndex(x=>/(^ITEM|PRODUCT|DESCRIPTION|BRAND)/.test(x)&&!/SUPPLIER/.test(x));
      if(it<0) it=row.findIndex(x=>/NAME/.test(x)&&!/SUPPLIER/.test(x));
      const q=row.findIndex(x=>/(^QTY|QUANTITY|^NOS|ISSUE)/.test(x));
      const d=row.findIndex(x=>/DATE/.test(x));
      if(it>-1&&q>-1){ hdr=r; ci={d,it,q}; break; } }
    const C = hdr>-1 ? ci : {d:-1,it:0,q:1};        // no header → assume col A item, col B qty
    const rows=[]; const start=hdr>-1?hdr+1:0;
    for(let r=start;r<grid.length;r++){ const row=grid[r]||[];
      const item=(row[C.it]??'').toString().trim(); if(!item||/^ITEM$/i.test(item)) continue;
      const qty=parseFloat((row[C.q]??'').toString().replace(/[^\d.\-]/g,'')); if(isNaN(qty)||qty<=0) continue;
      rows.push({item, qty, date:C.d>-1?excelDate(row[C.d]):''}); }
    inp.value=''; mrImpPreview(rows);
  }catch(err){ inp.value=''; toast('Upload failed', String(err.message||err),'err'); } };
  reader.readAsArrayBuffer(f);
}
function mrImpPreview(rows){
  if(!rows||!rows.length){ toast('Nothing found','No ITEM + QTY lines detected','err'); return; }
  _mrImp=rows.map(r=>{ let it=String(r.item||'').trim().toUpperCase();
    if(it && !findRaw(it)){ const c=mrVoiceClosest(it); if(c.length) it=c[0]; }   // fuzzy snap to Raw Data
    return {date:r.date||period.from, item:it, orig:String(r.item||''), qty:fnum(r.qty)}; });
  const body=_mrImp.map((r,i)=>{ const ok=inRaw(r.item);
    return `<tr class="${ok?'':'row-alert'}">
      <td><input class="input" type="date" style="width:126px;padding:4px 6px;font-size:11.5px" value="${r.date}" onchange="_mrImp[${i}].date=this.value"></td>
      <td><input class="input" list="rawItems" style="width:100%;min-width:180px;padding:4px 6px;font-size:11.5px" value="${esc(r.item)}" title="read as: ${esc(r.orig)}" onchange="_mrImp[${i}].item=this.value.trim().toUpperCase()"></td>
      <td class="num"><input class="input" type="number" style="width:64px;padding:4px 6px;font-size:11.5px" value="${r.qty}" onchange="_mrImp[${i}].qty=+this.value||0"></td>
      <td>${ok?`<span class="pill gray">${esc(findRaw(r.item).group)}</span>`:redBadge()}</td></tr>`; }).join('');
  modal('✔ Check &amp; Confirm — '+_mrImp.length+' issues', `
    <p class="muted" style="font-size:11px">Red = not in Item Master yet — fix the name (suggestions appear as you type) or confirm as-is.</p>
    <div class="table-wrap" style="max-height:300px;overflow:auto;margin-top:6px"><table class="tbl">
      <thead><tr><th>Date</th><th>Item</th><th class="right">Qty</th><th>Group</th></tr></thead><tbody>${body}</tbody></table></div>
    ${rawNamesDatalist()}`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="mrImpConfirm()">💾 Add issues</button>`);
}
function mrImpConfirm(){
  let n=0, un=0;
  _mrImp.forEach(r=>{ const it=String(r.item||'').trim().toUpperCase(); if(!it||!(fnum(r.qty)>0)) return;
    const rr=findRaw(it); if(!rr) un++;
    mrDetail.push({date:r.date||period.from, group:rr?rr.group:'', item:it, qty:fnum(r.qty)}); n++; });
  bsv('mr',mrDetail); _mrImp=[]; closeModal(); route();
  if(n) toast('Imported', n+' issues added'+(un?' · '+un+' unmatched (red)':' · all matched'), un?'err':'ok');
  else toast('Nothing added','No valid rows (need item + qty > 0)','err');
}
let mrDraft=[{date:'', item:'', qty:''}];
let mrVoiceLang='en-US', mrVoiceOn=false, mrVoiceHeard='', mrVoiceItem='', mrVoiceDate='', mrVoiceMsg='', mrVoiceSuggest=[], mrVoiceStep='item', _mrRec=null;
VIEWS.mrdetail = () => {
  const total=mrDetail.reduce((a,r)=>a+fnum(r.qty),0);
  const totalAmt=mrDetail.reduce((a,r)=>a+fnum(r.qty)*landOf(r.item),0);
  // per-item Liquor-Room closing as it stands NOW (Opening + Received − Issued) — cached per name so a long list
  // does not recompute the same item; display only, the same figures the Search & Issue panel shows
  const _lrNow={}; const lrNow=name=>{ if(_lrNow[name]==null){ const op=fnum(invGet(name).lrOpen), rv=receivedForItem(name), is=issuedForItem(name); _lrNow[name]=op+rv-is; } return _lrNow[name]; };
  const body=mrDetail.map((r,i)=>{ const ok=inRaw(r.item); const q=fnum(r.qty), amt=q*landOf(r.item), qd=Number.isInteger(q)?fmt(q):String(r.qty);
    const cl=ok?lrNow(r.item):null;
    // date · item · qty are inputs (v2.48.3, client: a wrong entry must be fixable in place) — same pattern as the Purchase register
    return `<tr class="${ok?'':'row-alert'}">
      <td class="nowrap"><input class="cell-input rvdate" type="date" value="${esc(r.date||'')}" title="Issue date — click to change" onchange="mrSetField(${i},'date',this.value)"></td>
      <td>${ok?`<span class="pill gray">${findRaw(r.item).group}</span>`:redBadge()}</td>
      <td class="lrname"><input class="cell-input rvitem" list="rawItems" value="${esc(r.item)}" title="Item — type another Item Master name to move this issue" onchange="mrSetField(${i},'item',this.value)"></td>
      <td class="num nowrap"><span class="lrsg ${q>0?'minus':'zero'}">${q>0?'−':''}</span><input class="cell-input rvqty" value="${esc(qd)}" title="Bottles issued — click to change (12+12 works)" onchange="mrSetField(${i},'qty',this.value)"></td>
      <td class="num"><span class="lrval">${amt?('₹ '+fmt(Math.round(amt))):'<span class="muted">—</span>'}</span></td>
      <td class="num">${cl==null?'<span class="muted">—</span>':`<strong class="lrclose ${cl<0?'neg':''}">${fmt(cl)}</strong>`}</td>
      <td class="right"><button class="btn btn-danger btn-sm" onclick="delMr(${i})">✕</button></td></tr>`; }).join('')
    || '<tr><td colspan="7" class="center muted" style="padding:20px">No issues yet — search an item above and press Enter.</td></tr>';
  // royal head figures (v2.32.0) — the same totals the old stat strip showed, plus today's issues and the
  // issued-of-available share (Liquor Room Opening + Received) that the Crown Gauge look already uses
  const today=new Date().toISOString().slice(0,10);
  const tdRows=mrDetail.filter(r=>r.date===today), tdQty=tdRows.reduce((a,r)=>a+fnum(r.qty),0);
  const nItems=new Set(mrDetail.map(r=>norm(r.item))).size;
  const mds=mrDetail.map(r=>r.date).filter(Boolean).sort(); const mspan=mds.length?`${mds[0]} → ${mds[mds.length-1]}`:'';
  const LT=lrTotals(), avail=LT.op+LT.rv, pctIs=avail>0?Math.min(100,Math.round(LT.is/avail*100)):0;
  const avgIs=total>0?totalAmt/total:0;
  return `
    <div class="page-head"><div><h1>Bar Stock Issue</h1><p>Liquor Room → Bar issues. Issue Slip: type the item, pick it, bottles, Enter — live stock beside it; the next line opens by itself.</p></div>
      <div class="page-actions">
        <button class="btn btn-sm" onclick="mrImportModal()" title="Bulk add from Excel / CSV or copy-paste lines">📂 Excel / Paste</button>
        <button class="btn btn-sm" onclick="openPhotoRecv()">📷 Photo</button>
        <button class="btn btn-sm" onclick="expReport('mrd','xlsx')" title="Download this sheet as Excel">📊 Excel</button>
        <button class="btn btn-sm" onclick="printSheet('mrd')" title="Clean print of this sheet — Save as PDF from the dialog">🖨 Print</button></div></div>
    ${periodBar()}
    <div class="card lrflow mrflow">
      <div class="lrf-head"><div class="t">Bar Stock Issue</div><div class="f">Issue Amount <b>=</b> Bottles issued <b>×</b> Landing ₹/bottle <span class="p">· Liquor Room → Bar${mspan?' · '+esc(mspan):''}</span></div></div>
      <div class="lrf-body">
        <div class="lrf-steps">
          <div class="st"><div class="ic">📋</div><div class="l">Saved Issues</div><div class="v">${fmt(mrDetail.length)}<small>rows</small></div><div class="m sub">${fmt(nItems)} item${nItems===1?'':'s'}</div></div>
          <div class="arr">›</div>
          <div class="st is"><div class="ic">🍸</div><div class="l">Bottles Issued</div><div class="v">−${fmt(total)}<small>btl</small></div><div class="m sub">out of ${fmt(avail)} available in Liquor Room</div></div>
          <div class="arr">=</div>
          <div class="st cl"><div class="ic">♛</div><div class="l">Issue Amount</div><div class="v amt">₹ ${fmt(Math.round(totalAmt))}</div><div class="m">avg ₹ ${fmt(Math.round(avgIs))} / bottle</div></div>
          <div class="arr">·</div>
          <div class="st td"><div class="ic">📅</div><div class="l">Today</div><div class="v">${fmt(tdQty)}<small>btl</small></div><div class="m sub">${tdRows.length?fmt(tdRows.length)+' issue'+(tdRows.length===1?'':'s')+' · '+esc(today):'nothing issued yet · '+esc(today)}</div></div>
        </div>
        <div class="lrf-ring"><div class="ring" style="--pct:${pctIs}"><div class="in"><div class="k">Issued to Bar</div><div class="amt">₹ ${fmt(Math.round(totalAmt))}</div><div class="k2">${fmt(total)} bottles · ${fmt(nItems)} item${nItems===1?'':'s'}</div><div class="k3">${pctIs}% of liquor room</div></div></div></div>
      </div>
    </div>
    ${mrFindPanel()}
    ${(()=>{ const lay=pageLay('mrdetail');
      const defCard=`<div class="card barinv laydense mrtbl"><div class="card-head"><div><h3>Issue Register</h3><p>All issues, Liquor Room → Bar · last column = that item's Liquor-Room stock <em>now</em></p></div>
      <div class="flex gap-8 items-center">${layDrop('mrdetail')}${mrDetail.length?`<button class="btn btn-danger btn-sm" onclick="clearAllMr()">🗑 Clear All</button>`:''}</div></div>
      <div class="table-wrap" style="max-height:460px;overflow-y:auto"><table class="tbl">
      <thead><tr><th style="width:96px">Date</th><th style="width:150px">Group</th><th>Item</th><th class="right" style="width:84px">Issued</th><th class="right" style="width:104px">Amount ₹</th><th class="right nowrap" style="width:118px" title="Opening + Received − Issued, as it stands now">In Liquor Room</th><th style="width:46px"></th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="lrsub" style="position:sticky;bottom:0"><td colspan="3" class="right"><strong>TOTAL</strong></td><td class="num"><strong class="lrsg ${total>0?'minus':'zero'}">${total>0?'−':''}${fmt(total)}</strong></td><td class="num"><strong class="lrval">₹ ${fmt(Math.round(totalAmt))}</strong></td><td colspan="2"></td></tr></tfoot>
      </table></div>${rawNamesDatalist()}</div>`;
      if(lay==='def') return defCard;
      if(lay==='dense') return `<div class="laydense">${defCard}</div>`;
      const byG={}; mrDetail.forEach((r,i)=>{ const k=r.group||'— no group'; (byG[k]=byG[k]||[]).push({r,i}); });
      const grp=Object.keys(byG).sort().map(k=>({ id:k, title:k, sub:`${byG[k].length} issues`,
        right:`<span class="num gold" style="font-weight:700">${fmt(byG[k].reduce((a,x)=>a+fnum(x.r.qty),0))}</span>`,
        detail: byG[k].map(x=>`<div class="flex between items-center" style="padding:4px 0;border-bottom:1px solid var(--border-soft);font-size:12px;gap:8px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><span class="muted">${x.r.date||'—'}</span> ${x.r.item}</span><span class="nowrap"><strong>${x.r.qty}</strong> <button class="btn btn-danger btn-sm" onclick="delMr(${x.i})">✕</button></span></div>`).join('') }));
      return `<div class="card-head" style="padding:0 0 8px 0;border:none"><div><h3>Saved Issues</h3></div><div class="flex gap-8 items-center">${layDrop('mrdetail')}${mrDetail.length?`<button class="btn btn-danger btn-sm" onclick="clearAllMr()">🗑 Clear All</button>`:''}</div></div>`+renderLay('mrdetail',lay,grp,{listTitle:'Groups'});
    })()}`;
};
function mrSetField(i,f,v){ const r=mrDetail[i]; if(!r) return;   // v2.48.3 — the register's date · item · qty edited in place
  if(f==='qty'){ const n=evalNum(v); if(n===''||isNaN(+n)||!(+n>0)){ toast('Qty?','Bottles issued must be more than 0 — ✕ removes the line','err'); route(); return; } r.qty=+n; }
  else if(f==='date'){ const d=String(v||'').trim(); if(!d){ route(); return; } r.date=d; }
  else if(f==='item'){ const nm=String(v||'').replace(/s+/g,' ').trim().toUpperCase(); if(!nm){ route(); return; } const ex=findRawExact(nm)||findRaw(nm); r.item=ex?ex.item:nm; r.group=ex?(ex.group||''):(r.group||''); }
  bsv('mr',mrDetail); route(); }
function clearAllMr(){ if(!mrDetail.length){ toast('Empty','No MR issues to clear','err'); return; }
  confirmAsk(`Delete <strong>ALL ${mrDetail.length} MR issue(s)</strong>? This clears the entire Bar Stock Issue list and cannot be undone.`, ()=>{
    mrDetail.length=0; bsv('mr',mrDetail); route(); toast('Cleared','All MR issues removed','err'); }); }
/* ---- Royal Search & Issue panel (2026-07-17 night) — Beverage-Control-style search:
   type → matching Raw-Data items appear with LIVE Liquor-Room stock (Op + Recv − Issued
   = Closing) → qty + Enter (or ＋ Issue) = saved issue. Replaces the voice assistant. ---- */
let mrFind='';
var _mqDate=new Date().toISOString().slice(0,10);   // issue date defaults to TODAY (was period start — looked "stuck")
// SILENT search — only the results box re-renders (no route(), no page fade), so typing is butter-smooth
function mrFindType(v){ mrFind=v; const h=$('#mrHits'); if(h) h.innerHTML=mrHitsHtml(); else route(); }
function mrHitsHtml(){
  if(!mrFind.trim())
    return `<div class="muted" style="padding:10px 2px;font-size:12px">🔎 Type an item name — its <strong>Liquor Room stock</strong> (Opening + Received − Issued = Closing) appears instantly. <strong>↓</strong> = jump to qty · <strong>Enter</strong> = issue · <strong>Esc</strong> = clear.</div>`;
  const q=norm(mrFind);
  const hits=rawData.map((r,i)=>({r,i})).filter(x=>norm(x.r.item).includes(q)||norm(x.r.group||'').includes(q)).slice(0,8);
  return hits.map(({r,i})=>{
    const op=fnum(invGet(r.item).lrOpen), rv=receivedForItem(r.item), is=issuedForItem(r.item), cl=op+rv-is;
    return `<div class="mrhit">
      <div class="nm"><strong>${esc(r.item)}</strong><br><span class="pill gray" style="font-size:9.5px">${esc(r.group||'—')}</span></div>
      <div class="stk">
        <span>Opening <b>${fmt(op)}</b></span>
        <span>Received <b style="color:var(--green)">+${fmt(rv)}</b></span>
        <span>Issued <b style="color:var(--red)">−${fmt(is)}</b></span>
        <span class="cl">In Liquor Room <b>${fmt(cl)}</b></span>
      </div>
      <div class="act"><input class="input" id="mqQ_${i}" type="number" min="0" placeholder="qty" style="width:72px;padding:5px 7px" onkeydown="mrQtyKey(event,${i})">
        <button class="btn btn-gold btn-sm" onclick="mrQuickIssue(${i})">＋ Issue</button></div>
    </div>`; }).join('')
    || `<div class="muted center" style="padding:14px;font-size:12px">No Item Master entry matches “${esc(mrFind)}” — add it in Item Master first.</div>`;
}
/* ---- Issue Slip (v2.48.0) — the client: "one box: search item · issue date · item name · qty; after one item the next
   line opens by itself; live available stock; royal, compact". One ledger-framed box: the issue date in the head, a
   grid whose FIRST row is the live entry (item box = search with a dropdown of matches carrying their Liquor-Room stock
   → pick → qty → Enter = saved), the lines of that date beneath it (newest first). Same figures as before: stock =
   Opening + Received − Issued (`_msStock`), amount = qty × landOf. Saving pushes the same {date,group,item,qty} entry
   (plus an id, like manual purchases) and re-renders quietly, so the empty entry row is simply there again. */
var _ms={i:-1, q:'', sel:0, hits:[]};   // the live row: picked rawData index · typed text · dropdown highlight · matches
var _msLast=-1;                            // index of the line just saved — flashed green once
function _msStock(name){ const op=fnum(invGet(name).lrOpen), rv=receivedForItem(name), is=issuedForItem(name); return {op, rv, is, cl:op+rv-is}; }
function _msHits(q){ q=norm(q); if(!q) return []; const starts=[], incl=[];
  rawData.forEach((r,i)=>{ const n=norm(r.item); if(n.startsWith(q)) starts.push(i); else if(n.includes(q)||norm(r.group||'').includes(q)) incl.push(i); });
  const byStock=arr=>arr.map((i,k)=>({i,k,r:_msStock(rawData[i].item).cl>0?0:1})).sort((a,b)=>a.r-b.r||a.k-b.k).map(x=>x.i);   // what is in hand first, sheet order within
  return byStock(starts).concat(byStock(incl)).slice(0,8); }
function _msNewId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function mrSlipLinesHtml(){
  const d=_mqDate||period.from; const all=mrDetail.map((r,i)=>({r,i})).filter(x=>x.r.date===d).reverse(); const show=all.slice(0,12);
  if(!all.length) return `<div class="empty">No issue on ${esc(d)} yet — type an item above, pick it, enter the bottles and press <b>Enter</b>.</div>`;
  return show.map((x,k)=>{ const r=x.r, ok=inRaw(r.item), q=fnum(r.qty), amt=q*landOf(r.item); const cl=ok?_msStock(r.item).cl:null;
    return `<div class="c n ${x.i===_msLast?'new':''}">${all.length-k}</div><div class="c it ${x.i===_msLast?'new':''}"><strong title="${esc(r.item)}">${esc(r.item)}</strong>${ok?'':' '+redBadge()}</div><div class="c g">${ok?`<span class="pill gray">${esc(findRaw(r.item).group)}</span>`:'<span class="mu">—</span>'}</div>
      <div class="c r stk">${cl==null?'<span class="mu">—</span>':`<b class="${cl<0?'neg':''}">${fmt(cl)}</b><small>btl</small>`}</div><div class="c r q"><span class="lrsg minus">−${Number.isInteger(q)?fmt(q):esc(String(r.qty))}</span></div>
      <div class="c r amt">${amt?'₹ '+fmt(Math.round(amt)):'<span class="mu">—</span>'}</div><div class="c x"><button class="btn rmx" onclick="delMr(${x.i})" title="Remove this issue">✕</button></div>`; }).join('')
    + (all.length>show.length?`<div class="more">… ${all.length-show.length} more on this date — the Issue Register below lists them all</div>`:'');
}
function mrSlipHead(){ const d=_mqDate||period.from; const L=mrDetail.filter(r=>r.date===d); const q=L.reduce((a,r)=>a+fnum(r.qty),0), amt=L.reduce((a,r)=>a+fnum(r.qty)*landOf(r.item),0);
  return L.length?`${fmt(L.length)} line${L.length===1?'':'s'} · ${fmt(q)} btl · ₹ ${fmt(Math.round(amt))}`:'no line on this date yet'; }
function mrFindPanel(){
  return `<div class="card bcledger mrslip noprint">
    <div class="bh"><div class="t">Issue Slip</div><div class="f">Liquor Room <b>→</b> Bar · type the item, pick it, bottles, <b>Enter</b> — the next line opens by itself</div>
      <div class="dt"><label for="mqDate">Issue date</label><input class="input" type="date" id="mqDate" value="${esc(_mqDate||period.from)}" oninput="_mqDate=this.value" onchange="mrSlipDate(this.value)"></div>
      <div class="p" id="msHead">${mrSlipHead()}</div></div>
    <div class="msg">
      <div class="h c">#</div><div class="h">Item · type to search</div><div class="h">Group</div><div class="h r" title="Opening + Received − Issued, as it stands now">In Liquor Room</div><div class="h r">Qty</div><div class="h r">Amount ₹</div><div class="h"></div>
      <div class="c lv n">→</div>
      <div class="c lv it"><input id="msItem" class="cell-input msin" placeholder="Search item…" autocomplete="off" value="${esc(_ms.q)}" oninput="mrSlipType(this.value)" onfocus="mrSlipType(this.value)" onblur="mrSlipBlur()" onkeydown="mrSlipItemKey(event)"><div id="msDD" class="msdd"></div></div>
      <div class="c lv g" id="msGrp"><span class="mu">—</span></div>
      <div class="c lv r stk" id="msStk"><span class="mu">—</span></div>
      <div class="c lv r"><input id="msQty" class="cell-input msin q" type="number" min="0" step="any" placeholder="qty" oninput="mrSlipLive()" onkeydown="mrSlipQtyKey(event)"></div>
      <div class="c lv r amt" id="msAmt"><span class="mu">—</span></div>
      <div class="c lv x"><button class="btn btn-gold btn-sm" onclick="mrSlipAdd()" title="Save this line (Enter does the same)">＋</button></div>
      <div id="msLines" style="display:contents">${mrSlipLinesHtml()}</div>
    </div></div>`;
}
function mrSlipDate(v){ if(!v) return; _mqDate=v; const l=$('#msLines'), h=$('#msHead'); if(l) l.innerHTML=mrSlipLinesHtml(); if(h) h.textContent=mrSlipHead(); }
function mrSlipType(v){ _ms.q=v; _ms.i=-1; _ms.hits=_msHits(v); _ms.sel=0; mrSlipDD(); mrSlipLive(); }
function mrSlipDD(){ const d=$('#msDD'); if(!d) return;
  if(!_ms.hits.length){ d.innerHTML=_ms.q.trim()?`<div class="none">No Item Master entry matches “${esc(_ms.q)}” — add it in Item Master first.</div>`:''; d.classList.toggle('open', !!_ms.q.trim()); return; }
  d.innerHTML=_ms.hits.map((i,k)=>{ const r=rawData[i], s=_msStock(r.item);
    return `<div class="o ${k===_ms.sel?'on':''}" onmousedown="event.preventDefault();mrSlipPick(${i})"><span class="nm">${esc(r.item)}</span><span class="gp">${esc(r.group||'')}</span><b class="st ${s.cl<=0?'z':''}" title="Opening ${fmt(s.op)} + Received ${fmt(s.rv)} − Issued ${fmt(s.is)}">${fmt(s.cl)}<small>btl</small></b></div>`; }).join('');
  d.classList.add('open'); const on=d.querySelector('.o.on'); if(on && on.scrollIntoView) on.scrollIntoView({block:'nearest'}); }
function mrSlipPick(i){ const r=rawData[i]; if(!r) return; _ms.i=i; _ms.q=r.item; _ms.hits=[]; const inp=$('#msItem'); if(inp) inp.value=r.item;
  const d=$('#msDD'); if(d){ d.classList.remove('open'); d.innerHTML=''; } mrSlipLive(); const q=$('#msQty'); if(q){ q.focus(); if(q.select) q.select(); } }
function mrSlipBlur(){ setTimeout(()=>{ const d=$('#msDD'); if(d) d.classList.remove('open'); },150);
  if(_ms.i<0){ const v=(($('#msItem')||{}).value||'').trim(); const ex=v&&findRawExact(v); if(ex){ const i=rawData.indexOf(ex); if(i>=0){ _ms.i=i; _ms.q=ex.item; mrSlipLive(); } } } }
function mrSlipLive(){   // group · stock (→ after) · amount of the live row, from the picked item and the qty as typed
  const g=$('#msGrp'), s=$('#msStk'), a=$('#msAmt'); const r=_ms.i>=0?rawData[_ms.i]:null; const qty=fnum(($('#msQty')||{}).value);
  if(!r){ [g,s,a].forEach(el=>{ if(el) el.innerHTML='<span class="mu">—</span>'; }); return; }
  const st=_msStock(r.item), after=st.cl-qty, amt=qty*landOf(r.item);
  if(g) g.innerHTML=`<span class="pill gray">${esc(r.group||'—')}</span>`;
  if(s) s.innerHTML=`<b class="${st.cl<=0?'z':''}" title="Opening ${fmt(st.op)} + Received ${fmt(st.rv)} − Issued ${fmt(st.is)}">${fmt(st.cl)}</b>${qty>0?`<span class="ar">→</span><b class="${after<0?'neg':'ok'}" title="after this issue">${fmt(after)}</b>`:''}<small>btl</small>`;
  if(a) a.innerHTML=amt>0?'₹ '+fmt(Math.round(amt)):'<span class="mu">—</span>';
}
function mrSlipItemKey(e){
  if(e.key==='ArrowDown'){ e.preventDefault(); if(_ms.hits.length){ _ms.sel=Math.min(_ms.hits.length-1,_ms.sel+1); mrSlipDD(); } else if(_ms.i>=0){ const q=$('#msQty'); if(q) q.focus(); } }
  else if(e.key==='ArrowUp'){ if(_ms.hits.length){ e.preventDefault(); _ms.sel=Math.max(0,_ms.sel-1); mrSlipDD(); } }
  else if(e.key==='Enter'||e.key==='Tab'){ if(_ms.i<0 && _ms.hits.length){ e.preventDefault(); mrSlipPick(_ms.hits[_ms.sel]); } else if(e.key==='Enter' && _ms.i>=0){ e.preventDefault(); const q=$('#msQty'); if(q){ q.focus(); if(q.select) q.select(); } } }
  else if(e.key==='Escape'){ e.target.value=''; mrSlipType(''); }
}
function mrSlipQtyKey(e){
  if(e.key==='Enter'){ e.preventDefault(); mrSlipAdd(); }
  else if(e.key==='Tab' && !e.shiftKey){ e.preventDefault(); if(fnum(e.target.value)>0) mrSlipAdd(); else { const b=$('#msItem'); if(b) b.focus(); } }   // Tab after the qty = save the line and jump to the next item (v2.48.2); an empty qty just goes back to the item box
  else if(e.key==='ArrowUp'){ e.preventDefault(); const b=$('#msItem'); if(b){ b.focus(); try{ b.select(); }catch(err){} } }
  else if(e.key==='Escape'){ e.target.value=''; mrSlipLive(); }
}
function mrSlipAdd(){
  let r=_ms.i>=0?rawData[_ms.i]:null;
  if(!r){ const v=(($('#msItem')||{}).value||'').trim(); const ex=v&&findRawExact(v); if(ex) r=ex; else if(_ms.hits.length===1) r=rawData[_ms.hits[0]]; }
  if(!r){ toast('Which item?','Type a name and pick it from the list','err'); const b=$('#msItem'); if(b) b.focus(); return; }
  const q=fnum(($('#msQty')||{}).value); if(!(q>0)){ toast('Qty?','Enter the bottles to issue','err'); const qb=$('#msQty'); if(qb) qb.focus(); return; }
  const d=(($('#mqDate')||{}).value)||_mqDate||period.from; _mqDate=d;
  const left=_msStock(r.item).cl-q;
  mrDetail.push({id:_msNewId(), date:d, group:r.group||'', item:String(r.item).toUpperCase(), qty:q});
  bsv('mr',mrDetail); _msLast=mrDetail.length-1; _ms={i:-1, q:'', sel:0, hits:[]};
  routeQuiet();   // the register, the head figures and the slip lines follow; the entry row comes back empty
  toast('Issued', r.item+' — '+fmt(q)+' → Bar · '+fmt(left)+' left in Liquor Room', left<0?'err':'ok');
  const b=$('#msItem'); if(b) b.focus();
}
AFTER.mrdetail=function(){ if(document.activeElement===document.body && ((document.scrollingElement||document.documentElement).scrollTop||0)<40){ const b=$('#msItem'); if(b) b.focus(); } };
/* keyboard flow in the panel: search ↓ → first qty · qty ↓/↑ → next/prev qty (↑ from the
   first goes back to search) · Enter = issue · Esc clears the search */
function mrFindKey(e){
  if(e.key==='ArrowDown'){ const q2=document.querySelector('[id^="mqQ_"]'); if(q2){ q2.focus(); if(q2.select) q2.select(); e.preventDefault(); } }
  else if(e.key==='Escape'){ e.target.value=''; mrFindType(''); }
}
function mrQtyKey(e,i){
  if(e.key==='Enter'){ e.preventDefault(); mrQuickIssue(i); return; }
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp') return;
  const all=Array.from(document.querySelectorAll('[id^="mqQ_"]'));
  const ix=all.indexOf(e.target); if(ix<0) return;
  e.preventDefault();
  if(e.key==='ArrowDown'){ const n2=all[ix+1]; if(n2){ n2.focus(); if(n2.select) n2.select(); } }
  else if(ix===0){ const b=$('#mrFindBox'); if(b){ b.focus(); try{ b.setSelectionRange(0,(b.value||'').length); }catch(err){} } }
  else { const p=all[ix-1]; if(p){ p.focus(); if(p.select) p.select(); } }
}
function mrQuickIssue(i){
  const r=rawData[i]; if(!r) return;
  const q=fnum(($('#mqQ_'+i)||{}).value); if(!(q>0)){ toast('Qty?','Enter a quantity first','err'); return; }
  const d=(($('#mqDate')||{}).value)||_mqDate||period.from; _mqDate=d;
  mrDetail.push({date:d, group:r.group||'', item:String(r.item).toUpperCase(), qty:q});
  bsv('mr',mrDetail); route(); toast('Issued', r.item+' — '+fmt(q)+' → Bar','ok');
  // back to the search box with the query selected — typing a new name replaces it instantly
  const b=$('#mrFindBox'); if(b){ b.focus(); try{ b.select(); }catch(e2){} }
}
function mrGrpSpan(item){ const it=(item||'').trim(); if(!it) return ''; const r=findRaw(it); return `<span class="${r?'muted':'pill red'}" style="font-size:11px">${r?r.group:'⚠ not in Item Master'}</span>`; }
function mrRowHtml(i,d){
  return `<tr>
    <td><input class="cell-input" style="width:140px" type="date" value="${d.date||period.from}" onchange="mrDField(${i},'date',this.value)"></td>
    <td><input class="cell-input" style="width:280px;text-align:left" list="rawItems" value="${esc(d.item||'')}" placeholder="Search item…" onchange="mrDItem(${i},this.value)"></td>
    <td><input class="cell-input" style="width:70px" type="number" value="${d.qty||''}" placeholder="qty" onchange="mrDField(${i},'qty',this.value)"></td>
    <td id="mrgrp${i}">${mrGrpSpan(d.item)}</td>
    <td class="right">${mrDraft.length>1?`<button class="btn btn-danger btn-sm" onclick="mrDraftDel(${i})">✕</button>`:''}</td></tr>`;
}
function mrManualStockInner(){
  let mi='';
  for(let i=mrDraft.length-1;i>=0;i--){ const it=(mrDraft[i].item||'').trim(); if(!it) continue; const r=findRaw(it); if(r){mi=r.item;break;} const c=mrVoiceClosest(it); if(c.length){mi=c[0];break;} }
  return mi ? `<div class="muted" style="font-size:11px;margin-bottom:6px">📦 Liquor Room stock — ${esc(mi)}</div>${mrVoiceStockHtml(mi,false)}`
            : '<div class="muted" style="font-size:12px">Type an item above to see its Liquor Room stock…</div>';
}
// SILENT field update — no re-render, so Tab flows Date→Item→Qty→next-row smoothly
function mrDField(i,field,val){ if(mrDraft[i]) mrDraft[i][field]=val; }
function mrDItem(i,val){
  if(!mrDraft[i]) return; mrDraft[i].item=val;
  const g=$('#mrgrp'+i); if(g) g.innerHTML=mrGrpSpan(val);          // update group cell in place
  const s=$('#mrStock'); if(s) s.innerHTML=mrManualStockInner();    // update stock preview in place
  if(val.trim() && i===mrDraft.length-1){ mrDraft.push({date:'',item:'',qty:''}); const tb=$('#mrDraftBody'); if(tb) tb.insertAdjacentHTML('beforeend', mrRowHtml(mrDraft.length-1, mrDraft[mrDraft.length-1])); }
}
function mrDraftDel(i){ mrDraft.splice(i,1); if(!mrDraft.length) mrDraft=[{date:'',item:'',qty:''}]; route(); }
function mrSaveAll(){
  const valid=mrDraft.filter(d=>d.item.trim() && (+d.qty>0));
  if(!valid.length){ toast('Nothing to save','Fill at least one item + qty','err'); return; }
  let unmatched=0;
  valid.forEach(d=>{ const item=d.item.trim().toUpperCase(); const r=findRaw(item); if(!r) unmatched++;
    mrDetail.push({date:d.date||period.from, group:r?r.group:'', item, qty:+d.qty}); });
  bsv('mr',mrDetail); mrDraft=[{date:'',item:'',qty:''}]; route();
  toast('Saved',`${valid.length} issue(s) added${unmatched?' · '+unmatched+' unmatched (red)':''}`, unmatched?'err':'ok');
}
function delMr(i){ confirmAsk('Delete this MR issue?', ()=>{ mrDetail.splice(i,1); bsv('mr',mrDetail); route(); toast('Deleted','Issue removed','err'); }); }

/* ---- MR Detail · Voice Assistant — continuous flow: Item → Date → Qty → issue → next ---- */
function mrVoicePanel(){
  const step = mrVoiceStep==='item' ? '① Say an ITEM name'
    : mrVoiceStep==='date' ? '② Say the DATE (“15 June”, “today”, or “skip”)'
    : '③ Say the QTY (e.g. “ten”)';
  const cur = mrVoiceItem ? `<div class="muted" style="font-size:12px;margin-bottom:4px">Selected: <strong style="color:var(--text)">${esc(mrVoiceItem)}</strong>${mrVoiceDate?` · Date <strong style="color:var(--text)">${mrVoiceDate}</strong>`:''}</div>` : '';
  const vers = mrVoiceVersionsList();
  const versHtml = (mrVoiceItem && vers.length>1) ? `<div style="margin:6px 0"><span class="muted" style="font-size:11px">Versions (tap to switch):</span> ${vers.map(n=>`<button class="btn btn-sm ${norm(n)===norm(mrVoiceItem)?'btn-gold':''}" style="margin:2px" onclick='mrVoicePick(${JSON.stringify(n)})'>${esc(n)}</button>`).join('')}</div>` : '';
  return `
    <div class="card" style="margin-bottom:16px"><div class="card-head" style="flex-wrap:wrap;gap:8px"><div><h3>🎤 Voice Assistant ${mrVoiceOn?'<span class="pill green" style="font-size:9px">● live</span>':''}</h3><p>Hands-free: Item → Date → Qty → issued, then next. Say “stop” to end · “cancel” to reset.</p></div>
      <div class="flex gap-8 items-center"><div class="tabs" style="margin:0;border:none"><div class="tab ${mrVoiceLang==='en-US'?'active':''}" onclick="mrSetLang('en-US')">English</div><div class="tab ${mrVoiceLang!=='en-US'?'active':''}" onclick="mrSetLang('bn-IN')">বাংলা</div></div>
      <button class="btn ${mrVoiceOn?'btn-danger':'btn-gold'} btn-sm" onclick="mrVoiceToggle()">${mrVoiceOn?'⏹ Stop':'🎤 Start'}</button></div></div>
      <div class="card-body">
        <div style="font-weight:700;margin-bottom:6px">${step}</div>
        ${cur}
        <div class="muted" id="mrHeardWrap" style="font-size:12px;margin:4px 0;${mrVoiceHeard?'':'display:none'}">Heard: “<strong id="mrHeard" style="color:var(--text)">${esc(mrVoiceHeard)}</strong>”</div>
        ${mrVoiceMsg?`<div style="font-size:12px;margin:4px 0;color:var(--gold-soft)">${mrVoiceMsg}</div>`:''}
        ${(!mrVoiceItem && mrVoiceSuggest.length)?`<div style="margin:6px 0"><span class="muted" style="font-size:11px">Did you mean:</span> ${mrVoiceSuggest.map(n=>`<button class="btn btn-sm" style="margin:2px" onclick='mrVoicePick(${JSON.stringify(n)})'>${esc(n)}</button>`).join('')}</div>`:''}
        ${versHtml}
        ${mrVoiceItem?mrVoiceStockHtml(mrVoiceItem):'<div class="muted" style="font-size:12px">🎧 Press Start, allow the mic once, then speak…</div>'}
      </div></div>`;
}
function mrSetLang(l){ mrVoiceLang=l; if(mrVoiceOn){ mrVoiceStop(); setTimeout(mrVoiceStart,200); } route(); }
function mrVoiceToggle(){ if(mrVoiceOn) mrVoiceStop(); else mrVoiceStart(); }
function mrVoiceStart(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ toast('Not supported','Voice needs Chrome/Edge + internet','err'); return; }
  try{
    _mrRec=new SR(); _mrRec.lang=mrVoiceLang; _mrRec.continuous=true; _mrRec.interimResults=true; _mrRec.maxAlternatives=6;
    _mrRec.onresult=e=>{ const res=e.results[e.results.length-1]; if(!res) return;
      if(!res.isFinal){ const w=$('#mrHeardWrap'), h=$('#mrHeard'); if(h){ h.textContent=res[0].transcript; if(w) w.style.display=''; } return; }   // live interim = feels fast
      const alts=[]; for(let k=0;k<res.length;k++) alts.push(String(res[k].transcript).trim()); mrVoiceHandleAlts(alts); };
    _mrRec.onerror=ev=>{
      if(ev.error==='not-allowed'||ev.error==='service-not-allowed'){ mrVoiceOn=false;
        mrVoiceMsg='⚠ Microphone blocked — click the 🔒 / mic icon in the address bar, ALLOW the microphone, then press Start again.'; route(); }
      else if(ev.error==='network'){ mrVoiceOn=false;
        mrVoiceMsg='⚠ Voice needs INTERNET (the browser sends speech to its online service). Offline? Use 📂 Excel / Paste instead — it works without voice.'; route(); }
      else if(ev.error==='audio-capture'){ mrVoiceOn=false;
        mrVoiceMsg='⚠ No microphone found — plug one in / check Windows sound settings, then press Start again.'; route(); }
    };   // 'no-speech'/'aborted' are transient — onend auto-restarts
    _mrRec.onend=()=>{ if(mrVoiceOn){ try{ _mrRec.start(); }catch(_){} } };   // auto-restart → stays live, no repeat permission
    _mrRec.start(); mrVoiceOn=true; mrVoiceHeard=''; mrVoiceMsg='🎧 Listening… speak an item name.'; route();
  }catch(err){ toast('Mic busy','Try again in a moment','err'); }
}
function mrVoiceStop(){ mrVoiceOn=false; if(_mrRec){ try{ _mrRec.stop(); }catch(_){} } mrVoiceMsg='⏹ Stopped.'; route(); }
function mrVoiceReset(){ mrVoiceItem=''; mrVoiceDate=''; mrVoiceSuggest=[]; mrVoiceStep='item'; }
function mrVoiceHandle(txt){
  mrVoiceHeard=txt; const low=txt.toLowerCase().trim(); if(!low) return;
  if(/\b(stop|band)\b/.test(low)||low.includes('স্টপ')||low.includes('বন্ধ')||low.includes('থাম')){ mrVoiceStop(); return; }
  if(/\b(cancel|reset|clear|back)\b/.test(low)||low.includes('বাতিল')||low.includes('ক্যানসেল')){ mrVoiceReset(); mrVoiceMsg='Reset — say an item.'; route(); return; }
  if(mrVoiceStep==='item'){
    const m=mrVoiceFind(txt);
    if(m){ mrVoiceItem=m; mrVoiceSuggest=[]; mrVoiceStep='date'; mrVoiceMsg='✓ '+esc(m)+' — now say the DATE, or “skip”.'; }
    else { mrVoiceItem=''; mrVoiceSuggest=mrVoiceClosest(txt); mrVoiceMsg=mrVoiceSuggest.length?'Not sure — tap the closest below, or say it again:':'No match. Say the item name again.'; }
    route(); return;
  }
  if(mrVoiceStep==='date'){
    mrVoiceDate=parseSpokenDate(txt, period.from); mrVoiceStep='qty'; mrVoiceMsg='Date '+mrVoiceDate+' — now say the QTY.'; route(); return;
  }
  if(mrVoiceStep==='qty'){
    const qty=parseSpokenQty(txt);
    if(qty>0 && mrVoiceItem) mrVoiceCommit(qty);
    else { mrVoiceMsg='Didn’t catch a number — say the quantity again.'; route(); }
    return;
  }
}
// pick the best of the recognition guesses — hugely improves brand-name accuracy
function mrVoiceHandleAlts(alts){
  alts=alts.filter(Boolean); if(!alts.length) return;
  if(mrVoiceStep==='item'){
    let best='', bestAlt=alts[0], bestScore=0;
    alts.forEach(a=>{ const m=mrVoiceFind(a); if(m){ const sc=_sim(a,m); if(sc>bestScore){ bestScore=sc; best=m; bestAlt=a; } } });
    mrVoiceHandle(best?bestAlt:alts[0]); return;
  }
  const withNum=alts.find(a=>/\d/.test(a)) || alts[0];   // date/qty → prefer a guess containing a number
  mrVoiceHandle(withNum);
}
function mrVoiceCommit(qty){
  const name=mrVoiceItem, d=mrVoiceDate||period.from, r=findRaw(name);
  mrDetail.push({date:d, group:r?r.group:'', item:String(name).toUpperCase(), qty}); bsv('mr',mrDetail);
  toast('Issued',`${qty} × ${name} → Bar`,'ok');
  mrVoiceReset(); mrVoiceMsg='✅ Issued '+qty+' × '+esc(name)+' on '+d+'. Say the next item…'; route();
}
function mrVoicePick(name){ mrVoiceItem=name; mrVoiceSuggest=[]; if(mrVoiceStep==='item') mrVoiceStep='date'; mrVoiceMsg='✓ '+esc(name)+' — say the DATE, or “skip”.'; route(); }
function mrVoiceFind(txt){
  const n=norm(txt); if(n.length<2) return '';
  const ex=rawData.find(r=>norm(r.item)===n); if(ex) return ex.item;
  const part=rawData.find(r=>{ const nn=norm(r.item); return nn.includes(n)||n.includes(nn); }); if(part) return part.item;
  const words=n.split(' ').filter(w=>w.length>2);
  const tok=words.length? rawData.find(r=>{ const nn=norm(r.item); return words.every(w=>nn.includes(w)); }) : null;
  if(tok) return tok.item;
  const c=mrVoiceClosest(txt); return (c.length && _sim(txt,c[0])>=0.55) ? c[0] : '';   // strong fuzzy = auto-accept
}
function _bigrams(s){ const a=[]; for(let i=0;i<s.length-1;i++) a.push(s.substr(i,2)); return a; }
function _sim(a,b){ a=norm(a).replace(/\s/g,''); b=norm(b).replace(/\s/g,''); if(!a||!b) return 0; if(a===b) return 1;
  const A=_bigrams(a), B=_bigrams(b); if(!A.length||!B.length) return 0;
  const map={}; A.forEach(g=>map[g]=(map[g]||0)+1); let hit=0; B.forEach(g=>{ if(map[g]>0){ map[g]--; hit++; } });
  return (2*hit)/(A.length+B.length); }
function mrVoiceClosest(txt){
  const pool=[...new Set(rawData.map(r=>r.item))];
  return pool.map(n=>({n, s:_matchScore(txt,n)})).filter(x=>x.s>0.25).sort((a,b)=>b.s-a.s).slice(0,4).map(x=>x.n);
}
// Levenshtein similarity (0..1) — much better than bigrams on OCR-garbled words
function _lev(a,b){ const m=a.length,n=b.length; if(!m||!n) return 0; const d=new Array(n+1);
  for(let j=0;j<=n;j++) d[j]=j;
  for(let i=1;i<=m;i++){ let prev=d[0]; d[0]=i;
    for(let j=1;j<=n;j++){ const t=d[j]; d[j]=Math.min(d[j]+1, d[j-1]+1, prev+(a[i-1]===b[j-1]?0:1)); prev=t; } }
  return 1-d[n]/Math.max(m,n); }
// token score: each OCR word vs its best-matching word in the raw name (prefix bonus), length-weighted
function _tokScore(q,name){ const qt=norm(q).split(' ').filter(w=>w.length>=3); if(!qt.length) return 0;
  const nt=norm(name).split(' ').filter(w=>w.length>=2); if(!nt.length) return 0;
  let tot=0,wsum=0;
  qt.forEach(t=>{ let best=0; nt.forEach(w=>{ let s=_lev(t,w); if(w.slice(0,3)===t.slice(0,3)) s=Math.max(s,0.62); if(s>best) best=s; });
    tot+=best*t.length; wsum+=t.length; });
  return tot/wsum; }
function _matchScore(q,name){
  const a=norm(q).replace(/\s/g,''), b=norm(name).replace(/\s/g,'');
  return Math.max(_sim(q,name), 0.6*_tokScore(q,name)+0.4*_lev(a,b));
}
function bestRawMatch(txt){ let best='',bs=0;
  [...new Set(rawData.map(r=>r.item))].forEach(n=>{ const s=_matchScore(txt,n); if(s>bs){bs=s;best=n;} });
  return {name:best,score:bs}; }
// all raw-data versions/sizes sharing the selected item's first significant words
function mrVoiceVersionsList(){
  if(!mrVoiceItem) return [];
  const base=norm(mrVoiceItem).split(' ').filter(w=>w.length>2).slice(0,2); if(!base.length) return [mrVoiceItem];
  const list=rawData.map(r=>r.item).filter(n=>{ const nn=norm(n); return base.every(w=>nn.includes(w)); });
  return list.length?[...new Set(list)]:[mrVoiceItem];
}
function parseSpokenDate(txt, fallback){
  const low=txt.toLowerCase();
  if(/today|now|আজ/.test(low)) return new Date().toISOString().slice(0,10);
  if(/skip|default|same|no date|একই|ওই/.test(low)) return fallback;
  const M={january:1,jan:1,february:2,feb:2,march:3,mar:3,april:4,apr:4,may:5,june:6,jun:6,july:7,jul:7,august:8,aug:8,september:9,sept:9,sep:9,october:10,oct:10,november:11,nov:11,december:12,dec:12};
  let mo=null; for(const k in M){ if(low.includes(k)){ mo=M[k]; break; } }
  const nums=(low.match(/\d+/g)||[]).map(Number);
  const yr=(fallback&&fallback.length>=4)?fallback.slice(0,4):String(new Date().getFullYear());
  if(mo){ const day=nums.find(n=>n>=1&&n<=31)||1; return `${yr}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`; }
  if(nums.length>=3){ const a=nums[0],b=nums[1],c=nums[2]; if(a>31) return `${a}-${String(b).padStart(2,'0')}-${String(c).padStart(2,'0')}`; return `${c>31?c:yr}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`; }
  if(nums.length===1&&nums[0]>=1&&nums[0]<=31){ const fm=(fallback&&fallback.length>=7)?fallback.slice(5,7):'01'; return `${yr}-${fm}-${String(nums[0]).padStart(2,'0')}`; }
  return fallback;
}
function parseSpokenQty(txt){
  const low=txt.toLowerCase(); const d=(low.match(/\d+/)||[])[0]; if(d) return +d;
  const W={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,eighteen:18,twenty:20,twentyfive:25,thirty:30,forty:40,fifty:50,hundred:100,'এক':1,'দুই':2,'তিন':3,'চার':4,'পাঁচ':5,'ছয়':6,'সাত':7,'আট':8,'নয়':9,'দশ':10};
  for(const k in W){ if(low.includes(k)) return W[k]; }
  return 0;
}
function mrVoiceStockHtml(name, btn){
  const op=fnum(invGet(name).lrOpen), rv=receivedForItem(name), is=issuedForItem(name), cl=op+rv-is;
  const r=findRaw(name);
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
    <div style="flex:1;min-width:170px"><div style="font-size:15px;font-weight:800">${esc(name)}</div>
      <div class="${r?'muted':'pill red'}" style="font-size:11px;margin-top:2px;display:inline-block">${r?r.group:'⚠ not in Item Master'}</div></div>
    <div class="stat-strip" style="flex:3;margin:0">
      <div class="s"><div class="l">Opening</div><div class="v">${fmt(op)}</div></div>
      <div class="s"><div class="l">Received</div><div class="v">${fmt(rv)}</div></div>
      <div class="s"><div class="l">Issued</div><div class="v">${fmt(is)}</div></div>
      <div class="s"><div class="l">In Liquor Room</div><div class="v gold">${fmt(cl)}</div></div>
    </div>
    ${btn===false?'':`<button class="btn btn-gold btn-sm" onclick="mrVoiceAddPrompt()">➕ Add (type)</button>`}</div>`;
}
function mrVoiceAddPrompt(){
  const name=mrVoiceItem; if(!name){ toast('No item','Speak / pick an item first','err'); return; }
  modal('➕ Add MR Issue — '+esc(name), `
    <div class="field"><label>Date</label><input class="input" type="date" id="mvDate" value="${mrVoiceDate||period.from}"></div>
    <div class="field"><label>Qty to issue (Liquor Room → Bar)</label><input class="input" type="number" id="mvQty" placeholder="qty"></div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="mrVoiceAddSave()">Add Issue</button>`);
  setTimeout(()=>{ const q=$('#mvDate'); if(q) q.focus(); },60);
}
function mrVoiceAddSave(){
  const name=mrVoiceItem; if(!name) return;
  const d=$('#mvDate').value||period.from, qty=+$('#mvQty').value||0;
  if(qty<=0){ toast('Qty?','Enter a quantity','err'); return; }
  const r=findRaw(name);
  mrDetail.push({date:d, group:r?r.group:'', item:String(name).toUpperCase(), qty}); bsv('mr',mrDetail);
  closeModal(); mrVoiceReset(); mrVoiceMsg='✅ Issued '+qty+' × '+esc(name); route(); toast('Issued',`${qty} × ${name} → Bar`,'ok');
}

/* ============================================================
   4) LIQUOR ROOM — Opening(manual) + Received(auto) − Issued = Closing
   (all Raw Data items + any red unmatched names)
   ============================================================ */
let lrFilter='all';
let lrBlank='none';
VIEWS.liquorroom = () => {
  const q=iq.lr;
  const groups=groupRaw(r=> !q || norm(r.item).includes(norm(q)) || norm(r.group).includes(norm(q)));
  let tOpen=0,tRecv=0,tIss=0,tClose=0, tValO=0,tValR=0,tValI=0, shownN=0, shownSel=0;
  const pass=cl=> lrFilter==='all' || (lrFilter==='instock'&&cl>0) || (lrFilter==='zero'&&cl===0) || (lrFilter==='neg'&&cl<0);
  const passB=v=> lrBlank==='none' || (lrBlank==='op'&&v.op===0) || (lrBlank==='rv'&&v.rv===0) || (lrBlank==='is'&&v.is===0) || (lrBlank==='cl'&&v.cl===0);
  let tVal=0;
  const rowHtml=(name,idx,grpKnown,op,rv,is,cl,grp)=>{
    const land=invGet(name).land, mrp=invGet(name).mrp, val=cl*landOf(name);
    const sgn=(n,cls,pre)=> n>0 ? `<span class="lrsg ${cls}">${pre}${fmt(n)}</span>` : `<span class="lrsg zero">0</span>`;
    return `<tr class="${grpKnown?'':'row-alert'}">
      <td class="lrname">${idx>=0?`<input type="checkbox" class="rdsel selcb" data-n="${esc(norm(name))}" data-g="${esc(grp||'')}" ${_rdSel.has(norm(name))?'checked':''} title="Select" onchange="rdSelToggle(this)"> `:''}<strong>${name}</strong>${grpKnown?'':' '+redBadge()}</td>
      <td class="num"><input class="cell-input lrland" value="${land!=null?land:''}" placeholder="${landOf(name)?Math.round(landOf(name)*100)/100:'₹'}" title="${land!=null&&land!==''?'Your Item Master rate — values this item everywhere':'Automatic: the latest BEVCO invoice rate (or MRP) — type a rate to make it yours'}" onchange="${idx>=0?`invSetRaw(${idx},'land',this.value)`:`invSet('${esc(name).replace(/'/g,"\'")}','land',this.value)`}"></td>
      <td class="num"><input class="cell-input lrobox" value="${invGet(name).lrOpen!=null?invGet(name).lrOpen:''}" placeholder="0" title="Opening bottles — or 12+12" onchange="${idx>=0?`invSetRaw(${idx},'lrOpen',this.value)`:`invSet('${esc(name).replace(/'/g,"\'")}','lrOpen',this.value)`}"></td>
      <td class="num">${sgn(rv,'plus','+')}</td>
      <td class="num">${sgn(is,'minus','−')}</td>
      <td class="num"><strong class="lrclose ${cl<0?'neg':''}">${fmt(cl)}</strong></td>
      <td class="num"><span class="lrval">${val?('₹ '+fmt(Math.round(val))):'<span class="muted">—</span>'}</span></td>
      <td class="nowrap">${cl<0?'<span class="pill red">negative</span>':cl===0?'<span class="pill gray">empty</span>':cl<5?'<span class="pill amber">low</span>':'<span class="pill green">ok</span>'}${idx>=0?` <button class="btn btn-danger btn-sm rmx" title="Remove this item from the Item Master & Liquor Room (linked Beverage Control brand goes too unless it has figures)" onclick="rawRemoveAsk(${idx})">✕</button>`:''}</td></tr>`; };
  const calc=name=>{ const op=fnum(invGet(name).lrOpen), rv=receivedForItem(name), is=issuedForItem(name); return {op,rv,is,cl:op+rv-is}; };
  let body=groups.map(g=>{
    let gO=0,gR=0,gI=0,gC=0, gN=0, gSel=0;
    const rows=g.items.map(r=>{ const v=calc(r.item); if(!pass(v.cl)||!passB(v)) return ''; gN++; shownN++; if(_rdSel.has(norm(r.item))){ gSel++; shownSel++; }
      gO+=v.op; gR+=v.rv; gI+=v.is; gC+=v.cl;
      const m=landOf(r.item);
      tOpen+=v.op; tRecv+=v.rv; tIss+=v.is; tClose+=v.cl; tValO+=v.op*m; tValR+=v.rv*m; tValI+=v.is*m; tVal+=v.cl*m;
      return rowHtml(r.item, rawData.indexOf(r), true, v.op,v.rv,v.is,v.cl, g.group); }).join('');
    if(!rows) return '';
    // per-group separate totals: Opening · Received · Issued · Closing · Value
    const gV=g.items.reduce((a,r)=>{ const v=calc(r.item); return (pass(v.cl)&&passB(v)) ? a+v.cl*landOf(r.item) : a; },0);
    const sub=`<tr class="lrsub"><td colspan="2" class="right"><strong>${g.group} — TOTAL</strong></td>
      <td class="num"><strong>${fmt(gO)}</strong></td><td class="num"><strong class="lrsg ${gR>0?'plus':'zero'}">${gR>0?'+':''}${fmt(gR)}</strong></td>
      <td class="num"><strong class="lrsg ${gI>0?'minus':'zero'}">${gI>0?'−':''}${fmt(gI)}</strong></td><td class="num"><strong class="lrclose">${fmt(gC)}</strong></td>
      <td class="num"><strong class="lrval">₹ ${fmt(Math.round(gV))}</strong></td><td></td></tr>`;
    return `<tr class="grp-row lrgrp"><td colspan="8"><input type="checkbox" class="rdselg selcb" data-g="${esc(g.group)}" ${gN&&gSel===gN?'checked':''} title="Select this group" onchange="rdSelGroup(this)"> <span class="g">${g.group}</span><span class="n">${g.items.length} items</span></td></tr>${rows}${sub}`;
  }).join('');
  const extra=unmatchedNames().filter(n=> !q || norm(n).includes(norm(q)));
  if(extra.length){ const erows=extra.map(n=>{ const v=calc(n); if(!pass(v.cl)||!passB(v)) return '';
      const m=landOf(n);
      tOpen+=v.op; tRecv+=v.rv; tIss+=v.is; tClose+=v.cl; tValO+=v.op*m; tValR+=v.rv*m; tValI+=v.is*m; tVal+=v.cl*m;
      return rowHtml(n,-1,false,v.op,v.rv,v.is,v.cl); }).join('');
    if(erows) body += `<tr class="grp-row"><td colspan="8" style="color:var(--red)">⚠ NOT IN ITEM MASTER — add these to Item Master</td></tr>`+erows; }
  const ftab=(id,lbl)=>`<div class="tab ${lrFilter===id?'active':''}" onclick="lrFilter='${id}';route()">${lbl}</div>`;
  const lay=pageLay('liquorroom');
  const defCard=`<div class="card"><div class="table-wrap" style="max-height:600px;overflow-y:auto"><table class="tbl rawhead">
      <thead><tr><th><input type="checkbox" id="rdSelAll" class="selcb" ${shownN&&shownSel===shownN?'checked':''} title="Select all shown" onchange="rdSelAll(this.checked)"> Item</th><th class="right nowrap" style="width:112px">Landing ₹/bot</th><th class="right" style="width:96px">Opening</th><th class="right" style="width:90px">Received</th><th class="right" style="width:90px">Issued</th><th class="right" style="width:96px">Closing</th><th class="right" style="width:112px">Value ₹</th><th style="width:86px">Status</th></tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
  let bodyHtml;
  if(lay==='def') bodyHtml=defCard;
  else if(lay==='dense') bodyHtml=`<div class="laydense">${defCard}</div>`;
  else {
    const grp=groups.map(g=>{
      const its=g.items.map(r=>{ const name=r.item, op=fnum(invGet(name).lrOpen), rv=receivedForItem(name), is=issuedForItem(name), cl=op+rv-is; return {name, idx:rawData.indexOf(r), op, rv, is, cl}; })
        .filter(x=>pass(x.cl)&&passB(x));
      return { id:g.group, title:g.group, sub:`${its.length} items`,
        right:`<span class="num gold" style="font-weight:700">${fmt(its.reduce((a,x)=>a+x.cl,0))}</span>`,
        detail: its.map(x=>`<div class="flex between items-center" style="padding:4px 0;border-bottom:1px solid var(--border-soft);font-size:12px;gap:8px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${x.name}</span><span class="nowrap muted" style="font-size:11px">op <input class="cell-input" style="width:46px" value="${invGet(x.name).lrOpen!=null?invGet(x.name).lrOpen:''}" placeholder="0" onchange="invSetRaw(${x.idx},'lrOpen',this.value);route()"> +${x.rv} −${x.is} = <strong class="${x.cl<0?'':'gold'}" style="${x.cl<0?'color:var(--red)':''}">${x.cl}</strong></span></div>`).join('')||'<span class="muted" style="font-size:12px">none</span>' };
    }).filter(g=>g.detail.indexOf('none')<0 || lrFilter==='all');
    bodyHtml=renderLay('liquorroom',lay,grp,{listTitle:'Groups'});
  }
  // ---- 5 premium looks (Chart.js canvases built in AFTER.liquorroom) ----
  const look=pref.lrLook||'def';
  const SER="font-family:Georgia,'Times New Roman',serif";
  let lrRoyal='';
  if(look!=='def'){
    const GOLDS=['#d8bd7f','#b89a5c','#8a6d3b','#6b5836','#5c4a28','#3a2f1c','#2a2620'];
    const dotc=c=>`<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${c};margin-right:4px"></span>`;
    const gv={}; const top=[];
    rawData.forEach(r=>{ const v=calc(r.item); const m=landOf(r.item); const val=v.cl*m;
      if(val>0){ gv[r.group]=(gv[r.group]||0)+val; top.push({n:r.item, val, cl:v.cl}); } });
    top.sort((a,b)=>b.val-a.val);
    const gTop=Object.entries(gv).sort((a,b)=>b[1]-a[1]);
    const legend=gTop.slice(0,5).map((g,i)=>`${dotc(GOLDS[i])}${esc(g[0])} <strong style="color:var(--text)">₹ ${fmt(Math.round(g[1]))}</strong>`).join('<br>');
    const ledger=gTop.map(([g,v])=>`<div class="flex between items-center" style="padding:4px 0;border-bottom:1px solid var(--border-soft);font-size:12px;gap:8px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(g)}</span><strong class="gold">₹ ${fmt(Math.round(v))}</strong></div>`).join('')||'<span class="muted" style="font-size:12px">no stock value yet — set Opening / Landing ₹</span>';
    const pieCard=(id,title,lg,h)=>`<div class="card" style="flex:1;min-width:220px"><div class="card-head"><h3 style="${SER};color:var(--gold)">${title}</h3></div>
      <div class="card-body" style="display:flex;gap:12px;align-items:center"><div style="width:${h||120}px;height:${h||120}px;flex:none;position:relative"><canvas id="${id}"></canvas></div>
      <div style="font-size:11px;color:var(--text-muted);line-height:1.9">${lg||''}</div></div></div>`;
    if(look==='donut'){
      lrRoyal=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">${pieCard('lrC1','👑 Closing value — group-wise',legend)}
        <div class="card" style="flex:1.3;min-width:250px"><div class="card-head"><h3 style="${SER};color:var(--gold)">Royal Stock Ledger</h3></div><div class="card-body">${ledger}</div></div></div>`;
    } else if(look==='bars'){
      lrRoyal=`<div class="card" style="margin-bottom:14px"><div class="card-head"><h3 style="${SER};color:var(--gold)">🥇 Top items — closing value (₹)</h3></div>
        <div class="card-body"><div style="height:${Math.max(140, Math.min(top.length,10)*26)}px;position:relative"><canvas id="lrC2"></canvas></div></div></div>`;
    } else if(look==='gauge'){
      const avail=tOpen+tRecv, pct=avail?Math.round(tIss/avail*100):0;
      lrRoyal=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div class="card" style="width:250px;flex:none"><div class="card-head"><h3 style="${SER};color:var(--gold)">👑 Issued of available</h3></div>
          <div class="card-body" style="text-align:center"><div style="height:110px;position:relative"><canvas id="lrC3"></canvas></div>
          <div style="${SER};font-size:22px;color:var(--gold);margin-top:-34px">${pct}%</div><div class="muted" style="font-size:11px">${fmt(tIss)} of ${fmt(avail)} bots</div></div></div>
        <div class="card" style="flex:1;min-width:280px"><div class="card-head"><h3 style="${SER};color:var(--gold)">Royal Stock Ledger</h3></div><div class="card-body">${ledger}</div>
          <div class="card-body" style="border-top:1px solid var(--gold-dim);display:flex;justify-content:space-between"><span class="muted" style="${SER}">CLOSING VALUE</span><strong class="gold" style="${SER};font-size:16px">₹ ${fmt(Math.round(tVal))}</strong></div></div></div>`;
    } else if(look==='register'){
      lrRoyal=`<div class="card" style="margin-bottom:14px"><div class="card-body" style="text-align:center;border-bottom:1px solid var(--gold)">
          <div style="${SER};font-size:10px;letter-spacing:3px;color:var(--text-dim);text-transform:uppercase">— ${esc(cfg.company||'Traffic Gastropub')} · Liquor Room Register —</div>
          <div style="${SER};font-size:26px;color:var(--text);margin-top:4px">₹ ${fmt(Math.round(tVal))}</div>
          <div class="muted" style="font-size:11px"><strong class="gold">${fmt(tClose)} bots</strong> closing stock · ${period.from} → ${period.to}</div></div>
        <div class="card-body" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          <div style="flex:1.4;min-width:240px">${ledger}</div>
          <div style="width:150px;flex:none;text-align:center"><div style="width:110px;height:110px;margin:0 auto;position:relative"><canvas id="lrC4"></canvas></div></div></div></div>`;
    }
  }
  // ---- head looks (v2.46.0): the client picked BOTH mockups of the Liquor Room canvas — ① Royal Ledger (the Excel
  //   TOTAL row as a gilded grid + the stock ring, every control in ONE toolbar row above) and ② Crown Seal (double
  //   frame, centre seal, two + two cards, the controls in a gold band below) — with the v2.31.0 flow kept as ③ Classic.
  //   pref.lrHead picks one (here and in Settings → Appearance). Same totals as always; theme tokens only.
  const headLook=lrHeadNow();
  const nInHand=groups.reduce((a,g)=>a+g.items.filter(r=>{const v=calc(r.item);return pass(v.cl)&&passB(v)&&v.cl!==0;}).length,0);
  const nOpen=groups.reduce((a,g)=>a+g.items.filter(r=>{const v=calc(r.item);return pass(v.cl)&&passB(v)&&v.op>0;}).length,0);
  const per=(v,b)=>b>0?'₹ '+fmt(Math.round(v/b)):'—';
  const pctOf=v=>tVal>0?v/tVal*100:0;
  const smallSel=(title,onchange,opts,cur)=>`<select class="input" style="width:auto;padding:4px 8px;font-size:11.5px" title="${title}" onchange="${onchange}">${opts.map(o=>`<option value="${o[0]}" ${cur===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select>`;
  const LOOK_OPTS=[['def','① Classic'],['donut','② Royal Donut'],['bars','③ Golden Bars'],['gauge','④ Crown Gauge'],['register','⑤ Monogram Register']];
  const BLANK_OPTS=[['none','— blank filter'],['op','Opening blank (0)'],['rv','Received 0'],['is','Issued 0'],['cl','Closing 0']];
  const headSel=smallSel('Head look — how the top section is drawn','setLrHead(this.value)',LR_HEADS,headLook);
  const fpill=(id,lbl,d)=>`<button class="lrpill ${lrFilter===id?'on':''}" onclick="lrFilter='${id}';route()">${d?`<i class="d ${d}"></i>`:''}${lbl}</button>`;
  const tools=`${periodBar(true)}<span class="lrsep"></span>${fpill('all','All')}${fpill('instock','In Stock','g')}${fpill('zero','Zero','z')}${fpill('neg','Negative','r')}${smallSel('Blank / zero filter','lrBlank=this.value;route()',BLANK_OPTS,lrBlank)}${rdSelBarHtml()}
      <div class="search lrq">🔎<input id="searchBox" placeholder="Search item or group — the sheet filters as you type…" value="${esc(q)}" oninput="isearch('lr',this.value)"></div>
      <button class="btn btn-sm" onclick="expReport('lroom','xlsx')" title="Download this sheet as Excel">📊 Excel</button><button class="btn btn-sm" onclick="printSheet('lroom')" title="Clean print of this sheet — Save as PDF from the dialog">🖨 Print</button>`;
  const tl=`<div class="tl noprint">${headSel}${smallSel('Premium look','setLrLook(this.value)',LOOK_OPTS,look)}${layDrop('liquorroom')}</div>`;
  // ① Royal Ledger — the .bcledger title + .bclh grid of the Beverage Control head, five columns, the .lrflow ring
  const shareCell=(v,c,hi)=>{ const p=pctOf(v); return `<div class="s${hi?' hi':''}">${p.toFixed(1)}%<span class="bar ${c}"><i style="width:${Math.min(100,p).toFixed(1)}%"></i></span></div>`; };
  const ledgerHead=`<div class="card lrflow bcledger lrledger">
      <div class="bh"><div class="t">Liquor Room Ledger</div><div class="f">Opening <b>+</b> Received <b>−</b> Issued to bar <b>=</b> Closing</div><div class="p">${nInHand} items in hand · ${esc(period.from)} → ${esc(period.to)}</div>${tl}</div>
      <div class="lrl-body">
        <div class="bclh lr5">
          <div class="h c">Column</div><div class="h">🏛️ Opening</div><div class="h">📦 Received</div><div class="h">🍸 Issued to bar</div><div class="h">♛ Closing stock</div>
          <div class="k">Bottles</div><div class="rs big tx">${fmt(tOpen)}<small>btl</small></div><div class="rs big vp">${tRecv>0?'+':''}${fmt(tRecv)}<small>btl</small></div><div class="rs big ${tIss>0?'vn':'mu'}">${tIss>0?'−':''}${fmt(tIss)}<small>btl</small></div><div class="rs big hi">${fmt(tClose)}<small>btl</small></div>
          <div class="k">Landing ₹</div><div class="rs">₹ ${fmt(Math.round(tValO))}</div><div class="rs">₹ ${fmt(Math.round(tValR))}</div><div class="rs">₹ ${fmt(Math.round(tValI))}</div><div class="rs hi">₹ ${fmt(Math.round(tVal))}</div>
          <div class="k">₹ per bottle</div><div class="q">${per(tValO,tOpen)}</div><div class="q">${per(tValR,tRecv)}</div><div class="q ${tIss>0?'':'mu'}">${per(tValI,tIss)}</div><div class="q hi">${per(tVal,tClose)}</div>
          <div class="k s" title="each column's landing value as a share of the closing stock value">Share of stock value <small>of closing ₹</small></div>${shareCell(tValO,'')}${shareCell(tValR,'g')}${shareCell(tValI,'r')}${shareCell(tVal,'',true)}
        </div>
        <div class="lrf-ring"><div class="ring"><div class="in"><div class="k">Stock in hand</div><div class="amt">₹ ${fmt(Math.round(tVal))}</div><div class="k2">${fmt(tClose)} bottles · ${nInHand} items</div><div class="k3">${per(tVal,tClose)} per bottle</div></div></div></div>
      </div>
    </div>`;
  // ② Crown Seal — double frame, ribbon title, Opening + Received · seal · Issued = Closing, the controls in a gold band
  const sc=(cls,ico,label,btl,sgn,val,sub)=>`<div class="sc ${cls}"><div class="l">${ico} ${label}</div><div class="v">${sgn}${fmt(btl)}<small>btl</small></div><div class="m">₹ ${fmt(Math.round(val))}</div><div class="n">${sub}</div></div>`;
  const sealHead=`<div class="card lrflow lrseal"><i class="cd tl"></i><i class="cd tr"></i><i class="cd bl"></i><i class="cd br"></i>${tl}
      <div class="rib"><span class="ln"></span><div class="c"><div class="t">❖ Liquor Room ❖</div><div class="f">Opening <b>+</b> Received <b>−</b> Issued <b>=</b> Closing <span class="p">· ${nInHand} items in hand · ${esc(period.from)} → ${esc(period.to)}</span></div></div><span class="ln r"></span></div>
      <div class="sg">
        ${sc('op','🏛️','Opening',tOpen,'',tValO,`${nOpen} items · ${per(tValO,tOpen)} / bottle`)}<div class="opr">+</div>
        ${sc('rv','📦','Received',tRecv,tRecv>0?'+':'',tValR,tRecv>0?`from Purchase · ${per(tValR,tRecv)} / bottle`:'nothing purchased in this period')}
        <div class="sealwrap"><div class="seal"><div class="in"><div class="ico">♛</div><div class="k">Stock in hand</div><div class="amt">₹ ${fmt(Math.round(tVal))}</div><div class="k2">${fmt(tClose)} bottles · ${nInHand} items</div><i class="rule"></i><div class="k3">${per(tVal,tClose)} per bottle</div></div></div></div>
        ${sc('is','🍸','Issued to bar',tIss,tIss>0?'−':'',tValI,tIss>0?`to Bar Stock Issue · ${per(tValI,tIss)} / bottle`:'no Bar Stock Issue yet')}<div class="opr">=</div>
        ${sc('cl','♛','Closing stock',tClose,'',tVal,`${nInHand} items · ${per(tVal,tClose)} / bottle`)}
      </div>
      <div class="band noprint">${tools}</div>
    </div>`;
  // ③ Classic — the v2.31.0 page exactly as it was (head-look selector added to its actions)
  const classicTop=`
    <div class="page-head"><div><h1>Liquor Room</h1><p>Formula · <span class="gold">Opening + Received − Issued = Closing</span>. Filter by stock status.</p></div>
      <div class="page-actions">
        ${headSel}
        <select class="input" style="width:auto;padding:6px 9px;font-size:12px" title="Premium look" onchange="setLrLook(this.value)">
          ${LOOK_OPTS.map(o=>`<option value="${o[0]}" ${look===o[0]?'selected':''}>${o[1]}</option>`).join('')}
        </select>
        ${layDrop('liquorroom')}<button class="btn btn-sm" onclick="expReport('lroom','xlsx')" title="Download this sheet as Excel">📊 Excel</button><button class="btn btn-sm" onclick="printSheet('lroom')" title="Clean print of this sheet — Save as PDF from the dialog">🖨 Print</button></div></div>
    ${periodBar()}
    <div class="tabs" style="align-items:center">${ftab('all','All')}${ftab('instock','✅ In Stock (&gt;0)')}${ftab('zero','⚪ Zero')}${ftab('neg','🔴 Negative')}
      <select class="input" style="width:auto;padding:5px 8px;font-size:12px;margin-left:10px" title="Blank / zero filter" onchange="lrBlank=this.value;route()">
        ${BLANK_OPTS.map(o=>`<option value="${o[0]}" ${lrBlank===o[0]?'selected':''}>${o[1]}</option>`).join('')}
      </select>${rdSelBarHtml()}</div>
    <div class="card lrflow">
      <div class="lrf-head"><div class="t">Liquor Room</div><div class="f">Opening <b>+</b> Received <b>−</b> Issued <b>=</b> Closing <span class="p">· ${esc(period.from)} → ${esc(period.to)}</span></div></div>
      <div class="lrf-body">
        <div class="lrf-steps">
          <div class="st op"><div class="ic">🏛️</div><div class="l">Opening</div><div class="v">${fmt(tOpen)}<small>btl</small></div><div class="m">₹ ${fmt(Math.round(tValO))}</div></div>
          <div class="arr">+</div>
          <div class="st rv"><div class="ic">📦</div><div class="l">Received</div><div class="v">${fmt(tRecv)}<small>btl</small></div><div class="m">₹ ${fmt(Math.round(tValR))}</div></div>
          <div class="arr">−</div>
          <div class="st is"><div class="ic">🍸</div><div class="l">Issued to Bar</div><div class="v">${fmt(tIss)}<small>btl</small></div><div class="m">₹ ${fmt(Math.round(tValI))}</div></div>
          <div class="arr">=</div>
          <div class="st cl"><div class="ic">♛</div><div class="l">Closing Stock</div><div class="v">${fmt(tClose)}<small>btl</small></div><div class="m">₹ ${fmt(Math.round(tVal))}</div></div>
        </div>
        <div class="lrf-ring"><div class="ring"><div class="in"><div class="k">Stock in hand</div><div class="amt">₹ ${fmt(Math.round(tVal))}</div><div class="k2">${fmt(tClose)} bottles · ${nInHand} items</div></div></div></div>
      </div>
    </div>`;
  const classicSearch=`
    <div class="card noprint" style="margin-bottom:12px;border-color:var(--gold-dim)"><div class="card-body" style="padding:12px 14px">
      <div class="bigsearch"><span style="font-size:22px">🔎</span><input id="searchBox" placeholder="Search any item or group — the sheet filters as you type…" value="${esc(q)}" oninput="isearch('lr',this.value)"></div>
    </div></div>`;
  const top = headLook==='ledger' ? `<div class="card lrbar noprint"><div class="card-body">${tools}</div></div>${ledgerHead}`
            : headLook==='seal'   ? sealHead
            : classicTop;
  return `
    ${top}
    ${lrRoyal}
    ${bevDupNotice()}
    ${headLook==='flow'?classicSearch:''}
    ${bodyHtml}`;
};
const LR_HEADS=[['ledger','① Royal Ledger'],['seal','② Crown Seal'],['flow','③ Classic Flow']];
function lrHeadNow(){ return LR_HEADS.some(o=>o[0]===pref.lrHead) ? pref.lrHead : 'ledger'; }
function setLrHead(v){ pref.lrHead=v; bsv('pref',pref); route(); }
function setLrLook(v){ pref.lrLook=v; bsv('pref',pref); route(); }
AFTER.liquorroom = () => {
  if(typeof Chart==='undefined') return;
  const look=pref.lrLook||'def'; if(look==='def') return;
  const gv={}; const top=[]; let tI=0,tAvail=0;
  rawData.forEach(r=>{ const op=fnum(invGet(r.item).lrOpen), rv=receivedForItem(r.item), is=issuedForItem(r.item), cl=op+rv-is, m=landOf(r.item);
    const val=cl*m; if(val>0){ gv[r.group]=(gv[r.group]||0)+val; top.push({n:r.item,val}); }
    tI+=is; tAvail+=op+rv; });
  top.sort((a,b)=>b.val-a.val);
  const gTop=Object.entries(gv).sort((a,b)=>b[1]-a[1]);
  const GOLDS=['#d8bd7f','#b89a5c','#8a6d3b','#6b5836','#5c4a28','#3a2f1c','#2a2620'];
  const mk=(id,cfg2)=>{ const el=$('#'+id); if(el) CHARTS.push(new Chart(el,cfg2)); };
  const noleg={plugins:{legend:{display:false}},responsive:true,maintainAspectRatio:false};
  const gData={labels:gTop.slice(0,6).map(g=>g[0]).concat(gTop.length>6?['Others']:[]),
    datasets:[{data:gTop.slice(0,6).map(g=>Math.round(g[1])).concat(gTop.length>6?[Math.round(gTop.slice(6).reduce((a,g)=>a+g[1],0))]:[]),
    backgroundColor:GOLDS,borderColor:'#161a23',borderWidth:2}]};
  mk('lrC1',{type:'doughnut',data:gData,options:{...noleg,cutout:'62%'}});
  mk('lrC2',{type:'bar',data:{labels:top.slice(0,10).map(x=>x.n.length>22?x.n.slice(0,21)+'…':x.n),
    datasets:[{data:top.slice(0,10).map(x=>Math.round(x.val)),backgroundColor:'#d8bd7f',borderRadius:4}]},
    options:{...noleg,indexAxis:'y',scales:{x:{ticks:{color:'#8a8f98',font:{size:9}},grid:{color:'rgba(138,143,152,.12)'}},y:{ticks:{color:'#8a8f98',font:{size:9}},grid:{display:false}}}}});
  mk('lrC3',{type:'doughnut',data:{labels:['Issued','In room'],datasets:[{data:[tI,Math.max(tAvail-tI,0)],
    backgroundColor:['#d8bd7f','#2a3140'],borderColor:'#161a23',borderWidth:2}]},
    options:{...noleg,cutout:'74%',rotation:270,circumference:180}});
  mk('lrC4',{type:'doughnut',data:gData,options:{...noleg,cutout:'62%'}});
};

/* ============================================================
   5) BAR INVENTORY — main sheet (bottle.loose, variance)
   ============================================================ */
function barRow(t){
  const { cmlMap, smlMap } = calcGrandTotals(); // (cheap, cached)
  const name=t.name, cat=t.category, u=invUnit(cat), iv=invGet(name);
  const rname=rawNameFor(name);                                   // Raw Data full name (Excel col A)
  const recBtl = rname ? receiptExact(rname) : receiptInPeriod(name); // exact when mapped, else best-effort
  const sale=Math.round(getEffectiveCocktailMl(t,cmlMap)+getEffectiveStraightMl(t,smlMap));
  let consAuto;
  if(u==='pcs'){ consAuto=fnum(iv.openBL)+recBtl-fnum(iv.closeBL); }
  else { const sizeL=sizeOf(name); consAuto=Math.round((toLitres(fnum(iv.openBL),sizeL)-toLitres(fnum(iv.closeBL),sizeL)+recBtl*sizeL)*1000); }
  // Consumption & Variance auto-calc, but a manual value (override) wins when entered.
  const consOver=(iv.consOverride!=null&&iv.consOverride!=='')?iv.consOverride:null;
  const cons=consOver!=null?fnum(consOver):consAuto;
  const varAuto=cons-sale;
  const varOver=(iv.varOverride!=null&&iv.varOverride!=='')?iv.varOverride:null;
  const varv=varOver!=null?fnum(varOver):varAuto;
  // Variance broken into full bottles + loose ml (magnitudes; sign shown by colour). pcs → count only.
  let varBtl=0, varMl=null;
  if(u==='pcs'){ varBtl=Math.abs(varv); }
  else { const sm=Math.round(sizeOf(name)*1000); const a=Math.abs(varv); varBtl=sm>0?Math.trunc(a/sm):0; varMl=sm>0?Math.round(a-varBtl*sm):a; }
  return {name,cat,u,iv,recBtl,sale,consAuto,cons,consOver,varAuto,varv,varOver,varBtl,varMl,rname};
}
/* MRP + ₹ amounts for a bar-inventory row. MRP is per bottle (ml items) / per pc (pcs items),
   shared with Raw Data / Liquor Room / Received via the receive name when mapped.
   Amounts NEVER touch the qty calculations — qty in bottles = litres/sizeL, then × MRP. */
function biAmt(t,R){
  const key=R.rname||t.name;
  // LANDING ₹/bottle is the money basis everywhere (falls back to MRP until an invoice sets it);
  // the Raw-Data name's value wins → change it in Raw Data / invoice and it changes EVERYWHERE
  const gv=(n,f)=>{ const v=invGet(n)[f]; return (v!=null&&v!=='')?v:null; };
  const landV=(R.rname?gv(R.rname,'land'):null); const landB=gv(t.name,'land');
  const mrpV =(R.rname?gv(R.rname,'mrp') :null); const mrpB =gv(t.name,'mrp');
  const mrpDisp=(landV!=null)?landV:((landB!=null)?landB:((mrpV!=null)?mrpV:mrpB));
  const mrp=+mrpDisp||0;
  let openQ,recQ,closeQ,consQ,saleQ,varQ;                       // qty in bottles (ml) / pcs
  if(R.u==='pcs'){ openQ=fnum(R.iv.openBL); recQ=R.recBtl; closeQ=fnum(R.iv.closeBL); consQ=R.cons; saleQ=R.sale; varQ=R.varv; }
  else { const sl=sizeOf(t.name)||0;
    openQ=sl?toLitres(fnum(R.iv.openBL),sl)/sl:0; recQ=R.recBtl; closeQ=sl?toLitres(fnum(R.iv.closeBL),sl)/sl:0;
    consQ=sl?R.cons/1000/sl:0; saleQ=sl?R.sale/1000/sl:0; varQ=sl?R.varv/1000/sl:0; }
  return { key, mrp, mrpDisp, open:openQ*mrp, rec:recQ*mrp, close:closeQ*mrp, cons:consQ*mrp, sale:saleQ*mrp, varv:varQ*mrp };
}
// one Bar-Inventory <tr> — shared by the sheet body and the Search & Add panel
function biRowHtml(t){
  const idx=tallyItems.indexOf(t); const R=barRow(t); const iv=R.iv; const A=biAmt(t,R); const u=R.u;
  const amtLine=(v,col)=>{ const r=Math.round(v); return r?`<div class="biamt"${col?` style="color:${col}"`:''}>₹ ${fmt(r)}</div>`:''; };
  const mrpRaw=A.mrpDisp;
  const vcol=R.varv>0?'var(--green)':(R.varv<0?'var(--red)':'var(--text-muted)');
  const vbg=R.varv>0?'var(--green-dim)':(R.varv<0?'var(--red-dim)':'transparent');
  const sizeCell = u==='pcs'
    ? `<td class="num"><input class="cell-input size" value="${iv.sizePcs!=null?iv.sizePcs:''}" placeholder="pcs" title="pack size in pcs (editable; does not change consumption)" onchange="invSetTNum(${idx},'sizePcs',this.value);route()"></td>`
    : `<td class="num"><input class="cell-input size" value="${Math.round(sizeOf(t.name)*1000)}" title="bottle size in ml (e.g. 750 · Draught 50000)" onchange="invSetSizeMl(${idx},this.value);route()"></td>`;
  const rnMissing = !R.rname;
  const varSub = u==='pcs' ? '' : `<div class="muted" style="font-size:9px;white-space:nowrap;text-align:right">±${R.varBtl} btl · ${R.varMl} ml</div>`;
  return `<tr>
    <td><div style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="bisel selcb" data-n="${esc(norm(t.name))}" data-c="${esc(t.category||'')}" ${_biSel.has(norm(t.name))?'checked':''} title="Mark" onchange="biSelToggle(this)"><strong style="flex:1;min-width:0">${t.name}</strong><button class="btn btn-danger btn-sm rmx" title="Remove this brand from Beverage Control & the Tally Sheet (with its POS aliases)" onclick="biRemove(${idx})">✕</button></div>
      <div style="margin-top:2px"><input class="cell-input rname" style="text-align:left;color:${rnMissing?'var(--red)':'var(--text-muted)'}" list="rawItems" value="${esc(R.rname||'')}" placeholder="↳ receive name (Item Master col A)…" title="Item Master full name — receipts in Bar Stock Issue / Purchase / Liquor Room are matched against THIS (Excel col A). Edit if blank/wrong." onchange="invSetT(${idx},'rawName',this.value);route()"></div></td>
    ${sizeCell}
    <td class="num"><input class="cell-input mrpcell" value="${mrpRaw!=null?mrpRaw:''}" placeholder="₹" title="Landing ₹ ${u==='pcs'?'per pc':'per bottle'} — shared with Item Master / Liquor Room / Purchase (auto-set by BEVCO invoice)" onchange='invSet(${jatt(A.key)},"land",this.value);route()'></td>
    <td class="num"><input class="cell-input obox" value="${iv.openBL!=null?iv.openBL:''}" placeholder="0" title="${u==='pcs'?'pieces':'bottle.loose 2.35 — or 12+12'}" onchange="invSetTNum(${idx},'openBL',this.value);route()">${amtLine(A.open)}</td>
    <td class="num calc" title="Bar Stock Issue entries for '${esc(R.rname||t.name)}' within the period">${R.recBtl}${amtLine(A.rec)}</td>
    <td class="num"><input class="cell-input cbox" value="${iv.closeBL!=null?iv.closeBL:''}" placeholder="0" title="${u==='pcs'?'pieces — or 12+12':'physical · 12+12 = 24'}" onchange="invSetTNum(${idx},'closeBL',this.value);route()">${amtLine(A.close)}</td>
    <td class="num"><input class="cell-input cv" style="color:${R.consOver!=null?'var(--gold)':'inherit'}" value="${R.consOver!=null?R.consOver:''}" placeholder="${fmt(R.consAuto)}" title="auto = Opening + Receipt − Closing · type a value to override (e.g. Draught keg)" onchange="invSetTNum(${idx},'consOverride',this.value);route()">${amtLine(A.cons)}</td>
    <td class="num gold">${fmt(R.sale)}${amtLine(A.sale)}</td>
    <td class="num"><input class="cell-input cv vcell" style="color:${vcol};background:${vbg}" value="${R.varOver!=null?R.varOver:''}" placeholder="${R.varAuto>0?'+':''}${fmt(R.varAuto)}" title="auto = Consumption − Sale · type a value to override (${u==='pcs'?'pcs':'ml'})" onchange="invSetTNum(${idx},'varOverride',this.value);route()">${varSub}</td>
    <td class="num" title="variance amount = variance qty in bottles × Landing ₹"><strong style="color:${vcol};font-size:12.5px">${Math.round(A.varv)?('₹ '+fmt(Math.round(A.varv))):'—'}</strong></td></tr>`;
}
// royal-look dashboard data over ACTIVE items (same activity rule as the sheet)
function biRoyalData(){
  const d={rows:[],byCatSale:{},byCatCons:{},tot:{open:0,rec:0,close:0,cons:0,sale:0,varv:0},plus:0,minus:0,
    // quantities behind the ₹ (v2.43.0, display only): ml-unit items in ml (kegs in ml too), pcs-unit items in pcs
    qty:{ml:{open:0,rec:0,close:0,cons:0,sale:0,varv:0}, pcs:{open:0,rec:0,close:0,cons:0,sale:0,varv:0},
      // the plain column sums the Excel's TOTAL row shows (D287 = Σ OPENING BAL as typed — bottle.loose, pcs and keg ml
      // mixed; E287 = Σ receipt bottles; F287 = Σ CLOSING BAL) — the figure the client compares with (v2.43.1)
      raw:{open:0,rec:0,close:0}}, byCatQty:{}};
  tallyItems.forEach(t=>{ const R=barRow(t);
    if(!(R.sale>0||R.recBtl>0||R.iv.openBL!=null||R.iv.closeBL!=null)) return;
    const A=biAmt(t,R); d.rows.push({name:t.name,cat:t.category,A,cons:R.cons,varv:R.varv,u:R.u});
    d.byCatSale[t.category]=(d.byCatSale[t.category]||0)+A.sale;
    d.byCatCons[t.category]=(d.byCatCons[t.category]||0)+A.cons;
    d.tot.open+=A.open; d.tot.rec+=A.rec; d.tot.close+=A.close; d.tot.cons+=A.cons; d.tot.sale+=A.sale; d.tot.varv+=A.varv;
    if(A.varv>0) d.plus+=A.varv; else d.minus+=-A.varv;
    let q; if(R.u==='pcs'){ q=d.qty.pcs; q.open+=fnum(R.iv.openBL); q.rec+=R.recBtl; q.close+=fnum(R.iv.closeBL); }
    else { q=d.qty.ml; const sl=sizeOf(t.name)||0; q.open+=toLitres(fnum(R.iv.openBL),sl)*1000; q.rec+=R.recBtl*sl*1000; q.close+=toLitres(fnum(R.iv.closeBL),sl)*1000; }
    q.cons+=R.cons; q.sale+=R.sale; q.varv+=R.varv;
    d.qty.raw.open+=fnum(R.iv.openBL); d.qty.raw.rec+=R.recBtl; d.qty.raw.close+=fnum(R.iv.closeBL);
    // per category, in that category's unit (a category is all-ml or all-pcs): opening · received · closing · consumption · sale · variance (v2.43.2)
    const cq=d.byCatQty[t.category]||(d.byCatQty[t.category]={u:R.u,ml:0,pcs:0,open:0,rec:0,close:0,cons:0,sale:0,varv:0});
    if(R.u==='pcs'){ const o=fnum(R.iv.openBL); cq.pcs+=o; cq.open+=o; cq.rec+=R.recBtl; cq.close+=fnum(R.iv.closeBL); }
    else { const sl=sizeOf(t.name)||0, o=toLitres(fnum(R.iv.openBL),sl)*1000; cq.ml+=o; cq.open+=o; cq.rec+=R.recBtl*sl*1000; cq.close+=toLitres(fnum(R.iv.closeBL),sl)*1000; }
    cq.cons+=R.cons; cq.sale+=R.sale; cq.varv+=R.varv;
  });
  return d;
}
function setBarLook(v){ pref.barLook=v; bsv('pref',pref); route(); }
/* Search & Add results — built on their own so typing can refresh ONLY this box.
   No route(), so the input element (and the whole page) never re-renders while you type. */
function biFindInner(){
  const findQ=(biFind||'').trim(); if(!findQ) return '';
  const matches=tallyItems.filter(t=>norm(t.name).includes(norm(findQ))||norm(t.category).includes(norm(findQ)));
  const show=matches.slice(0,15);
  return show.length
    ? `<div class="card-body" style="padding:0;border-top:1px solid var(--border)">
        <div class="table-wrap bizoom" style="max-height:460px;overflow:auto"><table class="tbl">
        <thead><tr><th>Item</th><th class="right">Size</th><th class="right">Landing ₹</th><th class="right">Opening</th><th class="right">Receipt</th><th class="right">Closing</th><th class="right">Consumption</th><th class="right">Sale</th><th class="right">Variance</th><th class="right">Variance ₹</th></tr></thead>
        <tbody>${show.map(t=>biRowHtml(t)).join('')}</tbody></table></div>
        ${matches.length>show.length?`<div class="muted center" style="font-size:12px;padding:8px">+ ${matches.length-show.length} more</div>`:''}</div>`
    : `<div class="card-body" style="padding:0;border-top:1px solid var(--border)">
        <div class="center muted" style="padding:24px;font-size:16px">"<strong>${esc(findQ)}</strong>" — not found</div></div>`;
}
function biFindType(v){ biFind=v; const r=$('#biFindResults'); if(r) r.innerHTML=biFindInner(); else routeQuiet(); }
VIEWS.barinv = () => {
  const q=iq.bi; const _gt=calcGrandTotals();
  const active=t=>{ const r=barRow(t); return r.sale>0||r.recBtl>0||t._fav||invGet(t.name).openBL!=null||invGet(t.name).closeBL!=null; };
  let list=tallyItems.filter(t=>{
    if(biCat && t.category!==biCat) return false;
    if(q && !(norm(t.name).includes(norm(q))||norm(t.category).includes(norm(q)))) return false;
    if(!q && !biCat && biConsF==='all' && biVarF==='all' && biSaleF==='all' && !pref.biAll && !active(t)) return false;   // default view: only active (pref.biAll = every brand)
    if(biConsF!=='all' || biVarF!=='all' || biSaleF!=='all'){ const r=barRow(t);
      if(!passSign(r.cons,biConsF)||!passSign(r.varv,biVarF)||!passSign(r.sale,biSaleF)) return false; }
    return true;
  });
  const groups={}; list.forEach(t=>{ (groups[t.category]=groups[t.category]||[]).push(t); });
  let mlC=0,mlV=0,pcC=0,pcV=0; const T={open:0,rec:0,close:0,cons:0,sale:0,varv:0};
  const body=Object.keys(groups).sort().map(cat=>{ const u=invUnit(cat);
    const rows=groups[cat].map(t=>{ const R=barRow(t); const A=biAmt(t,R);
      if(u==='pcs'){ pcC+=R.cons; pcV+=R.varv; } else { mlC+=R.cons; mlV+=R.varv; }
      T.open+=A.open; T.rec+=A.rec; T.close+=A.close; T.cons+=A.cons; T.sale+=A.sale; T.varv+=A.varv;
      return biRowHtml(t); }).join('');
    return `<tr class="grp-row"><td colspan="10"><input type="checkbox" class="biselc selcb" data-c="${esc(cat)}" title="Mark this category" onchange="biSelCat(this)"> ${cat} <span class="muted">· ${u}</span></td></tr>${rows}`;
  }).join('') || `<tr><td colspan="10" class="center muted" style="padding:24px">${(!q&&!biCat&&!pref.biAll)?'No item has figures yet. Switch on <b>☰ All brands</b> above to list every brand and type the opening stock, or search an item, or pick a category.':'No items match this filter.'}</td></tr>`;

  const allCats=[...new Set(tallyItems.map(t=>t.category))].sort();
  const chip=(c,lbl)=>`<button class="btn btn-sm ${biCat===c?'btn-gold':''}" onclick='setBiCat(${JSON.stringify(c)})'>${esc(lbl)}</button>`;
  const catChips = chip('','All') + allCats.map(c=>chip(c,c)).join('');
  const fopts=cur=>['all','plus','minus'].map(o=>`<option value="${o}" ${cur===o?'selected':''}>${o==='all'?'All':o==='plus'?'➕ Plus':'➖ Minus'}</option>`).join('');

  // ---- ₹ / stats / Search-Add panel (calculations untouched) ----
  const SER="font-family:Georgia,'Times New Roman',serif";
  const D=biRoyalData();
  // ① Grand totals (₹) as premium KPI chips — always on top, in EVERY layout
  const R0=v=>fmt(Math.round(v));
  // ① Head (v2.45.0 — the client picked "look 1 · Royal Ledger" whole from the mockup canvas): the Excel's own TOTAL
  //   row drawn as a gilded ledger — one grid, the six sheet columns across (Opening + Receipt − Closing = Consumption
  //   − Sale = Variance) and four rows down: Landing ₹ · ml items (kegs in ml, like the Excel) · pcs items · Σ column
  //   (the plain sum of the column as typed, = the sheet's TOTAL row; the three columns the sheet has no Σ for carry
  //   the formula / POS hint instead). Same figures as before (biRoyalData); .bcledger in styles.css, theme tokens only.
  const noSale=!(D.tot.sale>0);
  const sheetTxt=f=>{ if(!(f in D.qty.raw)) return ''; const v=D.qty.raw[f];
    return f==='rec' ? fmt(v)+' btl' : Number(v).toLocaleString('en-IN',{minimumFractionDigits:3,maximumFractionDigits:3}); };
  const BCOLS=[['open','Opening'],['rec','Receipt'],['close','Closing'],['cons','Consumption'],['sale','Sale'],['varv','Variance']];
  const bcSign=(f,v)=>f==='varv'?(v>=0?' vp':' vn'):'';
  const bcPlus=(f,v)=>(f==='varv'&&v>0)?'+':'';
  const bcHint={cons:'opening + receipt − closing', sale:noSale?'no POS sale in this period yet':'from the POS sheet', varv:'consumption − sale'};
  const bcCell=(cls,f,v,unit)=>`<div class="${cls}${bcSign(f,v)}">${bcPlus(f,v)}${fmt(Math.round(v))}<small>${unit}</small></div>`;
  const bcHead=`<div class="card bcledger">
      <div class="bh"><div class="t">Beverage Control Ledger</div><div class="f">Opening <b>+</b> Receipt <b>−</b> Closing <b>=</b> Consumption <b>−</b> Sale <b>=</b> Variance</div><div class="p">${D.rows.length} items · ${esc(period.from)} → ${esc(period.to)}</div></div>
      <div class="bclh">
        <div class="h c">Column</div>${BCOLS.map(([f,l])=>`<div class="h">${l}</div>`).join('')}
        <div class="k">Landing ₹</div>${BCOLS.map(([f])=>`<div class="rs${bcSign(f,D.tot[f])}">₹ ${R0(D.tot[f])}</div>`).join('')}
        <div class="k" title="ml items in ml — kegs in ml, like the Excel">ml items</div>${BCOLS.map(([f])=>bcCell('q',f,D.qty.ml[f],'ml')).join('')}
        <div class="k">pcs items</div>${BCOLS.map(([f])=>bcCell('q',f,D.qty.pcs[f],'pcs')).join('')}
        <div class="k s" title="the plain sum of each column, exactly as the Excel's TOTAL row adds it (bottles.loose, pcs and keg ml as typed)">Σ column <small>Excel total row</small></div>${BCOLS.map(([f])=>{ const s=sheetTxt(f); return s?`<div class="s">${s}</div>`:`<div class="s hint">${bcHint[f]||'—'}</div>`; }).join('')}
      </div>
    </div>`;
  // closing stock on hand — pcs items and ml items counted separately (display only)
  let pcsStock=0, mlStock=0, activeN=0;
  tallyItems.forEach(t=>{ const R=barRow(t);
    if(!(R.sale>0||R.recBtl>0||R.iv.openBL!=null||R.iv.closeBL!=null)) return;
    activeN++;
    if(R.u==='pcs') pcsStock+=fnum(R.iv.closeBL);
    else mlStock+=toLitres(fnum(R.iv.closeBL), sizeOf(t.name)||0)*1000; });
  // ② Category register (v2.44.0 — "look 1's table"): one row per category with its Opening · Received · Sale ·
  //   Closing in the category's unit (a category is all-ml or all-pcs), a share bar (of that unit's opening), Sale ₹
  //   (+ its % of the total sale once there is any), and Σ rows for the ml items and the pcs items. A grid, not .tbl —
  //   the .barinv .tbl fixed column widths (v2.13.4) would shape it. Theme tokens only (.bcled in styles.css).
  const cats=Object.keys(D.byCatQty).map(n=>({n, q:D.byCatQty[n], sale:D.byCatSale[n]||0}));
  const unOf=c=>c.q.u||invUnit(c.n);
  cats.sort((a,b)=>((unOf(a)==='pcs')-(unOf(b)==='pcs')) || (b.q.open-a.q.open) || a.n.localeCompare(b.n));
  const totU=u=>cats.filter(c=>unOf(c)===u).reduce((T,c)=>{ T.n++; T.open+=c.q.open; T.rec+=c.q.rec; T.sale+=c.q.sale; T.close+=c.q.close; T.rs+=c.sale; return T; },{n:0,open:0,rec:0,sale:0,close:0,rs:0});
  const TM=totU('ml'), TP=totU('pcs');
  const RN=v=>fmt(Math.round(v));
  const rupCell=v=>`₹ ${R0(v)}${D.tot.sale?`<small>${(v/D.tot.sale*100).toFixed(1)}%</small>`:''}`;
  const ledRow=(i,c)=>{ const u=unOf(c), T=u==='ml'?TM:TP, p=T.open?c.q.open/T.open*100:0;
    return `<div class="lc mu">${i}</div><div class="lc n">${esc(c.n)}<small>${u}</small></div>
      <div class="lc r o">${RN(c.q.open)}</div><div class="lc r${c.q.rec>0?' g':''}">${RN(c.q.rec)}</div><div class="lc r">${RN(c.q.sale)}</div><div class="lc r">${RN(c.q.close)}</div>
      <div class="lc"><div class="bar${u==='pcs'?' p':''}"><i style="width:${Math.min(100,p).toFixed(1)}%"></i></div></div>
      <div class="lc r mu">${p.toFixed(1)}%${u==='pcs'?'<small>of pcs</small>':''}</div><div class="lc r mu">${rupCell(c.sale)}</div>`; };
  const ledTot=(u,T)=>T.n?`<div class="lt">Σ</div><div class="lt">TOTAL · ${u} items <small>${T.n} categor${T.n===1?'y':'ies'}</small></div>
      <div class="lt r">${RN(T.open)}</div><div class="lt r">${RN(T.rec)}</div><div class="lt r">${RN(T.sale)}</div><div class="lt r">${RN(T.close)}</div>
      <div class="lt"><div class="bar"><i style="width:100%"></i></div></div><div class="lt r">100%</div><div class="lt r">${rupCell(T.rs)}</div>`:'';
  const bcLedger=`<div class="card bcledc" style="margin-bottom:10px"><div class="card-head" style="padding:6px 12px;flex-wrap:wrap;gap:4px 12px">
      <h3>Category Register — Opening · Received · Sale · Closing</h3>
      <span class="muted" style="font-size:10px;line-height:1.35;flex:1 1 260px">${noSale?'No sale in this period yet — upload the month&#39;s POS sales (Sales → POS Upload) and the Sale column and Sale ₹ fill in. ':''}ml items in ml (kegs in ml), pcs items in pieces · share = of that unit&#39;s opening</span>
      <button class="btn btn-sm" onclick="go('reports')" title="Full category breakdown in All Reports">View All →</button></div>
    <div class="card-body" style="padding:6px 8px 8px">
      ${cats.length?`<div class="bcled">
        <div class="lh">#</div><div class="lh">Category</div><div class="lh r">Opening</div><div class="lh r">Received</div><div class="lh r">Sale</div><div class="lh r">Closing</div><div class="lh">Share of opening</div><div class="lh r">%</div><div class="lh r">Sale ₹</div>
        ${cats.map((c,i)=>ledRow(i+1,c)).join('')}${ledTot('ml',TM)}${ledTot('pcs',TP)}</div>`
      :'<span class="muted" style="font-size:12px">Type an opening, or switch on ☰ All brands — the categories appear here</span>'}
    </div></div>`;
  // ④ bottom summary tiles
  const avgVarPct = D.tot.sale ? (D.tot.varv/D.tot.sale*100) : 0;
  const footHtml=`<div class="bcfoot">
    ${[['📦','Items Available', fmt(activeN), '#25c685','var(--text)'],
       ['🧊','Total Stock (pcs)', fmt(Math.round(pcsStock*100)/100), '#4f8cff','var(--text)'],
       ['💧','Total Stock (ml)', fmt(Math.round(mlStock)), '#8b5cf6','var(--text)'],
       ['💰','Total Sale Value', '₹ '+R0(D.tot.sale), '#e8c94b','var(--gold)'],
       ['⚖️','Total Variance', '₹ '+R0(D.tot.varv), D.tot.varv>=0?'#25c685':'#ef4f57', D.tot.varv>=0?'var(--green)':'var(--red)'],
       ['📉','Avg Variance %', (avgVarPct>0?'+':'')+avgVarPct.toFixed(2)+'%', avgVarPct>=0?'#25c685':'#ef4f57', avgVarPct>=0?'var(--green)':'var(--red)']]
      .map(x=>`<div class="f"><div class="ic" style="background:${x[3]}1f;border:1px solid ${x[3]}55">${x[0]}</div>
        <div class="v" style="color:${x[4]}">${x[2]}</div><div class="l">${x[1]}</div></div>`).join('')}
  </div>`;
  // ---- Search & Add — big search box; results live in their own box (updated in place) ----
  const findHtml = `<div class="card bicomp noprint" style="margin-bottom:10px;border-color:var(--gold-dim)">
    <div class="card-body" style="padding:12px 14px">
      <div class="bigsearch"><span style="font-size:22px">🔎</span><input id="biFindBox" placeholder="Search item, brand, category…" value="${esc(biFind||'')}" oninput="biFindType(this.value)"></div>
    </div>
    <div id="biFindResults">${biFindInner()}</div></div>`;
  // filter row (mockup): Consumption · Sale · Variance ₹ + reset
  const anyF=(biConsF!=='all'||biVarF!=='all'||biSaleF!=='all'||!!biCat);
  const bcFilter=`<div class="bcfilter noprint">
    <div class="f"><span class="l">Consumption</span>
      <select class="input ${biConsF!=='all'?'on':''}" onchange="setBiConsF(this.value)">${fopts(biConsF)}</select></div>
    <div class="f"><span class="l">Sale</span>
      <select class="input ${biSaleF!=='all'?'on':''}" onchange="setBiSaleF(this.value)">${fopts(biSaleF)}</select></div>
    <div class="f"><span class="l">Variance ₹</span>
      <select class="input ${biVarF!=='all'?'on':''}" onchange="setBiVarF(this.value)">${fopts(biVarF)}</select></div>
    <button class="fbtn ${pref.biAll?'on':''}" style="width:auto;padding:0 10px;font-size:11.5px;letter-spacing:.6px" title="${pref.biAll?'Showing every brand — click for only the ones with figures':'Show every brand, including those with no figures yet (month-start entry)'}" onclick="pref.biAll=!pref.biAll;bsv('pref',pref);route()">${pref.biAll?'● All brands':'☰ All brands'}</button>
    <button class="fbtn ${anyF?'on':''}" title="${anyF?'Clear all filters':'No filter applied'}" onclick="biClearFilters()">⛃</button>
    ${biSelBarHtml()}
  </div>`;

  return `
    ${letterhead('Beverage Control · Bar Inventory')}
    <div class="royalwrap">
    <div class="card royalcard bcper" style="margin-bottom:8px"><div class="card-body flex items-center" style="flex-wrap:wrap;gap:8px 14px;padding:7px 12px;justify-content:space-between">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <span style="${SER};color:var(--gold);font-size:11.5px;letter-spacing:1.6px">🗓️ PERIOD</span>
        <input class="input" type="date" id="biFrom" value="${period.from}" style="width:auto" onchange="setBarPeriod()">
        <span class="gold">→</span>
        <input class="input" type="date" id="biTo" value="${period.to}" style="width:auto" onchange="setBarPeriod()">
        <span class="muted" style="font-size:9.5px">Receipt = MR issues within these dates</span>
      </div>
      <div class="flex items-center" style="gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm btn-gold" onclick="openBevClone()" title="Create / delete clone pages">📑 Page Clone${bevPages.length?' ('+bevPages.length+')':''}</button>
        <button class="btn btn-sm" onclick="expReport('bev','xlsx')" title="Download this sheet as Excel">📊 Excel</button>
        <button class="btn btn-sm" onclick="printSheet('bev')" title="Clean print of this sheet — Save as PDF from the dialog">🖨 Print</button>
        <button class="btn btn-sm" onclick="cloneBarInv()" title="Closing → Opening carry-forward (new period)">🧬 Carry</button>
        <button class="btn btn-danger btn-sm" onclick="clearInvCol('openBL')" title="Clears EVERY Opening value">🧹 Opening</button>
        <button class="btn btn-danger btn-sm" onclick="clearInvCol('closeBL')" title="Clears EVERY Closing value">🧹 Closing</button>
      </div>
    </div></div>
    ${bcHead}
    ${bcLedger}
    ${findHtml}
    ${bcFilter}
    ${(()=>{ // sheet area — Classic table only (the Velvet Salon / Crown Glass card looks were
      // dropped on the client's request 2026-08-09; cardRow below stays dormant, repo convention)
      const lookB='def';
      const chipBar=`<div class="chip-bar" style="margin-bottom:${lookB==='def'?'0':'12px'}"><span class="muted" style="font-size:11px;margin-right:4px">Category:</span>${catChips}</div>`;
      if(lookB==='def') return `<div class="card barinv bicomp royalcard">
        <div class="card-body" style="padding:8px 14px;border-bottom:1px solid var(--border)">${chipBar}</div>
        <div class="table-wrap" style="max-height:560px;overflow-y:auto"><table class="tbl">
          <thead><tr><th><input type="checkbox" id="biSelAll" class="selcb" title="Mark all shown" onchange="biSelAll(this.checked)"> Item</th><th class="right">Size</th><th class="right">Landing ₹</th><th class="right">Opening</th><th class="right">Receipt</th><th class="right">Closing</th>
            <th class="right">Consumption</th>
            <th class="right">Sale</th>
            <th class="right">Variance</th>
            <th class="right">Variance ₹</th></tr></thead>
          <tbody>${body}</tbody>
        </table></div></div>`;
      // card looks — every number from the SAME barRow/biAmt engine; Opening/Closing stay editable
      const cardRow=(t)=>{ const idx=tallyItems.indexOf(t); const R=barRow(t); const iv=R.iv; const A=biAmt(t,R);
        const vcls=R.varv>0?'p':(R.varv<0?'n':'z'); const va=Math.round(A.varv);
        const sizeTxt=R.u==='pcs' ? ((iv.sizePcs!=null&&iv.sizePcs!=='')?iv.sizePcs+' pcs':'pcs') : (Math.round(sizeOf(t.name)*1000)+' ml');
        return `<div class="bvrow">
          <div class="who"><b>${esc(t.name)}</b><span>${esc(t.category)} · ${sizeTxt}</span></div>
          <div class="st"><i>Opening</i><input class="cell-input" value="${iv.openBL!=null?iv.openBL:''}" placeholder="0" title="${R.u==='pcs'?'pieces':'bottle.loose 2.35 — or 12+12'}" onchange="invSetTNum(${idx},'openBL',this.value);route()"></div>
          <div class="st"><i>Receipt</i><b>${R.recBtl}</b></div>
          <div class="st"><i>Closing</i><input class="cell-input" value="${iv.closeBL!=null?iv.closeBL:''}" placeholder="0" title="${R.u==='pcs'?'pieces — or 12+12':'physical · 12+12 = 24'}" onchange="invSetTNum(${idx},'closeBL',this.value);route()"></div>
          <div class="st"><i>Cons.</i><b>${fmt(R.cons)}</b></div>
          <div class="st"><i>Sale</i><b>${fmt(R.sale)}</b></div>
          <div class="vchip ${vcls}" title="variance qty (${R.u})">${R.varv>0?'+':''}${fmt(R.varv)}<i>${R.u}</i></div>
          <div class="vamt ${vcls}" title="variance amount ₹">${va?('₹ '+fmt(va)):'—'}<i>amount</i></div>
        </div>`; };
      const cardsHtml=Object.keys(groups).sort().map(cat=>{
        const rows=groups[cat].map(cardRow).join('');
        return `<div class="bvgrp"><div class="bvglabel">${esc(cat)} <span class="u">· ${invUnit(cat)}</span></div>${rows}</div>`;
      }).join('') || '<div class="center muted" style="padding:26px">No items match this filter.</div>';
      return `<div class="bv ${lookB==='velvet'?'bvvelvet':'bvglass'}">${chipBar}<div class="bvwrap">${cardsHtml}</div></div>`;
    })()}
    ${footHtml}
    </div>${rawNamesDatalist()}`;
};
// Beverage Control clone PAGES — identical full page, each its own data store (seed = copy of the page it was created from)
function registerBevPage(p){
  VIEWS['bev_'+p.id]=()=>VIEWS.barinv();
  AFTER['bev_'+p.id]=()=>{ if(AFTER.barinv) AFTER.barinv(); };
  if(typeof TITLES!=='undefined') TITLES['bev_'+p.id]=[p.name,''];
  if(typeof NAV!=='undefined'){ const g=NAV.find(x=>x.items&&x.items.some(it=>it.id==='barinv'));
    if(g && !g.items.some(it=>it.id==='bev_'+p.id)) g.items.push({id:'bev_'+p.id, label:p.name, ico:(typeof ICO!=='undefined'?ICO.clone:'📑')}); }
}
bevPages.forEach(registerBevPage);
function createBevPage(){
  const n=bevPages.length+1;
  const p={ id:String(Date.now()), name:'Beverage Control Clone'+(n>1?' '+n:'') };
  bevStores[p.id]=JSON.parse(JSON.stringify(activeInv())); bsv('inv2_'+p.id, bevStores[p.id]);   // seed = copy of current page
  bevPages.push(p); bsv('bevpages',bevPages); registerBevPage(p);
  closeModal(); renderShell(); go('bev_'+p.id); toast('Clone page created',p.name,'ok');
}
function delBevPage(id){
  const p=bevPages.find(x=>x.id===id); if(!p) return;
  confirmAsk(`Delete the page "<strong>${esc(p.name)}</strong>"?`, ()=>{
    closeModal();
    bevPages=bevPages.filter(x=>x.id!==id); bsv('bevpages',bevPages);
    delete VIEWS['bev_'+id]; delete AFTER['bev_'+id]; delete bevStores[id];
    try{ localStorage.removeItem((typeof CO_PREFIX!=='undefined'?CO_PREFIX:'tg2_')+'inv2_'+id); }catch(e){}
    if(typeof NAV!=='undefined') NAV.forEach(g=>{ if(g.items) g.items=g.items.filter(it=>it.id!=='bev_'+id); });
    renderShell();
    if(location.hash==='#bev_'+id) go('barinv'); else route();
  });
}
AFTER.barinv = () => {
  if(typeof Chart==='undefined') return;
  const look=pref.barLook||'crown'; if(look==='def') return;
  const D=biRoyalData();
  const catsS=Object.entries(D.byCatSale).sort((a,b)=>b[1]-a[1]);
  const catsC=Object.entries(D.byCatCons).sort((a,b)=>b[1]-a[1]);
  const topS=D.rows.slice().sort((a,b)=>b.A.sale-a.A.sale).slice(0,10);
  const GOLDS=['#d8bd7f','#b89a5c','#8a6d3b','#6b5836','#5c4a28','#3a2f1c','#2a2620'];
  const mk=(id,cfgc)=>{ const el=$('#'+id); if(el) CHARTS.push(new Chart(el,cfgc)); };
  const noleg={plugins:{legend:{display:false}},responsive:true,maintainAspectRatio:false};
  const donut=(id,arr)=>mk(id,{type:'doughnut',data:{labels:arr.slice(0,6).map(g=>g[0]).concat(arr.length>6?['Others']:[]),
    datasets:[{data:arr.slice(0,6).map(g=>Math.round(g[1])).concat(arr.length>6?[Math.round(arr.slice(6).reduce((a,g)=>a+g[1],0))]:[]),
    backgroundColor:GOLDS,borderColor:'#161a23',borderWidth:2}]},options:{...noleg,cutout:'62%'}});
  donut('biC1',catsS); donut('biC2',catsC);
  mk('biC3',{type:'doughnut',data:{labels:['Plus','Minus'],datasets:[{data:[Math.round(D.plus),Math.round(D.minus)],
    backgroundColor:['#4ecf9d','#d96a5c'],borderColor:'#161a23',borderWidth:2}]},options:{...noleg,cutout:'62%'}});
  mk('biC4',{type:'bar',data:{labels:topS.map(r=>r.name.length>14?r.name.slice(0,13)+'…':r.name),
    datasets:[{data:topS.map(r=>Math.round(r.A.sale)),backgroundColor:topS.map((r,i)=>i===0?'#d8bd7f':'#3a2f1c'),borderRadius:3}]},
    options:{...noleg,scales:{x:{ticks:{color:'#8a8272',font:{size:9}},grid:{display:false}},y:{ticks:{color:'#8a8272',font:{size:9}},grid:{color:'rgba(138,130,114,.12)'}}}}});
  mk('biC5',{type:'doughnut',data:{labels:['Sale','Rest'],datasets:[{data:[Math.round(D.tot.sale),Math.max(0,Math.round(D.tot.cons-D.tot.sale))],
    backgroundColor:['#d8bd7f','#2a2620'],borderColor:'#161a23',borderWidth:2}]},
    options:{...noleg,cutout:'72%',rotation:270,circumference:180}});
};
function setBarPeriod(){ const f=$('#biFrom').value, t=$('#biTo').value; period={from:f||period.from, to:t||period.to}; bsv('period',period); route(); toast('Period set',`${period.from} → ${period.to}`,'ok'); }
function cloneBarInv(){
  modal('Clone → New Period', `<p>Carry <strong>Closing → Opening</strong> for the next period:</p>
    <ul style="margin:10px 0 0 18px;font-size:13px;color:var(--text-muted);line-height:1.7">
      <li>Every item's <strong>Closing</strong> becomes the new <strong>Opening</strong></li>
      <li>Closing & Sale are cleared for fresh physical count</li>
      <li>Only the Bar Inventory sheet is affected (Item Master, Bar Stock Issue, Purchase untouched)</li></ul>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick="doCloneBarInv()">Clone Now</button>`);
}
function doCloneBarInv(){
  let n=0; const st=activeInv();
  tallyItems.forEach(t=>{ const iv=invGet(t.name); if(iv.closeBL!=null&&iv.closeBL!==''){ st[norm(t.name)]={...iv, openBL:iv.closeBL, closeBL:'', saleOverride:undefined}; n++; } });
  activeInvSave(); closeModal(); route(); toast('Cloned',`${n} items carried Closing → Opening (new period)`,'ok');
}
/* ---- Clone Pages popup: create a full duplicate page (own sheet in the nav) / delete one ---- */
function openBevClone(){
  const rows=bevPages.map(p=>`<div class="flex between items-center" style="padding:9px 0;border-bottom:1px solid var(--border-soft);gap:10px">
      <strong style="cursor:pointer" onclick="closeModal();go('bev_${p.id}')">📑 ${esc(p.name)}</strong>
      <button class="btn btn-danger btn-sm" onclick="delBevPage('${p.id}')">🗑️ Delete</button></div>`).join('');
  modal('📑 Clone Pages', `<div style="max-height:320px;overflow:auto">${rows||''}</div>`,
    `<button class="btn" onclick="closeModal()">Close</button><button class="btn btn-gold" onclick="createBevPage()">➕ Create Clone Page</button>`);
}
function clearInvCol(key){
  const lbl=key==='openBL'?'Opening':'Closing';
  modal('Clear '+lbl, `<p>Clear the <strong>${lbl}</strong> value for every item in the Bar Inventory sheet?</p>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" style="background:var(--red);color:#fff" onclick="doClearInvCol('${key}')">Clear ${lbl}</button>`);
}
function doClearInvCol(key){ const st=activeInv(); Object.keys(st).forEach(k=>{ if(st[k]) st[k][key]=''; }); activeInvSave(); closeModal(); route(); toast('Cleared',(key==='openBL'?'Opening':'Closing')+' cleared for all items','err'); }
function exportBarInvExcel(){
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page','err'); return; }
  const aoa=[[ (cfg.company||'TRAFFIC GASTROPUB')+' — Bar Inventory' ],[ 'Period', period.from+' to '+period.to ],[],
    ['Item','Receive Name (Item Master)','Category','Unit','Size','Landing ₹','Opening','Receipt','Closing','Consumption','Sale','Variance','Var Btl','Var ml','Opening ₹','Receipt ₹','Closing ₹','Consumption ₹','Sale ₹','Variance ₹']];
  const TT={open:0,rec:0,close:0,cons:0,sale:0,varv:0};
  tallyItems.forEach(t=>{ const R=barRow(t); const iv=R.iv;
    if(!(R.sale>0||R.recBtl>0||iv.openBL!=null||iv.closeBL!=null)) return;
    const A=biAmt(t,R); TT.open+=A.open; TT.rec+=A.rec; TT.close+=A.close; TT.cons+=A.cons; TT.sale+=A.sale; TT.varv+=A.varv;
    aoa.push([t.name, R.rname||'', t.category, R.u, (R.u==='pcs'?(iv.sizePcs!=null?+iv.sizePcs||'':''):Math.round(sizeOf(t.name)*1000)), A.mrp||'', fnum(iv.openBL), R.recBtl, fnum(iv.closeBL), R.cons, R.sale, R.varv, (R.varv<0?'-':'')+R.varBtl, R.varMl==null?'':R.varMl,
      Math.round(A.open), Math.round(A.rec), Math.round(A.close), Math.round(A.cons), Math.round(A.sale), Math.round(A.varv)]); });
  aoa.push(['TOTAL AMOUNT (₹)','','','','','','','','','','','','','', Math.round(TT.open), Math.round(TT.rec), Math.round(TT.close), Math.round(TT.cons), Math.round(TT.sale), Math.round(TT.varv)]);
  const ws=XLSX.utils.aoa_to_sheet(aoa); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Bar Inventory');
  XLSX.writeFile(wb,'bar_inventory_'+period.from+'_'+period.to+'.xlsx'); toast('Exported','Bar Inventory → Excel','ok');
}

/* ============================================================
   REPORTS — real-data reports with Excel / CSV / PDF export
   ============================================================ */
const REPORTS=[
  {id:'bev',     name:'Beverage Control Report',        ico:'🍾'},
  {id:'lroom',   name:'Liquor Room Report',             ico:'🏬'},
  {id:'recv',    name:'Purchase Report',          ico:'📦'},
  {id:'mrd',     name:'Bar Stock Issue Report',               ico:'🔁'},
  {id:'cksale',  name:'Cocktail Sale Report',           ico:'🍹'},
  {id:'stsale',  name:'Straight Liquor Sale Report',    ico:'🥃'},
  {id:'top15ck', name:'Top 15 Cocktails — High & Low',  ico:'🏆'},
  {id:'top15st', name:'Top 15 Straight — High & Low',   ico:'🎖️'},
  {id:'catbreak',name:'Category Breakdown Sale Report', ico:'📊'},
];
// items whose physical Closing is empty/low (real, from entered stock)
function lowStockList(){ const out=[];
  tallyItems.forEach(t=>{ const iv=invGet(t.name); if(!(iv.openBL!=null||iv.closeBL!=null)) return;   // only active items
    const u=invUnit(t.category), close=fnum(iv.closeBL);
    if(u==='pcs'){ if(close<=0) out.push({name:t.name,cat:t.category,closing:0,u,status:'OUT',sev:2});
      else if(close<6) out.push({name:t.name,cat:t.category,closing:close,u,status:'LOW',sev:1}); }
    else { const sl=sizeOf(t.name), ml=Math.round(toLitres(close,sl)*1000), sizeMl=Math.round(sl*1000);
      if(ml<=0) out.push({name:t.name,cat:t.category,closing:0,u,status:'OUT',sev:2});
      else if(ml<sizeMl) out.push({name:t.name,cat:t.category,closing:ml,u,status:'LOW',sev:1}); } });
  return out.sort((a,b)=>b.sev-a.sev||a.name.localeCompare(b.name)); }
function reportAoa(id){
  const meta=(cols)=>[[ (cfg.company||'TRAFFIC GASTROPUB')+' — '+(REPORTS.find(r=>r.id===id)||{name:'Report'}).name ],
    [ 'Period', period.from+' to '+period.to ], [], cols];
  if(id==='bev'){ const a=meta(['Item','Category','Unit','Opening','Receipt','Closing','Consumption','Sale','Variance','Sale ₹','Var ₹']);
    const T={c:0,s:0,v:0,sv:0,vv:0};
    tallyItems.forEach(t=>{ const R=barRow(t);
      if(!(R.sale>0||R.recBtl>0||R.iv.openBL!=null||R.iv.closeBL!=null)) return;
      const A=biAmt(t,R);
      a.push([t.name,t.category,R.u,R.iv.openBL!=null?R.iv.openBL:'',R.recBtl,R.iv.closeBL!=null?R.iv.closeBL:'',R.cons,R.sale,R.varv,Math.round(A.sale),Math.round(A.varv)]);
      T.c+=R.cons; T.s+=R.sale; T.v+=R.varv; T.sv+=A.sale; T.vv+=A.varv; });
    a.push(['TOTAL','','','','','',Math.round(T.c),Math.round(T.s),Math.round(T.v),Math.round(T.sv),Math.round(T.vv)]); return a; }
  if(id==='lroom'){ const a=meta(['Item','Group','Landing ₹','Opening','Received','Issued','Closing','Value ₹']);
    let tO=0,tR=0,tI=0,tC=0,tV=0;
    rawData.forEach(r=>{ const op=fnum(invGet(r.item).lrOpen), rv=receivedForItem(r.item), is=issuedForItem(r.item), cl=op+rv-is;
      if(!op&&!rv&&!is&&!cl) return; const m=landOf(r.item);
      a.push([r.item,r.group,m||'',op,rv,is,cl,Math.round(cl*m)]);
      tO+=op; tR+=rv; tI+=is; tC+=cl; tV+=cl*m; });
    a.push(['TOTAL','','',Math.round(tO*100)/100,tR,tI,Math.round(tC*100)/100,Math.round(tV)]); return a; }
  if(id==='recv'){ const a=meta(['Date','Item','Group','Qty','Landing ₹/bot','Value ₹','Invoice','Source']);
    let tq=0,tv=0, bq=0,bv=0, cq=0,cv=0;
    receivedStock.slice().sort((x,y)=>String(x.date).localeCompare(String(y.date))).forEach(r=>{
      const m=recvLand(r), q=fnum(r.qty), v=q*m, cash=recvSrc(r)==='cash'; tq+=q; tv+=v; if(cash){ cq+=q; cv+=v; } else { bq+=q; bv+=v; }
      a.push([r.date,r.item,r.group||'',q,m||'',Math.round(v),r.inv?String(r.inv).split('/').slice(-3).join('/'):'',cash?'Cash':'BEVCO']); });
    if(cq&&bq){ a.push(['BEVCO TOTAL','','',bq,'',Math.round(bv),'','']); a.push(['CASH TOTAL','','',cq,'',Math.round(cv),'','']); }
    a.push([cq&&bq?'GRAND TOTAL':'TOTAL','','',tq,'',Math.round(tv),'','']); return a; }
  if(id==='mrd'){ const a=meta(['Date','Item','Group','Qty Issued']);
    let tq=0;
    mrDetail.slice().sort((x,y)=>String(x.date).localeCompare(String(y.date))).forEach(r=>{ tq+=fnum(r.qty);
      a.push([r.date,r.item,r.group||'',fnum(r.qty)]); });
    a.push(['TOTAL','','',tq]); return a; }
  if(id==='cksale'){ const a=meta(['Cocktail','Qty Sold','Total ml','% of ml']);
    const list=cocktailSales().sort((x,y)=>y.qty-x.qty); const tot=list.reduce((s,x)=>s+x.ml,0)||1; let tq=0,tm=0;
    list.forEach(x=>{ a.push([x.c.name,x.qty,Math.round(x.ml),(x.ml/tot*100).toFixed(1)+'%']); tq+=x.qty; tm+=x.ml; });
    a.push(['TOTAL',tq,Math.round(tm),'100%']); return a; }
  if(id==='stsale'){ const a=meta(['Brand','Category','Straight ml','% share']);
    const list=brandRowsData().filter(b=>b.s>0).sort((x,y)=>y.s-x.s); const tot=list.reduce((s,b)=>s+b.s,0)||1; let tm=0;
    list.forEach(b=>{ a.push([b.t.name,b.t.category,Math.round(b.s),(b.s/tot*100).toFixed(1)+'%']); tm+=b.s; });
    a.push(['TOTAL','',Math.round(tm),'100%']); return a; }
  if(id==='top15ck'){ const a=meta(['#','Cocktail','Qty','Total ml']);
    const list=cocktailSales().sort((x,y)=>y.qty-x.qty);
    a.push(['🏆 TOP 15 — HIGH']);
    list.slice(0,15).forEach((x,i)=>a.push([i+1,x.c.name,x.qty,Math.round(x.ml)]));
    a.push(['🐢 TOP 15 — LOW']);
    list.slice().reverse().slice(0,15).forEach((x,i)=>a.push([i+1,x.c.name,x.qty,Math.round(x.ml)]));
    return a; }
  if(id==='top15st'){ const a=meta(['#','Brand','Category','Straight ml']);
    const list=brandRowsData().filter(b=>b.s>0).sort((x,y)=>y.s-x.s);
    a.push(['🏆 TOP 15 — HIGH']);
    list.slice(0,15).forEach((b,i)=>a.push([i+1,b.t.name,b.t.category,Math.round(b.s)]));
    a.push(['🐢 TOP 15 — LOW']);
    list.slice().reverse().slice(0,15).forEach((b,i)=>a.push([i+1,b.t.name,b.t.category,Math.round(b.s)]));
    return a; }
  if(id==='catbreak'){ const a=meta(['Category','Items','Cocktail ml','Straight ml','Total ml','% share']);
    const cs=categorySummary(); const tot=cs.reduce((s,c)=>s+c.c+c.s,0)||1;
    cs.forEach(c=>a.push([c.cat,c.n,Math.round(c.c),Math.round(c.s),Math.round(c.c+c.s),((c.c+c.s)/tot*100).toFixed(1)+'%']));
    a.push(['TOTAL',cs.reduce((s,c)=>s+c.n,0),Math.round(cs.reduce((s,c)=>s+c.c,0)),Math.round(cs.reduce((s,c)=>s+c.s,0)),Math.round(tot),'100%']); return a; }
  return meta(['No data']);
}
function _dlBlob(name,text,type){ const b=new Blob([text],{type:type}); const u=URL.createObjectURL(b);
  const a=document.createElement('a'); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1500); }
function _aoaCSV(aoa){ return aoa.map(r=>r.map(c=>{ const s=String(c==null?'':c); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(',')).join('\r\n'); }
function expReport(id,kind){ const aoa=reportAoa(id); const base=id+'_'+period.from+'_'+period.to;
  if(kind==='csv'){ _dlBlob(base+'.csv', _aoaCSV(aoa), 'text/csv;charset=utf-8'); toast('Exported',id+' → CSV','ok'); return; }
  if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page','err'); return; }
  const ws=XLSX.utils.aoa_to_sheet(aoa); const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,(REPORTS.find(r=>r.id===id)||{name:'Report'}).name.slice(0,28));
  XLSX.writeFile(wb, base+'.xlsx'); toast('Exported',id+' → Excel','ok'); }
VIEWS.reports = () => {
  const {totalC,totalS}=calcGrandTotals(); const sales=totalC+totalS;
  let consTot=0,varTot=0; tallyItems.forEach(t=>{ const R=barRow(t);
    if(R.iv.openBL!=null||R.iv.closeBL!=null||R.sale>0||R.recBtl>0){ consTot+=R.cons; varTot+=R.varv; } });
  const D=biRoyalData();
  const SER="font-family:Georgia,'Times New Roman',serif";
  const NUMFROM={bev:3,lroom:2,recv:3,mrd:3,cksale:1,stsale:2,top15ck:2,top15st:3,catbreak:1};
  const cards=REPORTS.map(r=>{ const aoa=reportAoa(r.id); const cols=aoa[3]||[]; const data=aoa.slice(4);
    const nf=NUMFROM[r.id]!=null?NUMFROM[r.id]:2;
    const head='<tr>'+cols.map(c=>`<th>${esc(String(c))}</th>`).join('')+'</tr>';
    const body=data.map(row=> row.length===1
        ? `<tr class="grp-row"><td colspan="${cols.length||1}">${esc(String(row[0]))}</td></tr>`
        : `<tr${String(row[0])==='TOTAL'?' style="background:var(--gold-dim);font-weight:700"':''}>`+row.map((c,i)=>`<td class="${i>=nf?'num':''}">${esc(String(c==null?'':c))}</td>`).join('')+'</tr>').join('')
      || `<tr><td colspan="${cols.length||1}" class="center muted" style="padding:12px">No data for this period</td></tr>`;
    return `<div class="card"><div class="card-head" style="padding:9px 14px"><div><h3 style="font-size:13.5px">${r.ico} ${r.name}</h3><p style="font-size:10.5px">${data.length} rows · A-Z all items</p></div>
        <div class="flex gap-8"><button class="btn btn-sm" onclick="expReport('${r.id}','xlsx')">📊 Excel</button><button class="btn btn-sm" onclick="expReport('${r.id}','csv')">⤓ CSV</button></div></div>
      <div class="table-wrap" style="max-height:300px;overflow:auto"><table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>`; }).join('');
  // ---- chart data + %-wise legends (so the pies are readable) ----
  const GOLDS=['#d8bd7f','#b89a5c','#8a6d3b','#6b5836','#5c4a28','#4a3a22','#3a2f1c','#2a2620'];
  const dot=c=>`<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${c};margin-right:5px"></span>`;
  const lgRow=(i,name,pct)=>`<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${dot(GOLDS[i]||'#2a2620')}${esc(name)} <strong style="color:var(--text)">${pct.toFixed(1)}%</strong></div>`;
  const ckAll=cocktailSales(); const ckTot=ckAll.reduce((s,x)=>s+x.qty,0)||1;
  const ckTop=ckAll.slice().sort((a,b)=>b.qty-a.qty).slice(0,8);
  const ckLg=ckTop.map((x,i)=>lgRow(i,x.c.name,x.qty/ckTot*100)).join('');
  const stAll=brandRowsData().filter(b=>b.s>0); const stTot=stAll.reduce((s,b)=>s+b.s,0)||1;
  const stTop=stAll.slice().sort((a,b)=>b.s-a.s).slice(0,8);
  const stLg=stTop.map((b,i)=>lgRow(i,b.t.name,b.s/stTot*100)).join('');
  const csAll=categorySummary(); const csTot=csAll.reduce((s,c)=>s+c.c+c.s,0)||1;
  const csTop=csAll.slice(0,7); const csRest=csAll.slice(7).reduce((s,c)=>s+c.c+c.s,0);
  const csLg=csTop.map((c,i)=>lgRow(i,c.cat,(c.c+c.s)/csTot*100)).join('')+(csRest?lgRow(7,'Others',csRest/csTot*100):'');
  const chartCard=(id,title,lg)=>`<div class="card" style="flex:1;min-width:230px"><div class="card-head" style="padding:8px 12px"><h3 style="${SER};color:var(--gold);font-size:12.5px">${title}</h3></div>
    <div class="card-body" style="padding:8px 10px;display:flex;gap:10px;align-items:center">
      <div style="width:112px;height:112px;flex:none;position:relative"><canvas id="${id}"></canvas></div>
      <div style="flex:1;min-width:0;font-size:10.5px;color:var(--text-muted);line-height:1.85">${lg}</div></div></div>`;
  return `
    <div class="rptc">
    ${letterhead('Reports')}
    <div class="page-head" style="margin-bottom:8px"><div><h1 style="font-size:17px">Reports</h1><p style="font-size:11px">${periodBar(true)}</p></div>
      <div class="page-actions"><button class="btn btn-sm" onclick="window.print()">🖨️ Print / PDF</button></div></div>
    <div class="stat-strip" style="margin-bottom:8px">
      <div class="s"><div class="l">Total Sale</div><div class="v gold">${fmt(Math.round(sales))} <span class="muted" style="font-size:11px">ml</span></div></div>
      <div class="s"><div class="l">Cocktail</div><div class="v">${fmt(Math.round(totalC))} <span class="muted" style="font-size:11px">ml</span></div></div>
      <div class="s"><div class="l">Straight</div><div class="v">${fmt(Math.round(totalS))} <span class="muted" style="font-size:11px">ml</span></div></div>
      <div class="s"><div class="l">Consumption</div><div class="v">${fmt(Math.round(consTot))}</div></div>
      <div class="s"><div class="l">Net Variance</div><div class="v" style="color:${varTot>=0?'var(--green)':'var(--red)'}">${varTot>0?'+':''}${fmt(Math.round(varTot))}</div></div>
      <div class="s"><div class="l">Sale Value</div><div class="v gold">₹ ${fmt(Math.round(D.tot.sale))}</div></div>
    </div>
    <div class="rptcharts" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      ${chartCard('rpC1','🍹 Cocktail share — qty %',ckLg)}
      ${chartCard('rpC2','🥃 Straight share — ml %',stLg)}
      ${chartCard('rpC3','📊 Category share — ml %',csLg)}
      <div class="card" style="flex:1.1;min-width:240px"><div class="card-head" style="padding:8px 12px"><h3 style="${SER};color:var(--gold);font-size:12.5px">🏆 Top sale value — ₹</h3></div>
        <div class="card-body" style="padding:8px"><div style="height:128px;position:relative"><canvas id="rpC4"></canvas></div></div></div>
    </div>
    <div class="grid-2" style="gap:8px">${cards}</div>
    </div>`;
};
AFTER.reports = () => {
  if(typeof Chart==='undefined') return;
  const GOLDS=['#d8bd7f','#b89a5c','#8a6d3b','#6b5836','#5c4a28','#4a3a22','#3a2f1c','#2a2620'];
  const mk=(id,cfgc)=>{ const el=$('#'+id); if(el) CHARTS.push(new Chart(el,cfgc)); };
  const noleg={plugins:{legend:{display:false}},responsive:true,maintainAspectRatio:false};
  const ck=cocktailSales().sort((a,b)=>b.qty-a.qty).slice(0,8);
  mk('rpC1',{type:'pie',data:{labels:ck.map(x=>x.c.name),datasets:[{data:ck.map(x=>x.qty),
    backgroundColor:GOLDS,borderColor:'#161a23',borderWidth:2}]},options:noleg});
  const st=brandRowsData().filter(b=>b.s>0).sort((a,b)=>b.s-a.s).slice(0,8);
  mk('rpC2',{type:'pie',data:{labels:st.map(b=>b.t.name),datasets:[{data:st.map(b=>Math.round(b.s)),
    backgroundColor:GOLDS,borderColor:'#161a23',borderWidth:2}]},options:noleg});
  const cs=categorySummary(); const csTop=cs.slice(0,7); const csRest=cs.slice(7).reduce((s,c)=>s+c.c+c.s,0);
  mk('rpC3',{type:'doughnut',data:{labels:csTop.map(c=>c.cat).concat(csRest?['Others']:[]),
    datasets:[{data:csTop.map(c=>Math.round(c.c+c.s)).concat(csRest?[Math.round(csRest)]:[]),
    backgroundColor:GOLDS,borderColor:'#161a23',borderWidth:2}]},options:{...noleg,cutout:'58%'}});
  const D=biRoyalData(); const topS=D.rows.slice().sort((a,b)=>b.A.sale-a.A.sale).slice(0,8).filter(r=>Math.round(r.A.sale)>0);
  mk('rpC4',{type:'bar',data:{labels:topS.map(r=>r.name.length>12?r.name.slice(0,11)+'…':r.name),
    datasets:[{data:topS.map(r=>Math.round(r.A.sale)),backgroundColor:topS.map((r,i)=>i===0?'#d8bd7f':'#3a2f1c'),borderRadius:3}]},
    options:{...noleg,scales:{x:{ticks:{color:'#8a8272',font:{size:8.5}},grid:{display:false}},y:{ticks:{color:'#8a8272',font:{size:9}},grid:{color:'rgba(138,130,114,.12)'}}}}});
};

/* ============================================================
   EXCEL-STYLE ARROW-KEY NAVIGATION — every sheet, every layout.
   ↑ ↓ move to the same column of the previous/next row; ← → move
   along the row (only when the text cursor is at the edge, so
   normal in-cell editing still works). Focus survives the route()
   re-render triggered by the committed edit (re-locates by index).
   ============================================================ */
document.addEventListener('keydown', function(e){
  const el=e.target;
  if(!(el instanceof HTMLInputElement) || !el.classList.contains('cell-input')) return;
  const k=(e.key==='Enter')?'ArrowDown':e.key;      // Enter = commit + move down, Excel-style
  if(k!=='ArrowUp' && k!=='ArrowDown' && k!=='ArrowLeft' && k!=='ArrowRight') return;
  const len=(el.value||'').length;
  let ss=null, se=null; try{ ss=el.selectionStart; se=el.selectionEnd; }catch(err){}
  if(k==='ArrowLeft'  && ss!=null && ss>0) return;      // still editing inside the text
  if(k==='ArrowRight' && se!=null && se<len) return;
  const table=el.closest('table'); if(!table) return;
  const all=Array.from(table.querySelectorAll('input.cell-input'));
  let target=null;
  if(k==='ArrowLeft' || k==='ArrowRight'){
    const ix=all.indexOf(el); if(ix<0) return;
    target=all[ix+(k==='ArrowRight'?1:-1)]||null;
  } else {
    const td=el.closest('td'), tr=el.closest('tr'); if(!td||!tr) return;
    const colIdx=Array.from(tr.children).indexOf(td);
    const inTd=Array.from(td.querySelectorAll('input.cell-input')).indexOf(el);
    let row=tr;
    while(true){
      row=(k==='ArrowDown')?row.nextElementSibling:row.previousElementSibling;
      if(!row) break;
      const c=row.children[colIdx]; if(!c) continue;              // group rows (colspan) are skipped
      const cin=c.querySelectorAll('input.cell-input');
      if(cin.length){ target=cin[Math.min(Math.max(inTd,0),cin.length-1)]; break; }
    }
  }
  if(!target) return;
  e.preventDefault();
  const tables=Array.from(document.querySelectorAll('#view table'));
  const ti=tables.indexOf(table), gIdx=all.indexOf(target);
  el.blur();                                                       // commits the edit (may route()-re-render)
  setTimeout(function(){
    const tb=Array.from(document.querySelectorAll('#view table'))[ti]; if(!tb) return;
    const a2=Array.from(tb.querySelectorAll('input.cell-input'));
    const nx=a2[gIdx]; if(nx){ nx.focus(); if(nx.select) nx.select(); nx.scrollIntoView({block:'nearest'}); }
  },0);
});
/* Laptop keys everywhere (2026-07-18): PageUp / PageDown / Home / End scroll the sheet
   you are looking at — open modal first, else the tallest scrolling table on the page,
   else the window. Home/End inside a text field keep their native cursor behaviour. */
document.addEventListener('keydown', function(e){
  const k=e.key;
  const t=e.target||{};
  const inField=t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT';
  if(k==='/' && !inField){                            // "/" = jump to this page's search box
    const s=$('#msItem')||$('#mrFindBox')||$('#biFindBox')||$('#searchBox');
    if(s && s.offsetParent){ s.focus(); try{ s.select(); }catch(err){} e.preventDefault(); }
    return;
  }
  if(k!=='PageDown'&&k!=='PageUp'&&k!=='Home'&&k!=='End') return;
  if((k==='Home'||k==='End') && inField) return;
  let sc=null;
  const mb=document.querySelector('.modal-body');
  if(mb && mb.offsetParent && mb.scrollHeight>mb.clientHeight+10) sc=mb;
  if(!sc){
    const wraps=Array.from(document.querySelectorAll('#view .table-wrap'))
      .filter(w=>w.offsetParent && w.scrollHeight>w.clientHeight+20);
    if(wraps.length) sc=wraps.reduce((a,b)=>(b.clientHeight>a.clientHeight?b:a));
  }
  const el=sc||document.scrollingElement||document.documentElement;
  const page=(sc?sc.clientHeight:window.innerHeight)*0.9;
  if(k==='PageDown') el.scrollTop+=page;
  else if(k==='PageUp') el.scrollTop-=page;
  else if(k==='Home') el.scrollTop=0;
  else el.scrollTop=el.scrollHeight;
  e.preventDefault();
});

/* ============================================================
   DASHBOARD — royal rebuild (overrides bartie's old dashboard).
   Every number comes from the SAME engine: barRow / biAmt /
   brandRowsData / cocktailSales / categorySummary — no new math.
   ============================================================ */
let dbOpenCat='';
function dbCatToggle(c){ dbOpenCat=(dbOpenCat===c?'':c); route(); }
// cocktail ₹ = each recipe spirit's ml → bottles × that brand's MRP (shared key)
function ckAmt(c,qty){
  let a=0;
  (c.recipe||[]).forEach(r=>{
    const t=(typeof getTallyItem==='function'&&getTallyItem(r.spirit))||tallyItems.find(x=>norm(x.name)===norm(r.spirit));
    if(!t) return; const sl=sizeOf(t.name)||0; if(!sl) return;
    const key=rawNameFor(t.name)||t.name; const m=landOf(key);
    a+=(+r.ml||0)*qty/1000/sl*m;
  });
  return a;
}
// vivid palette + shared category-chart data (view + AFTER use the SAME source, so
// legend order always matches the slices). all = cocktail+straight ml per category,
// st = straight-only, ck = cocktail-only (recipe ml attributed to each spirit's category).
const DBVIVID=['#4f8cff','#f0a73b','#22c1a3','#e8c94b','#8b5cf6','#25c685','#38bdf8','#ec4899','#f0776d','#94a3b8'];
function dbCatData(){
  const cs=categorySummary();
  const mk=f=>cs.map(c=>({cat:c.cat,v:f(c)})).filter(x=>x.v>0.5).sort((a,b)=>b.v-a.v);
  const cap=list=>{ if(list.length<=8) return list;
    const top=list.slice(0,7); top.push({cat:'OTHERS', v:list.slice(7).reduce((s,x)=>s+x.v,0)}); return top; };
  return { all:cap(mk(c=>c.c+c.s)), st:cap(mk(c=>c.s)), ck:cap(mk(c=>c.c)) };
}
/* ---- 5 royal dashboard looks (2026-08-08) — `pref.dbLook`; every figure is passed in
   from VIEWS.dashboard (same engine), this only lays it out. Colours are theme vars. ---- */
function setDbLook(v){ pref.dbLook=v; bsv('pref',pref); route(); }
const DBLOOKS=[['def','① Classic'],['palace','② Monogram Palace'],['colonnade','③ Imperial Colonnade'],['scroll','④ Golden Scroll'],['seal','⑤ Royal Seal'],['atrium','⑥ Emerald Atrium']];
function dbLookNow(){ const v=pref.dbLook||'palace'; return DBLOOKS.some(x=>x[0]===v)?v:'palace'; }
function dbRoyalHead(look,X){
  const R2=x=>Math.round(x), M=v=>'₹ '+fmt(R2(v)), ML=v=>fmt(R2(v))+' ML';
  const sgn=v=>(v>0?'+':'')+fmt(R2(v));
  const vc=v=>v>=0?'g':'r';
  const GOLD=['#d4af37','#b3891c','#8a6d3b','#6b5836','#4f4022','#3a2f1c','#2a2620','#1f1c16'];
  const catTot=X.cats.reduce((s,c)=>s+c.v,0)||1;
  const pct=v=>(v/catTot*100);
  let _a=0; const conic='conic-gradient('+X.cats.map((c,i)=>{ const s=_a; _a+=pct(c.v); return `${GOLD[i]||'#2a2620'} ${s.toFixed(2)}% ${_a.toFixed(2)}%`; }).join(',')+')';
  const donut=(sz)=>`<div class="dbdonut" style="width:${sz}px;height:${sz}px;background:${conic}"><div class="c"><b>${fmt(R2(catTot))}</b><span>Total ML</span></div></div>`;
  const ring=(p,label)=>`<div class="dbdonut" style="width:104px;height:104px;background:conic-gradient(var(--gold) 0 ${p.toFixed(1)}%, var(--border-soft) 0 100%)"><div class="c"><b>${p.toFixed(1)}%</b><span>${esc(label)}</span></div></div>`;
  const bars=n=>X.cats.slice(0,n||6).map(c=>`<div class="bar"><div class="t"><span>${esc(c.cat)}</span><b>${fmt(R2(c.v))} ml · ${pct(c.v).toFixed(1)}%</b></div><div class="tr"><div class="fl" style="width:${pct(c.v).toFixed(1)}%"></div></div></div>`).join('')||'<div class="muted" style="font-size:11px">No consumption yet</div>';
  const legend=n=>X.cats.slice(0,n||6).map((c,i)=>`<div class="lgr2"><i style="background:${GOLD[i]||'#2a2620'}"></i><span>${esc(c.cat)}</span><b>${pct(c.v).toFixed(1)}%</b></div>`).join('');
  const ROM=['I','II','III','IV','V','VI','VII','VIII'];
  const medals=(list,val)=>list.map((x,i)=>`<div class="medal"><div class="rk">${ROM[i]||(i+1)}</div><div class="nm">${esc(x.name)}</div><b>${val(x)}</b></div>`).join('')||'<div class="muted" style="font-size:11px">No data</div>';
  const brandTbl=n=>`<div class="dwrap"><table class="dtbl"><thead><tr><th>Brand</th><th>Category</th><th>Consumption</th><th>Amount ₹</th></tr></thead><tbody>${
    X.brands.slice(0,n||5).map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(b.cat)}</td><td>${fmt(R2(b.ml))} ml</td><td><b>${M(b.amt)}</b></td></tr>`).join('')||'<tr><td colspan="4" class="muted">No data</td></tr>'}</tbody></table></div>`;
  const varTbl=n=>`<div class="dwrap"><table class="dtbl"><thead><tr><th>Item</th><th>Variance</th><th>Amount ₹</th></tr></thead><tbody>${
    X.vars.slice(0,n||5).map(v=>`<tr><td>${esc(v.name)}</td><td class="${vc(v.v)}">${sgn(v.v)} ${v.u==='pcs'?'pcs':'ml'}</td><td class="${vc(v.amt)}">${M(v.amt)}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">No variance</td></tr>'}
    <tr><td><b style="color:var(--text)">NET VARIANCE</b></td><td></td><td class="${vc(X.vrT)}"><b class="${vc(X.vrT)}">${M(X.vrT)}</b></td></tr></tbody></table></div>`;
  const ckTbl=n=>`<div class="dwrap"><table class="dtbl"><thead><tr><th>Cocktail</th><th>Qty</th><th>Total ML</th><th>Amount ₹</th></tr></thead><tbody>${
    X.cks.slice(0,n||5).map(c=>`<tr><td>${esc(c.name)}</td><td>${fmt(c.qty)}</td><td>${fmt(R2(c.ml))}</td><td><b>${M(c.amt)}</b></td></tr>`).join('')||'<tr><td colspan="4" class="muted">No data</td></tr>'}</tbody></table></div>`;
  const catTbl=()=>`<div class="dwrap"><table class="dtbl"><thead><tr><th>Category</th><th>Consumption ML</th><th>% share</th></tr></thead><tbody>${
    X.cats.map(c=>`<tr><td>${esc(c.cat)}</td><td><b>${fmt(R2(c.v))}</b></td><td>${pct(c.v).toFixed(1)}%</td></tr>`).join('')||'<tr><td colspan="3" class="muted">No data</td></tr>'}
    <tr><td><b style="color:var(--text)">TOTAL</b></td><td><b>${fmt(R2(catTot))}</b></td><td>100%</td></tr></tbody></table></div>`;
  const head=`${esc(cfg.company||'Bar')}`, sub=`Beverage Control · ${period.from} → ${period.to}`;

  if(look==='palace') return `<div class="dbr dbr-palace">
    <div class="flor">✦ ✦ ✦</div><h2>${head}</h2><div class="sub">${esc(sub)}</div>
    <div class="centre">
      <div class="sidek">
        <div class="k"><i>Opening</i><b>${ML(X.ml.open)}</b><span>${M(X.amt.open)}</span></div>
        <div class="k"><i>Received</i><b>${ML(X.ml.rec)}</b><span>${M(X.amt.rec)}</span></div>
        <div class="k"><i>Consumption</i><b>${ML(X.ml.cons)}</b><span>${M(X.amt.cons)}</span></div>
      </div>
      <div class="crest"><i>♛</i><b>${M(X.lrVal+X.amt.close)}</b><span>Stock in Hand</span><span class="g">room ${fmt(R2(X.lrVal))} · bar ${fmt(R2(X.amt.close))}</span></div>
      <div class="sidek">
        <div class="k"><i>Closing</i><b>${ML(X.ml.close)}</b><span>${M(X.amt.close)}</span></div>
        <div class="k"><i>Variance</i><b class="${vc(X.ml.varv)}">${sgn(X.ml.varv)} ML</b><span class="${vc(X.amt.varv)}">${M(X.amt.varv)}</span></div>
        <div class="k"><i>Sale Value</i><b>${M(X.amt.sale)}</b><span>cocktail + straight</span></div>
      </div>
    </div>
    <div class="dsec">Category Consumption</div>${bars(6)}
    <div class="dsec">Top Movers &amp; Variance</div>
    <div class="two">${brandTbl(5)}${varTbl(4)}</div>
    <div class="band">
      <span>Top Brand <b>${esc((X.brands[0]||{}).name||'—')}</b></span>
      <span>Best Cocktail <b>${esc((X.cks[0]||{}).name||'—')}</b></span>
      <span>Variance <span class="${vc(X.vrT)}">${M(X.vrT)}</span></span>
      <span>Low Stock <b>${X.low} items</b></span>
    </div></div>`;

  if(look==='colonnade') return `<div class="dbr dbr-colonnade">
    <div class="arch"><h2>${head}</h2><small>${esc(sub)}</small></div>
    <div class="cols">
      <div class="pil"><i>Opening</i><b>${fmt(R2(X.ml.open))}</b><span>${M(X.amt.open)}</span></div>
      <div class="pil"><i>Received</i><b>${fmt(R2(X.ml.rec))}</b><span>${M(X.amt.rec)}</span></div>
      <div class="pil"><i>Consumption</i><b>${fmt(R2(X.ml.cons))}</b><span>${M(X.amt.cons)}</span></div>
      <div class="pil"><i>Closing</i><b>${fmt(R2(X.ml.close))}</b><span>${M(X.amt.close)}</span></div>
      <div class="pil"><i>Variance</i><b class="${vc(X.ml.varv)}">${sgn(X.ml.varv)}</b><span class="${vc(X.amt.varv)}">${M(X.amt.varv)}</span></div>
      <div class="pil"><i>Stock Value</i><b>${M(X.lrVal+X.amt.close)}</b><span>LR + Bar</span></div>
    </div>
    <div class="body">
      <div class="dsec">The Consumption Hall</div>
      <div class="split">
        <div class="plinth">${catTbl()}</div>
        <div class="plinth" style="text-align:center">
          <div style="font-family:Georgia,serif;color:var(--gold);font-size:10px;letter-spacing:.24em;text-transform:uppercase;margin-bottom:6px">Category Share</div>
          ${donut(122)}<div style="text-align:left;margin-top:8px">${legend(6)}</div></div>
      </div>
      <div class="dsec">Cocktails of Note</div>${ckTbl(6)}
    </div></div>`;

  if(look==='scroll') return `<div class="dbr dbr-scroll">
    <div class="rib"><h2>Beverage Control</h2><small>${head} · ${esc(sub.replace('Beverage Control · ',''))}</small></div>
    <div class="scr"><h4>The Six Figures</h4><div class="fig6">
      <div class="f"><i>Consumption</i><b>${fmt(R2(X.ml.cons))}</b><span>${M(X.amt.cons)}</span></div>
      <div class="f"><i>Variance</i><b class="${vc(X.ml.varv)}">${sgn(X.ml.varv)}</b><span class="${vc(X.amt.varv)}">${M(X.amt.varv)}</span></div>
      <div class="f"><i>Liquor Room</i><b>${M(X.lrVal)}</b><span>${X.lrN} items</span></div>
      <div class="f"><i>Bar Opening</i><b>${M(X.amt.open)}</b><span>${ML(X.ml.open)}</span></div>
      <div class="f"><i>Bar Received</i><b>${M(X.amt.rec)}</b><span>${ML(X.ml.rec)}</span></div>
      <div class="f"><i>Bar Closing</i><b>${M(X.amt.close)}</b><span>${ML(X.ml.close)}</span></div>
    </div></div>
    <div class="two">
      <div class="scr"><h4>Top Brands</h4>${medals(X.brands.slice(0,5),b=>fmt(R2(b.ml))+' ml')}</div>
      <div class="scr"><h4>Top Cocktails</h4>${medals(X.cks.slice(0,5),c=>fmt(c.qty)+' · '+M(c.amt))}</div>
    </div>
    <div class="scr"><h4>Category Consumption</h4>${bars(6)}</div>
    <div class="scr"><h4>Variance Register</h4>${varTbl(5)}</div></div>`;

  if(look==='seal') return `<div class="dbr dbr-seal">
    <div class="hd"><h2>${head}</h2><div class="rule"><span>${esc(sub)}</span></div></div>
    <div class="quad">
      <div class="q"><i>Opening Stock</i><b>${ML(X.ml.open)}</b><span>${M(X.amt.open)}</span></div>
      <div class="seal"><i>♛</i><b>${M(X.lrVal+X.amt.close)}</b><span>Stock in Hand</span></div>
      <div class="q"><i>Received</i><b>${ML(X.ml.rec)}</b><span>${M(X.amt.rec)}</span></div>
      <div class="q"><i>Consumption</i><b>${ML(X.ml.cons)}</b><span>${M(X.amt.cons)}</span></div>
      <div class="q"><i>Variance</i><b class="${vc(X.ml.varv)}">${sgn(X.ml.varv)} ML</b><span class="${vc(X.amt.varv)}">${M(X.amt.varv)}</span></div>
    </div>
    <div class="dsec">Consumption by Category</div>
    <div class="three">${X.cats.slice(0,3).map(c=>`<div class="q" style="text-align:center">${ring(pct(c.v),c.cat)}
      <div style="font-size:10.5px;color:var(--text-muted);margin-top:7px">${fmt(R2(c.v))} ml</div></div>`).join('')||'<div class="q muted">No data</div>'}</div>
    <div class="dsec">Liquor Room &amp; Bar</div>
    <div class="three">
      <div class="q"><i>Liquor Room Closing</i><b>${M(X.lrVal)}</b><span>across ${X.lrN} items</span></div>
      <div class="q"><i>Bar Closing</i><b>${M(X.amt.close)}</b><span>${ML(X.ml.close)}</span></div>
      <div class="q"><i>Low / Out of Stock</i><b>${X.low} items</b><span class="${X.low?'r':'g'}">${X.low?'needs attention':'all stocked ✔'}</span></div>
    </div>
    <div class="dsec">Top Movers</div>${brandTbl(5)}</div>`;

  return `<div class="dbr dbr-atrium">
    <div class="hd">
      <div style="display:flex;align-items:center;gap:12px"><div class="mono">${esc(initials(cfg.company||'TG'))}</div>
        <div><h2>Beverage Control</h2><small>${head} · ${esc(sub.replace('Beverage Control · ',''))}</small></div></div>
      <div style="text-align:right"><small>Stock in Hand</small>
        <div style="font-family:Georgia,serif;font-size:21px;color:var(--gold)" class="n">${M(X.lrVal+X.amt.close)}</div></div>
    </div>
    <div class="atr">
      <div class="p"><i>Total Consumption</i><b>${fmt(R2(X.ml.cons))}</b><span>ML · ${M(X.amt.cons)}</span>
        <div class="mini"><div>Cocktail<b>${fmt(R2(X.ckMl))} ml</b></div><div>Straight<b>${fmt(R2(X.stMl))} ml</b></div></div></div>
      <div class="p"><i>Total Variance</i><b class="${vc(X.ml.varv)}">${sgn(X.ml.varv)}</b><span class="${vc(X.amt.varv)}">ML · ${M(X.amt.varv)}</span>
        <div class="mini"><div>Plus<b class="g">${M(X.plus)}</b></div><div>Minus<b class="r">−${fmt(R2(X.minus))}</b></div></div></div>
      <div class="p"><i>Stock Value</i><b>${M(X.lrVal+X.amt.close)}</b><span>Liquor Room + Bar</span>
        <div class="mini"><div>Room<b>${M(X.lrVal)}</b></div><div>Bar<b>${M(X.amt.close)}</b></div></div></div>
    </div>
    <div class="atr">
      <div class="p"><i>Opening</i><b style="font-size:18px">${ML(X.ml.open)}</b><span>${M(X.amt.open)}</span></div>
      <div class="p"><i>Received</i><b style="font-size:18px">${ML(X.ml.rec)}</b><span>${M(X.amt.rec)}</span></div>
      <div class="p"><i>Closing</i><b style="font-size:18px">${ML(X.ml.close)}</b><span>${M(X.amt.close)}</span></div>
    </div>
    <div class="dsec">Category &amp; Movers</div>
    <div class="wide">
      <div class="p"><i>Category consumption share</i><div style="margin-top:8px">${bars(6)}</div></div>
      <div class="p"><i>Top brands &amp; variance</i><div style="margin-top:6px">${brandTbl(4)}${varTbl(3)}</div></div>
    </div></div>`;
}
/* ---- 🤖 Smart Assistant (rule-based, offline) — answers from the SAME live engine.
   Understands simple English + Bengali keywords; transcript lives in-memory only. ---- */
var _asstLog=[], _asstMs=0;
function asstRender(){
  return _asstLog.map(m=>`<div class="am ${m.w}">${m.h}</div>`).join('')
    || `<div class="am a">👋 Ask me about your numbers — try a quick button below, or type e.g. <b>top brands</b> · <b>low stock</b> · <b>variance</b> · <b>totals</b>.</div>`;
}
function asstRows(list){ return list.map(x=>`<div class="ar"><span>${esc(x[0])}</span><b>${x[1]}</b></div>`).join(''); }
function asstClear(){ _asstLog=[]; const l=$('#asstLog'); if(l) l.innerHTML=asstRender(); const i=$('#asstQ'); if(i) i.focus(); }
// typo-tolerant similarity (bigram Dice) — "carlsburg" still finds CARLSBERG
// Bigrams of a string are a pure function of that string, so they are cached
// forever-safely (a renamed item is simply a different key). This is the hot
// path: one item lookup used to rebuild ~4.5k bigram arrays.
var _asstBgC=Object.create(null), _asstBgN=0;
function _asstBg(s){
  var v=_asstBgC[s]; if(v!==undefined) return v;
  var o=[]; for(var i=0;i<s.length-1;i++) o.push(s.slice(i,i+2));
  if(_asstBgN>8000){ _asstBgC=Object.create(null); _asstBgN=0; }   // bounded
  _asstBgC[s]=o; _asstBgN++; return o;
}
// Dice from two prebuilt bigram arrays. `min` (optional) prunes exactly: Dice can
// never exceed 2*min(|A|,|B|)/(|A|+|B|), so a pair that cannot reach the caller's
// threshold is dropped without counting — same results, less work.
function _asstDice(A,B,min){ return _asstMatcher(A)(B,min); }
// A matcher pre-counts ONE side's bigrams and is then run against many candidates
// (the query is compared to ~500 names, so this map was being rebuilt ~500×).
// The base count map is never mutated — consumption is tracked in a small object
// allocated only when there are hits — so the multiset intersection stays exact.
function _asstMatcher(A){
  var la=A.length, base={}, i;
  for(i=0;i<la;i++){ var k=A[i]; base[k]=(base[k]||0)+1; }
  return function(B,min){
    var lb=B.length; if(!la||!lb) return 0;
    if(min && 2*(la<lb?la:lb)/(la+lb) < min) return 0;
    var hit=0, used=null, j, key, avail, u;
    for(j=0;j<lb;j++){
      key=B[j]; avail=base[key];
      if(avail===undefined) continue;
      u=used?(used[key]||0):0;
      if(u<avail){ hit++; if(!used) used={}; used[key]=u+1; }
    }
    return 2*hit/(la+lb);
  };
}
function _asstSim(a,b,min){
  a=norm(a); b=norm(b); if(!a||!b) return 0; if(a===b) return 1;
  return _asstDice(_asstBg(a), _asstBg(b), min);
}
// command / filler words (incl. common typos + Bengali) stripped before item matching
var _ASST_STOP=['stock','stok','stcok','stocks','closing','closig','closin','close','opening','open','value','valu','price','amount','total','grand','liquor','liquore','room','beverage','bevrage','beverege','control','bar','sale','sold','sell','variance','varian','varience','consumption','ml','btl','bottle','bottles','pcs','of','the','in','er','a','and','plus','koto','kato','dam','dor','holo','ache','ase','have','how','much','many','what','is','my','show','me','top','best','brand','brands','cocktail','cocktails','low','out','help','today','purchase','purchases','received','invoice','স্টক','মোট','বিক্রি','মূল্য','দাম','কত','আছে','কম','লিকার','রুম','বার','মিলিয়ে','ক্লোজিং','ভ্যারিয়েন্স'];
function asstFindItem(q){
  const words=String(norm(q)).split(/\s+/).filter(w=>w && _ASST_STOP.indexOf(w.toLowerCase())<0 && !/^\d+$/.test(w) && w!=='+');
  const qq=words.join(' ').trim();
  if(!qq || qq.replace(/\s/g,'').length<4) return null;
  // Build the query side ONCE (it used to be rebuilt for every one of ~500 items).
  const qM=_asstMatcher(_asstBg(qq)), nW=words.length;
  const wM=words.map(w=>_asstMatcher(_asstBg(w)));
  const scored=[];
  const consider=(name,src)=>{
    const n=norm(name);                                   // was computed twice per item
    let s=(n===qq)?1:qM(_asstBg(n),.45);                  // .45 prune is exact: the gate below is >=.45
    if(n.indexOf(qq)>=0) s=Math.max(s,.9);
    if(nW){
      const nw=n.split(/\s+/);
      let acc=0;
      for(let i=0;i<nW;i++){
        let b2=0;
        for(let j=0;j<nw.length;j++){
          const v=(words[i]===nw[j])?1:wM[i](_asstBg(nw[j]),b2);  // prune against the running max — exact
          if(v>b2) b2=v;
        }
        acc+=b2;
      }
      s=Math.max(s, acc/nW*.95);
    }
    if(s>=.45) scored.push({name,src,s});
  };
  rawData.forEach(r=>consider(r.item,'raw'));
  tallyItems.forEach(t=>consider(t.name,'tally'));
  if(!scored.length) return null;
  scored.sort((a,b)=>b.s-a.s);
  const best=scored[0];
  const alts=[]; const seen={}; seen[norm(best.name)]=1;
  scored.slice(1).forEach(x=>{ if(alts.length>=3) return; if(seen[norm(x.name)]) return; if(x.s<best.s-.22) return; seen[norm(x.name)]=1; alts.push(x.name); });
  return {name:best.name, src:best.src, alts};
}
// full stock/value/sale/variance answer for ONE item (liquor room + bar sides, ₹ always shown)
function asstItemAnswer(q, f){
  const R2=x=>Math.round(x);
  const wantLR=/liquor|room|লিকার|রুম/.test(q), wantBar=/beverage|bevrage|control|\bbar\b|বার/.test(q);
  const wantTotal=/total|মোট|মিলিয়ে|\+|plus|together/.test(q);
  const wantSale=/sale|sold|বিক্রি/.test(q), wantVar=/varian|ঘাটতি|ভ্যারিয়েন্স/.test(q);
  let rawName=null, tallyT=null;
  if(f.src==='raw'){ rawName=f.name;
    tallyT=tallyItems.find(t=>norm(rawNameFor(t.name)||'')===norm(f.name))||null;
    if(!tallyT){ let b=null,bs=0; tallyItems.forEach(t=>{ const v=_asstSim(f.name,t.name,bs||.55); if(v>bs){bs=v;b=t;} }); if(bs>=.55) tallyT=b; }
  } else { tallyT=tallyItems.find(t=>t.name===f.name)||null; rawName=tallyT?(rawNameFor(tallyT.name)||null):null; }
  const rows=[];
  let lrVal=0, hasLR=false, barVal=0, hasBar=false, R=null, A=null;
  if(rawName && findRaw(rawName)){
    const op=fnum(invGet(rawName).lrOpen), rv=receivedForItem(rawName), is=issuedForItem(rawName), cl=op+rv-is;
    lrVal=cl*landOf(rawName); hasLR=true;
    if(wantLR||wantTotal||!wantBar) rows.push(['Liquor Room closing', fmt(Math.round(cl*100)/100)+' btl · ₹ '+fmt(R2(lrVal))]);
  }
  if(tallyT){
    R=barRow(tallyT); A=biAmt(tallyT,R); barVal=A.close; hasBar=true;
    const closeTxt=(R.iv.closeBL!=null&&R.iv.closeBL!=='')?String(R.iv.closeBL):'0';
    if(wantBar||wantTotal||!wantLR) rows.push(['Bar closing ('+(R.u==='pcs'?'pcs':'bottle.loose')+')', closeTxt+' · ₹ '+fmt(R2(barVal))]);
  }
  if((hasLR||hasBar) && (wantTotal||(!wantLR&&!wantBar)))
    rows.push(['Total closing value (LR + Bar)','₹ '+fmt(R2(lrVal+barVal))]);
  if(wantSale&&R) rows.push(['Sale (this period)', fmt(R.sale)+(R.u==='pcs'?' pcs':' ml')+' · ₹ '+fmt(R2(A.sale))]);
  if(wantVar&&R) rows.push(['Variance', (R.varv>0?'+':'')+fmt(R.varv)+(R.u==='pcs'?' pcs':' ml')+' · ₹ '+fmt(R2(A.varv))]);
  let out;
  if(!rows.length) out=`Found <b>${esc(f.name)}</b> but it has no stock entries yet — set its Opening/Closing in Liquor Room or Beverage Control.`;
  else out=`<b>📦 ${esc(f.name)}</b>`+asstRows(rows);
  if(f.alts && f.alts.length)
    out+=`<div style="margin-top:7px;font-size:10.5px" class="muted">Did you mean: ${f.alts.map(n=>`<button class="btn btn-sm" style="margin:2px 2px 0 0" onclick='asstAsk(${jatt(n+" stock")})'>${esc(n)}</button>`).join('')}</div>`;
  return out;
}
function asstAnswer(q){
  const s=' '+q.toLowerCase()+' ';
  const has=(...w)=>w.some(x=>s.indexOf(x)>=0);
  const R2=x=>Math.round(x);
  try{
    if(has('help','সাহায্য','ki parbe','কি পারবে'))
      return `I answer from the live data — try: <b>top brands</b> · <b>top cocktails</b> · <b>low stock</b> · <b>variance</b> · <b>totals</b> · <b>stock value</b> · <b>purchases</b>, or ask about ANY item by name, e.g. <b>kingfisher ultra total stock</b> · <b>carlsberg liquor room stock</b> (বানান একটু ভুল হলেও চলবে; বাংলাতেও লিখতে পারেন)`;
    // item-specific question? (typo-tolerant name match, runs before the generic answers)
    const f=asstFindItem(q);
    if(f) return asstItemAnswer(s, f);
    if(has('varian','ভ্যারিয়েন্স','varr','ghatti','ঘাটতি')){
      const vars=[]; let net=0;
      tallyItems.forEach(t=>{ const R=barRow(t);
        if(!(R.sale>0||R.recBtl>0||R.iv.openBL!=null||R.iv.closeBL!=null)) return;
        const A=biAmt(t,R); net+=A.varv; if(Math.abs(A.varv)>=1) vars.push([t.name, (A.varv>=0?'+₹ ':'−₹ ')+fmt(Math.abs(R2(A.varv)))]); });
      vars.sort((a,b)=>Math.abs(parseFloat(b[1].replace(/[^\d.]/g,'')))-Math.abs(parseFloat(a[1].replace(/[^\d.]/g,''))));
      return `<b>⚖️ Biggest variance (₹)</b>${asstRows(vars.slice(0,6))}<div class="ar"><span><b>Net variance</b></span><b>${net>=0?'+':'−'}₹ ${fmt(Math.abs(R2(net)))}</b></div>`||'No variance yet.';
    }
    if(has('low','out of','কম','শেষ')){
      const low=lowStockList();
      if(!low.length) return '🚨 Low stock — <b>all items stocked ✔</b>';
      return `<b>🚨 Low / Out of stock — ${low.length} item${low.length===1?'':'s'}</b>`+asstRows(low.slice(0,8).map(x=>[x.name, x.status+' · '+fmt(x.closing)+' '+x.u]))+(low.length>8?`<div class="ar"><span>…</span><b>+${low.length-8} more</b></div>`:'');
    }
    if(has('cocktail','ককটেল')){
      const cks=cocktailSales().sort((a,b)=>b.qty-a.qty).slice(0,6);
      return `<b>🍹 Top cocktails (qty sold)</b>`+asstRows(cks.map(x=>[x.c.name, fmt(x.qty)+' · '+fmt(R2(x.ml))+' ml']));
    }
    if(has('top','best','সেরা','বেশি')){
      const st=brandRowsData().filter(b=>b.s>0).sort((a,b)=>b.s-a.s).slice(0,6);
      const ck=cocktailSales().sort((a,b)=>b.qty-a.qty)[0];
      return `<b>🏆 Top straight brands (ml)</b>`+asstRows(st.map(b=>[b.t.name, fmt(R2(b.s))+' ml']))+(ck?`<div class="ar"><span><b>🍹 Top cocktail</b> — ${esc(ck.c.name)}</span><b>${fmt(ck.qty)} sold</b></div>`:'');
    }
    if(has('stock value','closing','liquor room','মূল্য','স্টক ভ্যালু')){
      let lrv=0; rawData.forEach(r=>{ const op=fnum(invGet(r.item).lrOpen), rv=receivedForItem(r.item), is=issuedForItem(r.item), cl=op+rv-is; lrv+=cl*landOf(r.item); });
      const D=biRoyalData();
      return `<b>💰 Stock value</b>`+asstRows([['Liquor Room closing','₹ '+fmt(R2(lrv))],['Bar closing (Beverage Control)','₹ '+fmt(R2(D.tot.close))],['Together','₹ '+fmt(R2(lrv+D.tot.close))]]);
    }
    if(has('purchase','received','invoice','কেনা','রিসিভ')){
      const tq=receivedStock.reduce((a,r)=>a+fnum(r.qty),0);
      const tv=receivedStock.reduce((a,r)=>a+recvVal(r),0);
      const inv=(typeof invoices!=='undefined')?invoices.length:0;
      const last=receivedStock.slice().sort((x,y)=>String(y.date).localeCompare(String(x.date)))[0];
      return `<b>📦 Purchases (this period)</b>`+asstRows([['Entries · bottles', fmt(receivedStock.length)+' · '+fmt(tq)],['Landing amount','₹ '+fmt(R2(tv))],['BEVCO invoices', fmt(inv)]])+(last?`<div class="ar"><span>Last receive — ${esc(last.item)}</span><b>${esc(last.date||'')}</b></div>`:'');
    }
    if(has('total','consum','sale','মোট','বিক্রি','আজ')){
      const {totalC,totalS}=calcGrandTotals(); const D=biRoyalData();
      return `<b>Σ This period</b>`+asstRows([['Cocktail sale', fmt(R2(totalC))+' ml'],['Straight sale', fmt(R2(totalS))+' ml'],['Total sale', fmt(R2(totalC+totalS))+' ml · ₹ '+fmt(R2(D.tot.sale))],['Consumption value','₹ '+fmt(R2(D.tot.cons))],['Variance value',(D.tot.varv>=0?'+':'−')+'₹ '+fmt(Math.abs(R2(D.tot.varv)))]]);
    }
  }catch(e){ return '⚠ Could not compute that right now — try a quick button.'; }
  return `Didn't catch that — try <b>top brands</b> · <b>top cocktails</b> · <b>low stock</b> · <b>variance</b> · <b>totals</b> · <b>stock value</b> · <b>purchases</b>`;
}
/* ---- the summary handed to the AI ----------------------------------------
   Deliberately small: totals, a few leaders, the low list, the worst variances — plus the
   offline engine's OWN answer to this very question. The model is told to use only these
   numbers, so it phrases and explains but never computes, and the whole database stays here. */
function asstFacts(q, offHtml){
  const L=[], R=x=>Math.round(x||0);
  const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&[a-z]+;/g,' ').replace(/\s+/g,' ').trim();
  try{ L.push('Company: '+((typeof cfg!=='undefined'&&cfg.company)||'-')+' | Period: '+period.from+' to '+period.to); }catch(e){}
  try{ const g=calcGrandTotals();
    L.push('Consumption: cocktail '+R(g.totalC)+' ml, straight '+R(g.totalS)+' ml'); }catch(e){}
  try{ const D=biRoyalData().tot;
    L.push('Beverage control in rupees: opening '+R(D.open)+', receipt '+R(D.rec)+', closing '+R(D.close)
      +', consumption '+R(D.cons)+', sale '+R(D.sale)+', variance '+R(D.varv)); }catch(e){}
  try{ const t=lrTotals();
    L.push('Liquor room in rupees: opening '+R(t.opV)+', received '+R(t.rvV)+', issued '+R(t.isV)+', closing '+R(t.clV)
      +' ('+t.n+' items)'); }catch(e){}
  try{ const rows=[];
    tallyItems.forEach(t=>{ const Rw=barRow(t); if(!(Rw.sale>0)) return; const A=biAmt(t,Rw);
      rows.push([t.name, R(A.sale), R(A.varv)]); });
    rows.sort((a,b)=>b[1]-a[1]);
    if(rows.length) L.push('Top brands by sale value (name, sale Rs, variance Rs): '
      +rows.slice(0,8).map(r=>r[0]+' '+r[1]+' / '+r[2]).join('; '));
    const v=rows.slice().sort((a,b)=>Math.abs(b[2])-Math.abs(a[2]));
    if(v.length) L.push('Biggest variances (name, Rs): '+v.slice(0,8).map(r=>r[0]+' '+r[2]).join('; '));
  }catch(e){}
  try{ const low=lowStockList();
    if(low.length) L.push('Low or out of stock ('+low.length+' items): '
      +low.slice(0,12).map(x=>x.name+' '+x.status).join('; ')); }catch(e){}
  try{ L.push('Counts: '+tallyItems.length+' brands, '+rawData.length+' master items, '
      +cocktails.length+' cocktails'); }catch(e){}
  const off=plain(offHtml);
  if(off) L.push('\nThe system already calculated this answer for the question — use these exact figures:\n'+off.slice(0,1400));
  return L.join('\n');
}
/* ---- voice ---------------------------------------------------------------
   Listening needs the internet (the browser sends the audio away to be recognised) — that is
   Chrome's design, not ours. Reading the answer out loud is local and works offline. */
var _asstRec=null, _asstListening=false;
function asstLang(){ return pref.asstLang==='bn-IN' ? 'bn-IN' : 'en-US'; }
function asstMicUI(on){ const b=$('#asstMic'); if(b){ b.classList.toggle('on',!!on); b.textContent=on?'⏹':'🎤'; } }
function asstMic(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ toast('Voice not available','This browser cannot listen. Chrome or Edge can.','err'); return; }
  if(_asstListening && _asstRec){ try{ _asstRec.stop(); }catch(e){} return; }
  const r=new SR(); _asstRec=r; r.lang=asstLang(); r.interimResults=false; r.maxAlternatives=1;
  r.onstart=()=>{ _asstListening=true; asstMicUI(true); };
  r.onend=()=>{ _asstListening=false; asstMicUI(false); };
  r.onerror=e=>{ _asstListening=false; asstMicUI(false);
    const k=e&&e.error;
    if(k==='not-allowed'||k==='service-not-allowed')
      toast('Microphone blocked','Allow the microphone for this page (the icon in the address bar), then press the mic again.','err');
    else if(k==='network')
      toast('Listening needs internet','Speaking to the computer is recognised online. Type the question instead — the answers themselves work offline.','err');
    else if(k==='audio-capture')
      toast('No microphone found','Plug one in, or check the Windows sound settings.','err');
    else if(k!=='aborted' && k!=='no-speech') toast('Voice stopped',String(k||''),'err');
  };
  r.onresult=e=>{ const t=((((e.results||[])[0]||[])[0])||{}).transcript||'';
    const i=$('#asstQ'); if(i) i.value=t; if(t.trim()) asstAsk(t.trim()); };
  try{ r.start(); }catch(e){ toast('Voice','Could not start listening — '+((e&&e.message)||''),'err'); }
}
function asstSpeak(html){
  if(!pref.asstSpeak || !window.speechSynthesis) return;
  const txt=String(html).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&[a-z]+;/g,' ').replace(/\s+/g,' ').trim();
  if(!txt) return;
  try{ speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(txt.slice(0,400)); u.lang=asstLang(); speechSynthesis.speak(u);
  }catch(e){}
}
function asstPaint(){
  const l=$('#asstLog'); if(l){ l.innerHTML=asstRender(); l.scrollTop=l.scrollHeight; }
  const m=$('#asstMs'); if(m) m.textContent=' · '+_asstMs+' MS';
}
async function asstAsk(q){
  q=(q!=null?q:($('#asstQ')?$('#asstQ').value:'')).trim(); if(!q) return;
  _asstLog.push({w:'u',h:esc(q)});
  const i=$('#asstQ'); if(i){ i.value=''; i.focus(); }
  const t0=performance.now();
  const off=asstAnswer(q);          // always computed — every figure in the reply comes from here
  _asstMs=Math.max(1,Math.round(performance.now()-t0));   // REAL measured time, not a decoration
  let ans=off;
  const useAI=(typeof aiOn==='function') && aiOn() && navigator.onLine;
  if(useAI){
    _asstLog.push({w:'a',h:'<span class="muted">Thinking…</span>'}); asstPaint();
    try{
      const txt=await aiAsk(q, asstFacts(q,off));
      ans=esc(txt).replace(/\n/g,'<br>')
        +'<div class="asrc">answered by '+(aiCfg().prov==='anthropic'?'Claude':'ChatGPT')+'</div>';
    }catch(e){
      ans=off+'<div class="asrc">offline answer — '+esc((e&&e.message)||'the AI did not respond')+'</div>';
    }
    _asstLog.pop();
  }
  _asstLog.push({w:'a',h:ans});
  if(_asstLog.length>40) _asstLog.splice(0,_asstLog.length-40);
  asstPaint(); asstSpeak(ans);
}
function asstQuick(k){
  const map={top:'top brands', ck:'top cocktails', low:'low stock', varr:'variance', tot:'totals', stock:'stock value', pur:'purchases'};
  asstAsk(map[k]||'help');
}
VIEWS.dashboard = () => {
  const SER="font-family:Georgia,'Times New Roman',serif";
  const R2=x=>Math.round(x);
  // ---- executive summary (₹ from biAmt engine; ML totals for ml-unit items) ----
  const D=biRoyalData();
  let consMl=0,varMl=0,openMl=0,recMl=0,closeMl=0;
  D.rows.forEach(r=>{ if(r.u==='ml'){ consMl+=r.cons; varMl+=r.varv; } });
  tallyItems.forEach(t=>{ const R=barRow(t);
    if(!(R.sale>0||R.recBtl>0||R.iv.openBL!=null||R.iv.closeBL!=null)) return;
    if(R.u!=='ml') return; const sl=sizeOf(t.name)||0;
    openMl+=toLitres(fnum(R.iv.openBL),sl)*1000; recMl+=R.recBtl*sl*1000; closeMl+=toLitres(fnum(R.iv.closeBL),sl)*1000; });
  // ---- straight & cocktail lists (top-15 cards) ----
  const stRows=brandRowsData().filter(b=>b.s>0);
  const cks=cocktailSales().sort((a,b)=>b.qty-a.qty);
  // ---- category charts (same data drives legend AND canvas) ----
  const CD=dbCatData();
  const totOf=list=>list.reduce((s,x)=>s+x.v,0)||1;
  const lg2=(list,tot)=>list.map((x,i)=>`<div class="lgr"><i style="background:${DBVIVID[i]}"></i><span>${esc(x.cat)}</span><b>${fmt(R2(x.v))} · ${(x.v/tot*100).toFixed(1)}%</b></div>`).join('')||'<div class="muted" style="font-size:11px">No data</div>';
  // ---- 🏆 top 15 high & low ----
  const rankBody=(list,cols)=>list.map((r,i)=>`<tr><td class="num">${i+1}</td>`+cols(r).map(c=>`<td class="${typeof c==='number'?'num':''}">${typeof c==='number'?fmt(R2(c)):esc(String(c))}</td>`).join('')+'</tr>').join('');
  const sec=(t,n)=>`<tr class="grp-row"><td colspan="${n}">${t}</td></tr>`;
  const ckHL=sec('🏆 TOP 15 — HIGH',4)+rankBody(cks.slice(0,15),r=>[r.c.name,r.qty,r.ml])
            +sec('🐢 TOP 15 — LOW',4)+rankBody(cks.slice().reverse().slice(0,15),r=>[r.c.name,r.qty,r.ml]);
  const stSorted=stRows.slice().sort((a,b)=>b.s-a.s);
  const stHL=sec('🏆 TOP 15 — HIGH',4)+rankBody(stSorted.slice(0,15),b=>[b.t.name,b.t.category,b.s])
            +sec('🐢 TOP 15 — LOW',4)+rankBody(stSorted.slice().reverse().slice(0,15),b=>[b.t.name,b.t.category,b.s]);
  // ---- 🏬 liquor room closing stock ----
  const lr=[]; rawData.forEach(r=>{ const op=fnum(invGet(r.item).lrOpen), rv=receivedForItem(r.item), is=issuedForItem(r.item), cl=op+rv-is;
    if(!cl) return; const m=landOf(r.item); lr.push({name:r.item,cl,amt:cl*m}); });
  lr.sort((a,b)=>b.amt-a.amt); const lrT=lr.reduce((s,x)=>s+x.amt,0);
  const lrBody=lr.map(x=>`<tr><td>${esc(x.name)}</td><td class="num">${fmt(Math.round(x.cl*100)/100)}</td><td class="num gold">₹ ${fmt(R2(x.amt))}</td></tr>`).join('');
  // ---- ⚖️ inventory variance (item · ±btl · ±ml · ₹) ----
  const vr=[]; tallyItems.forEach(t=>{ const R=barRow(t);
    if(!(R.sale>0||R.recBtl>0||R.iv.openBL!=null||R.iv.closeBL!=null)) return;
    if(!R.varv) return; const A=biAmt(t,R);
    vr.push({name:t.name,u:R.u,btl:R.varBtl,ml:R.varMl,v:R.varv,amt:A.varv}); });
  vr.sort((a,b)=>Math.abs(b.amt)-Math.abs(a.amt)); const vrT=vr.reduce((s,x)=>s+x.amt,0);
  const vcol=v=>v>0?'var(--green)':(v<0?'var(--red)':'var(--text-muted)');
  const vrBody=vr.map(x=>`<tr><td>${esc(x.name)}</td>
    <td class="num" style="color:${vcol(x.v)}">${x.v<0?'−':'+'}${x.btl}${x.u==='pcs'?' pcs':' btl'}</td>
    <td class="num" style="color:${vcol(x.v)}">${x.u==='pcs'?'—':fmt(x.ml)}</td>
    <td class="num" style="color:${vcol(x.v)}">${x.v>0?'+':''}${fmt(x.v)}</td>
    <td class="num" style="color:${vcol(x.amt)}">₹ ${fmt(R2(x.amt))}</td></tr>`).join('');
  // ---- data bundle for the royal looks (same figures the classic head shows) ----
  const _dbLook=dbLookNow();
  const DBX={
    ml:{open:openMl, rec:recMl, cons:consMl, close:closeMl, varv:varMl},
    amt:{open:D.tot.open, rec:D.tot.rec, cons:D.tot.cons, close:D.tot.close, varv:D.tot.varv, sale:D.tot.sale},
    lrVal:lrT, lrN:lr.length, cats:CD.all,
    brands:stSorted.map(b=>{ const sl=sizeOf(b.t.name)||0; const m=landOf(rawNameFor(b.t.name)||b.t.name);
      return {name:b.t.name, cat:b.t.category, ml:b.s, amt:sl?b.s/1000/sl*m:0}; }),
    cks:cks.map(x=>({name:x.c.name, qty:x.qty, ml:x.ml, amt:ckAmt(x.c,x.qty)})),
    vars:vr, vrT:vrT,
    ckMl:cks.reduce((s,x)=>s+x.ml,0), stMl:stRows.reduce((s,b)=>s+b.s,0),
    plus:D.plus, minus:D.minus,
    low:(function(){ try{ return lowStockList().length; }catch(e){ return 0; } })()
  };
  // ---- shells ----
  const chartCard=(id,title,list)=>{ const tot=totOf(list); return `<div class="card" style="flex:1;min-width:260px"><div class="card-head" style="padding:8px 12px"><h3 style="${SER};color:var(--gold);font-size:12.5px">${title}</h3></div>
    <div class="card-body" style="padding:8px 12px;display:flex;gap:14px;align-items:center">
      <div class="dchart" style="width:128px;height:128px;flex:none"><canvas id="${id}"></canvas><div class="ctr"><b>${fmt(R2(tot))}</b><span>Total ML</span></div></div>
      <div style="flex:1;min-width:0;line-height:2.05">${lg2(list,tot)}</div></div></div>`; };
  const tcard=(ico,title,head,body,foot)=>`<div class="card"><div class="card-head" style="padding:9px 14px"><div><h3 style="font-size:13.5px">${ico} ${title}</h3></div></div>
    <div class="table-wrap" style="max-height:300px;overflow:auto"><table class="tbl"><thead>${head}</thead><tbody>${body||'<tr><td colspan="9" class="center muted" style="padding:12px">No data</td></tr>'}${foot||''}</tbody></table></div></div>`;
  const tot=(cells)=>`<tr style="background:var(--gold-dim);font-weight:700">${cells}</tr>`;
  return `<div class="rptc">
    ${letterhead('Dashboard')}
    <div class="page-head" style="margin-bottom:8px"><div><h1 style="font-size:18px">Dashboard</h1><p style="font-size:11px">${periodBar(true)}</p></div>
      <div class="page-actions">
        <select class="input" style="width:auto;padding:6px 9px;font-size:12px" title="Dashboard design" onchange="setDbLook(this.value)">
          ${DBLOOKS.map(o=>`<option value="${o[0]}" ${_dbLook===o[0]?'selected':''}>${o[1]}</option>`).join('')}
        </select>
        ${(function(){ let low=[]; try{ low=lowStockList(); }catch(e){} return low.length?`<button class="btn btn-sm" style="border-color:var(--red);color:var(--red)" onclick="dbLowModal()">🚨 Low stock (${low.length})</button>`:''; })()}
        <button class="btn btn-sm" style="border-color:#25d366;color:#25d366" onclick="waReport()">🟢 WhatsApp Report</button>
        <button class="btn btn-sm" onclick="window.print()">🖨️ Print</button></div></div>
    ${_dbLook!=='def' ? dbRoyalHead(_dbLook,DBX) : `
    <div class="exgrid">
      ${(function(){ const L=lrTotals(); const b=v=>fmt(Math.round(v*100)/100);
        // cocktail / straight consumption — straight from the linking engine (same numbers as the Tally Sheet)
        const GT=calcGrandTotals();
        const ckAmtT=cks.reduce((s,x)=>s+ckAmt(x.c,x.qty),0);
        const stAmtT=stRows.reduce((s,x)=>{ const sl=sizeOf(x.t.name)||0;
          return s+(sl ? x.s/1000/sl*landOf(rawNameFor(x.t.name)||x.t.name) : 0); },0);
        return [
        ['🍹','Total Cocktail Consumption', fmt(R2(GT.totalC))+' <span>ML</span>', 'Value : ₹ '+fmt(R2(ckAmtT)), '#8b5cf6'],
        ['🥃','Total Straight Consumption', fmt(R2(GT.totalS))+' <span>ML</span>', 'Value : ₹ '+fmt(R2(stAmtT)), '#4f8cff'],
        ['🏬','Liquor Room Opening', '₹ '+fmt(R2(L.opV)), fmt(R2(L.opMl))+' ML · '+b(L.op)+' btl', '#f0a73b'],
        ['📥','Liquor Room Received', '₹ '+fmt(R2(L.rvV)), fmt(R2(L.rvMl))+' ML · '+b(L.rv)+' btl', '#25c685'],
        ['📤','Liquor Room Issued', '₹ '+fmt(R2(L.isV)), fmt(R2(L.isMl))+' ML · '+b(L.is)+' btl', '#38bdf8'],
        ['🍷','Liquor Room Closing', '₹ '+fmt(R2(L.clV)), fmt(R2(L.clMl))+' ML · '+b(L.cl)+' btl', '#ec4899'],
      ].map(x=>`<div class="extile"><div class="ic" style="background:${x[4]}1f;border:1px solid ${x[4]}55">${x[0]}</div>
        <div style="min-width:0"><div class="l">${x[1]}</div><div class="v">${x[2]}</div><div class="sub">${x[3]}</div></div></div>`).join(''); })()}
    </div>
    <div class="card" style="margin-bottom:8px"><div class="card-head" style="padding:8px 14px"><h3 style="${SER};color:var(--gold);font-size:12.5px">🔗 Beverage Control Summary</h3>
      <button class="btn btn-sm" onclick="go('barinv')">View Beverage Control</button></div>
      <div class="bflow">
        ${[
          ['🍾','Opening', fmt(R2(openMl))+' ML', '₹ '+fmt(R2(D.tot.open)), '#4f8cff',''],
          ['📥','Received', fmt(R2(recMl))+' ML', '₹ '+fmt(R2(D.tot.rec)), '#25c685',''],
          ['🥃','Consumption', fmt(R2(consMl))+' ML', '₹ '+fmt(R2(D.tot.cons)), '#f0a73b',''],
          ['🌙','Closing', fmt(R2(closeMl))+' ML', '₹ '+fmt(R2(D.tot.close)), '#8b5cf6',''],
          ['⚖️','Variance', (varMl>0?'+':'')+fmt(R2(varMl))+' ML', '₹ '+fmt(R2(D.tot.varv)), varMl>=0?'#25c685':'#f0776d', varMl>=0?'var(--green)':'var(--red)'],
          ['💰','Stock Value', '₹ '+fmt(R2(D.tot.close)), 'closing stock', '#e8c94b',''],
        ].map((s,i,arr)=>`<div class="stp"><div class="ic" style="background:${s[4]}1f;border:1px solid ${s[4]}55">${s[0]}</div>
            <div class="l">${s[1]}</div><div class="v"${s[5]?` style="color:${s[5]}"`:''}>${s[2]}</div><div class="r">${s[3]}</div></div>${i<arr.length-1?'<div class="arr">→</div>':''}`).join('')}
      </div></div>
    <div class="rptcharts" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      ${chartCard('dbC1','🧭 Category Consumption (ML)',CD.all)}
      ${chartCard('dbC2','🥃 Straight — category wise (ML)',CD.st)}
      ${chartCard('dbC3','🍹 Cocktail — category wise (ML)',CD.ck)}
    </div>`}
    <div class="card asst asstmin noprint" style="margin-bottom:8px">
      <div class="card-body">
        <div class="amhead">
          <h3>Smart Assistant</h3>
          <div class="ameta"><span class="dot" style="${navigator.onLine?'':'background:var(--red)'}"></span>${navigator.onLine?'ONLINE':'NO INTERNET'} · ${typeof aiOn==='function'&&aiOn()?(aiCfg().prov==='anthropic'?'CLAUDE':'CHATGPT'):'LOCAL ANSWERS'} · ${tallyItems.length} BRANDS · ${rawData.length} ITEMS<span id="asstMs">${_asstMs?' · '+_asstMs+' MS':''}</span>
            <button class="btn btn-sm" onclick="asstClear()" title="Clear the chat">🗑 Clear</button></div>
        </div>
        <div id="asstLog" class="alog">${asstRender()}</div>
        <div class="amin"><span class="sp">✦</span>
          <input id="asstQ" placeholder="Ask about any item or total…" onkeydown="if(event.key==='Enter')asstAsk()">
          <button class="amic" id="asstMic" onclick="asstMic()" title="Ask by voice — needs a microphone and the internet">🎤</button><button class="asend" onclick="asstAsk()" title="Ask">➤</button></div>
        <div class="amrow">${[['top','🏆','Top Brands','Best selling'],['ck','🍹','Top Cocktails','Most popular'],
            ['low','🚨','Low Stock','Running low'],['varr','⚖️','Variance','Plus / minus'],['tot','Σ','Totals','Overall'],
            ['stock','💰','Stock Value','Current value'],['pur','📦','Purchases','Recent buys']]
            .map(c=>`<button onclick="asstQuick('${c[0]}')"><b>${c[1]} ${c[2]}</b><span>${c[3]}</span></button>`).join('')}</div>
        <div class="amfoot"><span>Period <b>${esc(period.from)} → ${esc(period.to)}</b></span>
          <span>Try <b>“carlsberg stock”</b></span><span>Try <b>“negative variance”</b></span>
          <span>Bengali works — <b>“মোট বিক্রি”</b></span><span>Press <b>🎤</b> to speak</span></div>
      </div></div>
    <div class="grid-2" style="gap:10px">
      ${tcard('🏆','Top 15 Cocktails — High & Low',
        '<tr><th style="width:34px">#</th><th>Cocktail</th><th class="right">Qty</th><th class="right">ml</th></tr>', ckHL)}
      ${tcard('🎖️','Top 15 Straight — High & Low',
        '<tr><th style="width:34px">#</th><th>Brand</th><th>Category</th><th class="right">ml</th></tr>', stHL)}
      ${tcard('🏬','Liquor Room — Closing Stock',
        '<tr><th>Item</th><th class="right">Closing</th><th class="right">Amount ₹</th></tr>',
        lrBody,
        tot(`<td>TOTAL</td><td></td><td class="num gold">₹ ${fmt(R2(lrT))}</td>`))}
      ${tcard('⚖️','Inventory Variance — Item · Btl · ml · ₹',
        '<tr><th>Item</th><th class="right">± Btl/Pcs</th><th class="right">± ml</th><th class="right">Variance</th><th class="right">Amount ₹</th></tr>',
        vrBody,
        tot(`<td>TOTAL</td><td></td><td></td><td></td><td class="num" style="color:${vrT>=0?'var(--green)':'var(--red)'}">₹ ${fmt(R2(vrT))}</td>`))}
    </div>
  </div>`;
};
AFTER.dashboard = () => {
  if(typeof Chart==='undefined') return;
  if(!$('#dbC1')) return;                    // royal looks draw their own CSS charts — no canvases
  const mk=(id,cfgc)=>{ const el=$('#'+id); if(el) CHARTS.push(new Chart(el,cfgc)); };
  const noleg={plugins:{legend:{display:false}},responsive:true,maintainAspectRatio:false};
  const CD=dbCatData();   // same source as the view's legends — slice order always matches
  const donut=(id,list)=>mk(id,{type:'doughnut',data:{labels:list.map(x=>x.cat),
    datasets:[{data:list.map(x=>Math.round(x.v)),backgroundColor:DBVIVID.slice(0,list.length),
    borderColor:'#161a23',borderWidth:2}]},options:{...noleg,cutout:'66%'}});
  donut('dbC1',CD.all); donut('dbC2',CD.st); donut('dbC3',CD.ck);
};
function dbLowModal(){
  const low=lowStockList();
  const rows=low.map(x=>`<div class="flex between" style="padding:5px 0;border-bottom:1px solid var(--border-soft);font-size:12px;gap:8px">
    <span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(x.name)} <span class="muted" style="font-size:10px">· ${esc(x.cat)}</span></span>
    <span class="nowrap"><span class="pill ${x.status==='OUT'?'red':'amber'}" style="font-size:10px">${x.status}</span> ${fmt(x.closing)} ${x.u}</span></div>`).join('')
    ||'<p class="muted center" style="padding:12px">All stocked ✔</p>';
  modal('🚨 Low / Out of Stock', `<div style="max-height:340px;overflow:auto">${rows}</div>`,
    `<button class="btn" onclick="closeModal()">Close</button>`);
}

/* ============================================================
   MONTH CLOSE — snapshot → history, carry Closing→Opening
   (bar + liquor room), clear the month. Mappings/formulas stay.
   ============================================================ */
/* Closing report bundle — the 4 month-end sheets (Beverage Control · Liquor Room ·
   Received · MR Detail) in one download: Excel (4 sheets) / CSV / print-PDF.
   Computed live for the running month; archived inside each month snapshot at close. */
const CLOSE_RPTS=['bev','lroom','recv','mrd'];
function closingAoas(){ return CLOSE_RPTS.map(id=>({id, name:(REPORTS.find(r=>r.id===id)||{name:id}).name, aoa:reportAoa(id)})); }
var _closePack=null;
function closingReports(mid){
  if(mid){ const m=bls('months',[]).find(x=>x.id===mid); if(!m) return;
    _closePack={packs:m.aoas||null, label:m.period.from+'_'+m.period.to}; }
  else _closePack={packs:closingAoas(), label:period.from+'_'+period.to};
  modal('📊 Closing Reports', `<p style="font-size:12.5px"><strong>${esc(_closePack.label.replace('_',' → '))}</strong></p>
    <p class="muted" style="font-size:11.5px;margin-top:4px">Beverage Control · Liquor Room · Purchase · Bar Stock Issue — the whole bundle in one file:</p>`,
    `<button class="btn" onclick="closeModal()">Close</button>
     <button class="btn btn-sm" onclick="closingGo('csv')">⤓ CSV</button>
     <button class="btn btn-sm" onclick="closingGo('pdf')">🖨 PDF</button>
     <button class="btn btn-gold btn-sm" onclick="closingGo('xlsx')">📊 Excel</button>`);
}
function closingGo(kind){ if(_closePack) closingPack(_closePack.packs,_closePack.label,kind); }
function closingPack(packs,label,kind){
  if(!packs||!packs.length){ toast('No reports stored','This month was closed before closing-reports existed — restore it, then use 📊 Closing Reports live','err'); return; }
  if(kind==='xlsx'){
    if(typeof XLSX==='undefined'){ toast('Reader not loaded','Reload the page','err'); return; }
    const wb=XLSX.utils.book_new();
    packs.forEach(p=>XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(p.aoa), (p.name||p.id).replace(/Report/i,'').trim().slice(0,28)||p.id));
    XLSX.writeFile(wb,'Closing_'+label+'.xlsx'); toast('Exported','Closing bundle → Excel (4 sheets)','ok'); return; }
  if(kind==='csv'){
    const txt=packs.map(p=>_aoaCSV(p.aoa)).join('\r\n\r\n');
    _dlBlob('Closing_'+label+'.csv',txt,'text/csv;charset=utf-8'); toast('Exported','Closing bundle → CSV','ok'); return; }
  // pdf — print-friendly window (Save as PDF from the browser's print dialog)
  _printWin(packs, label, 'MONTH CLOSING REPORTS');
}
/* Serif-gold print window shared by the closing bundle AND the per-page 🖨 Print buttons */
function _printWin(packs,label,title){
  const e2=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const secs=packs.map(p=>{ const cols=p.aoa[3]||[]; const data=p.aoa.slice(4);
    const body=data.map(r=> r.length===1
      ? `<tr class="g"><td colspan="${cols.length||1}">${e2(r[0])}</td></tr>`
      : `<tr${String(r[0])==='TOTAL'?' class="t"':''}>${r.map((c,i)=>`<td class="${i>=2?'n':''}">${e2(c)}</td>`).join('')}</tr>`).join('');
    return `<h2>${e2(p.name)}</h2><table><thead><tr>${cols.map(c=>`<th>${e2(c)}</th>`).join('')}</tr></thead><tbody>${body||'<tr><td>No data</td></tr>'}</tbody></table>`; }).join('');
  const w=window.open('','_blank'); if(!w){ toast('Popup blocked','Allow popups to print the PDF','err'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e2(title)} ${e2(label)}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;margin:14px}
    .bhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;
      border-bottom:2.5px double #b5832e;padding-bottom:5px;margin-bottom:3px}
    .bhead .co{font-size:15px;font-weight:700;letter-spacing:.6px;text-transform:uppercase}
    .bhead .rt{font-size:11px;color:#8a6d3b;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap}
    .sub{display:flex;justify-content:space-between;font-size:9px;color:#777;margin-bottom:10px}
    h2{font-size:11.5px;letter-spacing:.8px;text-transform:uppercase;color:#5c4a28;
      border-bottom:1.5px solid #b5832e;padding-bottom:2px;margin:14px 0 5px}
    table{width:100%;border-collapse:collapse;font-size:9px;page-break-inside:auto}
    tr{page-break-inside:avoid} thead{display:table-header-group}
    th{background:#f3ead6;border:1px solid #d8c9a5;padding:3px 5px;text-align:left;font-size:8.5px;
      letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}
    td{border:1px solid #e7dfcc;padding:2px 5px} td.n{text-align:right;font-variant-numeric:tabular-nums}
    tbody tr:nth-child(even) td{background:#fbf8f1}
    tr.g td{background:#f6efdd;font-weight:700;border-top:1.5px solid #d8c9a5}
    tr.t td{background:#f3ead6;font-weight:700;border-top:1.5px solid #b5832e}
    @page{margin:10mm}</style></head><body>
    ${(function(){ try{ return letterheadHTML(title); }catch(e){
      return `<div class="bhead"><span class="co">${e2((typeof cfg!=='undefined'&&cfg.company)||'Bar')}</span><span class="rt">${e2(title)}</span></div>
        <div class="sub"><span>Period: ${e2(label.replace('_',' to '))}</span><span>Generated ${e2(new Date().toLocaleString())}</span></div>`; } })()}
    ${secs}<script>window.onload=function(){window.print();}<\/script></body></html>`);
  w.document.close();
}
/* One-click clean print for a single sheet (Received / Liquor Room / MR Detail / Beverage Control) */
function printSheet(id){
  const name=(REPORTS.find(r=>r.id===id)||{name:id}).name;
  _printWin([{id, name, aoa:reportAoa(id)}], period.from+'_'+period.to, name.toUpperCase());
}
function monthClose(){
  confirmAsk(`Close month <strong>${period.from} → ${period.to}</strong>?<br><span class="muted" style="font-size:11.5px">Snapshot + closing reports → history · Closing→Opening carries · POS/MR/Received clear for the new month.</span>`, ()=>{
    const {totalC,totalS}=calcGrandTotals(); let D=null; try{ D=biRoyalData(); }catch(e){}
    let aoas=null; try{ aoas=closingAoas(); }catch(e){}
    const months=bls('months',[]); const mid='m'+Date.now();
    months.unshift({ id:mid, ts:new Date().toLocaleString(), period:{...period},
      tot:{ml:Math.round(totalC+totalS), c:Math.round(totalC), s:Math.round(totalS), sale:D?Math.round(D.tot.sale):0, varv:D?Math.round(D.tot.varv):0},
      aoas:aoas,
      data:{ inv:JSON.parse(JSON.stringify(invData)), recv:receivedStock, mr:mrDetail, pos:posData } });
    if(months.length>18) months.length=18;
    try{ bsv('months',months); }catch(e){ toast('Storage full','Delete an old month from History first','err'); return; }
    const lrNew={}; rawData.forEach(r=>{ lrNew[norm(r.item)]=fnum(invGet(r.item).lrOpen)+receivedForItem(r.item)-issuedForItem(r.item); });
    const nd=JSON.parse(JSON.stringify(invData));
    Object.keys(nd).forEach(k=>{ const e=nd[k];
      if(e.closeBL!=null && e.closeBL!==''){ e.openBL=e.closeBL; }
      e.closeBL=''; delete e.consOverride; delete e.varOverride; delete e.saleOverride; });
    Object.keys(lrNew).forEach(k=>{ (nd[k]=nd[k]||{}).lrOpen=lrNew[k]; });
    invData=nd; bsv('inv',invData);
    receivedStock=[]; bsv('recv',receivedStock);
    mrDetail=[]; bsv('mr',mrDetail);
    posData=[]; bsv('pos',posData);
    closeModal(); route(); toast('Month closed','Snapshot archived · Opening carried · new month ready','ok');
    setTimeout(()=>closingReports(mid),200);   // offer the closing bundle right away
  });
}
function openMonths(){
  const ms=bls('months',[]);
  const rows=ms.map(m=>`<div class="flex between items-center" style="padding:9px 0;border-bottom:1px solid var(--border-soft);gap:10px">
      <div style="min-width:0"><strong>${m.period.from} → ${m.period.to}</strong>
        <div class="muted" style="font-size:11px">closed ${esc(m.ts)} · ${fmt(m.tot.ml)} ml · ₹${fmt(m.tot.sale)} · var ₹${fmt(m.tot.varv)}</div></div>
      <div class="nowrap" style="flex:none">
        <button class="btn btn-sm" title="Closing reports — Excel / CSV / PDF" onclick='closingReports("${m.id}")'>📊</button>
        <button class="btn btn-sm" title="Export snapshot" onclick='exportMonth("${m.id}")'>⬇</button>
        <button class="btn btn-gold btn-sm" title="Restore" onclick='restoreMonth("${m.id}")'>♻</button>
        <button class="btn btn-danger btn-sm" onclick='delMonth("${m.id}")'>🗑</button>
      </div></div>`).join('')||'<p class="muted center" style="padding:14px">No closed months yet.</p>';
  modal('🗂 Month History', `<div style="max-height:340px;overflow:auto">${rows}</div>`,
    `<button class="btn" onclick="closeModal()">Close</button>`);
}
function exportMonth(id){ const m=bls('months',[]).find(x=>x.id===id); if(m) _dlText('BLIS_month_'+m.period.from+'_'+m.period.to+'.json', JSON.stringify(m)); }
function restoreMonth(id){
  const m=bls('months',[]).find(x=>x.id===id); if(!m) return;
  confirmAsk(`Restore <strong>${m.period.from} → ${m.period.to}</strong>? Current entries will be replaced by that snapshot.`, ()=>{
    invData=JSON.parse(JSON.stringify(m.data.inv||{})); bsv('inv',invData);
    receivedStock=m.data.recv||[]; bsv('recv',receivedStock);
    mrDetail=m.data.mr||[];       bsv('mr',mrDetail);
    posData=m.data.pos||[];       bsv('pos',posData);
    period={...m.period};         bsv('period',period);
    closeModal(); route(); toast('Restored',m.period.from+' → '+m.period.to,'ok');
  });
}
function delMonth(id){ confirmAsk('Delete this archived month?', ()=>{ bsv('months', bls('months',[]).filter(x=>x.id!==id)); closeModal(); openMonths(); }); }

/* ============================================================
   BARCODE SCAN (Received) — USB/Bluetooth keyboard-wedge scanner:
   focus the box, scan → +1 received today. Unknown code → map once.
   ============================================================ */
let barcodes = bls('barcodes', {});
function bcScan(code){
  code=String(code||'').trim(); if(!code) return;
  const item=barcodes[code];
  if(item && inRaw(item)){ bcAddEntry(item); return; }
  modal('📷 New barcode', `<p style="font-size:12.5px">Barcode <strong>${esc(code)}</strong> is not mapped yet. Pick its Item Master entry:</p>
    <input class="input" id="bcItem" list="rawItems" placeholder="Item name…" style="width:100%;margin-top:8px">${rawNamesDatalist()}`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-gold" onclick='bcSave(${jatt(code)})'>💾 Save &amp; add 1</button>`);
  setTimeout(()=>{ const el=$('#bcItem'); if(el) el.focus(); },60);
}
function bcSave(code){
  const item=($('#bcItem')&&$('#bcItem').value.trim()); if(!item){ toast('Pick item','Type/pick the Item Master entry','err'); return; }
  barcodes[code]=item.toUpperCase(); bsv('barcodes',barcodes); closeModal(); bcAddEntry(barcodes[code]);
}
function bcAddEntry(item){
  const today=new Date().toISOString().slice(0,10);
  const ex=receivedStock.find(r=>norm(r.item)===norm(item)&&r.date===today);
  if(ex){ ex.qty=fnum(ex.qty)+1; } else { const g=findRaw(item); receivedStock.push({date:today,item:item,qty:1,group:g?g.group:''}); }
  bsv('recv',receivedStock); route(); toast('Scanned','+1 '+item,'ok');
  setTimeout(()=>{ const b=$('#bcBox'); if(b) b.focus(); },80);
}

/* ============================================================
   🧾 BEVCO INVOICE IMPORT — upload the WBSBCL PDF; the app reads
   it (FlateDecode text extraction, no library), parses every line
   item + fees, auto-calculates the totals chain, maps items to
   Raw Data, then adds Received entries + MRPs + invoice register.
   ============================================================ */
let invoices = bls('invoices', []);
let bevMap   = bls('bevmap', {});   // BEVCO invoice name → YOUR Raw-Data name, learned once, remembered forever
async function _pdfText(buf){
  const bytes=new Uint8Array(buf); const CH=32768;
  let s=''; for(let i=0;i<bytes.length;i+=CH){ s+=String.fromCharCode.apply(null, bytes.subarray(i,Math.min(i+CH,bytes.length))); }
  let out='', prevText=null;
  /* Walk every "stream" keyword that is NOT the tail of "endstream". The old /stream\r?\n/g regex
     matched inside "endstream\r\n" too, so after the first object it locked onto garbage, failed to
     inflate, and skipped every following object — a two-page invoice lost its second page (the one
     with Special Purpose Fee, T.C.S. and the Total), and three September invoices came out ₹16,137
     short of BEVCO's own ledger (v2.35.1). */
  let pos=0;
  while(true){
    const at=s.indexOf('stream',pos); if(at<0) break;
    if(s.slice(Math.max(0,at-3),at)==='end'){ pos=at+6; continue; }
    const nl=(s[at+6]==='\r')?(s[at+7]==='\n'?2:1):(s[at+6]==='\n'?1:0);
    if(!nl){ pos=at+6; continue; }
    const m={index:at, 0:'stream'+s.slice(at+6,at+6+nl)};
    const start=at+6+nl; const end=s.indexOf('endstream',start); if(end<0) break;
    pos=end+9;
    // Prefer the exact byte count the PDF itself declares (<< /Length N >> just before "stream"):
    // trimming whitespace up to "endstream" is a guess, and the zlib checksum can legitimately
    // END in 0x0a — invoice (37) did, the guess ate that byte, and every stream failed to decode.
    let sub=null;
    { const head=s.slice(Math.max(0,m.index-400), m.index); const d=head.lastIndexOf('<<');
      const lm = d>=0 ? /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(head.slice(d)) : null;
      const n = lm ? +lm[1] : 0; if(n>0 && start+n<=end) sub=bytes.subarray(start,start+n); }
    let end2=end;                                    // strip trailing \r\n/space before "endstream" —
    while(end2>start && (bytes[end2-1]===0x0d||bytes[end2-1]===0x0a||bytes[end2-1]===0x20)) end2--;
    if(!sub) sub=bytes.subarray(start,end2);         //  the strict browser decoder rejects trailing junk
    let dec=null;
    try{ dec=await new Response(new Blob([sub]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(); }
    catch(e){ // raw deflate = zlib body without its 2-byte header and 4-byte Adler trailer; then the looser form
      try{ dec=await new Response(new Blob([sub.subarray(2,Math.max(2,sub.length-4))]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(); }
      catch(e2){ try{ dec=await new Response(new Blob([sub.subarray(2)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(); }catch(e3){} } }
    if(dec){
      const u=new Uint8Array(dec); let t='';
      for(let i=0;i<u.length;i+=CH){ t+=String.fromCharCode.apply(null,u.subarray(i,Math.min(i+CH,u.length))); }
      // a BEVCO PDF carries each page twice in a row (byte-identical copies) — keep one, so a
      // two-page invoice reads as page 1 → page 2, not page 1 → page 1 → page 2 (items would double)
      if(/\b(Tj|TJ|BT)\b/.test(t) && t!==prevText){ out+=t+'\n'; prevText=t; }
    }
  }
  let txt=''; const rx=/\((?:[^()\\]|\\.)*\)\s*Tj|\[(?:[^\[\]\\]|\\.)*\]\s*TJ|T\*|Td|TD|ET/g; let mm;
  while((mm=rx.exec(out))){
    const tk=mm[0];
    if(/Tj$/.test(tk)){ txt+=tk.slice(1,tk.lastIndexOf(')')).replace(/\\([()\\])/g,'$1'); }
    else if(/TJ$/.test(tk)){ const inner=tk.slice(1,tk.lastIndexOf(']')); const pr=/\((?:[^()\\]|\\.)*\)/g; let p;
      while((p=pr.exec(inner))) txt+=p[0].slice(1,-1).replace(/\\([()\\])/g,'$1'); }
    else txt+='\n';
  }
  return txt;
}
function bevcoParse(txt){
  const lines=txt.split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const full=lines.join('\n');
  const num=v=>{ const n=+String(v==null?'':v).replace(/,/g,''); return isFinite(n)?n:0; };
  const inv={no:'',date:'',items:[],fees:{rebate:0,spf:0,roundGovt:0,tcsPct:2,tcs:0,roundOff:0,total:0,bots:0}};
  let m=full.match(/Invoice No\s*\n?\s*([\w\/\-]+)/); if(m) inv.no=m[1];
  m=full.match(/Dated\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/); if(m){ const d=m[1].split('/'); inv.date=d[2]+'-'+d[1]+'-'+d[0]; }
  let i=lines.indexOf('Amount (Rs.)');
  if(i>=0){ i++;
    let pend=[];                                       // buffers name lines (long names wrap to 2+ lines)
    while(i<lines.length){
      const L=lines[i];
      if(/^(Less Rebate|Special Purpose Fee|Amount Chargeable|Round Off value|T\.C\.S\.)/.test(L)) break;
      if(L==='Amount (Rs.)'){ pend=[]; i++; continue; }   // a continuation page repeats the table header — start the name buffer afresh
      const isNum=/^[\d,]+\.?\d*$/.test(L);
      if(!isNum){ pend.push(L); if(pend.length>3) pend.shift(); i++; continue; }
      const cb=lines[i+2]||'';                          // numeric run: mrp, mrpVal, case-bot, alt, amount
      if(/^\d+-\d+$/.test(cb) && pend.length){
        inv.items.push({ name:pend.join(' ').replace(/\s{2,}/g,' ').replace(/\s+,/,','),
          mrp:num(L), mrpVal:num(lines[i+1]), caseBot:cb, bots:num(lines[i+3]), amount:num(lines[i+4]) });
        pend=[]; i+=5; continue;
      }
      i++;                                              // stray subtotal number
    }
  }
  m=full.match(/Less Rebate\s*:\s*\n?([\d,]+\.\d+)?/);            if(m&&m[1]) inv.fees.rebate=num(m[1]);
  m=full.match(/Special Purpose Fee\s*:\s*\n?([\d,]+\.\d+)/);     if(m) inv.fees.spf=num(m[1]);
  m=full.match(/Round Off value[^\n]*\n([\d,]+\.\d+)/);           if(m) inv.fees.roundGovt=num(m[1]);
  m=full.match(/T\.C\.S\.[\s\S]{0,30}?([\d.]+)\s*\n?%\s*\n?([\d,]+(?:\.\d+)?)/); if(m){ inv.fees.tcsPct=+m[1]; inv.fees.tcs=num(m[2]); }
  m=full.match(/Rounded Off\s*\n([\d,]+\.\d+)/);                  if(m) inv.fees.roundOff=num(m[1]);
  m=full.match(/Total:-\s*\n(\d+)\s*\n([\d,]+)/);                 if(m){ inv.fees.bots=+m[1]; inv.fees.total=num(m[2]); }
  // ---- auto-calculation chain (mirrors the BEVCO format) ----
  const base=inv.items.reduce((a,x)=>a+x.amount,0);
  const preTcs=base-(inv.fees.rebate||0)+inv.fees.spf+inv.fees.roundGovt;
  const tcs=Math.round(preTcs*(inv.fees.tcsPct||2))/100;
  const gross=Math.round((preTcs+tcs)*100)/100;
  inv.calc={ base:Math.round(base*100)/100, tcs:tcs, gross:gross,
    total:Math.round(gross), roundOff:Math.round(Math.abs(gross-Math.round(gross))*100)/100,
    bots:inv.items.reduce((a,x)=>a+x.bots,0) };
  // any fee the PDF text didn't yield cleanly → adopt the auto-calculated value
  if(!inv.fees.tcs)      inv.fees.tcs=inv.calc.tcs;
  if(!inv.fees.roundOff) inv.fees.roundOff=inv.calc.roundOff;
  if(!inv.fees.total)    inv.fees.total=inv.calc.total;
  if(!inv.fees.bots)     inv.fees.bots=inv.calc.bots;
  return inv;
}
/* ---- BEVCO name ↔ Item Master smart matching (v2.33.0) ----
   BEVCO prints the official product name ("Johnnie Walker Black Label Blended Scotch Whisky, 750 Ml.")
   while the Item Master keeps the house short name ("J.W.BLACK LABEL 750 ML"). The old strip-fuzzy
   matched 6 of the 64 names on the client's September invoices, so every other line had to be typed —
   or was left blank and became a raw BEVCO-named item under "BEVCO IMPORT". This matcher tokenises
   both sides, weights each token by how rare it is in the Item Master (IDF), tolerates spelling slips
   (HOEGAARDEN/HOEGARDEN, SMRINOFF, CARLSBARG), refuses a different bottle size or kind of drink, and is
   honest about confidence: sure (auto) · guess (amber — please check) · none (→ a NEW item is created). */
const BEV_KINDS={WHISKY:'WHISKY',SCOTCH:'WHISKY',BOURBON:'WHISKY',RUM:'RUM',VODKA:'VODKA',GIN:'GIN',BEER:'BEER',LAGER:'BEER',PILSNER:'BEER',ALE:'BEER',WITBIER:'BEER',
  WINE:'WINE',SPARKLING:'WINE',PROSECCO:'WINE',SHIRAZ:'WINE',CABERNET:'WINE',CHENIN:'WINE',CHARDONNAY:'WINE',MERLOT:'WINE',SAUVIGNON:'WINE',ZINFANDEL:'WINE',SOJU:'WINE',
  BRUT:'WINE',CHAMPAGNE:'WINE',CAVA:'WINE',MOSCATO:'WINE',RIESLING:'WINE',MALBEC:'WINE',PINOT:'WINE',GRIGIO:'WINE',SYRAH:'WINE',STOUT:'BEER',WHEAT:'BEER',   // (v2.47.0) Chandon Brut → a WINE group, not BEVCO IMPORT
  BRANDY:'BRANDY',COGNAC:'BRANDY',TEQUILA:'LIQ',LIQUEUR:'LIQ',ABSENTA:'LIQ',ABSINTHE:'LIQ'};
const BEV_FLUFF=new Set(['PREMIUM','LAGER','BLENDED','SCOTCH','ORIGINAL','TRIPLE','DISTILLED','FLAVOURED','FLAVOUR','FLAVOR','EXTRA','SUPER','FINEST','DELUXE','THE','SMOOTH','BALANCED','RECIPE','LIMITED','EDITION','GIFT','PACK','INTERNATIONAL','CONTEMPORARY','KENTUCKY','STRAIGHT','TENNESSEE','GRAIN','PREMIER','VATTED','VERY','ORDINARY','WORLD','CUP','FIFA','CLUB','SMALL','BATCH','AGED','OF','AND','IN','A','NEW','EXPERIMENTS','CITY','KING','BEERS','STRONG','SEMI','GERMAN','INDIAN','INDIA','IRISH','LONDON','DRY','SPARKLING','MALT','SINGLE','FIRE','TANGY','SELECT']);
const BEV_PACK=new Set(['CAN','BOTTLE','BTL','PET','NIP','PINT','QUART','KEG','ML']);
const BEV_GENERIC=new Set(['WHISKY','SCOTCH','BOURBON','RUM','VODKA','GIN','BEER','LAGER','PILSNER','ALE','WINE','BRANDY','COGNAC','TEQUILA','LIQUEUR']);   // the bare kind — agrees already, never discriminates; grape varieties (SHIRAZ, CHENIN) DO (v2.47.0)
const BEV_FORM=new Set(['DRAUGHT','DRAFT','KEG','CASK','BEER','LAGER','PREMIUM','STRONG','MILD','LIGHT','BLENDED','SCOTCH','WHISKY','RUM','VODKA','GIN','WINE','BRANDY','TEQUILA','LIQUEUR']);   // form / kind words — a house name's extra one of these is not a different product (v2.47.0)
function bevTokens(s){
  const u=String(s||'').toUpperCase()
    .replace(/JOHNNIE\s+WALKER/g,'J W').replace(/\bJ\.?\s*W\.?(?=[A-Z ])/g,'J W ')
    .replace(/([A-Z])(\d{2,5})\s*ML\b/g,'$1 $2 ML')                                         // GIN750ML → GIN 750 ML (v2.47.0)
    .replace(/JIM\s+BEAM\s+KENTUCKY\s+STRAIGHT\s+BOURBON/g,'JIM BEAM WHITE BOURBON')      // the white label's official name (v2.47.0)
    .replace(/WHISKEY/g,'WHISKY').replace(/\bBIER\b/g,'BEER').replace(/LIQUER\b/g,'LIQUEUR')
    .replace(/(\d)\s*(ML)\b/g,'$1 $2').replace(/\b(\d+)\s*(YO|YRS?|YEARS?|Y)\b/g,'$1 YO')
    .replace(/[’'\x60]/g,'').replace(/!/g,'I');
  return u.split(/[^A-Z0-9%]+/).filter(t=>t && t.indexOf('%')<0);
}
function bevSize(s){ const u=String(s||'').toUpperCase(); const m=u.match(/(\d{2,5})\s*ML\b/); if(m) return +m[1]; const t=u.match(/\b(\d{3,5})\s*$/); return t?+t[1]:0; }   // "… 750 ML", or a trailing bare "… 750" (house names / typed text)
function bevKind(toks){ for(const t of toks){ if(BEV_KINDS[t]) return BEV_KINDS[t]; } return ''; }
function _bevLev(a,b){ if(a===b) return 0; const m=a.length,n=b.length; if(!m||!n) return m||n;
  let prev=Array.from({length:n+1},(_,j)=>j), cur=new Array(n+1);
  for(let i=1;i<=m;i++){ cur[0]=i; for(let j=1;j<=n;j++){ cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); } const t=prev; prev=cur; cur=t; }
  return prev[n]; }
function _bevTokEq(a,b){ if(a===b) return true; if(/^\d/.test(a)||/^\d/.test(b)) return false;
  const L=Math.min(a.length,b.length); if(L<5) return false; const d=_bevLev(a,b); return d<=1 || (L>=7 && d<=2); }
var _bevIdx=null, _bevIdxKey='';
function bevIndex(list){                                   // list: an arbitrary [{item,group}] (no cache) — default: the Item Master (cached)
  const key=rawData.length+':'+_rawIdxVer;
  if(!list && _bevIdx && _bevIdxKey===key) return _bevIdx;
  const df={}; const items=(list||rawData).map(r=>{
    const sz=bevSize(r.item)||bevSize(r.group)||0;
    const toks=[...new Set(bevTokens(r.item).filter(t=>!BEV_PACK.has(t) && !(sz&&t===String(sz))))];
    toks.forEach(t=>df[t]=(df[t]||0)+1);
    let kind=bevKind(toks); if(!kind){ const gk=bevKind(bevTokens(r.group||'')); if(gk && gk!=='GIN' && gk!=='LIQ') kind=gk; }
    return {r, toks, sz, kind}; });
  const N=items.length; const w=t=>{ const d=df[t]||0; return d?Math.log((N+1)/(d+1))+0.15:0; };
  const ix={items, df, N, w}; if(!list){ _bevIdx=ix; _bevIdxKey=key; } return ix;
}
// → {name, group, score, sure, alt}: name='' means "nothing close enough — treat as a new item"
function bevcoMatch(name, opt){
  opt=opt||{}; const ix=bevIndex(opt.list); const szReal=bevSize(name), szB=opt.ignoreSize?0:szReal;
  const B=[...new Set(bevTokens(name).filter(t=>!BEV_PACK.has(t) && !(szReal&&t===String(szReal))))];
  const none={name:'',group:'',score:0,sure:false,alt:'',top:null};
  if(!B.length||!ix.N) return none;
  const kindB=bevKind(B);
  const scored=[];
  ix.items.forEach(it=>{
    if(szB && it.sz && it.sz!==szB) return;                                                // bottle size is law
    if(kindB && it.kind && it.kind!==kindB && !(kindB==='LIQ'||it.kind==='LIQ')) return;   // whisky is not gin
    let cw=0,cm=0, distinct=false, missDistinct=false, uniqHit=false;
    it.toks.forEach(t=>{ const wt=ix.w(t); cw+=wt; const hit=B.some(b=>_bevTokEq(t,b)); const rare=(ix.df[t]||0)<=ix.N/10 && !BEV_GENERIC.has(t) && !BEV_FORM.has(t);
      if(hit){ cm+=wt; if(rare) distinct=true; if(rare && (ix.df[t]||0)<=2 && !/^\d/.test(t)) uniqHit=true; } else if(rare) missDistinct=true; });
    if(!cw||!distinct) return;
    const recall=cm/cw;                                                                     // how much of the house name the BEVCO name explains
    let bw=0,bm=0,bMiss=false; B.forEach(b=>{ if(BEV_FLUFF.has(b)||BEV_GENERIC.has(b)) return; const wt=ix.w(b); if(!wt) return; bw+=wt; if(it.toks.some(t=>_bevTokEq(t,b))) bm+=wt; else if((ix.df[b]||0)<=ix.N/10) bMiss=true; });
    if(missDistinct && uniqHit && recall>=0.6 && !bMiss) missDistinct=false;                 // GENTLEMAN (JACK): a word only this house item has, and nothing in the BEVCO name is left unexplained — the house's extra word is a brand prefix, not another variant (v2.47.0)
    const cover=bw?bm/bw:recall;                                                            // how much of the BEVCO name the house name explains (kind words agree already — not counted, v2.47.0)
    let s=0.65*recall+0.35*cover; if(szB && !it.sz) s*=0.95; if(missDistinct) s*=0.8;      // a sibling variant (WHITE vs LEMON) is not a match
    if(recall>=0.5) scored.push({it,s,cover,missDistinct});
  });
  scored.sort((a,b)=> (Math.abs(b.s-a.s)<0.04 ? b.cover-a.cover : b.s-a.s));
  if(!scored.length) return none;
  const best=scored[0]; const second=scored.find(x=>x.it.r.item!==best.it.r.item); const gap=second?best.s-second.s:1;
  // a sibling variant (the house has WHITE RUM, the invoice says SELECT RUM) may lend its GROUP to a new item but is never offered as the item itself
  const lone=scored.filter(x=>x.it.r.item!==best.it.r.item).length===0;
  const sure=!best.missDistinct && ((best.s>=0.8 && gap>=0.12) || (best.s>=0.9 && gap>=0.06));
  const guess=!best.missDistinct && (best.s>=0.62 || (szB>=5000 && lone && best.s>=0.5));   // a lone keg of the brand at that size is offered (amber — the person confirms once, bevmap remembers) (v2.47.0)
  return { name:guess?best.it.r.item:'', group:best.it.r.group||'', score:Math.round(best.s*100)/100, sure, alt:(second&&second.s>=0.55)?second.it.r.item:'', top:{name:best.it.r.item, group:best.it.r.group||'', score:best.s} };
}
function bevcoMapName(name){ return bevcoMatch(name).name; }   // kept for callers of the old strip-fuzzy
// the house spelling for a brand-new BEVCO item: "Aperol, 750 Ml." → "APEROL 750 ML"
function bevcoCleanName(name){
  return String(name||'').toUpperCase().replace(/!/g,'I').replace(/,\s*(\d{2,5})\s*ML\.?\s*$/,' $1 ML').replace(/\.\s*$/,'').replace(/\s+/g,' ').trim();
}
// the Item Master group a new BEVCO item belongs in — same kind + same size as the client's own groups
// ("IMFL RUM 750 ML", "OS WHISKY 700 ML", "DRAUGHT BEER 50"); a sibling of the same brand at another size
// lends its group; only when nothing fits does it fall back to "BEVCO IMPORT"
function bevcoGuessGroup(name){
  const toks=bevTokens(name), kind=bevKind(toks), sz=bevSize(name);
  const cnt={}; rawData.forEach(r=>{ const g=String(r.group||'').trim(); if(g) cnt[g]=(cnt[g]||0)+1; });
  const groups=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]);
  const swapSize=g=> sz ? (/\d{2,5}\s*ML\b/i.test(g) ? g.replace(/\d{2,5}\s*ML\b/i, sz+' ML') : g+' '+sz+' ML') : g;
  if(sz>=5000){ const L=Math.round(sz/1000); const d=groups.find(g=>/DRAUGHT/i.test(g) && new RegExp('\\b'+L+'\\b').test(g)); return d || 'DRAUGHT BEER '+L; }
  if(kind){
    const isLiq=g=>{ const gt=bevTokens(g); return gt.indexOf('LIQ')>=0||gt.indexOf('LIQUEUR')>=0; };
    let ofKind=groups.filter(g=>{ const gt=bevTokens(g); if(kind==='LIQ') return isLiq(g); if(kind==='GIN') return gt.indexOf('GIN')>=0; return bevKind(gt)===kind; });
    if(kind==='GIN' && ofKind.some(g=>!isLiq(g))) ofKind=ofKind.filter(g=>!isLiq(g));   // a gin goes with the gins, not the tequila/liqueur shelf
    if(ofKind.length){ const same=ofKind.find(g=>bevSize(g)===sz); return same || swapSize(ofKind[0]); }
  }
  const sib=bevcoMatch(name,{ignoreSize:true}).top;
  if(sib && sib.score>=0.4 && sib.group){ const g=sib.group; const same=groups.find(x=>x===swapSize(g)); return same || (bevSize(g)&&sz&&bevSize(g)!==sz ? swapSize(g) : g); }
  return 'BEVCO IMPORT';
}
/* ---- many invoices in one go (v2.30.0) ----
   The picker takes a whole folder of BEVCO PDFs. They are read one after another: each gets the
   same preview + confirm as before (mapping, qty, fee check), and confirming moves straight to
   the next. An invoice whose number is already in the register is skipped, so re-selecting a
   folder never double-counts. Cancel empties the queue. */
var _bevQueue=[];
/* ---- ✅ Add all (v2.33.2) ----
   One click confirms the invoice on screen and every one still queued, exactly as an untouched
   preview would (remembered / sure matches, new items created) — EXCEPT an invoice with an amber
   "? check" line, where the run pauses on its preview so the person decides, then continues. */
var _bevAll=false, _bevAllN=0;
async function bevcoUpload(inp){
  const files=Array.from(inp.files||[]); inp.value=''; if(!files.length) return;
  _bevQueue=files; _bevAll=false; _bevAllN=0;
  toast('Reading…', files.length===1 ? 'Extracting the BEVCO invoice' : files.length+' invoices queued — check the first, then ✅ Add all does the rest', 'ok');
  bevcoNext();
}
function bevcoAddAll(){ _bevAll=true; _bevAllN=0; bevcoConfirm(); }
function bevcoCancelAll(){ _bevQueue=[]; _bevAll=false; closeModal(); }
async function bevcoNext(){
  const f=_bevQueue.shift();
  if(!f){ if(_bevAll){ _bevAll=false; toast('All invoices added', _bevAllN+' invoice'+(_bevAllN===1?'':'s')+' → Purchase · prices updated · new items in Item Master','ok'); } return; }
  let txt='';
  try{ txt=await _pdfText(await f.arrayBuffer()); }catch(e){}
  const inv=bevcoParse(txt||'');
  const dup=inv.no?invoices.find(v=>String(v.no)===String(inv.no)):null;
  const hasEntries=inv.no?receivedStock.some(r=>String(r.inv||'')===String(inv.no)):false;
  let replaced=false;
  if(dup && !hasEntries && inv.items.length){
    /* the register remembers it but the Purchase sheet holds none of its lines (Clear All, or a lost
       copy) — that is a missing invoice, not a duplicate: bring it in again (v2.35.2) */
    invoices=invoices.filter(v=>String(v.no)!==String(inv.no)); bsv('invoices',invoices);
    toast('Bringing it back', 'Invoice '+inv.no+' was in the register but the Purchase sheet had none of its lines — importing it again', 'ok');
  } else if(dup){
    const oldT=(dup.fees&&dup.fees.total)||(dup.calc&&dup.calc.total)||0, newT=inv.fees.total||inv.calc.total||0;
    if(Math.abs(oldT-newT)<0.6 || !inv.items.length){
      toast('Already in the register', 'Invoice '+inv.no+' ('+f.name+') skipped — it was added before', 'ok');
      return bevcoNext();
    }
    /* same invoice, different figures (the v2.35.1 extractor now reads a second page the old one lost):
       the earlier entries and register row go, the fresh reading is shown for confirmation */
    receivedStock=receivedStock.filter(r=>String(r.inv||'')!==String(inv.no)); bsv('recv',receivedStock);
    invoices=invoices.filter(v=>String(v.no)!==String(inv.no)); bsv('invoices',invoices);
    replaced=true;
    toast('Invoice re-read', 'Invoice '+inv.no+' was in the register at ₹'+fmt(oldT)+' — it now reads ₹'+fmt(newT)+'. The old entries were removed; confirm the new reading.', 'ok');
  }
  if(!inv.items.length){
    modal('🧾 BEVCO Invoice — '+esc(f.name), `<p style="font-size:12.5px">Could not auto-read this PDF. Open the PDF, select-all → copy, and paste the text here:</p>
      <textarea class="input" id="bevPaste" style="height:120px;font-size:11px;margin-top:8px"></textarea>`,
      `<button class="btn" onclick="bevcoCancelAll()">Cancel</button>${_bevQueue.length?`<button class="btn" onclick="closeModal();bevcoNext()">Skip this one →</button>`:''}<button class="btn btn-gold" onclick="bevcoFromPaste()">Parse</button>`);
    return;
  }
  inv._file=f.name;
  bevcoPreview(inv);
  if(_bevAll){
    if(document.querySelector('#modalBack .pill.amber')){ toast('Please check this one', 'A line needs a look — confirm it and Add all carries on', 'err'); }
    else if(replaced){ /* a changed reading of a known invoice is always shown, never confirmed blind */ }
    else bevcoConfirm();
  }
}
function bevcoFromPaste(){ const t=($('#bevPaste')&&$('#bevPaste').value)||''; closeModal();
  const inv=bevcoParse(t); if(!inv.items.length){ toast('No items found','Text did not match the BEVCO format','err'); return; } bevcoPreview(inv); }
let _bevInv=null;
function bevcoPreview(inv){
  _bevInv=inv;
  const ok=(a,b)=>Math.abs(a-b)<0.06;
  const chk=(lbl,parsed,calc)=>`<div class="flex between" style="font-size:11.5px;padding:2px 0"><span class="muted">${lbl}</span>
    <span>${fmt(parsed)} ${calc!=null?(ok(parsed,calc)?'<span style="color:var(--green)">✔</span>':`<span style="color:var(--red)" title="auto-calc says ${calc}">⚠ ${fmt(calc)}</span>`):''}</span></div>`;
  // per line: learned mapping (bevmap) → smart match → NEW item. Each state is visible: ✔ known / ? check / ＋ new
  const groupOpts=(sel)=>{ const gs=[...new Set(rawData.map(r=>String(r.group||'').trim()).filter(Boolean))].sort();
    if(sel && gs.indexOf(sel)<0) gs.unshift(sel); return gs.map(g=>`<option ${g===sel?'selected':''}>${esc(g)}</option>`).join(''); };
  let nSure=0,nGuess=0,nNew=0,nBlank=0;
  const grandP=inv.fees.total||inv.calc.total||0, factorP=(inv.calc.base>0&&grandP>0)?grandP/inv.calc.base:1;
  // pre-pass (v2.47.0): resolve every line first so two lines landing on ONE Item Master name can be flagged — BEVCO never
  // lists a product twice on an invoice; two lines on one name are two products (OLD NO. 7 + GENTLEMAN JACK) on one name
  const pre=inv.items.map(x=>{ let learned=bevMap[norm(x.name)]||''; if(learned && !findRawExact(learned)) learned='';   // a remembered name that was since deleted
    const m=learned?null:bevcoMatch(x.name); const mapped=learned||(m&&m.name)||'';
    return {learned, m, mapped, state:learned?'learned':(m&&m.sure?'sure':(mapped?'guess':'new'))}; });
  const shared={}; pre.forEach(p=>{ if(p.mapped) shared[norm(p.mapped)]=(shared[norm(p.mapped)]||0)+1; });
  let nColl=0;
  const rows=inv.items.map((x,i)=>{
    const learned=pre[i].learned, m=pre[i].m, mapped=pre[i].mapped; let state=pre[i].state;
    const coll=!!(mapped && shared[norm(mapped)]>1); if(coll && state!=='new'){ state='coll'; nColl++; }
    const others=coll?inv.items.filter((y,j)=>j!==i && norm(pre[j].mapped)===norm(mapped)).map(y=>y.name):[];
    if(state==='new') nNew++; else if(state==='guess'||state==='coll') nGuess++; else nSure++;
    const clean=bevcoCleanName(x.name), ggrp=bevcoGuessGroup(x.name);
    const landE=Math.round(x.amount*factorP/(x.bots||1)*100)/100;                       // this line's landed rate — offered, never imposed
    const blankPrice=state!=='new' && !(invGet(mapped).land!=null && invGet(mapped).land!=='');
    if(blankPrice) nBlank++;
    const priceBox=`<div id="bevPr${i}" style="margin-top:3px;${(state==='new'||blankPrice)?'':'display:none'}"><span class="muted" style="font-size:10.5px">${state==='new'?'Landing ₹/bot for this new item':'<span style=\"color:var(--amber)\">No landing ₹ in Item Master yet</span> — set it'}</span>
          <input class="cell-input" id="bevLand${i}" style="width:84px;margin-left:4px" value="${landE}" title="Landing ₹ per bottle — the invoice's own landed rate is suggested; what you save here becomes the Item Master rate"></div>`;
    const pill=state==='new'?`<span class="pill red" id="bevSt${i}">＋ new item — rename / pick category</span>`:state==='coll'?`<span class="pill amber" id="bevSt${i}" title="Two products on one name — this line and: ${esc(others.join(' · '))}. Give one of them its own Item Master name${m&&m.alt?' · maybe: '+esc(m.alt):''}">? 2 lines → one name</span>`:state==='guess'?`<span class="pill amber" id="bevSt${i}" title="Best guess — please check${m&&m.alt?' · or: '+esc(m.alt):''}">? check</span>`:`<span class="pill green" id="bevSt${i}">✔ ${state==='learned'?'remembered':'matched'}</span>`;
    return `<tr><td style="font-size:11px">${esc(x.name)} ${pill}
        <div style="margin-top:3px;display:flex;gap:6px;align-items:center"><input class="cell-input bmap ${(state==='guess'||state==='coll')?'bmap-guess':state==='new'?'bmap-new':''}" style="text-align:left;flex:1" list="rawItems" id="bevMap${i}" value="${esc(state==='new'?clean:mapped)}" placeholder="↳ Item Master name (blank = new item: ${esc(clean)})" oninput="bevMapEdit(${i})"></div>
        <div id="bevNew${i}" style="margin-top:3px;${state==='new'?'':'display:none'}"><span class="muted" style="font-size:10.5px">New in Item Master + Liquor Room under the name above · category</span>
          <select class="input" id="bevGrp${i}" style="width:auto;padding:2px 6px;font-size:11px;margin-left:4px" onchange="bevGrpPick(${i})">${groupOpts(ggrp)}<option value="__new__">＋ New category…</option></select>
          <input class="cell-input" id="bevGrpNew${i}" style="display:none;width:170px;text-align:left;margin-left:4px" placeholder="e.g. IMFL WHISKY 750 ML"></div>${priceBox}</td>
      <td class="num">₹${fmt(x.mrp)}</td><td class="num"><input class="cell-input" style="width:44px" id="bevQty${i}" value="${x.bots}"></td>
      <td class="num muted" style="font-size:10.5px">${esc(x.caseBot)}</td><td class="num gold">₹${fmt(x.amount)}</td></tr>`; }).join('');
  const sum=[nSure?`<span style="color:var(--green)">${nSure} matched</span>`:'', nGuess?`<span style="color:var(--amber)">${nGuess} to check${nColl?' ('+nColl+' share one name)':''}</span>`:'', nNew?`<span style="color:var(--red)">${nNew} new → Item Master</span>`:''].filter(Boolean).join(' · ');
  modal('🧾 BEVCO Invoice — '+esc(inv.no||''),
    `${nNew?`<div style="border:1px solid var(--red);background:var(--red-dim);border-radius:10px;padding:8px 12px;margin-bottom:8px;font-size:12px"><strong style="color:var(--red)">⚠ ${nNew} new product${nNew>1?'s':''} on this invoice</strong> — not in your Item Master yet. Check the name (rename it the way you write it) and pick the category on the red line${nNew>1?'s':''} below; on confirm ${nNew>1?'they are':'it is'} added to the Item Master and the Liquor Room.</div>`:''}<div class="muted" style="font-size:11.5px;margin-bottom:8px">Dated <strong>${esc(inv.date||'—')}</strong> · ${inv.items.length} items · ${sum}<br>On confirm: items → Purchase · new names → Item Master automatically · <strong>prices already set in Item Master are never changed by an invoice</strong>${nBlank?' · <span style="color:var(--amber)">'+nBlank+' item'+(nBlank>1?'s have':' has')+' no landing ₹ yet — set below</span>':''}</div>
     <div class="table-wrap" style="max-height:340px;overflow:auto"><table class="tbl">
       <thead><tr><th>Item (map to Item Master)</th><th class="right">MRP/Bot</th><th class="right">Bot.</th><th class="right">Case-Bot</th><th class="right">Amount</th></tr></thead>
       <tbody>${rows}
       <tr style="background:var(--gold-dim);font-weight:700"><td>TOTAL — ${inv.items.length} items</td><td></td>
         <td class="num">${inv.calc.bots}</td><td></td><td class="num gold">₹ ${fmt(Math.round(inv.calc.base))}</td></tr>
       </tbody></table></div>${rawNamesDatalist()}
     <div style="border-top:1px solid var(--gold-dim);margin-top:10px;padding-top:8px">
       ${chk('Items amount', Math.round(inv.items.reduce((a,x)=>a+x.amount,0)*100)/100, inv.calc.base)}
       ${inv.fees.rebate?chk('Less Rebate', inv.fees.rebate,null):''}
       ${chk('Special Purpose Fee', inv.fees.spf, null)}
       ${chk('Round Off (to Govt.)', inv.fees.roundGovt, null)}
       ${chk('T.C.S. '+(inv.fees.tcsPct||2)+'%', inv.fees.tcs, inv.calc.tcs)}
       ${chk('Rounded Off', inv.fees.roundOff, inv.calc.roundOff)}
       <div class="flex between" style="font-size:13.5px;padding:4px 0"><strong>Total — Landing Amount (${inv.fees.bots||inv.calc.bots} bot.)</strong>
         <strong class="gold" style="font-size:15px">₹ ${fmt(inv.fees.total||inv.calc.total)} ${ok(inv.fees.total||inv.calc.total,inv.calc.total)?'<span style="color:var(--green);font-size:11px">✔ auto-calc matches</span>':'<span style="color:var(--red);font-size:11px">⚠ check</span>'}</strong></div>
     </div>`,
    `<button class="btn" onclick="bevcoCancelAll()">Cancel${_bevQueue.length?' all':''}</button>${_bevQueue.length?`<button class="btn" onclick="closeModal();bevcoNext()" title="Leave this invoice out and go to the next">Skip →</button>`:''}<button class="btn btn-gold" onclick="bevcoConfirm()">✅ Add to Purchase · update prices${_bevQueue.length?' · next ('+_bevQueue.length+' more)':''}</button>${_bevQueue.length?`<button class="btn btn-gold" onclick="bevcoAddAll()" title="Confirm this and every queued invoice as shown — only an invoice with a “? check” line pauses for you">✅ Add all (${_bevQueue.length+1})</button>`:''}`);
}
// typing in a mapping box: blank → the NEW-item row (name + group) shows; a name → it hides
function bevMapEdit(i){ const inp=$('#bevMap'+i), nw=$('#bevNew'+i), st=$('#bevSt'+i); if(!inp) return;
  const v=inp.value.trim(); const known=!!(v&&findRawExact(v)); const isNew=!known;   // blank or an unknown name = a new item under that name
  if(nw) nw.style.display=isNew?'':'none';
  inp.classList.toggle('bmap-new',isNew); if(known) inp.classList.remove('bmap-guess');
  if(st){ if(known){ st.className='pill green'; st.textContent='✔ matched'; } else { st.className='pill red'; st.textContent='＋ new item — rename / pick category'; } } }
function bevGrpPick(i){ const s=$('#bevGrp'+i), t=$('#bevGrpNew'+i); if(!s||!t) return; t.style.display=s.value==='__new__'?'':'none'; if(s.value==='__new__') t.focus(); }
// which Item Master entry a preview line lands on — exact name wins; a typed name that is a SURE fuzzy
// match snaps to the house spelling; anything else becomes a NEW entry (the box empty → the clean BEVCO name)
function bevcoResolve(x,i){
  const typed=(($('#bevMap'+i)&&$('#bevMap'+i).value.trim())||'');
  if(typed){ const ex=findRawExact(typed); if(ex) return {name:ex.item,isNew:false};
    const m=bevcoMatch(typed); if(m.sure) return {name:m.name,isNew:false};
    return {name:typed.toUpperCase(),isNew:true}; }
  const clean=bevcoCleanName(x.name); const ex=findRawExact(clean);
  return ex?{name:ex.item,isNew:false}:{name:clean,isNew:true};
}
function bevcoConfirm(){
  const inv=_bevInv; if(!inv) return;
  // distribute the invoice-level fees (SPF + Round Off + TCS − rebate) into every bottle,
  // so Σ(qty × landing) === the invoice's grand Total (the true landed cost)
  const grand=inv.fees.total||inv.calc.total||0;
  const factor=(inv.calc.base>0 && grand>0) ? grand/inv.calc.base : 1;
  let added=0, rawAdded=0; const newNames=[];
  inv.items.forEach((x,i)=>{
    const R=bevcoResolve(x,i); const mapped=R.name;
    const qty=fnum(($('#bevQty'+i)&&$('#bevQty'+i).value)||x.bots)||x.bots;
    bevMap[norm(x.name)]=mapped;                       // remember this mapping for every future invoice
    if(R.isNew){                                       // NEW item → Item Master (and therefore Liquor Room, MR search, Purchase matching) at once
      const gsel=$('#bevGrp'+i), gnew=$('#bevGrpNew'+i);
      const group=((gsel&&gsel.value==='__new__')?((gnew&&gnew.value.trim().toUpperCase())||bevcoGuessGroup(x.name)):((gsel&&gsel.value.trim())||bevcoGuessGroup(x.name)))||'BEVCO IMPORT';
      rawData.push({item:mapped, group}); rebuildRawIdx(); rawAdded++; newNames.push(mapped); }
    const g=findRawExact(mapped);
    const landE=Math.round(x.amount*factor/(x.bots||1)*10000)/10000;   // this line's landed rate, fee share included
    receivedStock.push({date:inv.date||new Date().toISOString().slice(0,10), item:mapped, qty:qty, group:g?g.group:'', inv:inv.no||'', land:landE, src:'bevco'});
    /* the Item Master rate is the client's — an invoice fills it only where it is blank (or the item is new) */
    if(invGet(mapped).mrp==null||invGet(mapped).mrp==='') invSet(mapped,'mrp',x.mrp);
    const curL=invGet(mapped).land;
    if(R.isNew || curL==null || curL===''){ const box=$('#bevLand'+i); const v=box?fnum(box.value):0; invSet(mapped,'land', v>0?v:Math.round(x.amount*factor/(x.bots||1)*100)/100); }
    added++;
  });
  bsv('bevmap',bevMap);
  if(rawAdded){ saveRaw(); }
  bsv('recv',receivedStock);
  invoices.unshift({no:inv.no,date:inv.date,ts:new Date().toLocaleString(),items:inv.items,fees:inv.fees,calc:inv.calc});
  if(invoices.length>100) invoices.length=100;
  bsv('invoices',invoices);
  if(_bevAll) _bevAllN++;
  closeModal(); route();
  toast('Invoice added', added+' items → Purchase · landing ₹ + MRP updated everywhere'+(rawAdded?' · '+rawAdded+' NEW in Item Master + Liquor Room: '+newNames.slice(0,3).join(', ')+(newNames.length>3?' …':''):''),'ok');
  if(_bevQueue.length||_bevAll) bevcoNext();           // straight on to the next invoice in the folder (Add all: an empty queue ends the run with its summary)
}
function bevcoList(){
  const ln=(lbl,val,sign)=>`<div class="flex between" style="font-size:11.5px;padding:1px 0"><span class="muted">${lbl}</span><span>${sign||''}₹ ${fmt(val)}</span></div>`;
  const rows=invoices.map((v,i)=>{
    const base=v.calc&&v.calc.base!=null?v.calc.base:v.items.reduce((a,x)=>a+x.amount,0);
    const tcs=v.fees.tcs||(v.calc&&v.calc.tcs)||0;
    const gross=(v.calc&&v.calc.gross)||0;
    const roundOff=v.fees.roundOff||(v.calc&&v.calc.roundOff)||0;
    const total=v.fees.total||(v.calc&&v.calc.total)||0;
    const bots=v.fees.bots||(v.calc&&v.calc.bots)||v.items.reduce((a,x)=>a+x.bots,0);
    return `<div style="border:1px solid var(--gold-dim);border-radius:10px;padding:10px 12px;margin-bottom:10px">
      <div class="flex between items-center" style="gap:10px;margin-bottom:6px">
        <div style="min-width:0"><strong style="font-size:12px">${esc(v.no||'—')}</strong>
          <div class="muted" style="font-size:11px">${esc(v.date||'')} · ${v.items.length} items · ${bots} bot.</div></div>
        <div class="nowrap" style="flex:none;text-align:right">
          <div class="muted" style="font-size:9.5px;letter-spacing:1.5px">LANDING AMOUNT</div>
          <strong class="gold" style="font-size:17px;font-family:Georgia,serif">₹ ${fmt(total)}</strong>
          <button class="btn btn-danger btn-sm" onclick="confirmAsk('Delete this invoice record?',()=>{ invoices.splice(${i},1); bsv('invoices',invoices); closeModal(); bevcoList(); })">🗑</button></div>
      </div>
      <div style="border-top:1px solid var(--border-soft);padding-top:5px">
        ${ln('Items amount',Math.round(base*100)/100)}
        ${v.fees.rebate?ln('Less Rebate',v.fees.rebate,'−'):''}
        ${ln('Special Purpose Fee',v.fees.spf,'+')}
        ${ln('Round Off value (to Govt.)',v.fees.roundGovt,'+')}
        ${ln('T.C.S. '+(v.fees.tcsPct||2)+'%',tcs,'+')}
        ${gross?ln('Gross',gross):''}
        ${ln('Rounded Off',roundOff,'−')}
        <div class="flex between" style="font-size:12.5px;padding:3px 0;border-top:1px solid var(--gold-dim);margin-top:3px">
          <strong>Total (Landing)</strong><strong class="gold">₹ ${fmt(total)}</strong></div>
      </div></div>`; }).join('')||'<p class="muted center" style="padding:14px">No invoices yet — upload a BEVCO PDF.</p>';
  const tot=invoices.reduce((a,v)=>a+(v.fees.total||(v.calc&&v.calc.total)||0),0);
  modal('📜 BEVCO Invoices', `<div style="max-height:340px;overflow:auto">${rows}</div>
    <div class="flex between" style="border-top:1px solid var(--gold-dim);margin-top:8px;padding-top:8px"><strong>Total purchases (landing)</strong><strong class="gold" style="font-size:15px">₹ ${fmt(tot)}</strong></div>`,
    `<button class="btn" onclick="closeModal()">Close</button>`);
}

/* ---- one-time heal (v2.34.1): purchase entries imported from BEVCO before entries carried their own landing
   rate get it back from the invoice register — the same invoice line, the same fee share — so the Purchase
   total equals the invoices' own totals again. Direct localStorage write (load time), no push needed: every
   device heals its own copy identically. Entries whose invoice line cannot be found are left as they are. */
(function(){ try{
  if(typeof invoices==='undefined' || !Array.isArray(receivedStock)) return;
  let changed=0;
  receivedStock.forEach(r=>{
    if(!r || !r.inv || (r.land!=null && r.land!=='')) return;
    const v=invoices.find(x=>String(x.no)===String(r.inv)); if(!v||!v.items) return;
    const grand=(v.fees&&v.fees.total)||(v.calc&&v.calc.total)||0, base=(v.calc&&v.calc.base)||0;
    const factor=(base>0&&grand>0)?grand/base:1;
    const want=norm(r.item);
    const hits=v.items.filter(x=>{ const m=bevMap[norm(x.name)]; return (m&&norm(m)===want) || norm(bevcoCleanName(x.name))===want || norm(x.name)===want; });
    if(hits.length!==1) return;
    const x=hits[0]; if(!(x.bots>0)) return;
    r.land=Math.round(x.amount*factor/x.bots*10000)/10000; changed++;
  });
  if(changed){ localStorage.setItem(CO_PREFIX+'recv', JSON.stringify(receivedStock)); }
}catch(e){} })();

/* ---- bring the other side's sheets into the running page, no reload (v2.36.0) ----
   Called by the merge push / auto-pull with the storage keys that changed. Re-reads exactly those keys into
   the live arrays (the same bls() reads the file start does), drops the caches that depend on them, and
   re-renders the current page quietly with the scroll kept — or, while the person is typing or has a
   modal open, waits and renders at the next quiet moment. A reload would throw the view to the top and
   the focus away: that was the "page jumps while I type" whenever the other device had saved. */
var _cloudNeedRender=false;
function cloudRefreshState(keys){
  const list=Array.isArray(keys)?keys:[]; const set={}; list.forEach(k=>{ set[k]=1; });
  const has=k=>!!set[k];
  if(has('tally'))         tallyItems=bls('tally', SEED_TALLY.map(t=>({...t})));
  if(has('alias'))         aliasTable=bls('alias', SEED_ALIAS.map(a=>({...a})));
  if(has('cocktails'))     cocktails=bls('cocktails', SEED_CKS.map(c=>({...c, recipe:(c.recipe||[]).map(x=>({...x}))})));
  if(has('cocktailAlias')) cocktailAlias=bls('cocktailAlias', SEED_CKAL.map(c=>({...c})));
  if(has('pos'))           posData=bls('pos', DEFAULT_POS);
  if(has('namemap'))       nameMapList=bls('namemap', []);
  if(has('period'))        period=bls('period', period);
  if(has('pref'))          pref=bls('pref', pref);
  if(has('cfg'))           cfg=bls('cfg', cfg);
  if(has('users'))         users=bls('users', []);
  if(has('rawdata2'))    { rawData=bls('rawdata2', _seedRaw); rebuildRawIdx(); }
  if(has('recv'))          receivedStock=bls('recv', []);
  if(has('mr'))            mrDetail=bls('mr', []);
  if(has('inv'))           invData=bls('inv', JSON.parse(JSON.stringify(_seedInv)));
  if(has('invoices'))      invoices=bls('invoices', []);
  if(has('bevmap'))        bevMap=bls('bevmap', {});
  if(has('bevpages'))      bevPages=bls('bevpages', []);
  list.forEach(k=>{ if(k.indexOf('inv2_')===0) delete bevStores[k.slice(5)]; });
  try{ invalidateCalcCache(); }catch(e){} _bevIdx=null; _bevDupCache={ver:-1,list:null};
  if(has('cfg')||has('pref')){ try{ applyAppearance(); renderShell(); }catch(e){} }
  _cloudNeedRender=true; cloudRenderIfQuiet(true);
}
function cloudRenderIfQuiet(justArrived){
  if(!_cloudNeedRender) return;
  const a=document.activeElement;
  const typing=!!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type!=='button' && a.type!=='checkbox' && a.type!=='file');
  if(typing || document.getElementById('modalBack')) return;      // never under someone's fingers — the next quiet moment
  _cloudNeedRender=false;
  try{ _quietNext=true; route(); }catch(e){}
  try{ sbFill(); }catch(e){}
  if(justArrived!==false) toast('Up to date','Changes from the other side came in','ok');
}
document.addEventListener('focusout', ()=>{ setTimeout(()=>cloudRenderIfQuiet(false), 400); }, true);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) setTimeout(()=>cloudRenderIfQuiet(false), 300); });
setInterval(()=>cloudRenderIfQuiet(false), 20000);

/* ---- Item Master catch-up to the shipped workbook list (v2.37.0 Canteen · v2.42.0 Traffic) ----
   canteenseed.js carries the Canteen RAW DATA list (CANTEEN_RAW / CANTEEN_RAW_V); realdata.js carries the Traffic
   "Liqour room cl" list (REAL_ITEMS / TRAFFIC_RAW_V). A company that already saved its Item Master would never see
   a newer list, so when the version moves this brings the stored Item Master up to it ONCE, the way "📄 Sync from
   sheet" does, but only the safe part of that plan:
     · every name in the list is present, in the list's order, with the list's group (the client's grouping);
     · a stored name that is NOT in the list:
         Canteen — BEVCO-worded (group BEVCO IMPORT / ", 750 ML." tail) and a SURE match to a list name → renamed to
           it, every reference following (purchases, issues, stock, prices, learned BEVCO map); a name the PREVIOUS
           list had and this one dropped, holding no data → removed; anything else → kept, untouched.
         Traffic (strict — the client's rule of 2026-09-19: "only the names in the Liquor Room sheet stay") — ANY
           name with a SURE match to a list name → renamed to it (references follow); a name holding purchases,
           issues or typed stock and no sure match → kept (deleting it would orphan that work — the ✕ / tick-delete
           is theirs to press); everything else → removed.
   Direct localStorage writes at load (bsv() is not for load time) + cloudMark() so the change syncs; each
   device computes the same result, so the merge on the other side is a no-op. A marker per company
   (CO_PREFIX+'rawv') makes it run once per list version; a company still on the pure seed only gets the marker. */
function _rawSeedV(){ if(typeof CO_IS_CANTEEN!=='undefined' && CO_IS_CANTEEN) return (typeof CANTEEN_RAW_V!=='undefined') ? {v:CANTEEN_RAW_V, strict:false, dropped:(typeof CANTEEN_RAW_DROPPED!=='undefined'?CANTEEN_RAW_DROPPED:[])} : null;
  if(typeof CO_IS_TRAFFIC!=='undefined' && CO_IS_TRAFFIC) return (typeof TRAFFIC_RAW_V!=='undefined') ? {v:TRAFFIC_RAW_V, strict:true, dropped:(typeof TRAFFIC_RAW_DROPPED!=='undefined'?TRAFFIC_RAW_DROPPED:[])} : null;
  return null; }
function rawSeedCatchUp(){
  const S=_rawSeedV(); if(!S) return null;
  const MK=CO_PREFIX+'rawv';
  if(localStorage.getItem(MK)===String(S.v)) return null;
  const stored=localStorage.getItem(CO_PREFIX+'rawdata2');
  if(!stored){ localStorage.setItem(MK, String(S.v)); return {added:0,renamed:[],removed:[],kept:0,keptData:[],fresh:true}; }
  const list=_seedRaw.map(x=>({item:x.item, group:x.group}));
  const listIdx=new Map(list.map(x=>[norm(x.item),x]));
  const dropped=new Set(S.dropped.map(norm));
  const before=new Set(rawData.map(r=>norm(r.item)));
  const keep=[], keptData=[], renames=[], removed=[];
  rawData.forEach(r=>{ const k=norm(r.item); if(listIdx.has(k)) return;              // in the list → the list's row replaces it
    const refs=_rawRefs(r.item);
    if(S.strict){
      const m=bevcoMatch(r.item,{list}); if(m.name && m.sure && norm(m.name)!==k){ renames.push({old:r.item, to:m.name}); return; }
      if(refs.recv||refs.mr||refs.stock){ keep.push(r); keptData.push(r.item); return; }
      removed.push(r.item); return; }
    if(!refs.any && dropped.has(k)){ removed.push(r.item); return; }
    if(refs.any && _looksBevco(r)){ const m=bevcoMatch(r.item,{list}); if(m.name && m.sure && norm(m.name)!==k){ renames.push({old:r.item, to:m.name}); return; } }
    keep.push(r); });
  renames.forEach(rn=>rawMoveRefs(rn.old, rn.to));
  const newRaw=list.slice(); keep.forEach(r=>newRaw.push({item:r.item, group:r.group||'(ungrouped)'}));
  rawData.length=0; newRaw.forEach(r=>rawData.push(r)); rebuildRawIdx(); _bevIdx=null; _bevDupCache={ver:-1,list:null};
  const added=list.filter(x=>!before.has(norm(x.item))).length;
  const w=(k,v)=>{ try{ localStorage.setItem(CO_PREFIX+k, JSON.stringify(v)); }catch(e){} try{ cloudMark(k); }catch(e){} };
  w('rawdata2', rawData);
  if(renames.length){ w('recv',receivedStock); w('mr',mrDetail); w('inv',invData); w('bevmap',bevMap); }
  localStorage.setItem(MK, String(S.v));
  return {added, renamed:renames, removed, kept:keep.length, keptData, fresh:false};
}
/* ---- Beverage Control rows + opening figures from the Traffic workbook (v2.42.0, all rows since v2.43.0) ----
   TRAFFIC_BAR = every brand row of the main sheet: a brand the Tally Sheet does not know is created in the mapped
   category (the workbook's own group → app category) so Beverage Control shows the same rows as the Excel page;
   a row with `o` (OPENING BAL) → invData[brand].openBL; TRAFFIC_LR_OPEN (Liquor Room OPENING QTY) → invData[item].lrOpen.
   Openings fill BLANKS only — a figure the client has typed is never overwritten (counted as kept).
   Once per TRAFFIC_INV_V per company (CO_PREFIX+'invv'); a Start-Fresh company gets its figures back this way too. */
function invSeedCatchUp(){
  if(typeof CO_IS_TRAFFIC==='undefined' || !CO_IS_TRAFFIC || typeof TRAFFIC_INV_V==='undefined') return null;
  const MK=CO_PREFIX+'invv';
  if(localStorage.getItem(MK)===String(TRAFFIC_INV_V)) return null;
  const blank=v=>v==null||v==='';
  let bar=0, lr=0, keptBar=0, keptLr=0; const brandsAdded=[];
  (typeof TRAFFIC_BAR!=='undefined'?TRAFFIC_BAR:[]).forEach(x=>{
    if(!getTallyItem(x.b)){ const cat=(typeof CATEGORIES!=='undefined'&&CATEGORIES.includes(x.c))?x.c:'WHISKY'; const d=(typeof CAT_DEFAULTS!=='undefined'&&CAT_DEFAULTS[cat])||{unit:'ml',peg:30};
      tallyItems.push({name:x.b, category:cat, posQty:0, unit:d.unit, pegMl:d.peg||30, cocktailMl:0, straightMl:0, bogo:0}); brandsAdded.push(x.b); }
    if(x.o==null) return;
    const k=norm(x.b); const iv=invData[k]||(invData[k]={});
    if(blank(iv.openBL)){ iv.openBL=x.o; bar++; } else keptBar++; });
  (typeof TRAFFIC_LR_OPEN!=='undefined'?TRAFFIC_LR_OPEN:[]).forEach(x=>{
    const k=norm(x.f); const iv=invData[k]||(invData[k]={});
    if(blank(iv.lrOpen)){ iv.lrOpen=x.o; lr++; } else keptLr++; });
  const w=(k,v)=>{ try{ localStorage.setItem(CO_PREFIX+k, JSON.stringify(v)); }catch(e){} try{ cloudMark(k); }catch(e){} };
  if(bar||lr) w('inv', invData);
  if(brandsAdded.length){ w('tally', tallyItems); try{ rebuildIndexes(); }catch(e){} try{ invalidateCalcCache(); }catch(e){} }
  localStorage.setItem(MK, String(TRAFFIC_INV_V));
  return {bar, lr, keptBar, keptLr, brandsAdded};
}
/* When to run them. A device that was away (the PC closed overnight) would otherwise migrate its STALE copy at
   load, mark rawdata2/inv/bevmap dirty, and its next merge push would lay that stale copy over what the other
   side typed since (non-list keys: the pushing side wins). So on a cloud-connected, clean device the run waits
   for the first cloud check — nothing newer, or the auto-pull has brought the newest copy in (in place, via
   cloudRefreshState) — and only then migrates. A device with no cloud, or one already holding unpushed work,
   runs at once. Safety net: 90 s (offline, or the check never answers). */
var _rawCatchPending=false;
function _rawCatchDue(){ try{ const S=_rawSeedV(); if(S && localStorage.getItem(CO_PREFIX+'rawv')!==String(S.v)) return true;
  if(typeof CO_IS_TRAFFIC!=='undefined' && CO_IS_TRAFFIC && typeof TRAFFIC_INV_V!=='undefined' && localStorage.getItem(CO_PREFIX+'invv')!==String(TRAFFIC_INV_V)) return true; }catch(e){} return false; }
function _rawCatchRun(){
  if(!_rawCatchPending) return; _rawCatchPending=false;
  let R=null, I=null; try{ R=rawSeedCatchUp(); }catch(e){} try{ I=invSeedCatchUp(); }catch(e){}
  const rawDid=R&&!R.fresh&&(R.added||R.renamed.length||R.removed.length);
  const invDid=I&&(I.bar||I.lr||I.brandsAdded.length);
  if(!rawDid && !invDid) return;
  const n=(c,w)=>c+' '+w+(c===1?'':'s');
  const say=()=>{ try{ _cloudNeedRender=true; cloudRenderIfQuiet(false); }catch(e){}
    try{ if(rawDid) toast('Item Master updated from your September sheet', n(R.added,'new name')+' · '+n(R.renamed.length,'name')+' renamed to yours · '+n(R.removed.length,'extra name')+' removed'+(R.keptData.length?' · '+n(R.keptData.length,'name')+' with purchases / issues / stock kept for you to decide':'')+' · your groups applied', 'ok'); }catch(e){}
    try{ if(invDid){ if(I.bar||I.lr) toast('Opening stock filled from your September sheet', n(I.lr,'Liquor Room opening')+' · '+n(I.bar,'Beverage Control opening')+(I.keptBar+I.keptLr?' · '+n(I.keptBar+I.keptLr,'figure')+' already set — left as they were':'')+(I.brandsAdded.length?' · '+n(I.brandsAdded.length,'brand')+' added to Beverage Control':''), 'ok');
      else toast('Beverage Control now lists every brand of your September sheet', n(I.brandsAdded.length,'brand')+' added (openings already in place)', 'ok'); } }catch(e){} };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>setTimeout(say, 1200)); else setTimeout(say, 50);
}
(function(){ try{
  if(!_rawCatchDue()) return;
  _rawCatchPending=true;
  if(!cloudOn() || cloudDirty()){ _rawCatchRun(); return; }
  const orig=cloudCheck;                                     // function declaration → rebinding the name is what the 2.5 s call and cloudWatch() pick up
  cloudCheck=async function(){ try{ return await orig.apply(this, arguments); }
    finally{ if(_rawCatchPending && !document.querySelector('.cloudnew')) setTimeout(_rawCatchRun, 300); } };   // a banner = newer data not yet brought in → wait for the next check
  setTimeout(_rawCatchRun, 90000);
}catch(e){} })();
