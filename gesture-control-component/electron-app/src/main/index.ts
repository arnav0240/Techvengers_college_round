import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { createConnection } from 'net'
import { get } from 'http'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// ---------------------------------------------------------------------------
// Pyauto_cmds backend: auto-start daemon.sh (sudo ydotoold) + run.sh
// (pyautogui_server.py :8765) alongside Electron. Killed on quit.
// ---------------------------------------------------------------------------

const SERVER_PORT = 8765

function resolvePyautoDir(): string {
  if (process.env.PYAUTO_DIR && existsSync(process.env.PYAUTO_DIR)) {
    return process.env.PYAUTO_DIR
  }
  const candidates = [
    // dev: <repo>/electron-app -> <repo>/../Pyauto_cmds == Hackathon/Pyauto_cmds
    resolve(app.getAppPath(), '../../Pyauto_cmds'),
    resolve(__dirname, '../../Pyauto_cmds'),
    resolve(__dirname, '../../../Pyauto_cmds'),
    resolve(__dirname, '../../../../Pyauto_cmds'),
    '/home/halfy/Desktop/everything/Hackathon/Pyauto_cmds'
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'run.sh')) && existsSync(join(c, 'daemon.sh'))) return c
  }
  return candidates[0]
}

let daemonProc: ChildProcess | null = null
let serverProc: ChildProcess | null = null

function spawnLogged(
  cmd: string,
  args: string[],
  cwd: string,
  tag: string
): ChildProcess {
  const child = spawn(cmd, args, { cwd, env: { ...process.env } })
  child.stdout?.on('data', (d) => console.log(`[${tag}] ${String(d).trimEnd()}`))
  child.stderr?.on('data', (d) => console.warn(`[${tag}:err] ${String(d).trimEnd()}`))
  child.on('exit', (code, sig) => console.log(`[${tag}] exited code=${code} sig=${sig}`))
  child.on('error', (e) => console.error(`[${tag}] spawn error:`, e))
  return child
}

function daemonSocketPath(pyautoDir: string): string {
  return process.env.YDOTOOL_SOCKET || join(pyautoDir, '.ydotool_socket')
}

/** True only when a live ydotoold answers — a stale socket file doesn't count. */
function isDaemonAlive(sock: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(sock)) return resolve(false)
    const conn = createConnection(sock)
    let settled = false
    const done = (v: boolean): void => {
      if (settled) return
      settled = true
      try {
        conn.destroy()
      } catch {
        // ignore
      }
      resolve(v)
    }
    conn.on('connect', () => done(true))
    conn.on('error', () => done(false))
    setTimeout(() => done(false), 1500)
  })
}

function whichBin(name: string): string | null {
  try {
    const r = spawnSync('which', [name], { encoding: 'utf8' })
    const p = (r.stdout ?? '').trim()
    return p || null
  } catch {
    return null
  }
}

async function startDaemon(pyautoDir: string): Promise<void> {
  if (daemonProc && !daemonProc.killed) return
  const sock = daemonSocketPath(pyautoDir)
  if (await isDaemonAlive(sock)) {
    console.log(`[backend] ydotoold already answering on ${sock} — reusing it`)
    return
  }
  // Stale socket file (daemon died): a fresh root daemon replaces it.
  // (If owned by root we can't unlink — the pkexec daemon handles bind.)
  if (existsSync(sock)) {
    try {
      unlinkSync(sock)
      console.log(`[backend] removed stale daemon socket ${sock}`)
    } catch (e) {
      console.warn(`[backend] stale socket ${sock} not removable (root-owned?):`, e)
    }
  }
  // ydotoold needs root (/dev/uinput). pkexec raises the desktop password
  // dialog — approve once and Electron manages the daemon by itself.
  const pkexec = whichBin('pkexec')
  const ydotoold = whichBin('ydotoold')
  if (pkexec && ydotoold) {
    console.log('[backend] launching ydotoold via pkexec (approve the password prompt)…')
    daemonProc = spawnLogged(pkexec, [ydotoold, '-p', sock, '-P', '0666'], pyautoDir, 'daemon')
  } else {
    console.warn(
      '[backend] pkexec/ydotoold missing (need: sudo apt install ydotool) — falling back to daemon.sh'
    )
    daemonProc = spawnLogged('bash', [join(pyautoDir, 'daemon.sh')], pyautoDir, 'daemon')
  }
  // Confirm it actually came up (prompt approved, socket bound).
  setTimeout(() => {
    void (async () => {
      if (await isDaemonAlive(sock)) {
        console.log(`[backend] ydotoold is up on ${sock}`)
      } else {
        console.warn(
          '[backend] ydotoold did not come up — was the password prompt approved? See daemon output above.'
        )
      }
    })()
  }, 4000)
}

async function startServer(pyautoDir: string, force = false): Promise<void> {
  if (serverProc && !serverProc.killed) return
  if (!force) {
    // A previous run (or a manual ./run.sh) may still own :8765 —
    // reuse it instead of spawning into EADDRINUSE.
    const health = await checkHealth()
    if (health.ok) {
      console.log(
        `[backend] :8765 already serving (backend=${health.backend ?? '?'}) — reusing it, not spawning run.sh`
      )
      return
    }
  }
  serverProc = spawnLogged('bash', [join(pyautoDir, 'run.sh')], pyautoDir, 'pyserver')
}

function stopBackends(): void {
  // The py server is user-owned: always stop it (respawns prompt-free).
  // The root daemon is deliberately LEFT running: relaunching it costs a
  // sudo password prompt, so it persists across app sessions and the next
  // launch reuses it via the socket check — prompt only when actually
  // needed (first run, reboot, or dead daemon).
  try {
    serverProc?.kill('SIGTERM')
  } catch (e) {
    console.warn('[backend] failed to kill pyserver:', e)
  }
  serverProc = null
  daemonProc = null // drop the handle; the root daemon keeps serving
}

function checkHealth(): Promise<{ ok: boolean; backend?: string; error?: string }> {
  return new Promise((resolvePromise) => {
    const req = get(
      { host: '127.0.0.1', port: SERVER_PORT, path: '/health', timeout: 2000 },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            resolvePromise({ ok: !!json.ok, backend: json.backend })
          } catch {
            resolvePromise({ ok: false, error: 'bad-json' })
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolvePromise({ ok: false, error: 'timeout' })
    })
    req.on('error', (e) => resolvePromise({ ok: false, error: e.message }))
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // Dev only: surface renderer console (MediaPipe load errors, etc.)
    if (is.dev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Backend lifecycle IPC for the renderer (status pill, restart button).
  const pyautoDir = resolvePyautoDir()
  console.log(`[backend] Pyauto_cmds dir: ${pyautoDir}`)
  startDaemon(pyautoDir).catch((e) => console.error('[backend] daemon start failed:', e))
  void startServer(pyautoDir)

  ipcMain.handle('backend:status', async () => {
    const health = await checkHealth()
    return {
      pyautoDir,
      daemonRunning: !!daemonProc && !daemonProc.killed,
      serverRunning: !!serverProc && !serverProc.killed,
      health
    }
  })
  ipcMain.handle('backend:restart', async () => {
    try {
      serverProc?.kill('SIGTERM')
    } catch {
      // ignore
    }
    serverProc = null
    await startServer(pyautoDir, true)
    return { ok: true }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  stopBackends()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBackends()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
