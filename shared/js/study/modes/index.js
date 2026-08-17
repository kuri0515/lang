// =====================================================================
// 題型註冊表
//
// 【解決什麼】
//   重構前 render() 裡是一串 if (mode==='scramble') ... else if (mode==='listen')...，
//   每加一種題型就要改 render()、改鍵盤處理、改方向鎖定、改佇列過濾 —— 四處。
//
//   現在題型是可插拔的殼：宣告自己的 id / 方向約束 / 適用條件 / 掛載邏輯，
//   註冊進來就能用。加題型 = 新增一個檔案 + 這裡加一行，不動任何既有程式碼。
// =====================================================================
import flip from './flip.js';
import choice from './choice.js';
import scramble from './scramble.js';
import listen from './listen.js';
import { lang } from '../../core/lang.js';

const ALL = [flip, choice, scramble, listen];

/**
 * 有些題型對某個語言就是不成立，不是資料不足。
 *
 * 【實例：詞序重組之於日文】
 *   它靠空格切詞塊，而日文不用空格分詞 ——
 *   實測 301 條裡只有 1 條有素材（韓文站是 96/169）。
 *   留著它不會報錯，只會讓學生點進一個永遠沒題目的模式，
 *   然後以為是自己的詞庫有問題。
 *
 * 【為什麼是排除清單而不是啟用清單】
 *   啟用清單意味著每加一個題型都要回頭去每一站補一行，
 *   漏了就是新題型默默不見。排除清單的預設是「都能用」，
 *   要關掉才需要明講 —— 沉默的後果是多一個選項，不是少一個功能。
 */
export const MODES = ALL.filter((m) => !(lang().disabledModes || []).includes(m.id));
export const MODE_MAP = Object.fromEntries(MODES.map((m) => [m.id, m]));

export const getMode = (id) => MODE_MAP[id] || flip;   // 含「被本站關掉的題型」→ 退回翻卡

/** 題型是否綁定了固定方向（綁定時方向選擇器應鎖住） */
export const forcedDirection = (id) => getMode(id).direction;

/** 本題型是否需要干擾項池 */
export const needsPool = (id) => !!getMode(id).needsPool;
