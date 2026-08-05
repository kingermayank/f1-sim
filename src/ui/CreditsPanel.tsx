import credits from '../assets/credits.json';
import { AccessibleDialog } from './AccessibleDialog';

export function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function CreditsPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;
  return (
    <AccessibleDialog className="credits-panel" labelledBy="credits-title" onClose={onClose}>
        <header><div><p className="panel-kicker">Provenance</p><h2 id="credits-title">Credits and disclosure</h2></div><button type="button" className="modal-close" aria-label="Close credits" data-autofocus onClick={onClose}>×</button></header>
        <div className="disclosure">
          <strong>Independent simulated broadcast</strong>
          <p>This is a generated simulation for a private prototype. Timing, incidents, results, track geometry, liveries, and presentation graphics are fictional or project-original. It is not affiliated with or endorsed by Formula 1, the FIA, the Chinese Grand Prix, its teams, or drivers.</p>
        </div>
        <ul className="credits-list">
          {credits.map((credit) => (
            <li key={credit.id}>
              <h3>{credit.title}</h3>
              <p>{credit.creator}</p>
              <dl><div><dt>Source</dt><dd>{isExternalUrl(credit.source) ? <a href={credit.source} target="_blank" rel="noreferrer">Source link</a> : credit.source}</dd></div><div><dt>License</dt><dd><a href={credit.licenseUrl} target="_blank" rel="noreferrer">{credit.license} license</a></dd></div><div><dt>Modifications</dt><dd>{credit.modifications}</dd></div></dl>
            </li>
          ))}
        </ul>
    </AccessibleDialog>
  );
}
