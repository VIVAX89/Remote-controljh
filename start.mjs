import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT   = parseInt(process.env.PORT || '3000', 10);
const SERVER = path.join(__dirname, 'remote-desktop-relay', 'server', 'index.mjs');

// ─── Helpers ────────────────────────────────────────────────────────────────

function banner(lines) {
  const width = 52;
  const top    = '  ╔' + '═'.repeat(width) + '╗';
  const bottom = '  ╚' + '═'.repeat(width) + '╝';
  console.log(top);
  for (const line of lines) {
    const padded = line.padEnd(width);
    console.log(`  ║ ${padded} ║`);
  }
  console.log(bottom);
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === 'win32'  ? `start "" "${url}"` :
    platform === 'darwin' ? `open "${url}"` :
                            `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log(`  [Browser] Could not open automatically. Visit: ${url}`);
  });
}

// Poll the server health endpoint until it responds
async function waitForServer(port, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/healthz`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(800, () => { req.destroy(); resolve(false); });
    });
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// ─── Ngrok ──────────────────────────────────────────────────────────────────

async function startNgrok(port) {
  const token = process.env.NGROK_AUTHTOKEN;

  if (!token || token === 'YOUR_NGROK_AUTH_TOKEN_HERE' || token.trim() === '') {
    console.log('');
    console.log('  [Ngrok] No auth token found — tunnel skipped.');
    console.log('  [Ngrok] Get a free token → https://dashboard.ngrok.com/signup');
    console.log('  [Ngrok] Then set NGROK_AUTHTOKEN in setup.bat or your environment.');
    console.log('');
    return null;
  }

  try {
    const ngrokMod = await import('@ngrok/ngrok');
    const ngrok    = ngrokMod.default ?? ngrokMod;

    console.log('  [Ngrok] Connecting tunnel...');

    const listener = await ngrok.connect({ addr: port, authtoken: token });
    const url      = listener.url();

    console.log('');
    banner([
      '  ✓  REMOTE DESKTOP IS LIVE!',
      '',
      '  Share this link with anyone:',
      `  ${url}`,
      '',
      '  Host tab  → Share your screen',
      '  Viewer tab → Enter the Host ID to connect',
    ]);
    console.log('');

    return { listener, url };
  } catch (err) {
    console.error('  [Ngrok] Error:', err.message);
    return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('  ============================================================');
  console.log('    Remote Desktop Relay  —  Starting up');
  console.log('  ============================================================');
  console.log('');

  // ── 1. Spawn the bundled server ──────────────────────────────────────────
  const proc = spawn('node', [SERVER], {
    env:   { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });

  proc.stdout.on('data', (d) => process.stdout.write(d));
  proc.stderr.on('data', (d) => process.stderr.write(d));

  proc.on('error', (err) => {
    console.error('\n  [Server] Failed to start:', err.message);
    process.exit(1);
  });

  proc.on('exit', (code) => {
    if (code != null && code !== 0) {
      console.error(`\n  [Server] Exited with code ${code}`);
      process.exit(code);
    }
  });

  // ── 2. Wait for server to be ready ───────────────────────────────────────
  console.log(`  [Server] Waiting for port ${PORT}...`);
  const ready = await waitForServer(PORT);
  if (!ready) {
    console.error(`  [Server] Did not become ready in time. Check logs above.`);
    proc.kill();
    process.exit(1);
  }
  console.log(`  [Server] Ready on port ${PORT}`);

  // ── 3. Show local / Replit URL ───────────────────────────────────────────
  const replDomain = process.env.REPLIT_DEV_DOMAIN;
  let localUrl;

  if (replDomain) {
    localUrl = `https://${replDomain}`;
    console.log('');
    banner([
      '  Running on Replit',
      `  ${localUrl}`,
    ]);
    console.log('');
  } else {
    localUrl = `http://localhost:${PORT}`;
    console.log(`  [Server] Local → ${localUrl}`);
  }

  // ── 4. Start ngrok ───────────────────────────────────────────────────────
  const tunnel = await startNgrok(PORT);
  const publicUrl = tunnel ? tunnel.url : localUrl;

  // ── 5. Open browser ──────────────────────────────────────────────────────
  if (!replDomain) {
    openBrowser(publicUrl);
  }

  // ── 6. Keep alive ────────────────────────────────────────────────────────
  console.log('  Press Ctrl+C to stop.\n');

  const shutdown = () => {
    console.log('\n  [App] Shutting down...');
    proc.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
