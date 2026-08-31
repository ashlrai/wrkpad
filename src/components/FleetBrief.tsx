import { CircleAlert, ShieldCheck, Waypoints } from 'lucide-react'
import type { FleetBrief as FleetBriefModel, MissionControlSnapshot } from '../board'

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export default function FleetBrief({ fleet, source, notices }: {
  fleet: FleetBriefModel | null
  source: MissionControlSnapshot['fleetSource']
  notices: MissionControlSnapshot['operatorNotices']
}) {
  if (!fleet) return <aside className="fleet-brief unavailable"><span className="eyebrow">OPERATOR BRIEF</span><h2>{source === 'invalid' ? 'Fleet returned invalid evidence.' : 'Fleet evidence unavailable.'}</h2><p>The board is not inferring health or zero counts from an installed CLI.</p></aside>
  const needsYou = fleet.blocker?.label ?? (fleet.pendingProposals ? `Review ${plural(fleet.pendingProposals, 'proposal')}` : 'No urgent fleet decision')
  const autonomous = fleet.killed ? 'Fleet is paused' : fleet.eligibleItems > 0 ? `${plural(fleet.eligibleItems, 'item')} eligible now` : 'No work is eligible now'
  return <aside className="fleet-brief">
    <div className="brief-title"><div><span className="eyebrow">OPERATOR BRIEF</span><h2>Exception first, proof always.</h2></div><span className={`source-receipt ${source}`}>{source === 'status_receipt' ? 'STATUS RECEIPT' : source === 'invalid' ? 'STATUS INVALID' : 'STATUS UNAVAILABLE'}</span></div>
    <div className="brief-lanes">
      <section className="needs-you"><CircleAlert size={17} /><span>NEEDS YOU</span><strong>{needsYou}</strong><p>{fleet.blocker?.detail ?? fleet.nextAction ?? 'Nothing requires expanded authority.'}</p></section>
      <section><Waypoints size={17} /><span>AUTONOMOUS NOW</span><strong>{autonomous}</strong><p>{plural(fleet.backlogItems, 'backlog item')} · {plural(fleet.repairBlockedItems, 'repair')} blocked · {plural(fleet.activeGoals, 'active goal')}</p></section>
      <section><ShieldCheck size={17} /><span>PROOF GATE</span><strong>{fleet.operatingMode}</strong><p>{fleet.directive}. {plural(fleet.pendingProposals, 'proposal')} pending; no board approval action.</p></section>
    </div>
    {fleet.nextAction && <div className="next-safe-action"><ShieldCheck size={13} /><span>NEXT SAFE ACTION</span><strong>{fleet.nextAction}</strong><em>{fleet.nextActionSafety ?? 'unknown'}</em></div>}
    {notices.map((notice) => <div className={`operator-notice ${notice.severity}`} key={notice.code}><CircleAlert size={14} /><div><strong>{notice.label}</strong><p>{notice.detail}</p></div></div>)}
  </aside>
}
