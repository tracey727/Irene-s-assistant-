(() => {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const DB_NAME = 'gigi-secure-vault';
  const STORE = 'secure';
  const VAULT_KEY = 'vault';
  const ITERATIONS = 350000;
  const VERSION = 2;

  const secureState = {
    key: null,
    data: null,
    failedUnlocks: 0,
    lockTimer: null,
    hiddenTimer: null,
    lastActivity: Date.now(),
    idleMinutes: Number(localStorage.getItem('gigiIdleMinutes') || 5),
  };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function bytesToB64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }
  function b64ToBytes(s) {
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }
  async function dbPut(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  async function dbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptData(key, data, salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = enc.encode(JSON.stringify(data));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
    return {
      version: VERSION,
      algorithm: 'AES-GCM-256',
      kdf: 'PBKDF2-SHA-256',
      iterations: ITERATIONS,
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      ciphertext: bytesToB64(cipher),
      updatedAt: nowIso(),
    };
  }

  async function decryptData(key, record) {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(record.iv) },
      key,
      b64ToBytes(record.ciphertext)
    );
    return JSON.parse(dec.decode(plaintext));
  }

  function defaultData() {
    return {
      version: VERSION,
      createdAt: nowIso(),
      entries: [],
      checkins: [],
      audit: [],
      limits: {
        configured: false,
        maxSessionsDay: 5,
        maxSessionsWeek: 22,
        maxConsecutiveSessions: 3,
        minimumLunchMinutes: 45,
        workdayEnd: '17:30',
        maxAfterHoursMinutesDay: 60,
        protectedPersonalMinutesWeek: 240,
        supervisionMinutesWeek: 60,
      },
      preferences: {
        clientReferenceOnly: true,
        voiceClinicalDictation: false,
      },
    };
  }

  function audit(action, detail = '') {
    if (!secureState.data) return;
    secureState.data.audit.unshift({ id: uid(), at: nowIso(), action, detail });
    secureState.data.audit = secureState.data.audit.slice(0, 250);
  }

  async function persist() {
    if (!secureState.key || !secureState.data) throw new Error('Vault is locked');
    const current = await dbGet(VAULT_KEY);
    const salt = current?.salt ? b64ToBytes(current.salt) : crypto.getRandomValues(new Uint8Array(16));
    const record = await encryptData(secureState.key, secureState.data, salt);
    await dbPut(VAULT_KEY, record);
  }

  async function setupVault(passphrase) {
    if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, salt);
    secureState.key = key;
    secureState.data = defaultData();
    audit('vault_created', 'Secure device vault created');
    await dbPut(VAULT_KEY, await encryptData(key, secureState.data, salt));
    try { await navigator.storage?.persist?.(); } catch (_) {}
    onUnlocked();
  }

  async function unlockVault(passphrase) {
    const record = await dbGet(VAULT_KEY);
    if (!record) throw new Error('No vault exists yet.');
    const delay = Math.min(8000, secureState.failedUnlocks > 2 ? 700 * Math.pow(2, secureState.failedUnlocks - 2) : 0);
    if (delay) await new Promise(r => setTimeout(r, delay));
    try {
      const key = await deriveKey(passphrase, b64ToBytes(record.salt), record.iterations || ITERATIONS);
      const data = await decryptData(key, record);
      secureState.key = key;
      secureState.data = migrateData(data);
      secureState.failedUnlocks = 0;
      audit('vault_unlocked', 'Vault unlocked on this device');
      await persist();
      onUnlocked();
    } catch (e) {
      secureState.failedUnlocks += 1;
      throw new Error('Passphrase not accepted. The vault remains locked.');
    }
  }

  function migrateData(data) {
    const d = { ...defaultData(), ...data };
    d.entries = Array.isArray(data.entries) ? data.entries : [];
    d.checkins = Array.isArray(data.checkins) ? data.checkins : [];
    d.audit = Array.isArray(data.audit) ? data.audit : [];
    d.limits = { ...defaultData().limits, ...(data.limits || {}) };
    d.preferences = { ...defaultData().preferences, ...(data.preferences || {}) };
    return d;
  }

  function lockVault(reason = 'Locked') {
    secureState.key = null;
    secureState.data = null;
    clearTimeout(secureState.lockTimer);
    clearTimeout(secureState.hiddenTimer);
    const gate = $('#gigiPrivacyGate');
    if (gate) gate.hidden = false;
    $('#secureWorkspace')?.remove();
    document.body.classList.add('vault-locked');
    setGateMessage(reason);
    updateLockButton(false);
  }

  function onUnlocked() {
    $('#gigiPrivacyGate').hidden = true;
    document.body.classList.remove('vault-locked');
    secureState.lastActivity = Date.now();
    resetAutoLock();
    updateLockButton(true);
    renderProtectionPanel();
    renderLoadGuard();
    dispatchEvent(new CustomEvent('gigi-vault-unlocked'));
  }

  function resetAutoLock() {
    if (!secureState.key) return;
    secureState.lastActivity = Date.now();
    clearTimeout(secureState.lockTimer);
    secureState.lockTimer = setTimeout(() => lockVault('Auto-locked after inactivity.'), secureState.idleMinutes * 60 * 1000);
  }

  function attachActivityWatchers() {
    ['pointerdown','keydown','touchstart'].forEach(evt => window.addEventListener(evt, resetAutoLock, { passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (!secureState.key) return;
      clearTimeout(secureState.hiddenTimer);
      if (document.hidden) secureState.hiddenTimer = setTimeout(() => lockVault('Auto-locked while the app was in the background.'), 2 * 60 * 1000);
      else resetAutoLock();
    });
  }

  function setGateMessage(text) {
    const m = $('#vaultGateMessage'); if (m) m.textContent = text;
  }

  async function hasVault() { return !!(await dbGet(VAULT_KEY)); }

  function buildGate() {
    const gate = document.createElement('section');
    gate.id = 'gigiPrivacyGate';
    gate.className = 'privacy-gate';
    gate.innerHTML = `
      <div class="privacy-card">
        <div class="privacy-mark">G</div>
        <span class="privacy-kicker">PRIVATE DEVICE VAULT</span>
        <h2>Gigi protects Irene's private information.</h2>
        <p id="vaultGateMessage">Checking this device…</p>
        <div id="vaultSetupBlock" hidden>
          <label>Create Irene's master passphrase<input id="vaultNewPass" type="password" minlength="12" autocomplete="new-password" placeholder="12+ characters" /></label>
          <label>Confirm passphrase<input id="vaultNewPass2" type="password" minlength="12" autocomplete="new-password" placeholder="Repeat passphrase" /></label>
          <button class="secure-primary" id="createVaultBtn" type="button">Create encrypted vault</button>
          <p class="secure-warning"><b>Important:</b> Gigi cannot recover this passphrase. Create an encrypted backup after setup.</p>
        </div>
        <div id="vaultUnlockBlock" hidden>
          <label>Master passphrase<input id="vaultPass" type="password" autocomplete="current-password" placeholder="Unlock Gigi" /></label>
          <button class="secure-primary" id="unlockVaultBtn" type="button">Unlock Gigi</button>
        </div>
        <div class="privacy-promises">
          <span>🔐 AES-GCM encrypted device vault</span>
          <span>⏱ Automatic lock</span>
          <span>🧾 Encrypted audit history</span>
          <span>🎙 Voice kept away from clinical dictation</span>
        </div>
      </div>`;
    document.body.append(gate);
  }

  async function initialiseGate() {
    const exists = await hasVault();
    $('#vaultSetupBlock').hidden = exists;
    $('#vaultUnlockBlock').hidden = !exists;
    setGateMessage(exists ? 'Enter Irene’s master passphrase. Sensitive records never need to leave this device.' : 'First-time setup: create a strong passphrase for Irene’s encrypted local vault.');
  }

  function bindGate() {
    $('#createVaultBtn').addEventListener('click', async () => {
      const a = $('#vaultNewPass').value, b = $('#vaultNewPass2').value;
      if (a !== b) return setGateMessage('The two passphrases do not match.');
      try { setGateMessage('Creating encrypted vault…'); await setupVault(a); $('#vaultNewPass').value=''; $('#vaultNewPass2').value=''; }
      catch (e) { setGateMessage(e.message); }
    });
    $('#unlockVaultBtn').addEventListener('click', async () => {
      const p = $('#vaultPass').value;
      try { setGateMessage('Unlocking…'); await unlockVault(p); $('#vaultPass').value=''; }
      catch (e) { setGateMessage(e.message); }
    });
    $('#vaultPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#unlockVaultBtn').click(); });
  }

  function injectSecurityStrip() {
    if ($('#gigiSecurityStrip')) return;
    const strip = document.createElement('section');
    strip.id = 'gigiSecurityStrip';
    strip.className = 'security-strip';
    strip.innerHTML = `<span>🔐 <b>Private Device Mode</b></span><span>Encrypted vault • auto-lock • no client data sent by Gigi</span><button id="quickLockBtn" type="button">Lock now</button>`;
    $('#dashboardView')?.prepend(strip);
    $('#quickLockBtn')?.addEventListener('click', () => lockVault('Locked manually.'));
  }

  function injectSecureModules() {
    const grid = $('#moreView .module-grid');
    if (!grid || $('#secureVaultModule')) return;
    const modules = [
      ['secureVaultModule','Secure Vault','Client, supervision, business, operations and personal records','Encrypted'],
      ['workloadGuardModule','Workload Guard','Caseload, breaks, after-hours and personal protection','Active'],
      ['secureBackupModule','Encrypted Backup','Export or restore an encrypted vault copy','Recommended'],
      ['privacyModule','Privacy & Audit','Security status, audit trail and privacy boundaries','Protected'],
    ];
    modules.forEach(([id,title,sub,em]) => {
      const b = document.createElement('button'); b.id=id; b.className='module-card secure-module'; b.type='button';
      b.innerHTML=`<b>${title}</b><span>${sub}</span><em>${em}</em>`;
      b.addEventListener('click', () => openSecureWorkspace(id)); grid.append(b);
    });
  }

  function ensureSecureWorkspace() {
    let w = $('#secureWorkspace');
    if (!w) {
      w = document.createElement('dialog');
      w.id='secureWorkspace'; w.className='secure-workspace';
      w.innerHTML=`<div class="secure-workspace-inner"><button class="secure-close" id="secureClose" aria-label="Close">×</button><div id="secureWorkspaceContent"></div></div>`;
      document.body.append(w);
      $('#secureClose').addEventListener('click',()=>w.close());
    }
    return w;
  }

  function openSecureWorkspace(id) {
    if (!secureState.key) return lockVault('Unlock Gigi to open the secure vault.');
    const w=ensureSecureWorkspace(), c=$('#secureWorkspaceContent');
    if (id==='secureVaultModule') renderVaultWorkspace(c);
    else if (id==='workloadGuardModule') renderLimitsWorkspace(c);
    else if (id==='secureBackupModule') renderBackupWorkspace(c);
    else renderPrivacyWorkspace(c);
    w.showModal();
  }

  const docTypes = [
    'Session / Progress Note','Assessment','General Letter','NDIS Letter / Report','GP / Medicare Correspondence',
    'Insurer / WorkCover','School / University','Legal / Court','Specialist Referral','Progress Report',
    'Treatment Summary','Supervision Note','Business / Administration','Personal Commitment','Other'
  ];

  function renderVaultWorkspace(c) {
    const entries = [...secureState.data.entries].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
    c.innerHTML=`
      <span class="secure-kicker">ENCRYPTED VAULT</span><h2>Irene's secure working records</h2>
      <p>Use a client reference/code rather than a full name where practical. Store only information Irene genuinely needs. Gigi does not accept clinical dictation through browser voice.</p>
      <div class="secure-toolbar"><button class="secure-primary" id="addSecureEntry">+ Add information</button><input id="vaultSearch" placeholder="Search decrypted vault while unlocked" /></div>
      <div class="vault-category-row"><span>Clients</span><span>Supervision</span><span>Business</span><span>Operations</span><span>Personal</span></div>
      <div id="vaultEntryList" class="vault-entry-list"></div>`;
    const renderList = (query='') => {
      const q=query.toLowerCase();
      const filtered=entries.filter(e=>!q || [e.title,e.clientRef,e.kind,e.documentType,e.notes].join(' ').toLowerCase().includes(q));
      $('#vaultEntryList').innerHTML = filtered.length ? filtered.map(e=>`
        <button class="vault-entry" data-entry="${e.id}" type="button"><span><b>${escapeHtml(e.title)}</b><small>${escapeHtml(e.kind)} • ${escapeHtml(e.documentType||'Record')} ${e.clientRef?`• Ref ${escapeHtml(e.clientRef)}`:''}</small></span><span>${escapeHtml(e.date||'')}<small>${escapeHtml(e.status||'Open')}</small></span></button>`).join('') : '<p class="empty-secure">No matching secure information.</p>';
      $$('.vault-entry').forEach(b=>b.addEventListener('click',()=>renderEntryDetail(c,b.dataset.entry)));
    };
    renderList();
    $('#vaultSearch').addEventListener('input',e=>renderList(e.target.value));
    $('#addSecureEntry').addEventListener('click',()=>renderEntryForm(c));
  }

  function renderEntryForm(c, existing=null) {
    const e=existing||{id:uid(),kind:'Clients',documentType:'Session / Progress Note',date:isoDate(),estimatedMinutes:50,priority:'Normal',status:'Open',consent:'Not recorded',startTime:'',clientRef:'',title:'',notes:''};
    c.innerHTML=`<span class="secure-kicker">${existing?'EDIT':'ADD'} SECURE INFORMATION</span><h2>${existing?'Update record':'What does Irene need Gigi to hold?'}</h2>
      <p>Suitable for psychology work beyond NDIS: session/admin notes, assessments, GP/Medicare correspondence, insurers, schools, legal/court documents, referrals, supervision, business, operations and personal commitments.</p>
      <form id="secureEntryForm" class="secure-form">
        <label>Area<select name="kind">${['Clients','Supervision','Business','Operations','Personal'].map(x=>`<option ${e.kind===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label>Record / work type<select name="documentType">${docTypes.map(x=>`<option ${e.documentType===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label class="wide">Title<input name="title" required value="${attr(e.title)}" placeholder="e.g. Follow-up letter, assessment review, personal appointment" /></label>
        <label>Client reference / code<input name="clientRef" value="${attr(e.clientRef)}" placeholder="Optional; avoid full name where possible" /></label>
        <label>Date<input type="date" name="date" value="${attr(e.date||isoDate())}" /></label>
        <label>Start time<input type="time" name="startTime" value="${attr(e.startTime||'')}" /></label>
        <label>Minutes<input type="number" min="5" max="720" step="5" name="estimatedMinutes" value="${Number(e.estimatedMinutes)||30}" /></label>
        <label>Priority<select name="priority">${['Critical','High','Normal','Low'].map(x=>`<option ${e.priority===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label>Status<select name="status">${['Open','Waiting','Draft','Ready for review','Completed'].map(x=>`<option ${e.status===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label>Consent / authority<select name="consent">${['Not recorded','Obtained','Not required / lawful basis recorded','Withdrawn / do not disclose'].map(x=>`<option ${e.consent===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label class="wide">Private notes<textarea name="notes" rows="7" placeholder="Type sensitive information here. Do not dictate identifiable clinical notes through browser voice.">${escapeHtml(e.notes||'')}</textarea></label>
        <div class="secure-form-actions wide"><button class="secure-primary" type="submit">Encrypt & save</button><button class="secure-secondary" id="cancelSecureEntry" type="button">Cancel</button>${existing?'<button class="secure-danger" id="deleteSecureEntry" type="button">Delete record</button>':''}</div>
      </form>`;
    $('#cancelSecureEntry').addEventListener('click',()=>renderVaultWorkspace(c));
    $('#secureEntryForm').addEventListener('submit',async evt=>{
      evt.preventDefault(); const fd=new FormData(evt.currentTarget); const record={...e};
      for(const [k,v] of fd.entries()) record[k]=v;
      record.estimatedMinutes=Number(record.estimatedMinutes)||0; record.updatedAt=nowIso(); if(!record.createdAt)record.createdAt=nowIso();
      const idx=secureState.data.entries.findIndex(x=>x.id===record.id); if(idx>=0)secureState.data.entries[idx]=record; else secureState.data.entries.push(record);
      audit(existing?'record_updated':'record_created',`${record.kind}: ${record.documentType}`); await persist(); renderProtectionPanel(); renderLoadGuard(); renderVaultWorkspace(c);
    });
    $('#deleteSecureEntry')?.addEventListener('click',async()=>{
      if(!confirm('Delete this encrypted record from this device?')) return;
      secureState.data.entries=secureState.data.entries.filter(x=>x.id!==e.id); audit('record_deleted',`${e.kind}: ${e.documentType}`); await persist(); renderProtectionPanel(); renderLoadGuard(); renderVaultWorkspace(c);
    });
  }

  function renderEntryDetail(c,id) {
    const e=secureState.data.entries.find(x=>x.id===id); if(!e)return renderVaultWorkspace(c);
    c.innerHTML=`<span class="secure-kicker">${escapeHtml(e.kind).toUpperCase()}</span><h2>${escapeHtml(e.title)}</h2>
      <div class="record-meta"><span>${escapeHtml(e.documentType||'Record')}</span><span>${escapeHtml(e.date||'')}</span><span>${e.estimatedMinutes||0} min</span><span>${escapeHtml(e.status||'')}</span></div>
      ${e.clientRef?`<p><b>Client reference:</b> ${escapeHtml(e.clientRef)}</p>`:''}
      <p><b>Consent / authority:</b> ${escapeHtml(e.consent||'Not recorded')}</p>
      <div class="secure-note">${escapeHtml(e.notes||'No private notes entered.').replace(/\n/g,'<br>')}</div>
      <div class="secure-form-actions"><button class="secure-primary" id="editSecureEntry">Edit</button><button class="secure-secondary" id="backVault">Back</button></div>`;
    $('#editSecureEntry').addEventListener('click',()=>renderEntryForm(c,e)); $('#backVault').addEventListener('click',()=>renderVaultWorkspace(c));
  }

  function startOfWeek(date=new Date()) { const d=new Date(date); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d; }
  function workloadMetrics() {
    const entries=secureState.data?.entries||[], limits=secureState.data?.limits||defaultData().limits;
    const today=isoDate(), weekStart=startOfWeek(), weekStartStr=weekStart.toISOString().slice(0,10);
    const sessions=entries.filter(e=>e.kind==='Clients' && e.documentType==='Session / Progress Note');
    const sessionsToday=sessions.filter(e=>e.date===today).length;
    const sessionsWeek=sessions.filter(e=>e.date>=weekStartStr && e.date<=today).length;
    const clientMinutesWeek=sessions.filter(e=>e.date>=weekStartStr && e.date<=today).reduce((s,e)=>s+(Number(e.estimatedMinutes)||0),0);
    const personalMinutesWeek=entries.filter(e=>e.kind==='Personal' && e.date>=weekStartStr).reduce((s,e)=>s+(Number(e.estimatedMinutes)||0),0);
    const supervisionMinutesWeek=entries.filter(e=>e.kind==='Supervision' && e.date>=weekStartStr).reduce((s,e)=>s+(Number(e.estimatedMinutes)||0),0);
    const workEndMin=timeToMinutes(limits.workdayEnd||'17:30');
    const afterHoursToday=entries.filter(e=>e.date===today && e.startTime && timeToMinutes(e.startTime)>=workEndMin).reduce((s,e)=>s+(Number(e.estimatedMinutes)||0),0);
    const recentCheckins=[...secureState.data.checkins].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
    const pressure=[];
    if(sessionsToday>Number(limits.maxSessionsDay)) pressure.push(`Client sessions today exceed Irene's limit (${sessionsToday}/${limits.maxSessionsDay}).`);
    if(sessionsWeek>Number(limits.maxSessionsWeek)) pressure.push(`Client sessions this week exceed Irene's limit (${sessionsWeek}/${limits.maxSessionsWeek}).`);
    if(afterHoursToday>Number(limits.maxAfterHoursMinutesDay)) pressure.push(`After-hours work exceeds today's limit (${afterHoursToday} min).`);
    if(personalMinutesWeek<Number(limits.protectedPersonalMinutesWeek)) pressure.push(`Protected personal time is below Irene's weekly target (${personalMinutesWeek}/${limits.protectedPersonalMinutesWeek} min).`);
    if(supervisionMinutesWeek<Number(limits.supervisionMinutesWeek)) pressure.push(`Supervision/professional support is below Irene's weekly target (${supervisionMinutesWeek}/${limits.supervisionMinutesWeek} min).`);
    if(recentCheckins.length>=3 && recentCheckins.every(x=>Number(x.energy)<=2 || Number(x.load)>=4)) pressure.push('Three recent check-ins show sustained high load or low energy. Reduce non-essential work and review support/capacity.');
    return {sessionsToday,sessionsWeek,clientMinutesWeek,personalMinutesWeek,supervisionMinutesWeek,afterHoursToday,recentCheckins,pressure,limits};
  }
  function timeToMinutes(t){ const [h,m]=(t||'0:0').split(':').map(Number); return h*60+m; }

  function renderLoadGuard() {
    if (!secureState.data) return;
    let panel=$('#gigiLoadGuard');
    if(!panel){ panel=document.createElement('section'); panel.id='gigiLoadGuard'; panel.className='load-guard'; $('#gigiSecurityStrip')?.after(panel); }
    const m=workloadMetrics();
    panel.innerHTML=`<div><span class="secure-kicker">GIGI WORKLOAD GUARD</span><h3>${m.pressure.length?'Load pressure needs attention':'Workload within Irene’s current limits'}</h3><p>${secureState.data.limits.configured?'Limits are Irene’s own settings.':'Starter limits are active — Irene should personalise them in Workload Guard.'}</p></div>
      <div class="load-metrics"><span><b>${m.sessionsToday}</b> sessions today</span><span><b>${m.sessionsWeek}</b> this week</span><span><b>${m.personalMinutesWeek}</b> personal min/week</span><span><b>${m.afterHoursToday}</b> after-hours min</span></div>
      <div class="load-alerts">${m.pressure.length?m.pressure.slice(0,3).map(x=>`<span>⚠ ${escapeHtml(x)}</span>`).join(''):'<span>✓ Gigi is protecting capacity, breaks and personal time.</span>'}</div>
      <div class="load-actions"><button id="dailyCheckinBtn" type="button">30-second check-in</button><button id="editLimitsBtn" type="button">Adjust Irene's limits</button></div>`;
    $('#dailyCheckinBtn').addEventListener('click',()=>openCheckin()); $('#editLimitsBtn').addEventListener('click',()=>openSecureWorkspace('workloadGuardModule'));
  }

  function renderLimitsWorkspace(c) {
    const l=secureState.data.limits, m=workloadMetrics();
    c.innerHTML=`<span class="secure-kicker">WORKLOAD GUARD</span><h2>Protect Irene before the diary becomes impossible.</h2>
      <p>These are personal capacity limits, not a universal clinical rule. Irene can change them to match how she safely and sustainably practises.</p>
      <div class="load-summary">${m.pressure.length?m.pressure.map(x=>`<span>⚠ ${escapeHtml(x)}</span>`).join(''):'<span>✓ Current secure workload is within the configured limits.</span>'}</div>
      <form id="limitsForm" class="secure-form">
        <label>Max client sessions / day<input type="number" min="1" max="12" name="maxSessionsDay" value="${l.maxSessionsDay}" /></label>
        <label>Max client sessions / week<input type="number" min="1" max="60" name="maxSessionsWeek" value="${l.maxSessionsWeek}" /></label>
        <label>Max consecutive sessions<input type="number" min="1" max="8" name="maxConsecutiveSessions" value="${l.maxConsecutiveSessions}" /></label>
        <label>Minimum lunch / break (min)<input type="number" min="15" max="180" name="minimumLunchMinutes" value="${l.minimumLunchMinutes}" /></label>
        <label>Normal workday finish<input type="time" name="workdayEnd" value="${attr(l.workdayEnd)}" /></label>
        <label>Max after-hours work / day (min)<input type="number" min="0" max="300" name="maxAfterHoursMinutesDay" value="${l.maxAfterHoursMinutesDay}" /></label>
        <label>Protected personal time / week (min)<input type="number" min="0" max="2000" name="protectedPersonalMinutesWeek" value="${l.protectedPersonalMinutesWeek}" /></label>
        <label>Supervision/support target / week (min)<input type="number" min="0" max="600" name="supervisionMinutesWeek" value="${l.supervisionMinutesWeek}" /></label>
        <div class="secure-form-actions wide"><button class="secure-primary" type="submit">Save Irene's limits</button><button class="secure-secondary" id="openCheckinFromLimits" type="button">Daily check-in</button></div>
      </form>`;
    $('#limitsForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);for(const [k,v]of fd.entries())l[k]=k==='workdayEnd'?v:Number(v);l.configured=true;audit('workload_limits_updated','Irene personalised workload guard limits');await persist();renderLoadGuard();renderLimitsWorkspace(c);});
    $('#openCheckinFromLimits').addEventListener('click',openCheckin);
  }

  function openCheckin() {
    const w=ensureSecureWorkspace(),c=$('#secureWorkspaceContent');
    c.innerHTML=`<span class="secure-kicker">30-SECOND CHECK-IN</span><h2>How is Irene carrying today?</h2><p>This is a workload check, not a diagnosis. Gigi uses the trend to protect capacity.</p>
      <form id="checkinForm" class="secure-form"><label>Energy (1 very low → 5 strong)<input type="range" min="1" max="5" value="3" name="energy" /><output id="energyOut">3</output></label><label>Load pressure (1 light → 5 too much)<input type="range" min="1" max="5" value="3" name="load" /><output id="loadOut">3</output></label><label>Lunch / proper break taken<select name="lunchTaken"><option value="yes">Yes</option><option value="no">No</option></select></label><label>Expected finish time<input type="time" name="finishTime" value="17:30" /></label><label class="wide">Anything Gigi should protect?<textarea name="note" rows="3" placeholder="Optional personal workload note"></textarea></label><div class="secure-form-actions wide"><button class="secure-primary" type="submit">Save check-in</button></div></form>`;
    const energy=$('[name=energy]'), load=$('[name=load]'); energy.oninput=()=>$('#energyOut').textContent=energy.value;load.oninput=()=>$('#loadOut').textContent=load.value;
    $('#checkinForm').addEventListener('submit',async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.currentTarget));const item={id:uid(),date:isoDate(),at:nowIso(),energy:Number(fd.energy),load:Number(fd.load),lunchTaken:fd.lunchTaken==='yes',finishTime:fd.finishTime,note:fd.note};secureState.data.checkins=secureState.data.checkins.filter(x=>x.date!==item.date);secureState.data.checkins.push(item);audit('daily_checkin_saved',`Energy ${item.energy}; load ${item.load}`);await persist();renderLoadGuard();w.close();});
    if(!w.open)w.showModal();
  }

  function renderBackupWorkspace(c) {
    c.innerHTML=`<span class="secure-kicker">ENCRYPTED BACKUP</span><h2>Protect Irene from device loss or browser storage loss.</h2><p>The exported file remains encrypted. Keep the master passphrase separate from the backup. Without the passphrase, the backup cannot be opened by Gigi.</p><div class="backup-actions"><button class="secure-primary" id="exportEncryptedBackup">Download encrypted backup</button><label class="secure-file">Restore encrypted backup<input id="importEncryptedBackup" type="file" accept="application/json,.gigi,.json" /></label></div><p class="secure-warning">Restoring replaces the current encrypted vault on this device and then locks Gigi.</p>`;
    $('#exportEncryptedBackup').addEventListener('click',exportBackup); $('#importEncryptedBackup').addEventListener('change',e=>importBackup(e.target.files?.[0]));
  }

  async function exportBackup() {
    audit('encrypted_backup_exported','Encrypted backup downloaded'); await persist();
    const record=await dbGet(VAULT_KEY); const blob=new Blob([JSON.stringify({format:'GIGI-SECURE-VAULT',exportedAt:nowIso(),record},null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=`Gigi_Irene_Encrypted_Backup_${isoDate()}.gigi.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importBackup(file) {
    if(!file)return; try{const parsed=JSON.parse(await file.text()); if(parsed.format!=='GIGI-SECURE-VAULT'||!parsed.record?.ciphertext)throw new Error('Not a Gigi encrypted backup.'); if(!confirm('Replace this device vault with the selected encrypted backup?'))return; await dbPut(VAULT_KEY,parsed.record); ensureSecureWorkspace().close(); lockVault('Encrypted backup restored. Enter its passphrase to unlock.'); await initialiseGate();}catch(e){alert(e.message);}
  }

  function renderPrivacyWorkspace(c) {
    const auditRows=(secureState.data.audit||[]).slice(0,30);
    c.innerHTML=`<span class="secure-kicker">PRIVACY & AUDIT</span><h2>Privacy-by-design protections</h2>
      <div class="privacy-control-grid"><span><b>Device vault</b>AES-GCM encrypted</span><span><b>Auto-lock</b>${secureState.idleMinutes} minutes idle</span><span><b>Network data sync</b>Off</span><span><b>Clinical voice dictation</b>Blocked by design</span></div>
      <label class="idle-setting">Auto-lock after <select id="idleMinutesSelect">${[2,5,10,15].map(x=>`<option value="${x}" ${secureState.idleMinutes===x?'selected':''}>${x} minutes</option>`).join('')}</select></label>
      <h3>Encrypted audit history</h3><div class="audit-list">${auditRows.map(a=>`<div><b>${escapeHtml(a.action)}</b><span>${new Date(a.at).toLocaleString('en-AU')}</span><small>${escapeHtml(a.detail||'')}</small></div>`).join('')||'<p>No audit events yet.</p>'}</div>
      <div class="secure-danger-zone"><h3>Danger zone</h3><p>Deleting the vault permanently removes Irene's locally stored information from this browser.</p><button class="secure-danger" id="deleteVaultBtn">Delete local vault</button></div>`;
    $('#idleMinutesSelect').addEventListener('change',e=>{secureState.idleMinutes=Number(e.target.value);localStorage.setItem('gigiIdleMinutes',String(secureState.idleMinutes));resetAutoLock();});
    $('#deleteVaultBtn').addEventListener('click',async()=>{const phrase=prompt('Type DELETE GIGI VAULT to permanently delete the encrypted local vault.');if(phrase!=='DELETE GIGI VAULT')return;await dbDelete(VAULT_KEY);ensureSecureWorkspace().close();secureState.key=null;secureState.data=null;lockVault('Local vault deleted from this browser.');await initialiseGate();});
  }

  function renderProtectionPanel() { injectSecurityStrip(); injectSecureModules(); }
  function updateLockButton(unlocked) { const b=$('#quickLockBtn'); if(b)b.textContent=unlocked?'Lock now':'Locked'; }
  function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function attr(v=''){return escapeHtml(v).replace(/`/g,'&#96;');}

  async function boot() {
    buildGate(); bindGate(); attachActivityWatchers(); await initialiseGate();
    injectSecurityStrip(); injectSecureModules();
    document.body.classList.add('vault-locked');
  }

  window.GigiVault = {
    lock: lockVault,
    isUnlocked: () => !!secureState.key,
    open: () => openSecureWorkspace('secureVaultModule'),
    getWorkload: () => secureState.data ? workloadMetrics() : null,
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
