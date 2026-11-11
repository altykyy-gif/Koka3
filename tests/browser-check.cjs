"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const {existsSync,readFileSync} = require("node:fs");
const {setTimeout:delay} = require("node:timers/promises");
const {chromium} = require("playwright");
const {initializeTestEnvironment} = require("@firebase/rules-unit-testing");
const {collection,doc,getDoc,getDocs,writeBatch} = require("firebase/firestore");
const {app,root,projectId,host,authPort,firestorePort} = require("./paths.cjs");

const v50 = process.env.RAFIQ_V50_DIR || path.join(root,"source");
const password = "Example-Local-51!";
const authOrigin = "http://"+host+":"+authPort;
const endpoints = JSON.stringify({apiKey:"demo-key",projectId,authDomain:projectId+".firebaseapp.com"});
const types = {".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".png":"image/png",".json":"application/json",".webmanifest":"application/manifest+json"};
let serveV51 = true;

function serve(request,response) {
  try {
    const url = new URL(request.url,"http://"+host);
    if (!url.pathname.startsWith("/app/")) { response.writeHead(404).end(); return; }
    const relative = url.pathname.slice("/app/".length) || "index.html";
    if (!/^(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+$/.test(relative) || !types[path.extname(relative)]) {
      response.writeHead(404).end();
      return;
    }
    const base = serveV51 ? app : v50;
    let content = readFileSync(path.join(base,relative));
    if (relative==="index.html") {
      const production = /firebase\.initializeApp\(\{[\s\S]*?\}\);/;
      const html = content.toString("utf8");
      assert.match(html,production);
      assert.match(html,/const db = window\.firebase \? firebase\.firestore\(\) : null;/);
      content = html.replace(production,"firebase.initializeApp("+endpoints+");")
        .replace(/(const db = window\.firebase \? firebase\.firestore\(\) : null;)/,
          '$1\n  auth.useEmulator("'+authOrigin+'",{disableWarnings:true});\n'
          +'  db.useEmulator("'+host+'",'+firestorePort+');');
      assert.doesNotMatch(content,/"rafiq-sukkar"/);
    }
    response.writeHead(200,{"Content-Type":types[path.extname(relative)],"Cache-Control":"no-store"}).end(content);
  } catch (error) {
    response.writeHead(error.code==="ENOENT"?404:500).end();
  }
}

async function createUser(name) {
  const email = name+"@example.test";
  const response = await fetch(authOrigin+"/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({email,password,returnSecureToken:true}),
  });
  assert.equal(response.status,200,await response.clone().text());
  const data = await response.json();
  return {uid:data.localId,email};
}

async function waitText(page, selector, expected, timeout=12000) {
  await page.waitForFunction(({selector,expected})=>
    [...document.querySelectorAll(selector)].some(element=>element.textContent.includes(expected)),{selector,expected},{timeout});
}

async function navigate(page, screen) {
  await page.evaluate(id=>{location.hash=id;},screen);
  await page.locator("#"+screen).waitFor({state:"visible"});
}

async function ready(page) {
  await page.waitForFunction(()=>!document.body.hidden && typeof window.rafiqLevel==="function");
}

async function cacheReady(page, version) {
  const deadline=Date.now()+20000;
  do {
    const ready = await page.evaluate(async version=>{
      const registration=await navigator.serviceWorker.getRegistration();
      const worker=registration?.active;
      const cachesInScope=(await caches.keys()).filter(key=>/^rafiq-v\d+$/.test(key));
      return worker?.state==="activated" && worker===navigator.serviceWorker.controller
        && cachesInScope.length===1 && cachesInScope[0]===version
        && !!(await caches.match(new URL("app.js",location.href),{cacheName:version}));
    },version);
    if (ready) return;
    await delay(100);
  } while (Date.now()<deadline);
  throw new Error("The active service worker did not finish caching "+version);
}

async function enter(page,value) {
  await page.locator("#val").fill(String(value));
  await page.locator("#save").click();
  await waitText(page,"#hist",String(value));
}

async function login(page,account) {
  await navigate(page,"doctor");
  await page.locator("#dEmail").fill(account.email);
  await page.locator("#dPass").fill(password);
  await Promise.all([page.waitForEvent("load"),page.locator("#dIn").click()]);
  await ready(page);
  await page.waitForFunction(uid=>firebase.auth().currentUser?.uid===uid,account.uid);
}

async function logout(page) {
  await navigate(page,"more");
  await Promise.all([page.waitForEvent("load"),page.locator("#accountOut").click()]);
  await ready(page);
  await page.waitForFunction(()=>firebase.auth().currentUser===null);
}

async function readAdmin(env,key) {
  let data;
  await env.withSecurityRulesDisabled(async context=>{
    data=(await getDoc(doc(context.firestore(),key))).data();
  });
  return data;
}

async function listAdmin(env,key) {
  let rows;
  await env.withSecurityRulesDisabled(async context=>{
    rows=(await getDocs(collection(context.firestore(),key))).docs.map(record=>({id:record.id,...record.data()}));
  });
  return rows;
}

async function visibleFit(page) {
  const width = await page.evaluate(()=>[document.documentElement.scrollWidth,window.innerWidth]);
  assert.ok(width[0]<=width[1]+1,"page has horizontal overflow "+width.join("/"));
}

function fileInput(name,data) {
  return {name,mimeType:"application/json",buffer:Buffer.from(JSON.stringify(data))};
}

async function run() {
  const env = await initializeTestEnvironment({projectId,firestore:{host,port:firestorePort}});
  const server = http.createServer(serve);
  let browser;
  const pageErrors = [];
  try {
    await env.clearFirestore();
    const [doctor,patient,second,invitee,supervisor,newDoctor] = await Promise.all(
      ["doctor","patient","second","invitee","supervisor","new-doctor"].map(createUser));
    const restoredMed = {n:"دواء تجريبي محفوظ",t:"23:59",o:""};
    await env.withSecurityRulesDisabled(async context=>{
      const db = context.firestore();
      const batch = writeBatch(db);
      const documents = {
        ["doctors/"+doctor.uid]:{active:true},
        ["supervisors/"+supervisor.uid]:{active:true},
        "patients/low":{name:"حالة الهبوط التجريبية",doctorId:doctor.uid,patientUid:patient.uid,meds:[restoredMed]},
        "patients/high":{name:"حالة الارتفاع التجريبية",doctorId:doctor.uid,patientUid:second.uid},
        "patients/empty":{name:"حالة السجل الفارغ",doctorId:doctor.uid},
        "patients/low/events/legacy-meal":{
          k:"m",n:"وجبة اختبارية قديمة",q:"ثقيلة (نشويات أو حلويات)",day:"2024-1-15",ts:1700000000000,
        },
      };
      for (let i=0;i<31;i++) documents["doctors/zz-fixture-"+i]={active:false};
      for (const [key,value] of Object.entries(documents)) batch.set(doc(db,key),value);
      await batch.commit();
    });

    await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,host,resolve);});
    const origin="http://"+host+":"+server.address().port+"/app/";
    browser = await chromium.launch({
      executablePath:process.env.RAFIQ_CHROMIUM || undefined,headless:true,
      args:["--no-sandbox","--disable-dev-shm-usage"],
    });

    async function device(screen="home", setup) {
      const context = await browser.newContext({
        isMobile:true,hasTouch:true,viewport:{width:393,height:852},
        locale:"ar-LY",timezoneId:"Africa/Tripoli",acceptDownloads:true,
      });
      await context.route("**/*",route=>new URL(route.request().url()).hostname===host?route.continue():route.abort());
      if (setup) await context.addInitScript(setup.fn,setup.arg);
      const page = await context.newPage();
      page.setDefaultTimeout(14000);
      page.on("pageerror",error=>pageErrors.push(error.stack || error.message));
      await page.goto(origin+"#"+screen,{waitUntil:"load"});
      await ready(page);
      return {context,page};
    }

    const guest = await device("log");
    const g = guest.page;
    await enter(g,114);
    await enter(g,48);
    await waitText(g,"#res","السكر منخفض جدًا");
    await enter(g,300);
    await enter(g,300);
    await waitText(g,"#res","استمر السكر عند 300");
    assert.deepEqual(await g.locator("#hist .row b").allTextContents(),["300","300","48","114"]);
    assert.equal(await g.locator("#chart svg").count(),1);
    await g.locator("#val").fill("999");
    await g.locator("#save").click();
    await waitText(g,"#res","20 و700");
    assert.equal(await g.locator("#hist .row").count(),4);
    console.log("PASS mobile UI records 114, 48, 300, 300 and displays chart and safety statuses");

    await navigate(g,"ask");
    await g.locator("#faqQ").fill("شن نقدر ناكل في الفطور؟");
    await g.locator("#faqForm button").click();
    await waitText(g,"#faqResult","كيف أختار فطوري");
    assert.match(await g.locator("#faqResult a").getAttribute("href"),/^https:\/\/www\.cdc\.gov\//);
    await g.locator("#faqQ").fill("سكري ٤٨ شن نشرب؟");
    await g.locator("#faqForm button").click();
    assert.equal(await g.locator("#faqResult a").getAttribute("href"),"#sos");
    await visibleFit(g);
    await g.locator("#faqResult a").click();
    await g.locator("#sos").waitFor();
    assert.equal(await g.locator("#sos a.call").getAttribute("href"),"tel:1412");
    await waitText(g,"#sos","تغطية هذا الرقم في سلوق تحتاج إلى تأكيد");
    assert.equal(await g.locator('#sos a[href*="diabetic-ketoacidosis"]').count(),1);
    await navigate(g,"about");
    await g.locator('[data-go="research"]').click();
    await waitText(g,"#labSummary","0.701");
    await g.locator("#labForm button").click();
    await waitText(g,"#labResult","الساعة التالية");
    await visibleFit(g);
    await navigate(g,"log");
    assert.equal(await g.locator("#hist .row").count(),4);
    await cacheReady(g,"rafiq-v51");
    await guest.context.setOffline(true);
    await g.reload({waitUntil:"load"});
    await ready(g);
    assert.equal(await g.evaluate(()=>navigator.onLine),false);
    await enter(g,108);
    await navigate(g,"ask");
    await g.locator("#faqQ").fill("العدس");
    await g.locator("#faqForm button").click();
    await waitText(g,"#faqResult","الفول والعدس والحمص");
    await navigate(g,"research");
    await waitText(g,"#labSummary","0.701");
    await g.locator("#labForm button").click();
    await waitText(g,"#labResult","الساعة التالية");
    await guest.context.setOffline(false);
    console.log("PASS Arabic food assistant, study and offline reload/recording without affecting the history");

    await navigate(g,"more");
    const backup = (v,d)=>({app:"rafiq",v:1,data:{rafiq_log:[{v,d,w:"f",ts:1700000000000}]}});
    await g.locator("#bimp").setInputFiles(fileInput("invalid.json",backup(999,"غير صالح")));
    await waitText(g,"#bmsg","تعذّر الاسترجاع");
    await navigate(g,"log");
    assert.equal(await g.locator("#hist .row").count(),5);
    await navigate(g,"more");
    const injected = '<img src=x onerror="window.pwned=1">';
    g.once("dialog",dialog=>dialog.accept());
    await Promise.all([g.waitForEvent("load"),g.locator("#bimp").setInputFiles(fileInput("backup.json",backup(114,injected)))]);
    await ready(g);
    await navigate(g,"log");
    assert.equal(await g.locator("#hist .row").count(),1);
    await waitText(g,"#hist",injected);
    assert.equal(await g.locator("#hist img").count(),0);
    assert.equal(await g.evaluate(()=>window.pwned),undefined);
    console.log("PASS invalid backup preserves current data and imported markup remains plain text");
    await guest.context.close();

    const patientDevice = await device("more");
    const p = patientDevice.page;
    await login(p,patient);
    await waitText(p,"#lkStatus","مرتبط بطبيبك");
    assert.equal(await p.locator("#accountDoctor").isVisible(),false);
    await navigate(p,"meds");
    await waitText(p,"#today",restoredMed.n);
    assert.deepEqual((await readAdmin(env,"patients/low")).meds,[restoredMed]);
    await navigate(p,"log");
    await enter(p,48);
    await navigate(p,"more");
    await p.locator("#lkSyncMeds").click();
    await waitText(p,"#lkMsg","تمت المزامنة");
    assert.deepEqual((await listAdmin(env,"patients/low/readings")).map(record=>record.v),[48]);
    console.log("PASS a patient signs in on a fresh device, restores the link and keeps remote medications");

    await patientDevice.context.setOffline(true);
    await p.evaluate(()=>firebase.firestore().disableNetwork());
    await navigate(p,"log");
    await enter(p,117);
    const pendingId = await p.evaluate(uid=>{
      const records = JSON.parse(localStorage.getItem("rafiq-v50:user:"+encodeURIComponent(uid)+":rafiq_log"));
      const reading = records.find(record=>record.v===117);
      return "r"+reading.ts+"_"+reading.w+"_"+reading.v;
    },patient.uid);
    await navigate(p,"more");
    await p.locator("#lkSyncMeds").click();
    await waitText(p,"#lkMsg","لم تكتمل المزامنة",24000);
    assert.equal(await readAdmin(env,"patients/low/readings/"+pendingId),undefined);
    await patientDevice.context.setOffline(false);
    await p.evaluate(()=>firebase.firestore().enableNetwork());
    await p.locator("#lkSyncMeds").click();
    await waitText(p,"#lkMsg","تمت المزامنة",24000);
    await p.locator("#lkSyncMeds").click();
    await waitText(p,"#lkMsg","تمت المزامنة",24000);
    const delivered = (await listAdmin(env,"patients/low/readings")).filter(record=>record.v===117);
    assert.deepEqual(delivered.map(record=>record.id),[pendingId]);
    console.log("PASS interrupted reading upload retries with the same ID exactly once");

    await navigate(p,"supervisor");
    await waitText(p,"#supervisorStatus","تتطلب لوحة المشرف اعتماد");
    assert.equal(await p.locator("#supervisorPanel").isVisible(),false);
    await logout(p);
    await login(p,second);
    await waitText(p,"#lkStatus","مرتبط بطبيبك");
    await navigate(p,"log");
    assert.equal(await p.locator("#hist .row").count(),0);
    await enter(p,300);
    await enter(p,300);
    await waitText(p,"#res","استمر السكر عند 300");
    await navigate(p,"more");
    await p.locator("#lkSyncMeds").click();
    await waitText(p,"#lkMsg","تمت المزامنة");
    assert.deepEqual((await listAdmin(env,"patients/high/readings")).map(record=>record.v),[300,300]);
    assert.equal((await listAdmin(env,"patients/low/readings")).length,2);
    console.log("PASS separate patient accounts on the same browser retain isolated histories");

    const doctorDevice = await device("doctor");
    const d = doctorDevice.page;
    await login(d,doctor);
    await d.locator("#dPanel").waitFor();
    await waitText(d,"#dList","خطر: هبوط شديد");
    await waitText(d,"#dList","خطر: سكر مستمر عند 300 أو أعلى");
    await waitText(d,"#dList","لا قراءات بعد");
    const lowCard=d.locator("#dList > .card").filter({hasText:"حالة الهبوط التجريبية"});
    const highCard=d.locator("#dList > .card").filter({hasText:"حالة الارتفاع التجريبية"});
    await lowCard.locator(".level-evidence summary").click();
    await highCard.locator(".level-evidence summary").click();
    assert.match(await lowCard.locator(".level-evidence li").textContent(),/48 ملغ\/دل/);
    assert.equal(await highCard.locator(".level-evidence li").count(),2);
    for (const label of await highCard.locator(".level-evidence li").allTextContents()) assert.match(label,/300 ملغ\/دل/);
    await lowCard.locator('[data-det="low"]').click();
    await waitText(d,'#dList .det',"وجبة اختبارية قديمة (ثقيلة)");
    await visibleFit(d);
    console.log("PASS doctor sees severe low, persistent 300, empty case, reason readings and a legacy meal");

    await d.evaluate(()=>{
      const prototype=Object.getPrototypeOf(firebase.firestore().collection("patients").orderBy("ts"));
      const original=prototype.get;
      prototype.get=function(options){
        const segments=this._delegate?._query?.path?.segments;
        if (Array.isArray(segments) && segments.join("/")==="patients/low/readings") {
          return Promise.reject(Object.assign(new Error("offline test"),{code:"unavailable"}));
        }
        return original.call(this,options);
      };
    });
    await d.locator("#dRefresh").click();
    await waitText(d,"#dList","تعذّر تحميل القراءات");
    await waitText(d,"#dList","لا قراءات بعد");
    console.log("PASS doctor distinguishes a failed reading fetch from an empty history");

    await d.locator("#dNew").fill("مريض للربط التجريبي");
    await d.locator("#dAdd").click();
    await waitText(d,"#dList","مريض للربط التجريبي");
    const inviteCard=d.locator("#dList > .card").filter({hasText:"مريض للربط التجريبي"});
    const inviteButton=inviteCard.locator("[data-link]");
    const invitePid=await inviteButton.getAttribute("data-link");
    const dialogPromise=d.waitForEvent("dialog").then(async dialog=>{
      const code=dialog.message().match(/\b\d{8}\b/)?.[0];
      await dialog.accept();
      return code;
    });
    const [code] = await Promise.all([dialogPromise,inviteButton.click()]);
    assert.ok(code);
    const inviteDevice = await device("doctor");
    const i = inviteDevice.page;
    await login(i,invitee);
    await navigate(i,"more");
    await i.locator("#lkCode").fill(code);
    await i.locator("#lkBtn").click();
    await waitText(i,"#lkMsg","يجب الموافقة");
    await i.locator("#lkConsent").check();
    await i.locator("#lkBtn").click();
    await waitText(i,"#lkStatus","مرتبط بطبيبك");
    assert.equal((await readAdmin(env,"patients/"+invitePid)).patientUid,invitee.uid);
    assert.equal((await readAdmin(env,"links/"+code)).used,true);
    console.log("PASS approved doctor creates an invitation, patient accepts consent and code is consumed");

    const supervisorDevice = await device("doctor");
    const s = supervisorDevice.page;
    await login(s,supervisor);
    await navigate(s,"more");
    await s.locator("#accountSupervisor").waitFor();
    assert.equal(await s.locator("#accountDoctor").isVisible(),false);
    await s.locator("#accountSupervisor").click();
    await s.locator("#supervisorNext").waitFor();
    assert.equal(await s.locator(".supervisor-doctor").count(),30);
    await s.locator("#supervisorNext").click();
    await s.waitForFunction(()=>document.querySelectorAll(".supervisor-doctor").length===32);
    assert.equal(new Set(await s.locator(".supervisor-doctor bdi").allTextContents()).size,32);
    await s.locator("#supervisorUid").fill(newDoctor.uid);
    await s.locator("#supervisorForm button").click();
    const newRow=s.locator(".supervisor-doctor").filter({hasText:newDoctor.uid});
    await newRow.getByRole("button",{name:"إيقاف الاعتماد"}).waitFor();
    assert.deepEqual(await readAdmin(env,"doctors/"+newDoctor.uid),{active:true});
    s.once("dialog",dialog=>dialog.accept());
    await newRow.getByRole("button",{name:"إيقاف الاعتماد"}).click();
    await newRow.getByRole("button",{name:"اعتماد الطبيب",exact:true}).waitFor();
    assert.deepEqual(await readAdmin(env,"doctors/"+newDoctor.uid),{active:false});
    await visibleFit(s);
    console.log("PASS supervisor pages through approved roles, adds one doctor and revokes approval");

    const oldReading = {v:132,w:"f",c:"warn",t:"مرتفع قليلاً",d:"سجل قديم تجريبي",ts:1700000000067};
    const migrated = await device("doctor",{arg:{uid:patient.uid,reading:oldReading},fn:({uid,reading})=>{
      if (!localStorage.getItem("legacy-fixture")) {
        localStorage.setItem("legacy-fixture","1");
        localStorage.setItem("rafiq_log",JSON.stringify([reading]));
        localStorage.setItem("rafiq_link",JSON.stringify({pid:"low",uid}));
        localStorage.setItem("rafiq_sent",JSON.stringify({"r1700000000067_f_132":1}));
      }
    }});
    const m = migrated.page;
    await login(m,patient);
    await waitText(m,"#lkStatus","مرتبط بطبيبك");
    await m.locator("#lkSyncMeds").click();
    await waitText(m,"#lkMsg","تمت المزامنة");
    const legacyId="r"+oldReading.ts+"_f_132";
    assert.equal((await readAdmin(env,"patients/low/readings/"+legacyId)).v,132);
    await navigate(m,"log");
    await waitText(m,"#hist","132");
    console.log("PASS legacy pending reading is reconciled with the server despite a stale sent flag");

    if (existsSync(path.join(v50,"index.html"))) {
      serveV51=false;
      const upgrade=await device("log");
      const u=upgrade.page;
      await enter(u,126);
      await cacheReady(u,"rafiq-v50");
      serveV51=true;
      await u.reload({waitUntil:"load"});
      await ready(u);
      await waitText(u,"#hist","126");
      await u.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
      await cacheReady(u,"rafiq-v51");
      const indexed = await u.evaluate(async()=>{
        const response=await caches.match(new URL("index.html",location.href),{cacheName:"rafiq-v51"});
        return response ? (await response.text()).includes('id="research"') : false;
      });
      assert.equal(indexed,true);
      await upgrade.context.setOffline(true);
      await u.reload({waitUntil:"load"});
      await ready(u);
      await waitText(u,"#hist","126");
      await navigate(u,"research");
      await waitText(u,"#labSummary","0.701");
      console.log("PASS actual v50 to v51 upgrade preserves stored readings and updates the offline cache");
    } else {
      console.log("SKIP actual v50 upgrade replay. Set RAFIQ_V50_DIR to the unpacked baseline.");
    }

    assert.deepEqual(pageErrors,[]);
    console.log("PASS no uncaught page errors");
  } finally {
    await browser?.close();
    server.close();
    await env.clearFirestore();
    await env.cleanup();
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
