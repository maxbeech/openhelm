/**
 * Builds a data: URI containing a styled instruction page shown when
 * Chrome opens for credential browser-profile setup.
 *
 * Uses the real OpenHelm logo and brand palette so the page feels
 * continuous with the main app.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// OpenHelm logo: boat hull (blue-gray) + sails (orange-red)
const LOGO_SVG = `<svg viewBox="0 0 570 570" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="g0" x1="264" y1="231" x2="264" y2="506.7" gradientUnits="userSpaceOnUse"><stop stop-color="#6B8EAE"/><stop offset="1" stop-color="#96AEC5"/></linearGradient>
  <linearGradient id="g2" x1="285.25" y1="64" x2="285.25" y2="338" gradientUnits="userSpaceOnUse"><stop stop-color="#E53D00"/><stop offset="1" stop-color="#FF6933"/></linearGradient>
</defs>
<path d="M549.5 231L123 439.5C234.5 549.5 397.5 518 465.5 392L549.5 231Z" fill="url(#g0)" fill-opacity="0.9"/>
<path d="M114.5 424L259 353L21 268L114.5 424Z" fill="url(#g0)" fill-opacity="0.9"/>
<path d="M443.5 264.5L290.5 338V233L502.5 109.5L443.5 264.5Z" fill="url(#g2)" fill-opacity="0.9"/>
<path d="M376.5 166L290.5 213.5V130.5L396 73L376.5 166Z" fill="url(#g2)" fill-opacity="0.9"/>
<path d="M272 64V338L68 264.5C97.1647 128.441 143.563 86.522 272 64Z" fill="url(#g2)" fill-opacity="0.9"/>
</svg>`;

export function buildInstructionPageUrl(loginUrl?: string): string {
  const safeUrl = loginUrl ? escapeHtml(loginUrl) : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OpenHelm - Browser Setup</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:#080d14;color:#F8FAFC;min-height:100vh;display:flex;
    align-items:center;justify-content:center;padding:2rem}
  .card{max-width:560px;width:100%;background:#0c1522;border:1px solid #1c3048;
    border-radius:16px;padding:2.5rem;box-shadow:0 25px 50px -12px rgba(0,0,0,.6)}
  .logo{display:flex;align-items:center;gap:.875rem;margin-bottom:1.75rem}
  .logo svg{width:40px;height:40px}
  .logo span{font-size:1.125rem;font-weight:600;color:#F8FAFC;letter-spacing:-.01em}
  h1{font-size:1.5rem;font-weight:700;color:#F8FAFC;margin-bottom:.5rem;letter-spacing:-.02em}
  .subtitle{color:#6B8EAE;font-size:.875rem;margin-bottom:2rem;line-height:1.5}
  .steps{display:flex;flex-direction:column;gap:1.25rem;margin-bottom:2rem}
  .step{display:flex;gap:1rem;align-items:flex-start}
  .num{width:28px;height:28px;border-radius:50%;
    background:linear-gradient(180deg,#E53D00 0%,#FF6933 100%);
    color:#F8FAFC;display:flex;align-items:center;justify-content:center;
    font-size:.8rem;font-weight:700;flex-shrink:0;margin-top:2px;
    box-shadow:0 2px 8px rgba(229,61,0,.3)}
  .step-text h3{font-size:.9375rem;font-weight:600;color:#F8FAFC;margin-bottom:2px}
  .step-text p{font-size:.8125rem;color:#6B8EAE;line-height:1.5}
  .step-text strong{color:#96AEC5}
  .nav-box{background:#080d14;border:1px solid #1c3048;border-radius:10px;
    padding:1rem;margin-bottom:1.5rem}
  .nav-box label{font-size:.6875rem;color:#6B8EAE;display:block;margin-bottom:.5rem;
    text-transform:uppercase;letter-spacing:.08em;font-weight:600}
  .nav-row{display:flex;gap:.5rem}
  .nav-row input{flex:1;padding:.625rem .875rem;background:#0c1522;border:1px solid #1c3048;
    border-radius:8px;color:#F8FAFC;font-size:.875rem;outline:none;
    transition:border-color .15s}
  .nav-row input:focus{border-color:#E53D00}
  .nav-row input::placeholder{color:#3d5875}
  .btn{padding:.625rem 1.25rem;
    background:linear-gradient(180deg,#E53D00 0%,#cc3600 100%);
    color:#F8FAFC;border:none;border-radius:8px;font-size:.875rem;font-weight:600;
    cursor:pointer;transition:filter .15s}
  .btn:hover{filter:brightness(1.1)}
  .tip{background:#14273d;border:1px solid #1c3048;border-radius:10px;
    padding:1rem;display:flex;gap:.75rem;align-items:flex-start}
  .tip-icon{width:20px;height:20px;flex-shrink:0;margin-top:1px;color:#6B8EAE}
  .tip p{font-size:.8125rem;color:#96AEC5;line-height:1.5}
  .tip strong{color:#F8FAFC}
  .kbd{display:inline-block;padding:1px 6px;background:#080d14;border:1px solid #1c3048;
    border-radius:4px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:.75rem;
    color:#F8FAFC}
  a{color:#FF6933;text-decoration:none;font-weight:500}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    ${LOGO_SVG}
    <span>OpenHelm</span>
  </div>
  <h1>Save your login session</h1>
  <p class="subtitle">Log in to your site in this browser. Your session will be saved and reused automatically for future automation runs.</p>

  <div class="steps">
    <div class="step">
      <div class="num">1</div>
      <div class="step-text">
        <h3>Navigate to your site</h3>
        <p>${safeUrl ? `Go to <a href="${safeUrl}">${safeUrl}</a> or use the bar below.` : "Use the address bar below, or Chrome's URL bar above."}</p>
      </div>
    </div>
    <div class="step">
      <div class="num">2</div>
      <div class="step-text">
        <h3>Log in normally</h3>
        <p>Enter your username and password. If Chrome offers to save your password, click <strong>Save</strong>.</p>
      </div>
    </div>
    <div class="step">
      <div class="num">3</div>
      <div class="step-text">
        <h3>Quit Chrome when done</h3>
        <p>Press <span class="kbd">⌘Q</span> to quit Chrome. OpenHelm will detect your saved session automatically.</p>
      </div>
    </div>
  </div>

  <div class="nav-box">
    <label>Quick navigate</label>
    <div class="nav-row">
      <input id="url-input" type="url" placeholder="https://example.com/login" value="${safeUrl}">
      <button class="btn" onclick="var u=document.getElementById('url-input').value;if(u){if(!/^https?:\\/\\//.test(u))u='https://'+u;window.location.href=u}">Go</button>
    </div>
  </div>

  <div class="tip">
    <svg class="tip-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
    <p><strong>Tip:</strong> Your session cookies are saved automatically either way. Saving the password just helps with future auto-fill.</p>
  </div>
</div>
</body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
