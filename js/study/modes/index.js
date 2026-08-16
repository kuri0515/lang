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

export const MODES = [flip, choice, scramble, listen];
export const MODE_MAP = Object.fromEntries(MODES.map((m) => [m.id, m]));

export const getMode = (id) => MODE_MAP[id] || flip;

/** 題型是否綁定了固定方向（綁定時方向選擇器應鎖住） */
export const forcedDirection = (id) => getMode(id).direction;

/** 本題型是否需要干擾項池 */
export const needsPool = (id) => !!getMode(id).needsPool;
