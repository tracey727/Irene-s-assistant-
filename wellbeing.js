(() => {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    workdayStart: '08:00',
    workdayEnd: '17:30',
    waterEveryMinutes: 90,
    morningSnackTime: '10:30',
    lunchTime: '12:30',
    afternoonSnackTime: '15:30',
    clinicalQuietMinutes: 60,
    voicePrompts: true,
    desktopNotifications: false,
    dietaryNotes: '',
    snackPreferences: [],
  };

  const SNACKS = [
    { name:'Banana + small handful of nuts', prep:'Under 1 minute', tags:['no-cook','portable'] },
    { name:'Apple or pear + nut butter sachet', prep:'Under 1 minute', tags:['no-cook','portable'] },
    { name:'Boiled egg + cherry tomatoes', prep:'Prep eggs ahead', tags:['protein','portable'] },
    { name:'Plain yoghurt + berries', prep:'2 minutes', tags:['protein','cool-bag'] },
    { name:'Cheese cubes + grapes', prep:'2 minutes', tags:['portable','cool-bag'] },
    { name:'Hummus + baby carrots or cucumber', prep:'2 minutes', tags:['vegetarian','cool-bag'] },
    { name:'Rice cakes + peanut or almond butter', prep:'1 minute', tags:['portable','no-cook'] },
    { name:'Small trail-mix portion', prep:'Pack once for several days', tags:['portable','no-cook'] },
    { name:'Mandarin + roasted chickpeas', prep:'Under 1 minute', tags:['portable','no-cook'] },
    { name:'Wholegrain crackers + tuna pouch', prep:'1 minute', tags:['protein','portable'] },
  ];

  const state = {
    settings: { ...DEFAULTS, ...JSON.parse(localStorage.getItem('gigiWellbeingSettings') || '{}') },
    quietUntil: Number(localStorage.getItem('gigiClinicalQuietUntil') || 0),
    lastWaterAt: Number(localStorage.getItem('gigiLastWaterAt') || 0),
    lastPromptKeys: JSON.parse(localStorage.getItem('gigiWellbeingPromptKeys') || '[]'),
    timer: null,
  };

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const nowMinutes = () => { const d=new Date(); return d.getHours()*60+d.getMinutes(); };
  const timeToMinutes = t => { const [h,m]=(t||'00:00').split(':').map(Number); return h*60+m; };
  const dateKey = () => new Date().toISOString().slice(0,10);

  function saveSettings() {
    localStorage.setItem('gigiWellbeingSettings', JSON.stringify(state.settings));
  }

  function say(text) {
    if (!state.settings.voicePrompts || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find(v=>v.lang?.toLowerCase()==='en-za') || voices.find(v=>v.lang?.toLowerCase().startsWith('en-au')) || voices.find(v=>v.lang?.toLowerCase().startsWith('en-gb')) || voices.find(v=>v.lang?.toLowerCase().startsWith('en')) || null;
    u.rate = .96;
    u.pitch = 1.02;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function notify(title, body) {
    showBanner(title, body);
    say(body);
    if (state.settings.desktopNotifications && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon:'/assets/gigi-mark.svg', tag:`gigi-${Date.now()}` }); } catch (_) {}
    }
  }

  function showBanner(title, body) {
    let banner = $('#gigiWellbeingBanner');
    if (!banner) {
      banner = document.createElement('aside');
      banner.id = 'gigiWellbeingBanner';
      banner.className = 'gigi-wellbeing-banner';
      banner.innerHTML = '<div><span class="wellbeing-icon">♡</span><div><b id="wellbeingBannerTitle"></b><p id="wellbeingBannerBody"></p></div></div><div class="wellbeing-banner-actions"><button id="wellbeingDone">Done</button><button id="wellbeingSnooze">Snooze 20 min</button><button id="wellbeingClose">×</button></div>';
      document.body.append(banner);
      $('#wellbeingDone').onclick = () => banner.classList.remove('show');
      $('#wellbeingClose').onclick = () => banner.classList.remove('show');
      $('#wellbeingSnooze').onclick = () => { banner.classList.remove('show'); setTimeout(checkPrompts, 20*60*1000); };
    }
    $('#wellbeingBannerTitle').textContent = title;
    $('#wellbeingBannerBody').textContent = body;
    banner.classList.add('show');
  }

  function promptOnce(key, title, body) {
    const full = `${dateKey()}:${key}`;
    if (state.lastPromptKeys.includes(full)) return;
    state.lastPromptKeys = state.lastPromptKeys.filter(k => k.startsWith(dateKey()+':'));
    state.lastPromptKeys.push(full);
    localStorage.setItem('gigiWellbeingPromptKeys', JSON.stringify(state.lastPromptKeys));
    notify(title, body);
  }

  function inWorkday() {
    const n=nowMinutes();
    return n >= timeToMinutes(state.settings.workdayStart) && n <= timeToMinutes(state.settings.workdayEnd);
  }

  function inClinicalQuiet() {
    return Date.now() < state.quietUntil;
  }

  function deferIfQuiet(fn) {
    if (!inClinicalQuiet()) return false;
    const wait = Math.max(1000, state.quietUntil - Date.now() + 30000);
    setTimeout(fn, wait);
    return true;
  }

  function checkPrompts() {
    if (!state.settings.enabled || !inWorkday()) return;
    if (inClinicalQuiet()) return;

    const now = new Date();
    const n = nowMinutes();

    if (!state.lastWaterAt) state.lastWaterAt = now.getTime();
    if (now.getTime() - state.lastWaterAt >= state.settings.waterEveryMinutes * 60 * 1000) {
      state.lastWaterAt = now.getTime();
      localStorage.setItem('gigiLastWaterAt', String(state.lastWaterAt));
      notify('Gigi water check', 'Irene, quick water break. A few good sips now is enough — then back to what matters.');
    }

    const snack1 = timeToMinutes(state.settings.morningSnackTime);
    const lunch = timeToMinutes(state.settings.lunchTime);
    const snack2 = timeToMinutes(state.settings.afternoonSnackTime);

    if (n >= snack1 && n < snack1 + 20) promptOnce('morning-snack','Gigi food check','Irene, have you eaten something this morning? Keep it easy — fruit, nuts, a boiled egg, yoghurt, or something else you packed.');
    if (n >= lunch && n < lunch + 25) promptOnce('lunch','Gigi lunch protection','Irene, this is your lunch window. Please eat before the next block of work if you can. Gigi can protect the time; you do not need to earn the break.');
    if (n >= snack2 && n < snack2 + 20) promptOnce('afternoon-snack','Gigi afternoon check','Irene, quick fuel check. A small snack now may make the last part of the day easier.');
  }

  function startClinicalQuiet(minutes = state.settings.clinicalQuietMinutes) {
    state.quietUntil = Date.now() + minutes*60*1000;
    localStorage.setItem('gigiClinicalQuietUntil', String(state.quietUntil));
    showBanner('Clinical quiet mode', `Wellbeing prompts are paused for ${minutes} minutes. Gigi will wait until the session is over.`);
  }

  function endClinicalQuiet() {
    state.quietUntil = 0;
    localStorage.removeItem('gigiClinicalQuietUntil');
    showBanner('Clinical quiet ended', 'Gigi is available again. No missed prompt will interrupt you all at once.');
  }

  function randomSnack() {
    const list = filteredSnacks();
    return list[Math.floor(Math.random()*list.length)] || SNACKS[0];
  }

  function filteredSnacks() {
    const notes = (state.settings.dietaryNotes||'').toLowerCase();
    return SNACKS.filter(s => {
      const n=s.name.toLowerCase();
      if (notes.includes('dairy-free') || notes.includes('no dairy')) if (/yoghurt|cheese/.test(n)) return false;
      if (notes.includes('nut-free') || notes.includes('no nuts')) if (/nut|peanut|almond|trail-mix/.test(n)) return false;
      if (notes.includes('vegetarian')) if (/tuna/.test(n)) return false;
      return true;
    });
  }

  function injectDashboardCard() {
    if ($('#gigiWellbeingCard')) return;
    const dashboard = $('#dashboardView');
    if (!dashboard) return;
    const card = document.createElement('section');
    card.id='gigiWellbeingCard';
    card.className='wellbeing-card';
    const snack=randomSnack();
    card.innerHTML=`<div><span class="secure-kicker">GIGI WELLBEING GUARD</span><h3>Food, water and energy count as part of the workday.</h3><p>Gentle prompts are active during Irene's workday and can be paused instantly for a client session.</p></div><div class="wellbeing-quick"><button id="waterNowBtn" type="button">💧 I drank water</button><button id="clinicalQuietBtn" type="button">🔕 Client session quiet</button><button id="snackIdeaBtn" type="button">🍎 Snack idea</button></div><div class="snack-suggestion"><b>Easy pack-today idea</b><span id="snackSuggestion">${snack.name}</span><small>${snack.prep}</small></div>`;
    const guard=$('#gigiLoadGuard');
    if (guard) guard.after(card); else dashboard.prepend(card);
    $('#waterNowBtn').onclick=()=>{state.lastWaterAt=Date.now();localStorage.setItem('gigiLastWaterAt',String(state.lastWaterAt));showBanner('Water logged','Good. Gigi will start the next water interval from now.');};
    $('#clinicalQuietBtn').onclick=()=>{ if(inClinicalQuiet()) endClinicalQuiet(); else startClinicalQuiet(); };
    $('#snackIdeaBtn').onclick=()=>{const s=randomSnack();$('#snackSuggestion').textContent=s.name;showBanner('Quick snack idea',`${s.name}. ${s.prep}.`);};
  }

  function injectModule() {
    const grid=$('#moreView .module-grid');
    if(!grid || $('#wellbeingModule')) return;
    const b=document.createElement('button'); b.id='wellbeingModule'; b.className='module-card'; b.type='button';
    b.innerHTML='<b>Wellbeing Guard</b><span>Water, food, quick snacks and client-session quiet mode</span><em>Gentle</em>';
    b.onclick=openSettings;
    grid.append(b);
  }

  function openSettings() {
    let d=$('#wellbeingDialog');
    if(!d){d=document.createElement('dialog');d.id='wellbeingDialog';d.className='secure-workspace';document.body.append(d);}
    const s=state.settings;
    const snacks=filteredSnacks();
    d.innerHTML=`<div class="secure-workspace-inner"><button class="secure-close" id="wellbeingDialogClose">×</button><span class="secure-kicker">WELLBEING GUARD</span><h2>Keep Irene fed, hydrated and protected.</h2><p>These prompts are practical executive-function supports, not medical advice. Gigi can pause them during client work.</p><form id="wellbeingForm" class="secure-form"><label>Workday starts<input type="time" name="workdayStart" value="${s.workdayStart}"></label><label>Workday finishes<input type="time" name="workdayEnd" value="${s.workdayEnd}"></label><label>Water reminder every<select name="waterEveryMinutes">${[60,75,90,120].map(x=>`<option value="${x}" ${Number(s.waterEveryMinutes)===x?'selected':''}>${x} minutes</option>`).join('')}</select></label><label>Morning snack<input type="time" name="morningSnackTime" value="${s.morningSnackTime}"></label><label>Lunch reminder<input type="time" name="lunchTime" value="${s.lunchTime}"></label><label>Afternoon snack<input type="time" name="afternoonSnackTime" value="${s.afternoonSnackTime}"></label><label>Client quiet duration<select name="clinicalQuietMinutes">${[50,60,75,90].map(x=>`<option value="${x}" ${Number(s.clinicalQuietMinutes)===x?'selected':''}>${x} minutes</option>`).join('')}</select></label><label>Voice prompts<select name="voicePrompts"><option value="yes" ${s.voicePrompts?'selected':''}>On</option><option value="no" ${!s.voicePrompts?'selected':''}>Off</option></select></label><label class="wide">Dietary / allergy notes<input name="dietaryNotes" value="${escapeHtml(s.dietaryNotes)}" placeholder="e.g. dairy-free, nut-free, vegetarian"></label><div class="secure-form-actions wide"><button class="secure-primary" type="submit">Save wellbeing settings</button><button class="secure-secondary" id="testWellbeingPrompt" type="button">Test Gigi prompt</button><button class="secure-secondary" id="enableNotificationsBtn" type="button">Enable device notifications</button></div></form><div class="snack-library"><h3>Fast workday snack ideas</h3>${snacks.map(x=>`<div><b>${escapeHtml(x.name)}</b><span>${escapeHtml(x.prep)}</span></div>`).join('')}</div></div>`;
    $('#wellbeingDialogClose').onclick=()=>d.close();
    $('#wellbeingForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget);s.workdayStart=fd.get('workdayStart');s.workdayEnd=fd.get('workdayEnd');s.waterEveryMinutes=Number(fd.get('waterEveryMinutes'));s.morningSnackTime=fd.get('morningSnackTime');s.lunchTime=fd.get('lunchTime');s.afternoonSnackTime=fd.get('afternoonSnackTime');s.clinicalQuietMinutes=Number(fd.get('clinicalQuietMinutes'));s.voicePrompts=fd.get('voicePrompts')==='yes';s.dietaryNotes=fd.get('dietaryNotes')||'';saveSettings();injectDashboardCard();showBanner('Wellbeing settings saved','Gigi will use Irene’s chosen food and water schedule.');d.close();};
    $('#testWellbeingPrompt').onclick=()=>notify('Gigi wellbeing check','Irene, quick check: water, something to eat, and a moment to reset if you need it.');
    $('#enableNotificationsBtn').onclick=async()=>{if(!('Notification'in window))return showBanner('Notifications unavailable','This browser does not support web notifications.');const p=await Notification.requestPermission();state.settings.desktopNotifications=p==='granted';saveSettings();showBanner('Notification setting',p==='granted'?'Device notifications are enabled while the web app can run.':'Notifications were not enabled. In-app prompts will still work.');};
    d.showModal();
  }

  function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  function boot(){
    injectModule();
    document.addEventListener('gigi-vault-unlocked',()=>{injectDashboardCard();injectModule();});
    setTimeout(()=>{injectDashboardCard();injectModule();},1000);
    clearInterval(state.timer);
    state.timer=setInterval(checkPrompts,60*1000);
    setTimeout(checkPrompts,4000);
  }

  window.GigiWellbeing = { startClinicalQuiet, endClinicalQuiet, openSettings, randomSnack, checkPrompts };
  document.addEventListener('DOMContentLoaded',boot);
})();
