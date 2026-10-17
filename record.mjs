import { chromium } from 'playwright';
import { spawn } from 'child_process';
const FPS = 30;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
await p.goto('file://' + process.cwd() + '/index.html?rec=1', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1000);
const total = await p.evaluate(() => window.__total);
const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', 'silent.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
const n = Math.ceil(total / 1000 * FPS);
for (let k = 0; k < n; k++) {
  await p.evaluate(T => window.__renderAt(T), k * 1000 / FPS);
  const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (k % 300 === 0) console.log('frame', k, '/', n);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await b.close();
