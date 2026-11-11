"use strict";

(function () {
  function forecast(model, values) {
    const {current, previous, minutes} = values;
    if (!Number.isFinite(current) || current<70 || current>180 ||
        !Number.isFinite(previous) || previous<20 || previous>700 ||
        !Number.isFinite(minutes) || minutes<15 || minutes>1440) {
      throw new RangeError("القيم التجريبية خارج نطاق الدراسة.");
    }
    const vector = [current,current-previous,Math.log1p(minutes)];
    if (!model || !Number.isFinite(model.intercept) ||
        ![model.means,model.scales,model.weights].every(items=>
          Array.isArray(items) && items.length===vector.length && items.every(Number.isFinite)) ||
        model.scales.some(scale=>scale<=0)) {
      throw new Error("تعذّر قراءة معاملات الدراسة.");
    }
    const logit = vector.reduce((sum,value,i) =>
      sum+((value-model.means[i])/model.scales[i])*model.weights[i],model.intercept);
    return 1/(1+Math.exp(-logit));
  }

  function start() {
    const form = document.getElementById("labForm");
    if (!form) return;
    const summary = document.getElementById("labSummary");
    const result = document.getElementById("labResult");
    const submit = form.querySelector('[type="submit"]');
    const current = document.getElementById("labCurrent");
    const previous = document.getElementById("labPrevious");
    const minutes = document.getElementById("labGap");
    const integer = new Intl.NumberFormat("ar-LY");
    const percent = new Intl.NumberFormat("ar-LY",{style:"percent",maximumFractionDigits:1});
    let study;

    function showSummary() {
      const high = study.outcomes.high;
      const low = study.outcomes.low;
      const items = [
        "استُخدمت "+integer.format(study.extraction.complete_sensor_window)+" نافذة من بيانات النوع الثاني.",
        "التدريب على "+integer.format(study.train.participants)+" مشاركًا، والاختبار على "+integer.format(study.test.participants)+" مشاركًا مستقلًا.",
        "تضمّنت "+integer.format(high.test_events)+" من "+integer.format(study.test.examples)+" نافذة في الاختبار قراءة أعلى من الحد. بلغ مؤشر التمييز "+high.model.auc.toFixed(3)+" من 1.",
        "رُصدت "+integer.format(low.test_events)+" نافذة هبوط في الاختبار. يعرض المختبر نتيجة الارتفاع."
      ];
      const list = document.createElement("ul");
      for (const item of items) {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      }
      summary.replaceChildren(list);
    }
    fetch("glucose-study.json")
      .then(response=>{
        if (!response.ok) throw new Error("تعذّر تحميل ملف نتائج الدراسة.");
        return response.json();
      })
      .then(value=>{
        if (value.schema!==1 || value.window_minutes!==60) throw new Error("إصدار غير متوافق.");
        forecast(value.outcomes.high.parameters,{current:120,previous:140,minutes:240});
        study = value;
        showSummary();
        submit.disabled = false;
      })
      .catch(()=>{summary.textContent="تعذّر تحميل نتائج الدراسة. أعد فتح الصفحة بعد التحديث.";});

    form.addEventListener("submit",event=>{
      event.preventDefault();
      if (!study) return;
      try {
        const probability = forecast(study.outcomes.high.parameters,{
          current:current.valueAsNumber,previous:previous.valueAsNumber,minutes:minutes.valueAsNumber
        });
        result.className = "res";
        result.textContent = "في هذه المحاكاة، تقدير النموذج لظهور قراءة حساس أعلى من 180 ملغ/دل خلال الساعة التالية هو "+percent.format(probability)+".";
      } catch (error) {
        result.className = "res warn";
        result.textContent = error.message;
      }
      result.hidden = false;
    });
    form.addEventListener("input",()=>{result.hidden=true;});
  }

  if (typeof module!=="undefined") module.exports = {forecast};
  if (typeof document!=="undefined") start();
})();
