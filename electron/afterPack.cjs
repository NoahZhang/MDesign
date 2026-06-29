// We ship without an Apple Developer certificate, and `identity:null` leaves the app
// with a broken/inconsistent ad-hoc signature → on another Mac (where the file is
// quarantined after transfer) Gatekeeper reports "已损坏 / is damaged". Re-sign the whole
// bundle (and the Rust sidecar) with a proper deep ad-hoc signature so it validates;
// then a recipient gets the normal "unidentified developer" prompt (right-click → Open)
// instead of "damaged". Zero-friction distribution still requires notarization.
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const sidecar = path.join(appPath, 'Contents', 'Resources', 'mdesign')
  try {
    // Sign nested Mach-O first (the sidecar must be ad-hoc signed to run on arm64).
    if (fs.existsSync(sidecar)) execSync(`codesign --force --sign - "${sidecar}"`, { stdio: 'inherit' })
    // Deep ad-hoc sign the whole bundle so it has a valid _CodeSignature.
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
    execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' })
    console.log('[afterPack] ad-hoc signed + verified:', appPath)
  } catch (e) {
    console.error('[afterPack] codesign failed:', e.message)
  }
}
