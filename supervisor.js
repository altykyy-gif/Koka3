"use strict";

(function () {
  if (typeof auth==="undefined" || !auth || typeof db==="undefined" || !db) return;
  const element = id=>document.getElementById(id);
  const entry = element("accountSupervisor");
  const panel = element("supervisorPanel");
  const list = element("supervisorDoctors");
  const status = element("supervisorStatus");
  const form = element("supervisorForm");
  const uidInput = element("supervisorUid");
  const next = element("supervisorNext");
  const refresh = element("supervisorRefresh");
  const doctors = db.collection("doctors");
  const pageSize = 30;
  let allowedUid = null;
  let generation = 0;
  let cursor = null;
  let busy = false;

  function authorized() {
    return allowedUid!==null && auth.currentUser?.uid===allowedUid;
  }

  function message(text,kind="") {
    status.className = "res "+kind;
    status.textContent = text;
    status.hidden = !text;
  }

  function allowControl(enabled) {
    entry.hidden = !enabled;
    panel.hidden = !enabled;
    if (!enabled) {
      list.replaceChildren();
      uidInput.value = "";
      cursor = null;
      next.hidden = true;
    }
  }

  function setBusy(value) {
    busy=value;
    for (const button of panel.querySelectorAll("button")) button.disabled=value;
  }

  async function checkRole(user) {
    const request = ++generation;
    allowedUid = null;
    allowControl(false);
    if (!user || user.isAnonymous) {
      message("سجّل الدخول بحساب مشرف معتمد.");
      return;
    }
    if (location.hash==="#supervisor") message("جارٍ التحقق من صلاحية المشرف…");
    try {
      const role=await db.collection("supervisors").doc(user.uid).get({source:"server"});
      if (request!==generation || user.uid!==auth.currentUser?.uid) return;
      if (role.data()?.active!==true) {
        message("تتطلب لوحة المشرف اعتماد هذا الحساب في Firebase.");
        return;
      }
      allowedUid = user.uid;
      allowControl(true);
      message("");
      if (location.hash==="#supervisor") await loadDoctors();
    } catch (error) {
      if (request!==generation) return;
      message(error.code==="permission-denied"
        ? "تتطلب لوحة المشرف نشر قواعد v51 واعتماد الحساب."
        : "تعذّر التحقق من صلاحية المشرف. أعد فتح اللوحة عند الاتصال.","warn");
    }
  }

  function addDoctorRow(doc) {
    const row=document.createElement("div");
    row.className="card supervisor-doctor";
    const id=document.createElement("bdi");
    id.dir="ltr";
    id.textContent=doc.id;
    const active=doc.data().active===true;
    const description=document.createElement("p");
    description.className="note";
    description.textContent=active?"معتمد":"موقوف";
    const action=document.createElement("button");
    action.className="go sec";
    action.type="button";
    action.textContent=active?"إيقاف الاعتماد":"اعتماد الطبيب";
    action.addEventListener("click",()=>saveRole(doc.id,!active));
    row.append(id,description,action);
    list.append(row);
  }

  async function loadDoctors(append=false) {
    if (!authorized() || busy) return;
    const request=generation;
    setBusy(true);
    message("جارٍ تحميل حسابات الأطباء…");
    try {
      const query=doctors.orderBy(firebase.firestore.FieldPath.documentId()).limit(pageSize+1);
      const snapshot=await (append&&cursor?query.startAfter(cursor):query).get({source:"server"});
      if (request!==generation || !authorized()) return;
      if (!append) list.replaceChildren();
      const page=snapshot.docs.slice(0,pageSize);
      page.forEach(addDoctorRow);
      cursor=page.at(-1) || null;
      next.hidden=snapshot.size<=pageSize;
      message(!append && !page.length?"لا توجد حسابات أطباء مضافة بعد.":"");
    } catch (error) {
      if (request!==generation) return;
      if (error.code==="permission-denied") {
        allowedUid=null;
        allowControl(false);
      }
      message("تعذّر تحميل حسابات الأطباء. تحقّق من اتصالك وصلاحيتك.","warn");
    } finally {
      if (request===generation) setBusy(false);
    }
  }

  async function saveRole(uid,active) {
    if (!authorized() || busy) return;
    if (!active && !window.confirm("إيقاف اعتماد هذا الحساب كطبيب؟")) return;
    const request=generation;
    const ref=doctors.doc(uid);
    let saved=false;
    setBusy(true);
    try {
      await db.runTransaction(async transaction=>{
        if (request!==generation || !authorized()) throw new Error("تغيّرت الجلسة.");
        await transaction.get(ref);
        if (request!==generation || !authorized()) throw new Error("تغيّرت الجلسة.");
        transaction.set(ref,{active},{merge:true});
      });
      if (request!==generation || !authorized()) return;
      uidInput.value="";
      saved=true;
    } catch (error) {
      if (request===generation) {
        message("تعذّر حفظ الاعتماد. تحقّق من الاتصال والصلاحية وأعد المحاولة.","warn");
      }
    } finally {
      if (request===generation) setBusy(false);
    }
    if (saved) await loadDoctors();
  }

  form.addEventListener("submit",event=>{
    event.preventDefault();
    const uid=uidInput.value.trim();
    if (!uid || uid.length>128 || /[\/\s]/.test(uid) || uid==="." || uid===".." || /^__.*__$/.test(uid)) {
      message("ألصق معرّف حساب الطبيب الصحيح من Firebase Authentication.","warn");
      return;
    }
    saveRole(uid,true);
  });
  refresh.addEventListener("click",()=>loadDoctors());
  next.addEventListener("click",()=>loadDoctors(true));
  auth.onAuthStateChanged(user=>{setBusy(false);checkRole(user);});
  window.addEventListener("hashchange",()=>{
    if (location.hash!=="#supervisor") return;
    if (authorized()) loadDoctors();
    else checkRole(auth.currentUser);
  });
})();
