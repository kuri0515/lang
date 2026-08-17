// 翻卡自評：看題自己回想，按四鍵評估熟練度
export default {
  id: 'flip',
  label: '翻卡自評',
  hint: '看到題目自己回想，再按四鍵評估熟練度。',
  direction: null,          // 兩個方向都能用
  needsPool: false,
  canUse: () => true,
  /** 沒有自訂作答介面 —— 走預設的「顯示答案 → 四鍵評分」 */
  mount: null,
};
