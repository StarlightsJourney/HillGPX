/**
 * Local training log and weekly goal.
 *
 * Stored in the browser only; not synced to GitHub. A session is created when a
 * dropped GPX route is saved to this device.
 */

const GOAL_KEY = 'hillgpx:trainingGoal';
const LOG_KEY = 'hillgpx:trainingLog';

export interface Session {
  savedAt: string; // ISO 8601
  routeName: string;
  gainM: number;
  distanceM: number;
}

export interface TrainingState {
  goalM: number;
  sessions: Session[];
}

const DEFAULT_GOAL = 1000;

export function loadTrainingState(): TrainingState {
  let goalM = DEFAULT_GOAL;
  try {
    const raw = localStorage.getItem(GOAL_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) goalM = parsed;
    }
  } catch {
    // ignore
  }

  let sessions: Session[] = [];
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      sessions = Array.isArray(parsed) ? (parsed as Session[]) : [];
    }
  } catch {
    sessions = [];
  }

  return { goalM, sessions };
}

export function saveGoal(goalM: number): void {
  try {
    localStorage.setItem(GOAL_KEY, String(Math.max(0, Math.round(goalM))));
  } catch {
    throw new Error('Could not save the weekly goal because browser storage is unavailable.');
  }
}

export function logSession(session: Omit<Session, 'savedAt'>): void {
  const state = loadTrainingState();
  const next: Session = { ...session, savedAt: new Date().toISOString() };
  state.sessions.push(next);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(state.sessions));
  } catch {
    throw new Error('Could not log the session because browser storage is full.');
  }
}

export function deleteSession(savedAt: string): void {
  const state = loadTrainingState();
  state.sessions = state.sessions.filter((s) => s.savedAt !== savedAt);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(state.sessions));
  } catch {
    throw new Error('Could not update the training log.');
  }
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun, 1 = Mon
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function getCurrentWeekSessions(state: TrainingState): Session[] {
  const weekStart = startOfWeek(new Date());
  return state.sessions.filter((s) => new Date(s.savedAt) >= weekStart);
}

export function weeklyTotalM(state: TrainingState): number {
  return getCurrentWeekSessions(state).reduce((sum, s) => sum + s.gainM, 0);
}

export interface DayStat {
  label: string;
  gainM: number;
  sessions: number;
}

export function weeklyChart(state: TrainingState): DayStat[] {
  const weekStart = startOfWeek(new Date());
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const days = labels.map((label, i) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    const daySessions = state.sessions.filter((s) => isSameDay(new Date(s.savedAt), day));
    return {
      label,
      gainM: daySessions.reduce((sum, s) => sum + s.gainM, 0),
      sessions: daySessions.length,
    };
  });
  return days;
}

export function recentSessions(state: TrainingState, limit = 10): Session[] {
  return [...state.sessions]
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    .slice(0, limit);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}
