const { app, BrowserWindow } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')

const width = 1600
const minimumHeight = 1200
const maximumHeight = 1500
const rendererPath = path.join(__dirname, '..', 'dist-renderer', 'index.html')
const outputPath = path.join(__dirname, '..', '..', 'docs', 'assets', 'agent-board-public-demo.png')

app.commandLine.appendSwitch('force-device-scale-factor', '1')

async function capture() {
  const window = new BrowserWindow({
    width,
    height: minimumHeight,
    show: false,
    frame: false,
    backgroundColor: '#d7d6d0',
    webPreferences: {
      preload: path.join(__dirname, 'public-demo-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  await window.loadFile(rendererPath, { query: { documentationFixture: 'public' } })
  await window.webContents.insertCSS('* { animation: none !important; transition: none !important; caret-color: transparent !important; }')
  const fixtureEvidence = await window.webContents.executeJavaScript(`
    (async () => {
      await document.fonts.ready;
      const banner = document.createElement('aside');
      banner.setAttribute('aria-label', 'Synthetic documentation fixture notice');
      banner.style.cssText = 'min-height:44px;padding:10px 24px;display:flex;align-items:center;justify-content:center;gap:12px;background:#17191c;color:#f1f0eb;font:700 11px/1.35 "SF Mono",monospace;letter-spacing:.05em;text-align:center';
      banner.innerHTML = '<strong style="color:#8fa3ff">SYNTHETIC DOCUMENTATION VIEW</strong><span>No live sessions, personal paths, device writes, RGB, or Fleet authority.</span>';
      document.body.prepend(banner);
      const visibleText = document.body.innerText;
      const requiredText = ['BLACK-CAP LEGEND', 'Ready to review', 'Available', 'Screen is authoritative now', 'USB absent', 'OBSERVER UNAVAILABLE'];
      return {
        contentHeight: Math.ceil(document.documentElement.scrollHeight),
        slotCount: document.querySelectorAll('.attention-slot').length,
        hasRequiredText: requiredText.every((label) => visibleText.includes(label)),
        hasPrivatePath: /\\/Users\\/|[A-Z]:\\\\Users\\\\/i.test(visibleText),
      };
    })()
  `)

  if (fixtureEvidence.slotCount !== 6 || !fixtureEvidence.hasRequiredText || fixtureEvidence.hasPrivatePath) {
    throw new Error(`Public fixture validation failed: ${JSON.stringify(fixtureEvidence)}`)
  }

  window.setContentSize(width, Math.max(minimumHeight, Math.min(maximumHeight, fixtureEvidence.contentHeight)))
  await new Promise((resolve) => setTimeout(resolve, 250))
  const image = await window.webContents.capturePage()
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, image.toPNG())
  window.destroy()
  return { outputPath, width: image.getSize().width, height: image.getSize().height }
}

app.whenReady().then(async () => {
  try {
    const result = await capture()
    console.log(JSON.stringify(result))
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
