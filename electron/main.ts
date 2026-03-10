/**
 * ERPNext Level — Electron Main Process
 *
 * Starts the Express backend server, then opens a BrowserWindow
 * pointing to it. The frontend (dist/) is served statically by Express.
 */

import { app, BrowserWindow, shell, dialog } from "electron";
import { join, resolve } from "path";
import { startServer } from "../server/index.js";

// Tell server we're running inside Electron
process.env["ELECTRON"] = "1";

// Determine paths — in packaged app, resources are in asar
const isDev = !app.isPackaged;
// In dev: __dirname is dist-electron/electron/, so go up 2 levels to project root
// In packaged: resources are in asar
const rootDir = isDev
  ? resolve(__dirname, "..", "..")
  : resolve(process.resourcesPath, "app");

// Set dist dir for server to serve the built frontend
process.env["ERPNEXT_LEVEL_DIST"] = join(rootDir, "dist");

let mainWindow: BrowserWindow | null = null;
let serverPort = 3001;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "ERPNext Level",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    console.log("[electron] Starting backend server...");
    console.log("[electron] Dist dir:", process.env["ERPNEXT_LEVEL_DIST"]);
    serverPort = await startServer(0); // port 0 = auto-assign free port
    console.log(`[electron] Backend ready on port ${serverPort}`);
    createWindow();
  } catch (err) {
    console.error("[electron] Failed to start:", err);
    dialog.showErrorBox(
      "ERPNext Level - Fout bij opstarten",
      `Kan de server niet starten:\n\n${err}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
