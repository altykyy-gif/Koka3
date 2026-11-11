'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RafiqFollowup=api;
})(globalThis,function(root){
  const KEY='rafiq_followup';
  const kinds=['lab','bp','visit','question'];
  const names={lab:'فحص',bp:'قياس ضغط الدم',visit:'زيارة',question:'سؤال للطبيب'};
  const MAX_ROWS=5000;
  const fresh=()=>({schema:1,plan:{months:3,systolic:130,diastolic:80},rows:[]});
  const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const timeOK=t=>typeof t==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
  const int=(n,max)=>Number.isInteger(n)&&n>0&&n<=max;
  const uuid=()=>root.crypto?.randomUUID?.()||`f-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function localDay(date=new Date()){
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function validDay(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const date=new Date(value+'T12:00:00Z');
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value&&Number(value.slice(0,4))>=1900;
  }
  function nextDate(date,months){
    if(!validDay(date)||!Number.isInteger(months)||months<1||months>24)return null;
    const [y,m,d]=date.split('-').map(Number);
    const target=new Date(Date.UTC(y,m-1+months,1));
    if(target.getUTCFullYear()>9999)return null;
    const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
    target.setUTCDate(Math.min(d,last));
    return target.toISOString().slice(0,10);
  }
  function dayFor(ts){
    if(!Number.isFinite(ts)||ts<=0||ts>8640000000000000)return '';
    return localDay(new Date(ts));
  }
  function labNumber(value){
    const s=value.trim().replace(/[٠-٩۰-۹]/g,c=>String(c.codePointAt(0)-(c<='٩'?0x660:0x6f0))).replace(/[٫,]/g,'.');
    return /^\d+(?:\.\d+)?$/.test(s)?Number(s):NaN;
  }
  function readingsIn(rows,{from='',to='',context=''}={}){
    if((from&&!validDay(from))||(to&&!validDay(to))||(from&&to&&from>to)||!['','f','a'].includes(context))throw new Error('invalid filter');
    return rows.map((reading,index)=>({reading,index})).filter(({reading})=>{
      if(!obj(reading)||!Number.isFinite(reading.v)||reading.v<20||reading.v>700)return false;
      if(context&&reading.w!==context)return false;
      if(!from&&!to)return true;
      const day=dayFor(Number(reading.ts));
      return !!day&&(!from||day>=from)&&(!to||day<=to);
    });
  }
  function text(value,max,required=false){
    if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error('invalid field');
    return value.trim();
  }
  function plan(value){
    if(!obj(value)||!int(value.months,24)||!int(value.systolic,400)||!int(value.diastolic,400)||value.systolic<=value.diastolic)throw new Error('invalid plan');
    return {months:value.months,systolic:value.systolic,diastolic:value.diastolic};
  }
  function row(value){
    if(!obj(value)||!kinds.includes(value.kind)||typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)||!validDay(value.date))throw new Error('invalid record');
    const out={id:value.id,kind:value.kind,date:value.date};
    if(value.kind==='lab'){
      if(value.test==='a1c'){
        if(typeof value.result!=='number'||!Number.isFinite(value.result)||value.result<=0||value.result>100)throw new Error('invalid A1C');
        return {...out,test:'a1c',name:'السكر التراكمي',result:value.result,unit:'%',note:text(value.note??'',300)};
      }
      if(value.test!=='other')throw new Error('invalid test type');
      return {...out,test:'other',name:text(value.name,100,true),result:text(value.result,100,true),unit:text(value.unit??'',30),note:text(value.note??'',300)};
    }
    if(value.kind==='bp'){
      if(!int(value.systolic,400)||!int(value.diastolic,400)||value.systolic<=value.diastolic)throw new Error('invalid blood pressure');
      return {...out,systolic:value.systolic,diastolic:value.diastolic,note:text(value.note??'',300)};
    }
    if(typeof value.done!=='boolean')throw new Error('invalid status');
    if(value.kind==='visit'){
      if(value.time!==''&&!timeOK(value.time))throw new Error('invalid visit time');
      return {...out,title:text(value.title,120,true),time:value.time,note:text(value.note??'',300),done:value.done};
    }
    return {...out,title:text(value.title,500,true),done:value.done};
  }
  function normalize(state){
    if(!obj(state)||state.schema!==1||!Array.isArray(state.rows)||state.rows.length>MAX_ROWS)throw new Error('invalid follow-up');
    const rows=state.rows.map(row),ids=new Set(rows.map(r=>r.id));
    if(ids.size!==rows.length)throw new Error('duplicate record');
    return {schema:1,plan:plan(state.plan),rows};
  }
  function list(state,kind){return state.rows.filter(r=>r.kind===kind).slice().reverse().sort((a,b)=>b.date.localeCompare(a.date)||String(b.time??'').localeCompare(String(a.time??'')));}
  function details(r){
    if(r.kind==='lab')return `${r.name}: ${r.result}${r.unit?' '+r.unit:''}`;
    if(r.kind==='bp')return `ضغط الدم: ${r.systolic}/${r.diastolic} ملم زئبق`;
    if(r.kind==='visit')return `${r.title}${r.time?' · '+r.time:''}${r.done?' · تمت الزيارة':''}`;
    return r.title+(r.done?' · تمت المناقشة':'');
  }
  function reportLines(state){
    const s=normalize(state);
    const take=[...list(s,'lab').slice(0,3),...list(s,'bp').slice(0,3),...list(s,'visit').filter(x=>!x.done).slice(0,5),...list(s,'question').filter(x=>!x.done).slice(0,10)];
    return take.map(r=>`${r.date} — ${details(r)}${r.note?' — '+r.note:''}`);
  }
  function csv(rows){
    const cell=value=>{
      let s=String(value??'');
      // Spreadsheet programs can interpret some user-entered strings as formulas.
      if(/^[\t\r\n]|^[\s\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069]*[=+\-@]/u.test(s))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    return '\uFEFF'+rows.map(line=>line.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  function readingsCSV(entries){
    return csv([['التاريخ','وقت القياس','القيمة (ملغ/دل)','سياق القياس'],...entries.map(({reading:r})=>{
      const ts=Number(r.ts),day=dayFor(ts);
      return [day,day?new Date(ts).toLocaleTimeString('ar-LY',{hour:'2-digit',minute:'2-digit'}):r.d,r.v,r.w==='f'?'صائم':r.w==='a'?'بعد الأكل':'غير محدد'];
    })]);
  }
  function followupCSV(state){
    return csv([['النوع','التاريخ','الوقت','الوصف','ملاحظات'],...normalize(state).rows.map(r=>[names[r.kind],r.date,r.time??'',details(r),r.note??''])]);
  }
  function download(content,filename,type='text/csv;charset=utf-8'){
    const url=root.URL.createObjectURL(new root.Blob([content],{type}));
    const a=root.document.createElement('a');a.href=url;a.download=filename;
    root.document.body.appendChild(a);
    try{a.click();}finally{a.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),4000);}
  }

  function mount(storage){
    const document=root.document,$=id=>document.getElementById(id);
    if(!$('fuLabForm'))return;
    const forms={lab:'Lab',bp:'Bp',visit:'Visit',question:'Question'};
    const editing={},limits={lab:8,bp:8,visit:8,question:8};
    function read(){
      const value=storage.getItem(KEY);
      return value===null?fresh():normalize(JSON.parse(value));
    }
    function write(s){storage.setItem(KEY,JSON.stringify(normalize(s)));}
    function message(value,bad=false){const e=$('fuMessage');e.textContent=value;e.className=bad?'res warn':'res ok';e.hidden=!value;}
    function format(s){
      if(!s)return '';
      return new Date(s+'T12:00:00Z').toLocaleDateString('ar-LY',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'});
    }
    function syncLabFields(){
      const other=$('fuLabKind').value==='other';
      $('fuOtherLab').hidden=!other;
      $('fuLabName').required=other;
      $('fuLabLabel').textContent=other?'نتيجة الفحص':'نتيجة التراكمي (%)';
      $('fuLabValue').inputMode=other?'text':'decimal';
    }
    function reset(kind){
      const type=forms[kind];delete editing[kind];
      $('fu'+type+'Form').reset();
      const date=$('fu'+type+'Date');
      if(date){date.value=localDay();if(kind==='lab'||kind==='bp')date.max=date.value;}
      $('fu'+type+'Cancel').hidden=true;
      $('fu'+type+'Save').textContent='حفظ';
      if(kind==='lab')syncLabFields();
    }
    function draft(kind,s){
      const type=forms[kind],old=s.rows.find(r=>r.id===editing[kind]);
      const base={id:old?.id||uuid(),kind,date:$('fu'+type+'Date')?.value||old?.date||localDay()};
      if(kind==='lab'){
        const test=$('fuLabKind').value;
        return {...base,test,name:$('fuLabName').value,result:test==='a1c'?labNumber($('fuLabValue').value):$('fuLabValue').value,unit:$('fuLabUnit').value,note:$('fuLabNote').value};
      }
      if(kind==='bp')return {...base,systolic:Number($('fuSys').value),diastolic:Number($('fuDia').value),note:$('fuBpNote').value};
      if(kind==='visit')return {...base,title:$('fuVisitTitle').value,time:$('fuVisitTime').value,note:$('fuVisitNote').value,done:old?.done??false};
      return {...base,title:$('fuQuestionText').value,done:old?.done??false};
    }
    function startEdit(r){
      const type=forms[r.kind];editing[r.kind]=r.id;
      if($('fu'+type+'Date'))$('fu'+type+'Date').value=r.date;
      if(r.kind==='lab'){
        $('fuLabKind').value=r.test;$('fuLabName').value=r.test==='other'?r.name:'';
        $('fuLabValue').value=String(r.result);$('fuLabUnit').value=r.test==='other'?r.unit:'';$('fuLabNote').value=r.note;syncLabFields();
      }else if(r.kind==='bp'){
        $('fuSys').value=String(r.systolic);$('fuDia').value=String(r.diastolic);$('fuBpNote').value=r.note;
      }else if(r.kind==='visit'){
        $('fuVisitTitle').value=r.title;$('fuVisitTime').value=r.time;$('fuVisitNote').value=r.note;
      }else $('fuQuestionText').value=r.title;
      $('fu'+type+'Save').textContent='حفظ التعديل';$('fu'+type+'Cancel').hidden=false;
      $('fu'+type+'Form').scrollIntoView?.({block:'nearest'});
      $('fu'+type+'Form').querySelector('input,select,textarea')?.focus();
    }
    function button(label,fn){const b=document.createElement('button');b.type='button';b.className='go sec fu-action';b.textContent=label;b.addEventListener('click',fn);return b;}
    function alter(id,remove){
      if(remove&&!root.confirm('حذف هذا البند من سجل المتابعة على الجهاز؟'))return;
      try{
        const s=read();
        s.rows=remove?s.rows.filter(r=>r.id!==id):s.rows.map(r=>r.id===id?{...r,done:!r.done}:r);
        write(s);
        if(remove)for(const k of kinds)if(editing[k]===id)reset(k);
        render();message(remove?'تم حذف البند.':'تم تحديث حالة البند.');
      }catch{message('تعذّر تحديث سجل المتابعة على الجهاز.',true);}
    }
    function render(){
      let s;
      try{s=read();}catch{message('تعذّرت قراءة سجل المتابعة. راجع نسختك الاحتياطية قبل استبداله.',true);return;}
      const a1c=list(s,'lab').find(r=>r.test==='a1c');
      const due=a1c&&nextDate(a1c.date,s.plan.months);
      $('fuA1cDue').textContent=due
        ?`موعد التراكمي المحسوب من آخر نتيجة: ${format(due)}${due<=localDay()?' — راجع الموعد الذي حدده طبيبك.':''}`
        :`تذكير التراكمي مضبوط على ${s.plan.months} أشهر. أضف نتيجة سابقة ليظهر الموعد التالي.`;
      $('fuHomeDue').textContent=due
        ?'موعد التراكمي المحسوب: '+format(due)+(due<=localDay()?' · راجع موعد الفحص':'')
        :'التراكمي والضغط والمواعيد وأسئلتي للطبيب';
      const bp=list(s,'bp')[0];
      const below=bp&&bp.systolic<s.plan.systolic&&bp.diastolic<s.plan.diastolic;
      $('fuBpTarget').textContent='الهدف المسجّل: أقل من '+s.plan.systolic+'/'+s.plan.diastolic+' ملم زئبق.'
        +(bp?' آخر قياس: '+bp.systolic+'/'+bp.diastolic+' — '+(below?'الرقمان أقل من الهدف.':'بلغ أحد الرقمين الهدف أو تجاوزه.'):'');
      const upcoming=list(s,'visit').filter(r=>!r.done&&r.date>=localDay()).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time))[0];
      $('fuNextVisit').textContent=upcoming?`الزيارة القادمة: ${format(upcoming.date)}${upcoming.time?' · '+upcoming.time:''} — ${upcoming.title}`:'لا توجد زيارة قادمة مسجلة.';
      for(const k of kinds){
        const dest=$('fu'+forms[k]+'List'),rows=list(s,k);
        dest.replaceChildren();
        if(!rows.length){const p=document.createElement('p');p.className='note';p.textContent='لم تسجّل بنودًا بعد.';dest.append(p);continue;}
        for(const r of rows.slice(0,limits[k])){
          const wrap=document.createElement('div');wrap.className='row fu-record';
          const info=document.createElement('div'),b=document.createElement('b'),meta=document.createElement('p');
          b.textContent=details(r);meta.className='note';meta.textContent=format(r.date)+(r.note?' — '+r.note:'');info.append(b,meta);
          const buttons=document.createElement('div');buttons.className='fu-buttons';
          if(k==='visit'||k==='question')buttons.append(button(r.done?'إعادة فتح':k==='visit'?'تمت الزيارة':'تمت المناقشة',()=>alter(r.id,false)));
          buttons.append(button('تعديل',()=>startEdit(r)),button('حذف',()=>alter(r.id,true)));
          wrap.append(info,buttons);dest.append(wrap);
        }
        if(rows.length>limits[k])dest.append(button('عرض المزيد ('+rows.length+')',()=>{limits[k]+=20;render();}));
      }
    }
    const s=(()=>{try{return read();}catch{return fresh();}})();
    $('fuMonths').value=String(s.plan.months);$('fuGoalSys').value=String(s.plan.systolic);$('fuGoalDia').value=String(s.plan.diastolic);
    $('fuPlanForm').addEventListener('submit',event=>{
      event.preventDefault();
      try{
        const s=read();s.plan=plan({months:Number($('fuMonths').value),systolic:Number($('fuGoalSys').value),diastolic:Number($('fuGoalDia').value)});write(s);render();message('تم حفظ خطة المتابعة على الجهاز.');
      }catch{message('تحقّق من مدة المتابعة وقيم هدف الضغط، ثم حاول الحفظ.',true);}
    });
    $('fuLabKind').addEventListener('change',syncLabFields);
    for(const k of kinds){
      const type=forms[k];reset(k);
      $('fu'+type+'Cancel').addEventListener('click',()=>reset(k));
      $('fu'+type+'Form').addEventListener('submit',event=>{
        event.preventDefault();
        try{
          const s=read(),r=row(draft(k,s)),index=s.rows.findIndex(x=>x.id===r.id);
          if((k==='lab'||k==='bp')&&r.date>localDay())throw new Error('future result date');
          if(index<0)s.rows.push(r);else s.rows[index]=r;
          write(s);reset(k);render();message('تم حفظ البند على الجهاز.');
        }catch{message('تعذّر الحفظ. راجع الحقول والتاريخ، وتحقّق من مساحة التخزين.',true);}
      });
    }
    $('fuExport').addEventListener('click',()=>{
      try{const s=read();if(!s.rows.length){message('لا توجد بيانات متابعة لتصديرها.',true);return;}download(followupCSV(s),'rafiq-followup-'+localDay()+'.csv');message('تم إعداد ملف المتابعة للتنزيل.');}
      catch{message('تعذّر تصدير ملف المتابعة.',true);}
    });
    root.rafiqFollowupReport=()=>{try{return reportLines(read());}catch{return[];}};
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden)return;
      $('fuLabDate').max=$('fuBpDate').max=localDay();
      render();
    });
    render();
  }
  return {KEY,fresh,normalize,validDay,nextDate,localDay,readingsIn,csv,readingsCSV,followupCSV,reportLines,download,mount};
});
