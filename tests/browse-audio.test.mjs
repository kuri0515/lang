// =====================================================================
// 詞庫頁的小喇叭要播真人錄音
//
//     STUB_POOL=tests/fixtures/pool-audio.json node --import ./tests/_cdn-stub.mjs tests/browse-audio.test.mjs
//
// 【它守什麼】
//   列表上的小喇叭是最常按的入口。它原本只傳韓文文字給朗讀，
//   於是有真人錄音的句子在這裡仍是機器唸 —— 學習頁聽得到真人、列表聽不到，
//   而且不報錯，只是聲音不對。
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { SHARED, SITE_DIR, siteReady } from './_site.mjs';

const dom = new JSDOM(fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8'),
  { pretendToBeVisual: true, url: 'https://x.test/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} };
const played = [];
global.Audio = class { constructor(u) { this.u = u; } play() { played.push(this.u); return Promise.resolve(); } };
await siteReady();

let fails = 0;
const chk = (n, c, e = '') => { console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); if (!c) fails++; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const { qsa } = await import(`${SHARED}/js/core/dom.js`);
const browse = await import(`${SHARED}/js/views/browse.js`);
const speech = await import(`${SHARED}/js/core/speech.js`);
const audio = await import(`${SHARED}/js/data/audio.js`);
const { isLongItem } = await import(`${SHARED}/js/core/layout.js`);

// 簽名網址直接放進快取（不打網路）：模擬「開頁時已預先換好」
speech.setAudioSource({ peek: (u) => (u === 'sb:haerin-audio/p01-01.mp3' ? 'https://signed.test/p01-01.mp3?t=1' : null),
                        get: async () => null });

browse.initBrowse({ user: () => null, isAdmin: () => false, onPractice: () => {} });
await browse.render(); await tick();

const btns = qsa('#b-list .b-speak[data-ko]');
chk('有兩個小喇叭', btns.length === 2, `${btns.length}`);
chk('★ 小喇叭帶著條目 id（才查得到 audio_url）', btns.every((b) => !!b.dataset.sayId));
played.length = 0;
btns.find((b) => b.dataset.sayId === 'aud-1').click();
chk('★ 有錄音的句子：小喇叭播真人錄音（簽名網址）', played.length === 1 && played[0] === 'https://signed.test/p01-01.mp3?t=1',
    played.join() || '（沒播音檔：退回了機器朗讀）');
played.length = 0;
btns.find((b) => b.dataset.sayId === 'aud-2').click();
chk('沒有錄音的句子：不播音檔（走機器朗讀）', played.length === 0, played.join());

console.log('\n【中文換行：長條目才換】');
chk('句子是長條目', isLongItem({ item_type: 'sentence', ko: '짧아.' }));
chk('短單字不是', !isLongItem({ item_type: 'word', ko: '고맙습니다' }));
chk('★ 很長的詞組也算（一行放不下中文）', isLongItem({ item_type: 'phrase', ko: '이렇게까지 디테일하게는 계획을' }));
chk('日文注音標記不算進長度', !isLongItem({ item_type: 'word', ko: '駅[えき]' }));
chk('空值不炸', !isLongItem(null) && !isLongItem({}));
const rowsEl = qsa('#b-list .b-row');
chk('★ 詞庫頁：句子那列有 b-long', rowsEl.find((r) => r.dataset.id === 'aud-1')?.classList.contains('b-long') === true);
chk('★ 詞庫頁：單字那列沒有（維持一行）', rowsEl.find((r) => r.dataset.id === 'aud-2')?.classList.contains('b-long') === false);
chk('中文自成一個元素（才能單獨換行）', !!rowsEl[0].querySelector('.b-zh') && !!rowsEl[0].querySelector('.b-sep'));

if (fails) { console.log(`\n❌ ${fails} 項不通過`); process.exit(1); }
console.log('\n✅ 全部通過');
