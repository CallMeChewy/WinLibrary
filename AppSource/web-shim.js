/*
  web-shim.js — CORS-proof & early-run for OurLibrary (no module changes)
*/
(function () {
  'use strict';
  // Check if we're in Electron/desktop mode vs web mode
  if (window.api && window.api.dbInitialize && typeof window.api.dbQuery === 'function') { 
    console.info('[web-shim] native desktop API detected; skipping web shim initialization.'); 
    return; 
  }
  window.OUR_LIBRARY_WEB_MODE = true;

  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/';
  const SQL_JS = CDN + 'sql-wasm.js';
  const S = { cfg:null, SQL:null, db:null, init:null };
  const log = (...a)=>console.log('[web-shim]',...a);

  function isDriveDownload(url){ return /https:\/\/drive\.google\.com\/uc(\?|$)/.test(url); }
  function isGoogleDriveApi(url){ return /https:\/\/www\.googleapis\.com\/drive\/v\d\/files/.test(url); }

  // Keep native fetch around
  window.__nativeFetch = window.fetch.bind(window);

  async function cfg() {
    if (S.cfg) return S.cfg;
    // Use native fetch to avoid recursive loop with patched fetch
    const r = await window.__nativeFetch('/Config/ourlibrary_google_config.json', { cache:'no-store' });
    if (!r.ok) throw new Error('Config 404 /Config/ourlibrary_google_config.json');
    S.cfg = await r.json();
    return S.cfg;
  }
  const localDbUrlFromConfig = (c)=> c.database_url || (c.database_filename ? `/Data/Databases/${encodeURIComponent(c.database_filename)}` : null);

  // Patch fetch
  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (isDriveDownload(url)) {
      const c = await cfg(), localUrl = localDbUrlFromConfig(c);
      if (localUrl) { log('fetch rewrite →', localUrl); return window.__nativeFetch(localUrl, init); }
    }
    if (isGoogleDriveApi(url)) {
      const now = new Date().toISOString();
      const body = JSON.stringify({ id:'stub', name:'OurLibrary.db', modifiedTime:now, size:0 });
      log('fetch stub Google Drive API:', url);
      return new Response(body, { status:200, headers:{'Content-Type':'application/json'}});
    }
    return window.__nativeFetch(input, init);
  };

  // Patch XHR too
  (function(){
    const NativeXHR = window.XMLHttpRequest;
    function ShimXHR(){
      const xhr = new NativeXHR();
      let _url=''; let _method='GET'; let _async=true;
      const open = xhr.open.bind(xhr);
      xhr.open = function(method, url, async, user, password){
        _method = method; _url = url; _async = (async !== false);
        if (isDriveDownload(url)) {
          cfg().then(c=>{ const localUrl = localDbUrlFromConfig(c);
            if (localUrl) { _url = localUrl; log('XHR rewrite →', _url); }
          }).catch(()=>{});
        }
        if (isGoogleDriveApi(url)) xhr.__stubDriveMeta = true;
        return open(_method, _url, _async, user, password);
      };
      const send = xhr.send.bind(xhr);
      xhr.send = function(body){
        if (xhr.__stubDriveMeta) {
          const now = new Date().toISOString();
          const payload = JSON.stringify({ id:'stub', name:'OurLibrary.db', modifiedTime:now, size:0 });
          setTimeout(()=>{
            Object.defineProperty(xhr,'readyState',{value:4});
            Object.defineProperty(xhr,'status',{value:200});
            Object.defineProperty(xhr,'responseText',{value:payload});
            Object.defineProperty(xhr,'response',{value:payload});
            xhr.onreadystatechange && xhr.onreadystatechange();
            xhr.onload && xhr.onload();
          },0);
          log('XHR stub Google Drive API:', _url);
          return;
        }
        return send(body);
      };
      return xhr;
    }
    ShimXHR.DONE = NativeXHR.DONE;
    ShimXHR.UNSENT = NativeXHR.UNSENT;
    ShimXHR.HEADERS_RECEIVED = NativeXHR.HEADERS_RECEIVED;
    ShimXHR.LOADING = NativeXHR.LOADING;
    ShimXHR.OPENED = NativeXHR.OPENED;
    window.XMLHttpRequest = ShimXHR;
  })();

  function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.async=true;s.onload=res;s.onerror=()=>rej(new Error('load '+src));document.head.appendChild(s);});}
  async function loadSQL(){ if(S.SQL) return S.SQL; await loadScript(SQL_JS);
    if(typeof window.initSqlJs!=='function') throw new Error('initSqlJs missing');
    S.SQL = await window.initSqlJs({ locateFile:(f)=>CDN+f }); log('sql.js ready'); return S.SQL; }
  async function fetchDbArrayBuffer(){
    const c = await cfg(); const candidates = [];
    const localUrl = localDbUrlFromConfig(c); if (localUrl) candidates.push(localUrl);
    if (c.database_file_id) candidates.push(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(c.database_file_id)}`);
    let lastErr=null;
    for (const url of candidates){
      try{ log('fetch DB:', url);
        const r = await window.__nativeFetch(url,{cache:'no-store'});
        if(!r.ok) throw new Error(`${url} -> ${r.status}`);
        return await r.arrayBuffer();
      } catch(e){ lastErr=e; log('fetch failed:', e.message||e); }
    }
    throw lastErr || new Error('No DB source succeeded');
  }
  async function ensureDb(){
    if(S.db) return S.db;
    if(S.init) return S.init;
    S.init = (async()=>{
      await loadSQL();
      const buf = new Uint8Array(await fetchDbArrayBuffer());
      const db = new S.SQL.Database(buf);
      try{ const res = db.exec('SELECT COUNT(*) FROM Books'); log('DB open, Books=', res?.[0]?.values?.[0]?.[0] ?? 0); }
      catch(e){ log('COUNT failed (Books missing?)', e); }
      S.db=db; S.init=null; return db;
    })();
    return S.init;
  }
  function rows(stmt){const names=stmt.getColumnNames();const out=[];while(stmt.step()){const row=stmt.get();const o={};for(let i=0;i<names.length;i++)o[names[i]]=row[i];out.push(o);}return out;}
  async function dbQuery(sql, params){const db=await ensureDb();const stmt=db.prepare(sql);try{if(params)stmt.bind(params);return rows(stmt);}finally{stmt.free();}}

  window.api = {
    __source:'web-shim',
    getGoogleConfig: async ()=>cfg(),
    dbInitialize:    async ()=>{ await ensureDb(); const r = await dbQuery('SELECT COUNT(*) AS n FROM Books'); return { ok:!!S.db, mode:'browser', books:r?.[0]?.n ?? 0 }; },
    dbConnect:       async ()=>{ await ensureDb(); return { ok:!!S.db, mode:'browser' }; },
    dbGetStatus:     async ()=>{ const ok=!!S.db; let n=0; if(ok){ try{ n=(await dbQuery('SELECT COUNT(*) AS n FROM Books'))?.[0]?.n ?? 0; }catch{} } return { ok, mode:'browser', books:n }; },
    dbQuery,
    searchBooks:     async (q)=>dbQuery(
      `SELECT ID, Title, Author, Category_ID, Filename, Thumbnail
       FROM Books
       WHERE Title LIKE $q OR Author LIKE $q
       ORDER BY Title LIMIT 200`, { $q:`%${(q||'').trim()}%` })
  };

  // Auto-init on #/app
  function maybeInit(){ if(location.hash.startsWith('#/app')) window.api.dbInitialize().catch(e=>console.error('[web-shim] init',e)); }
  addEventListener('hashchange', maybeInit);
  (document.readyState==='loading'?document.addEventListener('DOMContentLoaded', maybeInit):maybeInit());
  console.log('[web-shim] ready (CORS-proof + XHR)');
})();

// --- debug-only: stub updater so browser mode never crashes ---
(function(){
  try {
    window.api = window.api || {};
    if (!window.api.updateDatabase) {
      window.api.updateDatabase = async function(_arrayBuffer){
        console.info('[web-shim] updateDatabase stub: no-op in browser mode');
        return { ok: true, mode: 'browser', updated: false };
      };
    }
  } catch(e) {
    console.warn('[web-shim] failed to install updateDatabase stub', e);
  }
})();

// --- ensure a no-op updater exists in browser debug ---
(function(){
  try {
    window.api = window.api || {};
    if (typeof window.api.updateDatabase !== 'function') {
      window.api.updateDatabase = async function(_buf){
        console.info('[web-shim] updateDatabase stub: no-op in browser mode');
        return { ok:true, mode:'browser', updated:false };
      };
    }
  } catch(e) { console.warn('[web-shim] could not install updateDatabase stub', e); }
})();

// --- ensure a no-op updater exists in browser debug ---
(function(){
  try {
    window.api = window.api || {};
    if (typeof window.api.updateDatabase !== 'function') {
      window.api.updateDatabase = async function(_buf){
        console.info('[web-shim] updateDatabase stub: no-op in browser mode');
        return { ok:true, mode:'browser', updated:false };
      };
    }
  } catch(e) { console.warn('[web-shim] could not install updateDatabase stub', e); }
})();

// --- add nested no-op updaters so any call shape resolves in browser ---
(function(){
  try {
    function ok(){ console.info('[web-shim] updateDatabase stub: no-op in browser mode'); return Promise.resolve({ok:true,mode:'browser',updated:false}); }
    // ensure root
    window.api = window.api || {};
    // common shapes used by app code
    if (!window.api.updater)  window.api.updater  = {};
    if (!window.api.database) window.api.database = {};
    if (typeof window.api.updater.updateDatabase  !== 'function') window.api.updater.updateDatabase  = ok;
    if (typeof window.api.database.updateDatabase !== 'function') window.api.database.updateDatabase = ok;

    // other bridges some apps use
    window.OurLibraryNative = window.OurLibraryNative || {};
    if (typeof window.OurLibraryNative.updateDatabase !== 'function') window.OurLibraryNative.updateDatabase = ok;

    window.electronAPI = window.electronAPI || {};
    if (typeof window.electronAPI.updateDatabase !== 'function') window.electronAPI.updateDatabase = ok;

    if (typeof window.updateDatabase !== 'function') window.updateDatabase = ok;
  } catch(e) { console.warn('[web-shim] could not install nested updater stubs', e); }
})();

// --- browser debug: neuter OurLibraryDatabaseSync so it never calls native updaters ---
(function(){
  function installPatch(){
    try{
      const Sync = window.OurLibraryDatabaseSync;
      if (!Sync || !Sync.prototype || window.__ol_sync_patched) return;

      const ok = async (...args) => {
        console.info('[web-shim] OurLibraryDatabaseSync: no-op in browser', {args});
        return { ok:true, updated:false, mode:'browser' };
      };

      // Patch the hot paths that call native update handlers
      if (typeof Sync.prototype.downloadAndUpdateDatabase === 'function')
        Sync.prototype.downloadAndUpdateDatabase = ok;

      if (typeof Sync.prototype.checkForUpdates === 'function')
        Sync.prototype.checkForUpdates = ok;

      if (typeof Sync.prototype.initializeSync === 'function')
        Sync.prototype.initializeSync = ok;

      window.__ol_sync_patched = true;
      console.info('[web-shim] OurLibraryDatabaseSync patched for browser debug');
    }catch(e){
      console.warn('[web-shim] failed to patch OurLibraryDatabaseSync', e);
    }
  }

  // Try repeatedly in case the class is defined after this script runs
  installPatch();
  document.addEventListener('DOMContentLoaded', installPatch);
  setTimeout(installPatch, 0);
  setTimeout(installPatch, 100);
  setTimeout(installPatch, 300);
  setTimeout(installPatch, 800);
  setTimeout(installPatch, 1500);
})();

// --- browser debug: claim remote DB is NOT newer so sync won't update ---
// Note: This functionality is now integrated into the main fetch patch above
