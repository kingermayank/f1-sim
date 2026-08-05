import credits from '../assets/credits.json';

export function CreditsPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="credits-panel" role="dialog" aria-modal="true" aria-labelledby="credits-title">
        <header><div><p className="panel-kicker">Provenance</p><h2 id="credits-title">Credits and disclosure</h2></div><button type="button" className="modal-close" aria-label="Close credits" onClick={onClose}>×</button></header>
        <div className="disclosure">
          <strong>Independent simulated broadcast</strong>
          <p>This is a generated simulation for a private prototype. Timing, incidents, results, track geometry, liveries, and presentation graphics are fictional or project-original. It is not affiliated with or endorsed by Formula 1, the FIA, the Monaco Grand Prix, its teams, or drivers.</p>
        </div>
        <ul className="credits-list">
          {credits.map((credit) => (
            <li key={credit.id}>
              <h3>{credit.title}</h3>
              <p>{credit.creator}</p>
              <dl><div><dt>Source</dt><dd>{credit.source}</dd></div><div><dt>License</dt><dd><a href={credit.licenseUrl} target="_blank" rel="noreferrer">{credit.license} license</a></dd></div><div><dt>Modifications</dt><dd>{credit.modifications}</dd></div></dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
