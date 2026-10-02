import { useEffect, useState } from 'react';
import { communityStats } from '../lib/api';
import { compactCount, computeCoverage, formatShare, type Coverage } from '../lib/coverage';
import { loadDataset } from '../lib/venues';
import { loadPeakIndex } from '../lib/worldPeaks';
import { GlobeIcon } from './icons';
import { Modal } from './Modal';

/** Coverage numbers, loaded once and shared by every pill on the page. */
export function useCoverage(): Coverage | null {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadDataset(), loadPeakIndex(), communityStats()])
      .then(([dataset, index, stats]) => {
        if (!cancelled) setCoverage(computeCoverage(dataset, index, stats));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return coverage;
}

interface CoveragePillProps {
  onUpload: () => void;
  className?: string;
}

/**
 * "917k summits · 0.01% have a GPX": how much of the map the community has
 * filled in, as one tappable pill. The breakdown it opens ends in the actions
 * that move the numbers.
 */
export function CoveragePill({ onUpload, className = '' }: CoveragePillProps) {
  const coverage = useCoverage();
  const [open, setOpen] = useState(false);
  if (!coverage) return null;
  return (
    <>
      <button type="button" className={`coverage-pill ${className}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <GlobeIcon size={16} />
        <span>
          <strong>{compactCount(coverage.summits)}</strong> hills
        </span>
        <span className="coverage-pill-sep" aria-hidden="true" />
        <span>
          <strong>{coverage.placesWithRoutes.toLocaleString()}</strong> with a GPX
        </span>
      </button>
      {open && <CoverageModal coverage={coverage} onClose={() => setOpen(false)} onUpload={() => { setOpen(false); onUpload(); }} />}
    </>
  );
}

function Meter({ label, value, share }: { label: string; value: string; share: number }) {
  return (
    <div className="coverage-meter">
      <div className="coverage-meter-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="coverage-meter-track" aria-hidden="true">
        <span style={{ width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%` }} />
      </div>
    </div>
  );
}

function CoverageModal({ coverage, onClose, onUpload }: { coverage: Coverage; onClose: () => void; onUpload: () => void }) {
  return (
    <Modal
      title="What's mapped"
      onClose={onClose}
      footer={<button type="button" className="btn btn-accent" onClick={onUpload}>Add a GPX</button>}
    >
      <div className="coverage-hero">
        <div>
          <strong>{coverage.summits.toLocaleString()}</strong>
          <span>hills</span>
        </div>
        <div>
          <strong>{coverage.countries}</strong>
          <span>countries</span>
        </div>
        <div>
          <strong>{coverage.builtClimbs.toLocaleString()}</strong>
          <span>stairs and blocks</span>
        </div>
      </div>

      <Meter
        label="With a GPX"
        value={`${coverage.placesWithRoutes.toLocaleString()} · ${formatShare(coverage.gpxShare)}`}
        share={coverage.gpxShare}
      />
      <Meter
        label="With a photo"
        value={`${coverage.placesWithPhotos.toLocaleString()} · ${formatShare(coverage.photoShare)}`}
        share={coverage.photoShare}
      />
      <div className="coverage-row">
        <span>Routes</span>
        <strong>{coverage.routes.toLocaleString()}</strong>
      </div>
      <div className="coverage-row">
        <span>Reviews</span>
        <strong>{coverage.reviews.toLocaleString()}</strong>
      </div>
    </Modal>
  );
}
