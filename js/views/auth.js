// 登入 / 註冊
import { $, msg } from '../core/dom.js';
import * as auth from '../data/auth.js';

let isSignUp = false;

export function initAuth() {
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
