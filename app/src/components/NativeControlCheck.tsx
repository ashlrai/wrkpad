import { useMemo, useState } from 'react'
import { Activity, Check, CircleAlert, ShieldCheck } from 'lucide-react'
import { nativeControlReportFresh } from '../native-control-report'

export type NativeSettingsOutcome = 'connected_granted' | 'failed_or_ungranted' | 'not_checked'
export type NativeControlOutcome = 'observed_response' | 'no_response' | 'unexpected_target' | 'not_configured' | 'skipped'
export type NativeControlOverall = 'incomplete' | 'reported_failure' | 'operator_accepted'

export interface NativeControlOutcomes {
  dial: NativeControlOutcome
  joystick: NativeControlOutcome
  agentKeys: Record<'AG00' | 'AG01' | 'AG02' | 'AG03' | 'AG04' | 'AG05', NativeControlOutcome>
  actionKeys: Record<'ACT06' | 'ACT07' | 'ACT08' | 'ACT09' | 'ACT10' | 'ACT11' | 'ACT12', NativeControlOutcome>
  lighting: NativeControlOutcome
}

export interface NativeControlCheckReceipt {
  schema: 'ai.ashlr.agent-board.native-control-check/v1'
  overall: NativeControlOverall
  reportedAt: string
  context: { route: 'codex_native'; device: { vidPid: string }; codex: { version: string; build: string } }
  settings: NativeSettingsOutcome
  outcomes: NativeControlOutcomes
}

export interface NativeControlCheckReport {
  settings: NativeSettingsOutcome
  outcomes: NativeControlOutcomes
}

const agentKeys = ['AG00', 'AG01', 'AG02', 'AG03', 'AG04', 'AG05'] as const
const actionKeys = ['ACT06', 'ACT07', 'ACT08', 'ACT09', 'ACT10', 'ACT11', 'ACT12'] as const
const defaultOutcomes = (): NativeControlOutcomes => ({
  dial: 'skipped',
  joystick: 'skipped',
  agentKeys: Object.fromEntries(agentKeys.map((id) => [id, 'skipped'])) as NativeControlOutcomes['agentKeys'],
  actionKeys: Object.fromEntries(actionKeys.map((id) => [id, 'skipped'])) as NativeControlOutcomes['actionKeys'],
  lighting: 'skipped',
})

const outcomeOptions: Array<{ value: NativeControlOutcome; label: string }> = [
  { value: 'skipped', label: 'Not tested yet' },
  { value: 'observed_response', label: 'Observed response' },
  { value: 'no_response', label: 'No response' },
  { value: 'unexpected_target', label: 'Unexpected target' },
  { value: 'not_configured', label: 'Not configured / no eligible task' },
]

const outcomeLabel = (value: NativeControlOutcome) => outcomeOptions.find((option) => option.value === value)?.label ?? 'Unknown'

function ControlOutcome({ id, label, detail, value, onChange }: { id: string; label: string; detail: string; value: NativeControlOutcome; onChange: (value: NativeControlOutcome) => void }) {
  return <label className={`native-control-row outcome-${value}`} htmlFor={`native-control-${id}`}>
    <span><strong>{label}</strong><small>{detail}</small></span>
    <select id={`native-control-${id}`} value={value} onChange={(event) => onChange(event.target.value as NativeControlOutcome)}>
      {outcomeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
}

export default function NativeControlCheck({ receipt, busy, error, onSave }: { receipt: NativeControlCheckReceipt | null; busy: boolean; error: string | null; onSave: (report: NativeControlCheckReport) => Promise<void> }) {
  const [settings, setSettings] = useState<NativeSettingsOutcome>(receipt?.settings ?? 'not_checked')
  const [outcomes, setOutcomes] = useState<NativeControlOutcomes>(receipt?.outcomes ?? defaultOutcomes())
  const [dirty, setDirty] = useState(false)
  const tested = useMemo(() => [outcomes.dial, outcomes.joystick, ...agentKeys.map((key) => outcomes.agentKeys[key]), ...actionKeys.map((key) => outcomes.actionKeys[key]), outcomes.lighting].filter((value) => value !== 'skipped').length, [outcomes])
  const updateControl = (key: 'dial' | 'joystick' | 'lighting', value: NativeControlOutcome) => {
    setOutcomes((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }
  const updateAgent = (key: typeof agentKeys[number], value: NativeControlOutcome) => {
    setOutcomes((current) => ({ ...current, agentKeys: { ...current.agentKeys, [key]: value } }))
    setDirty(true)
  }
  const updateAction = (key: typeof actionKeys[number], value: NativeControlOutcome) => {
    setOutcomes((current) => ({ ...current, actionKeys: { ...current.actionKeys, [key]: value } }))
    setDirty(true)
  }
  const receiptFresh = receipt ? nativeControlReportFresh(receipt) : false
  const savedState = receipt?.overall === 'operator_accepted' && receiptFresh
    ? { label: 'Operator accepted', tone: 'accepted', icon: <Check size={14} /> }
      : receipt?.overall === 'reported_failure'
      ? { label: 'Response needs recovery', tone: 'failed', icon: <CircleAlert size={14} /> }
      : receipt && !receiptFresh
        ? { label: 'Saved report expired · retest', tone: 'failed', icon: <CircleAlert size={14} /> }
      : { label: receipt ? 'Partial check saved' : 'No control report yet', tone: 'pending', icon: <Activity size={14} /> }
  const save = async () => {
    try {
      await onSave({ settings, outcomes })
      setDirty(false)
    } catch {
      // The parent renders a bounded recovery message; keep the edited report dirty.
    }
  }

  return <section className="native-control-check" aria-labelledby="native-control-check-title">
    <div className="native-control-check-head">
      <div><span className="eyebrow">CONTROL RECOVERY / OPERATOR-OBSERVED</span><h3 id="native-control-check-title">Prove what the key actually did.</h3><p>Agent Board stays passive and will not animate for Codex Native presses. Watch Codex: one tap selects the assigned task without forcing Codex forward; a double-tap within 350 ms selects and foregrounds it.</p></div>
      <span className={`native-control-check-state ${savedState.tone}`}>{savedState.icon}{savedState.label}</span>
    </div>

    <div className="native-route-preflight">
      <b>Put the board on the native wired route first</b>
      <ol>
        <li>On Creator Micro 2 Pro, hold the bottom-left touch sensor for three seconds, then tap through the channels to the fourth <strong>WIRED</strong> mode. Its underglow is white; let the selector exit after five seconds without touching it.</li>
        <li>A numeric <strong>Layer 1</strong> indicator identifies only a position—not its bindings. If native controls are absent or uncertain, stop; do not import into or alter the existing profile.</li>
        <li>Before recovery, require Setup to show verified Input integrity and preserve rollback exports. Follow <strong>app/docs/codex-native-layer-recovery.md</strong> for the new candidate profile, manual layer import and first-position reorder, post-import export verification, and human activation.</li>
        <li>Return only after the candidate’s first-position content is verified and you activated it yourself. Quit Input, Command-Q and reopen ChatGPT Desktop, then complete this physical check. Never use Reset settings or let Agent Board import, reorder, activate, or write the device.</li>
      </ol>
      <p><ShieldCheck size={13} /> White underglow proves only firmware-selected wired mode. A layer number, Connected, and Granted still do not prove native binding content or that Codex consumed a press.</p>
    </div>

    <div className="native-test-card">
      <b>Deterministic two-key test</b>
      <ol><li>In Codex Settings, use two assigned keys that point to different existing tasks.</li><li>Keep Codex visible and tap the first key once; the selected task should change.</li><li>Put another app in front and double-tap the second key within 350 ms; Codex should come forward.</li></ol>
      <p><ShieldCheck size={13} /> Testing the already-selected task or an unassigned, unlit slot can correctly look like no movement.</p>
    </div>

    <fieldset className="native-settings-result" disabled={busy}>
      <legend>What does Codex Settings → Creator Micro show?</legend>
      {([
        ['connected_granted', 'Connected + Input Monitoring Granted'],
        ['failed_or_ungranted', 'Connection failed or permission not granted'],
        ['not_checked', 'Not checked yet'],
      ] as Array<[NativeSettingsOutcome, string]>).map(([value, label]) => <label key={value}><input type="radio" name="native-settings-result" value={value} checked={settings === value} onChange={() => { setSettings(value); setDirty(true) }} /><span>{label}</span></label>)}
    </fieldset>

    <div className="native-control-results" aria-label="Physical control observations">
      <ControlOutcome id="dial" label="Left rotary dial" detail="Turn left, turn right, and press" value={outcomes.dial} onChange={(value) => updateControl('dial', value)} />
      <ControlOutcome id="joystick" label="Right planar toggle / joystick" detail="Move up, right, down, and left" value={outcomes.joystick} onChange={(value) => updateControl('joystick', value)} />
      {agentKeys.map((key, index) => <ControlOutcome key={key} id={key} label={`${key} · Agent ${index + 1}`} detail={index < 2 ? 'Upper center Agent position' : 'Second-row Agent position'} value={outcomes.agentKeys[key]} onChange={(value) => updateAgent(key, value)} />)}
      {actionKeys.map((key, index) => <ControlOutcome key={key} id={key} label={`${key} · Action ${index + 1}`} detail={key === 'ACT10' ? 'Bottom Voice position' : key === 'ACT11' ? 'Bottom Copy next / Continue position' : key === 'ACT12' ? 'Transparent Attention position' : 'Third-row action position'} value={outcomes.actionKeys[key]} onChange={(value) => updateAction(key, value)} />)}
      <ControlOutcome id="lighting" label="Lighting" detail="Inspect the physical board; the screen legend remains authoritative" value={outcomes.lighting} onChange={(value) => updateControl('lighting', value)} />
    </div>

    <div className="native-control-save">
      <span>{tested}/16 control groups observed</span>
      <button type="button" disabled={busy || !dirty || settings === 'not_checked'} onClick={() => void save()}>{busy ? 'Saving report…' : 'Save operator report'}</button>
    </div>
    {error && <p className="native-control-error" role="alert">{error}</p>}
    {receipt && !dirty && <p className={`native-control-receipt${receiptFresh ? '' : ' stale'}`}>Saved {outcomeLabel(receipt.outcomes.agentKeys.AG00) === 'No response' ? 'with AG00 reporting no response' : new Date(receipt.reportedAt).toLocaleString()} · {receipt.context.device.vidPid} · Codex {receipt.context.codex.version} · {receiptFresh ? 'fresh for this diagnosis' : 'older than 30 minutes; retest now'}</p>}
    <p className="native-proof-boundary"><ShieldCheck size={14} /><span><strong>Operator report—not HID proof.</strong> This receipt stores only bounded enums, timestamps, model VID:PID, and Codex version/build. It contains no task title, ID, prompt, transcript, path, or raw log.</span></p>
  </section>
}
