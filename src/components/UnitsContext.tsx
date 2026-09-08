import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { formatDistanceIn, formatHeight, loadUnits, saveUnits, type Units } from '../lib/units';

interface UnitsApi {
  units: Units;
  setUnits: (units: Units) => void;
  /** A height in whole metres or whole feet — "163 m", "535 ft". */
  height: (metres: number) => string;
  /** A distance in m/km or ft/mi. */
  distance: (metres: number) => string;
}

/**
 * Metric by default, so anything rendered outside the provider — a test, a
 * component someone mounts on its own — still prints a sensible figure instead
 * of throwing. Its setter is inert on purpose: silently doing nothing is better
 * than pretending a preference was stored somewhere it cannot be read back.
 */
const UnitsContext = createContext<UnitsApi>({
  units: 'metric',
  setUnits: () => undefined,
  height: (m) => formatHeight(m, 'metric'),
  distance: (m) => formatDistanceIn(m, 'metric'),
});

/**
 * Context rather than prop drilling because heights are printed in six
 * components at three different depths, four of them under a memo boundary that
 * a new prop would have to be threaded through by hand. Context also re-renders
 * past `memo`, which is exactly what switching units has to do.
 */
export function UnitsProvider({ children }: { children: ReactNode }) {
  // Read once, lazily: localStorage is synchronous and this sits above the
  // whole tree, so doing it on every render would tax every keystroke.
  const [units, setUnitsState] = useState<Units>(loadUnits);

  const value = useMemo<UnitsApi>(
    () => ({
      units,
      setUnits: (next: Units) => {
        setUnitsState(next);
        saveUnits(next);
      },
      height: (m: number) => formatHeight(m, units),
      distance: (m: number) => formatDistanceIn(m, units),
    }),
    [units],
  );

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsApi {
  return useContext(UnitsContext);
}
