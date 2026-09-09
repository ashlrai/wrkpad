const CREATOR_MICRO_2_IDENTITIES = Object.freeze([
  { decimalProductId: '33432', storageId: '33432', vidPid: '303A:8298', evidence: 'desk_verified' },
  { decimalProductId: '33431', storageId: '33431', vidPid: '303A:8297', evidence: 'candidate' },
])

function detectCreatorMicro2(usb) {
  if (typeof usb !== 'string') return null
  const vendor = /"USB Vendor Name"\s*=\s*"([^"]{1,128})"/.exec(usb)?.[1]
  const product = /"USB Product Name"\s*=\s*"([^"]{1,128})"/.exec(usb)?.[1]
  const productId = /"idProduct"\s*=\s*(\d{1,5})(?!\d)/.exec(usb)?.[1]
  if (vendor !== 'Work Louder' || product !== 'Creator Micro 2' || !productId) return null
  return CREATOR_MICRO_2_IDENTITIES.find((identity) => identity.decimalProductId === productId) ?? null
}

module.exports = { CREATOR_MICRO_2_IDENTITIES, detectCreatorMicro2 }
