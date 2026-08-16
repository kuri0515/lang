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

console.log(f?`\n❌ 失敗 ${f} 項`:'\n✅ 全部通過');
process.exit(f?1:0);
