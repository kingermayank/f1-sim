/**
 * Pit decision freeze card — minimal visual placeholder for future pit wall feature.
 * Shows when strategy decision is pending (not implemented in current spectator sim).
 * 
 * Visual craft only: demonstrates broadcast glass system over bright asphalt.
 * Product logic (pit wall, player taps) is future work per VISION.md.
 */

interface PitDecisionCardProps {
  driverName: string;
  driverCode: string;
  teamColor: string;
  currentLap: number;
  currentTire: string;
  tireWear: number;
  isAuto?: boolean;
}

export function PitDecisionCard({
  driverName,
  driverCode,
  teamColor,
  currentLap,
  currentTire,
  tireWear,
  isAuto = false,
}: PitDecisionCardProps) {
  return (
    <div className="pit-decision-card" data-auto={isAuto || undefined}>
      <header className="pit-decision-card__header">
        <div className="pit-decision-card__driver" style={{ '--team-color': teamColor } as React.CSSProperties}>
          <strong>{driverCode}</strong>
          <small>{driverName}</small>
        </div>
        {isAuto && <span className="pit-decision-card__auto">AUTO</span>}
      </header>

      <section className="pit-decision-card__stake">
        <h3>Current Situation</h3>
        <dl>
          <div>
            <dt>Lap</dt>
            <dd>{currentLap}</dd>
          </div>
          <div>
            <dt>Tire</dt>
            <dd className="pit-decision-card__tire">{currentTire}</dd>
          </div>
          <div>
            <dt>Wear</dt>
            <dd>{Math.round(tireWear * 100)}%</dd>
          </div>
        </dl>
      </section>

      <section className="pit-decision-card__taps">
        <h3>Decision</h3>
        <div className="pit-decision-card__buttons">
          <button className="pit-decision-card__button pit-decision-card__button--primary">
            Box this lap
          </button>
          <button className="pit-decision-card__button">
            Stay out
          </button>
        </div>
      </section>

      <footer className="pit-decision-card__timeout">
        <span>Decision locks in 8s</span>
      </footer>
    </div>
  );
}
