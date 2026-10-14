import { expect, test } from 'bun:test'

import { pairingLink, parsePairingFragment } from '../src/pairing'

const pairing = { port: 7610, token: 'Abc_def-1234567890xyz', mcpToken: 'f'.repeat(64) }

test('a pairing link round-trips through the location hash', () => {
  const link = pairingLink('https://app.openpencil.dev/', pairing)
  expect(link).toBe(
    `https://app.openpencil.dev/#openpencil-harness=7610.${pairing.token}.${pairing.mcpToken}`
  )
  expect(parsePairingFragment(new URL(link).hash)).toEqual(pairing)
})

test('malformed pairings are ignored', () => {
  for (const hash of [
    '',
    '#other=1',
    '#openpencil-harness=7610.short.short',
    `#openpencil-harness=80.${pairing.token}.${pairing.mcpToken}`,
    `#openpencil-harness=7610.${pairing.token}`,
    `#openpencil-harness=7610.${pairing.token}.${pairing.mcpToken}.extra`,
    `#openpencil-harness=7610.${pairing.token}.<script>${'x'.repeat(20)}`
  ]) {
    expect(parsePairingFragment(hash)).toBeNull()
  }
})
