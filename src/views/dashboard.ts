export interface HealthStatus {
  status: string;
  domain: string;
  geminiConfigured: boolean;
  authConfigured: boolean;
  kvConfigured: boolean;
  rateLimiterConfigured: boolean;
  analyticsConfigured: boolean;
}

export function renderDashboardHtml(health: HealthStatus): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mcpx | Autonomous Edge MCP Gateway</title>
  <style>
    :root {
      --bg: #0a0b0e;
      --card-bg: #12141c;
      --border: #202434;
      --border-accent: #00f2ff44;
      --cyan: #00f2ff;
      --emerald: #10b981;
      --rose: #f43f5e;
      --text-main: #e2e8f0;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2.5rem 1rem;
      line-height: 1.5;
    }
    .container { width: 100%; max-width: 820px; }
    header { margin-bottom: 2.5rem; border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0.8rem;
      background: #10b98118;
      border: 1px solid #10b98155;
      color: var(--emerald);
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    .status-dot { width: 8px; height: 8px; background: var(--emerald); border-radius: 50%; box-shadow: 0 0 10px var(--emerald); }
    h1 { font-size: 2.2rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    h1 span { color: var(--cyan); }
    .subtitle { color: var(--text-muted); font-size: 1.05rem; margin-top: 0.5rem; }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.75rem;
      margin-bottom: 2rem;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    }
    .card h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: #fff; }
    
    .input-group { display: flex; gap: 0.75rem; margin-bottom: 1rem; }
    input[type="password"], input[type="text"] {
      flex: 1;
      background: #06070a;
      border: 1px solid var(--border);
      color: var(--cyan);
      font-family: monospace;
      padding: 0.85rem 1.1rem;
      border-radius: 8px;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: var(--cyan); box-shadow: 0 0 8px #00f2ff33; }
    button.btn {
      background: var(--cyan);
      color: #000;
      border: none;
      padding: 0.85rem 1.4rem;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    button.btn:hover { opacity: 0.9; transform: translateY(-1px); }
    button.btn:active { transform: translateY(0); }
    
    #key-result {
      display: none;
      margin-top: 1.25rem;
      padding: 1.25rem;
      background: #090b10;
      border: 1px solid var(--border-accent);
      border-radius: 8px;
    }
    .metric-row { display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid #161a26; }
    .metric-row:last-child { border-bottom: none; }
    .metric-val { font-family: monospace; font-weight: 600; color: #fff; }
    .metric-val.balance { color: var(--emerald); font-size: 1.15rem; }
    
    .topup-tier-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-top: 1.25rem; }
    .topup-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1rem 0.5rem;
      background: #161a26;
      border: 1px solid var(--border);
      color: #fff;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      transition: all 0.2s;
    }
    .topup-btn:hover {
      border-color: var(--cyan);
      background: #1c2233;
      transform: translateY(-2px);
    }
    .topup-btn span.amount { font-size: 1.2rem; color: var(--cyan); }
    .topup-btn span.credits { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem; }
    
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.95rem; }
    th, td { text-align: left; padding: 0.75rem 0.5rem; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; }
    td.cost { font-family: monospace; font-weight: 600; color: var(--cyan); }
    
    footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      width: 100%;
      border-top: 1px solid var(--border);
      padding-top: 1.5rem;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .footer-left strong {
      color: var(--text-main);
    }
    .footer-legal {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .footer-legal a {
      color: var(--cyan);
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .footer-legal a:hover {
      text-decoration: underline;
      opacity: 0.9;
    }
    .footer-legal .dot {
      color: var(--border);
      user-select: none;
    }
    .footer-legal .support-link {
      display: inline-flex;
      align-items: center;
      color: var(--text-muted);
    }
    .footer-legal .support-link:hover {
      color: var(--cyan);
    }
    .error-msg { color: var(--rose); font-size: 0.9rem; margin-top: 0.5rem; display: none; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="badge"><span class="status-dot"></span> Edge V8 Mesh Active</div>
      <h1><span>mcpx</span> gateway</h1>
      <p class="subtitle">Deterministic Model Context Protocol Edge Gateway with native x402 machine billing.</p>
    </header>

    <div class="card">
      <h2>Verify API Key Balance</h2>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem;">Enter your bearer key to check available credit balance or instantly top up via Creem.io.</p>
      
      <div class="input-group">
        <input type="password" id="api-key" placeholder="mcpx_live_..." autocomplete="off">
        <button class="btn" id="check-btn" onclick="checkBalance()">Verify</button>
      </div>
      <div id="error-msg" class="error-msg"></div>

      <div id="key-result">
        <div class="metric-row">
          <span style="color: var(--text-muted);">Key ID / Tenant:</span>
          <span class="metric-val" id="res-key-id">-</span>
        </div>
        <div class="metric-row">
          <span style="color: var(--text-muted);">Available Balance:</span>
          <span class="metric-val balance" id="res-balance">0 c</span>
        </div>
        <div class="metric-row">
          <span style="color: var(--text-muted);">Total Settled:</span>
          <span class="metric-val" id="res-spent">0 c</span>
        </div>

        <div style="margin-top: 1.5rem; border-top: 1px solid var(--border); padding-top: 1rem;">
          <p style="font-size: 0.9rem; font-weight: 600; color: #fff;">Instant Credit Top-Up (Creem.io Webhook):</p>
          <div class="topup-tier-grid">
            <a href="#" id="topup-10" target="_blank" class="topup-btn">
              <span class="amount">$10</span>
              <span class="credits">1,000 credits</span>
            </a>
            <a href="#" id="topup-25" target="_blank" class="topup-btn">
              <span class="amount">$25</span>
              <span class="credits">2,500 credits</span>
            </a>
            <a href="#" id="topup-50" target="_blank" class="topup-btn">
              <span class="amount">$50</span>
              <span class="credits">5,000 credits</span>
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>x402 Pricing Matrix</h2>
      <table>
        <thead>
          <tr>
            <th>Tool Type / Operation</th>
            <th>Rate</th>
            <th>Ladder of Trust</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>tools/list, initialize, /llms.txt</td>
            <td class="cost">Free ($0.00)</td>
            <td style="color: var(--emerald);">Discovery Free Tier</td>
          </tr>
          <tr>
            <td>Lightweight analysis (read/metadata)</td>
            <td class="cost">$0.01 (1 credit)</td>
            <td>Agent Work Session</td>
          </tr>
          <tr>
            <td>Deep syntax parsing & calculations</td>
            <td class="cost">$0.02 (2 credits)</td>
            <td>Multi-file Execution</td>
          </tr>
          <tr>
            <td>Edge code generation & sandbox execution</td>
            <td class="cost">$0.05 (5 credits)</td>
            <td>Full Synthesis Cycle</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer>
      <div class="footer-left">
        Domain: <strong>${health.domain}</strong> (Cloudflare Edge)
      </div>
      <div class="footer-legal">
        <a href="https://harrykrauze.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        <span class="dot">·</span>
        <a href="https://harrykrauze.com/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
        <span class="dot">·</span>
        <a href="mailto:support@harrykrauze.com" class="support-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>Support: support@harrykrauze.com
        </a>
      </div>
    </footer>
  </div>

  <script>
    async function checkBalance() {
      const keyInput = document.getElementById('api-key');
      const errBox = document.getElementById('error-msg');
      const resBox = document.getElementById('key-result');
      const btn = document.getElementById('check-btn');
      const key = keyInput.value.trim();

      errBox.style.display = 'none';
      if (!key) {
        errBox.innerText = 'Please enter your API key.';
        errBox.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Verifying...';

      try {
        const res = await fetch('/keys/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to verify API key');
        }

        document.getElementById('res-key-id').innerText = data.keyId;
        document.getElementById('res-balance').innerText = '$' + (data.balanceCents / 100).toFixed(2) + ' (' + data.balanceCents.toLocaleString() + ' credits)';
        document.getElementById('res-spent').innerText = '$' + (data.totalSpentCents / 100).toFixed(2) + ' (' + data.totalSpentCents.toLocaleString() + ' credits)';
        
        const baseCheckout = 'https://www.creem.io/payment/prod_mcpx_topup';
        document.getElementById('topup-10').href = baseCheckout + '?amount=1000&currency=USD&custom_fields[key_id]=' + encodeURIComponent(data.keyId);
        document.getElementById('topup-25').href = baseCheckout + '?amount=2500&currency=USD&custom_fields[key_id]=' + encodeURIComponent(data.keyId);
        document.getElementById('topup-50').href = baseCheckout + '?amount=5000&currency=USD&custom_fields[key_id]=' + encodeURIComponent(data.keyId);

        resBox.style.display = 'block';
      } catch (err) {
        errBox.innerText = err.message;
        errBox.style.display = 'block';
        resBox.style.display = 'none';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Verify';
      }
    }
  </script>
</body>
</html>`;
}
