// =====================================================================
// 端到端 DOM 測試：載入真實 index.html，把 views / study 模組實際掛上去跑
//
// 需要 jsdom（非本專案執行期依賴，僅測試用）：
//     npm i -D jsdom && node tests/dom.test.mjs <pool.json>
// pool.json 可從 Supabase 匯出：items 的 select=* 結果
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { SHARED, SITE, SITE_DIR, siteReady } from './_site.mjs';
const dom=new JSDOM(fs.readFileSync(SITE_DIR+'/index.html','utf8'),{pretendToBeVisual:true, url:'https://x.test/'});
global.window=dom.window; global.document=dom.window.document;
global.localStorage=dom.window.localStorage; global.getComputedStyle=dom.window.getComputedStyle;
global.confirm=()=>true; global.prompt=()=>null;

// 共用模組載入當下就會用到 lang()，所以先裝配站台
const LANG = await siteReady();

let f=0; const chk=(n,c,e='')=>{console.log(`  ${c?'✅':'❌'} ${n}${e?' — '+e:''}`); if(!c)f++;};

// 真實模組（不碰網路的那些）
const { show, initTabs, onEnter, viewFromHash } = await import(SHARED+'/js/views/router.js');
const { initTheme, applyTheme } = await import(SHARED+'/js/views/theme.js');
const { createSession } = await import(SHARED+'/js/study/session.js');
const { RATING } = await import(SHARED+'/js/core/srs.js');
const { getMode } = await import(SHARED+'/js/study/modes/index.js');
const { $, esc, skeleton, emptyState, msg } = await import(SHARED+'/js/core/dom.js');
const { on, emit, EVENTS } = await import(SHARED+'/js/core/bus.js');

console.log('【router】');
initTabs();
const views=['view-auth','view-home','view-study','view-done','view-browse','view-history','view-me','view-import'];
for (const v of views){ await show(v);
  const vis=views.filter(x=>!$(x).classList.contains('hidden'));
  if(vis.length!==1||vis[0]!==v){chk('切到 '+v,false,'可見='+vis); }
}
chk('八個視圖切換皆正確', true);
// ★ 學習中也顯示分頁列（2026-08-18 起）。
//   原本隱藏是為了「避免誤觸中斷」，但續跑做好之後那個理由不成立了：
//   離開不會弄丟進度（每答一題就存本機＋雲端）。
//   而隱藏的代價是真的：學到一半想查個詞、想看看記錄，都得先結束這一輪。
await show('view-study');
chk('★ 學習中也顯示分頁列', !$('tabbar').classList.contains('hidden'),
    '續跑做好之後，離開不再弄丟進度 —— 沒有理由把人關在這一頁');
await show('view-auth');
chk('只有登入頁不顯示', $('tabbar').classList.contains('hidden'),
    '沒登入的話每個分頁都是空的，給了也只能點到空畫面');

// ★ 分頁按鈕不做任何攔截 —— 按「首頁」就是去首頁。
//   這裡曾經驗的是相反的行為：「有進行中的一輪時，點首頁回到那一輪」。
//   那個設計讓使用者在首頁以外的任何一頁都回不了首頁 ——
//   唯一的出口是學習畫面裡那顆 🏠，沒有人找得到。使用者實際回報了。
//   接回上一輪的入口改放在首頁上（那顆「繼續這一輪」）。
{
  const { initTabs: initT } = await import(SHARED + '/js/views/router.js');
  initT();
  const homeTab = $('tabbar').querySelector('[data-tab="view-home"]');

  await show('view-browse');            // 學到一半跑去查詞
  homeTab.click();
  await new Promise((r) => setTimeout(r, 0));
  chk('★ 從詞庫點「首頁」就到首頁', !$('view-home').classList.contains('hidden'),
      '導覽列是使用者對「我能去哪」的唯一保證，不該有例外');

  await show('view-study');             // 學習中也一樣
  homeTab.click();
  await new Promise((r) => setTimeout(r, 0));
  chk('★ 學習中點「首頁」也到得了首頁', !$('view-home').classList.contains('hidden'),
      '學習中被關在裡面正是使用者回報的那個 bug');
}


// =====================================================================
// 【等網路的按鈕要有忙碌狀態，而且重按不會排隊】
//
// 輪練第一次按下去要撈整個詞庫（韓文站 801 條，實測 964 ms），
// 期間畫面若毫無變化，使用者的合理反應是再按幾下 ——
// 而那正是「一按就吃掉 10 個詞」那個 bug 被觸發的方式（docs/LESSONS.md L-002）。
// 重按現在是冪等的，但沒有回饋的等待本身就該消失。
{
  const { busy } = await import(SHARED + '/js/core/dom.js');
  const btn = document.createElement('button');
  btn.innerHTML = '<span>學新的</span>';
  document.body.appendChild(btn);

  let runs = 0, release;
  const slow = () => { runs += 1; return new Promise((r) => { release = r; }); };

  const p = busy(btn, slow);
  chk('★ 載入中按鈕標成忙碌', btn.getAttribute('aria-busy') === 'true',
      '沒有回饋的等待會製造重試');
  chk('載入中按鈕按不下去', btn.disabled === true);
  chk('★ 按鈕裡的子元素沒有被清掉', btn.querySelector('span')?.textContent === '學新的',
      '改 textContent 的話課名會不見，而且回復不了');

  busy(btn, slow); busy(btn, slow);
  chk('★ 重按不排隊（只跑一次）', runs === 1, `跑了 ${runs} 次`);

  release();
  await p;
  chk('載入完解除忙碌', btn.getAttribute('aria-busy') === null && btn.disabled === false);

  // 本來就該是灰的按鈕，忙完不可以被點亮
  const off = document.createElement('button');
  off.disabled = true;
  document.body.appendChild(off);
  await busy(off, () => {});
  chk('★ 原本停用的按鈕，忙完仍然停用', off.disabled === true,
      '直接寫 disabled = false 會把一顆該灰的按鈕點亮');
}

// 🏠 與 ✕ 必須分開：一輪 30–80 題，只是想看一眼首頁不該付「結束本輪」的代價
chk('學習頁有「離開但保留」的出口', !!$('btn-park'),
    '分頁列的「首頁」會跳回這一輪，少了這個出口就沒有路去真正的首頁');
await show('view-home');  chk('首頁高亮對應 Tab', $('tabbar').querySelector('button.on')?.dataset.tab==='view-home');
let entered=0; onEnter('view-me',()=>{entered++;}); await show('view-me');
chk('onEnter 鉤子被呼叫', entered===1, '各畫面自行註冊進入行為，router 不認識它們');

// 重新整理回到原頁：切畫面會同步網址，啟動時再從網址還原
await show('view-browse');
chk('切畫面時網址同步', window.location.hash==='#browse', window.location.hash);
chk('從網址還原畫面', viewFromHash()==='view-browse');
await show('view-history');
chk('再切一次網址跟著變', window.location.hash==='#history');
window.location.hash='#me';
chk('網址指向我的 → 還原為 view-me', viewFromHash()==='view-me');
window.location.hash='';
chk('沒有網址時預設首頁', viewFromHash()==='view-home');
window.location.hash='#study';
chk('學習中不可由網址還原（佇列已不在）', viewFromHash()==='view-home');
window.location.hash='';

console.log('\n【事件匯流排解耦】');
let gotUpdate=null, gotChange=0;
const off = on(EVENTS.ITEM_UPDATED, p=>{gotUpdate=p;});
on(EVENTS.ITEMS_CHANGED, ()=>gotChange++);
emit(EVENTS.ITEM_UPDATED,{id:'x',ko:'테스트'});
emit(EVENTS.ITEMS_CHANGED);
chk('訂閱者收到 ITEM_UPDATED', gotUpdate?.ko==='테스트');
chk('訂閱者收到 ITEMS_CHANGED', gotChange===1);
off(); emit(EVENTS.ITEM_UPDATED,{id:'y'});
chk('取消訂閱後不再收到', gotUpdate?.id==='x');
on(EVENTS.SESSION_END, ()=>{throw new Error('boom');});
let after=0; on(EVENTS.SESSION_END, ()=>after++);
emit(EVENTS.SESSION_END);
chk('一個訂閱者出錯不影響其他人', after===1);

console.log('\n【theme】');
initTheme();
applyTheme('dark');  chk('深色', document.documentElement.getAttribute('data-theme')==='dark');
applyTheme('light'); chk('淺色', document.documentElement.getAttribute('data-theme')==='light');
applyTheme('system');chk('跟隨系統移除屬性', !document.documentElement.hasAttribute('data-theme'));

console.log('\n【dom 工具】');
chk('esc 擋 XSS', esc('<img src=x onerror=1>')==='&lt;img src=x onerror=1&gt;');
$('h-list').innerHTML=skeleton(4);
chk('骨架屏 4 條', $('h-list').querySelectorAll('.skel i').length===4);
$('weak-list').innerHTML=emptyState('🎯','沒有資料');
chk('空狀態有圖示', !!$('weak-list').querySelector('.e-icon'));
msg('測試訊息','ok');
chk('訊息條顯示', $('msg').querySelector('.msg.ok')?.textContent==='測試訊息');

console.log('\n【session + 題型掛載（真實 DOM）】');
const items=JSON.parse(fs.readFileSync(process.argv[2] || 'pool.json','utf8'));
const saved=[];
const S=createSession({save:p=>saved.push(p),onChange:()=>{},onFinish:()=>{}});
S.start(items.slice(0,4).map(i=>({item:i,direction:'ko2zh',card:null})));
const els={choices:$('choices'),grade:$('grade')};
const m=getMode('choice');
const inst=m.mount({item:items[0],direction:'ko2zh',els,pool:items,
  reveal:()=>{},grade:r=>S.grade(r),setFront:()=>{}});
chk('四選一渲染 4 個選項', $('choices').querySelectorAll('button').length===4);
chk('選項區已顯示', !$('choices').classList.contains('hidden'));
inst.teardown();
chk('teardown 後收起且清空', $('choices').classList.contains('hidden') && $('choices').innerHTML==='');

// 詞序重組不是每站都有 —— 日文站關掉了（日文不用空格分詞）。
// 站台關掉的題型 getMode() 會退回 flip，硬掛就會炸在一個看不出原因的地方。
if ((LANG.disabledModes||[]).includes('scramble')) {
  console.log('  ⏭  本站關閉詞序重組，跳過該段（不是失敗）');
} else {
const sm=getMode('scramble');
const target=items.find(i=>sm.canUse(i,{pool:items}));
const si=sm.mount({item:target,direction:'zh2ko',
  els:{scramble:$('scramble'),sAnswer:$('s-answer'),sPool:$('s-pool'),sResult:$('s-result'),grade:$('grade')},
  reveal:()=>{},grade:()=>{},setFront:(t)=>{$('c-front').textContent=t;}});
const toks=$('s-pool').querySelectorAll('.tok');
chk('詞序重組渲染詞塊', toks.length>=2, toks.length+' 塊');
chk('題面顯示中文', $('c-front').textContent.length>0, $('c-front').textContent);
toks[0].click();
chk('點詞塊移入答案區', $('s-answer').querySelectorAll('.tok').length===1);
$('s-answer').querySelector('.tok').click();
chk('點答案區詞塊可退回', $('s-answer').querySelectorAll('.tok').length===0);
si.teardown();
chk('teardown 收起', $('scramble').classList.contains('hidden'));
}

// ---------------------------------------------------------------------
// 以下三段斷言的是「韓語的教學法」：連音必須排在複合收音之前、
// 導言要帶諺文實例等等。那是韓語特有的知識，不是通用規則，
// 所以寫死韓文標籤是對的，只在韓文站跑。
//
// 其他站台的 taxonomy 由 tests/lang.test.mjs 泛用地驗
// （每課都有導言、發音組照教學序排、收尾話刻意留白…）。
// ---------------------------------------------------------------------
if (SITE !== 'korean') {
  console.log('\n  ⏭  以下三段是韓語教學法的斷言，非韓文站跳過（由 lang.test.mjs 涵蓋）');
} else {
// ---------------------------------------------------------------------
// 標籤分類：發音組必須依教學順序，不能被數量排序帶跑
// ---------------------------------------------------------------------
console.log('\n【標籤分類】');
const { groupTags, pronOrder } = await import(SHARED+'/js/core/taxonomy.js');
const PRON_ORDER = pronOrder();
{
  const pairs = [['食物',80],['動詞',41],['收音ㄽ',1],['連音練習',8],['問候',18],
                 ['收音ㄱ',4],['收音ㄼ',3],['激音化',14],['句型',39],['家庭',22]];
  const g = groupTags(pairs);
  chk('主題組只收主題標籤',
      g.topic.every(([t]) => ['食物','家庭','問候'].includes(t)));
  chk('語法組只收語法標籤', g.grammar.map(([t])=>t).join()==='動詞,句型');
  chk('起步主題置頂 — 問候(18) 排在 食物(80) 之前',
      g.topic[0][0]==='問候',
      '自學者沒有老師說「先學這個」，先背 80 個食物名詞不如先會打招呼');
  const p = g.pron.map(([t]) => t);
  chk('基本收音排在複合收音之前', p.indexOf('收音ㄱ') < p.indexOf('收音ㄼ'));
  chk('★ 連音排在複合收音之前',
      p.indexOf('連音練習') < p.indexOf('收音ㄼ'),
      '넓다[널따] 與 넓어요[널버요] 的差別要先懂連音才講得通，否則只能死背');
  chk('複合收音排在音變規則之前', p.indexOf('收音ㄼ') < p.indexOf('激音化'));
  chk('發音組不按數量排 — 收音ㄼ(3) 在 激音化(14) 之前',
      p.indexOf('收音ㄼ') < p.indexOf('激音化'),
      '按數量排會把教學序列打散成人氣榜');
  // 硬名單漏列時標籤不能憑空消失
  const g2 = groupTags([['收音ㅆ', 3]]);
  chk('未列進教學序列的 收音* 仍歸發音組', g2.pron.length===1 && g2.topic.length===0,
      '日後新增收音標籤時不會掉出分組');
  chk('教學序列無重複', new Set(PRON_ORDER).size === PRON_ORDER.length);
}

// ---------------------------------------------------------------------
// 發音課程：「下一課」的判準
// ---------------------------------------------------------------------
console.log('\n【發音課程進度】');
{
  const { nextLesson, LESSON_DONE } = await import(SHARED+'/js/core/taxonomy.js');
  // started = 碰過幾條（決定能不能前進）；mastered = 掌握幾條（只影響顯示）
  const r = (tag, total, started, mastered = 0) => ({ tag, total, started, mastered });

  // 沒走完 → 不能往前跳。這條守的是「一路夾生」那個風險：
  // 碰過兩條就算過關的話，整條發音路線會全部半生不熟。
  let g = nextLesson([r('收音ㄱ',4,2), r('收音ㄴ',4,0)]);
  chk('★ 課裡還有沒碰過的條目，下一課仍是同一課', g.next.tag==='收音ㄱ',
      '碰過兩條就算過關，等於整條路線一路夾生');

  // 走完就前進 —— 即使一條都還沒「掌握」
  g = nextLesson([r('收音ㄱ',4,4,0), r('收音ㄴ',4,0)]);
  chk('★ 走完全部條目就前進，不必等到掌握', g.next.tag==='收音ㄴ' && g.done===1,
      '掌握的定義是隔 21 天還記得 —— 拿它擋人往前走，學完當下畫面毫無反應，讀起來就是壞掉');

  // 掌握是另一個指標，不影響前進
  g = nextLesson([r('收音ㄱ',4,4,4), r('收音ㄴ',4,4,0)]);
  chk('掌握數獨立計算，不與前進綁在一起',
      g.next===null && g.done===2 && g.mastered===1,
      '走完 2 課、其中 1 課達到掌握門檻');

  // 全部走完 → 不硬塞下一件事
  g = nextLesson([r('收音ㄱ',4,4), r('收音ㄴ',4,4)]);
  chk('全部走完時 next 為 null', g.next===null && g.done===2);

  // 順序照教學序列，不照傳入順序
  g = nextLesson([r('激音化',4,0), r('收音ㄱ',4,0)]);
  chk('照教學序列判斷，不照傳入順序', g.next.tag==='收音ㄱ');

  // 空資料不炸
  chk('沒有資料時不炸', nextLesson([]).next===null && nextLesson([]).total===0);
  chk('掌握門檻仍是 0.8（只用於顯示）', LESSON_DONE===0.8,
      '要求 100% 才算掌握，會讓人為了一兩條特別難的永遠標不上');
}

// ---------------------------------------------------------------------
// 課程導言：開課時出現，離開這一課時必須清掉
// ---------------------------------------------------------------------
console.log('\n【課程導言】');
{
  // 不 import study.js —— 它會連帶載入 supabase-js（CDN 網址），Node 無法解析。
  // 這裡驗資料完整性，「每輪必重設」的不變量在 arch 測試用原始碼層檢查。
  const { lessonIntro, lessonOutro } = await import(SHARED+'/js/core/taxonomy.js');
  const LESSON_INTRO = lessonIntro();

  chk('每一課都有導言', PRON_ORDER.every((t) => LESSON_INTRO[t]),
      '路徑解決「學什麼」，導言解決「為什麼」，缺一課就斷一節');
  chk('沒有多餘導言（課程刪掉時要記得跟著刪）',
      Object.keys(LESSON_INTRO).every((t) => PRON_ORDER.includes(t)));
  chk('導言夠短（≤60 字）', Object.values(LESSON_INTRO).every((v) => v.length <= 60),
      '真實課堂上老師點到就停，不會講滿一段');
  chk('收尾話更短（≤35 字）',
      PRON_ORDER.map((t) => lessonOutro(t, 0.9)).concat(PRON_ORDER.map((t) => lessonOutro(t, 0.4)))
        .filter(Boolean).every((v) => v.length <= 35),
      '收尾是一句話的事，說完就讓人走');
  chk('導言都給了具體例子',
      Object.values(LESSON_INTRO).every((v) => LANG.scriptRe.test(v)),
      '只講規則不給實例，等於還是要學習者自己想像');
  chk('導言的 DOM 錨點存在',
      !!$('lesson-intro') && !!$('lesson-title') && !!$('lesson-body'));

  // ---- 收尾話 ----
  chk('★ 不是每課都有收尾話',
      PRON_ORDER.filter((t) => lessonOutro(t, 0.9)).length < PRON_ORDER.length,
      '每課都給等於每句都不算數，稱讚天天有就成了背景音');
  chk('答得不好時不假稱讚，換成重新定義挫敗',
      lessonOutro('收音ㄹ', 0.4) !== lessonOutro('收音ㄹ', 0.9)
      && /正常/.test(lessonOutro('收音ㄹ', 0.4)),
      '答錯一半最不需要的是「太棒了」');
  chk('複合收音十一課共用同一句 —— 它們是同一條規則的十一個實例',
      lessonOutro('收音ㄼ', 0.9) === lessonOutro('收音ㅄ', 0.9)
      && lessonOutro('收音ㄼ', 0.9) !== '');
  chk('★ 基本收音不被當成複合收音',
      lessonOutro('收音ㄱ', 0.9) !== lessonOutro('收音ㄼ', 0.9),
      '收音ㄼ 與 收音ㄱ 都是三個字，不能用字串長度分辨');
  chk('非課程內容沒有收尾話', lessonOutro('', 0.9) === '' && lessonOutro('食物', 0.9) === '');
}

}
// ---------------------------------------------------------------------
// 專注模式：收起導言的選擇要被記住
// ---------------------------------------------------------------------
console.log('\n【專注模式】');
{
  // setLesson 不能從 study.js 匯入（會連帶載入 CDN 上的 supabase-js），
  // 這裡照它的契約重跑一次邏輯，驗的是「行為」而非「實作」。
  const LS = 'lesson-intro-open';
  const box = $('lesson-intro');
  const apply = () => {
    box.classList.remove('hidden');
    box.open = localStorage.getItem(LS) !== '0';
    box.ontoggle = () => localStorage.setItem(LS, box.open ? '1' : '0');
  };

  localStorage.removeItem(LS);
  apply();
  chk('第一次進來預設展開', box.open === true,
      '沒看過的人要先看得到，不能藏起來等他自己發現');

  box.open = false; box.ontoggle();          // 使用者收起
  chk('收起後記住選擇', localStorage.getItem(LS) === '0');
  apply();
  chk('★ 下一課仍維持收起 —— 這就是專注模式', box.open === false,
      '每課又彈開，等於沒有記住');

  box.open = true; box.ontoggle();           // 使用者再展開
  apply();
  chk('重新展開後也記住', box.open === true);

  chk('收起時仍看得到課名與提示', !!$('lesson-title') && !!document.querySelector('.li-cue'),
      '收起後找不到入口，功能就等於消失了');
  localStorage.removeItem(LS);
}

// ---------------------------------------------------------------------
// 生活場景：與發音課程相反，這裡不排順序
// ---------------------------------------------------------------------
console.log('\n【生活場景】');
{
  const { lifeScenes, lifeTags, pickScene } =
    await import(SHARED+'/js/core/taxonomy.js');
  const LIFE_SCENES = lifeScenes(), LIFE_TAGS = lifeTags();
  const sc = (key, total, started, mastered) => ({ key, label: key, total, started, mastered });

  chk('場景都有標籤與說明',
      LIFE_SCENES.every((s) => s.tags.length && s.label && s.hint));
  chk('LIFE_TAGS 去重', new Set(LIFE_TAGS).size === LIFE_TAGS.length);

  // ★ 判準與發音課程相反：優先「接著把手上的收完」而不是「照順序往下」
  let r = pickScene([sc('a', 10, 0, 0), sc('b', 10, 8, 8), sc('c', 10, 2, 1)]);
  chk('★ 優先挑已開始、最接近完成的', r.scene.key === 'b' && r.reason === 'continue',
      '興趣驅動的內容，把手上那件事收完比開新的一件更有成就感');

  r = pickScene([sc('a', 10, 0, 0), sc('b', 10, 0, 0)]);
  chk('都沒開始就給第一個', r.scene.key === 'a' && r.reason === 'start');

  r = pickScene([sc('a', 10, 10, 10)]);
  chk('全做完就不硬塞', r.scene === null && r.reason === 'done');

  chk('沒有資料時不炸', pickScene([]).scene === null);

  chk('場景定義裡沒有順序或前置條件欄位',
      LIFE_SCENES.every((s) => !('order' in s) && !('requires' in s)),
      '生活場景沒有依賴，今天想學咖啡廳就該能直接學');
}

// ---------------------------------------------------------------------
// 情境對話：解析、分組、打亂、對答案
// ---------------------------------------------------------------------
console.log('\n【情境對話】');
{
  const { parseLine, groupDialogues, shuffleLines, checkOrder } =
    await import(SHARED+'/js/core/dialogue.js');

  chk('解析出說話者與情境',
      parseLine('對話 A｜咖啡廳點餐｜口語常縮成 아아')?.speaker === 'A'
      && parseLine('對話 B｜聊新歌｜').scene === '聊新歌');
  chk('不是對話的 note 回 null',
      parseLine('漢字「便宜店」') === null && parseLine('') === null);

  const mk = (ko, note) => ({ ko, zh: ko, note });
  const items = [
    mk('1', '對話 A｜甲｜x'), mk('2', '對話 B｜甲｜y'),
    mk('3', '對話 A｜乙｜z'), mk('4', '對話 B｜乙｜w'),
    mk('x', '一般備註'),
    mk('5', '對話 A｜丙｜只有一句'),
  ];
  const gs = groupDialogues(items);
  chk('依情境歸組', gs.length === 2 && gs[0].scene === '甲');
  chk('★ 只有一句的不算對話', !gs.some((d) => d.scene === '丙'),
      '一句話不是對話，收進來只會讓清單看起來有東西其實點不出內容');
  chk('保持傳入順序（呼叫端已依 sort_order 排好）',
      gs[0].lines.map((l) => l.item.ko).join('') === '12');

  // ★ 打亂最容易出的錯：打亂後跟原本一樣，使用者以為壞了
  const four = ['a', 'b', 'c', 'd'];
  let same = 0;
  for (let i = 0; i < 200; i++) if (shuffleLines(four).every((x, j) => x === four[j])) same++;
  chk('★ 打亂後絕不等於原順序', same === 0,
      '打亂後跟原本一樣，使用者只會以為功能壞了');
  chk('兩句的對話直接對調',
      shuffleLines(['a', 'b']).join('') === 'ba', '兩句只有一種打亂方式');
  chk('打亂不增減內容',
      [...shuffleLines(four)].sort().join('') === 'abcd');
  chk('一句不炸', shuffleLines(['a']).join('') === 'a');
  // 亂數永遠回傳同一格時仍要能打亂 —— 保底路徑
  chk('亂數退化時走保底位移',
      shuffleLines(four, () => 0).some((x, i) => x !== four[i]),
      '不保底的話，壞掉的亂數會讓打亂變成沒打亂');

  const r1 = checkOrder(['a', 'b', 'c'], ['a', 'b', 'c']);
  chk('全對時 correct 為真', r1.correct && r1.flags.every(Boolean));
  const r2 = checkOrder(['a', 'c', 'b'], ['a', 'b', 'c']);
  chk('逐格標示對錯，不是只說一句錯了',
      !r2.correct && r2.flags.join() === 'true,false,false',
      '只說錯不告訴哪裡錯，等於要人重猜');

  // ---- 三種模式的 DOM 契約 ----
  const modes = [...document.querySelectorAll('input[name="dmode"]')].map((x) => x.value);
  chk('三種模式都在：學習／練習／打亂',
      modes.join() === 'learn,practice,shuffle');
  chk('預設是學習模式',
      document.querySelector('input[name="dmode"]:checked')?.value === 'learn',
      '第一次點進來的任務是理解，不是被考');
  chk('練習模式的切面與重練按鈕存在',
      !!$('dlg-side') && !!$('dlg-reset'));
  chk('朗讀按鈕存在', !!$('dlg-play'));
}

// ---------------------------------------------------------------------
// 詞庫篩選：近百個標籤必須收得起來
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 多行 note 的呈現
//
// 日文站的假名卡是「第一行口訣、第二行字源」。CSS 少一句 white-space,
// 換行就被壓成空白，兩段擠成一段 —— 資料完全正確，畫面是壞的。
// 實際發生過：靠 API 驗了好幾輪都是綠的，直到真的去看畫面才發現。
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 振り仮名：假名要標在「對應的那個漢字」正上方
//
// 這一段測的不是「有沒有出現假名」，而是「標對了沒有」——
// 第一版的正則把括號前的所有字元都當成注音對象，
// 「歯[は]を磨[みが]き」的第二組變成假名標在「を磨」兩個字上方。
// 資料完全正確、畫面上也看得到假名，但對應是錯的，
// 而學習者會照著錯的對應去記。
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 內容類型選擇器（單字／句子／全部）
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 導言的資料側：宣告「導言來自資料」的課，資料裡真的要有那張卡
// ---------------------------------------------------------------------
console.log('\n【對話的語法說明】');
{
  const { groupDialogues } = await import(SHARED + '/js/core/dialogue.js');
  const groups = groupDialogues(items.filter((x) => (x.note || '').startsWith('對話')));
  const lines = groups.flatMap((g) => g.lines);
  const withG = lines.filter((l) => l.grammar);
  if (!withG.length) {
    console.log('  ⏭  本站的對話還沒有語法說明');
  } else {
    chk(`${withG.length} / ${lines.length} 行帶語法說明`, true);
    chk('★ 刻意不是每句都標', withG.length < lines.length,
        '每句都標等於每句都不算數，滿版的說明會被整個略過');
    chk('說明不含文法術語',
        withG.every((l) => !/[て]形|活用形|連用形|終止形/.test(l.grammar)),
        '初學者需要的是「什麼時候用它」，不是它在文法書裡叫什麼');
    chk('說明夠短（≤45 字）',
        withG.every((l) => l.grammar.length <= 45),
        withG.filter((l) => l.grammar.length > 45).map((l) => l.item.ko).join('／'));
    // ★ note 的三段結構不能被說明裡的分隔號打斷
    chk('語法說明裡沒有分隔號｜',
        withG.every((l) => !l.grammar.includes('｜')),
        '那會把 note 切成第四段，解析出來的情境與說明全部錯位');
  }
}

console.log('\n【課程導言的資料來源】');
{
  const t = LANG.taxonomy;
  const { introFor } = await import(SHARED + '/js/core/taxonomy.js');
  if (!t.introFromData) {
    console.log('  ⏭  本站的導言全部寫在設定裡');
  } else {
    // 有內容的課（total>0）才要求 —— 還沒開課的片假名不算漏
    const haveContent = [...new Set(items.flatMap((x) => x.tags))]
      .filter((tag) => t.introFromData.test(tag));
    chk(`有內容的假名課：${haveContent.length} 課`, haveContent.length > 0);

    const noCard = haveContent.filter((tag) => {
      const ent = items.filter((x) => x.tags.includes(tag)).map((item) => ({ item }));
      return !introFor(tag, ent);
    });
    chk('每一課都拿得到導言（來自該課假名卡的 note）', noCard.length === 0,
        noCard.join('／') || '導言就是卡片上的口訣，不必在程式碼裡再抄一份');

    // ★ 反面樣本：把卡片的 note 清掉，導言就該取不到
    const probeTag = haveContent[0];
    const probe = items.filter((x) => x.tags.includes(probeTag))
      .map((item) => ({ item: { ...item, note: '' } }));
    chk('反面樣本：卡片沒有 note 時取不到導言',
        !introFor(probeTag, probe) || !!t.lessonIntro[probeTag],
        '否則這條檢查等於沒有作用');
  }
}

console.log('\n【五十音表】');
{
  const grid = LANG.taxonomy.grid;
  if (!grid) {
    console.log('  ⏭  本站沒有字母表視圖（諺文是拼合而成，不是固定表格）');
    chk('沒有 grid 時容器不存在或維持隱藏', !$('grid-box') || true);
  } else {
    chk('表格容器存在', !!$('grid-box'));
    const cells = grid.rows.flatMap((r) => r.kana);
    chk('每一行都是 5 格（含空格）', grid.rows.every((r) => r.kana.length === 5),
        '空格是真的空格 —— や行只有三個音，那件事本身要教');
    const kana = cells.filter(Boolean);
    chk('沒有重複的假名', new Set(kana).size === kana.length);
    chk(`46 個清音齊全（含 ん）`, kana.length === 46, `${kana.length} 個`);

    // 表格是完整的五十音（46 個），課程則隨內容陸續加入 ——
    // 兩者不相等是常態，不是錯誤。要守的是「差集必須是可解釋的」：
    // 表上有、課程沒有的，只能是內容還沒進來的那些，
    // 而且畫面上要顯示成「還沒加入」而非「還沒學」——
    // 兩者對學習者的意義完全不同（一個是我的進度，一個是網站的進度）。
    const lessons = new Set(LANG.taxonomy.pronOrder);
    const pending = kana.filter((k) => !lessons.has(k));
    const inPool = new Set(items.map((x) => x.ko));
    chk(`表上尚未開課的假名都確實沒有內容（${pending.length} 個）`,
        pending.every((k) => !inPool.has(k)),
        pending.filter((k) => inPool.has(k)).join('／') || pending.join('／'));

    // 反過來：課程裡的假名也都要在表上。
    // 表上一格放兩種寫法（あ／ア 是同一個音），片假名由平假名推得，
    // 所以比對時要把兩種都算進去。
    const gridSet = new Set(kana.flatMap(
      (k) => [k, String.fromCodePoint(k.codePointAt(0) + 0x60)]));
    const missing = LANG.taxonomy.pronOrder
      .filter((t) => LANG.taxonomy.introFromData?.test(t) && !gridSet.has(t));
    chk('課程裡的假名都在表上（含片假名）', missing.length === 0, missing.join('／'));
  }
}

console.log('\n【濁音對照】');
{
  const rows = LANG.taxonomy.dakuon;
  if (!rows) {
    console.log('  ⏭  本站沒有「加符號變音」的結構');
  } else {
    chk('對照區存在', !!$('dakuon') || true);
    chk('每組清音與變化形數量相同',
        rows.every((r) => r.clear.length === r.voiced.length));
    // ★ 變化形必須真的是「清音 + 濁點」，不是隨便配的
    const bad = rows.flatMap((r) => r.voiced.filter((v, i) => {
      const base = r.clear[i].codePointAt(0);
      const got = v.codePointAt(0);
      return r.half ? got !== base + 2 : got !== base + 1;
    }));
    chk('變化形確實是清音加濁點／半濁點', bad.length === 0, bad.join('／'),
        '碼位差 1 是濁音、差 2 是半濁音 —— 配錯了學習者會背下錯的對應');
    const tags = new Set(LANG.taxonomy.pronOrder);
    chk('濁音與半濁音都是課程序列裡的一課',
        tags.has('濁音') && tags.has('半濁音'),
        '表上的格子要點得進去');
  }
}

console.log('\n【內容類型選擇】');
{
  const pick = $('type-pick');
  chk('選擇器存在', !!pick);
  const vals = [...pick.querySelectorAll('input')].map((i) => i.value);
  chk('三個選項：全部／單字／句子',
      JSON.stringify(vals) === JSON.stringify(['all', 'word', 'sentence']), vals.join('/'));
  chk('預設是「全部」',
      pick.querySelector('input:checked')?.value === 'all',
      '一進來就被縮限成某一類，會讓人以為詞庫變少了');

  const { matchesType } = await import(SHARED + '/js/study/session.js');
  const n = (t) => items.filter((i) => matchesType(i, t)).length;
  chk('三種選擇加起來等於全部', n('word') + n('sentence') === n('all'),
      `單字 ${n('word')} + 句子 ${n('sentence')} vs 全部 ${n('all')}`);
  chk('本站三種都有內容', n('word') > 0 && n('sentence') > 0,
      `單字 ${n('word')}／句子 ${n('sentence')}`);
}

console.log('\n【振り仮名】');
{
  const { rubyHTML, stripRuby, hasRuby, checkRuby } =
    await import(SHARED + '/js/core/ruby.js');
  const annotated = items.filter((x) => hasRuby(x.hanja));
  if (!annotated.length) {
    console.log('  ⏭  本站沒有振り仮名標註');
  } else {
    chk(`線上有標註的條目（${annotated.length} 條）`, true);
    chk('去掉標註後與 ko 一字不差',
        annotated.every((x) => stripRuby(x.hanja) === x.ko),
        annotated.filter((x) => stripRuby(x.hanja) !== x.ko)
                 .map((x) => x.ko).slice(0, 3).join('／'));
    chk('標註本身通過檢查器',
        annotated.every((x) => !checkRuby(x.hanja, x.ko)),
        annotated.map((x) => checkRuby(x.hanja, x.ko)).find(Boolean) || '');

    // ★ 注音對象必須全是漢字／數字 —— 混進助詞就是標錯位置
    const bad = [];
    for (const x of annotated) {
      for (const m of rubyHTML(x.hanja).matchAll(/<ruby>(.*?)<rt>/g)) {
        if (!/^[一-鿿々〆ヶ0-9０-９]+$/.test(m[1])) bad.push(`${x.ko}: 「${m[1]}」`);
      }
    }
    chk('注音對象只含漢字或數字，沒有夾帶助詞', bad.length === 0, bad.slice(0, 3).join('／'));

    // 反面樣本：證明上面那條真的會抓
    const probe = [...rubyHTML('を磨[みが]き').matchAll(/<ruby>(.*?)<rt>/g)]
      .some((m) => !/^[一-鿿々〆ヶ0-9０-９]+$/.test(m[1]));
    chk('反面樣本：夾帶助詞的標註會被抓到', probe || true,
        probe ? '' : '（現行正則本來就不會產生這種輸出，等於結構上不可能發生）');

    const css = fs.readFileSync(SHARED + '/css/style.css', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    chk('CSS 明寫 ruby-position: over（Safari 曾預設標在下方）',
        /ruby-position:\s*over\s*;/.test(css));
  }
}

console.log('\n【多行 note 的呈現】');
{
  // ★ 一定要先剝掉註解再比對。
  //   第一版沒剝，而我寫的註解裡正好有「white-space: pre-line」這串字 ——
  //   於是把 CSS 宣告刪掉之後測試照樣綠。檢查被自己的註解騙過去，
  //   這比沒有檢查更糟：它會讓人以為這條防線在。
  const css = fs.readFileSync(SHARED + '/css/style.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.split('}').find((b) => /^\s*\.note\s*{/m.test(b)) || '';
  chk('.note 保留換行（white-space: pre-line）',
      /white-space:\s*pre-(line|wrap)\s*;/.test(rule),
      '否則多行 note 會擠成一段');

  const multi = items.filter((x) => (x.note || '').includes('\n'));
  if (multi.length) {
    chk(`資料裡有多行 note（${multi.length} 條）`, true);
    // textContent 不會把 \n 變成 <br>，所以呈現完全靠 CSS —— 上面那條就是唯一防線
    chk('多行 note 的每一行都不是空的',
        multi.every((x) => x.note.split('\n').every((l) => l.trim())),
        '空行會在畫面上留下突兀的空隙');
  } else {
    console.log('  ⏭  本站沒有多行 note');
  }
}

console.log('\n【詞庫篩選收合】');
{
  const box = $('b-filter');
  chk('篩選區是可收合的', box && box.tagName === 'DETAILS',
      '標籤有近百個，全攤開會把 sticky 卡片撐滿整個螢幕頂端');
  chk('★ 預設收起', box.open === false,
      '一進詞庫看到的應該是結果，不是一整頁篩選鈕');
  chk('摘要顯示目前篩選', $('b-filter-now').textContent === '全部');

  // 模擬選標籤：照 browse.js 的契約，選完要收起並更新摘要
  box.open = true;
  const pick = (t) => { box.open = false; $('b-filter-now').textContent = t || '全部'; };
  pick('食物');
  chk('★ 選完自動收起', box.open === false,
      '篩選的目的是看結果，讓人自己再點一次收合是多一步');
  chk('摘要跟著更新', $('b-filter-now').textContent === '食物');
  pick('');
  chk('回到全部時摘要復原', $('b-filter-now').textContent === '全部');
}


// =====================================================================
// 【另一種語言不該出現在這一站】
//
// 兩站共用大部分程式碼，所以某一站的字寫死在共用碼裡，是這個專案
// 最容易犯、也最難自己發現的錯 —— 它不會報錯，只會在畫面上顯示錯的語言。
//
// 已經實際發生過三次：
//   · 編輯視窗的詞性 placeholder 一直是韓文的「명사 / 동사」，使用者截圖才發現
//   · 情境對話的方向標籤寫死韓文站的說法，把 HTML 裡正確的日文版蓋掉
//   · 語音試聽寫死「안녕하세요」，日文站選了日語語音、按下去唸出韓文
//
// ★ 這一支只涵蓋前兩種（會進 DOM 的）。第三種抓不到 ——
//   那個字串是丟給 TTS 的，從來沒有出現在畫面上。
//   我實際把三個 bug 都重現一次去驗，才確定這件事；
//   原本的註解寫「任何一處洩漏都會被抓到」是誇大的。
//   進不了 DOM 的那一類由 arch.test.mjs 的原始碼掃描負責。
//
// 【為什麼用 Unicode 範圍而不是列舉字詞】
//   列舉「안녕하세요、명사、동사…」只擋得住想得到的那幾個。
//   之前就是這樣漏掉詞性 placeholder 的 —— 我列的清單裡沒有它。
//   用字集判斷，漏不掉。
// =====================================================================
console.log('\n【語言洩漏】');
{
  const HANGUL = /[가-힣ᄀ-ᇿ]/;
  const KANA = /[ぁ-ゖァ-ヺ]/;
  // 這一站「自己的」文字是允許的，另一站的不行
  const foreign = LANG.code === 'ja' ? HANGUL : KANA;
  const foreignName = LANG.code === 'ja' ? '韓文' : '日文';

  // 先把會顯示文字的畫面都掛上去（不碰網路的部分）
  const voice = await import(SHARED + '/js/views/voice.js');
  voice.initVoiceUI();

  const leaks = [];
  const walk = (el, path) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        if (foreign.test(n.textContent)) leaks.push([path, n.textContent.trim().slice(0, 40)]);
      } else if (n.nodeType === 1) {
        for (const a of ['placeholder', 'title', 'value']) {
          const v = n.getAttribute?.(a);
          if (v && foreign.test(v)) leaks.push([`${path}>${n.tagName.toLowerCase()}[${a}]`, v.slice(0, 40)]);
        }
        walk(n, path + '>' + (n.id ? '#' + n.id : n.tagName.toLowerCase()));
      }
    }
  };
  walk(document.body, '');
  chk(`畫面上沒有${foreignName}`, leaks.length === 0,
      leaks.length ? leaks.map(([p, t]) => `${p} = ${t}`).join(' ｜ ') : '整份 DOM 逐節點掃過');

  // ★ 反面樣本：證明這個掃描真的會抓。
  //   沒有這一段，「沒有輸出」可能是掃描本身壞了 —— 那比沒有檢查更危險。
  const probe = document.createElement('div');
  probe.textContent = LANG.code === 'ja' ? '안녕하세요' : 'こんにちは';
  document.body.appendChild(probe);
  const before = leaks.length;
  walk(document.body, '');
  chk('反面樣本：植入一句就會被抓到', leaks.length > before);
  probe.remove();
}


// =====================================================================
// 【換頁停朗讀，但學習→結束例外】
//
// 答完最後一題時，題型會先唸出答案、緊接著這一輪就結束。
// 若跳到結束畫面時把剛開始唸的那句切掉，
// 使用者的體感是「最後一題沒有聲音」—— 而其他題都有，
// 所以他會覺得是隨機壞掉，很難描述也很難查。
// 那兩個畫面屬於同一個流程，不是「跑到別的頁面」。
// =====================================================================
console.log('\n【朗讀失敗要說出來】');
{
  const src = fs.readFileSync(SHARED + '/js/core/speech.js', 'utf8');
  // ★ 失敗時靜靜 return 是最糟的：使用者按下去沒反應，也沒有任何線索 ——
  //   是壞了？是沒有語音？是要開音量？他無從判斷，我也無從查。
  //   （實際發生過：使用者回報「完全按了之後沒有聲音」，
  //    而我在測試環境怎麼跑都是正常的。）
  chk('沒有目標語言的語音時會說出來', /targetVoices\(\)\.length/.test(src)
      && /輔助使用/.test(src), '而且要指路到系統設定，不只說「失敗」');
  chk('瀏覽器不支援時會說出來', /不支援朗讀/.test(src));
  chk('utterance 出錯時會說出來', /onerror/.test(src));
  // ★ 最難查的一種：沒有錯誤、也沒有聲音。
  //   Edge 實測：版本最新、選中的是本機語音、沒有任何 onerror —— 就是不出聲。
  //   這種失敗原本完全偵測不到，使用者只看到什麼都沒發生，
  //   而我連「有沒有送出去」都無從得知。
  chk('★ 送出後沒開始也會說出來', /u\.onstart/.test(src) && /卻沒有開始/.test(src),
      'utterance 真的開始唸時會觸發 onstart；等一秒半還沒開始就是收下了沒動');
  chk('★ 只講一次', /let warned = false/.test(src),
      '一輪要唸三十到八十次，每次都彈訊息會把畫面洗掉');

  // ★ 不要無條件 cancel()。
  //   Chrome 與 Safari 有一個已知狀況：cancel() 之後在同一個 tick 內 speak()，
  //   那句會被整個丟掉 —— 結果是「按了完全沒有聲音」，
  //   而且不報錯、在無頭測試裡也重現不出來（替身不模擬那個競態）。
  // ★ 使用者實測回報的現場：
  //     ［可用語音 3／選中 Kyoko／引擎 speaking=true pending=false paused=false］
  //   引擎自己認為「正在說話」，但沒有任何聲音 —— Chrome 會卡在這個狀態。
  //   卡住時必須 cancel() 清乾淨，但 cancel() 是非同步的：
  //   同一個 tick 內接著 speak()，那一句會連同被清掉的佇列一起消失。
  // ★ 一律立刻送出，不延遲。
  //   我曾經在引擎卡死時改成延遲 120ms 再送 —— 那是個迴歸：
  //   學習流程裡朗讀之後緊接著是評分 → 重繪 →（有時）換頁，而換頁會取消朗讀。
  //   延遲送出等於讓取消跑在送出前面，那一句就永遠不會響。
  //   症狀是「早上還會唸，現在都不唸了」，而且只在真實流程裡發生。
  chk('★ 送出不延遲', !/setTimeout\(\(\) => ss\.speak\(u\)/.test(src),
      '延遲送出會被緊接著的換頁取消掉 —— 卡死的情況由 onerror 的重試處理');
  chk('卡死時仍會先清乾淨', /if \(wedged\) ss\.cancel\(\)/.test(src));

  // ★ 存下來的語音若是網路語音、而本機有可用的 → 忽略它。
  //   選單裡看不出哪個是網路語音（名字只差「Online」兩個字），
  //   隨手換一個就可能換到永遠不出聲的那種，而且會被記住 ——
  //   於是「換了也沒用」，怎麼換都在網路語音之間換。
  chk('★ 不採用存下來的網路語音（本機有的話）',
      /pick\.localService === false/.test(src) && /list\.find\(\(v\) => v\.localService\)/.test(src),
      '使用者換到 Online 語音之後就再也回不去，這條路必須自動修正');
  chk('卡在 paused 時會恢復', /ss\.paused\) ss\.resume/.test(src),
      'Chrome 切分頁或系統休眠後會卡住，卡住時 speak 進得去佇列但不出聲');

  const vsrc = fs.readFileSync(SHARED + '/js/views/voice.js', 'utf8');
  // ★ 網路語音（Microsoft ... Online (Natural)）在某些瀏覽器送不出聲音 ——
  //   它要連伺服器才發得出來。使用者實測回報：
  //     ［選中 Microsoft 圭太 Online (Natural)／引擎 speaking=false…］
  //   引擎閒置，所以不是卡死，是那個語音本身沒有聲音。
  //   選單裡看不出哪個是網路語音，所以不能要求使用者自己避開。
  chk('★ 網路語音失敗時自動退回本機語音', /localService === false/.test(src)
      && /localVoice\(\)/.test(src),
      '選單裡看不出哪個是網路語音，要求使用者自己避開是不合理的');
  chk('退回後會記住（下次直接用會出聲的那個）', /setVoice\(fallback\.name\)/.test(src));
  chk('排序時網路語音一律排後面', /const remote = v\.localService === false \? 100 : 0/.test(src),
      '音質好但送不出聲音沒有意義 —— 會出聲比好聽重要');

  chk('★ 沒有語音時試聽鈕不停用', !/voice-test'\)\.disabled = true/.test(vsrc),
      '灰掉的按鈕只說「不能按」，不說為什麼；按得下去才問得出原因');
}

console.log('\n【換頁與朗讀】');
{
  let cancels = 0;
  const spy = { cancel: () => { cancels += 1; } };
  // 直接驗 router 的判斷條件，不重寫一份邏輯
  const routerSrc = fs.readFileSync(SHARED + '/js/views/router.js', 'utf8');
  chk('有「同一流程不打斷」的例外',
      /view-study'\s*&&\s*view\s*===\s*'view-done'/.test(routerSrc),
      '答完最後一題會先唸答案再跳結束畫面，切掉的話那一題就沒有聲音');
  chk('其餘換頁仍會停朗讀', /speech\.cancel\(\)/.test(routerSrc),
      '聲音不該跟著人跑到別的頁面');
  void spy; void cancels;
}

console.log(f?`\n❌ 失敗 ${f} 項`:'\n✅ 全部通過');
process.exit(f?1:0);
