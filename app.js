(() => {
  const demoSchedule = [
    { id:'client-a', start:'08:30', end:'09:20', title:'Client Session — Client A', subtitle:'50 min • Therapy session', category:'Clients', icon:'◎' },
    { id:'supervision', start:'09:30', end:'10:20', title:'Supervision — Clinician A', subtitle:'50 min • Professional supervision', category:'Supervision', icon:'◌' },
    { id:'client-b', start:'10:30', end:'11:20', title:'Client Session — Client B', subtitle:'50 min • NDIS plan review', category:'Clients', icon:'◎' },
    { id:'lunch', start:'12:00', end:'13:00', title:'Protected Lunch', subtitle:'60 min • Reset. Refuel. Realign.', category:'Personal', icon:'♨', protected:true },
    { id:'ndis', start:'13:10', end:'14:00', title:'NDIS Letter Review', subtitle:'50 min • Report & compliance', category:'Clients', icon:'▤' },
    { id:'deep-work', start:'14:15', end:'16:15', title:'Deep Work Block', subtitle:'120 min • Business priorities', category:'Business', icon:'★', protected:true }
  ];

  const state = {
    voiceOn: localStorage.getItem('gigiVoiceOn') !== 'false',
    completed: JSON.parse(localStorage.getItem('gigiCompleted') || '[]'),
    listening:false,
    currentView:'dashboard'
  };

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const el = (tag, cls, html='') => { const n=document.createElement(tag); if(cls)n.className=cls; n.innerHTML=html; return n; };

  function minutes(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
  function duration(a,b){ return minutes(b)-minutes(a); }
  function formatTime(t){ let [h,m]=t.split(':').map(Number); const ap=h>=12?'PM':'AM'; h=h%12||12; return `${h}:${String(m).padStart(2,'0')} ${ap}`; }
  function formatDuration(total){ const h=Math.floor(total/60), m=total%60; return h ? `${h}h ${m}m` : `${m}m`; }
  function getDayCapacity(){
    const workStart=8*60, workEnd=17*60+30;
    const scheduled = demoSchedule.reduce((s,e)=>s+duration(e.start,e.end),0);
    const transitionReserve = 35;
    const rawFree = Math.max(0,(workEnd-workStart)-scheduled-transitionReserve);
    const realistic = Math.floor(rawFree*.68);
    return {rawFree, realistic, scheduled, transitionReserve};
  }

  function renderSchedule(){
    const wrap=$('#timeline'); wrap.innerHTML='';
    demoSchedule.filter(e=>e.id!=='deep-work').forEach(e=>{
      const row=el('button',`event-row${e.protected?' protected':''}`); row.type='button'; row.dataset.event=e.id;
      row.innerHTML=`<span class="event-time"><b>${formatTime(e.start)}</b>${formatTime(e.end)}</span><span class="timeline-node"><i></i></span><span class="event-info"><strong>${e.title}</strong><span>${e.subtitle}</span></span><span class="event-tag">${e.icon}</span>`;
      row.addEventListener('click',()=>openEvent(e)); wrap.append(row);
    });
    const calendar=$('#calendarList'); calendar.innerHTML='';
    demoSchedule.forEach(e=>{
      const row=el('button','calendar-row'); row.type='button'; row.dataset.event=e.id;
      row.innerHTML=`<span><b>${formatTime(e.start)}</b><br><small>${formatTime(e.end)}</small></span><span><b>${e.title}</b><br><small>${e.subtitle}</small></span><span>${e.category}</span>`;
      row.addEventListener('click',()=>openEvent(e)); calendar.append(row);
    });
  }

  const attention = [
    {id:'approval-1', icon:'◉', title:'2 approvals', subtitle:'Awaiting your review', count:2, panel:'approvals'},
    {id:'ndis-letter', icon:'✉', title:'NDIS Letters', subtitle:'2 ready to review', count:2, panel:'ndis'},
    {id:'enquiry', icon:'◎', title:'New Client Enquiry', subtitle:'Demo referral waiting', count:1, soft:true, panel:'referrals'},
    {id:'tomorrow', icon:'▣', title:"Tomorrow's Schedule", subtitle:'6 appointments', count:null, panel:'time'}
  ];

  function renderAttention(){
    const list=$('#attentionList'); list.innerHTML='';
    attention.filter(a=>!state.completed.includes(a.id)).forEach(a=>{
      const row=el('button','attention-item'); row.type='button'; row.innerHTML=`<span class="icon">${a.icon}</span><span><b>${a.title}</b><small>${a.subtitle}</small></span>${a.count?`<span class="count-badge ${a.soft?'soft':''}">${a.count}</span>`:'<span>›</span>'}`;
      row.addEventListener('click',()=>openPanel(a.panel,a)); list.append(row);
    });
    if(!list.children.length) list.innerHTML='<p style="color:var(--muted);padding:16px 0">Nothing urgent is waiting. Gigi has cleared the queue.</p>';
    const approvals = attention.filter(a=>a.panel==='approvals'&&!state.completed.includes(a.id)).reduce((s,a)=>s+(a.count||0),0) || 0;
    $('#approvalCount').textContent=approvals; $('#urgentApprovalCount').textContent=approvals?`${Math.min(2,approvals)} urgent`:'All clear';
  }

  function updateCapacity(){
    const c=getDayCapacity(); $('#usableTime').textContent=formatDuration(c.realistic); $('#timeProgress').style.width=`${Math.min(100,(c.realistic/c.rawFree)*100 || 0)}%`; $('#capacityNote').textContent=`${formatDuration(c.rawFree)} free → ${formatDuration(c.realistic)} realistically schedulable`;
  }

  function setVoice(on, announce=true){
    state.voiceOn=on; localStorage.setItem('gigiVoiceOn',String(on));
    const toggle=$('#gigiToggle'); toggle.classList.toggle('is-on',on); toggle.setAttribute('aria-checked',String(on)); $('#toggleLabel').textContent=on?'ON':'OFF';
    $('#voiceStatus').textContent=on?'Gigi is ready.':'Gigi voice is off. Tap the toggle to turn her back on.';
    if(announce) showToast(on?'Gigi voice is on':'Gigi voice is off'); if(on && announce) speak('Gigi is on. I am ready, Irene.'); if(!on && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  function chooseVoice(){
    const voices=speechSynthesis.getVoices();
    return voices.find(v=>v.lang.toLowerCase()==='en-za') || voices.find(v=>v.lang.toLowerCase().startsWith('en-au')) || voices.find(v=>v.lang.toLowerCase().startsWith('en-gb')) || voices.find(v=>v.lang.toLowerCase().startsWith('en')) || voices[0];
  }
  function speak(text){ if(!state.voiceOn || !('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); const v=chooseVoice(); if(v)u.voice=v; u.rate=.96; u.pitch=1.02; u.volume=1; speechSynthesis.speak(u); }

  let recognition=null;
  function initRecognition(){
    const R=window.SpeechRecognition||window.webkitSpeechRecognition; if(!R)return null;
    const r=new R(); r.lang='en-ZA'; r.interimResults=false; r.maxAlternatives=1;
    r.onstart=()=>{state.listening=true;$('#micButton').classList.add('listening');$('#waveform').classList.add('active');$('#voiceStatus').textContent='Listening…';};
    r.onend=()=>{state.listening=false;$('#micButton').classList.remove('listening');$('#waveform').classList.remove('active');if(state.voiceOn)$('#voiceStatus').textContent='Gigi is ready.';};
    r.onerror=e=>{showToast(`Voice input: ${e.error}`);$('#voiceStatus').textContent='Voice input unavailable. You can still use the dashboard.';};
    r.onresult=e=>{const text=e.results[0][0].transcript;$('#voiceStatus').textContent=`You said: “${text}”`;handleVoiceCommand(text);};
    return r;
  }
  function startListening(){
    if(!state.voiceOn){setVoice(true,false);showToast('Gigi voice turned on');}
    if(!recognition)recognition=initRecognition();
    if(!recognition){speak('Voice recognition is not available in this browser. You can still use all dashboard controls.');showToast('Voice recognition is not supported in this browser');return;}
    if(state.listening){recognition.stop();return;} try{recognition.start()}catch(e){showToast('Gigi is already listening');}
  }

  function handleVoiceCommand(raw){
    const q=raw.toLowerCase();
    if(q.includes('gigi off')||q.includes('turn off')){setVoice(false,false);showToast('Gigi voice is off');return;}
    if(q.includes('what should i')||q.includes('what now')||q.includes('next')){ const next=getNextEvent(); const msg=next?`Your next protected item is ${next.title} at ${formatTime(next.start)}. ${capacityMessage()}`:`You have no more fixed appointments in the demo schedule. ${capacityMessage()}`; speak(msg); showToast(msg); return; }
    if(q.includes('usable time')||q.includes('how much time')){const c=getDayCapacity();const msg=`You have ${formatDuration(c.realistic)} of realistically schedulable time today after protecting appointments, transitions and buffer.`;speak(msg);showToast(msg);return;}
    if(q.includes('attention')||q.includes('urgent')){const open=attention.filter(a=>!state.completed.includes(a.id));const msg=open.length?`You have ${open.length} attention items. The first is ${open[0].title}.`:'Your urgent queue is clear.';speak(msg);showToast(msg);return;}
    if(q.includes('protect lunch')){const lunch=demoSchedule.find(e=>e.id==='lunch');lunch.protected=true;renderSchedule();const msg='Lunch is protected from 12 until 1. I will not place routine work over it.';speak(msg);showToast(msg);return;}
    if(q.includes('ndis')){openPanel('ndis');speak('I have opened the NDIS action queue. Two demo letters are ready for clinician review.');return;}
    if(q.includes('calendar')){switchView('calendar');speak('Calendar opened. Every block includes its real duration.');return;}
    const msg='I heard you. In this deployable prototype I can manage the dashboard, time capacity, NDIS queue, approvals and navigation. Full email and clinical integrations will require authorised connections.';speak(msg);showToast('Command captured by Gigi');
  }

  function getNextEvent(){ const now=new Date(); const current=now.getHours()*60+now.getMinutes(); return demoSchedule.find(e=>minutes(e.start)>=current) || null; }
  function capacityMessage(){const c=getDayCapacity();return `You have ${formatDuration(c.realistic)} of realistic usable capacity remaining in the planning model.`;}

  const panelContent={
    time:{k:'REALISTIC CAPACITY',t:'Usable time is protected time',p:'Gigi does not fill every empty minute. Client sessions, transitions, protected lunch and deep-work blocks are accounted for before new work is suggested.',items:['9.5h nominal workday','Scheduled commitments protected','35m transition reserve','68% of remaining free time offered for new work']},
    approvals:{k:'APPROVAL QUEUE',t:'Only the decisions Irene needs',p:'Gigi keeps routine administration away from Irene and brings forward the items that require her authority.',items:['NDIS letter draft — clinician review','Service agreement — signature','Invoice exception — owner approval']},
    clients:{k:'CLIENTS',t:'Demo client view',p:'This prototype deliberately contains no real client records. Production client data would require authentication, role permissions, audit logging and privacy controls.',items:['12 demo active-client placeholders','50-minute standard client blocks','Follow-up actions separated from session time']},
    business:{k:'BUSINESS',t:'Business progress',p:'A concise owner view that protects strategy time from day-to-day noise.',items:['Weekly priorities 78% complete','Approval backlog visible','Deep work block protected']},
    ndis:{k:'NDIS ACTION QUEUE',t:'Prepare → review → approve → verify',p:'Gigi can organise and draft administrative material, but clinical opinions and final release remain with the authorised clinician.',items:['Demo Letter A — ready for review','Demo Letter B — missing one fact','Review time already protected']},
    referrals:{k:'REFERRALS',t:'No lost referrals',p:'Every referral receives an owner, status, next action and deadline.',items:['4 demo referrals waiting','2 require allocation','1 follow-up due tomorrow']},
    'client-followup':{k:'FOLLOW-UP',t:'Close every loop',p:'Calls, documents and promised actions are tracked until verified complete.',items:['3 open demo follow-ups','1 waiting on external reply','No overdue critical items']},
    continuity:{k:'CONTINUITY',t:'Handover and coverage',p:'Leave, handover and ownership are surfaced before care is disrupted.',items:['All demo matters currently covered','No orphaned actions']},
    personal:{k:'PERSONAL',t:'Private protected time',p:'Personal commitments stay separate from practice operations and are not overwritten by routine scheduling.',items:['Protected lunch','Transition time','Private commitments hidden from staff views']},
    operations:{k:'OPERATIONS',t:'Run the practice, not Irene',p:'Rosters, rooms, referrals and routine admin are assigned and chased before reaching Irene.',items:['Operations stable','Waiting-list review scheduled','No critical room conflict']},
    supervision:{k:'SUPERVISION',t:'Protected clinical governance time',p:'Supervision has real duration, preparation time and tracked actions.',items:['50-minute protected block','Preparation retained','Actions feed back to ownership list']},
    waiting:{k:'WAITING ON SOMEONE',t:'Stop carrying other people’s jobs',p:'Gigi remembers who owes what and when to chase.',items:['Accountant — response expected','External provider — document requested','Staff member — roster confirmation']},
    decisions:{k:'DECISION REGISTER',t:'What did we decide, and why?',p:'Important choices keep context, owner, date and review point.',items:['3 decisions this week','All have owners','1 review due Friday']},
    ideas:{k:'IDEA PARKING LOT',t:'Capture without derailment',p:'New ideas are kept safe without hijacking today’s priorities.',items:['7 captured ideas','Weekly review enabled','No idea scheduled without capacity']},
    review:{k:'CEO REVIEW',t:'A realistic weekly reset',p:'Completed, overdue, delegated, financial, staffing and capacity items come together in one review.',items:['Friday review','Capacity variance tracked','Next week built from real available hours']}
  };

  function openPanel(name, attentionItem){
    const p=panelContent[name]||panelContent.business; const content=$('#dialogContent');
    const actions = attentionItem ? `<div class="dialog-actions"><button class="primary-action" id="completeAttention" type="button">Mark handled</button><button class="secondary-action" type="button" id="speakPanel">Read this to me</button></div>` : `<div class="dialog-actions"><button class="secondary-action" type="button" id="speakPanel">Read this to me</button></div>`;
    content.innerHTML=`<div class="dialog-body"><span class="dialog-kicker">${p.k}</span><h3>${p.t}</h3><p>${p.p}</p><ul class="dialog-list">${p.items.map(i=>`<li><span>${i}</span><span>›</span></li>`).join('')}</ul>${actions}</div>`;
    const d=$('#actionDialog'); d.showModal(); $('#speakPanel')?.addEventListener('click',()=>speak(`${p.t}. ${p.p}`));
    $('#completeAttention')?.addEventListener('click',()=>{state.completed.push(attentionItem.id);localStorage.setItem('gigiCompleted',JSON.stringify(state.completed));renderAttention();d.close();showToast(`${attentionItem.title} marked handled`);speak(`${attentionItem.title} is marked handled.`);});
  }

  function openEvent(e){
    $('#dialogContent').innerHTML=`<div class="dialog-body"><span class="dialog-kicker">${e.category.toUpperCase()}</span><h3>${e.title}</h3><p>${formatTime(e.start)} – ${formatTime(e.end)} • ${duration(e.start,e.end)} minutes</p><ul class="dialog-list"><li><span>Full time block protected</span><span>✓</span></li><li><span>Category</span><strong>${e.category}</strong></li><li><span>Protected</span><strong>${e.protected?'Yes':'Standard'}</strong></li></ul><div class="dialog-actions"><button class="secondary-action" id="speakPanel" type="button">Read this to me</button></div></div>`;
    $('#actionDialog').showModal(); $('#speakPanel')?.addEventListener('click',()=>speak(`${e.title}, from ${formatTime(e.start)} until ${formatTime(e.end)}. ${duration(e.start,e.end)} minutes are protected.`));
  }

  function showToast(text){const t=$('#toast');t.textContent=text;t.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('show'),3000);}
  function switchView(view){ state.currentView=view; const ids={dashboard:'#dashboardView',calendar:'#calendarView',clients:'#clientsView',more:'#moreView'}; Object.entries(ids).forEach(([k,id])=>{$(id).hidden=k!==view;}); $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); window.scrollTo({top:0,behavior:'smooth'}); }

  function bind(){
    $('#gigiToggle').addEventListener('click',()=>setVoice(!state.voiceOn)); $('#micButton').addEventListener('click',startListening); $('#speakHint').addEventListener('click',startListening); $('#navGigi').addEventListener('click',startListening);
    $$('.metric-card,.module-card').forEach(b=>b.addEventListener('click',()=>openPanel(b.dataset.panel))); $$('.nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('#viewDay').addEventListener('click',()=>switchView('calendar')); $('#priorityCard').addEventListener('click',()=>openEvent(demoSchedule.find(e=>e.id==='deep-work')));
    $('#breatheButton').addEventListener('click',()=>{const m='Irene, you do not have to do it all. You only have to do what matters next.';speak(m);showToast('Breathe. Gigi has the plan.');});
  }

  function init(){
    const now=new Date(); const h=now.getHours(); $('.eyebrow').textContent=h<12?'Good morning,':h<17?'Good afternoon,':'Good evening,'; $('#todayDate').textContent=now.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'});
    setVoice(state.voiceOn,false); renderSchedule(); renderAttention(); updateCapacity(); bind(); if('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged=()=>chooseVoice(); if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }
  document.addEventListener('DOMContentLoaded',init);
})();
