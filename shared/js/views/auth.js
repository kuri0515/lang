// 登入 / 註冊
import { $, msg } from '../core/dom.js';
import * as auth from '../data/auth.js';

let isSignUp = false;

export function initAuth() {
  // 忘記密碼：寄重置信到帳號綁定的信箱。
  //
  // 【為什麼不管信箱存不存在都說同一句話】
  //   回「查無此帳號」等於讓任何人可以用這個表單一個一個試，
  //   問出誰註冊過。這一站的帳號就是暱稱，猜中的成本很低。
  //   所以一律回「若這個帳號存在，信已寄出」——
  //   對真的使用者沒有差別，對試探的人沒有資訊。
  $('btn-forgot').onclick = async () => {
    const who = $('f-email').value.trim();
    if (!who) return msg('先填上帳號，我才知道要寄給誰');
    try {
      await auth.resetPassword(who);
    } catch { /* 見上：成功與否都給同一個回覆 */ }
    msg('若這個帳號存在，重設信已寄出，請查收信箱', 'ok');
  };

  $('btn-toggle').onclick = () => {
    isSignUp = !isSignUp;
    $('auth-title').textContent = isSignUp ? '註冊' : '登入';
    $('btn-submit').textContent = isSignUp ? '註冊' : '登入';
    $('btn-toggle').textContent = isSignUp ? '已有帳號？登入' : '還沒有帳號？註冊';
    $('row-name').classList.toggle('hidden', !isSignUp);
  };

  $('btn-submit').onclick = async () => {
    const username = $('f-email').value.trim();
    const pass = $('f-pass').value;
    if (!username || !pass) return msg('請填寫帳號名與密碼');
    $('btn-submit').disabled = true;
    try {
      const { data, error } = isSignUp
        ? await auth.signUp(username, pass, $('f-name').value.trim())
        : await auth.signIn(username, pass);
      if (error) throw error;
      if (isSignUp && !data.session) msg('註冊成功，現在可以直接登入。', 'ok');
    } catch (e) {
      msg(e.message || String(e));
    } finally {
      $('btn-submit').disabled = false;
    }
  };

  $('btn-signout').onclick = () => auth.signOut();
}
