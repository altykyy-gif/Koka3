"use strict";

const profileKeys = ["rafiq_log", "rafiq_meds", "rafiq_taken", "rafiq_rem", "rafiq_fs", "rafiq_daily", "rafiq_followup"];
const legacySessionKeys = [
  "rafiq_link", "rafiq_sent", "rafiq_rsync", "rafiq_rsync2", "rafiq_meds_sent",
  "rafiq_unread", "rafiq_note_seen", "rafiq_note_text", "rafiq_note_init", "rafiq_reply_init"
];
const migrationKey = "rafiq-v50:migrated";
const highGlucose = 300;
const consecutiveHighLabel = "تنبيه: قراءتان مرتفعتان متتاليتان";
const consecutiveHighNote = "آخر قراءتين مسجلتين عند 300 ملغ/دل أو أعلى. راجع توقيت القياسين.";

function profileStorage(uid) {
  const prefix = uid ? "rafiq-v50:user:" + encodeURIComponent(uid) + ":" : "rafiq-v50:local:";
  const store = globalThis.RafiqStorage?.store || localStorage;
  return {
    getItem(key) { return store.getItem(prefix + key); },
    setItem(key, value) { store.setItem(prefix + key, value); },
    removeItem(key) { store.removeItem(prefix + key); }
  };
}

function readJSON(store, key, fallback) {
  try { return JSON.parse(store.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function esc(value) {
  const entities = {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"};
  return String(value ?? "").replace(/[&<>"']/g, char => entities[char]);
}

function validLink(link) {
  return isRecord(link) && typeof link.uid === "string" && !!link.uid
    && typeof link.pid === "string" && !!link.pid && !link.pid.includes("/");
}

function writeProfile(store, entries) {
  const previous = [];
  try {
    for (const [key, value] of entries) {
      const old = store.getItem(key);
      store.setItem(key, value);
      previous.push([key, old]);
    }
  } catch (error) {
    for (const [key, old] of previous.reverse()) {
      if (old === null) store.removeItem(key);
      else store.setItem(key, old);
    }
    throw error;
  }
}

function moveLocalProfile(from, to, keys) {
  const entries = [];
  for (const key of keys) {
    const value = from.getItem(key);
    if (value !== null && to.getItem(key) === null) entries.push([key, value]);
  }
  writeProfile(to, entries);
  for (const [key] of entries) from.removeItem(key);
}

function migrateProfiles() {
  try {
    if (localStorage.getItem(migrationKey)) return true;
    const legacyLink = readJSON(localStorage, "rafiq_link", null);
    const link = validLink(legacyLink) ? legacyLink : null;
    const owner = profileStorage(link?.uid);
    const entries = [];
    for (const key of profileKeys) {
      const old = localStorage.getItem(key);
      if (old !== null && owner.getItem(key) === null) entries.push([key, old]);
    }
    if (link && owner.getItem("rafiq_link") === null) {
      entries.push(["rafiq_link", JSON.stringify(link)]);
      const sent = readJSON(localStorage, "rafiq_sent", {});
      const events = Object.fromEntries(Object.entries(sent).filter(([key]) => /^[dt]/.test(key)));

      entries.push([syncKey(link, "sent"), JSON.stringify(events)]);
      const oldMeds = readJSON(localStorage,"rafiq_meds_sent",null);
      if (Array.isArray(oldMeds)) entries.push([syncKey(link,"legacyMedsBase"),JSON.stringify(medicationList(oldMeds))]);
    }
    writeProfile(owner, entries);
    localStorage.setItem(migrationKey, "1");
    for (const key of profileKeys.concat(legacySessionKeys)) localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error("rafiq migration:", error);
    return false;
  }
}

function syncKey(link, key) {
  return "patient:" + encodeURIComponent(link.pid) + ":" + key;
}

function validGlucose(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 20 && value <= 700;
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000;
}

function consecutiveHigh(recent) {
  return recent.length >= 2 && recent[0].v >= highGlucose && recent[1].v >= highGlucose;
}

function judge(v, w) {
  if (v < 54) return ["bad","خطر: السكر منخفض جدًا. اطلب المساعدة فورًا. إذا كنت واعيًا وقادرًا على البلع فتناول سكرًا سريع المفعول. عند فقدان الوعي أو تعذّر البلع يجب الاتصال بالطوارئ فورًا.","منخفض جدًا"];
  if (v < 70) return ["bad","السكر منخفض. للبالغ القادر على البلع، تناول 15 غرامًا من الكربوهيدرات سريعة المفعول وأعد القياس بعد 15 دقيقة. افتح إرشادات الطوارئ للمزيد.","منخفض"];
  if (v >= highGlucose) return ["bad","السكر عند 300 ملغ/دل أو أعلى. إذا استمر عند هذا المستوى، أو صَعُب التنفس أو منعك القيء من الاحتفاظ بالسوائل، فتوجّه إلى الطوارئ فورًا.","مرتفع جدًا"];
  if (w === "f") {
    if (v <= 130) return ["ok","ممتاز! سكرك الصائم في المعدل الجيد. استمر على نظامك.","جيد"];
    if (v <= 180) return ["warn","السكر أعلى قليلاً من المطلوب. تأكد من الدواء والأكل، واذكر ذلك لطبيبك.","مرتفع قليلاً"];
  } else {
    if (v <= 180) return ["ok","ممتاز! السكر بعد الأكل في المعدل الجيد.","جيد"];
    if (v <= 250) return ["warn","السكر مرتفع قليلاً بعد الأكل. قلّل النشويات والحلويات في الوجبة القادمة، وامشِ قليلاً.","مرتفع قليلاً"];
  }
  return ["warn","السكر مرتفع. اشرب الماء، وراجع طبيبك قريبًا.","مرتفع"];
}

function boundedText(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function safeClock(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function readingDoc(entry) {
  if (!isRecord(entry) || !validGlucose(entry.v) || !["f", "a"].includes(entry.w)) return null;
  const assessment = judge(entry.v, entry.w);
  return {
    v:entry.v, w:entry.w, c:["ok", "warn", "bad"].includes(entry.c) ? entry.c : assessment[0],
    t:boundedText(entry.t,50) || assessment[2], d:boundedText(entry.d,50), ts:Number(entry.ts ?? 0)
  };
}

function medicationFields(med) {
  if (!isRecord(med) || typeof med.n !== "string" || !med.n.trim() || !safeClock(med.t)) return null;
  return {n:med.n.trim().slice(0,100), t:med.t, o:boundedText(med.o,100)};
}

function medicationList(items) {
  return (Array.isArray(items) ? items : []).map(medicationFields).filter(Boolean);
}

function dailyDoc(event) {
  if (!isRecord(event) || !["m", "a"].includes(event.k) || !validTimestamp(Number(event.id))
      || typeof event.day !== "string" || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(event.day)) return null;
  return {
    k:event.k, n:boundedText(event.n,100), q:boundedText(event.q,100),
    m:Number.isFinite(event.m) && event.m >= 0 ? event.m : 0,
    day:event.day, t:boundedText(event.t,50), ts:Number(event.id)
  };
}

function validMedId(value) {
  return (typeof value === "string" || typeof value === "number")
    && /^[\w-]{1,50}$/.test(String(value)) && !["__proto__","constructor","prototype"].includes(String(value));
}

function medId() {
  return "m-" + (globalThis.crypto?.randomUUID?.() ?? (Date.now()+"-"+Math.random().toString(36).slice(2)));
}

function activeIds(object, parse) {
  if (!isRecord(object)) throw new Error("invalid medication state");
  return Object.fromEntries(Object.entries(object).map(([key,value]) => {
    if (!validMedId(key)) throw new Error("invalid medication id");
    return [key,parse(value)];
  }));
}

function backupEntries(backup) {
  if (!isRecord(backup) || backup.app !== "rafiq" || !isRecord(backup.data)) throw new Error("invalid backup");
  const data = backup.data;
  function list(key, parse) {
    if (!Array.isArray(data[key])) throw new Error("invalid list");
    return data[key].map(parse);
  }
  function dayState(value) {
    if (!isRecord(value) || (value.day && !/^\d{4}-\d{1,2}-\d{1,2}$/.test(value.day))) throw new Error("invalid day");
    return value.day || "";
  }
  const parsers = {
    rafiq_log: () => list("rafiq_log", entry => {
      const r = readingDoc(entry);
      if (!r || (r.ts !== 0 && !validTimestamp(r.ts))) throw new Error("invalid glucose reading");
      const assessment = judge(r.v,r.w);
      return {...r,c:assessment[0],t:assessment[2]};
    }),
    rafiq_meds: () => list("rafiq_meds", med => {
      const fields = medicationFields(med);
      if (!fields) throw new Error("invalid medication");
      return {...fields,id:validMedId(med.id) ? med.id : medId()};
    }),
    rafiq_daily: () => list("rafiq_daily", entry => {
      const d = dailyDoc(entry);
      if (!d) throw new Error("invalid event");
      const {ts,...event} = d;
      return {...event,id:ts};
    }),
    rafiq_taken: () => ({day:dayState(data.rafiq_taken),ids:activeIds(data.rafiq_taken.ids ?? {}, () => 1)}),
    rafiq_rem: () => ({
      day:dayState(data.rafiq_rem),
      m:activeIds(data.rafiq_rem.m ?? {}, value => {
        if (!isRecord(value) || !Number.isFinite(value.c) || !Number.isFinite(value.l)) throw new Error("invalid reminder");
        return {c:value.c,l:value.l};
      })
    }),
    rafiq_followup: () => globalThis.RafiqFollowup.normalize(data.rafiq_followup),
    rafiq_fs: () => {
      const size = Number(data.rafiq_fs);
      if (!Number.isFinite(size)) throw new Error("invalid font size");
      return Math.min(28,Math.max(16,size));
    }
  };
  const keys = profileKeys.filter(key => Object.hasOwn(data,key));
  if (!keys.length) throw new Error("empty backup");
  return keys.map(key => [key,JSON.stringify(parsers[key]())]);
}

function startRafiq(initialUser) {
  const scopeUid = initialUser?.uid ?? null;
  const storage = profileStorage(scopeUid);
  const migrated = migrateProfiles();
(function(){
var K="rafiq_log",FK="rafiq_fs";
function show(){var h=(location.hash||"#home").slice(1);if(!document.getElementById(h))h="home";
 document.querySelectorAll("section").forEach(function(s){s.classList.toggle("on",s.id===h)});
 document.querySelectorAll("nav a").forEach(function(a){a.classList.toggle("on",a.dataset.p===h)});scrollTo(0,0)}
addEventListener("hashchange",show);show();
document.querySelectorAll("[data-go]").forEach(function(b){b.onclick=function(){location.hash=b.dataset.go}});

function load(){const a=readJSON(storage,K,[]);return Array.isArray(a)?a:[]}
function store(a){storage.setItem(K,JSON.stringify(a))}
const followup=globalThis.RafiqFollowup, byId=id=>document.getElementById(id);
let filters={from:"",to:"",context:""}, shown=15;
function filtered(rows=load()){
 return followup?followup.readingsIn(rows,filters):rows.map((reading,index)=>({reading,index}));
}
window.rafiqFilteredReadings=()=>filtered().map(row=>row.reading);

window.rafiqJudge=judge;
// تصنيف الخطورة الموحَّد: يستخدمه التطبيق ولوحة الطبيب (rs: القراءات الأحدث أولاً، كل واحدة {v,w})
window.rafiqLevel=function(rs){
 if(!rs||!rs.length)return{k:4,t:"لا قراءات بعد",c:""};
 const lastThree=rs.slice(0,3);
 const severeLow=lastThree.filter(r=>r.v<54);
 if(severeLow.length)return{k:0,t:"خطر: قراءة منخفضة جدًا",c:"bad",evidence:severeLow};
 if(consecutiveHigh(rs))return{k:0,t:consecutiveHighLabel,c:"bad",evidence:rs.slice(0,2)};
 const veryHigh=lastThree.filter(r=>r.v>highGlucose);
 if(veryHigh.length)return{k:0,t:"خطر: قراءة مرتفعة جدًا",c:"bad",evidence:veryHigh};
 const low=rs.slice(0,5).filter(r=>r.v<70);
 if(low.length>=2)return{k:1,t:"تنبيه: هبوط متكرر",c:"bad",evidence:low};
 if(low.length)return{k:1,t:"تنبيه: قراءة منخفضة",c:"bad",evidence:low};
 const at300=lastThree.filter(r=>r.v===highGlucose);
 if(at300.length)return{k:1,t:"تنبيه: قراءة عند 300 ملغ/دل",c:"bad",evidence:at300};
 if(lastThree.length===3&&lastThree.every(r=>r.v>=70&&judge(r.v,r.w==="f"?"f":"a")[0]!=="ok")){
   return{k:2,t:"مرتفع في آخر القراءات",c:"warn",evidence:lastThree};
 }
 if(judge(rs[0].v,rs[0].w)[0]==="warn")return{k:2,t:"تنبيه: آخر قراءة مرتفعة",c:"warn",evidence:rs.slice(0,1)};
 return{k:3,t:"مستقر",c:"ok"}};
function readMessage(text){const e=byId("readMessage");if(e)e.textContent=text}
function render(){var a=load(),h=byId("hist"),entries=filtered(a).reverse(),visible=entries.slice(0,shown);
 const more=byId("readMore"),count=byId("readCount");
 if(more)more.hidden=entries.length<=shown;
 if(count)count.textContent=a.length?"القراءات المعروضة: "+visible.length+" من "+entries.length+" مطابقة ("+a.length+" في السجل).":"";
 if(!entries.length){h.innerHTML=a.length?"<p>لا توجد قراءات تطابق التصفية الحالية.</p>":"<p>لا توجد قراءات بعد. اكتب أول قراءة فوق 👆</p>";return}
 h.innerHTML=visible.map(function({reading:r,index:idx}){
  var j=validGlucose(r?.v)?judge(r.v,r.w):["warn","","قيمة خارج النطاق"];
  const when=validTimestamp(Number(r?.ts))?new Date(Number(r.ts)).toLocaleString("ar-LY",{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):r?.d;
  return '<div class="row"><div><b>'+esc(r?.v)+'</b> ملغ/دل<br><span class="note">'+(r?.w==="f"?"صائم":"بعد الأكل")+' – '+esc(when)+'</span></div><span class="pill '+j[0]+'">'+j[2]+'</span><button class="del" data-i="'+idx+'" aria-label="احذف القراءة">حذف</button></div>'}).join("");
 h.querySelectorAll(".del").forEach(function(b){b.onclick=function(){
  const i=Number(b.dataset.i);
  if(!confirm("حذف القراءة من سجل هذا الجهاز؟ إذا سبق إرسالها إلى طبيبك، فستبقى نسخته لديه."))return;
  const x=load(),status=byId("res");
  if(!Number.isInteger(i)||i<0||i>=x.length||JSON.stringify(a[i])!==JSON.stringify(x[i])){
    status.className="res warn";status.textContent="تغيّر السجل. اختر القراءة مرة أخرى.";render();return;
  }
  x.splice(i,1);
  try{store(x);status.className="res ok";status.textContent="تم حذف القراءة من هذا الجهاز.";render();}
  catch{status.className="res bad";status.textContent="تعذّر حذف القراءة من هذا الجهاز.";}
 }})}
byId("readFilter")?.addEventListener("submit",event=>{
 event.preventDefault();
 const candidate={from:byId("readFrom").value,to:byId("readTo").value,context:byId("readContext").value};
 try{
  if(!followup)return;
  followup.readingsIn([],candidate);filters=candidate;shown=15;render();
  window.rafiqRefreshReadingChart?.();
  readMessage("طُبّقت التصفية. القراءات القديمة بلا تاريخ كامل تظهر عند إلغاء الفترة.");
 }catch{readMessage("تحقّق من التواريخ؛ تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه.")}
});
byId("readReset")?.addEventListener("click",()=>{
 byId("readFilter").reset();filters={from:"",to:"",context:""};shown=15;render();
 window.rafiqRefreshReadingChart?.();readMessage("تُعرض جميع القراءات.");
});
byId("readMore")?.addEventListener("click",()=>{shown+=25;render()});
byId("readExport")?.addEventListener("click",()=>{
 try{
  const rows=filtered();
  if(!rows.length){readMessage("لا توجد قراءات مطابقة للتصدير.");return}
  followup.download(followup.readingsCSV(rows),"rafiq-readings-"+followup.localDay()+".csv");
  readMessage("تم إعداد ملف القراءات المطابقة للتنزيل.");
 }catch{readMessage("تعذّر تصدير القراءات.")}
});
document.getElementById("save").onclick=function(){
 const input=document.getElementById("val"), w=document.getElementById("when").value;
 const v=input.valueAsNumber, result=document.getElementById("res");
 if(!validGlucose(v)){result.className="res warn";result.textContent="اكتب قراءة بين 20 و700 ملغ/دل.";return}
 const a=load(), j=judge(v,w);
 let ts=Date.now();
 while(a.some(entry=>Number(entry?.ts)===ts)) ts++;
 const d=new Date(ts).toLocaleString("ar-LY",{day:"numeric",month:"numeric",hour:"numeric",minute:"2-digit"});
 a.push({v,w,c:j[0],t:j[2],d,ts});
 try { store(a); }
 catch {result.className="res bad";result.textContent="تعذّر حفظ القراءة على هذا الجهاز.";return}
 const recent=a.filter(entry=>validGlucose(entry?.v)).slice().sort((x,y)=>(Number(y.ts)||0)-(Number(x.ts)||0));
 result.className="res "+j[0];
 result.textContent=j[1]+(v>=highGlucose&&consecutiveHigh(recent)?" "+consecutiveHighNote:"");
 window.rafiqPush?.();
 render();
 input.value="";
};
render();
var fs=19;try{fs=+storage.getItem(FK)||19}catch(e){}
function setfs(n){fs=Math.max(16,Math.min(28,n));document.documentElement.style.setProperty("--fs",fs+"px");try{storage.setItem(FK,fs)}catch(e){}}
setfs(fs);
document.getElementById("fp").onclick=function(){setfs(fs+2)};
document.getElementById("fm").onclick=function(){setfs(fs-2)};
})();


(function(){
var MK="rafiq_meds",TK="rafiq_taken",RK="rafiq_rem";
function g(k,d){try{return JSON.parse(storage.getItem(k))||d}catch(e){return d}}
function p(k,v){try{storage.setItem(k,JSON.stringify(v))}catch(e){return}if(k===MK||k===TK)window.rafiqPush?.()}
function dk(){var d=new Date();return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate()}
function mins(t){var a=t.split(":");return +a[0]*60+ +a[1]}
function nowm(){var d=new Date();return d.getHours()*60+d.getMinutes()}
function fmt(t){var a=t.split(":"),h=+a[0];return (h%12||12)+":"+a[1]+(h>=12?" م":" ص")}
function taken(){var t=g(TK,{});if(t.day!==dk()||!isRecord(t.ids))t={day:dk(),ids:{}};return t}
function meds(){var a=g(MK,[]);return Array.isArray(a)?a.filter(m=>medicationFields(m)&&validMedId(m.id)):[]}
function late(){var tk=taken(),n=nowm();return meds().filter(function(m){return !Object.hasOwn(tk.ids,m.id)&&mins(m.t)<=n})}
function render(){
 var ms=meds().sort(function(a,b){return mins(a.t)-mins(b.t)}),tk=taken(),n=nowm(),box=document.getElementById("today");
 if(!ms.length)box.innerHTML="<p>لم تضف أدوية بعد. أضف دواءك الأول من الأسفل 👇</p>";
 else box.innerHTML=ms.map(function(m){var done=Object.hasOwn(tk.ids,m.id),isLate=!done&&mins(m.t)<=n;
  var st=done?'<span class="pill ok">تم ✅</span>':isLate?'<span class="pill bad">فات موعده</span>':'<span class="pill warn">قادم</span>';
  return '<div class="dose"><div class="nm">'+esc(m.n)+'<br><span class="note">'+esc(fmt(m.t))+(m.o?" – "+esc(m.o):"")+'</span></div>'+st+
   (done?"":'<button class="tk" data-t="'+esc(m.id)+'">أخذتُ الدواء</button>')+'<button class="del" data-d="'+esc(m.id)+'" aria-label="احذف الدواء">حذف</button></div>'}).join("");
 box.querySelectorAll("[data-t]").forEach(function(b){b.onclick=function(){var t=taken();t.ids[b.dataset.t]=1;p(TK,t);render();banner()}});
 box.querySelectorAll("[data-d]").forEach(function(b){b.onclick=function(){if(confirm("حذف هذا الدواء؟")){p(MK,meds().filter(function(m){return String(m.id)!==b.dataset.d}));render();banner()}}});
}
function banner(){var l=late(),h=l.length?'<div class="al">⏰ حان موعد: '+l.map(function(m){return esc(m.n)+" ("+esc(fmt(m.t))+")"}).join("، ")+'</div>':"";
 document.querySelectorAll(".due").forEach(function(d){d.innerHTML=h})}
function beep(){try{var c=new (window.AudioContext||window.webkitAudioContext)(),o=c.createOscillator();o.frequency.value=880;o.connect(c.destination);o.start();setTimeout(function(){o.stop();c.close()},600)}catch(e){}}
function notify(m){
 var title="💊 موعد الدواء",body=m.n+" – "+fmt(m.t)+(m.o?" ("+m.o+")":"");
 try{navigator.vibrate&&navigator.vibrate([300,150,300])}catch(e){}beep();
 if(!("Notification" in window)||Notification.permission!=="granted")return;
 var o={body:body,icon:"icons/icon-192.png",tag:"m"+m.id,renotify:true,vibrate:[300,150,300]};
 if(navigator.serviceWorker&&navigator.serviceWorker.ready)navigator.serviceWorker.ready.then(function(r){r.showNotification(title,o)}).catch(function(){try{new Notification(title,o)}catch(e){}});
 else try{new Notification(title,o)}catch(e){}}
function check(){var r=g(RK,{});if(r.day!==dk()||!isRecord(r.m))r={day:dk(),m:{}};var now=Date.now(),ch=false;
 late().forEach(function(m){var x=r.m[m.id]||{c:0,l:0};if(x.c<4&&now-x.l>=15*60000){notify(m);r.m[m.id]={c:x.c+1,l:now};ch=true}});
 if(ch)p(RK,r);render();banner()}
document.getElementById("madd").onclick=function(){var n=document.getElementById("mn").value.trim(),t=document.getElementById("mt").value,o=document.getElementById("mo").value.trim();
 if(!n||!safeClock(t)){alert("اكتب اسم الدواء ووقته");return}
 var a=meds();if(a.length>=30){alert("الحد الأقصى 30 دواءً في القائمة.");return}
 a.push({id:medId(),n:n.slice(0,100),t,o:o.slice(0,100)});p(MK,a);document.getElementById("mn").value="";document.getElementById("mo").value="";check()};
function nst(){var s=document.getElementById("nstat"),b=document.getElementById("notif");
 if(!("Notification" in window)){s.textContent="جهازك لا يدعم الإشعارات. سيظهر التنبيه داخل التطبيق فقط.";b.style.display="none";return}
 var m={granted:"✅ التنبيهات مفعّلة.",denied:"❌ التنبيهات مغلقة. فعّلها من إعدادات المتصفح للموقع.",default:"التنبيهات غير مفعّلة بعد."};
 s.textContent=m[Notification.permission];if(Notification.permission==="granted")b.style.display="none"}
document.getElementById("notif").onclick=function(){Notification.requestPermission().then(nst)};
window.rafiqRefreshMeds=function(){render();banner()};
nst();check();setInterval(check,30000);
document.addEventListener("visibilitychange",function(){if(!document.hidden)check()});
})();

(function(){
var LK="rafiq_log",MK="rafiq_meds",KEYS=profileKeys;
function g(k,d){try{return JSON.parse(storage.getItem(k))||d}catch(e){return d}}
function fmt(t){var a=String(t).split(":"),h=+a[0];return (h%12||12)+":"+a[1]+(h>=12?" م":" ص")}
function logs(){const a=g(LK,[]);return Array.isArray(a)?a.filter(r=>validGlucose(r?.v)):[]}
/* 1) الرسم البياني */
function chart(){
 var box=document.getElementById("chart"),a=(window.rafiqFilteredReadings?.()||logs()).filter(r=>validGlucose(r?.v)).slice(-10);
 if(a.length<2){box.innerHTML="<p>يظهر الرسم عند توفر قراءتين على الأقل في السجل المعروض 📈</p>";return}
 var W=340,H=210,L=30,R=12,T=18,B=22,mx=Math.max(315,Math.max.apply(null,a.map(function(r){return r.v}))+10),mn=Math.min(40,Math.min(...a.map(r=>r.v))-8);
 function y(v){return T+(mx-v)/(mx-mn)*(H-T-B)}
 function x(i){return W-R-i*(W-L-R)/(a.length-1)}
 var col={ok:"var(--ok)",warn:"var(--warn)",bad:"var(--bad)"};
 var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="رسم بياني لآخر '+a.length+' قراءات">';
 svg+='<rect x="'+L+'" y="'+y(180)+'" width="'+(W-L-R)+'" height="'+(y(70)-y(180))+'" fill="var(--okbg)"/>';
 [70,180,300].forEach(function(v){svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="var(--line)" stroke-dasharray="4 4"/><text x="'+(L-4)+'" y="'+(y(v)+4)+'" font-size="11" text-anchor="end" fill="var(--sub)">'+v+'</text>'});
 var pts=[];a.forEach(function(r,i){pts.push(x(i).toFixed(1)+","+y(r.v).toFixed(1))});
 svg+='<polyline points="'+pts.join(" ")+'" fill="none" stroke="var(--main)" stroke-width="2.5"/>';
 a.slice().reverse().forEach(function(r,j){var i=a.length-1-j;
  svg+='<circle cx="'+x(i).toFixed(1)+'" cy="'+y(r.v).toFixed(1)+'" r="6" fill="'+col[judge(r.v,r.w)[0]]+'" stroke="var(--card)" stroke-width="2"/><text x="'+x(i).toFixed(1)+'" y="'+(y(r.v)-10).toFixed(1)+'" font-size="12" font-weight="700" text-anchor="middle" fill="var(--ink)">'+r.v+'</text>'});
 svg+='<text x="'+(W-R)+'" y="'+(H-4)+'" font-size="11" text-anchor="end" fill="var(--sub)">الأقدم</text><text x="'+L+'" y="'+(H-4)+'" font-size="11" fill="var(--sub)">الأحدث</text></svg>';
 var vs=a.map(function(r){return r.v}),avg=Math.round(vs.reduce(function(p,c){return p+c},0)/vs.length);
 box.innerHTML=svg+'<div class="stats"><span>'+avg+'<small>المتوسط</small></span><span>'+Math.max.apply(null,vs)+'<small>الأعلى</small></span><span>'+Math.min.apply(null,vs)+'<small>الأدنى</small></span></div><p class="note">المنطقة المظللة مرجع بصري (70–180 ملغ/دل). يعرض الرسم آخر '+a.length+' من القراءات المطابقة.</p>';
}
/* 2) تنبيه المخاطر */
function trend(a){
 if(a.length<4)return null;var w=a[a.length-1].w,b=a.filter(function(r){return r.w===w}).slice(-6);
 if(b.length<4)return null;var n=b.length,sx=0,sy=0,sxy=0,sxx=0;
 b.forEach(function(r,i){sx+=i;sy+=r.v;sxy+=i*r.v;sxx+=i*i});
 var sl=(n*sxy-sx*sy)/(n*sxx-sx*sx),pr=Math.round((sy-sl*sx)/n+sl*n);
 var recent=b[0].w==="f"?"قراءات الصيام الأخيرة":"قراءات ما بعد الأكل الأخيرة";
 if(sl>=8&&pr>180)return["warn","📈 "+recent+" تميل إلى الارتفاع. اعرض تسلسل القراءات على طبيبك."];
 if(sl<=-8&&pr<80)return["warn","📉 "+recent+" تميل إلى الانخفاض. اعرض تسلسل القراءات على طبيبك."];
 return null}
function avg(x){return x.reduce(function(p,c){return p+c},0)/x.length}
function dkOf(t){var d=new Date(t);return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate()}
function insights(){
 var box=document.getElementById("ins"),a=logs().filter(function(r){return r.ts}),raw=g("rafiq_daily",[]),dl=(Array.isArray(raw)?raw:[]).filter(dailyDoc),m=[],hv=[],ot=[],mins={},has={},ac=[],rs=[];
 var meals=dl.filter(function(x){return x.k==="m"});
 a.filter(function(r){return r.w==="a"}).forEach(function(r){var b=null;meals.forEach(function(x){if(x.id<=r.ts&&r.ts-x.id<=4*3600000&&(!b||x.id>b.id))b=x});if(b)(String(b.q||"").indexOf("ثقيلة")===0?hv:ot).push(r.v)});
 if(hv.length>=2&&ot.length>=2&&avg(hv)-avg(ot)>=20)m.push("بعد الوجبات الثقيلة كان سكرك أعلى بنحو "+Math.round(avg(hv)-avg(ot))+" من الوجبات الأخرى.");
 dl.forEach(function(x){has[x.day]=1;if(x.k==="a")mins[x.day]=(mins[x.day]||0)+x.m});
 a.forEach(function(r){var d=dkOf(r.ts);if(mins[d]>=30)ac.push(r.v);else if(has[d])rs.push(r.v)});
 if(ac.length>=2&&rs.length>=2&&avg(rs)-avg(ac)>=15)m.push("في الأيام التي مشيت فيها 30 دقيقة أو أكثر كان سكرك أقل بنحو "+Math.round(avg(rs)-avg(ac))+".");
 box.style.display=m.length?"block":"none";
 box.innerHTML=m.length?'<h3 style="margin-top:0">🔎 ملاحظات من بياناتك</h3><ul>'+m.map(function(x){return "<li>"+x+"</li>"}).join("")+'</ul><p class="note">ملاحظات تجريبية من بياناتك فقط وليست تشخيصاً. اعرضها على طبيبك.</p>':""}
function risk(){
 var a=logs().slice().sort((x,y)=>(Number(x.ts)||0)-(Number(y.ts)||0)),l3=a.slice(-3),l5=a.slice(-5),m=[];
 function hi(r){return r.v>=70&&judge(r.v,r.w)[0]!=="ok"}
 if(l3.some(function(r){return r.v<54}))m.push(["bad","⚠️ ظهرت قراءة منخفضة جدًا (أقل من 54). إذا كان الهبوط قائمًا الآن، اطلب المساعدة فورًا واتبع إرشادات الطوارئ."]);
 if(consecutiveHigh(l3.slice().reverse()))m.push(["bad","⚠️ "+consecutiveHighNote]);
 if(l3.some(r=>r.v>=highGlucose))m.push(["bad","⚠️ سُجّلت قراءة عند 300 ملغ/دل أو أعلى. إذا ظلّ القياس الحالي عند هذا المستوى، أو صَعُب التنفس أو منعك القيء من الاحتفاظ بالسوائل، فتوجّه إلى الطوارئ فورًا."]);
 if(!m.length){
  if(l5.filter(function(r){return r.v<70}).length>=2)m.push(["bad","⚠️ تكرر نزول السكر في قراءاتك الأخيرة. لا تتأخر عن وجباتك، وأخبر طبيبك قريباً."]);
  else if(l3.at(-1)?.v<70)m.push(["bad","⚠️ آخر قراءة مسجّلة منخفضة. إذا كان الهبوط قائمًا الآن، راجع إرشادات الطوارئ في الموقع."]);
  if(l3.length===3&&l3.every(hi))m.push(["warn","⚠️ آخر 3 قراءات كلها أعلى من المطلوب. راجع أكلك وموعد دوائك، وأخبر طبيبك في أقرب موعد."]);
  const tr=trend(a);if(tr)m.push(tr);
 }
 var h=m.map(function(x){return '<div class="res '+x[0]+'">'+x[1]+'</div>'}).join("");
 document.querySelectorAll(".risk").forEach(function(d){d.innerHTML=h});
}
function refresh(){chart();risk();insights()}
window.rafiqRefreshReadingChart=chart;
addEventListener("hashchange",refresh);
refresh();
var hist=document.getElementById("hist");
if(window.MutationObserver)new MutationObserver(refresh).observe(hist,{childList:true});
/* 3) تقرير الطبيب */
function today(){return new Date().toLocaleDateString("ar-LY",{year:"numeric",month:"numeric",day:"numeric"})}
function data(){var a=logs().slice(-15).reverse(),ms=medicationList(g(MK,[])).sort(function(p,q){return p.t<q.t?-1:1}),vs=a.map(function(r){return r.v});
 return{a:a,ms:ms,avg:vs.length?Math.round(vs.reduce(function(p,c){return p+c},0)/vs.length):0,mx:vs.length?Math.max.apply(null,vs):0,mn:vs.length?Math.min.apply(null,vs):0}}
function wh(r){return r.w==="f"?"صائم":"بعد الأكل"}
function pname(){return (document.getElementById("pname").value||"").trim()}
function selectedFollowup(){return document.getElementById("reportFollowup")?.checked?window.rafiqFollowupReport?.()||[]:[]}
function text(){var d=data(),pn=pname(),t="تقرير متابعة السكر – رفيق السكري\n"+(pn?"اسم المريض: "+pn+"\n":"")+"التاريخ: "+today()+"\n\n";
 t+=d.a.length?"القراءات (الأحدث أولاً):\n"+d.a.map(function(r){return "• "+r.v+" mg/dL – "+wh(r)+" – "+r.d+" – "+judge(r.v,r.w)[2]}).join("\n")+"\n\nالمتوسط: "+d.avg+" | الأعلى: "+d.mx+" | الأدنى: "+d.mn:"لا توجد قراءات مسجلة.";
 t+="\n\nالأدوية:\n"+(d.ms.length?d.ms.map(function(m){return "• "+m.n+" – "+fmt(m.t)+(m.o?" ("+m.o+")":"")}).join("\n"):"لا توجد أدوية مسجلة.");
 const summary=selectedFollowup();
 if(summary.length)t+="\n\nملخص المتابعة:\n"+summary.map(line=>"• "+line).join("\n");
 return t+"\n\nملاحظة: التقرير من تطبيق إرشادي ولا يغني عن الفحص الطبي."}
document.getElementById("rprint").onclick=function(){var d=data(),h='<h2>تقرير متابعة السكر – رفيق السكري</h2><p>الاسم: '+(pname()?esc(pname()):'____________________')+' &nbsp; التاريخ: '+today()+'</p>';
 h+=d.a.length?'<table><tr><th>القراءة (mg/dL)</th><th>السياق</th><th>التاريخ</th><th>التقييم</th></tr>'+d.a.map(function(r){return '<tr><td>'+r.v+'</td><td>'+wh(r)+'</td><td>'+esc(r.d)+'</td><td>'+judge(r.v,r.w)[2]+'</td></tr>'}).join("")+'</table><p>المتوسط: '+d.avg+' – الأعلى: '+d.mx+' – الأدنى: '+d.mn+'</p>':'<p>لا توجد قراءات مسجلة.</p>';
 h+='<h3>الأدوية</h3>'+(d.ms.length?'<table><tr><th>الدواء</th><th>الوقت</th><th>ملاحظة</th></tr>'+d.ms.map(function(m){return '<tr><td>'+esc(m.n)+'</td><td>'+esc(fmt(m.t))+'</td><td>'+esc(m.o||"")+'</td></tr>'}).join("")+'</table>':'<p>لا توجد أدوية مسجلة.</p>');
 const summary=selectedFollowup();
 if(summary.length)h+='<h3>ملخص المتابعة</h3><ul>'+summary.map(line=>'<li>'+esc(line)+'</li>').join("")+'</ul>';
 h+='<p style="font-size:12px">التقرير من تطبيق إرشادي ولا يغني عن الفحص الطبي.</p>';
 document.getElementById("printarea").innerHTML=h;window.print()};
document.getElementById("rshare").onclick=function(){var t=text();
 if(navigator.share){navigator.share({title:"تقرير السكر",text:t}).catch(function(){})}
 else window.open("https://wa.me/?text="+encodeURIComponent(t),"_blank","noopener,noreferrer")};
/* 4) نسخ احتياطي */
const $=id=>document.getElementById(id), bm=$("bmsg"), cryptoBackup=globalThis.RafiqBackup;
let operation=null,pending=null,busy=false;
function say(c,t){bm.className=t?"res "+c:"";bm.textContent=t}
function lock(value){
 busy=value;
 ["bexp","bimp","bcrypt","baction","bcancel"].forEach(id=>{const e=$(id);if(e)e.disabled=value});
}
function closeBackup(){
 operation=null;pending=null;
 if($("bpanel")){
  $("bpanel").hidden=true;$("bpass").value="";$("bconfirm").value="";
 }
}
function openBackup(mode,envelope=null){
 closeBackup();
 if(!cryptoBackup?.supported()){
  say("warn","التشفير غير متاح في هذه الصفحة. افتح الموقع عبر HTTPS أو استخدم النسخة العادية.");return;
 }
 operation=mode;pending=envelope;
 $("btitle").textContent=mode==="export"?"كلمة مرور جديدة للنسخة المشفّرة":"أدخل كلمة مرور النسخة المشفّرة";
 $("bconfirmRow").hidden=mode!=="export";
 $("baction").textContent=mode==="export"?"تشفير وتنزيل":"فتح النسخة";
 $("bpass").autocomplete=mode==="export"?"new-password":"current-password";
 $("bpanel").hidden=false;say("","");$("bpass").focus();
}
function backupPayload(){
 const data={};
 for(const k of KEYS){const v=storage.getItem(k);if(v!==null)data[k]=JSON.parse(v);}
 return {app:"rafiq",v:2,date:new Date().toISOString(),owner:scopeUid,data};
}
function saveBackup(payload,encrypted){
 const content=JSON.stringify(payload);
 const blob=new Blob([content],{type:"application/json"});
 if(blob.size>(cryptoBackup?.MAX_FILE_BYTES||18*1024*1024))throw new Error("backup too large");
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="rafiq-"+(encrypted?"encrypted-":"")+"backup-"+todayISO()+".json";document.body.appendChild(a);
 try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);}
}
function todayISO(){return new Date().toISOString().slice(0,10)}
async function restoreBackup(payload){
 const entries=backupEntries(payload);
 const other=typeof payload.owner==="string"&&payload.owner!==scopeUid;
 const note=other?"أُنشئت هذه النسخة في حساب مختلف. تابع فقط إذا كانت البيانات تخصك. ":"";
 if(!confirm(note+"سيُستبدل ما يقابله من السجل الحالي بالأجزاء الموجودة في الملف. عند تفعيل الربط، تتزامن البيانات المعتادة مع طبيبك."))return false;
 writeProfile(storage,entries);
 window.rafiqInvalidateReadings?.();
 say("ok","تم استرجاع بياناتك ✅");
 await globalThis.RafiqStorage?.flush();
 setTimeout(()=>location.reload(),700);
 return true;
}
function invalidBackup(){
 say("bad","تعذّر الاسترجاع. تأكّد من أن الملف نسخة صالحة، وأن قراءات السكر فيها بين 20 و700 ملغ/دل.");
}
$("bexp").onclick=function(){
 if(busy)return;
 try{saveBackup(backupPayload(),false);closeBackup();say("ok","تم إعداد النسخة العادية للتنزيل. احفظها في مكان خاص.");}
 catch{say("bad","تعذّر حفظ النسخة على هذا الجهاز.");}
};
if($("bcrypt"))$("bcrypt").onclick=()=>{if(!busy)openBackup("export")};
if($("bcancel"))$("bcancel").onclick=()=>{if(!busy){closeBackup();say("","");}};
if($("bpanel"))$("bpanel").onsubmit=async event=>{
 event.preventDefault();
 if(!operation||busy)return;
 const pass=$("bpass").value,mode=operation;
 if(!cryptoBackup.passwordOK(pass)){
  say("warn","اكتب كلمة مرور النسخة، بعشرة محارف على الأقل.");return;
 }
 if(mode==="export"&&pass!==$("bconfirm").value){
  say("warn","كلمتا المرور غير متطابقتين.");return;
 }
 $("bpass").value="";$("bconfirm").value="";
 lock(true);say("","");let restoring=false;
 try{
  if(mode==="export"){
   saveBackup(await cryptoBackup.encrypt(backupPayload(),pass),true);
   closeBackup();say("ok","تم إعداد النسخة المشفّرة للتنزيل. ستحتاج كلمة المرور عند استرجاعها.");
  }else{
   let payload;
   try{payload=await cryptoBackup.decrypt(pending,pass);}
   catch{say("bad","تعذّر فتح النسخة. تأكّد من كلمة المرور وسلامة الملف.");$("bpass").focus();return;}
   restoring=await restoreBackup(payload);
   closeBackup();
  }
 }catch{if(mode==="export")say("bad","تعذّر إنشاء النسخة المشفّرة.");else invalidBackup();}
 finally{if(!restoring)lock(false);}
};
$("bimp").onchange=function(ev){
 const file=ev.target.files[0];if(!file||busy)return;
 closeBackup();
 if(file.size>(cryptoBackup?.MAX_FILE_BYTES||18*1024*1024)){
  ev.target.value="";say("bad","ملف النسخة أكبر من الحجم الذي يمكن استرجاعه.");return;
 }
 const fr=new FileReader();lock(true);say("","");
 fr.onload=async function(){
  let restoring=false;
  try{
   const payload=JSON.parse(fr.result);
   if(payload?.encrypted===true&&payload.app==="rafiq")openBackup("import",payload);
   else restoring=await restoreBackup(payload);
  }catch{invalidBackup();}
  finally{ev.target.value="";if(!restoring)lock(false);}
 };
 fr.onerror=fr.onabort=function(){ev.target.value="";lock(false);say("bad","تعذّرت قراءة ملف النسخة الاحتياطية.");};
 try{fr.readAsText(file);}catch{fr.onerror();}
};
})();

globalThis.RafiqFollowup?.mount(storage);

(function(){
var DK="rafiq_daily";
function g(){try{var v=JSON.parse(storage.getItem(DK));return Array.isArray(v)?v:[]}catch(e){return[]}}
function p(v){try{storage.setItem(DK,JSON.stringify(v.slice(-200)))}catch(e){return}window.rafiqPush?.()}
function dk(){var d=new Date();return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate()}
function tm(){return new Date().toLocaleTimeString("ar-LY",{hour:"numeric",minute:"2-digit"})}
var sel={t:"",q:""};
function pick(id,key){var b=document.querySelectorAll("#"+id+" button");b.forEach(function(x){x.setAttribute("aria-pressed","false");x.onclick=function(){b.forEach(function(y){y.setAttribute("aria-pressed","false")});x.setAttribute("aria-pressed","true");sel[key]=x.dataset.v}})}
pick("mt2","t");pick("mq2","q");
function render(){
 var a=g().filter(function(r){return r&&r.day===dk()}),w=a.filter(function(r){return r.k==="a"}).reduce(function(s,r){return s+r.m},0);
 var box=document.getElementById("dlist");
 box.innerHTML=a.length?a.slice().reverse().map(function(r){var i=g().indexOf(r);return ""}).join(""):"<p>لم تسجّل شيئاً اليوم بعد.</p>";
 if(a.length){var all=g();box.innerHTML=a.slice().reverse().map(function(r){
  var idx=all.findIndex(function(x){return x.id===r.id});
  return '<div class="row"><div>'+(r.k==="m"?"🍽️ <b>"+esc(r.n)+"</b> – "+esc(r.q):"🚶 <b>"+esc(r.n)+"</b> – "+(+r.m)+" دقيقة")+'<br><span class="note">'+esc(r.t)+'</span></div><button class="del" data-i="'+idx+'" aria-label="احذف">حذف</button></div>'}).join("");
  box.querySelectorAll(".del").forEach(function(b){b.onclick=function(){var x=g();x.splice(+b.dataset.i,1);p(x);render()}})}
 var s=document.getElementById("wsum"),c=w>=30?"ok":"warn";
 s.innerHTML='<div class="res '+c+'">حركتك اليوم: '+w+' دقيقة'+(w>=30?" 👏 أحسنت، حققت الهدف!":" من 30. كل دقيقة تفيد.")+'</div>'}
document.getElementById("msave").onclick=function(){
 if(!sel.t||!sel.q){alert("اختر الوجبة وكيف كانت أولاً");return}
 var a=g();a.push({id:Date.now(),day:dk(),t:tm(),k:"m",n:sel.t,q:sel.q});p(a);
 document.querySelectorAll("#mt2 button,#mq2 button").forEach(function(b){b.setAttribute("aria-pressed","false")});
 var last=sel.q;sel={t:"",q:""};render();
 if(last.indexOf("ثقيلة")===0)alert("وجبة ثقيلة: امشِ 10 دقائق، وقِس سكرك بعد ساعتين.")};
document.querySelectorAll("#act button").forEach(function(b){b.onclick=function(){var a=g();a.push({id:Date.now(),day:dk(),t:tm(),k:"a",n:b.dataset.n,m:+b.dataset.m});p(a);render()}});
render();
})();


/* 5) لوحة الطبيب: تسجيل الدخول وقائمة المرضى */
(function(){
  var $=function(i){return document.getElementById(i)};
  var A=null,D=null;
  try{ if(window.firebase&&firebase.auth&&firebase.firestore){ A=firebase.auth(); D=firebase.firestore(); } }
  catch(e){ console.error("Firebase init:",e); }
  if(!A||!D){ $("dNoFb").hidden=false; $("dLogin").hidden=true; $("accountStatus").textContent="وضع الاستخدام المحلي."; return; }
  var ERR={"auth/invalid-email":"البريد غير صحيح.","auth/missing-password":"اكتب كلمة المرور.",
    "auth/invalid-credential":"البريد أو كلمة المرور غير صحيحة.","auth/wrong-password":"كلمة المرور غير صحيحة.",
    "auth/user-not-found":"لا يوجد حساب بهذا البريد.","auth/too-many-requests":"محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.",
    "auth/network-request-failed":"لا يوجد اتصال بالإنترنت."};
  function errText(e){return ERR[e&&e.code]||"حدث خطأ، حاول مرة أخرى."}
  function msg(id,c,t){var el=$(id);el.className="res "+c;el.textContent=t;el.hidden=!t}
  // تصنيف الخطورة من آخر القراءات (الأحدث أولاً) بنفس قواعد التطبيق
  function level(rs){return window.rafiqLevel(rs)}
  function withTimeout(p,ms){
    return new Promise(function(res,rej){
      var t=setTimeout(function(){rej(new Error("timeout"))},ms);
      p.then(function(v){clearTimeout(t);res(v)},function(e){clearTimeout(t);rej(e)});
    });
  }
  var APP_VER="v52";
  function showEvidence(rows) {
    if (!rows?.length) return "";
    const evidence=rows.map(r=>{
      const ts=Number(r.ts);
      const time=validTimestamp(ts)?new Date(ts).toLocaleString("ar-LY"):(r.d||"وقت غير متاح");
      return '<li><b>'+esc(r.v)+' ملغ/دل</b> · '+esc(wh2(r.w))+' · '+esc(time)+'</li>';
    });
    return '<details class="level-evidence"><summary>القراءات التي أدّت إلى التصنيف</summary><ul>'+evidence.join("")+'</ul></details>';
  }
  // رسم القائمة: الأسماء تظهر فوراً، والحالة تُحدَّث بعد قراءة القراءات
  function draw(rows){
    var dg=rows.filter(function(r){return r.lv&&r.lv.k<=1}).length;
    var al=$("dAlert");if(al){al.hidden=!dg;al.textContent=dg?"⚠️ عدد الملفات ذات القراءات ذات الأولوية للمراجعة: "+dg+".":""}
    $("dList").innerHTML=rows.map(function(r){
      var lv=r.lv||{t:"جارٍ حساب الحالة…",c:""};
      var st=r.linked?"🔗 مرتبط بالتطبيق":"غير مرتبط بعد";
      var lb=r.linked
        ?'<button class="go sec" data-unlink="'+esc(r.id)+'" style="margin-top:10px">🔓 فك الربط</button>'
        :'<button class="go sec" data-link="'+esc(r.id)+'" data-name="'+esc(r.name)+'" data-old="'+esc(r.code||"")+'" style="margin-top:10px">🔑 إنشاء رمز ربط</button>';
      var last=r.last?'<p class="note" style="margin:6px 0 0">آخر قراءة: <b>'+esc(r.last.v)+' mg/dL</b> – '+esc(wh2(r.last.w))+' – '+esc(r.last.d||"")+'</p>':'';
      return '<div class="card"><b>'+esc(r.name)+'</b><div class="res '+lv.c+'" style="margin:8px 0 0">'+lv.t+'</div>'+last+showEvidence(lv.evidence)+'<p class="note" style="margin:6px 0 0">'+st+'</p>'+lb+'<button class="go sec" data-det="'+esc(r.id)+'" style="margin-top:10px">📋 عرض التفاصيل والنتائج</button><div class="det" hidden data-open="0"></div><button class="go sec" data-del="'+esc(r.id)+'" data-name="'+esc(r.name)+'" style="margin-top:10px">🗑️ حذف هذا المريض</button></div>';
    }).join("")+'<p class="note" dir="ltr">'+APP_VER+'</p>';
  }
  function load(uid){
    var box=$("dList");
    function stage(t){box.innerHTML='<p>'+t+' <small dir="ltr">'+APP_VER+'</small></p>'}
    stage("جارٍ التحميل… المرحلة 1 من 3: جلب قائمة المرضى");
    D.collection("patients").where("doctorId","==",uid).get({source:"server"})
      .then(function(snap){
        stage("المرحلة 2 من 3: تم جلب "+snap.size+" مريض");
        var rows=[];
        snap.forEach(function(d){rows.push({id:d.id,name:String(d.data().name||""),linked:!!d.data().patientUid,code:d.data().linkCode||""})});
        if(!rows.length){box.innerHTML="<p>لا يوجد مرضى بعد. أضف أول مريض من الأعلى. <small dir=\"ltr\">"+APP_VER+"</small></p>";return}
        rows.sort(function(a,b){return a.name<b.name?-1:a.name>b.name?1:0});
        stage("المرحلة 3 من 3: رسم "+rows.length+" مريض");
        try{ draw(rows); }
        catch(err){ box.textContent="خطأ في الرسم: "+(err&&err.message?err.message:String(err)); return; }
        return Promise.all(rows.map(function(r){
          return withTimeout(
            D.collection("patients").doc(r.id).collection("readings").orderBy("ts","desc").limit(5).get({source:"server"}),
            8000
          ).then(function(rs){
            var vs=[];rs.forEach(function(x){var q=x.data();if(validGlucose(q.v))vs.push({v:Number(q.v),w:q.w,ts:q.ts,d:q.d})});
            r.lv=level(vs);r.last=rs.docs.length?rs.docs[0].data():null;
          }).catch(function(){r.lv={k:2.5,t:"تعذّر تحميل القراءات، حدّث القائمة",c:"warn"}});
        })).then(function(){
          rows.sort(function(a,b){return (a.lv.k-b.lv.k)||(a.name<b.name?-1:a.name>b.name?1:0)});
          draw(rows);
        });
      })
      .catch(function(e){
        console.error(e);
        box.textContent="تعذّر تحميل المرضى: "+((e&&(e.code||e.message))||"unknown");
      });
  }
  // ربط السجل بالحساب الحالي وتأكيد الوجهة قبل مزامنة أي بيانات.
  let verifiedLink = null;
  let approvedDoctor = false;
  let checkingAccount = null;
  let linkingFromGuest = false;
  let linkingPatient = false;
  let leavingSession = false;
  let blockingLink = false;

  function sameSession() {
    return !leavingSession && (A.currentUser?.uid ?? null) === scopeUid;
  }
  function getLink() {
    const link = readJSON(storage,"rafiq_link",null);
    return validLink(link) && link.uid === scopeUid ? link : null;
  }
  function setLink(link) {
    if (link) storage.setItem("rafiq_link",JSON.stringify(link));
    else storage.removeItem("rafiq_link");
  }
  function activeLink() {
    return sameSession() ? verifiedLink : null;
  }
  function stillLinked(link) {
    return activeLink()?.pid === link.pid;
  }
  function showLinkStatus() {
    const link = getLink();
    const anonymous = !!A.currentUser?.isAnonymous;
    const nst = !("Notification" in window) ? "غير مدعومة" : ({
      granted:"مفعّلة ✅", denied:"مرفوضة", default:"غير مفعّلة"
    })[Notification.permission];
    $("lkStatus").textContent = (activeLink()
      ? "الحالة: مرتبط بطبيبك ✅ وتُزامَن بياناتك تلقائيًا."
      : link ? "الحالة: الربط محفوظ على هذا الجهاز. يجري تأكيده عند الاتصال."
        : blockingLink ? "الحالة: وجد التطبيق أكثر من ملف مرتبط. اطلب من طبيبك تصحيح الربط."
          : "الحالة: غير مرتبط بعد.")+" | الإشعارات: "+nst;
    $("lkUnlink").hidden = !activeLink();
    $("lkSyncMeds").hidden = !link;
    $("svCard").hidden = !activeLink() || !anonymous;
    $("lkNotifyBtn").hidden = !activeLink() || !("Notification" in window) || Notification.permission === "granted";
    $("lkTestNotif").hidden = !activeLink() || !("Notification" in window) || Notification.permission !== "granted";
    $("lkLocalBox").hidden = !!scopeUid || !profileKeys.some(key => key !== "rafiq_fs" && storage.getItem(key) !== null);
    $("lkBtn").disabled = linkingPatient || !!link || approvedDoctor || blockingLink;
  }
  function myPatients(user) {
    return withTimeout(D.collection("patients").where("patientUid","==",user.uid)
      .limit(2).get({source:"server"}),12000);
  }

  window.rafiqPush = function() { return window.rafiqSyncAll?.(true); };
  $("lkBtn").onclick = async function() {
    const code = $("lkCode").value.trim();
    if (!$("lkConsent").checked) {
      msg("lkMsg","bad","يجب الموافقة أولًا على إرسال بياناتك إلى طبيبك.");
      return;
    }
    if (!/^\d{8}$/.test(code)) {
      msg("lkMsg","bad","اكتب الرمز المكوّن من 8 أرقام.");
      return;
    }
    if (linkingPatient || getLink() || approvedDoctor || blockingLink) return;
    const fromGuest = !scopeUid;
    const transfer = fromGuest && !$("lkLocalBox").hidden && $("lkLocal").checked;
    let user;
    let linked = false;
    linkingFromGuest = fromGuest;
    linkingPatient = true;
    $("lkBtn").disabled = true;
    msg("lkMsg","warn","جارٍ الربط… انتظر.");
    try {
      user = A.currentUser || (await A.signInAnonymously()).user;
      if (fromGuest ? !user.isAnonymous : user.uid !== scopeUid) throw {code:"session-changed"};
      if (!(await myPatients(user)).empty) throw {code:"already-linked"};
      const ref = D.collection("links").doc(code);
      const invitation = await withTimeout(ref.get({source:"server"}),12000);
      const invite = invitation.data();
      if (!invite || invite.used || invite.exp <= Date.now()) throw {code:"invalid-code"};
      if (A.currentUser?.uid !== user.uid) throw {code:"session-changed"};
      const ts = Date.now();
      const batch = D.batch();
      batch.update(D.collection("patients").doc(invite.pid), {
        patientUid:user.uid,
        consent:{accepted:true,ts,text:"أوافق على إرسال قراءاتي وأدويتي ووجباتي ونشاطي وسجل أخذ الدواء إلى طبيبي المرتبط."},
        linkHistory:firebase.firestore.FieldValue.arrayUnion({a:"link",by:"patient",ts})
      });
      batch.update(ref,{used:true});
      await batch.commit();
      linked = true;
      if (A.currentUser?.uid !== user.uid) return;
      if (fromGuest) {
        const target = profileStorage(user.uid);
        target.setItem("rafiq_link",JSON.stringify({pid:invite.pid,uid:user.uid}));
        if (transfer) moveLocalProfile(storage,target,profileKeys);
      } else {
        setLink({pid:invite.pid,uid:user.uid});
        await verifyAccount();
        msg("lkMsg","ok","تم الربط بنجاح.");
        $("lkCode").value = "";
      }
    } catch (error) {
      const messages = {
        "invalid-code":"الرمز غير صحيح أو انتهت صلاحيته.",
        "permission-denied":"تعذّر استخدام الرمز. تحقّق منه أو اطلب رمزًا ساريًا من طبيبك.",
        "already-linked":"هذا الحساب مرتبط بالفعل. افصل الربط السابق قبل ربط ملف آخر.",
        "session-changed":"تغيّر الحساب أثناء الربط. حاول مرة أخرى من حسابك.",
        "auth/admin-restricted-operation":"الدخول المجهول غير مفعّل في Firebase."
      };
      msg("lkMsg","bad",messages[error?.code] || "تعذّر إكمال الربط. تأكّد من اتصالك وحاول مرة أخرى.");
      if (fromGuest && !linked && user?.uid === A.currentUser?.uid && error?.code !== "already-linked") {
        await A.signOut().catch(() => {});
      }
    } finally {
      linkingFromGuest = false;
      linkingPatient = false;
      if (fromGuest && A.currentUser) {
        location.hash = "more";
        location.reload();
      } else showLinkStatus();
    }
  };
  showLinkStatus();

  function readMeds() {
    const items = readJSON(storage,"rafiq_meds",[]);
    return Array.isArray(items) ? items.filter(m => medicationFields(m) && validMedId(m.id)) : [];
  }
  $("lkReplyBtn").onclick=function(){
    var L=activeLink();
    var t=$("lkReplyTxt").value.trim();
    if(!L){msg("lkMsg","bad","أنت غير مرتبط بطبيب بعد.");return}
    if(!t){msg("lkMsg","bad","اكتب ردك أولاً.");return}
    $("lkReplyBtn").disabled=true;
    D.collection("patients").doc(L.pid).update({patientReply:{text:t.slice(0,500),ts:Date.now(),noteAt:lastNoteAt}})
      .then(function(){$("lkReplyTxt").value="";msg("lkMsg","ok","تم إرسال ردك إلى طبيبك.")})
      .catch(function(e){msg("lkMsg","bad","تعذّر إرسال الرد: "+((e&&(e.code||e.message))||"unknown"))})
      .then(function(){$("lkReplyBtn").disabled=false});
  };
  $("lkTestNotif").onclick=function(){
    notifyPatient("اختبار الإشعارات","إذا ظهر هذا الإشعار فالإعداد سليم.");
    msg("lkMsg","ok","أُرسل إشعار تجريبي. إن لم يظهر فتحقق من إعدادات الإشعارات في الهاتف.");
  };
  $("lkNotifyBtn").onclick=function(){
    if(!("Notification" in window)){msg("lkMsg","bad","هذا المتصفح لا يدعم الإشعارات.");return}
    Notification.requestPermission().then(function(p){
      msg("lkMsg",p==="granted"?"ok":"bad",p==="granted"?"تم تفعيل الإشعارات.":"لم تُفعَّل الإشعارات. فعّلها من إعدادات المتصفح.");
      showLinkStatus();
    });
  };
  $("lkSyncMeds").onclick=async function(){
    msg("lkMsg","warn","جارٍ المزامنة…");
    if (!activeLink()) await verifyAccount();
    const result=await window.rafiqSyncAll(true);
    if (!result.ok) msg("lkMsg","bad","لم تكتمل المزامنة. أعد المحاولة عند توفر الاتصال. تبقى بياناتك محفوظة على هذا الجهاز.");
    else if (result.invalid) msg("lkMsg","warn","تمت مزامنة البيانات الصالحة. بقيت عناصر محلية غير صالحة أو قديمة دون إرسال.");
    else if (result.pending) msg("lkMsg","warn","أُرسلت دفعة من البيانات. ما زالت عناصر تنتظر المزامنة.");
    else msg("lkMsg","ok","تمت المزامنة مع طبيبك"+(result.n?" ("+result.n+" عنصر جديد)":"")+".");
    loadNote();
  };
  $("lkUnlink").onclick=async function(){
    const link=activeLink();
    if (!link||!window.confirm("فك الربط مع طبيبك؟ لن تصله بيانات جديدة من هذا الحساب.")) return;
    $("lkUnlink").disabled=true;
    try {
      await D.collection("patients").doc(link.pid).update({
        patientUid:firebase.firestore.FieldValue.delete(),
        linkHistory:firebase.firestore.FieldValue.arrayUnion({a:"unlink",by:"patient",ts:Date.now()})
      });
      unlinkedHere("تم فك الربط.","ok");
    } catch(error) {
      msg("lkMsg","bad","تعذّر فك الربط. تأكد من الاتصال وحاول مرة أخرى.");
    } finally { $("lkUnlink").disabled=false;showLinkStatus(); }
  };
  function wh2(w){return w==="f"?"صائم":"بعد الأكل"}
  function unlinkPatient(pid,b){
    if(!window.confirm("فك ربط هذا المريض بالتطبيق؟ لن تصل قراءاته إليك بعد الآن.")) return;
    b.disabled=true;
    D.collection("patients").doc(pid).update({patientUid:firebase.firestore.FieldValue.delete(),linkHistory:firebase.firestore.FieldValue.arrayUnion({a:"unlink",by:"doctor",ts:Date.now()})})
      .then(function(){if(A.currentUser)load(A.currentUser.uid)})
      .catch(function(err){b.disabled=false;window.alert("تعذّر فك الربط: "+((err&&(err.code||err.message))||"unknown"))});
  }
  function mealSize(value) {
    const size=String(value||"").trim();
    if (size==="heavy" || size.startsWith("ثقيلة")) return "ثقيلة";
    if (size==="light" || size.startsWith("خفيفة")) return "خفيفة";
    if (size==="normal" || size==="عادية") return "عادية";
    return size || "الحجم غير محدد";
  }
  function showDetails(pid,box){
    if(!box) return;
    if(box.getAttribute("data-open")==="1"){box.hidden=true;box.setAttribute("data-open","0");return}
    box.hidden=false;box.setAttribute("data-open","1");
    box.innerHTML="<p>جارٍ تحميل التفاصيل…</p>";
    var pr=D.collection("patients").doc(pid);
    withTimeout(Promise.all([
      pr.get({source:"server"}),
      pr.collection("readings").orderBy("ts","desc").limit(20).get({source:"server"}),
      pr.collection("events").orderBy("ts","desc").limit(60).get({source:"server"})
    ]),15000).then(function(res){
      var p=res[0].data()||{},rs=res[1],ev=res[2],h="";
      h+="<h3>القراءات (الأحدث أولاً)</h3>";
      h+=rs.size?rs.docs.map(function(x){
        var r=x.data(),j=validGlucose(r.v)?judge(r.v,r.w):["warn","","قيمة خارج النطاق"];
        return '<div class="res '+j[0]+'" style="margin:6px 0"><b>'+esc(r.v)+' mg/dL</b> – '+esc(wh2(r.w))+' – '+j[2]+'<br><small dir="ltr">'+esc(r.d||"")+(r.by==="doctor"?" (أضافها الطبيب)":"")+'</small></div>';
      }).join(""):"<p>لا توجد قراءات بعد.</p>";
      var meals=[],tk=[];
      ev.docs.forEach(function(x){
        var e=x.data();
        if(e.k==="m") meals.push('<div class="card" style="margin:6px 0">🍽️ '+esc(e.n)+' ('+esc(mealSize(e.q))+') – '+esc(e.day)+' '+esc(e.t||"")+'</div>');
        else if(e.k==="a") meals.push('<div class="card" style="margin:6px 0">🚶 '+esc(e.n)+' ('+esc(e.m)+' دقيقة) – '+esc(e.day)+'</div>');
        else if(e.k==="taken") tk.push('<div style="margin:4px 0">✅ '+esc(e.day)+' – '+esc(e.dn||"دواء")+'</div>');
      });
      h+="<h3>الوجبات والنشاط</h3>";
      h+=meals.length?meals.join(""):"<p>لا توجد وجبات أو نشاط مرسل بعد.</p>";
      h+="<h3>أخذ الأدوية</h3>";
      h+=tk.length?tk.join(""):"<p>لا يوجد تسجيل لأخذ الأدوية بعد.</p>";
      h+="<h3>الأدوية المسجلة</h3>";
      var m=medicationList(p.meds);
      h+=m.length?m.map(function(x){return '<div class="card" style="margin:6px 0"><b>'+esc(x.n)+'</b> – '+esc(x.t||"")+(x.o?' ('+esc(x.o)+')':'')+'</div>'}).join(""):"<p>لا توجد أدوية مسجلة.</p>";
      var hist=Array.isArray(p.linkHistory)?p.linkHistory.filter(isRecord):[];
      h+="<h3>سجل الربط</h3>";
      h+=hist.length?hist.map(function(x){return '<div style="margin:4px 0">'+(x.a==="link"?"🔗 ربط":"🔓 فك ربط")+' ('+(x.by==="doctor"?"من الطبيب":"من المريض")+') – '+esc(new Date(x.ts).toLocaleString("ar-LY"))+'</div>'}).join(""):"<p>لا يوجد سجل بعد.</p>";
      if(p.note) h+='<div class="card" style="margin-top:10px"><b>ملاحظتك الحالية للمريض:</b> '+esc(p.note)+'</div>';
      if(p.patientReply&&p.patientReply.text) h+='<div class="card" style="margin-top:10px"><b>ردّ المريض على الملاحظة:</b> '+esc(p.patientReply.text)+'<br><small dir="ltr">'+esc(new Date(p.patientReply.ts).toLocaleString("ar-LY"))+'</small></div>';
      h+='<div class="noprint" style="margin-top:12px">';
      h+='<button class="go sec" data-note="'+esc(pid)+'">📝 كتابة ملاحظة للمريض</button>';
      h+='<button class="go sec" data-addr="'+esc(pid)+'" style="margin-top:8px">➕ إضافة قراءة يدوياً</button>';
      h+='<button class="go sec" data-print="1" style="margin-top:8px">🖨️ طباعة التقرير / حفظ PDF</button>';
      h+='</div>';
      box.innerHTML=h;
    }).catch(function(e){
      box.innerHTML='<div class="res bad">تعذّر تحميل التفاصيل: '+esc((e&&(e.code||e.message))||"unknown")+'</div>';
    });
  }
  // الطباعة تتم في صفحة مستقلة (تفتح في المتصفح) حتى تعمل من التطبيق المثبت والمتصفح معاً
  // بناء صفحة التقرير المطبوعة (منفصلة عن التطبيق)
  function reportHtml(nm,inner,autoPrint){
    return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
      +'<meta name="viewport" content="width=device-width,initial-scale=1"><title>تقرير '+esc(nm)+'</title>'
      +'<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
      +'<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">'
      +'<style>body{font-family:Cairo,Tahoma,sans-serif;color:#000;background:#fff;line-height:1.6}'
      +'h2{margin:0 0 8px}h3{margin:16px 0 6px;border-bottom:1px solid #ccc}'
      +'.card{border:1px solid #999;border-radius:8px;padding:8px;margin:6px 0}'
      +'.res{border:2px solid #666;border-radius:8px;padding:8px 10px;margin:6px 0;font-weight:700}'
      +'.res.ok{background:#e6f5ec;border-color:#1b7a3a;color:#135c2b}'
      +'.res.warn{background:#fff4d6;border-color:#8a5a00;color:#6b4400}'
      +'.res.bad{background:#fde8e8;border-color:#b00020;color:#8a0016}'
      +'h2,h3,.res,.card{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      +'.noprint{display:none!important}'
      +'@page{size:auto;margin:0}body{padding:12mm}'
      +'@media print{.card,.res{break-inside:avoid}}</style></head><body>'
      +inner
      +(autoPrint?'<scr'+'ipt>window.onafterprint=function(){window.close()};window.onload=function(){setTimeout(function(){window.print()},400)};</scr'+'ipt>':'')
      +'</body></html>';
  }
  // المسار الأساسي: طباعة من إطار مخفي داخل الصفحة نفسها، بلا فتح أي لسان ظاهر
  // والمسار البديل: صفحة مستقلة تُغلق تلقائياً بعد الطباعة
  function openBlobReport(html){
    var url=URL.createObjectURL(new Blob([html],{type:"text/html;charset=utf-8"}));
    var w=window.open(url,"_blank");
    if(!w){
      var a=document.createElement("a");
      a.href=url;a.download="تقرير.html";
      document.body.appendChild(a);a.click();a.remove();
    }
    setTimeout(function(){URL.revokeObjectURL(url)},600000);
  }
  function printBox(box){
    if(!box) return;
    var card=box.closest(".card");
    var nm=card&&card.querySelector("b")?card.querySelector("b").textContent:"";
    var inner='<h2>تقرير متابعة السكر – رفيق السكري</h2>'
      +'<p>المريض: '+esc(nm)+'<br>التاريخ: '+esc(new Date().toLocaleString("ar-LY"))+'</p>'
      +box.innerHTML;
    var printHtml=reportHtml(nm,inner,false);
    var autoHtml=reportHtml(nm,inner,true);
    var f=document.createElement("iframe");
    f.setAttribute("aria-hidden","true");
    f.style.cssText="position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(f);
    var cleaned=false;
    function cleanup(){
      if(cleaned) return;
      cleaned=true;
      setTimeout(function(){if(f.parentNode) f.parentNode.removeChild(f)},300);
    }
    try{
      var fd=f.contentWindow.document;
      fd.open();fd.write(printHtml);fd.close();
      setTimeout(function(){
        try{
          f.contentWindow.addEventListener("afterprint",cleanup);
          f.contentWindow.focus();
          f.contentWindow.print();
          setTimeout(cleanup,300000);
        }catch(e){
          cleanup();
          openBlobReport(autoHtml);
        }
      },700);
    }catch(e){
      cleanup();
      openBlobReport(autoHtml);
    }
  }
  function addReading(pid){
    var raw=window.prompt("القيمة (mg/dL):","");
    if(raw===null) return;
    var v=Number(raw);
    if(!validGlucose(v)){window.alert("أدخل قيمة صحيحة بين 20 و700 ملغ/دل.");return}
    var wr=window.prompt("اكتب f للصائم أو a لبعد الأكل","f");
    if(wr===null) return;
    var w=String(wr).trim().toLowerCase()==="f"?"f":"a";
    var j=window.rafiqJudge(v,w);
    D.collection("patients").doc(pid).collection("readings").add({v:v,w:w,c:j[0],t:j[2],d:new Date().toLocaleString("ar-LY"),ts:Date.now(),by:"doctor"})
      .then(function(){window.alert("تمت إضافة القراءة.");if(A.currentUser)load(A.currentUser.uid)})
      .catch(function(err){window.alert("تعذّر الحفظ: "+((err&&(err.code||err.message))||"unknown"))});
  }
  function editNote(pid){
    var n=window.prompt("اكتب ملاحظة تظهر للمريض في تطبيقه (اتركها فارغة لحذفها):","");
    if(n===null) return;
    D.collection("patients").doc(pid).update({note:String(n).trim(),noteAt:Date.now()})
      .then(function(){window.alert("تم حفظ الملاحظة.")})
      .catch(function(err){window.alert("تعذّر الحفظ: "+((err&&(err.code||err.message))||"unknown"))});
  }
  $("dTestJudge").onclick=function(){
    var cases=[[50,"f"],[65,"a"],[100,"f"],[120,"a"],[160,"f"],[220,"a"],[320,"f"]];
    var lines=cases.map(function(c){var j=window.rafiqJudge(c[0],c[1]);return c[0]+" mg/dL ("+(c[1]==="f"?"صائم":"بعد الأكل")+") ← "+j[2]+" ["+j[0]+"]"});
    var el=$("dTestRes");el.className="res ok";el.hidden=false;
    el.innerHTML="نتائج اختبار التقييم:<br>"+lines.map(esc).join("<br>");
  };
  // المزامنة مقيدة بالحساب والملف اللذين تحقّق منهما الخادم.
  function syncState(link,key,fallback) {
    return readJSON(storage,syncKey(link,key),fallback);
  }
  function saveState(link,key,value) {
    storage.setItem(syncKey(link,key),JSON.stringify(value));
  }
  function getSent(link) {
    const sent = syncState(link,"sent",{});
    return isRecord(sent) ? sent : {};
  }
  function markSent(link,keys) {
    const sent = getSent(link);
    for (const key of keys) sent[key]=1;
    saveState(link,"sent",sent);
  }

  const medKey = med => JSON.stringify([med.n,med.t,med.o]);
  const equalMeds = (a,b) => JSON.stringify(a) === JSON.stringify(b);

  function countMeds(list) {
    const counts = new Map();
    for (const med of list) {
      const key = medKey(med);
      counts.set(key,(counts.get(key) ?? 0)+1);
    }
    return counts;
  }
  function applyMedChanges(remote,before,after) {
    const was = countMeds(before);
    const want = countMeds(after);
    const current = countMeds(remote);
    const changes = new Map();
    for (const key of new Set([...was.keys(),...want.keys()])) {
      changes.set(key,(want.get(key) ?? 0)-(was.get(key) ?? 0));
    }
    const result = remote.filter(med => {
      const key = medKey(med);
      if (!(changes.get(key)<0) || current.get(key)<=(want.get(key) ?? 0)) return true;
      current.set(key,current.get(key)-1);
      changes.set(key,changes.get(key)+1);
      return false;
    });
    for (const med of after) {
      const key = medKey(med);
      const count = current.get(key) ?? 0;
      if (changes.get(key)>0 && count<want.get(key)) {
        result.push(med);
        current.set(key,count+1);
        changes.set(key,changes.get(key)-1);
      }
    }
    return result;
  }
  function restoreMeds(remote,local) {
    const available = local.slice();
    const next = remote.map(med => {
      const i = available.findIndex(item => medKey(medicationFields(item)) === medKey(med));
      return {...med,id:i<0 ? medId() : available.splice(i,1)[0].id};
    });
    storage.setItem("rafiq_meds",JSON.stringify(next));
    window.rafiqRefreshMeds?.();
  }
  function learnRemoteMeds(link,data) {
    const remote = medicationList(data.meds);
    const local = readMeds();
    let base = syncState(link,"medsBase",null);
    const legacy = syncState(link,"legacyMedsBase",null);
    if (legacy !== null) {
      if (base === null && equalMeds(legacy,remote)) {
        base=remote;
        saveState(link,"medsBase",base);
      }
      storage.removeItem(syncKey(link,"legacyMedsBase"));
    }
    if (base === null ? !local.length : equalMeds(medicationList(local),base)) {
      if (!equalMeds(medicationList(local),remote) || storage.getItem("rafiq_meds") === null) restoreMeds(remote,local);
      saveState(link,"medsBase",remote);
    }
  }
  async function syncMeds(link,patient) {
    const local = readMeds();
    const wanted = medicationList(local);
    const base = syncState(link,"medsBase",null);
    if (base !== null && equalMeds(wanted,base)) return;
    const remote = await withTimeout(D.runTransaction(async transaction => {
      const snap = await transaction.get(patient);
      if (!stillLinked(link) || snap.data()?.patientUid !== scopeUid) throw new Error("link changed");
      const current = medicationList(snap.data().meds);
      const next = applyMedChanges(current,base ?? [],wanted);
      if (next.length>30) throw new Error("medication limit");
      if (!equalMeds(current,next)) transaction.update(patient,{meds:next});
      return next;
    }),15000);
    if (!stillLinked(link)) return;
    const live = readMeds();
    const visible = applyMedChanges(remote,wanted,medicationList(live));
    restoreMeds(visible,live);
    saveState(link,"medsBase",remote);
  }

  function readingKey(reading) {
    return "r"+reading.ts+"_"+reading.w+"_"+reading.v;
  }

  window.rafiqInvalidateReadings = function() {
    const link = getLink();
    if (link) storage.removeItem(syncKey(link,"checkedReadings"));
  };

  async function syncReadings(link,patient) {
    const coll = patient.collection("readings");
    if (!syncState(link,"checkedReadings",false)) {
      const snapshot = await withTimeout(coll.get({source:"server"}),15000);
      if (!stillLinked(link)) throw new Error("link changed");
      const keys = [];
      snapshot.forEach(doc => {
        const data = doc.data(), reading = readingDoc(data);
        if (data.by !== "doctor" && reading && validTimestamp(reading.ts)) keys.push(readingKey(reading));
      });
      markSent(link,keys);
      saveState(link,"checkedReadings",true);
    }

    const sent = getSent(link);
    const entries = readJSON(storage,"rafiq_log",[]);
    let invalid = false;
    const pending = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const data = readingDoc(entry);
      if (!data || !validTimestamp(data.ts)) { invalid=true; continue; }
      const key = readingKey(data);
      if (!sent[key]) pending.set(key,data);
    }
    try {
      const n = await sendGroup(link,coll,pending,100);
      return {n,invalid,pending:pending.size>n};
    } catch (error) {
      if (error?.code === "permission-denied") storage.removeItem(syncKey(link,"checkedReadings"));
      throw error;
    }
  }

  async function syncEvents(link,patient) {
    const sent = getSent(link);
    const pending = new Map();
    const daily = readJSON(storage,"rafiq_daily",[]);
    const localMeds = readMeds();
    let invalid = false;
    for (const entry of Array.isArray(daily) ? daily : []) {
      const data = dailyDoc(entry);
      if (!data) {invalid=true;continue;}
      const key = "d"+data.ts;
      if (!sent[key]) pending.set(key,data);
    }
    const taken = readJSON(storage,"rafiq_taken",{});
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(taken.day) && isRecord(taken.ids)) {
      for (const mid of Object.keys(taken.ids).filter(validMedId)) {
        const key = "t"+taken.day+"_"+mid;
        if (sent[key]) continue;
        const med = localMeds.find(m => String(m.id)===mid);
        pending.set(key,{k:"taken",mid,dn:boundedText(med?.n,100),day:taken.day,ts:Date.now()});
      }
    }
    const n = await sendGroup(link,patient.collection("events"),pending,200);
    return {n,invalid,pending:pending.size>n};
  }

  async function sendGroup(link,collection,pending,limit) {
    const items = [...pending].slice(0,limit);
    if (!items.length) return 0;
    if (!stillLinked(link)) throw new Error("link changed");
    const batch = D.batch();
    for (const [key,data] of items) batch.set(collection.doc(key),data);
    await withTimeout(batch.commit(),15000);
    markSent(link,items.map(([key])=>key));
    return items.length;
  }

  async function syncOnce(link,patient) {
    const results = await Promise.allSettled([
      syncReadings(link,patient), syncEvents(link,patient), syncMeds(link,patient)
    ]);
    const done = results.filter(result=>result.status==="fulfilled" && result.value).map(result=>result.value);
    for (const failure of results.filter(result=>result.status==="rejected")) console.error("rafiq sync:",failure.reason);
    return {
      ok:stillLinked(link) && results.every(result=>result.status==="fulfilled"),
      n:done.reduce((count,result)=>count+result.n,0),
      pending:done.some(result=>result.pending),
      invalid:done.some(result=>result.invalid)
    };
  }

  let syncInProgress = null;
  let syncRequested = false;
  window.rafiqSyncAll = function(afterEdit=false) {
    const link = activeLink();
    if (!link || !migrated) return Promise.resolve({ok:false,n:0});
    if (syncInProgress) {
      syncRequested ||= afterEdit;
      return syncInProgress;
    }
    const patient = D.collection("patients").doc(link.pid);
    syncInProgress = (async () => {
      let result;
      let total=0;
      do {
        syncRequested=false;
        result=await syncOnce(link,patient);
        total+=result.n;
      } while (result.ok && stillLinked(link) && (syncRequested || result.pending));
      return {...result,n:total};
    })().finally(()=>{syncInProgress=null;});
    return syncInProgress;
  };

  function unlinkedHere(text,style="warn") {
    verifiedLink=null;
    setLink(null);
    showLinkStatus();
    $("lkNote").hidden=true;
    $("lkNote").textContent="";
    $("lkReplyBox").hidden=true;
    $("lkCheck").textContent="";
    msg("lkMsg",style,text || "تم فك الربط من جهة الطبيب.");
  }

  var lastNoteAt=0;
  function notifyPatient(title,body){
    if(String(title).indexOf("اختبار")===-1&&window.rafiqUnreadAdd) window.rafiqUnreadAdd();
    if(!("Notification" in window)||Notification.permission!=="granted") return;
    var opts={body:String(body).slice(0,180),icon:"icons/icon-192.png",dir:"rtl",lang:"ar",tag:"rafiq-note"};
    var fallback=function(){try{new Notification(title,opts)}catch(e){console.error(e)}};
    if(navigator.serviceWorker&&navigator.serviceWorker.ready){
      navigator.serviceWorker.ready.then(function(r){return r.showNotification(title,opts)}).catch(fallback);
    }else fallback();
  }
  // يُشعر المريض عند وصول ملاحظة جديدة (أثناء فتح التطبيق أو في الخلفية القريبة)
  function checkNoteNotify(note,at){
    at=Number(at)||0;
    var seenAt=Number(storage.getItem("rafiq_note_seen")||0);
    var seenText=storage.getItem("rafiq_note_text")||"";
    if(!storage.getItem("rafiq_note_init")){
      storage.setItem("rafiq_note_init","1");
      storage.setItem("rafiq_note_seen",String(at));
      storage.setItem("rafiq_note_text",note||"");
      return false;
    }
    var changed=(at>seenAt)||(!!note&&note!==seenText);
    if(note&&changed) notifyPatient("ملاحظة جديدة من طبيبك",note);
    storage.setItem("rafiq_note_seen",String(Math.max(at,seenAt)));
    storage.setItem("rafiq_note_text",note||"");
    return !!(note&&changed);
  }
  function loadNote(){
    var L=activeLink(); if(!L) return;
    D.collection("patients").doc(L.pid).get({source:"server"}).then(function(d){
      if(!stillLinked(L))return;
      var data=d.exists?d.data():null;
      if(!data||data.patientUid!==L.uid){unlinkedHere();return}
      if(!syncInProgress)learnRemoteMeds(L,data);
      var n=data.note;
      lastNoteAt=Number(data.noteAt)||0;
      $("lkReplyBox").hidden=!n;
      var changedNow=checkNoteNotify(n,data.noteAt||0);
      if(changedNow) msg("lkMsg","ok","وصلت ملاحظة جديدة من طبيبك.");
      var at=Number(data.noteAt)||0;
      $("lkCheck").textContent="آخر فحص: "+new Date().toLocaleTimeString("ar-LY")+(at?" | آخر تحديث للملاحظة: "+new Date(at).toLocaleString("ar-LY"):"");
      $("lkNote").textContent=n?"📝 ملاحظة من طبيبك: "+n:"";
      $("lkNote").hidden=!n;
    }).catch(function(e){
      if(stillLinked(L)&&e?.code==="permission-denied") unlinkedHere();
      else console.error("loadNote:",e);
    });
  }
  setInterval(function(){if(document.visibilityState!=="hidden"&&getLink())loadNote()},30000);
  // تحديث الملاحظة عند فتح صفحة التقرير/الربط
  document.querySelectorAll('[data-go="more"]').forEach(function(b){b.addEventListener("click",function(){setTimeout(loadNote,300)})});
  window.addEventListener("hashchange",function(){
    if(location.hash==="#more"){showLinkStatus();loadNote();}
    if(location.hash==="#doctor"&&scopeUid&&!approvedDoctor&&!checkingAccount)verifyAccount();
  });
  setInterval(function(){if(document.visibilityState!=="hidden"){if(activeLink())window.rafiqSyncAll();else if(getLink())verifyAccount()}},30000);
  document.addEventListener("visibilitychange",function(){
    if(document.visibilityState==="visible"&&getLink()){if(!activeLink())verifyAccount();else{window.rafiqSyncAll();loadNote()}}
  });
  // حفظ حساب المريض المجهول ببريد وكلمة مرور
  $("svBtn").onclick=function(){
    var u=A.currentUser;
    var em=$("svEmail").value.trim(),pw=$("svPass").value;
    if(!activeLink()||!u?.isAnonymous){msg("svMsg","bad","حسابك محفوظ بالفعل.");return}
    if(!em||pw.length<6){msg("svMsg","bad","اكتب بريداً صحيحاً وكلمة مرور من 6 أحرف على الأقل.");return}
    $("svBtn").disabled=true;
    u.linkWithCredential(firebase.auth.EmailAuthProvider.credential(em,pw))
      .then(function(){msg("lkMsg","ok","تم حفظ الحساب بالبريد.");$("svPass").value="";showLinkStatus();renderAccount(A.currentUser)})
      .catch(function(e){
        var mm={"auth/email-already-in-use":"هذا البريد مستخدم من قبل.","auth/invalid-email":"البريد غير صحيح.","auth/weak-password":"كلمة المرور ضعيفة (6 أحرف على الأقل).","auth/credential-already-in-use":"هذا البريد مرتبط بحساب آخر."};
        msg("svMsg","bad",mm[e&&e.code]||("تعذّر الحفظ: "+((e&&(e.code||e.message))||"unknown")));
      })
      .then(function(){$("svBtn").disabled=false});
  };

  $("dIn").onclick=function(){
    var em=$("dEmail").value.trim(),pw=$("dPass").value;
    msg("dErr","","");
    if(!em||!pw){msg("dErr","bad","اكتب البريد وكلمة المرور.");return}
    msg("dErr","warn","جارٍ تسجيل الدخول… انتظر لحظة.");
    $("dIn").disabled=true;
    var timer=setTimeout(function(){
      msg("dErr","bad","لم يصل رد من الخادم خلال 15 ثانية. تأكد من الإنترنت وحاول مرة أخرى.");
      $("dIn").disabled=false;
    },15000);
    try{
      A.signInWithEmailAndPassword(em,pw)
        .then(function(){clearTimeout(timer);$("dPass").value="";msg("dErr","","")})
        .catch(function(e){clearTimeout(timer);console.error(e);msg("dErr","bad",errText(e))})
        .then(function(){$("dIn").disabled=false});
    }catch(e){
      clearTimeout(timer);
      console.error(e);
      $("dIn").disabled=false;
      msg("dErr","bad","تعذّر الدخول: "+(e.message||e));
    }
  };
  $("dRefresh").onclick=()=>verifyAccount();
  // حذف مريض: زر الحذف داخل كل بطاقة مع تأكيد قبل الحذف
  function makeLink(b){
    var u=A.currentUser;
    if(!u) return;
    var pid=b.getAttribute("data-link"),nm=b.getAttribute("data-name")||"";
    b.disabled=true;
    function tryCode(n){
      var c=String(Math.floor(10000000+Math.random()*90000000));
      var batch=D.batch();
      batch.set(D.collection("links").doc(c),{pid:pid,doctorId:u.uid,exp:Date.now()+24*3600*1000,used:false});
      batch.update(D.collection("patients").doc(pid),{linkCode:c});
      return batch.commit().then(function(){return c},function(err){
        if(n<5&&err&&err.code==="permission-denied") return tryCode(n+1);
        throw err;
      });
    }
    tryCode(0).then(function(code){
      window.alert("رمز ربط "+nm+": "+code+"\nصالح لمدة 24 ساعة ولمرة واحدة. أعطه للمريض.");
      load(u.uid);
    }).catch(function(err){
      b.disabled=false;
      window.alert("تعذّر إنشاء الرمز: "+((err&&(err.code||err.message))||"unknown"));
    });
  }
  function deleteRefsInBatches(refs){
    var chain=Promise.resolve();
    for(var i=0;i<refs.length;i+=400){
      (function(part){
        chain=chain.then(function(){
          var b=D.batch();
          part.forEach(function(r){b.delete(r)});
          return b.commit();
        });
      })(refs.slice(i,i+400));
    }
    return chain;
  }
  // حذف المريض مع قراءاته وأحداثه (وجبات ونشاط وأخذ دواء)
  function deletePatientDeep(pid){
    var pr=D.collection("patients").doc(pid);
    return Promise.all([
      pr.collection("readings").get({source:"server"}),
      pr.collection("events").get({source:"server"})
    ]).then(function(res){
      var refs=[];
      res[0].forEach(function(d){refs.push(d.ref)});
      res[1].forEach(function(d){refs.push(d.ref)});
      return deleteRefsInBatches(refs);
    }).then(function(){return pr.delete()});
  }
  // حذف جميع مرضى الطبيب بتأكيد مزدوج
  $("dDelAll").onclick=function(){
    var u=A.currentUser;
    if(!u) return;
    if(!window.confirm("حذف جميع المرضى في هذه القائمة؟")) return;
    if(!window.confirm("تأكيد نهائي: لا يمكن التراجع عن حذف كل المرضى. هل تريد المتابعة؟")) return;
    var btn=$("dDelAll");
    btn.disabled=true;
    D.collection("patients").where("doctorId","==",u.uid).get({source:"server"})
      .then(function(snap){
        var ids=snap.docs.map(function(d){return d.id});
        return ids.reduce(function(p,id){return p.then(function(){return deletePatientDeep(id)})},Promise.resolve())
          .then(function(){return ids.length});
      })
      .then(function(n){window.alert("تم حذف "+n+" مريض.");load(u.uid)})
      .catch(function(err){window.alert("تعذّر الحذف: "+((err&&(err.code||err.message))||"unknown"))})
      .then(function(){btn.disabled=false});
  };
  $("dList").onclick=function(e){
    var nt=e.target.closest?e.target.closest("[data-note]"):null;
    if(nt){editNote(nt.getAttribute("data-note"));return}
    var ad=e.target.closest?e.target.closest("[data-addr]"):null;
    if(ad){addReading(ad.getAttribute("data-addr"));return}
    var pb=e.target.closest?e.target.closest("[data-print]"):null;
    if(pb){printBox(pb.closest(".det"));return}
    var lk=e.target.closest?e.target.closest("[data-link]"):null;
    if(lk){makeLink(lk);return}
    var dt=e.target.closest?e.target.closest("[data-det]"):null;
    if(dt){showDetails(dt.getAttribute("data-det"),dt.parentNode.querySelector(".det"));return}
    var ul=e.target.closest?e.target.closest("[data-unlink]"):null;
    if(ul){unlinkPatient(ul.getAttribute("data-unlink"),ul);return}
    var b=e.target.closest?e.target.closest("[data-del]"):null;
    if(!b) return;
    var id=b.getAttribute("data-del"),nm=b.getAttribute("data-name")||"";
    if(!window.confirm("حذف المريض "+nm+"؟ لا يمكن التراجع عن الحذف.")) return;
    b.disabled=true;
    deletePatientDeep(id)
      .then(function(){if(A.currentUser)load(A.currentUser.uid)})
      .catch(function(err){b.disabled=false;window.alert("تعذّر الحذف: "+((err&&(err.code||err.message))||"unknown"))});
  };
  // فحص مباشر: يقرأ من الخادم مباشرة ويعرض النتيجة
  $("dTest").onclick=function(){
    var u=A.currentUser;
    if(!u) return;
    var out=[];
    function show(c){msg("dTestRes",c,out.join("\n"))}
    function step(label,p){
      var t0=Date.now();
      out.push(label+": جارٍ...");show("warn");
      return withTimeout(p,12000).then(function(s){
        out[out.length-1]=label+": نجح ("+s.size+" وثيقة، "+(Date.now()-t0)+" ms)";
      }).catch(function(e){
        out[out.length-1]=label+": فشل ("+((e&&(e.code||e.message))||"unknown")+")";
      }).then(function(){show("ok")});
    }
    out=[];
    step("1) استعلام مع limit(1)", D.collection("patients").where("doctorId","==",u.uid).limit(1).get({source:"server"}))
    .then(function(){
      return step("2) استعلام بدون limit", D.collection("patients").where("doctorId","==",u.uid).get({source:"server"}));
    })
    .then(function(){
      return step("3) استعلام بدون where (يُتوقع رفضه)", D.collection("patients").limit(1).get({source:"server"}));
    });
  };
  $("dAdd").onclick=function(){
    var n=$("dNew").value.trim(),u=A.currentUser;
    if(!u) return;
    if(!n){msg("dAddMsg","bad","اكتب اسم المريض.");return}
    $("dAdd").disabled=true;
    D.collection("patients").add({name:n,doctorId:u.uid,createdAt:Date.now()})
      .then(function(){$("dNew").value="";msg("dAddMsg","ok","تمت إضافة المريض.");load(u.uid)})
      .catch(function(err){msg("dAddMsg","bad","تعذّر الحفظ: "+((err&&(err.code||err.message))||"unknown"))})
      .then(function(){$("dAdd").disabled=false});
  };
  // ===== إشعارات الطبيب عند رد المريض =====
  function checkReplies(){
    var u=A.currentUser;
    if(!approvedDoctor||!sameSession()||!u) return;
    var first=!storage.getItem("rafiq_reply_init");
    D.collection("patients").where("doctorId","==",u.uid).get({source:"server"}).then(function(snap){
      snap.forEach(function(d){
        var x=d.data(),r=x.patientReply;
        if(!r||!r.ts) return;
        var key="rafiq_reply_seen_"+d.id;
        var raw=storage.getItem(key);
        if(raw===null){
          storage.setItem(key,String(r.ts));
          if(!first) notifyPatient("رد جديد من مريض: "+(x.name||""),r.text||"");
          return;
        }
        if(r.ts>Number(raw)){
          notifyPatient("رد جديد من مريض: "+(x.name||""),r.text||"");
          storage.setItem(key,String(r.ts));
        }
      });
      storage.setItem("rafiq_reply_init","1");
    }).catch(function(e){console.error("checkReplies:",e)});
  }
  function notifyBtnState(){
    $("dNotifyBtn").hidden=!("Notification" in window)||Notification.permission==="granted";
  }
  $("dNotifyBtn").onclick=function(){
    if(!("Notification" in window)) return;
    Notification.requestPermission().then(function(){notifyBtnState();window.alert(Notification.permission==="granted"?"تم تفعيل الإشعارات.":"لم تُفعَّل الإشعارات.")});
  };
  setInterval(function(){if(document.visibilityState!=="hidden")checkReplies()},120000);
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")checkReplies()});
  function renderAccount(user,state="") {
    const canViewDoctor = approvedDoctor && sameSession();
    $("accountIn").hidden = !!user;
    $("accountOut").hidden = !user || (user.isAnonymous && !!getLink());
    $("accountDoctor").hidden = !canViewDoctor;
    $("accountStatus").textContent = state || (user
      ? canViewDoctor ? "حساب طبيب معتمد: "+user.email
        : user.isAnonymous ? "حساب مريض على هذا الجهاز." : "الحساب الحالي: "+user.email
      : "تستخدم التطبيق محليًا. يمكنك الدخول إلى حسابك بالبريد.");
    $("dTitle").textContent = canViewDoctor ? "👨‍⚕️ لوحة الطبيب" : "👤 تسجيل الدخول";
    $("dLogin").hidden = !!user;
    $("dPanel").hidden = !canViewDoctor;
    if (!canViewDoctor) $("dList").textContent="";
  }

  function verifyAccount() {
    if (!sameSession() || !scopeUid) return Promise.resolve(false);
    if (checkingAccount) return checkingAccount;
    const user = A.currentUser;
    const role = user.isAnonymous ? Promise.resolve(null)
      : withTimeout(D.collection("doctors").doc(user.uid).get({source:"server"}),12000);
    checkingAccount = Promise.all([myPatients(user),role]).then(([matches,doctor]) => {
      if (!sameSession()) return false;
      blockingLink = matches.size > 1;
      approvedDoctor = !blockingLink && matches.empty && doctor?.data()?.active === true;
      const patient = matches.size===1 ? matches.docs[0] : null;
      verifiedLink = patient ? {pid:patient.id,uid:scopeUid} : null;
      setLink(verifiedLink);
      showLinkStatus();
      renderAccount(user,blockingLink ? "هذا الحساب مرتبط بأكثر من ملف. اطلب من طبيبك مراجعة الربط." : "");
      $("dRetry").hidden=true;
      msg("dErr","","");
      if (approvedDoctor) {
        $("dWho").textContent=user.email || "";
        load(user.uid);
        notifyBtnState();
        checkReplies();
      } else if (location.hash==="#doctor") location.hash="more";
      if (patient) {
        learnRemoteMeds(verifiedLink,patient.data());
        loadNote();
        window.rafiqSyncAll();
      }
      return true;
    }).catch(error => {
      if (!sameSession()) return false;
      console.error("rafiq account:",error);
      approvedDoctor=false;
      verifiedLink=null;
      showLinkStatus();
      const notice="تعذّر التحقق من الحساب. أعد المحاولة عند توفر الاتصال.";
      renderAccount(user,notice);
      msg("dErr","warn",notice);
      $("dRetry").hidden=false;
      return false;
    }).finally(()=>{checkingAccount=null;});
    return checkingAccount;
  }

  function leaveAccount() {
    if (!sameSession()) return;
    leavingSession=true;
    $("dOut").disabled=true;
    $("accountOut").disabled=true;
    A.signOut().catch(error => {
      leavingSession=false;
      $("dOut").disabled=false;
      $("accountOut").disabled=false;
      console.error("rafiq sign-out:",error);
    });
  }

  $("accountOut").onclick=leaveAccount;
  $("dOut").onclick=leaveAccount;
  $("dRetry").onclick=verifyAccount;
  renderAccount(initialUser,scopeUid ? "جارٍ التحقق من الحساب…" : "");
  if (!migrated) {
    renderAccount(initialUser,"تعذّر نقل السجل المحلي القديم. أفرغ مساحة تخزين وأعد فتح التطبيق.");
  }

  A.onAuthStateChanged(user => {
    if ((user?.uid ?? null) === scopeUid) return;
    if (linkingFromGuest && user?.isAnonymous) return;
    // يبدأ المستند الجديد بسجل الحساب الجديد بعد أن تستعيد خدمة الدخول هويته.
    document.body.hidden=true;
    navigator.serviceWorker?.controller?.postMessage({type:"clearProfileNotifications"});
    location.reload();
  });
  if (scopeUid) verifyAccount();

  window.addEventListener("online",()=> {
    if (!activeLink() && !approvedDoctor) verifyAccount();
    else { window.rafiqSyncAll(); loadNote(); }
  });

})();

(function(){
  function count(){return Number(storage.getItem("rafiq_unread")||0)}
  function render(){
    var b=document.getElementById("bellN");if(!b)return;
    var n=count();b.hidden=!n;b.textContent=n>99?"99+":String(n);
  }
  window.rafiqUnreadAdd=function(){storage.setItem("rafiq_unread",String(count()+1));render()};
  var bell=document.getElementById("bell");
  if(bell) bell.addEventListener("click",function(){
    storage.setItem("rafiq_unread","0");render();
    var more=document.querySelector('[data-go="more"]');
    if(more) more.click();
    setTimeout(function(){
      var l=null;try{l=JSON.parse(storage.getItem("rafiq_link"))}catch(e){}
      if(!l){var d=document.getElementById("accountDoctor");if(d&&!d.hidden)d.click();}
    },300);
  });
  window.addEventListener("storage",render);
  render();
})();


}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(error=>console.error("rafiq service worker:",error));
}
const profileReady=globalThis.RafiqStorage?.prepare();
function boot(initialUser){
  if(!profileReady){startRafiq(initialUser);return;}
  profileReady.then(()=>{
    startRafiq(typeof auth!=="undefined"&&auth?auth.currentUser:initialUser);
  });
}
if (typeof auth !== "undefined" && auth) {
  const unsubscribe = auth.onAuthStateChanged(user => {
    unsubscribe();
    boot(user);
  });
} else boot(null);
