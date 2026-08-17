(() => {
  'use strict';

  const SETTINGS_KEY = 'gigiDayArchitectSettings';
  const PLANNED_KEY = 'gigiDayArchitectLastPlanned';
  const defaults = {
    enabled: true,
    autoProtectDaily: true,
    workStart: '08:00',
    workEnd: '17:30',
    morningPlanningMinutes: 15,
    lunchTarget: '12:30',
    lunchMinutes: 30,
    personalGrowthTarget: '16:00',
    personalGrowthMinutes: 30,
    shutdownMinutes: 20,
    transitionMinutes: 10,
  };

  const settings = { ...defaults, ...safeParse(localStorage.getItem(SETTINGS_KEY), {}) };
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  function safeParse(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function toMinutes(t) {
    const [h,m] = String(t || '00:00').split(':').map(Number);
    return h * 60 + m;
  }

  function toClock(total) {
    const v = Math.max(0, Math.min(1439, Math.round(total)));
    return `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
  }

  function parseDisplayTime(text) {
    const m = String(text).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[3].toUpperCase();
    if (h === 12) h = 0;
    if (ap === 'PM') h += 12;
    return h * 60 + min;
  }

  function readTodayBlocks() {
    return $$('#timeline .event-row').map(row => {
      const timeText = row.querySelector('.event-time')?.textContent || '';
      const matches = [...timeText.matchAll(/\d{1,2}:\d{2}\s*(?:AM|PM)/gi)].map(x => parseDisplayTime(x[0]));
      const info = row.querySelector('.event-info');
      const title = info?.querySelector('strong')?.textContent?.trim() || 'Time block';
      const meta = info?.querySelector('span')?.textContent || '';
      const category = meta.split('•')[0]?.trim() || 'Business';
      return { title, category, start: matches[0], end: matches[1], protected: row.classList.contains('protected') };
    }).filter(b => Number.isFinite(b.start) && Number.isFinite(b.end)).sort((a,b)=>a.start-b.start);
  }

  function isUnlocked() {
    return $('#appShell')?.getAttribute('aria-busy') === 'false' && !$('#gigiGate');
  }

  function overlaps(blocks, start, end) {
    return blocks.some(b => start < b.end && end > b.start);
  }

  function findSlot(blocks, target, duration, earliest, latest, prefer = 'nearest') {
    const candidates = [];
    for (let s = earliest; s + duration <= latest; s += 5) {
      if (!overlaps(blocks, s, s + duration)) candidates.push(s);
    }
    if (!candidates.length) return null;
    if (prefer === 'latest') return candidates[candidates.length - 1];
    if (prefer === 'earliest') return candidates[0];
    return candidates.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0];
  }

  function hasNamedBlock(blocks, words) {
    return blocks.some(b => words.some(w => b.title.toLowerCase().includes(w)));
  }

  function clinicalBlocks(blocks) {
    return blocks.filter(b => b.category.toLowerCase().includes('clinical') || b.title.toLowerCase().includes('client session'));
  }

  function nextCommitment(blocks) {
    const now = new Date();
    const n = now.getHours()*60 + now.getMinutes();
    return blocks.find(b => b.end > n) || null;
  }

  function durationText(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes/60), m = minutes%60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function showBanner(title, body) {
    let el = $('#dayArchitectBanner');
    if (!el) {
      el = document.createElement('aside');
      el.id = 'dayArchitectBanner';
      el.className = 'day-architect-banner';
      el.innerHTML = '<div><span>♛</span><div><b id="dayArchitectBannerTitle"></b><p id="dayArchitectBannerBody"></p></div></div><button type="button" id="dayArchitectBannerClose">Done</button>';
      document.body.append(el);
      $('#dayArchitectBannerClose').onclick = () => el.classList.remove('show');
    }
    $('#dayArchitectBannerTitle').textContent = title;
    $('#dayArchitectBannerBody').textContent = body;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 14000);
  }

  function speak(text) {
    if (localStorage.getItem('gigiVoiceOn') === 'false' || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find(v => v.lang?.toLowerCase() === 'en-za') || voices.find(v => v.lang?.toLowerCase().startsWith('en-za')) || voices.find(v => v.lang?.toLowerCase().startsWith('en-au')) || voices.find(v => v.lang?.toLowerCase().startsWith('en-gb')) || voices.find(v => v.lang?.toLowerCase().startsWith('en')) || null;
    u.lang = 'en-ZA';
    u.rate = .95;
    u.pitch = 1.02;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function addProtectedBlock({ title, start, end, category }) {
    if (!isUnlocked()) throw new Error('Unlock Gigi first.');
    const dialog = $('#scheduleDialog');
    const form = $('#scheduleForm');
    if (!dialog || !form) throw new Error('Gigi scheduling is unavailable.');

    dialog.classList.add('day-architect-silent');
    if (!dialog.open) dialog.showModal();
    form.date.value = todayKey();
    form.title.value = title;
    form.start.value = toClock(start);
    form.end.value = toClock(end);
    form.category.value = category;
    form.protected.value = 'yes';
    form.requestSubmit();

    for (let i=0; i<20; i++) {
      await wait(120);
      if (!dialog.open) break;
    }
    dialog.classList.remove('day-architect-silent');
    await wait(120);
  }

  function carePlan(blocks) {
    const workStart = toMinutes(settings.workStart);
    const workEnd = toMinutes(settings.workEnd);
    const plan = [];
    let working = [...blocks];

    const propose = (title, duration, target, earliest, latest, category, words, prefer='nearest') => {
      if (hasNamedBlock(working, words)) return;
      const start = findSlot(working, target, duration, earliest, latest, prefer);
      if (start == null) return;
      const item = { title, start, end:start+duration, category };
      plan.push(item);
      working.push({ ...item, protected:true });
      working.sort((a,b)=>a.start-b.start);
    };

    propose('Gigi Morning Command', settings.morningPlanningMinutes, workStart, workStart, Math.min(workStart+120, workEnd), 'Personal', ['morning command','day planning'], 'earliest');
    propose('Protected Lunch · Reset, Refuel, Realign', settings.lunchMinutes, toMinutes(settings.lunchTarget), Math.max(workStart, 11*60+30), Math.min(workEnd, 14*60+15), 'Break', ['protected lunch','lunch']);
    propose('Irene · Personal Growth & Reflection', settings.personalGrowthMinutes, toMinutes(settings.personalGrowthTarget), Math.max(workStart, 14*60), Math.min(workEnd, 17*60+15), 'Personal', ['personal growth','reflection','irene time']);
    propose('Gigi End-of-Day Shutdown', settings.shutdownMinutes, workEnd-settings.shutdownMinutes, Math.max(workStart, workEnd-90), workEnd, 'Personal', ['end-of-day shutdown','shutdown'], 'latest');

    return plan;
  }

  async function structureDay({ auto = false } = {}) {
    if (!isUnlocked()) {
      showBanner('Gigi is locked', 'Unlock Irene’s private workspace and Gigi can structure the day safely.');
      return;
    }

    const before = readTodayBlocks();
    const plan = carePlan(before);
    if (!plan.length) {
      renderCard();
      if (!auto) {
        showBanner('Today is already protected', 'Lunch, personal growth and day-closing time are already present or there is no safe free window to add them without touching appointments.');
        speak('Today is already protected, or there is no safe free window. I have not moved any appointments.');
      }
      localStorage.setItem(PLANNED_KEY, todayKey());
      return;
    }

    for (const item of plan) {
      const latest = readTodayBlocks();
      if (!overlaps(latest, item.start, item.end)) {
        try { await addProtectedBlock(item); } catch (e) { console.warn('Gigi Day Architect could not add block', e); }
      }
    }
    localStorage.setItem(PLANNED_KEY, todayKey());
    renderCard();
    const added = plan.length;
    const message = `I protected ${added} part${added===1?'':'s'} of Irene’s day without moving existing appointments: planning, food and reset time, personal growth, and shutdown where space allowed.`;
    showBanner('Gigi structured today', message);
    if (!auto) speak(message);
  }

  function scheduleRisk(blocks) {
    const clinical = clinicalBlocks(blocks);
    let consecutive = 0, maxConsecutive = 0;
    let previousEnd = null;
    for (const b of blocks) {
      const isClinical = clinical.includes(b);
      if (isClinical) {
        if (previousEnd != null && b.start - previousEnd <= 10) consecutive += 1; else consecutive = 1;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
        previousEnd = b.end;
      } else {
        consecutive = 0;
        previousEnd = null;
      }
    }
    const hasLunch = hasNamedBlock(blocks,['lunch']);
    const hasGrowth = hasNamedBlock(blocks,['personal growth','reflection','irene time']);
    const hasShutdown = hasNamedBlock(blocks,['shutdown']);
    const risks = [];
    if (maxConsecutive >= 4) risks.push(`${maxConsecutive} clinical blocks are tightly grouped`);
    if (!hasLunch) risks.push('lunch is not protected');
    if (!hasGrowth) risks.push('personal growth time is not protected');
    if (!hasShutdown) risks.push('no end-of-day shutdown is protected');
    return { risks, clinicalCount:clinical.length, hasLunch, hasGrowth, hasShutdown };
  }

  function renderCard() {
    const host = $('#dashboardView');
    if (!host) return;
    let card = $('#gigiDayArchitectCard');
    if (!card) {
      card = document.createElement('section');
      card.id = 'gigiDayArchitectCard';
      card.className = 'day-architect-card';
      const wellbeing = $('#wellbeingCard');
      if (wellbeing) wellbeing.before(card); else host.append(card);
    }
    const blocks = isUnlocked() ? readTodayBlocks() : [];
    const risk = scheduleRisk(blocks);
    const next = nextCommitment(blocks);
    const nextText = next ? `${toClock(next.start)} · ${next.title}` : 'No remaining commitment shown';
    const protectedCount = [risk.hasLunch,risk.hasGrowth,risk.hasShutdown].filter(Boolean).length;
    card.innerHTML = `
      <div class="day-architect-copy">
        <span class="section-kicker">GIGI DAY ARCHITECT</span>
        <h3>Appointments stay fixed. Gigi structures the life around them.</h3>
        <p>Gigi protects realistic work time, lunch, water and food prompts, transition space, personal growth and a clean finish — without silently moving a client appointment.</p>
      </div>
      <div class="day-architect-stats">
        <div><small>Next commitment</small><b>${escapeHtml(nextText)}</b></div>
        <div><small>Clinical blocks today</small><b>${risk.clinicalCount}</b></div>
        <div><small>Personal protections</small><b>${protectedCount}/3</b></div>
      </div>
      <div class="day-architect-actions">
        <button type="button" class="day-primary" id="structureDayNow">✦ Structure my day</button>
        <button type="button" id="dayArchitectSettings">⚙ Day preferences</button>
        <button type="button" id="protectGrowthNow">♡ Protect personal growth</button>
      </div>
      <div class="day-architect-risk ${risk.risks.length?'is-alert':''}">
        <b>${risk.risks.length ? 'Gigi is watching:' : 'Gigi check:'}</b>
        <span>${risk.risks.length ? escapeHtml(risk.risks.join(' • ')) : 'The main personal protections are present. Gigi will still preserve appointments and clinical quiet.'}</span>
      </div>`;

    $('#structureDayNow').onclick = () => structureDay();
    $('#dayArchitectSettings').onclick = openSettings;
    $('#protectGrowthNow').onclick = protectGrowth;
  }

  function escapeHtml(v='') {
    return String(v).replace(/[&<>'\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
  }

  async function protectGrowth() {
    if (!isUnlocked()) return showBanner('Unlock Gigi first', 'Personal growth time is stored as a protected block inside Irene’s private workspace.');
    const blocks = readTodayBlocks();
    if (hasNamedBlock(blocks,['personal growth','reflection','irene time'])) {
      showBanner('Personal growth is protected', 'Irene already has protected personal-growth or reflection time today.');
      return;
    }
    const start = findSlot(blocks, toMinutes(settings.personalGrowthTarget), settings.personalGrowthMinutes, 14*60, Math.min(toMinutes(settings.workEnd),17*60+15));
    if (start == null) {
      showBanner('No safe free window', 'Gigi did not move an appointment. Open Calendar and choose where Irene wants personal time protected.');
      return;
    }
    await addProtectedBlock({title:'Irene · Personal Growth & Reflection',start,end:start+settings.personalGrowthMinutes,category:'Personal'});
    renderCard();
    showBanner('Personal growth protected', `${durationText(settings.personalGrowthMinutes)} is now protected for Irene today.`);
    speak('I have protected time for your own growth today, Irene.');
  }

  function openSettings() {
    let d = $('#dayArchitectDialog');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'dayArchitectDialog';
      d.className = 'action-dialog day-architect-dialog';
      document.body.append(d);
    }
    d.innerHTML = `<form method="dialog"><button class="dialog-close" value="cancel" aria-label="Close">×</button></form><div class="dialog-body"><span class="dialog-kicker">GIGI DAY ARCHITECT</span><h3>Protect Irene’s time as deliberately as the appointments.</h3><p class="day-settings-note">These settings contain routine preferences only. Gigi never moves an existing appointment automatically.</p><form id="dayArchitectForm" class="gigi-form"><label>Workday starts<input type="time" name="workStart" value="${settings.workStart}"></label><label>Workday ends<input type="time" name="workEnd" value="${settings.workEnd}"></label><label>Morning planning<select name="morningPlanningMinutes">${[10,15,20,30].map(x=>`<option value="${x}" ${settings.morningPlanningMinutes===x?'selected':''}>${x} min</option>`).join('')}</select></label><label>Lunch target<input type="time" name="lunchTarget" value="${settings.lunchTarget}"></label><label>Protected lunch<select name="lunchMinutes">${[30,45,60].map(x=>`<option value="${x}" ${settings.lunchMinutes===x?'selected':''}>${x} min</option>`).join('')}</select></label><label>Personal growth target<input type="time" name="personalGrowthTarget" value="${settings.personalGrowthTarget}"></label><label>Personal growth<select name="personalGrowthMinutes">${[20,30,45,60].map(x=>`<option value="${x}" ${settings.personalGrowthMinutes===x?'selected':''}>${x} min</option>`).join('')}</select></label><label>End-of-day shutdown<select name="shutdownMinutes">${[15,20,30].map(x=>`<option value="${x}" ${settings.shutdownMinutes===x?'selected':''}>${x} min</option>`).join('')}</select></label><label>Auto-protect each day<select name="autoProtectDaily"><option value="yes" ${settings.autoProtectDaily?'selected':''}>On</option><option value="no" ${!settings.autoProtectDaily?'selected':''}>Off</option></select></label><div class="dialog-actions wide"><button class="primary-action" type="submit">Save Day Architect</button><button class="secondary-action" type="button" id="dayPlanAfterSave">Save + structure today</button></div></form></div>`;
    const form = $('#dayArchitectForm', d);
    const save = async (alsoPlan) => {
      const fd = new FormData(form);
      settings.workStart = fd.get('workStart');
      settings.workEnd = fd.get('workEnd');
      settings.morningPlanningMinutes = Number(fd.get('morningPlanningMinutes'));
      settings.lunchTarget = fd.get('lunchTarget');
      settings.lunchMinutes = Number(fd.get('lunchMinutes'));
      settings.personalGrowthTarget = fd.get('personalGrowthTarget');
      settings.personalGrowthMinutes = Number(fd.get('personalGrowthMinutes'));
      settings.shutdownMinutes = Number(fd.get('shutdownMinutes'));
      settings.autoProtectDaily = fd.get('autoProtectDaily') === 'yes';
      saveSettings();
      d.close();
      renderCard();
      showBanner('Day preferences saved', 'Gigi will use these limits when shaping Irene’s day.');
      if (alsoPlan) await structureDay();
    };
    form.onsubmit = e => { e.preventDefault(); save(false); };
    $('#dayPlanAfterSave', d).onclick = () => save(true);
    d.showModal();
  }

  function injectModule() {
    const grid = $('#moreView .module-grid');
    if (!grid || $('#dayArchitectModule')) return;
    const b = document.createElement('button');
    b.id = 'dayArchitectModule';
    b.className = 'module-card';
    b.type = 'button';
    b.innerHTML = '<b>Day Architect</b><span>Appointments, protected breaks, personal growth and realistic capacity</span><em>Active</em>';
    b.onclick = openSettings;
    const settingsCard = grid.querySelector('[data-panel="settings"]');
    if (settingsCard) settingsCard.before(b); else grid.append(b);
  }

  function injectCalendarHelp() {
    const view = $('#calendarView');
    if (!view || $('#dayArchitectCalendarNote')) return;
    const note = document.createElement('div');
    note.id = 'dayArchitectCalendarNote';
    note.className = 'day-calendar-note';
    note.innerHTML = '<span>♛</span><div><b>Appointment rule</b><p>Enter Irene’s real appointments and fixed commitments here. Gigi treats them as fixed, then structures breaks, buffers, food, water prompts and personal time around them.</p></div><button type="button">Structure today</button>';
    note.querySelector('button').onclick = () => structureDay();
    view.querySelector('.page-actions')?.after(note);
  }

  function watchUnlock() {
    const shell = $('#appShell');
    if (!shell) return;
    const onChange = () => {
      renderCard();
      injectModule();
      injectCalendarHelp();
      if (isUnlocked() && settings.enabled && settings.autoProtectDaily && localStorage.getItem(PLANNED_KEY) !== todayKey()) {
        setTimeout(() => structureDay({auto:true}), 900);
      }
    };
    new MutationObserver(onChange).observe(shell,{attributes:true,attributeFilter:['aria-busy']});
    const timeline = $('#timeline');
    if (timeline) new MutationObserver(()=>renderCard()).observe(timeline,{childList:true,subtree:true});
    onChange();
  }

  function boot() {
    injectModule();
    injectCalendarHelp();
    renderCard();
    watchUnlock();
    setInterval(() => isUnlocked() && renderCard(), 5*60*1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
