const { execFileSync } = require('node:child_process')
const path = require('node:path')

const UNUSED_PRIVACY_KEYS = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
]

function previewCodesignCommand(bundle, environment = process.env) {
  if (environment.WRKPAD_ADHOC_PREVIEW !== '1') return null
  return Object.freeze({ executable: '/usr/bin/codesign', args: Object.freeze(['--force', '--deep', '--sign', '-', bundle]) })
}

async function hardenMacPackage(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const bundle = path.join(context.appOutDir, `${appName}.app`)
  const plist = path.join(bundle, 'Contents', 'Info.plist')

  execFileSync('/usr/bin/plutil', [
    '-replace',
    'NSAppTransportSecurity',
    '-json',
    JSON.stringify({ NSAllowsArbitraryLoads: false }),
    plist,
  ])

  for (const key of UNUSED_PRIVACY_KEYS) {
    execFileSync('/usr/bin/plutil', ['-remove', key, plist])
  }

  // A local preview has no Developer ID identity, but it still needs a complete
  // bundle seal. Without this explicit ad-hoc signature, only Electron's Mach-O
  // linker signature is present and strict macOS verification fails. Public or
  // Developer ID builds must use a separate release workflow and never set this
  // local-preview flag.
  const codesign = previewCodesignCommand(bundle)
  if (codesign) execFileSync(codesign.executable, codesign.args)
}

module.exports = hardenMacPackage
module.exports.previewCodesignCommand = previewCodesignCommand
