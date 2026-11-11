"use strict";

(function () {
  const meals = {name:"المراكز الأمريكية لمكافحة الأمراض · تخطيط الوجبات",url:"https://www.cdc.gov/diabetes/healthy-eating/diabetes-meal-planning.html"};
  const healthy = {name:"المعهد الأمريكي للسكري وأمراض الجهاز الهضمي والكلى",url:"https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes"};
  const fasting = {name:"جمعية السكري البريطانية · الصيام في رمضان",url:"https://www.diabetes.org.uk/about-diabetes/looking-after-diabetes/ramadan"};

  const fruitPortions = {name:"جمعية السكري البريطانية · حصص الفاكهة",url:"https://www.diabetes.org.uk/living-with-diabetes/eating/portion-sizes"};

  const topics = [
    {
      id:"plate", title:"كيف أرتّب طبق الوجبة؟",
      terms:["طبق","نظم وجبتي","طريقة الطبق","وجبة متوازنة","شن ناكل","شن نقدر ناكل","شن نقدر نوكل","ماذا آكل","شن ناكل في الغدا","نظام غذائي"],
      answer:"في طريقة الطبق، يُخصَّص نصف الطبق للخضار غير النشوية، وربعه للبروتين قليل الدهن، وربعه للطعام الذي يحتوي على الكربوهيدرات. اختر الماء أو مشروبًا غير مُحلّى مع الوجبة.",
      source:meals
    },
    {
      id:"breakfast", title:"كيف أختار فطوري؟",
      terms:["الفطور","فطور","الفطار","فطار","الفطور الصبح","الإفطار","افطار","فطوري","الفطور الصباحي","فطور الصباح"],
      answer:"اختر فطورًا يجمع مصدرًا للكربوهيدرات الغنية بالألياف مع مصدر للبروتين. من الأمثلة شوفان غير مُحلّى مع زبادي طبيعي. حدّد كمية الوجبة وفق خطة الأكل التي وضعها لك فريق الرعاية.",
      source:meals
    },
    {
      id:"grain", title:"الخبز والأرز والمكرونة والكسكسي",
      terms:["خبز","عيش","أرز","رز","مكرونة","معكرونة","كسكسي","كُسكسي","مبطن","بطاطا","نشويات","حبوب كاملة"],
      answer:"الخبز والأرز والمكرونة من الأطعمة التي تحتوي على الكربوهيدرات. في طريقة الطبق، تقع ضمن ربع الطبق المخصّص للكربوهيدرات. يمكن اختيار خبز الحبوب الكاملة وإكمال الوجبة بالخضار والبروتين.",
      source:meals
    },
    {
      id:"fruit", title:"الفاكهة والتمر",
      terms:["فاكهة","فواكه","تمر","تمرة","رطب","بلح","تفاح","موز","عنب","بطيخ","برتقال","برتقالة","فاكهة مجففة"],
      answer:"الفاكهة تدخل ضمن حصة الكربوهيدرات في الوجبة. اختر الفاكهة الكاملة غالبًا، واحسب التمر والفواكه المجففة ضمن الحصص التي تناسب خطة أكلك.",
      source:fruitPortions
    },
    {
      id:"drinks", title:"العصير والمشروبات المحلّاة",
      terms:["عصير","عصاير","مشروب","مشروبات","مشروب غازي","غازية","بيبسي","كوكا","كولا","ماء","عصير برتقال","مشروبات الطاقة"],
      answer:"اختر الماء أو مشروبًا دون سكر مضاف في الوجبات العادية. الفاكهة الكاملة خيار يحتوي على ألياف، بينما يرفع العصير السكر بسرعة أكبر من تناول الفاكهة الكاملة.",
      source:meals
    },
    {
      id:"hot-drinks", title:"الشاي والقهوة",
      terms:["شاي","قهوة","نسكافيه","شاهي","كابتشينو","شاهي بالسكر","قهوه"],
      answer:"يمكن اختيار الشاي أو القهوة غير المُحلّيين ضمن المشروبات اليومية. انتبه إلى السكر أو الشراب المُحلّى الذي يُضاف إلى القهوة الجاهزة.",
      source:healthy
    },
    {
      id:"sweets", title:"الحلويات والسكريات المضافة",
      terms:["حلويات","حلوى","شكلاطة","شوكولاتة","كيك","كعك","عسل","بسكوت","سكر مضاف","سكريات مضافة","مثلجات"],
      answer:"احسب الحلوى ضمن كمية الكربوهيدرات المخطّطة للوجبة، وقلّل تكرار الأطعمة والمشروبات الغنية بالسكر المضاف. راجع ملصق العبوة لمعرفة حجم الحصة وإجمالي الكربوهيدرات.",
      source:meals
    },
    {
      id:"beans", title:"الفول والعدس والحمص",
      terms:["فول","عدس","حمص","بقول","بقوليات","لوبيا","فاصوليا","بازلاء","بسلة"],
      answer:"تحتوي البقول مثل الفول والعدس والحمص على الألياف والبروتين والكربوهيدرات. احسب كميتها عند تخطيط حصة الكربوهيدرات في الوجبة.",
      source:healthy
    },
    {
      id:"fats", title:"الدهون والزيوت والمقليات",
      terms:["زيت","زيوت","زيتون","زبدة","سمن","سمنة","دهون","مقلي","مقليات","مقليه","قلي"],
      answer:"عند الطهي، اختر مصادر الدهون غير المشبعة مثل زيت الزيتون، وقلّل الأطعمة الغنية بالدهون المشبعة. يساعد الشوي أو الطهي في الفرن على تقليل الزيت المضاف.",
      source:healthy
    },
    {
      id:"milk", title:"الحليب واللبن والزبادي",
      terms:["حليب","لبن","زبادي","ياغورت","لبن رايب","روب","رايب"],
      answer:"اختر الحليب أو اللبن غير المحلّى وفق خطة أكلك. الحليب والزبادي يحتويان على كربوهيدرات، وقد تزيد الأصناف المحلّاة من كمية السكر المضاف.",
      source:meals
    },
    {
      id:"labels", title:"قراءة الملصق الغذائي",
      terms:["ملصق","ملصق غذائي","الملصق","بطاقة غذائية","حجم الحصة","إجمالي الكربوهيدرات","كارب","كربوهيدرات","عبوة"],
      answer:"ابدأ بحجم الحصة ثم اقرأ إجمالي الكربوهيدرات للحصة. إذا تناولت أكثر من حصة، احسب إجمالي الكربوهيدرات بحسب الكمية التي تناولتها.",
      source:meals
    },
    {
      id:"ramadan", title:"السكري والصيام في رمضان",
      terms:["رمضان","صيام","نصوم","نقدر نصوم","نصوم رمضان","اصوم","أصوم","سحور","صوم"],
      answer:"ناقش الصيام مع طبيبك أو فريق الرعاية قبل رمضان. يعتمد القرار على حالتك وخطة القياس والدواء، ويمكن لفريقك إعداد خطة تناسبك قبل بدء الصيام.",
      source:fasting
    }
  ];

  function normalize(value) {
    return String(value || "").normalize("NFKC")
      .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/g,"")
      .replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه")
      .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (/[٠-٩]/.test(digit) ? 0x660 : 0x6f0)))
      .replace(/[^\p{L}\p{N}]+/gu," ").trim().toLowerCase();
  }

  function tokens(value) {
    return normalize(value).split(" ").filter(Boolean).map(word =>
      word.replace(/^(?:بال|وال|فال|كال|لل|ال)(?=.{2,}$)/,""));
  }

  function matchesPhrase(text, phrase) {
    const padded = " "+text+" ";
    return padded.includes(" "+phrase+" ") || padded.includes(" و"+phrase+" ");
  }

  const indexed = topics.map(topic => ({
    topic,
    phrases:topic.terms.map(term => tokens(term).join(" "))
  }));
  const urgent = ["هبوط","سكر منخفض","انخفاض السكر","ارتفاع شديد","سكر مرتفع جدا","اغماء","اغمي","غيبوبه","فاقد الوعي",
    "فقد الوعي","فقدان الوعي","غير واعي","تشنج","صعوبه التنفس","مش قادر يتنفس","تعذر البلع","لا يقدر يبلع","قيء مستمر"];
  const clinical = ["جرعه","جرعات","حامل","حمل","رضاعه","طفل","قصور الكلى","غسيل كلى","علاج","اشعر","دوخه"];

  function findTopics(value) {
    const query = tokens(value).join(" ");
    if (!query) return [];
    return indexed.map(({topic,phrases}) => {
      const score = phrases.reduce((best, phrase) =>
        matchesPhrase(query,phrase) ? Math.max(best, phrase.split(" ").length) : best, 0);
      return {topic,score};
    }).filter(item => item.score>0).sort((a,b) => b.score-a.score);
  }

  function answerQuestion(value) {
    const query = tokens(value).join(" ");
    if (!query) return {type:"empty"};
    const reading = query.match(/(?:^| )(?:سكري|سكر|قياسي|قراءتي|قراءه) (?:(?:سكر|عندي|ان|وصل|وصلت|هو|كان|صار|طلع|اليوم|صايم|صائم) )*(\d{1,4})(?: |$)/);
    if (urgent.some(term=>matchesPhrase(query,tokens(term).join(" "))) ||
        (reading && (Number(reading[1])<70 || Number(reading[1])>=300))) return {type:"urgent"};
    if (clinical.some(term=>matchesPhrase(query,tokens(term).join(" ")))) return {type:"clinical"};
    const ranked = findTopics(value);
    if (!ranked.length) return {type:"unknown"};
    const specific = ranked.filter(item=>item.topic.id!=="plate");
    const candidates = specific.length ? specific : ranked;
    const choices = candidates.filter(item=>item.score===candidates[0].score).map(item=>item.topic);
    return choices.length===1 ? {type:"answer",topic:choices[0]} : {type:"choices",choices};
  }

  function start() {
    const form = document.getElementById("faqForm");
    if (!form) return;
    const input = document.getElementById("faqQ");
    const box = document.getElementById("faqResult");
    const list = document.getElementById("faqTopics");
    const listStatus = document.getElementById("faqListStatus");

    const element = (tag,text) => {
      const item = document.createElement(tag);
      item.textContent = text;
      return item;
    };
    function sourceLink(topic) {
      const link = element("a",topic.source.name);
      link.href = topic.source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    }
    function showTopic(topic) {
      box.className = "card food-answer";
      const source = element("p","المصدر ");
      source.className = "note";
      source.append(sourceLink(topic));
      box.replaceChildren(element("h3",topic.title),element("p",topic.answer),source);
      box.hidden = false;
    }
    function pickButton(topic) {
      const button = element("button",topic.title);
      button.type = "button";
      button.className = "go sec";
      button.addEventListener("click",()=>showTopic(topic));
      return button;
    }
    function submit(value) {
      const result = answerQuestion(value);
      if (result.type==="answer") {showTopic(result.topic);return;}
      box.className = "card food-answer";
      box.replaceChildren();
      const notices = {
        empty:"اكتب سؤالك عن الأكل أو اختر سؤالًا من القائمة.",
        clinical:"تحتاج الجرعات والأسئلة الصحية الخاصة إلى مراجعة طبيبك أو فريق الرعاية.",
        unknown:"اختر موضوعًا غذائيًا من القائمة أو أعد صياغة سؤالك بكلمات أوضح.",
        urgent:"افتح صفحة الطوارئ إذا كانت هناك أعراض أو قراءة مقلقة الآن. عند فقدان الوعي أو صعوبة التنفس اطلب مساعدة طارئة فورًا.",
        choices:"وجدت أكثر من موضوع في سؤالك. اختر الذي تقصده."
      };
      box.append(element("p",notices[result.type]));
      if (result.type==="urgent") {
        const link = element("a","فتح إرشادات الطوارئ");
        link.href = "#sos";
        box.append(link);
      }
      if (result.type==="choices") box.append(...result.choices.map(pickButton));
      box.hidden = false;
    }
    const cards = new Map();
    for (const topic of topics) {
      const row = document.createElement("details");
      const source = element("p","المصدر ");
      source.className = "note";
      source.append(sourceLink(topic));
      row.append(element("summary",topic.title),element("p",topic.answer),source);
      cards.set(topic.id,row);
      list.append(row);
    }
    for (const id of ["plate","breakfast","fruit"]) {
      document.getElementById("faqSuggestions").append(pickButton(topics.find(topic=>topic.id===id)));
    }
    input.addEventListener("input",()=>{
      box.hidden = true;
      const query = input.value.trim();
      const allowed = new Set(findTopics(query).map(item=>item.topic.id));
      for (const [id,row] of cards) row.hidden = !!query && !allowed.has(id);
      listStatus.textContent = !query ? "" : allowed.size
        ? "عدد الموضوعات المطابقة "+allowed.size
        : "لم يظهر موضوع مطابق في القائمة.";
    });
    form.addEventListener("submit",event=>{event.preventDefault();submit(input.value);});
  }

  if (typeof module!=="undefined") module.exports = {answerQuestion,findTopics,normalize};
  if (typeof document!=="undefined") start();
})();
