/**
 * Generate a 256x256 PNG icon using Electron's offscreen rendering.
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const helperScript = resolve(__dirname, "_gen-icon-helper.cjs");

writeFileSync(helperScript, `
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 256,
    height: 256,
    webPreferences: { offscreen: true },
  });

  const svgContent = \`
    <html>
    <body style="margin:0;padding:0;width:256px;height:256px">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
      <rect width="256" height="256" rx="40" fill="#1e1b4b"/>
      <rect x="28" y="28" width="200" height="200" rx="28" fill="#451a44"/>
      <text x="128" y="110" text-anchor="middle" font-family="system-ui" font-weight="900" font-size="48" fill="#45b6a8">ERP</text>
      <text x="128" y="160" text-anchor="middle" font-family="system-ui" font-weight="800" font-size="40" fill="white">Next</text>
      <text x="128" y="195" text-anchor="middle" font-family="system-ui" font-weight="700" font-size="24" fill="#45b6a8" letter-spacing="8">LEVEL</text>
    </svg>
    </body>
    </html>
  \`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(svgContent));

  // Wait for render
  await new Promise(r => setTimeout(r, 1000));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const outPath = path.resolve(__dirname, '..', 'build-resources', 'icon.png');
  writeFileSync(outPath, image.toPNG());
  console.log('[generate-icon] PNG saved to', outPath);
  app.quit();
});
`);

try {
  execSync(`npx electron "${helperScript}"`, {
    cwd: root,
    stdio: "inherit",
    timeout: 30000,
  });
} finally {
  try { unlinkSync(helperScript); } catch {}
}
