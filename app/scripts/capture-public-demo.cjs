const { app, BrowserWindow, nativeImage } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')

const width = 1600
const minimumHeight = 1200
const maximumHeight = 1500
const rendererPath = path.join(__dirname, '..', 'dist-renderer', 'index.html')
const outputPath = path.join(__dirname, '..', '..', 'docs', 'assets', 'agent-board-public-demo.png')

app.commandLine.appendSwitch('force-device-scale-factor', '1')

function compareImages(candidate, existing) {
  const candidateSize = candidate.getSize()
  const existingSize = existing.getSize()
  if (candidateSize.width !== existingSize.width || candidateSize.height !== existingSize.height) {
    return { equivalent: false, changedPixels: null, maximumChannelDelta: null }
  }

  const candidatePixels = candidate.toBitmap()
  const existingPixels = existing.toBitmap()
  let changedPixels = 0
  let maximumChannelDelta = 0

  for (let index = 0; index < candidatePixels.length; index += 4) {
    let pixelDelta = 0
    for (let channel = 0; channel < 4; channel += 1) {
      pixelDelta = Math.max(pixelDelta, Math.abs(candidatePixels[index + channel] - existingPixels[index + channel]))
    }
    if (pixelDelta > 0) {
      changedPixels += 1
      maximumChannelDelta = Math.max(maximumChannelDelta, pixelDelta)
    }
  }

  // Chromium can move a tiny fraction of antialiasing values by a few levels
  // between identical headless captures. Preserve the reviewed asset for that
  // noise, while still replacing it for any visible renderer change.
  return {
    equivalent: changedPixels <= 4096 && maximumChannelDelta <= 4,
    changedPixels,
    maximumChannelDelta,
  }
}

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
  await window.webContents.insertCSS(`
    * { animation: none !important; transition: none !important; caret-color: transparent !important; }
    body { min-height: 0 !important; }
    #root, .app-shell { min-height: calc(100vh - 44px) !important; }
  `)
  const fixtureEvidence = await window.webContents.executeJavaScript(`
    (async () => {
      await document.fonts.ready;
      const banner = document.createElement('aside');
      banner.setAttribute('aria-label', 'Synthetic documentation fixture notice');
      banner.style.cssText = 'min-height:44px;padding:10px 24px;display:flex;align-items:center;justify-content:center;gap:12px;background:#17191c;color:#f1f0eb;font:700 11px/1.35 "SF Mono",monospace;letter-spacing:.05em;text-align:center';
      banner.innerHTML = '<strong style="color:#8fa3ff">SYNTHETIC DOCUMENTATION VIEW</strong><span>No live sessions, personal paths, device writes, RGB, or Fleet authority.</span>';
      document.body.prepend(banner);
      const visibleText = document.body.innerText;
      const requiredText = ['BLACK-CAP LEGEND', 'Ready to review', 'Available', 'Screen is authoritative now', 'USB identity not observed', 'Agent session feed unavailable'];
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

  if (fixtureEvidence.contentHeight > maximumHeight) {
    throw new Error(`Public fixture height ${fixtureEvidence.contentHeight}px exceeds the ${maximumHeight}px capture limit`)
  }

  const captureHeight = Math.max(minimumHeight, fixtureEvidence.contentHeight)
  window.setContentSize(width, captureHeight)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const finalContentHeight = await window.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')
  if (finalContentHeight > captureHeight) {
    throw new Error(`Public fixture grew to ${finalContentHeight}px after layout and would be truncated at ${captureHeight}px`)
  }
  const capturedImage = await window.webContents.capturePage()
  const capturedSize = capturedImage.getSize()
  const widthScale = capturedSize.width / width
  const heightScale = capturedSize.height / captureHeight
  if (!Number.isInteger(widthScale) || widthScale < 1 || widthScale > 4 || heightScale !== widthScale) {
    throw new Error(`Public fixture captured at ${capturedSize.width}x${capturedSize.height}; expected a bounded integer scale of ${width}x${captureHeight}`)
  }
  // Chromium can capture backing-store pixels on Retina hosts even when the
  // logical device scale switch is pinned. Normalize to the reviewed logical
  // dimensions so local and CI fixtures have the same public contract.
  const image = widthScale === 1
    ? capturedImage
    : capturedImage.resize({ width, height: captureHeight, quality: 'best' })
  const imageSize = image.getSize()
  await mkdir(path.dirname(outputPath), { recursive: true })
  const existingImage = nativeImage.createFromPath(outputPath)
  const comparison = existingImage.isEmpty() ? null : compareImages(image, existingImage)
  const updated = comparison === null || !comparison.equivalent
  if (updated) await writeFile(outputPath, image.toPNG())
  window.destroy()
  return { outputPath, width: imageSize.width, height: imageSize.height, updated, comparison }
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
