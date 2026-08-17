// =====================================================================
// 端到端 DOM 測試：載入真實 index.html，把 views / study 模組實際掛上去跑
//
// 需要 jsdom（非本專案執行期依賴，僅測試用）：
//     npm i -D jsdom && node tests/dom.test.mjs <pool.json>
// pool.json 可從 Supabase 匯出：items 的 select=* 結果
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'fs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const dom=new JSDOM(fs.readFileSync(ROOT+'/index.html','utf8'),{pretendToBeVisual:true, url:'https://x.test/'});
global.window=dom.window; global.document=dom.window.document;
global.localStorage=dom.window.localStorage; global.getComputedStyle=dom.window.getComputedStyle;
global.confirm=()=>true; global.prompt=()=>null;

let f=0; const chk=(n,c,e='')=>{console.log(`  ${c?'✅':'❌'} ${n}${e?' — '+e:''}`); if(!c)f++;};

// 真實模組（不碰網路的那些）
const { show, initTabs, onEnter, viewFromHash } = await import(ROOT+'/js/views/router.js');
const { initTheme, applyTheme } = await import(ROOT+'/js/views/theme.js');
const { createSession } = await import(ROOT+'/js/study/session.js');
const { RATING } = await import(ROOT+'/js/core/srs.js');
const { getMode } = await import(ROOT+'/js/study/modes/index.js');
const { $, esc, skeleton, emptyState, msg } = await import(ROOT+'/js/core/dom.js');
const { on, emit, EVENTS } = await import(ROOT+'/js/core/bus.js');

console.log('【router】');
initTabs();
const views=['view-auth','view-home','view-study','view-done','view-browse','view-history','view-me','view-import'];
for (const v of views){ await show(v);
  const vis=views.filter(x=>!$(x).classList.contains('hidden'));
  if(vis.length!==1||vis[0]!==v){chk('切到 '+v,false,'可見='+vis); }
}
chk('八個視圖切換皆正確', true);
await show('view-study'); chk('學習中隱藏 Tabbar', $('tabbar').classList.contains('hidden'));
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

// ---------------------------------------------------------------------
// 標籤分類：發音組必須依教學順序，不能被數量排序帶跑
// ---------------------------------------------------------------------
console.log('\n【標籤分類】');
const { groupTags, PRON_ORDER } = await import(ROOT+'/js/core/taxonomy.js');
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
  const { nextLesson, LESSON_DONE } = await import(ROOT+'/js/core/taxonomy.js');
  const r = (tag, total, mastered) => ({ tag, total, mastered, started: mastered });

  // 第一課碰過但沒掌握 → 下一課仍是它，不能往前跳
  let g = nextLesson([r('收音ㄱ',4,1), r('收音ㄴ',4,0)]);
  chk('★ 碰過但沒掌握牢，下一課仍是同一課', g.next.tag==='收音ㄱ',
      '判準是「還沒掌握牢」而非「還沒碰過」——發音夾生，後面的音變規則全聽不懂');

  // 達標就前進
  g = nextLesson([r('收音ㄱ',4,4), r('收音ㄴ',4,0)]);
  chk('達標後前進到下一課', g.next.tag==='收音ㄴ' && g.done===1);

  // 門檻 80%：4 條掌握 3 條（75%）不算過
  g = nextLesson([r('收音ㄱ',4,3), r('收音ㄴ',4,0)]);
  chk('75% 未達 80% 門檻，仍停在該課', g.next.tag==='收音ㄱ');
  g = nextLesson([r('收音ㄱ',5,4), r('收音ㄴ',4,0)]);
  chk('80% 剛好達標，可以前進', g.next.tag==='收音ㄴ',
      '要求 100% 會讓人為了一兩條特別難的卡在原地出不去');

  // 全部達標
  g = nextLesson([r('收音ㄱ',4,4), r('收音ㄴ',4,4)]);
  chk('全部達標時 next 為 null，不硬塞下一件事', g.next===null && g.done===2);

  // 順序照教學序列，不照傳入順序
  g = nextLesson([r('激音化',4,0), r('收音ㄱ',4,0)]);
  chk('照教學序列判斷，不照傳入順序', g.next.tag==='收音ㄱ');

  // 空資料不炸
  chk('沒有資料時不炸', nextLesson([]).next===null && nextLesson([]).total===0);
  chk('門檻是 0.8', LESSON_DONE===0.8);
}

// ---------------------------------------------------------------------
// 課程導言：開課時出現，離開這一課時必須清掉
// ---------------------------------------------------------------------
console.log('\n【課程導言】');
{
  // 不 import study.js —— 它會連帶載入 supabase-js（CDN 網址），Node 無法解析。
  // 這裡驗資料完整性，「每輪必重設」的不變量在 arch 測試用原始碼層檢查。
  const { LESSON_INTRO, PRON_ORDER } = await import(ROOT+'/js/core/taxonomy.js');

  chk('每一課都有導言', PRON_ORDER.every((t) => LESSON_INTRO[t]),
      '路徑解決「學什麼」，導言解決「為什麼」，缺一課就斷一節');
  chk('沒有多餘導言（課程刪掉時要記得跟著刪）',
      Object.keys(LESSON_INTRO).every((t) => PRON_ORDER.includes(t)));
  chk('導言夠短', Object.values(LESSON_INTRO).every((v) => v.length <= 80),
      '學習者是按下「開始」之後才看到，長了直接跳過');
  chk('導言都給了具體例子',
      Object.values(LESSON_INTRO).every((v) => /[가-힣]/.test(v)),
      '只講規則不給實例，等於還是要學習者自己想像');
  chk('導言的 DOM 錨點存在',
      !!$('lesson-intro') && !!$('lesson-title') && !!$('lesson-body'));

  // ---- 收尾話 ----
  const { lessonOutro } = await import(ROOT+'/js/core/taxonomy.js');
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

console.log(f?`\n❌ 失敗 ${f} 項`:'\n✅ 全部通過');
process.exit(f?1:0);
