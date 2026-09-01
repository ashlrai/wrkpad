const test = require('node:test')
const assert = require('node:assert/strict')
const { detectCreatorMicro2 } = require('./creator-micro-identity.cjs')

const usb = (vendor, product, productId, extra = '') => `
  "USB Vendor Name" = "${vendor}"
  "USB Product Name" = "${product}"
  ${extra}
  "idProduct" = ${productId}
`

test('recognizes both bounded Creator Micro 2 identities', () => {
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 2', 33432)).vidPid, '303A:8298')
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 2', 33431)).vidPid, '303A:8297')
})

test('does not broad-match the vendor, name, or product id independently', () => {
  assert.equal(detectCreatorMicro2(usb('Other Vendor', 'Creator Micro 2', 33432)), null)
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Other Product', 33432)), null)
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 2', 99999)), null)
})

test('rejects PID and product near-matches in unrelated fields', () => {
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 2', 133432)), null)
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 2', 99999, '"USB Serial Number" = "33432"')), null)
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 20', 33432)), null)
})
