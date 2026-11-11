"use strict";
const assert = require("node:assert/strict");
const {initializeTestEnvironment,assertSucceeds,assertFails} = require("@firebase/rules-unit-testing");
const {
  collection,doc,documentId,getDoc,getDocs,limit,orderBy,query,setDoc,updateDoc,deleteDoc,where,writeBatch,
} = require("firebase/firestore");
const {projectId,host,firestorePort} = require("./paths.cjs");

const provider = (signInProvider) => ({firebase:{sign_in_provider:signInProvider}});
const reading = {v:117,w:"f",c:"ok",ts:1700000000000,d:"وقت تجريبي",t:"مستوى تجريبي"};
const now = Date.now();

async function run() {
  const env = await initializeTestEnvironment({projectId,firestore:{host,port:firestorePort}});
  const account = (uid,signInProvider="password") => env.authenticatedContext(uid,provider(signInProvider)).firestore();
  const doctor = account("doctor-a");
  const patient = account("patient-a");
  const invitee = account("invitee","anonymous");
  const supervisor = account("supervisor");
  const other = account("doctor-b");
  const unverified = env.unauthenticatedContext().firestore();
  const get = (db,key)=>getDoc(doc(db,key));
  const set = (db,key,data)=>setDoc(doc(db,key),data);
  const update = (db,key,data)=>updateDoc(doc(db,key),data);
  const remove = (db,key)=>deleteDoc(doc(db,key));
  const list = (db,path,...filters)=>getDocs(query(collection(db,path),...filters));

  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context=>{
      const admin = context.firestore();
      const batch = writeBatch(admin);
      const records = {
        "doctors/doctor-a":{active:true},
        "doctors/doctor-b":{active:true,legacyLabel:"يبقى محفوظًا"},
        "supervisors/supervisor":{active:true},
        "patients/case-a":{name:"ملف تجريبي أ",doctorId:"doctor-a",patientUid:"patient-a"},
        "patients/case-b":{name:"ملف تجريبي ب",doctorId:"doctor-a",linkCode:"12345678"},
        "patients/expired":{name:"ملف تجريبي ج",doctorId:"doctor-a",linkCode:"99999999"},
        "links/12345678":{pid:"case-b",doctorId:"doctor-a",used:false,exp:now+180000},
        "links/99999999":{pid:"expired",doctorId:"doctor-a",used:false,exp:now-10000},
      };
      for (const [key,value] of Object.entries(records)) batch.set(doc(admin,key),value);
      await batch.commit();
    });

    await assertSucceeds(get(supervisor,"supervisors/supervisor"));
    await assertSucceeds(get(patient,"supervisors/patient-a"));
    await assertFails(get(patient,"supervisors/supervisor"));
    await assertFails(list(supervisor,"supervisors",limit(31)));
    await assertFails(set(patient,"supervisors/patient-a",{active:true}));
    await assertFails(set(supervisor,"supervisors/second-supervisor",{active:true}));
    await assertFails(get(unverified,"supervisors/supervisor"));
    console.log("PASS supervisor role documents require admin provisioning");

    const initial = await assertSucceeds(list(supervisor,"doctors",orderBy(documentId()),limit(31)));
    assert.deepEqual(initial.docs.map(record=>record.id),["doctor-a","doctor-b"]);
    await assertFails(list(supervisor,"doctors"));
    await assertFails(list(supervisor,"doctors",limit(32)));
    await assertFails(list(patient,"doctors",limit(31)));
    await assertFails(list(account("supervisor","anonymous"),"doctors",limit(31)));
    await assertFails(set(other,"doctors/doctor-c",{active:true}));
    await assertFails(set(supervisor,"doctors/doctor-c",{active:true,email:"ignored@example.test"}));
    await assertFails(set(supervisor,"doctors/doctor-c",{active:false}));
    await assertSucceeds(set(supervisor,"doctors/doctor-c",{active:true}));
    await assertFails(update(supervisor,"doctors/doctor-c",{active:"false"}));
    await assertFails(update(supervisor,"doctors/doctor-b",{legacyLabel:"new"}));
    await assertSucceeds(update(supervisor,"doctors/doctor-b",{active:false}));
    const legacy = await assertSucceeds(get(supervisor,"doctors/doctor-b"));
    assert.deepEqual(legacy.data(),{active:false,legacyLabel:"يبقى محفوظًا"});
    await assertFails(remove(supervisor,"doctors/doctor-b"));
    await assertFails(get(supervisor,"patients/case-a"));
    await assertFails(get(supervisor,"patients/case-a/readings/same-id"));
    await assertFails(list(supervisor,"patients",limit(31)));
    console.log("PASS supervisor manages bounded doctor lists and cannot read patient data");

    await assertSucceeds(get(doctor,"doctors/doctor-a"));
    await assertSucceeds(get(doctor,"patients/case-a"));
    await assertFails(get(other,"patients/case-a"));
    await assertFails(get(account("doctor-a","anonymous"),"patients/case-a"));
    await assertFails(set(other,"patients/rejected",{name:"تجربة",doctorId:"doctor-b"}));
    await assertSucceeds(set(account("doctor-c"),"patients/new",{name:"تجربة",doctorId:"doctor-c",createdAt:now}));
    const linked = await assertSucceeds(list(patient,"patients",where("patientUid","==","patient-a"),limit(2)));
    assert.deepEqual(linked.docs.map(record=>record.id),["case-a"]);
    await assertFails(get(patient,"patients/case-b"));
    console.log("PASS approved doctors and linked patients have scoped access");

    const record = "patients/case-a/readings/same-id";
    await assertFails(set(patient,record,{...reading,v:999}));
    await assertFails(set(patient,record,{...reading,by:"doctor"}));
    await assertSucceeds(set(patient,record,reading));
    await assertSucceeds(set(patient,record,reading));
    await assertFails(set(patient,record,{...reading,v:118}));
    const stored = await assertSucceeds(list(doctor,"patients/case-a/readings",orderBy("ts","desc"),limit(5)));
    assert.equal(stored.size,1);
    assert.deepEqual(stored.docs[0].data(),reading);
    await assertFails(get(other,record));
    await assertFails(remove(patient,record));
    console.log("PASS reading writes are validated and idempotent");

    const link = "links/12345678";
    const target = "patients/case-b";
    const consent = {accepted:true,ts:now};
    await assertSucceeds(get(invitee,link));
    await assertFails(get(unverified,link));
    await assertFails(update(invitee,link,{used:true}));
    await assertFails(update(invitee,target,{patientUid:"invitee",consent}));
    await assertFails(get(invitee,"links/99999999"));
    const batch = writeBatch(invitee);
    batch.update(doc(invitee,target),{patientUid:"invitee",consent});
    batch.update(doc(invitee,link),{used:true});
    await assertSucceeds(batch.commit());
    assert.equal((await assertSucceeds(get(invitee,target))).data().patientUid,"invitee");
    await assertFails(get(invitee,link));
    await assertFails(update(patient,link,{used:true}));
    console.log("PASS link code is read only while valid and consumed atomically");

    await env.withSecurityRulesDisabled(context=>update(context.firestore(),"supervisors/supervisor",{active:false}));
    await assertFails(list(supervisor,"doctors",limit(31)));
    await assertFails(set(supervisor,"doctors/doctor-d",{active:true}));
    await assertSucceeds(get(doctor,"patients/case-a"));
    console.log("PASS revoked supervisor loses access immediately");
  } finally {
    await env.clearFirestore();
    await env.cleanup();
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
