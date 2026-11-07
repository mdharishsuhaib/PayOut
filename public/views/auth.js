// Login and Sign Up, the way PayPal's own pages work: one centred card, PayPal logo on top,
// and the sign-in itself happens on paypal.com (Log in with PayPal). This site never asks for a PayPal password.
import { esc } from '../util.js';

const ERRORS = {
  cancelled: 'You cancelled logging in with PayPal.',
  expired: 'That login took too long or was opened in another tab. Please try again.',
  no_code: 'PayPal did not return a login code. Please try again.',
  not_configured: 'Log in with PayPal is not set up on this server yet.',
  invalid_client: 'PayPal did not accept this app\'s credentials for login. Check that "Log in with PayPal" is enabled for the app.',
};

export async function render(el, app, [mode = 'login', next]) {
  const signup = mode === 'signup';
  const a = app.auth || {};
  const err = new URLSearchParams(location.search).get('auth_error');
  if (err) history.replaceState(null, '', `/${location.hash}`);
  const loginHref = `${a.loginUrl || '/auth/paypal/login'}?tab=1${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  const host = esc(a.paypalHost || 'www.sandbox.paypal.com');

  el.innerHTML = `
    <section class="auth"><div class="auth-card" role="main">
      <img class="auth-logo" src="/paypal-logo.svg" alt="PayPal" width="120" height="34">
      ${err ? `<div class="auth-err" role="alert">${esc(ERRORS[err] || `PayPal login failed: ${err}`)}</div>` : ''}
      ${signup ? `
        <h1>Sign up for PayPal</h1>
        <p class="auth-lead">Create a PayPal business account, then log in with it here to check, send and recover every payout.</p>
        <a class="pill dark wide" href="${esc(a.signupUrl || 'https://www.sandbox.paypal.com/bizsignup/')}" target="_blank" rel="noopener" id="a-signup">Sign Up</a>
        <ol class="auth-steps"><li>Create your account on PayPal.</li><li>Log in with the account you just made.</li></ol>
        <p class="auth-swap">Already have an account? <a href="#/login${next ? `/${esc(next)}` : ''}">Log in</a></p>`
      : `
        <h1>Log in to your account</h1>
        <p class="auth-lead center">Use your PayPal account.</p>
        <a class="pill dark wide" href="${loginHref}" target="_blank" rel="noopener" id="a-login">Login with PayPal</a>`}
      ${a.configured === false ? '<p class="auth-warn">Log in with PayPal needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in the server\'s .env.</p>' : ''}
      ${a.demo !== false ? `<div class="auth-or"><span>or</span></div>
        <button type="button" class="pill ghost wide" id="a-demo">Try the demo</button>` : ''}
      <p class="auth-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"/></svg><span>You sign in on <b>${host}</b></span></p>
    </div>
    <p class="auth-foot">PayOut – A PayPal's Product</p></section>`;
  const demo = el.querySelector('#a-demo');
  demo?.addEventListener('click', async () => {
    demo.disabled = true; demo.textContent = 'Opening the demo…';
    try { await app.startDemo(next); } catch (e) { demo.disabled = false; demo.textContent = 'Try the demo'; app.toast?.(e.message, true); }
  });
  return () => {};
}
