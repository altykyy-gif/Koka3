"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {app} = require("./paths.cjs");
const {answerQuestion,findTopics,normalize} = require(path.join(app, "nutrition.js"));
const {forecast} = require(path.join(app, "glucose-lab.js"));
const study = require(path.join(app, "glucose-study.json"));
const model = study.outcomes.high.parameters;
const example = {previous:145,current:120,minutes:240};

test("nutrition answers in Arabic and Libyan dialect with source", () => {
  for (const [q,id] of [
    ["شن نقدر ناكل في الفطور؟","breakfast"], ["هل الكُسكسي مناسب؟","grain"],
    ["هل نقدر ناكل التمر؟","fruit"], ["شن وضع العدس؟","beans"],
    ["ماذا أفعل في صيام رمضان؟","ramadan"], ["كيف أقرأ إجمالي الكربوهيدرات؟","labels"],
  ]) {
    const answer = answerQuestion(q);
    assert.equal(answer.type,"answer",q);
    assert.equal(answer.topic.id,id,q);
    assert.equal(new URL(answer.topic.source.url).protocol,"https:");
  }
});

test("nutrition sends current high/low readings, severe symptoms and medication questions to the proper screen", () => {
  assert.equal(normalize("إفطَار ٤٨ ۳۰۰"),"افطار 48 300");
  for (const q of ["سكري ٤٨ هل أشرب عصير؟", "السكر عندي ۳۰۰ هل آكل؟", "عندي صعوبة التنفس"]) {
    assert.equal(answerQuestion(q).type,"urgent",q);
  }
  for (const q of ["كم جرعة الإنسولين؟","أنا حامل فهل آكل التمر؟"]) {
    assert.equal(answerQuestion(q).type,"clinical",q);
  }
});

test("nutrition distinguishes ambiguity, unknown, empty, and an inert markup query", () => {
  assert.equal(answerQuestion("خبز وتمر").type,"choices");
  assert.equal(answerQuestion("؟").type,"empty");
  assert.equal(answerQuestion("<<img src=x onerror=alert(1)>>").type,"unknown");
  assert.deepEqual(findTopics("العدس").map(result=>result.topic.id),["beans"]);
});

test("packaged study preserves the independent test and the high-only output", () => {
  assert.equal(study.schema,1);
  assert.equal(study.train.examples+study.test.examples,study.extraction.complete_sensor_window);
  assert.equal(study.train.participants,57);
  assert.equal(study.test.participants,20);
  assert.equal(study.test.examples,388);
  assert.equal(study.outcomes.high.test_events,70);
  assert.equal(study.outcomes.low.test_events,12);
  assert.equal(study.outcomes.low.parameters,undefined);
  assert.equal(study.outcomes.high.model.auc,0.700854);
  const [lo,hi] = study.outcomes.high.participant_bootstrap.auc_gain_vs_latest_95;
  assert.ok(lo<0 && hi>0);
});

test("browser inference agrees with the trained Python model", () => {
  assert.ok(Math.abs(forecast(model,example)-0.09551898116618104)<1e-12);
  const rising = forecast(model,{previous:110,current:180,minutes:240});
  assert.ok(rising>forecast(model,example) && rising<1);
  assert.ok(forecast(model,{previous:700,current:70,minutes:15})>0);
});

test("inference rejects unsupported values and broken coefficients", () => {
  for (const invalid of [
    {current:69},{current:181},{previous:NaN},{previous:701},
    {minutes:0},{minutes:1441},{minutes:"240"},
  ]) assert.throws(()=>forecast(model,{...example,...invalid}),RangeError);
  assert.throws(()=>forecast({...model,scales:[1,0,1]},example),/معاملات الدراسة/);
});
