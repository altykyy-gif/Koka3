(() => {
  'use strict';
  const C = window.COURSE_CONTENT;
  const Q = window.EXAM_BANK || [];
  const RC = window.RESEARCH_CONTENT || {sections:[],blocks:[]};
  const SOURCES = window.PROJECT_SOURCES || {};
  const RULES = window.FIRESTORE_RULES || 'تعذر تحميل القواعد المرفقة.';
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const STORE_KEY = 'rafiq-academy-v1';
  const defaults = {done:{},bookmarks:[],notes:{},theme:'light',font:17,confidence:{},last:'front',examRuns:0};
  let state;
  try { state = Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
  catch { state = {...defaults}; }
  for (const key of ['done','notes','confidence']) if (!state[key] || typeof state[key] !== 'object') state[key] = {};
  if (!Array.isArray(state.bookmarks)) state.bookmarks = [];
  let currentModule = 'front', sourceSection = '', examState = null, searchTimer = null, toastTimer = null;
  let examTimerToken = 0;
  const views = ['homeView','moduleView','examView','reviewView','sourceView','searchView'];

  function save(updateUI=true){ try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} if (updateUI) updateProgress(); }
  function escapeHtml(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(text){ const t=$('#toast'); t.textContent=text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2300); }
  function getModule(id){ return C.modules.find(m=>m.id===id) || C.modules[0]; }
  function toggleView(id){ for (const v of views) $('#'+v).hidden = v !== id; }
  function switchNav(id){ $$('.nav-item').forEach(b=>{b.classList.toggle('active', b.dataset.module===id); b.setAttribute('aria-current',b.dataset.module===id?'page':'false');}); }
  function renderNav(){
    const nav=$('#courseNav');
    const heads=['المقرر','الشفرة والسياسات'];
    const groups=[C.modules.slice(0,11), C.modules.slice(11)];
    nav.innerHTML=groups.map((group,g)=>`<div class="nav-label">${heads[g]}</div>`+group.map((m,i)=>{
      const idx=C.modules.indexOf(m)+1, done=!!state.done[m.id];
      return `<button class="nav-item ${done?'done':''} ${currentModule===m.id?'active':''}" type="button" data-module="${escapeHtml(m.id)}"><span class="nav-no">${String(idx).padStart(2,'0')}</span><span>${escapeHtml(m.nav)}</span>${done?'<span class="nav-tick" aria-label="مكتمل">✓</span>':''}</button>`;
    }).join('')).join('');
  }
  function updateProgress(){
    if(!C?.modules) return;
    const total=C.modules.length, done=C.modules.filter(m=>state.done[m.id]).length, pct=Math.round(100*done/total);
    $('#progressPercent').textContent=pct+'٪'; $('#progressBar').style.width=pct+'%'; $('#progressCount').textContent=`${done} من ${total} وحدة`;
    $('#homePercent').textContent=pct+'٪'; $('#homeDone').textContent=`${done}/${total}`; $('#circleProgress').style.setProperty('--progress',pct+'%');
    renderNav(); renderCards();
  }
  function renderCards(){
    const box=$('#moduleCards'); if(!box) return;
    box.innerHTML=C.modules.slice(0,8).map((m,i)=>`<button class="module-card" type="button" data-open-module="${m.id}"><span class="num">${String(i+1).padStart(2,'0')} / 08</span>${state.done[m.id]?'<span class="done-dot" title="مكتمل">✓</span>':''}<b>${escapeHtml(m.nav)}</b><small>${escapeHtml(m.subtitle)}</small></button>`).join('');
    $('#continueButton').innerHTML=`${state.done.front?'تابعي مسار المذاكرة':'ابدئي من الوحدة الأولى'} <span aria-hidden="true">←</span>`;
  }
  function renderIdentity(){
    $('#studentList').innerHTML=C.students.map(s=>`<div class="student-pill"><b>${escapeHtml(s.name)}</b><span>الرقم الدراسي: ${escapeHtml(s.id)}</span></div>`).join('');
  }
  function diagramsHtml(ids=[]){
    const diagrams={
      architecture:`<section class="lesson-chunk diagram-card"><h2>صورة ذهنية: أربع طبقات لا تخلطي بينها</h2><div class="diagram-flow"><div>واجهة HTML/CSS/JS</div><span>↕</span><div>المتصفح<br>سجل محلي + IndexedDB</div><span>↕</span><div>Firebase Auth<br>هوية الحساب</div><span>↕</span><div>Firestore<br>بيانات مشتركة + قواعد</div></div><small>عامل الخدمة يخزن ملفات الواجهة فقط؛ وGitHub Pages يستضيف الملفات الثابتة.</small></section>`,
      sync:`<section class="lesson-chunk diagram-card"><h2>مسار القراءة: حفظ محلي ثم إرسال مشروط</h2><div class="diagram-flow"><div>إدخال + تحقق</div><span>→</span><div>حفظ محلي</div><span>→</span><div>رابط + موافقة + اتصال</div><span>→</span><div>دفعة Firestore<br>ثم إقرار الإرسال</div></div><small>عند فشل الشبكة تبقى القراءة محليًا؛ لا تُعرض كأنها وصلت للطبيب.</small></section>`,
      crypto:`<section class="lesson-chunk diagram-card"><h2>سلسلة النسخة الاحتياطية المشفرة</h2><div class="diagram-flow"><div>كلمة مرور</div><span>→</span><div>PBKDF2<br>SHA-256</div><span>→</span><div>مفتاح 256 بت</div><span>→</span><div>AES-GCM<br>تشفير + تحقق</div></div><small>تُنشأ قيمتا salt وIV عشوائيًا، ويفحص الملف قبل الاسترجاع.</small></section>`
    };
    return ids.map(id=>diagrams[id]||'').join('');
  }
  function renderModule(id){
    const m=getModule(id); currentModule=m.id; state.last=m.id; save(false);
    toggleView('moduleView'); switchNav(m.id); $('#crumbTitle').textContent=m.nav;
    $('#moduleEyebrow').textContent=`وحدة ${String(C.modules.indexOf(m)+1).padStart(2,'0')} · ${m.nav}`;
    $('#moduleTitle').textContent=m.title; $('#moduleSubtitle').textContent=m.subtitle;
    $('#goalList').innerHTML=(m.goals||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
    const bookmark=state.bookmarks.includes(m.id); $('#bookmarkButton').classList.toggle('is-on',bookmark); $('#bookmarkButton').textContent=bookmark?'★ محفوظة للمراجعة':'☆ حفظ للمراجعة';
    $('#completeButton').textContent=state.done[m.id]?'✓ مكتملة — اضغطي لإلغاء الإكمال':'أنهيت هذه الوحدة'; $('#completeButton').classList.toggle('is-on',!!state.done[m.id]);
    const tags=[...new Set((m.chunks||[]).flatMap(c=>c.tags||[]))].slice(0,8); $('#moduleMeta').innerHTML=tags.map(t=>`<span class="meta-chip">${escapeHtml(t)}</span>`).join('');
    $('#moduleNote').value=state.notes[m.id]||'';
    const body=(m.chunks||[]).map((c,i)=>`<section class="lesson-chunk"><div class="chunk-title"><span class="chunk-number">${String(i+1).padStart(2,'0')}</span><h2>${escapeHtml(c.h)}</h2></div><p>${escapeHtml(c.p)}</p>${c.why?`<div class="why-box"><b>كيف تشرحينها؟</b> ${escapeHtml(c.why)}</div>`:''}${c.memory?`<div class="why-box"><b>تذكرة حفظ:</b> ${escapeHtml(c.memory)}</div>`:''}${c.tags?.length?`<div class="tag-row">${c.tags.map(t=>`<span>${escapeHtml(t)}</span>`).join('')}</div>`:''}</section>`).join('');
    const summary=`<section class="lesson-summary"><h2>الفكرة المحورية</h2><p>${escapeHtml(m.summary)}</p></section>`;
    const viva=(m.viva||[]).map(([q,a],i)=>`<details class="viva-question"><summary><b>س${i+1}.</b> ${escapeHtml(q)}</summary><p><b>إجابة مقترحة:</b> ${escapeHtml(a)}</p></details>`).join('');
    let extras='';
    if(m.codeFiles){ extras=`<section class="code-embedded"><div class="section-kicker">تصفحي كل ملف من المصدر</div><h2>مكتبة المصدر الأصلي</h2><p>الملفات التالية من حزمة v52 المرفقة. استثنينا مكتبات Firebase المورّدة من تحرير الشفرة؛ نعرضها بوصفها تبعيات خارجية.</p><div class="code-browser"><div class="code-file-list" id="codeFileList"></div><div class="code-pane"><div class="code-toolbar"><strong id="codeFileName">اختاري ملفًا</strong><button class="outline-button" id="copyCode" type="button">نسخ الملف</button></div><p id="codeFileDescription"></p><pre><code id="codeOutput">يظهر هنا المصدر الأصلي من حزمة v52.</code></pre></div></div></section>`; }
    if(m.ruleMap){extras=`<section class="code-embedded"><div class="section-kicker">خريطة من قواعد المرفق</div><div class="rule-map">${m.ruleMap.map(([h,p])=>`<article class="rule-card"><b>${escapeHtml(h)}</b><p>${escapeHtml(p)}</p></article>`).join('')}</div><details class="source-accordion"><summary>عرض النص الكامل لقواعد Firestore</summary><pre><code id="rulesCode">${escapeHtml(RULES)}</code></pre></details></section>`;}
    const source=(m.section?`<details class="source-accordion"><summary>المتن الأصلي والجداول والأشكال</summary><p>اعرضي النص الأكاديمي المطابق لهذا الباب للمقارنة مع الشرح.</p><button class="text-button" type="button" data-source-section="${escapeHtml(m.section)}">فتح مادة ${escapeHtml(m.section)} كاملة ←</button></details>`:'');
    const vivaBlock=`<section id="vivaSection" class="viva-section"><div class="section-kicker">تدريب على أسئلة اللجنة</div><h2>اسألي نفسك قبل فتح الإجابة</h2><p class="muted-line">حاولي الإجابة شفهيًا في 30–60 ثانية، واذكري الدليل والحدود.</p>${viva||'<p>تصفحي البطاقات أو اختبار المناقشة.</p>'}</section>`;
    const goalsInfo=`<section class="lesson-chunk"><h2>ما تتقنينه بعد الوحدة</h2><ul>${(m.goals||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></section>`;
    $('#lessonMain').innerHTML=summary+diagramsHtml(m.diagrams)+body+goalsInfo+vivaBlock+extras+source;
    $('#prevModule').disabled=C.modules.indexOf(m)===0; $('#nextModule').disabled=C.modules.indexOf(m)===C.modules.length-1;
    if(m.codeFiles) renderCodeBrowser();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function showHome(){toggleView('homeView');$('#crumbTitle').textContent='الرئيسية';switchNav('');window.scrollTo({top:0,behavior:'smooth'});}
  function openExam(){toggleView('examView');$('#crumbTitle').textContent='اختبار المناقشة';switchNav('');$('#examChooser').hidden=false;$('#examRunner').hidden=true;$('#examResults').hidden=true;window.scrollTo({top:0,behavior:'smooth'});}
  function openReview(tab='practice'){toggleView('reviewView');$('#crumbTitle').textContent='بطاقات المراجعة';switchNav('');renderReview(tab);window.scrollTo({top:0,behavior:'smooth'});}
  function openSource(section=''){toggleView('sourceView');$('#crumbTitle').textContent='نص البحث الأصلي';switchNav('');sourceSection=section;const sel=$('#sourceFilter');sel.innerHTML='<option value="">البحث كاملًا</option>'+RC.sections.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');sel.value=section;$('#sourceSearch').value='';renderSource();window.scrollTo({top:0,behavior:'smooth'});}
  function makeSourceBlock(block, query){
    let content='';
    if(block.type==='paragraph'&&block.text){
      let text=escapeHtml(block.text);
      if(query){const safe=escapeHtml(query);const idx=text.toLowerCase().indexOf(safe.toLowerCase());if(idx>=0) text=text.slice(0,idx)+'<mark>'+text.slice(idx,idx+safe.length)+'</mark>'+text.slice(idx+safe.length);}
      content=`<p>${text}</p>`;
    } else if(block.type==='table'&&block.rows?.length){
      const maxcols=Math.max(...block.rows.map(r=>r.length));
      content='<table><tbody>'+block.rows.map((row,ri)=>'<tr>'+Array.from({length:maxcols},(_,ci)=>`<${ri===0?'th':'td'}>${escapeHtml(row[ci]||'')}</${ri===0?'th':'td'}>`).join('')+'</tr>').join('')+'</tbody></table>';
    }
    const imgs=(block.images||[]).map(src=>`<img loading="lazy" src="${escapeHtml(src)}" alt="شكل مصور من البحث الأصلي" onerror="this.hidden=true">`).join('');
    if(!content&&!imgs)return '';
    return `<article class="source-block">${content}${imgs}</article>`;
  }
  function renderSource(){
    const filter=$('#sourceFilter').value, query=$('#sourceSearch').value.trim();
    let blocks=RC.blocks.filter(b=>!filter||b.section===filter);
    if(query) blocks=blocks.filter(b=>JSON.stringify(b).toLowerCase().includes(query.toLowerCase()));
    $('#sourceCount').textContent=`${blocks.length} كتلة من البحث`;
    $('#sourceBlocks').innerHTML=blocks.length?blocks.map(b=>makeSourceBlock(b,query)).join(''):'<div class="source-empty">لا توجد نتائج مطابقة. جرّبي عبارة أخرى.</div>';
  }
  function renderCodeBrowser(){
    const table=getModule('code').codeFiles||[]; const list=$('#codeFileList'); if(!list)return;
    list.innerHTML=table.map(([name,desc])=>`<button class="code-file" type="button" data-code-file="${escapeHtml(name)}" data-desc="${escapeHtml(desc)}">${escapeHtml(name)}</button>`).join('');
    const first=table.find(([name])=>Object.hasOwn(SOURCES,name)); if(first) showCode(first[0],table.find(x=>x[0]===first[0])[1]);
  }
  function showCode(name,description){
    $$('.code-file').forEach(b=>b.classList.toggle('active',b.dataset.codeFile===name));
    $('#codeFileName').textContent=name; $('#codeFileDescription').textContent=description||'';
    let text=SOURCES[name];
    if(text===undefined){
      if(name.startsWith('vendor/')) text='مكتبة SDK خارجية غير مضمنة في عارض المصدر التعليمي. تُستخدم تبعيات Firebase الرسمية ولا تُعد منطق التطبيق الخاص.';
      else text='هذا الملف غير موجود ضمن الحزمة المرفقة.';
    }
    $('#codeOutput').textContent=text;
    $('#copyCode').dataset.file=name;
  }
  function renderReview(tab='practice'){
    $$('.review-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.review===tab));
    const grid=$('#reviewGrid');let items=[];
    if(tab==='practice') items=C.practiceCards.map((x,i)=>({kind:'تدريب دفاعي',q:x[0],a:x[1],id:'p'+i}));
    if(tab==='glossary') items=C.glossary.map((x,i)=>({kind:'مصطلح',q:x[0],a:x[1],id:'g'+i}));
    if(tab==='bookmarks') items=C.modules.filter(m=>state.bookmarks.includes(m.id)).map(m=>({kind:'وحدة محفوظة',q:m.title,a:m.summary,id:'b'+m.id,module:m.id}));
    if(!items.length){grid.innerHTML='<div class="source-empty">لا توجد بطاقات هنا بعد. أضيفي علامة نجمة إلى وحدة أو اختاري تبويبًا آخر.</div>';return;}
    grid.innerHTML=items.map(x=>`<article class="flash-card"><span class="flash-kind">${escapeHtml(x.kind)}</span><h3>${escapeHtml(x.q)}</h3><details><summary>إظهار إجابة مقترحة</summary><p>${escapeHtml(x.a)}</p></details><div class="confidence-row"><button data-confidence="low" data-card="${escapeHtml(x.id)}" class="${state.confidence[x.id]==='low'?'chosen':''}">أراجعها</button><button data-confidence="mid" data-card="${escapeHtml(x.id)}" class="${state.confidence[x.id]==='mid'?'chosen':''}">متوسطة</button><button data-confidence="high" data-card="${escapeHtml(x.id)}" class="${state.confidence[x.id]==='high'?'chosen':''}">متقنة</button></div>${x.module?`<button class="text-button" data-open-module="${escapeHtml(x.module)}">افتح الوحدة ←</button>`:''}</article>`).join('');
  }
  function pickQuestions(count){
    const shuffle=items=>{const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
    const buckets=new Map(C.modules.map(m=>[m.id,shuffle(Q.filter(q=>q.unit===m.id))]));
    const order=shuffle(C.modules.map(m=>m.id)), selected=[];
    while(selected.length<count){let added=false;for(const id of order){const item=buckets.get(id)?.shift();if(item){selected.push(item);added=true;if(selected.length===count)break;}}if(!added)break;}
    return selected;
  }
  function startExam(level){
    const count={quick:10,medium:25,full:50}[level]||10; examState={level,questions:pickQuestions(count),started:Date.now()};
    $('#examChooser').hidden=true;$('#examResults').hidden=true;$('#examRunner').hidden=false;
    $('#examRunner').innerHTML=`<div class="exam-paper"><div class="exam-head"><h2>${level==='quick'?'اختبار سريع':level==='medium'?'اختبار متوسط':'اختبار شامل'} · ${count} أسئلة</h2><span class="timer" id="examTimer">الوقت 00:00</span></div><form id="examForm">${examState.questions.map((q,i)=>`<fieldset class="question-card" data-question="${i}"><small>السؤال ${i+1} · ${escapeHtml(getModule(q.unit).nav)}</small><h3>${escapeHtml(q.q)}</h3>${q.options.map((o,j)=>`<label class="answer-option"><input type="radio" name="q${i}" value="${j}"><span>${escapeHtml(o)}</span></label>`).join('')}</fieldset>`).join('')}<button class="primary-button submit-exam" type="submit">إنهاء الاختبار وتصحيح الإجابات</button></form></div>`;
    tickTimer(++examTimerToken);window.scrollTo({top:0,behavior:'smooth'});
  }
  function tickTimer(token){if(!examState||token!==examTimerToken)return;const e=Math.floor((Date.now()-examState.started)/1000);const el=$('#examTimer');if(el)el.textContent=`الوقت ${String(Math.floor(e/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`; if(!$('#examRunner').hidden)setTimeout(()=>tickTimer(token),1000);}
  function finishExam(){
    examTimerToken++;
    const answers=examState.questions.map((q,i)=>{const input=$(`input[name="q${i}"]:checked`);return input?Number(input.value):-1;});
    const score=answers.reduce((n,a,i)=>n+(a===examState.questions[i].answer?1:0),0);state.examRuns++;save();
    $('#examRunner').hidden=true;$('#examResults').hidden=false;
    const pct=Math.round(100*score/answers.length);
    $('#examResults').innerHTML=`<div class="exam-result-card"><div class="section-kicker">نتيجتك الحالية</div><h2>${pct>=80?'أداء قوي — ثبتي الدليل والحدود':pct>=60?'قاعدة جيدة — راجعي مواضع التعثر':'مراجعة مفيدة — عودي للأبواب ثم أعيدي الاختبار'}</h2><div class="score-ring">${score}/${answers.length}</div><p>النتيجة تدريبية لتحديد ما تراجعينه وليست تقييمًا رسميًا.</p><div class="answer-review">${examState.questions.map((q,i)=>{const ok=answers[i]===q.answer;return `<div class="review-answer ${ok?'correct':'wrong'}"><b>${i+1}. ${ok?'صحيح':'راجعي الإجابة'} · ${escapeHtml(getModule(q.unit).nav)}</b><p>${escapeHtml(q.q)}</p><p><b>الإجابة:</b> ${escapeHtml(q.options[q.answer])}</p><p>${escapeHtml(q.why)}</p></div>`;}).join('')}</div><button class="primary-button" id="retryExam" type="button">إعادة المستوى نفسه</button> <button class="outline-button" id="showWeak" type="button">مراجعة الوحدات المرتبطة</button></div>`;
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function runSearch(){
    const q=$('#globalSearch').value.trim();const out=$('#searchResults');if(q.length<2){out.innerHTML='<p class="muted-line">اكتبي حرفين أو أكثر لبدء البحث.</p>';return;}
    const matches=[];const lower=q.toLowerCase();
    for(const m of C.modules){for(const c of m.chunks||[]){const hay=(c.h+' '+c.p+' '+(c.why||'')+' '+(c.tags||[]).join(' '));if(hay.toLowerCase().includes(lower))matches.push({title:m.title,sub:c.h,text:c.p,id:m.id});}}
    for(const b of RC.blocks){if(b.text&&b.text.toLowerCase().includes(lower))matches.push({title:'نص البحث الأصلي · '+b.section,sub:'مقتطف أكاديمي',text:b.text,id:'source:'+b.section});}
    out.innerHTML=matches.slice(0,50).map(x=>`<button class="search-result" type="button" data-result="${escapeHtml(x.id)}"><b>${escapeHtml(x.title)} · ${escapeHtml(x.sub)}</b><span>${escapeHtml(x.text.slice(0,260))}${x.text.length>260?'…':''}</span></button>`).join('')||(matches.length===0?'<div class="source-empty">لم نجد هذه العبارة داخل الشرح أو البحث.</div>':'');
  }

  // Main navigation and controls
  $('#courseNav').addEventListener('click',e=>{const b=e.target.closest('[data-module]');if(b){$('#sidebar').classList.remove('open');$('#menuButton').setAttribute('aria-expanded','false');renderModule(b.dataset.module);}});
  $('#homeButton').addEventListener('click',e=>{e.preventDefault();showHome();});
  document.addEventListener('click',async e=>{
    const open=e.target.closest('[data-open-module]');if(open){renderModule(open.dataset.openModule);return;}
    const source=e.target.closest('[data-source-section]');if(source){openSource(source.dataset.sourceSection);return;}
    const result=e.target.closest('[data-result]');if(result){const id=result.dataset.result;if(id.startsWith('source:'))openSource(id.slice(7));else renderModule(id);return;}
    const cf=e.target.closest('[data-code-file]');if(cf){showCode(cf.dataset.codeFile,cf.dataset.desc);return;}
    const copy=e.target.closest('#copyCode');if(copy){const text=$('#codeOutput')?.textContent||'';try{await navigator.clipboard.writeText(text);toast('نُسخ محتوى الملف');}catch{toast('النسخ غير متاح في هذا السياق؛ يمكنك تحديد النص يدويًا');}return;}
    const confidence=e.target.closest('[data-confidence]');if(confidence){state.confidence[confidence.dataset.card]=confidence.dataset.confidence;save();renderReview($('.review-tabs button.active')?.dataset.review||'practice');return;}
  });
  $('#continueButton').addEventListener('click',()=>renderModule(state.last||'front'));
  $('#examStartButton').addEventListener('click',openExam);
  $('#menuButton').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('open');$('#menuButton').setAttribute('aria-expanded',String(open));});
  $('#fontUp').addEventListener('click',()=>{state.font=Math.min(24,(state.font||17)+1);document.documentElement.style.setProperty('--body-size',state.font+'px');save();});
  $('#fontDown').addEventListener('click',()=>{state.font=Math.max(14,(state.font||17)-1);document.documentElement.style.setProperty('--body-size',state.font+'px');save();});
  $('#themeButton').addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=state.theme;$('#themeButton').textContent=state.theme==='dark'?'☀':'☾';save();});
  $('#bookmarkButton').addEventListener('click',()=>{const at=state.bookmarks.indexOf(currentModule);if(at<0)state.bookmarks.push(currentModule);else state.bookmarks.splice(at,1);save();renderModule(currentModule);toast(at<0?'حُفظت الوحدة في بطاقات المراجعة':'أزيلت من الوحدات المحفوظة');});
  $('#completeButton').addEventListener('click',()=>{state.done[currentModule]=!state.done[currentModule];save();renderModule(currentModule);toast(state.done[currentModule]?'تم حفظ إكمال الوحدة':'أعيدت الوحدة إلى قيد المراجعة');});
  $('#moduleNote').addEventListener('input',()=>{state.notes[currentModule]=$('#moduleNote').value;save(false);$('#noteStatus').textContent='حُفظت الملاحظة على هذا الجهاز';});
  $('#prevModule').addEventListener('click',()=>{const i=C.modules.findIndex(m=>m.id===currentModule);if(i>0)renderModule(C.modules[i-1].id);});
  $('#nextModule').addEventListener('click',()=>{const i=C.modules.findIndex(m=>m.id===currentModule);if(i<C.modules.length-1)renderModule(C.modules[i+1].id);});
  $('#jumpViva').addEventListener('click',()=>$('#vivaSection').scrollIntoView({behavior:'smooth'}));
  $('#openSource').addEventListener('click',()=>openSource(getModule(currentModule).section||''));
  $('#sourceBack').addEventListener('click',()=>renderModule(currentModule));
  $('#sourceFilter').addEventListener('change',renderSource);$('#sourceSearch').addEventListener('input',renderSource);
  $('#searchButton').addEventListener('click',()=>{toggleView('searchView');switchNav('');$('#crumbTitle').textContent='بحث';$('#globalSearch').focus();});
  $('#reviewButton').addEventListener('click',()=>openReview('practice'));
  $('#globalSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,130);});
  $('#readButton').addEventListener('click',()=>{
    if(!('speechSynthesis' in window)){toast('القراءة الصوتية غير متاحة في هذا المتصفح');return;}
    const m=getModule(currentModule);const text=[m.title,m.summary,...(m.chunks||[]).map(c=>c.h+'. '+c.p)].join('. ');speechSynthesis.cancel();const utter=new SpeechSynthesisUtterance(text);utter.lang='ar';const voice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('ar'));if(voice)utter.voice=voice;speechSynthesis.speak(utter);toast('بدأت القراءة؛ توفر الصوت العربي يعتمد على الجهاز');
  });
  $('#examChooser').addEventListener('click',e=>{const b=e.target.closest('[data-level]');if(b)startExam(b.dataset.level);});
  $('#examRunner').addEventListener('submit',e=>{if(e.target.id==='examForm'){e.preventDefault();const answered=$$('#examForm input:checked').length;if(answered<examState.questions.length&&!confirm(`أجبتِ عن ${answered} من ${examState.questions.length}. هل تريدين الإنهاء الآن؟`))return;finishExam();}});
  $('#examResults').addEventListener('click',e=>{if(e.target.id==='retryExam')startExam(examState.level);if(e.target.id==='showWeak'){const wrong=examState.questions.filter((q,i)=>{const a=$(`input[name="q${i}"]:checked`);return !a||Number(a.value)!==q.answer;});const id=wrong[0]?.unit||'front';renderModule(id);}});
  $('#examBack').addEventListener('click',showHome);
  $$('.review-tabs button').forEach(b=>b.addEventListener('click',()=>renderReview(b.dataset.review)));
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#searchButton').click();}});

  document.documentElement.dataset.theme=state.theme==='dark'?'dark':'light';$('#themeButton').textContent=state.theme==='dark'?'☀':'☾';document.documentElement.style.setProperty('--body-size',`${Math.max(14,Math.min(24,state.font||17))}px`);
  renderIdentity();renderNav();updateProgress();renderCodeBrowser();
  if(location.hash.startsWith('#lesson-'))renderModule(decodeURIComponent(location.hash.slice(8)));else showHome();
})();
