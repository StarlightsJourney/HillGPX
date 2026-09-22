import { useCallback, useMemo, useState } from 'react';
import {
  deleteSession,
  formatDate,
  loadTrainingState,
  recentSessions,
  saveGoal,
  weeklyChart,
  weeklyTotalM,
} from '../lib/training';
import { useUnits } from './UnitsContext';
import { ChartIcon, ChevronLeftIcon, TargetIcon } from './icons';

function TrashIconComp({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

interface TrainingPanelProps {
  onClose: () => void;
}

export function TrainingPanel({ onClose }: TrainingPanelProps) {
  const units = useUnits();
  const [state, setState] = useState(loadTrainingState);
  const [goalInput, setGoalInput] = useState(String(state.goalM));
  const total = useMemo(() => weeklyTotalM(state), [state]);
  const chart = useMemo(() => weeklyChart(state), [state]);
  const recent = useMemo(() => recentSessions(state), [state]);
  const maxDay = useMemo(() => Math.max(...chart.map((d) => d.gainM), state.goalM / 7), [chart, state.goalM]);
  const progress = Math.min(100, (total / state.goalM) * 100);

  const updateGoal = useCallback(() => {
    const value = Number(goalInput);
    if (!Number.isFinite(value) || value <= 0) {
      setGoalInput(String(state.goalM));
      return;
    }
    saveGoal(value);
    setState(loadTrainingState);
  }, [goalInput, state.goalM]);

  const removeSession = useCallback((savedAt: string) => {
    deleteSession(savedAt);
    setState(loadTrainingState);
  }, []);

  return (
    <div className="training-panel">
      <header className="training-panel-head">
        <button type="button" className="training-back" onClick={onClose} aria-label="Back to map">
          <ChevronLeftIcon size={20} />
        </button>
        <h1>Training balance</h1>
      </header>

      <section className="training-card">
        <div className="training-goal-row">
          <div className="training-icon">
            <TargetIcon size={22} />
          </div>
          <div className="training-goal-fields">
            <label htmlFor="weekly-goal">Weekly elevation goal</label>
            <div className="training-goal-input">
              <input
                id="weekly-goal"
                type="number"
                min={100}
                step={100}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                onBlur={updateGoal}
                onKeyDown={(e) => e.key === 'Enter' && updateGoal()}
              />
              <span>metres</span>
            </div>
          </div>
        </div>

        <div className="training-progress">
          <div className="training-progress-track">
            <div className="training-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="training-progress-label">
            <strong>{units.height(total)}</strong> of {units.height(state.goalM)} this week
          </p>
        </div>
      </section>

      <section className="training-card">
        <h2>
          <ChartIcon size={18} /> This week
        </h2>
        <div className="training-chart">
          {chart.map((day) => {
            const heightPct = maxDay > 0 ? (day.gainM / maxDay) * 100 : 0;
            return (
              <div key={day.label} className="training-chart-col">
                <div className="training-chart-bar-wrap">
                  <div
                    className="training-chart-bar"
                    style={{ height: `${heightPct}%` }}
                    title={day.sessions > 0 ? `${day.sessions} session${day.sessions > 1 ? 's' : ''}` : undefined}
                  />
                </div>
                <span className="training-chart-value">{day.gainM > 0 ? units.height(day.gainM) : ''}</span>
                <span className="training-chart-label">{day.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="training-card">
        <h2>Recent sessions</h2>
        {recent.length === 0 ? (
          <div className="training-empty">
            <p>No sessions logged yet.</p>
            <p className="muted">Drop a GPX on the map and save it to this device to log your first climb.</p>
          </div>
        ) : (
          <ul className="training-sessions">
            {recent.map((session) => (
              <li key={session.savedAt} className="training-session">
                <div>
                  <strong>{session.routeName}</strong>
                  <span className="muted">{formatDate(session.savedAt)} · {units.height(session.gainM)} gained</span>
                </div>
                <button
                  type="button"
                  className="training-delete"
                  aria-label="Remove session"
                  onClick={() => removeSession(session.savedAt)}
                >
                  <TrashIconComp size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
