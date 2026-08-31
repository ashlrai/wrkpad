const { execFileSync } = require('node:child_process')
const path = require('node:path')

const UNUSED_PRIVACY_KEYS = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
]

module.exports = async function hardenMacPackage(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const plist = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Info.plist')

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
}

