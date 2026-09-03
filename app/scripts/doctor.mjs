import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { detectCreatorMicro2 } = require('../electron/creator-micro-identity.cjs')
const { HYBRID_NATIVE_ROUTE, HYBRID_NATIVE_SIGNAL_IDS } = require('../electron/board-route-policy.cjs')
const { inspectCodexMicroLogs } = require('../electron/codex-micro-diagnostics.cjs')
const { exactHybridLayers } = require('../electron/flight-gates.cjs')
const { inspectInputApplicationRuntime } = require('../electron/input-application-runtime.cjs')
const { inspectInputInstallation } = require('../electron/input-installation-diagnostics.cjs')
const { inspectInputProfile } = require('../electron/input-profile-diagnostics.cjs')
const { inspectInputRuntime } = require('../electron/input-runtime-diagnostics.cjs')
const { inspectReceiverRuntime, RECEIVER_PROCESS_PATTERN } = require('../electron/receiver-runtime-diagnostics.cjs')
const { appSettingsPath, readAppSettings } = require('../electron/settings.cjs')
const { resolveTool } = require('../electron/tool-resolver.cjs')

const BOARD_CHECK = {
  key: 'board',
  name: 'Creator Micro 2 USB',
  nextAction: 'Connect the Creator Micro 2 with a data-capable USB-C cable, then rerun the doctor.',
}
const INPUT_CHECK = {
  key: 'input',
  name: 'Work Louder Input',
  nextAction: 'Install the signed Work Louder Input app, then rerun the doctor.',
}
const CHATGPT_CHECK = {
  key: 'chatgpt',
  name: 'ChatGPT desktop',
  nextAction: 'Install ChatGPT desktop, open Codex, then rerun the doctor.',
}

const OPTIONAL_CHECKS = [
  INPUT_CHECK,
  { key: 'chatgpt', name: 'ChatGPT desktop' },
  { key: 'codex', name: 'Codex CLI' },
  { key: 'nativeCodex', name: 'Codex native Creator Micro' },
  { key: 'claude', name: 'Claude Code' },
  { key: 'ashlr', name: 'Ashlr Hub' },
  { key: 'logitech', name: 'Competing Logitech HID owner' },
]

const ASHLR_MANUAL_CHECKS = [
  {
    id: 'input-monitoring',
    name: 'Input Monitoring',
    detail: 'Verify the shortcut-receiving app in System Settings → Privacy & Security → Input Monitoring.',
  },
  {
    id: 'input-layer',
    name: 'Work Louder Input layer',
    detail: 'Verify the canonical daily shortcut layer is active in Work Louder Input.',
  },
  {
    id: 'flight-check',
    name: 'Physical Flight Check',
    detail: 'Run the Daily Flight Check in Agent Board and export a passing receipt.',
  },
]
const NATIVE_MANUAL_CHECKS = [
  {
    id: 'wired-mode',
    name: 'Wired USB mode',
    detail: 'Confirm the board connection light is white and the USB cable carries data, not power only.',
  },
  {
    id: 'native-owner-isolation',
    name: 'Native controller isolation',
    detail: 'Keep Work Louder Input fully quit. Agent Board may remain open only after its Codex Native handoff prepares successfully; Codex stays the sole intended HID controller.',
  },
  {
    id: 'native-settings',
    name: 'Codex Creator Micro connection',
    detail: 'Require a fresh Settings → Creator Micro connected state after the ordered native handshake.',
  },
  {
    id: 'native-physical-controls',
    name: 'Native physical controls',
    detail: 'Verify the dial, joystick, agent keys, action keys, separate ACT10 and ACT11 behavior, and lighting in Codex.',
  },
]
const HYBRID_MANUAL_CHECKS = [
  {
    id: 'input-monitoring',
    name: 'Input Monitoring',
    detail: 'Verify Agent Board in System Settings → Privacy & Security → Input Monitoring.',
  },
  {
    id: 'hybrid-layer',
    name: 'Hybrid profile and layer',
    detail: 'Verify the exact hybrid profile is current, its hybrid layer is first, then fully quit Work Louder Input before Agent Board receives shortcuts.',
  },
  {
    id: 'hybrid-non-agent-flight-check',
    name: 'Hybrid 14-control Flight Check',
    detail: `With actions suppressed, prove only the ordered non-agent controls: ${HYBRID_NATIVE_SIGNAL_IDS.join(', ')}. This does not test the six native Agent keys.`,
  },
  {
    id: 'hybrid-native-agent-acceptance',
    name: 'Native Agent-key acceptance',
    detail: 'Separately verify the six Agent keys inside ChatGPT. The hybrid Flight Check does not intercept or accept them.',
  },
]
const INPUT_RUNTIME_STATUSES = new Set(['unresolved_profile_layer', 'not_observed', 'log_missing', 'log_unsafe', 'log_unavailable'])
const INPUT_APPLICATION_STATUSES = new Set(['running', 'not_running', 'unavailable'])
const CODEX_PROTOCOL_TRAFFIC_STATUSES = new Set(['recurring_unresolved_response', 'not_observed', 'log_missing', 'log_unsafe', 'log_unavailable'])
const INPUT_INSTALLATION_STATUSES = new Set(['verified', 'missing', 'multiple_installations', 'unsafe', 'invalid_metadata', 'publisher_unrecognized', 'invalid_signature', 'known_resource_mutation', 'gatekeeper_rejected', 'probe_unavailable'])
const RECEIVER_RUNTIME_STATUSES = new Set(['exclusive', 'contended_same_build', 'contended_distinct_builds', 'not_running', 'unavailable'])
const SHA256 = /^[0-9a-f]{64}$/
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/
const boundedIsoTimestamp = (value) => {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null
}

const projectInputInstallation = (raw) => {
  const status = INPUT_INSTALLATION_STATUSES.has(raw?.status) ? raw.status : 'probe_unavailable'
  const version = typeof raw?.version === 'string' && SAFE_VERSION.test(raw.version) ? raw.version : null
  const versionRequired = ['verified', 'publisher_unrecognized', 'invalid_signature', 'known_resource_mutation', 'gatekeeper_rejected'].includes(status)
  const versionForbidden = ['missing', 'multiple_installations', 'unsafe', 'invalid_metadata', 'probe_unavailable'].includes(status)
  const knownMutationVersionInvalid = status === 'known_resource_mutation' && version !== '0.18.4'
  if ((versionRequired && !version) || (versionForbidden && raw?.version !== null) || knownMutationVersionInvalid) {
    return { status: 'probe_unavailable', version: null }
  }
  return { status, version }
}

const inputCheck = (installation) => {
  const version = installation.version ? ` v${installation.version}` : ''
  const details = {
    verified: `verified signed vendor app${version}`,
    missing: 'signed vendor app not found',
    multiple_installations: 'multiple Input.app installations found',
    unsafe: 'Input.app installation candidate is unsafe',
    invalid_metadata: 'Input.app metadata is invalid',
    publisher_unrecognized: `Input.app publisher is unrecognized${version}`,
    invalid_signature: `Input.app signature integrity failed${version}`,
    known_resource_mutation: `Input.app has the known modified signed resource${version}`,
    gatekeeper_rejected: `Input.app was rejected by Gatekeeper${version}`,
    probe_unavailable: 'Input.app integrity probe unavailable',
  }
  return { ok: installation.status === 'verified', detail: details[installation.status], code: installation.status }
}

const inputRecoveryAction = (status) => {
  if (status === 'missing') return 'Install the signed Work Louder Input app from the vendor, then rerun the doctor.'
  if (status === 'multiple_installations') return 'A human must review both Input.app installations, keep one verified signed vendor copy, and rerun the doctor. No application was removed automatically.'
  if (status === 'known_resource_mutation') return 'Stop Input, profile synchronization, and firmware qualification. A human must fully quit Input, preserve a stopped-state profile backup, replace it with one official signed vendor copy, then rerun the doctor before reopening other board controllers. Do not repair or re-sign the app; no application was changed automatically.'
  if (status === 'probe_unavailable') return 'A human must verify the signed Work Louder Input installation manually, then rerun the read-only doctor; no application was changed.'
  return 'Stop Input and firmware qualification. A human must replace or repair Input.app from the signed vendor distribution, then rerun the doctor; no application was changed automatically.'
}

const unavailableReceiver = () => ({
  status: 'unavailable', instanceCount: 0, distinctBuildCount: 0,
  currentAsarSha256: null, candidateAsarSha256: null, candidateMatchesCurrent: null,
})

const projectReceiverRuntime = (raw) => {
  if (!RECEIVER_RUNTIME_STATUSES.has(raw?.status)) return unavailableReceiver()
  const instanceCount = Number.isInteger(raw.instanceCount) && raw.instanceCount >= 0 && raw.instanceCount <= 64 ? raw.instanceCount : null
  const distinctBuildCount = Number.isInteger(raw.distinctBuildCount) && raw.distinctBuildCount >= 0 && raw.distinctBuildCount <= 64 ? raw.distinctBuildCount : null
  const currentAsarSha256 = raw.currentAsarSha256 === null ? null : SHA256.test(raw.currentAsarSha256 ?? '') ? raw.currentAsarSha256 : undefined
  const candidateAsarSha256 = raw.candidateAsarSha256 === null ? null : SHA256.test(raw.candidateAsarSha256 ?? '') ? raw.candidateAsarSha256 : undefined
  const candidateMatchesCurrent = raw.candidateMatchesCurrent === null || typeof raw.candidateMatchesCurrent === 'boolean' ? raw.candidateMatchesCurrent : undefined
  if (instanceCount === null || distinctBuildCount === null || currentAsarSha256 === undefined || candidateAsarSha256 === undefined || candidateMatchesCurrent === undefined) return unavailableReceiver()
  if (distinctBuildCount > instanceCount) return unavailableReceiver()
  const candidateShapeValid = candidateAsarSha256 === null
    ? candidateMatchesCurrent === null
    : currentAsarSha256 !== null && candidateMatchesCurrent === (candidateAsarSha256 === currentAsarSha256)
  const shapeValid = raw.status === 'not_running'
    ? instanceCount === 0 && distinctBuildCount === 0 && currentAsarSha256 === null && candidateAsarSha256 === null && candidateMatchesCurrent === null
    : raw.status === 'unavailable'
      ? distinctBuildCount === 0 && currentAsarSha256 === null && candidateAsarSha256 === null && candidateMatchesCurrent === null
      : raw.status === 'exclusive'
        ? instanceCount === 1 && distinctBuildCount === 1 && currentAsarSha256 !== null && candidateShapeValid
        : raw.status === 'contended_same_build'
          ? instanceCount >= 2 && distinctBuildCount === 1 && currentAsarSha256 !== null && candidateShapeValid
          : instanceCount >= 2 && distinctBuildCount >= 2 && currentAsarSha256 !== null && candidateShapeValid
  if (!shapeValid) return unavailableReceiver()
  return { status: raw.status, instanceCount, distinctBuildCount, currentAsarSha256, candidateAsarSha256, candidateMatchesCurrent }
}

const receiverRecoveryAction = 'A human must fully quit every Ashlr Agent Board copy, then reopen exactly one reviewed build and rerun the doctor. No process was quit automatically.'

const makeCheck = (definition, probe, category) => ({
  name: definition.name,
  ok: Boolean(probe?.ok),
  detail: probe?.detail || 'unavailable',
  category,
  severity: probe?.ok ? 'pass' : category === 'required' ? 'error' : 'warning',
  blocking: category === 'required',
  ...(typeof probe?.code === 'string' ? { code: probe.code } : {}),
  ...(typeof probe?.fresh === 'boolean' ? { fresh: probe.fresh } : {}),
})

export function evaluateDoctor(probes, options = {}) {
  const route = ['codex_native', 'ashlr_layer', HYBRID_NATIVE_ROUTE].includes(probes.boardRoute)
    ? probes.boardRoute
    : 'unknown'
  const inputInstallation = projectInputInstallation(probes.inputInstallation)
  const inputApplication = {
    status: INPUT_APPLICATION_STATUSES.has(probes.inputApplication?.status)
      ? probes.inputApplication.status
      : 'unavailable',
  }
  const receiverRuntime = projectReceiverRuntime(probes.receiverRuntime)
  const evaluatedProbes = { ...probes, input: inputCheck(inputInstallation) }
  const requiredDefinitions = route === 'codex_native'
    ? [BOARD_CHECK, CHATGPT_CHECK]
    : route === HYBRID_NATIVE_ROUTE
      ? [BOARD_CHECK, INPUT_CHECK, CHATGPT_CHECK]
      : [BOARD_CHECK, INPUT_CHECK]
  const requiredKeys = new Set(requiredDefinitions.map((definition) => definition.key))
  const requiredChecks = requiredDefinitions.map((definition) =>
    makeCheck(definition, evaluatedProbes[definition.key], 'required'),
  )
  const optionalChecks = OPTIONAL_CHECKS.filter((definition) => !requiredKeys.has(definition.key)).map((definition) =>
    makeCheck(definition, evaluatedProbes[definition.key], 'optional'),
  )
  const failedRequiredIndex = requiredChecks.findIndex((check) => !check.ok)
  const ashlrPrerequisitesReady = Boolean(probes.board?.ok) && inputInstallation.status === 'verified'
  const nativePrerequisitesReady = Boolean(probes.board?.ok) && Boolean(probes.chatgpt?.ok)
  const nativeFirmwareMissing = probes.nativeCodex?.code === 'firmware_rpc_missing'
  const nativeEvidenceFresh = probes.nativeCodex?.fresh === true
  const currentNativeFirmwareMissing = nativeFirmwareMissing && nativeEvidenceFresh
  const nativeConnected = nativePrerequisitesReady && probes.nativeCodex?.ok === true && nativeEvidenceFresh
  const nativeRouteSelected = probes.boardRoute === 'codex_native'
  const inputProfile = probes.inputProfile ?? {
    cacheStatus: 'missing',
    activeProfile: null,
    activeLayer: null,
    encoderDirection: 'unavailable',
  }
  const dailyProfileReady = inputProfile.activeProfile === 'Ashlr Agent Board Corrected'
    && inputProfile.activeLayer === 'Ashlr Daily'
    && inputProfile.encoderDirection === 'correct'
  const hybridProfileMatch = inputProfile.activeProfile === 'Ashlr Hybrid Dual Plane (UNOFFICIAL)'
  const hybridLayersMatch = exactHybridLayers(inputProfile.configuredLayers)
  const hybridProfileReady = inputProfile.cacheStatus === 'available'
    && inputProfile.activeLayer === null
    && hybridProfileMatch
    && hybridLayersMatch
  const rawInputRuntime = probes.inputRuntime ?? {}
  const inputRuntimeStatus = INPUT_RUNTIME_STATUSES.has(rawInputRuntime.status) ? rawInputRuntime.status : 'log_unavailable'
  const runtimeProfileIndex = Number.isInteger(rawInputRuntime.profileIndex) && rawInputRuntime.profileIndex >= 0 && rawInputRuntime.profileIndex <= 31 ? rawInputRuntime.profileIndex : null
  const runtimeLayerIndex = Number.isInteger(rawInputRuntime.layerIndex) && rawInputRuntime.layerIndex >= 0 && rawInputRuntime.layerIndex <= 15 ? rawInputRuntime.layerIndex : null
  const runtimeObservedAt = boundedIsoTimestamp(rawInputRuntime.observedAt)
  const unresolvedRuntimeShapeValid = inputRuntimeStatus !== 'unresolved_profile_layer'
    || (runtimeProfileIndex !== null && runtimeLayerIndex !== null && runtimeObservedAt !== null)
  const projectedRuntimeStatus = unresolvedRuntimeShapeValid ? inputRuntimeStatus : 'log_unavailable'
  const unresolvedRuntimeObserved = projectedRuntimeStatus === 'unresolved_profile_layer'
    && rawInputRuntime.fresh === true && runtimeProfileIndex !== null && runtimeLayerIndex !== null && runtimeObservedAt !== null
  const rawCodexTraffic = rawInputRuntime.codexProtocolTraffic && typeof rawInputRuntime.codexProtocolTraffic === 'object'
    ? rawInputRuntime.codexProtocolTraffic
    : null
  const codexTrafficStatus = rawCodexTraffic && CODEX_PROTOCOL_TRAFFIC_STATUSES.has(rawCodexTraffic.status)
    ? rawCodexTraffic.status
    : 'log_unavailable'
  const codexTrafficObservedAt = boundedIsoTimestamp(rawCodexTraffic?.observedAt)
  const codexTrafficShapeValid = codexTrafficStatus !== 'recurring_unresolved_response' || codexTrafficObservedAt !== null
  const projectedCodexTrafficStatus = codexTrafficShapeValid ? codexTrafficStatus : 'log_unavailable'
  const recurringCodexTrafficObserved = projectedCodexTrafficStatus === 'recurring_unresolved_response'
    && rawCodexTraffic?.fresh === true && codexTrafficObservedAt !== null
  const receiverBlocked = ['contended_same_build', 'contended_distinct_builds', 'unavailable'].includes(receiverRuntime.status)
  const receiverReason = receiverRuntime.status === 'contended_same_build'
    ? 'receiver_contended_same_build'
    : receiverRuntime.status === 'contended_distinct_builds'
      ? 'receiver_contended_distinct_builds'
      : 'receiver_probe_unavailable'
  const ashlrReason = !ashlrPrerequisitesReady
    ? 'required_prerequisite_missing'
    : receiverBlocked
      ? receiverReason
      : receiverRuntime.status === 'not_running'
        ? 'receiver_not_running'
        : inputProfile.encoderDirection === 'reversed'
      ? 'encoder_direction_reversed'
      : !dailyProfileReady
        ? 'input_profile_requires_activation'
        : unresolvedRuntimeObserved
          ? 'recent_unresolved_profile_layer_observed'
          : recurringCodexTrafficObserved
            ? 'recurring_codex_protocol_traffic'
            : 'physical_acceptance_required'
  const hybridPrerequisitesReady = Boolean(probes.board?.ok)
    && inputInstallation.status === 'verified'
    && Boolean(probes.chatgpt?.ok)
  const hybridReason = !hybridPrerequisitesReady
    ? 'required_prerequisite_missing'
    : receiverBlocked
      ? receiverReason
      : receiverRuntime.status === 'not_running'
        ? 'receiver_not_running'
        : inputApplication.status === 'running'
          ? 'input_application_running'
          : inputApplication.status !== 'not_running'
            ? 'input_application_probe_unavailable'
            : !hybridProfileReady
              ? 'hybrid_profile_requires_activation'
              : 'separate_physical_acceptance_required'
  const manualDefinitions = route === 'codex_native'
    ? NATIVE_MANUAL_CHECKS
    : route === HYBRID_NATIVE_ROUTE ? HYBRID_MANUAL_CHECKS : ASHLR_MANUAL_CHECKS
  const manualChecks = manualDefinitions.map((check) => ({
    ...check,
    category: 'manual',
    status: 'manual',
    blocking: false,
  }))

  return {
    schema: 'ai.ashlr.agent-board.doctor/v1',
    observedAt: options.observedAt ?? new Date().toISOString(),
    readOnly: true,
    route,
    ok: failedRequiredIndex === -1,
    checks: [...requiredChecks, ...optionalChecks],
    inputInstallation,
    inputApplication,
    receiverRuntime,
    inputProfile: {
      cacheStatus: inputProfile.cacheStatus,
      dailyProfileMatch: inputProfile.activeProfile === 'Ashlr Agent Board Corrected',
      dailyLayerMatch: inputProfile.activeLayer === 'Ashlr Daily',
      encoderDirection: inputProfile.encoderDirection,
      dailyProfileReady,
      ...(route === HYBRID_NATIVE_ROUTE ? {
        hybridProfileMatch,
        hybridLayersMatch,
        hybridProfileReady,
      } : {}),
    },
    inputRuntime: {
      status: projectedRuntimeStatus,
      profileIndex: projectedRuntimeStatus === 'unresolved_profile_layer' ? runtimeProfileIndex : null,
      layerIndex: projectedRuntimeStatus === 'unresolved_profile_layer' ? runtimeLayerIndex : null,
      observedAt: projectedRuntimeStatus === 'unresolved_profile_layer' ? runtimeObservedAt : null,
      fresh: unresolvedRuntimeObserved,
      codexProtocolTraffic: {
        status: projectedCodexTrafficStatus,
        observedAt: projectedCodexTrafficStatus === 'recurring_unresolved_response' ? codexTrafficObservedAt : null,
        fresh: recurringCodexTrafficObserved,
      },
    },
    manualChecks,
    readiness: {
      prerequisites: {
        status: failedRequiredIndex === -1 ? 'pass' : 'blocked',
        reason: failedRequiredIndex === -1 ? 'required_checks_passed' : `required_check_failed:${requiredDefinitions[failedRequiredIndex].key}`,
      },
      codexNative: {
        status: !nativePrerequisitesReady || currentNativeFirmwareMissing ? 'blocked' : nativeConnected ? 'pass' : 'manual',
        reason: !nativePrerequisitesReady
          ? 'native_prerequisite_missing'
          : currentNativeFirmwareMissing
          ? 'firmware_rpc_missing'
          : nativeConnected
            ? 'recent_native_connection_observed'
            : nativeFirmwareMissing
              ? 'historical_firmware_rpc_missing'
              : 'native_connection_requires_verification',
        fresh: nativePrerequisitesReady && nativeEvidenceFresh,
      },
      ashlrLayer: {
        status: ashlrPrerequisitesReady && !receiverBlocked ? 'manual' : 'blocked',
        reason: ashlrReason,
      },
      hybridNative: {
        status: hybridPrerequisitesReady
          && !receiverBlocked
          && receiverRuntime.status !== 'not_running'
          && inputApplication.status === 'not_running'
          && hybridProfileReady ? 'manual' : 'blocked',
        reason: hybridReason,
      },
    },
    modeGuidance: {
      codexNative: !nativePrerequisitesReady
        ? 'Native Codex requires the Creator Micro 2 over USB and ChatGPT desktop before its connection receipt can be evaluated.'
        : currentNativeFirmwareMissing
          ? 'Codex recently observed v.oai.rgbcfg RPC 404. Back up Input profiles, then qualify a reviewed vendor firmware candidate with Codex fully quit; release strings alone do not prove compatibility.'
          : nativeFirmwareMissing
            ? 'Codex previously observed v.oai.rgbcfg RPC 404, but that evidence is historical. Re-run the explicit native connection check before considering firmware.'
            : 'Native Codex requires an explicit connected receipt; process presence alone is not enough.',
      ashlrLayer: receiverBlocked
        ? 'Agent Board receiver ownership is contended or unavailable. Shortcut and physical acceptance must wait for one reviewed receiver; no process was quit automatically.'
        : unresolvedRuntimeObserved
          ? 'Input recently logged an unresolved profile/layer combination. This event is advisory and may predate the current cache; a fresh physical Flight Check can supersede it.'
          : recurringCodexTrafficObserved
            ? 'Input is receiving recurring Codex-protocol responses for which it had no active resolver. This is co-presence evidence, not ownership; Input-only reconciliation is not exclusive.'
            : 'The Ashlr shortcut route remains independently commissionable through Work Louder Input and the physical Flight Check.',
      hybridNative: !hybridPrerequisitesReady
        ? 'Hybrid Native requires USB, verified Work Louder Input installation, and ChatGPT desktop. These prerequisites do not prove either control plane.'
        : receiverBlocked || receiverRuntime.status === 'not_running'
          ? 'Hybrid shortcut ownership is unavailable. Exactly one reviewed Agent Board receiver must own only the 14 non-agent shortcuts.'
          : inputApplication.status !== 'not_running'
            ? 'Hybrid operation requires Work Louder Input to be verifiably quit. Installation and exact-profile evidence remain separate gates.'
            : !hybridProfileReady
              ? 'The exact two-layer hybrid profile is not proven by the bounded Input cache. Do not infer active firmware state from a profile name alone.'
              : 'The profile and ownership prerequisites are ready for two separate human checks: the ordered 14-control Flight Check and native six-key acceptance in ChatGPT.',
    },
    nextAction:
      failedRequiredIndex === -1
        ? currentNativeFirmwareMissing && nativeRouteSelected
          ? inputInstallation.status === 'verified'
            ? 'For the declared Codex Native route, back up the Input profile and plan a guarded vendor firmware qualification with Codex fully quit.'
            : `${inputRecoveryAction(inputInstallation.status)} This is required before another firmware qualification, not before a read-only native connection retry.`
          : nativeFirmwareMissing && nativeRouteSelected
            ? 'Keep Work Louder Input quit, prepare Agent Board’s passive Codex Native handoff successfully, restart Codex, then re-run the explicit native connection check. Historical RPC evidence is advisory and does not authorize firmware work.'
            : nativeRouteSelected
              ? 'Keep Work Louder Input quit, prepare Agent Board’s passive Codex Native handoff successfully, restart Codex, then verify Settings → Creator Micro and the physical controls.'
          : route === HYBRID_NATIVE_ROUTE && receiverBlocked
            ? receiverRecoveryAction
            : route === HYBRID_NATIVE_ROUTE && receiverRuntime.status === 'not_running'
              ? 'Open exactly one reviewed Ashlr Agent Board build, then rerun the doctor before Hybrid Flight Check.'
              : route === HYBRID_NATIVE_ROUTE && inputApplication.status !== 'not_running'
                ? 'Fully quit Work Louder Input manually, confirm it is no longer running, then rerun the doctor. No process was quit automatically.'
                : route === HYBRID_NATIVE_ROUTE && !hybridProfileReady
                  ? 'In an isolated Input-only window, make the exact hybrid profile current with its hybrid layer first; then quit Input and rerun the doctor. A cache match will not prove device synchronization or physical controls.'
                  : route === 'ashlr_layer' && receiverBlocked
            ? receiverRecoveryAction
            : route === 'ashlr_layer' && receiverRuntime.status === 'not_running'
              ? 'Open exactly one reviewed Ashlr Agent Board build, then rerun the doctor before Flight Check.'
          : route === 'ashlr_layer' && inputProfile.encoderDirection === 'reversed'
            ? 'Create and activate the corrected Input profile before Flight Check.'
            : route === 'ashlr_layer' && !dailyProfileReady
              ? 'Use Set as current profile for Ashlr Agent Board Corrected and verify Ashlr Daily before Flight Check.'
              : unresolvedRuntimeObserved && route === 'ashlr_layer'
                ? 'Review the recent unresolved Input profile/layer event. If the board remains silent, complete the Input-only reconciliation before firmware qualification.'
                : recurringCodexTrafficObserved && route === 'ashlr_layer'
                  ? 'A human must establish an Input-only window before reconciliation; no application was quit and protocol traffic does not prove ownership.'
                : manualChecks[0].detail
        : requiredDefinitions[failedRequiredIndex].key === 'input' ? inputRecoveryAction(inputInstallation.status) : requiredDefinitions[failedRequiredIndex].nextAction,
  }
}

const run = (executable, args) => {
  try {
    return execFileSync(executable, args, { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {
    return null
  }
}

const toolProbe = (tool) => {
  const executable = resolveTool(tool, { home: homedir() })
  const version = executable ? run(executable, ['--version']) : null
  return { ok: Boolean(version), detail: version || 'unavailable' }
}

export { detectCreatorMicro2 }

export function collectProbes() {
  const home = homedir()
  const usb = run('/usr/sbin/ioreg', ['-p', 'IOUSB', '-n', 'Creator Micro 2', '-r', '-l'])
  const boardIdentity = detectCreatorMicro2(usb)
  const chatgptInstalled = existsSync('/Applications/ChatGPT.app')
  const inputInstallation = inspectInputInstallation({ home })
  const receiverPidText = run('/usr/bin/pgrep', ['-of', RECEIVER_PROCESS_PATTERN])
  const receiverPid = /^\d{1,10}$/.test(receiverPidText ?? '') ? Number(receiverPidText) : null
  const receiverRuntime = inspectReceiverRuntime(receiverPid ? { currentPid: receiverPid } : {})
  const inputApplication = inspectInputApplicationRuntime()
  const logitechOwner = run('/usr/bin/pgrep', ['-fl', 'logioptionsplus_agent'])
  const nativeCodex = inspectCodexMicroLogs(home)
  const settings = readAppSettings(appSettingsPath(join(home, 'Library', 'Application Support')), home)

  return {
    board: { ok: Boolean(boardIdentity), detail: boardIdentity ? `Work Louder ${boardIdentity.vidPid}${boardIdentity.evidence === 'candidate' ? ' candidate' : ''}` : 'not detected' },
    inputInstallation,
    input: inputCheck(projectInputInstallation(inputInstallation)),
    receiverRuntime,
    inputApplication,
    chatgpt: { ok: chatgptInstalled, detail: chatgptInstalled ? 'installed' : 'missing' },
    codex: toolProbe('codex'),
    nativeCodex: {
      ok: nativeCodex.status === 'connected' && nativeCodex.fresh === true,
      code: nativeCodex.status,
      fresh: nativeCodex.fresh === true,
      detail: nativeCodex.status === 'firmware_rpc_missing'
        ? `v.oai.rgbcfg returned RPC 404${nativeCodex.fresh ? ' recently' : ` in historical evidence${nativeCodex.observedAt ? ` at ${nativeCodex.observedAt}` : ''}`}`
        : nativeCodex.detail,
    },
    boardRoute: settings.boardRoute,
    inputProfile: inspectInputProfile(home, boardIdentity?.storageId),
    inputRuntime: inspectInputRuntime(home),
    claude: toolProbe('claude'),
    ashlr: toolProbe('ashlr'),
    logitech: {
      ok: !logitechOwner,
      detail: logitechOwner ? 'running; generic HID-manager caution only' : 'not running',
    },
  }
}

function printHuman(result) {
  const sections = [
    ['Required', result.checks.filter((check) => check.category === 'required')],
    ['Optional integrations', result.checks.filter((check) => check.category === 'optional')],
  ]

  for (const [heading, checks] of sections) {
    console.log(`${heading}:`)
    for (const check of checks) console.log(`  ${check.ok ? '✓' : check.blocking ? '✕' : '!'} ${check.name}: ${check.detail}`)
  }

  console.log('Manual verification:')
  for (const check of result.manualChecks) console.log(`  • ${check.name}: ${check.detail}`)
  console.log(`\n${result.ok ? 'Doctor passed required checks.' : 'Doctor failed required checks.'}`)
  console.log(`Declared route: ${result.route}`)
  if (result.inputRuntime.fresh) console.log(`Input runtime: unresolved profile ${result.inputRuntime.profileIndex} / layer ${result.inputRuntime.layerIndex} observed recently`)
  if (result.inputRuntime.codexProtocolTraffic.fresh) console.log('Input runtime: recurring Codex-protocol responses observed; co-presence only, ownership unproven')
  console.log(`Input integrity: ${result.inputInstallation.status}${result.inputInstallation.version ? ` v${result.inputInstallation.version}` : ''}`)
  if (result.route === HYBRID_NATIVE_ROUTE) console.log(`Work Louder Input process: ${result.inputApplication.status}`)
  console.log(`Agent Board receiver: ${result.receiverRuntime.status}; ${result.receiverRuntime.instanceCount} instance(s)`)
  console.log(`Next: ${result.nextAction}`)
}

function main() {
  const result = evaluateDoctor(collectProbes())
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else printHuman(result)
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
